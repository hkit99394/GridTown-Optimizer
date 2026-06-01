import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { assertValidLayoutEvaluateInputs, assertValidSolveInputs } from "../../../packages/core/index.js";
import { checkCpSatReadiness } from "../../../packages/solvers/cp-sat/solver.js";
import {
  getOptimizerAdapter,
  resolveOptimizerName,
  SolveJobManager,
  settleFailedSolve,
  settleSuccessfulSolve
} from "../../../packages/runtime/index.js";
import {
  assertValidSerializedSolutionPayload,
  isCancelSolveRequest,
  isLayoutEvaluateRequest,
  isSolveRequest,
  materializeSerializedSolution,
  resolveSolveRequestClientRole,
  sanitizeSolveRequest
} from "./contracts.js";
import { buildManualLayoutResponse, buildSolveResponse } from "./solutionResponse.js";
import {
  buildActiveSolveResponse,
  buildRecoveredProgressLogStatusResponse,
  buildSolveStatusResponse
} from "./solveStatusResponse.js";
import { monitorClientDisconnect, readValidatedJsonBody, sendJson } from "./transport.js";

import type { CancelSolveRequest, LayoutEvaluateRequest, SolveRequest } from "./contracts.js";
import type { SerializedSolution } from "../../../packages/core/index.js";

export const PLANNER_API_ROUTE_METHODS: ReadonlyMap<string, readonly string[]> = new Map([
  ["/api/health", ["GET", "HEAD"]],
  ["/api/cp-sat/readiness", ["GET", "HEAD"]],
  ["/api/solve", ["POST"]],
  ["/api/layout/evaluate", ["POST"]],
  ["/api/solve/start", ["POST"]],
  ["/api/solve/status", ["GET", "HEAD"]],
  ["/api/solve/active", ["GET", "HEAD"]],
  ["/api/solve/cancel", ["POST"]]
]);

function buildCancelRequestedMessage(optimizer: string): string {
  return optimizer === "cp-sat"
    ? "Stop requested. Finalizing the current CP-SAT run and preserving the best feasible solution found so far."
    : optimizer === "auto"
      ? "Stop requested. Finalizing the current auto stage and preserving the best incumbent found so far."
      : optimizer === "lns"
        ? "Stop requested. Finalizing the current LNS run and preserving the best solution found so far."
        : "Stop requested. Finalizing the current greedy run and preserving the best result found so far.";
}

