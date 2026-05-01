import type { SolverParams } from "../../core/index.js";

const DEFAULT_WEAK_CYCLE_IMPROVEMENT_THRESHOLD = 0.005;
const DEFAULT_MAX_CONSECUTIVE_WEAK_CYCLES = 2;
const DEFAULT_CP_SAT_STAGE_TIME_LIMIT_SECONDS = 30;
const DEFAULT_CP_SAT_STAGE_NO_IMPROVEMENT_TIMEOUT_SECONDS = 10;
const AUTO_GREEDY_STAGE_RESTART_CAP = 4;
const AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP = 1;
const AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP = 24;
const AUTO_GREEDY_STAGE_EXACT_POOL_CAP = 8;
const AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP = 512;
const AUTO_CP_SAT_STAGE_RESERVE_RATIO = 0.2;
const AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS = 1;
const AUTO_TRACE_TUNED_LNS_MAX_ITERATIONS = 24;
const AUTO_TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS = 5;
const AUTO_TRACE_TUNED_LNS_MEDIUM_BUDGET_SECONDS = 30;

export const MAX_STAGE_RANDOM_SEED = 0x7fffffff;

export interface NormalizedAutoOptions {
  wallClockLimitSeconds: number | null;
  randomSeed: number | null;
  weakCycleImprovementThreshold: number;
  maxConsecutiveWeakCycles: number;
  cpSatStageTimeLimitSeconds: number;
  cpSatStageReserveRatio: number;
  cpSatStageNoImprovementTimeoutSeconds: number;
}

export interface AutoLnsStageBudget {
  wallClockLimitSeconds: number | null;
  seedTimeLimitSeconds?: number;
  iterations?: number;
  maxNoImprovementIterations?: number;
  repairTimeLimitSeconds: number;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(finiteNumberOrDefault(value, fallback)));
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  const normalized = finiteNumberOrDefault(value, fallback);
  return normalized > 0 ? Math.max(0.001, normalized) : fallback;
}

function optionalPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function capPositiveSeconds(value: number, limit: number): number {
  return Math.max(0.001, Math.min(value, limit));
}

export function normalizeAutoOptions(params: SolverParams): NormalizedAutoOptions {
  const auto = params.auto ?? {};
  const configuredWallClockLimitSeconds = finiteNumberOrDefault(auto.wallClockLimitSeconds, Number.NaN);
  const wallClockLimitSeconds = configuredWallClockLimitSeconds > 0
    ? Math.max(0.001, configuredWallClockLimitSeconds)
    : null;
  return {
    wallClockLimitSeconds,
    randomSeed:
      typeof auto.randomSeed === "number" && Number.isInteger(auto.randomSeed) && auto.randomSeed >= 0
        ? Math.min(auto.randomSeed, MAX_STAGE_RANDOM_SEED)
        : null,
    weakCycleImprovementThreshold: Math.max(
      0,
      finiteNumberOrDefault(auto.weakCycleImprovementThreshold, DEFAULT_WEAK_CYCLE_IMPROVEMENT_THRESHOLD)
    ),
    maxConsecutiveWeakCycles: positiveIntegerOrDefault(
      auto.maxConsecutiveWeakCycles,
      DEFAULT_MAX_CONSECUTIVE_WEAK_CYCLES
    ),
    cpSatStageTimeLimitSeconds: positiveNumberOrDefault(
      auto.cpSatStageTimeLimitSeconds,
      DEFAULT_CP_SAT_STAGE_TIME_LIMIT_SECONDS
    ),
    cpSatStageReserveRatio: Math.max(
      0,
      Math.min(
        1,
        finiteNumberOrDefault(auto.cpSatStageReserveRatio, AUTO_CP_SAT_STAGE_RESERVE_RATIO)
      )
    ),
    cpSatStageNoImprovementTimeoutSeconds: positiveNumberOrDefault(
      auto.cpSatStageNoImprovementTimeoutSeconds,
      DEFAULT_CP_SAT_STAGE_NO_IMPROVEMENT_TIMEOUT_SECONDS
    ),
  };
}

export function buildAutoGreedyStageOptions(params: SolverParams): NonNullable<SolverParams["greedy"]> {
  const greedy = params.greedy ?? {};
  return {
    ...greedy,
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    profile: greedy.profile ?? true,
    densityTieBreaker: false,
    densityTieBreakerTolerancePercent: 0,
    restarts: Math.max(
      1,
      Math.min(greedy.restarts ?? params.restarts ?? AUTO_GREEDY_STAGE_RESTART_CAP, AUTO_GREEDY_STAGE_RESTART_CAP)
    ),
    serviceRefineIterations: Math.max(
      0,
      Math.min(
        greedy.serviceRefineIterations ?? params.serviceRefineIterations ?? AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP,
        AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP
      )
    ),
    serviceRefineCandidateLimit: Math.max(
      1,
      Math.min(
        greedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit ?? AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP,
        AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP
      )
    ),
    exhaustiveServiceSearch: false,
    serviceExactPoolLimit: Math.max(
      1,
      Math.min(
        greedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit ?? AUTO_GREEDY_STAGE_EXACT_POOL_CAP,
        AUTO_GREEDY_STAGE_EXACT_POOL_CAP
      )
    ),
    serviceExactMaxCombinations: Math.max(
      1,
      Math.min(
        greedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations ?? AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP,
        AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP
      )
    ),
  };
}

