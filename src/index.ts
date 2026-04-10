/**
 * Public library entry point.
 */

export { solve, solveGreedy } from "./solver.js";
export { solveCpSat } from "./cpSatSolver.js";
export { evaluateLayout, validateSolution } from "./evaluator.js";
export { formatSolutionMap, renderSolutionMap, validateSolutionMap } from "./map.js";

export type {
  Grid,
  OptimizerName,
  CpSatOptions,
  GreedyOptions,
  SolverParams,
  Solution,
  AvailableBuildings,
  ResidentialSettings,
  ResidentialSizeSetting,
  ResidentialTypeSetting,
  ServiceTypeSetting,
  ServiceCandidate,
  ResidentialCandidate,
  EvaluatedServicePlacement,
  LayoutEvaluationInput,
  LayoutEvaluationResult,
  EvaluatedResidentialResult,
  SolutionValidationInput,
  SolutionValidationResult,
} from "./types.js";
export type { SolutionMapValidationResult } from "./map.js";