function sendSolveCapacityFull(res: ServerResponse<IncomingMessage>, solveJobManager: SolveJobManager): void {
  const activeJob = solveJobManager.getActiveRunningJob();
  sendJson(res, 429, {
    ok: false,
    error:
      "Another solve is already running. Stop the running solve or wait for it to finish before starting a new one.",
    ...(activeJob ? { activeSolve: buildActiveSolveResponse(activeJob) } : {})
  });
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

function isPostRoute(req: IncomingMessage, pathname: string): boolean {
  return req.method === "POST" && requestUrl(req).pathname === pathname;
}

function matchGetOrHeadRoute(req: IncomingMessage, pathname: string): { url: URL; headOnly: boolean } | null {
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
  const solution = sanitized.solution;
  assertValidSerializedSolutionPayload(solution, "Manual layout solution");
  return { ...sanitized, solution };
}

export function handlePlannerHealth(req: IncomingMessage, res: ServerResponse<IncomingMessage>): boolean {
  const route = matchGetOrHeadRoute(req, "/api/health");
  if (!route) return false;

  sendJson(res, 200, { ok: true }, route.headOnly);
  return true;
}

export function handleCpSatReadiness(req: IncomingMessage, res: ServerResponse<IncomingMessage>): boolean {
  const route = matchGetOrHeadRoute(req, "/api/cp-sat/readiness");
  if (!route) return false;

  sendJson(res, 200, { ok: true, cpSat: checkCpSatReadiness() }, route.headOnly);
  return true;
}

export function handleActiveSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): boolean {
  const route = matchGetOrHeadRoute(req, "/api/solve/active");
  if (!route) return false;

  const activeJob = solveJobManager.getActiveRunningJob();
  sendJson(
    res,
    200,
    activeJob
      ? buildActiveSolveResponse(activeJob)
      : {
          ok: true,
          active: false
        },
    route.headOnly
  );
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
    sendSolveCapacityFull(res, solveJobManager);
    return true;
  }

  try {
    const optimizerAdapter = getOptimizerAdapter(payload.params);
    const handle = optimizerAdapter.startBackgroundSolve(payload.grid, payload.params);
    const disconnectMonitor = monitorClientDisconnect(req, res, () => {
      handle.cancel();
    });

    try {
      const settlement = settleSuccessfulSolve(await handle.promise, {
        optimizer: optimizerAdapter.name,
        handle,
        cancelRequested: false,
        lastProgressEntry: null
      });
      if (disconnectMonitor.isDisconnected()) return true;
      if (!settlement.solution) throw new Error("Solve completed without a solution.");

      sendJson(res, 200, {
        ok: true,
        ...(settlement.message ? { message: settlement.message } : {}),
        ...buildSolveResponse(payload.grid, payload.params, settlement.solution)
      });
    } catch (error) {
      if (disconnectMonitor.isDisconnected()) return true;
      const settlement = settleFailedSolve(error, {
        optimizer: optimizerAdapter.name,
        handle,
        cancelRequested: false,
        lastProgressEntry: null
      });
      if (!settlement.solution) throw error;

      sendJson(res, 200, {
        ok: true,
        ...(settlement.message ? { message: settlement.message } : {}),
        ...buildSolveResponse(payload.grid, payload.params, settlement.solution)
      });
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
    ...buildManualLayoutResponse(payload.grid, payload.params, solution)
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

  const requestId =
    typeof payload.requestId === "string" && payload.requestId.trim() ? payload.requestId.trim() : randomUUID();
  const existingJob = solveJobManager.replaceIfIdle(requestId);
  if (existingJob?.status === "running") {
    sendJson(res, 409, {
      ok: false,
      error: "A solve with this request ID is already running."
    });
    return true;
  }
  if (!solveJobManager.canStartSolve()) {
    sendSolveCapacityFull(res, solveJobManager);
    return true;
  }

  const clientRole = resolveSolveRequestClientRole(payload);
  const job = solveJobManager.start(payload.grid, payload.params, requestId, { clientRole });
  sendJson(res, 202, {
    ok: true,
    requestId,
    clientRole,
    optimizer: resolveOptimizerName(payload.params),
    jobStatus: "running",
    progressLogFilePath: job.progressLogFilePath
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

  const requestId = route.url.searchParams.get("requestId")?.trim() ?? "";
  const includeSnapshot = ["1", "true", "yes"].includes(
    (route.url.searchParams.get("includeSnapshot") ?? "").toLowerCase()
  );
  if (!requestId) {
    sendJson(
      res,
      400,
      {
        ok: false,
        error: "Missing requestId query parameter."
      },
      route.headOnly
    );
    return true;
  }

  const jobStatus = solveJobManager.getStatus(requestId, includeSnapshot);
  if (!jobStatus) {
    const progressLogStatus = solveJobManager.getProgressLogStatus(requestId);
    if (progressLogStatus) {
      const projection = buildRecoveredProgressLogStatusResponse(progressLogStatus);
      sendJson(res, projection.statusCode, projection.payload, route.headOnly);
      return true;
    }

    sendJson(
      res,
      404,
      {
        ok: false,
        error: "No solve job was found for that request."
      },
      route.headOnly
    );
    return true;
  }
  const projection = buildSolveStatusResponse(jobStatus);
  sendJson(res, projection.statusCode, projection.payload, route.headOnly);
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

  const activeSolve = solveJobManager.get(payload.requestId.trim());
  if (!activeSolve) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      message: "No solve job was found for that request."
    });
    return true;
  }

  if (activeSolve.status !== "running" || !activeSolve.handle) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      message: "That solve is no longer running."
    });
    return true;
  }

  solveJobManager.cancel(payload.requestId.trim());
  sendJson(res, 200, {
    ok: true,
    stopped: true,
    message: buildCancelRequestedMessage(activeSolve.optimizer)
  });
  return true;
}
