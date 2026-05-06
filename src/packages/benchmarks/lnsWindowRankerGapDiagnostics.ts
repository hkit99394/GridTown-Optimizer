import { benchmarkGeneratedAt, benchmarkRatio, sumBenchmarkBy, uniqueBenchmarkValuesBy } from "./benchmarkOptions.js";
import {
  inferLnsWindowRankerReplaySeedHintKind,
  normalizeLnsWindowRankerLabelTarget,
  normalizeLnsWindowRankerWeakSeedAllowance,
  type LnsWindowRankerLabelTarget
} from "./lnsWindowRankerBaselines.js";
import { buildModelExperimentFingerprint } from "./modelExperimentArtifacts.js";
import { scoreLnsWindowRankerReplayLabel, type LnsWindowRankerModel } from "./lnsWindowRanker.js";
import {
  buildLnsWindowRankerGapOfflineFeatureDeltas,
  buildLnsWindowRankerGapTraceComparisons,
  type LnsWindowRankerGapDiagnosis,
  type LnsWindowRankerGapLayoutSignature,
  type LnsWindowRankerGapTraceComparison
} from "./lnsWindowRankerGapTraceComparisons.js";
import {
  buildLnsWindowRankerGapRecommendedExperiments,
  type LnsWindowRankerGapRecommendedExperiment
} from "./lnsWindowRankerGapRecommendations.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";

import type { LearnedRankingLabelSnapshot, LearnedRankingLabelSplit } from "./learnedRankingLabels.js";
import type { LnsReplayPressureFamilyLabel } from "./lns.js";
import type { LnsWindowRankerOnlineAblationSnapshot } from "./lnsWindowRankerOnlineAblations.js";
import type {
  LnsWindowReplaySeedHintKind,
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel
} from "./lnsWindowReplayLabels.js";
interface OfflineDecisionGroup {
  split: LearnedRankingLabelSplit;
  source: "label-snapshot" | "supplemental-replay";
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  seedHintKind: LnsWindowReplaySeedHintKind | "unknown";
  statePolicy: string;
  stateIndex: number;
  labels: LnsWindowReplaySnapshotLabel[];
}

export interface LnsWindowRankerGapOfflineDecision {
  split: LearnedRankingLabelSplit;
  source: "label-snapshot" | "supplemental-replay";
  caseName: string;
  pressureFamily: string;
  seed: number | null;
  seedHintKind: string;
  statePolicy: string;
  stateIndex: number;
  exactOnlineDecisionSupplemental: boolean;
  transition: string;
  selectedByBaseline: boolean;
  baselineOperator: string;
  selectedOperator: string;
  baselineWindowIndex: number;
  selectedWindowIndex: number;
  bestTargetValue: number;
  baselineTargetValue: number;
  selectedTargetValue: number;
  selectedDeltaVsBaseline: number;
  regret: number;
  scoreDeltaVsBaseline: number;
  baselineWindow: LnsWindowReplaySnapshotLabel["window"];
  selectedWindow: LnsWindowReplaySnapshotLabel["window"];
  featureDeltas: Record<string, number>;
}

export interface LnsWindowRankerGapOfflineSummary {
  key: string;
  split: LearnedRankingLabelSplit | "all";
  pressureFamily: string | "all";
  transition: string;
  decisionCount: number;
  supplementalDecisionCount: number;
  exactOnlineDecisionSupplementalDecisionCount: number;
  overrideCount: number;
  opportunityCount: number;
  hitBestCount: number;
  selectedPositiveCount: number;
  supplementalSelectedPositiveCount: number;
  exactOnlineDecisionSupplementalSelectedPositiveCount: number;
  baselinePositiveCount: number;
  bestTargetTotal: number;
  selectedTargetTotal: number;
  baselineTargetTotal: number;
  selectedDeltaVsBaselineTotal: number;
  selectedCaptureRate: number;
  baselineCaptureRate: number;
  hitBestRate: number;
  meanSelectedDeltaVsBaseline: number;
  meanScoreDeltaVsBaseline: number;
}

export interface LnsWindowRankerGapOnlineTransitionCase {
  caseName: string;
  pressureFamily: string;
  seed: number | null;
  transition: string;
  count: number;
  finalOutcomeStatus: "improved" | "neutral" | "regressed";
  populationDeltaVsBaseline: number;
}

