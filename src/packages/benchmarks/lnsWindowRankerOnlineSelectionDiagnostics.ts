import type { LnsWindowRankerSelectionTelemetry } from "../core/index.js";
import type { LnsBenchmarkCaseResult } from "./lns.js";

export type LnsWindowRankerOnlineFinalTransitionStatus = "improved" | "neutral" | "regressed";

export interface LnsWindowRankerOnlineTransitionStatusCounts {
  improved: number;
  neutral: number;
  regressed: number;
}

export interface LnsWindowRankerOnlineSelectionDiagnostics {
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideChangedWindowCount: number;
  fallbackChangedWindowCount: number;
  overrideFeatureDeltaCount: number;
  fallbackFeatureDeltaCount: number;
  overrideMeanFeatureDeltas: Record<string, number>;
  fallbackMeanFeatureDeltas: Record<string, number>;
  overrideTransitionFeatureDeltaCounts: Record<string, number>;
  fallbackTransitionFeatureDeltaCounts: Record<string, number>;
  overrideTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
  fallbackTransitionMeanFeatureDeltas: Record<string, Record<string, number>>;
}

export interface LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
}

export interface LnsWindowRankerOnlineTransitionOutcomeInput {
  pressureFamily: string;
  finalOutcomeStatus: LnsWindowRankerOnlineFinalTransitionStatus;
  selectionDiagnostics: LnsWindowRankerOnlineSelectionDiagnostics | null;
}

function emptyDiagnostics(): LnsWindowRankerOnlineSelectionDiagnostics {
  return {
    overrideTransitionCounts: {},
    fallbackTransitionCounts: {},
    overrideChangedWindowCount: 0,
    fallbackChangedWindowCount: 0,
    overrideFeatureDeltaCount: 0,
    fallbackFeatureDeltaCount: 0,
    overrideMeanFeatureDeltas: {},
    fallbackMeanFeatureDeltas: {},
    overrideTransitionFeatureDeltaCounts: {},
    fallbackTransitionFeatureDeltaCounts: {},
    overrideTransitionMeanFeatureDeltas: {},
    fallbackTransitionMeanFeatureDeltas: {}
  };
}

function emptyStatusCounts(): LnsWindowRankerOnlineTransitionStatusCounts {
  return { improved: 0, neutral: 0, regressed: 0 };
}

function emptyOutcomeDiagnostics(): LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  return {
    overrideTransitionFinalOutcomeCounts: {},
    fallbackTransitionFinalOutcomeCounts: {},
    overrideTransitionPressureFamilyCounts: {},
    fallbackTransitionPressureFamilyCounts: {}
  };
}

