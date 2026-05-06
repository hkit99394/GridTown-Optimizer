import {
  benchmarkGeneratedAt,
  benchmarkRatio,
  formatBenchmarkRate,
  formatBenchmarkSignedNumber,
  sumBenchmarkBy,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import {
  inferLnsWindowRankerReplaySeedHintKind,
  normalizeLnsWindowRankerLabelTarget,
  normalizeLnsWindowRankerWeakSeedAllowance,
  type LnsWindowRankerLabelTarget
} from "./lnsWindowRankerBaselines.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import { scoreLnsWindowRankerReplayLabel, type LnsWindowRankerModel } from "./lnsWindowRanker.js";
import {
  buildLnsWindowRankerGapOfflineFeatureDeltas,
  buildLnsWindowRankerGapTraceComparisons,
  formatLnsWindowRankerGapTraceComparison,
  type LnsWindowRankerGapDiagnosis,
  type LnsWindowRankerGapLayoutSignature,
  type LnsWindowRankerGapTraceComparison
} from "./lnsWindowRankerGapTraceComparisons.js";
import {
  buildLnsWindowRankerGapRecommendedExperiments,
  formatLnsWindowRankerGapRecommendedExperiment,
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
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifest,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";

interface OfflineDecisionGroup {
  split: LearnedRankingLabelSplit;
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
  caseName: string;
  pressureFamily: string;
  seed: number | null;
  seedHintKind: string;
  statePolicy: string;
  stateIndex: number;
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
  overrideCount: number;
  opportunityCount: number;
  hitBestCount: number;
  selectedPositiveCount: number;
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

export interface LnsWindowRankerGapDiagnosticsTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerGapDiagnosticsRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {}

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
    caseName: group.caseName,
    pressureFamily: group.pressureFamily,
    seed: group.seed,
    seedHintKind: group.seedHintKind,
    statePolicy: group.statePolicy,
    stateIndex: group.stateIndex,
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
    overrideCount: decisions.filter((entry) => !entry.selectedByBaseline).length,
    opportunityCount,
    hitBestCount: decisions.filter(
      (entry) => entry.bestTargetValue > 0 && entry.selectedTargetValue === entry.bestTargetValue
    ).length,
    selectedPositiveCount: decisions.filter((entry) => entry.selectedTargetValue > 0).length,
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
    const diagnosis =
      offlineSummary === null
        ? "online-active-no-offline-match"
        : onlineAllNeutral && offlineSummary.selectedPositiveCount > 0
          ? "offline-positive-online-neutral"
          : "offline-neutral-online-neutral";
    return {
      key,
      pressureFamily: onlineSummary.pressureFamily,
      transition: onlineSummary.transition,
      offline: offlineSummary,
      online: onlineSummary,
      diagnosis
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
      traceComparisonLayoutSignatureCounts: layoutSignatureCounts,
      zeroLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["zero-layout-final-neutral"],
      changedLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["changed-layout-final-neutral"],
      mixedLayoutFinalNeutralTraceComparisonCount: layoutSignatureCounts["mixed-layout-final-neutral"],
      promotionSensitivity,
      promotionBlocked: joins.some((entry) => entry.diagnosis !== "offline-neutral-online-neutral")
    }
  };
}

function modelRecord(result: LnsWindowRankerGapDiagnosticsResult): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelType: "lns-window-ranker-gap-diagnostics",
    purpose: "offline-diagnostics-only",
    runtimeDefaultChanged: false,
    solverDefaultChanged: false,
    target: result.audit.target,
    weakSeedReplayLabelsAllowed: result.audit.weakSeedReplayLabelsAllowed,
    supplementalReplaySnapshotCount: result.audit.supplementalReplaySnapshotCount,
    rankerModelFingerprint: result.inputs.rankerModelFingerprint,
    onlineScorecardType: result.audit.onlineScorecardType
  };
}

