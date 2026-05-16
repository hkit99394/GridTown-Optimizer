import type { SolverParams } from "./types.js";

import {
  requireOptionalBoolean,
  requireOptionalFiniteNumberInRange,
  requireOptionalIntegerInRange,
  requireOptionalString,
  requireValidationRecord
} from "./solverInputValidationShared.js";

const GREEDY_RANDOM_SEED_MAX = 0x7fffffff;
const GREEDY_MAX_RESTARTS = 100;
const GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS = 100;
const GREEDY_MAX_SERVICE_CANDIDATE_LIMIT = 2_000;
const GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT = 64;
const GREEDY_MAX_SERVICE_EXACT_COMBINATIONS = 100_000;
const GREEDY_MAX_SERVICE_MASTER_POOL_LIMIT = 128;
const GREEDY_MAX_SERVICE_MASTER_LAYOUTS = 100_000;
const GREEDY_MAX_TIME_LIMIT_SECONDS = 24 * 60 * 60;
const GREEDY_MAX_DENSITY_TIE_BREAKER_TOLERANCE_PERCENT = 100;

export function assertValidGreedyOptions(params: SolverParams): void {
  const paramsRecord = params as Record<string, unknown>;
  const greedyValue = paramsRecord.greedy;
  const greedy = greedyValue === undefined ? undefined : requireValidationRecord(greedyValue, "Greedy options greedy");

  if (greedy) {
    requireOptionalBoolean(greedy, "localSearch", "Greedy option greedy.localSearch");
    requireOptionalBoolean(greedy, "localSearchServiceMoves", "Greedy option greedy.localSearchServiceMoves");
    requireOptionalIntegerInRange(
      greedy,
      "localSearchServiceCandidateLimit",
      "Greedy option greedy.localSearchServiceCandidateLimit",
      1,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceLookaheadCandidates",
      "Greedy option greedy.serviceLookaheadCandidates",
      0,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalBoolean(greedy, "deferRoadCommitment", "Greedy option greedy.deferRoadCommitment");
    requireOptionalBoolean(greedy, "densityTieBreaker", "Greedy option greedy.densityTieBreaker");
    requireOptionalFiniteNumberInRange(
      greedy,
      "densityTieBreakerTolerancePercent",
      "Greedy option greedy.densityTieBreakerTolerancePercent",
      0,
      GREEDY_MAX_DENSITY_TIE_BREAKER_TOLERANCE_PERCENT,
      true
    );
    requireOptionalBoolean(greedy, "connectivityShadowScoring", "Greedy option greedy.connectivityShadowScoring");
    requireOptionalIntegerInRange(greedy, "randomSeed", "Greedy option greedy.randomSeed", 0, GREEDY_RANDOM_SEED_MAX);
    requireOptionalBoolean(greedy, "profile", "Greedy option greedy.profile");
    requireOptionalBoolean(greedy, "diagnostics", "Greedy option greedy.diagnostics");
    requireOptionalFiniteNumberInRange(
      greedy,
      "timeLimitSeconds",
      "Greedy option greedy.timeLimitSeconds",
      0,
      GREEDY_MAX_TIME_LIMIT_SECONDS
    );
    requireOptionalIntegerInRange(greedy, "restarts", "Greedy option greedy.restarts", 1, GREEDY_MAX_RESTARTS);
    requireOptionalIntegerInRange(
      greedy,
      "serviceRefineIterations",
      "Greedy option greedy.serviceRefineIterations",
      0,
      GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceRefineCandidateLimit",
      "Greedy option greedy.serviceRefineCandidateLimit",
      1,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalBoolean(greedy, "exhaustiveServiceSearch", "Greedy option greedy.exhaustiveServiceSearch");
    requireOptionalIntegerInRange(
      greedy,
      "serviceExactPoolLimit",
      "Greedy option greedy.serviceExactPoolLimit",
      1,
      GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceExactMaxCombinations",
      "Greedy option greedy.serviceExactMaxCombinations",
      1,
      GREEDY_MAX_SERVICE_EXACT_COMBINATIONS
    );
    requireOptionalBoolean(greedy, "serviceMasterDecomposition", "Greedy option greedy.serviceMasterDecomposition");
    requireOptionalIntegerInRange(
      greedy,
      "serviceMasterPoolLimit",
      "Greedy option greedy.serviceMasterPoolLimit",
      1,
      GREEDY_MAX_SERVICE_MASTER_POOL_LIMIT
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceMasterMaxLayouts",
      "Greedy option greedy.serviceMasterMaxLayouts",
      1,
      GREEDY_MAX_SERVICE_MASTER_LAYOUTS
    );
    requireOptionalString(greedy, "stopFilePath", "Greedy option greedy.stopFilePath");
    requireOptionalString(greedy, "snapshotFilePath", "Greedy option greedy.snapshotFilePath");
  }

  requireOptionalBoolean(paramsRecord, "localSearch", "Legacy greedy option localSearch");
  requireOptionalIntegerInRange(paramsRecord, "restarts", "Legacy greedy option restarts", 1, GREEDY_MAX_RESTARTS);
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceRefineIterations",
    "Legacy greedy option serviceRefineIterations",
    0,
    GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS
  );
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceRefineCandidateLimit",
    "Legacy greedy option serviceRefineCandidateLimit",
    1,
    GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
  );
  requireOptionalBoolean(paramsRecord, "exhaustiveServiceSearch", "Legacy greedy option exhaustiveServiceSearch");
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceExactPoolLimit",
    "Legacy greedy option serviceExactPoolLimit",
    1,
    GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT
  );
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceExactMaxCombinations",
    "Legacy greedy option serviceExactMaxCombinations",
    1,
    GREEDY_MAX_SERVICE_EXACT_COMBINATIONS
  );
}
