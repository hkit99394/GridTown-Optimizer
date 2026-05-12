import { uniqueBenchmarkValuesBy } from "./benchmarkOptions.js";
import { DEFAULT_LEARNED_RANKING_LABEL_SPLITS } from "./learnedRankingLabels.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import { assertValidLnsWindowRankerRuntimeModel } from "../core/index.js";

import type {
  LnsWindowRankerFeatureDeltaGate,
  LnsWindowRankerRuntimeModel,
  LnsWindowRankerSelectedFeatureGate,
  LnsWindowRankerSelectedFeatureGateGroup
} from "../core/index.js";
import type {
  LnsWindowRankerOnlineAblationSuiteResult,
  LnsWindowRankerOnlineCalibrationSuiteResult,
  LnsWindowRankerOnlineCalibrationThresholdSummary
} from "./lnsWindowRankerOnlineAblations.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";

const ONLINE_ABLATION_VARIANT_COUNT = 2;

export interface LnsWindowRankerOnlineAblationTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerOnlineAblationRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {
  modelPath?: string;
  suppressionModelPath?: string;
  protectedHoldout?: boolean;
  protectedCorpus?: LnsWindowRankerOnlineProtectedCorpus;
}

export interface LnsWindowRankerOnlineCalibrationTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {
  model: LnsWindowRankerRuntimeModel;
}

export interface LnsWindowRankerOnlineCalibrationRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {
  model: LnsWindowRankerRuntimeModel;
  modelPath?: string;
  suppressionModelPath?: string;
  protectedHoldout?: boolean;
  protectedCorpus?: LnsWindowRankerOnlineProtectedCorpus;
}

export type LnsWindowRankerOnlineProtectedCorpus =
  | "standard-protected-holdout"
  | "product-promotion-holdout"
  | "fresh-pressure-holdout";

function modelWithFingerprint(model: LnsWindowRankerRuntimeModel): LnsWindowRankerRuntimeModel {
  return {
    ...model,
    modelFingerprint: model.modelFingerprint ?? buildModelExperimentFingerprint(model)
  };
}

function assertRuntimeModel(
  model: LnsWindowRankerRuntimeModel | undefined
): asserts model is LnsWindowRankerRuntimeModel {
  assertValidLnsWindowRankerRuntimeModel(model, "LNS window ranker online artifact model");
}

function modelFromAblationResult(result: LnsWindowRankerOnlineAblationSuiteResult): LnsWindowRankerRuntimeModel {
  const model = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.lnsOptions.windowRanker?.model;
  assertRuntimeModel(model);
  return modelWithFingerprint(model);
}

function getRankerSummary(result: LnsWindowRankerOnlineAblationSuiteResult) {
  const summary = result.variantSummaries.find((entry) => entry.variantName === "window-ranker");
  if (!summary) {
    throw new Error("LNS window ranker online artifact missing window-ranker summary.");
  }
  return summary;
}

function getBaselineSummary(result: LnsWindowRankerOnlineAblationSuiteResult) {
  const summary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
  if (!summary) {
    throw new Error("LNS window ranker online artifact missing baseline summary.");
  }
  return summary;
}

function lnsWindowRankerOnlineCasesBySplit(
  selectedCaseNames: readonly string[],
  protectedHoldout: boolean
): Record<"development" | "holdout", string[]> {
  if (protectedHoldout) {
    return { development: [], holdout: [...selectedCaseNames] };
  }
  const selected = new Set(selectedCaseNames);
  const development =
    DEFAULT_LEARNED_RANKING_LABEL_SPLITS.find((split) => split.split === "development")?.lnsCaseNames.filter((name) =>
      selected.has(name)
    ) ?? [];
  const holdout =
    DEFAULT_LEARNED_RANKING_LABEL_SPLITS.find((split) => split.split === "holdout")?.lnsCaseNames.filter((name) =>
      selected.has(name)
    ) ?? [];
  if (development.length + holdout.length === 0) {
    return { development: [...selectedCaseNames], holdout: [] };
  }
  return { development, holdout };
}

