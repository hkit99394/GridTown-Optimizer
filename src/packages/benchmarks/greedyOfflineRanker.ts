import { performance } from "node:perf_hooks";

import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  benchmarkGeneratedAt,
  positiveIntegerOrDefault,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
} from "./benchmarkOptions.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import {
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
} from "./greedyDeterministicAblations.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest,
} from "./modelExperimentArtifacts.js";
import {
  collectGreedyOrderingLabelsFromBenchmarkSuite,
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
} from "./learnedRankingLabels.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkOptions,
} from "./greedy.js";
import type {
  GreedyOrderingLabel,
  GreedyOrderingLabelSource,
  GreedyOrderingLabelSplitResult,
  GreedyOrderingPlacementFeatures,
  LearnedRankingLabelSplit,
  LearnedRankingLabelSplitConfig,
} from "./learnedRankingLabels.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifest,
  ModelExperimentTelemetryManifestOptions,
} from "./modelExperimentArtifacts.js";

export const GREEDY_OFFLINE_RANKER_FEATURE_NAMES = Object.freeze([
  "lowerRoadCost",
  "higherScore",
  "lowerShadowPenalty",
  "higherReachableBefore",
  "higherReachableAfter",
  "lowerLostCells",
  "lowerFootprintCells",
  "lowerDisconnectedCells",
  "higherBonus",
  "higherRange",
  "smallerArea",
  "lowerTypeIndex",
] as const);

export type GreedyOfflineRankerFeatureName = typeof GREEDY_OFFLINE_RANKER_FEATURE_NAMES[number];

export interface GreedyOfflineRankerTrainingOptions {
  epochs?: number;
  learningRate?: number;
  marginWeightCap?: number;
}

export interface GreedyOfflineRankerRunOptions {
  seeds?: readonly number[];
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[];
  greedyCorpus?: readonly GreedyBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
  training?: GreedyOfflineRankerTrainingOptions;
  randomBaselineSeed?: number;
}

export interface GreedyOfflineRankerPairMetrics {
  labelCount: number;
  correctScore: number;
  accuracy: number;
  marginWeightedCorrect: number;
  marginWeightedTotal: number;
  marginWeightedAccuracy: number;
}

export interface GreedyOfflineRankerSourceMetrics extends GreedyOfflineRankerPairMetrics {
  source: GreedyOrderingLabelSource;
}

export interface GreedyOfflineRankerSplitEvaluation extends GreedyOfflineRankerPairMetrics {
  split: LearnedRankingLabelSplit;
  sourceMetrics: GreedyOfflineRankerSourceMetrics[];
}

export interface GreedyOfflineRankerBaselineEvaluation {
  name: "deterministic-proxy" | "stable-random" | "best-single-feature";
  description: string;
  selectedFeatureName: GreedyOfflineRankerFeatureName | null;
  development: GreedyOfflineRankerSplitEvaluation;
  holdout: GreedyOfflineRankerSplitEvaluation;
}

export interface GreedyOfflineRankerEpochSummary {
  epoch: number;
  mistakes: number;
  developmentAccuracy: number;
}

export interface GreedyOfflineRankerModel {
  schemaVersion: 1;
  modelType: "greedy-linear-pairwise-perceptron";
  purpose: "offline-diagnostics-only";
  trained: true;
  featureNames: GreedyOfflineRankerFeatureName[];
  weights: Record<GreedyOfflineRankerFeatureName, number>;
  intercept: 0;
  training: Required<GreedyOfflineRankerTrainingOptions>;
  trainedLabelCount: number;
  trainingSplit: "development";
}

export interface GreedyOfflineRankerLabelSplitSummary {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  seeds: number[];
  labelCount: number;
  sourceCounts: Record<GreedyOrderingLabelSource, number>;
}

export interface GreedyOfflineRankerLeakageReport {
  developmentGreedyCases: string[];
  holdoutGreedyCases: string[];
  greedyOverlap: string[];
  protectedHoldout: boolean;
}

