import { formatBenchmarkSignedNumber, sumBenchmarkBy } from "./benchmarkOptions.js";
import { LNS_WINDOW_RANKER_FEATURE_NAMES } from "./lnsWindowRanker.js";

import type { LnsWindowRankerFeatureName } from "./lnsWindowRanker.js";
import type { LnsWindowRankerOnlineAblationSnapshot } from "./lnsWindowRankerOnlineAblations.js";
import type { LnsWindowReplaySnapshotLabel } from "./lnsWindowReplayLabels.js";
import type {
  LnsWindowRankerGapOfflineDecision,
  LnsWindowRankerGapTransitionJoin
} from "./lnsWindowRankerGapDiagnostics.js";

export type LnsWindowRankerGapDiagnosis =
  | "offline-positive-online-neutral"
  | "offline-neutral-online-neutral"
  | "online-active-no-offline-match";

type LnsWindowRankerOnlineTraceEntry =
  LnsWindowRankerOnlineAblationSnapshot["cases"][number]["variants"][number]["selectionTrace"][number];

interface OnlineTraceWithCase {
  caseName: string;
  pressureFamily: string;
  seed: number | null;
  finalOutcomeStatus: "improved" | "neutral" | "regressed";
  populationDeltaVsBaseline: number;
  trace: LnsWindowRankerOnlineTraceEntry;
}

export interface LnsWindowRankerGapTraceFeatureDelta {
  featureName: string;
  offlineMeanDelta: number | null;
  onlineMeanDelta: number;
  meanDeltaGap: number | null;
}

export interface LnsWindowRankerGapOfflineTraceSample {
  caseName: string;
  seed: number | null;
  statePolicy: string;
  stateIndex: number;
  baselineWindowIndex: number;
  selectedWindowIndex: number;
  baselineWindow: LnsWindowReplaySnapshotLabel["window"];
  selectedWindow: LnsWindowReplaySnapshotLabel["window"];
  selectedDeltaVsBaseline: number;
  scoreDeltaVsBaseline: number;
}

export interface LnsWindowRankerGapOnlineTraceSample {
  caseName: string;
  seed: number | null;
  iteration: number;
  baselineWindow: LnsWindowRankerOnlineTraceEntry["baselineWindow"];
  selectedWindow: LnsWindowRankerOnlineTraceEntry["selectedWindow"];
  outcomeStatus: LnsWindowRankerOnlineTraceEntry["outcomeStatus"];
  finalOutcomeStatus: "improved" | "neutral" | "regressed";
  improvement: number;
  populationDeltaVsBaseline: number;
  scoreDelta: number;
}

export interface LnsWindowRankerGapTraceComparison {
  key: string;
  pressureFamily: string;
  transition: string;
  diagnosis: LnsWindowRankerGapDiagnosis;
  offlineDecisionCount: number;
  offlineSelectedPositiveCount: number;
  offlineMeanSelectedDeltaVsBaseline: number | null;
  offlineMeanScoreDeltaVsBaseline: number | null;
  onlineTraceCount: number;
  onlineNeutralTraceCount: number;
  onlineMeanImprovement: number | null;
  onlineMeanScoreDelta: number | null;
  topFeatureDeltaGaps: LnsWindowRankerGapTraceFeatureDelta[];
  offlineSamples: LnsWindowRankerGapOfflineTraceSample[];
  onlineSamples: LnsWindowRankerGapOnlineTraceSample[];
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function labelFeatureRecord(label: LnsWindowReplaySnapshotLabel): Record<LnsWindowRankerFeatureName, number> {
  const features = label.features;
  const connectivity = features.connectivityShadow;
  const fragmentation = features.fragmentation;
  const candidateLoss = features.candidateLoss;
  const values = [
    label.operatorScore / 100,
    label.selectedByBaseline ? 1 : 0,
    numericValue(features.area) / 20,
    numericValue(features.roadCountInside) / 10,
    numericValue(features.serviceCountInside) / 4,
    numericValue(features.residentialCountInside) / 4,
    numericValue(features.residentialHeadroomInside) / 500,
    numericValue(features.serviceBonusInside) / 500,
    numericValue(connectivity.reachableEmptyCellsBefore) / 50,
    numericValue(connectivity.reachableEmptyCellsAfterClearingWindow) / 50,
    numericValue(connectivity.newlyReachableEmptyCellsIfCleared) / 50,
    numericValue(connectivity.disconnectedEmptyCellsBefore) / 50,
    numericValue(connectivity.disconnectedEmptyCellsAfterClearingWindow) / 50,
    numericValue(connectivity.clearedBuildingFootprintCells) / 20,
    numericValue(fragmentation.emptyComponentCountBefore) / 10,
    numericValue(fragmentation.emptyComponentCountAfterClearingWindow) / 10,
    numericValue(fragmentation.componentDeltaAfterClearingWindow) / 10,
    numericValue(fragmentation.allowedWindowCellCount) / 20,
    numericValue(fragmentation.anchorReachableWindowCellCount) / 20,
    numericValue(fragmentation.narrowGateCellCount) / 10,
    numericValue(candidateLoss.serviceCandidatesIntersectingWindow) / 20,
    numericValue(candidateLoss.residentialCandidatesIntersectingWindow) / 20,
    numericValue(candidateLoss.serviceCandidatesBlockedByIncumbent) / 20,
    numericValue(candidateLoss.residentialCandidatesBlockedByIncumbent) / 20,
    numericValue(candidateLoss.serviceCandidateBonusInside) / 500,
    numericValue(candidateLoss.maxServiceCandidateBonusInside) / 500,
    numericValue(candidateLoss.residentialCandidateHeadroomInside) / 500
  ];
  return Object.fromEntries(
    LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName, index) => [featureName, roundMetric(values[index] ?? 0)])
  ) as Record<LnsWindowRankerFeatureName, number>;
}

