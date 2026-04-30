import { buildBenchmarkSeedRunPlan, formatBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  benchmarkRatio,
  buildBenchmarkVariantCoverage,
  buildBenchmarkSuiteMetadata,
  countBenchmarkMatches,
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
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import {
  DEFAULT_LNS_BENCHMARK_CORPUS,
  runLnsBenchmarkSuite,
} from "./lns.js";

import type {
  LnsBenchmarkCase,
  LnsBenchmarkCaseResult,
  LnsBenchmarkRunOptions,
} from "./lns.js";
import type { LnsOptions } from "../core/types.js";
import type {
  BenchmarkVariantCoverageMetrics,
  BenchmarkVariantResultSnapshot,
  BenchmarkVariantSummaryMetrics,
  BenchmarkVariantSummarySnapshot,
} from "./benchmarkOptions.js";

export type LnsNeighborhoodAblationVariantName =
  | "baseline"
  | "sliding-only"
  | "weak-service-first"
  | "residential-opportunity-first"
  | "frontier-congestion-first"
  | "placed-buildings-first"
  | "small-2x2"
  | "wide-4x4";

export interface LnsNeighborhoodAblationVariant {
  name: LnsNeighborhoodAblationVariantName;
  description: string;
  lns: Partial<LnsOptions>;
}

export interface LnsNeighborhoodAblationRunOptions extends LnsBenchmarkRunOptions {
  variants?: readonly LnsNeighborhoodAblationVariant[];
  variantNames?: readonly LnsNeighborhoodAblationVariantName[];
  seeds?: readonly number[];
  rotateVariantRunOrder?: boolean;
}

export interface LnsNeighborhoodAblationOutcome {
  iteration: number;
  phase: string;
  status: string;
  improvement: number;
  populationBefore: number;
  populationAfter: number;
  window: {
    top: number;
    left: number;
    rows: number;
    cols: number;
  };
}

export interface LnsNeighborhoodAblationVariantResult {
  variantName: LnsNeighborhoodAblationVariantName;
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
  outcomes: LnsNeighborhoodAblationOutcome[];
}

export interface LnsNeighborhoodAblationCaseResult {
  name: string;
  description: string;
  seed: number | null;
  gridRows: number;
  gridCols: number;
  gridCells: number;
  baseline: LnsNeighborhoodAblationVariantResult;
  variants: LnsNeighborhoodAblationVariantResult[];
}

export interface LnsNeighborhoodAblationVariantSummary
  extends BenchmarkVariantSummaryMetrics<LnsNeighborhoodAblationVariantName> {
  description: string;
  firstWindowMovementCount: number;
  firstWindowMovementRate: number;
  windowSequenceMovementCount: number;
  windowSequenceMovementRate: number;
  anchorCoordinateMovementCount: number;
  anchorCoordinateMovementRate: number;
}

export interface LnsNeighborhoodAblationCoverage extends BenchmarkVariantCoverageMetrics {}

export interface LnsNeighborhoodAblationVariantExecutionOrder {
  seed: number | null;
  variants: LnsNeighborhoodAblationVariantName[];
}

export interface LnsNeighborhoodAblationSuiteResult {
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  variants: LnsNeighborhoodAblationVariantName[];
  variantExecutionOrders: LnsNeighborhoodAblationVariantExecutionOrder[];
  coverage: LnsNeighborhoodAblationCoverage;
  variantSummaries: LnsNeighborhoodAblationVariantSummary[];
  cases: LnsNeighborhoodAblationCaseResult[];
}

export interface LnsNeighborhoodAblationSnapshotVariantResult
  extends BenchmarkVariantResultSnapshot<LnsNeighborhoodAblationVariantResult> {}

export interface LnsNeighborhoodAblationSnapshotCaseResult
  extends Omit<LnsNeighborhoodAblationCaseResult, "baseline" | "variants"> {
  baseline: LnsNeighborhoodAblationSnapshotVariantResult;
  variants: LnsNeighborhoodAblationSnapshotVariantResult[];
}

export interface LnsNeighborhoodAblationSnapshotVariantSummary
  extends BenchmarkVariantSummarySnapshot<LnsNeighborhoodAblationVariantSummary> {}

export interface LnsNeighborhoodAblationSnapshot
  extends Omit<LnsNeighborhoodAblationSuiteResult, "generatedAt" | "variantSummaries" | "cases"> {
  variantSummaries: LnsNeighborhoodAblationSnapshotVariantSummary[];
  cases: LnsNeighborhoodAblationSnapshotCaseResult[];
}

export const DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS: readonly LnsNeighborhoodAblationVariant[] =
  Object.freeze([
    {
      name: "baseline",
      description: "Current ranked LNS anchors plus sliding fallback windows.",
      lns: { neighborhoodAnchorPolicy: "ranked" },
    },
    {
      name: "sliding-only",
      description: "Disable ranked anchors and use only deterministic sliding windows.",
      lns: { neighborhoodAnchorPolicy: "sliding-only" },
    },
    {
      name: "weak-service-first",
      description: "Rank repair windows from weak service marginal-value anchors plus sliding fallback.",
      lns: { neighborhoodAnchorPolicy: "weak-service-first" },
    },
    {
      name: "residential-opportunity-first",
      description: "Rank repair windows from residential headroom anchors plus sliding fallback.",
      lns: { neighborhoodAnchorPolicy: "residential-opportunity-first" },
    },
    {
      name: "frontier-congestion-first",
      description: "Rank repair windows from road-frontier congestion anchors plus sliding fallback.",
      lns: { neighborhoodAnchorPolicy: "frontier-congestion-first" },
    },
    {
      name: "placed-buildings-first",
      description: "Use incumbent service and weak-residential anchors without the ranked feature groups.",
      lns: { neighborhoodAnchorPolicy: "placed-buildings-first" },
    },
    {
      name: "small-2x2",
      description: "Keep ranked anchors but constrain repair windows to 2x2.",
      lns: { neighborhoodAnchorPolicy: "ranked", neighborhoodRows: 2, neighborhoodCols: 2 },
    },
    {
      name: "wide-4x4",
      description: "Keep ranked anchors but expand repair windows to 4x4.",
      lns: { neighborhoodAnchorPolicy: "ranked", neighborhoodRows: 4, neighborhoodCols: 4 },
    },
  ]);

export const DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES = Object.freeze([
  "typed-housing-single",
  "compact-service-repair",
  "seeded-service-anchor-pressure",
  "row0-anchor-repair",
] satisfies string[]);

function selectDefaultAblationCases(corpus: readonly LnsBenchmarkCase[]): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES, {
    caseLabel: "LNS neighborhood ablation",
    corpusLabel: "LNS neighborhood ablation",
  });
}