export interface GreedyOfflineRankerSummary {
  passed: boolean;
  failedReasons: string[];
  bestBaselineName: GreedyOfflineRankerBaselineEvaluation["name"];
  bestBaselineHoldoutAccuracy: number;
  modelHoldoutAccuracy: number;
  holdoutAccuracyDeltaVsBestBaseline: number;
}

export interface GreedyOfflineRankerExperimentResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  splitCount: number;
  audit: {
    cpuOnly: true;
    runtimeDefaultChanged: false;
    solverDefaultChanged: false;
    usesCaseNameFeature: false;
    learnedRuntimeHook: null;
  };
  labels: {
    labelCount: number;
    sourceCounts: Record<GreedyOrderingLabelSource, number>;
    splits: GreedyOfflineRankerLabelSplitSummary[];
  };
  leakage: GreedyOfflineRankerLeakageReport;
  training: {
    wallClockSeconds: number;
    epochs: GreedyOfflineRankerEpochSummary[];
  };
  model: GreedyOfflineRankerModel;
  evaluation: {
    model: {
      development: GreedyOfflineRankerSplitEvaluation;
      holdout: GreedyOfflineRankerSplitEvaluation;
    };
    baselines: GreedyOfflineRankerBaselineEvaluation[];
    summary: GreedyOfflineRankerSummary;
  };
  datasetFingerprint: string;
  modelFingerprint: string;
}

export interface GreedyOfflineRankerExperimentSnapshot
  extends Omit<GreedyOfflineRankerExperimentResult, "generatedAt" | "training"> {
  training: Omit<GreedyOfflineRankerExperimentResult["training"], "wallClockSeconds">;
}

export interface GreedyOfflineRankerTelemetryManifestOptions
  extends Pick<ModelExperimentTelemetryManifestOptions, "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"> {}

export interface GreedyOfflineRankerRegistryEntryDraftOptions
  extends Pick<ModelExperimentRegistryEntryDraftOptions, "runId" | "commands" | "artifactPaths" | "decision" | "summary"> {}

type FeatureVector = Record<GreedyOfflineRankerFeatureName, number>;

const DEFAULT_GREEDY_OFFLINE_RANKER_TRAINING: Required<GreedyOfflineRankerTrainingOptions> = Object.freeze({
  epochs: 12,
  learningRate: 0.25,
  marginWeightCap: 10,
});

const DETERMINISTIC_BASELINE_WEIGHTS: Readonly<Partial<Record<GreedyOfflineRankerFeatureName, number>>> =
  Object.freeze({
    lowerRoadCost: 0.5,
    higherScore: 1,
    lowerShadowPenalty: 4,
    higherReachableAfter: 0.25,
    lowerLostCells: 2.5,
    lowerDisconnectedCells: 1,
    smallerArea: 0.2,
  });

function positiveFiniteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function emptySourceCounts(): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": 0,
    "road-opportunity-counterfactual": 0,
  };
}

function countSources(labels: readonly GreedyOrderingLabel[]): Record<GreedyOrderingLabelSource, number> {
  const counts = emptySourceCounts();
  for (const label of labels) {
    counts[label.source]++;
  }
  return counts;
}

function sumSourceCounts(
  splits: readonly GreedyOrderingLabelSplitResult[]
): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision":
      sumBenchmarkBy(splits, (split) => split.sourceCounts["connectivity-shadow-decision"]),
    "road-opportunity-counterfactual":
      sumBenchmarkBy(splits, (split) => split.sourceCounts["road-opportunity-counterfactual"]),
  };
}

function validateGreedySplitConfigs(splitConfigs: readonly LearnedRankingLabelSplitConfig[]): void {
  const splits = splitConfigs.map((config) => config.split);
  if (new Set(splits).size !== splits.length) {
    throw new Error("Greedy offline ranker split configs must use each split at most once.");
  }
  if (!splits.includes("development") || !splits.includes("holdout")) {
    throw new Error("Greedy offline ranker requires development and holdout splits.");
  }
  for (const config of splitConfigs) {
    if (config.greedyCaseNames.length === 0) {
      throw new Error(`Greedy offline ranker ${config.split} split must include at least one Greedy case.`);
    }
    if (uniqueBenchmarkValues(config.greedyCaseNames).length !== config.greedyCaseNames.length) {
      throw new Error(`Greedy offline ranker ${config.split} split has duplicate Greedy cases.`);
    }
  }
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return uniqueBenchmarkValues(left.filter((entry) => rightSet.has(entry)));
}