export function buildLnsWindowRankerGapOfflineFeatureDeltas(
  selected: LnsWindowReplaySnapshotLabel,
  baseline: LnsWindowReplaySnapshotLabel
): Record<string, number> {
  const selectedFeatures = labelFeatureRecord(selected);
  const baselineFeatures = labelFeatureRecord(baseline);
  return Object.fromEntries(
    LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName) => [
      featureName,
      roundMetric(selectedFeatures[featureName] - baselineFeatures[featureName])
    ])
  );
}

function onlineRankerVariant(benchmarkCase: LnsWindowRankerOnlineAblationSnapshot["cases"][number]) {
  const variant = benchmarkCase.variants.find((entry) => entry.variantName === "window-ranker");
  if (!variant)
    throw new Error(`LNS ranker gap trace comparison missing online window-ranker variant: ${benchmarkCase.name}.`);
  return variant;
}

function collectOnlineSelectionTraces(onlineScorecard: LnsWindowRankerOnlineAblationSnapshot): OnlineTraceWithCase[] {
  return onlineScorecard.cases.flatMap((benchmarkCase) => {
    const variant = onlineRankerVariant(benchmarkCase);
    return (variant.selectionTrace ?? [])
      .filter((trace) => trace.selectionStatus === "override")
      .map((trace) => ({
        caseName: benchmarkCase.name,
        pressureFamily: benchmarkCase.pressureFamily,
        seed: benchmarkCase.seed,
        finalOutcomeStatus: variant.finalOutcome.status,
        populationDeltaVsBaseline: variant.finalOutcome.populationDeltaVsBaseline,
        trace
      }));
  });
}

function meanFeatureDeltas(records: readonly Record<string, number>[]): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const record of records) {
    for (const [featureName, value] of Object.entries(record)) {
      if (!Number.isFinite(value)) continue;
      sums[featureName] = (sums[featureName] ?? 0) + value;
      counts[featureName] = (counts[featureName] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(sums)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([featureName, sum]) => [featureName, roundMetric(sum / (counts[featureName] ?? 1))])
  );
}

function topFeatureDeltaGaps(
  offlineMean: Record<string, number> | null,
  onlineMean: Record<string, number>,
  limit = 5
): LnsWindowRankerGapTraceFeatureDelta[] {
  const featureNames = new Set([...Object.keys(offlineMean ?? {}), ...Object.keys(onlineMean)]);
  return [...featureNames]
    .map((featureName) => {
      const offlineMeanDelta = offlineMean?.[featureName] ?? null;
      const onlineMeanDelta = onlineMean[featureName] ?? 0;
      return {
        featureName,
        offlineMeanDelta,
        onlineMeanDelta,
        meanDeltaGap: offlineMeanDelta === null ? null : roundMetric(onlineMeanDelta - offlineMeanDelta)
      };
    })
    .filter((entry) => entry.offlineMeanDelta !== 0 || entry.onlineMeanDelta !== 0)
    .sort((left, right) => {
      const leftMagnitude = Math.abs(left.meanDeltaGap ?? left.onlineMeanDelta);
      const rightMagnitude = Math.abs(right.meanDeltaGap ?? right.onlineMeanDelta);
      return rightMagnitude - leftMagnitude || left.featureName.localeCompare(right.featureName);
    })
    .slice(0, limit);
}

function meanOrNull<T>(entries: readonly T[], selector: (entry: T) => number): number | null {
  return entries.length === 0 ? null : roundMetric(sumBenchmarkBy(entries, selector) / entries.length);
}

function buildOfflineTraceSamples(
  decisions: readonly LnsWindowRankerGapOfflineDecision[]
): LnsWindowRankerGapOfflineTraceSample[] {
  return [...decisions]
    .sort(
      (left, right) =>
        right.selectedDeltaVsBaseline - left.selectedDeltaVsBaseline ||
        right.scoreDeltaVsBaseline - left.scoreDeltaVsBaseline
    )
    .slice(0, 3)
    .map((decision) => ({
      caseName: decision.caseName,
      seed: decision.seed,
      statePolicy: decision.statePolicy,
      stateIndex: decision.stateIndex,
      baselineWindowIndex: decision.baselineWindowIndex,
      selectedWindowIndex: decision.selectedWindowIndex,
      baselineWindow: { ...decision.baselineWindow },
      selectedWindow: { ...decision.selectedWindow },
      selectedDeltaVsBaseline: roundMetric(decision.selectedDeltaVsBaseline),
      scoreDeltaVsBaseline: roundMetric(decision.scoreDeltaVsBaseline)
    }));
}

