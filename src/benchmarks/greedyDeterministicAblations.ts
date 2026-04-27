import { DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS } from "./crossModeBudgetAblations.js";
import { formatBenchmarkSeeds, normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
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

export type GreedyDeterministicAblationVariantName =
  | "baseline"
  | "no-restarts"
  | "no-local-search"
  | "no-service-neighborhood"
  | "no-service-refinement"
  | "no-exhaustive-service-search"
  | "no-service-lookahead"
  | "explicit-roads"
  | "deferred-roads"
  | "connectivity-shadow-scoring";

export interface GreedyDeterministicAblationVariant {
  name: GreedyDeterministicAblationVariantName;
  description: string;
  greedy: Partial<GreedyBenchmarkOptions>;
}

export interface GreedyDeterministicAblationRunOptions extends GreedyBenchmarkRunOptions {
  variants?: readonly GreedyDeterministicAblationVariant[];
  variantNames?: readonly GreedyDeterministicAblationVariantName[];
  seeds?: readonly number[];
  baselineGreedy?: Partial<GreedyBenchmarkOptions>;
}

export interface GreedyDeterministicAblationVariantResult {
  variantName: GreedyDeterministicAblationVariantName;
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
  greedyOptions: GreedyBenchmarkOptions;
  profileEnabled: boolean;
  phaseCount: number;
}

export interface GreedyDeterministicAblationCaseResult {
  name: string;
  description: string;
  seed: number | null;
  gridRows: number;
  gridCols: number;
  gridCells: number;
  baseline: GreedyDeterministicAblationVariantResult;
  variants: GreedyDeterministicAblationVariantResult[];
}

export interface GreedyDeterministicAblationVariantSummary {
  variantName: GreedyDeterministicAblationVariantName;
  description: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  meanPopulation: number;
  medianPopulation: number;
  worstDecilePopulation: number;
  bestPopulation: number;
  meanPopulationDeltaVsBaseline: number;
  medianPopulationDeltaVsBaseline: number;
  worstDecilePopulationDeltaVsBaseline: number;
  bestPopulationDeltaVsBaseline: number;
  meanWallClockSeconds: number;
  meanWallClockDeltaVsBaselineSeconds: number;
  improvedCaseCount: number;
  regressedCaseCount: number;
  unchangedCaseCount: number;
  winRate: number;
  regressionRate: number;
  unchangedRate: number;
  worstPopulationDeltaVsBaseline: number;
  worstPopulationDeltaCaseName: string | null;
  worstPopulationDeltaSeed: number | null;
  bestPopulationDeltaCaseName: string | null;
  bestPopulationDeltaSeed: number | null;
}

export interface GreedyDeterministicAblationCoverage {
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  variantCount: number;
  runCount: number;
  gridCellCount: number;
  profileEnabledRuns: number;
}

export interface GreedyDeterministicAblationSuiteResult {
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  variants: GreedyDeterministicAblationVariantName[];
  coverage: GreedyDeterministicAblationCoverage;
  variantSummaries: GreedyDeterministicAblationVariantSummary[];
  cases: GreedyDeterministicAblationCaseResult[];
}

export interface GreedyDeterministicAblationSnapshotVariantResult
  extends Omit<
    GreedyDeterministicAblationVariantResult,
    "wallClockSeconds" | "wallClockDeltaVsBaselineSeconds"
  > {}

export interface GreedyDeterministicAblationSnapshotCaseResult
  extends Omit<GreedyDeterministicAblationCaseResult, "baseline" | "variants"> {
  baseline: GreedyDeterministicAblationSnapshotVariantResult;
  variants: GreedyDeterministicAblationSnapshotVariantResult[];
}

export interface GreedyDeterministicAblationSnapshotVariantSummary
  extends Omit<
    GreedyDeterministicAblationVariantSummary,
    "meanWallClockSeconds" | "meanWallClockDeltaVsBaselineSeconds"
  > {}

export interface GreedyDeterministicAblationSnapshot
  extends Omit<GreedyDeterministicAblationSuiteResult, "generatedAt" | "variantSummaries" | "cases"> {
  variantSummaries: GreedyDeterministicAblationSnapshotVariantSummary[];
  cases: GreedyDeterministicAblationSnapshotCaseResult[];
}

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS: readonly GreedyDeterministicAblationVariant[] =
  Object.freeze([
    {
      name: "baseline",
      description: "Current deterministic Greedy settings inherited from each benchmark case.",
      greedy: {},
    },
    {
      name: "no-restarts",
      description: "Disable restart exploration by forcing a single constructive pass.",
      greedy: { restarts: 1 },
    },
    {
      name: "no-local-search",
      description: "Disable residential and service local-search improvement.",
      greedy: { localSearch: false, localSearchServiceMoves: false },
    },
    {
      name: "no-service-neighborhood",
      description: "Keep residential local search but disable service remove/add/swap neighborhoods.",
      greedy: { localSearchServiceMoves: false },
    },
    {
      name: "no-service-refinement",
      description: "Disable fixed-service refinement reruns.",
      greedy: { serviceRefineIterations: 0 },
    },
    {
      name: "no-exhaustive-service-search",
      description: "Disable exhaustive fixed-service-set checks.",
      greedy: { exhaustiveServiceSearch: false },
    },
    {
      name: "no-service-lookahead",
      description: "Disable Step 14 service lookahead reranking.",
      greedy: { serviceLookaheadCandidates: 0 },
    },
    {
      name: "explicit-roads",
      description: "Force immediate explicit road commitment.",
      greedy: { deferRoadCommitment: false },
    },
    {
      name: "deferred-roads",
      description: "Enable deferred road commitment where the case can use it.",
      greedy: { deferRoadCommitment: true },
    },
    {
      name: "connectivity-shadow-scoring",
      description: "Enable guarded connectivity-shadow tie-break scoring.",
      greedy: { connectivityShadowScoring: true },
    },
  ]);

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES = Object.freeze([
  "cap-sweep-mixed",
  "fixed-service-realization-complete",
  "service-local-neighborhood",
  "step14-service-lookahead-reranker",
  "deferred-road-packing-gain",
  "geometry-occupancy-hot-path",
  "typed-footprint-pressure",
  "typed-availability-pressure",
  "row0-corridor-repair-pressure",
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
  return DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES.map((name) => {
    const benchmarkCase = byName.get(name);
    if (!benchmarkCase) {
      throw new Error(`Greedy deterministic ablation case not found: ${name}.`);
    }
    return benchmarkCase;
  });
}

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS: readonly GreedyBenchmarkCase[] =
  Object.freeze(
    selectDefaultAblationCases(
      dedupeCases([
        DEFAULT_GREEDY_BENCHMARK_CORPUS,
        DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
      ])
    )
  );

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))
  );
  return sorted[index]!;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function seedCaseLabel(
  result: GreedyDeterministicAblationVariantResult,
  cases: readonly GreedyDeterministicAblationCaseResult[]
): { caseName: string | null; seed: number | null } {
  const match = cases.find((entry) =>
    entry.seed === result.seed
    && entry.variants.some((candidate) => candidate.variantName === result.variantName && candidate === result)
  );
  return {
    caseName: match?.name ?? null,
    seed: result.seed,
  };
}