function buildGreedyLeakageReport(
  splitConfigs: readonly LearnedRankingLabelSplitConfig[]
): GreedyOfflineRankerLeakageReport {
  const development = splitConfigs.find((config) => config.split === "development")!;
  const holdout = splitConfigs.find((config) => config.split === "holdout")!;
  const greedyOverlap = intersection(development.greedyCaseNames, holdout.greedyCaseNames);
  return {
    developmentGreedyCases: [...development.greedyCaseNames],
    holdoutGreedyCases: [...holdout.greedyCaseNames],
    greedyOverlap,
    protectedHoldout: greedyOverlap.length === 0,
  };
}

function assertProtectedGreedyHoldout(leakage: GreedyOfflineRankerLeakageReport): void {
  if (!leakage.protectedHoldout) {
    throw new Error(`Greedy offline ranker development/holdout split overlap is not allowed. Greedy: ${leakage.greedyOverlap.join(", ")}`);
  }
}

function normalizeTrainingOptions(
  options: GreedyOfflineRankerTrainingOptions | undefined
): Required<GreedyOfflineRankerTrainingOptions> {
  return {
    epochs: positiveIntegerOrDefault(options?.epochs, DEFAULT_GREEDY_OFFLINE_RANKER_TRAINING.epochs),
    learningRate: positiveFiniteNumberOrDefault(
      options?.learningRate,
      DEFAULT_GREEDY_OFFLINE_RANKER_TRAINING.learningRate
    ),
    marginWeightCap: positiveFiniteNumberOrDefault(
      options?.marginWeightCap,
      DEFAULT_GREEDY_OFFLINE_RANKER_TRAINING.marginWeightCap
    ),
  };
}