function sameTelemetryWindow(
  left: { top: number; left: number; rows: number; cols: number },
  right: { top: number; left: number; rows: number; cols: number }
): boolean {
  return left.top === right.top && left.left === right.left && left.rows === right.rows && left.cols === right.cols;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function mergeCounts(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function roundedFeatureDelta(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function selectionFeatureDeltas(selection: LnsWindowRankerSelectionTelemetry): Record<string, number> | null {
  if (selection.featureDeltas) return selection.featureDeltas;
  if (!selection.baselineFeatures || !selection.selectedFeatures) return null;
  const featureNames = new Set([
    ...Object.keys(selection.baselineFeatures),
    ...Object.keys(selection.selectedFeatures)
  ]);
  return Object.fromEntries(
    [...featureNames].map((featureName) => [
      featureName,
      (selection.selectedFeatures?.[featureName] ?? 0) - (selection.baselineFeatures?.[featureName] ?? 0)
    ])
  );
}

function addDeltasToSums(sums: Record<string, number>, deltas: Record<string, number>): boolean {
  let added = false;
  for (const [featureName, delta] of Object.entries(deltas)) {
    if (!Number.isFinite(delta)) continue;
    sums[featureName] = (sums[featureName] ?? 0) + delta;
    added = true;
  }
  return added;
}

function addFeatureDeltas(sums: Record<string, number>, selection: LnsWindowRankerSelectionTelemetry): boolean {
  const deltas = selectionFeatureDeltas(selection);
  if (!deltas) return false;
  return addDeltasToSums(sums, deltas);
}

function addTransitionFeatureDeltas(
  sumsByTransition: Record<string, Record<string, number>>,
  countsByTransition: Record<string, number>,
  transition: string,
  selection: LnsWindowRankerSelectionTelemetry
): void {
  const deltas = selectionFeatureDeltas(selection);
  if (!deltas) return;
  const sums = sumsByTransition[transition] ?? {};
  if (!addDeltasToSums(sums, deltas)) return;
  sumsByTransition[transition] = sums;
  countsByTransition[transition] = (countsByTransition[transition] ?? 0) + 1;
}

function meanFeatureDeltas(sums: Record<string, number>, count: number): Record<string, number> {
  if (count <= 0) return {};
  return Object.fromEntries(
    Object.entries(sums)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([featureName, sum]) => [featureName, roundedFeatureDelta(sum / count)])
  );
}

function mergeMeanFeatureDeltas(
  leftMean: Record<string, number>,
  leftCount: number,
  rightMean: Record<string, number>,
  rightCount: number
): Record<string, number> {
  const totalCount = leftCount + rightCount;
  if (totalCount <= 0) return {};
  const featureNames = new Set([...Object.keys(leftMean), ...Object.keys(rightMean)]);
  return Object.fromEntries(
    [...featureNames]
      .sort((left, right) => left.localeCompare(right))
      .map((featureName) => [
        featureName,
        roundedFeatureDelta(
          ((leftMean[featureName] ?? 0) * leftCount + (rightMean[featureName] ?? 0) * rightCount) / totalCount
        )
      ])
  );
}

function meanTransitionFeatureDeltas(
  sumsByTransition: Record<string, Record<string, number>>,
  countsByTransition: Record<string, number>
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(sumsByTransition)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([transition, sums]) => [transition, meanFeatureDeltas(sums, countsByTransition[transition] ?? 0)])
  );
}

function mergeTransitionMeanFeatureDeltas(
  leftMeanByTransition: Record<string, Record<string, number>>,
  leftCountsByTransition: Record<string, number>,
  rightMeanByTransition: Record<string, Record<string, number>>,
  rightCountsByTransition: Record<string, number>
): Record<string, Record<string, number>> {
  const transitions = new Set([...Object.keys(leftMeanByTransition), ...Object.keys(rightMeanByTransition)]);
  return Object.fromEntries(
    [...transitions]
      .sort((left, right) => left.localeCompare(right))
      .map((transition) => [
        transition,
        mergeMeanFeatureDeltas(
          leftMeanByTransition[transition] ?? {},
          leftCountsByTransition[transition] ?? 0,
          rightMeanByTransition[transition] ?? {},
          rightCountsByTransition[transition] ?? 0
        )
      ])
      .filter(([, deltas]) => Object.keys(deltas).length > 0)
  );
}

function addStatusCount(
  counts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>,
  transition: string,
  status: LnsWindowRankerOnlineFinalTransitionStatus,
  count: number
): void {
  const statusCounts = counts[transition] ?? emptyStatusCounts();
  statusCounts[status] += count;
  counts[transition] = statusCounts;
}

function addFamilyCount(
  counts: Record<string, Record<string, number>>,
  transition: string,
  pressureFamily: string,
  count: number
): void {
  const familyCounts = counts[transition] ?? {};
  familyCounts[pressureFamily] = (familyCounts[pressureFamily] ?? 0) + count;
  counts[transition] = familyCounts;
}

function addTransitionOutcomeCounts(
  transitionCounts: Record<string, number>,
  finalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>,
  pressureFamilyCounts: Record<string, Record<string, number>>,
  input: LnsWindowRankerOnlineTransitionOutcomeInput
): void {
  for (const [transition, count] of Object.entries(transitionCounts)) {
    addStatusCount(finalOutcomeCounts, transition, input.finalOutcomeStatus, count);
    addFamilyCount(pressureFamilyCounts, transition, input.pressureFamily, count);
  }
}

function transitionKey(selection: LnsWindowRankerSelectionTelemetry): string {
  return `${selection.baselineOperator}->${selection.selectedOperator}`;
}

