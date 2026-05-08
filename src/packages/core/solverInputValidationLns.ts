import { LNS_WINDOW_RANKER_FEATURE_NAMES } from "./types.js";
import type { SolverParams } from "./types.js";

import {
  requireOptionalBoolean,
  requireOptionalFiniteNumberInRange,
  requireOptionalIntegerInRange,
  requireOptionalString,
  requireOptionalStringInSet,
  requireValidationRecord,
  SolverInputError
} from "./solverInputValidationShared.js";

const LNS_MAX_ITERATIONS = 10_000;
const LNS_MAX_NEIGHBORHOOD_DIMENSION = 10_000;
const LNS_MAX_TIME_LIMIT_SECONDS = 24 * 60 * 60;
const LNS_MAX_SMALL_WINDOW_DP_MUTABLE_CELLS = 24;
const LNS_MAX_SMALL_WINDOW_DP_CANDIDATES = 64;
const LNS_MAX_SMALL_WINDOW_DP_STATES = 1_000_000;
const LNS_MAX_WINDOW_RANKER_SCORE_DELTA = 1_000_000;
const LNS_NEIGHBORHOOD_ANCHOR_POLICIES = [
  "ranked",
  "sliding-only",
  "weak-service-first",
  "residential-opportunity-first",
  "frontier-congestion-first",
  "placed-buildings-first"
] as const;
const LNS_ADAPTIVE_OPERATORS = [
  "weak-service",
  "residential-headroom",
  "frontier-congestion",
  "gate-choke",
  "service-overlap",
  "random-exploration",
  "placed-buildings",
  "sliding"
] as const;

function assertValidWindowRankerAllowedTransitions(windowRanker: Record<string, unknown>): void {
  const value = windowRanker.allowedTransitions;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new SolverInputError("LNS option lns.windowRanker.allowedTransitions must be an array of strings.");
  }

  const operators = new Set<string>(LNS_ADAPTIVE_OPERATORS);
  for (const transition of value) {
    const [baselineOperator, selectedOperator, extra] = transition.split("->");
    if (
      extra !== undefined ||
      baselineOperator === undefined ||
      selectedOperator === undefined ||
      !operators.has(baselineOperator) ||
      !operators.has(selectedOperator)
    ) {
      throw new SolverInputError(
        "LNS option lns.windowRanker.allowedTransitions must contain operator transitions like weak-service->random-exploration."
      );
    }
  }
}

function assertValidWindowRankerFeatureDeltaGates(windowRanker: Record<string, unknown>): void {
  const value = windowRanker.featureDeltaGates;
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new SolverInputError("LNS option lns.windowRanker.featureDeltaGates must be an array of objects.");
  }

  const knownFeatures = new Set<string>(LNS_WINDOW_RANKER_FEATURE_NAMES);
  for (const [index, entry] of value.entries()) {
    const label = `LNS option lns.windowRanker.featureDeltaGates[${index}]`;
    const gate = requireValidationRecord(entry, label);
    if (typeof gate.feature !== "string" || gate.feature.trim().length === 0) {
      throw new SolverInputError(`${label}.feature must be a non-empty string.`);
    }
    if (!knownFeatures.has(gate.feature)) {
      throw new SolverInputError(`${label}.feature must be one of the LNS window ranker feature names.`);
    }
    requireOptionalFiniteNumberInRange(
      gate,
      "minDelta",
      `${label}.minDelta`,
      -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      true
    );
    requireOptionalFiniteNumberInRange(
      gate,
      "maxDelta",
      `${label}.maxDelta`,
      -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      true
    );
    if (gate.minDelta === undefined && gate.maxDelta === undefined) {
      throw new SolverInputError(`${label} must include minDelta or maxDelta.`);
    }
    if (typeof gate.minDelta === "number" && typeof gate.maxDelta === "number" && gate.minDelta > gate.maxDelta) {
      throw new SolverInputError(`${label}.minDelta must be less than or equal to maxDelta.`);
    }
  }
}

function assertValidWindowRankerOptions(lns: Record<string, unknown>): void {
  const value = lns.windowRanker;
  if (value === undefined) return;
  const windowRanker = requireValidationRecord(value, "LNS option lns.windowRanker");
  requireOptionalBoolean(windowRanker, "enabled", "LNS option lns.windowRanker.enabled");
  if (windowRanker.enabled === false) return;
  requireOptionalBoolean(windowRanker, "captureDecisionState", "LNS option lns.windowRanker.captureDecisionState");
  requireOptionalFiniteNumberInRange(
    windowRanker,
    "minScoreDelta",
    "LNS option lns.windowRanker.minScoreDelta",
    0,
    LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    true
  );
  assertValidWindowRankerAllowedTransitions(windowRanker);
  assertValidWindowRankerFeatureDeltaGates(windowRanker);

  const model = requireValidationRecord(windowRanker.model, "LNS option lns.windowRanker.model");
  requireOptionalString(model, "modelFingerprint", "LNS option lns.windowRanker.model.modelFingerprint");
  requireOptionalStringInSet(model, "modelType", "LNS option lns.windowRanker.model.modelType", [
    "lns-window-linear-pairwise-ranker"
  ]);
  requireOptionalFiniteNumberInRange(
    model,
    "intercept",
    "LNS option lns.windowRanker.model.intercept",
    -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    true
  );
  if (
    model.featureSchemaVersion !== undefined &&
    model.featureSchemaVersion !== null &&
    model.featureSchemaVersion !== 2
  ) {
    throw new SolverInputError("LNS option lns.windowRanker.model.featureSchemaVersion must be null or 2.");
  }
  if (model.featureNames !== undefined) {
    if (!Array.isArray(model.featureNames) || model.featureNames.some((entry) => typeof entry !== "string")) {
      throw new SolverInputError("LNS option lns.windowRanker.model.featureNames must be an array of strings.");
    }
  }

  const weights = requireValidationRecord(model.weights, "LNS option lns.windowRanker.model.weights");
  const entries = Object.entries(weights);
  if (entries.length === 0) {
    throw new SolverInputError("LNS option lns.windowRanker.model.weights must include at least one weight.");
  }
  for (const [featureName, weight] of entries) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new SolverInputError(`LNS option lns.windowRanker.model.weights.${featureName} must be a finite number.`);
    }
  }
}

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
  assertValidWindowRankerOptions(lns);
  requireOptionalString(lns, "stopFilePath", "LNS runtime option lns.stopFilePath");
  requireOptionalString(lns, "snapshotFilePath", "LNS runtime option lns.snapshotFilePath");
}
