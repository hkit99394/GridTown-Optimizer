import type {
  CpSatModelSizeTelemetry,
  CpSatNeighborhoodWindow,
  CpSatOptions,
  GreedyOptions,
  LnsAdaptiveOperatorName,
  LnsOptions
} from "../core/index.js";
import type { LnsReplayPressureFamilyLabel } from "./lns.js";

export const LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION = 2;
export const LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS = 1;

export const LNS_WINDOW_REPLAY_CP_SAT_MODEL_ENCODING_VERSION = "cp-sat-layout-v1";
export const LNS_WINDOW_REPLAY_CP_SAT_CANDIDATE_KEY_VERSION = 1;

export const LNS_WINDOW_REPLAY_STATE_POLICIES = Object.freeze([
  "initial-incumbent",
  "post-first-improvement",
  "post-stagnation"
] as const);
export const DEFAULT_LNS_WINDOW_REPLAY_STATE_POLICIES = Object.freeze(["initial-incumbent"] as const);
export const LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY = "online-decision" as const;

export type LnsWindowReplayStatePolicy =
  | (typeof LNS_WINDOW_REPLAY_STATE_POLICIES)[number]
  | typeof LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY;

export type LnsWindowReplayStateSourceStatus =
  | "initial-incumbent"
  | "improved"
  | "neutral"
  | "recoverable-failure"
  | "skipped-budget"
  | "stopped";

export type LnsWindowReplaySeedHintKind = "none" | "curated" | "weak-replay" | "online-decision";

export type LnsWindowReplaySelectionSource =
  | "baseline-top-k"
  | "exploration-tail"
  | "online-baseline"
  | "online-selected";

export interface LnsWindowReplayOnlineDecisionTrace {
  selectionStatus: "override" | "fallback" | "baseline";
  transition: string;
  iteration: number;
  phase: string;
  outcomeStatus: string;
  baselineOperator: LnsAdaptiveOperatorName;
  selectedOperator: LnsAdaptiveOperatorName;
  baselineWindow: CpSatNeighborhoodWindow;
  selectedWindow: CpSatNeighborhoodWindow;
  changedWindow: boolean;
  scoreDelta: number;
  baselineScore: number;
  selectedScore: number;
}

export interface LnsWindowReplayLabelRunOptions {
  names?: readonly string[];
  seeds?: readonly number[];
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
  rollForwardIterations?: number;
  rollForwardRepairTimeLimitSeconds?: number;
  statePolicies?: readonly LnsWindowReplayStatePolicy[];
  stateCollectionIterations?: number;
  stateCollectionRepairTimeLimitSeconds?: number;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
}

export interface LnsWindowReplayConnectivityShadowFeatures {
  reachableEmptyCellsBefore: number;
  reachableEmptyCellsAfterClearingWindow: number;
  newlyReachableEmptyCellsIfCleared: number;
  disconnectedEmptyCellsBefore: number;
  disconnectedEmptyCellsAfterClearingWindow: number;
  clearedBuildingFootprintCells: number;
}

export interface LnsWindowReplayFragmentationFeatures {
  emptyComponentCountBefore: number;
  emptyComponentCountAfterClearingWindow: number;
  componentDeltaAfterClearingWindow: number;
  allowedWindowCellCount: number;
  anchorReachableWindowCellCount: number;
  narrowGateCellCount: number;
}

export interface LnsWindowReplayCandidateLossFeatures {
  serviceCandidatesIntersectingWindow: number;
  residentialCandidatesIntersectingWindow: number;
  serviceCandidatesBlockedByIncumbent: number;
  residentialCandidatesBlockedByIncumbent: number;
  serviceCandidateBonusInside: number;
  maxServiceCandidateBonusInside: number;
  residentialCandidateHeadroomInside: number;
  serviceTypeCounts: Record<string, number>;
  residentialTypeCounts: Record<string, number>;
}

export interface LnsWindowReplayFeatures {
  schemaVersion: typeof LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION;
  area: number;
  touchesRoadAnchorBoundary: boolean;
  roadCountInside: number;
  serviceCountInside: number;
  residentialCountInside: number;
  residentialHeadroomInside: number;
  serviceBonusInside: number;
  selectedByBaseline: boolean;
  connectivityShadow: LnsWindowReplayConnectivityShadowFeatures;
  fragmentation: LnsWindowReplayFragmentationFeatures;
  candidateLoss: LnsWindowReplayCandidateLossFeatures;
}

export interface LnsWindowReplayTiming {
  repairTimeLimitSeconds: number;
  cpSatNumWorkers: number;
  workerCpuBudgetSeconds: number;
  wallClockSeconds: number;
  cpSatSolveWallTimeSeconds: number | null;
  cpSatUserTimeSeconds: number | null;
  observedCpuSeconds: number | null;
}

