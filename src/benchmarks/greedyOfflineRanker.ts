import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  benchmarkGeneratedAt,
  formatBenchmarkRate,
  meanBenchmarkValue,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import {
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
} from "./greedyDeterministicAblations.js";
import {
  collectGreedyOrderingLabelsFromBenchmarkSuite,
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
} from "./learnedRankingLabels.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";

import type { GreedyBenchmarkCase, GreedyBenchmarkOptions } from "./greedy.js";
import type {
  GreedyOrderingLabel,
  GreedyOrderingLabelSource,
  GreedyOrderingLabelSplitResult,
  GreedyOrderingPlacementFeatures,
  LearnedRankingLabelSplit,
  LearnedRankingLabelSplitConfig,
  LearnedRankingLeakageReport,
} from "./learnedRankingLabels.js";

export type GreedyOfflineRankerBaselineName =
  | "cpu-linear-ranker"
  | "deterministic-feature-proxy"
  | "random-hash"
  | "best-single-feature";

export type GreedyOfflineRankerSingleFeatureDirection = "higher" | "lower";

export interface GreedyOfflineRankerRunOptions {
  seeds?: readonly number[];
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[];
  greedyCorpus?: readonly GreedyBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
  labels?: readonly GreedyOrderingLabel[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
  inferenceRepeats?: number;
}

export interface GreedyOfflineRankerSplitSummary {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  seeds: number[];
  labelCount: number;
  sourceCounts: Record<GreedyOrderingLabelSource, number>;
}

export interface GreedyOfflineRankerLabelSummary {
  labelCount: number;
  sourceCounts: Record<GreedyOrderingLabelSource, number>;
  splits: GreedyOfflineRankerSplitSummary[];
  labelFingerprint: string;
}

export interface GreedyOfflineRankerFeatureScale {
  featureName: string;
  rms: number;
}

export interface GreedyOfflineRankerModel {
  kind: "pairwise-linear";
  trainedOnSplit: "development";
  cpuOnly: true;
  featureNames: string[];
  featureScale: GreedyOfflineRankerFeatureScale[];
  weights: number[];
  epochs: number;
  learningRate: number;
  l2: number;
  trainingPairCount: number;
  modelFingerprint: string;
}

export interface GreedyOfflineRankerSourceMetric {
  labelCount: number;
  accuracy: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface GreedyOfflineRankerMetric {
  split: LearnedRankingLabelSplit;
  labelCount: number;
  accuracy: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  lossRate: number;
  tieRate: number;
  meanSignedScoreMargin: number;
  sourceMetrics: Record<GreedyOrderingLabelSource, GreedyOfflineRankerSourceMetric>;
}

export interface GreedyOfflineRankerBaselineReport {
  name: GreedyOfflineRankerBaselineName;
  description: string;
  development: GreedyOfflineRankerMetric;
  holdout: GreedyOfflineRankerMetric;
  selectedFeatureName?: string;
  selectedFeatureDirection?: GreedyOfflineRankerSingleFeatureDirection;
}

export interface GreedyOfflineRankerGateComparison {
  baselineName: GreedyOfflineRankerBaselineName;
  holdoutAccuracyDelta: number;
}

export interface GreedyOfflineRankerGate {
  passed: boolean;
  failedReasons: string[];
  protectedHoldout: boolean;
  requiredBaselines: GreedyOfflineRankerBaselineName[];
  comparisons: GreedyOfflineRankerGateComparison[];
}

export interface GreedyOfflineRankerInferenceTiming {
  holdoutPairCount: number;
  repeatCount: number;
  totalPairScores: number;
  elapsedMs: number;
  microsecondsPerPair: number;
  checksum: number;
}

export interface GreedyOfflineRankerExperimentResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  splitCount: number;
  audit: {
    cpuOnly: true;
    runtimeIntegration: false;
    solverDefaultsChanged: false;
    trainingTarget: "greedy-pairwise-placement-ordering";
  };
  labels: GreedyOfflineRankerLabelSummary;
  leakage: LearnedRankingLeakageReport;
  model: GreedyOfflineRankerModel;
  modelMetrics: {
    development: GreedyOfflineRankerMetric;
    holdout: GreedyOfflineRankerMetric;
  };
  baselines: GreedyOfflineRankerBaselineReport[];
  gate: GreedyOfflineRankerGate;
  inference: GreedyOfflineRankerInferenceTiming;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: "offline-diagnostics-only";
  summary: string;
}

export interface GreedyOfflineRankerSnapshot
  extends Omit<GreedyOfflineRankerExperimentResult, "generatedAt"> {}

type GreedyOfflineRankerBaseFeatureName =
  | "r"
  | "c"
  | "rows"
  | "cols"
  | "area"
  | "roadCost"
  | "score"
  | "shadowPenalty"
  | "reachableBefore"
  | "reachableAfter"
  | "reachableDelta"
  | "lostCells"
  | "footprintCells"
  | "disconnectedCells"
  | "lostPerFootprint"
  | "disconnectedPerFootprint"
  | "typeIndex"
  | "bonus"
  | "range";

interface PairwiseExample {
  label: GreedyOrderingLabel;
  rawDiff: number[];
  scaledDiff: number[];
}

const GREEDY_OFFLINE_RANKER_BASE_FEATURE_NAMES: readonly GreedyOfflineRankerBaseFeatureName[] = [
  "r",
  "c",
  "rows",
  "cols",
  "area",
  "roadCost",
  "score",
  "shadowPenalty",
  "reachableBefore",
  "reachableAfter",
  "reachableDelta",
  "lostCells",
  "footprintCells",
  "disconnectedCells",
  "lostPerFootprint",
  "disconnectedPerFootprint",
  "typeIndex",
  "bonus",
  "range",
] as const;

const GREEDY_OFFLINE_RANKER_CONTEXT_NAMES: readonly string[] = [
  "all",
  "source:connectivity-shadow-decision",
  "source:road-opportunity-counterfactual",
  "target:lower-connectivity-shadow",
  "target:accepted-near-miss",
] as const;

export const GREEDY_OFFLINE_RANKER_FEATURE_NAMES: readonly string[] =
  Object.freeze(GREEDY_OFFLINE_RANKER_CONTEXT_NAMES.flatMap((context) =>
    GREEDY_OFFLINE_RANKER_BASE_FEATURE_NAMES.map((feature) => `${context}:${feature}`)
  ));

const DEFAULT_GREEDY_OFFLINE_RANKER_EPOCHS = 200;
const DEFAULT_GREEDY_OFFLINE_RANKER_LEARNING_RATE = 0.05;
const DEFAULT_GREEDY_OFFLINE_RANKER_L2 = 0.0001;
const DEFAULT_GREEDY_OFFLINE_RANKER_INFERENCE_REPEATS = 100;

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function placementFeatureValue(
  placement: GreedyOrderingPlacementFeatures,
  featureName: GreedyOfflineRankerBaseFeatureName
): number {
  switch (featureName) {
    case "area":
      return finiteOrZero(placement.rows) * finiteOrZero(placement.cols);
    case "reachableDelta":
      return finiteOrZero(placement.reachableAfter) - finiteOrZero(placement.reachableBefore);
    case "lostPerFootprint":
      return finiteOrZero(placement.lostCells) / Math.max(1, finiteOrZero(placement.footprintCells));
    case "disconnectedPerFootprint":
      return finiteOrZero(placement.disconnectedCells) / Math.max(1, finiteOrZero(placement.footprintCells));
    default:
      return finiteOrZero(placement[featureName]);
  }
}

function contextApplies(label: GreedyOrderingLabel, contextName: string): boolean {
  return contextName === "all"
    || contextName === `source:${label.source}`
    || contextName === `target:${label.target}`;
}

function placementFeatureVector(label: GreedyOrderingLabel, placement: GreedyOrderingPlacementFeatures): number[] {
  const values: number[] = [];
  for (const contextName of GREEDY_OFFLINE_RANKER_CONTEXT_NAMES) {
    const active = contextApplies(label, contextName);
    for (const featureName of GREEDY_OFFLINE_RANKER_BASE_FEATURE_NAMES) {
      values.push(active ? placementFeatureValue(placement, featureName) : 0);
    }
  }
  return values;
}

function pairwiseFeatureDiff(label: GreedyOrderingLabel): number[] {
  const selected = placementFeatureVector(label, label.selected);
  const rejected = placementFeatureVector(label, label.rejected);
  return selected.map((value, index) => value - rejected[index]!);
}

function emptySourceCounts(): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": 0,
    "road-opportunity-counterfactual": 0,
  };
}