function protectedCorpusMetadata(protectedHoldout: boolean, protectedCorpus?: LnsWindowRankerOnlineProtectedCorpus) {
  if (!protectedHoldout) {
    return {
      protectedCorpus: null,
      splitField: "DEFAULT_LEARNED_RANKING_LABEL_SPLITS.lnsCaseNames",
      leakage: "threshold-calibration-used-replay-pressure-corpus",
      notes:
        "Online LNS ranker A/B calibration scorecard over replay-pressure cases; not protected holdout promotion evidence."
    };
  }
  if (protectedCorpus === "product-promotion-holdout") {
    return {
      protectedCorpus,
      splitField: "DEFAULT_LNS_WINDOW_RANKER_ONLINE_PRODUCT_PROMOTION_CORPUS",
      leakage: "none",
      notes: "Online LNS ranker A/B scorecard over independent product-promotion protected holdout cases."
    };
  }
  if (protectedCorpus === "fresh-pressure-holdout") {
    return {
      protectedCorpus,
      splitField: "DEFAULT_LNS_WINDOW_RANKER_ONLINE_FRESH_PRESSURE_HOLDOUT_CORPUS",
      leakage: "none",
      notes: "Online LNS ranker A/B scorecard over fresh held-out pressure cases."
    };
  }
  return {
    protectedCorpus: protectedCorpus ?? "standard-protected-holdout",
    splitField: "DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS",
    leakage: "none",
    notes: "Online LNS ranker A/B scorecard over independent protected holdout cases."
  };
}

function lnsWindowRankerOnlineCaseFamilies(result: LnsWindowRankerOnlineAblationSuiteResult): string[] {
  return uniqueBenchmarkValuesBy(result.cases, (benchmarkCase) => `lns-${benchmarkCase.pressureFamily}`);
}

