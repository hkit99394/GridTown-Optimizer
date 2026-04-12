/**
 * Shared optimizer dispatcher.
 */

import { getOptimizerAdapter } from "./optimizerRegistry.js";

import type { Grid, Solution, SolverParams } from "./types.js";

export function solve(grid: Grid, params: SolverParams): Solution {
  return getOptimizerAdapter(params).solve(grid, params);
}
