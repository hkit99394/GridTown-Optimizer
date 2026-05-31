import { performance } from "node:perf_hooks";

import {
  buildDecisionTraceFromSolution,
  computePopulationCapacityUpperBound,
  buildTimeToQualityScorecard,
  serializeDecisionTraceJsonl,
  summarizeDecisionTraceReason
} from "../core/index.js";
import { buildSolverProgressSummary } from "../core/index.js";
import { isAdjacentToRoads, isRoadAnchorCell, roadsConnectedToRoadAnchor } from "../core/index.js";
import { solveAsync } from "../runtime/index.js";
import {
  assertBenchmarkCasesSelected,
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  countBenchmarkMatches,
  listBenchmarkCaseNames,
  observedCpSatWorkerCpuSeconds,
  safePopulationRate,
  selectBenchmarkCasesByName,
  uniqueBenchmarkValues
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import { buildCpSatBenchmarkCpuPlan, normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { normalizeLnsBenchmarkOptions } from "./lns.js";
import { withCaseScopedCpSatOptions } from "./crossModeCpSatGeometry.js";
import { buildCrossModeRunTelemetry } from "./crossModeTelemetry.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossModeCorpus.js";
import { MODE_LABELS } from "./crossModeLabels.js";
import { rankResults } from "./crossModeResultOrder.js";
import {
  buildBudgetPolicySignals,
  buildCrossModeBudgetAllocationSignal,
  buildPortfolioEfficiencySignals,
  buildSummaries
} from "./crossModeSignals.js";
import { buildPopulationAttainmentMetrics } from "./populationAttainment.js";

export { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossModeCorpus.js";
export { evaluateCpSatNoOverlap2dGeometryPressure } from "./crossModeCpSatGeometry.js";
export { formatCrossModeBenchmarkSuite } from "./crossModeFormatting.js";
export type { CrossModeCpSatNoOverlap2dGeometryPressureSignal } from "./crossModeCpSatGeometry.js";
export type {
  CrossModeBenchmarkBudgetAblationPolicy,
  CrossModeBenchmarkBudgetPolicySignal,
  CrossModeBenchmarkCase,
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkModeResult,
  CrossModeBenchmarkModeSummary,
  CrossModeBenchmarkProblemSizeSummary,
  CrossModeBenchmarkRunOptions,
  CrossModeBenchmarkSolve,
  CrossModeBenchmarkSolveContext,
  CrossModeBenchmarkSplit,
  CrossModeBenchmarkSuiteResult,
  CrossModeBudgetAllocationSignal,
  CrossModeBudgetAllocationSignalKind,
  CrossModeBudgetPolicyRecommendation,
  CrossModePortfolioEfficiencyRecommendation,
  CrossModePortfolioEfficiencySignal,
  CrossModeProblemSizeBand,
  CrossModeRoadSemanticStatus,
  CrossModeRoadSemanticsSummary,
  CrossModeWorkflowTag,
  CrossModeWinVsAuto
} from "./crossModeTypes.js";

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
  SolverTimeToQualityScorecard
} from "../core/index.js";
import type {
  CrossModeBenchmarkBudgetAblationPolicy,
  CrossModeBenchmarkCase,
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkModeResult,
  CrossModeBenchmarkRunOptions,
  CrossModeBenchmarkSolveContext,
  CrossModeBenchmarkSuiteResult,
  CrossModeProblemSizeBand,
  CrossModeRoadSemanticStatus,
  CrossModeRoadSemanticsSummary,
  CrossModeWinVsAuto
} from "./crossModeTypes.js";

type CrossModeBenchmarkModeResultDraft = Omit<
  CrossModeBenchmarkModeResult,
  | "scoreDeltaToBest"
  | "scoreRatioToBest"
  | "winVsAuto"
  | "scoreDeltaVsAuto"
  | "rank"
  | "budgetAllocationSignal"
  | "attainment"
>;

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
  "cp-sat-portfolio"
] satisfies CrossModeBenchmarkMode[]);

const TRACE_TUNED_LNS_MAX_ITERATIONS = 24;
const TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS = 5;
const TRACE_TUNED_LNS_MEDIUM_BUDGET_SECONDS = 30;

function inferProblemSizeBand(benchmarkCase: CrossModeBenchmarkCase): CrossModeProblemSizeBand {
  if (benchmarkCase.problemSizeBand) return benchmarkCase.problemSizeBand;
  const cells = benchmarkCase.grid.length * (benchmarkCase.grid[0]?.length ?? 0);
  if (cells <= 16) return "tiny";
  if (cells <= 36) return "small";
  return "medium";
}

