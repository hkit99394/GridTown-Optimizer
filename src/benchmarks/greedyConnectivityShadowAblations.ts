import { DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS } from "./crossModeBudgetAblations.js";
import {
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  runGreedyBenchmarkSuite,
} from "./greedy.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkCaseResult,
  GreedyBenchmarkOptions,
  GreedyBenchmarkRunOptions,
} from "./greedy.js";

export type GreedyConnectivityShadowScoringAblationVariantName = "baseline" | "connectivity-shadow";

export interface GreedyConnectivityShadowScoringAblationRunOptions extends GreedyBenchmarkRunOptions {
  baselineGreedy?: Partial<GreedyBenchmarkOptions>;
  connectivityShadowGreedy?: Partial<GreedyBenchmarkOptions>;
}

export interface GreedyConnectivityShadowScoringAblationVariantResult {
  variantName: GreedyConnectivityShadowScoringAblationVariantName;
  connectivityShadowScoring: boolean;
  totalPopulation: number;
  wallClockSeconds: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  greedyOptions: GreedyBenchmarkOptions;
  progressSummary: GreedyBenchmarkCaseResult["progressSummary"];
  profileEnabled: boolean;
  shadowChecks: number | null;
  shadowLostCells: number | null;
  shadowDisconnectedCells: number | null;
  shadowMaxLostCells: number | null;
  shadowMaxDisconnectedCells: number | null;
  shadowScoreTies: number | null;
  shadowScoreWins: number | null;
  shadowScoreLosses: number | null;
  shadowScoreNeutral: number | null;
  shadowDecisionTraceCount: number;
}

export interface GreedyConnectivityShadowScoringAblationCaseResult {
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  gridCells: number;
  baseline: GreedyConnectivityShadowScoringAblationVariantResult;
  connectivityShadow: GreedyConnectivityShadowScoringAblationVariantResult;
  populationDelta: number;
  wallClockDeltaSeconds: number;
  roadDelta: number;
  serviceDelta: number;
  residentialDelta: number;
  shadowChecksDelta: number | null;
  shadowLostCellsDelta: number | null;
}

export interface GreedyConnectivityShadowScoringAblationCoverage {
  caseCount: number;
  runCount: number;
  variantCount: number;
  gridCellCount: number;
  profileEnabledRuns: number;
  shadowObservedRuns: number;
}

export interface GreedyConnectivityShadowScoringAblationSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  variants: GreedyConnectivityShadowScoringAblationVariantName[];
  coverage: GreedyConnectivityShadowScoringAblationCoverage;
  improvedCaseCount: number;
  regressedCaseCount: number;
  unchangedCaseCount: number;
  totalPopulationDelta: number;
  meanPopulationDelta: number;
  bestPopulationDelta: number;
  worstPopulationDelta: number;
  totalRoadDelta: number;
  cases: GreedyConnectivityShadowScoringAblationCaseResult[];
}

export const DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES = Object.freeze([
  "row0-corridor-repair-pressure",
  "bridge-connectivity-heavy",
  "geometry-occupancy-hot-path",
  "deferred-road-packing-gain",
  "service-local-neighborhood",
  "deterministic-tie-breaks",
  "typed-footprint-pressure",
  "typed-availability-pressure",
] satisfies string[]);

function dedupeCases(corpora: readonly (readonly GreedyBenchmarkCase[])[]): GreedyBenchmarkCase[] {
  const byName = new Map<string, GreedyBenchmarkCase>();
  for (const corpus of corpora) {
    for (const benchmarkCase of corpus) {
      if (!byName.has(benchmarkCase.name)) {
        byName.set(benchmarkCase.name, benchmarkCase);
      }
    }
  }
  return [...byName.values()];
}

function selectDefaultAblationCases(corpus: readonly GreedyBenchmarkCase[]): GreedyBenchmarkCase[] {
  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  return DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES.map((name) => {
    const benchmarkCase = byName.get(name);
    if (!benchmarkCase) {
      throw new Error(`Greedy connectivity-shadow ablation case not found: ${name}.`);
    }
    return benchmarkCase;
  });
}

export const DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS: readonly GreedyBenchmarkCase[] =
  Object.freeze(
    selectDefaultAblationCases(
      dedupeCases([
        DEFAULT_GREEDY_BENCHMARK_CORPUS,
        DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
      ])
    )
  );

function maybeDelta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : right - left;
}

