import { buildBenchmarkSeedRunPlan } from "./benchmarkSeeds.js";
import {
  buildBenchmarkSuiteMetadata,
  buildBenchmarkVariantCoverage,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName,
  snapshotBenchmarkVariantResult,
  snapshotBenchmarkVariantSummary,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, getLnsReplayPressureFamily, runLnsBenchmarkSuite } from "./lns.js";
import {
  GENERATED_LNS_FRESH_PRESSURE_HOLDOUT_CASES,
  GENERATED_LNS_PRODUCT_PROMOTION_PRESSURE_CASES,
  GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES
} from "./lnsPressureCases.js";
import { buildModelExperimentFingerprint } from "./modelExperimentArtifacts.js";
import type * as finalOutcomes from "./lnsWindowRankerOnlineFinalOutcomes.js";
import { buildVariantSummary, variantResult } from "./lnsWindowRankerOnlineAblationVariants.js";
import { assertValidLnsWindowRankerRuntimeModel } from "../core/index.js";

import type {
  CpSatNeighborhoodWindow,
  LnsAdaptiveOperatorName,
  LnsNeighborhoodOutcomeStatus,
  LnsOptions,
  LnsRepairPhase,
  LnsWindowRankerOperatorTransition,
  LnsWindowRankerDecisionStateTelemetry,
  LnsWindowRankerFeatureDeltaGate,
  LnsWindowRankerFeatureTelemetry,
  LnsWindowRankerRuntimeModel,
  LnsWindowRankerSelectedFeatureGate,
  LnsWindowRankerSelectedFeatureGateGroup,
  LnsWindowRankerSelectionTelemetry
} from "../core/index.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot
} from "./benchmarkOptions.js";
import type { LnsBenchmarkCase, LnsBenchmarkRunOptions } from "./lns.js";
import type { LnsWindowRankerOnlineFinalLayoutDelta } from "./lnsWindowRankerOnlineLayoutDeltas.js";
import type {
  LnsWindowRankerOnlineFinalTransitionStatus,
  LnsWindowRankerOnlineSelectionDiagnostics,
  LnsWindowRankerOnlineTransitionStatusCounts
} from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

export type LnsWindowRankerOnlineAblationVariantName = "baseline" | "window-ranker";

export interface LnsWindowRankerOnlineAblationRunOptions extends LnsBenchmarkRunOptions {
  model: LnsWindowRankerRuntimeModel;
  minScoreDelta?: number;
  suppressionModel?: LnsWindowRankerRuntimeModel;
  suppressionMinScoreDelta?: number;
  allowedTransitions?: readonly LnsWindowRankerOperatorTransition[];
  selectedFeatureGates?: readonly LnsWindowRankerSelectedFeatureGate[];
  selectedFeatureGateGroups?: readonly LnsWindowRankerSelectedFeatureGateGroup[];
  featureDeltaGates?: readonly LnsWindowRankerFeatureDeltaGate[];
  seeds?: readonly number[];
}

export interface LnsWindowRankerOnlineAblationTelemetrySummary {
  enabled: boolean;
  modelFingerprint: string | null;
  featureSchemaVersion: number | null;
  minScoreDelta: number | null;
  suppressionModelFingerprint: string | null;
  suppressionMinScoreDelta: number | null;
  allowedTransitions: readonly LnsWindowRankerOperatorTransition[] | null;
  selectedFeatureGates: readonly LnsWindowRankerSelectedFeatureGate[];
  selectedFeatureGateGroups: readonly LnsWindowRankerSelectedFeatureGateGroup[];
  featureDeltaGates: readonly LnsWindowRankerFeatureDeltaGate[];
  decisions: number;
  overrides: number;
  fallbackDecisions: number;
  overrideRate: number;
  fallbackRate: number;
}

export interface LnsWindowRankerOnlineTimeToBestSummary {
  timeToBestIteration: number | null;
  timeToBestWallClockSeconds: number | null;
}

export type LnsWindowRankerOnlineSelectionTraceStatus = "override" | "fallback" | "baseline";