export interface LnsWindowRankerGapOnlineSummary {
  key: string;
  pressureFamily: string | "all";
  transition: string;
  overrideCount: number;
  finalImprovedCount: number;
  finalNeutralCount: number;
  finalRegressedCount: number;
  caseCount: number;
  populationDeltaTotal: number;
  meanPopulationDelta: number;
}

export interface LnsWindowRankerGapTransitionJoin {
  key: string;
  pressureFamily: string;
  transition: string;
  offline: LnsWindowRankerGapOfflineSummary | null;
  online: LnsWindowRankerGapOnlineSummary | null;
  diagnosis: LnsWindowRankerGapDiagnosis;
  exactReplayNeutralizedOfflinePositiveOnlineNeutral: boolean;
}

export type LnsWindowRankerGapPromotionSensitivityBlocker =
  | "changed-layout-no-lift-trajectory-depth"
  | "missing-layout-delta"
  | "mixed-final-outcome"
  | "unmatched-protected-replay-evidence";

export interface LnsWindowRankerGapPromotionSensitivity {
  suppressedLayoutSignature: "zero-layout-final-neutral";
  suppressedTraceComparisonCount: number;
  remainingTraceComparisonCount: number;
  remainingOfflinePositiveOnlineNeutralCount: number;
  remainingOnlineActiveNoOfflineMatchCount: number;
  changedLayoutNoLiftTrajectoryDepthCount: number;
  missingLayoutDeltaCount: number;
  mixedFinalOutcomeCount: number;
  remainingPromotionBlocked: boolean;
  remainingBlockers: LnsWindowRankerGapPromotionSensitivityBlocker[];
  protectedReplayEvidenceGate: LnsWindowRankerGapProtectedReplayEvidenceGateSensitivity;
}

export interface LnsWindowRankerGapProtectedReplayEvidenceGateSensitivity {
  suppressedDiagnosis: "online-active-no-offline-match";
  suppressedTraceComparisonCount: number;
  remainingTraceComparisonCount: number;
  remainingOfflinePositiveOnlineNeutralCount: number;
  changedLayoutNoLiftTrajectoryDepthCount: number;
  missingLayoutDeltaCount: number;
  mixedFinalOutcomeCount: number;
  remainingPromotionBlocked: boolean;
  remainingBlockers: Exclude<LnsWindowRankerGapPromotionSensitivityBlocker, "unmatched-protected-replay-evidence">[];
}

export interface LnsWindowRankerGapDiagnosticsResult {
  generatedAt: string;
  schemaVersion: 1;
  audit: {
    runtimeDefaultChanged: false;
    solverDefaultChanged: false;
    diagnosticOnly: true;
    target: LnsWindowRankerLabelTarget;
    weakSeedReplayLabelsAllowed: boolean;
    sourceLabelPreset: string | null;
    sourceLnsScaleReady: boolean;
    onlineScorecardType: "lns-window-ranker-online-ablation";
    supplementalReplaySnapshotCount: number;
  };
  inputs: {
    labelFingerprint: string;
    datasetFingerprint: string;
    rankerModelFingerprint: string;
    onlineScorecardFingerprint: string;
    supplementalReplayFingerprints: string[];
  };
  offline: {
    decisionCount: number;
    supplementalDecisionCount: number;
    overrideCount: number;
    opportunityCount: number;
    selectedPositiveCount: number;
    transitionSummaries: LnsWindowRankerGapOfflineSummary[];
    transitionFamilySummaries: LnsWindowRankerGapOfflineSummary[];
  };
  online: {
    selectedCaseNames: string[];
    pressureFamilies: string[];
    seeds: number[];
    comparisonCount: number;
    minScoreDelta: number | null;
    overrideCount: number;
    selectionTraceCount: number;
    finalNeutralOverrideCount: number;
    transitionSummaries: LnsWindowRankerGapOnlineSummary[];
    transitionFamilySummaries: LnsWindowRankerGapOnlineSummary[];
    transitionCases: LnsWindowRankerGapOnlineTransitionCase[];
  };
  joins: LnsWindowRankerGapTransitionJoin[];
  traceComparisons: LnsWindowRankerGapTraceComparison[];
  recommendedExperiments: LnsWindowRankerGapRecommendedExperiment[];
  summary: {
    joinedTransitionFamilyCount: number;
    offlinePositiveOnlineNeutralCount: number;
    onlineActiveNoOfflineMatchCount: number;
    exactReplayNeutralizedOfflinePositiveOnlineNeutralCount: number;
    traceComparisonLayoutSignatureCounts: Record<LnsWindowRankerGapLayoutSignature, number>;
    zeroLayoutFinalNeutralTraceComparisonCount: number;
    changedLayoutFinalNeutralTraceComparisonCount: number;
    mixedLayoutFinalNeutralTraceComparisonCount: number;
    promotionSensitivity: LnsWindowRankerGapPromotionSensitivity;
    promotionBlocked: boolean;
  };
}

