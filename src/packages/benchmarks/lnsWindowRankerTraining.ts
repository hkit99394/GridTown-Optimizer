import {
  isLnsWindowRankerFeatureName,
  isLnsWindowRankerInteractionFeatureName,
  lnsWindowRankerBaselineOperatorFeatureName,
  lnsWindowRankerOperatorTransitionFeatureName,
  lnsWindowRankerSelectedOperatorFeatureName,
  LNS_ADAPTIVE_OPERATOR_NAMES,
  LNS_WINDOW_RANKER_BASE_FEATURE_NAMES,
  LNS_WINDOW_RANKER_FEATURE_NAMES
} from "../core/index.js";
import { lnsWindowReplayRepeatabilityBucketKey } from "./lnsWindowReplayRepeatability.js";
import {
  hasTargetValue,
  inferLnsWindowRankerReplaySeedHintKind,
  normalizeLnsWindowRankerFeatureIdenticalRepeatabilityConflictExclusion,
  normalizeLnsWindowRankerLabelTarget,
  normalizeLnsWindowRankerWeakSeedAllowance,
  numericValue,
  positiveFiniteNumberOrDefault,
  positiveIntegerOrDefault,
  roundMetric,
  targetAllowsFeatureIdenticalRepeatabilityConflicts,
  targetValue
} from "./lnsWindowRankerShared.js";

import type {
  LnsAdaptiveOperatorName,
  LnsWindowRankerFeatureName,
  LnsWindowRankerOperatorTrajectoryFeatureName
} from "../core/index.js";
import type { LearnedRankingLabelSnapshot, LearnedRankingLabelSplit } from "./learnedRankingLabels.js";
import type { LnsReplayPressureFamilyLabel } from "./lns.js";
import type {
  LnsWindowReplaySeedHintKind,
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel
} from "./lnsWindowReplayLabels.js";
import type { LnsWindowRankerLabelTarget } from "./lnsWindowRankerShared.js";
import type { LnsWindowRankerMetricSummary } from "./lnsWindowRankerBaselines.js";
import type {
  LnsWindowRankerEpochSummary,
  LnsWindowRankerModel,
  LnsWindowRankerModelBreakdownMetrics,
  LnsWindowRankerModelSplitEvaluation,
  LnsWindowRankerTrainingOptions
} from "./lnsWindowRanker.js";

export interface ReplayDecisionGroup {
  split: LearnedRankingLabelSplit;
  source: "label-snapshot" | "supplemental-replay";
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  seedHintKind: LnsWindowReplaySeedHintKind | "unknown";
  statePolicy: string;
  stateIndex: number;
  baselineOperator: LnsAdaptiveOperatorName | null;
  labels: LnsWindowReplaySnapshotLabel[];
}

export interface ReplayDecisionGroupCollection {
  groups: ReplayDecisionGroup[];
  excludedFeatureIdenticalRepeatabilityConflictLabelCount: number;
  excludedFeatureIdenticalRepeatabilityConflictDecisionCount: number;
}

const DEFAULT_LNS_WINDOW_RANKER_TRAINING: Required<LnsWindowRankerTrainingOptions> = Object.freeze({
  epochs: 5,
  learningRate: 0.05,
  marginWeightCap: 500,
  baselineTieBreak: false,
  target: "immediate-improvement",
  allowWeakSeedReplayLabels: true,
  supplementalReplayCalibration: false,
  supplementalReplayCalibrationIgnoreBaselineFeature: false,
  excludeFeatureIdenticalRepeatabilityConflicts: false,
  trajectoryFeatures: false,
  featureInteractions: false
});

const SELECTED_BY_BASELINE_FEATURE_INDEX = LNS_WINDOW_RANKER_BASE_FEATURE_NAMES.indexOf("selectedByBaseline");

export function normalizeTrainingOptions(
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
    supplementalReplayCalibration: options?.supplementalReplayCalibration === true,
    supplementalReplayCalibrationIgnoreBaselineFeature:
      options?.supplementalReplayCalibrationIgnoreBaselineFeature === true,
    excludeFeatureIdenticalRepeatabilityConflicts:
      normalizeLnsWindowRankerFeatureIdenticalRepeatabilityConflictExclusion(
        options?.excludeFeatureIdenticalRepeatabilityConflicts
      ),
    trajectoryFeatures: options?.trajectoryFeatures === true,
    featureInteractions: options?.featureInteractions === true
  };
}