function buildOnlineTraceSamples(traces: readonly OnlineTraceWithCase[]): LnsWindowRankerGapOnlineTraceSample[] {
  return [...traces]
    .sort(
      (left, right) => right.trace.scoreDelta - left.trace.scoreDelta || left.caseName.localeCompare(right.caseName)
    )
    .slice(0, 3)
    .map((entry) => ({
      caseName: entry.caseName,
      seed: entry.seed,
      iteration: entry.trace.iteration,
      baselineWindow: { ...entry.trace.baselineWindow },
      selectedWindow: { ...entry.trace.selectedWindow },
      outcomeStatus: entry.trace.outcomeStatus,
      finalOutcomeStatus: entry.finalOutcomeStatus,
      improvement: entry.trace.improvement,
      populationDeltaVsBaseline: entry.populationDeltaVsBaseline,
      scoreDelta: entry.trace.scoreDelta
    }));
}

export function buildLnsWindowRankerGapTraceComparisons(
  joins: readonly LnsWindowRankerGapTransitionJoin[],
  decisions: readonly LnsWindowRankerGapOfflineDecision[],
  onlineScorecard: LnsWindowRankerOnlineAblationSnapshot
): LnsWindowRankerGapTraceComparison[] {
  const onlineTraces = collectOnlineSelectionTraces(onlineScorecard);
  return joins
    .filter((join) => join.diagnosis !== "offline-neutral-online-neutral")
    .map((join) => {
      const offline = decisions.filter(
        (decision) =>
          decision.split === "holdout" &&
          decision.pressureFamily === join.pressureFamily &&
          decision.transition === join.transition
      );
      const online = onlineTraces.filter(
        (entry) => entry.pressureFamily === join.pressureFamily && entry.trace.transition === join.transition
      );
      const offlineMeanFeatures = offline.length
        ? meanFeatureDeltas(offline.map((entry) => entry.featureDeltas))
        : null;
      const onlineMeanFeatures = meanFeatureDeltas(online.map((entry) => entry.trace.featureDeltas ?? {}));
      return {
        key: join.key,
        pressureFamily: join.pressureFamily,
        transition: join.transition,
        diagnosis: join.diagnosis,
        offlineDecisionCount: offline.length,
        offlineSelectedPositiveCount: offline.filter((entry) => entry.selectedTargetValue > 0).length,
        offlineMeanSelectedDeltaVsBaseline: meanOrNull(offline, (entry) => entry.selectedDeltaVsBaseline),
        offlineMeanScoreDeltaVsBaseline: meanOrNull(offline, (entry) => entry.scoreDeltaVsBaseline),
        onlineTraceCount: online.length,
        onlineNeutralTraceCount: online.filter((entry) => entry.finalOutcomeStatus === "neutral").length,
        onlineMeanImprovement: meanOrNull(online, (entry) => entry.trace.improvement),
        onlineMeanScoreDelta: meanOrNull(online, (entry) => entry.trace.scoreDelta),
        topFeatureDeltaGaps: topFeatureDeltaGaps(offlineMeanFeatures, onlineMeanFeatures),
        offlineSamples: buildOfflineTraceSamples(offline),
        onlineSamples: buildOnlineTraceSamples(online)
      };
    });
}

function formatNullableSigned(value: number | null): string {
  return value === null ? "n/a" : formatBenchmarkSignedNumber(value);
}

function formatTraceFeatureDeltas(features: readonly LnsWindowRankerGapTraceFeatureDelta[]): string {
  if (features.length === 0) return "none";
  return features
    .map((entry) => {
      const offline = entry.offlineMeanDelta === null ? "n/a" : formatBenchmarkSignedNumber(entry.offlineMeanDelta);
      const online = formatBenchmarkSignedNumber(entry.onlineMeanDelta);
      const gap = entry.meanDeltaGap === null ? "n/a" : formatBenchmarkSignedNumber(entry.meanDeltaGap);
      return `${entry.featureName}:offline=${offline}/online=${online}/gap=${gap}`;
    })
    .join(",");
}

export function formatLnsWindowRankerGapTraceComparison(comparison: LnsWindowRankerGapTraceComparison): string {
  return `- ${comparison.diagnosis} ${comparison.pressureFamily}/${comparison.transition}: offline-decisions=${comparison.offlineDecisionCount} offline-selected-positive=${comparison.offlineSelectedPositiveCount} offline-mean-selected-delta=${formatNullableSigned(comparison.offlineMeanSelectedDeltaVsBaseline)} online-traces=${comparison.onlineTraceCount} online-neutral-traces=${comparison.onlineNeutralTraceCount} online-mean-improvement=${formatNullableSigned(comparison.onlineMeanImprovement)} online-mean-score-delta=${formatNullableSigned(comparison.onlineMeanScoreDelta)} features=${formatTraceFeatureDeltas(comparison.topFeatureDeltaGaps)}`;
}
