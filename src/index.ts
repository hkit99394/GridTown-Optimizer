/**
 * Public library entry point.
 */

export { solve, solveAsync } from "./solve.js";
export { describeAutoStopReason, solveAuto, startAutoSolve } from "./autoSolver.js";
export { solveGreedy } from "./solver.js";
export { solveCpSat, solveCpSatAsync, startCpSatSolve } from "./cpSatSolver.js";
export { solveLns } from "./lnsSolver.js";
export {
  DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  DEFAULT_CP_SAT_BENCHMARK_OPTIONS,
  formatCpSatBenchmarkSuite,
  listCpSatBenchmarkCaseNames,
  normalizeCpSatBenchmarkOptions,
  runCpSatBenchmarkSuite,
} from "./cpSatBenchmark.js";
export { evaluateLayout, validateSolution } from "./evaluator.js";
export { formatSolutionMap, renderSolutionMap, validateSolutionMap } from "./map.js";
export { getOptimizerAdapter, listOptimizerAdapters, resolveOptimizerName } from "./optimizerRegistry.js";

export type {
  Grid,
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  OptimizerName,
  AutoOptions,
  AutoStageOptimizerName,
  AutoSolveStopReason,
  AutoSolveGeneratedSeed,
  AutoSolveStageMetadata,
  CpSatOptions,
  CpSatObjectivePolicy,
  CpSatTelemetry,
  CpSatPortfolioOptions,
  CpSatPortfolioSummary,
  CpSatPortfolioWorkerSummary,
  CpSatProgressKind,
  CpSatProgressUpdate,
  CpSatAsyncOptions,
  CpSatWarmStartHint,
  CpSatWarmStartServicePlacement,
  CpSatWarmStartResidentialPlacement,
  GreedyOptions,
  LnsOptions,
  CpSatNeighborhoodWindow,
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
export type {
  CpSatBenchmarkCase,
  CpSatBenchmarkRunOptions,
  CpSatBenchmarkProgressSample,
  CpSatBenchmarkCaseResult,
  CpSatBenchmarkSuiteResult,
} from "./cpSatBenchmark.js";