export interface LnsWindowRankerOnlineSelectionTraceEntry {
  iteration: number;
  phase: LnsRepairPhase;
  outcomeStatus: LnsNeighborhoodOutcomeStatus;
  populationBefore: number;
  populationAfter: number;
  improvement: number;
  stagnantIterationsBefore: number;
  repairTimeLimitSeconds: number;
  appliedOperator: LnsAdaptiveOperatorName | null;
  appliedWindow: CpSatNeighborhoodWindow;
  transition: string;
  changedWindow: boolean;
  nominatedTransition?: string;
  nominatedChangedWindow?: boolean;
  selectionStatus: LnsWindowRankerOnlineSelectionTraceStatus;
  candidateCount: number;
  baselineCandidateIndex: number;
  selectedCandidateIndex: number;
  baselineOperator: LnsAdaptiveOperatorName;
  selectedOperator: LnsAdaptiveOperatorName;
  baselineWindow: CpSatNeighborhoodWindow;
  selectedWindow: CpSatNeighborhoodWindow;
  selectedByBaseline: boolean;
  fallbackReason?: LnsWindowRankerSelectionTelemetry["fallbackReason"];
  baselineScore: number;
  selectedScore: number;
  scoreDelta: number;
  nominatedCandidateIndex?: number;
  nominatedOperator?: LnsAdaptiveOperatorName;
  nominatedWindow?: CpSatNeighborhoodWindow;
  nominatedByBaseline?: boolean;
  nominatedScore?: number;
  nominatedScoreDelta?: number;
  suppressionModelFingerprint?: string;
  suppressionBaselineScore?: number;
  suppressionSelectedScore?: number;
  suppressionScoreDelta?: number;
  modelFingerprint: string | null;
  featureSchemaVersion: number | null;
  baselineFeatures?: LnsWindowRankerFeatureTelemetry;
  selectedFeatures?: LnsWindowRankerFeatureTelemetry;
  featureDeltas?: LnsWindowRankerFeatureTelemetry;
  nominatedFeatures?: LnsWindowRankerFeatureTelemetry;
  nominatedFeatureDeltas?: LnsWindowRankerFeatureTelemetry;
  decisionState?: LnsWindowRankerDecisionStateTelemetry;
}

export interface LnsWindowRankerOnlineAblationVariantResult {
  variantName: LnsWindowRankerOnlineAblationVariantName;
  description: string;
  seed: number | null;
  totalPopulation: number;
  populationDeltaVsBaseline: number;
  wallClockSeconds: number;
  wallClockDeltaVsBaselineSeconds: number;
  timeToBestIteration: number | null;
  timeToBestIterationDeltaVsBaseline: number | null;
  timeToBestWallClockSeconds: number | null;
  timeToBestWallClockDeltaVsBaselineSeconds: number | null;
  roadCount: number;
  roadDeltaVsBaseline: number;
  serviceCount: number;
  residentialCount: number;
  lnsOptions: LnsOptions;
  cpSatStatus: string | null;
  stopReason: string | null;
  improvingIterations: number | null;
  neutralIterations: number | null;
  recoverableFailures: number | null;
  overrideOutcomeCount: number;
  fallbackOutcomeCount: number;
  overrideImprovedOutcomeCount: number;
  overrideNeutralOutcomeCount: number;
  fallbackImprovedOutcomeCount: number;
  fallbackNeutralOutcomeCount: number;
  meanOverrideScoreDelta: number | null;
  selectionDiagnostics: LnsWindowRankerOnlineSelectionDiagnostics | null;
  selectionTrace: LnsWindowRankerOnlineSelectionTraceEntry[];
  finalLayoutDeltaVsBaseline: LnsWindowRankerOnlineFinalLayoutDelta;
  finalOutcome: finalOutcomes.LnsWindowRankerOnlineFinalOutcome;
  windowRanker: LnsWindowRankerOnlineAblationTelemetrySummary | null;
}

export interface LnsWindowRankerOnlineAblationCaseResult {
  name: string;
  description: string;
  pressureFamily: string;
  seed: number | null;
  gridRows: number;
  gridCols: number;
  gridCells: number;
  baseline: LnsWindowRankerOnlineAblationVariantResult;
  variants: LnsWindowRankerOnlineAblationVariantResult[];
}

