import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getOptimizerAdapter, resolveOptimizerName } from "./optimizerRegistry.js";
import { SolveJobManager } from "./solveJobManager.js";
import {
  buildManualLayoutResponse,
  buildSolveResponse,
  isCancelSolveRequest,
  isLayoutEvaluateRequest,
  isSolveRequest,
  materializeSerializedSolution,
} from "./webServerHttp.js";

const MAX_BODY_SIZE_BYTES = 2 * 1024 * 1024;

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/plannerShell.js": "plannerShell.js",
  "/plannerShared.js": "plannerShared.js",
  "/plannerPersistence.js": "plannerPersistence.js",
  "/plannerSolveRuntime.js": "plannerSolveRuntime.js",
  "/plannerExpansion.js": "plannerExpansion.js",
  "/plannerResults.js": "plannerResults.js",
  "/plannerRequestBuilder.js": "plannerRequestBuilder.js",
  "/plannerWorkbench.js": "plannerWorkbench.js",
  "/app.js": "app.js",
};

export interface PlannerRequestHandlerOptions {
  solveJobManager?: SolveJobManager;
  webRoot: string;
}

function sendJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
  headOnly = false
): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

function sendText(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType: string,
  headOnly = false
): void {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

function getErrorStatusCode(message: string): number {
  if (message.includes("Invalid solve payload") || message.includes("JSON")) return 400;
  if (message.includes("was stopped")) return 409;
  if (
    message.includes("backend failed")
    || message.includes("Failed to launch")
    || message.includes("exceeded")
  ) {
    return 500;
  }
  return 400;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > MAX_BODY_SIZE_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(
  webRoot: string,
  pathname: string,
  method: string,
  res: ServerResponse<IncomingMessage>
): Promise<void> {
  const relativePath = STATIC_FILES[pathname] ?? null;
  if (!relativePath) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8", method === "HEAD");
    return;
  }

  const filePath = resolve(webRoot, relativePath);
  const file = await readFile(filePath, "utf8");
  sendText(res, 200, file, contentTypeFor(relativePath), method === "HEAD");
}

async function handleImmediateSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve") return false;

  const body = await readBody(req);
  const payload = JSON.parse(body) as unknown;
  if (!isSolveRequest(payload)) {
    sendJson(res, 400, {
      ok: false,
      error: "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid.",
    });
    return true;
  }

  const solution = getOptimizerAdapter(payload.params).solve(payload.grid, payload.params);
  sendJson(res, 200, {
    ok: true,
    ...buildSolveResponse(payload.grid, payload.params, solution),
  });
  return true;
}

async function handleLayoutEvaluate(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/layout/evaluate") return false;

  const body = await readBody(req);
  const payload = JSON.parse(body) as unknown;
  if (!isLayoutEvaluateRequest(payload)) {
    sendJson(res, 400, {
      ok: false,
      error: "Invalid layout-evaluate payload. Expected { grid, params, solution } with a rectangular 0/1 grid.",
    });
    return true;
  }

  const solution = materializeSerializedSolution(payload.solution);
  sendJson(res, 200, {
    ok: true,
    ...buildManualLayoutResponse(payload.grid, payload.params, solution),
  });
  return true;
}

async function handleStartSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve/start") return false;

  const body = await readBody(req);
  const payload = JSON.parse(body) as unknown;
  if (!isSolveRequest(payload)) {
    sendJson(res, 400, {
      ok: false,
      error: "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid.",
    });
    return true;
  }

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

  solveJobManager.start(payload.grid, payload.params, requestId);
  sendJson(res, 202, {
    ok: true,
    requestId,
    optimizer: resolveOptimizerName(payload.params),
    jobStatus: "running",
  });
  return true;
}

function handleSolveStatus(
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
      ok: true,
      requestId: job.requestId,
      optimizer: job.optimizer,
      jobStatus: job.status,
      cancelRequested: job.cancelRequested,
      ...(job.message ? { message: job.message } : {}),
      ...buildSolveResponse(job.grid, job.params, job.solution),
    }, method === "HEAD");
    return true;
  }

  if (job.status !== "running") {
    sendJson(res, 200, {
      ok: true,
      requestId: job.requestId,
      optimizer: job.optimizer,
      jobStatus: job.status,
      cancelRequested: job.cancelRequested,
      error: job.error ?? (job.status === "stopped" ? "Solve was stopped." : "Solve failed."),
    }, method === "HEAD");
    return true;
  }

  if (liveSnapshot) {
    sendJson(res, 200, {
      ok: true,
      requestId: job.requestId,
      optimizer: job.optimizer,
      jobStatus: job.status,
      cancelRequested: job.cancelRequested,
      hasFeasibleSolution: snapshotState.hasFeasibleSolution,
      bestTotalPopulation: snapshotState.totalPopulation,
      liveSnapshot: true,
      ...(job.message ? { message: job.message } : {}),
      ...buildSolveResponse(job.grid, job.params, liveSnapshot),
    }, method === "HEAD");
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    requestId: job.requestId,
    optimizer: job.optimizer,
    jobStatus: job.status,
    cancelRequested: job.cancelRequested,
    hasFeasibleSolution: snapshotState.hasFeasibleSolution,
    bestTotalPopulation: snapshotState.totalPopulation,
  }, method === "HEAD");
  return true;
}

async function handleCancelSolve(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  solveJobManager: SolveJobManager
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/solve/cancel") return false;

  const body = await readBody(req);
  const payload = JSON.parse(body) as unknown;
  if (!isCancelSolveRequest(payload)) {
    sendJson(res, 400, {
      ok: false,
      error: "Invalid cancel payload. Expected { requestId }.",
    });
    return true;
  }

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
    message:
      activeSolve.optimizer === "cp-sat"
        ? "Stop requested. Finalizing the current CP-SAT run and preserving the best feasible solution found so far."
        : activeSolve.optimizer === "lns"
          ? "Stop requested. Finalizing the current LNS run and preserving the best solution found so far."
          : "Stop requested. Finalizing the current greedy run and preserving the best result found so far.",
  });
  return true;
}

export function createPlannerRequestHandler(options: PlannerRequestHandlerOptions) {
  const solveJobManager = options.solveJobManager ?? new SolveJobManager();

  return async (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true }, method === "HEAD");
        return;
      }

      if (await handleImmediateSolve(req, res)) return;
      if (await handleLayoutEvaluate(req, res)) return;
      if (await handleStartSolve(req, res, solveJobManager)) return;
      if (handleSolveStatus(req, res, solveJobManager)) return;
      if (await handleCancelSolve(req, res, solveJobManager)) return;

      if (method !== "GET" && method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: "Method not allowed." });
        return;
      }

      await serveStatic(options.webRoot, url.pathname, method, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error.";
      sendJson(res, getErrorStatusCode(message), { ok: false, error: message });
    }
  };
}
