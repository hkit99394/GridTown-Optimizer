/**
 * LNS solver bridge for background web solves.
 */

import { resolve } from "node:path";

import {
  materializeSerializedBackgroundSolution,
  startSerializedSolutionSolverProcess,
} from "../runtime/background/serializedSolutionBridge.js";

import type { BackgroundSolveHandle, Grid, SerializedSolution, Solution, SolverParams } from "../packages/core/index.js";

export type LnsSolveHandle = BackgroundSolveHandle;

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
    workerScriptPath: resolve(__dirname, "./worker.js"),
    materializeSolution: materializeLnsSolution,
    stoppedBeforeFeasibleMessage: "LNS solve was stopped before finding a feasible solution.",
    noSolutionMessage: "LNS backend exited without returning a solution.",
  });
}