export interface LnsWindowRankerOnlineAblationSummary
  extends
    BenchmarkVariantSummaryMetrics<LnsWindowRankerOnlineAblationVariantName>,
    finalOutcomes.LnsWindowRankerOnlineFinalOutcomeSummary {
  description: string;
  rankerDecisionCount: number;
  rankerOverrideCount: number;
  rankerFallbackDecisionCount: number;
  rankerOverrideRate: number;
  rankerFallbackRate: number;
  overrideOutcomeCount: number;
  fallbackOutcomeCount: number;
  overrideImprovedOutcomeCount: number;
  overrideNeutralOutcomeCount: number;
  fallbackImprovedOutcomeCount: number;
  fallbackNeutralOutcomeCount: number;
  meanOverrideScoreDelta: number | null;
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideChangedWindowCount: number;
  fallbackChangedWindowCount: number;
  overrideFeatureDeltaCount: number;
  fallbackFeatureDeltaCount: number;
  overrideMeanFeatureDeltas: Record<string, number>;
  fallbackMeanFeatureDeltas: Record<string, number>;
  overrideTransitionFeatureDeltaCounts: Record<string, number>;
  fallbackTransitionFeatureDeltaCounts: Record<string, number>;
  overrideTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
  fallbackTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  overrideFinalOutcomeFeatureDeltaCounts: Record<LnsWindowRankerOnlineFinalTransitionStatus, number>;
  fallbackFinalOutcomeFeatureDeltaCounts: Record<LnsWindowRankerOnlineFinalTransitionStatus, number>;
  overrideFinalOutcomeMeanFeatureDeltas: Record<LnsWindowRankerOnlineFinalTransitionStatus, Record<string, number>>;
  fallbackFinalOutcomeMeanFeatureDeltas: Record<LnsWindowRankerOnlineFinalTransitionStatus, Record<string, number>>;
  overrideImprovedVsNeutralMeanFeatureDeltaGaps: Record<string, number>;
  overrideRegressedVsNeutralMeanFeatureDeltaGaps: Record<string, number>;
  selectionTraceCount: number;
  sameFinalLayoutCount: number;
  changedFinalLayoutCount: number;
  meanFinalLayoutPlacementDelta: number;
  meanTimeToBestIteration: number | null;
  meanTimeToBestIterationDeltaVsBaseline: number | null;
  meanTimeToBestWallClockSeconds: number | null;
  meanTimeToBestWallClockDeltaVsBaselineSeconds: number | null;
  timeToBestWallClockKnownPairCount: number;
  timeToBestWallClockUnknownPairCount: number;
  meanTimeToBestWallClockRatioVsBaseline: number | null;
  medianTimeToBestWallClockRatioVsBaseline: number | null;
  timeToBestWallClockFaster10PercentCount: number;
  timeToBestWallClockSlower10PercentCount: number;
  timeToBestWallClockFaster10PercentRate: number;
  timeToBestWallClockSlower10PercentRate: number;
  equalPopulationTimeToBestGatePassed: boolean;
  timeToBestPromotionGatePassed: boolean;
  earlierTimeToBestCount: number;
  sameTimeToBestCount: number;
  laterTimeToBestCount: number;
  unknownTimeToBestCount: number;
}

export interface LnsWindowRankerOnlineAblationCoverage extends BenchmarkVariantCoverageMetrics {}

export interface LnsWindowRankerOnlineAblationSuiteResult {
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  variants: LnsWindowRankerOnlineAblationVariantName[];
  coverage: LnsWindowRankerOnlineAblationCoverage;
  variantSummaries: LnsWindowRankerOnlineAblationSummary[];
  cases: LnsWindowRankerOnlineAblationCaseResult[];
}

export interface LnsWindowRankerOnlineAblationSnapshotVariantResult extends BenchmarkVariantResultSnapshot<LnsWindowRankerOnlineAblationVariantResult> {}

export interface LnsWindowRankerOnlineAblationSnapshotCaseResult extends Omit<
  LnsWindowRankerOnlineAblationCaseResult,
  "baseline" | "variants"
> {
  baseline: LnsWindowRankerOnlineAblationSnapshotVariantResult;
  variants: LnsWindowRankerOnlineAblationSnapshotVariantResult[];
}

export interface LnsWindowRankerOnlineAblationSnapshotSummary extends BenchmarkVariantSummarySnapshot<LnsWindowRankerOnlineAblationSummary> {}

export interface LnsWindowRankerOnlineAblationSnapshot extends Omit<
  LnsWindowRankerOnlineAblationSuiteResult,
  "generatedAt" | "variantSummaries" | "cases"
> {
  variantSummaries: LnsWindowRankerOnlineAblationSnapshotSummary[];
  cases: LnsWindowRankerOnlineAblationSnapshotCaseResult[];
}

export interface LnsWindowRankerOnlineCalibrationRunOptions extends Omit<
  LnsWindowRankerOnlineAblationRunOptions,
  "minScoreDelta"
> {
  minScoreDeltas?: readonly number[];
}

