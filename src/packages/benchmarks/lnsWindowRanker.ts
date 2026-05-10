import { performance } from "node:perf_hooks";

import { benchmarkGeneratedAt, uniqueBenchmarkValues } from "./benchmarkOptions.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import {
  runLnsWindowRankerBaselineExperiment,
  type LnsWindowRankerBaselineExperimentResult,
  type LnsWindowRankerMetricSummary
} from "./lnsWindowRankerBaselines.js";
import {
  collectReplayDecisionGroups,
  collectSupplementalReplayDecisionGroups,
  evaluateSplit,
  featureNamesForTraining,
  interactionWeightsRecord,
  modelFeatureNames,
  normalizeTrainingOptions,
  roundMetric,
  scoreLabel,
  splitGroups,
  targetAllowsFeatureIdenticalRepeatabilityConflicts,
  trainLinearRanker,
  weightArrayFromModel,
  weightsRecord
} from "./lnsWindowRankerTraining.js";
import { buildLnsWindowReplayRepeatabilityConflictIndex } from "./lnsWindowReplayRepeatability.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";
import {
  assertValidLnsWindowRankerRuntimeModel,
  LNS_WINDOW_RANKER_FEATURE_NAMES,
  LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION
} from "../core/index.js";

import type { LearnedRankingLabelSnapshot, LearnedRankingLabelSplit } from "./learnedRankingLabels.js";
import type { LnsWindowReplayRepeatabilitySummary } from "./lnsWindowReplayRepeatability.js";
import type { LnsWindowReplaySnapshot, LnsWindowReplaySnapshotLabel } from "./lnsWindowReplayLabels.js";
import { positiveIntegerOrDefault } from "./lnsWindowRankerShared.js";
import type { LnsWindowRankerLabelTarget } from "./lnsWindowRankerShared.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifest,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";
import type { LnsWindowRankerFeatureName } from "../core/index.js";

export { LNS_WINDOW_RANKER_FEATURE_NAMES };
export type { LnsWindowRankerFeatureName };

export interface LnsWindowRankerTrainingOptions {
  epochs?: number;
  learningRate?: number;
  marginWeightCap?: number;
  baselineTieBreak?: boolean;
  target?: LnsWindowRankerLabelTarget;
  allowWeakSeedReplayLabels?: boolean;
  supplementalReplayCalibration?: boolean;
  supplementalReplayCalibrationIgnoreBaselineFeature?: boolean;
  excludeFeatureIdenticalRepeatabilityConflicts?: boolean;
  trajectoryFeatures?: boolean;
  featureInteractions?: boolean;
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
  featureNames: string[];
  weights: Record<LnsWindowRankerFeatureName, number>;
  interactionWeights?: Record<string, number>;
  intercept: 0;
  topK: number;
  training: Required<LnsWindowRankerTrainingOptions>;
  trainedDecisionCount: number;
  trainedPairCount: number;
  trainingSplit: "development";
}