export const DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS: readonly LnsBenchmarkCase[] =
  Object.freeze(selectDefaultAblationCases(DEFAULT_LNS_BENCHMARK_CORPUS));

function firstWindowMoved(
  baseline: LnsNeighborhoodAblationVariantResult,
  variant: LnsNeighborhoodAblationVariantResult
): boolean {
  const baselineWindow = baseline.outcomes[0]?.window ?? null;
  const variantWindow = variant.outcomes[0]?.window ?? null;
  if (baselineWindow === null || variantWindow === null) return baselineWindow !== variantWindow;
  return baselineWindow.top !== variantWindow.top
    || baselineWindow.left !== variantWindow.left
    || baselineWindow.rows !== variantWindow.rows
    || baselineWindow.cols !== variantWindow.cols;
}

function windowSequenceKey(result: LnsNeighborhoodAblationVariantResult): string {
  return result.outcomes
    .map((outcome) =>
      `${outcome.window.top}:${outcome.window.left}:${outcome.window.rows}x${outcome.window.cols}`
    )
    .join("|");
}

function anchorCoordinateSequenceKey(result: LnsNeighborhoodAblationVariantResult): string {
  return result.outcomes
    .map((outcome) => `${outcome.window.top}:${outcome.window.left}`)
    .join("|");
}

function normalizeVariants(
  variants: readonly LnsNeighborhoodAblationVariant[] | undefined,
  variantNames: readonly LnsNeighborhoodAblationVariantName[] | undefined
): readonly LnsNeighborhoodAblationVariant[] {
  return selectBenchmarkVariants(
    variants,
    DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS,
    variantNames,
    {
      suiteLabel: "LNS neighborhood ablations",
      variantSetLabel: "LNS neighborhood ablation variants",
      requestedVariantSetLabel: "LNS neighborhood ablation requested variants",
      unknownVariantLabel: "LNS neighborhood ablation variant",
    },
    "baseline"
  );
}

function rotateVariantOrder(
  variants: readonly LnsNeighborhoodAblationVariant[],
  offset: number
): readonly LnsNeighborhoodAblationVariant[] {
  if (variants.length === 0) return variants;
  const normalizedOffset = offset % variants.length;
  if (normalizedOffset === 0) return variants;
  return [
    ...variants.slice(normalizedOffset),
    ...variants.slice(0, normalizedOffset),
  ];
}