export function buildLnsWindowRankerOnlineSelectionDiagnostics(
  result: LnsBenchmarkCaseResult
): LnsWindowRankerOnlineSelectionDiagnostics | null {
  let seen = false;
  const diagnostics = emptyDiagnostics();
  const overrideFeatureDeltaSums: Record<string, number> = {};
  const fallbackFeatureDeltaSums: Record<string, number> = {};
  const overrideTransitionFeatureDeltaSums: Record<string, Record<string, number>> = {};
  const fallbackTransitionFeatureDeltaSums: Record<string, Record<string, number>> = {};

  for (const outcome of result.lnsTelemetry?.outcomes ?? []) {
    const selection = outcome.windowRankerSelection;
    if (!selection) continue;
    seen = true;
    const changedWindow = !sameTelemetryWindow(selection.baselineWindow, selection.selectedWindow);
    const transition = transitionKey(selection);
    if (selection.selectedByBaseline === false) {
      incrementCount(diagnostics.overrideTransitionCounts, transition);
      if (changedWindow) diagnostics.overrideChangedWindowCount += 1;
      if (addFeatureDeltas(overrideFeatureDeltaSums, selection)) diagnostics.overrideFeatureDeltaCount += 1;
      addTransitionFeatureDeltas(
        overrideTransitionFeatureDeltaSums,
        diagnostics.overrideTransitionFeatureDeltaCounts,
        transition,
        selection
      );
    }
    if (selection.fallbackReason) {
      incrementCount(diagnostics.fallbackTransitionCounts, transition);
      if (changedWindow) diagnostics.fallbackChangedWindowCount += 1;
      if (addFeatureDeltas(fallbackFeatureDeltaSums, selection)) diagnostics.fallbackFeatureDeltaCount += 1;
      addTransitionFeatureDeltas(
        fallbackTransitionFeatureDeltaSums,
        diagnostics.fallbackTransitionFeatureDeltaCounts,
        transition,
        selection
      );
    }
  }

  diagnostics.overrideMeanFeatureDeltas = meanFeatureDeltas(
    overrideFeatureDeltaSums,
    diagnostics.overrideFeatureDeltaCount
  );
  diagnostics.fallbackMeanFeatureDeltas = meanFeatureDeltas(
    fallbackFeatureDeltaSums,
    diagnostics.fallbackFeatureDeltaCount
  );
  diagnostics.overrideTransitionMeanFeatureDeltas = meanTransitionFeatureDeltas(
    overrideTransitionFeatureDeltaSums,
    diagnostics.overrideTransitionFeatureDeltaCounts
  );
  diagnostics.fallbackTransitionMeanFeatureDeltas = meanTransitionFeatureDeltas(
    fallbackTransitionFeatureDeltaSums,
    diagnostics.fallbackTransitionFeatureDeltaCounts
  );

  return seen ? diagnostics : null;
}

