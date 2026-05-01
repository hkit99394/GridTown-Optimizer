/**
 * CP-SAT option, progress, and telemetry types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { AutoStageOptimizerName } from "./baseTypes.js";
import type { OptimizerName, ResidentialPlacement, ServicePlacement } from "./baseTypes.js";
import type { Solution } from "./solutionTypes.js";

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
  /** Optional cap on total worker CPU seconds: workers * per-worker CP-SAT workers * per-worker time. */
  totalCpuBudgetSeconds?: number;
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

export interface CpSatModelSizeTelemetry {
  variableCount: number;
  booleanVariableCount: number;
  constraintCount: number;
  allowedCellCount: number;
  roadEligibleCellCount: number;
  roadVariableCount: number;
  rootVariableCount: number;
  directedEdgeCount: number;
  serviceCandidateCount: number;
  residentialCandidateCount: number;
  populationVariableCount: number;
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
  modelSize: CpSatModelSizeTelemetry | null;
}

export interface CpSatPortfolioWorkerSummary {
  workerIndex: number;
  randomSeed: number | null;
  randomizeSearch: boolean;
  numWorkers: number;
  status: string;
  feasible: boolean;
  totalPopulation: number | null;
  /** Per-worker CP-SAT telemetry. Null for still-running snapshot placeholders. */
  telemetry: CpSatTelemetry | null;
}

export interface CpSatPortfolioSummary {
  workerCount: number;
  selectedWorkerIndex: number | null;
  workers: CpSatPortfolioWorkerSummary[];
}

export interface SolverProgressPortfolioSummary {
  workerCount: number;
  completedWorkers: number;
  feasibleWorkers: number;
  selectedWorkerIndex: number | null;
}

export interface SolverProgressSummary {
  currentScore: number | null;
  bestScore: number | null;
  activeStage: OptimizerName | AutoStageOptimizerName | null;
  reuseSource: string | null;
  elapsedTimeSeconds: number | null;
  timeSinceImprovementSeconds: number | null;
  stopReason: string | null;
  exactGap: number | null;
  portfolioWorkerSummary: SolverProgressPortfolioSummary | null;
}

export type SolverDecisionTraceKind =
  | "checkpoint"
  | "greedy-phase"
  | "lns-neighborhood"
  | "cp-sat-progress"
  | "auto-stage";

export type SolverDecisionTraceDecision =
  | "started"
  | "improved"
  | "stalled"
  | "bounded"
  | "stopped"
  | "failed";

export type SolverDecisionTraceEvidenceValue = string | number | boolean | null;

export interface SolverDecisionTraceScore {
  before: number | null;
  after: number | null;
  best: number | null;
  delta: number | null;
  upperBound: number | null;
  gap: number | null;
}

export interface SolverDecisionTraceStage {
  stageIndex?: number;
  cycleIndex?: number;
  phase?: string;
  iteration?: number;
}

export interface SolverDecisionTraceEvent {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  eventId: string;
  elapsedMs: number;
  optimizer: OptimizerName;
  activeStage: OptimizerName | AutoStageOptimizerName | null;
  kind: SolverDecisionTraceKind;
  decision: SolverDecisionTraceDecision;
  reason: string;
  score: SolverDecisionTraceScore;
  stage?: SolverDecisionTraceStage;
  evidence?: Record<string, SolverDecisionTraceEvidenceValue>;
}

export interface SolverElapsedScoreCheckpoint {
  elapsedMs: number;
  bestScore: number | null;
  scoreDeltaToBest: number | null;
  scoreRatioToBest: number | null;
  reached: boolean;
}

export interface SolverQualityTargetCheckpoint {
  ratio: number;
  targetScore: number | null;
  reachedAtMs: number | null;
  reachedScore: number | null;
}

export interface SolverTimeToQualityScorecard {
  finalElapsedMs: number;
  finalScore: number | null;
  bestScore: number | null;
  firstFeasibleAtMs: number | null;
  firstImprovementAtMs: number | null;
  bestScoreAtMs: number | null;
  improvementCount: number;
  timeCheckpoints: SolverElapsedScoreCheckpoint[];
  qualityTargets: SolverQualityTargetCheckpoint[];
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