function summaryMetrics(result: LnsWindowRankerGapDiagnosticsResult): Record<string, unknown> {
  return {
    target: result.audit.target,
    weakSeedReplayLabelsAllowed: result.audit.weakSeedReplayLabelsAllowed,
    supplementalReplaySnapshotCount: result.audit.supplementalReplaySnapshotCount,
    offlineDecisionCount: result.offline.decisionCount,
    offlineSupplementalDecisionCount: result.offline.supplementalDecisionCount,
    offlineOverrideCount: result.offline.overrideCount,
    offlineOpportunityCount: result.offline.opportunityCount,
    onlineComparisonCount: result.online.comparisonCount,
    onlineOverrideCount: result.online.overrideCount,
    onlineSelectionTraceCount: result.online.selectionTraceCount,
    onlineFinalNeutralOverrideCount: result.online.finalNeutralOverrideCount,
    joinedTransitionFamilyCount: result.summary.joinedTransitionFamilyCount,
    offlinePositiveOnlineNeutralCount: result.summary.offlinePositiveOnlineNeutralCount,
    onlineActiveNoOfflineMatchCount: result.summary.onlineActiveNoOfflineMatchCount,
    traceComparisonLayoutSignatureCounts: result.summary.traceComparisonLayoutSignatureCounts,
    zeroLayoutFinalNeutralTraceComparisonCount: result.summary.zeroLayoutFinalNeutralTraceComparisonCount,
    changedLayoutFinalNeutralTraceComparisonCount: result.summary.changedLayoutFinalNeutralTraceComparisonCount,
    mixedLayoutFinalNeutralTraceComparisonCount: result.summary.mixedLayoutFinalNeutralTraceComparisonCount,
    promotionSensitivity: result.summary.promotionSensitivity,
    traceComparisonCount: result.traceComparisons.length,
    traceComparisonOnlineTraceCount: sumBenchmarkBy(result.traceComparisons, (entry) => entry.onlineTraceCount),
    traceComparisonChangedFinalLayoutTraceCount: sumBenchmarkBy(
      result.traceComparisons,
      (entry) => entry.onlineChangedFinalLayoutTraceCount
    ),
    traceComparisonPostSelectionImprovementTraceCount: sumBenchmarkBy(
      result.traceComparisons,
      (entry) => entry.onlinePostSelectionImprovementTraceCount
    ),
    traceComparisonOfflineDecisionCount: sumBenchmarkBy(result.traceComparisons, (entry) => entry.offlineDecisionCount),
    recommendedExperimentCount: result.recommendedExperiments.length,
    longerRollForwardReplayRecommendationCount: result.recommendedExperiments.filter(
      (entry) => entry.kind === "longer-roll-forward-replay"
    ).length,
    targetedProtectedReplayLabelRecommendationCount: result.recommendedExperiments.filter(
      (entry) => entry.kind === "targeted-protected-replay-labels"
    ).length,
    promotionBlocked: result.summary.promotionBlocked
  };
}

export function buildLnsWindowRankerGapDiagnosticsTelemetryManifest(
  result: LnsWindowRankerGapDiagnosticsResult,
  options: LnsWindowRankerGapDiagnosticsTelemetryManifestOptions
): ModelExperimentTelemetryManifest {
  return buildModelExperimentTelemetryManifest({
    ...options,
    generatedAt: result.generatedAt,
    model: modelRecord(result),
    labelFingerprint: result.inputs.labelFingerprint,
    datasetFingerprint: result.inputs.datasetFingerprint,
    modelFingerprint: buildModelExperimentFingerprint(modelRecord(result)),
    metrics: summaryMetrics(result),
    notes: options.notes ?? "Offline-to-online LNS window-ranker gap diagnostics; no solver default changed."
  });
}