function reservedCpSatStageSeconds(options: NormalizedAutoOptions, remainingSeconds: number): number {
  if (
    options.wallClockLimitSeconds === null
    || options.cpSatStageReserveRatio <= 0
    || remainingSeconds <= AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS
  ) {
    return 0;
  }
  const budgetScaledReserve = options.wallClockLimitSeconds * options.cpSatStageReserveRatio;
  return Math.min(
    options.cpSatStageTimeLimitSeconds,
    Math.max(AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS, budgetScaledReserve),
    Math.max(0, remainingSeconds - AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS)
  );
}

function budgetedAutoLnsStageSeconds(options: NormalizedAutoOptions, remainingSeconds: number): number {
  const cpSatReserveSeconds = reservedCpSatStageSeconds(options, remainingSeconds);
  return Math.max(0.001, remainingSeconds - cpSatReserveSeconds);
}

function defaultAutoLnsRepairBudgetSeconds(budgetSeconds: number): number {
  if (budgetSeconds <= AUTO_TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS) return 1;
  if (budgetSeconds <= AUTO_TRACE_TUNED_LNS_MEDIUM_BUDGET_SECONDS) return 2;
  return 5;
}

function defaultAutoLnsSeedBudgetSeconds(budgetSeconds: number, repairTimeLimitSeconds: number): number {
  return Math.max(0.1, Math.min(budgetSeconds * 0.2, repairTimeLimitSeconds));
}

function defaultAutoLnsEscalatedRepairBudgetSeconds(
  budgetSeconds: number,
  repairTimeLimitSeconds: number
): number {
  if (budgetSeconds <= AUTO_TRACE_TUNED_LNS_SMALL_BUDGET_SECONDS) return repairTimeLimitSeconds;
  return Math.min(repairTimeLimitSeconds * 2, Math.max(repairTimeLimitSeconds, budgetSeconds * 0.1));
}

function defaultAutoLnsIterations(stageBudgetSeconds: number, repairTimeLimitSeconds: number): number {
  return Math.max(
    1,
    Math.min(
      AUTO_TRACE_TUNED_LNS_MAX_ITERATIONS,
      Math.floor(Math.max(0.001, stageBudgetSeconds) / Math.max(0.001, repairTimeLimitSeconds))
    )
  );
}

export function buildAutoLnsStageBudget(
  params: SolverParams,
  options: NormalizedAutoOptions,
  remainingSeconds: number | null
): AutoLnsStageBudget {
  const wallClockLimitSeconds = remainingSeconds === null
    ? null
    : budgetedAutoLnsStageSeconds(options, remainingSeconds);
  const tuningBudgetSeconds = options.wallClockLimitSeconds
    ?? wallClockLimitSeconds
    ?? params.cpSat?.timeLimitSeconds
    ?? DEFAULT_CP_SAT_STAGE_TIME_LIMIT_SECONDS;
  const defaultRepairTimeLimitSeconds = defaultAutoLnsRepairBudgetSeconds(tuningBudgetSeconds);
  const configuredRepairTimeLimitSeconds = params.lns?.repairTimeLimitSeconds
    ?? (options.wallClockLimitSeconds === null ? params.cpSat?.timeLimitSeconds : undefined)
    ?? defaultRepairTimeLimitSeconds;
  const repairTimeLimitSeconds = wallClockLimitSeconds === null
    ? configuredRepairTimeLimitSeconds
    : capPositiveSeconds(configuredRepairTimeLimitSeconds, wallClockLimitSeconds);
  const configuredSeedTimeLimitSeconds = optionalPositiveNumber(params.lns?.seedTimeLimitSeconds)
    ?? defaultAutoLnsSeedBudgetSeconds(tuningBudgetSeconds, repairTimeLimitSeconds);
  const seedTimeLimitSeconds = wallClockLimitSeconds !== null
    ? capPositiveSeconds(configuredSeedTimeLimitSeconds, wallClockLimitSeconds)
    : configuredSeedTimeLimitSeconds;
  const repairVariantLimitSeconds = wallClockLimitSeconds ?? repairTimeLimitSeconds;
  const defaultEscalatedRepairTimeLimitSeconds = defaultAutoLnsEscalatedRepairBudgetSeconds(
    tuningBudgetSeconds,
    repairTimeLimitSeconds
  );
  const focusedRepairTimeLimitSeconds = wallClockLimitSeconds === null && params.lns?.focusedRepairTimeLimitSeconds !== undefined
    ? params.lns.focusedRepairTimeLimitSeconds
    : capPositiveSeconds(params.lns?.focusedRepairTimeLimitSeconds ?? repairTimeLimitSeconds, repairVariantLimitSeconds);
  const escalatedRepairTimeLimitSeconds = wallClockLimitSeconds === null && params.lns?.escalatedRepairTimeLimitSeconds !== undefined
    ? params.lns.escalatedRepairTimeLimitSeconds
    : capPositiveSeconds(params.lns?.escalatedRepairTimeLimitSeconds ?? defaultEscalatedRepairTimeLimitSeconds, repairVariantLimitSeconds);
  const defaultIterations = defaultAutoLnsIterations(repairVariantLimitSeconds, repairTimeLimitSeconds);
  const iterations = params.lns?.iterations ?? defaultIterations;
  const maxNoImprovementIterations = params.lns?.maxNoImprovementIterations
    ?? (params.lns?.iterations === undefined ? defaultIterations : undefined);

  return {
    wallClockLimitSeconds,
    seedTimeLimitSeconds,
    iterations,
    ...(maxNoImprovementIterations !== undefined ? { maxNoImprovementIterations } : {}),
    repairTimeLimitSeconds,
    focusedRepairTimeLimitSeconds,
    escalatedRepairTimeLimitSeconds,
  };
}
