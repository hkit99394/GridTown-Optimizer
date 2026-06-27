/**
 * Public solver input validation facade.
 *
 * Mode-specific option rules live under ./validation so each solver owns its
 * validation surface while this file preserves the historical public imports.
 */

import { assertValidAutoOptions } from "./solverInputValidationAuto.js";
import { assertValidCpSatOptions } from "./solverInputValidationCpSat.js";
import { assertValidGreedyOptions } from "./solverInputValidationGreedy.js";
import { assertValidLnsOptions } from "./solverInputValidationLns.js";
import {
  assertValidCpSatReusableInputs,
  assertValidFixedRoadInputs,
  assertValidGrid,
  assertValidProblemDefinition,
  materializeValidLnsSeedSolution,
  resolveOptimizerName
} from "./solverInputValidationShared.js";

import type { Grid, SolverParams } from "./types.js";

export { assertValidLnsOptions } from "./solverInputValidationLns.js";
export {
  SOLVER_INPUT_ERROR_PREFIX,
  SolverInputError,
  assertValidProblemDefinition,
  assertValidSerializedSolutionPayload,
  isSolverInputError,
  isSolverInputErrorMessage,
  materializeValidLnsSeedSolution
} from "./solverInputValidationShared.js";

export function assertValidSolveInputs(G: Grid, params: SolverParams): void {
  assertValidGrid(G);
  assertValidProblemDefinition(params);
  assertValidFixedRoadInputs(G, params);
  const optimizer = resolveOptimizerName(params);
  assertValidAutoOptions(params);
  assertValidCpSatOptions(params, optimizer);
  assertValidGreedyOptions(params);
  assertValidLnsOptions(params);
  assertValidCpSatReusableInputs(G, params);
  if (optimizer !== "lns" && optimizer !== "auto") return;
  materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
}

export function assertValidLayoutEvaluateInputs(G: Grid, params: SolverParams): void {
  assertValidGrid(G);
  assertValidProblemDefinition(params);
  assertValidFixedRoadInputs(G, params);
}
