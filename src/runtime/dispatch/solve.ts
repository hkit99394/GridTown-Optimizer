/**
 * Shared optimizer dispatcher.
 */

import { startAutoSolve } from "../../auto/solver.js";
import { solveCpSatAsync } from "../../cp-sat/solver.js";
import { getOptimizerAdapter } from "./optimizerRegistry.js";

import type { CpSatAsyncOptions, Grid, Solution, SolverParams } from "../../core/types.js";

export function solve(grid: Grid, params: SolverParams): Solution {
  return getOptimizerAdapter(params).solve(grid, params);
}

export async function solveAsync(
  grid: Grid,
  params: SolverParams,
  cpSatAsyncOptions?: CpSatAsyncOptions
): Promise<Solution> {
  if ((params.optimizer ?? "greedy") === "cp-sat") {
    return solveCpSatAsync(grid, params, cpSatAsyncOptions);
  }
  if ((params.optimizer ?? "greedy") === "auto") {
    return startAutoSolve(grid, params).promise;
  }
  return getOptimizerAdapter(params).solve(grid, params);
}