function baseFeatureVector(label: LnsWindowReplaySnapshotLabel): number[] {
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

function baselineOperatorForReplayCase(benchmarkCase: {
  baselineSelectedOperator?: LnsAdaptiveOperatorName | null;
  labels: readonly LnsWindowReplaySnapshotLabel[];
}): LnsAdaptiveOperatorName | null {
  return (
    benchmarkCase.baselineSelectedOperator ??
    benchmarkCase.labels.find((label) => label.selectedByBaseline)?.operator ??
    null
  );
}

function pairwiseInteractionFeatureNames(featureNames: readonly string[]): string[] {
  return featureNames.flatMap((left, leftIndex) => featureNames.slice(leftIndex).map((right) => `${left}*${right}`));
}

export function featureNamesForTraining(training: Required<LnsWindowRankerTrainingOptions>): string[] {
  const featureNames = training.trajectoryFeatures
    ? [...LNS_WINDOW_RANKER_FEATURE_NAMES]
    : [...LNS_WINDOW_RANKER_BASE_FEATURE_NAMES];
  return training.featureInteractions
    ? [...featureNames, ...pairwiseInteractionFeatureNames(featureNames)]
    : featureNames;
}

function operatorTrajectoryFeatureValues(
  label: LnsWindowReplaySnapshotLabel,
  baselineOperator: LnsAdaptiveOperatorName | null
): Record<LnsWindowRankerOperatorTrajectoryFeatureName, number> {
  const values: Partial<Record<LnsWindowRankerOperatorTrajectoryFeatureName, number>> = {};
  for (const operator of LNS_ADAPTIVE_OPERATOR_NAMES) {
    values[lnsWindowRankerBaselineOperatorFeatureName(operator)] = operator === baselineOperator ? 1 : 0;
    values[lnsWindowRankerSelectedOperatorFeatureName(operator)] = operator === label.operator ? 1 : 0;
    for (const selectedOperator of LNS_ADAPTIVE_OPERATOR_NAMES) {
      values[lnsWindowRankerOperatorTransitionFeatureName(operator, selectedOperator)] =
        operator === baselineOperator && selectedOperator === label.operator ? 1 : 0;
    }
  }
  return values as Record<LnsWindowRankerOperatorTrajectoryFeatureName, number>;
}

function featureVector(
  label: LnsWindowReplaySnapshotLabel,
  featureNames: readonly string[],
  group?: ReplayDecisionGroup
): number[] {
  const base = baseFeatureVector(label);
  if (featureNames.length === LNS_WINDOW_RANKER_BASE_FEATURE_NAMES.length) return base;
  const baselineOperator = group?.baselineOperator ?? (label.selectedByBaseline ? label.operator : null);
  const trajectoryValues = operatorTrajectoryFeatureValues(label, baselineOperator);
  const baseByName = new Map<string, number>(
    LNS_WINDOW_RANKER_BASE_FEATURE_NAMES.map((featureName, index) => [featureName, base[index] ?? 0])
  );
  for (const [featureName, value] of Object.entries(trajectoryValues)) {
    baseByName.set(featureName, value);
  }
  return featureNames.map((featureName) => {
    const baseValue = baseByName.get(featureName);
    if (baseValue !== undefined) return baseValue;
    const [left, right, extra] = featureName.split("*");
    if (extra !== undefined || left === undefined || right === undefined) return 0;
    return (baseByName.get(left) ?? 0) * (baseByName.get(right) ?? 0);
  });
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

export function scoreLabel(
  label: LnsWindowReplaySnapshotLabel,
  weights: readonly number[],
  featureNames: readonly string[],
  group?: ReplayDecisionGroup
): number {
  return dot(featureVector(label, featureNames, group), weights);
}

export function modelFeatureNames(model: Pick<LnsWindowRankerModel, "featureNames" | "interactionWeights">): string[] {
  return model.featureNames.length > 0
    ? [...model.featureNames]
    : [...LNS_WINDOW_RANKER_FEATURE_NAMES, ...Object.keys(model.interactionWeights ?? {})];
}

export { roundMetric, targetAllowsFeatureIdenticalRepeatabilityConflicts };

export function collectReplayDecisionGroups(
  labelSnapshot: LearnedRankingLabelSnapshot,
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean,
  featureIdenticalConflictBucketKeys: ReadonlySet<string>
): ReplayDecisionGroupCollection {
  const collection: ReplayDecisionGroupCollection = {
    groups: [],
    excludedFeatureIdenticalRepeatabilityConflictLabelCount: 0,
    excludedFeatureIdenticalRepeatabilityConflictDecisionCount: 0
  };
  for (const split of labelSnapshot.lns.splits) {
    for (const benchmarkCase of split.replay.cases) {
      const seedKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedKind === "weak-replay") continue;
      const eligibleLabels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (eligibleLabels.length === 0) continue;
      const labels = eligibleLabels.filter(
        (label) => !featureIdenticalConflictBucketKeys.has(lnsWindowReplayRepeatabilityBucketKey(label))
      );
      const excludedLabelCount = eligibleLabels.length - labels.length;
      collection.excludedFeatureIdenticalRepeatabilityConflictLabelCount += excludedLabelCount;
      if (excludedLabelCount > 0 && labels.length === 0) {
        collection.excludedFeatureIdenticalRepeatabilityConflictDecisionCount += 1;
      }
      if (labels.length === 0) continue;
      collection.groups.push({
        split: split.split,
        source: "label-snapshot",
        caseName: benchmarkCase.name,
        pressureFamily: benchmarkCase.pressureFamily,
        seed: benchmarkCase.seed,
        seedHintKind: seedKind,
        statePolicy: benchmarkCase.statePolicy,
        stateIndex: benchmarkCase.stateIndex,
        baselineOperator: baselineOperatorForReplayCase(benchmarkCase),
        labels
      });
    }
  }
  return collection;
}

export function collectSupplementalReplayDecisionGroups(
  snapshots: readonly LnsWindowReplaySnapshot[],
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean,
  featureIdenticalConflictBucketKeys: ReadonlySet<string>
): ReplayDecisionGroupCollection {
  const collection: ReplayDecisionGroupCollection = {
    groups: [],
    excludedFeatureIdenticalRepeatabilityConflictLabelCount: 0,
    excludedFeatureIdenticalRepeatabilityConflictDecisionCount: 0
  };
  for (const snapshot of snapshots) {
    for (const benchmarkCase of snapshot.cases) {
      const seedKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedKind === "weak-replay") continue;
      const eligibleLabels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (eligibleLabels.length === 0) continue;
      const labels = eligibleLabels.filter(
        (label) => !featureIdenticalConflictBucketKeys.has(lnsWindowReplayRepeatabilityBucketKey(label))
      );
      const excludedLabelCount = eligibleLabels.length - labels.length;
      collection.excludedFeatureIdenticalRepeatabilityConflictLabelCount += excludedLabelCount;
      if (excludedLabelCount > 0 && labels.length === 0) {
        collection.excludedFeatureIdenticalRepeatabilityConflictDecisionCount += 1;
      }
      if (labels.length === 0) continue;
      collection.groups.push({
        split: "development",
        source: "supplemental-replay",
        caseName: benchmarkCase.name,
        pressureFamily: benchmarkCase.pressureFamily,
        seed: benchmarkCase.seed,
        seedHintKind: seedKind,
        statePolicy: benchmarkCase.statePolicy,
        stateIndex: benchmarkCase.stateIndex,
        baselineOperator: baselineOperatorForReplayCase(benchmarkCase),
        labels
      });
    }
  }
  return collection;
}

