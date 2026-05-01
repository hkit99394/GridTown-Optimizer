/**
 * Shared optimizer dispatcher.
 */

import { assertValidSolveInputs } from "../../packages/core/index.js";
import { getOptimizerAdapter } from "./optimizerRegistry.js";

import type { CpSatAsyncOptions, Grid, Solution, SolverParams } from "../../packages/core/index.js";

export function solve(grid: Grid, params: SolverParams): Solution {
  assertValidSolveInputs(grid, params);
  return getOptimizerAdapter(params).solve(grid, params);
}

export async function solveAsync(
  grid: Grid,
  params: SolverParams,
  cpSatAsyncOptions?: CpSatAsyncOptions
): Promise<Solution> {
  assertValidSolveInputs(grid, params);
  const adapter = getOptimizerAdapter(params);
  return adapter.solveAsync?.(grid, params, cpSatAsyncOptions) ?? adapter.solve(grid, params);
}