function variantResult(
  variantName: GreedyConnectivityShadowScoringAblationVariantName,
  connectivityShadowScoring: boolean,
  result: GreedyBenchmarkCaseResult
): GreedyConnectivityShadowScoringAblationVariantResult {
  const counters = result.greedyProfile?.counters.roads;
  return {
    variantName,
    connectivityShadowScoring,
    totalPopulation: result.totalPopulation,
    wallClockSeconds: result.wallClockSeconds,
    roadCount: result.roadCount,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    greedyOptions: result.greedyOptions,
    progressSummary: result.progressSummary,
    profileEnabled: result.greedyProfile !== null,
    shadowChecks: counters?.connectivityShadowChecks ?? null,
    shadowLostCells: counters?.connectivityShadowLostCells ?? null,
    shadowDisconnectedCells: counters?.connectivityShadowDisconnectedCells ?? null,
    shadowMaxLostCells: counters?.connectivityShadowMaxLostCells ?? null,
    shadowMaxDisconnectedCells: counters?.connectivityShadowMaxDisconnectedCells ?? null,
    shadowScoreTies: counters?.connectivityShadowScoreTies ?? null,
    shadowScoreWins: counters?.connectivityShadowScoreWins ?? null,
    shadowScoreLosses: counters?.connectivityShadowScoreLosses ?? null,
    shadowScoreNeutral: counters?.connectivityShadowScoreNeutral ?? null,
    shadowDecisionTraceCount: result.greedyProfile?.connectivityShadowDecisions?.length ?? 0,
  };
}

