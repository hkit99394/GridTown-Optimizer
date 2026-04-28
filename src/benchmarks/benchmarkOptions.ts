import type { GreedyOptions, Grid, OptimizerName, Solution, SolverParams } from "../core/types.js";

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

export type BenchmarkOptionsWithDefaults<TOptions extends object, TDefaults extends Partial<TOptions>> =
  TOptions & { [K in keyof TDefaults]-?: NonNullable<TDefaults[K]> };

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

export function meanBenchmarkValue(values: readonly number[]): number {
  return values.length === 0 ? 0 : sumBenchmarkValues(values) / values.length;
}

export function percentileBenchmarkValue(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))
  );
  return sorted[index]!;
}

export function benchmarkRatio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function uniqueBenchmarkValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function benchmarkGeneratedAt(): string {
  return new Date().toISOString();
}

export function buildBenchmarkSuiteMetadata(caseNames: readonly string[]): BenchmarkSuiteMetadata {
  return {
    generatedAt: benchmarkGeneratedAt(),
    caseCount: caseNames.length,
    selectedCaseNames: [...caseNames],
  };
}

export function assertBenchmarkCasesSelected<TCase>(
  selected: readonly TCase[],
  emptySelectionMessage: string
): void {
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

export function selectBenchmarkVariants<
  TName extends string,
  TVariant extends NamedBenchmarkVariant<TName>,
>(
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
  const requestedNames = [
    baselineName,
    ...requestedVariantNames.filter((name) => name !== baselineName),
  ];
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
    serviceExactMaxCombinations: benchmarkGreedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations,
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
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations,
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

export function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function nonNegativeIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function positiveFiniteNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
