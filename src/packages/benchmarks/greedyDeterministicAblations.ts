import { DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS } from "./crossModeBudgetAblations.js";
import { buildBenchmarkSeedRunPlan, formatBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  buildBenchmarkVariantCoverage,
  buildBenchmarkSuiteMetadata,
  countBenchmarkMatches,
  dedupeBenchmarkCases,
  formatBenchmarkDecimal as formatDecimal,
  formatBenchmarkRate as formatRate,
  formatBenchmarkSeconds as formatSeconds,
  formatBenchmarkSeedCase as formatSeedCase,
  formatBenchmarkSignedNumber as formatSigned,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName,
  selectBenchmarkVariants,
  snapshotBenchmarkVariantResult,
  snapshotBenchmarkVariantSummary,
  summarizeBenchmarkVariantMetrics,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS, runGreedyBenchmarkSuite } from "./greedy.js";
import {
  buildPopulationAttainmentMetrics,
  buildPopulationAttainmentMetricsForParams,
  formatPopulationAttainmentMetrics
} from "./populationAttainment.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkCaseResult,
  GreedyBenchmarkOptions,
  GreedyBenchmarkRunOptions
} from "./greedy.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot,
  PopulationAttainmentMetrics
} from "./benchmarkOptions.js";

export type GreedyDeterministicAblationVariantName =
  | "baseline"
  | "no-restarts"
  | "no-local-search"
  | "no-service-neighborhood"
  | "no-service-refinement"
  | "no-exhaustive-service-search"
  | "service-master-decomposition"
  | "no-service-master-decomposition"
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
  attainment: PopulationAttainmentMetrics;
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

export interface GreedyDeterministicAblationVariantSummary extends BenchmarkVariantSummaryMetrics<GreedyDeterministicAblationVariantName> {
  description: string;
}

export interface GreedyDeterministicAblationCoverage extends BenchmarkVariantCoverageMetrics {
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

export interface GreedyDeterministicAblationSnapshotVariantResult extends BenchmarkVariantResultSnapshot<GreedyDeterministicAblationVariantResult> {}

export interface GreedyDeterministicAblationSnapshotCaseResult extends Omit<
  GreedyDeterministicAblationCaseResult,
  "baseline" | "variants"
> {
  baseline: GreedyDeterministicAblationSnapshotVariantResult;
  variants: GreedyDeterministicAblationSnapshotVariantResult[];
}

export interface GreedyDeterministicAblationSnapshotVariantSummary extends BenchmarkVariantSummarySnapshot<GreedyDeterministicAblationVariantSummary> {}

export interface GreedyDeterministicAblationSnapshot extends Omit<
  GreedyDeterministicAblationSuiteResult,
  "generatedAt" | "variantSummaries" | "cases"
> {
  variantSummaries: GreedyDeterministicAblationSnapshotVariantSummary[];
  cases: GreedyDeterministicAblationSnapshotCaseResult[];
}

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS: readonly GreedyDeterministicAblationVariant[] =
  Object.freeze([
    {
      name: "baseline",
      description: "Current deterministic Greedy settings inherited from each benchmark case.",
      greedy: {}
    },
    {
      name: "no-restarts",
      description: "Disable restart exploration by forcing a single constructive pass.",
      greedy: { restarts: 1 }
    },
    {
      name: "no-local-search",
      description: "Disable residential and service local-search improvement.",
      greedy: { localSearch: false, localSearchServiceMoves: false }
    },
    {
      name: "no-service-neighborhood",
      description: "Keep residential local search but disable service remove/add/swap neighborhoods.",
      greedy: { localSearchServiceMoves: false }
    },
    {
      name: "no-service-refinement",
      description: "Disable fixed-service refinement reruns.",
      greedy: { serviceRefineIterations: 0 }
    },
    {
      name: "no-exhaustive-service-search",
      description: "Disable exhaustive fixed-service-set checks.",
      greedy: { exhaustiveServiceSearch: false }
    },
    {
      name: "service-master-decomposition",
      description: "Enable the experimental service-layout master pass.",
      greedy: { serviceMasterDecomposition: true }
    },
    {
      name: "no-service-master-decomposition",
      description: "Disable the experimental service-layout master pass.",
      greedy: { serviceMasterDecomposition: false }
    },
    {
      name: "no-service-lookahead",
      description: "Disable Step 14 service lookahead reranking.",
      greedy: { serviceLookaheadCandidates: 0 }
    },
    {
      name: "explicit-roads",
      description: "Force immediate explicit road commitment.",
      greedy: { deferRoadCommitment: false }
    },
    {
      name: "deferred-roads",
      description: "Enable deferred road commitment where the case can use it.",
      greedy: { deferRoadCommitment: true }
    },
    {
      name: "connectivity-shadow-scoring",
      description: "Enable guarded connectivity-shadow tie-break scoring.",
      greedy: { connectivityShadowScoring: true }
    }
  ]);

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES = Object.freeze([
  "cap-sweep-mixed",
  "fixed-service-realization-complete",
  "service-master-decomposition-experiment",
  "service-local-neighborhood",
  "step14-service-lookahead-reranker",
  "deferred-road-packing-gain",
  "geometry-occupancy-hot-path",
  "typed-footprint-pressure",
  "typed-availability-pressure",
  "row0-corridor-repair-pressure"
] satisfies string[]);

function selectDefaultAblationCases(corpus: readonly GreedyBenchmarkCase[]): GreedyBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES, {
    caseLabel: "Greedy deterministic ablation",
    corpusLabel: "Greedy deterministic ablation"
  });
}

