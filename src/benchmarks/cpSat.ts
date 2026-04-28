import { performance } from "node:perf_hooks";

import { buildSolverProgressSummary, formatSolverProgressSummary } from "../core/progress.js";
import { solveAsync } from "../runtime/solve.js";

import type {
  CpSatAsyncOptions,
  CpSatOptions,
  CpSatPortfolioOptions,
  CpSatProgressUpdate,
  CpSatTelemetry,
  Grid,
  Solution,
  SolverParams,
  SolverProgressSummary,
} from "../core/types.js";

export interface CpSatBenchmarkCase {
  name: string;
  description: string;
  grid: Grid;
  params: SolverParams;
}

export interface CpSatBenchmarkRunOptions {
  names?: string[];
  includeProgressTimeline?: boolean;
  cpSat?: Partial<CpSatOptions>;
}

export type CpSatBenchmarkCpuPlanMode = "single" | "portfolio";
export type CpSatBenchmarkCpuAdmission = "within-budget" | "over-budget";

export interface CpSatBenchmarkCpuPlan {
  mode: CpSatBenchmarkCpuPlanMode;
  wallClockBudgetSeconds: number;
  workerCount: number;
  perWorkerNumWorkers: number;
  perWorkerTimeLimitSeconds: number;
  parallelWorkerCount: number;
  workerCpuBudgetSeconds: number;
  cpuBudgetMultiplier: number;
  totalCpuBudgetSeconds: number | null;
  cpuBudgetHeadroomSeconds: number | null;
  admission: CpSatBenchmarkCpuAdmission;
}

export interface CpSatBenchmarkProgressSample {
  atSeconds: number;
  update: CpSatProgressUpdate;
}

export interface CpSatBenchmarkCaseResult {
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  totalPopulation: number;
  cpSatStatus: string | null;
  cpSatTelemetry: CpSatTelemetry | null;
  cpSatObjectiveSummary: string | null;
  cpSatOptions: CpSatOptions;
  cpSatCpuPlan: CpSatBenchmarkCpuPlan;
  observedWorkerCpuSeconds: number | null;
  populationPerWorkerCpuBudgetSecond: number | null;
  populationPerObservedCpuSecond: number | null;
  progressTimeline: CpSatBenchmarkProgressSample[];
  progressSummary: SolverProgressSummary;
  wallClockSeconds: number;
}

export interface CpSatBenchmarkSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  results: CpSatBenchmarkCaseResult[];
}

export const DEFAULT_CP_SAT_BENCHMARK_OPTIONS: Readonly<Required<
  Pick<
    CpSatOptions,
    | "timeLimitSeconds"
    | "maxDeterministicTime"
    | "numWorkers"
    | "randomSeed"
    | "randomizeSearch"
    | "progressIntervalSeconds"
    | "logSearchProgress"
  >
>> = Object.freeze({
  timeLimitSeconds: 10,
  maxDeterministicTime: 10,
  numWorkers: 1,
  randomSeed: 1,
  randomizeSearch: false,
  progressIntervalSeconds: 0.5,
  logSearchProgress: false,
});

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

function cloneCpSatOptions(options: CpSatOptions): CpSatOptions {
  return structuredClone(options);
}

function createSeedSequence(baseSeed: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => baseSeed + index * 101);
}

function roundBenchmarkSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safePopulationRate(population: number, seconds: number | null): number | null {
  return seconds !== null && seconds > 0 ? roundBenchmarkSeconds(population / seconds) : null;
}

