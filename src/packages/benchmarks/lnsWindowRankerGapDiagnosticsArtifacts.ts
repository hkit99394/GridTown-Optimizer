import {
  benchmarkRatio,
  formatBenchmarkRate,
  formatBenchmarkSignedNumber,
  sumBenchmarkBy
} from "./benchmarkOptions.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import {
  formatLnsWindowRankerGapTraceComparison,
  type LnsWindowRankerGapLayoutSignature
} from "./lnsWindowRankerGapTraceComparisons.js";
import { formatLnsWindowRankerGapRecommendedExperiment } from "./lnsWindowRankerGapRecommendations.js";

import type {
  LnsWindowRankerGapDiagnosticsResult,
  LnsWindowRankerGapOfflineSummary,
  LnsWindowRankerGapPromotionSensitivity,
  LnsWindowRankerGapTransitionJoin
} from "./lnsWindowRankerGapDiagnostics.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifest,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";

export interface LnsWindowRankerGapDiagnosticsTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerGapDiagnosticsRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {}

const LAYOUT_SIGNATURES: readonly LnsWindowRankerGapLayoutSignature[] = Object.freeze([
  "changed-layout-final-neutral",
  "mixed-final-outcome",
  "mixed-layout-final-neutral",
  "missing-layout-delta",
  "zero-layout-final-neutral"
]);

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
    exactReplayNeutralizedOfflinePositiveOnlineNeutralCount:
      result.summary.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount,
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
      exactReplayNeutralizedOfflinePositiveOnlineNeutralCount:
        result.summary.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount,
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
  return `${summary.pressureFamily}/${summary.transition}: decisions=${summary.decisionCount} supplemental=${summary.supplementalDecisionCount} exact-online-supplemental=${summary.exactOnlineDecisionSupplementalDecisionCount} selected-positive=${summary.selectedPositiveCount} exact-online-selected-positive=${summary.exactOnlineDecisionSupplementalSelectedPositiveCount} hit-best=${summary.hitBestCount}/${summary.opportunityCount} selected-delta=${formatBenchmarkSignedNumber(summary.selectedDeltaVsBaselineTotal)} capture=${summary.selectedCaptureRate.toFixed(4)} baseline-capture=${summary.baselineCaptureRate.toFixed(4)}`;
}

function formatJoin(join: LnsWindowRankerGapTransitionJoin): string {
  const offline = join.offline
    ? formatOfflineSummary(join.offline)
    : `${join.pressureFamily}/${join.transition}: offline=none`;
  const online = join.online
    ? `online-overrides=${join.online.overrideCount} finals=${join.online.finalImprovedCount}/${join.online.finalNeutralCount}/${join.online.finalRegressedCount} mean-delta=${formatBenchmarkSignedNumber(join.online.meanPopulationDelta)}`
    : "online=none";
  const exactNeutralized = join.exactReplayNeutralizedOfflinePositiveOnlineNeutral
    ? " exact-replay-neutralized=true"
    : "";
  return `- ${join.diagnosis}${exactNeutralized} ${offline} ${online}`;
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
    .filter(
      (entry) =>
        entry.diagnosis !== "offline-neutral-online-neutral" || entry.exactReplayNeutralizedOfflinePositiveOnlineNeutral
    )
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
    `Gap: joined-transition-families=${result.summary.joinedTransitionFamilyCount} offline-positive-online-neutral=${result.summary.offlinePositiveOnlineNeutralCount} online-active-no-offline-match=${result.summary.onlineActiveNoOfflineMatchCount} exact-replay-neutralized=${result.summary.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount} promotion-blocked=${result.summary.promotionBlocked}`,
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
