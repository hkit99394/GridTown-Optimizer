/**
 * Saved layout and strict layout evaluation types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { Grid, ResidentialPlacement, ServicePlacement } from "./baseTypes.js";
import type { CpSatContinuationCheckpoint } from "./cpSatContinuationTypes.js";
import type { SolveRequestPayload, SolveResponsePayload, Solution } from "./solutionTypes.js";
import type { SolverParams } from "./solverParamTypes.js";

/**
 * Browser-saved output layout record.
 * The `continueCpSat` block is optional so existing saved layouts remain valid
 * and non-CP-SAT results can stay display-only.
 */
export interface SavedLayoutRecord {
  id: string;
  name: string;
  savedAt: string;
  elapsedMs: number;
  result: SolveResponsePayload;
  resultContext: SolveRequestPayload;
  continueCpSat?: CpSatContinuationCheckpoint;
}

/** Explicit service placement for manual layout evaluation */
export interface EvaluatedServicePlacement extends ServicePlacement {
  /** Population increase contributed by this service */
  bonus: number;
}

/** Input payload for strict layout evaluation */
export interface LayoutEvaluationInput {
  grid: Grid;
  roads: Set<string>;
  services: EvaluatedServicePlacement[];
  residentials: ResidentialPlacement[];
  params: SolverParams;
}

/** Shared constraint-validation result for explicit layouts. */
export interface LayoutConstraintValidationResult {
  valid: boolean;
  errors: string[];
}

/** Per-building scored result for manual layout evaluation */
export interface EvaluatedResidentialResult extends ResidentialPlacement {
  population: number;
}

/** Output payload for strict layout evaluation */
export interface LayoutEvaluationResult {
  valid: boolean;
  errors: string[];
  populations: EvaluatedResidentialResult[];
  totalPopulation: number;
  boosts: number[];
}

/** Input payload for full solution validation */
export interface SolutionValidationInput {
  grid: Grid;
  solution: Solution;
  params: SolverParams;
}

/** Output payload for full solution validation */
export interface SolutionValidationResult {
  valid: boolean;
  errors: string[];
  recomputedPopulations: number[];
  recomputedTotalPopulation: number;
  layoutEvaluation: LayoutEvaluationResult;
}
