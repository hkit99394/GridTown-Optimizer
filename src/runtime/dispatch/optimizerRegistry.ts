/**
 * Central optimizer registry for synchronous and background execution.
 *
 * Keeping this dispatch in one place makes new optimizers cheaper to add:
 * the web host, CLI-facing dispatcher, and future metaheuristics can all
 * resolve the same adapter instead of branching independently.
 */

import { solveAuto, startAutoSolve } from "../../auto/solver.js";
import { solveCpSat, startCpSatSolve } from "../../cp-sat/solver.js";
import { startGreedySolve } from "../../greedy/bridge.js";
import { startLnsSolve } from "../../lns/bridge.js";
import { solveLns } from "../../lns/solver.js";
import { solveGreedy } from "../../greedy/solver.js";
import { isOptimizerName, OMITTED_SOLVER_OPTIMIZER } from "../../core/types.js";

import type { BackgroundSolveHandle, Grid, OptimizerName, Solution, SolverParams } from "../../core/types.js";

export interface OptimizerAdapter {
  name: OptimizerName;
  solve: (grid: Grid, params: SolverParams) => Solution;
  startBackgroundSolve: (grid: Grid, params: SolverParams) => BackgroundSolveHandle;
}

const optimizerAdapters: Record<OptimizerName, OptimizerAdapter> = {
  auto: {
    name: "auto",
    solve: solveAuto,
    startBackgroundSolve: startAutoSolve,
  },
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
  lns: {
    name: "lns",
    solve: solveLns,
    startBackgroundSolve: startLnsSolve,
  },
};

export function resolveOptimizerName(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerName {
  const candidate = typeof value === "string" ? value : value?.optimizer;
  return isOptimizerName(candidate) ? candidate : OMITTED_SOLVER_OPTIMIZER;
}

export function getOptimizerAdapter(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerAdapter {
  return optimizerAdapters[resolveOptimizerName(value)];
}

export function listOptimizerAdapters(): OptimizerAdapter[] {
  return Object.values(optimizerAdapters);
}
