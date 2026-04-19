/**
 * Public library entry point.
 */

export { solve, solveAsync } from "./runtime/solve.js";
export { describeAutoStopReason, solveAuto, startAutoSolve } from "./auto/index.js";
export { solveGreedy } from "./greedy/solver.js";
export { solveCpSat, solveCpSatAsync, startCpSatSolve } from "./cp-sat/solver.js";
export { solveLns } from "./lns/solver.js";
export {
  DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  DEFAULT_CP_SAT_BENCHMARK_OPTIONS,
  formatCpSatBenchmarkSuite,
  listCpSatBenchmarkCaseNames,
  normalizeCpSatBenchmarkOptions,
  runCpSatBenchmarkSuite,
} from "./benchmarks/index.js";
export { evaluateLayout, formatSolutionMap, renderSolutionMap, validateSolution, validateSolutionMap } from "./core/index.js";
export { getOptimizerAdapter, listOptimizerAdapters, resolveOptimizerName } from "./runtime/optimizerRegistry.js";

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
  SolutionMapValidationResult,
} from "./core/index.js";
export type {
  CpSatBenchmarkCase,
  CpSatBenchmarkRunOptions,
  CpSatBenchmarkProgressSample,
  CpSatBenchmarkCaseResult,
  CpSatBenchmarkSuiteResult,
} from "./benchmarks/index.js";
