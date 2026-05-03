import type { SolverParams } from "./types.js";

import {
  requireOptionalBoolean,
  requireOptionalFiniteNumberInRange,
  requireOptionalIntegerInRange,
  requireOptionalString,
  requireOptionalStringInSet,
  requireValidationRecord
} from "./solverInputValidationShared.js";

const LNS_MAX_ITERATIONS = 10_000;
const LNS_MAX_NEIGHBORHOOD_DIMENSION = 10_000;
const LNS_MAX_TIME_LIMIT_SECONDS = 24 * 60 * 60;
const LNS_MAX_SMALL_WINDOW_DP_MUTABLE_CELLS = 24;
const LNS_MAX_SMALL_WINDOW_DP_CANDIDATES = 64;
const LNS_MAX_SMALL_WINDOW_DP_STATES = 1_000_000;
const LNS_NEIGHBORHOOD_ANCHOR_POLICIES = [
  "ranked",
  "sliding-only",
  "weak-service-first",
  "residential-opportunity-first",
  "frontier-congestion-first",
  "placed-buildings-first"
] as const;

export function assertValidLnsOptions(params: SolverParams): void {
  const lnsValue = (params as Record<string, unknown>).lns;
  if (lnsValue === undefined) return;

  const lns = requireValidationRecord(lnsValue, "LNS options lns");
  requireOptionalIntegerInRange(lns, "iterations", "LNS option lns.iterations", 1, LNS_MAX_ITERATIONS);
  requireOptionalIntegerInRange(
    lns,
    "maxNoImprovementIterations",
    "LNS option lns.maxNoImprovementIterations",
    1,
    LNS_MAX_ITERATIONS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "wallClockLimitSeconds",
    "LNS option lns.wallClockLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "timeLimitSeconds",
    "LNS option lns.timeLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "noImprovementTimeoutSeconds",
    "LNS option lns.noImprovementTimeoutSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "seedTimeLimitSeconds",
    "LNS option lns.seedTimeLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalIntegerInRange(
    lns,
    "neighborhoodRows",
    "LNS option lns.neighborhoodRows",
    1,
    LNS_MAX_NEIGHBORHOOD_DIMENSION
  );
  requireOptionalIntegerInRange(
    lns,
    "neighborhoodCols",
    "LNS option lns.neighborhoodCols",
    1,
    LNS_MAX_NEIGHBORHOOD_DIMENSION
  );
  requireOptionalStringInSet(
    lns,
    "neighborhoodAnchorPolicy",
    "LNS option lns.neighborhoodAnchorPolicy",
    LNS_NEIGHBORHOOD_ANCHOR_POLICIES
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "repairTimeLimitSeconds",
    "LNS option lns.repairTimeLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "focusedRepairTimeLimitSeconds",
    "LNS option lns.focusedRepairTimeLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    lns,
    "escalatedRepairTimeLimitSeconds",
    "LNS option lns.escalatedRepairTimeLimitSeconds",
    0,
    LNS_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalBoolean(lns, "smallWindowDpRepair", "LNS option lns.smallWindowDpRepair");
  requireOptionalIntegerInRange(
    lns,
    "smallWindowDpMaxMutableCells",
    "LNS option lns.smallWindowDpMaxMutableCells",
    1,
    LNS_MAX_SMALL_WINDOW_DP_MUTABLE_CELLS
  );
  requireOptionalIntegerInRange(
    lns,
    "smallWindowDpMaxCandidates",
    "LNS option lns.smallWindowDpMaxCandidates",
    1,
    LNS_MAX_SMALL_WINDOW_DP_CANDIDATES
  );
  requireOptionalIntegerInRange(
    lns,
    "smallWindowDpMaxStates",
    "LNS option lns.smallWindowDpMaxStates",
    1,
    LNS_MAX_SMALL_WINDOW_DP_STATES
  );
  requireOptionalString(lns, "stopFilePath", "LNS runtime option lns.stopFilePath");
  requireOptionalString(lns, "snapshotFilePath", "LNS runtime option lns.snapshotFilePath");
}