function buildCoverage(cases: readonly GreedyConnectivityShadowScoringAblationCaseResult[]): GreedyConnectivityShadowScoringAblationCoverage {
  const variants = cases.flatMap((entry) => [entry.baseline, entry.connectivityShadow]);
  return {
    caseCount: cases.length,
    runCount: variants.length,
    variantCount: 2,
    gridCellCount: cases.reduce((sum, entry) => sum + entry.gridCells, 0),
    profileEnabledRuns: variants.filter((entry) => entry.profileEnabled).length,
    shadowObservedRuns: variants.filter((entry) => entry.shadowChecks !== null && entry.shadowChecks > 0).length,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function listGreedyConnectivityShadowScoringAblationCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS
): string[] {
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

export function runGreedyConnectivityShadowScoringAblation(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
  options: GreedyConnectivityShadowScoringAblationRunOptions = {}
): GreedyConnectivityShadowScoringAblationSuiteResult {
  const names = options.names?.length ? options.names : undefined;
  const baselineSuite = runGreedyBenchmarkSuite(corpus, {
    names,
    greedy: {
      ...(options.greedy ?? {}),
      ...(options.baselineGreedy ?? {}),
      connectivityShadowScoring: false,
    },
  });
  const connectivityShadowSuite = runGreedyBenchmarkSuite(corpus, {
    names,
    greedy: {
      ...(options.greedy ?? {}),
      ...(options.connectivityShadowGreedy ?? {}),
      connectivityShadowScoring: true,
    },
  });

  const connectivityShadowByName = new Map(
    connectivityShadowSuite.results.map((result) => [result.name, result])
  );
  const cases = baselineSuite.results.map((baselineResult) => {
    const connectivityShadowResult = connectivityShadowByName.get(baselineResult.name);
    if (!connectivityShadowResult) {
      throw new Error(`Greedy connectivity-shadow ablation result missing: ${baselineResult.name}.`);
    }
    const baseline = variantResult("baseline", false, baselineResult);
    const connectivityShadow = variantResult("connectivity-shadow", true, connectivityShadowResult);
    return {
      name: baselineResult.name,
      description: baselineResult.description,
      gridRows: baselineResult.gridRows,
      gridCols: baselineResult.gridCols,
      gridCells: baselineResult.gridRows * baselineResult.gridCols,
      baseline,
      connectivityShadow,
      populationDelta: connectivityShadow.totalPopulation - baseline.totalPopulation,
      wallClockDeltaSeconds: connectivityShadow.wallClockSeconds - baseline.wallClockSeconds,
      roadDelta: connectivityShadow.roadCount - baseline.roadCount,
      serviceDelta: connectivityShadow.serviceCount - baseline.serviceCount,
      residentialDelta: connectivityShadow.residentialCount - baseline.residentialCount,
      shadowChecksDelta: maybeDelta(baseline.shadowChecks, connectivityShadow.shadowChecks),
      shadowLostCellsDelta: maybeDelta(baseline.shadowLostCells, connectivityShadow.shadowLostCells),
    };
  });
  const populationDeltas = cases.map((entry) => entry.populationDelta);

  return {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    selectedCaseNames: cases.map((entry) => entry.name),
    variants: ["baseline", "connectivity-shadow"],
    coverage: buildCoverage(cases),
    improvedCaseCount: cases.filter((entry) => entry.populationDelta > 0).length,
    regressedCaseCount: cases.filter((entry) => entry.populationDelta < 0).length,
    unchangedCaseCount: cases.filter((entry) => entry.populationDelta === 0).length,
    totalPopulationDelta: sum(populationDeltas),
    meanPopulationDelta: mean(populationDeltas),
    bestPopulationDelta: populationDeltas.length ? Math.max(...populationDeltas) : 0,
    worstPopulationDelta: populationDeltas.length ? Math.min(...populationDeltas) : 0,
    totalRoadDelta: sum(cases.map((entry) => entry.roadDelta)),
    cases,
  };
}

function formatSigned(value: number | null): string {
  if (value === null) return "n/a";
  return value > 0 ? `+${Number(value).toLocaleString()}` : Number(value).toLocaleString();
}

function formatNullable(value: number | null): string {
  return value === null ? "n/a" : Number(value).toLocaleString();
}

function formatVariant(variant: GreedyConnectivityShadowScoringAblationVariantResult): string {
  return [
    `${variant.variantName}=connectivityShadowScoring:${variant.connectivityShadowScoring}`,
    `population:${variant.totalPopulation}`,
    `wall:${variant.wallClockSeconds.toFixed(3)}s`,
    `roads:${variant.roadCount}`,
    `services:${variant.serviceCount}`,
    `residentials:${variant.residentialCount}`,
    `shadow-checks:${formatNullable(variant.shadowChecks)}`,
    `shadow-lost:${formatNullable(variant.shadowLostCells)}`,
    `shadow-disconnected:${formatNullable(variant.shadowDisconnectedCells)}`,
    `shadow-max-lost:${formatNullable(variant.shadowMaxLostCells)}`,
    `shadow-score-ties:${formatNullable(variant.shadowScoreTies)}`,
    `shadow-score-wins:${formatNullable(variant.shadowScoreWins)}`,
    `shadow-score-losses:${formatNullable(variant.shadowScoreLosses)}`,
    `shadow-trace:${variant.shadowDecisionTraceCount}`,
  ].join(" ");
}

export function formatGreedyConnectivityShadowScoringAblation(
  result: GreedyConnectivityShadowScoringAblationSuiteResult
): string {
  const lines: string[] = [];
  lines.push("=== Greedy Connectivity-Shadow Scoring Ablation ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Variants: baseline=false, connectivity-shadow=true`);
  lines.push(
    `Coverage: cases=${result.coverage.caseCount} runs=${result.coverage.runCount} variants=${result.coverage.variantCount} grid-cells=${result.coverage.gridCellCount} profile-runs=${result.coverage.profileEnabledRuns} shadow-observed-runs=${result.coverage.shadowObservedRuns}`
  );
  lines.push(
    `Population delta: total=${formatSigned(result.totalPopulationDelta)} mean=${formatSigned(result.meanPopulationDelta)} best=${formatSigned(result.bestPopulationDelta)} worst=${formatSigned(result.worstPopulationDelta)} improved=${result.improvedCaseCount} regressed=${result.regressedCaseCount} unchanged=${result.unchangedCaseCount} road-delta=${formatSigned(result.totalRoadDelta)}`
  );
  lines.push("");

  for (const benchmarkCase of result.cases) {
    lines.push(`- ${benchmarkCase.name}: ${benchmarkCase.description}`);
    lines.push(
      `  grid=${benchmarkCase.gridRows}x${benchmarkCase.gridCols} population-delta=${formatSigned(benchmarkCase.populationDelta)} wall-delta=${benchmarkCase.wallClockDeltaSeconds.toFixed(3)}s road-delta=${formatSigned(benchmarkCase.roadDelta)} service-delta=${formatSigned(benchmarkCase.serviceDelta)} residential-delta=${formatSigned(benchmarkCase.residentialDelta)} shadow-checks-delta=${formatSigned(benchmarkCase.shadowChecksDelta)} shadow-lost-delta=${formatSigned(benchmarkCase.shadowLostCellsDelta)}`
    );
    lines.push(`  ${formatVariant(benchmarkCase.baseline)}`);
    lines.push(`  ${formatVariant(benchmarkCase.connectivityShadow)}`);
  }

  return lines.join("\n");
}
