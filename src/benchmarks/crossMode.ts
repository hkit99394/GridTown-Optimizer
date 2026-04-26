import { performance } from "node:perf_hooks";

import {
  buildDecisionTraceFromSolution,
  buildTimeToQualityScorecard,
  formatTimeToQualityScorecard,
  serializeDecisionTraceJsonl,
  summarizeDecisionTraceReason,
} from "../core/decisionTrace.js";
import { buildSolverProgressSummary, formatSolverProgressSummary } from "../core/progress.js";
import { solveAsync } from "../runtime/solve.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { normalizeLnsBenchmarkOptions } from "./lns.js";

import type {
  AutoOptions,
  CpSatOptions,
  CpSatPortfolioOptions,
  Grid,
  GreedyOptions,
  LnsOptions,
  OptimizerName,
  Solution,
  SolverParams,
  SolverDecisionTraceEvent,
  SolverProgressSummary,
  SolverTimeToQualityScorecard,
} from "../core/types.js";

export type CrossModeBenchmarkMode = OptimizerName | "cp-sat-portfolio";
export type CrossModeProblemSizeBand = "tiny" | "small" | "medium";
export type CrossModeWinVsAuto = "baseline" | "win" | "loss" | "tie" | "no-auto";

export interface CrossModeBenchmarkCase {
  name: string;
  description: string;
  problemSizeBand?: CrossModeProblemSizeBand;
  grid: Grid;
  params: SolverParams;
}

export interface CrossModeBenchmarkSolveContext {
  benchmarkCase: CrossModeBenchmarkCase;
  mode: CrossModeBenchmarkMode;
  budgetSeconds: number;
  seed: number;
}

export type CrossModeBenchmarkSolve = (
  grid: Grid,
  params: SolverParams,
  context: CrossModeBenchmarkSolveContext
) => Solution | Promise<Solution>;

export interface CrossModeBenchmarkRunOptions {
  names?: string[];
  modes?: CrossModeBenchmarkMode[];
  /** Backward-compatible single-budget option. Prefer budgetsSeconds for scorecards. */
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  auto?: Partial<AutoOptions>;
  greedy?: Partial<GreedyOptions>;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  portfolio?: Partial<CpSatPortfolioOptions>;
  solve?: CrossModeBenchmarkSolve;
}

export interface CrossModeBenchmarkModeResult {
  mode: CrossModeBenchmarkMode;
  optimizer: OptimizerName;
  label: string;
  problemSizeBand: CrossModeProblemSizeBand;
  budgetSeconds: number;
  seed: number;
  totalPopulation: number;
  scoreDeltaToBest: number | null;
  scoreRatioToBest: number | null;
  winVsAuto: CrossModeWinVsAuto;
  scoreDeltaVsAuto: number | null;
  rank: number;
  wallClockSeconds: number;
  workerCpuBudgetSeconds: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  cpSatStatus: string | null;
  lnsStopReason: string | null;
  lnsSeedTimeLimitSeconds: number | null;
  lnsSeedWallClockSeconds: number | null;
  lnsSeedProfilePhaseCount: number;
  autoStopReason: string | null;
  autoGreedySeedTimeLimitSeconds: number | null;
  autoGreedySeedElapsedSeconds: number | null;
  autoGreedySeedProfilePhaseCount: number;
  stoppedByUser: boolean;
  progressSummary: SolverProgressSummary;
  decisionTrace: SolverDecisionTraceEvent[];
  timeToQuality: SolverTimeToQualityScorecard;
  checkpointReason: string;
}

export interface CrossModeBenchmarkCaseScorecard {
  name: string;
  description: string;
  problemSizeBand: CrossModeProblemSizeBand;
  gridRows: number;
  gridCols: number;
  budgetSeconds: number;
  seed: number;
  bestScore: number | null;
  winnerModes: CrossModeBenchmarkMode[];
  results: CrossModeBenchmarkModeResult[];
}