function variantResult(
  variant: GreedyDeterministicAblationVariant,
  result: GreedyBenchmarkCaseResult,
  baseline: GreedyBenchmarkCaseResult,
  seed: number | null
): GreedyDeterministicAblationVariantResult {
  return {
    variantName: variant.name,
    description: variant.description,
    seed,
    totalPopulation: result.totalPopulation,
    populationDeltaVsBaseline: result.totalPopulation - baseline.totalPopulation,
    wallClockSeconds: result.wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: result.wallClockSeconds - baseline.wallClockSeconds,
    roadCount: result.roadCount,
    roadDeltaVsBaseline: result.roadCount - baseline.roadCount,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    greedyOptions: result.greedyOptions,
    profileEnabled: result.greedyProfile !== null,
    phaseCount: result.greedyProfile?.phases.length ?? 0,
  };
}

function buildVariantSummary(
  variant: GreedyDeterministicAblationVariant,
  cases: readonly GreedyDeterministicAblationCaseResult[],
  caseCount: number,
  seedCount: number
): GreedyDeterministicAblationVariantSummary {
  const results = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(`Greedy deterministic ablation variant result missing: ${variant.name}.`);
    }
    return result;
  });
  const populations = results.map((entry) => entry.totalPopulation);
  const populationDeltas = results.map((entry) => entry.populationDeltaVsBaseline);
  const improvedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline > 0).length;
  const regressedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline < 0).length;
  const unchangedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline === 0).length;
  const worstDeltaResult = results.reduce<GreedyDeterministicAblationVariantResult | null>(
    (worst, entry) => (worst === null || entry.populationDeltaVsBaseline < worst.populationDeltaVsBaseline ? entry : worst),
    null
  );
  const bestDeltaResult = results.reduce<GreedyDeterministicAblationVariantResult | null>(
    (best, entry) => (best === null || entry.populationDeltaVsBaseline > best.populationDeltaVsBaseline ? entry : best),
    null
  );
  const worstDeltaLabel = worstDeltaResult ? seedCaseLabel(worstDeltaResult, cases) : { caseName: null, seed: null };
  const bestDeltaLabel = bestDeltaResult ? seedCaseLabel(bestDeltaResult, cases) : { caseName: null, seed: null };
  return {
    variantName: variant.name,
    description: variant.description,
    caseCount,
    seedCount,
    comparisonCount: results.length,
    meanPopulation: mean(populations),
    medianPopulation: percentile(populations, 0.5),
    worstDecilePopulation: percentile(populations, 0.1),
    bestPopulation: populations.length ? Math.max(...populations) : 0,
    meanPopulationDeltaVsBaseline: mean(populationDeltas),
    medianPopulationDeltaVsBaseline: percentile(populationDeltas, 0.5),
    worstDecilePopulationDeltaVsBaseline: percentile(populationDeltas, 0.1),
    bestPopulationDeltaVsBaseline: populationDeltas.length ? Math.max(...populationDeltas) : 0,
    meanWallClockSeconds: mean(results.map((entry) => entry.wallClockSeconds)),
    meanWallClockDeltaVsBaselineSeconds: mean(results.map((entry) => entry.wallClockDeltaVsBaselineSeconds)),
    improvedCaseCount,
    regressedCaseCount,
    unchangedCaseCount,
    winRate: ratio(improvedCaseCount, results.length),
    regressionRate: ratio(regressedCaseCount, results.length),
    unchangedRate: ratio(unchangedCaseCount, results.length),
    worstPopulationDeltaVsBaseline: populationDeltas.length ? Math.min(...populationDeltas) : 0,
    worstPopulationDeltaCaseName: worstDeltaLabel.caseName,
    worstPopulationDeltaSeed: worstDeltaLabel.seed,
    bestPopulationDeltaCaseName: bestDeltaLabel.caseName,
    bestPopulationDeltaSeed: bestDeltaLabel.seed,
  };
}