export const DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS: readonly GreedyBenchmarkCase[] = Object.freeze(
  selectDefaultAblationCases(
    dedupeBenchmarkCases([DEFAULT_GREEDY_BENCHMARK_CORPUS, DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS])
  )
);

function variantResult(
  variant: GreedyDeterministicAblationVariant,
  result: GreedyBenchmarkCaseResult,
  baseline: GreedyBenchmarkCaseResult,
  seed: number | null,
  benchmarkCase: GreedyBenchmarkCase | null
): GreedyDeterministicAblationVariantResult {
  const attainmentOptions = {
    totalPopulation: result.totalPopulation,
    baselinePopulation: variant.name === "baseline" ? 0 : baseline.totalPopulation,
    elapsedSeconds: result.wallClockSeconds
  };
  return {
    variantName: variant.name,
    description: variant.description,
    seed,
    totalPopulation: result.totalPopulation,
    populationDeltaVsBaseline: result.totalPopulation - baseline.totalPopulation,
    wallClockSeconds: result.wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: result.wallClockSeconds - baseline.wallClockSeconds,
    attainment: benchmarkCase
      ? buildPopulationAttainmentMetricsForParams(benchmarkCase.params, attainmentOptions)
      : buildPopulationAttainmentMetrics({ ...attainmentOptions, capacityUpperBound: null }),
    roadCount: result.roadCount,
    roadDeltaVsBaseline: result.roadCount - baseline.roadCount,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    greedyOptions: result.greedyOptions,
    profileEnabled: result.greedyProfile !== null,
    phaseCount: result.greedyProfile?.phases.length ?? 0
  };
}

function buildVariantSummary(
  variant: GreedyDeterministicAblationVariant,
  cases: readonly GreedyDeterministicAblationCaseResult[],
  caseCount: number,
  seedCount: number
): GreedyDeterministicAblationVariantSummary {
  return {
    ...summarizeBenchmarkVariantMetrics(
      variant.name,
      cases,
      caseCount,
      seedCount,
      `Greedy deterministic ablation variant result missing: ${variant.name}.`
    ),
    description: variant.description
  };
}

function buildCoverage(
  cases: readonly GreedyDeterministicAblationCaseResult[],
  caseCount: number,
  seedCount: number
): GreedyDeterministicAblationCoverage {
  const coverage = buildBenchmarkVariantCoverage(cases, caseCount, seedCount);
  const variants = cases.flatMap((entry) => entry.variants);
  return {
    ...coverage,
    profileEnabledRuns: countBenchmarkMatches(variants, (entry) => entry.profileEnabled)
  };
}

function normalizeVariants(
  variants: readonly GreedyDeterministicAblationVariant[] | undefined,
  variantNames: readonly GreedyDeterministicAblationVariantName[] | undefined
): readonly GreedyDeterministicAblationVariant[] {
  return selectBenchmarkVariants(
    variants,
    DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS,
    variantNames,
    {
      suiteLabel: "Greedy deterministic ablations",
      variantSetLabel: "Greedy deterministic ablation variants",
      requestedVariantSetLabel: "Greedy deterministic ablation requested variants",
      unknownVariantLabel: "Greedy deterministic ablation variant"
    },
    "baseline"
  );
}

export function listGreedyDeterministicAblationCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "Greedy deterministic ablation",
    corpusLabel: "Greedy deterministic ablation"
  });
}

export function listGreedyDeterministicAblationVariantNames(): GreedyDeterministicAblationVariantName[] {
  return DEFAULT_GREEDY_DETERMINISTIC_ABLATION_VARIANTS.map((variant) => variant.name);
}

function formatOptionalRate(value: number | null | undefined): string {
  return value == null ? "n/a" : formatRate(value);
}

function formatOptionalDecimal(value: number | null | undefined): string {
  return value == null ? "n/a" : value.toFixed(3);
}

export function runGreedyDeterministicAblation(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
  options: GreedyDeterministicAblationRunOptions = {}
): GreedyDeterministicAblationSuiteResult {
  const names = options.names?.length ? options.names : undefined;
  const variants = normalizeVariants(options.variants, options.variantNames);
  const { seeds, seedRuns } = buildBenchmarkSeedRunPlan(options.seeds, "Greedy deterministic ablation seeds");
  const baseGreedy = {
    profile: false,
    ...(options.greedy ?? {})
  };
  const benchmarkCasesByName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const suites = new Map<string, ReturnType<typeof runGreedyBenchmarkSuite>>();
  for (const seed of seedRuns) {
    for (const variant of variants) {
      suites.set(
        `${seed ?? "case-default"}:${variant.name}`,
        runGreedyBenchmarkSuite(corpus, {
          names,
          greedy: {
            ...baseGreedy,
            ...(variant.name === "baseline" ? (options.baselineGreedy ?? {}) : {}),
            ...variant.greedy,
            ...(seed !== null ? { randomSeed: seed } : {})
          }
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
          throw new Error(
            `Greedy deterministic ablation result missing: ${variant.name}/${baselineResult.name}/${seed ?? "case-default"}.`
          );
        }
        return variantResult(
          variant,
          result,
          baselineResult,
          seed,
          benchmarkCasesByName.get(baselineResult.name) ?? null
        );
      });
      return {
        name: baselineResult.name,
        description: baselineResult.description,
        seed,
        gridRows: baselineResult.gridRows,
        gridCols: baselineResult.gridCols,
        gridCells: baselineResult.gridRows * baselineResult.gridCols,
        baseline: variantResults.find((entry) => entry.variantName === "baseline")!,
        variants: variantResults
      };
    });
  });

  const selectedCaseNames = uniqueBenchmarkValuesBy(cases, (entry) => entry.name);

  return {
    ...buildBenchmarkSuiteMetadata(selectedCaseNames),
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    variants: variants.map((variant) => variant.name),
    coverage: buildCoverage(cases, selectedCaseNames.length, seedRuns.length),
    variantSummaries: variants.map((variant) =>
      buildVariantSummary(variant, cases, selectedCaseNames.length, seedRuns.length)
    ),
    cases
  };
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
    variantSummaries: result.variantSummaries.map(snapshotBenchmarkVariantSummary),
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baseline: snapshotBenchmarkVariantResult(benchmarkCase.baseline),
      variants: benchmarkCase.variants.map(snapshotBenchmarkVariantResult)
    }))
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
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} util-mean=${formatOptionalRate(summary.meanCapacityUtilization)} closed/s-mean=${formatOptionalDecimal(summary.meanGapClosedPerSecond)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} unchanged-rate=${formatRate(summary.unchangedRate)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  lines.push("");

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(`- ${benchmarkCase.name} seed=${seedLabel}: ${benchmarkCase.description}`);
    for (const variant of benchmarkCase.variants) {
      lines.push(
        `  ${variant.variantName}=population:${variant.totalPopulation} delta:${formatSigned(variant.populationDeltaVsBaseline)} wall:${formatSeconds(variant.wallClockSeconds)} wall-delta:${formatSeconds(variant.wallClockDeltaVsBaselineSeconds)} attainment:${formatPopulationAttainmentMetrics(variant.attainment)} roads:${variant.roadCount} road-delta:${formatSigned(variant.roadDeltaVsBaseline)} services:${variant.serviceCount} residentials:${variant.residentialCount} phases:${variant.phaseCount}`
      );
    }
  }

  return lines.join("\n");
}
