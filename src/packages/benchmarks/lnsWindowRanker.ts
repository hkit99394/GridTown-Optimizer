import { performance } from "node:perf_hooks";

import { benchmarkGeneratedAt, uniqueBenchmarkValues } from "./benchmarkOptions.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import {
  inferLnsWindowRankerReplaySeedHintKind,
  runLnsWindowRankerBaselineExperiment,
  normalizeLnsWindowRankerLabelTarget,
  normalizeLnsWindowRankerWeakSeedAllowance,
  type LnsWindowRankerBaselineExperimentResult,
  type LnsWindowRankerLabelTarget,
  type LnsWindowRankerMetricSummary
} from "./lnsWindowRankerBaselines.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";

import type { LearnedRankingLabelSnapshot, LearnedRankingLabelSplit } from "./learnedRankingLabels.js";
import type { LnsReplayPressureFamilyLabel } from "./lns.js";
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

export const LNS_WINDOW_RANKER_FEATURE_NAMES = Object.freeze([
  "operatorScore",
  "selectedByBaseline",
  "area",
  "roadCountInside",
  "serviceCountInside",
  "residentialCountInside",
  "residentialHeadroomInside",
  "serviceBonusInside",
  "reachableBefore",
  "reachableAfter",
  "newlyReachable",
  "disconnectedBefore",
  "disconnectedAfter",
  "clearedFootprint",
  "emptyComponentsBefore",
  "emptyComponentsAfter",
  "componentDelta",
  "allowedWindowCells",
  "anchorReachableWindowCells",
  "narrowGateCells",
  "serviceCandidatesIntersecting",
  "residentialCandidatesIntersecting",
  "serviceCandidatesBlocked",
  "residentialCandidatesBlocked",
  "serviceCandidateBonus",
  "maxServiceCandidateBonus",
  "residentialCandidateHeadroom"
] as const);

export type LnsWindowRankerFeatureName = (typeof LNS_WINDOW_RANKER_FEATURE_NAMES)[number];

export interface LnsWindowRankerTrainingOptions {
  epochs?: number;
  learningRate?: number;
  marginWeightCap?: number;
  baselineTieBreak?: boolean;
  target?: LnsWindowRankerLabelTarget;
  allowWeakSeedReplayLabels?: boolean;
  supplementalReplayCalibration?: boolean;
}

export interface LnsWindowRankerRunOptions {
  training?: LnsWindowRankerTrainingOptions;
  supplementalReplaySnapshots?: readonly LnsWindowReplaySnapshot[];
  randomBaselineSeed?: number;
  topK?: number;
}

export interface LnsWindowRankerEpochSummary {
  epoch: number;
  mistakes: number;
  developmentCaptureRate: number;
}

export interface LnsWindowRankerModelBreakdownMetrics extends LnsWindowRankerMetricSummary {
  key: string;
}

export interface LnsWindowRankerModelSplitEvaluation extends LnsWindowRankerMetricSummary {
  split: LearnedRankingLabelSplit;
  pressureFamilyMetrics: LnsWindowRankerModelBreakdownMetrics[];
  statePolicyMetrics: LnsWindowRankerModelBreakdownMetrics[];
  seedHintMetrics: LnsWindowRankerModelBreakdownMetrics[];
}

export interface LnsWindowRankerModel {
  schemaVersion: 1;
  modelType: "lns-window-linear-pairwise-ranker";
  purpose: "offline-diagnostics-only";
  trained: true;
  runtimeDefaultChanged: false;
  solverDefaultChanged: false;
  featureSchemaVersion: number | null;
  featureNames: LnsWindowRankerFeatureName[];
  weights: Record<LnsWindowRankerFeatureName, number>;
  intercept: 0;
  topK: number;
  training: Required<LnsWindowRankerTrainingOptions>;
  trainedDecisionCount: number;
  trainedPairCount: number;
  trainingSplit: "development";
}

export interface LnsWindowRankerSummary {
  passed: boolean;
  failedReasons: string[];
  bestBaselineName: string;
  bestBaselineHoldoutCaptureRate: number;
  modelHoldoutCaptureRate: number;
  holdoutCaptureDeltaVsBestBaseline: number;
  modelHoldoutHitAt1: number;
  modelHoldoutHitAtK: number;
}

