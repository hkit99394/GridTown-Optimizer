/**
 * Auto solver option and stage metadata types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { AutoStageOptimizerName } from "./baseTypes.js";
import type { GreedyProfilePhaseSummary } from "./greedyTypes.js";
import type {
  LnsAdaptiveOperatorName,
  LnsNeighborhoodOutcomeStatus,
  LnsRepairBackend,
  LnsRepairPhase
} from "./lnsTypes.js";

export type AutoSolveStopReason =
  | "completed-plan"
  | "weak-cycle-limit"
  | "optimal"
  | "population-cap-reached"
  | "cancelled"
  | "wall-clock-cap"
  | "stage-error";

export interface AutoOptions {
  /** Optional global wall-clock safety cap for the outer auto policy. Omit for no outer cap. */
  wallClockLimitSeconds?: number;
  /** Optional seed for reproducible Auto stage-seed generation. Omit for random stage seeds. */
  randomSeed?: number;
  /** Minimum combined improvement ratio for an LNS -> CP-SAT cycle to count as meaningful. Defaults to 0.5%. */
  weakCycleImprovementThreshold?: number;
  /** Stop after this many consecutive weak cycles. Defaults to 2. */
  maxConsecutiveWeakCycles?: number;
  /** Optional extra Auto runtime after a feasible incumbent reaches configured population capacity. Defaults to 0. */
  continueAfterPopulationCapSeconds?: number;
  /** Default CP-SAT stage runtime when auto is driving exact passes. Defaults to 30 seconds. */
  cpSatStageTimeLimitSeconds?: number;
  /** Share of the global Auto budget reserved for each CP-SAT stage after LNS. Defaults to 20%. */
  cpSatStageReserveRatio?: number;
  /** Default CP-SAT no-improvement cutoff when auto is driving exact passes. Defaults to 10 seconds. */
  cpSatStageNoImprovementTimeoutSeconds?: number;
}

export interface AutoSolveGeneratedSeed {
  stage: AutoStageOptimizerName;
  stageIndex: number;
  cycleIndex: number;
  randomSeed: number;
}

export interface AutoGreedySeedStageSummary {
  timeLimitSeconds: number | null;
  localSearch: boolean | null;
  restarts: number | null;
  serviceRefineIterations: number | null;
  serviceRefineCandidateLimit: number | null;
  exhaustiveServiceSearch: boolean | null;
  serviceExactPoolLimit: number | null;
  serviceExactMaxCombinations: number | null;
  serviceMasterDecomposition: boolean | null;
  serviceMasterPoolLimit: number | null;
  serviceMasterMaxLayouts: number | null;
  totalPopulation: number | null;
  elapsedSeconds: number | null;
  phases?: GreedyProfilePhaseSummary[];
}

export interface AutoLnsNeighborhoodOutcomeSummary {
  iteration: number;
  phase: LnsRepairPhase;
  operator?: LnsAdaptiveOperatorName;
  status: LnsNeighborhoodOutcomeStatus;
  repairBackend?: LnsRepairBackend;
  repairTimeLimitSeconds: number;
  wallClockSeconds: number;
  populationBefore: number;
  populationAfter: number;
  improvement: number;
  windowTop: number;
  windowLeft: number;
  windowRows: number;
  windowCols: number;
  stagnantIterationsBefore: number;
  cpSatStatus?: string | null;
}

export interface AutoStageRunSummary {
  stage: AutoStageOptimizerName;
  stageIndex: number;
  cycleIndex: number;
  randomSeed: number;
  startedAtSeconds: number;
  elapsedSeconds: number;
  completedAtSeconds: number;
  populationBefore: number | null;
  candidatePopulation: number | null;
  acceptedPopulation: number | null;
  improvement: number | null;
  cpSatStatus?: string | null;
  cpSatSolveWallTimeSeconds?: number | null;
  cpSatLastImprovementAtSeconds?: number | null;
  cpSatPopulationGapUpperBound?: number | null;
  lnsStopReason?: string | null;
  lnsSeedTimeLimitSeconds?: number | null;
  lnsSeedWallClockSeconds?: number | null;
  lnsFocusedRepairTimeLimitSeconds?: number | null;
  lnsEscalatedRepairTimeLimitSeconds?: number | null;
  lnsIterationsStarted?: number | null;
  lnsIterationsCompleted?: number | null;
  lnsImprovingIterations?: number | null;
  lnsNeutralIterations?: number | null;
  lnsNeighborhoods?: AutoLnsNeighborhoodOutcomeSummary[];
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
  stageRuns?: AutoStageRunSummary[];
  greedySeedStage?: AutoGreedySeedStageSummary | null;
}