function normalizeBudgetSeconds(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Cross-mode benchmark budget seconds must be a finite number greater than 0.");
  }
  return Math.max(1, Math.round(value * 1000) / 1000);
}

function normalizeBudgetList(options: CrossModeBenchmarkRunOptions): number[] {
  const requested = options.budgetsSeconds?.length
    ? options.budgetsSeconds
    : options.budgetSeconds !== undefined
      ? [options.budgetSeconds]
      : DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS;
  const budgets = requested.map((value) => normalizeBudgetSeconds(value)).filter((value) => value > 0);
  return uniqueBenchmarkValues(budgets);
}

function normalizeSingleRunBudgetSeconds(options: CrossModeBenchmarkRunOptions): number {
  if (options.budgetSeconds !== undefined) {
    return normalizeBudgetSeconds(options.budgetSeconds);
  }
  if (options.budgetsSeconds?.length) {
    return normalizeBudgetSeconds(options.budgetsSeconds[0]);
  }
  return DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS;
}

function normalizeSeeds(seeds: readonly number[] | undefined): number[] {
  return normalizeBenchmarkSeeds(seeds, "Cross-mode benchmark seeds") ?? [...DEFAULT_CROSS_MODE_BENCHMARK_SEEDS];
}

function isCrossModeBenchmarkMode(mode: unknown): mode is CrossModeBenchmarkMode {
  return typeof mode === "string" && mode in MODE_LABELS;
}

function formatUnknownCrossModeBenchmarkModes(modes: readonly unknown[]): string {
  return `Unknown cross-mode benchmark mode(s): ${modes.map(String).join(", ")}. Available modes: ${DEFAULT_CROSS_MODE_BENCHMARK_MODES.join(", ")}.`;
}

function assertCrossModeBenchmarkMode(mode: CrossModeBenchmarkMode): void {
  if (!isCrossModeBenchmarkMode(mode)) {
    throw new Error(formatUnknownCrossModeBenchmarkModes([mode]));
  }
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
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations
  };
}