function buildCoverage(
  cases: readonly GreedyDeterministicAblationCaseResult[],
  caseCount: number,
  seedCount: number
): GreedyDeterministicAblationCoverage {
  const variants = cases.flatMap((entry) => entry.variants);
  return {
    caseCount,
    seedCount,
    comparisonCount: cases.length,
    variantCount: cases[0]?.variants.length ?? 0,
    runCount: variants.length,
    gridCellCount: cases.reduce((total, entry) => total + entry.gridCells, 0),
    profileEnabledRuns: variants.filter((entry) => entry.profileEnabled).length,
  };
}

function normalizeVariants(
  variants: readonly GreedyDeterministicAblationVariant[] | undefined,
  variantNames: readonly GreedyDeterministicAblationVariantName[] | undefined
): readonly GreedyDeterministicAblationVariant[] {
  const normalized = variants ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS;
  if (normalized.length === 0) {
    throw new Error("Greedy deterministic ablations must include at least one variant.");
  }
  const names = normalized.map((variant) => variant.name);
  if (!names.includes("baseline")) {
    throw new Error("Greedy deterministic ablations must include the baseline variant.");
  }
  if (new Set(names).size !== names.length) {
    throw new Error("Greedy deterministic ablation variants must use unique names.");
  }
  if (variantNames?.length) {
    const byName = new Map(normalized.map((variant) => [variant.name, variant]));
    const requestedNames: GreedyDeterministicAblationVariantName[] = [
      "baseline",
      ...variantNames.filter((name) => name !== "baseline"),
    ];
    if (new Set(requestedNames).size !== requestedNames.length) {
      throw new Error("Greedy deterministic ablation requested variants must use unique names.");
    }
    const missing = requestedNames.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Unknown Greedy deterministic ablation variant(s): ${missing.join(", ")}. Available variants: ${names.join(", ")}.`
      );
    }
    return requestedNames.map((name) => byName.get(name)!);
  }
  return normalized;
}

export function listGreedyDeterministicAblationCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS
): string[] {
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

export function listGreedyDeterministicAblationVariantNames(): GreedyDeterministicAblationVariantName[] {
  return DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS.map((variant) => variant.name);
}

export function runGreedyDeterministicAblation(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
  options: GreedyDeterministicAblationRunOptions = {}
): GreedyDeterministicAblationSuiteResult {
  const names = options.names?.length ? options.names : undefined;
  const variants = normalizeVariants(options.variants, options.variantNames);
  const seeds = normalizeBenchmarkSeeds(options.seeds, "Greedy deterministic ablation seeds") ?? [];
  const seedRuns: readonly (number | null)[] = seeds.length ? seeds : [null];
  const baseGreedy = {
    profile: false,
    ...(options.greedy ?? {}),
  };
  const suites = new Map<string, ReturnType<typeof runGreedyBenchmarkSuite>>();
  for (const seed of seedRuns) {
    for (const variant of variants) {
      suites.set(
        `${seed ?? "case-default"}:${variant.name}`,
        runGreedyBenchmarkSuite(corpus, {
          names,
          greedy: {
            ...baseGreedy,
            ...(variant.name === "baseline" ? options.baselineGreedy ?? {} : {}),
            ...variant.greedy,
            ...(seed !== null ? { randomSeed: seed } : {}),
          },
        })
      );
    }
  }

  const cases = seedRuns.flatMap((seed) => {
    const baselineSuite = suites.get(`${seed ?? "case-default"}:baseline`);
    if (!baselineSuite) {
      throw new Error(`Greedy deterministic ablation baseline suite missing for seed ${seed ?? "case-default"}.`);
    }
    return baselineSuite.results.map((baselineResult) => {
      const variantResults = variants.map((variant) => {
        const suite = suites.get(`${seed ?? "case-default"}:${variant.name}`);
        const result = suite?.results.find((entry) => entry.name === baselineResult.name);
        if (!result) {
          throw new Error(`Greedy deterministic ablation result missing: ${variant.name}/${baselineResult.name}/${seed ?? "case-default"}.`);
        }
        return variantResult(variant, result, baselineResult, seed);
      });
      return {
        name: baselineResult.name,
        description: baselineResult.description,
        seed,
        gridRows: baselineResult.gridRows,
        gridCols: baselineResult.gridCols,
        gridCells: baselineResult.gridRows * baselineResult.gridCols,
        baseline: variantResults.find((entry) => entry.variantName === "baseline")!,
        variants: variantResults,
      };
    });
  });

  const selectedCaseNames = baselineSelectedCaseNames(cases);

  return {
    generatedAt: new Date().toISOString(),
    caseCount: selectedCaseNames.length,
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    selectedCaseNames,
    variants: variants.map((variant) => variant.name),
    coverage: buildCoverage(cases, selectedCaseNames.length, seedRuns.length),
    variantSummaries: variants.map((variant) => buildVariantSummary(variant, cases, selectedCaseNames.length, seedRuns.length)),
    cases,
  };
}

function baselineSelectedCaseNames(cases: readonly GreedyDeterministicAblationCaseResult[]): string[] {
  return [...new Set(cases.map((entry) => entry.name))];
}

function formatSigned(value: number): string {
  return value > 0 ? `+${Number(value).toLocaleString()}` : Number(value).toLocaleString();
}

function formatSeconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? Number(value).toLocaleString() : value.toFixed(1);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSeedCase(caseName: string | null, seed: number | null): string {
  if (!caseName) return "n/a";
  return seed === null ? `${caseName}/case-default` : `${caseName}/seed:${seed}`;
}

function snapshotVariantResult(
  result: GreedyDeterministicAblationVariantResult
): GreedyDeterministicAblationSnapshotVariantResult {
  const {
    wallClockSeconds: _wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: _wallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = result;
  return snapshot;
}

function snapshotVariantSummary(
  summary: GreedyDeterministicAblationVariantSummary
): GreedyDeterministicAblationSnapshotVariantSummary {
  const {
    meanWallClockSeconds: _meanWallClockSeconds,
    meanWallClockDeltaVsBaselineSeconds: _meanWallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = summary;
  return snapshot;
}

export function createGreedyDeterministicAblationSnapshot(
  result: GreedyDeterministicAblationSuiteResult
): GreedyDeterministicAblationSnapshot {
  return {
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    variants: [...result.variants],
    coverage: { ...result.coverage },
    variantSummaries: result.variantSummaries.map(snapshotVariantSummary),
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baseline: snapshotVariantResult(benchmarkCase.baseline),
      variants: benchmarkCase.variants.map(snapshotVariantResult),
    })),
  };
}

export function formatGreedyDeterministicAblation(result: GreedyDeterministicAblationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Greedy Deterministic Ablation Matrix ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  lines.push(
    `Coverage: cases=${result.coverage.caseCount} seeds=${result.coverage.seedCount} comparisons=${result.coverage.comparisonCount} runs=${result.coverage.runCount} variants=${result.coverage.variantCount} grid-cells=${result.coverage.gridCellCount} profile-runs=${result.coverage.profileEnabledRuns}`
  );
  lines.push("Summary:");
  for (const summary of result.variantSummaries) {
    lines.push(
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} unchanged-rate=${formatRate(summary.unchangedRate)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  lines.push("");

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(`- ${benchmarkCase.name} seed=${seedLabel}: ${benchmarkCase.description}`);
    for (const variant of benchmarkCase.variants) {
      lines.push(
        `  ${variant.variantName}=population:${variant.totalPopulation} delta:${formatSigned(variant.populationDeltaVsBaseline)} wall:${formatSeconds(variant.wallClockSeconds)} wall-delta:${formatSeconds(variant.wallClockDeltaVsBaselineSeconds)} roads:${variant.roadCount} road-delta:${formatSigned(variant.roadDeltaVsBaseline)} services:${variant.serviceCount} residentials:${variant.residentialCount} phases:${variant.phaseCount}`
      );
    }
  }

  return lines.join("\n");
}
