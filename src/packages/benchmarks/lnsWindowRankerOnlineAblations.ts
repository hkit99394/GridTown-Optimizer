import { buildBenchmarkSeedRunPlan } from "./benchmarkSeeds.js";
import {
  benchmarkRatio,
  buildBenchmarkSuiteMetadata,
  buildBenchmarkVariantCoverage,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName,
  snapshotBenchmarkVariantResult,
  snapshotBenchmarkVariantSummary,
  sumBenchmarkBy,
  summarizeBenchmarkVariantMetrics,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, getLnsReplayPressureFamily, runLnsBenchmarkSuite } from "./lns.js";
import { GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES } from "./lnsPressureCases.js";
import { buildModelExperimentFingerprint } from "./modelExperimentArtifacts.js";
import * as finalOutcomes from "./lnsWindowRankerOnlineFinalOutcomes.js";
import {
  buildLnsWindowRankerOnlineSelectionDiagnostics,
  buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics,
  mergeLnsWindowRankerOnlineSelectionDiagnostics
} from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

import type { LnsOptions, LnsWindowRankerRuntimeModel } from "../core/index.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot
} from "./benchmarkOptions.js";
import type { LnsBenchmarkCase, LnsBenchmarkCaseResult, LnsBenchmarkRunOptions } from "./lns.js";
import type {
  LnsWindowRankerOnlineSelectionDiagnostics,
  LnsWindowRankerOnlineTransitionStatusCounts
} from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

export type LnsWindowRankerOnlineAblationVariantName = "baseline" | "window-ranker";

export interface LnsWindowRankerOnlineAblationRunOptions extends LnsBenchmarkRunOptions {
  model: LnsWindowRankerRuntimeModel;
  minScoreDelta?: number;
  seeds?: readonly number[];
}

export interface LnsWindowRankerOnlineAblationTelemetrySummary {
  enabled: boolean;
  modelFingerprint: string | null;
  featureSchemaVersion: number | null;
  minScoreDelta: number | null;
  decisions: number;
  overrides: number;
  fallbackDecisions: number;
  overrideRate: number;
  fallbackRate: number;
}

export interface LnsWindowRankerOnlineAblationVariantResult {
  variantName: LnsWindowRankerOnlineAblationVariantName;
  description: string;
  seed: number | null;
  totalPopulation: number;
  populationDeltaVsBaseline: number;
  wallClockSeconds: number;
  wallClockDeltaVsBaselineSeconds: number;
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
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
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
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
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
  minScoreDeltas: number[];
  topMeanPopulationDeltaMinScoreDelta: number | null;
  topSafeMinScoreDelta: number | null;
  thresholdSummaries: LnsWindowRankerOnlineCalibrationThresholdSummary[];
}

export interface LnsWindowRankerOnlineCalibrationThresholdSnapshot extends Omit<
  LnsWindowRankerOnlineCalibrationThresholdSummary,
  "meanWallClockDeltaVsBaselineSeconds"
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

const VARIANT_DESCRIPTIONS: Record<LnsWindowRankerOnlineAblationVariantName, string> = {
  baseline: "Existing deterministic adaptive LNS window selector.",
  "window-ranker": "Opt-in learned LNS window scorer using the supplied offline ranker model."
};

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_ABLATION_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  ...DEFAULT_LNS_REPLAY_LABEL_CORPUS
]);

export const DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  ...GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES
]);

export const DEFAULT_LNS_WINDOW_RANKER_MIN_SCORE_DELTA_SWEEP: readonly number[] = Object.freeze([
  0, 0.05, 0.1, 0.15, 0.2
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRuntimeModel(
  model: LnsWindowRankerRuntimeModel | undefined
): asserts model is LnsWindowRankerRuntimeModel {
  if (!isRecord(model) || !isRecord(model.weights)) {
    throw new Error("LNS window ranker online ablation requires a runtime model with a weights object.");
  }
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
      ...(options.minScoreDelta === undefined ? {} : { minScoreDelta: options.minScoreDelta })
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

function summarizeWindowRanker(result: LnsBenchmarkCaseResult): LnsWindowRankerOnlineAblationTelemetrySummary | null {
  const ranker = result.lnsTelemetry?.windowRanker;
  if (!ranker) return null;
  return {
    enabled: ranker.enabled,
    modelFingerprint: ranker.modelFingerprint ?? null,
    featureSchemaVersion: ranker.featureSchemaVersion ?? null,
    minScoreDelta: ranker.minScoreDelta,
    decisions: ranker.decisions,
    overrides: ranker.overrides,
    fallbackDecisions: ranker.fallbackDecisions,
    overrideRate: benchmarkRatio(ranker.overrides, ranker.decisions),
    fallbackRate: benchmarkRatio(ranker.fallbackDecisions, ranker.decisions)
  };
}

function overrideOutcomeCount(result: LnsBenchmarkCaseResult): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.selectedByBaseline === false ? 1 : 0
  );
}

function fallbackOutcomeCount(result: LnsBenchmarkCaseResult): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.fallbackReason ? 1 : 0
  );
}