export function buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft(
  result: LnsWindowRankerGapDiagnosticsResult,
  options: LnsWindowRankerGapDiagnosticsRegistryEntryDraftOptions
): Record<string, unknown> {
  return buildModelExperimentRegistryEntryDraft({
    ...options,
    generatedAt: result.generatedAt,
    cases: result.online.selectedCaseNames,
    caseFamilies: result.online.pressureFamilies,
    seeds: result.online.seeds,
    splitStatus: {
      protectedHoldout: true,
      sourceLnsScaleReady: result.audit.sourceLnsScaleReady,
      promotionBlocked: result.summary.promotionBlocked
    },
    budget: {
      minScoreDelta: result.online.minScoreDelta,
      onlineComparisonCount: result.online.comparisonCount,
      onlineOverrideCount: result.online.overrideCount,
      onlineSelectionTraceCount: result.online.selectionTraceCount,
      onlineFinalNeutralOverrideCount: result.online.finalNeutralOverrideCount,
      offlineDecisionCount: result.offline.decisionCount,
      offlineSupplementalDecisionCount: result.offline.supplementalDecisionCount,
      offlineOpportunityCount: result.offline.opportunityCount,
      offlinePositiveOnlineNeutralCount: result.summary.offlinePositiveOnlineNeutralCount,
      zeroLayoutFinalNeutralTraceComparisonCount: result.summary.zeroLayoutFinalNeutralTraceComparisonCount,
      changedLayoutFinalNeutralTraceComparisonCount: result.summary.changedLayoutFinalNeutralTraceComparisonCount,
      mixedLayoutFinalNeutralTraceComparisonCount: result.summary.mixedLayoutFinalNeutralTraceComparisonCount,
      suppressedZeroLayoutFinalNeutralTraceComparisonCount:
        result.summary.promotionSensitivity.suppressedTraceComparisonCount,
      sensitivityRemainingTraceComparisonCount: result.summary.promotionSensitivity.remainingTraceComparisonCount,
      sensitivityRemainingPromotionBlocked: result.summary.promotionSensitivity.remainingPromotionBlocked ? 1 : 0,
      protectedReplayEvidenceSuppressedTraceComparisonCount:
        result.summary.promotionSensitivity.protectedReplayEvidenceGate.suppressedTraceComparisonCount,
      protectedReplayEvidenceRemainingTraceComparisonCount:
        result.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingTraceComparisonCount,
      protectedReplayEvidenceRemainingPromotionBlocked: result.summary.promotionSensitivity.protectedReplayEvidenceGate
        .remainingPromotionBlocked
        ? 1
        : 0,
      traceComparisonCount: result.traceComparisons.length,
      traceComparisonOnlineTraceCount: sumBenchmarkBy(result.traceComparisons, (entry) => entry.onlineTraceCount),
      traceComparisonChangedFinalLayoutTraceCount: sumBenchmarkBy(
        result.traceComparisons,
        (entry) => entry.onlineChangedFinalLayoutTraceCount
      ),
      traceComparisonPostSelectionImprovementTraceCount: sumBenchmarkBy(
        result.traceComparisons,
        (entry) => entry.onlinePostSelectionImprovementTraceCount
      ),
      recommendedExperimentCount: result.recommendedExperiments.length,
      longerRollForwardReplayRecommendationCount: result.recommendedExperiments.filter(
        (entry) => entry.kind === "longer-roll-forward-replay"
      ).length,
      targetedProtectedReplayLabelRecommendationCount: result.recommendedExperiments.filter(
        (entry) => entry.kind === "targeted-protected-replay-labels"
      ).length
    },
    model: modelRecord(result),
    decision: options.decision ?? "offline-online-lns-window-ranker-gap-diagnostics",
    summary: options.summary ?? "Offline-to-online LNS window-ranker gap diagnostics; no solver default changed.",
    labelFingerprint: result.inputs.labelFingerprint,
    datasetFingerprint: result.inputs.datasetFingerprint,
    inputFingerprint: result.inputs.onlineScorecardFingerprint,
    modelFingerprint: buildModelExperimentFingerprint(modelRecord(result)),
    summaryMetrics: summaryMetrics(result)
  });
}

function formatOfflineSummary(summary: LnsWindowRankerGapOfflineSummary): string {
  return `${summary.pressureFamily}/${summary.transition}: decisions=${summary.decisionCount} selected-positive=${summary.selectedPositiveCount} hit-best=${summary.hitBestCount}/${summary.opportunityCount} selected-delta=${formatBenchmarkSignedNumber(summary.selectedDeltaVsBaselineTotal)} capture=${summary.selectedCaptureRate.toFixed(4)} baseline-capture=${summary.baselineCaptureRate.toFixed(4)}`;
}

function formatJoin(join: LnsWindowRankerGapTransitionJoin): string {
  const offline = join.offline
    ? formatOfflineSummary(join.offline)
    : `${join.pressureFamily}/${join.transition}: offline=none`;
  const online = join.online
    ? `online-overrides=${join.online.overrideCount} finals=${join.online.finalImprovedCount}/${join.online.finalNeutralCount}/${join.online.finalRegressedCount} mean-delta=${formatBenchmarkSignedNumber(join.online.meanPopulationDelta)}`
    : "online=none";
  return `- ${join.diagnosis} ${offline} ${online}`;
}

function formatLayoutSignatureCounts(counts: Record<LnsWindowRankerGapLayoutSignature, number>): string {
  const formatted = LAYOUT_SIGNATURES.filter((signature) => counts[signature] > 0).map(
    (signature) => `${signature}:${counts[signature]}`
  );
  return formatted.length ? formatted.join(",") : "none";
}