function countSources(labels: readonly GreedyOrderingLabel[]): Record<GreedyOrderingLabelSource, number> {
  const counts = emptySourceCounts();
  for (const label of labels) counts[label.source]++;
  return counts;
}

function labelSplitResultFromLabels(
  split: LearnedRankingLabelSplit,
  labels: readonly GreedyOrderingLabel[]
): GreedyOrderingLabelSplitResult {
  return {
    split,
    selectedCaseNames: uniqueBenchmarkValuesBy(labels, (label) => label.caseName),
    seeds: uniqueBenchmarkValues(labels.map((label) => label.seed)).sort((left, right) => left - right),
    labelCount: labels.length,
    sourceCounts: countSources(labels),
    labels: [...labels],
  };
}

function labelSplitsFromLabels(labels: readonly GreedyOrderingLabel[]): GreedyOrderingLabelSplitResult[] {
  return [
    labelSplitResultFromLabels("development", labels.filter((label) => label.split === "development")),
    labelSplitResultFromLabels("holdout", labels.filter((label) => label.split === "holdout")),
  ];
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return uniqueBenchmarkValues(left.filter((value) => rightSet.has(value)));
}

function buildLeakageReportFromSplits(
  splits: readonly GreedyOrderingLabelSplitResult[],
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[]
): LearnedRankingLeakageReport {
  const developmentGreedyCases = splitConfigs
    ?.find((config) => config.split === "development")
    ?.greedyCaseNames
    ?? splits.find((split) => split.split === "development")?.selectedCaseNames
    ?? [];
  const holdoutGreedyCases = splitConfigs
    ?.find((config) => config.split === "holdout")
    ?.greedyCaseNames
    ?? splits.find((split) => split.split === "holdout")?.selectedCaseNames
    ?? [];
  const developmentLnsCases = splitConfigs
    ?.find((config) => config.split === "development")
    ?.lnsCaseNames
    ?? [];
  const holdoutLnsCases = splitConfigs
    ?.find((config) => config.split === "holdout")
    ?.lnsCaseNames
    ?? [];
  const greedyOverlap = intersection(developmentGreedyCases, holdoutGreedyCases);
  const lnsOverlap = intersection(developmentLnsCases, holdoutLnsCases);
  return {
    developmentGreedyCases: [...developmentGreedyCases],
    holdoutGreedyCases: [...holdoutGreedyCases],
    developmentLnsCases: [...developmentLnsCases],
    holdoutLnsCases: [...holdoutLnsCases],
    greedyOverlap,
    lnsOverlap,
    protectedHoldout: greedyOverlap.length === 0 && lnsOverlap.length === 0,
  };
}