export interface LnsWindowRankerExperimentResult {
  generatedAt: string;
  schemaVersion: 1;
  audit: {
    cpuOnly: true;
    runtimeDefaultChanged: false;
    solverDefaultChanged: false;
    learnedRuntimeHook: null;
    sourceLabelPreset: string | null;
    sourceLnsScaleReady: boolean;
    weakSeedReplayLabelsAllowed: boolean;
    labelTarget: LnsWindowRankerLabelTarget;
    supplementalReplayCalibration: boolean;
    supplementalReplaySnapshotCount: number;
  };
  labels: {
    labelCount: number;
    usableLabelCount: number;
    opportunityCount: number;
    developmentDecisionCount: number;
    holdoutDecisionCount: number;
    supplementalReplayDecisionCount: number;
    supplementalReplayLabelCount: number;
  };
  training: {
    wallClockSeconds: number;
    epochs: LnsWindowRankerEpochSummary[];
  };
  model: LnsWindowRankerModel;
  evaluation: {
    model: {
      development: LnsWindowRankerModelSplitEvaluation;
      holdout: LnsWindowRankerModelSplitEvaluation;
    };
    baselines: LnsWindowRankerBaselineExperimentResult["evaluation"]["baselines"];
    summary: LnsWindowRankerSummary;
  };
  datasetFingerprint: string;
  labelFingerprint: string;
  modelFingerprint: string;
}

export interface LnsWindowRankerExperimentSnapshot extends Omit<
  LnsWindowRankerExperimentResult,
  "generatedAt" | "training"
> {
  training: Omit<LnsWindowRankerExperimentResult["training"], "wallClockSeconds">;
}

export interface LnsWindowRankerTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {}

interface ReplayDecisionGroup {
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

const DEFAULT_LNS_WINDOW_RANKER_TRAINING: Required<LnsWindowRankerTrainingOptions> = Object.freeze({
  epochs: 5,
  learningRate: 0.05,
  marginWeightCap: 500,
  baselineTieBreak: false,
  target: "immediate-improvement",
  allowWeakSeedReplayLabels: true,
  supplementalReplayCalibration: false
});

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveFiniteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeTrainingOptions(
  options: LnsWindowRankerTrainingOptions | undefined
): Required<LnsWindowRankerTrainingOptions> {
  return {
    epochs: positiveIntegerOrDefault(options?.epochs, DEFAULT_LNS_WINDOW_RANKER_TRAINING.epochs),
    learningRate: positiveFiniteNumberOrDefault(options?.learningRate, DEFAULT_LNS_WINDOW_RANKER_TRAINING.learningRate),
    marginWeightCap: positiveFiniteNumberOrDefault(
      options?.marginWeightCap,
      DEFAULT_LNS_WINDOW_RANKER_TRAINING.marginWeightCap
    ),
    baselineTieBreak: options?.baselineTieBreak === true,
    target: normalizeLnsWindowRankerLabelTarget(options?.target),
    allowWeakSeedReplayLabels: normalizeLnsWindowRankerWeakSeedAllowance(options?.allowWeakSeedReplayLabels),
    supplementalReplayCalibration: options?.supplementalReplayCalibration === true
  };
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function featureVector(label: LnsWindowReplaySnapshotLabel): number[] {
  const features = label.features;
  const connectivity = features.connectivityShadow;
  const fragmentation = features.fragmentation;
  const candidateLoss = features.candidateLoss;
  return [
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
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

function scoreLabel(label: LnsWindowReplaySnapshotLabel, weights: readonly number[]): number {
  return dot(featureVector(label), weights);
}

export function scoreLnsWindowRankerReplayLabel(
  label: LnsWindowReplaySnapshotLabel,
  model: Pick<LnsWindowRankerModel, "weights">
): number {
  return scoreLabel(label, weightArrayFromRecord(model.weights));
}

function hasTargetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): boolean {
  return target === "immediate-improvement" || typeof label.rollForward?.populationDeltaVsBaseline === "number";
}

function targetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): number {
  return target === "roll-forward-final-lift" ? (label.rollForward?.populationDeltaVsBaseline ?? 0) : label.improvement;
}

function collectReplayDecisionGroups(
  labelSnapshot: LearnedRankingLabelSnapshot,
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean
): ReplayDecisionGroup[] {
  return labelSnapshot.lns.splits.flatMap((split) =>
    split.replay.cases.flatMap((benchmarkCase): ReplayDecisionGroup[] => {
      const seedKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedKind === "weak-replay") return [];
      const labels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (labels.length === 0) return [];
      return [
        {
          split: split.split,
          source: "label-snapshot",
          caseName: benchmarkCase.name,
          pressureFamily: benchmarkCase.pressureFamily,
          seed: benchmarkCase.seed,
          seedHintKind: seedKind,
          statePolicy: benchmarkCase.statePolicy,
          stateIndex: benchmarkCase.stateIndex,
          labels
        }
      ];
    })
  );
}

function collectSupplementalReplayDecisionGroups(
  snapshots: readonly LnsWindowReplaySnapshot[],
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean
): ReplayDecisionGroup[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.cases.flatMap((benchmarkCase): ReplayDecisionGroup[] => {
      const seedKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedKind === "weak-replay") return [];
      const labels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (labels.length === 0) return [];
      return [
        {
          split: "development",
          source: "supplemental-replay",
          caseName: benchmarkCase.name,
          pressureFamily: benchmarkCase.pressureFamily,
          seed: benchmarkCase.seed,
          seedHintKind: seedKind,
          statePolicy: benchmarkCase.statePolicy,
          stateIndex: benchmarkCase.stateIndex,
          labels
        }
      ];
    })
  );
}

