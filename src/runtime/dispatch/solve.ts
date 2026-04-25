/**
 * Shared optimizer dispatcher.
 */

import { startAutoSolve } from "../../auto/solver.js";
import { solveCpSatAsync } from "../../cp-sat/solver.js";
import { getOptimizerAdapter, resolveOptimizerName } from "./optimizerRegistry.js";

import type { CpSatAsyncOptions, Grid, Solution, SolverParams } from "../../core/types.js";

export function solve(grid: Grid, params: SolverParams): Solution {
  return getOptimizerAdapter(params).solve(grid, params);
}

export async function solveAsync(
  grid: Grid,
  params: SolverParams,
  cpSatAsyncOptions?: CpSatAsyncOptions
): Promise<Solution> {
  const optimizer = resolveOptimizerName(params);
  if (optimizer === "cp-sat") {
    return solveCpSatAsync(grid, params, cpSatAsyncOptions);
  }
  if (optimizer === "auto") {
    return startAutoSolve(grid, params).promise;
  }
  return getOptimizerAdapter(params).solve(grid, params);
}