export interface LnsWindowRankerGapDiagnosticsOptions {
  supplementalReplaySnapshots?: readonly LnsWindowReplaySnapshot[];
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function fingerprint(value: unknown): string {
  return `fnv1a:${hashString(stableStringify(value))}`;
}

function targetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): number {
  return target === "roll-forward-final-lift" ? (label.rollForward?.populationDeltaVsBaseline ?? 0) : label.improvement;
}

function hasTargetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): boolean {
  return target === "immediate-improvement" || typeof label.rollForward?.populationDeltaVsBaseline === "number";
}

function transitionKey(baselineOperator: string, selectedOperator: string): string {
  return `${baselineOperator}->${selectedOperator}`;
}

function summaryKey(
  transition: string,
  pressureFamily: string | "all",
  split: LearnedRankingLabelSplit | "all"
): string {
  return `${split}:${pressureFamily}:${transition}`;
}

function collectDecisionGroups(
  labelSnapshot: LearnedRankingLabelSnapshot,
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean
): OfflineDecisionGroup[] {
  return labelSnapshot.lns.splits.flatMap((split) =>
    split.replay.cases.flatMap((benchmarkCase): OfflineDecisionGroup[] => {
      const seedHintKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedHintKind === "weak-replay") return [];
      const labels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (labels.length === 0) return [];
      return [
        {
          split: split.split,
          source: "label-snapshot",
          caseName: benchmarkCase.name,
          pressureFamily: benchmarkCase.pressureFamily,
          seed: benchmarkCase.seed,
          seedHintKind,
          statePolicy: benchmarkCase.statePolicy,
          stateIndex: benchmarkCase.stateIndex,
          labels
        }
      ];
    })
  );
}

function collectSupplementalDecisionGroups(
  snapshots: readonly LnsWindowReplaySnapshot[],
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean
): OfflineDecisionGroup[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.cases.flatMap((benchmarkCase): OfflineDecisionGroup[] => {
      const seedHintKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedHintKind === "weak-replay") return [];
      const labels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (labels.length === 0) return [];
      return [
        {
          split: "holdout",
          source: "supplemental-replay",
          caseName: benchmarkCase.name,
          pressureFamily: benchmarkCase.pressureFamily,
          seed: benchmarkCase.seed,
          seedHintKind,
          statePolicy: benchmarkCase.statePolicy,
          stateIndex: benchmarkCase.stateIndex,
          labels
        }
      ];
    })
  );
}

function selectedBaselineLabel(group: OfflineDecisionGroup): LnsWindowReplaySnapshotLabel {
  return (
    group.labels.find((label) => label.selectedByBaseline) ??
    [...group.labels].sort(
      (left, right) => right.operatorScore - left.operatorScore || left.windowIndex - right.windowIndex
    )[0]!
  );
}

