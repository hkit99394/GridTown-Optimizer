/**
 * LNS solver option and telemetry types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { CpSatNeighborhoodWindow, CpSatWarmStartHint } from "./cpSatTypes.js";

export type LnsNeighborhoodAnchorPolicy =
  | "ranked"
  | "sliding-only"
  | "weak-service-first"
  | "residential-opportunity-first"
  | "frontier-congestion-first"
  | "placed-buildings-first";

export interface LnsOptions {
  /** Number of neighborhood-repair attempts to run after the greedy seed. */
  iterations?: number;
  /** Stop after this many consecutive non-improving neighborhoods. */
  maxNoImprovementIterations?: number;
  /** Total LNS wall-clock budget in seconds, including seed construction. Omit for no LNS-specific wall-clock cap. */
  wallClockLimitSeconds?: number;
  /** Alias for wallClockLimitSeconds for callers that use the same naming as raw Greedy and CP-SAT. */
  timeLimitSeconds?: number;
  /** Stop after this many seconds without an improving neighborhood. Omit to rely on iteration-based stopping. */
  noImprovementTimeoutSeconds?: number;
  /** Optional greedy seed construction budget in seconds when no saved seed is provided. */
  seedTimeLimitSeconds?: number;
  /** Height of each repair neighborhood. Defaults to about half the grid height. */
  neighborhoodRows?: number;
  /** Width of each repair neighborhood. Defaults to about half the grid width. */
  neighborhoodCols?: number;
  /** Deterministic policy used to rank or suppress LNS repair-window anchors. Default ranked. */
  neighborhoodAnchorPolicy?: LnsNeighborhoodAnchorPolicy;
  /** Per-neighborhood CP-SAT repair budget in seconds. */
  repairTimeLimitSeconds?: number;
  /** Per-neighborhood budget for focused repair attempts before escalation. Defaults to repairTimeLimitSeconds. */
  focusedRepairTimeLimitSeconds?: number;
  /** Per-neighborhood budget for escalated repair attempts. Defaults to repairTimeLimitSeconds. */
  escalatedRepairTimeLimitSeconds?: number;
  /** Opt-in bounded exact DP repair for tiny LNS windows. Ineligible windows still fall back to CP-SAT. */
  smallWindowDpRepair?: boolean;
  /** Maximum mutable cells for the opt-in small-window DP repair path. */
  smallWindowDpMaxMutableCells?: number;
  /** Maximum mutable service plus residential candidates for the opt-in small-window DP repair path. */
  smallWindowDpMaxCandidates?: number;
  /** Maximum memo/search states for one opt-in small-window DP repair attempt. */
  smallWindowDpMaxStates?: number;
  /** Opt-in learned window scorer. Disabled unless a caller provides this object. */
  windowRanker?: LnsWindowRankerRuntimeOptions;
  /** Optional saved-layout seed used instead of rebuilding the initial greedy incumbent. */
  seedHint?: CpSatWarmStartHint;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export type LnsRepairPhase = "focused" | "escalated";

export type LnsRepairBackend = "cp-sat" | "small-window-dp";

export type LnsSmallWindowDpStatus =
  | "optimal"
  | "no-feasible-solution"
  | "ineligible-window-size"
  | "ineligible-mutable-cells"
  | "ineligible-candidates"
  | "ineligible-state-limit";

export interface SmallWindowDpRepairTelemetry {
  status: LnsSmallWindowDpStatus;
  elapsedSeconds: number;
  mutableCellCount: number;
  roadCellCount: number;
  serviceCandidateCount: number;
  residentialCandidateCount: number;
  candidateCount: number;
  roadMaskCount: number;
  stateCount: number;
}

export const LNS_ADAPTIVE_OPERATOR_NAMES = Object.freeze([
  "weak-service",
  "residential-headroom",
  "frontier-congestion",
  "gate-choke",
  "service-overlap",
  "random-exploration",
  "placed-buildings",
  "sliding"
] as const);

export type LnsAdaptiveOperatorName = (typeof LNS_ADAPTIVE_OPERATOR_NAMES)[number];

export const LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR = Object.freeze({
  "weak-service": "WeakService",
  "residential-headroom": "ResidentialHeadroom",
  "frontier-congestion": "FrontierCongestion",
  "gate-choke": "GateChoke",
  "service-overlap": "ServiceOverlap",
  "random-exploration": "RandomExploration",
  "placed-buildings": "PlacedBuildings",
  sliding: "Sliding"
} satisfies Record<LnsAdaptiveOperatorName, string>);

export type LnsAdaptiveOperatorFeatureSuffix =
  (typeof LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR)[LnsAdaptiveOperatorName];

export type LnsWindowRankerBaselineOperatorFeatureName = `baselineOperator${LnsAdaptiveOperatorFeatureSuffix}`;
export type LnsWindowRankerSelectedOperatorFeatureName = `selectedOperator${LnsAdaptiveOperatorFeatureSuffix}`;
export type LnsWindowRankerOperatorTransitionFeatureName =
  `transition${LnsAdaptiveOperatorFeatureSuffix}To${LnsAdaptiveOperatorFeatureSuffix}`;
