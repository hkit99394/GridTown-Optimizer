import { formatBenchmarkSignedNumber } from "./benchmarkOptions.js";

import type {
  LnsWindowRankerGapDiagnosis,
  LnsWindowRankerGapLayoutSignature,
  LnsWindowRankerGapTraceComparison
} from "./lnsWindowRankerGapTraceComparisons.js";

export type LnsWindowRankerGapRecommendedExperimentKind =
  | "longer-roll-forward-replay"
  | "targeted-protected-replay-labels";

export type LnsWindowRankerGapRecommendedExperimentEvidenceStatus =
  | "evidence-backed-blocker"
  | "requires-protected-replay-evidence";

export interface LnsWindowRankerGapRecommendedExperiment {
  priority: number;
  kind: LnsWindowRankerGapRecommendedExperimentKind;
  key: string;
  pressureFamily: string;
  transition: string;
  diagnosis: LnsWindowRankerGapDiagnosis;
  layoutSignature: LnsWindowRankerGapLayoutSignature;
  evidenceStatus: LnsWindowRankerGapRecommendedExperimentEvidenceStatus;
  offlineDecisionCount: number;
  offlineSelectedPositiveCount: number;
  onlineTraceCount: number;
  onlineChangedFinalLayoutTraceCount: number;
  onlineMeanFinalLayoutPlacementDelta: number | null;
  onlinePostSelectionImprovementTraceCount: number;
  onlineMeanFinalPopulationDeltaFromSelectedAfter: number | null;
  reason: string;
  suggestedExperiment: string;
}

function changedLayoutSignature(signature: LnsWindowRankerGapLayoutSignature): boolean {
  return signature === "changed-layout-final-neutral" || signature === "mixed-layout-final-neutral";
}

function signedOrNeutral(value: number | null): string {
  return value === null ? "n/a" : formatBenchmarkSignedNumber(value);
}

function recommendationBase(
  comparison: LnsWindowRankerGapTraceComparison,
  kind: LnsWindowRankerGapRecommendedExperimentKind,
  evidenceStatus: LnsWindowRankerGapRecommendedExperimentEvidenceStatus,
  priority: number,
  reason: string,
  suggestedExperiment: string
): LnsWindowRankerGapRecommendedExperiment {
  return {
    priority,
    kind,
    key: comparison.key,
    pressureFamily: comparison.pressureFamily,
    transition: comparison.transition,
    diagnosis: comparison.diagnosis,
    layoutSignature: comparison.layoutSignature,
    evidenceStatus,
    offlineDecisionCount: comparison.offlineDecisionCount,
    offlineSelectedPositiveCount: comparison.offlineSelectedPositiveCount,
    onlineTraceCount: comparison.onlineTraceCount,
    onlineChangedFinalLayoutTraceCount: comparison.onlineChangedFinalLayoutTraceCount,
    onlineMeanFinalLayoutPlacementDelta: comparison.onlineMeanFinalLayoutPlacementDelta,
    onlinePostSelectionImprovementTraceCount: comparison.onlinePostSelectionImprovementTraceCount,
    onlineMeanFinalPopulationDeltaFromSelectedAfter: comparison.onlineMeanFinalPopulationDeltaFromSelectedAfter,
    reason,
    suggestedExperiment
  };
}

function buildEvidenceBackedRecommendation(
  comparison: LnsWindowRankerGapTraceComparison
): LnsWindowRankerGapRecommendedExperiment {
  const finalDelta = signedOrNeutral(comparison.onlineMeanFinalPopulationDeltaFromSelectedAfter);
  return recommendationBase(
    comparison,
    "longer-roll-forward-replay",
    "evidence-backed-blocker",
    1,
    `Offline holdout says this transition can lift final score, but protected online traces changed layout without final lift; post-selection improvements=${comparison.onlinePostSelectionImprovementTraceCount}, final-from-selected=${finalDelta}.`,
    "Run a targeted longer/chunked roll-forward replay for this pressure family and transition to separate harmless neutral reshuffles from missed final-lift opportunity."
  );
}

function buildUnmatchedEvidenceRecommendation(
  comparison: LnsWindowRankerGapTraceComparison
): LnsWindowRankerGapRecommendedExperiment {
  return recommendationBase(
    comparison,
    "targeted-protected-replay-labels",
    "requires-protected-replay-evidence",
    2,
    "Protected online scorecard has active final-neutral overrides for this transition, but the offline holdout replay labels have no matching transition/family evidence.",
    "Collect targeted protected-holdout replay labels for this pressure family and transition before allowing it to count toward promotion evidence."
  );
}

export function buildLnsWindowRankerGapRecommendedExperiments(
  traceComparisons: readonly LnsWindowRankerGapTraceComparison[]
): LnsWindowRankerGapRecommendedExperiment[] {
  const evidenceBacked = traceComparisons
    .filter(
      (comparison) =>
        comparison.diagnosis === "offline-positive-online-neutral" && changedLayoutSignature(comparison.layoutSignature)
    )
    .map(buildEvidenceBackedRecommendation);
  const unmatched = traceComparisons
    .filter(
      (comparison) =>
        comparison.diagnosis === "online-active-no-offline-match" &&
        comparison.layoutSignature !== "zero-layout-final-neutral"
    )
    .map(buildUnmatchedEvidenceRecommendation);
  return [...evidenceBacked, ...unmatched].sort(
    (left, right) =>
      left.priority - right.priority ||
      right.onlineChangedFinalLayoutTraceCount - left.onlineChangedFinalLayoutTraceCount ||
      (right.onlineMeanFinalLayoutPlacementDelta ?? -1) - (left.onlineMeanFinalLayoutPlacementDelta ?? -1) ||
      left.key.localeCompare(right.key)
  );
}

export function formatLnsWindowRankerGapRecommendedExperiment(
  recommendation: LnsWindowRankerGapRecommendedExperiment
): string {
  return `- p${recommendation.priority} ${recommendation.kind} ${recommendation.pressureFamily}/${recommendation.transition}: evidence=${recommendation.evidenceStatus} layout=${recommendation.layoutSignature} online-traces=${recommendation.onlineTraceCount} changed-layout=${recommendation.onlineChangedFinalLayoutTraceCount} final-from-selected=${signedOrNeutral(recommendation.onlineMeanFinalPopulationDeltaFromSelectedAfter)} reason=${recommendation.reason}`;
}
