/**
 * City Builder — type definitions (see SPEC.md)
 */

export type Grid = number[][];

export type Cell = { r: number; c: number };

/** Key for set/map of cells */
export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export function cellFromKey(key: string): Cell {
  const comma = key.indexOf(",");
  const r = Number(key.slice(0, comma));
  const c = Number(key.slice(comma + 1));
  return { r, c };
}

/** Rectangle: top-left (r, c), size (rows × cols) */
export type Rectangle = { r: number; c: number; rows: number; cols: number };

/** Service building placement with explicit footprint and effect range. */
export type ServicePlacement = { r: number; c: number; rows: number; cols: number; range: number };

/** Service candidate with type index and bonus metadata for optimizer use */
export type ServiceCandidate = ServicePlacement & { typeIndex: number; bonus: number };

/** Residential building: placement (r, c) and size (rows × cols) */
export type ResidentialPlacement = { r: number; c: number; rows: number; cols: number };

/** Residential candidate with type index (for per-type avail and min/max) */
export type ResidentialCandidate = ResidentialPlacement & { typeIndex: number };

/**
 * How many of each building type are available to place.
 * Omit or use undefined for "no limit".
 */
export interface AvailableBuildings {
  /** Max number of service buildings to place. Default: no limit */
  services?: number;
  /** Max number of residential buildings (2×2 or 2×3) to place. Default: no limit */
  residentials?: number;
}

/** Min (base) and max population for one residential size (e.g. 2×2 or 2×3) */
export interface ResidentialSizeSetting {
  min: number;
  max: number;
}

/** Key is "rowsxcols", e.g. "2x2", "2x3" */
export type ResidentialSettings = Partial<Record<string, ResidentialSizeSetting>>;

/**
 * One residential building type: size (w×h), min/max population, and how many can be placed.
 * Building can be rotated so both (w×h) and (h×w) count as this type and share the same avail.
 */
export interface ResidentialTypeSetting {
  name?: string;
  w: number;
  h: number;
  min: number;
  max: number;
  avail: number;
}

/**
 * One service building type: size, bonus, effect range, and availability.
 * When allowRotation is true (default), both (rows×cols) and (cols×rows) are allowed for this type.
 */
export interface ServiceTypeSetting {
  name?: string;
  rows: number;
  cols: number;
  bonus: number;
  range: number;
  avail: number;
  allowRotation?: boolean;
}

export type OptimizerName = "auto" | "greedy" | "cp-sat" | "lns";

export type AutoStageOptimizerName = Exclude<OptimizerName, "auto">;

export type AutoSolveStopReason =
  | "completed-plan"
  | "weak-cycle-limit"
  | "optimal"
  | "cancelled"
  | "wall-clock-cap"
  | "stage-error";

export interface AutoOptions {
  /** Optional global wall-clock safety cap for the outer auto policy. Omit for no outer cap. */
  wallClockLimitSeconds?: number;
  /** Minimum combined improvement ratio for an LNS -> CP-SAT cycle to count as meaningful. Defaults to 0.5%. */
  weakCycleImprovementThreshold?: number;
  /** Stop after this many consecutive weak cycles. Defaults to 2. */
  maxConsecutiveWeakCycles?: number;
  /** Default CP-SAT stage runtime when auto is driving exact passes. Defaults to 30 seconds. */
  cpSatStageTimeLimitSeconds?: number;
  /** Default CP-SAT no-improvement cutoff when auto is driving exact passes. Defaults to 10 seconds. */
  cpSatStageNoImprovementTimeoutSeconds?: number;
}

export interface AutoSolveGeneratedSeed {
  stage: AutoStageOptimizerName;
  stageIndex: number;
  cycleIndex: number;
  randomSeed: number;
}

export interface AutoSolveStageMetadata {
  requestedOptimizer: "auto";
  activeStage: AutoStageOptimizerName | null;
  stageIndex: number;
  cycleIndex: number;
  consecutiveWeakCycles: number;
  lastCycleImprovementRatio: number | null;
  stopReason?: AutoSolveStopReason | null;
  generatedSeeds: AutoSolveGeneratedSeed[];
}

