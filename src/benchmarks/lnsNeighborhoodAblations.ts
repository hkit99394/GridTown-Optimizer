import { formatBenchmarkSeeds, normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
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

export interface LnsNeighborhoodAblationVariantSummary {
  variantName: LnsNeighborhoodAblationVariantName;
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
  firstWindowMovementCount: number;
  firstWindowMovementRate: number;
  windowSequenceMovementCount: number;
  windowSequenceMovementRate: number;
  anchorCoordinateMovementCount: number;
  anchorCoordinateMovementRate: number;
}

export interface LnsNeighborhoodAblationCoverage {
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  variantCount: number;
  runCount: number;
  gridCellCount: number;
}

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
  extends Omit<
    LnsNeighborhoodAblationVariantResult,
    "wallClockSeconds" | "wallClockDeltaVsBaselineSeconds"
  > {}

export interface LnsNeighborhoodAblationSnapshotCaseResult
  extends Omit<LnsNeighborhoodAblationCaseResult, "baseline" | "variants"> {
  baseline: LnsNeighborhoodAblationSnapshotVariantResult;
  variants: LnsNeighborhoodAblationSnapshotVariantResult[];
}

export interface LnsNeighborhoodAblationSnapshotVariantSummary
  extends Omit<
    LnsNeighborhoodAblationVariantSummary,
    "meanWallClockSeconds" | "meanWallClockDeltaVsBaselineSeconds"
  > {}

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
  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  return DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES.map((name) => {
    const benchmarkCase = byName.get(name);
    if (!benchmarkCase) {
      throw new Error(`LNS neighborhood ablation case not found: ${name}.`);
    }
    return benchmarkCase;
  });
}

export const DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS: readonly LnsBenchmarkCase[] =
  Object.freeze(selectDefaultAblationCases(DEFAULT_LNS_BENCHMARK_CORPUS));

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

function seedCaseLabel(
  result: LnsNeighborhoodAblationVariantResult,
  cases: readonly LnsNeighborhoodAblationCaseResult[]
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

function normalizeVariants(
  variants: readonly LnsNeighborhoodAblationVariant[] | undefined,
  variantNames: readonly LnsNeighborhoodAblationVariantName[] | undefined
): readonly LnsNeighborhoodAblationVariant[] {
  const baseVariants = variants ?? DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS;
  if (baseVariants.length === 0) {
    throw new Error("LNS neighborhood ablations must include at least one variant.");
  }
  const names = baseVariants.map((variant) => variant.name);
  if (!names.includes("baseline")) {
    throw new Error("LNS neighborhood ablations must include the baseline variant.");
  }
  if (new Set(names).size !== names.length) {
    throw new Error("LNS neighborhood ablation variants must use unique names.");
  }
  if (!variantNames || variantNames.length === 0) {
    return baseVariants;
  }

  const byName = new Map(baseVariants.map((variant) => [variant.name, variant]));
  const requestedNames: LnsNeighborhoodAblationVariantName[] = [
    "baseline",
    ...variantNames.filter((name) => name !== "baseline"),
  ];
  if (new Set(requestedNames).size !== requestedNames.length) {
    throw new Error("LNS neighborhood ablation requested variants must use unique names.");
  }
  const missing = requestedNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown LNS neighborhood ablation variant(s): ${missing.join(", ")}. Available variants: ${names.join(", ")}.`
    );
  }
  return requestedNames.map((name) => byName.get(name)!);
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
  const results = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(`LNS neighborhood ablation variant result missing: ${variant.name}.`);
    }
    return result;
  });
  const populations = results.map((entry) => entry.totalPopulation);
  const populationDeltas = results.map((entry) => entry.populationDeltaVsBaseline);
  const improvedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline > 0).length;
  const regressedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline < 0).length;
  const unchangedCaseCount = results.filter((entry) => entry.populationDeltaVsBaseline === 0).length;
  const firstWindowMovementCount = cases.filter((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(`LNS neighborhood ablation variant result missing: ${variant.name}.`);
    }
    return firstWindowMoved(entry.baseline, result);
  }).length;
  const windowSequenceMovementCount = cases.filter((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(`LNS neighborhood ablation variant result missing: ${variant.name}.`);
    }
    return windowSequenceKey(entry.baseline) !== windowSequenceKey(result);
  }).length;
  const anchorCoordinateMovementCount = cases.filter((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variant.name);
    if (!result) {
      throw new Error(`LNS neighborhood ablation variant result missing: ${variant.name}.`);
    }
    return anchorCoordinateSequenceKey(entry.baseline) !== anchorCoordinateSequenceKey(result);
  }).length;
  const worstDeltaResult = results.reduce<LnsNeighborhoodAblationVariantResult | null>(
    (worst, entry) => (worst === null || entry.populationDeltaVsBaseline < worst.populationDeltaVsBaseline ? entry : worst),
    null
  );
  const bestDeltaResult = results.reduce<LnsNeighborhoodAblationVariantResult | null>(
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
    firstWindowMovementCount,
    firstWindowMovementRate: ratio(firstWindowMovementCount, results.length),
    windowSequenceMovementCount,
    windowSequenceMovementRate: ratio(windowSequenceMovementCount, results.length),
    anchorCoordinateMovementCount,
    anchorCoordinateMovementRate: ratio(anchorCoordinateMovementCount, results.length),
  };
}

function buildCoverage(
  cases: readonly LnsNeighborhoodAblationCaseResult[],
  caseCount: number,
  seedCount: number
): LnsNeighborhoodAblationCoverage {
  const variants = cases.flatMap((entry) => entry.variants);
  return {
    caseCount,
    seedCount,
    comparisonCount: cases.length,
    variantCount: cases[0]?.variants.length ?? 0,
    runCount: variants.length,
    gridCellCount: cases.reduce((total, entry) => total + entry.gridCells, 0),
  };
}

export function listLnsNeighborhoodAblationCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS
): string[] {
  return corpus.map((benchmarkCase) => benchmarkCase.name);
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
  const seeds = normalizeBenchmarkSeeds(options.seeds, "LNS neighborhood ablation seeds") ?? [];
  const seedRuns: readonly (number | null)[] = seeds.length ? seeds : [null];
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

  const selectedCaseNames = [...new Set(cases.map((entry) => entry.name))];

  return {
    generatedAt: new Date().toISOString(),
    caseCount: selectedCaseNames.length,
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    selectedCaseNames,
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
  result: LnsNeighborhoodAblationVariantResult
): LnsNeighborhoodAblationSnapshotVariantResult {
  const {
    wallClockSeconds: _wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: _wallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = result;
  return snapshot;
}

function snapshotVariantSummary(
  summary: LnsNeighborhoodAblationVariantSummary
): LnsNeighborhoodAblationSnapshotVariantSummary {
  const {
    meanWallClockSeconds: _meanWallClockSeconds,
    meanWallClockDeltaVsBaselineSeconds: _meanWallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = summary;
  return snapshot;
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
    variantSummaries: result.variantSummaries.map(snapshotVariantSummary),
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baseline: snapshotVariantResult(benchmarkCase.baseline),
      variants: benchmarkCase.variants.map(snapshotVariantResult),
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