export function scoreLnsWindowRankerReplayLabel(
  label: LnsWindowReplaySnapshotLabel,
  model: Pick<LnsWindowRankerModel, "weights" | "interactionWeights" | "featureNames">
): number {
  assertValidLnsWindowRankerRuntimeModel(model, "LNS window ranker model");
  const featureNames = modelFeatureNames(model);
  return scoreLabel(label, weightArrayFromModel(model, featureNames), featureNames);
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
    sourceRepeatabilityFeatureIdenticalConflictBucketCount: number;
    sourceRepeatabilityFeatureIdenticalConflictLabelCount: number;
  };
  labels: {
    labelCount: number;
    usableLabelCount: number;
    excludedFeatureIdenticalRepeatabilityConflictLabelCount: number;
    excludedFeatureIdenticalRepeatabilityConflictDecisionCount: number;
    opportunityCount: number;
    developmentDecisionCount: number;
    holdoutDecisionCount: number;
    supplementalReplayDecisionCount: number;
    supplementalReplayLabelCount: number;
    repeatabilitySummary: LnsWindowReplayRepeatabilitySummary;
    supplementalRepeatabilitySummary: LnsWindowReplayRepeatabilitySummary;
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

function buildSummary(
  labelSnapshot: LearnedRankingLabelSnapshot,
  baselineResult: LnsWindowRankerBaselineExperimentResult,
  holdoutEvaluation: LnsWindowRankerModelSplitEvaluation,
  supplementalReplayCalibration: boolean,
  target: LnsWindowRankerLabelTarget,
  repeatabilitySummary: LnsWindowReplayRepeatabilitySummary,
  excludeFeatureIdenticalRepeatabilityConflicts: boolean
): LnsWindowRankerSummary {
  const bestBaseline = baselineResult.evaluation.summary;
  const failedReasons: string[] = [];
  if (!labelSnapshot.leakage.protectedHoldout) failedReasons.push("development/holdout label cases overlap");
  if (supplementalReplayCalibration) {
    failedReasons.push("supplemental replay calibration is diagnostics-only and cannot promote a model");
  }
  if (!labelSnapshot.lns.scaleReadiness.passed) failedReasons.push("source LNS label-scale readiness did not pass");
  if (
    repeatabilitySummary.featureIdenticalConflictBucketCount > 0 &&
    !targetAllowsFeatureIdenticalRepeatabilityConflicts(target) &&
    !excludeFeatureIdenticalRepeatabilityConflicts
  ) {
    failedReasons.push(
      `source LNS replay repeatability has feature-identical conflicts ${repeatabilitySummary.featureIdenticalConflictBucketCount} buckets/${repeatabilitySummary.featureIdenticalConflictLabelCount} labels`
    );
  }
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

function lnsRepeatabilityInput(labelSnapshot: LearnedRankingLabelSnapshot) {
  return {
    cases: labelSnapshot.lns.splits.flatMap((split) => split.replay.cases)
  };
}

function supplementalRepeatabilityInput(snapshots: readonly LnsWindowReplaySnapshot[]) {
  return {
    cases: snapshots.flatMap((snapshot) => snapshot.cases)
  };
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
    targetRollForwardBaselineStallLift: result.model.training.target === "roll-forward-baseline-stall-lift" ? 1 : 0,
    weakSeedReplayLabelsAllowed: result.model.training.allowWeakSeedReplayLabels,
    supplementalReplayCalibration: result.model.training.supplementalReplayCalibration,
    supplementalReplayCalibrationIgnoreBaselineFeature:
      result.model.training.supplementalReplayCalibrationIgnoreBaselineFeature,
    excludeFeatureIdenticalRepeatabilityConflicts: result.model.training.excludeFeatureIdenticalRepeatabilityConflicts,
    trajectoryFeatures: result.model.training.trajectoryFeatures,
    trajectoryFeatureCount: result.model.featureNames.filter(
      (featureName) =>
        featureName.startsWith("baselineOperator") ||
        featureName.startsWith("selectedOperator") ||
        featureName.startsWith("transition")
    ).length,
    featureInteractions: result.model.training.featureInteractions,
    interactionFeatureCount: Object.keys(result.model.interactionWeights ?? {}).length,
    supplementalReplaySnapshotCount: result.audit.supplementalReplaySnapshotCount,
    sourceRepeatabilityFeatureIdenticalConflictBucketCount:
      result.labels.repeatabilitySummary.featureIdenticalConflictBucketCount,
    sourceRepeatabilityFeatureIdenticalConflictLabelCount:
      result.labels.repeatabilitySummary.featureIdenticalConflictLabelCount,
    supplementalRepeatabilityFeatureIdenticalConflictBucketCount:
      result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictBucketCount,
    supplementalRepeatabilityFeatureIdenticalConflictLabelCount:
      result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictLabelCount,
    excludedFeatureIdenticalRepeatabilityConflictLabelCount:
      result.labels.excludedFeatureIdenticalRepeatabilityConflictLabelCount,
    excludedFeatureIdenticalRepeatabilityConflictDecisionCount:
      result.labels.excludedFeatureIdenticalRepeatabilityConflictDecisionCount,
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
  const supplementalReplaySnapshots = training.supplementalReplayCalibration
    ? (options.supplementalReplaySnapshots ?? [])
    : [];
  const topK = positiveIntegerOrDefault(options.topK, 3);
  const baselineResult = runLnsWindowRankerBaselineExperiment(labelSnapshot, {
    randomBaselineSeed: options.randomBaselineSeed,
    topK,
    target: training.target,
    allowWeakSeedReplayLabels: training.allowWeakSeedReplayLabels,
    excludeFeatureIdenticalRepeatabilityConflicts: training.excludeFeatureIdenticalRepeatabilityConflicts
  });
  const repeatabilityIndex = buildLnsWindowReplayRepeatabilityConflictIndex(lnsRepeatabilityInput(labelSnapshot));
  const supplementalRepeatabilityIndex = buildLnsWindowReplayRepeatabilityConflictIndex(
    supplementalRepeatabilityInput(supplementalReplaySnapshots)
  );
  const sourceConflictBucketKeys = training.excludeFeatureIdenticalRepeatabilityConflicts
    ? new Set(repeatabilityIndex.featureIdenticalConflictBucketKeys)
    : new Set<string>();
  const supplementalConflictBucketKeys = training.excludeFeatureIdenticalRepeatabilityConflicts
    ? new Set(supplementalRepeatabilityIndex.featureIdenticalConflictBucketKeys)
    : new Set<string>();
  const sourceGroupCollection = collectReplayDecisionGroups(
    labelSnapshot,
    training.target,
    training.allowWeakSeedReplayLabels,
    sourceConflictBucketKeys
  );
  const supplementalGroupCollection = collectSupplementalReplayDecisionGroups(
    supplementalReplaySnapshots,
    training.target,
    training.allowWeakSeedReplayLabels,
    supplementalConflictBucketKeys
  );
  const supplementalGroups = supplementalGroupCollection.groups;
  const groups = [...sourceGroupCollection.groups, ...supplementalGroups];
  const developmentGroups = splitGroups(groups, "development");
  const holdoutGroups = splitGroups(groups, "holdout");
  const featureNames = featureNamesForTraining(training);
  const startedAtMs = performance.now();
  const trained = trainLinearRanker(developmentGroups, training, topK, featureNames);
  const trainingWallClockSeconds = (performance.now() - startedAtMs) / 1000;
  const weights = weightsRecord(trained.weights, featureNames);
  const interactionWeights = interactionWeightsRecord(trained.weights, featureNames);
  const model: LnsWindowRankerModel = {
    schemaVersion: 1,
    modelType: "lns-window-linear-pairwise-ranker",
    purpose: "offline-diagnostics-only",
    trained: true,
    runtimeDefaultChanged: false,
    solverDefaultChanged: false,
    featureSchemaVersion: training.trajectoryFeatures
      ? LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION
      : (labelSnapshot.audit.lnsReplay.featureSchemaVersion ?? null),
    featureNames,
    weights,
    ...(training.featureInteractions ? { interactionWeights } : {}),
    intercept: 0,
    topK,
    training,
    trainedDecisionCount: developmentGroups.length,
    trainedPairCount: trained.trainedPairCount,
    trainingSplit: "development"
  };
  assertValidLnsWindowRankerRuntimeModel(model, "LNS window ranker model");
  const roundedWeights = weightArrayFromModel(model, featureNames);
  const modelEvaluation = {
    development: evaluateSplit("development", developmentGroups, roundedWeights, topK, training.target, featureNames),
    holdout: evaluateSplit("holdout", holdoutGroups, roundedWeights, topK, training.target, featureNames)
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
      supplementalReplaySnapshotCount: supplementalReplaySnapshots.length,
      sourceRepeatabilityFeatureIdenticalConflictBucketCount:
        repeatabilityIndex.summary.featureIdenticalConflictBucketCount,
      sourceRepeatabilityFeatureIdenticalConflictLabelCount:
        repeatabilityIndex.summary.featureIdenticalConflictLabelCount
    },
    labels: {
      labelCount: labelSnapshot.lns.labelCount,
      usableLabelCount: baselineResult.labels.usableLabelCount,
      excludedFeatureIdenticalRepeatabilityConflictLabelCount:
        sourceGroupCollection.excludedFeatureIdenticalRepeatabilityConflictLabelCount +
        supplementalGroupCollection.excludedFeatureIdenticalRepeatabilityConflictLabelCount,
      excludedFeatureIdenticalRepeatabilityConflictDecisionCount:
        sourceGroupCollection.excludedFeatureIdenticalRepeatabilityConflictDecisionCount +
        supplementalGroupCollection.excludedFeatureIdenticalRepeatabilityConflictDecisionCount,
      opportunityCount: baselineResult.labels.opportunityCount,
      developmentDecisionCount: developmentGroups.length,
      holdoutDecisionCount: holdoutGroups.length,
      supplementalReplayDecisionCount: supplementalGroups.length,
      supplementalReplayLabelCount: supplementalGroups.reduce((total, group) => total + group.labels.length, 0),
      repeatabilitySummary: repeatabilityIndex.summary,
      supplementalRepeatabilitySummary: supplementalRepeatabilityIndex.summary
    },
    training: {
      wallClockSeconds: trainingWallClockSeconds,
      epochs: trained.epochs
    },
    model,
    evaluation: {
      model: modelEvaluation,
      baselines: baselineResult.evaluation.baselines,
      summary: buildSummary(
        labelSnapshot,
        baselineResult,
        modelEvaluation.holdout,
        training.supplementalReplayCalibration,
        training.target,
        repeatabilityIndex.summary,
        training.excludeFeatureIdenticalRepeatabilityConflicts
      )
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
      trainingTargetRollForwardBaselineStallLift:
        result.model.training.target === "roll-forward-baseline-stall-lift" ? 1 : 0,
      trainingAllowWeakSeedReplayLabels: result.model.training.allowWeakSeedReplayLabels ? 1 : 0,
      trainingSupplementalReplayCalibration: result.model.training.supplementalReplayCalibration ? 1 : 0,
      trainingSupplementalReplayCalibrationIgnoreBaselineFeature: result.model.training
        .supplementalReplayCalibrationIgnoreBaselineFeature
        ? 1
        : 0,
      trainingTrajectoryFeatures: result.model.training.trajectoryFeatures ? 1 : 0,
      trainingFeatureInteractions: result.model.training.featureInteractions ? 1 : 0,
      trainingExcludeFeatureIdenticalRepeatabilityConflicts: result.model.training
        .excludeFeatureIdenticalRepeatabilityConflicts
        ? 1
        : 0,
      trainingWallClockSeconds: roundMetric(result.training.wallClockSeconds),
      trainedDecisionCount: result.model.trainedDecisionCount,
      trainedPairCount: result.model.trainedPairCount,
      trajectoryFeatureCount: result.model.featureNames.filter(
        (featureName) =>
          featureName.startsWith("baselineOperator") ||
          featureName.startsWith("selectedOperator") ||
          featureName.startsWith("transition")
      ).length,
      interactionFeatureCount: Object.keys(result.model.interactionWeights ?? {}).length,
      lnsLabelCount: result.labels.labelCount,
      supplementalReplayDecisionCount: result.labels.supplementalReplayDecisionCount,
      supplementalReplayLabelCount: result.labels.supplementalReplayLabelCount,
      usableLabelCount: result.labels.usableLabelCount,
      repeatabilityFeatureIdenticalConflictBucketCount:
        result.labels.repeatabilitySummary.featureIdenticalConflictBucketCount,
      repeatabilityFeatureIdenticalConflictLabelCount:
        result.labels.repeatabilitySummary.featureIdenticalConflictLabelCount,
      supplementalRepeatabilityFeatureIdenticalConflictBucketCount:
        result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictBucketCount,
      supplementalRepeatabilityFeatureIdenticalConflictLabelCount:
        result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictLabelCount,
      excludedFeatureIdenticalRepeatabilityConflictLabelCount:
        result.labels.excludedFeatureIdenticalRepeatabilityConflictLabelCount,
      excludedFeatureIdenticalRepeatabilityConflictDecisionCount:
        result.labels.excludedFeatureIdenticalRepeatabilityConflictDecisionCount,
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
    `Audit: cpu-only=${result.audit.cpuOnly} runtime-default-changed=${result.audit.runtimeDefaultChanged} source-preset=${result.audit.sourceLabelPreset ?? "none"} source-lns-scale-ready=${result.audit.sourceLnsScaleReady} target=${result.audit.labelTarget} weak-seed-labels=${result.audit.weakSeedReplayLabelsAllowed} supplemental-replay-calibration=${result.audit.supplementalReplayCalibration} supplemental-replay-snapshots=${result.audit.supplementalReplaySnapshotCount} repeatability-feature-identical-conflicts=${result.audit.sourceRepeatabilityFeatureIdenticalConflictBucketCount}/${result.audit.sourceRepeatabilityFeatureIdenticalConflictLabelCount}`
  );
  lines.push(
    `Labels: total=${result.labels.labelCount} usable=${result.labels.usableLabelCount} opportunities=${result.labels.opportunityCount} supplemental-decisions=${result.labels.supplementalReplayDecisionCount} supplemental-labels=${result.labels.supplementalReplayLabelCount} supplemental-repeatability-feature-identical-conflicts=${result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictBucketCount}/${result.labels.supplementalRepeatabilitySummary.featureIdenticalConflictLabelCount} repeatability-excluded=${result.labels.excludedFeatureIdenticalRepeatabilityConflictLabelCount}/${result.labels.excludedFeatureIdenticalRepeatabilityConflictDecisionCount} label-fingerprint=${result.labelFingerprint}`
  );
  lines.push(
    `Model: ${result.model.modelType} features=${result.model.featureNames.length} interaction-features=${Object.keys(result.model.interactionWeights ?? {}).length} epochs=${result.model.training.epochs} baseline-tie-break=${result.model.training.baselineTieBreak} target=${result.model.training.target} weak-seed-labels=${result.model.training.allowWeakSeedReplayLabels} supplemental-replay-calibration=${result.model.training.supplementalReplayCalibration} supplemental-replay-calibration-ignore-baseline-feature=${result.model.training.supplementalReplayCalibrationIgnoreBaselineFeature} trajectory-features=${result.model.training.trajectoryFeatures} feature-interactions=${result.model.training.featureInteractions} repeatability-conflicts-excluded=${result.model.training.excludeFeatureIdenticalRepeatabilityConflicts} trained-decisions=${result.model.trainedDecisionCount} model-fingerprint=${result.modelFingerprint}`
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
