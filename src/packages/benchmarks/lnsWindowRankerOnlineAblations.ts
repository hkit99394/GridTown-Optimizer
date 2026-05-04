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
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, runLnsBenchmarkSuite } from "./lns.js";
import { buildModelExperimentFingerprint } from "./modelExperimentArtifacts.js";

import type { LnsOptions, LnsWindowRankerRuntimeModel } from "../core/index.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot
} from "./benchmarkOptions.js";
import type { LnsBenchmarkCase, LnsBenchmarkCaseResult, LnsBenchmarkRunOptions } from "./lns.js";

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
  windowRanker: LnsWindowRankerOnlineAblationTelemetrySummary | null;
}

export interface LnsWindowRankerOnlineAblationCaseResult {
  name: string;
  description: string;
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
  return {
    ...summarizeBenchmarkVariantMetrics(variantName, cases, caseCount, seedCount, missingResultMessage),
    description: VARIANT_DESCRIPTIONS[variantName],
    rankerDecisionCount: decisionCount,
    rankerOverrideCount: overrideCount,
    rankerFallbackDecisionCount: fallbackDecisionCount,
    rankerOverrideRate: benchmarkRatio(overrideCount, decisionCount),
    rankerFallbackRate: benchmarkRatio(fallbackDecisionCount, decisionCount),
    overrideOutcomeCount: sumBenchmarkBy(results, (entry) => entry.overrideOutcomeCount),
    fallbackOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackOutcomeCount)
  };
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
      const baselineVariant = variantResult("baseline", baselineResult, baselineResult, seed);
      const rankerVariant = variantResult("window-ranker", rankerResult, baselineResult, seed);
      return {
        name: baselineResult.name,
        description: baselineResult.description,
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

function formatRankerSummary(variant: LnsWindowRankerOnlineAblationVariantResult): string {
  const ranker = variant.windowRanker;
  if (!ranker) return "ranker=disabled";
  return `ranker=decisions:${ranker.decisions} overrides:${ranker.overrides} fallback:${ranker.fallbackDecisions} override-rate:${formatRate(ranker.overrideRate)} fingerprint:${ranker.modelFingerprint ?? "n/a"}`;
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
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} decisions=${summary.rankerDecisionCount} overrides=${summary.rankerOverrideCount} fallbacks=${summary.rankerFallbackDecisionCount} override-rate=${formatRate(summary.rankerOverrideRate)} fallback-rate=${formatRate(summary.rankerFallbackRate)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
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