function overrideOutcomeStatusCount(result: LnsBenchmarkCaseResult, status: "improved" | "neutral"): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.selectedByBaseline === false && outcome.status === status ? 1 : 0
  );
}

function fallbackOutcomeStatusCount(result: LnsBenchmarkCaseResult, status: "improved" | "neutral"): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.fallbackReason && outcome.status === status ? 1 : 0
  );
}

function meanOverrideScoreDelta(result: LnsBenchmarkCaseResult): number | null {
  const deltas = (result.lnsTelemetry?.outcomes ?? [])
    .filter((outcome) => outcome.windowRankerSelection?.selectedByBaseline === false)
    .map((outcome) => outcome.windowRankerSelection?.scoreDelta)
    .filter((delta): delta is number => delta !== undefined);
  return deltas.length ? sumBenchmarkBy(deltas, (delta) => delta) / deltas.length : null;
}

function variantResult(
  variantName: LnsWindowRankerOnlineAblationVariantName,
  result: LnsBenchmarkCaseResult,
  baseline: LnsBenchmarkCaseResult,
  seed: number | null
): LnsWindowRankerOnlineAblationVariantResult {
  const populationDeltaVsBaseline = result.totalPopulation - baseline.totalPopulation;
  const overrides = overrideOutcomeCount(result);
  const fallbacks = fallbackOutcomeCount(result);
  return {
    variantName,
    description: VARIANT_DESCRIPTIONS[variantName],
    seed,
    totalPopulation: result.totalPopulation,
    populationDeltaVsBaseline,
    wallClockSeconds: result.wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: result.wallClockSeconds - baseline.wallClockSeconds,
    roadCount: result.roadCount,
    roadDeltaVsBaseline: result.roadCount - baseline.roadCount,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    lnsOptions: result.lnsOptions,
    cpSatStatus: result.cpSatStatus,
    stopReason: result.lnsTelemetry?.stopReason ?? null,
    improvingIterations: result.lnsTelemetry?.improvingIterations ?? null,
    neutralIterations: result.lnsTelemetry?.neutralIterations ?? null,
    recoverableFailures: result.lnsTelemetry?.recoverableFailures ?? null,
    overrideOutcomeCount: overrides,
    fallbackOutcomeCount: fallbacks,
    overrideImprovedOutcomeCount: overrideOutcomeStatusCount(result, "improved"),
    overrideNeutralOutcomeCount: overrideOutcomeStatusCount(result, "neutral"),
    fallbackImprovedOutcomeCount: fallbackOutcomeStatusCount(result, "improved"),
    fallbackNeutralOutcomeCount: fallbackOutcomeStatusCount(result, "neutral"),
    meanOverrideScoreDelta: meanOverrideScoreDelta(result),
    selectionDiagnostics: buildLnsWindowRankerOnlineSelectionDiagnostics(result),
    finalOutcome: finalOutcomes.buildLnsWindowRankerFinalOutcome(populationDeltaVsBaseline, overrides, fallbacks),
    windowRanker: summarizeWindowRanker(result)
  };
}