function variantResult(
  variant: LnsNeighborhoodAblationVariant,
  result: LnsBenchmarkCaseResult,
  baseline: LnsBenchmarkCaseResult,
  seed: number | null
): LnsNeighborhoodAblationVariantResult {
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
    lnsOptions: result.lnsOptions,
    cpSatStatus: result.cpSatStatus,
    stopReason: result.lnsTelemetry?.stopReason ?? null,
    improvingIterations: result.lnsTelemetry?.improvingIterations ?? null,
    neutralIterations: result.lnsTelemetry?.neutralIterations ?? null,
    recoverableFailures: result.lnsTelemetry?.recoverableFailures ?? null,
    outcomes: result.lnsTelemetry?.outcomes.map((outcome) => ({
      iteration: outcome.iteration,
      phase: outcome.phase,
      status: outcome.status,
      improvement: outcome.improvement,
      populationBefore: outcome.populationBefore,
      populationAfter: outcome.populationAfter,
      window: { ...outcome.window },
    })) ?? [],
  };
}

function buildVariantSummary(
  variant: LnsNeighborhoodAblationVariant,
  cases: readonly LnsNeighborhoodAblationCaseResult[],
  caseCount: number,
  seedCount: number
): LnsNeighborhoodAblationVariantSummary {
  const missingResultMessage = `LNS neighborhood ablation variant result missing: ${variant.name}.`;
  const caseResults = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(missingResultMessage);
    }
    return { entry, result };
  });
  const firstWindowMovementCount = countBenchmarkMatches(caseResults, ({ entry, result }) =>
    firstWindowMoved(entry.baseline, result)
  );
  const windowSequenceMovementCount = countBenchmarkMatches(caseResults, ({ entry, result }) =>
    windowSequenceKey(entry.baseline) !== windowSequenceKey(result)
  );
  const anchorCoordinateMovementCount = countBenchmarkMatches(caseResults, ({ entry, result }) =>
    anchorCoordinateSequenceKey(entry.baseline) !== anchorCoordinateSequenceKey(result)
  );
  const comparisonCount = caseResults.length;
  return {
    ...summarizeBenchmarkVariantMetrics(variant.name, cases, caseCount, seedCount, missingResultMessage),
    description: variant.description,
    firstWindowMovementCount,
    firstWindowMovementRate: benchmarkRatio(firstWindowMovementCount, comparisonCount),
    windowSequenceMovementCount,
    windowSequenceMovementRate: benchmarkRatio(windowSequenceMovementCount, comparisonCount),
    anchorCoordinateMovementCount,
    anchorCoordinateMovementRate: benchmarkRatio(anchorCoordinateMovementCount, comparisonCount),
  };
}

function buildCoverage(
  cases: readonly LnsNeighborhoodAblationCaseResult[],
  caseCount: number,
  seedCount: number
): LnsNeighborhoodAblationCoverage {
  return buildBenchmarkVariantCoverage(cases, caseCount, seedCount);
}

export function listLnsNeighborhoodAblationCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "LNS neighborhood ablation",
    corpusLabel: "LNS neighborhood ablation",
  });
}

export function listLnsNeighborhoodAblationVariantNames(): LnsNeighborhoodAblationVariantName[] {
  return DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS.map((variant) => variant.name);
}

