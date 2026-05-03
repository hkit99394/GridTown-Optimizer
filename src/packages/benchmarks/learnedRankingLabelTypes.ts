import type { GreedyBenchmarkCase, GreedyBenchmarkOptions } from "./greedy.js";
import type { LnsBenchmarkCase, LnsReplayPressureFamilyLabel } from "./lns.js";
import type { LnsReplayLabelScaleReadiness } from "./lnsReplayLabelReadiness.js";
import type {
  LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel,
  LnsWindowReplayStatePolicy
} from "./lnsWindowReplayLabels.js";
import type {
  CpSatOptions,
  GreedyConnectivityShadowPlacementTrace,
  GreedyRoadOpportunityCounterfactualTrace,
  LnsOptions
} from "../core/index.js";

export type LearnedRankingLabelSplit = "development" | "holdout";

export type GreedyOrderingLabelSource = "connectivity-shadow-decision" | "road-opportunity-counterfactual";

export interface LearnedRankingLabelSplitConfig {
  split: LearnedRankingLabelSplit;
  greedyCaseNames: readonly string[];
  lnsCaseNames: readonly string[];
}

export interface GreedyOrderingPlacementFeatures {
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  score?: number;
  shadowPenalty?: number;
  reachableBefore?: number;
  reachableAfter?: number;
  lostCells?: number;
  footprintCells?: number;
  disconnectedCells?: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
}

export interface GreedyOrderingLabel {
  id: string;
  split: LearnedRankingLabelSplit;
  caseName: string;
  seed: number;
  source: GreedyOrderingLabelSource;
  phase: string;
  target: "lower-connectivity-shadow" | "accepted-near-miss";
  selected: GreedyOrderingPlacementFeatures;
  rejected: GreedyOrderingPlacementFeatures;
  margin: number;
  reason?: GreedyRoadOpportunityCounterfactualTrace["reason"];
}

export interface GreedyOrderingLabelSplitResult {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  seeds: number[];
  labelCount: number;
  sourceCounts: Record<GreedyOrderingLabelSource, number>;
  labels: GreedyOrderingLabel[];
}

export interface LnsReplayLabelSplitResult {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  statusCounts: Record<LnsWindowReplaySnapshotLabel["status"], number>;
  replay: LnsWindowReplaySnapshot;
}

export interface LearnedRankingLeakageReport {
  developmentGreedyCases: string[];
  holdoutGreedyCases: string[];
  developmentLnsCases: string[];
  holdoutLnsCases: string[];
  greedyOverlap: string[];
  lnsOverlap: string[];
  protectedHoldout: boolean;
}

export interface LearnedRankingAuditMetadata {
  learnedModel: null;
  greedy: {
    profile: true;
    connectivityShadowScoring: true;
  };
  lnsReplay: {
    cpSatNumWorkers: 1;
    incumbentStatePolicy: LnsWindowReplayStatePolicy | "multiple";
    incumbentStatePolicies: LnsWindowReplayStatePolicy[];
    stateCollectionIterations: number;
    stateCollectionRepairTimeLimitSeconds: number;
    candidateWindowPolicy: "baseline-ranked-top-k" | "baseline-ranked-top-k-plus-tail-exploration";
    explorationWindowCount: number;
    featureSchemaVersion: typeof LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION;
  };
}

export interface LearnedRankingLabelSuiteResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  splitCount: number;
  audit: LearnedRankingAuditMetadata;
  greedy: {
    labelCount: number;
    sourceCounts: Record<GreedyOrderingLabelSource, number>;
    splits: GreedyOrderingLabelSplitResult[];
  };
  lns: {
    labelCount: number;
    scaleReadiness: LnsReplayLabelScaleReadiness<LearnedRankingLabelSplit>;
    splits: LnsReplayLabelSplitResult[];
  };
  leakage: LearnedRankingLeakageReport;
}

export interface LearnedRankingLabelSnapshot extends Omit<LearnedRankingLabelSuiteResult, "generatedAt"> {}

export interface LearnedRankingLabelTelemetryManifestOptions {
  command: string;
  git?: {
    commit: string;
    branch: string;
  };
  hardware?: Record<string, unknown>;
}

export interface LearnedRankingLabelTelemetryManifest {
  schemaVersion: 1;
  source: "learned-ranking-label-bundle";
  command: string;
  generatedAt: string;
  git: LearnedRankingLabelTelemetryManifestOptions["git"] | null;
  hardware: Record<string, unknown>;
  labelFingerprint: string;
  suite: {
    splitCount: number;
    totalLabels: number;
    greedyLabelCount: number;
    lnsLabelCount: number;
    seeds: number[];
    protectedHoldout: boolean;
    lnsScaleReady: boolean;
    learnedModel: null;
  };
  audit: LearnedRankingAuditMetadata;
  greedy: {
    sourceCounts: Record<GreedyOrderingLabelSource, number>;
    splits: Array<{
      split: LearnedRankingLabelSplit;
      selectedCaseNames: string[];
      labelCount: number;
      sourceCounts: Record<GreedyOrderingLabelSource, number>;
    }>;
  };
  lns: {
    scaleReadiness: LnsReplayLabelScaleReadiness<LearnedRankingLabelSplit>;
    statusCounts: Record<LnsWindowReplaySnapshotLabel["status"], number>;
    splits: Array<{
      split: LearnedRankingLabelSplit;
      selectedCaseNames: string[];
      pressureFamilies: LnsReplayPressureFamilyLabel[];
      labelCount: number;
      usableLabelCount: number;
      statusCounts: Record<LnsWindowReplaySnapshotLabel["status"], number>;
      repairTimeLimitSeconds: number;
      maxWindows: number;
      explorationWindowCount: number;
      statePolicies: LnsWindowReplayStatePolicy[];
      capturedStatePolicies: LnsWindowReplayStatePolicy[];
      stateCollectionIterations: number;
      stateCollectionRepairTimeLimitSeconds: number;
      stateCount: number;
      featureSchemaVersion: number;
      cpSatNumWorkers: number;
      cpSatModelFingerprints: string[];
    }>;
  };
}

export interface LearnedRankingLabelRegistryEntryDraftOptions {
  runId?: string;
  commands: readonly string[];
  artifactPaths: readonly string[];
  decision?: string;
  summary?: string;
}

export interface LearnedRankingLabelRunOptions {
  seeds?: readonly number[];
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[];
  greedyCorpus?: readonly GreedyBenchmarkCase[];
  lnsCorpus?: readonly LnsBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  maxWindows?: number;
  repairTimeLimitSeconds?: number;
  explorationWindowCount?: number;
  lnsStatePolicies?: readonly LnsWindowReplayStatePolicy[];
  lnsStateCollectionIterations?: number;
  lnsStateCollectionRepairTimeLimitSeconds?: number;
}

export type GreedyOrderingPlacementTrace = GreedyConnectivityShadowPlacementTrace;