export interface LnsWindowRankerOnlineCalibrationThresholdSummary {
  minScoreDelta: number;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  meanPopulationDeltaVsBaseline: number;
  medianPopulationDeltaVsBaseline: number;
  worstDecilePopulationDeltaVsBaseline: number;
  bestPopulationDeltaVsBaseline: number;
  worstPopulationDeltaVsBaseline: number;
  worstPopulationDeltaCaseName: string | null;
  worstPopulationDeltaSeed: number | null;
  bestPopulationDeltaCaseName: string | null;
  bestPopulationDeltaSeed: number | null;
  meanWallClockDeltaVsBaselineSeconds: number;
  meanTimeToBestIterationDeltaVsBaseline: number | null;
  meanTimeToBestWallClockDeltaVsBaselineSeconds: number | null;
  timeToBestWallClockKnownPairCount: number;
  timeToBestWallClockUnknownPairCount: number;
  meanTimeToBestWallClockRatioVsBaseline: number | null;
  medianTimeToBestWallClockRatioVsBaseline: number | null;
  timeToBestWallClockFaster10PercentCount: number;
  timeToBestWallClockSlower10PercentCount: number;
  timeToBestWallClockFaster10PercentRate: number;
  timeToBestWallClockSlower10PercentRate: number;
  equalPopulationTimeToBestGatePassed: boolean;
  timeToBestPromotionGatePassed: boolean;
  earlierTimeToBestCount: number;
  sameTimeToBestCount: number;
  laterTimeToBestCount: number;
  unknownTimeToBestCount: number;
  improvedCaseCount: number;
  regressedCaseCount: number;
  unchangedCaseCount: number;
  winRate: number;
  regressionRate: number;
  rankerDecisionCount: number;
  rankerOverrideCount: number;
  rankerFallbackDecisionCount: number;
  rankerOverrideRate: number;
  rankerFallbackRate: number;
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideChangedWindowCount: number;
  fallbackChangedWindowCount: number;
  overrideFeatureDeltaCount: number;
  fallbackFeatureDeltaCount: number;
  overrideMeanFeatureDeltas: Record<string, number>;
  fallbackMeanFeatureDeltas: Record<string, number>;
  overrideTransitionFeatureDeltaCounts: Record<string, number>;
  fallbackTransitionFeatureDeltaCounts: Record<string, number>;
  overrideTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
  fallbackTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  overrideFinalOutcomeFeatureDeltaCounts: Record<LnsWindowRankerOnlineFinalTransitionStatus, number>;
  fallbackFinalOutcomeFeatureDeltaCounts: Record<LnsWindowRankerOnlineFinalTransitionStatus, number>;
  overrideFinalOutcomeMeanFeatureDeltas: Record<LnsWindowRankerOnlineFinalTransitionStatus, Record<string, number>>;
  fallbackFinalOutcomeMeanFeatureDeltas: Record<LnsWindowRankerOnlineFinalTransitionStatus, Record<string, number>>;
  overrideImprovedVsNeutralMeanFeatureDeltaGaps: Record<string, number>;
  overrideRegressedVsNeutralMeanFeatureDeltaGaps: Record<string, number>;
  selectionTraceCount: number;
  sameFinalLayoutCount: number;
  changedFinalLayoutCount: number;
  meanFinalLayoutPlacementDelta: number;
  safetyGatePassed: boolean;
}

export interface LnsWindowRankerOnlineCalibrationSuiteResult {
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  modelFingerprint: string | null;
  suppressionModelFingerprint?: string | null;
  suppressionMinScoreDelta?: number;
  allowedTransitions?: readonly LnsWindowRankerOperatorTransition[];
  selectedFeatureGates?: readonly LnsWindowRankerSelectedFeatureGate[];
  selectedFeatureGateGroups?: readonly LnsWindowRankerSelectedFeatureGateGroup[];
  featureDeltaGates?: readonly LnsWindowRankerFeatureDeltaGate[];
  minScoreDeltas: number[];
  topMeanPopulationDeltaMinScoreDelta: number | null;
  topSafeMinScoreDelta: number | null;
  thresholdSummaries: LnsWindowRankerOnlineCalibrationThresholdSummary[];
}

export interface LnsWindowRankerOnlineCalibrationThresholdSnapshot extends Omit<
  LnsWindowRankerOnlineCalibrationThresholdSummary,
  "meanWallClockDeltaVsBaselineSeconds" | "meanTimeToBestWallClockDeltaVsBaselineSeconds"
> {}

export interface LnsWindowRankerOnlineCalibrationSnapshot extends Omit<
  LnsWindowRankerOnlineCalibrationSuiteResult,
  "generatedAt" | "thresholdSummaries"
> {
  thresholdSummaries: LnsWindowRankerOnlineCalibrationThresholdSnapshot[];
}

const ONLINE_ABLATION_VARIANTS: readonly LnsWindowRankerOnlineAblationVariantName[] = Object.freeze([
  "baseline",
  "window-ranker"
]);

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_ABLATION_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  ...DEFAULT_LNS_REPLAY_LABEL_CORPUS
]);

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  ...GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES
]);

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_PRODUCT_PROMOTION_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  ...GENERATED_LNS_PRODUCT_PROMOTION_PRESSURE_CASES
]);

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_FRESH_PRESSURE_HOLDOUT_CORPUS: readonly LnsBenchmarkCase[] =
  Object.freeze([...GENERATED_LNS_FRESH_PRESSURE_HOLDOUT_CASES]);

export const DEFAULT_LNS_WINDOW_RANKER_MIN_SCORE_DELTA_SWEEP: readonly number[] = Object.freeze([
  0, 0.05, 0.1, 0.15, 0.2
]);