function buildBudgetedGreedyOptions(
  benchmarkCase: CrossModeBenchmarkCase,
  mode: CrossModeBenchmarkMode,
  params: SolverParams,
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number,
  seed: number
): GreedyOptions {
  return {
    ...normalizeGreedyBenchmarkOptions(params.greedy, {
      ...(options.greedy ?? {}),
      ...budgetAblationGreedyOptions(options.budgetAblationPolicy, mode, budgetSeconds, benchmarkCase)
    }),
    timeLimitSeconds: budgetSeconds,
    randomSeed: seed
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
    randomizeSearch: options.portfolio?.randomizeSearch ?? true
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
    portfolio
  });
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function firstPositiveFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = positiveFiniteNumber(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstPositiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = positiveInteger(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function ratioBudgetSeconds(value: unknown, budgetSeconds: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(0.001, Math.min(budgetSeconds, budgetSeconds * value))
    : null;
}

function budgetAblationPolicyApplies(
  policy: CrossModeBenchmarkBudgetAblationPolicy | undefined,
  budgetSeconds: number,
  benchmarkCase: CrossModeBenchmarkCase
): boolean {
  if (!policy) return false;
  const budgetApplies =
    !policy.activeBudgetSeconds?.length ||
    policy.activeBudgetSeconds.some(
      (activeBudgetSeconds) =>
        Number.isFinite(activeBudgetSeconds) && Math.abs(activeBudgetSeconds - budgetSeconds) <= 1e-9
    );
  if (!budgetApplies) return false;
  return policy.appliesToCase ? policy.appliesToCase(benchmarkCase) : true;
}

function budgetAblationLnsOptions(
  policy: CrossModeBenchmarkBudgetAblationPolicy | undefined,
  budgetSeconds: number,
  benchmarkCase: CrossModeBenchmarkCase
): Partial<LnsOptions> {
  if (!policy || !budgetAblationPolicyApplies(policy, budgetSeconds, benchmarkCase)) return {};
  const seedTimeLimitSeconds = ratioBudgetSeconds(policy.lnsSeedBudgetRatio, budgetSeconds);
  const repairTimeLimitSeconds = ratioBudgetSeconds(policy.lnsRepairBudgetRatio, budgetSeconds);
  const escalatedRepairTimeLimitSeconds = ratioBudgetSeconds(policy.lnsEscalatedRepairBudgetRatio, budgetSeconds);
  return {
    ...(policy.lns ?? {}),
    ...(seedTimeLimitSeconds !== null ? { seedTimeLimitSeconds } : {}),
    ...(repairTimeLimitSeconds !== null
      ? {
          repairTimeLimitSeconds,
          focusedRepairTimeLimitSeconds: repairTimeLimitSeconds
        }
      : {}),
    ...(escalatedRepairTimeLimitSeconds !== null ? { escalatedRepairTimeLimitSeconds } : {})
  };
}

function budgetAblationAutoOptions(
  policy: CrossModeBenchmarkBudgetAblationPolicy | undefined,
  budgetSeconds: number,
  benchmarkCase: CrossModeBenchmarkCase
): Partial<AutoOptions> {
  if (!policy || !budgetAblationPolicyApplies(policy, budgetSeconds, benchmarkCase)) return {};
  return {
    ...(policy.auto ?? {}),
    ...(typeof policy.autoCpSatStageReserveRatio === "number" && Number.isFinite(policy.autoCpSatStageReserveRatio)
      ? { cpSatStageReserveRatio: Math.max(0, Math.min(1, policy.autoCpSatStageReserveRatio)) }
      : {})
  };
}

function budgetAblationGreedyOptions(
  policy: CrossModeBenchmarkBudgetAblationPolicy | undefined,
  mode: CrossModeBenchmarkMode,
  budgetSeconds: number,
  benchmarkCase: CrossModeBenchmarkCase
): Partial<GreedyOptions> {
  if (mode !== "greedy" || !policy || !budgetAblationPolicyApplies(policy, budgetSeconds, benchmarkCase)) return {};
  return {
    ...(policy.greedy ?? {})
  };
}

function defaultTraceTunedLnsRepairBudgetSeconds(budgetSeconds: number): number {
  if (budgetSeconds <= TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS) return 1;
  if (budgetSeconds <= TRACE_TUNED_LNS_MEDIUM_BUDGET_SECONDS) return 2;
  return 5;
}

function defaultTraceTunedLnsEscalatedRepairBudgetSeconds(
  budgetSeconds: number,
  repairTimeLimitSeconds: number
): number {
  if (budgetSeconds <= TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS) return repairTimeLimitSeconds;
  return Math.min(repairTimeLimitSeconds * 2, Math.max(repairTimeLimitSeconds, budgetSeconds * 0.1));
}

function buildBudgetedLnsOptions(
  benchmarkCase: CrossModeBenchmarkCase,
  params: SolverParams,
  options: CrossModeBenchmarkRunOptions,
  budgetSeconds: number
): LnsOptions {
  const overrideLns = {
    ...(options.lns ?? {}),
    ...budgetAblationLnsOptions(options.budgetAblationPolicy, budgetSeconds, benchmarkCase)
  };
  const explicitRepairTimeLimitSeconds = firstPositiveFiniteNumber(overrideLns.repairTimeLimitSeconds);
  const repairTimeLimitSeconds = Math.min(
    explicitRepairTimeLimitSeconds ?? defaultTraceTunedLnsRepairBudgetSeconds(budgetSeconds),
    budgetSeconds
  );
  const seedTimeLimitSeconds = Math.min(
    firstPositiveFiniteNumber(overrideLns.seedTimeLimitSeconds) ??
      Math.max(0.1, Math.min(budgetSeconds * 0.2, repairTimeLimitSeconds)),
    budgetSeconds
  );
  const repairBudgetSeconds = Math.max(0, budgetSeconds - seedTimeLimitSeconds);
  const policyIterations = Math.max(
    1,
    Math.min(TRACE_TUNED_LNS_MAX_ITERATIONS, Math.floor(repairBudgetSeconds / repairTimeLimitSeconds))
  );
  const iterations = firstPositiveInteger(overrideLns.iterations) ?? policyIterations;
  const explicitFocusedRepair = firstPositiveFiniteNumber(overrideLns.focusedRepairTimeLimitSeconds);
  const explicitEscalatedRepair = firstPositiveFiniteNumber(overrideLns.escalatedRepairTimeLimitSeconds);
  return normalizeLnsBenchmarkOptions(params.lns, {
    ...overrideLns,
    wallClockLimitSeconds: budgetSeconds,
    timeLimitSeconds: budgetSeconds,
    seedTimeLimitSeconds,
    iterations,
    maxNoImprovementIterations: firstPositiveInteger(overrideLns.maxNoImprovementIterations) ?? iterations,
    repairTimeLimitSeconds,
    focusedRepairTimeLimitSeconds: Math.min(explicitFocusedRepair ?? repairTimeLimitSeconds, budgetSeconds),
    escalatedRepairTimeLimitSeconds: Math.min(
      explicitEscalatedRepair ??
        (explicitRepairTimeLimitSeconds === null
          ? defaultTraceTunedLnsEscalatedRepairBudgetSeconds(budgetSeconds, repairTimeLimitSeconds)
          : repairTimeLimitSeconds),
      budgetSeconds
    )
  });
}

export function buildCrossModeBenchmarkParams(
  benchmarkCase: CrossModeBenchmarkCase,
  mode: CrossModeBenchmarkMode,
  options: CrossModeBenchmarkRunOptions = {}
): SolverParams {
  assertCrossModeBenchmarkMode(mode);
  const scopedOptions = withCaseScopedCpSatOptions(benchmarkCase, options);
  const budgetSeconds = normalizeSingleRunBudgetSeconds(scopedOptions);
  const seed = normalizeSeeds(scopedOptions.seeds)[0] ?? DEFAULT_CROSS_MODE_BENCHMARK_SEEDS[0];
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const optimizer = modeToOptimizer(mode);
  const greedy = buildBudgetedGreedyOptions(benchmarkCase, mode, params, scopedOptions, budgetSeconds, seed);
  const baseWithGreedy = applyGreedyCompatibilityFields(params, greedy);
  const portfolio = mode === "cp-sat-portfolio" ? buildPortfolioOptions(scopedOptions, budgetSeconds, seed) : undefined;
  const cpSat = buildBudgetedCpSatOptions(baseWithGreedy, scopedOptions, budgetSeconds, seed, portfolio);
  const autoPolicyOverrides = budgetAblationAutoOptions(
    scopedOptions.budgetAblationPolicy,
    budgetSeconds,
    benchmarkCase
  );

  if (mode === "greedy") {
    return {
      ...baseWithGreedy,
      optimizer
    };
  }

  if (mode === "lns") {
    return {
      ...baseWithGreedy,
      optimizer,
      cpSat: withoutPortfolio(cpSat),
      lns: buildBudgetedLnsOptions(benchmarkCase, baseWithGreedy, scopedOptions, budgetSeconds)
    };
  }

  if (mode === "auto") {
    return {
      ...baseWithGreedy,
      optimizer,
      auto: {
        ...(baseWithGreedy.auto ?? {}),
        ...(scopedOptions.auto ?? {}),
        ...autoPolicyOverrides,
        wallClockLimitSeconds: budgetSeconds,
        randomSeed: seed,
        cpSatStageTimeLimitSeconds: Math.min(
          autoPolicyOverrides.cpSatStageTimeLimitSeconds ??
            scopedOptions.auto?.cpSatStageTimeLimitSeconds ??
            budgetSeconds,
          budgetSeconds
        )
      },
      cpSat: withoutPortfolio(cpSat),
      lns: buildBudgetedLnsOptions(benchmarkCase, baseWithGreedy, scopedOptions, budgetSeconds)
    };
  }

  return {
    ...baseWithGreedy,
    optimizer,
    cpSat: mode === "cp-sat" ? withoutPortfolio(cpSat) : cpSat
  };
}

function workerCpuBudgetSeconds(mode: CrossModeBenchmarkMode, cpSat: CpSatOptions, budgetSeconds: number): number {
  if (mode === "cp-sat" || mode === "cp-sat-portfolio") {
    return buildCpSatBenchmarkCpuPlan(cpSat).workerCpuBudgetSeconds;
  }
  return budgetSeconds;
}

function selectBenchmarkCases(
  corpus: readonly CrossModeBenchmarkCase[],
  names: readonly string[] | undefined
): CrossModeBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "cross-mode benchmark",
    corpusLabel: "Cross-mode benchmark"
  });
}

