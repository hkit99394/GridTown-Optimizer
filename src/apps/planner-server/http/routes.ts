import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { assertValidLayoutEvaluateInputs, assertValidSolveInputs } from "../../../packages/core/index.js";
import {
  getOptimizerAdapter,
  resolveOptimizerName,
  SolveJobManager,
  settleFailedSolve,
  settleSuccessfulSolve,
  type SolveJob,
  type SolveProgressLogReadResult
} from "../../../packages/runtime/index.js";
import {
  assertValidSerializedSolutionPayload,
  isCancelSolveRequest,
  isLayoutEvaluateRequest,
  isSolveRequest,
  materializeSerializedSolution,
  sanitizeSolveRequest
} from "./contracts.js";
import { buildCompactSolveResponse, buildManualLayoutResponse, buildSolveResponse } from "./solutionResponse.js";
import { monitorClientDisconnect, readValidatedJsonBody, sendJson } from "./transport.js";

import type { CancelSolveRequest, LayoutEvaluateRequest, SolveRequest } from "./contracts.js";
import type { SerializedSolution, Solution } from "../../../packages/core/index.js";

function buildSolveJobResponseBase(job: {
  requestId: string;
  optimizer: string;
  status: string;
  cancelRequested: boolean;
  progressLogFilePath: string;
}) {
  return {
    ok: true,
    requestId: job.requestId,
    optimizer: job.optimizer,
    jobStatus: job.status,
    cancelRequested: job.cancelRequested,
    progressLogFilePath: job.progressLogFilePath
  };
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
    source: "live-snapshot"
  });
}

function buildProgressLogStatusResponseBase(progressLog: SolveProgressLogReadResult) {
  const { document, filePath } = progressLog;
  return {
    ok: true,
    requestId: document.requestId,
    optimizer: document.optimizer,
    jobStatus: document.status,
    cancelRequested: document.status === "stopped" || Boolean(document.finalResult?.stoppedByUser),
    progressLogFilePath: filePath
  };
}

function sendSolveCapacityFull(res: ServerResponse<IncomingMessage>): void {
  sendJson(res, 429, {
    ok: false,
    error:
      "Another solve is already running. Stop the running solve or wait for it to finish before starting a new one."
  });
}

function buildOrphanedRunningProgressLogMessage(): string {
  return "Solver status was lost because the local server is no longer tracking this run. The progress log still shows it as running, so the server was likely stopped or restarted before the solve finished.";
}

function buildTerminalProgressLogError(progressLog: SolveProgressLogReadResult): string {
  const { status, error } = progressLog.document;
  return (
    error ??
    (status === "stopped"
      ? "Solve was stopped."
      : status === "failed"
        ? "Solve failed."
        : "Solve completed without a persisted final result.")
  );
}

function getRecoveredProgressLogValidationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown validation error.";
  return `Recovered solve progress log is invalid and cannot be materialized: ${detail}`;
}

function buildRecoveredProgressLogTerminalErrorResponse(
  progressLog: SolveProgressLogReadResult,
  progressEntry: SolveProgressLogReadResult["document"]["entries"][number] | null,
  error: string
) {
  const { document } = progressLog;
  return {
    ...buildProgressLogStatusResponseBase(progressLog),
    ...(document.message ? { message: document.message } : {}),
    ...(progressEntry ? { progressEntry } : {}),
    error
  };
}

