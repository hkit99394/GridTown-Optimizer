import type { GreedyOptions, Grid, OptimizerName, Solution, SolverParams } from "../core/index.js";

export interface NamedBenchmarkCase {
  name: string;
}

export interface BenchmarkCaseSelectionLabels {
  caseLabel: string;
  corpusLabel: string;
}

export interface NamedBenchmarkVariant<TName extends string = string> {
  name: TName;
}

export interface BenchmarkVariantSelectionLabels {
  suiteLabel: string;
  variantSetLabel: string;
  requestedVariantSetLabel: string;
  unknownVariantLabel: string;
}

export interface BenchmarkSuiteMetadata {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
}

export interface BenchmarkVariantResultMetrics<TName extends string = string> {
  variantName: TName;
  seed: number | null;
  totalPopulation: number;
  populationDeltaVsBaseline: number;
  wallClockSeconds: number;
  wallClockDeltaVsBaselineSeconds: number;
  timeToBestWallClockSeconds?: number | null;
  timeToBestWallClockDeltaVsBaselineSeconds?: number | null;
}

export interface BenchmarkVariantCaseMetrics<
  TResult extends BenchmarkVariantResultMetrics = BenchmarkVariantResultMetrics
> {
  name: string;
  variants: readonly TResult[];
}

export interface BenchmarkVariantSummaryMetrics<TName extends string = string> {
  variantName: TName;
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
  meanTimeToBestWallClockSeconds?: number | null;
  meanTimeToBestWallClockDeltaVsBaselineSeconds?: number | null;
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

export interface BenchmarkVariantCoverageMetrics {
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  variantCount: number;
  runCount: number;
  gridCellCount: number;
}

export interface BenchmarkVariantCoverageCase<TVariant = unknown> {
  gridCells: number;
  variants: readonly TVariant[];
}

export type BenchmarkVariantResultSnapshot<TResult extends BenchmarkVariantResultMetrics> = Omit<
  TResult,
  | "wallClockSeconds"
  | "wallClockDeltaVsBaselineSeconds"
  | "timeToBestWallClockSeconds"
  | "timeToBestWallClockDeltaVsBaselineSeconds"
>;

export type BenchmarkVariantSummarySnapshot<TSummary extends BenchmarkVariantSummaryMetrics> = Omit<
  TSummary,
  | "meanWallClockSeconds"
  | "meanWallClockDeltaVsBaselineSeconds"
  | "meanTimeToBestWallClockSeconds"
  | "meanTimeToBestWallClockDeltaVsBaselineSeconds"
>;

export type BenchmarkOptionsWithDefaults<TOptions extends object, TDefaults extends Partial<TOptions>> = TOptions & {
  [K in keyof TDefaults]-?: NonNullable<TDefaults[K]>;
};

export function cloneBenchmarkGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

export function cloneBenchmarkSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

export function cloneBenchmarkOptions<TOptions>(options: TOptions): TOptions {
  return structuredClone(options);
}

export function roundBenchmarkMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function sumBenchmarkValues(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function sumBenchmarkBy<T>(values: readonly T[], selector: (value: T) => number): number {
  return values.reduce((total, value) => total + selector(value), 0);
}

export function countBenchmarkMatches<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  return values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
}

export function meanBenchmarkValue(values: readonly number[]): number {
  return values.length === 0 ? 0 : sumBenchmarkValues(values) / values.length;
}

export function meanNullableBenchmarkValue(values: ReadonlyArray<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length ? meanBenchmarkValue(finiteValues) : null;
}

export function percentileBenchmarkValue(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue)));
  return sorted[index]!;
}

export function benchmarkRatio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function formatBenchmarkSignedNumber(value: number): string {
  return value > 0 ? `+${Number(value).toLocaleString()}` : Number(value).toLocaleString();
}

export function formatNullableBenchmarkSignedNumber(value: number | null): string {
  return value === null ? "n/a" : formatBenchmarkSignedNumber(value);
}

export function formatNullableBenchmarkNumber(value: number | null): string {
  return value === null ? "n/a" : Number(value).toLocaleString();
}

export function formatBenchmarkSeconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

export function formatNullableBenchmarkSeconds(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatBenchmarkSeconds(value) : "n/a";
}

export function formatBenchmarkDecimal(value: number): string {
  return Number.isInteger(value) ? Number(value).toLocaleString() : value.toFixed(1);
}

export function formatBenchmarkRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatBenchmarkSeedCase(caseName: string | null, seed: number | null): string {
  if (!caseName) return "n/a";
  return seed === null ? `${caseName}/case-default` : `${caseName}/seed:${seed}`;
}