function assertRuntimeModel(
  model: LnsWindowRankerRuntimeModel | undefined
): asserts model is LnsWindowRankerRuntimeModel {
  assertValidLnsWindowRankerRuntimeModel(model, "LNS window ranker online ablation model");
}

function withoutWindowRanker(lns: Partial<LnsOptions> | undefined): Partial<LnsOptions> {
  const { windowRanker: _windowRanker, ...rest } = lns ?? {};
  return rest;
}

function seededOptions(
  options: LnsWindowRankerOnlineAblationRunOptions,
  seed: number | null,
  lns: Partial<LnsOptions>
): LnsBenchmarkRunOptions {
  return {
    greedy: {
      ...(options.greedy ?? {}),
      ...(seed !== null ? { randomSeed: seed } : {})
    },
    cpSat: {
      ...(options.cpSat ?? {}),
      ...(seed !== null ? { randomSeed: seed } : {})
    },
    lns
  };
}

function modelWithFingerprint(model: LnsWindowRankerRuntimeModel): LnsWindowRankerRuntimeModel {
  return {
    ...model,
    modelFingerprint: model.modelFingerprint ?? buildModelExperimentFingerprint(model)
  };
}

function rankerLnsOptions(
  options: LnsWindowRankerOnlineAblationRunOptions,
  model: LnsWindowRankerRuntimeModel
): Partial<LnsOptions> {
  return {
    ...withoutWindowRanker(options.lns),
    windowRanker: {
      model,
      ...(options.minScoreDelta === undefined ? {} : { minScoreDelta: options.minScoreDelta }),
      ...(options.suppressionModel === undefined
        ? {}
        : { suppressionModel: modelWithFingerprint(options.suppressionModel) }),
      ...(options.suppressionMinScoreDelta === undefined
        ? {}
        : { suppressionMinScoreDelta: options.suppressionMinScoreDelta }),
      ...(options.allowedTransitions === undefined ? {} : { allowedTransitions: [...options.allowedTransitions] }),
      ...(options.selectedFeatureGates === undefined
        ? {}
        : { selectedFeatureGates: [...options.selectedFeatureGates] }),
      ...(options.selectedFeatureGateGroups === undefined
        ? {}
        : { selectedFeatureGateGroups: options.selectedFeatureGateGroups.map((group) => [...group]) }),
      ...(options.featureDeltaGates === undefined ? {} : { featureDeltaGates: [...options.featureDeltaGates] }),
      captureDecisionState: true
    }
  };
}

function baselineLnsOptions(options: LnsWindowRankerOnlineAblationRunOptions): Partial<LnsOptions> {
  return withoutWindowRanker(options.lns);
}

function selectOnlineAblationCases(
  corpus: readonly LnsBenchmarkCase[],
  names: readonly string[] | undefined
): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "LNS window ranker online ablation",
    corpusLabel: "LNS window ranker online ablation"
  });
}

function normalizeMinScoreDeltas(values: readonly number[] | undefined): number[] {
  const minScoreDeltas = values?.length ? [...values] : [...DEFAULT_LNS_WINDOW_RANKER_MIN_SCORE_DELTA_SWEEP];
  const invalid = minScoreDeltas.filter((value) => !Number.isFinite(value) || value < 0);
  if (invalid.length > 0) {
    throw new Error("LNS window ranker min score delta sweep must contain only non-negative finite numbers.");
  }
  if (new Set(minScoreDeltas).size !== minScoreDeltas.length) {
    throw new Error("LNS window ranker min score delta sweep must not contain duplicate values.");
  }
  return minScoreDeltas;
}

function getRankerSummary(result: LnsWindowRankerOnlineAblationSuiteResult): LnsWindowRankerOnlineAblationSummary {
  const summary = result.variantSummaries.find((entry) => entry.variantName === "window-ranker");
  if (!summary) {
    throw new Error("LNS window ranker online calibration result missing window-ranker summary.");
  }
  return summary;
}