function sendRecoveredProgressLogStatus(
  res: ServerResponse<IncomingMessage>,
  progressLog: SolveProgressLogReadResult,
  headOnly: boolean
): void {
  const { document, filePath } = progressLog;
  const progressEntry = document.entries[document.entries.length - 1] ?? null;
  if (document.status !== "running") {
    if (document.finalResult) {
      let compactResponse: ReturnType<typeof buildCompactSolveResponse>;
      try {
        assertValidSolveInputs(document.input.grid, document.input.params);
        assertValidSerializedSolutionPayload(
          document.finalResult.solution,
          "Recovered progress log finalResult.solution"
        );
        const solution = materializeSerializedSolution(document.finalResult.solution);
        compactResponse = buildCompactSolveResponse(document.input.grid, document.input.params, solution, {
          validationMode: "full"
        });
      } catch (error) {
        sendJson(
          res,
          200,
          buildRecoveredProgressLogTerminalErrorResponse(
            progressLog,
            progressEntry,
            getRecoveredProgressLogValidationError(error)
          ),
          headOnly
        );
        return;
      }
      sendJson(
        res,
        200,
        {
          ...buildProgressLogStatusResponseBase(progressLog),
          ...(document.message ? { message: document.message } : {}),
          ...(document.error ? { error: document.error } : {}),
          ...(progressEntry ? { progressEntry } : {}),
          ...compactResponse
        },
        headOnly
      );
      return;
    }

    sendJson(
      res,
      200,
      {
        ...buildProgressLogStatusResponseBase(progressLog),
        ...(document.message ? { message: document.message } : {}),
        ...(progressEntry ? { progressEntry } : {}),
        error: buildTerminalProgressLogError(progressLog)
      },
      headOnly
    );
    return;
  }

  sendJson(
    res,
    410,
    {
      ok: false,
      requestId: document.requestId,
      optimizer: document.optimizer,
      jobStatus: document.status === "running" ? "failed" : document.status,
      cancelRequested: false,
      progressLogFilePath: filePath,
      ...(progressEntry ? { progressEntry } : {}),
      error: buildOrphanedRunningProgressLogMessage()
    },
    headOnly
  );
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
    sendSolveCapacityFull(res);
    return true;
  }

  const job = solveJobManager.start(payload.grid, payload.params, requestId);
  sendJson(res, 202, {
    ok: true,
    requestId,
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
      sendRecoveredProgressLogStatus(res, progressLogStatus, route.headOnly);
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
  const { job, snapshotState, liveSnapshot } = jobStatus;

  if (job.solution) {
    const progressEntry = job.progressLogWriter.getLastEntry();
    sendJson(
      res,
      200,
      {
        ...buildSolveJobResponseBase(job),
        ...(job.message ? { message: job.message } : {}),
        ...(progressEntry ? { progressEntry } : {}),
        ...buildCompactSolveResponse(job.grid, job.params, job.solution, { validationMode: "full" })
      },
      route.headOnly
    );
    return true;
  }

  if (job.status !== "running") {
    sendJson(
      res,
      200,
      {
        ...buildSolveJobResponseBase(job),
        error: job.error ?? (job.status === "stopped" ? "Solve was stopped." : "Solve failed.")
      },
      route.headOnly
    );
    return true;
  }

  if (liveSnapshot) {
    const progressEntry = buildLiveProgressEntry(job, liveSnapshot);
    sendJson(
      res,
      200,
      {
        ...buildSolveJobResponseBase(job),
        hasFeasibleSolution: snapshotState.hasFeasibleSolution,
        bestTotalPopulation: snapshotState.totalPopulation,
        activeOptimizer: snapshotState.activeOptimizer ?? null,
        autoStage: snapshotState.autoStage ?? null,
        progressEntry,
        liveSnapshot: true,
        ...(job.message ? { message: job.message } : {}),
        ...buildCompactSolveResponse(job.grid, job.params, liveSnapshot, { validationMode: "lightweight" })
      },
      route.headOnly
    );
    return true;
  }

  const progressEntry = job.progressLogWriter.getLastEntry();
  sendJson(
    res,
    200,
    {
      ...buildSolveJobResponseBase(job),
      hasFeasibleSolution: snapshotState.hasFeasibleSolution,
      bestTotalPopulation: snapshotState.totalPopulation,
      activeOptimizer: snapshotState.activeOptimizer ?? null,
      autoStage: snapshotState.autoStage ?? null,
      ...(progressEntry ? { progressEntry } : {})
    },
    route.headOnly
  );
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