function splitGroups(groups: readonly ReplayDecisionGroup[], split: LearnedRankingLabelSplit): ReplayDecisionGroup[] {
  return groups.filter((group) => group.split === split);
}

function maxImprovement(group: ReplayDecisionGroup, target: LnsWindowRankerLabelTarget): number {
  return Math.max(...group.labels.map((label) => targetValue(label, target)));
}

function marginWeight(delta: number, cap: number): number {
  return Math.min(cap, Math.max(1, Math.abs(delta))) / cap;
}

function positiveLabelsForTraining(
  group: ReplayDecisionGroup,
  bestImprovement: number,
  training: Required<LnsWindowRankerTrainingOptions>
): LnsWindowReplaySnapshotLabel[] {
  if (useSupplementalNeutralBaselineCalibration(group, bestImprovement, training)) {
    return group.labels.filter((label) => label.selectedByBaseline);
  }
  if (training.baselineTieBreak) {
    const baselineBest = group.labels.find(
      (label) => label.selectedByBaseline && targetValue(label, training.target) === bestImprovement
    );
    if (baselineBest) return [baselineBest];
  }
  return group.labels.filter((label) => targetValue(label, training.target) === bestImprovement);
}

function useSupplementalNeutralBaselineCalibration(
  group: ReplayDecisionGroup,
  bestImprovement: number,
  training: Required<LnsWindowRankerTrainingOptions>
): boolean {
  return (
    training.supplementalReplayCalibration &&
    group.source === "supplemental-replay" &&
    group.statePolicy === "online-decision" &&
    bestImprovement <= 0 &&
    group.labels.some((label) => label.selectedByBaseline)
  );
}

function trainingDelta(
  group: ReplayDecisionGroup,
  negative: LnsWindowReplaySnapshotLabel,
  bestImprovement: number,
  training: Required<LnsWindowRankerTrainingOptions>
): number {
  if (useSupplementalNeutralBaselineCalibration(group, bestImprovement, training)) {
    return negative.selectedByBaseline ? 0 : training.marginWeightCap;
  }
  return bestImprovement - targetValue(negative, training.target);
}

