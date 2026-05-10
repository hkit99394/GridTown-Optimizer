import { startAutoSolveWithStages } from "../../solvers/auto/solver.js";
import { assertValidSolveInputs } from "../../core/index.js";
import * as backgroundSolvers from "./backgroundSolvers.js";

import type { BackgroundSolveHandle, Grid, SolverParams } from "../../core/index.js";

export type AutoSolveHandle = BackgroundSolveHandle;

export function startAutoSolve(G: Grid, params: SolverParams): AutoSolveHandle {
  assertValidSolveInputs(G, params);
  return startAutoSolveWithStages(G, params, {
    greedy: backgroundSolvers.startGreedySolve,
    lns: backgroundSolvers.startLnsSolve,
    cpSat: backgroundSolvers.startCpSatSolve
  });
}