function lnsWindowRankerOnlineAblationSummaryMetrics(
  result: LnsWindowRankerOnlineAblationSuiteResult
): Record<string, unknown> {
  const baseline = getBaselineSummary(result);
  const ranker = getRankerSummary(result);
  const allowedTransitions = ablationAllowedTransitions(result);
  const suppressionModelFingerprint = ablationSuppressionModelFingerprint(result);
  const suppressionMinScoreDelta = ablationSuppressionMinScoreDelta(result);
  const selectedFeatureGates = ablationSelectedFeatureGates(result);
  const selectedFeatureGateGroups = ablationSelectedFeatureGateGroups(result);
  const featureDeltaGates = ablationFeatureDeltaGates(result);
  return {
    ...(allowedTransitions === null ? {} : { allowedTransitions: [...allowedTransitions] }),
    ...(suppressionModelFingerprint === null ? {} : { suppressionModelFingerprint }),
    ...(suppressionMinScoreDelta === null ? {} : { suppressionMinScoreDelta }),
    ...(selectedFeatureGates.length === 0 ? {} : { selectedFeatureGates: [...selectedFeatureGates] }),
    ...(selectedFeatureGateGroups.length === 0
      ? {}
      : { selectedFeatureGateGroups: selectedFeatureGateGroups.map((group) => [...group]) }),
    ...(featureDeltaGates.length === 0 ? {} : { featureDeltaGates: [...featureDeltaGates] }),
    baselineMeanPopulation: baseline.meanPopulation,
    rankerMeanPopulation: ranker.meanPopulation,
    meanPopulationDeltaVsBaseline: ranker.meanPopulationDeltaVsBaseline,
    medianPopulationDeltaVsBaseline: ranker.medianPopulationDeltaVsBaseline,
    worstDecilePopulationDeltaVsBaseline: ranker.worstDecilePopulationDeltaVsBaseline,
    bestPopulationDeltaVsBaseline: ranker.bestPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: ranker.worstPopulationDeltaVsBaseline,
    worstPopulationDeltaCaseName: ranker.worstPopulationDeltaCaseName,
    worstPopulationDeltaSeed: ranker.worstPopulationDeltaSeed,
    bestPopulationDeltaCaseName: ranker.bestPopulationDeltaCaseName,
    bestPopulationDeltaSeed: ranker.bestPopulationDeltaSeed,
    meanWallClockDeltaVsBaselineSeconds: ranker.meanWallClockDeltaVsBaselineSeconds,
    baselineMeanTimeToBestIteration: baseline.meanTimeToBestIteration,
    rankerMeanTimeToBestIteration: ranker.meanTimeToBestIteration,
    meanTimeToBestIterationDeltaVsBaseline: ranker.meanTimeToBestIterationDeltaVsBaseline,
    meanTimeToBestWallClockDeltaVsBaselineSeconds: ranker.meanTimeToBestWallClockDeltaVsBaselineSeconds,
    timeToBestWallClockKnownPairCount: ranker.timeToBestWallClockKnownPairCount,
    timeToBestWallClockUnknownPairCount: ranker.timeToBestWallClockUnknownPairCount,
    meanTimeToBestWallClockRatioVsBaseline: ranker.meanTimeToBestWallClockRatioVsBaseline,
    medianTimeToBestWallClockRatioVsBaseline: ranker.medianTimeToBestWallClockRatioVsBaseline,
    timeToBestWallClockFaster10PercentCount: ranker.timeToBestWallClockFaster10PercentCount,
    timeToBestWallClockSlower10PercentCount: ranker.timeToBestWallClockSlower10PercentCount,
    timeToBestWallClockFaster10PercentRate: ranker.timeToBestWallClockFaster10PercentRate,
    timeToBestWallClockSlower10PercentRate: ranker.timeToBestWallClockSlower10PercentRate,
    equalPopulationTimeToBestGatePassed: ranker.equalPopulationTimeToBestGatePassed,
    timeToBestPromotionGatePassed: ranker.timeToBestPromotionGatePassed,
    earlierTimeToBestCount: ranker.earlierTimeToBestCount,
    sameTimeToBestCount: ranker.sameTimeToBestCount,
    laterTimeToBestCount: ranker.laterTimeToBestCount,
    unknownTimeToBestCount: ranker.unknownTimeToBestCount,
    improvedCaseCount: ranker.improvedCaseCount,
    regressedCaseCount: ranker.regressedCaseCount,
    unchangedCaseCount: ranker.unchangedCaseCount,
    winRate: ranker.winRate,
    regressionRate: ranker.regressionRate,
    rankerDecisionCount: ranker.rankerDecisionCount,
    rankerOverrideCount: ranker.rankerOverrideCount,
    rankerFallbackDecisionCount: ranker.rankerFallbackDecisionCount,
    rankerOverrideRate: ranker.rankerOverrideRate,
    rankerFallbackRate: ranker.rankerFallbackRate,
    overrideOutcomeCount: ranker.overrideOutcomeCount,
    overrideImprovedOutcomeCount: ranker.overrideImprovedOutcomeCount,
    overrideNeutralOutcomeCount: ranker.overrideNeutralOutcomeCount,
    fallbackOutcomeCount: ranker.fallbackOutcomeCount,
    fallbackImprovedOutcomeCount: ranker.fallbackImprovedOutcomeCount,
    fallbackNeutralOutcomeCount: ranker.fallbackNeutralOutcomeCount,
    meanOverrideScoreDelta: ranker.meanOverrideScoreDelta,
    overrideFinalImprovedCaseCount: ranker.overrideFinalImprovedCaseCount,
    overrideFinalNeutralCaseCount: ranker.overrideFinalNeutralCaseCount,
    overrideFinalRegressedCaseCount: ranker.overrideFinalRegressedCaseCount,
    meanOverrideFinalPopulationDelta: ranker.meanOverrideFinalPopulationDelta,
    overrideChangedWindowCount: ranker.overrideChangedWindowCount,
    fallbackChangedWindowCount: ranker.fallbackChangedWindowCount,
    overrideFeatureDeltaCount: ranker.overrideFeatureDeltaCount,
    fallbackFeatureDeltaCount: ranker.fallbackFeatureDeltaCount,
    overrideMeanFeatureDeltas: ranker.overrideMeanFeatureDeltas,
    fallbackMeanFeatureDeltas: ranker.fallbackMeanFeatureDeltas,
    overrideTransitionFeatureDeltaCounts: ranker.overrideTransitionFeatureDeltaCounts,
    fallbackTransitionFeatureDeltaCounts: ranker.fallbackTransitionFeatureDeltaCounts,
    overrideTransitionMeanFeatureDeltas: ranker.overrideTransitionMeanFeatureDeltas,
    fallbackTransitionMeanFeatureDeltas: ranker.fallbackTransitionMeanFeatureDeltas,
    overrideTransitionCounts: ranker.overrideTransitionCounts,
    fallbackTransitionCounts: ranker.fallbackTransitionCounts,
    overrideFinalOutcomeFeatureDeltaCounts: ranker.overrideFinalOutcomeFeatureDeltaCounts,
    fallbackFinalOutcomeFeatureDeltaCounts: ranker.fallbackFinalOutcomeFeatureDeltaCounts,
    overrideFinalOutcomeMeanFeatureDeltas: ranker.overrideFinalOutcomeMeanFeatureDeltas,
    fallbackFinalOutcomeMeanFeatureDeltas: ranker.fallbackFinalOutcomeMeanFeatureDeltas,
    overrideImprovedVsNeutralMeanFeatureDeltaGaps: ranker.overrideImprovedVsNeutralMeanFeatureDeltaGaps,
    overrideRegressedVsNeutralMeanFeatureDeltaGaps: ranker.overrideRegressedVsNeutralMeanFeatureDeltaGaps,
    overrideTransitionFinalOutcomeCounts: ranker.overrideTransitionFinalOutcomeCounts,
    fallbackTransitionFinalOutcomeCounts: ranker.fallbackTransitionFinalOutcomeCounts,
    overrideTransitionPressureFamilyCounts: ranker.overrideTransitionPressureFamilyCounts,
    fallbackTransitionPressureFamilyCounts: ranker.fallbackTransitionPressureFamilyCounts,
    selectionTraceCount: ranker.selectionTraceCount,
    sameFinalLayoutCount: ranker.sameFinalLayoutCount,
    changedFinalLayoutCount: ranker.changedFinalLayoutCount,
    meanFinalLayoutPlacementDelta: ranker.meanFinalLayoutPlacementDelta,
    safetyGatePassed: ranker.regressedCaseCount === 0 && ranker.worstPopulationDeltaVsBaseline >= 0
  };
}