function normalizeModes(modes: readonly CrossModeBenchmarkMode[] | undefined): CrossModeBenchmarkMode[] {
  const selected = modes?.length ? [...modes] : [...DEFAULT_CROSS_MODE_BENCHMARK_MODES];
  const unknownModes = uniqueBenchmarkValues(selected.filter((mode) => !isCrossModeBenchmarkMode(mode)));
  if (unknownModes.length > 0) {
    throw new Error(formatUnknownCrossModeBenchmarkModes(unknownModes));
  }
  const seen = new Set<CrossModeBenchmarkMode>();
  const normalized: CrossModeBenchmarkMode[] = [];
  for (const mode of selected) {
    if (seen.has(mode)) continue;
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
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "cross-mode benchmark",
    corpusLabel: "Cross-mode benchmark"
  });
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
    policyName?: string;
  }
): CrossModeBenchmarkTraceArtifacts {
  const policySegment = options.policyName ? `:policy-${options.policyName.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
  const decisionTrace = buildDecisionTraceFromSolution(solution, {
    runId: `${benchmarkCase.name}:${mode}${policySegment}:budget-${options.budgetSeconds}:seed-${options.seed}`,
    optimizer,
    elapsedTimeSeconds: options.wallClockSeconds
  });
  return {
    decisionTrace,
    timeToQuality: buildTimeToQualityScorecard(decisionTrace, {
      finalElapsedMs: options.wallClockSeconds * 1000,
      finalScore: solution.totalPopulation
    }),
    checkpointReason: summarizeDecisionTraceReason(decisionTrace)
  };
}

function buildRoadSemanticsSummary(grid: Grid, solution: Solution): CrossModeRoadSemanticsSummary {
  const roads = solution.roads;
  const connectedRoads = roadsConnectedToRoadAnchor(grid, roads);
  const anchorRoadCount = [...roads].filter((key) => {
    const [r, c] = key.split(",").map(Number);
    return isRoadAnchorCell(r, c);
  }).length;
  const disconnectedRoadCount = Math.max(0, roads.size - connectedRoads.size);
  const buildings = [
    ...solution.services.map((service) => ({
      r: service.r,
      c: service.c,
      rows: service.rows,
      cols: service.cols
    })),
    ...solution.residentials
  ];
  const roadAdjacentBuildingCount = countBenchmarkMatches(buildings, (building) =>
    isAdjacentToRoads(roads, building.r, building.c, building.rows, building.cols)
  );
  const status: CrossModeRoadSemanticStatus =
    roads.size === 0
      ? "empty"
      : anchorRoadCount === 0
        ? "no-anchor-touch"
        : disconnectedRoadCount > 0
          ? "disconnected"
          : "anchor-connected";

  return {
    status,
    anchorRoadCount,
    anchorConnectedRoadCount: connectedRoads.size,
    disconnectedRoadCount,
    anchorConnectedRoadRatio: safePopulationRate(connectedRoads.size, roads.size),
    roadAdjacentBuildingCount,
    roadUnadjacentBuildingCount: buildings.length - roadAdjacentBuildingCount
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
  const rawResults: CrossModeBenchmarkModeResultDraft[] = [];
  const problemSizeBand = inferProblemSizeBand(benchmarkCase);
  const populationCapacityUpperBound = computePopulationCapacityUpperBound(benchmarkCase.params);
  const budgetAblationPolicyName = options.budgetAblationPolicy?.name;
  const budgetAblationPolicyApplied = budgetAblationPolicyApplies(
    options.budgetAblationPolicy,
    budgetSeconds,
    benchmarkCase
  );

  for (const mode of modes) {
    const params = buildCrossModeBenchmarkParams(benchmarkCase, mode, {
      ...options,
      budgetSeconds,
      seeds: [seed]
    });
    const startedAt = performance.now();
    const solution = await solve(cloneBenchmarkGrid(benchmarkCase.grid), params, {
      benchmarkCase,
      mode,
      budgetSeconds,
      seed,
      ...(budgetAblationPolicyName
        ? {
            budgetAblationPolicyName,
            budgetAblationPolicyApplied
          }
        : {})
    });
    const finishedAt = performance.now();
    const wallClockSeconds = (finishedAt - startedAt) / 1000;
    const progressSummary = buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: params.optimizer ?? modeToOptimizer(mode),
      params
    });
    const optimizer = params.optimizer ?? modeToOptimizer(mode);
    const traceArtifacts = buildCrossModeBenchmarkTraceArtifacts(benchmarkCase, mode, optimizer, solution, {
      budgetSeconds,
      seed,
      wallClockSeconds,
      policyName: options.budgetAblationPolicy?.name
    });
    const workerCpuBudgetSecondsValue = workerCpuBudgetSeconds(mode, params.cpSat ?? {}, budgetSeconds);
    const observedWorkerCpuSecondsValue = observedCpSatWorkerCpuSeconds(solution);
    const telemetryAttainment = buildPopulationAttainmentMetrics({
      totalPopulation: solution.totalPopulation,
      capacityUpperBound: populationCapacityUpperBound,
      baselinePopulation: 0,
      elapsedSeconds: wallClockSeconds
    });
    const telemetry = buildCrossModeRunTelemetry({
      benchmarkCase,
      mode,
      params,
      solution,
      traceArtifacts,
      problemSizeBand,
      budgetSeconds,
      seed,
      ...(budgetAblationPolicyName
        ? {
            budgetAblationPolicyName,
            budgetAblationPolicyApplied
          }
        : {}),
      wallClockSeconds,
      workerCpuBudgetSeconds: workerCpuBudgetSecondsValue,
      observedWorkerCpuSeconds: observedWorkerCpuSecondsValue,
      attainment: telemetryAttainment
    });

    rawResults.push({
      mode,
      optimizer,
      label: MODE_LABELS[mode],
      ...(budgetAblationPolicyName
        ? {
            budgetAblationPolicyName,
            budgetAblationPolicyApplied
          }
        : {}),
      problemSizeBand,
      budgetSeconds,
      seed,
      totalPopulation: solution.totalPopulation,
      wallClockSeconds,
      workerCpuBudgetSeconds: workerCpuBudgetSecondsValue,
      observedWorkerCpuSeconds: observedWorkerCpuSecondsValue,
      populationPerWorkerCpuBudgetSecond: safePopulationRate(solution.totalPopulation, workerCpuBudgetSecondsValue),
      populationPerObservedCpuSecond: safePopulationRate(solution.totalPopulation, observedWorkerCpuSecondsValue),
      roadCount: solution.roads.size,
      roadSemantics: buildRoadSemanticsSummary(benchmarkCase.grid, solution),
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
      telemetry,
      ...traceArtifacts
    });
  }

  const bestScore = rawResults.length ? Math.max(...rawResults.map((result) => result.totalPopulation)) : null;
  const autoResult = rawResults.find((result) => result.mode === "auto") ?? null;
  const autoScore = autoResult?.totalPopulation ?? null;
  const withScoreDeltas: CrossModeBenchmarkModeResult[] = rawResults.map((result) => {
    const scoreDeltaVsAuto = autoScore === null ? null : result.totalPopulation - autoScore;
    const winVsAuto: CrossModeWinVsAuto =
      result.mode === "auto"
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
      rank: 0,
      scoreDeltaVsAuto: result.mode === "auto" ? 0 : scoreDeltaVsAuto,
      attainment: buildPopulationAttainmentMetrics({
        totalPopulation: result.totalPopulation,
        capacityUpperBound: populationCapacityUpperBound,
        baselinePopulation: autoScore !== null && result.mode !== "auto" ? autoScore : 0,
        elapsedSeconds: result.wallClockSeconds
      }),
      budgetAllocationSignal: buildCrossModeBudgetAllocationSignal(result, {
        scoreDeltaVsAuto: result.mode === "auto" ? 0 : scoreDeltaVsAuto,
        autoBestScoreAtMs: autoResult?.timeToQuality.bestScoreAtMs ?? null
      })
    };
  });
  const rankedResults = rankResults(withScoreDeltas);

  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    problemSizeBand,
    split: benchmarkCase.split ?? "development",
    workflowTags: [...(benchmarkCase.workflowTags ?? [])],
    gridRows: benchmarkCase.grid.length,
    gridCols: benchmarkCase.grid[0]?.length ?? 0,
    populationCapacityUpperBound,
    budgetSeconds,
    seed,
    bestScore,
    winnerModes:
      bestScore === null
        ? []
        : rankedResults.filter((result) => result.totalPopulation === bestScore).map((result) => result.mode),
    results: rankedResults
  };
}

export async function runCrossModeBenchmarkSuite(
  corpus: readonly CrossModeBenchmarkCase[] = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  options: CrossModeBenchmarkRunOptions = {}
): Promise<CrossModeBenchmarkSuiteResult> {
  const selected = selectBenchmarkCases(corpus, options.names);
  assertBenchmarkCasesSelected(selected, "No cross-mode benchmark cases matched the requested names.");
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
  const budgetPolicySignals = buildBudgetPolicySignals(cases);
  const portfolioEfficiencySignals = buildPortfolioEfficiencySignals(cases);

  return {
    ...buildBenchmarkSuiteMetadata(selected.map((benchmarkCase) => benchmarkCase.name)),
    budgetSeconds: budgetsSeconds[0] ?? DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
    budgetsSeconds,
    seeds,
    modeCount: modes.length,
    modes,
    cases,
    budgetPolicySignals,
    portfolioEfficiencySignals,
    ...summaries
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