function buildVariantSummary(
  variantName: LnsWindowRankerOnlineAblationVariantName,
  cases: readonly LnsWindowRankerOnlineAblationCaseResult[],
  caseCount: number,
  seedCount: number
): LnsWindowRankerOnlineAblationSummary {
  const missingResultMessage = `LNS window ranker online ablation result missing: ${variantName}.`;
  const caseResults = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variantName);
    if (!result) {
      throw new Error(missingResultMessage);
    }
    return { benchmarkCase: entry, result };
  });
  const results = caseResults.map((entry) => entry.result);
  const decisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.decisions ?? 0);
  const overrideCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.overrides ?? 0);
  const fallbackDecisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.fallbackDecisions ?? 0);
  const overrideOutcomeCount = sumBenchmarkBy(results, (entry) => entry.overrideOutcomeCount);
  const overrideScoreDeltaWeightedSum = sumBenchmarkBy(
    results,
    (entry) => (entry.meanOverrideScoreDelta ?? 0) * entry.overrideOutcomeCount
  );
  const diagnostics = results
    .map((entry) => entry.selectionDiagnostics)
    .filter((entry): entry is LnsWindowRankerOnlineSelectionDiagnostics => entry !== null);
  const mergedDiagnostics = mergeLnsWindowRankerOnlineSelectionDiagnostics(diagnostics);
  const transitionOutcomeDiagnostics = buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics(
    caseResults.map(({ benchmarkCase, result }) => ({
      pressureFamily: benchmarkCase.pressureFamily,
      finalOutcomeStatus: result.finalOutcome.status,
      selectionDiagnostics: result.selectionDiagnostics
    }))
  );
  return {
    ...summarizeBenchmarkVariantMetrics(variantName, cases, caseCount, seedCount, missingResultMessage),
    description: VARIANT_DESCRIPTIONS[variantName],
    rankerDecisionCount: decisionCount,
    rankerOverrideCount: overrideCount,
    rankerFallbackDecisionCount: fallbackDecisionCount,
    rankerOverrideRate: benchmarkRatio(overrideCount, decisionCount),
    rankerFallbackRate: benchmarkRatio(fallbackDecisionCount, decisionCount),
    overrideOutcomeCount,
    fallbackOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackOutcomeCount),
    overrideImprovedOutcomeCount: sumBenchmarkBy(results, (entry) => entry.overrideImprovedOutcomeCount),
    overrideNeutralOutcomeCount: sumBenchmarkBy(results, (entry) => entry.overrideNeutralOutcomeCount),
    fallbackImprovedOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackImprovedOutcomeCount),
    fallbackNeutralOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackNeutralOutcomeCount),
    meanOverrideScoreDelta: overrideOutcomeCount > 0 ? overrideScoreDeltaWeightedSum / overrideOutcomeCount : null,
    overrideTransitionCounts: mergedDiagnostics.overrideTransitionCounts,
    fallbackTransitionCounts: mergedDiagnostics.fallbackTransitionCounts,
    overrideChangedWindowCount: mergedDiagnostics.overrideChangedWindowCount,
    fallbackChangedWindowCount: mergedDiagnostics.fallbackChangedWindowCount,
    overrideTransitionFinalOutcomeCounts: transitionOutcomeDiagnostics.overrideTransitionFinalOutcomeCounts,
    fallbackTransitionFinalOutcomeCounts: transitionOutcomeDiagnostics.fallbackTransitionFinalOutcomeCounts,
    overrideTransitionPressureFamilyCounts: transitionOutcomeDiagnostics.overrideTransitionPressureFamilyCounts,
    fallbackTransitionPressureFamilyCounts: transitionOutcomeDiagnostics.fallbackTransitionPressureFamilyCounts,
    ...finalOutcomes.summarizeLnsWindowRankerFinalOutcomes(results)
  };
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
    overrideTransitionFinalOutcomeCounts: summary.overrideTransitionFinalOutcomeCounts,
    fallbackTransitionFinalOutcomeCounts: summary.fallbackTransitionFinalOutcomeCounts,
    overrideTransitionPressureFamilyCounts: summary.overrideTransitionPressureFamilyCounts,
    fallbackTransitionPressureFamilyCounts: summary.fallbackTransitionPressureFamilyCounts,
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
    minScoreDeltas: [...result.minScoreDeltas],
    topMeanPopulationDeltaMinScoreDelta: result.topMeanPopulationDeltaMinScoreDelta,
    topSafeMinScoreDelta: result.topSafeMinScoreDelta,
    thresholdSummaries: result.thresholdSummaries.map(
      ({ meanWallClockDeltaVsBaselineSeconds: _meanWallClockDeltaVsBaselineSeconds, ...summary }) => summary
    )
  };
}