export type LnsWindowRankerOperatorTrajectoryFeatureName =
  | LnsWindowRankerBaselineOperatorFeatureName
  | LnsWindowRankerSelectedOperatorFeatureName
  | LnsWindowRankerOperatorTransitionFeatureName;

export type LnsWindowRankerOperatorTransition = `${LnsAdaptiveOperatorName}->${LnsAdaptiveOperatorName}`;

export interface LnsOperatorWeight {
  operator: LnsAdaptiveOperatorName;
  weight: number;
}

export interface LnsOperatorSummary extends LnsOperatorWeight {
  attempts: number;
  feasibleRepairs: number;
  improvements: number;
  neutralRepairs: number;
  recoverableFailures: number;
  regressions: number;
  totalImprovement: number;
  elapsedSeconds: number;
}

export interface LnsWindowRankerRuntimeModel {
  modelType?: "lns-window-linear-pairwise-ranker";
  modelFingerprint?: string;
  featureSchemaVersion?: number | null;
  featureNames?: readonly string[];
  weights: Record<string, number>;
  interactionWeights?: Record<string, number>;
  intercept?: number;
}

export const LNS_WINDOW_RANKER_BASE_FEATURE_NAMES = Object.freeze([
  "operatorScore",
  "selectedByBaseline",
  "area",
  "roadCountInside",
  "serviceCountInside",
  "residentialCountInside",
  "residentialHeadroomInside",
  "serviceBonusInside",
  "reachableBefore",
  "reachableAfter",
  "newlyReachable",
  "disconnectedBefore",
  "disconnectedAfter",
  "clearedFootprint",
  "emptyComponentsBefore",
  "emptyComponentsAfter",
  "componentDelta",
  "allowedWindowCells",
  "anchorReachableWindowCells",
  "narrowGateCells",
  "serviceCandidatesIntersecting",
  "residentialCandidatesIntersecting",
  "serviceCandidatesBlocked",
  "residentialCandidatesBlocked",
  "serviceCandidateBonus",
  "maxServiceCandidateBonus",
  "residentialCandidateHeadroom"
] as const);

export type LnsWindowRankerBaseFeatureName = (typeof LNS_WINDOW_RANKER_BASE_FEATURE_NAMES)[number];

export const LNS_WINDOW_RANKER_OPERATOR_TRAJECTORY_FEATURE_NAMES = Object.freeze([
  ...LNS_ADAPTIVE_OPERATOR_NAMES.map(
    (operator) =>
      `baselineOperator${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[operator]}` as LnsWindowRankerBaselineOperatorFeatureName
  ),
  ...LNS_ADAPTIVE_OPERATOR_NAMES.map(
    (operator) =>
      `selectedOperator${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[operator]}` as LnsWindowRankerSelectedOperatorFeatureName
  ),
  ...LNS_ADAPTIVE_OPERATOR_NAMES.flatMap((baselineOperator) =>
    LNS_ADAPTIVE_OPERATOR_NAMES.map(
      (selectedOperator) =>
        `transition${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[baselineOperator]}To${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[selectedOperator]}` as LnsWindowRankerOperatorTransitionFeatureName
    )
  )
] as const) as readonly LnsWindowRankerOperatorTrajectoryFeatureName[];

export const LNS_WINDOW_RANKER_FEATURE_NAMES = Object.freeze([
  ...LNS_WINDOW_RANKER_BASE_FEATURE_NAMES,
  ...LNS_WINDOW_RANKER_OPERATOR_TRAJECTORY_FEATURE_NAMES
] as const) as readonly (LnsWindowRankerBaseFeatureName | LnsWindowRankerOperatorTrajectoryFeatureName)[];

export type LnsWindowRankerFeatureName = (typeof LNS_WINDOW_RANKER_FEATURE_NAMES)[number];

export function lnsWindowRankerBaselineOperatorFeatureName(
  operator: LnsAdaptiveOperatorName
): LnsWindowRankerBaselineOperatorFeatureName {
  return `baselineOperator${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[operator]}`;
}

export function lnsWindowRankerSelectedOperatorFeatureName(
  operator: LnsAdaptiveOperatorName
): LnsWindowRankerSelectedOperatorFeatureName {
  return `selectedOperator${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[operator]}`;
}

export function lnsWindowRankerOperatorTransitionFeatureName(
  baselineOperator: LnsAdaptiveOperatorName,
  selectedOperator: LnsAdaptiveOperatorName
): LnsWindowRankerOperatorTransitionFeatureName {
  return `transition${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[baselineOperator]}To${LNS_ADAPTIVE_OPERATOR_FEATURE_SUFFIX_BY_OPERATOR[selectedOperator]}`;
}

export interface LnsWindowRankerFeatureDeltaGate {
  feature: LnsWindowRankerFeatureName;
  minDelta?: number;
  maxDelta?: number;
}

export interface LnsWindowRankerSelectedFeatureGate {
  feature: LnsWindowRankerFeatureName;
  minValue?: number;
  maxValue?: number;
}

