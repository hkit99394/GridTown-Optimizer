/**
 * CP-SAT solver bridge. The optimization model lives in python/cp_sat_solver.py
 * because Google OR-Tools exposes CP-SAT officially in Python rather than Node.js.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type { EvaluatedServicePlacement, Grid, SolverParams, Solution } from "./types.js";
import { evaluateLayout } from "./evaluator.js";
import { roadsConnectedToRow0 } from "./roads.js";

interface CpSatResidentialPlacement {
  r: number;
  c: number;
  rows: number;
  cols: number;
  typeIndex: number;
  population: number;
}

interface CpSatServicePlacement {
  r: number;
  rows: number;
  cols: number;
  range: number;
  c: number;
  bonus: number;
  typeIndex: number;
}

interface CpSatRawSolution {
  roads: string[];
  services: CpSatServicePlacement[];
  residentials: CpSatResidentialPlacement[];
  populations: number[];
  totalPopulation: number;
  status: string;
  stoppedByUser?: boolean;
}

export interface CpSatSolveHandle {
  promise: Promise<Solution>;
  cancel: () => void;
  getLatestSnapshot: () => Solution | null;
  getLatestSnapshotState: () => {
    hasFeasibleSolution: boolean;
    totalPopulation: number | null;
    cpSatStatus: string | null;
  };
}

const CP_SAT_BUFFER_LIMIT = 16 * 1024 * 1024;

function defaultPythonExecutable(): string {
  const venvPython = resolve(__dirname, "../.venv-cp-sat/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function buildCpSatRequest(G: Grid, params: SolverParams) {
  return {
    grid: G,
    params,
  };
}

function parseCpSatRawSolution(stdout: string): CpSatRawSolution {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`CP-SAT backend returned invalid JSON: ${(error as Error).message}`);
  }
}

function materializeCpSatSolution(G: Grid, params: SolverParams, raw: CpSatRawSolution): Solution {
  const roads = new Set(raw.roads);
  const connectedRoads = roadsConnectedToRow0(G, roads);
  if (connectedRoads.size === 0) {
    throw new Error("CP-SAT backend produced an invalid layout: road network does not touch row 0.");
  }
  if (connectedRoads.size !== roads.size) {
    throw new Error("CP-SAT backend produced an invalid layout: some road cells are not connected to row 0.");
  }
  const services: EvaluatedServicePlacement[] = raw.services.map((service) => ({
    r: service.r,
    c: service.c,
    rows: service.rows,
    cols: service.cols,
    range: service.range,
    bonus: service.bonus,
  }));
  const residentials = raw.residentials.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
  }));

  const evaluation = evaluateLayout({
    grid: G,
    roads,
    services,
    residentials,
    params,
  });
  if (!evaluation.valid) {
    throw new Error(`CP-SAT backend produced an invalid layout: ${evaluation.errors.join(" ")}`);
  }

  return {
    optimizer: "cp-sat",
    cpSatStatus: raw.status,
    stoppedByUser: Boolean(raw.stoppedByUser),
    roads,
    services: raw.services.map(({ r, c, rows, cols, range }) => ({ r, c, rows, cols, range })),
    serviceTypeIndices: raw.services.map((service) => service.typeIndex),
    servicePopulationIncreases: raw.services.map((service) => service.bonus),
    residentials,
    residentialTypeIndices: raw.residentials.map((residential) => residential.typeIndex),
    populations: raw.populations,
    totalPopulation: raw.totalPopulation,
  };
}

function appendBufferedOutput(current: string, chunk: Buffer | string, label: string): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") > CP_SAT_BUFFER_LIMIT) {
    throw new Error(`CP-SAT backend ${label} exceeded ${CP_SAT_BUFFER_LIMIT} bytes.`);
  }
  return next;
}

export function startCpSatSolve(G: Grid, params: SolverParams): CpSatSolveHandle {
  const pythonExecutable = params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  const tempStopDirectory = mkdtempSync(join(tmpdir(), "city-builder-cp-sat-stop-"));
  const stopFilePath = join(tempStopDirectory, "stop");
  const snapshotFilePath = join(tempStopDirectory, "snapshot.json");
  const request = buildCpSatRequest(G, {
    ...params,
    cpSat: {
      ...(params.cpSat ?? {}),
      stopFilePath,
      snapshotFilePath,
    } as SolverParams["cpSat"],
  });
  const child = spawn(pythonExecutable, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stopRequested = false;
  let forcedTerminationTimer: NodeJS.Timeout | undefined;
  let streamError: Error | null = null;
  let cleanedUp = false;
  let latestSnapshotRaw: CpSatRawSolution | null = null;

  const cleanupStopToken = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempStopDirectory, { recursive: true, force: true });
  };

  const readLatestSnapshotRaw = (): CpSatRawSolution | null => {
    if (!existsSync(snapshotFilePath)) return latestSnapshotRaw;
    try {
      latestSnapshotRaw = parseCpSatRawSolution(readFileSync(snapshotFilePath, "utf8"));
    } catch {
      return latestSnapshotRaw;
    }
    return latestSnapshotRaw;
  };

  const materializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    const raw = readLatestSnapshotRaw();
    if (!raw) return null;
    return materializeCpSatSolution(G, params, {
      ...raw,
      stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
    });
  };

  const scheduleForcedTermination = (): void => {
    if (forcedTerminationTimer) return;
    forcedTerminationTimer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }, 5000);
    forcedTerminationTimer.unref?.();
  };

  const cancel = (): void => {
    stopRequested = true;
    if (child.exitCode != null || child.signalCode != null) return;
    try {
      writeFileSync(stopFilePath, "stop\n");
    } catch {
      child.kill("SIGTERM");
    }
    scheduleForcedTermination();
  };

  const promise = new Promise<Solution>((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      cleanupStopToken();
      rejectPromise(new Error(`Failed to launch CP-SAT backend with ${pythonExecutable}: ${error.message}`));
    });

    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBufferedOutput(stdout, chunk, "stdout");
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBufferedOutput(stderr, chunk, "stderr");
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.once("close", (code, signal) => {
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      const snapshotRaw = readLatestSnapshotRaw();
      cleanupStopToken();

      if (streamError) {
        rejectPromise(streamError);
        return;
      }

      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const trimmedStdout = stdout.trim();
        if (stopRequested && snapshotRaw) {
          try {
            resolvePromise(materializeCpSatSolution(G, params, { ...snapshotRaw, stoppedByUser: true }));
            return;
          } catch (error) {
            rejectPromise(error as Error);
            return;
          }
        }
        if (stopRequested) {
          rejectPromise(new Error(trimmedStderr || "CP-SAT solve was stopped before finding a feasible solution."));
          return;
        }
        rejectPromise(
          new Error(
            `CP-SAT backend failed with exit code ${code ?? "unknown"}${
              signal ? ` (signal ${signal})` : ""
            }.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${trimmedStdout ? ` stdout: ${trimmedStdout}` : ""}`
          )
        );
        return;
      }

      try {
        const trimmedStdout = stdout.trim();
        const raw = trimmedStdout ? parseCpSatRawSolution(trimmedStdout) : snapshotRaw;
        if (!raw) {
          throw new Error("CP-SAT backend exited without returning a solution.");
        }
        resolvePromise(
          materializeCpSatSolution(G, params, {
            ...raw,
            stoppedByUser: stopRequested || Boolean(raw.stoppedByUser),
          })
        );
      } catch (error) {
        if (stopRequested && snapshotRaw) {
          try {
            resolvePromise(materializeCpSatSolution(G, params, { ...snapshotRaw, stoppedByUser: true }));
            return;
          } catch {
            // Fall through to the original parse/materialization error below.
          }
        }
        rejectPromise(error as Error);
      }
    });

    try {
      child.stdin.end(JSON.stringify(request));
    } catch (error) {
      cancel();
      rejectPromise(new Error(`Failed to send request to CP-SAT backend: ${(error as Error).message}`));
    }
  });

  return {
    promise,
    cancel,
    getLatestSnapshot: () => materializeSnapshot(stopRequested),
    getLatestSnapshotState: () => {
      const raw = readLatestSnapshotRaw();
      return {
        hasFeasibleSolution: Boolean(raw),
        totalPopulation: raw?.totalPopulation ?? null,
        cpSatStatus: raw?.status ?? null,
      };
    },
  };
}

export async function solveCpSatAsync(G: Grid, params: SolverParams): Promise<Solution> {
  return startCpSatSolve(G, params).promise;
}

export function solveCpSat(G: Grid, params: SolverParams): Solution {
  const pythonExecutable = params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  const request = buildCpSatRequest(G, params);

  const result = spawnSync(pythonExecutable, [scriptPath], {
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: CP_SAT_BUFFER_LIMIT,
  });

  if (result.error) {
    throw new Error(`Failed to launch CP-SAT backend with ${pythonExecutable}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `CP-SAT backend failed with exit code ${result.status}.${stderr ? ` stderr: ${stderr}` : ""}${stdout ? ` stdout: ${stdout}` : ""}`
    );
  }

  return materializeCpSatSolution(G, params, parseCpSatRawSolution(result.stdout));
}