function thresholdSummary(
  minScoreDelta: number,
  result: LnsWindowRankerOnlineAblationSuiteResult
): LnsWindowRankerOnlineCalibrationThresholdSummary {
  const summary = getRankerSummary(result);
  return {
    minScoreDelta,
    caseCount: summary.caseCount,
    seedCount: summary.seedCount,
    comparisonCount: summary.comparisonCount,
    meanPopulationDeltaVsBaseline: summary.meanPopulationDeltaVsBaseline,
    medianPopulationDeltaVsBaseline: summary.medianPopulationDeltaVsBaseline,
    worstDecilePopulationDeltaVsBaseline: summary.worstDecilePopulationDeltaVsBaseline,
    bestPopulationDeltaVsBaseline: summary.bestPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
    worstPopulationDeltaCaseName: summary.worstPopulationDeltaCaseName,
    worstPopulationDeltaSeed: summary.worstPopulationDeltaSeed,
    bestPopulationDeltaCaseName: summary.bestPopulationDeltaCaseName,
    bestPopulationDeltaSeed: summary.bestPopulationDeltaSeed,
    meanWallClockDeltaVsBaselineSeconds: summary.meanWallClockDeltaVsBaselineSeconds,
    meanTimeToBestIterationDeltaVsBaseline: summary.meanTimeToBestIterationDeltaVsBaseline,
    meanTimeToBestWallClockDeltaVsBaselineSeconds: summary.meanTimeToBestWallClockDeltaVsBaselineSeconds,
    timeToBestWallClockKnownPairCount: summary.timeToBestWallClockKnownPairCount,
    timeToBestWallClockUnknownPairCount: summary.timeToBestWallClockUnknownPairCount,
    meanTimeToBestWallClockRatioVsBaseline: summary.meanTimeToBestWallClockRatioVsBaseline,
    medianTimeToBestWallClockRatioVsBaseline: summary.medianTimeToBestWallClockRatioVsBaseline,
    timeToBestWallClockFaster10PercentCount: summary.timeToBestWallClockFaster10PercentCount,
    timeToBestWallClockSlower10PercentCount: summary.timeToBestWallClockSlower10PercentCount,
    timeToBestWallClockFaster10PercentRate: summary.timeToBestWallClockFaster10PercentRate,
    timeToBestWallClockSlower10PercentRate: summary.timeToBestWallClockSlower10PercentRate,
    equalPopulationTimeToBestGatePassed: summary.equalPopulationTimeToBestGatePassed,
    timeToBestPromotionGatePassed: summary.timeToBestPromotionGatePassed,
    earlierTimeToBestCount: summary.earlierTimeToBestCount,
    sameTimeToBestCount: summary.sameTimeToBestCount,
    laterTimeToBestCount: summary.laterTimeToBestCount,
    unknownTimeToBestCount: summary.unknownTimeToBestCount,
    improvedCaseCount: summary.improvedCaseCount,
    regressedCaseCount: summary.regressedCaseCount,
    unchangedCaseCount: summary.unchangedCaseCount,
    winRate: summary.winRate,
    regressionRate: summary.regressionRate,
    rankerDecisionCount: summary.rankerDecisionCount,
    rankerOverrideCount: summary.rankerOverrideCount,
    rankerFallbackDecisionCount: summary.rankerFallbackDecisionCount,
    rankerOverrideRate: summary.rankerOverrideRate,
    rankerFallbackRate: summary.rankerFallbackRate,
    overrideTransitionCounts: summary.overrideTransitionCounts,
    fallbackTransitionCounts: summary.fallbackTransitionCounts,
    overrideChangedWindowCount: summary.overrideChangedWindowCount,
    fallbackChangedWindowCount: summary.fallbackChangedWindowCount,
    overrideFeatureDeltaCount: summary.overrideFeatureDeltaCount,
    fallbackFeatureDeltaCount: summary.fallbackFeatureDeltaCount,
    overrideMeanFeatureDeltas: summary.overrideMeanFeatureDeltas,
    fallbackMeanFeatureDeltas: summary.fallbackMeanFeatureDeltas,
    overrideTransitionFeatureDeltaCounts: summary.overrideTransitionFeatureDeltaCounts,
    fallbackTransitionFeatureDeltaCounts: summary.fallbackTransitionFeatureDeltaCounts,
    overrideTransitionMeanFeatureDeltas: summary.overrideTransitionMeanFeatureDeltas,
    fallbackTransitionMeanFeatureDeltas: summary.fallbackTransitionMeanFeatureDeltas,
    overrideTransitionFinalOutcomeCounts: summary.overrideTransitionFinalOutcomeCounts,
    fallbackTransitionFinalOutcomeCounts: summary.fallbackTransitionFinalOutcomeCounts,
    overrideTransitionPressureFamilyCounts: summary.overrideTransitionPressureFamilyCounts,
    fallbackTransitionPressureFamilyCounts: summary.fallbackTransitionPressureFamilyCounts,
    overrideFinalOutcomeFeatureDeltaCounts: summary.overrideFinalOutcomeFeatureDeltaCounts,
    fallbackFinalOutcomeFeatureDeltaCounts: summary.fallbackFinalOutcomeFeatureDeltaCounts,
    overrideFinalOutcomeMeanFeatureDeltas: summary.overrideFinalOutcomeMeanFeatureDeltas,
    fallbackFinalOutcomeMeanFeatureDeltas: summary.fallbackFinalOutcomeMeanFeatureDeltas,
    overrideImprovedVsNeutralMeanFeatureDeltaGaps: summary.overrideImprovedVsNeutralMeanFeatureDeltaGaps,
    overrideRegressedVsNeutralMeanFeatureDeltaGaps: summary.overrideRegressedVsNeutralMeanFeatureDeltaGaps,
    selectionTraceCount: summary.selectionTraceCount,
    sameFinalLayoutCount: summary.sameFinalLayoutCount,
    changedFinalLayoutCount: summary.changedFinalLayoutCount,
    meanFinalLayoutPlacementDelta: summary.meanFinalLayoutPlacementDelta,
    safetyGatePassed: summary.regressedCaseCount === 0 && summary.worstPopulationDeltaVsBaseline >= 0
  };
}

