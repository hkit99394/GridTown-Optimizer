/**
 * Greedy solver bridge for background web solves.
 */

import { resolve } from "node:path";

import { startSerializedSolutionSolverProcess } from "../runtime/background/serializedSolutionBridge.js";

import type { BackgroundSolveHandle, Grid, SolverParams } from "../core/index.js";
export type GreedySolveHandle = BackgroundSolveHandle;

export function startGreedySolve(G: Grid, params: SolverParams): GreedySolveHandle {
  return startSerializedSolutionSolverProcess({
    solverLabel: "Greedy",
    stopDirectoryPrefix: "city-builder-greedy-stop-",
    grid: G,
    params,
    solverOptionKey: "greedy",
    workerScriptPath: resolve(__dirname, "./worker.js"),
    stoppedBeforeFeasibleMessage: "Greedy solve was stopped before finding a feasible solution.",
    noSolutionMessage: "Greedy backend exited without returning a solution.",
  });
}