export function splitGroups(
  groups: readonly ReplayDecisionGroup[],
  split: LearnedRankingLabelSplit
): ReplayDecisionGroup[] {
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

function featureDiffForTraining(
  group: ReplayDecisionGroup,
  positiveVector: readonly number[],
  negativeVector: readonly number[],
  bestImprovement: number,
  training: Required<LnsWindowRankerTrainingOptions>
): number[] {
  const diff = positiveVector.map((value, index) => value - (negativeVector[index] ?? 0));
  if (
    training.supplementalReplayCalibrationIgnoreBaselineFeature &&
    SELECTED_BY_BASELINE_FEATURE_INDEX >= 0 &&
    useSupplementalNeutralBaselineCalibration(group, bestImprovement, training)
  ) {
    diff[SELECTED_BY_BASELINE_FEATURE_INDEX] = 0;
  }
  return diff;
}

function evaluateMetricSummary(
  groups: readonly ReplayDecisionGroup[],
  weights: readonly number[],
  topK: number,
  target: LnsWindowRankerLabelTarget,
  featureNames: readonly string[]
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
        scoreLabel(right, weights, featureNames, group) - scoreLabel(left, weights, featureNames, group) ||
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
  featureNames: readonly string[],
  keyForGroup: (group: ReplayDecisionGroup) => string
): LnsWindowRankerModelBreakdownMetrics[] {
  return [...groupByKey(groups, keyForGroup).entries()]
    .map(([key, keyGroups]) => ({
      key,
      ...evaluateMetricSummary(keyGroups, weights, topK, target, featureNames)
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function evaluateSplit(
  split: LearnedRankingLabelSplit,
  groups: readonly ReplayDecisionGroup[],
  weights: readonly number[],
  topK: number,
  target: LnsWindowRankerLabelTarget,
  featureNames: readonly string[]
): LnsWindowRankerModelSplitEvaluation {
  return {
    split,
    ...evaluateMetricSummary(groups, weights, topK, target, featureNames),
    pressureFamilyMetrics: breakdownMetrics(
      groups,
      weights,
      topK,
      target,
      featureNames,
      (group) => group.pressureFamily
    ),
    statePolicyMetrics: breakdownMetrics(groups, weights, topK, target, featureNames, (group) => group.statePolicy),
    seedHintMetrics: breakdownMetrics(groups, weights, topK, target, featureNames, (group) => group.seedHintKind)
  };
}

export function trainLinearRanker(
  developmentGroups: readonly ReplayDecisionGroup[],
  training: Required<LnsWindowRankerTrainingOptions>,
  topK: number,
  featureNames: readonly string[]
): {
  weights: number[];
  epochs: LnsWindowRankerEpochSummary[];
  trainedPairCount: number;
} {
  const weights = featureNames.map(() => 0);
  const epochs: LnsWindowRankerEpochSummary[] = [];
  let trainedPairCount = 0;

  for (let epoch = 0; epoch < training.epochs; epoch++) {
    let mistakes = 0;
    for (const group of developmentGroups) {
      const bestImprovement = maxImprovement(group, training.target);
      const positives = positiveLabelsForTraining(group, bestImprovement, training);
      if (positives.length === 0) continue;
      for (const positive of positives) {
        const positiveVector = featureVector(positive, featureNames, group);
        for (const negative of group.labels) {
          const delta = trainingDelta(group, negative, bestImprovement, training);
          if (delta <= 0) continue;
          trainedPairCount++;
          const negativeVector = featureVector(negative, featureNames, group);
          const diff = featureDiffForTraining(group, positiveVector, negativeVector, bestImprovement, training);
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
      developmentCaptureRate: evaluateMetricSummary(developmentGroups, weights, topK, training.target, featureNames)
        .improvementCaptureRate
    });
  }

  return { weights, epochs, trainedPairCount };
}

export function weightsRecord(
  weights: readonly number[],
  featureNames: readonly string[]
): Record<LnsWindowRankerFeatureName, number> {
  return Object.fromEntries(
    featureNames
      .filter(isLnsWindowRankerFeatureName)
      .map((featureName) => [featureName, roundMetric(weights[featureNames.indexOf(featureName)] ?? 0)])
  ) as Record<LnsWindowRankerFeatureName, number>;
}

export function interactionWeightsRecord(
  weights: readonly number[],
  featureNames: readonly string[]
): Record<string, number> {
  return Object.fromEntries(
    featureNames
      .filter((featureName) => isLnsWindowRankerInteractionFeatureName(featureName))
      .map((featureName) => [featureName, roundMetric(weights[featureNames.indexOf(featureName)] ?? 0)])
      .filter(([, value]) => value !== 0)
  ) as Record<string, number>;
}

export function weightArrayFromModel(
  model: Pick<LnsWindowRankerModel, "weights" | "interactionWeights">,
  featureNames: readonly string[]
): number[] {
  return featureNames.map((featureName) =>
    featureName.includes("*")
      ? (model.interactionWeights?.[featureName] ?? 0)
      : (model.weights[featureName as LnsWindowRankerFeatureName] ?? 0)
  );
}