function betterCalibrationSummary(
  candidate: LnsWindowRankerOnlineCalibrationThresholdSummary,
  best: LnsWindowRankerOnlineCalibrationThresholdSummary | null
): boolean {
  if (!best) return true;
  if (candidate.meanPopulationDeltaVsBaseline !== best.meanPopulationDeltaVsBaseline) {
    return candidate.meanPopulationDeltaVsBaseline > best.meanPopulationDeltaVsBaseline;
  }
  if (candidate.worstPopulationDeltaVsBaseline !== best.worstPopulationDeltaVsBaseline) {
    return candidate.worstPopulationDeltaVsBaseline > best.worstPopulationDeltaVsBaseline;
  }
  return candidate.rankerFallbackRate < best.rankerFallbackRate;
}

function topThreshold(
  summaries: readonly LnsWindowRankerOnlineCalibrationThresholdSummary[],
  predicate: (summary: LnsWindowRankerOnlineCalibrationThresholdSummary) => boolean
): number | null {
  const best = summaries
    .filter(predicate)
    .reduce<LnsWindowRankerOnlineCalibrationThresholdSummary | null>(
      (currentBest, candidate) => (betterCalibrationSummary(candidate, currentBest) ? candidate : currentBest),
      null
    );
  return best?.minScoreDelta ?? null;
}

export function listLnsWindowRankerOnlineAblationCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_WINDOW_RANKER_ONLINE_ABLATION_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "LNS window ranker online ablation",
    corpusLabel: "LNS window ranker online ablation"
  });
}

export function runLnsWindowRankerOnlineAblation(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_WINDOW_RANKER_ONLINE_ABLATION_CORPUS,
  options: LnsWindowRankerOnlineAblationRunOptions
): LnsWindowRankerOnlineAblationSuiteResult {
  assertRuntimeModel(options.model);
  const rankerModel = modelWithFingerprint(options.model);
  const selected = selectOnlineAblationCases(corpus, options.names?.length ? options.names : undefined);
  const selectedCaseByName = new Map(selected.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const { seeds, seedRuns } = buildBenchmarkSeedRunPlan(options.seeds, "LNS window ranker online ablation seeds");
  const cases = seedRuns.flatMap((seed) => {
    const baselineSuite = runLnsBenchmarkSuite(selected, seededOptions(options, seed, baselineLnsOptions(options)));
    const rankerSuite = runLnsBenchmarkSuite(
      selected,
      seededOptions(options, seed, rankerLnsOptions(options, rankerModel))
    );

    return baselineSuite.results.map((baselineResult) => {
      const rankerResult = rankerSuite.results.find((entry) => entry.name === baselineResult.name);
      if (!rankerResult) {
        throw new Error(
          `LNS window ranker online ablation result missing: window-ranker/${baselineResult.name}/${seed ?? "case-default"}.`
        );
      }
      const benchmarkCase = selectedCaseByName.get(baselineResult.name);
      if (!benchmarkCase) {
        throw new Error(`LNS window ranker online ablation case metadata missing: ${baselineResult.name}.`);
      }
      const baselineVariant = variantResult("baseline", baselineResult, baselineResult, seed);
      const rankerVariant = variantResult("window-ranker", rankerResult, baselineResult, seed);
      return {
        name: baselineResult.name,
        description: baselineResult.description,
        pressureFamily: getLnsReplayPressureFamily(benchmarkCase),
        seed,
        gridRows: baselineResult.gridRows,
        gridCols: baselineResult.gridCols,
        gridCells: baselineResult.gridRows * baselineResult.gridCols,
        baseline: baselineVariant,
        variants: [baselineVariant, rankerVariant]
      };
    });
  });

  const selectedCaseNames = uniqueBenchmarkValuesBy(cases, (entry) => entry.name);
  return {
    ...buildBenchmarkSuiteMetadata(selectedCaseNames),
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    variants: [...ONLINE_ABLATION_VARIANTS],
    coverage: buildBenchmarkVariantCoverage(cases, selectedCaseNames.length, seedRuns.length),
    variantSummaries: ONLINE_ABLATION_VARIANTS.map((variant) =>
      buildVariantSummary(variant, cases, selectedCaseNames.length, seedRuns.length)
    ),
    cases
  };
}

export function createLnsWindowRankerOnlineAblationSnapshot(
  result: LnsWindowRankerOnlineAblationSuiteResult
): LnsWindowRankerOnlineAblationSnapshot {
  return {
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    variants: [...result.variants],
    coverage: { ...result.coverage },
    variantSummaries: result.variantSummaries.map(snapshotBenchmarkVariantSummary),
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baseline: snapshotBenchmarkVariantResult(benchmarkCase.baseline),
      variants: benchmarkCase.variants.map(snapshotBenchmarkVariantResult)
    }))
  };
}