/** Stable semantic key for a road cell in persisted snapshots: "r,c". */
export type PersistedRoadKey = string;

/** Stable semantic key for a hinted service candidate: "service:typeIndex:r:c:rows:cols". */
export type PersistedServiceCandidateKey = string;

/** Stable semantic key for a hinted residential candidate: "residential:typeIndex:r:c:rows:cols". */
export type PersistedResidentialCandidateKey = string;

export interface CpSatNeighborhoodWindow {
  top: number;
  left: number;
  rows: number;
  cols: number;
}

export interface CpSatWarmStartServicePlacement extends ServicePlacement {
  typeIndex?: number;
  bonus?: number;
}

export interface CpSatWarmStartResidentialPlacement extends ResidentialPlacement {
  typeIndex?: number;
  population?: number;
}

/** Typed service placement saved specifically for rebuilding CP-SAT solution hints. */
export interface CpSatContinuationHintedServicePlacement extends ServicePlacement {
  typeIndex: number;
  bonus: number;
}

/** Typed residential placement saved specifically for rebuilding CP-SAT solution hints. */
export interface CpSatContinuationHintedResidentialPlacement extends ResidentialPlacement {
  typeIndex: number;
  population: number;
}

export interface CpSatWarmStartHint {
  sourceName?: string;
  modelFingerprint?: string;
  roadKeys?: PersistedRoadKey[];
  serviceCandidateKeys?: PersistedServiceCandidateKey[];
  residentialCandidateKeys?: PersistedResidentialCandidateKey[];
  roads?: PersistedRoadKey[];
  services?: CpSatWarmStartServicePlacement[];
  residentials?: CpSatWarmStartResidentialPlacement[];
  solution?: {
    roads?: PersistedRoadKey[];
    services?: CpSatContinuationHintedServicePlacement[];
    residentials?: CpSatContinuationHintedResidentialPlacement[];
    populations?: number[];
    totalPopulation?: number;
  };
  totalPopulation?: number;
  objectiveLowerBound?: number;
  preferStrictImprove?: boolean;
  repairHint?: boolean;
  fixVariablesToHintedValue?: boolean;
  hintConflictLimit?: number;
  neighborhoodWindow?: CpSatNeighborhoodWindow;
  fixOutsideNeighborhoodToHintedValue?: boolean;
}

export interface CpSatPortfolioOptions {
  /** Number of independent CP-SAT workers to launch when randomSeeds is not provided. */
  workerCount?: number;
  /** Explicit per-worker random seeds. Overrides workerCount when provided. */
  randomSeeds?: number[];
  /** Per-worker time limit override. Defaults to the outer timeLimitSeconds. */
  perWorkerTimeLimitSeconds?: number;
  /** Per-worker deterministic time override. Defaults to the outer maxDeterministicTime. */
  perWorkerMaxDeterministicTime?: number;
  /** Per-worker CP-SAT internal worker count. Defaults to 1 to avoid oversubscription. */
  perWorkerNumWorkers?: number;
  /** Override randomized search for every portfolio worker. Defaults to true. */
  randomizeSearch?: boolean;
}

export interface CpSatObjectivePolicy {
  populationWeight: number;
  maxTieBreakPenalty: number;
  summary: string;
}

export interface CpSatTelemetry {
  solveWallTimeSeconds: number;
  userTimeSeconds: number;
  solutionCount: number;
  incumbentObjectiveValue: number | null;
  bestObjectiveBound: number | null;
  objectiveGap: number | null;
  incumbentPopulation: number | null;
  bestPopulationUpperBound: number | null;
  populationGapUpperBound: number | null;
  lastImprovementAtSeconds: number | null;
  secondsSinceLastImprovement: number | null;
  numBranches: number;
  numConflicts: number;
}

export interface CpSatPortfolioWorkerSummary {
  workerIndex: number;
  randomSeed: number | null;
  randomizeSearch: boolean;
  numWorkers: number;
  status: string;
  feasible: boolean;
  totalPopulation: number | null;
}

export interface CpSatPortfolioSummary {
  workerCount: number;
  selectedWorkerIndex: number | null;
  workers: CpSatPortfolioWorkerSummary[];
}