export interface CrossModeBenchmarkModeSummary {
  mode: CrossModeBenchmarkMode;
  label: string;
  runs: number;
  meanPopulation: number;
  bestPopulation: number;
  worstPopulation: number;
  populationStdDev: number;
  meanWallClockSeconds: number;
  winRateVsAuto: number | null;
  meanScoreDeltaVsAuto: number | null;
}

export interface CrossModeBenchmarkProblemSizeSummary extends CrossModeBenchmarkModeSummary {
  problemSizeBand: CrossModeProblemSizeBand;
}

export interface CrossModeBenchmarkSuiteResult {
  generatedAt: string;
  /** Backward-compatible first budget. */
  budgetSeconds: number;
  budgetsSeconds: number[];
  seeds: number[];
  modeCount: number;
  caseCount: number;
  selectedCaseNames: string[];
  modes: CrossModeBenchmarkMode[];
  cases: CrossModeBenchmarkCaseScorecard[];
  modeSummaries: CrossModeBenchmarkModeSummary[];
  problemSizeSummaries: CrossModeBenchmarkProblemSizeSummary[];
}

interface CrossModeBenchmarkTraceArtifacts {
  decisionTrace: SolverDecisionTraceEvent[];
  timeToQuality: SolverTimeToQualityScorecard;
  checkpointReason: string;
}

export const DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS = 5;
export const DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS = Object.freeze([5, 30, 120]);
export const DEFAULT_CROSS_MODE_BENCHMARK_SEEDS = Object.freeze([7, 19, 37]);

export const DEFAULT_CROSS_MODE_BENCHMARK_MODES = Object.freeze([
  "auto",
  "greedy",
  "lns",
  "cp-sat",
  "cp-sat-portfolio",
] satisfies CrossModeBenchmarkMode[]);

const MODE_LABELS: Record<CrossModeBenchmarkMode, string> = {
  auto: "Auto",
  greedy: "Greedy",
  lns: "LNS",
  "cp-sat": "CP-SAT",
  "cp-sat-portfolio": "CP-SAT portfolio",
};

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

function inferProblemSizeBand(benchmarkCase: CrossModeBenchmarkCase): CrossModeProblemSizeBand {
  if (benchmarkCase.problemSizeBand) return benchmarkCase.problemSizeBand;
  const cells = benchmarkCase.grid.length * (benchmarkCase.grid[0]?.length ?? 0);
  if (cells <= 16) return "tiny";
  if (cells <= 36) return "small";
  return "medium";
}

function normalizeBudgetSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS;
  }
  return Math.max(1, Math.round(value * 1000) / 1000);
}

function normalizeBudgetList(options: CrossModeBenchmarkRunOptions): number[] {
  const requested = options.budgetsSeconds?.length
    ? options.budgetsSeconds
    : options.budgetSeconds !== undefined
      ? [options.budgetSeconds]
      : DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS;
  const budgets = requested
    .map((value) => normalizeBudgetSeconds(value))
    .filter((value) => value > 0);
  return [...new Set(budgets)];
}

function normalizeSeeds(seeds: readonly number[] | undefined): number[] {
  const requested = seeds?.length ? seeds : DEFAULT_CROSS_MODE_BENCHMARK_SEEDS;
  const normalized = requested
    .map((value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : -1))
    .filter((value) => value >= 0);
  if (normalized.length === 0) {
    throw new Error("Cross-mode benchmark suite must include at least one non-negative seed.");
  }
  return [...new Set(normalized)];
}

function modeToOptimizer(mode: CrossModeBenchmarkMode): OptimizerName {
  return mode === "cp-sat-portfolio" ? "cp-sat" : mode;
}

function createSeedSequence(baseSeed: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => (baseSeed + index * 101) & 0x7fffffff);
}