export type LnsWindowReplaySnapshotTiming = Pick<
  LnsWindowReplayTiming,
  "repairTimeLimitSeconds" | "cpSatNumWorkers" | "workerCpuBudgetSeconds"
>;

export interface LnsWindowReplayCpSatMetadata {
  modelEncodingVersion: typeof LNS_WINDOW_REPLAY_CP_SAT_MODEL_ENCODING_VERSION;
  candidateKeyVersion: typeof LNS_WINDOW_REPLAY_CP_SAT_CANDIDATE_KEY_VERSION;
  modelFingerprint: string;
  warmStartFixOutsideNeighborhood: true;
  modelSize: CpSatModelSizeTelemetry | null;
}

export type LnsWindowReplayRollForwardStatus = "improved" | "neutral" | "regressed" | "unknown";

export interface LnsWindowReplayRollForwardOutcome {
  iterations: number;
  repairTimeLimitSeconds: number;
  seedPopulation: number;
  totalPopulation: number;
  populationDeltaFromIncumbent: number;
  populationDeltaFromRepair: number;
  baselineTotalPopulation: number | null;
  populationDeltaVsBaseline: number | null;
  improvementVsBaseline: number | null;
  statusVsBaseline: LnsWindowReplayRollForwardStatus;
}

export interface LnsWindowReplayLabel {
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  seedHintKind: LnsWindowReplaySeedHintKind;
  seedHintSourceName: string | null;
  statePolicy: LnsWindowReplayStatePolicy;
  stateIndex: number;
  stateSourceIteration: number | null;
  stateSourceStatus: LnsWindowReplayStateSourceStatus;
  stateStagnantIterations: number;
  windowIndex: number;
  operator: LnsAdaptiveOperatorName;
  operatorScore: number;
  selectionSource: LnsWindowReplaySelectionSource;
  window: CpSatNeighborhoodWindow;
  selectedByBaseline: boolean;
  incumbentPopulation: number;
  totalPopulation: number;
  populationDelta: number;
  improvement: number;
  status: "improved" | "neutral" | "regressed" | "invalid" | "recoverable-failure";
  usable: boolean;
  cpSatStatus: string | null;
  repairTimeLimitSeconds: number;
  wallClockSeconds: number;
  timing: LnsWindowReplayTiming;
  cpSat: LnsWindowReplayCpSatMetadata;
  validation: {
    valid: boolean;
    recomputedTotalPopulation: number;
  };
  features: LnsWindowReplayFeatures;
  onlineDecisionTrace?: LnsWindowReplayOnlineDecisionTrace;
  rollForward?: LnsWindowReplayRollForwardOutcome;
}

export interface LnsWindowReplayCaseResult {
  name: string;
  description: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  seedHintKind: LnsWindowReplaySeedHintKind;
  seedHintSourceName: string | null;
  statePolicy: LnsWindowReplayStatePolicy;
  stateIndex: number;
  stateSourceIteration: number | null;
  stateSourceStatus: LnsWindowReplayStateSourceStatus;
  stateStagnantIterations: number;
  gridRows: number;
  gridCols: number;
  incumbentPopulation: number;
  candidateWindowCount: number;
  replayedWindowCount: number;
  baselineSelectedWindow: CpSatNeighborhoodWindow | null;
  baselineSelectedOperator: LnsAdaptiveOperatorName | null;
  onlineDecisionTrace?: LnsWindowReplayOnlineDecisionTrace;
  labels: LnsWindowReplayLabel[];
}

export interface LnsWindowReplaySuiteResult {
  schemaVersion: 1;
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  maxWindows: number;
  explorationWindowCount: number;
  repairTimeLimitSeconds: number;
  rollForwardIterations: number;
  rollForwardRepairTimeLimitSeconds: number | null;
  rollForwardLabelCount: number;
  statePolicies: LnsWindowReplayStatePolicy[];
  capturedStatePolicies: LnsWindowReplayStatePolicy[];
  stateCollectionIterations: number;
  stateCollectionRepairTimeLimitSeconds: number;
  stateCount: number;
  featureSchemaVersion: typeof LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION;
  cpSatNumWorkers: typeof LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS;
  cpSatModelFingerprints: string[];
  labelCount: number;
  cases: LnsWindowReplayCaseResult[];
}

export interface LnsWindowReplaySnapshotLabel extends Omit<LnsWindowReplayLabel, "wallClockSeconds" | "timing"> {
  timing: LnsWindowReplaySnapshotTiming;
}

export interface LnsWindowReplaySnapshotCaseResult extends Omit<LnsWindowReplayCaseResult, "labels"> {
  labels: LnsWindowReplaySnapshotLabel[];
}

export interface LnsWindowReplaySnapshot extends Omit<LnsWindowReplaySuiteResult, "generatedAt" | "cases"> {
  cases: LnsWindowReplaySnapshotCaseResult[];
}
