import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  assertValidLayoutEvaluateInputs,
  assertValidSolveInputs,
  SolverInputError,
} from "../../core/solverInputValidation.js";
import { getOptimizerAdapter, resolveOptimizerName } from "../../runtime/dispatch/optimizerRegistry.js";
import { SolveJobManager, type SolveJob } from "../../runtime/jobs/solveJobManager.js";
import {
  assertHttpPlannerInputLimits,
  assertValidSerializedSolutionPayload,
  isCancelSolveRequest,
  isLayoutEvaluateRequest,
  isSolveRequest,
  materializeSerializedSolution,
  sanitizeSolveRequest,
} from "./contracts.js";
import { buildManualLayoutResponse, buildSolveResponse } from "./solutionResponse.js";
import { monitorClientDisconnect, readValidatedJsonBody, sendJson } from "./transport.js";

import type { CancelSolveRequest, LayoutEvaluateRequest, SolveRequest } from "./contracts.js";
import type { SerializedSolution, Solution } from "../../core/types.js";

function buildSolveJobResponseBase(job: {
  requestId: string;
  optimizer: string;
  status: string;
  cancelRequested: boolean;
  progressLogFileName: string;
}) {
  return {
    ok: true,
    requestId: job.requestId,
    optimizer: job.optimizer,
    jobStatus: job.status,
    cancelRequested: job.cancelRequested,
    progressLogFileName: job.progressLogFileName,
  };
}

const MAX_SOLVE_REQUEST_ID_LENGTH = 120;
const SOLVE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizeProvidedSolveRequestId(requestId: unknown): string | null {
  if (typeof requestId !== "string") return null;
  const normalized = requestId.trim();
  if (!normalized) return null;
  if (
    normalized.length > MAX_SOLVE_REQUEST_ID_LENGTH
    || !SOLVE_REQUEST_ID_PATTERN.test(normalized)
  ) {
    throw new SolverInputError(
      `Solve requestId must be 1-${MAX_SOLVE_REQUEST_ID_LENGTH} characters using letters, numbers, ".", "_", or "-".`
    );
  }
  return normalized;
}

function normalizeRequiredSolveRequestId(requestId: unknown): string {
  const normalized = normalizeProvidedSolveRequestId(requestId);
  if (!normalized) {
    throw new SolverInputError("Solve requestId is required.");
  }
  return normalized;
}

function buildCancelRequestedMessage(optimizer: string): string {
  return optimizer === "cp-sat"
    ? "Stop requested. Finalizing the current CP-SAT run and preserving the best feasible solution found so far."
    : optimizer === "auto"
      ? "Stop requested. Finalizing the current auto stage and preserving the best incumbent found so far."
      : optimizer === "lns"
        ? "Stop requested. Finalizing the current LNS run and preserving the best solution found so far."
        : "Stop requested. Finalizing the current greedy run and preserving the best result found so far.";
}

function buildLiveProgressEntry(job: SolveJob, solution: Solution) {
  return job.progressLogWriter.buildSolutionSample(solution, {
    elapsedMs: Date.now() - job.createdAt,
    source: "live-snapshot",
  });
}