function selectedModelLabel(
  group: OfflineDecisionGroup,
  model: LnsWindowRankerModel
): { label: LnsWindowReplaySnapshotLabel; score: number } {
  return group.labels
    .map((label) => ({ label, score: scoreLnsWindowRankerReplayLabel(label, model) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.label.operatorScore - left.label.operatorScore ||
        left.label.windowIndex - right.label.windowIndex
    )[0]!;
}

function buildOfflineDecision(
  group: OfflineDecisionGroup,
  model: LnsWindowRankerModel,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerGapOfflineDecision {
  const baseline = selectedBaselineLabel(group);
  const selected = selectedModelLabel(group, model);
  const baselineTargetValue = targetValue(baseline, target);
  const selectedTargetValue = targetValue(selected.label, target);
  const bestTargetValue = Math.max(...group.labels.map((label) => targetValue(label, target)));
  return {
    split: group.split,
    source: group.source,
    caseName: group.caseName,
    pressureFamily: group.pressureFamily,
    seed: group.seed,
    seedHintKind: group.seedHintKind,
    statePolicy: group.statePolicy,
    stateIndex: group.stateIndex,
    exactOnlineDecisionSupplemental: group.source === "supplemental-replay" && group.statePolicy === "online-decision",
    transition: transitionKey(baseline.operator, selected.label.operator),
    selectedByBaseline: selected.label.selectedByBaseline,
    baselineOperator: baseline.operator,
    selectedOperator: selected.label.operator,
    baselineWindowIndex: baseline.windowIndex,
    selectedWindowIndex: selected.label.windowIndex,
    bestTargetValue,
    baselineTargetValue,
    selectedTargetValue,
    selectedDeltaVsBaseline: selectedTargetValue - baselineTargetValue,
    regret: Math.max(0, bestTargetValue - selectedTargetValue),
    scoreDeltaVsBaseline: selected.score - scoreLnsWindowRankerReplayLabel(baseline, model),
    baselineWindow: { ...baseline.window },
    selectedWindow: { ...selected.label.window },
    featureDeltas: buildLnsWindowRankerGapOfflineFeatureDeltas(selected.label, baseline)
  };
}

function summarizeOfflineDecisions(
  key: string,
  split: LearnedRankingLabelSplit | "all",
  pressureFamily: string | "all",
  transition: string,
  decisions: readonly LnsWindowRankerGapOfflineDecision[]
): LnsWindowRankerGapOfflineSummary {
  const decisionCount = decisions.length;
  const supplementalDecisions = decisions.filter((entry) => entry.source === "supplemental-replay");
  const exactOnlineDecisionSupplementalDecisions = decisions.filter((entry) => entry.exactOnlineDecisionSupplemental);
  const opportunityCount = decisions.filter((entry) => entry.bestTargetValue > 0).length;
  const bestTargetTotal = sumBenchmarkBy(decisions, (entry) => Math.max(0, entry.bestTargetValue));
  const selectedTargetTotal = sumBenchmarkBy(decisions, (entry) => Math.max(0, entry.selectedTargetValue));
  const baselineTargetTotal = sumBenchmarkBy(decisions, (entry) => Math.max(0, entry.baselineTargetValue));
  const selectedDeltaVsBaselineTotal = sumBenchmarkBy(decisions, (entry) => entry.selectedDeltaVsBaseline);
  return {
    key,
    split,
    pressureFamily,
    transition,
    decisionCount,
    supplementalDecisionCount: supplementalDecisions.length,
    exactOnlineDecisionSupplementalDecisionCount: exactOnlineDecisionSupplementalDecisions.length,
    overrideCount: decisions.filter((entry) => !entry.selectedByBaseline).length,
    opportunityCount,
    hitBestCount: decisions.filter(
      (entry) => entry.bestTargetValue > 0 && entry.selectedTargetValue === entry.bestTargetValue
    ).length,
    selectedPositiveCount: decisions.filter((entry) => entry.selectedTargetValue > 0).length,
    supplementalSelectedPositiveCount: supplementalDecisions.filter((entry) => entry.selectedTargetValue > 0).length,
    exactOnlineDecisionSupplementalSelectedPositiveCount: exactOnlineDecisionSupplementalDecisions.filter(
      (entry) => entry.selectedTargetValue > 0
    ).length,
    baselinePositiveCount: decisions.filter((entry) => entry.baselineTargetValue > 0).length,
    bestTargetTotal: roundMetric(bestTargetTotal),
    selectedTargetTotal: roundMetric(selectedTargetTotal),
    baselineTargetTotal: roundMetric(baselineTargetTotal),
    selectedDeltaVsBaselineTotal: roundMetric(selectedDeltaVsBaselineTotal),
    selectedCaptureRate: bestTargetTotal === 0 ? 0 : roundMetric(selectedTargetTotal / bestTargetTotal),
    baselineCaptureRate: bestTargetTotal === 0 ? 0 : roundMetric(baselineTargetTotal / bestTargetTotal),
    hitBestRate: benchmarkRatio(
      decisions.filter((entry) => entry.bestTargetValue > 0 && entry.selectedTargetValue === entry.bestTargetValue)
        .length,
      opportunityCount
    ),
    meanSelectedDeltaVsBaseline: decisionCount === 0 ? 0 : roundMetric(selectedDeltaVsBaselineTotal / decisionCount),
    meanScoreDeltaVsBaseline:
      decisionCount === 0
        ? 0
        : roundMetric(sumBenchmarkBy(decisions, (entry) => entry.scoreDeltaVsBaseline) / decisionCount)
  };
}

function groupOfflineSummaries(
  decisions: readonly LnsWindowRankerGapOfflineDecision[],
  includeFamily: boolean
): LnsWindowRankerGapOfflineSummary[] {
  const groups = new Map<string, LnsWindowRankerGapOfflineDecision[]>();
  for (const decision of decisions) {
    const pressureFamily = includeFamily ? decision.pressureFamily : "all";
    const key = summaryKey(decision.transition, pressureFamily, decision.split);
    groups.set(key, [...(groups.get(key) ?? []), decision]);
  }
  return [...groups.entries()]
    .map(([key, entries]) =>
      summarizeOfflineDecisions(
        key,
        entries[0]!.split,
        includeFamily ? entries[0]!.pressureFamily : "all",
        entries[0]!.transition,
        entries
      )
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

function onlineRankerVariant(benchmarkCase: LnsWindowRankerOnlineAblationSnapshot["cases"][number]) {
  const variant = benchmarkCase.variants.find((entry) => entry.variantName === "window-ranker");
  if (!variant)
    throw new Error(`LNS ranker gap diagnostic missing online window-ranker variant: ${benchmarkCase.name}.`);
  return variant;
}

function collectOnlineTransitionCases(
  onlineScorecard: LnsWindowRankerOnlineAblationSnapshot
): LnsWindowRankerGapOnlineTransitionCase[] {
  return onlineScorecard.cases.flatMap((benchmarkCase) => {
    const variant = onlineRankerVariant(benchmarkCase);
    const diagnostics = variant.selectionDiagnostics;
    if (!diagnostics) return [];
    return Object.entries(diagnostics.overrideTransitionCounts).map(([transition, count]) => ({
      caseName: benchmarkCase.name,
      pressureFamily: benchmarkCase.pressureFamily,
      seed: benchmarkCase.seed,
      transition,
      count,
      finalOutcomeStatus: variant.finalOutcome.status,
      populationDeltaVsBaseline: variant.finalOutcome.populationDeltaVsBaseline
    }));
  });
}

function countOnlineSelectionTraceEntries(onlineScorecard: LnsWindowRankerOnlineAblationSnapshot): number {
  return sumBenchmarkBy(
    onlineScorecard.cases.map((benchmarkCase) => onlineRankerVariant(benchmarkCase)),
    (variant) => variant.selectionTrace?.length ?? 0
  );
}

function summarizeOnlineTransitionCases(
  key: string,
  pressureFamily: string | "all",
  transition: string,
  entries: readonly LnsWindowRankerGapOnlineTransitionCase[]
): LnsWindowRankerGapOnlineSummary {
  const overrideCount = sumBenchmarkBy(entries, (entry) => entry.count);
  const populationDeltaTotal = sumBenchmarkBy(entries, (entry) => entry.populationDeltaVsBaseline);
  return {
    key,
    pressureFamily,
    transition,
    overrideCount,
    finalImprovedCount: sumBenchmarkBy(entries, (entry) => (entry.finalOutcomeStatus === "improved" ? entry.count : 0)),
    finalNeutralCount: sumBenchmarkBy(entries, (entry) => (entry.finalOutcomeStatus === "neutral" ? entry.count : 0)),
    finalRegressedCount: sumBenchmarkBy(entries, (entry) =>
      entry.finalOutcomeStatus === "regressed" ? entry.count : 0
    ),
    caseCount: entries.length,
    populationDeltaTotal: roundMetric(populationDeltaTotal),
    meanPopulationDelta: entries.length === 0 ? 0 : roundMetric(populationDeltaTotal / entries.length)
  };
}

function groupOnlineSummaries(
  entries: readonly LnsWindowRankerGapOnlineTransitionCase[],
  includeFamily: boolean
): LnsWindowRankerGapOnlineSummary[] {
  const groups = new Map<string, LnsWindowRankerGapOnlineTransitionCase[]>();
  for (const entry of entries) {
    const pressureFamily = includeFamily ? entry.pressureFamily : "all";
    const key = summaryKey(entry.transition, pressureFamily, "all");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([key, group]) =>
      summarizeOnlineTransitionCases(key, includeFamily ? group[0]!.pressureFamily : "all", group[0]!.transition, group)
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

function transitionFamilyJoinKey(transition: string, pressureFamily: string): string {
  return `${pressureFamily}:${transition}`;
}

function buildJoins(
  offline: readonly LnsWindowRankerGapOfflineSummary[],
  online: readonly LnsWindowRankerGapOnlineSummary[]
): LnsWindowRankerGapTransitionJoin[] {
  const offlineByKey = new Map(
    offline.map((entry) => [transitionFamilyJoinKey(entry.transition, entry.pressureFamily), entry])
  );
  return online.map((onlineSummary) => {
    const key = transitionFamilyJoinKey(onlineSummary.transition, onlineSummary.pressureFamily);
    const offlineSummary = offlineByKey.get(key) ?? null;
    const onlineAllNeutral =
      onlineSummary.overrideCount > 0 && onlineSummary.finalNeutralCount === onlineSummary.overrideCount;
    const exactReplayNeutralizedOfflinePositiveOnlineNeutral =
      onlineAllNeutral &&
      offlineSummary !== null &&
      offlineSummary.selectedPositiveCount > 0 &&
      offlineSummary.exactOnlineDecisionSupplementalDecisionCount > 0 &&
      offlineSummary.exactOnlineDecisionSupplementalSelectedPositiveCount === 0;
    const diagnosis =
      offlineSummary === null
        ? "online-active-no-offline-match"
        : onlineAllNeutral &&
            offlineSummary.selectedPositiveCount > 0 &&
            !exactReplayNeutralizedOfflinePositiveOnlineNeutral
          ? "offline-positive-online-neutral"
          : "offline-neutral-online-neutral";
    return {
      key,
      pressureFamily: onlineSummary.pressureFamily,
      transition: onlineSummary.transition,
      offline: offlineSummary,
      online: onlineSummary,
      diagnosis,
      exactReplayNeutralizedOfflinePositiveOnlineNeutral
    };
  });
}

function modelTarget(model: LnsWindowRankerModel): LnsWindowRankerLabelTarget {
  return normalizeLnsWindowRankerLabelTarget(model.training?.target);
}

function modelWeakSeedAllowance(model: LnsWindowRankerModel): boolean {
  return normalizeLnsWindowRankerWeakSeedAllowance(model.training?.allowWeakSeedReplayLabels);
}

const LAYOUT_SIGNATURES: readonly LnsWindowRankerGapLayoutSignature[] = Object.freeze([
  "changed-layout-final-neutral",
  "mixed-final-outcome",
  "mixed-layout-final-neutral",
  "missing-layout-delta",
  "zero-layout-final-neutral"
]);

function buildLayoutSignatureCounts(
  traceComparisons: readonly LnsWindowRankerGapTraceComparison[]
): Record<LnsWindowRankerGapLayoutSignature, number> {
  return Object.fromEntries(
    LAYOUT_SIGNATURES.map((signature) => [
      signature,
      traceComparisons.filter((entry) => entry.layoutSignature === signature).length
    ])
  ) as Record<LnsWindowRankerGapLayoutSignature, number>;
}

function buildPromotionSensitivity(
  traceComparisons: readonly LnsWindowRankerGapTraceComparison[]
): LnsWindowRankerGapPromotionSensitivity {
  const suppressedLayoutSignature = "zero-layout-final-neutral";
  const remaining = traceComparisons.filter((entry) => entry.layoutSignature !== suppressedLayoutSignature);
  const remainingOnlineActiveNoOfflineMatchCount = remaining.filter(
    (entry) => entry.diagnosis === "online-active-no-offline-match"
  ).length;
  const changedLayoutNoLiftTrajectoryDepthCount = remaining.filter(
    (entry) =>
      entry.layoutSignature === "changed-layout-final-neutral" || entry.layoutSignature === "mixed-layout-final-neutral"
  ).length;
  const missingLayoutDeltaCount = remaining.filter((entry) => entry.layoutSignature === "missing-layout-delta").length;
  const mixedFinalOutcomeCount = remaining.filter((entry) => entry.layoutSignature === "mixed-final-outcome").length;
  const remainingBlockers: LnsWindowRankerGapPromotionSensitivityBlocker[] = [
    ...(remainingOnlineActiveNoOfflineMatchCount > 0 ? (["unmatched-protected-replay-evidence"] as const) : []),
    ...(changedLayoutNoLiftTrajectoryDepthCount > 0 ? (["changed-layout-no-lift-trajectory-depth"] as const) : []),
    ...(missingLayoutDeltaCount > 0 ? (["missing-layout-delta"] as const) : []),
    ...(mixedFinalOutcomeCount > 0 ? (["mixed-final-outcome"] as const) : [])
  ];
  const evidenceMatched = remaining.filter((entry) => entry.diagnosis !== "online-active-no-offline-match");
  const evidenceMatchedChangedLayoutNoLiftCount = evidenceMatched.filter(
    (entry) =>
      entry.layoutSignature === "changed-layout-final-neutral" || entry.layoutSignature === "mixed-layout-final-neutral"
  ).length;
  const evidenceMatchedMissingLayoutDeltaCount = evidenceMatched.filter(
    (entry) => entry.layoutSignature === "missing-layout-delta"
  ).length;
  const evidenceMatchedMixedFinalOutcomeCount = evidenceMatched.filter(
    (entry) => entry.layoutSignature === "mixed-final-outcome"
  ).length;
  const evidenceMatchedBlockers: LnsWindowRankerGapProtectedReplayEvidenceGateSensitivity["remainingBlockers"] = [
    ...(evidenceMatchedChangedLayoutNoLiftCount > 0 ? (["changed-layout-no-lift-trajectory-depth"] as const) : []),
    ...(evidenceMatchedMissingLayoutDeltaCount > 0 ? (["missing-layout-delta"] as const) : []),
    ...(evidenceMatchedMixedFinalOutcomeCount > 0 ? (["mixed-final-outcome"] as const) : [])
  ];
  return {
    suppressedLayoutSignature,
    suppressedTraceComparisonCount: traceComparisons.length - remaining.length,
    remainingTraceComparisonCount: remaining.length,
    remainingOfflinePositiveOnlineNeutralCount: remaining.filter(
      (entry) => entry.diagnosis === "offline-positive-online-neutral"
    ).length,
    remainingOnlineActiveNoOfflineMatchCount,
    changedLayoutNoLiftTrajectoryDepthCount,
    missingLayoutDeltaCount,
    mixedFinalOutcomeCount,
    remainingPromotionBlocked: remainingBlockers.length > 0,
    remainingBlockers,
    protectedReplayEvidenceGate: {
      suppressedDiagnosis: "online-active-no-offline-match",
      suppressedTraceComparisonCount: remaining.length - evidenceMatched.length,
      remainingTraceComparisonCount: evidenceMatched.length,
      remainingOfflinePositiveOnlineNeutralCount: evidenceMatched.filter(
        (entry) => entry.diagnosis === "offline-positive-online-neutral"
      ).length,
      changedLayoutNoLiftTrajectoryDepthCount: evidenceMatchedChangedLayoutNoLiftCount,
      missingLayoutDeltaCount: evidenceMatchedMissingLayoutDeltaCount,
      mixedFinalOutcomeCount: evidenceMatchedMixedFinalOutcomeCount,
      remainingPromotionBlocked: evidenceMatchedBlockers.length > 0,
      remainingBlockers: evidenceMatchedBlockers
    }
  };
}

export function runLnsWindowRankerGapDiagnostics(
  labelSnapshot: LearnedRankingLabelSnapshot,
  model: LnsWindowRankerModel,
  onlineScorecard: LnsWindowRankerOnlineAblationSnapshot,
  options: LnsWindowRankerGapDiagnosticsOptions = {}
): LnsWindowRankerGapDiagnosticsResult {
  const target = modelTarget(model);
  const allowWeakSeedReplayLabels = modelWeakSeedAllowance(model);
  const supplementalReplaySnapshots = options.supplementalReplaySnapshots ?? [];
  const supplementalDecisionGroups = collectSupplementalDecisionGroups(
    supplementalReplaySnapshots,
    target,
    allowWeakSeedReplayLabels
  );
  const decisionGroups = [
    ...collectDecisionGroups(labelSnapshot, target, allowWeakSeedReplayLabels),
    ...supplementalDecisionGroups
  ];
  const decisions = decisionGroups.map((group) => buildOfflineDecision(group, model, target));
  const onlineTransitionCases = collectOnlineTransitionCases(onlineScorecard);
  const offlineTransitionSummaries = groupOfflineSummaries(decisions, false);
  const offlineTransitionFamilySummaries = groupOfflineSummaries(decisions, true);
  const onlineTransitionSummaries = groupOnlineSummaries(onlineTransitionCases, false);
  const onlineTransitionFamilySummaries = groupOnlineSummaries(onlineTransitionCases, true);
  const joins = buildJoins(
    offlineTransitionFamilySummaries.filter((entry) => entry.split === "holdout"),
    onlineTransitionFamilySummaries
  );
  const traceComparisons = buildLnsWindowRankerGapTraceComparisons(joins, decisions, onlineScorecard);
  const recommendedExperiments = buildLnsWindowRankerGapRecommendedExperiments(traceComparisons);
  const layoutSignatureCounts = buildLayoutSignatureCounts(traceComparisons);
  const promotionSensitivity = buildPromotionSensitivity(traceComparisons);
  const minScoreDeltas = onlineScorecard.cases
    .map((entry) => onlineRankerVariant(entry).windowRanker?.minScoreDelta)
    .filter((entry): entry is number => typeof entry === "number");
  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    audit: {
      runtimeDefaultChanged: false,
      solverDefaultChanged: false,
      diagnosticOnly: true,
      target,
      weakSeedReplayLabelsAllowed: allowWeakSeedReplayLabels,
      sourceLabelPreset: labelSnapshot.audit.lnsReplay.preset,
      sourceLnsScaleReady: labelSnapshot.lns.scaleReadiness.passed,
      onlineScorecardType: "lns-window-ranker-online-ablation",
      supplementalReplaySnapshotCount: supplementalReplaySnapshots.length
    },
    inputs: {
      labelFingerprint: fingerprint(labelSnapshot),
      datasetFingerprint: fingerprint(labelSnapshot.lns),
      rankerModelFingerprint: buildModelExperimentFingerprint(model),
      onlineScorecardFingerprint: fingerprint(onlineScorecard),
      supplementalReplayFingerprints: supplementalReplaySnapshots.map((snapshot) => fingerprint(snapshot))
    },
    offline: {
      decisionCount: decisions.length,
      supplementalDecisionCount: supplementalDecisionGroups.length,
      overrideCount: decisions.filter((entry) => !entry.selectedByBaseline).length,
      opportunityCount: decisions.filter((entry) => entry.bestTargetValue > 0).length,
      selectedPositiveCount: decisions.filter((entry) => entry.selectedTargetValue > 0).length,
      transitionSummaries: offlineTransitionSummaries,
      transitionFamilySummaries: offlineTransitionFamilySummaries
    },
    online: {
      selectedCaseNames: [...onlineScorecard.selectedCaseNames],
      pressureFamilies: uniqueBenchmarkValuesBy(onlineScorecard.cases, (entry) => entry.pressureFamily),
      seeds: [...onlineScorecard.seeds],
      comparisonCount: onlineScorecard.comparisonCount,
      minScoreDelta: minScoreDeltas.length ? minScoreDeltas[0]! : null,
      overrideCount: sumBenchmarkBy(onlineTransitionCases, (entry) => entry.count),
      selectionTraceCount: countOnlineSelectionTraceEntries(onlineScorecard),
      finalNeutralOverrideCount: sumBenchmarkBy(onlineTransitionCases, (entry) =>
        entry.finalOutcomeStatus === "neutral" ? entry.count : 0
      ),
      transitionSummaries: onlineTransitionSummaries,
      transitionFamilySummaries: onlineTransitionFamilySummaries,
      transitionCases: onlineTransitionCases
    },
    joins,
    traceComparisons,
    recommendedExperiments,
    summary: {
      joinedTransitionFamilyCount: joins.length,
      offlinePositiveOnlineNeutralCount: joins.filter((entry) => entry.diagnosis === "offline-positive-online-neutral")
        .length,
      onlineActiveNoOfflineMatchCount: joins.filter((entry) => entry.diagnosis === "online-active-no-offline-match")
        .length,
      exactReplayNeutralizedOfflinePositiveOnlineNeutralCount: joins.filter(
        (entry) => entry.exactReplayNeutralizedOfflinePositiveOnlineNeutral
      ).length,
      traceComparisonLayoutSignatureCounts: layoutSignatureCounts,
      zeroLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["zero-layout-final-neutral"],
      changedLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["changed-layout-final-neutral"],
      mixedLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["mixed-layout-final-neutral"],
      promotionSensitivity,
      promotionBlocked: joins.some((entry) => entry.diagnosis !== "offline-neutral-online-neutral")
    }
  };
}

export {
  buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft,
  buildLnsWindowRankerGapDiagnosticsTelemetryManifest,
  formatLnsWindowRankerGapDiagnostics,
  type LnsWindowRankerGapDiagnosticsRegistryEntryDraftOptions,
  type LnsWindowRankerGapDiagnosticsTelemetryManifestOptions
} from "./lnsWindowRankerGapDiagnosticsArtifacts.js";
