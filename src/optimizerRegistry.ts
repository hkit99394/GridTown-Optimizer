/**
 * Central optimizer registry for synchronous and background execution.
 *
 * Keeping this dispatch in one place makes new optimizers cheaper to add:
 * the web host, CLI-facing dispatcher, and future metaheuristics can all
 * resolve the same adapter instead of branching independently.
 */

import { solveCpSat, startCpSatSolve } from "./cpSatSolver.js";
import { startGreedySolve } from "./greedyBridge.js";
import { solveGreedy } from "./solver.js";

import type { BackgroundSolveHandle, Grid, OptimizerName, Solution, SolverParams } from "./types.js";

export interface OptimizerAdapter {
  name: OptimizerName;
  solve: (grid: Grid, params: SolverParams) => Solution;
  startBackgroundSolve: (grid: Grid, params: SolverParams) => BackgroundSolveHandle;
}

const optimizerAdapters: Record<OptimizerName, OptimizerAdapter> = {
  greedy: {
    name: "greedy",
    solve: solveGreedy,
    startBackgroundSolve: startGreedySolve,
  },
  "cp-sat": {
    name: "cp-sat",
    solve: solveCpSat,
    startBackgroundSolve: startCpSatSolve,
  },
};

export function resolveOptimizerName(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerName {
  const candidate = typeof value === "string" ? value : value?.optimizer;
  return candidate === "cp-sat" ? "cp-sat" : "greedy";
}

export function getOptimizerAdapter(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerAdapter {
  return optimizerAdapters[resolveOptimizerName(value)];
}

export function listOptimizerAdapters(): OptimizerAdapter[] {
  return Object.values(optimizerAdapters);
}
