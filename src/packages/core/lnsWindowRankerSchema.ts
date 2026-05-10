import { LNS_WINDOW_RANKER_FEATURE_NAMES } from "./types.js";

import type { LnsWindowRankerFeatureName, LnsWindowRankerRuntimeModel } from "./types.js";

export const LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION = 2;

export type LnsWindowRankerInteractionFeatureName = `${LnsWindowRankerFeatureName}*${LnsWindowRankerFeatureName}`;

const LNS_WINDOW_RANKER_FEATURE_NAME_SET = new Set<string>(LNS_WINDOW_RANKER_FEATURE_NAMES);

export const LNS_WINDOW_RANKER_INTERACTION_FEATURE_NAMES = Object.freeze(
  LNS_WINDOW_RANKER_FEATURE_NAMES.flatMap((left, leftIndex) =>
    LNS_WINDOW_RANKER_FEATURE_NAMES.slice(leftIndex).map((right) => `${left}*${right}`)
  )
) as readonly LnsWindowRankerInteractionFeatureName[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isLnsWindowRankerFeatureName(value: unknown): value is LnsWindowRankerFeatureName {
  return typeof value === "string" && LNS_WINDOW_RANKER_FEATURE_NAME_SET.has(value);
}

export function isLnsWindowRankerInteractionFeatureName(
  value: unknown
): value is LnsWindowRankerInteractionFeatureName {
  if (typeof value !== "string") return false;
  const [left, right, extra] = value.split("*");
  return extra === undefined && isLnsWindowRankerFeatureName(left) && isLnsWindowRankerFeatureName(right);
}

function isKnownFeatureOrInteractionName(value: unknown): boolean {
  return isLnsWindowRankerFeatureName(value) || isLnsWindowRankerInteractionFeatureName(value);
}

function featureNameListValidationError(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return `${label} must be an array of strings.`;
  }

  const seen = new Set<string>();
  for (const featureName of value) {
    if (!isKnownFeatureOrInteractionName(featureName)) {
      return `${label} entries must be LNS window ranker feature names or pairwise interaction names.`;
    }
    if (seen.has(featureName)) {
      return `${label} must not include duplicate entries.`;
    }
    seen.add(featureName);
  }
  return null;
}

function weightsValidationError(weights: unknown, label: string): string | null {
  if (!isRecord(weights)) return `${label} must be an object.`;
  const entries = Object.entries(weights);
  if (entries.length === 0) return `${label} must include at least one weight.`;

  for (const [featureName, weight] of entries) {
    if (!isLnsWindowRankerFeatureName(featureName)) {
      return `${label}.${featureName} must be one of the LNS window ranker feature names.`;
    }
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      return `${label}.${featureName} must be a finite number.`;
    }
  }
  return null;
}

function interactionWeightsValidationError(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return `${label} must be an object.`;

  for (const [featureName, weight] of Object.entries(value)) {
    if (!isLnsWindowRankerInteractionFeatureName(featureName)) {
      return `${label} keys must be pairwise feature names like operatorScore*selectedByBaseline.`;
    }
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      return `${label}.${featureName} must be a finite number.`;
    }
  }
  return null;
}

export function lnsWindowRankerRuntimeModelValidationError(
  model: unknown,
  label = "LNS window ranker model"
): string | null {
  if (!isRecord(model)) return `${label} must be an object.`;
  if (model.modelType !== undefined && model.modelType !== "lns-window-linear-pairwise-ranker") {
    return `${label}.modelType must be lns-window-linear-pairwise-ranker.`;
  }
  if (
    model.featureSchemaVersion !== undefined &&
    model.featureSchemaVersion !== null &&
    model.featureSchemaVersion !== LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION
  ) {
    return `${label}.featureSchemaVersion must be null or ${LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION}.`;
  }

  return (
    featureNameListValidationError(model.featureNames, `${label}.featureNames`) ??
    weightsValidationError(model.weights, `${label}.weights`) ??
    interactionWeightsValidationError(model.interactionWeights, `${label}.interactionWeights`)
  );
}

export function assertValidLnsWindowRankerRuntimeModel(
  model: unknown,
  label = "LNS window ranker model"
): asserts model is LnsWindowRankerRuntimeModel {
  const error = lnsWindowRankerRuntimeModelValidationError(model, label);
  if (error !== null) {
    throw new Error(error);
  }
}