function observedWorkerCpuSeconds(solution: Solution): number | null {
  const portfolioWorkerTimes = solution.cpSatPortfolio?.workers
    .map((worker) => worker.telemetry?.userTimeSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (portfolioWorkerTimes?.length) {
    return roundBenchmarkSeconds(portfolioWorkerTimes.reduce((sum, value) => sum + value, 0));
  }
  return typeof solution.cpSatTelemetry?.userTimeSeconds === "number"
    ? roundBenchmarkSeconds(solution.cpSatTelemetry.userTimeSeconds)
    : null;
}

export function buildCpSatBenchmarkCpuPlan(cpSat: CpSatOptions): CpSatBenchmarkCpuPlan {
  const wallClockBudgetSeconds = cpSat.timeLimitSeconds ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.timeLimitSeconds;
  if (!cpSat.portfolio) {
    const perWorkerNumWorkers = cpSat.numWorkers ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.numWorkers;
    const workerCpuBudgetSeconds = roundBenchmarkSeconds(wallClockBudgetSeconds * perWorkerNumWorkers);
    return {
      mode: "single",
      wallClockBudgetSeconds,
      workerCount: 1,
      perWorkerNumWorkers,
      perWorkerTimeLimitSeconds: wallClockBudgetSeconds,
      parallelWorkerCount: perWorkerNumWorkers,
      workerCpuBudgetSeconds,
      cpuBudgetMultiplier: perWorkerNumWorkers,
      totalCpuBudgetSeconds: null,
      cpuBudgetHeadroomSeconds: null,
      admission: "within-budget",
    };
  }

  const portfolio = cpSat.portfolio;
  const workerCount = portfolio.randomSeeds?.length ?? portfolio.workerCount ?? 1;
  const perWorkerNumWorkers = portfolio.perWorkerNumWorkers ?? 1;
  const perWorkerTimeLimitSeconds = portfolio.perWorkerTimeLimitSeconds ?? wallClockBudgetSeconds;
  const parallelWorkerCount = workerCount * perWorkerNumWorkers;
  const workerCpuBudgetSeconds = roundBenchmarkSeconds(parallelWorkerCount * perWorkerTimeLimitSeconds);
  const totalCpuBudgetSeconds = portfolio.totalCpuBudgetSeconds ?? null;
  const cpuBudgetHeadroomSeconds =
    totalCpuBudgetSeconds === null ? null : roundBenchmarkSeconds(totalCpuBudgetSeconds - workerCpuBudgetSeconds);
  return {
    mode: "portfolio",
    wallClockBudgetSeconds,
    workerCount,
    perWorkerNumWorkers,
    perWorkerTimeLimitSeconds,
    parallelWorkerCount,
    workerCpuBudgetSeconds,
    cpuBudgetMultiplier: roundBenchmarkSeconds(workerCpuBudgetSeconds / Math.max(wallClockBudgetSeconds, 0.001)),
    totalCpuBudgetSeconds,
    cpuBudgetHeadroomSeconds,
    admission:
      totalCpuBudgetSeconds === null || workerCpuBudgetSeconds <= totalCpuBudgetSeconds + 1e-9
        ? "within-budget"
        : "over-budget",
  };
}

function assertCpSatBenchmarkCpuPlanAdmitted(cpuPlan: CpSatBenchmarkCpuPlan): void {
  if (cpuPlan.admission === "within-budget") {
    return;
  }
  throw new Error(
    `CP-SAT benchmark portfolio requests ${cpuPlan.workerCpuBudgetSeconds} total CPU seconds, exceeding the ${cpuPlan.totalCpuBudgetSeconds} second benchmark portfolio budget.`
  );
}

function normalizeBenchmarkPortfolio(
  portfolio: CpSatPortfolioOptions | undefined,
  randomSeed: number,
  timeLimitSeconds: number,
  maxDeterministicTime: number
): CpSatPortfolioOptions | undefined {
  if (!portfolio) {
    return undefined;
  }
  const workerCount = portfolio.randomSeeds?.length ?? portfolio.workerCount ?? 3;
  const randomSeeds = portfolio.randomSeeds ?? createSeedSequence(randomSeed, workerCount);
  const perWorkerTimeLimitSeconds = portfolio.perWorkerTimeLimitSeconds ?? timeLimitSeconds;
  const perWorkerMaxDeterministicTime = portfolio.perWorkerMaxDeterministicTime ?? maxDeterministicTime;
  const perWorkerNumWorkers = portfolio.perWorkerNumWorkers ?? 1;
  const normalized = {
    ...portfolio,
    workerCount,
    randomSeeds,
    perWorkerTimeLimitSeconds,
    perWorkerMaxDeterministicTime,
    perWorkerNumWorkers,
    totalCpuBudgetSeconds:
      portfolio.totalCpuBudgetSeconds ?? roundBenchmarkSeconds(randomSeeds.length * perWorkerNumWorkers * perWorkerTimeLimitSeconds),
    randomizeSearch: portfolio.randomizeSearch ?? true,
  };
  assertCpSatBenchmarkCpuPlanAdmitted(buildCpSatBenchmarkCpuPlan({
    timeLimitSeconds,
    maxDeterministicTime,
    randomSeed,
    portfolio: normalized,
  }));
  return normalized;
}

export function normalizeCpSatBenchmarkOptions(
  cpSat: CpSatOptions | undefined,
  overrides: Partial<CpSatOptions> | undefined
): CpSatOptions {
  const merged = { ...(cpSat ?? {}), ...(overrides ?? {}) };
  const timeLimitSeconds = merged.timeLimitSeconds ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.timeLimitSeconds;
  const maxDeterministicTime = merged.maxDeterministicTime ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.maxDeterministicTime;
  const numWorkers = merged.numWorkers ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.numWorkers;
  const randomSeed = merged.randomSeed ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.randomSeed;
  const randomizeSearch = merged.randomizeSearch ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.randomizeSearch;
  const progressIntervalSeconds =
    merged.progressIntervalSeconds ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.progressIntervalSeconds;
  const logSearchProgress = merged.logSearchProgress ?? DEFAULT_CP_SAT_BENCHMARK_OPTIONS.logSearchProgress;

  return {
    ...merged,
    timeLimitSeconds,
    maxDeterministicTime,
    numWorkers,
    randomSeed,
    randomizeSearch,
    progressIntervalSeconds,
    logSearchProgress,
    portfolio: normalizeBenchmarkPortfolio(merged.portfolio, randomSeed, timeLimitSeconds, maxDeterministicTime),
  };
}

function buildBenchmarkParams(benchmarkCase: CpSatBenchmarkCase, overrides?: Partial<CpSatOptions>): SolverParams {
  const params = cloneSolverParams(benchmarkCase.params);
  return {
    ...params,
    optimizer: "cp-sat",
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, overrides),
  };
}

