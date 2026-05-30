import { isLnsWindowRankerFeatureName, lnsWindowRankerRuntimeModelValidationError } from "./lnsWindowRankerSchema.js";
import { LNS_ADAPTIVE_OPERATOR_NAMES, LNS_NEIGHBORHOOD_ANCHOR_POLICIES } from "./types.js";
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
function assertValidWindowRankerAllowedTransitions(windowRanker: Record<string, unknown>): void {
  const value = windowRanker.allowedTransitions;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new SolverInputError("LNS option lns.windowRanker.allowedTransitions must be an array of strings.");
  }

  const operators = new Set<string>(LNS_ADAPTIVE_OPERATOR_NAMES);
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

  for (const [index, entry] of value.entries()) {
    const label = `LNS option lns.windowRanker.featureDeltaGates[${index}]`;
    const gate = requireValidationRecord(entry, label);
    if (typeof gate.feature !== "string" || gate.feature.trim().length === 0) {
      throw new SolverInputError(`${label}.feature must be a non-empty string.`);
    }
    if (!isLnsWindowRankerFeatureName(gate.feature)) {
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

function assertValidWindowRankerSelectedFeatureGates(windowRanker: Record<string, unknown>): void {
  const value = windowRanker.selectedFeatureGates;
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new SolverInputError("LNS option lns.windowRanker.selectedFeatureGates must be an array of objects.");
  }

  for (const [index, entry] of value.entries()) {
    const label = `LNS option lns.windowRanker.selectedFeatureGates[${index}]`;
    assertValidWindowRankerSelectedFeatureGate(entry, label);
  }
}

function assertValidWindowRankerSelectedFeatureGateGroups(windowRanker: Record<string, unknown>): void {
  const value = windowRanker.selectedFeatureGateGroups;
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new SolverInputError(
      "LNS option lns.windowRanker.selectedFeatureGateGroups must be an array of non-empty gate arrays."
    );
  }

  for (const [groupIndex, group] of value.entries()) {
    const groupLabel = `LNS option lns.windowRanker.selectedFeatureGateGroups[${groupIndex}]`;
    if (!Array.isArray(group) || group.length === 0) {
      throw new SolverInputError(`${groupLabel} must be a non-empty array of gate objects.`);
    }
    for (const [gateIndex, entry] of group.entries()) {
      assertValidWindowRankerSelectedFeatureGate(entry, `${groupLabel}[${gateIndex}]`);
    }
  }
}

function assertValidWindowRankerSelectedFeatureGate(entry: unknown, label: string): void {
  const gate = requireValidationRecord(entry, label);
  if (typeof gate.feature !== "string" || gate.feature.trim().length === 0) {
    throw new SolverInputError(`${label}.feature must be a non-empty string.`);
  }
  if (!isLnsWindowRankerFeatureName(gate.feature)) {
    throw new SolverInputError(`${label}.feature must be one of the LNS window ranker feature names.`);
  }
  requireOptionalFiniteNumberInRange(
    gate,
    "minValue",
    `${label}.minValue`,
    -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    true
  );
  requireOptionalFiniteNumberInRange(
    gate,
    "maxValue",
    `${label}.maxValue`,
    -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    true
  );
  if (gate.minValue === undefined && gate.maxValue === undefined) {
    throw new SolverInputError(`${label} must include minValue or maxValue.`);
  }
  if (typeof gate.minValue === "number" && typeof gate.maxValue === "number" && gate.minValue > gate.maxValue) {
    throw new SolverInputError(`${label}.minValue must be less than or equal to maxValue.`);
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
  requireOptionalFiniteNumberInRange(
    windowRanker,
    "suppressionMinScoreDelta",
    "LNS option lns.windowRanker.suppressionMinScoreDelta",
    0,
    LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
    true
  );
  if (windowRanker.suppressionMinScoreDelta !== undefined && windowRanker.suppressionModel === undefined) {
    throw new SolverInputError(
      "LNS option lns.windowRanker.suppressionMinScoreDelta requires lns.windowRanker.suppressionModel."
    );
  }
  assertValidWindowRankerAllowedTransitions(windowRanker);
  assertValidWindowRankerSelectedFeatureGates(windowRanker);
  assertValidWindowRankerSelectedFeatureGateGroups(windowRanker);
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
  const schemaError = lnsWindowRankerRuntimeModelValidationError(model, "LNS option lns.windowRanker.model");
  if (schemaError !== null) {
    throw new SolverInputError(schemaError);
  }
  if (windowRanker.suppressionModel !== undefined) {
    const suppressionModel = requireValidationRecord(
      windowRanker.suppressionModel,
      "LNS option lns.windowRanker.suppressionModel"
    );
    requireOptionalString(
      suppressionModel,
      "modelFingerprint",
      "LNS option lns.windowRanker.suppressionModel.modelFingerprint"
    );
    requireOptionalStringInSet(
      suppressionModel,
      "modelType",
      "LNS option lns.windowRanker.suppressionModel.modelType",
      ["lns-window-linear-pairwise-ranker"]
    );
    requireOptionalFiniteNumberInRange(
      suppressionModel,
      "intercept",
      "LNS option lns.windowRanker.suppressionModel.intercept",
      -LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      LNS_MAX_WINDOW_RANKER_SCORE_DELTA,
      true
    );
    const suppressionSchemaError = lnsWindowRankerRuntimeModelValidationError(
      suppressionModel,
      "LNS option lns.windowRanker.suppressionModel"
    );
    if (suppressionSchemaError !== null) {
      throw new SolverInputError(suppressionSchemaError);
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