export type CpSatProgressKind = "incumbent" | "bound" | "portfolio-worker-complete";

export interface CpSatProgressUpdate {
  kind: CpSatProgressKind;
  telemetry?: CpSatTelemetry;
  worker?: CpSatPortfolioWorkerSummary;
}

export interface CpSatAsyncOptions {
  /** Called as the Python backend emits live CP-SAT progress events. */
  onProgress?: (update: CpSatProgressUpdate) => void;
  /** Minimum interval between streamed bound updates. Defaults to 0.5 seconds. */
  progressIntervalSeconds?: number;
}

export interface CpSatOptions {
  /** Python executable to run the CP-SAT backend. Defaults to .venv-cp-sat/bin/python when present, else python3. */
  pythonExecutable?: string;
  /** Override the CP-SAT backend script path. */
  scriptPath?: string;
  /** Optional max solve time in seconds. When omitted, CP-SAT runs until it finishes or is stopped externally. */
  timeLimitSeconds?: number;
  /** Max deterministic time. Useful for more reproducible benchmark comparisons. */
  maxDeterministicTime?: number;
  /** CP-SAT worker count. Default 8. */
  numWorkers?: number;
  /** Fixed search seed for reproducibility. */
  randomSeed?: number;
  /** Enable randomized search decisions. Default false. */
  randomizeSearch?: boolean;
  /** Relative optimality gap limit. Stop once the relative gap is at or below this value. */
  relativeGapLimit?: number;
  /** Absolute optimality gap limit. Stop once the absolute gap is at or below this value. */
  absoluteGapLimit?: number;
  /** Stop after this many seconds without a new incumbent, but only after the first feasible solution is found. */
  noImprovementTimeoutSeconds?: number;
  /** Soft warm-start incumbent. Accepts either a serializable hint or an existing Solution. */
  warmStartHint?: CpSatWarmStartHint | Solution;
  /** Hard lower bound on total population for continuation runs from a known incumbent. */
  objectiveLowerBound?: number;
  /** Single-machine portfolio search across multiple CP-SAT workers. */
  portfolio?: CpSatPortfolioOptions;
  /** Emit NDJSON progress events from the Python backend. Primarily used by the async bridge. */
  streamProgress?: boolean;
  /** Minimum interval between streamed bound-progress updates. Defaults to 0.5 seconds when streaming is enabled. */
  progressIntervalSeconds?: number;
  /** Emit OR-Tools search logs. Default false. */
  logSearchProgress?: boolean;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export interface GreedyOptions {
  /** Run bounded local search to improve the greedy seed (residential neighborhoods plus bounded service neighborhoods). */
  localSearch?: boolean;
  /** Allow bounded service remove/add/swap neighborhoods around the incumbent after greedy construction (default true). */
  localSearchServiceMoves?: boolean;
  /** Maximum ranked service candidates considered by bounded service neighborhoods per iteration (default 6). */
  localSearchServiceCandidateLimit?: number;
  /** Prototype deferred road commitment during the main greedy construction pass (default false). */
  deferRoadCommitment?: boolean;
  /** Fixed seed for reproducible greedy restart shuffling. */
  randomSeed?: number;
  /** Collect phase-level profiling counters without changing solver behavior. */
  profile?: boolean;
  /** Number of restarts with different service order; take best solution (default 1) */
  restarts?: number;
  /** Service-position refinement passes after restarts (default 2) */
  serviceRefineIterations?: number;
  /** Max service candidates considered per refinement pass (default 40) */
  serviceRefineCandidateLimit?: number;
  /** Run exhaustive search over service layouts in top-N pool (default false) */
  exhaustiveServiceSearch?: boolean;
  /** Pool size for exhaustive service search (default 22) */
  serviceExactPoolLimit?: number;
  /** Hard cap on evaluated service combinations (default 12000) */
  serviceExactMaxCombinations?: number;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export interface GreedyProfileCounters {
  precompute: {
    serviceCandidates: number;
    residentialCandidates: number;
    geometryCacheEntries: number;
    residentialScoringGroups: number;
    residentialScoringVariantsCollapsed: number;
    serviceCoveragePairs: number;
    serviceCoverageGroups: number;
    serviceStaticScores: number;
    serviceStaticScoreGroupEvaluations: number;
    serviceStaticAvailabilityDiscountedGroups: number;
    residentialPopulationCacheEntries: number;
  };
  attempts: {
    serviceCaps: number;
    coarseCaps: number;
    refineCaps: number;
    capsSkipped: number;
    restarts: number;
    restartCaps: number;
    serviceRefineTrials: number;
    exhaustiveTrials: number;
    fixedServiceRealizationTrials: number;
    localSearchIterations: number;
  };
  servicePhase: {
    candidateScans: number;
    canConnectChecks: number;
    candidateInvalidations: number;
    typeInvalidations: number;
    groupedScoreLookups: number;
    groupedScoreGroupEvaluations: number;
    availabilityDiscountedGroups: number;
    scoreDirtyMarks: number;
    scoreRecomputes: number;
    placements: number;
    fixedPlacements: number;
  };
  residentialPhase: {
    candidateScans: number;
    canConnectChecks: number;
    candidateInvalidations: number;
    typeInvalidations: number;
    placements: number;
    populationCacheLookups: number;
  };
  localSearch: {
    candidateScans: number;
    canConnectChecks: number;
    placements: number;
    occupancyScratchReuses: number;
    moveChecks: number;
    addChecks: number;
    serviceRemoveChecks: number;
    serviceAddChecks: number;
    serviceSwapChecks: number;
    serviceNeighborhoodImprovements: number;
    populationCacheLookups: number;
  };
  roads: {
    canConnectChecks: number;
    ensureConnectedCalls: number;
    probeCalls: number;
    probeReuses: number;
    scratchProbeCalls: number;
    row0Checks: number;
    fallbackRoads: number;
    deferredFrontierRecomputes: number;
    deferredReconstructionSteps: number;
    deferredReconstructionFailures: number;
  };
}

export interface GreedyProfile {
  counters: GreedyProfileCounters;
}

export interface LnsOptions {
  /** Number of neighborhood-repair attempts to run after the greedy seed. */
  iterations?: number;
  /** Stop after this many consecutive non-improving neighborhoods. */
  maxNoImprovementIterations?: number;
  /** Height of each repair neighborhood. Defaults to about half the grid height. */
  neighborhoodRows?: number;
  /** Width of each repair neighborhood. Defaults to about half the grid width. */
  neighborhoodCols?: number;
  /** Per-neighborhood CP-SAT repair budget in seconds. */
  repairTimeLimitSeconds?: number;
  /** Optional saved-layout seed used instead of rebuilding the initial greedy incumbent. */
  seedHint?: CpSatWarmStartHint;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export interface SolverParams {
  /** Optimizer backend. Defaults to greedy. */
  optimizer?: OptimizerName;
  /** Auto-orchestration options, used when optimizer = "auto". */
  auto?: AutoOptions;
  /** CP-SAT backend options, used when optimizer = "cp-sat". */
  cpSat?: CpSatOptions;
  /** Greedy-only tuning knobs. Ignored by the CP-SAT backend. */
  greedy?: GreedyOptions;
  /** LNS-only tuning knobs. Ignored by other backends. */
  lns?: LnsOptions;
  /** Service types: each type has its own footprint, bonus, range, and availability. */
  serviceTypes?: ServiceTypeSetting[];
  /**
   * Residential types with rotation: each type allows (w×h) and (h×w), with per-type min, max, and avail.
   * If provided, used for candidate enumeration and population bounds; avail caps how many of that type are placed.
   */
  residentialTypes?: ResidentialTypeSetting[];
  /**
   * Per-size min/max for residentials (legacy). Key = "rowsxcols" (e.g. "2x2", "2x3").
   * Ignored when residentialTypes is provided.
   */
  residentialSettings?: ResidentialSettings;
  /** Base population per residential when no type/size setting applies */
  basePop?: number;
  /** Max population per residential when no type/size setting applies */
  maxPop?: number;
  /**
   * Available buildings: caps on how many of each type to place.
   * You can set this instead of (or it overrides) maxServices / maxResidentials.
   */
  availableBuildings?: AvailableBuildings;
  /** @deprecated Use availableBuildings.services */
  maxServices?: number;
  /** @deprecated Use availableBuildings.residentials */
  maxResidentials?: number;
  /** @deprecated Use greedy.localSearch */
  localSearch?: boolean;
  /** @deprecated Use greedy.restarts */
  restarts?: number;
  /** @deprecated Use greedy.serviceRefineIterations */
  serviceRefineIterations?: number;
  /** @deprecated Use greedy.serviceRefineCandidateLimit */
  serviceRefineCandidateLimit?: number;
  /** @deprecated Use greedy.exhaustiveServiceSearch */
  exhaustiveServiceSearch?: boolean;
  /** @deprecated Use greedy.serviceExactPoolLimit */
  serviceExactPoolLimit?: number;
  /** @deprecated Use greedy.serviceExactMaxCombinations */
  serviceExactMaxCombinations?: number;
}

export interface Solution {
  optimizer?: OptimizerName;
  /** Active inner stage when a meta-optimizer is orchestrating multiple backends. */
  activeOptimizer?: AutoStageOptimizerName;
  /** Metadata for staged auto solves. Omitted for single-stage runs. */
  autoStage?: AutoSolveStageMetadata;
  /** True when the layout was manually edited and then revalidated outside a solver run. */
  manualLayout?: boolean;
  /** CP-SAT backend status such as OPTIMAL or FEASIBLE; omitted for non-CP-SAT solvers. */
  cpSatStatus?: string;
  /** Explicit CP-SAT objective metadata when the solution came from the CP-SAT backend. */
  cpSatObjectivePolicy?: CpSatObjectivePolicy;
  /** Exact-run telemetry emitted by the CP-SAT backend when available. */
  cpSatTelemetry?: CpSatTelemetry;
  /** Portfolio summary when CP-SAT used multi-run portfolio search. */
  cpSatPortfolio?: CpSatPortfolioSummary;
  /** Optional greedy profiling counters collected only when profiling is enabled. */
  greedyProfile?: GreedyProfile;
  /** True when a run was stopped early and this solution is the best feasible result found so far. */
  stoppedByUser?: boolean;
  roads: Set<string>;
  services: ServicePlacement[];
  /** Service type index per placement; -1 only for manual solutions without configured service types */
  serviceTypeIndices: number[];
  /** Population increase applied by the i-th service (same order as services) */
  servicePopulationIncreases: number[];
  residentials: ResidentialPlacement[];
  /** Residential type index per placement; -1 when the solution did not use typed residentials */
  residentialTypeIndices: number[];
  /** Population per residential (same order as residentials) */
  populations: number[];
  totalPopulation: number;
}

/** Shared progress snapshot returned by long-running background solvers. */
export interface BackgroundSolveSnapshotState {
  hasFeasibleSolution: boolean;
  totalPopulation: number | null;
  activeOptimizer?: AutoStageOptimizerName | null;
  autoStage?: AutoSolveStageMetadata | null;
  cpSatStatus?: string | null;
}

/** Shared contract for cancellable background solver runs. */
export interface BackgroundSolveHandle {
  promise: Promise<Solution>;
  cancel: () => void;
  getLatestSnapshot: () => Solution | null;
  getLatestSnapshotState: () => BackgroundSolveSnapshotState;
}

/** JSON-serializable form of Solution for APIs and persisted browser storage. */
export interface SerializedSolution extends Omit<Solution, "roads"> {
  roads: string[];
}

/** Current solve request payload shape used by the web planner and local web server. */
export interface SolveRequestPayload {
  grid: Grid;
  params: SolverParams;
}

/** Solver summary returned by the local web server for display and persistence. */
export interface SolveResponseStats {
  optimizer?: OptimizerName;
  activeOptimizer?: AutoStageOptimizerName;
  autoStage?: AutoSolveStageMetadata;
  manualLayout: boolean;
  cpSatStatus: string | null;
  stoppedByUser: boolean;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
}

/** Validation details returned alongside a solved layout. */
export interface SolveResponseValidation {
  valid: boolean;
  errors: string[];
  recomputedPopulations: number[];
  recomputedTotalPopulation: number;
  mapRows: string[];
  mapText: string;
}

/** Chronological performance sample captured during a planner solve. */
export interface SolveProgressLogEntry {
  capturedAt: string;
  elapsedMs: number;
  source: "live-snapshot" | "final-result";
  optimizer: OptimizerName | null;
  activeOptimizer?: AutoStageOptimizerName | null;
  autoStage?: AutoSolveStageMetadata | null;
  hasFeasibleSolution: boolean;
  totalPopulation: number | null;
  cpSatStatus: string | null;
  bestPopulationUpperBound: number | null;
  populationGapUpperBound: number | null;
  solveWallTimeSeconds: number | null;
  lastImprovementAtSeconds: number | null;
  secondsSinceLastImprovement: number | null;
  note?: string | null;
}

/** Display-ready solve result payload as saved by the planner UI. */
export interface SolveResponsePayload {
  solution: SerializedSolution;
  validation: SolveResponseValidation;
  stats: SolveResponseStats;
  progressLog?: SolveProgressLogEntry[];
  progressLogFilePath?: string;
  message?: string;
}

/**
 * Full request model used to continue a saved CP-SAT solve later.
 * This is stricter than SolveRequestPayload because continuation only makes
 * sense when the model is rebuilt as CP-SAT again.
 */
export interface CpSatContinuationModelInput {
  grid: Grid;
  params: SolverParams & {
    optimizer: "cp-sat";
  };
}

/** Versioning and fingerprint data used to reject incompatible continuation attempts. */
export interface CpSatContinuationCompatibility {
  modelEncodingVersion: "cp-sat-layout-v1";
  candidateKeyVersion: 1;
  modelFingerprint: string;
  candidateUniverseHash: string;
  createdWith: {
    appVersion?: string;
    ortoolsVersion?: string;
  };
}

/** Default runtime knobs to reuse when restarting from a saved CP-SAT checkpoint. */
export interface CpSatContinuationRuntimeDefaults {
  numWorkers?: number;
  randomSeed?: number;
  randomizeSearch?: boolean;
  logSearchProgress?: boolean;
}

/** Best-known objective snapshot stored at save time. */
export interface CpSatContinuationIncumbent {
  status: "FEASIBLE" | "OPTIMAL";
  objective: {
    name: "totalPopulation";
    sense: "maximize";
    value: number;
    bestBound?: number | null;
  };
  elapsedMs: number;
  stoppedByUser: boolean;
}

/** Saved best-so-far assignment used as a warm start for a future CP-SAT run. */
export interface CpSatContinuationHint {
  roadKeys: PersistedRoadKey[];
  serviceCandidateKeys: PersistedServiceCandidateKey[];
  residentialCandidateKeys: PersistedResidentialCandidateKey[];
  solution: {
    roads: PersistedRoadKey[];
    services: CpSatContinuationHintedServicePlacement[];
    residentials: CpSatContinuationHintedResidentialPlacement[];
    populations: number[];
    totalPopulation: number;
  };
}

/** Resume policy for a future warm restart from a saved CP-SAT checkpoint. */
export interface CpSatContinuationResumePolicy {
  requireExactModelMatch: true;
  applyHints: boolean;
  repairHint: boolean;
  fixVariablesToHintedValue: boolean;
  objectiveCutoff: {
    op: ">=";
    value: number;
    preferStrictImprove: boolean;
  };
}

/** Persisted CP-SAT checkpoint that can be loaded later as a warm restart. */
export interface CpSatContinuationCheckpoint {
  kind: "city-builder.cp-sat-checkpoint";
  version: 1;
  compatibility: CpSatContinuationCompatibility;
  modelInput: CpSatContinuationModelInput;
  runtimeDefaults: CpSatContinuationRuntimeDefaults;
  incumbent: CpSatContinuationIncumbent;
  hint: CpSatContinuationHint;
  resumePolicy: CpSatContinuationResumePolicy;
}

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