export function runLnsWindowRankerOnlineCalibration(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_WINDOW_RANKER_ONLINE_ABLATION_CORPUS,
  options: LnsWindowRankerOnlineCalibrationRunOptions
): LnsWindowRankerOnlineCalibrationSuiteResult {
  const minScoreDeltas = normalizeMinScoreDeltas(options.minScoreDeltas);
  const suites = minScoreDeltas.map((minScoreDelta) =>
    runLnsWindowRankerOnlineAblation(corpus, {
      ...options,
      minScoreDelta
    })
  );
  const firstSuite = suites[0];
  if (!firstSuite) {
    throw new Error("LNS window ranker online calibration requires at least one threshold.");
  }
  const thresholdSummaries = suites.map((suite, index) => thresholdSummary(minScoreDeltas[index]!, suite));
  return {
    generatedAt: firstSuite.generatedAt,
    caseCount: firstSuite.caseCount,
    seedCount: firstSuite.seedCount,
    comparisonCount: firstSuite.comparisonCount,
    seeds: [...firstSuite.seeds],
    selectedCaseNames: [...firstSuite.selectedCaseNames],
    modelFingerprint: thresholdSummaries.find((entry) => entry.rankerDecisionCount > 0)
      ? (modelWithFingerprint(options.model).modelFingerprint ?? null)
      : null,
    ...(options.suppressionModel === undefined
      ? {}
      : { suppressionModelFingerprint: modelWithFingerprint(options.suppressionModel).modelFingerprint ?? null }),
    ...(options.suppressionModel === undefined
      ? {}
      : { suppressionMinScoreDelta: options.suppressionMinScoreDelta ?? 0 }),
    ...(options.allowedTransitions === undefined ? {} : { allowedTransitions: [...options.allowedTransitions] }),
    ...(options.selectedFeatureGates === undefined ? {} : { selectedFeatureGates: [...options.selectedFeatureGates] }),
    ...(options.selectedFeatureGateGroups === undefined
      ? {}
      : { selectedFeatureGateGroups: options.selectedFeatureGateGroups.map((group) => [...group]) }),
    ...(options.featureDeltaGates === undefined ? {} : { featureDeltaGates: [...options.featureDeltaGates] }),
    minScoreDeltas,
    topMeanPopulationDeltaMinScoreDelta: topThreshold(thresholdSummaries, () => true),
    topSafeMinScoreDelta: topThreshold(thresholdSummaries, (summary) => summary.safetyGatePassed),
    thresholdSummaries
  };
}

export function createLnsWindowRankerOnlineCalibrationSnapshot(
  result: LnsWindowRankerOnlineCalibrationSuiteResult
): LnsWindowRankerOnlineCalibrationSnapshot {
  return {
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    modelFingerprint: result.modelFingerprint,
    ...(result.suppressionModelFingerprint === undefined
      ? {}
      : { suppressionModelFingerprint: result.suppressionModelFingerprint }),
    ...(result.suppressionMinScoreDelta === undefined
      ? {}
      : { suppressionMinScoreDelta: result.suppressionMinScoreDelta }),
    ...(result.allowedTransitions === undefined ? {} : { allowedTransitions: [...result.allowedTransitions] }),
    ...(result.selectedFeatureGates === undefined ? {} : { selectedFeatureGates: [...result.selectedFeatureGates] }),
    ...(result.selectedFeatureGateGroups === undefined
      ? {}
      : { selectedFeatureGateGroups: result.selectedFeatureGateGroups.map((group) => [...group]) }),
    ...(result.featureDeltaGates === undefined ? {} : { featureDeltaGates: [...result.featureDeltaGates] }),
    minScoreDeltas: [...result.minScoreDeltas],
    topMeanPopulationDeltaMinScoreDelta: result.topMeanPopulationDeltaMinScoreDelta,
    topSafeMinScoreDelta: result.topSafeMinScoreDelta,
    thresholdSummaries: result.thresholdSummaries.map(
      ({
        meanWallClockDeltaVsBaselineSeconds: _meanWallClockDeltaVsBaselineSeconds,
        meanTimeToBestWallClockDeltaVsBaselineSeconds: _meanTimeToBestWallClockDeltaVsBaselineSeconds,
        ...summary
      }) => summary
    )
  };
}