function ablationMinScoreDelta(result: LnsWindowRankerOnlineAblationSuiteResult): number | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.minScoreDelta ?? null
  );
}

function ablationSuppressionModelFingerprint(result: LnsWindowRankerOnlineAblationSuiteResult): string | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.suppressionModelFingerprint ?? null
  );
}

function ablationSuppressionMinScoreDelta(result: LnsWindowRankerOnlineAblationSuiteResult): number | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.suppressionMinScoreDelta ?? null
  );
}

function ablationAllowedTransitions(result: LnsWindowRankerOnlineAblationSuiteResult): readonly string[] | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.allowedTransitions ?? null
  );
}

function ablationFeatureDeltaGates(
  result: LnsWindowRankerOnlineAblationSuiteResult
): readonly LnsWindowRankerFeatureDeltaGate[] {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.featureDeltaGates ?? []
  );
}

function ablationSelectedFeatureGates(
  result: LnsWindowRankerOnlineAblationSuiteResult
): readonly LnsWindowRankerSelectedFeatureGate[] {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.selectedFeatureGates ?? []
  );
}

function ablationSelectedFeatureGateGroups(
  result: LnsWindowRankerOnlineAblationSuiteResult
): readonly LnsWindowRankerSelectedFeatureGateGroup[] {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.selectedFeatureGateGroups ?? []
  );
}

function calibrationThresholdByDelta(
  result: LnsWindowRankerOnlineCalibrationSuiteResult,
  minScoreDelta: number | null
): LnsWindowRankerOnlineCalibrationThresholdSummary | null {
  return minScoreDelta === null
    ? null
    : (result.thresholdSummaries.find((entry) => entry.minScoreDelta === minScoreDelta) ?? null);
}

