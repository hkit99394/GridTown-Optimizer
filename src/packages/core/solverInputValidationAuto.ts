import type { SolverParams } from "./types.js";

import {
  requireOptionalFiniteNumberInRange,
  requireOptionalIntegerInRange,
  requireValidationRecord,
} from "./solverInputValidationShared.js";

const GREEDY_RANDOM_SEED_MAX = 0x7fffffff;

const AUTO_MAX_WALL_CLOCK_LIMIT_SECONDS = 24 * 60 * 60;
const AUTO_MAX_WEAK_CYCLE_IMPROVEMENT_THRESHOLD = 1;
const AUTO_MAX_CONSECUTIVE_WEAK_CYCLES = 100;
const AUTO_MAX_STAGE_TIME_LIMIT_SECONDS = 24 * 60 * 60;

export function assertValidAutoOptions(params: SolverParams): void {
  const autoValue = (params as Record<string, unknown>).auto;
  if (autoValue === undefined) return;

  const auto = requireValidationRecord(autoValue, "Auto options auto");
  requireOptionalFiniteNumberInRange(
    auto,
    "wallClockLimitSeconds",
    "Auto option auto.wallClockLimitSeconds",
    0,
    AUTO_MAX_WALL_CLOCK_LIMIT_SECONDS
  );
  requireOptionalIntegerInRange(
    auto,
    "randomSeed",
    "Auto option auto.randomSeed",
    0,
    GREEDY_RANDOM_SEED_MAX
  );
  requireOptionalFiniteNumberInRange(
    auto,
    "weakCycleImprovementThreshold",
    "Auto option auto.weakCycleImprovementThreshold",
    0,
    AUTO_MAX_WEAK_CYCLE_IMPROVEMENT_THRESHOLD,
    true
  );
  requireOptionalIntegerInRange(
    auto,
    "maxConsecutiveWeakCycles",
    "Auto option auto.maxConsecutiveWeakCycles",
    1,
    AUTO_MAX_CONSECUTIVE_WEAK_CYCLES
  );
  requireOptionalFiniteNumberInRange(
    auto,
    "cpSatStageTimeLimitSeconds",
    "Auto option auto.cpSatStageTimeLimitSeconds",
    0,
    AUTO_MAX_STAGE_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    auto,
    "cpSatStageReserveRatio",
    "Auto option auto.cpSatStageReserveRatio",
    0,
    1,
    true
  );
  requireOptionalFiniteNumberInRange(
    auto,
    "cpSatStageNoImprovementTimeoutSeconds",
    "Auto option auto.cpSatStageNoImprovementTimeoutSeconds",
    0,
    AUTO_MAX_STAGE_TIME_LIMIT_SECONDS
  );
}