export function runLnsNeighborhoodAblation(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS,
  options: LnsNeighborhoodAblationRunOptions = {}
): LnsNeighborhoodAblationSuiteResult {
  const names = options.names?.length ? options.names : undefined;
  const variants = normalizeVariants(options.variants, options.variantNames);
  const { seeds, seedRuns } = buildBenchmarkSeedRunPlan(options.seeds, "LNS neighborhood ablation seeds");
  const rotateVariantRunOrder = options.rotateVariantRunOrder ?? seedRuns.length > 1;
  const variantExecutionOrders = seedRuns.map((seed, seedIndex) => {
    const orderedVariants = rotateVariantRunOrder
      ? rotateVariantOrder(variants, seedIndex)
      : variants;
    return {
      seed,
      orderedVariants,
      variants: orderedVariants.map((variant) => variant.name),
    };
  });
  const suites = new Map<string, ReturnType<typeof runLnsBenchmarkSuite>>();
  for (const executionOrder of variantExecutionOrders) {
    for (const variant of executionOrder.orderedVariants) {
      suites.set(
        `${executionOrder.seed ?? "case-default"}:${variant.name}`,
        runLnsBenchmarkSuite(corpus, {
          names,
          greedy: {
            ...(options.greedy ?? {}),
            ...(executionOrder.seed !== null ? { randomSeed: executionOrder.seed } : {}),
          },
          cpSat: {
            ...(options.cpSat ?? {}),
            ...(executionOrder.seed !== null ? { randomSeed: executionOrder.seed } : {}),
          },
          lns: {
            maxNoImprovementIterations: 4,
            ...(options.lns ?? {}),
            ...variant.lns,
          },
        })
      );
    }
  }

  const cases = seedRuns.flatMap((seed) => {
    const baselineSuite = suites.get(`${seed ?? "case-default"}:baseline`);
    if (!baselineSuite) {
      throw new Error(`LNS neighborhood ablation baseline suite missing for seed ${seed ?? "case-default"}.`);
    }
    return baselineSuite.results.map((baselineResult) => {
      const variantResults = variants.map((variant) => {
        const suite = suites.get(`${seed ?? "case-default"}:${variant.name}`);
        const result = suite?.results.find((entry) => entry.name === baselineResult.name);
        if (!result) {
          throw new Error(`LNS neighborhood ablation result missing: ${variant.name}/${baselineResult.name}/${seed ?? "case-default"}.`);
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

  const selectedCaseNames = uniqueBenchmarkValuesBy(cases, (entry) => entry.name);

  return {
    ...buildBenchmarkSuiteMetadata(selectedCaseNames),
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    variants: variants.map((variant) => variant.name),
    variantExecutionOrders: variantExecutionOrders.map((entry) => ({
      seed: entry.seed,
      variants: [...entry.variants],
    })),
    coverage: buildCoverage(cases, selectedCaseNames.length, seedRuns.length),
    variantSummaries: variants.map((variant) => buildVariantSummary(variant, cases, selectedCaseNames.length, seedRuns.length)),
    cases,
  };
}

export function createLnsNeighborhoodAblationSnapshot(
  result: LnsNeighborhoodAblationSuiteResult
): LnsNeighborhoodAblationSnapshot {
  return {
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    variants: [...result.variants],
    variantExecutionOrders: result.variantExecutionOrders.map((entry) => ({
      seed: entry.seed,
      variants: [...entry.variants],
    })),
    coverage: { ...result.coverage },
    variantSummaries: result.variantSummaries.map(snapshotBenchmarkVariantSummary),
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baseline: snapshotBenchmarkVariantResult(benchmarkCase.baseline),
      variants: benchmarkCase.variants.map(snapshotBenchmarkVariantResult),
    })),
  };
}

export function formatLnsNeighborhoodAblation(result: LnsNeighborhoodAblationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Neighborhood Ablation Matrix ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  if (result.variantExecutionOrders.length > 0) {
    lines.push(
      `Run order: ${result.variantExecutionOrders.map((entry) => {
        const seedLabel = entry.seed === null ? "case-default" : `seed:${entry.seed}`;
        return `${seedLabel}=${entry.variants.join(" > ")}`;
      }).join("; ")}`
    );
  }
  lines.push(
    `Coverage: cases=${result.coverage.caseCount} seeds=${result.coverage.seedCount} comparisons=${result.coverage.comparisonCount} runs=${result.coverage.runCount} variants=${result.coverage.variantCount} grid-cells=${result.coverage.gridCellCount}`
  );
  lines.push("Summary:");
  for (const summary of result.variantSummaries) {
    lines.push(
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} unchanged-rate=${formatRate(summary.unchangedRate)} first-window-moved=${summary.firstWindowMovementCount}/${summary.comparisonCount} first-window-move-rate=${formatRate(summary.firstWindowMovementRate)} window-sequence-moved=${summary.windowSequenceMovementCount}/${summary.comparisonCount} window-sequence-move-rate=${formatRate(summary.windowSequenceMovementRate)} anchor-coordinate-moved=${summary.anchorCoordinateMovementCount}/${summary.comparisonCount} anchor-coordinate-move-rate=${formatRate(summary.anchorCoordinateMovementRate)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  lines.push("");

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(`- ${benchmarkCase.name} seed=${seedLabel}: ${benchmarkCase.description}`);
    for (const variant of benchmarkCase.variants) {
      const firstOutcome = variant.outcomes[0];
      const firstWindow = firstOutcome
        ? `${firstOutcome.window.top}:${firstOutcome.window.left}:${firstOutcome.window.rows}x${firstOutcome.window.cols}/${firstOutcome.status}/+${firstOutcome.improvement}`
        : "n/a";
      lines.push(
        `  ${variant.variantName}=population:${variant.totalPopulation} delta:${formatSigned(variant.populationDeltaVsBaseline)} wall:${formatSeconds(variant.wallClockSeconds)} wall-delta:${formatSeconds(variant.wallClockDeltaVsBaselineSeconds)} roads:${variant.roadCount} road-delta:${formatSigned(variant.roadDeltaVsBaseline)} services:${variant.serviceCount} residentials:${variant.residentialCount} policy:${variant.lnsOptions.neighborhoodAnchorPolicy ?? "ranked"} window:${variant.lnsOptions.neighborhoodRows ?? "n/a"}x${variant.lnsOptions.neighborhoodCols ?? "n/a"} stop:${variant.stopReason ?? "n/a"} improved:${variant.improvingIterations ?? "n/a"} neutral:${variant.neutralIterations ?? "n/a"} first-window:${firstWindow}`
      );
    }
  }

  return lines.join("\n");
}