function lnsWindowRankerOnlineCalibrationSummaryMetrics(
  result: LnsWindowRankerOnlineCalibrationSuiteResult
): Record<string, unknown> {
  const topMeanSummary = calibrationThresholdByDelta(result, result.topMeanPopulationDeltaMinScoreDelta);
  const topSafeSummary = calibrationThresholdByDelta(result, result.topSafeMinScoreDelta);
  return {
    ...(result.allowedTransitions === undefined ? {} : { allowedTransitions: [...result.allowedTransitions] }),
    ...(result.suppressionModelFingerprint === undefined || result.suppressionModelFingerprint === null
      ? {}
      : { suppressionModelFingerprint: result.suppressionModelFingerprint }),
    ...(result.suppressionMinScoreDelta === undefined
      ? {}
      : { suppressionMinScoreDelta: result.suppressionMinScoreDelta }),
    ...(result.selectedFeatureGates === undefined ? {} : { selectedFeatureGates: [...result.selectedFeatureGates] }),
    ...(result.selectedFeatureGateGroups === undefined
      ? {}
      : { selectedFeatureGateGroups: result.selectedFeatureGateGroups.map((group) => [...group]) }),
    ...(result.featureDeltaGates === undefined ? {} : { featureDeltaGates: [...result.featureDeltaGates] }),
    thresholdCount: result.minScoreDeltas.length,
    minScoreDeltas: [...result.minScoreDeltas],
    topMeanPopulationDeltaMinScoreDelta: result.topMeanPopulationDeltaMinScoreDelta,
    topMeanPopulationDeltaVsBaseline: topMeanSummary?.meanPopulationDeltaVsBaseline ?? null,
    topMeanWorstPopulationDeltaVsBaseline: topMeanSummary?.worstPopulationDeltaVsBaseline ?? null,
    topSafeMinScoreDelta: result.topSafeMinScoreDelta,
    topSafeMeanPopulationDeltaVsBaseline: topSafeSummary?.meanPopulationDeltaVsBaseline ?? null,
    topSafeWorstPopulationDeltaVsBaseline: topSafeSummary?.worstPopulationDeltaVsBaseline ?? null,
    topMeanTimeToBestIterationDeltaVsBaseline: topMeanSummary?.meanTimeToBestIterationDeltaVsBaseline ?? null,
    topSafeTimeToBestIterationDeltaVsBaseline: topSafeSummary?.meanTimeToBestIterationDeltaVsBaseline ?? null,
    topMeanTimeToBestWallClockDeltaVsBaselineSeconds:
      topMeanSummary?.meanTimeToBestWallClockDeltaVsBaselineSeconds ?? null,
    topSafeTimeToBestWallClockDeltaVsBaselineSeconds:
      topSafeSummary?.meanTimeToBestWallClockDeltaVsBaselineSeconds ?? null,
    topMeanTimeToBestWallClockRatioVsBaseline: topMeanSummary?.meanTimeToBestWallClockRatioVsBaseline ?? null,
    topSafeTimeToBestWallClockRatioVsBaseline: topSafeSummary?.meanTimeToBestWallClockRatioVsBaseline ?? null,
    topMeanMedianTimeToBestWallClockRatioVsBaseline: topMeanSummary?.medianTimeToBestWallClockRatioVsBaseline ?? null,
    topSafeMedianTimeToBestWallClockRatioVsBaseline: topSafeSummary?.medianTimeToBestWallClockRatioVsBaseline ?? null,
    timeToBestPromotionThresholdCount: result.thresholdSummaries.filter((entry) => entry.timeToBestPromotionGatePassed)
      .length,
    safeThresholdCount: result.thresholdSummaries.filter((entry) => entry.safetyGatePassed).length,
    thresholdSummaries: result.thresholdSummaries.map((entry) => ({ ...entry }))
  };
}

export function buildLnsWindowRankerOnlineAblationTelemetryManifest(
  result: LnsWindowRankerOnlineAblationSuiteResult,
  options: LnsWindowRankerOnlineAblationTelemetryManifestOptions
): ReturnType<typeof buildModelExperimentTelemetryManifest> {
  const model = modelFromAblationResult(result) as unknown as Record<string, unknown>;
  return buildModelExperimentTelemetryManifest({
    ...options,
    generatedAt: result.generatedAt,
    model,
    modelFingerprint: model.modelFingerprint as string,
    metrics: lnsWindowRankerOnlineAblationSummaryMetrics(result)
  });
}