function applyGreedyCompatibilityFields(params: SolverParams, greedy: GreedyOptions): SolverParams {
  return {
    ...params,
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

function buildBudgetedGreedyOptions(
  params: SolverParams,
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number,
  seed: number
): GreedyOptions {
  return {
    ...normalizeGreedyBenchmarkOptions(params.greedy, options.greedy),
    timeLimitSeconds: budgetSeconds,
    randomSeed: seed,
  };
}

function withoutPortfolio(cpSat: CpSatOptions): CpSatOptions {
  const { portfolio: _portfolio, ...rest } = cpSat;
  return rest;
}

function buildPortfolioOptions(
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number,
  seed: number
): CpSatPortfolioOptions {
  const workerCount = options.portfolio?.randomSeeds?.length ?? options.portfolio?.workerCount ?? 3;
  const perWorkerNumWorkers = options.portfolio?.perWorkerNumWorkers ?? 1;
  const perWorkerTimeLimitSeconds = options.portfolio?.perWorkerTimeLimitSeconds ?? budgetSeconds;
  return {
    ...(options.portfolio ?? {}),
    workerCount,
    randomSeeds: options.portfolio?.randomSeeds ?? createSeedSequence(seed, workerCount),
    perWorkerTimeLimitSeconds,
    perWorkerMaxDeterministicTime: options.portfolio?.perWorkerMaxDeterministicTime ?? budgetSeconds,
    perWorkerNumWorkers,
    totalCpuBudgetSeconds:
      options.portfolio?.totalCpuBudgetSeconds ?? workerCount * perWorkerNumWorkers * perWorkerTimeLimitSeconds,
    randomizeSearch: options.portfolio?.randomizeSearch ?? true,
  };
}

function buildBudgetedCpSatOptions(
  params: SolverParams,
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number,
  seed: number,
  portfolio: CpSatPortfolioOptions | undefined
): CpSatOptions {
  return normalizeCpSatBenchmarkOptions(params.cpSat, {
    ...(options.cpSat ?? {}),
    timeLimitSeconds: options.cpSat?.timeLimitSeconds ?? budgetSeconds,
    maxDeterministicTime: options.cpSat?.maxDeterministicTime ?? budgetSeconds,
    randomSeed: seed,
    portfolio,
  });
}

function buildBudgetedLnsOptions(params: SolverParams, options: CrossModeBenchmarkRunOptions, budgetSeconds: number): LnsOptions {
  return normalizeLnsBenchmarkOptions(params.lns, {
    ...(options.lns ?? {}),
    wallClockLimitSeconds: budgetSeconds,
    timeLimitSeconds: budgetSeconds,
    repairTimeLimitSeconds: Math.min(options.lns?.repairTimeLimitSeconds ?? params.lns?.repairTimeLimitSeconds ?? 1, budgetSeconds),
  });
}

export function buildCrossModeBenchmarkParams(
  benchmarkCase: CrossModeBenchmarkCase,
  mode: CrossModeBenchmarkMode,
  options: CrossModeBenchmarkRunOptions = {}
): SolverParams {
  const budgetSeconds = normalizeBudgetSeconds(options.budgetSeconds);
  const seed = normalizeSeeds(options.seeds)[0] ?? DEFAULT_CROSS_MODE_BENCHMARK_SEEDS[0];
  const params = cloneSolverParams(benchmarkCase.params);
  const optimizer = modeToOptimizer(mode);
  const greedy = buildBudgetedGreedyOptions(params, options, budgetSeconds, seed);
  const baseWithGreedy = applyGreedyCompatibilityFields(params, greedy);
  const portfolio = mode === "cp-sat-portfolio"
    ? buildPortfolioOptions(options, budgetSeconds, seed)
    : undefined;
  const cpSat = buildBudgetedCpSatOptions(baseWithGreedy, options, budgetSeconds, seed, portfolio);

  if (mode === "greedy") {
    return {
      ...baseWithGreedy,
      optimizer,
    };
  }

  if (mode === "lns") {
    return {
      ...baseWithGreedy,
      optimizer,
      cpSat: withoutPortfolio(cpSat),
      lns: buildBudgetedLnsOptions(baseWithGreedy, options, budgetSeconds),
    };
  }

  if (mode === "auto") {
    return {
      ...baseWithGreedy,
      optimizer,
      auto: {
        ...(baseWithGreedy.auto ?? {}),
        ...(options.auto ?? {}),
        wallClockLimitSeconds: budgetSeconds,
        randomSeed: seed,
        cpSatStageTimeLimitSeconds: Math.min(options.auto?.cpSatStageTimeLimitSeconds ?? budgetSeconds, budgetSeconds),
      },
      cpSat: withoutPortfolio(cpSat),
      lns: buildBudgetedLnsOptions(baseWithGreedy, options, budgetSeconds),
    };
  }

  return {
    ...baseWithGreedy,
    optimizer,
    cpSat: mode === "cp-sat" ? withoutPortfolio(cpSat) : cpSat,
  };
}

function workerCpuBudgetSeconds(mode: CrossModeBenchmarkMode, cpSat: CpSatOptions, budgetSeconds: number): number {
  if (mode !== "cp-sat-portfolio") return budgetSeconds;
  const portfolio = cpSat.portfolio;
  const workerCount = portfolio?.randomSeeds?.length ?? portfolio?.workerCount ?? 1;
  const perWorkerNumWorkers = portfolio?.perWorkerNumWorkers ?? 1;
  const perWorkerTimeLimitSeconds = portfolio?.perWorkerTimeLimitSeconds ?? budgetSeconds;
  return workerCount * perWorkerNumWorkers * perWorkerTimeLimitSeconds;
}

function validateBenchmarkCorpus(corpus: readonly CrossModeBenchmarkCase[]): void {
  const names = corpus.map((benchmarkCase) => benchmarkCase.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Cross-mode benchmark corpus must use unique case names.");
  }
}

function selectBenchmarkCases(
  corpus: readonly CrossModeBenchmarkCase[],
  names: readonly string[] | undefined
): CrossModeBenchmarkCase[] {
  validateBenchmarkCorpus(corpus);
  if (!names || names.length === 0) {
    return [...corpus];
  }

  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown cross-mode benchmark case(s): ${missing.join(", ")}. Available cases: ${corpus
        .map((benchmarkCase) => benchmarkCase.name)
        .join(", ")}.`
    );
  }

  return names.map((name) => byName.get(name) as CrossModeBenchmarkCase);
}

function normalizeModes(modes: readonly CrossModeBenchmarkMode[] | undefined): CrossModeBenchmarkMode[] {
  const selected = modes?.length ? [...modes] : [...DEFAULT_CROSS_MODE_BENCHMARK_MODES];
  const seen = new Set<CrossModeBenchmarkMode>();
  const normalized: CrossModeBenchmarkMode[] = [];
  for (const mode of selected) {
    if (!(mode in MODE_LABELS) || seen.has(mode)) continue;
    seen.add(mode);
    normalized.push(mode);
  }
  if (normalized.length === 0) {
    throw new Error("Cross-mode benchmark suite must include at least one known mode.");
  }
  return normalized;
}

export function listCrossModeBenchmarkCaseNames(
  corpus: readonly CrossModeBenchmarkCase[] = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS
): string[] {
  validateBenchmarkCorpus(corpus);
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

function compareModeResults(left: CrossModeBenchmarkModeResult, right: CrossModeBenchmarkModeResult): number {
  if (left.totalPopulation !== right.totalPopulation) return right.totalPopulation - left.totalPopulation;
  if (left.wallClockSeconds !== right.wallClockSeconds) return left.wallClockSeconds - right.wallClockSeconds;
  return left.mode.localeCompare(right.mode);
}

function rankResults(results: CrossModeBenchmarkModeResult[]): CrossModeBenchmarkModeResult[] {
  const sorted = [...results].sort(compareModeResults);
  const rankByMode = new Map<CrossModeBenchmarkMode, number>();
  let last: CrossModeBenchmarkModeResult | null = null;
  let lastRank = 0;
  for (const [index, result] of sorted.entries()) {
    const rank = last
      && result.totalPopulation === last.totalPopulation
      && result.wallClockSeconds === last.wallClockSeconds
        ? lastRank
        : index + 1;
    rankByMode.set(result.mode, rank);
    last = result;
    lastRank = rank;
  }
  return results.map((result) => ({
    ...result,
    rank: rankByMode.get(result.mode) ?? result.rank,
  }));
}

async function defaultCrossModeSolve(
  grid: Grid,
  params: SolverParams,
  _context: CrossModeBenchmarkSolveContext
): Promise<Solution> {
  return solveAsync(grid, params);
}

function buildCrossModeBenchmarkTraceArtifacts(
  benchmarkCase: CrossModeBenchmarkCase,
  mode: CrossModeBenchmarkMode,
  optimizer: OptimizerName,
  solution: Solution,
  options: {
    budgetSeconds: number;
    seed: number;
    wallClockSeconds: number;
  }
): CrossModeBenchmarkTraceArtifacts {
  const decisionTrace = buildDecisionTraceFromSolution(solution, {
    runId: `${benchmarkCase.name}:${mode}:budget-${options.budgetSeconds}:seed-${options.seed}`,
    optimizer,
    elapsedTimeSeconds: options.wallClockSeconds,
  });
  return {
    decisionTrace,
    timeToQuality: buildTimeToQualityScorecard(decisionTrace, {
      finalElapsedMs: options.wallClockSeconds * 1000,
      finalScore: solution.totalPopulation,
    }),
    checkpointReason: summarizeDecisionTraceReason(decisionTrace),
  };
}

async function runCrossModeBenchmarkCase(
  benchmarkCase: CrossModeBenchmarkCase,
  modes: readonly CrossModeBenchmarkMode[],
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number,
  seed: number
): Promise<CrossModeBenchmarkCaseScorecard> {
  const solve = options.solve ?? defaultCrossModeSolve;
  const rawResults: CrossModeBenchmarkModeResult[] = [];
  const problemSizeBand = inferProblemSizeBand(benchmarkCase);

  for (const mode of modes) {
    const params = buildCrossModeBenchmarkParams(benchmarkCase, mode, {
      ...options,
      budgetSeconds,
      seeds: [seed],
    });
    const startedAt = performance.now();
    const solution = await solve(cloneGrid(benchmarkCase.grid), params, {
      benchmarkCase,
      mode,
      budgetSeconds,
      seed,
    });
    const finishedAt = performance.now();
    const wallClockSeconds = (finishedAt - startedAt) / 1000;
    const progressSummary = buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: params.optimizer ?? modeToOptimizer(mode),
      params,
    });
    const optimizer = params.optimizer ?? modeToOptimizer(mode);
    const traceArtifacts = buildCrossModeBenchmarkTraceArtifacts(benchmarkCase, mode, optimizer, solution, {
      budgetSeconds,
      seed,
      wallClockSeconds,
    });

    rawResults.push({
      mode,
      optimizer,
      label: MODE_LABELS[mode],
      problemSizeBand,
      budgetSeconds,
      seed,
      totalPopulation: solution.totalPopulation,
      scoreDeltaToBest: null,
      scoreRatioToBest: null,
      winVsAuto: "no-auto",
      scoreDeltaVsAuto: null,
      rank: 0,
      wallClockSeconds,
      workerCpuBudgetSeconds: workerCpuBudgetSeconds(mode, params.cpSat ?? {}, budgetSeconds),
      roadCount: solution.roads.size,
      serviceCount: solution.services.length,
      residentialCount: solution.residentials.length,
      cpSatStatus: solution.cpSatStatus ?? null,
      lnsStopReason: solution.lnsTelemetry?.stopReason ?? null,
      lnsSeedTimeLimitSeconds: solution.lnsTelemetry?.seedTimeLimitSeconds ?? null,
      lnsSeedWallClockSeconds: solution.lnsTelemetry?.seedWallClockSeconds ?? null,
      lnsSeedProfilePhaseCount: mode === "lns" ? (solution.greedyProfile?.phases.length ?? 0) : 0,
      autoStopReason: solution.autoStage?.stopReason ?? null,
      autoGreedySeedTimeLimitSeconds: solution.autoStage?.greedySeedStage?.timeLimitSeconds ?? null,
      autoGreedySeedElapsedSeconds: solution.autoStage?.greedySeedStage?.elapsedSeconds ?? null,
      autoGreedySeedProfilePhaseCount: solution.autoStage?.greedySeedStage?.phases?.length ?? 0,
      stoppedByUser: Boolean(solution.stoppedByUser),
      progressSummary,
      ...traceArtifacts,
    });
  }

  const bestScore = rawResults.length
    ? Math.max(...rawResults.map((result) => result.totalPopulation))
    : null;
  const autoScore = rawResults.find((result) => result.mode === "auto")?.totalPopulation ?? null;
  const withScoreDeltas = rawResults.map((result) => {
    const scoreDeltaVsAuto = autoScore === null ? null : result.totalPopulation - autoScore;
    const winVsAuto: CrossModeWinVsAuto = result.mode === "auto"
      ? "baseline"
      : scoreDeltaVsAuto === null
        ? "no-auto"
        : scoreDeltaVsAuto > 0
          ? "win"
          : scoreDeltaVsAuto < 0
            ? "loss"
            : "tie";
    return {
      ...result,
      scoreDeltaToBest: bestScore === null ? null : bestScore - result.totalPopulation,
      scoreRatioToBest: bestScore === null || bestScore <= 0 ? null : result.totalPopulation / bestScore,
      winVsAuto,
      scoreDeltaVsAuto: result.mode === "auto" ? 0 : scoreDeltaVsAuto,
    };
  });
  const rankedResults = rankResults(withScoreDeltas);

  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    problemSizeBand,
    gridRows: benchmarkCase.grid.length,
    gridCols: benchmarkCase.grid[0]?.length ?? 0,
    budgetSeconds,
    seed,
    bestScore,
    winnerModes: bestScore === null
      ? []
      : rankedResults.filter((result) => result.totalPopulation === bestScore).map((result) => result.mode),
    results: rankedResults,
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function summarizeMode(mode: CrossModeBenchmarkMode, results: readonly CrossModeBenchmarkModeResult[]): CrossModeBenchmarkModeSummary {
  const populations = results.map((result) => result.totalPopulation);
  const comparable = results.filter((result) => result.winVsAuto !== "baseline" && result.winVsAuto !== "no-auto");
  const wins = comparable.filter((result) => result.winVsAuto === "win").length;
  const ties = comparable.filter((result) => result.winVsAuto === "tie").length;
  const deltas = results
    .map((result) => result.scoreDeltaVsAuto)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    mode,
    label: MODE_LABELS[mode],
    runs: results.length,
    meanPopulation: mean(populations),
    bestPopulation: populations.length ? Math.max(...populations) : 0,
    worstPopulation: populations.length ? Math.min(...populations) : 0,
    populationStdDev: standardDeviation(populations),
    meanWallClockSeconds: mean(results.map((result) => result.wallClockSeconds)),
    winRateVsAuto: comparable.length ? (wins + ties * 0.5) / comparable.length : null,
    meanScoreDeltaVsAuto: deltas.length ? mean(deltas) : null,
  };
}

function buildSummaries(cases: readonly CrossModeBenchmarkCaseScorecard[]): {
  modeSummaries: CrossModeBenchmarkModeSummary[];
  problemSizeSummaries: CrossModeBenchmarkProblemSizeSummary[];
} {
  const results = cases.flatMap((scorecard) => scorecard.results);
  const modes = [...new Set(results.map((result) => result.mode))];
  const modeSummaries = modes.map((mode) => summarizeMode(mode, results.filter((result) => result.mode === mode)));
  const problemSizeBands = [...new Set(results.map((result) => result.problemSizeBand))];
  const problemSizeSummaries = problemSizeBands.flatMap((problemSizeBand) =>
    modes.map((mode) => ({
      problemSizeBand,
      ...summarizeMode(
        mode,
        results.filter((result) => result.mode === mode && result.problemSizeBand === problemSizeBand)
      ),
    })).filter((summary) => summary.runs > 0)
  );
  return { modeSummaries, problemSizeSummaries };
}

export async function runCrossModeBenchmarkSuite(
  corpus: readonly CrossModeBenchmarkCase[] = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  options: CrossModeBenchmarkRunOptions = {}
): Promise<CrossModeBenchmarkSuiteResult> {
  const selected = selectBenchmarkCases(corpus, options.names);
  if (selected.length === 0) {
    throw new Error("No cross-mode benchmark cases matched the requested names.");
  }
  const budgetsSeconds = normalizeBudgetList(options);
  const seeds = normalizeSeeds(options.seeds);
  const modes = normalizeModes(options.modes);
  const cases: CrossModeBenchmarkCaseScorecard[] = [];
  for (const benchmarkCase of selected) {
    for (const budgetSeconds of budgetsSeconds) {
      for (const seed of seeds) {
        cases.push(await runCrossModeBenchmarkCase(benchmarkCase, modes, options, budgetSeconds, seed));
      }
    }
  }
  const summaries = buildSummaries(cases);

  return {
    generatedAt: new Date().toISOString(),
    budgetSeconds: budgetsSeconds[0] ?? DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
    budgetsSeconds,
    seeds,
    modeCount: modes.length,
    caseCount: selected.length,
    selectedCaseNames: selected.map((benchmarkCase) => benchmarkCase.name),
    modes,
    cases,
    ...summaries,
  };
}

export function collectCrossModeBenchmarkDecisionTraceEvents(
  result: CrossModeBenchmarkSuiteResult
): SolverDecisionTraceEvent[] {
  return result.cases.flatMap((scorecard) => scorecard.results.flatMap((benchmark) => benchmark.decisionTrace));
}

export function formatCrossModeBenchmarkDecisionTraceJsonl(result: CrossModeBenchmarkSuiteResult): string {
  return serializeDecisionTraceJsonl(collectCrossModeBenchmarkDecisionTraceEvents(result));
}

function formatScoreDelta(value: number | null): string {
  if (value === null) return "n/a";
  return value === 0 ? "best" : `-${Number(value).toLocaleString()}`;
}

function formatScoreDeltaVsAuto(value: number | null): string {
  if (value === null) return "n/a";
  if (value > 0) return `+${Number(value).toLocaleString()}`;
  return Number(value).toLocaleString();
}

function formatSeconds(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(3)}s` : "n/a";
}

function formatSeedPolicyEvidence(benchmark: CrossModeBenchmarkModeResult): string | null {
  const details: string[] = [];
  if (benchmark.lnsSeedTimeLimitSeconds !== null || benchmark.lnsSeedWallClockSeconds !== null) {
    details.push(
      `lns-seed-limit:${formatSeconds(benchmark.lnsSeedTimeLimitSeconds)} lns-seed-wall:${formatSeconds(benchmark.lnsSeedWallClockSeconds)} lns-seed-phases:${benchmark.lnsSeedProfilePhaseCount}`
    );
  }
  if (benchmark.autoGreedySeedTimeLimitSeconds !== null || benchmark.autoGreedySeedElapsedSeconds !== null) {
    details.push(
      `auto-greedy-seed-limit:${formatSeconds(benchmark.autoGreedySeedTimeLimitSeconds)} auto-greedy-seed-wall:${formatSeconds(benchmark.autoGreedySeedElapsedSeconds)} auto-greedy-seed-phases:${benchmark.autoGreedySeedProfilePhaseCount}`
    );
  }
  return details.length > 0 ? details.join(" ") : null;
}

export function formatCrossModeBenchmarkSuite(result: CrossModeBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Cross-Mode Benchmark Scorecard ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Modes: ${result.modes.map((mode) => MODE_LABELS[mode]).join(", ")}`);
  lines.push(`Equal wall-clock budgets: ${result.budgetsSeconds.join(", ")}s per mode`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push("");

  for (const scorecard of result.cases) {
    lines.push(`- ${scorecard.name}: ${scorecard.description}`);
    lines.push(
      `  band=${scorecard.problemSizeBand} budget=${scorecard.budgetSeconds}s seed=${scorecard.seed} best=${scorecard.bestScore ?? "n/a"} winner=${scorecard.winnerModes.map((mode) => MODE_LABELS[mode]).join(", ") || "n/a"} grid=${scorecard.gridRows}x${scorecard.gridCols}`
    );
    for (const benchmark of [...scorecard.results].sort(compareModeResults)) {
      lines.push(
        `  ${benchmark.label}: rank=${benchmark.rank} score=${benchmark.totalPopulation} delta=${formatScoreDelta(benchmark.scoreDeltaToBest)} win-vs-auto=${benchmark.winVsAuto} auto-delta=${formatScoreDeltaVsAuto(benchmark.scoreDeltaVsAuto)} wall=${benchmark.wallClockSeconds.toFixed(3)}s cpu-budget=${benchmark.workerCpuBudgetSeconds}s roads=${benchmark.roadCount} services=${benchmark.serviceCount} residentials=${benchmark.residentialCount}`
      );
      lines.push(`    progress=${formatSolverProgressSummary(benchmark.progressSummary)}`);
      lines.push(
        `    quality=${formatTimeToQualityScorecard(benchmark.timeToQuality)} trace-events=${benchmark.decisionTrace.length}`
      );
      lines.push(`    reason=${benchmark.checkpointReason}`);
      const seedPolicyEvidence = formatSeedPolicyEvidence(benchmark);
      if (seedPolicyEvidence) {
        lines.push(`    seed-policy=${seedPolicyEvidence}`);
      }
    }
  }

  lines.push("");
  lines.push("Mode summaries:");
  for (const summary of result.modeSummaries) {
    lines.push(
      `- ${summary.label}: runs=${summary.runs} mean=${summary.meanPopulation.toFixed(1)} best=${summary.bestPopulation} worst=${summary.worstPopulation} seed-stddev=${summary.populationStdDev.toFixed(1)} win-rate-vs-auto=${summary.winRateVsAuto === null ? "n/a" : summary.winRateVsAuto.toFixed(3)}`
    );
  }

  lines.push("");
  lines.push("Problem-size summaries:");
  for (const summary of result.problemSizeSummaries) {
    lines.push(
      `- ${summary.problemSizeBand} ${summary.label}: mean=${summary.meanPopulation.toFixed(1)} best=${summary.bestPopulation} win-rate-vs-auto=${summary.winRateVsAuto === null ? "n/a" : summary.winRateVsAuto.toFixed(3)}`
    );
  }

  return lines.join("\n");
}

export const DEFAULT_CROSS_MODE_BENCHMARK_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-single",
    description: "Tiny typed-housing case shared by all solver modes.",
    problemSizeBand: "tiny",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 2, services: 0 },
      greedy: {
        localSearch: false,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
  {
    name: "compact-service-single",
    description: "Small service-and-housing case for equal-budget mode comparisons.",
    problemSizeBand: "small",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
      greedy: {
        localSearch: true,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 32,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
  {
    name: "compact-service-repair",
    description: "Small 6x6 mixed case for LNS and Auto repair scorecards.",
    problemSizeBand: "small",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 180, avail: 2 },
        { w: 2, h: 3, min: 130, max: 260, avail: 1 },
      ],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: {
        localSearch: true,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64,
      },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 2,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
]);
