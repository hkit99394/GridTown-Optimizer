import { buildBenchmarkSeedRunPlan, formatBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  benchmarkRatio,
  buildBenchmarkSuiteMetadata,
  buildBenchmarkVariantCoverage,
  formatBenchmarkDecimal as formatDecimal,
  formatBenchmarkRate as formatRate,
  formatBenchmarkSeconds as formatSeconds,
  formatBenchmarkSeedCase as formatSeedCase,
  formatBenchmarkSignedNumber as formatSigned,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName,
  snapshotBenchmarkVariantResult,
  snapshotBenchmarkVariantSummary,
  sumBenchmarkBy,
  summarizeBenchmarkVariantMetrics,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, getLnsReplayPressureFamily, runLnsBenchmarkSuite } from "./lns.js";
import { DEFAULT_LEARNED_RANKING_LABEL_SPLITS } from "./learnedRankingLabels.js";
import { GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES } from "./lnsPressureCases.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";

import type { LnsOptions, LnsWindowRankerRuntimeModel } from "../core/index.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot
} from "./benchmarkOptions.js";
import type { LnsBenchmarkCase, LnsBenchmarkCaseResult, LnsBenchmarkRunOptions } from "./lns.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";

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

export interface LnsWindowRankerOnlineAblationSummary extends BenchmarkVariantSummaryMetrics<LnsWindowRankerOnlineAblationVariantName> {
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

export interface LnsWindowRankerOnlineAblationTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerOnlineAblationRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {
  modelPath?: string;
  protectedHoldout?: boolean;
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

function modelFromAblationResult(result: LnsWindowRankerOnlineAblationSuiteResult): LnsWindowRankerRuntimeModel {
  const model = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.lnsOptions.windowRanker?.model;
  assertRuntimeModel(model);
  return modelWithFingerprint(model);
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
  return {
    variantName,
    description: VARIANT_DESCRIPTIONS[variantName],
    seed,
    totalPopulation: result.totalPopulation,
    populationDeltaVsBaseline: result.totalPopulation - baseline.totalPopulation,
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
    overrideOutcomeCount: overrideOutcomeCount(result),
    fallbackOutcomeCount: fallbackOutcomeCount(result),
    overrideImprovedOutcomeCount: overrideOutcomeStatusCount(result, "improved"),
    overrideNeutralOutcomeCount: overrideOutcomeStatusCount(result, "neutral"),
    fallbackImprovedOutcomeCount: fallbackOutcomeStatusCount(result, "improved"),
    fallbackNeutralOutcomeCount: fallbackOutcomeStatusCount(result, "neutral"),
    meanOverrideScoreDelta: meanOverrideScoreDelta(result),
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
  const results = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variantName);
    if (!result) {
      throw new Error(missingResultMessage);
    }
    return result;
  });
  const decisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.decisions ?? 0);
  const overrideCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.overrides ?? 0);
  const fallbackDecisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.fallbackDecisions ?? 0);
  const overrideOutcomeCount = sumBenchmarkBy(results, (entry) => entry.overrideOutcomeCount);
  const overrideScoreDeltaWeightedSum = sumBenchmarkBy(
    results,
    (entry) => (entry.meanOverrideScoreDelta ?? 0) * entry.overrideOutcomeCount
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
    meanOverrideScoreDelta: overrideOutcomeCount > 0 ? overrideScoreDeltaWeightedSum / overrideOutcomeCount : null
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

function getBaselineSummary(result: LnsWindowRankerOnlineAblationSuiteResult): LnsWindowRankerOnlineAblationSummary {
  const summary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
  if (!summary) {
    throw new Error("LNS window ranker online ablation result missing baseline summary.");
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

function lnsWindowRankerOnlineCaseFamilies(cases: readonly LnsWindowRankerOnlineAblationCaseResult[]): string[] {
  return uniqueBenchmarkValuesBy(cases, (benchmarkCase) => `lns-${benchmarkCase.pressureFamily}`);
}

function lnsWindowRankerOnlineAblationSummaryMetrics(
  result: LnsWindowRankerOnlineAblationSuiteResult
): Record<string, unknown> {
  const baseline = getBaselineSummary(result);
  const ranker = getRankerSummary(result);
  return {
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
    safetyGatePassed: ranker.regressedCaseCount === 0 && ranker.worstPopulationDeltaVsBaseline >= 0
  };
}

function ablationMinScoreDelta(result: LnsWindowRankerOnlineAblationSuiteResult): number | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.minScoreDelta ?? null
  );
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
  const protectedHoldout = options.protectedHoldout ?? false;
  const cases = lnsWindowRankerOnlineCasesBySplit(result.selectedCaseNames, protectedHoldout);
  const summaryMetrics = lnsWindowRankerOnlineAblationSummaryMetrics(result);
  return buildModelExperimentRegistryEntryDraft({
    runId: options.runId ?? `lns-window-ranker-online-ablation-${result.generatedAt.slice(0, 10)}`,
    commands: options.commands,
    artifactPaths: options.artifactPaths,
    generatedAt: result.generatedAt,
    cases,
    caseFamilies: lnsWindowRankerOnlineCaseFamilies(result.cases),
    seeds: result.seeds,
    splitStatus: {
      protectedHoldout,
      splitField: protectedHoldout
        ? "DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS"
        : "DEFAULT_LEARNED_RANKING_LABEL_SPLITS.lnsCaseNames",
      developmentCaseCount: cases.development.length,
      holdoutCaseCount: cases.holdout.length,
      leakage: protectedHoldout ? "none" : "threshold-calibration-used-replay-pressure-corpus",
      notes: protectedHoldout
        ? "Online LNS ranker A/B scorecard over independent protected holdout cases."
        : "Online LNS ranker A/B calibration scorecard over replay-pressure cases; not protected holdout promotion evidence."
    },
    budget: {
      minScoreDelta,
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      comparisonCount: result.comparisonCount,
      variantCount: result.variants.length,
      totalRuns: result.coverage.runCount,
      rankerDecisionCount: summaryMetrics.rankerDecisionCount,
      rankerOverrideCount: summaryMetrics.rankerOverrideCount,
      rankerFallbackDecisionCount: summaryMetrics.rankerFallbackDecisionCount,
      overrideImprovedOutcomeCount: summaryMetrics.overrideImprovedOutcomeCount,
      overrideNeutralOutcomeCount: summaryMetrics.overrideNeutralOutcomeCount
    },
    model: {
      ...model,
      ...(options.modelPath === undefined ? {} : { modelPath: options.modelPath })
    },
    decision: options.decision ?? "online-lns-window-ranker-calibration-evidence",
    summary:
      options.summary ??
      `Online LNS window-ranker A/B scorecard at minScoreDelta=${minScoreDelta ?? "n/a"}; no solver default changed.`,
    modelFingerprint,
    summaryMetrics
  });
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

function formatNullableThreshold(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

export function formatLnsWindowRankerOnlineCalibration(result: LnsWindowRankerOnlineCalibrationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Ranker Threshold Sweep ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Model fingerprint: ${result.modelFingerprint ?? "n/a"}`);
  lines.push(`Thresholds: ${result.minScoreDeltas.join(", ")}`);
  lines.push(`Top mean-delta threshold: ${formatNullableThreshold(result.topMeanPopulationDeltaMinScoreDelta)}`);
  lines.push(`Top no-regression threshold: ${formatNullableThreshold(result.topSafeMinScoreDelta)}`);
  lines.push("Summary:");
  for (const summary of result.thresholdSummaries) {
    lines.push(
      `- min-score-delta=${summary.minScoreDelta}: delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} decisions=${summary.rankerDecisionCount} overrides=${summary.rankerOverrideCount} fallbacks=${summary.rankerFallbackDecisionCount} override-rate=${formatRate(summary.rankerOverrideRate)} fallback-rate=${formatRate(summary.rankerFallbackRate)} safety=${summary.safetyGatePassed ? "pass" : "fail"} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  return lines.join("\n");
}

function formatNullableDecimal(value: number | null): string {
  return value === null ? "n/a" : formatDecimal(value);
}

function formatRankerSummary(variant: LnsWindowRankerOnlineAblationVariantResult): string {
  const ranker = variant.windowRanker;
  if (!ranker) return "ranker=disabled";
  return `ranker=decisions:${ranker.decisions} overrides:${ranker.overrides} fallback:${ranker.fallbackDecisions} override-rate:${formatRate(ranker.overrideRate)} override-improved:${variant.overrideImprovedOutcomeCount} override-neutral:${variant.overrideNeutralOutcomeCount} override-score-delta-mean:${formatNullableDecimal(variant.meanOverrideScoreDelta)} fingerprint:${ranker.modelFingerprint ?? "n/a"}`;
}

export function formatLnsWindowRankerOnlineAblation(result: LnsWindowRankerOnlineAblationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Ranker Online A/B ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  lines.push(
    `Coverage: cases=${result.coverage.caseCount} seeds=${result.coverage.seedCount} comparisons=${result.coverage.comparisonCount} runs=${result.coverage.runCount} variants=${result.coverage.variantCount} grid-cells=${result.coverage.gridCellCount}`
  );
  lines.push("Summary:");
  for (const summary of result.variantSummaries) {
    lines.push(
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} decisions=${summary.rankerDecisionCount} overrides=${summary.rankerOverrideCount} fallbacks=${summary.rankerFallbackDecisionCount} override-rate=${formatRate(summary.rankerOverrideRate)} fallback-rate=${formatRate(summary.rankerFallbackRate)} override-improved=${summary.overrideImprovedOutcomeCount} override-neutral=${summary.overrideNeutralOutcomeCount} override-score-delta-mean=${formatNullableDecimal(summary.meanOverrideScoreDelta)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  lines.push("");

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(`- ${benchmarkCase.name} seed=${seedLabel}: ${benchmarkCase.description}`);
    for (const variant of benchmarkCase.variants) {
      lines.push(
        `  ${variant.variantName}=population:${variant.totalPopulation} delta:${formatSigned(variant.populationDeltaVsBaseline)} wall:${formatSeconds(variant.wallClockSeconds)} wall-delta:${formatSeconds(variant.wallClockDeltaVsBaselineSeconds)} roads:${variant.roadCount} road-delta:${formatSigned(variant.roadDeltaVsBaseline)} services:${variant.serviceCount} residentials:${variant.residentialCount} stop:${variant.stopReason ?? "n/a"} improved:${variant.improvingIterations ?? "n/a"} neutral:${variant.neutralIterations ?? "n/a"} ${formatRankerSummary(variant)}`
      );
    }
  }

  return lines.join("\n");
}