export function buildLnsWindowRankerOnlineAblationRegistryEntryDraft(
  result: LnsWindowRankerOnlineAblationSuiteResult,
  options: LnsWindowRankerOnlineAblationRegistryEntryDraftOptions
): Record<string, unknown> {
  const model = modelFromAblationResult(result) as unknown as Record<string, unknown>;
  const modelFingerprint = model.modelFingerprint as string;
  const minScoreDelta = ablationMinScoreDelta(result);
  const suppressionModelFingerprint = ablationSuppressionModelFingerprint(result);
  const suppressionMinScoreDelta = ablationSuppressionMinScoreDelta(result);
  const allowedTransitions = ablationAllowedTransitions(result);
  const selectedFeatureGates = ablationSelectedFeatureGates(result);
  const selectedFeatureGateGroups = ablationSelectedFeatureGateGroups(result);
  const featureDeltaGates = ablationFeatureDeltaGates(result);
  const protectedHoldout = options.protectedHoldout ?? false;
  const protectedCorpus = protectedCorpusMetadata(protectedHoldout, options.protectedCorpus);
  const cases = lnsWindowRankerOnlineCasesBySplit(result.selectedCaseNames, protectedHoldout);
  const summaryMetrics = lnsWindowRankerOnlineAblationSummaryMetrics(result);
  return buildModelExperimentRegistryEntryDraft({
    runId: options.runId ?? `lns-window-ranker-online-ablation-${result.generatedAt.slice(0, 10)}`,
    commands: options.commands,
    artifactPaths: options.artifactPaths,
    generatedAt: result.generatedAt,
    cases,
    caseFamilies: lnsWindowRankerOnlineCaseFamilies(result),
    seeds: result.seeds,
    splitStatus: {
      protectedHoldout,
      ...(protectedCorpus.protectedCorpus === null ? {} : { protectedCorpus: protectedCorpus.protectedCorpus }),
      splitField: protectedCorpus.splitField,
      developmentCaseCount: cases.development.length,
      holdoutCaseCount: cases.holdout.length,
      leakage: protectedCorpus.leakage,
      notes: protectedCorpus.notes
    },
    budget: {
      minScoreDelta,
      ...(suppressionMinScoreDelta === null ? {} : { suppressionMinScoreDelta }),
      ...(allowedTransitions === null ? {} : { allowedTransitionCount: allowedTransitions.length }),
      ...(selectedFeatureGates.length === 0 ? {} : { selectedFeatureGateCount: selectedFeatureGates.length }),
      ...(selectedFeatureGateGroups.length === 0
        ? {}
        : { selectedFeatureGateGroupCount: selectedFeatureGateGroups.length }),
      ...(featureDeltaGates.length === 0 ? {} : { featureDeltaGateCount: featureDeltaGates.length }),
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      comparisonCount: result.comparisonCount,
      variantCount: result.variants.length,
      totalRuns: result.coverage.runCount,
      rankerDecisionCount: summaryMetrics.rankerDecisionCount,
      rankerOverrideCount: summaryMetrics.rankerOverrideCount,
      rankerFallbackDecisionCount: summaryMetrics.rankerFallbackDecisionCount,
      selectionTraceCount: summaryMetrics.selectionTraceCount,
      changedFinalLayoutCount: summaryMetrics.changedFinalLayoutCount,
      meanFinalLayoutPlacementDelta: summaryMetrics.meanFinalLayoutPlacementDelta,
      overrideImprovedOutcomeCount: summaryMetrics.overrideImprovedOutcomeCount,
      overrideNeutralOutcomeCount: summaryMetrics.overrideNeutralOutcomeCount,
      overrideFinalImprovedCaseCount: summaryMetrics.overrideFinalImprovedCaseCount,
      overrideFinalNeutralCaseCount: summaryMetrics.overrideFinalNeutralCaseCount,
      overrideFinalRegressedCaseCount: summaryMetrics.overrideFinalRegressedCaseCount,
      timeToBestWallClockKnownPairCount: summaryMetrics.timeToBestWallClockKnownPairCount,
      timeToBestWallClockUnknownPairCount: summaryMetrics.timeToBestWallClockUnknownPairCount,
      meanTimeToBestWallClockRatioVsBaseline: summaryMetrics.meanTimeToBestWallClockRatioVsBaseline,
      medianTimeToBestWallClockRatioVsBaseline: summaryMetrics.medianTimeToBestWallClockRatioVsBaseline,
      timeToBestWallClockFaster10PercentCount: summaryMetrics.timeToBestWallClockFaster10PercentCount,
      timeToBestWallClockSlower10PercentCount: summaryMetrics.timeToBestWallClockSlower10PercentCount,
      earlierTimeToBestCount: summaryMetrics.earlierTimeToBestCount,
      sameTimeToBestCount: summaryMetrics.sameTimeToBestCount,
      laterTimeToBestCount: summaryMetrics.laterTimeToBestCount,
      unknownTimeToBestCount: summaryMetrics.unknownTimeToBestCount
    },
    model: {
      ...model,
      ...(options.modelPath === undefined ? {} : { modelPath: options.modelPath }),
      ...(suppressionModelFingerprint === null ? {} : { suppressionModelFingerprint }),
      ...(options.suppressionModelPath === undefined ? {} : { suppressionModelPath: options.suppressionModelPath })
    },
    decision: options.decision ?? "online-lns-window-ranker-calibration-evidence",
    summary:
      options.summary ??
      `Online LNS window-ranker A/B scorecard at minScoreDelta=${minScoreDelta ?? "n/a"}; no solver default changed.`,
    modelFingerprint,
    summaryMetrics
  });
}

