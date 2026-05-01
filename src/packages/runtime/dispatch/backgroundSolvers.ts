import { resolve } from "node:path";

import {
  materializeSerializedBackgroundSolution,
  startSerializedSolutionSolverProcess,
} from "../background/serializedSolutionBridge.js";
import { startJsonBackgroundSolve } from "../background/runner.js";
import {
  defaultPythonExecutable,
  buildCpSatRequest,
  materializeCpSatSolution,
  parseCpSatRawSolution,
} from "../../solvers/cp-sat/solver.js";

import type {
  BackgroundSolveHandle,
  Grid,
  SerializedSolution,
  Solution,
  SolverParams,
} from "../../core/index.js";

export type CpSatSolveHandle = BackgroundSolveHandle;
export type GreedySolveHandle = BackgroundSolveHandle;
export type LnsSolveHandle = BackgroundSolveHandle;

export function startGreedySolve(G: Grid, params: SolverParams): GreedySolveHandle {
  return startSerializedSolutionSolverProcess({
    solverLabel: "Greedy",
    stopDirectoryPrefix: "city-builder-greedy-stop-",
    grid: G,
    params,
    solverOptionKey: "greedy",
    workerScriptPath: resolve(__dirname, "../background/greedyWorker.js"),
    stoppedBeforeFeasibleMessage: "Greedy solve was stopped before finding a feasible solution.",
    noSolutionMessage: "Greedy backend exited without returning a solution.",
  });
}

function materializeLnsSolution(raw: SerializedSolution, stoppedByUser: boolean): Solution {
  const solution = materializeSerializedBackgroundSolution(raw, stoppedByUser);
  return {
    ...solution,
    ...(solution.lnsTelemetry && solution.stoppedByUser
      ? {
          lnsTelemetry: {
            ...solution.lnsTelemetry,
            stopReason: "cancelled",
          },
        }
      : {}),
  };
}

export function startLnsSolve(G: Grid, params: SolverParams): LnsSolveHandle {
  return startSerializedSolutionSolverProcess({
    solverLabel: "LNS",
    stopDirectoryPrefix: "city-builder-lns-stop-",
    grid: G,
    params,
    solverOptionKey: "lns",
    workerScriptPath: resolve(__dirname, "../background/lnsWorker.js"),
    materializeSolution: materializeLnsSolution,
    stoppedBeforeFeasibleMessage: "LNS solve was stopped before finding a feasible solution.",
    noSolutionMessage: "LNS backend exited without returning a solution.",
  });
}

export function startCpSatSolve(G: Grid, params: SolverParams): CpSatSolveHandle {
  const pythonExecutable =
    params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../../../../python/cp_sat_solver.py");
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
        },
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