function evaluateMetricSummary(
  groups: readonly ReplayDecisionGroup[],
  weights: readonly number[],
  topK: number,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerMetricSummary {
  let decisionCount = 0;
  let opportunityCount = 0;
  let usableLabelCount = 0;
  let bestImprovementTotal = 0;
  let selectedImprovementTotal = 0;
  let regretTotal = 0;
  let hitAt1Count = 0;
  let hitAtKCount = 0;
  let selectedImprovedCount = 0;

  for (const group of groups) {
    if (group.labels.length === 0) continue;
    const bestImprovement = maxImprovement(group, target);
    const ranked = [...group.labels].sort(
      (left, right) =>
        scoreLabel(right, weights) - scoreLabel(left, weights) ||
        right.operatorScore - left.operatorScore ||
        left.windowIndex - right.windowIndex
    );
    const selected = ranked[0]!;
    const selectedImprovement = Math.max(0, targetValue(selected, target));

    decisionCount++;
    usableLabelCount += group.labels.length;
    if (selectedImprovement > 0) selectedImprovedCount++;
    if (bestImprovement <= 0) continue;

    opportunityCount++;
    bestImprovementTotal += bestImprovement;
    selectedImprovementTotal += Math.min(selectedImprovement, bestImprovement);
    regretTotal += Math.max(0, bestImprovement - selectedImprovement);
    if (selectedImprovement === bestImprovement) hitAt1Count++;
    if (ranked.slice(0, topK).some((label) => targetValue(label, target) === bestImprovement)) hitAtKCount++;
  }

  return {
    decisionCount,
    opportunityCount,
    usableLabelCount,
    bestImprovementTotal: roundMetric(bestImprovementTotal),
    selectedImprovementTotal: roundMetric(selectedImprovementTotal),
    regretTotal: roundMetric(regretTotal),
    meanRegret: opportunityCount === 0 ? 0 : roundMetric(regretTotal / opportunityCount),
    improvementCaptureRate:
      bestImprovementTotal === 0 ? 0 : roundMetric(selectedImprovementTotal / bestImprovementTotal),
    hitAt1Count,
    hitAt1: opportunityCount === 0 ? 0 : roundMetric(hitAt1Count / opportunityCount),
    hitAtKCount,
    hitAtK: opportunityCount === 0 ? 0 : roundMetric(hitAtKCount / opportunityCount),
    selectedImprovedCount,
    selectedImprovedRate: decisionCount === 0 ? 0 : roundMetric(selectedImprovedCount / decisionCount)
  };
}

function groupByKey(groups: readonly ReplayDecisionGroup[], keyForGroup: (group: ReplayDecisionGroup) => string) {
  const grouped = new Map<string, ReplayDecisionGroup[]>();
  for (const group of groups) {
    const key = keyForGroup(group);
    const entries = grouped.get(key);
    if (entries) entries.push(group);
    else grouped.set(key, [group]);
  }
  return grouped;
}

function breakdownMetrics(
  groups: readonly ReplayDecisionGroup[],
  weights: readonly number[],
  topK: number,
  target: LnsWindowRankerLabelTarget,
  keyForGroup: (group: ReplayDecisionGroup) => string
): LnsWindowRankerModelBreakdownMetrics[] {
  return [...groupByKey(groups, keyForGroup).entries()]
    .map(([key, keyGroups]) => ({
      key,
      ...evaluateMetricSummary(keyGroups, weights, topK, target)
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function evaluateSplit(
  split: LearnedRankingLabelSplit,
  groups: readonly ReplayDecisionGroup[],
  weights: readonly number[],
  topK: number,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerModelSplitEvaluation {
  return {
    split,
    ...evaluateMetricSummary(groups, weights, topK, target),
    pressureFamilyMetrics: breakdownMetrics(groups, weights, topK, target, (group) => group.pressureFamily),
    statePolicyMetrics: breakdownMetrics(groups, weights, topK, target, (group) => group.statePolicy),
    seedHintMetrics: breakdownMetrics(groups, weights, topK, target, (group) => group.seedHintKind)
  };
}

function trainLinearRanker(
  developmentGroups: readonly ReplayDecisionGroup[],
  training: Required<LnsWindowRankerTrainingOptions>,
  topK: number
): {
  weights: number[];
  epochs: LnsWindowRankerEpochSummary[];
  trainedPairCount: number;
} {
  const weights = LNS_WINDOW_RANKER_FEATURE_NAMES.map(() => 0);
  const epochs: LnsWindowRankerEpochSummary[] = [];
  let trainedPairCount = 0;

  for (let epoch = 0; epoch < training.epochs; epoch++) {
    let mistakes = 0;
    for (const group of developmentGroups) {
      const bestImprovement = maxImprovement(group, training.target);
      const positives = positiveLabelsForTraining(group, bestImprovement, training);
      if (positives.length === 0) continue;
      for (const positive of positives) {
        const positiveVector = featureVector(positive);
        for (const negative of group.labels) {
          const delta = trainingDelta(group, negative, bestImprovement, training);
          if (delta <= 0) continue;
          trainedPairCount++;
          const negativeVector = featureVector(negative);
          const diff = positiveVector.map((value, index) => value - (negativeVector[index] ?? 0));
          if (dot(diff, weights) > 0) continue;
          const update = training.learningRate * marginWeight(delta, training.marginWeightCap);
          for (let index = 0; index < weights.length; index++) {
            weights[index] += update * (diff[index] ?? 0);
          }
          mistakes++;
        }
      }
    }
    epochs.push({
      epoch: epoch + 1,
      mistakes,
      developmentCaptureRate: evaluateMetricSummary(developmentGroups, weights, topK, training.target)
        .improvementCaptureRate
    });
  }

  return { weights, epochs, trainedPairCount };
}

function weightsRecord(weights: readonly number[]): Record<LnsWindowRankerFeatureName, number> {
  return Object.fromEntries(
    LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName, index) => [featureName, roundMetric(weights[index] ?? 0)])
  ) as Record<LnsWindowRankerFeatureName, number>;
}

function weightArrayFromRecord(weights: Record<LnsWindowRankerFeatureName, number>): number[] {
  return LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName) => weights[featureName]);
}

function buildSummary(
  labelSnapshot: LearnedRankingLabelSnapshot,
  baselineResult: LnsWindowRankerBaselineExperimentResult,
  holdoutEvaluation: LnsWindowRankerModelSplitEvaluation,
  supplementalReplayCalibration: boolean
): LnsWindowRankerSummary {
  const bestBaseline = baselineResult.evaluation.summary;
  const failedReasons: string[] = [];
  if (!labelSnapshot.leakage.protectedHoldout) failedReasons.push("development/holdout label cases overlap");
  if (supplementalReplayCalibration) {
    failedReasons.push("supplemental replay calibration is diagnostics-only and cannot promote a model");
  }
  if (!labelSnapshot.lns.scaleReadiness.passed) failedReasons.push("source LNS label-scale readiness did not pass");
  if (holdoutEvaluation.opportunityCount === 0) failedReasons.push("holdout improvement opportunity count is zero");
  if (holdoutEvaluation.improvementCaptureRate <= bestBaseline.bestBaselineHoldoutCaptureRate) {
    failedReasons.push(
      `holdout capture ${holdoutEvaluation.improvementCaptureRate.toFixed(4)} does not beat best baseline ${bestBaseline.bestBaselineName} ${bestBaseline.bestBaselineHoldoutCaptureRate.toFixed(4)}`
    );
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    bestBaselineName: bestBaseline.bestBaselineName,
    bestBaselineHoldoutCaptureRate: bestBaseline.bestBaselineHoldoutCaptureRate,
    modelHoldoutCaptureRate: holdoutEvaluation.improvementCaptureRate,
    holdoutCaptureDeltaVsBestBaseline: roundMetric(
      holdoutEvaluation.improvementCaptureRate - bestBaseline.bestBaselineHoldoutCaptureRate
    ),
    modelHoldoutHitAt1: holdoutEvaluation.hitAt1,
    modelHoldoutHitAtK: holdoutEvaluation.hitAtK
  };
}

function buildDatasetFingerprint(
  labelSnapshot: LearnedRankingLabelSnapshot,
  supplementalReplaySnapshots: readonly LnsWindowReplaySnapshot[]
): string {
  return `fnv1a:${hashString(stableStringify({ lns: labelSnapshot.lns, supplementalReplaySnapshots }))}`;
}

function buildLabelFingerprint(labelSnapshot: LearnedRankingLabelSnapshot): string {
  return `fnv1a:${hashString(stableStringify(labelSnapshot))}`;
}

function modelRecord(model: LnsWindowRankerModel): Record<string, unknown> {
  return model as unknown as Record<string, unknown>;
}

function summaryMetrics(result: LnsWindowRankerExperimentResult): Record<string, unknown> {
  return {
    passed: result.evaluation.summary.passed,
    bestBaselineName: result.evaluation.summary.bestBaselineName,
    bestBaselineHoldoutCaptureRate: result.evaluation.summary.bestBaselineHoldoutCaptureRate,
    modelHoldoutCaptureRate: result.evaluation.summary.modelHoldoutCaptureRate,
    holdoutCaptureDeltaVsBestBaseline: result.evaluation.summary.holdoutCaptureDeltaVsBestBaseline,
    modelHoldoutHitAt1: result.evaluation.summary.modelHoldoutHitAt1,
    modelHoldoutHitAtK: result.evaluation.summary.modelHoldoutHitAtK,
    target: result.model.training.target,
    weakSeedReplayLabelsAllowed: result.model.training.allowWeakSeedReplayLabels,
    supplementalReplayCalibration: result.model.training.supplementalReplayCalibration,
    supplementalReplaySnapshotCount: result.audit.supplementalReplaySnapshotCount,
    developmentDecisionCount: result.labels.developmentDecisionCount,
    holdoutDecisionCount: result.labels.holdoutDecisionCount,
    supplementalReplayDecisionCount: result.labels.supplementalReplayDecisionCount,
    supplementalReplayLabelCount: result.labels.supplementalReplayLabelCount,
    opportunityCount: result.labels.opportunityCount,
    sourceLnsScaleReady: result.audit.sourceLnsScaleReady
  };
}

export function runLnsWindowRankerExperiment(
  labelSnapshot: LearnedRankingLabelSnapshot,
  options: LnsWindowRankerRunOptions = {}
): LnsWindowRankerExperimentResult {
  const training = normalizeTrainingOptions(options.training);
  const supplementalReplaySnapshots =
    training.supplementalReplayCalibration ? (options.supplementalReplaySnapshots ?? []) : [];
  const topK = positiveIntegerOrDefault(options.topK, 3);
  const baselineResult = runLnsWindowRankerBaselineExperiment(labelSnapshot, {
    randomBaselineSeed: options.randomBaselineSeed,
    topK,
    target: training.target,
    allowWeakSeedReplayLabels: training.allowWeakSeedReplayLabels
  });
  const supplementalGroups = collectSupplementalReplayDecisionGroups(
    supplementalReplaySnapshots,
    training.target,
    training.allowWeakSeedReplayLabels
  );
  const groups = [
    ...collectReplayDecisionGroups(labelSnapshot, training.target, training.allowWeakSeedReplayLabels),
    ...supplementalGroups
  ];
  const developmentGroups = splitGroups(groups, "development");
  const holdoutGroups = splitGroups(groups, "holdout");
  const startedAtMs = performance.now();
  const trained = trainLinearRanker(developmentGroups, training, topK);
  const trainingWallClockSeconds = (performance.now() - startedAtMs) / 1000;
  const weights = weightsRecord(trained.weights);
  const model: LnsWindowRankerModel = {
    schemaVersion: 1,
    modelType: "lns-window-linear-pairwise-ranker",
    purpose: "offline-diagnostics-only",
    trained: true,
    runtimeDefaultChanged: false,
    solverDefaultChanged: false,
    featureSchemaVersion: labelSnapshot.audit.lnsReplay.featureSchemaVersion ?? null,
    featureNames: [...LNS_WINDOW_RANKER_FEATURE_NAMES],
    weights,
    intercept: 0,
    topK,
    training,
    trainedDecisionCount: developmentGroups.length,
    trainedPairCount: trained.trainedPairCount,
    trainingSplit: "development"
  };
  const roundedWeights = weightArrayFromRecord(weights);
  const modelEvaluation = {
    development: evaluateSplit("development", developmentGroups, roundedWeights, topK, training.target),
    holdout: evaluateSplit("holdout", holdoutGroups, roundedWeights, topK, training.target)
  };
  const labelFingerprint = buildLabelFingerprint(labelSnapshot);
  const datasetFingerprint = buildDatasetFingerprint(labelSnapshot, supplementalReplaySnapshots);
  const modelFingerprint = buildModelExperimentFingerprint(model);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    audit: {
      cpuOnly: true,
      runtimeDefaultChanged: false,
      solverDefaultChanged: false,
      learnedRuntimeHook: null,
      sourceLabelPreset: labelSnapshot.audit.lnsReplay.preset,
      sourceLnsScaleReady: labelSnapshot.lns.scaleReadiness.passed,
      weakSeedReplayLabelsAllowed: training.allowWeakSeedReplayLabels,
      labelTarget: training.target,
      supplementalReplayCalibration: training.supplementalReplayCalibration,
      supplementalReplaySnapshotCount: supplementalReplaySnapshots.length
    },
    labels: {
      labelCount: labelSnapshot.lns.labelCount,
      usableLabelCount: baselineResult.labels.usableLabelCount,
      opportunityCount: baselineResult.labels.opportunityCount,
      developmentDecisionCount: developmentGroups.length,
      holdoutDecisionCount: holdoutGroups.length,
      supplementalReplayDecisionCount: supplementalGroups.length,
      supplementalReplayLabelCount: supplementalGroups.reduce((total, group) => total + group.labels.length, 0)
    },
    training: {
      wallClockSeconds: trainingWallClockSeconds,
      epochs: trained.epochs
    },
    model,
    evaluation: {
      model: modelEvaluation,
      baselines: baselineResult.evaluation.baselines,
      summary: buildSummary(labelSnapshot, baselineResult, modelEvaluation.holdout, training.supplementalReplayCalibration)
    },
    datasetFingerprint,
    labelFingerprint,
    modelFingerprint
  };
}

export function createLnsWindowRankerSnapshot(
  result: LnsWindowRankerExperimentResult
): LnsWindowRankerExperimentSnapshot {
  const { generatedAt: _generatedAt, training, ...snapshot } = result;
  const { wallClockSeconds: _wallClockSeconds, ...stableTraining } = training;
  return {
    ...snapshot,
    training: stableTraining
  };
}

export function buildLnsWindowRankerTelemetryManifest(
  result: LnsWindowRankerExperimentResult,
  options: LnsWindowRankerTelemetryManifestOptions
): ModelExperimentTelemetryManifest {
  return buildModelExperimentTelemetryManifest({
    command: options.command,
    generatedAt: result.generatedAt,
    git: options.git,
    hardware: options.hardware,
    model: modelRecord(result.model),
    inputArtifacts: options.inputArtifacts,
    outputArtifacts: options.outputArtifacts,
    labelFingerprint: result.labelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    modelFingerprint: result.modelFingerprint,
    metrics: summaryMetrics(result),
    notes:
      options.notes ??
      "CPU-only LNS window ranker diagnostics only; no learned runtime scorer or solver default changed."
  });
}

export function buildLnsWindowRankerRegistryEntryDraft(
  result: LnsWindowRankerExperimentResult,
  labelSnapshot: LearnedRankingLabelSnapshot,
  options: LnsWindowRankerRegistryEntryDraftOptions
): Record<string, unknown> {
  const pressureFamilies = uniqueBenchmarkValues(
    labelSnapshot.lns.splits.flatMap((split) => split.pressureFamilies.map((family) => `lns-${family}`))
  );
  return buildModelExperimentRegistryEntryDraft({
    runId: options.runId,
    generatedAt: result.generatedAt,
    commands: options.commands,
    artifactPaths: options.artifactPaths,
    cases: {
      development: [...labelSnapshot.leakage.developmentLnsCases],
      holdout: [...labelSnapshot.leakage.holdoutLnsCases]
    },
    caseFamilies: pressureFamilies,
    seeds: labelSnapshot.seeds,
    splitStatus: {
      protectedHoldout: labelSnapshot.leakage.protectedHoldout,
      leakage: labelSnapshot.leakage,
      lnsScaleReadiness: labelSnapshot.lns.scaleReadiness
    },
    budget: {
      cpuOnly: 1,
      topK: result.model.topK,
      trainingEpochs: result.model.training.epochs,
      trainingLearningRate: result.model.training.learningRate,
      trainingMarginWeightCap: result.model.training.marginWeightCap,
      trainingBaselineTieBreak: result.model.training.baselineTieBreak ? 1 : 0,
      trainingTargetRollForwardFinalLift: result.model.training.target === "roll-forward-final-lift" ? 1 : 0,
      trainingAllowWeakSeedReplayLabels: result.model.training.allowWeakSeedReplayLabels ? 1 : 0,
      trainingSupplementalReplayCalibration: result.model.training.supplementalReplayCalibration ? 1 : 0,
      trainingWallClockSeconds: roundMetric(result.training.wallClockSeconds),
      trainedDecisionCount: result.model.trainedDecisionCount,
      trainedPairCount: result.model.trainedPairCount,
      lnsLabelCount: result.labels.labelCount,
      supplementalReplayDecisionCount: result.labels.supplementalReplayDecisionCount,
      supplementalReplayLabelCount: result.labels.supplementalReplayLabelCount,
      usableLabelCount: result.labels.usableLabelCount,
      opportunityCount: result.labels.opportunityCount,
      baselineCount: result.evaluation.baselines.length
    },
    model: modelRecord(result.model),
    decision:
      options.decision ??
      (result.evaluation.summary.passed
        ? "offline-lns-window-ranker-beats-baselines"
        : "offline-lns-window-ranker-insufficient"),
    summary:
      options.summary ??
      (result.evaluation.summary.passed
        ? `CPU-first LNS window ranker beat ${result.evaluation.summary.bestBaselineName} by ${result.evaluation.summary.holdoutCaptureDeltaVsBestBaseline.toFixed(4)} holdout improvement capture.`
        : `CPU-first LNS window ranker did not clear the offline gate: ${result.evaluation.summary.failedReasons.join("; ")}.`),
    labelFingerprint: result.labelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    modelFingerprint: result.modelFingerprint,
    summaryMetrics: summaryMetrics(result)
  });
}

function formatMetric(metrics: LnsWindowRankerMetricSummary): string {
  return `capture=${metrics.improvementCaptureRate.toFixed(4)} hit@1=${metrics.hitAt1.toFixed(4)} hit@k=${metrics.hitAtK.toFixed(4)} regret=${metrics.meanRegret.toFixed(2)} opportunities=${metrics.opportunityCount}/${metrics.decisionCount}`;
}

export function formatLnsWindowRankerExperiment(result: LnsWindowRankerExperimentResult): string {
  const lines: string[] = [];
  lines.push("=== CPU-First LNS Window Ranker ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(
    `Audit: cpu-only=${result.audit.cpuOnly} runtime-default-changed=${result.audit.runtimeDefaultChanged} source-preset=${result.audit.sourceLabelPreset ?? "none"} source-lns-scale-ready=${result.audit.sourceLnsScaleReady} target=${result.audit.labelTarget} weak-seed-labels=${result.audit.weakSeedReplayLabelsAllowed} supplemental-replay-calibration=${result.audit.supplementalReplayCalibration} supplemental-replay-snapshots=${result.audit.supplementalReplaySnapshotCount}`
  );
  lines.push(
    `Labels: total=${result.labels.labelCount} usable=${result.labels.usableLabelCount} opportunities=${result.labels.opportunityCount} supplemental-decisions=${result.labels.supplementalReplayDecisionCount} supplemental-labels=${result.labels.supplementalReplayLabelCount} label-fingerprint=${result.labelFingerprint}`
  );
  lines.push(
    `Model: ${result.model.modelType} features=${result.model.featureNames.length} epochs=${result.model.training.epochs} baseline-tie-break=${result.model.training.baselineTieBreak} target=${result.model.training.target} weak-seed-labels=${result.model.training.allowWeakSeedReplayLabels} supplemental-replay-calibration=${result.model.training.supplementalReplayCalibration} trained-decisions=${result.model.trainedDecisionCount} model-fingerprint=${result.modelFingerprint}`
  );
  lines.push(
    `Model capture: development=${formatMetric(result.evaluation.model.development)} holdout=${formatMetric(result.evaluation.model.holdout)}`
  );
  for (const baseline of result.evaluation.baselines) {
    lines.push(
      `- baseline ${baseline.name}: development=${formatMetric(baseline.development)} holdout=${formatMetric(baseline.holdout)}`
    );
  }
  lines.push(
    `Gate: passed=${result.evaluation.summary.passed} best-baseline=${result.evaluation.summary.bestBaselineName} holdout-delta=${result.evaluation.summary.holdoutCaptureDeltaVsBestBaseline.toFixed(4)} failures=${result.evaluation.summary.failedReasons.length ? result.evaluation.summary.failedReasons.join("; ") : "none"}`
  );
  lines.push("Decision: offline diagnostics only; no LNS runtime scorer or solver default changed.");
  return lines.join("\n");
}