export function mergeLnsWindowRankerOnlineSelectionDiagnostics(
  diagnostics: readonly LnsWindowRankerOnlineSelectionDiagnostics[]
): LnsWindowRankerOnlineSelectionDiagnostics {
  return diagnostics.reduce<LnsWindowRankerOnlineSelectionDiagnostics>(
    (merged, entry) => ({
      overrideTransitionCounts: mergeCounts(merged.overrideTransitionCounts, entry.overrideTransitionCounts),
      fallbackTransitionCounts: mergeCounts(merged.fallbackTransitionCounts, entry.fallbackTransitionCounts),
      overrideChangedWindowCount: merged.overrideChangedWindowCount + entry.overrideChangedWindowCount,
      fallbackChangedWindowCount: merged.fallbackChangedWindowCount + entry.fallbackChangedWindowCount,
      overrideFeatureDeltaCount: merged.overrideFeatureDeltaCount + entry.overrideFeatureDeltaCount,
      fallbackFeatureDeltaCount: merged.fallbackFeatureDeltaCount + entry.fallbackFeatureDeltaCount,
      overrideMeanFeatureDeltas: mergeMeanFeatureDeltas(
        merged.overrideMeanFeatureDeltas,
        merged.overrideFeatureDeltaCount,
        entry.overrideMeanFeatureDeltas,
        entry.overrideFeatureDeltaCount
      ),
      fallbackMeanFeatureDeltas: mergeMeanFeatureDeltas(
        merged.fallbackMeanFeatureDeltas,
        merged.fallbackFeatureDeltaCount,
        entry.fallbackMeanFeatureDeltas,
        entry.fallbackFeatureDeltaCount
      ),
      overrideTransitionFeatureDeltaCounts: mergeCounts(
        merged.overrideTransitionFeatureDeltaCounts,
        entry.overrideTransitionFeatureDeltaCounts
      ),
      fallbackTransitionFeatureDeltaCounts: mergeCounts(
        merged.fallbackTransitionFeatureDeltaCounts,
        entry.fallbackTransitionFeatureDeltaCounts
      ),
      overrideTransitionMeanFeatureDeltas: mergeTransitionMeanFeatureDeltas(
        merged.overrideTransitionMeanFeatureDeltas,
        merged.overrideTransitionFeatureDeltaCounts,
        entry.overrideTransitionMeanFeatureDeltas,
        entry.overrideTransitionFeatureDeltaCounts
      ),
      fallbackTransitionMeanFeatureDeltas: mergeTransitionMeanFeatureDeltas(
        merged.fallbackTransitionMeanFeatureDeltas,
        merged.fallbackTransitionFeatureDeltaCounts,
        entry.fallbackTransitionMeanFeatureDeltas,
        entry.fallbackTransitionFeatureDeltaCounts
      )
    }),
    emptyDiagnostics()
  );
}

export function buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics(
  inputs: readonly LnsWindowRankerOnlineTransitionOutcomeInput[]
): LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  const diagnostics = emptyOutcomeDiagnostics();
  for (const input of inputs) {
    if (!input.selectionDiagnostics) continue;
    addTransitionOutcomeCounts(
      input.selectionDiagnostics.overrideTransitionCounts,
      diagnostics.overrideTransitionFinalOutcomeCounts,
      diagnostics.overrideTransitionPressureFamilyCounts,
      input
    );
    addTransitionOutcomeCounts(
      input.selectionDiagnostics.fallbackTransitionCounts,
      diagnostics.fallbackTransitionFinalOutcomeCounts,
      diagnostics.fallbackTransitionPressureFamilyCounts,
      input
    );
  }
  return diagnostics;
}

export function formatLnsWindowRankerOnlineTransitionCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${value}`).join(",");
}

export function formatLnsWindowRankerOnlineTransitionFinalOutcomeCounts(
  counts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>
): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${value.improved}/${value.neutral}/${value.regressed}`).join(",");
}

export function formatLnsWindowRankerOnlineTransitionPressureFamilyCounts(
  counts: Record<string, Record<string, number>>
): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries
    .map(([key, familyCounts]) => {
      const formattedFamilies = Object.entries(familyCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([family, count]) => `${family}:${count}`)
        .join("|");
      return `${key}[${formattedFamilies}]`;
    })
    .join(",");
}

export function formatLnsWindowRankerOnlineFeatureDeltas(deltas: Record<string, number>, limit = 5): string {
  const entries = Object.entries(deltas)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .sort(
      ([leftName, leftValue], [rightName, rightValue]) =>
        Math.abs(rightValue) - Math.abs(leftValue) || leftName.localeCompare(rightName)
    )
    .slice(0, limit);
  if (entries.length === 0) return "none";
  return entries.map(([featureName, value]) => `${featureName}:${value >= 0 ? "+" : ""}${value}`).join(",");
}

export function formatLnsWindowRankerOnlineTransitionFeatureDeltas(
  deltasByTransition: Record<string, Record<string, number>>,
  transitionLimit = 5,
  featureLimit = 3
): string {
  const entries = Object.entries(deltasByTransition)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, transitionLimit)
    .map(([transition, deltas]) => `${transition}[${formatLnsWindowRankerOnlineFeatureDeltas(deltas, featureLimit)}]`);
  return entries.length > 0 ? entries.join(",") : "none";
}