function formatPromotionSensitivity(sensitivity: LnsWindowRankerGapPromotionSensitivity): string {
  const blockers = sensitivity.remainingBlockers.length ? sensitivity.remainingBlockers.join(",") : "none";
  const evidenceGate = sensitivity.protectedReplayEvidenceGate;
  const evidenceBlockers = evidenceGate.remainingBlockers.length ? evidenceGate.remainingBlockers.join(",") : "none";
  return `suppress=${sensitivity.suppressedLayoutSignature}:${sensitivity.suppressedTraceComparisonCount} remaining=${sensitivity.remainingTraceComparisonCount} remaining-blocked=${sensitivity.remainingPromotionBlocked} blockers=${blockers} unmatched=${sensitivity.remainingOnlineActiveNoOfflineMatchCount} changed-layout-no-lift=${sensitivity.changedLayoutNoLiftTrajectoryDepthCount} evidence-gate-suppress=${evidenceGate.suppressedDiagnosis}:${evidenceGate.suppressedTraceComparisonCount} evidence-gate-remaining=${evidenceGate.remainingTraceComparisonCount} evidence-gate-blocked=${evidenceGate.remainingPromotionBlocked} evidence-gate-blockers=${evidenceBlockers}`;
}

export function formatLnsWindowRankerGapDiagnostics(result: LnsWindowRankerGapDiagnosticsResult): string {
  const joins = result.joins
    .filter((entry) => entry.diagnosis !== "offline-neutral-online-neutral")
    .slice(0, 10)
    .map(formatJoin);
  const traceComparisons = result.traceComparisons.slice(0, 10).map(formatLnsWindowRankerGapTraceComparison);
  const recommendedExperiments = result.recommendedExperiments
    .slice(0, 10)
    .map(formatLnsWindowRankerGapRecommendedExperiment);
  return [
    "=== LNS Window Ranker Offline/Online Gap Diagnostics ===",
    `Generated: ${result.generatedAt}`,
    `Schema: ${result.schemaVersion}`,
    `Audit: runtime-default-changed=false solver-default-changed=false target=${result.audit.target} weak-seed-labels=${result.audit.weakSeedReplayLabelsAllowed} supplemental-replay=${result.audit.supplementalReplaySnapshotCount}`,
    `Inputs: label=${result.inputs.labelFingerprint} model=${result.inputs.rankerModelFingerprint} online=${result.inputs.onlineScorecardFingerprint} supplemental=${result.inputs.supplementalReplayFingerprints.length ? result.inputs.supplementalReplayFingerprints.join(",") : "none"}`,
    `Offline: decisions=${result.offline.decisionCount} supplemental=${result.offline.supplementalDecisionCount} overrides=${result.offline.overrideCount} opportunities=${result.offline.opportunityCount} selected-positive=${result.offline.selectedPositiveCount}`,
    `Online: cases=${result.online.selectedCaseNames.length} seeds=${result.online.seeds.join(",")} comparisons=${result.online.comparisonCount} min-score-delta=${result.online.minScoreDelta ?? "n/a"} overrides=${result.online.overrideCount} selection-trace=${result.online.selectionTraceCount} final-neutral-overrides=${result.online.finalNeutralOverrideCount}`,
    `Gap: joined-transition-families=${result.summary.joinedTransitionFamilyCount} offline-positive-online-neutral=${result.summary.offlinePositiveOnlineNeutralCount} online-active-no-offline-match=${result.summary.onlineActiveNoOfflineMatchCount} promotion-blocked=${result.summary.promotionBlocked}`,
    `Layout signatures: ${formatLayoutSignatureCounts(result.summary.traceComparisonLayoutSignatureCounts)}`,
    `Promotion sensitivity: ${formatPromotionSensitivity(result.summary.promotionSensitivity)}`,
    `Online neutral override rate: ${formatBenchmarkRate(benchmarkRatio(result.online.finalNeutralOverrideCount, result.online.overrideCount))}`,
    "Joined evidence:",
    ...(joins.length ? joins : ["- none"]),
    "Trace comparisons:",
    ...(traceComparisons.length ? traceComparisons : ["- none"]),
    "Recommended experiments:",
    ...(recommendedExperiments.length ? recommendedExperiments : ["- none"]),
    "Decision: diagnostics only; no LNS runtime scorer or solver default changed."
  ].join("\n");
}
