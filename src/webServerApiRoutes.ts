import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { getOptimizerAdapter, resolveOptimizerName } from "./optimizerRegistry.js";
import { SolveJobManager } from "./solveJobManager.js";
import { assertValidSolveInputs } from "./solverInputValidation.js";
import {
  buildManualLayoutResponse,
  buildSolveResponse,
  isCancelSolveRequest,
  isLayoutEvaluateRequest,
  isSolveRequest,
  materializeSerializedSolution,
} from "./webServerHttp.js";
import { monitorClientDisconnect, readValidatedJsonBody, sendJson } from "./webServerTransport.js";

import type { CancelSolveRequest, LayoutEvaluateRequest, SolveRequest } from "./webServerHttp.js";

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
    progressLogFilePath: job.progressLogFilePath,
  };
}

function buildCancelRequestedMessage(optimizer: string): string {
  return optimizer === "cp-sat"
    ? "Stop requested. Finalizing the current CP-SAT run and preserving the best feasible solution found so far."
    : optimizer === "lns"
      ? "Stop requested. Finalizing the current LNS run and preserving the best solution found so far."
      : "Stop requested. Finalizing the current greedy run and preserving the best result found so far.";
}

export function handlePlannerHealth(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): boolean {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  if ((method !== "GET" && method !== "HEAD") || url.pathname !== "/api/health") return false;

  sendJson(res, 200, { ok: true }, method === "HEAD");
  return true;
}

export async function handleImmediateSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve") return false;

  const payload = await readValidatedJsonBody<SolveRequest>(
    req,
    res,
    isSolveRequest,
    "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid."
  );
  if (!payload) return true;

  assertValidSolveInputs(payload.grid, payload.params);
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
  return true;
}

export async function handleLayoutEvaluate(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/layout/evaluate") return false;

  const payload = await readValidatedJsonBody<LayoutEvaluateRequest>(
    req,
    res,
    isLayoutEvaluateRequest,
    "Invalid layout-evaluate payload. Expected { grid, params, solution } with a rectangular 0/1 grid."
  );
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
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve/start") return false;

  const payload = await readValidatedJsonBody<SolveRequest>(
    req,
    res,
    isSolveRequest,
    "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid."
  );
  if (!payload) return true;

  assertValidSolveInputs(payload.grid, payload.params);
  const requestId = typeof payload.requestId === "string" && payload.requestId.trim()
    ? payload.requestId.trim()
    : randomUUID();
  const existingJob = solveJobManager.replaceIfIdle(requestId);
  if (existingJob?.status === "running") {
    sendJson(res, 409, {
      ok: false,
      error: "A solve with this request ID is already running.",
    });
    return true;
  }

  const job = solveJobManager.start(payload.grid, payload.params, requestId);
  sendJson(res, 202, {
    ok: true,
    requestId,
    optimizer: resolveOptimizerName(payload.params),
    jobStatus: "running",
    progressLogFilePath: job.progressLogFilePath,
  });
  return true;
}

export function handleSolveStatus(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): boolean {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve/status") return false;

  const requestId = url.searchParams.get("requestId")?.trim() ?? "";
  const includeSnapshot = ["1", "true", "yes"].includes((url.searchParams.get("includeSnapshot") ?? "").toLowerCase());
  if (!requestId) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing requestId query parameter.",
    }, method === "HEAD");
    return true;
  }

  const jobStatus = solveJobManager.getStatus(requestId, includeSnapshot);
  if (!jobStatus) {
    sendJson(res, 404, {
      ok: false,
      error: "No solve job was found for that request.",
    }, method === "HEAD");
    return true;
  }
  const { job, snapshotState, liveSnapshot } = jobStatus;

  if (job.solution) {
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      ...(job.message ? { message: job.message } : {}),
      ...buildSolveResponse(job.grid, job.params, job.solution),
    }, method === "HEAD");
    return true;
  }

  if (job.status !== "running") {
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      error: job.error ?? (job.status === "stopped" ? "Solve was stopped." : "Solve failed."),
    }, method === "HEAD");
    return true;
  }

  if (liveSnapshot) {
    sendJson(res, 200, {
      ...buildSolveJobResponseBase(job),
      hasFeasibleSolution: snapshotState.hasFeasibleSolution,
      bestTotalPopulation: snapshotState.totalPopulation,
      liveSnapshot: true,
      ...(job.message ? { message: job.message } : {}),
      ...buildSolveResponse(job.grid, job.params, liveSnapshot),
    }, method === "HEAD");
    return true;
  }

  sendJson(res, 200, {
    ...buildSolveJobResponseBase(job),
    hasFeasibleSolution: snapshotState.hasFeasibleSolution,
    bestTotalPopulation: snapshotState.totalPopulation,
  }, method === "HEAD");
  return true;
}

export async function handleCancelSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve/cancel") return false;

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

  solveJobManager.cancel(payload.requestId.trim());
  sendJson(res, 200, {
    ok: true,
    stopped: true,
    message: buildCancelRequestedMessage(activeSolve.optimizer),
  });
  return true;
}