export function buildLnsWindowRankerOnlineCalibrationTelemetryManifest(
  result: LnsWindowRankerOnlineCalibrationSuiteResult,
  options: LnsWindowRankerOnlineCalibrationTelemetryManifestOptions
): ReturnType<typeof buildModelExperimentTelemetryManifest> {
  assertRuntimeModel(options.model);
  const model = modelWithFingerprint(options.model) as unknown as Record<string, unknown>;
  return buildModelExperimentTelemetryManifest({
    ...options,
    generatedAt: result.generatedAt,
    model,
    modelFingerprint: model.modelFingerprint as string,
    metrics: lnsWindowRankerOnlineCalibrationSummaryMetrics(result)
  });
}

export function buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft(
  result: LnsWindowRankerOnlineCalibrationSuiteResult,
  options: LnsWindowRankerOnlineCalibrationRegistryEntryDraftOptions
): Record<string, unknown> {
  assertRuntimeModel(options.model);
  const model = modelWithFingerprint(options.model) as unknown as Record<string, unknown>;
  const modelFingerprint = model.modelFingerprint as string;
  const protectedHoldout = options.protectedHoldout ?? false;
  const protectedCorpus = protectedCorpusMetadata(protectedHoldout, options.protectedCorpus);
  const cases = lnsWindowRankerOnlineCasesBySplit(result.selectedCaseNames, protectedHoldout);
  const summaryMetrics = lnsWindowRankerOnlineCalibrationSummaryMetrics(result);
  return buildModelExperimentRegistryEntryDraft({
    runId: options.runId ?? `lns-window-ranker-online-threshold-sweep-${result.generatedAt.slice(0, 10)}`,
    commands: options.commands,
    artifactPaths: options.artifactPaths,
    generatedAt: result.generatedAt,
    cases,
    caseFamilies: null,
    seeds: result.seeds,
    splitStatus: {
      protectedHoldout,
      ...(protectedCorpus.protectedCorpus === null ? {} : { protectedCorpus: protectedCorpus.protectedCorpus }),
      splitField: protectedCorpus.splitField,
      developmentCaseCount: cases.development.length,
      holdoutCaseCount: cases.holdout.length,
      leakage: protectedCorpus.leakage,
      notes:
        protectedCorpus.protectedCorpus === "product-promotion-holdout"
          ? "Online LNS ranker threshold sweep over independent product-promotion protected holdout cases."
          : protectedCorpus.notes.replace("A/B scorecard", "threshold sweep")
    },
    budget: {
      ...(result.allowedTransitions === undefined ? {} : { allowedTransitionCount: result.allowedTransitions.length }),
      ...(result.suppressionMinScoreDelta === undefined
        ? {}
        : { suppressionMinScoreDelta: result.suppressionMinScoreDelta }),
      ...(result.selectedFeatureGates === undefined
        ? {}
        : { selectedFeatureGateCount: result.selectedFeatureGates.length }),
      ...(result.selectedFeatureGateGroups === undefined
        ? {}
        : { selectedFeatureGateGroupCount: result.selectedFeatureGateGroups.length }),
      ...(result.featureDeltaGates === undefined ? {} : { featureDeltaGateCount: result.featureDeltaGates.length }),
      minScoreDeltas: [...result.minScoreDeltas],
      thresholdCount: result.minScoreDeltas.length,
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      comparisonCountPerThreshold: result.comparisonCount,
      totalComparisons: result.comparisonCount * result.minScoreDeltas.length,
      variantCount: ONLINE_ABLATION_VARIANT_COUNT,
      totalRuns: result.comparisonCount * result.minScoreDeltas.length * ONLINE_ABLATION_VARIANT_COUNT
    },
    model: {
      ...model,
      ...(options.modelPath === undefined ? {} : { modelPath: options.modelPath }),
      ...(result.suppressionModelFingerprint === undefined || result.suppressionModelFingerprint === null
        ? {}
        : { suppressionModelFingerprint: result.suppressionModelFingerprint }),
      ...(options.suppressionModelPath === undefined ? {} : { suppressionModelPath: options.suppressionModelPath })
    },
    decision: options.decision ?? "online-lns-window-ranker-threshold-sweep-evidence",
    summary:
      options.summary ??
      `Online LNS window-ranker threshold sweep over ${result.minScoreDeltas.length} minScoreDelta values; no solver default changed.`,
    modelFingerprint,
    summaryMetrics
  });
}