function validateBenchmarkCorpus(corpus: readonly CpSatBenchmarkCase[]): void {
  const names = corpus.map((benchmarkCase) => benchmarkCase.name);
  if (new Set(names).size !== names.length) {
    throw new Error("CP-SAT benchmark corpus must use unique case names.");
  }
}

function selectBenchmarkCases(
  corpus: readonly CpSatBenchmarkCase[],
  names: readonly string[] | undefined
): CpSatBenchmarkCase[] {
  validateBenchmarkCorpus(corpus);
  if (!names || names.length === 0) {
    return [...corpus];
  }

  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown CP-SAT benchmark case(s): ${missing.join(", ")}. Available cases: ${corpus
        .map((benchmarkCase) => benchmarkCase.name)
        .join(", ")}.`
    );
  }

  return names.map((name) => byName.get(name) as CpSatBenchmarkCase);
}

function buildBenchmarkAsyncOptions(
  params: SolverParams,
  options: CpSatBenchmarkRunOptions | undefined,
  timeline: CpSatBenchmarkProgressSample[],
  startedAt: number
): CpSatAsyncOptions | undefined {
  if (!(options?.includeProgressTimeline ?? true)) {
    return undefined;
  }

  return {
    onProgress: captureProgressTimeline(startedAt, true, timeline),
    progressIntervalSeconds: params.cpSat?.progressIntervalSeconds,
  };
}

export function listCpSatBenchmarkCaseNames(
  corpus: readonly CpSatBenchmarkCase[] = DEFAULT_CP_SAT_BENCHMARK_CORPUS
): string[] {
  validateBenchmarkCorpus(corpus);
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

function captureProgressTimeline(
  startedAt: number,
  includeProgressTimeline: boolean,
  timeline: CpSatBenchmarkProgressSample[]
): CpSatAsyncOptions["onProgress"] {
  return (update) => {
    if (!includeProgressTimeline) {
      return;
    }
    timeline.push({
      atSeconds: (performance.now() - startedAt) / 1000,
      update,
    });
  };
}

async function runCpSatBenchmarkCase(
  benchmarkCase: CpSatBenchmarkCase,
  options?: CpSatBenchmarkRunOptions
): Promise<CpSatBenchmarkCaseResult> {
  const params = buildBenchmarkParams(benchmarkCase, options?.cpSat);
  const cpSatOptions = params.cpSat ?? {};
  const cpSatCpuPlan = buildCpSatBenchmarkCpuPlan(cpSatOptions);
  assertCpSatBenchmarkCpuPlanAdmitted(cpSatCpuPlan);
  const timeline: CpSatBenchmarkProgressSample[] = [];
  const startedAt = performance.now();
  const solution = await solveAsync(
    cloneGrid(benchmarkCase.grid),
    params,
    buildBenchmarkAsyncOptions(params, options, timeline, startedAt)
  );
  const finishedAt = performance.now();
  const wallClockSeconds = (finishedAt - startedAt) / 1000;
  const observedWorkerCpuSecondsValue = observedWorkerCpuSeconds(solution);

  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    gridRows: benchmarkCase.grid.length,
    gridCols: benchmarkCase.grid[0]?.length ?? 0,
    totalPopulation: solution.totalPopulation,
    cpSatStatus: solution.cpSatStatus ?? null,
    cpSatTelemetry: solution.cpSatTelemetry ?? null,
    cpSatObjectiveSummary: solution.cpSatObjectivePolicy?.summary ?? null,
    cpSatOptions: cloneCpSatOptions(cpSatOptions),
    cpSatCpuPlan,
    observedWorkerCpuSeconds: observedWorkerCpuSecondsValue,
    populationPerWorkerCpuBudgetSecond: safePopulationRate(solution.totalPopulation, cpSatCpuPlan.workerCpuBudgetSeconds),
    populationPerObservedCpuSecond: safePopulationRate(solution.totalPopulation, observedWorkerCpuSecondsValue),
    progressTimeline: timeline,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "cp-sat",
      params,
    }),
    wallClockSeconds,
  };
}

export async function runCpSatBenchmarkSuite(
  corpus: readonly CpSatBenchmarkCase[] = DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  options?: CpSatBenchmarkRunOptions
): Promise<CpSatBenchmarkSuiteResult> {
  const selected = selectBenchmarkCases(corpus, options?.names);
  if (selected.length === 0) {
    throw new Error("No CP-SAT benchmark cases matched the requested names.");
  }

  const results: CpSatBenchmarkCaseResult[] = [];
  for (const benchmarkCase of selected) {
    results.push(await runCpSatBenchmarkCase(benchmarkCase, options));
  }

  return {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    selectedCaseNames: results.map((result) => result.name),
    results,
  };
}

function formatProgressPreview(timeline: CpSatBenchmarkProgressSample[]): string {
  if (timeline.length === 0) {
    return "no streamed progress";
  }
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  return `${timeline.length} events, first=${first.update.kind}@${first.atSeconds.toFixed(2)}s, last=${last.update.kind}@${last.atSeconds.toFixed(2)}s`;
}

function formatCpuPlan(cpuPlan: CpSatBenchmarkCpuPlan): string {
  const cap = cpuPlan.totalCpuBudgetSeconds === null ? "n/a" : `${cpuPlan.totalCpuBudgetSeconds}s`;
  const headroom = cpuPlan.cpuBudgetHeadroomSeconds === null ? "n/a" : `${cpuPlan.cpuBudgetHeadroomSeconds}s`;
  return [
    cpuPlan.mode,
    `worker-cpu=${cpuPlan.workerCpuBudgetSeconds}s`,
    `parallel-workers=${cpuPlan.parallelWorkerCount}`,
    `cpu/wall=${cpuPlan.cpuBudgetMultiplier.toFixed(3)}x`,
    `cap=${cap}`,
    `headroom=${headroom}`,
    `admission=${cpuPlan.admission}`,
  ].join(" ");
}

function formatNullableSeconds(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(3)}s`;
}