function numericFeature(
  placement: GreedyOrderingPlacementFeatures,
  key: keyof GreedyOrderingPlacementFeatures
): number {
  const value = placement[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function placementArea(placement: GreedyOrderingPlacementFeatures): number {
  return numericFeature(placement, "rows") * numericFeature(placement, "cols");
}

function placementSignalVector(placement: GreedyOrderingPlacementFeatures): FeatureVector {
  return {
    lowerRoadCost: -numericFeature(placement, "roadCost") / 10,
    higherScore: numericFeature(placement, "score") / 100,
    lowerShadowPenalty: -numericFeature(placement, "shadowPenalty") / 20,
    higherReachableBefore: numericFeature(placement, "reachableBefore") / 50,
    higherReachableAfter: numericFeature(placement, "reachableAfter") / 50,
    lowerLostCells: -numericFeature(placement, "lostCells") / 50,
    lowerFootprintCells: -numericFeature(placement, "footprintCells") / 20,
    lowerDisconnectedCells: -numericFeature(placement, "disconnectedCells") / 50,
    higherBonus: numericFeature(placement, "bonus") / 200,
    higherRange: numericFeature(placement, "range") / 10,
    smallerArea: -placementArea(placement) / 20,
    lowerTypeIndex: -numericFeature(placement, "typeIndex") / 10,
  };
}

function pairFeatureVector(label: GreedyOrderingLabel): number[] {
  const selected = placementSignalVector(label.selected);
  const rejected = placementSignalVector(label.rejected);
  return GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((featureName) => selected[featureName] - rejected[featureName]);
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

function marginWeight(label: GreedyOrderingLabel, cap: number): number {
  return Math.min(cap, Math.max(1, Math.abs(label.margin || 1))) / cap;
}

function featureWeightsRecord(weights: readonly number[]): Record<GreedyOfflineRankerFeatureName, number> {
  return Object.fromEntries(
    GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((featureName, index) => [featureName, roundMetric(weights[index] ?? 0)])
  ) as Record<GreedyOfflineRankerFeatureName, number>;
}

function weightArrayFromRecord(weights: Record<GreedyOfflineRankerFeatureName, number>): number[] {
  return GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((featureName) => weights[featureName]);
}

function scoreWithWeights(label: GreedyOrderingLabel, weights: readonly number[]): number {
  return dot(pairFeatureVector(label), weights);
}

function sourceMetrics(
  labels: readonly GreedyOrderingLabel[],
  scorePair: (label: GreedyOrderingLabel) => number
): GreedyOfflineRankerSourceMetrics[] {
  return (Object.keys(emptySourceCounts()) as GreedyOrderingLabelSource[]).map((source) => ({
    source,
    ...evaluatePairMetrics(labels.filter((label) => label.source === source), scorePair),
  }));
}

function evaluatePairMetrics(
  labels: readonly GreedyOrderingLabel[],
  scorePair: (label: GreedyOrderingLabel) => number
): GreedyOfflineRankerPairMetrics {
  let correctScore = 0;
  let marginWeightedCorrect = 0;
  let marginWeightedTotal = 0;
  for (const label of labels) {
    const score = scorePair(label);
    const correctness = score > 0 ? 1 : score === 0 ? 0.5 : 0;
    const weight = Math.max(1, Math.abs(label.margin || 1));
    correctScore += correctness;
    marginWeightedCorrect += correctness * weight;
    marginWeightedTotal += weight;
  }
  return {
    labelCount: labels.length,
    correctScore: roundMetric(correctScore),
    accuracy: labels.length === 0 ? 0 : roundMetric(correctScore / labels.length),
    marginWeightedCorrect: roundMetric(marginWeightedCorrect),
    marginWeightedTotal: roundMetric(marginWeightedTotal),
    marginWeightedAccuracy: marginWeightedTotal === 0 ? 0 : roundMetric(marginWeightedCorrect / marginWeightedTotal),
  };
}

function evaluateSplit(
  split: GreedyOrderingLabelSplitResult,
  scorePair: (label: GreedyOrderingLabel) => number
): GreedyOfflineRankerSplitEvaluation {
  return {
    split: split.split,
    ...evaluatePairMetrics(split.labels, scorePair),
    sourceMetrics: sourceMetrics(split.labels, scorePair),
  };
}

function splitByName(
  splits: readonly GreedyOrderingLabelSplitResult[],
  split: LearnedRankingLabelSplit
): GreedyOrderingLabelSplitResult {
  const entry = splits.find((candidate) => candidate.split === split);
  if (!entry) {
    throw new Error(`Greedy offline ranker missing ${split} split.`);
  }
  return entry;
}

function evaluateModel(
  splits: readonly GreedyOrderingLabelSplitResult[],
  weights: readonly number[]
): GreedyOfflineRankerExperimentResult["evaluation"]["model"] {
  const scorePair = (label: GreedyOrderingLabel) => scoreWithWeights(label, weights);
  return {
    development: evaluateSplit(splitByName(splits, "development"), scorePair),
    holdout: evaluateSplit(splitByName(splits, "holdout"), scorePair),
  };
}

function trainLinearPairwiseModel(
  developmentLabels: readonly GreedyOrderingLabel[],
  training: Required<GreedyOfflineRankerTrainingOptions>
): {
  weights: number[];
  epochs: GreedyOfflineRankerEpochSummary[];
} {
  const weights = GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map(() => 0);
  const epochs: GreedyOfflineRankerEpochSummary[] = [];
  for (let epoch = 0; epoch < training.epochs; epoch++) {
    let mistakes = 0;
    for (const label of developmentLabels) {
      const features = pairFeatureVector(label);
      if (dot(features, weights) > 0) continue;
      const update = training.learningRate * marginWeight(label, training.marginWeightCap);
      for (let index = 0; index < weights.length; index++) {
        weights[index] += update * features[index];
      }
      mistakes++;
    }
    epochs.push({
      epoch: epoch + 1,
      mistakes,
      developmentAccuracy: evaluatePairMetrics(
        developmentLabels,
        (label) => scoreWithWeights(label, weights)
      ).accuracy,
    });
  }
  return { weights, epochs };
}

function deterministicBaselineScore(label: GreedyOrderingLabel): number {
  const features = pairFeatureVector(label);
  return GREEDY_OFFLINE_RANKER_FEATURE_NAMES.reduce(
    (score, featureName, index) => score + features[index] * (DETERMINISTIC_BASELINE_WEIGHTS[featureName] ?? 0),
    0
  );
}

function stableRandomBaselineScore(label: GreedyOrderingLabel, seed: number): number {
  const hash = Number.parseInt(hashString(`${seed}:${label.id}`), 16);
  return hash % 2 === 0 ? 1 : -1;
}

function singleFeatureScore(label: GreedyOrderingLabel, featureName: GreedyOfflineRankerFeatureName): number {
  const featureIndex = GREEDY_OFFLINE_RANKER_FEATURE_NAMES.indexOf(featureName);
  return pairFeatureVector(label)[featureIndex] ?? 0;
}

function baselineEvaluation(
  name: GreedyOfflineRankerBaselineEvaluation["name"],
  description: string,
  selectedFeatureName: GreedyOfflineRankerFeatureName | null,
  splits: readonly GreedyOrderingLabelSplitResult[],
  scorePair: (label: GreedyOrderingLabel) => number
): GreedyOfflineRankerBaselineEvaluation {
  return {
    name,
    description,
    selectedFeatureName,
    development: evaluateSplit(splitByName(splits, "development"), scorePair),
    holdout: evaluateSplit(splitByName(splits, "holdout"), scorePair),
  };
}

function buildBaselineEvaluations(
  splits: readonly GreedyOrderingLabelSplitResult[],
  randomBaselineSeed: number
): GreedyOfflineRankerBaselineEvaluation[] {
  const singleFeatureCandidates = GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((featureName) =>
    baselineEvaluation(
      "best-single-feature",
      `Single feature selected by development accuracy: ${featureName}.`,
      featureName,
      splits,
      (label) => singleFeatureScore(label, featureName)
    )
  );
  const bestSingleFeature = [...singleFeatureCandidates].sort((left, right) =>
    right.development.accuracy - left.development.accuracy
    || left.selectedFeatureName!.localeCompare(right.selectedFeatureName!)
  )[0];

  return [
    baselineEvaluation(
      "deterministic-proxy",
      "Hand-written weighted proxy over the same placement features.",
      null,
      splits,
      deterministicBaselineScore
    ),
    baselineEvaluation(
      "stable-random",
      "Stable pseudo-random ordering keyed by label id.",
      null,
      splits,
      (label) => stableRandomBaselineScore(label, randomBaselineSeed)
    ),
    bestSingleFeature,
  ];
}

function buildSummary(
  modelEvaluation: GreedyOfflineRankerExperimentResult["evaluation"]["model"],
  baselines: readonly GreedyOfflineRankerBaselineEvaluation[],
  leakage: GreedyOfflineRankerLeakageReport
): GreedyOfflineRankerSummary {
  const bestBaseline = [...baselines].sort((left, right) =>
    right.holdout.accuracy - left.holdout.accuracy
    || left.name.localeCompare(right.name)
  )[0];
  const failedReasons: string[] = [];
  if (!leakage.protectedHoldout) {
    failedReasons.push("development/holdout Greedy cases overlap");
  }
  if (modelEvaluation.development.labelCount === 0) {
    failedReasons.push("development label count is zero");
  }
  if (modelEvaluation.holdout.labelCount === 0) {
    failedReasons.push("holdout label count is zero");
  }
  if (modelEvaluation.holdout.accuracy <= bestBaseline.holdout.accuracy) {
    failedReasons.push(
      `holdout accuracy ${modelEvaluation.holdout.accuracy.toFixed(4)} does not beat best baseline ${bestBaseline.name} ${bestBaseline.holdout.accuracy.toFixed(4)}`
    );
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    bestBaselineName: bestBaseline.name,
    bestBaselineHoldoutAccuracy: bestBaseline.holdout.accuracy,
    modelHoldoutAccuracy: modelEvaluation.holdout.accuracy,
    holdoutAccuracyDeltaVsBestBaseline: roundMetric(modelEvaluation.holdout.accuracy - bestBaseline.holdout.accuracy),
  };
}

function collectGreedyLabelSplits(options: {
  splitConfigs: readonly LearnedRankingLabelSplitConfig[];
  seeds: readonly number[];
  greedyCorpus: readonly GreedyBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
}): GreedyOrderingLabelSplitResult[] {
  return options.splitConfigs.map((config): GreedyOrderingLabelSplitResult => {
    const labels = options.seeds.flatMap((seed) => {
      const result = runGreedyBenchmarkSuite(options.greedyCorpus, {
        names: [...config.greedyCaseNames],
        greedy: {
          ...(options.greedy ?? {}),
          profile: true,
          connectivityShadowScoring: true,
          randomSeed: seed,
        },
      });
      return collectGreedyOrderingLabelsFromBenchmarkSuite(result, config.split, seed);
    });
    return {
      split: config.split,
      selectedCaseNames: [...config.greedyCaseNames],
      seeds: [...options.seeds],
      labelCount: labels.length,
      sourceCounts: countSources(labels),
      labels,
    };
  });
}

function labelSplitSummaries(
  splits: readonly GreedyOrderingLabelSplitResult[]
): GreedyOfflineRankerLabelSplitSummary[] {
  return splits.map((split) => ({
    split: split.split,
    selectedCaseNames: [...split.selectedCaseNames],
    seeds: [...split.seeds],
    labelCount: split.labelCount,
    sourceCounts: { ...split.sourceCounts },
  }));
}

function buildDatasetFingerprint(splits: readonly GreedyOrderingLabelSplitResult[]): string {
  return `fnv1a:${hashString(stableStringify(splits.map((split) => ({
    split: split.split,
    selectedCaseNames: split.selectedCaseNames,
    seeds: split.seeds,
    labels: split.labels,
  }))))}`;
}

function summaryMetrics(result: GreedyOfflineRankerExperimentResult): Record<string, unknown> {
  return {
    passed: result.evaluation.summary.passed,
    developmentModelAccuracy: result.evaluation.model.development.accuracy,
    holdoutModelAccuracy: result.evaluation.model.holdout.accuracy,
    bestBaselineName: result.evaluation.summary.bestBaselineName,
    bestBaselineHoldoutAccuracy: result.evaluation.summary.bestBaselineHoldoutAccuracy,
    holdoutAccuracyDeltaVsBestBaseline: result.evaluation.summary.holdoutAccuracyDeltaVsBestBaseline,
    developmentLabelCount: result.evaluation.model.development.labelCount,
    holdoutLabelCount: result.evaluation.model.holdout.labelCount,
    protectedHoldout: result.leakage.protectedHoldout,
  };
}

function modelRecord(model: GreedyOfflineRankerModel): Record<string, unknown> {
  return model as unknown as Record<string, unknown>;
}

export function runGreedyOfflineRankerExperiment(
  options: GreedyOfflineRankerRunOptions = {}
): GreedyOfflineRankerExperimentResult {
  const splitConfigs = options.splitConfigs ?? DEFAULT_LEARNED_RANKING_LABEL_SPLITS;
  validateGreedySplitConfigs(splitConfigs);
  const leakage = buildGreedyLeakageReport(splitConfigs);
  assertProtectedGreedyHoldout(leakage);
  const seeds = normalizeBenchmarkSeeds(options.seeds, "Greedy offline ranker seeds")
    ?? [...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS];
  const greedyCorpus = options.greedyCorpus ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS;
  const training = normalizeTrainingOptions(options.training);
  const splits = collectGreedyLabelSplits({
    splitConfigs,
    seeds,
    greedyCorpus,
    greedy: options.greedy,
  });
  const developmentLabels = splitByName(splits, "development").labels;
  const startedAtMs = performance.now();
  const trained = trainLinearPairwiseModel(developmentLabels, training);
  const trainingWallClockSeconds = (performance.now() - startedAtMs) / 1000;
  const weights = featureWeightsRecord(trained.weights);
  const model: GreedyOfflineRankerModel = {
    schemaVersion: 1,
    modelType: "greedy-linear-pairwise-perceptron",
    purpose: "offline-diagnostics-only",
    trained: true,
    featureNames: [...GREEDY_OFFLINE_RANKER_FEATURE_NAMES],
    weights,
    intercept: 0,
    training,
    trainedLabelCount: developmentLabels.length,
    trainingSplit: "development",
  };
  const modelEvaluation = evaluateModel(splits, weightArrayFromRecord(weights));
  const baselines = buildBaselineEvaluations(splits, options.randomBaselineSeed ?? 17);
  const datasetFingerprint = buildDatasetFingerprint(splits);
  const modelFingerprint = buildModelExperimentFingerprint(model);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...seeds],
    splitCount: splitConfigs.length,
    audit: {
      cpuOnly: true,
      runtimeDefaultChanged: false,
      solverDefaultChanged: false,
      usesCaseNameFeature: false,
      learnedRuntimeHook: null,
    },
    labels: {
      labelCount: sumBenchmarkBy(splits, (split) => split.labelCount),
      sourceCounts: sumSourceCounts(splits),
      splits: labelSplitSummaries(splits),
    },
    leakage,
    training: {
      wallClockSeconds: trainingWallClockSeconds,
      epochs: trained.epochs,
    },
    model,
    evaluation: {
      model: modelEvaluation,
      baselines,
      summary: buildSummary(modelEvaluation, baselines, leakage),
    },
    datasetFingerprint,
    modelFingerprint,
  };
}

export function createGreedyOfflineRankerSnapshot(
  result: GreedyOfflineRankerExperimentResult
): GreedyOfflineRankerExperimentSnapshot {
  const { generatedAt: _generatedAt, training, ...snapshot } = result;
  const { wallClockSeconds: _wallClockSeconds, ...stableTraining } = training;
  return {
    ...snapshot,
    training: stableTraining,
  };
}

export function buildGreedyOfflineRankerTelemetryManifest(
  result: GreedyOfflineRankerExperimentResult,
  options: GreedyOfflineRankerTelemetryManifestOptions
): ModelExperimentTelemetryManifest {
  return buildModelExperimentTelemetryManifest({
    command: options.command,
    generatedAt: result.generatedAt,
    git: options.git,
    hardware: options.hardware,
    model: modelRecord(result.model),
    inputArtifacts: options.inputArtifacts,
    outputArtifacts: options.outputArtifacts,
    datasetFingerprint: result.datasetFingerprint,
    modelFingerprint: result.modelFingerprint,
    metrics: summaryMetrics(result),
    notes: options.notes ?? "CPU-first Greedy offline ranker diagnostics only; no solver default changed.",
  });
}

export function buildGreedyOfflineRankerRegistryEntryDraft(
  result: GreedyOfflineRankerExperimentResult,
  options: GreedyOfflineRankerRegistryEntryDraftOptions
): Record<string, unknown> {
  return buildModelExperimentRegistryEntryDraft({
    runId: options.runId,
    generatedAt: result.generatedAt,
    commands: options.commands,
    artifactPaths: options.artifactPaths,
    cases: {
      development: [...result.leakage.developmentGreedyCases],
      holdout: [...result.leakage.holdoutGreedyCases],
    },
    caseFamilies: [
      "greedy-connectivity-shadow",
      "greedy-road-opportunity",
    ],
    seeds: result.seeds,
    splitStatus: {
      protectedHoldout: result.leakage.protectedHoldout,
      leakage: result.leakage,
      usesCaseNameFeature: result.audit.usesCaseNameFeature,
    },
    budget: {
      cpuOnly: 1,
      trainingEpochs: result.model.training.epochs,
      trainingLearningRate: result.model.training.learningRate,
      trainingMarginWeightCap: result.model.training.marginWeightCap,
      trainingWallClockSeconds: roundMetric(result.training.wallClockSeconds),
      developmentLabelCount: result.evaluation.model.development.labelCount,
      holdoutLabelCount: result.evaluation.model.holdout.labelCount,
    },
    model: modelRecord(result.model),
    decision: options.decision ?? (
      result.evaluation.summary.passed
        ? "offline-greedy-ranker-beats-baselines"
        : "offline-greedy-ranker-insufficient"
    ),
    summary: options.summary ?? (
      result.evaluation.summary.passed
        ? `CPU-first Greedy offline ranker beat deterministic, random, and single-feature baselines by ${result.evaluation.summary.holdoutAccuracyDeltaVsBestBaseline.toFixed(4)} holdout accuracy.`
        : `CPU-first Greedy offline ranker did not clear the offline gate: ${result.evaluation.summary.failedReasons.join("; ")}.`
    ),
    datasetFingerprint: result.datasetFingerprint,
    modelFingerprint: result.modelFingerprint,
    summaryMetrics: summaryMetrics(result),
  });
}

function formatMetric(metrics: GreedyOfflineRankerPairMetrics): string {
  return `${metrics.accuracy.toFixed(4)} (${metrics.correctScore}/${metrics.labelCount})`;
}

export function formatGreedyOfflineRankerExperiment(result: GreedyOfflineRankerExperimentResult): string {
  const lines: string[] = [];
  lines.push("=== CPU-First Greedy Offline Ranker ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(
    `Audit: cpu-only=${result.audit.cpuOnly} runtime-default-changed=${result.audit.runtimeDefaultChanged} case-name-feature=${result.audit.usesCaseNameFeature}`
  );
  lines.push(
    `Labels: total=${result.labels.labelCount} development=${result.evaluation.model.development.labelCount} holdout=${result.evaluation.model.holdout.labelCount} connectivity-shadow=${result.labels.sourceCounts["connectivity-shadow-decision"]} road-opportunity=${result.labels.sourceCounts["road-opportunity-counterfactual"]}`
  );
  lines.push(
    `Leakage: protected-holdout=${result.leakage.protectedHoldout} greedy-overlap=${result.leakage.greedyOverlap.length ? result.leakage.greedyOverlap.join(", ") : "none"}`
  );
  lines.push(
    `Model: ${result.model.modelType} features=${result.model.featureNames.length} epochs=${result.model.training.epochs} trained-labels=${result.model.trainedLabelCount} model-fingerprint=${result.modelFingerprint}`
  );
  lines.push(
    `Model accuracy: development=${formatMetric(result.evaluation.model.development)} holdout=${formatMetric(result.evaluation.model.holdout)} margin-weighted-holdout=${result.evaluation.model.holdout.marginWeightedAccuracy.toFixed(4)}`
  );
  for (const baseline of result.evaluation.baselines) {
    lines.push(
      `- baseline ${baseline.name}${baseline.selectedFeatureName ? ` feature=${baseline.selectedFeatureName}` : ""}: development=${formatMetric(baseline.development)} holdout=${formatMetric(baseline.holdout)}`
    );
  }
  lines.push(
    `Gate: passed=${result.evaluation.summary.passed} best-baseline=${result.evaluation.summary.bestBaselineName} holdout-delta=${result.evaluation.summary.holdoutAccuracyDeltaVsBestBaseline.toFixed(4)} failures=${result.evaluation.summary.failedReasons.length ? result.evaluation.summary.failedReasons.join("; ") : "none"}`
  );
  lines.push("Decision: offline diagnostics only; no Greedy runtime scorer or solver default changed.");
  return lines.join("\n");
}