export type LnsWindowRankerSelectedFeatureGateGroup = readonly LnsWindowRankerSelectedFeatureGate[];

export interface LnsWindowRankerRuntimeOptions {
  enabled?: boolean;
  model: LnsWindowRankerRuntimeModel;
  minScoreDelta?: number;
  /** Diagnostics-only: only allow learned overrides whose baseline->selected operator transition is listed. */
  allowedTransitions?: readonly LnsWindowRankerOperatorTransition[];
  /** Diagnostics-only: only allow learned overrides whose selected-window feature values satisfy these bounds. */
  selectedFeatureGates?: readonly LnsWindowRankerSelectedFeatureGate[];
  /** Diagnostics-only: only allow learned overrides whose selected-window feature values satisfy at least one group. */
  selectedFeatureGateGroups?: readonly LnsWindowRankerSelectedFeatureGateGroup[];
  /** Diagnostics-only: only allow learned overrides whose selected-baseline feature deltas satisfy these bounds. */
  featureDeltaGates?: readonly LnsWindowRankerFeatureDeltaGate[];
  /** Diagnostics-only: include the exact incumbent layout at each ranker decision. */
  captureDecisionState?: boolean;
}

export type LnsWindowRankerFeatureTelemetry = Record<string, number>;

export interface LnsWindowRankerDecisionStateTelemetry {
  schemaVersion: 1;
  source: "online-window-ranker-decision-state";
  incumbentPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  seedHint: CpSatWarmStartHint;
}

export interface LnsWindowRankerSelectionTelemetry {
  source: "learned-window-ranker";
  modelFingerprint?: string;
  featureSchemaVersion?: number | null;
  candidateCount: number;
  baselineScore: number;
  selectedScore: number;
  scoreDelta: number;
  baselineCandidateIndex: number;
  selectedCandidateIndex: number;
  baselineOperator: LnsAdaptiveOperatorName;
  selectedOperator: LnsAdaptiveOperatorName;
  baselineWindow: CpSatNeighborhoodWindow;
  selectedWindow: CpSatNeighborhoodWindow;
  selectedByBaseline: boolean;
  baselineFeatures?: LnsWindowRankerFeatureTelemetry;
  selectedFeatures?: LnsWindowRankerFeatureTelemetry;
  featureDeltas?: LnsWindowRankerFeatureTelemetry;
  decisionState?: LnsWindowRankerDecisionStateTelemetry;
  fallbackReason?:
    | "score-delta-below-threshold"
    | "operator-transition-not-allowed"
    | "selected-feature-gate-not-met"
    | "feature-delta-gate-not-met";
}

export interface LnsWindowRankerTelemetry {
  enabled: true;
  modelFingerprint?: string;
  featureSchemaVersion?: number | null;
  minScoreDelta: number;
  allowedTransitions?: readonly LnsWindowRankerOperatorTransition[];
  selectedFeatureGates?: readonly LnsWindowRankerSelectedFeatureGate[];
  selectedFeatureGateGroups?: readonly LnsWindowRankerSelectedFeatureGateGroup[];
  featureDeltaGates?: readonly LnsWindowRankerFeatureDeltaGate[];
  decisions: number;
  overrides: number;
  fallbackDecisions: number;
}

export type LnsNeighborhoodOutcomeStatus =
  | "improved"
  | "neutral"
  | "recoverable-failure"
  | "skipped-budget"
  | "stopped";

export type LnsStopReason =
  | "running"
  | "iteration-limit"
  | "stale-iteration-limit"
  | "stale-time-limit"
  | "wall-clock-limit"
  | "no-neighborhoods"
  | "cancelled";

export interface LnsNeighborhoodOutcome {
  iteration: number;
  phase: LnsRepairPhase;
  operator?: LnsAdaptiveOperatorName;
  operatorWeight?: number;
  window: CpSatNeighborhoodWindow;
  stagnantIterationsBefore: number;
  staleSecondsBefore: number;
  repairTimeLimitSeconds: number;
  wallClockSeconds: number;
  populationBefore: number;
  populationAfter: number;
  improvement: number;
  status: LnsNeighborhoodOutcomeStatus;
  repairBackend?: LnsRepairBackend;
  windowRankerSelection?: LnsWindowRankerSelectionTelemetry;
  cpSatStatus?: string | null;
  smallWindowDp?: SmallWindowDpRepairTelemetry;
}

export interface LnsTelemetry {
  stopReason: LnsStopReason;
  seedSource: "greedy" | "hint";
  seedWallClockSeconds: number;
  seedTimeLimitSeconds: number | null;
  wallClockLimitSeconds: number | null;
  noImprovementTimeoutSeconds: number | null;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
  iterationsStarted: number;
  iterationsCompleted: number;
  improvingIterations: number;
  neutralIterations: number;
  recoverableFailures: number;
  skippedIterations: number;
  finalStagnantIterations: number;
  elapsedSeconds: number;
  windowRanker?: LnsWindowRankerTelemetry;
  operatorSummaries?: LnsOperatorSummary[];
  outcomes: LnsNeighborhoodOutcome[];
}