function formatNullableRate(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

export function formatCpSatBenchmarkSuite(result: CpSatBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== CP-SAT Benchmark Suite ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push("");
  for (const benchmark of result.results) {
    lines.push(`- ${benchmark.name}: ${benchmark.description}`);
    lines.push(
      `  status=${benchmark.cpSatStatus ?? "unknown"} population=${benchmark.totalPopulation} wall=${benchmark.wallClockSeconds.toFixed(
        3
      )}s`
    );
    if (benchmark.cpSatTelemetry) {
      lines.push(
        `  bound=${benchmark.cpSatTelemetry.bestPopulationUpperBound ?? "n/a"} gap=${
          benchmark.cpSatTelemetry.populationGapUpperBound ?? "n/a"
        } branches=${benchmark.cpSatTelemetry.numBranches} conflicts=${benchmark.cpSatTelemetry.numConflicts}`
      );
    }
    lines.push(`  progress-summary=${formatSolverProgressSummary(benchmark.progressSummary)}`);
    lines.push(`  cpu-plan=${formatCpuPlan(benchmark.cpSatCpuPlan)}`);
    lines.push(
      `  cpu-efficiency=observed:${formatNullableSeconds(
        benchmark.observedWorkerCpuSeconds
      )} pop/budget-cpu:${formatNullableRate(
        benchmark.populationPerWorkerCpuBudgetSecond
      )} pop/observed-cpu:${formatNullableRate(benchmark.populationPerObservedCpuSecond)}`
    );
    lines.push(`  progress=${formatProgressPreview(benchmark.progressTimeline)}`);
  }
  return lines.join("\n");
}

export const DEFAULT_CP_SAT_BENCHMARK_CORPUS: readonly CpSatBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-single",
    description: "Tiny exact baseline with two residential types and no services.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 2, services: 0 },
    },
  },
  {
    name: "shaped-service-single",
    description: "Small shaped-service case with mixed residential footprints.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
      residentialSettings: {
        "2x2": { min: 100, max: 200 },
        "2x3": { min: 140, max: 260 },
      },
      availableBuildings: { services: 1, residentials: 2 },
    },
  },
  {
    name: "compact-service-single",
    description: "Compact mixed case for incumbent and bound tracking.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
    },
  },
  {
    name: "typed-housing-portfolio",
    description: "Single-machine portfolio exact run on the tiny typed-housing case.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 2, services: 0 },
      cpSat: {
        portfolio: {
          randomSeeds: [3, 11, 17],
          perWorkerTimeLimitSeconds: 4,
          perWorkerNumWorkers: 1,
        },
      },
    },
  },
]);