function collectDefaultGreedyLabelSplits(
  options: GreedyOfflineRankerRunOptions
): {
  seeds: number[];
  splitConfigs: readonly LearnedRankingLabelSplitConfig[];
  splits: GreedyOrderingLabelSplitResult[];
} {
  const seeds = normalizeBenchmarkSeeds(options.seeds, "greedy offline ranker seeds")
    ?? [...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS];
  const splitConfigs = options.splitConfigs ?? DEFAULT_LEARNED_RANKING_LABEL_SPLITS;
  const greedyCorpus = options.greedyCorpus ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS;
  const splits: GreedyOrderingLabelSplitResult[] = [];

  for (const config of splitConfigs) {
    const labels = seeds.flatMap((seed) => {
      const result = runGreedyBenchmarkSuite(greedyCorpus, {
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
    splits.push({
      split: config.split,
      selectedCaseNames: [...config.greedyCaseNames],
      seeds: [...seeds],
      labelCount: labels.length,
      sourceCounts: countSources(labels),
      labels,
    });
  }

  return { seeds, splitConfigs, splits };
}

function resolveLabelData(options: GreedyOfflineRankerRunOptions): {
  seeds: number[];
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[];
  splits: GreedyOrderingLabelSplitResult[];
  leakage: LearnedRankingLeakageReport;
} {
  if (options.labels !== undefined) {
    const splits = labelSplitsFromLabels(options.labels);
    const seeds = options.seeds === undefined
      ? uniqueBenchmarkValues(options.labels.map((label) => label.seed)).sort((left, right) => left - right)
      : [...options.seeds];
    return {
      seeds,
      splits,
      leakage: buildLeakageReportFromSplits(splits, options.splitConfigs),
    };
  }

  const collected = collectDefaultGreedyLabelSplits(options);
  return {
    ...collected,
    leakage: buildLeakageReportFromSplits(collected.splits, collected.splitConfigs),
  };
}

function flattenSplitLabels(
  splits: readonly GreedyOrderingLabelSplitResult[],
  splitName: LearnedRankingLabelSplit
): GreedyOrderingLabel[] {
  return splits
    .filter((split) => split.split === splitName)
    .flatMap((split) => split.labels);
}

function fingerprintValue(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildLabelFingerprint(labels: readonly GreedyOrderingLabel[]): string {
  return fingerprintValue(labels.map((label) => ({
    id: label.id,
    split: label.split,
    caseName: label.caseName,
    seed: label.seed,
    source: label.source,
    target: label.target,
    selected: label.selected,
    rejected: label.rejected,
    margin: label.margin,
    reason: label.reason ?? null,
  })));
}

function dot(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index]! * right[index]!;
  }
  return total;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function computeRmsFeatureScale(labels: readonly GreedyOrderingLabel[]): number[] {
  const diffs = labels.map(pairwiseFeatureDiff);
  return GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((_, featureIndex) => {
    const rms = Math.sqrt(meanBenchmarkValue(diffs.map((diff) => diff[featureIndex]! ** 2)));
    return rms > 0 ? rms : 1;
  });
}

function scaledDiff(diff: readonly number[], scale: readonly number[]): number[] {
  return diff.map((value, index) => value / scale[index]!);
}

function buildExamples(
  labels: readonly GreedyOrderingLabel[],
  scale: readonly number[]
): PairwiseExample[] {
  return labels.map((label) => {
    const rawDiff = pairwiseFeatureDiff(label);
    return {
      label,
      rawDiff,
      scaledDiff: scaledDiff(rawDiff, scale),
    };
  });
}

function trainLinearRanker(
  developmentLabels: readonly GreedyOrderingLabel[],
  epochs: number,
  learningRate: number,
  l2: number
): GreedyOfflineRankerModel {
  if (developmentLabels.length === 0) {
    throw new Error("Greedy offline ranker requires at least one development label.");
  }
  const scale = computeRmsFeatureScale(developmentLabels);
  const examples = buildExamples(developmentLabels, scale);
  const weights = GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map(() => 0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const epochLearningRate = learningRate / (1 + epoch * 0.02);
    const order = examples
      .map((example, index) => ({ example, index }))
      .sort((left, right) =>
        hashString(`${epoch}:${left.example.label.id}:${left.index}`)
        - hashString(`${epoch}:${right.example.label.id}:${right.index}`)
      );
    for (const { example } of order) {
      const probability = sigmoid(dot(weights, example.scaledDiff));
      const gradientScale = probability - 1;
      for (let index = 0; index < weights.length; index += 1) {
        weights[index] -= epochLearningRate * (
          gradientScale * example.scaledDiff[index]!
          + l2 * weights[index]!
        );
      }
    }
  }

  const modelCore = {
    kind: "pairwise-linear" as const,
    trainedOnSplit: "development" as const,
    cpuOnly: true as const,
    featureNames: [...GREEDY_OFFLINE_RANKER_FEATURE_NAMES],
    featureScale: GREEDY_OFFLINE_RANKER_FEATURE_NAMES.map((featureName, index) => ({
      featureName,
      rms: scale[index]!,
    })),
    weights,
    epochs,
    learningRate,
    l2,
    trainingPairCount: developmentLabels.length,
  };
  return {
    ...modelCore,
    modelFingerprint: fingerprintValue(modelCore),
  };
}

function scoreLinearRanker(model: GreedyOfflineRankerModel, label: GreedyOrderingLabel): number {
  const scale = model.featureScale.map((entry) => entry.rms);
  return dot(model.weights, scaledDiff(pairwiseFeatureDiff(label), scale));
}

function sourceMetric(labels: readonly GreedyOrderingLabel[], scorer: (label: GreedyOrderingLabel) => number): GreedyOfflineRankerSourceMetric {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const label of labels) {
    const score = scorer(label);
    if (score > 1e-9) wins++;
    else if (score < -1e-9) losses++;
    else ties++;
  }
  return {
    labelCount: labels.length,
    accuracy: labels.length === 0 ? 0 : (wins + 0.5 * ties) / labels.length,
    wins,
    losses,
    ties,
  };
}

function evaluateScorer(
  split: LearnedRankingLabelSplit,
  labels: readonly GreedyOrderingLabel[],
  scorer: (label: GreedyOrderingLabel) => number
): GreedyOfflineRankerMetric {
  const metric = sourceMetric(labels, scorer);
  const sourceMetrics: Record<GreedyOrderingLabelSource, GreedyOfflineRankerSourceMetric> = {
    "connectivity-shadow-decision": sourceMetric(
      labels.filter((label) => label.source === "connectivity-shadow-decision"),
      scorer
    ),
    "road-opportunity-counterfactual": sourceMetric(
      labels.filter((label) => label.source === "road-opportunity-counterfactual"),
      scorer
    ),
  };
  return {
    split,
    ...metric,
    winRate: labels.length === 0 ? 0 : metric.wins / labels.length,
    lossRate: labels.length === 0 ? 0 : metric.losses / labels.length,
    tieRate: labels.length === 0 ? 0 : metric.ties / labels.length,
    meanSignedScoreMargin: labels.length === 0 ? 0 : meanBenchmarkValue(labels.map(scorer)),
    sourceMetrics,
  };
}

function deterministicProxyPlacementScore(placement: GreedyOrderingPlacementFeatures): number {
  return finiteOrZero(placement.score)
    + 0.05 * finiteOrZero(placement.reachableAfter)
    - 0.5 * finiteOrZero(placement.roadCost)
    - finiteOrZero(placement.shadowPenalty)
    - 0.25 * finiteOrZero(placement.lostCells)
    - 0.5 * finiteOrZero(placement.disconnectedCells);
}

function deterministicProxyScore(label: GreedyOrderingLabel): number {
  return deterministicProxyPlacementScore(label.selected) - deterministicProxyPlacementScore(label.rejected);
}

function randomHashScore(label: GreedyOrderingLabel): number {
  return hashString(label.id) % 2 === 0 ? 1 : -1;
}

function singleFeatureScore(
  label: GreedyOrderingLabel,
  featureName: GreedyOfflineRankerBaseFeatureName,
  direction: GreedyOfflineRankerSingleFeatureDirection
): number {
  const sign = direction === "higher" ? 1 : -1;
  return sign * (
    placementFeatureValue(label.selected, featureName)
    - placementFeatureValue(label.rejected, featureName)
  );
}

function bestSingleFeatureBaseline(
  developmentLabels: readonly GreedyOrderingLabel[]
): {
  featureName: GreedyOfflineRankerBaseFeatureName;
  direction: GreedyOfflineRankerSingleFeatureDirection;
} {
  let best: {
    featureName: GreedyOfflineRankerBaseFeatureName;
    direction: GreedyOfflineRankerSingleFeatureDirection;
    accuracy: number;
    key: string;
  } | null = null;
  for (const featureName of GREEDY_OFFLINE_RANKER_BASE_FEATURE_NAMES) {
    for (const direction of ["higher", "lower"] as const) {
      const metric = evaluateScorer(
        "development",
        developmentLabels,
        (label) => singleFeatureScore(label, featureName, direction)
      );
      const key = `${featureName}:${direction}`;
      if (
        best === null
        || metric.accuracy > best.accuracy
        || (metric.accuracy === best.accuracy && key < best.key)
      ) {
        best = { featureName, direction, accuracy: metric.accuracy, key };
      }
    }
  }
  if (best === null) {
    throw new Error("Greedy offline ranker could not select a single-feature baseline.");
  }
  return {
    featureName: best.featureName,
    direction: best.direction,
  };
}

function buildBaselineReports(
  developmentLabels: readonly GreedyOrderingLabel[],
  holdoutLabels: readonly GreedyOrderingLabel[]
): GreedyOfflineRankerBaselineReport[] {
  const singleFeature = bestSingleFeatureBaseline(developmentLabels);
  return [
    {
      name: "deterministic-feature-proxy",
      description: "Fixed CPU heuristic over score, reachability, road cost, connectivity shadow, and lost cells.",
      development: evaluateScorer("development", developmentLabels, deterministicProxyScore),
      holdout: evaluateScorer("holdout", holdoutLabels, deterministicProxyScore),
    },
    {
      name: "random-hash",
      description: "Deterministic hash baseline that picks selected or rejected with equal probability.",
      development: evaluateScorer("development", developmentLabels, randomHashScore),
      holdout: evaluateScorer("holdout", holdoutLabels, randomHashScore),
    },
    {
      name: "best-single-feature",
      description: "Best single raw feature and direction selected on development labels only.",
      development: evaluateScorer(
        "development",
        developmentLabels,
        (label) => singleFeatureScore(label, singleFeature.featureName, singleFeature.direction)
      ),
      holdout: evaluateScorer(
        "holdout",
        holdoutLabels,
        (label) => singleFeatureScore(label, singleFeature.featureName, singleFeature.direction)
      ),
      selectedFeatureName: singleFeature.featureName,
      selectedFeatureDirection: singleFeature.direction,
    },
  ];
}

function buildGate(
  leakage: LearnedRankingLeakageReport,
  developmentLabels: readonly GreedyOrderingLabel[],
  holdoutLabels: readonly GreedyOrderingLabel[],
  modelHoldout: GreedyOfflineRankerMetric,
  baselines: readonly GreedyOfflineRankerBaselineReport[]
): GreedyOfflineRankerGate {
  const requiredBaselines = baselines.map((baseline) => baseline.name);
  const failedReasons: string[] = [];
  if (!leakage.protectedHoldout) {
    failedReasons.push("development/holdout case names overlap");
  }
  if (developmentLabels.length === 0) failedReasons.push("development split has no labels");
  if (holdoutLabels.length === 0) failedReasons.push("holdout split has no labels");
  const comparisons = baselines.map((baseline) => ({
    baselineName: baseline.name,
    holdoutAccuracyDelta: modelHoldout.accuracy - baseline.holdout.accuracy,
  }));
  for (const comparison of comparisons) {
    if (comparison.holdoutAccuracyDelta <= 0) {
      failedReasons.push(`model did not beat ${comparison.baselineName} on holdout`);
    }
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    protectedHoldout: leakage.protectedHoldout,
    requiredBaselines,
    comparisons,
  };
}

function measureInferenceTiming(
  holdoutLabels: readonly GreedyOrderingLabel[],
  model: GreedyOfflineRankerModel,
  repeatCount: number
): GreedyOfflineRankerInferenceTiming {
  const start = performance.now();
  let checksum = 0;
  for (let repeat = 0; repeat < repeatCount; repeat += 1) {
    for (const label of holdoutLabels) {
      checksum += scoreLinearRanker(model, label);
    }
  }
  const elapsedMs = performance.now() - start;
  const totalPairScores = holdoutLabels.length * repeatCount;
  return {
    holdoutPairCount: holdoutLabels.length,
    repeatCount,
    totalPairScores,
    elapsedMs,
    microsecondsPerPair: totalPairScores === 0 ? 0 : (elapsedMs * 1000) / totalPairScores,
    checksum,
  };
}

function summarizeSplit(split: GreedyOrderingLabelSplitResult): GreedyOfflineRankerSplitSummary {
  return {
    split: split.split,
    selectedCaseNames: [...split.selectedCaseNames],
    seeds: [...split.seeds],
    labelCount: split.labelCount,
    sourceCounts: { ...split.sourceCounts },
  };
}

function buildLabelSummary(splits: readonly GreedyOrderingLabelSplitResult[]): GreedyOfflineRankerLabelSummary {
  const labels = splits.flatMap((split) => split.labels);
  return {
    labelCount: sumBenchmarkBy(splits, (split) => split.labelCount),
    sourceCounts: {
      "connectivity-shadow-decision": sumBenchmarkBy(splits, (split) => split.sourceCounts["connectivity-shadow-decision"]),
      "road-opportunity-counterfactual": sumBenchmarkBy(splits, (split) => split.sourceCounts["road-opportunity-counterfactual"]),
    },
    splits: splits.map(summarizeSplit),
    labelFingerprint: buildLabelFingerprint(labels),
  };
}

function summarizeResult(
  gate: GreedyOfflineRankerGate,
  modelHoldout: GreedyOfflineRankerMetric,
  baselines: readonly GreedyOfflineRankerBaselineReport[],
  inference: GreedyOfflineRankerInferenceTiming
): string {
  const baselineSummary = baselines
    .map((baseline) => `${baseline.name} ${formatBenchmarkRate(baseline.holdout.accuracy)}`)
    .join(", ");
  return `CPU linear Greedy ranker ${gate.passed ? "passed" : "failed"} offline diagnostics on protected holdout: model ${formatBenchmarkRate(modelHoldout.accuracy)} vs ${baselineSummary}; inference ${inference.microsecondsPerPair.toFixed(3)}us/pair. No runtime scorer or solver default changed.`;
}

export function runGreedyOfflineRankerExperiment(
  options: GreedyOfflineRankerRunOptions = {}
): GreedyOfflineRankerExperimentResult {
  const epochs = options.epochs ?? DEFAULT_GREEDY_OFFLINE_RANKER_EPOCHS;
  const learningRate = options.learningRate ?? DEFAULT_GREEDY_OFFLINE_RANKER_LEARNING_RATE;
  const l2 = options.l2 ?? DEFAULT_GREEDY_OFFLINE_RANKER_L2;
  const inferenceRepeats = options.inferenceRepeats ?? DEFAULT_GREEDY_OFFLINE_RANKER_INFERENCE_REPEATS;
  const data = resolveLabelData(options);
  const developmentLabels = flattenSplitLabels(data.splits, "development");
  const holdoutLabels = flattenSplitLabels(data.splits, "holdout");
  const model = trainLinearRanker(developmentLabels, epochs, learningRate, l2);
  const modelScorer = (label: GreedyOrderingLabel) => scoreLinearRanker(model, label);
  const modelDevelopment = evaluateScorer("development", developmentLabels, modelScorer);
  const modelHoldout = evaluateScorer("holdout", holdoutLabels, modelScorer);
  const baselines = buildBaselineReports(developmentLabels, holdoutLabels);
  const gate = buildGate(data.leakage, developmentLabels, holdoutLabels, modelHoldout, baselines);
  const inference = measureInferenceTiming(holdoutLabels, model, inferenceRepeats);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...data.seeds],
    splitCount: data.splits.length,
    audit: {
      cpuOnly: true,
      runtimeIntegration: false,
      solverDefaultsChanged: false,
      trainingTarget: "greedy-pairwise-placement-ordering",
    },
    labels: buildLabelSummary(data.splits),
    leakage: data.leakage,
    model,
    modelMetrics: {
      development: modelDevelopment,
      holdout: modelHoldout,
    },
    baselines,
    gate,
    inference,
    hardware: captureExperimentRegistryHardwareMetadata({ gpuUsed: false }),
    decision: "offline-diagnostics-only",
    summary: summarizeResult(gate, modelHoldout, baselines, inference),
  };
}

export function createGreedyOfflineRankerSnapshot(
  result: GreedyOfflineRankerExperimentResult
): GreedyOfflineRankerSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function formatGreedyOfflineRankerExperiment(
  result: GreedyOfflineRankerExperimentResult
): string {
  const lines: string[] = [];
  lines.push("=== CPU-First Greedy Offline Ranker ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Audit: cpu-only=${result.audit.cpuOnly} runtime-integration=${result.audit.runtimeIntegration} solver-defaults-changed=${result.audit.solverDefaultsChanged}`);
  lines.push(`Leakage: protected-holdout=${result.leakage.protectedHoldout} greedy-overlap=${result.leakage.greedyOverlap.length ? result.leakage.greedyOverlap.join(", ") : "none"}`);
  lines.push(`Labels: total=${result.labels.labelCount} connectivity-shadow=${result.labels.sourceCounts["connectivity-shadow-decision"]} road-opportunity=${result.labels.sourceCounts["road-opportunity-counterfactual"]} fingerprint=${result.labels.labelFingerprint.slice(0, 12)}`);
  for (const split of result.labels.splits) {
    lines.push(`- ${split.split}: cases=${split.selectedCaseNames.join(", ")} labels=${split.labelCount} connectivity-shadow=${split.sourceCounts["connectivity-shadow-decision"]} road-opportunity=${split.sourceCounts["road-opportunity-counterfactual"]}`);
  }
  lines.push(`Model: kind=${result.model.kind} training-pairs=${result.model.trainingPairCount} features=${result.model.featureNames.length} epochs=${result.model.epochs} fingerprint=${result.model.modelFingerprint.slice(0, 12)}`);
  lines.push(`Model development: accuracy=${formatBenchmarkRate(result.modelMetrics.development.accuracy)} wins=${result.modelMetrics.development.wins} ties=${result.modelMetrics.development.ties} losses=${result.modelMetrics.development.losses}`);
  lines.push(`Model holdout: accuracy=${formatBenchmarkRate(result.modelMetrics.holdout.accuracy)} wins=${result.modelMetrics.holdout.wins} ties=${result.modelMetrics.holdout.ties} losses=${result.modelMetrics.holdout.losses}`);
  for (const baseline of result.baselines) {
    const suffix = baseline.selectedFeatureName === undefined
      ? ""
      : ` selected=${baseline.selectedFeatureName}:${baseline.selectedFeatureDirection}`;
    lines.push(`Baseline ${baseline.name}: development=${formatBenchmarkRate(baseline.development.accuracy)} holdout=${formatBenchmarkRate(baseline.holdout.accuracy)}${suffix}`);
  }
  lines.push(`Gate: passed=${result.gate.passed} failures=${result.gate.failedReasons.length ? result.gate.failedReasons.join("; ") : "none"}`);
  for (const comparison of result.gate.comparisons) {
    lines.push(`- delta vs ${comparison.baselineName}: ${formatBenchmarkRate(comparison.holdoutAccuracyDelta)}`);
  }
  lines.push(`Inference: holdout-pairs=${result.inference.holdoutPairCount} repeats=${result.inference.repeatCount} us-per-pair=${result.inference.microsecondsPerPair.toFixed(3)}`);
  lines.push(`Decision: ${result.decision}`);
  lines.push(result.summary);
  return lines.join("\n");
}
