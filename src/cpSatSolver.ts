/**
 * CP-SAT solver bridge. The optimization model lives in python/cp_sat_solver.py
 * because Google OR-Tools exposes CP-SAT officially in Python rather than Node.js.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { BackgroundSolveHandle, EvaluatedServicePlacement, Grid, SolverParams, Solution } from "./types.js";
import { startJsonBackgroundSolve } from "./backgroundSolverRunner.js";
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

export type CpSatSolveHandle = BackgroundSolveHandle;

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

export function startCpSatSolve(G: Grid, params: SolverParams): CpSatSolveHandle {
  const pythonExecutable = params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  return startJsonBackgroundSolve({
    solverLabel: "CP-SAT",
    stopDirectoryPrefix: "city-builder-cp-sat-stop-",
    command: pythonExecutable,
    args: [scriptPath],
    launchContext: `with ${pythonExecutable}`,
    buildRequest: ({ stopFilePath, snapshotFilePath }) =>
      buildCpSatRequest(G, {
        ...params,
        cpSat: {
          ...(params.cpSat ?? {}),
          stopFilePath,
          snapshotFilePath,
        } as SolverParams["cpSat"],
      }),
    parseRaw: parseCpSatRawSolution,
    materializeSolution: (raw, stoppedByUser) =>
      materializeCpSatSolution(G, params, {
        ...raw,
        stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
      }),
    getSnapshotState: (raw) => ({
      hasFeasibleSolution: Boolean(raw),
      totalPopulation: raw?.totalPopulation ?? null,
      cpSatStatus: raw?.status ?? null,
    }),
    readStoppedByUser: (raw) => Boolean(raw.stoppedByUser),
    stoppedBeforeFeasibleMessage: "CP-SAT solve was stopped before finding a feasible solution.",
    noSolutionMessage: "CP-SAT backend exited without returning a solution.",
  });
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
    maxBuffer: 16 * 1024 * 1024,
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