export function uniqueBenchmarkValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function uniqueBenchmarkValuesBy<T, TValue>(values: readonly T[], selector: (value: T) => TValue): TValue[] {
  return uniqueBenchmarkValues(values.map(selector));
}

export function groupBenchmarkValuesBy<T, TValue>(
  values: readonly T[],
  selector: (value: T) => TValue
): Map<TValue, T[]> {
  const groups = new Map<TValue, T[]>();
  for (const value of values) {
    const key = selector(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

export function benchmarkGeneratedAt(): string {
  return new Date().toISOString();
}

export function buildBenchmarkSuiteMetadata(caseNames: readonly string[]): BenchmarkSuiteMetadata {
  return {
    generatedAt: benchmarkGeneratedAt(),
    caseCount: caseNames.length,
    selectedCaseNames: [...caseNames]
  };
}

export function assertBenchmarkCasesSelected<TCase>(selected: readonly TCase[], emptySelectionMessage: string): void {
  if (selected.length === 0) {
    throw new Error(emptySelectionMessage);
  }
}

export function applyBenchmarkOptionDefaults<TOptions extends object, TDefaults extends Partial<TOptions>>(
  options: TOptions | undefined,
  overrides: Partial<TOptions> | undefined,
  defaults: TDefaults
): BenchmarkOptionsWithDefaults<TOptions, TDefaults> {
  const merged = { ...(options ?? {}), ...(overrides ?? {}) } as Record<string, unknown>;
  const normalized = { ...merged };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    normalized[key] = merged[key] ?? defaultValue;
  }
  return normalized as BenchmarkOptionsWithDefaults<TOptions, TDefaults>;
}

export function selectBenchmarkVariants<TName extends string, TVariant extends NamedBenchmarkVariant<TName>>(
  variants: readonly TVariant[] | undefined,
  defaultVariants: readonly TVariant[],
  requestedVariantNames: readonly TName[] | undefined,
  labels: BenchmarkVariantSelectionLabels,
  baselineName: TName
): readonly TVariant[] {
  const normalized = variants ?? defaultVariants;
  if (normalized.length === 0) {
    throw new Error(`${labels.suiteLabel} must include at least one variant.`);
  }

  const names = normalized.map((variant) => variant.name);
  if (!names.includes(baselineName)) {
    throw new Error(`${labels.suiteLabel} must include the ${baselineName} variant.`);
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`${labels.variantSetLabel} must use unique names.`);
  }
  if (!requestedVariantNames?.length) {
    return normalized;
  }

  const byName = new Map(normalized.map((variant) => [variant.name, variant]));
  const requestedNames = [baselineName, ...requestedVariantNames.filter((name) => name !== baselineName)];
  if (new Set(requestedNames).size !== requestedNames.length) {
    throw new Error(`${labels.requestedVariantSetLabel} must use unique names.`);
  }

  const missing = requestedNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown ${labels.unknownVariantLabel}(s): ${missing.join(", ")}. Available variants: ${names.join(", ")}.`
    );
  }
  return requestedNames.map((name) => byName.get(name)!);
}

function findBenchmarkVariantResult<TName extends string, TResult extends BenchmarkVariantResultMetrics<TName>>(
  variantName: TName,
  entry: BenchmarkVariantCaseMetrics<TResult>,
  missingResultMessage: string
): TResult {
  const result = entry.variants.find((candidate) => candidate.variantName === variantName);
  if (!result) {
    throw new Error(missingResultMessage);
  }
  return result;
}

function benchmarkVariantSeedCaseLabel<TName extends string, TResult extends BenchmarkVariantResultMetrics<TName>>(
  result: TResult | null,
  cases: readonly BenchmarkVariantCaseMetrics<TResult>[]
): { caseName: string | null; seed: number | null } {
  if (!result) {
    return { caseName: null, seed: null };
  }
  const match = cases.find((entry) =>
    entry.variants.some((candidate) => candidate.variantName === result.variantName && candidate === result)
  );
  return {
    caseName: match?.name ?? null,
    seed: result.seed
  };
}

export function summarizeBenchmarkVariantMetrics<
  TName extends string,
  TResult extends BenchmarkVariantResultMetrics<TName>
>(
  variantName: TName,
  cases: readonly BenchmarkVariantCaseMetrics<TResult>[],
  caseCount: number,
  seedCount: number,
  missingResultMessage: string
): BenchmarkVariantSummaryMetrics<TName> {
  const results = cases.map((entry) => findBenchmarkVariantResult(variantName, entry, missingResultMessage));
  const populations = results.map((entry) => entry.totalPopulation);
  const populationDeltas = results.map((entry) => entry.populationDeltaVsBaseline);
  const improvedCaseCount = countBenchmarkMatches(results, (entry) => entry.populationDeltaVsBaseline > 0);
  const regressedCaseCount = countBenchmarkMatches(results, (entry) => entry.populationDeltaVsBaseline < 0);
  const unchangedCaseCount = countBenchmarkMatches(results, (entry) => entry.populationDeltaVsBaseline === 0);
  const worstDeltaResult = results.reduce<TResult | null>(
    (worst, entry) =>
      worst === null || entry.populationDeltaVsBaseline < worst.populationDeltaVsBaseline ? entry : worst,
    null
  );
  const bestDeltaResult = results.reduce<TResult | null>(
    (best, entry) => (best === null || entry.populationDeltaVsBaseline > best.populationDeltaVsBaseline ? entry : best),
    null
  );
  const worstDeltaLabel = benchmarkVariantSeedCaseLabel(worstDeltaResult, cases);
  const bestDeltaLabel = benchmarkVariantSeedCaseLabel(bestDeltaResult, cases);

  return {
    variantName,
    caseCount,
    seedCount,
    comparisonCount: results.length,
    meanPopulation: meanBenchmarkValue(populations),
    medianPopulation: percentileBenchmarkValue(populations, 0.5),
    worstDecilePopulation: percentileBenchmarkValue(populations, 0.1),
    bestPopulation: populations.length ? Math.max(...populations) : 0,
    meanPopulationDeltaVsBaseline: meanBenchmarkValue(populationDeltas),
    medianPopulationDeltaVsBaseline: percentileBenchmarkValue(populationDeltas, 0.5),
    worstDecilePopulationDeltaVsBaseline: percentileBenchmarkValue(populationDeltas, 0.1),
    bestPopulationDeltaVsBaseline: populationDeltas.length ? Math.max(...populationDeltas) : 0,
    meanWallClockSeconds: meanBenchmarkValue(results.map((entry) => entry.wallClockSeconds)),
    meanWallClockDeltaVsBaselineSeconds: meanBenchmarkValue(
      results.map((entry) => entry.wallClockDeltaVsBaselineSeconds)
    ),
    improvedCaseCount,
    regressedCaseCount,
    unchangedCaseCount,
    winRate: benchmarkRatio(improvedCaseCount, results.length),
    regressionRate: benchmarkRatio(regressedCaseCount, results.length),
    unchangedRate: benchmarkRatio(unchangedCaseCount, results.length),
    worstPopulationDeltaVsBaseline: populationDeltas.length ? Math.min(...populationDeltas) : 0,
    worstPopulationDeltaCaseName: worstDeltaLabel.caseName,
    worstPopulationDeltaSeed: worstDeltaLabel.seed,
    bestPopulationDeltaCaseName: bestDeltaLabel.caseName,
    bestPopulationDeltaSeed: bestDeltaLabel.seed
  };
}

export function buildBenchmarkVariantCoverage<TVariant>(
  cases: readonly BenchmarkVariantCoverageCase<TVariant>[],
  caseCount: number,
  seedCount: number
): BenchmarkVariantCoverageMetrics {
  const variants = cases.flatMap((entry) => entry.variants);
  return {
    caseCount,
    seedCount,
    comparisonCount: cases.length,
    variantCount: cases[0]?.variants.length ?? 0,
    runCount: variants.length,
    gridCellCount: sumBenchmarkBy(cases, (entry) => entry.gridCells)
  };
}

export function snapshotBenchmarkVariantResult<TResult extends BenchmarkVariantResultMetrics>(
  result: TResult
): BenchmarkVariantResultSnapshot<TResult> {
  const {
    wallClockSeconds: _wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: _wallClockDeltaVsBaselineSeconds,
    timeToBestWallClockSeconds: _timeToBestWallClockSeconds,
    timeToBestWallClockDeltaVsBaselineSeconds: _timeToBestWallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = result;
  return snapshot;
}

export function snapshotBenchmarkVariantSummary<TSummary extends BenchmarkVariantSummaryMetrics>(
  summary: TSummary
): BenchmarkVariantSummarySnapshot<TSummary> {
  const {
    meanWallClockSeconds: _meanWallClockSeconds,
    meanWallClockDeltaVsBaselineSeconds: _meanWallClockDeltaVsBaselineSeconds,
    meanTimeToBestWallClockSeconds: _meanTimeToBestWallClockSeconds,
    meanTimeToBestWallClockDeltaVsBaselineSeconds: _meanTimeToBestWallClockDeltaVsBaselineSeconds,
    ...snapshot
  } = summary;
  return snapshot;
}

export function safePopulationRate(population: number, seconds: number | null): number | null {
  return seconds !== null && seconds > 0 ? roundBenchmarkMetric(population / seconds) : null;
}

export function observedCpSatWorkerCpuSeconds(
  solution: Pick<Solution, "cpSatPortfolio" | "cpSatTelemetry">
): number | null {
  const portfolioWorkerTimes = solution.cpSatPortfolio?.workers
    .map((worker) => worker.telemetry?.userTimeSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (portfolioWorkerTimes?.length) {
    return roundBenchmarkMetric(portfolioWorkerTimes.reduce((sum, value) => sum + value, 0));
  }
  return typeof solution.cpSatTelemetry?.userTimeSeconds === "number"
    ? roundBenchmarkMetric(solution.cpSatTelemetry.userTimeSeconds)
    : null;
}

export function inheritGreedyBenchmarkOptions<TGreedyOptions extends GreedyOptions>(
  params: SolverParams
): TGreedyOptions {
  const benchmarkGreedy = (params.greedy ?? {}) as TGreedyOptions;
  return {
    ...benchmarkGreedy,
    localSearch: benchmarkGreedy.localSearch ?? params.localSearch,
    restarts: benchmarkGreedy.restarts ?? params.restarts,
    serviceRefineIterations: benchmarkGreedy.serviceRefineIterations ?? params.serviceRefineIterations,
    serviceRefineCandidateLimit: benchmarkGreedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit,
    exhaustiveServiceSearch: benchmarkGreedy.exhaustiveServiceSearch ?? params.exhaustiveServiceSearch,
    serviceExactPoolLimit: benchmarkGreedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit,
    serviceExactMaxCombinations: benchmarkGreedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations
  };
}

export function applyNormalizedGreedyBenchmarkParams<TGreedyOptions extends GreedyOptions>(
  params: SolverParams,
  greedy: TGreedyOptions,
  optimizer?: OptimizerName
): SolverParams {
  return {
    ...params,
    ...(optimizer ? { optimizer } : {}),
    greedy,
    localSearch: greedy.localSearch,
    restarts: greedy.restarts,
    serviceRefineIterations: greedy.serviceRefineIterations,
    serviceRefineCandidateLimit: greedy.serviceRefineCandidateLimit,
    exhaustiveServiceSearch: greedy.exhaustiveServiceSearch,
    serviceExactPoolLimit: greedy.serviceExactPoolLimit,
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations
  };
}

function assertUniqueBenchmarkCaseNames<TCase extends NamedBenchmarkCase>(
  corpus: readonly TCase[],
  labels: BenchmarkCaseSelectionLabels
): void {
  const names = corpus.map((benchmarkCase) => benchmarkCase.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`${labels.corpusLabel} corpus must use unique case names.`);
  }
}

export function selectBenchmarkCasesByName<TCase extends NamedBenchmarkCase>(
  corpus: readonly TCase[],
  names: readonly string[] | undefined,
  labels: BenchmarkCaseSelectionLabels
): TCase[] {
  assertUniqueBenchmarkCaseNames(corpus, labels);
  if (!names?.length) {
    return [...corpus];
  }

  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown ${labels.caseLabel} case(s): ${missing.join(", ")}. Available cases: ${corpus
        .map((benchmarkCase) => benchmarkCase.name)
        .join(", ")}.`
    );
  }

  return names.map((name) => byName.get(name) as TCase);
}

export function listBenchmarkCaseNames<TCase extends NamedBenchmarkCase>(
  corpus: readonly TCase[],
  labels: BenchmarkCaseSelectionLabels
): string[] {
  assertUniqueBenchmarkCaseNames(corpus, labels);
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

export function dedupeBenchmarkCases<TCase extends NamedBenchmarkCase>(
  corpora: readonly (readonly TCase[])[]
): TCase[] {
  const byName = new Map<string, TCase>();
  for (const corpus of corpora) {
    for (const benchmarkCase of corpus) {
      if (!byName.has(benchmarkCase.name)) {
        byName.set(benchmarkCase.name, benchmarkCase);
      }
    }
  }
  return [...byName.values()];
}

export function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function nonNegativeIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function positiveFiniteNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