function sendSolveCapacityFull(res: ServerResponse<IncomingMessage>): void {
  sendJson(res, 429, {
    ok: false,
    error: "Another solve is already running. Stop the running solve or wait for it to finish before starting a new one.",
  });
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

function isPostRoute(req: IncomingMessage, pathname: string): boolean {
  return req.method === "POST" && requestUrl(req).pathname === pathname;
}

function matchGetOrHeadRoute(
  req: IncomingMessage,
  pathname: string
): { url: URL; headOnly: boolean } | null {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return null;
  const url = requestUrl(req);
  return url.pathname === pathname ? { url, headOnly: method === "HEAD" } : null;
}

async function readSolvePayload(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<SolveRequest | null> {
  const payload = await readValidatedJsonBody<SolveRequest>(
    req,
    res,
    isSolveRequest,
    "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid."
  );
  if (!payload) return null;

  const sanitized = sanitizeSolveRequest(payload);
  assertValidSolveInputs(sanitized.grid, sanitized.params);
  assertHttpPlannerInputLimits(sanitized.grid, sanitized.params);
  return sanitized;
}

async function readLayoutEvaluatePayload(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<(LayoutEvaluateRequest & { solution: SerializedSolution }) | null> {
  const payload = await readValidatedJsonBody<LayoutEvaluateRequest>(
    req,
    res,
    isLayoutEvaluateRequest,
    "Invalid layout-evaluate payload. Expected { grid, params, solution } with a rectangular 0/1 grid."
  );
  if (!payload) return null;

  const sanitized = sanitizeSolveRequest(payload);
  assertValidLayoutEvaluateInputs(sanitized.grid, sanitized.params);
  assertHttpPlannerInputLimits(sanitized.grid, sanitized.params);
  const solution = sanitized.solution;
  assertValidSerializedSolutionPayload(solution, "Manual layout solution");
  return { ...sanitized, solution };
}

export function handlePlannerHealth(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): boolean {
  const route = matchGetOrHeadRoute(req, "/api/health");
  if (!route) return false;

  sendJson(res, 200, { ok: true }, route.headOnly);
  return true;
}

export async function handleImmediateSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (!isPostRoute(req, "/api/solve")) return false;

  const payload = await readSolvePayload(req, res);
  if (!payload) return true;

  const solveLease = solveJobManager.tryAcquireImmediateSolve();
  if (!solveLease) {
    sendSolveCapacityFull(res);
    return true;
  }

  try {
    const handle = getOptimizerAdapter(payload.params).startBackgroundSolve(payload.grid, payload.params);
    const disconnectMonitor = monitorClientDisconnect(req, res, () => {
      handle.cancel();
    });

    try {
      const solution = await handle.promise;
      if (disconnectMonitor.isDisconnected()) return true;

      sendJson(res, 200, {
        ok: true,
        ...buildSolveResponse(payload.grid, payload.params, solution),
      });
    } catch (error) {
      if (disconnectMonitor.isDisconnected()) return true;
      throw error;
    } finally {
      disconnectMonitor.dispose();
    }
  } finally {
    solveLease.release();
  }
  return true;
}

export async function handleLayoutEvaluate(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<boolean> {
  if (!isPostRoute(req, "/api/layout/evaluate")) return false;

  const payload = await readLayoutEvaluatePayload(req, res);
  if (!payload) return true;

  const solution = materializeSerializedSolution(payload.solution);
  sendJson(res, 200, {
    ok: true,
    ...buildManualLayoutResponse(payload.grid, payload.params, solution),
  });
  return true;
}

export async function handleStartSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (!isPostRoute(req, "/api/solve/start")) return false;

  const payload = await readSolvePayload(req, res);
  if (!payload) return true;

  const requestId = normalizeProvidedSolveRequestId(payload.requestId) ?? randomUUID();
  const existingJob = solveJobManager.replaceIfIdle(requestId);
  if (existingJob?.status === "running") {
    sendJson(res, 409, {
      ok: false,
      error: "A solve with this request ID is already running.",
    });
    return true;
  }
  if (!solveJobManager.canStartSolve()) {
    sendSolveCapacityFull(res);
    return true;
  }

  const job = solveJobManager.start(payload.grid, payload.params, requestId);
  sendJson(res, 202, {
    ok: true,
    requestId,
    optimizer: resolveOptimizerName(payload.params),
    jobStatus: "running",
    progressLogFileName: job.progressLogFileName,
  });
  return true;
}

export function handleSolveStatus(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): boolean {
  const route = matchGetOrHeadRoute(req, "/api/solve/status");
  if (!route) return false;

  const requestIdValue = route.url.searchParams.get("requestId")?.trim() ?? "";
  const includeSnapshot = ["1", "true", "yes"].includes((route.url.searchParams.get("includeSnapshot") ?? "").toLowerCase());
  if (!requestIdValue) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing requestId query parameter.",
    }, route.headOnly);
    return true;
  }
  const requestId = normalizeRequiredSolveRequestId(requestIdValue);

  const jobStatus = solveJobManager.getStatus(requestId, includeSnapshot);
  if (!jobStatus) {
    sendJson(res, 404, {
      ok: false,
      error: "No solve job was found for that request.",
    }, route.headOnly);
    return true;
  }
  const { job, snapshotState, liveSnapshot } = jobStatus;

  if (job.solution) {
    const progressEntry = job.progressLogWriter.getLastEntry();
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      ...(job.message ? { message: job.message } : {}),
      ...(progressEntry ? { progressEntry } : {}),
      ...buildSolveResponse(job.grid, job.params, job.solution),
    }, route.headOnly);
    return true;
  }

  if (job.status !== "running") {
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      error: job.error ?? (job.status === "stopped" ? "Solve was stopped." : "Solve failed."),
    }, route.headOnly);
    return true;
  }

  if (liveSnapshot) {
    const progressEntry = buildLiveProgressEntry(job, liveSnapshot);
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      hasFeasibleSolution: snapshotState.hasFeasibleSolution,
      bestTotalPopulation: snapshotState.totalPopulation,
      activeOptimizer: snapshotState.activeOptimizer ?? null,
      autoStage: snapshotState.autoStage ?? null,
      progressEntry,
      liveSnapshot: true,
      ...(job.message ? { message: job.message } : {}),
      ...buildSolveResponse(job.grid, job.params, liveSnapshot),
    }, route.headOnly);
    return true;
  }

  const progressEntry = job.progressLogWriter.getLastEntry();
  sendJson(res, 200, {
    ...buildSolveJobResponseBase(job),
    hasFeasibleSolution: snapshotState.hasFeasibleSolution,
    bestTotalPopulation: snapshotState.totalPopulation,
    activeOptimizer: snapshotState.activeOptimizer ?? null,
    autoStage: snapshotState.autoStage ?? null,
    ...(progressEntry ? { progressEntry } : {}),
  }, route.headOnly);
  return true;
}

export async function handleCancelSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (!isPostRoute(req, "/api/solve/cancel")) return false;

  const payload = await readValidatedJsonBody<CancelSolveRequest>(
    req,
    res,
    isCancelSolveRequest,
    "Invalid cancel payload. Expected { requestId }."
  );
  if (!payload) return true;

  const requestId = normalizeRequiredSolveRequestId(payload.requestId);
  const activeSolve = solveJobManager.get(requestId);
  if (!activeSolve) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      message: "No solve job was found for that request.",
    });
    return true;
  }

  if (activeSolve.status !== "running" || !activeSolve.handle) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      message: "That solve is no longer running.",
    });
    return true;
  }

  solveJobManager.cancel(requestId);
  sendJson(res, 200, {
    ok: true,
    stopped: true,
    message: buildCancelRequestedMessage(activeSolve.optimizer),
  });
  return true;
}
