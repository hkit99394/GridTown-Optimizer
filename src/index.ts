/**
 * Public library entry point.
 */

export { solve } from "./solve.js";
export { solveGreedy } from "./solver.js";
export { solveCpSat } from "./cpSatSolver.js";
export { solveLns } from "./lnsSolver.js";
export { evaluateLayout, validateSolution } from "./evaluator.js";
export { formatSolutionMap, renderSolutionMap, validateSolutionMap } from "./map.js";
export { getOptimizerAdapter, listOptimizerAdapters, resolveOptimizerName } from "./optimizerRegistry.js";

export type {
  Grid,
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  OptimizerName,
  CpSatOptions,
  GreedyOptions,
  LnsOptions,
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  SolverParams,
  Solution,
  SerializedSolution,
  SolveRequestPayload,
  SolveResponseStats,
  SolveResponseValidation,
  SolveResponsePayload,
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
  PersistedRoadKey,
  PersistedServiceCandidateKey,
  PersistedResidentialCandidateKey,
  CpSatContinuationModelInput,
  CpSatContinuationCompatibility,
  CpSatContinuationRuntimeDefaults,
  CpSatContinuationIncumbent,
  CpSatContinuationHintedServicePlacement,
  CpSatContinuationHintedResidentialPlacement,
  CpSatContinuationHint,
  CpSatContinuationResumePolicy,
  CpSatContinuationCheckpoint,
  SavedLayoutRecord,
} from "./types.js";
export type { SolutionMapValidationResult } from "./map.js";
