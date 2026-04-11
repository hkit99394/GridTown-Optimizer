/**
 * Lightweight local web server for the planning UI.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { solve, validateSolutionMap } from "./index.js";
import { startCpSatSolve } from "./cpSatSolver.js";
import { startGreedySolve } from "./greedyBridge.js";
import type { Grid, OptimizerName, Solution, SolverParams } from "./types.js";

const PORT = Number(process.env.PORT ?? 4173);
const WEB_ROOT = resolve(__dirname, "../web");

interface SolveRequest {
  grid: Grid;
  params: SolverParams;
  requestId?: string;
}

interface CancelSolveRequest {
  requestId: string;
}

type SolveJobStatus = "running" | "completed" | "stopped" | "failed";

interface BackgroundSolveHandle {
  promise: Promise<Solution>;
  cancel: () => void;
  getLatestSnapshot: () => Solution | null;
  getLatestSnapshotState: () => {
    hasFeasibleSolution: boolean;
    totalPopulation: number | null;
  };
}

interface SolveJob {
  requestId: string;
  optimizer: OptimizerName;
  grid: Grid;
  params: SolverParams;
  status: SolveJobStatus;
  cancelRequested: boolean;
  handle: BackgroundSolveHandle | null;
  solution: Solution | null;
  error: string | null;
  createdAt: number;
  finishedAt?: number;
}

const solveJobs = new Map<string, SolveJob>();

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

function isGrid(value: unknown): value is Grid {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((row) => Array.isArray(row) && row.length > 0)) return false;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (width === 0) return false;
  return value.every(
    (row) => Array.isArray(row) && row.length === width && row.every((cell) => cell === 0 || cell === 1)
  );
}

function isSolveRequest(value: unknown): value is SolveRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SolveRequest>;
  return isGrid(candidate.grid) && typeof candidate.params === "object" && candidate.params !== null;
}

function isCancelSolveRequest(value: unknown): value is CancelSolveRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CancelSolveRequest>;
  return typeof candidate.requestId === "string" && candidate.requestId.trim().length > 0;
}

function isCpSatRequest(params: SolverParams): boolean {
  return params.optimizer === "cp-sat";
}

function buildSolveResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const validation = validateSolutionMap({
    grid,
    solution,
    params,
  });

  return {
    solution: serializeSolution(solution),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      recomputedPopulations: validation.recomputedPopulations,
      recomputedTotalPopulation: validation.recomputedTotalPopulation,
      mapRows: validation.mapRows,
      mapText: validation.mapText,
    },
    stats: {
      optimizer: solution.optimizer,
      cpSatStatus: solution.cpSatStatus ?? null,
      stoppedByUser: Boolean(solution.stoppedByUser),
      totalPopulation: solution.totalPopulation,
      roadCount: solution.roads.size,
      serviceCount: solution.services.length,
      residentialCount: solution.residentials.length,
    },
  };
}

function startSolveJob(grid: Grid, params: SolverParams, requestId: string): SolveJob {
  const optimizer = params.optimizer ?? "greedy";
  const handle: BackgroundSolveHandle = isCpSatRequest(params)
    ? startCpSatSolve(grid, params)
    : startGreedySolve(grid, params);
  const job: SolveJob = {
    requestId,
    optimizer,
    grid,
    params,
    status: "running",
    cancelRequested: false,
    handle,
    solution: null,
    error: null,
    createdAt: Date.now(),
  };

  solveJobs.set(requestId, job);

  void handle.promise
    .then((solution) => {
      job.solution = solution;
      job.status = solution.stoppedByUser || job.cancelRequested ? "stopped" : "completed";
      job.error = null;
    })
    .catch((error) => {
      const recoveredSolution = job.cancelRequested ? (job.handle?.getLatestSnapshot() ?? null) : null;
      if (recoveredSolution) {
        job.solution = {
          ...recoveredSolution,
          stoppedByUser: true,
        };
        job.status = "stopped";
        job.error = null;
        return;
      }

      job.solution = null;
      job.status = job.cancelRequested ? "stopped" : "failed";
      job.error = error instanceof Error ? error.message : "Unknown CP-SAT error.";
    })
    .finally(() => {
      job.handle = null;
      job.finishedAt = Date.now();
    });

  return job;
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > 2 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function serializeSolution(solution: Solution) {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

async function serveStatic(pathname: string, method: string, res: ServerResponse<IncomingMessage>): Promise<void> {
  const relativePath =
    pathname === "/" || pathname === "/index.html"
      ? "index.html"
      : pathname === "/styles.css"
        ? "styles.css"
        : pathname === "/app.js"
          ? "app.js"
          : null;

  if (!relativePath) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8", method === "HEAD");
    return;
  }

  const filePath = resolve(WEB_ROOT, relativePath);
  const file = await readFile(filePath, "utf8");
  sendText(res, 200, file, contentTypeFor(relativePath), method === "HEAD");
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    if ((method === "GET" || method === "HEAD") && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true }, method === "HEAD");
      return;
    }

    if (method === "POST" && url.pathname === "/api/solve") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as unknown;
      if (!isSolveRequest(payload)) {
        sendJson(res, 400, {
          ok: false,
          error: "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid.",
        });
        return;
      }

      const solution = isCpSatRequest(payload.params)
        ? await startCpSatSolve(payload.grid, payload.params).promise
        : solve(payload.grid, payload.params);

      sendJson(res, 200, {
        ok: true,
        ...buildSolveResponse(payload.grid, payload.params, solution),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/solve/start") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as unknown;
      if (!isSolveRequest(payload)) {
        sendJson(res, 400, {
          ok: false,
          error: "Invalid solve payload. Expected { grid, params } with a rectangular 0/1 grid.",
        });
        return;
      }

      const requestId = typeof payload.requestId === "string" && payload.requestId.trim()
        ? payload.requestId.trim()
        : randomUUID();
      const existingJob = solveJobs.get(requestId);
      if (existingJob?.status === "running") {
        sendJson(res, 409, {
          ok: false,
          error: "A solve with this request ID is already running.",
        });
        return;
      }

      if (existingJob) solveJobs.delete(requestId);
      startSolveJob(payload.grid, payload.params, requestId);
      sendJson(res, 202, {
        ok: true,
        requestId,
        optimizer: payload.params.optimizer ?? "greedy",
        jobStatus: "running",
      });
      return;
    }

    if ((method === "GET" || method === "HEAD") && url.pathname === "/api/solve/status") {
      const requestId = url.searchParams.get("requestId")?.trim() ?? "";
      if (!requestId) {
        sendJson(res, 400, {
          ok: false,
          error: "Missing requestId query parameter.",
        }, method === "HEAD");
        return;
      }

      const job = solveJobs.get(requestId);
      if (!job) {
        sendJson(res, 404, {
          ok: false,
          error: "No solve job was found for that request.",
        }, method === "HEAD");
        return;
      }

      if (job.solution) {
        sendJson(res, 200, {
          ok: true,
          requestId: job.requestId,
          optimizer: job.optimizer,
          jobStatus: job.status,
          cancelRequested: job.cancelRequested,
          ...buildSolveResponse(job.grid, job.params, job.solution),
        }, method === "HEAD");
        return;
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
        return;
      }

      const snapshotState = job.handle?.getLatestSnapshotState() ?? {
        hasFeasibleSolution: false,
        totalPopulation: null,
      };
      sendJson(res, 200, {
        ok: true,
        requestId: job.requestId,
        optimizer: job.optimizer,
        jobStatus: job.status,
        cancelRequested: job.cancelRequested,
        hasFeasibleSolution: snapshotState.hasFeasibleSolution,
        bestTotalPopulation: snapshotState.totalPopulation,
      }, method === "HEAD");
      return;
    }

    if (method === "POST" && url.pathname === "/api/solve/cancel") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as unknown;
      if (!isCancelSolveRequest(payload)) {
        sendJson(res, 400, {
          ok: false,
          error: "Invalid cancel payload. Expected { requestId }.",
        });
        return;
      }

      const activeSolve = solveJobs.get(payload.requestId.trim());
      if (!activeSolve) {
        sendJson(res, 200, {
          ok: true,
          stopped: false,
          message: "No solve job was found for that request.",
        });
        return;
      }

      if (activeSolve.status !== "running" || !activeSolve.handle) {
        sendJson(res, 200, {
          ok: true,
          stopped: false,
          message: "That solve is no longer running.",
        });
        return;
      }

      activeSolve.cancelRequested = true;
      activeSolve.handle.cancel();
      sendJson(res, 200, {
        ok: true,
        stopped: true,
        message:
          activeSolve.optimizer === "cp-sat"
            ? "Stop requested. Finalizing the current CP-SAT run and preserving the best feasible solution found so far."
            : "Stop requested. Finalizing the current greedy run and preserving the best result found so far.",
      });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    await serveStatic(url.pathname, method, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    const statusCode = message.includes("Invalid solve payload") || message.includes("JSON")
      ? 400
      : message.includes("was stopped")
        ? 409
      : message.includes("CP-SAT backend failed")
          || message.includes("Failed to launch CP-SAT backend")
          || message.includes("Greedy backend failed")
          || message.includes("Failed to launch greedy backend")
        ? 500
        : 400;
    sendJson(res, statusCode, { ok: false, error: message });
  }
});

server.listen(PORT, () => {
  console.log(`City Builder web planner running at http://localhost:${PORT}`);
});
