import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  benchmarkGeneratedAt,
  countBenchmarkMatches,
  formatBenchmarkRate,
  meanBenchmarkValue,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import {
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
  runLearnedRankingLabelSuite,
} from "./learnedRankingLabels.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";

import type {
  LearnedRankingLabelRunOptions,
  LearnedRankingLabelSplit,
  LearnedRankingLabelSplitConfig,
  LearnedRankingLabelSuiteResult,
  LearnedRankingLeakageReport,
  LnsReplayPairwiseLabel,
  LnsReplayPairwiseSplitResult,
  LnsReplayPairwiseWindowSummary,
} from "./learnedRankingLabels.js";

export type LnsOfflineRankerBaselineName =
  | "cpu-linear-ranker"
  | "deterministic-window-proxy"
  | "random-hash"
  | "best-single-feature";

export type LnsOfflineRankerSingleFeatureDirection = "higher" | "lower";

export interface LnsOfflineRankerRunOptions
  extends Pick<
    LearnedRankingLabelRunOptions,
    | "seeds"
    | "splitConfigs"
    | "greedyCorpus"
    | "lnsCorpus"
    | "greedy"
    | "lns"
    | "cpSat"
    | "maxWindows"
    | "repairTimeLimitSeconds"
    | "explorationWindowCount"
  > {
  labelSuite?: LearnedRankingLabelSuiteResult;
  labels?: readonly LnsReplayPairwiseLabel[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
  inferenceRepeats?: number;
}

export interface LnsOfflineRankerSplitSummary {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  pressureFamilies: string[];
  seeds: number[];
  labelCount: number;
  rankedLabelCount: number;
  neutralLabelCount: number;
}

export interface LnsOfflineRankerLabelSummary {
  labelCount: number;
  rankedLabelCount: number;
  neutralLabelCount: number;
  splits: LnsOfflineRankerSplitSummary[];
  labelFingerprint: string;
}

export interface LnsOfflineRankerFeatureScale {
  featureName: string;
  rms: number;
}

export interface LnsOfflineRankerModel {
  kind: "pairwise-linear";
  trainedOnSplit: "development";
  cpuOnly: true;
  featureNames: string[];
  featureScale: LnsOfflineRankerFeatureScale[];
  weights: number[];
  epochs: number;
  learningRate: number;
  l2: number;
  trainingPairCount: number;
  modelFingerprint: string;
}

export interface LnsOfflineRankerFamilyMetric {
  labelCount: number;
  rankedLabelCount: number;
  accuracy: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface LnsOfflineRankerMetric {
  split: LearnedRankingLabelSplit;
  labelCount: number;
  rankedLabelCount: number;
  neutralLabelCount: number;
  accuracy: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  lossRate: number;
  tieRate: number;
  meanSignedScoreMargin: number;
  familyMetrics: Record<string, LnsOfflineRankerFamilyMetric>;
}

export interface LnsOfflineRankerBaselineReport {
  name: LnsOfflineRankerBaselineName;
  description: string;
  development: LnsOfflineRankerMetric;
  holdout: LnsOfflineRankerMetric;
  selectedFeatureName?: string;
  selectedFeatureDirection?: LnsOfflineRankerSingleFeatureDirection;
}

export interface LnsOfflineRankerGateComparison {
  baselineName: LnsOfflineRankerBaselineName;
  holdoutAccuracyDelta: number;
}

export interface LnsOfflineRankerGate {
  passed: boolean;
  failedReasons: string[];
  protectedHoldout: boolean;
  requiredBaselines: LnsOfflineRankerBaselineName[];
  comparisons: LnsOfflineRankerGateComparison[];
}

export interface LnsOfflineRankerInferenceTiming {
  holdoutPairCount: number;
  repeatCount: number;
  totalPairScores: number;
  elapsedMs: number;
  microsecondsPerPair: number;
  checksum: number;
}

export interface LnsOfflineRankerExperimentResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  splitCount: number;
  audit: {
    cpuOnly: true;
    runtimeIntegration: false;
    solverDefaultsChanged: false;
    trainingTarget: "lns-pairwise-window-improvement";
    trainedOnNeutralPairs: false;
  };
  labels: LnsOfflineRankerLabelSummary;
  leakage: LearnedRankingLeakageReport;
  model: LnsOfflineRankerModel;
  modelMetrics: {
    development: LnsOfflineRankerMetric;
    holdout: LnsOfflineRankerMetric;
  };
  baselines: LnsOfflineRankerBaselineReport[];
  gate: LnsOfflineRankerGate;
  inference: LnsOfflineRankerInferenceTiming;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: "lns-offline-ranker-ready-for-online-ab" | "offline-diagnostics-only";
  summary: string;
}

export interface LnsOfflineRankerSnapshot
  extends Omit<LnsOfflineRankerExperimentResult, "generatedAt"> {}

type LnsOfflineRankerBaseFeatureName =
  | "top"
  | "left"
  | "rows"
  | "cols"
  | "operatorWeakServiceRepair"
  | "operatorResidentialHeadroomRepair"
  | "operatorFrontierCongestionRepair"
  | "operatorGateChokeRepair"
  | "operatorServiceOverlapRepair"
  | "operatorRandomExploration"
  | "operatorSlidingWindow"
  | "operatorScore"
  | "operatorExploration"
  | "candidateWindowCount"
  | "candidateRankRatio"
  | "area"
  | "windowAreaRatio"
  | "touchesRoadAnchorBoundary"
  | "touchesTopBoundary"
  | "touchesLeftBoundary"
  | "minAnchorDistance"
  | "anchorBoundaryCellCount"
  | "anchorBoundaryCoverageRatio"
  | "allowedCellCountInside"
  | "blockedCellCountInside"
  | "roadCountInside"
  | "serviceCountInside"
  | "serviceFootprintCellsInside"
  | "residentialCountInside"
  | "residentialFootprintCellsInside"
  | "occupiedBuildingCellCountInside"
  | "emptyAllowedCellCountInside"
  | "roadDensityInside"
  | "buildingDensityInside"
  | "emptyAllowedRatioInside"
  | "residentialHeadroomInside"
  | "residentialHeadroomDensityInside"
  | "serviceBonusInside"
  | "serviceBonusDensityInside"
  | "selectedByBaseline"
  | "windowIndex"
  | "baselineRankScore"
  | "selectionSourceBaselineTopK"
  | "selectionSourceExplorationTail"
  | "aspectRatio"
  | "perimeter";

interface PairwiseExample {
  label: LnsReplayPairwiseLabel;
  rawDiff: number[];
  scaledDiff: number[];
}

const LNS_OFFLINE_RANKER_BASE_FEATURE_NAMES: readonly LnsOfflineRankerBaseFeatureName[] = [
  "top",
  "left",
  "rows",
  "cols",
  "operatorWeakServiceRepair",
  "operatorResidentialHeadroomRepair",
  "operatorFrontierCongestionRepair",
  "operatorGateChokeRepair",
  "operatorServiceOverlapRepair",
  "operatorRandomExploration",
  "operatorSlidingWindow",
  "operatorScore",
  "operatorExploration",
  "candidateWindowCount",
  "candidateRankRatio",
  "area",
  "windowAreaRatio",
  "touchesRoadAnchorBoundary",
  "touchesTopBoundary",
  "touchesLeftBoundary",
  "minAnchorDistance",
  "anchorBoundaryCellCount",
  "anchorBoundaryCoverageRatio",
  "allowedCellCountInside",
  "blockedCellCountInside",
  "roadCountInside",
  "serviceCountInside",
  "serviceFootprintCellsInside",
  "residentialCountInside",
  "residentialFootprintCellsInside",
  "occupiedBuildingCellCountInside",
  "emptyAllowedCellCountInside",
  "roadDensityInside",
  "buildingDensityInside",
  "emptyAllowedRatioInside",
  "residentialHeadroomInside",
  "residentialHeadroomDensityInside",
  "serviceBonusInside",
  "serviceBonusDensityInside",
  "selectedByBaseline",
  "windowIndex",
  "baselineRankScore",
  "selectionSourceBaselineTopK",
  "selectionSourceExplorationTail",
  "aspectRatio",
  "perimeter",
] as const;

const LNS_OFFLINE_RANKER_CONTEXT_NAMES: readonly string[] = [
  "all",
  "family:anchor-service",
  "family:baseline",
  "family:corridor",
  "family:footprint-pressure",
  "family:gate",
  "family:service-pressure",
  "family:uncategorized",
] as const;

export const LNS_OFFLINE_RANKER_FEATURE_NAMES: readonly string[] =
  Object.freeze(LNS_OFFLINE_RANKER_CONTEXT_NAMES.flatMap((context) =>
    LNS_OFFLINE_RANKER_BASE_FEATURE_NAMES.map((feature) => `${context}:${feature}`)
  ));

const DEFAULT_LNS_OFFLINE_RANKER_EPOCHS = 300;
const DEFAULT_LNS_OFFLINE_RANKER_LEARNING_RATE = 0.05;
const DEFAULT_LNS_OFFLINE_RANKER_L2 = 0.0001;
const DEFAULT_LNS_OFFLINE_RANKER_INFERENCE_REPEATS = 100;

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function boolFeature(value: boolean | undefined): number {
  return value === true ? 1 : 0;
}

function windowFeatureValue(
  summary: LnsReplayPairwiseWindowSummary,
  featureName: LnsOfflineRankerBaseFeatureName
): number {
  const { window, features } = summary;
  switch (featureName) {
    case "top":
      return window.top;
    case "left":
      return window.left;
    case "rows":
      return window.rows;
    case "cols":
      return window.cols;
    case "operatorWeakServiceRepair":
      return features.operatorName === "weak-service-repair" ? 1 : 0;
    case "operatorResidentialHeadroomRepair":
      return features.operatorName === "residential-headroom-repair" ? 1 : 0;
    case "operatorFrontierCongestionRepair":
      return features.operatorName === "frontier-congestion-repair" ? 1 : 0;
    case "operatorGateChokeRepair":
      return features.operatorName === "gate-choke-repair" ? 1 : 0;
    case "operatorServiceOverlapRepair":
      return features.operatorName === "service-overlap-repair" ? 1 : 0;
    case "operatorRandomExploration":
      return features.operatorName === "random-exploration" ? 1 : 0;
    case "operatorSlidingWindow":
      return features.operatorName === "sliding-window" ? 1 : 0;
    case "operatorScore":
      return finiteOrZero(features.operatorScore);
    case "operatorExploration":
      return boolFeature(features.operatorExploration);
    case "candidateWindowCount":
      return finiteOrZero(features.candidateWindowCount);
    case "candidateRankRatio":
      return finiteOrZero(features.candidateRankRatio);
    case "area":
      return finiteOrZero(features.area) || window.rows * window.cols;
    case "windowAreaRatio":
      return finiteOrZero(features.windowAreaRatio);
    case "touchesRoadAnchorBoundary":
      return boolFeature(features.touchesRoadAnchorBoundary);
    case "touchesTopBoundary":
      return boolFeature(features.touchesTopBoundary);
    case "touchesLeftBoundary":
      return boolFeature(features.touchesLeftBoundary);
    case "minAnchorDistance":
      return finiteOrZero(features.minAnchorDistance);
    case "anchorBoundaryCellCount":
      return finiteOrZero(features.anchorBoundaryCellCount);
    case "anchorBoundaryCoverageRatio":
      return finiteOrZero(features.anchorBoundaryCoverageRatio);
    case "allowedCellCountInside":
      return finiteOrZero(features.allowedCellCountInside);
    case "blockedCellCountInside":
      return finiteOrZero(features.blockedCellCountInside);
    case "roadCountInside":
      return finiteOrZero(features.roadCountInside);
    case "serviceCountInside":
      return finiteOrZero(features.serviceCountInside);
    case "serviceFootprintCellsInside":
      return finiteOrZero(features.serviceFootprintCellsInside);
    case "residentialCountInside":
      return finiteOrZero(features.residentialCountInside);
    case "residentialFootprintCellsInside":
      return finiteOrZero(features.residentialFootprintCellsInside);
    case "occupiedBuildingCellCountInside":
      return finiteOrZero(features.occupiedBuildingCellCountInside);
    case "emptyAllowedCellCountInside":
      return finiteOrZero(features.emptyAllowedCellCountInside);
    case "roadDensityInside":
      return finiteOrZero(features.roadDensityInside);
    case "buildingDensityInside":
      return finiteOrZero(features.buildingDensityInside);
    case "emptyAllowedRatioInside":
      return finiteOrZero(features.emptyAllowedRatioInside);
    case "residentialHeadroomInside":
      return finiteOrZero(features.residentialHeadroomInside);
    case "residentialHeadroomDensityInside":
      return finiteOrZero(features.residentialHeadroomDensityInside);
    case "serviceBonusInside":
      return finiteOrZero(features.serviceBonusInside);
    case "serviceBonusDensityInside":
      return finiteOrZero(features.serviceBonusDensityInside);
    case "selectedByBaseline":
      return boolFeature(summary.selectedByBaseline);
    case "windowIndex":
      return summary.windowIndex;
    case "baselineRankScore":
      return 1 / (1 + summary.windowIndex);
    case "selectionSourceBaselineTopK":
      return summary.selectionSource === "baseline-top-k" ? 1 : 0;
    case "selectionSourceExplorationTail":
      return summary.selectionSource === "exploration-tail" ? 1 : 0;
    case "aspectRatio":
      return window.rows / Math.max(1, window.cols);
    case "perimeter":
      return 2 * (window.rows + window.cols);
  }
}

function contextApplies(label: LnsReplayPairwiseLabel, contextName: string): boolean {
  return contextName === "all" || contextName === `family:${label.pressureFamily}`;
}

function windowFeatureVector(
  label: LnsReplayPairwiseLabel,
  summary: LnsReplayPairwiseWindowSummary
): number[] {
  const values: number[] = [];
  for (const contextName of LNS_OFFLINE_RANKER_CONTEXT_NAMES) {
    const active = contextApplies(label, contextName);
    for (const featureName of LNS_OFFLINE_RANKER_BASE_FEATURE_NAMES) {
      values.push(active ? windowFeatureValue(summary, featureName) : 0);
    }
  }
  return values;
}

function pairwiseFeatureDiff(label: LnsReplayPairwiseLabel): number[] {
  const better = windowFeatureVector(label, label.better);
  const worse = windowFeatureVector(label, label.worse);
  return better.map((value, index) => value - worse[index]!);
}

function rankedLabels(labels: readonly LnsReplayPairwiseLabel[]): LnsReplayPairwiseLabel[] {
  return labels.filter((label) => label.usable && label.status === "ranked");
}

function splitResultFromLabels(
  split: LearnedRankingLabelSplit,
  labels: readonly LnsReplayPairwiseLabel[]
): LnsReplayPairwiseSplitResult {
  const splitLabels = labels.filter((label) => label.split === split);
  const usableLabelCount = countBenchmarkMatches(splitLabels, (label) => label.usable);
  const nonNeutralUsableLabelCount = countBenchmarkMatches(splitLabels, (label) =>
    label.usable && label.status === "ranked"
  );
  const neutralUsableLabelCount = countBenchmarkMatches(splitLabels, (label) =>
    label.usable && label.status === "tie"
  );
  return {
    split,
    selectedCaseNames: uniqueBenchmarkValuesBy(splitLabels, (label) => label.caseName),
    pressureFamilies: uniqueBenchmarkValuesBy(splitLabels, (label) => label.pressureFamily),
    seeds: uniqueBenchmarkValues(
      splitLabels
        .map((label) => label.seed)
        .filter((seed): seed is number => seed !== null)
    ).sort((left, right) => left - right),
    labelCount: splitLabels.length,
    usableLabelCount,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio: usableLabelCount === 0 ? 1 : neutralUsableLabelCount / usableLabelCount,
    labels: [...splitLabels],
  };
}

function labelSplitsFromLabels(labels: readonly LnsReplayPairwiseLabel[]): LnsReplayPairwiseSplitResult[] {
  return [
    splitResultFromLabels("development", labels),
    splitResultFromLabels("holdout", labels),
  ];
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return uniqueBenchmarkValues(left.filter((value) => rightSet.has(value)));
}

function buildLeakageReportFromSplits(
  splits: readonly LnsReplayPairwiseSplitResult[],
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[]
): LearnedRankingLeakageReport {
  const developmentLnsCases = splitConfigs
    ?.find((config) => config.split === "development")
    ?.lnsCaseNames
    ?? splits.find((split) => split.split === "development")?.selectedCaseNames
    ?? [];
  const holdoutLnsCases = splitConfigs
    ?.find((config) => config.split === "holdout")
    ?.lnsCaseNames
    ?? splits.find((split) => split.split === "holdout")?.selectedCaseNames
    ?? [];
  const developmentGreedyCases = splitConfigs
    ?.find((config) => config.split === "development")
    ?.greedyCaseNames
    ?? [];
  const holdoutGreedyCases = splitConfigs
    ?.find((config) => config.split === "holdout")
    ?.greedyCaseNames
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

function resolveLabelData(options: LnsOfflineRankerRunOptions): {
  seeds: number[];
  splits: LnsReplayPairwiseSplitResult[];
  leakage: LearnedRankingLeakageReport;
} {
  if (options.labelSuite !== undefined) {
    return {
      seeds: [...options.labelSuite.seeds],
      splits: options.labelSuite.lns.pairwiseSplits.map((split) => ({
        ...split,
        selectedCaseNames: [...split.selectedCaseNames],
        pressureFamilies: [...split.pressureFamilies],
        seeds: [...split.seeds],
        labels: [...split.labels],
      })),
      leakage: options.labelSuite.leakage,
    };
  }

  if (options.labels !== undefined) {
    const splits = labelSplitsFromLabels(options.labels);
    const seeds = options.seeds === undefined
      ? uniqueBenchmarkValues(
        options.labels
          .map((label) => label.seed)
          .filter((seed): seed is number => seed !== null)
      ).sort((left, right) => left - right)
      : [...options.seeds];
    return {
      seeds,
      splits,
      leakage: buildLeakageReportFromSplits(splits, options.splitConfigs),
    };
  }

  const suite = runLearnedRankingLabelSuite({
    seeds: options.seeds,
    splitConfigs: options.splitConfigs ?? DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
    greedyCorpus: options.greedyCorpus,
    lnsCorpus: options.lnsCorpus,
    greedy: options.greedy,
    lns: options.lns,
    cpSat: options.cpSat,
    maxWindows: options.maxWindows,
    repairTimeLimitSeconds: options.repairTimeLimitSeconds,
    explorationWindowCount: options.explorationWindowCount,
  });
  return {
    seeds: [...suite.seeds],
    splits: suite.lns.pairwiseSplits.map((split) => ({
      ...split,
      selectedCaseNames: [...split.selectedCaseNames],
      pressureFamilies: [...split.pressureFamilies],
      seeds: [...split.seeds],
      labels: [...split.labels],
    })),
    leakage: suite.leakage,
  };
}

function flattenSplitLabels(
  splits: readonly LnsReplayPairwiseSplitResult[],
  splitName: LearnedRankingLabelSplit
): LnsReplayPairwiseLabel[] {
  return splits
    .filter((split) => split.split === splitName)
    .flatMap((split) => split.labels);
}

function fingerprintValue(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildLabelFingerprint(labels: readonly LnsReplayPairwiseLabel[]): string {
  return fingerprintValue(labels.map((label) => ({
    id: label.id,
    split: label.split,
    caseName: label.caseName,
    pressureFamily: label.pressureFamily,
    seed: label.seed,
    target: label.target,
    status: label.status,
    margin: label.margin,
    better: label.better,
    worse: label.worse,
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

function computeRmsFeatureScale(labels: readonly LnsReplayPairwiseLabel[]): number[] {
  const diffs = labels.map(pairwiseFeatureDiff);
  return LNS_OFFLINE_RANKER_FEATURE_NAMES.map((_, featureIndex) => {
    const rms = Math.sqrt(meanBenchmarkValue(diffs.map((diff) => diff[featureIndex]! ** 2)));
    return rms > 0 ? rms : 1;
  });
}

function scaledDiff(diff: readonly number[], scale: readonly number[]): number[] {
  return diff.map((value, index) => value / scale[index]!);
}

function buildExamples(
  labels: readonly LnsReplayPairwiseLabel[],
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
  developmentLabels: readonly LnsReplayPairwiseLabel[],
  epochs: number,
  learningRate: number,
  l2: number
): LnsOfflineRankerModel {
  if (developmentLabels.length === 0) {
    throw new Error("LNS offline ranker requires at least one non-neutral development label.");
  }
  const scale = computeRmsFeatureScale(developmentLabels);
  const examples = buildExamples(developmentLabels, scale);
  const weights = LNS_OFFLINE_RANKER_FEATURE_NAMES.map(() => 0);

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
    featureNames: [...LNS_OFFLINE_RANKER_FEATURE_NAMES],
    featureScale: LNS_OFFLINE_RANKER_FEATURE_NAMES.map((featureName, index) => ({
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

function scoreLinearRanker(model: LnsOfflineRankerModel, label: LnsReplayPairwiseLabel): number {
  const scale = model.featureScale.map((entry) => entry.rms);
  return dot(model.weights, scaledDiff(pairwiseFeatureDiff(label), scale));
}

function metricForLabels(
  labels: readonly LnsReplayPairwiseLabel[],
  scorer: (label: LnsReplayPairwiseLabel) => number
): LnsOfflineRankerFamilyMetric {
  const selected = rankedLabels(labels);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const label of selected) {
    const score = scorer(label);
    if (score > 1e-9) wins++;
    else if (score < -1e-9) losses++;
    else ties++;
  }
  return {
    labelCount: labels.length,
    rankedLabelCount: selected.length,
    accuracy: selected.length === 0 ? 0 : (wins + 0.5 * ties) / selected.length,
    wins,
    losses,
    ties,
  };
}

function evaluateScorer(
  split: LearnedRankingLabelSplit,
  labels: readonly LnsReplayPairwiseLabel[],
  scorer: (label: LnsReplayPairwiseLabel) => number
): LnsOfflineRankerMetric {
  const selected = rankedLabels(labels);
  const metric = metricForLabels(labels, scorer);
  const familyMetrics: Record<string, LnsOfflineRankerFamilyMetric> = {};
  for (const pressureFamily of uniqueBenchmarkValuesBy(labels, (label) => label.pressureFamily)) {
    familyMetrics[pressureFamily] = metricForLabels(
      labels.filter((label) => label.pressureFamily === pressureFamily),
      scorer
    );
  }
  return {
    split,
    ...metric,
    neutralLabelCount: countBenchmarkMatches(labels, (label) => label.status === "tie"),
    winRate: selected.length === 0 ? 0 : metric.wins / selected.length,
    lossRate: selected.length === 0 ? 0 : metric.losses / selected.length,
    tieRate: selected.length === 0 ? 0 : metric.ties / selected.length,
    meanSignedScoreMargin: selected.length === 0 ? 0 : meanBenchmarkValue(selected.map(scorer)),
    familyMetrics,
  };
}

function deterministicWindowProxyScore(label: LnsReplayPairwiseLabel): number {
  const score = (summary: LnsReplayPairwiseWindowSummary): number =>
    (summary.selectedByBaseline ? 1000 : 0)
    + 10 / (1 + summary.windowIndex)
    + finiteOrZero(summary.features.serviceBonusInside)
    + 0.1 * finiteOrZero(summary.features.residentialHeadroomInside)
    + 0.2 * finiteOrZero(summary.features.residentialCountInside)
    + 0.5 * finiteOrZero(summary.features.serviceCountInside)
    - finiteOrZero(summary.features.roadCountInside);
  return score(label.better) - score(label.worse);
}

function randomHashScore(label: LnsReplayPairwiseLabel): number {
  return hashString(label.id) % 2 === 0 ? 1 : -1;
}

function singleFeatureScore(
  label: LnsReplayPairwiseLabel,
  featureName: LnsOfflineRankerBaseFeatureName,
  direction: LnsOfflineRankerSingleFeatureDirection
): number {
  const sign = direction === "higher" ? 1 : -1;
  return sign * (
    windowFeatureValue(label.better, featureName)
    - windowFeatureValue(label.worse, featureName)
  );
}

function bestSingleFeatureBaseline(
  developmentLabels: readonly LnsReplayPairwiseLabel[]
): {
  featureName: LnsOfflineRankerBaseFeatureName;
  direction: LnsOfflineRankerSingleFeatureDirection;
} {
  let best: {
    featureName: LnsOfflineRankerBaseFeatureName;
    direction: LnsOfflineRankerSingleFeatureDirection;
    accuracy: number;
    key: string;
  } | null = null;
  for (const featureName of LNS_OFFLINE_RANKER_BASE_FEATURE_NAMES) {
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
    throw new Error("LNS offline ranker could not select a single-feature baseline.");
  }
  return {
    featureName: best.featureName,
    direction: best.direction,
  };
}

function buildBaselineReports(
  developmentLabels: readonly LnsReplayPairwiseLabel[],
  holdoutLabels: readonly LnsReplayPairwiseLabel[]
): LnsOfflineRankerBaselineReport[] {
  const singleFeature = bestSingleFeatureBaseline(developmentLabels);
  return [
    {
      name: "deterministic-window-proxy",
      description: "Fixed CPU heuristic over baseline selection, baseline rank, service bonus, headroom, and road count.",
      development: evaluateScorer("development", developmentLabels, deterministicWindowProxyScore),
      holdout: evaluateScorer("holdout", holdoutLabels, deterministicWindowProxyScore),
    },
    {
      name: "random-hash",
      description: "Deterministic hash baseline that picks better or worse with equal probability.",
      development: evaluateScorer("development", developmentLabels, randomHashScore),
      holdout: evaluateScorer("holdout", holdoutLabels, randomHashScore),
    },
    {
      name: "best-single-feature",
      description: "Best single raw window feature and direction selected on development labels only.",
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
  developmentLabels: readonly LnsReplayPairwiseLabel[],
  holdoutLabels: readonly LnsReplayPairwiseLabel[],
  modelHoldout: LnsOfflineRankerMetric,
  baselines: readonly LnsOfflineRankerBaselineReport[]
): LnsOfflineRankerGate {
  const requiredBaselines = baselines.map((baseline) => baseline.name);
  const failedReasons: string[] = [];
  if (!leakage.protectedHoldout) {
    failedReasons.push("development/holdout case names overlap");
  }
  if (developmentLabels.length === 0) failedReasons.push("development split has no non-neutral labels");
  if (holdoutLabels.length === 0) failedReasons.push("holdout split has no non-neutral labels");
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
  holdoutLabels: readonly LnsReplayPairwiseLabel[],
  model: LnsOfflineRankerModel,
  repeatCount: number
): LnsOfflineRankerInferenceTiming {
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

function summarizeSplit(split: LnsReplayPairwiseSplitResult): LnsOfflineRankerSplitSummary {
  return {
    split: split.split,
    selectedCaseNames: [...split.selectedCaseNames],
    pressureFamilies: [...split.pressureFamilies],
    seeds: [...split.seeds],
    labelCount: split.labelCount,
    rankedLabelCount: split.nonNeutralUsableLabelCount,
    neutralLabelCount: split.neutralUsableLabelCount,
  };
}

function buildLabelSummary(splits: readonly LnsReplayPairwiseSplitResult[]): LnsOfflineRankerLabelSummary {
  const labels = splits.flatMap((split) => split.labels);
  return {
    labelCount: sumBenchmarkBy(splits, (split) => split.labelCount),
    rankedLabelCount: sumBenchmarkBy(splits, (split) => split.nonNeutralUsableLabelCount),
    neutralLabelCount: sumBenchmarkBy(splits, (split) => split.neutralUsableLabelCount),
    splits: splits.map(summarizeSplit),
    labelFingerprint: buildLabelFingerprint(labels),
  };
}

function summarizeResult(
  gate: LnsOfflineRankerGate,
  modelHoldout: LnsOfflineRankerMetric,
  baselines: readonly LnsOfflineRankerBaselineReport[],
  inference: LnsOfflineRankerInferenceTiming
): string {
  const baselineSummary = baselines
    .map((baseline) => `${baseline.name} ${formatBenchmarkRate(baseline.holdout.accuracy)}`)
    .join(", ");
  return `CPU linear LNS window ranker ${gate.passed ? "passed" : "failed"} offline diagnostics on protected holdout: model ${formatBenchmarkRate(modelHoldout.accuracy)} vs ${baselineSummary}; inference ${inference.microsecondsPerPair.toFixed(3)}us/pair. No runtime scorer or solver default changed.`;
}

export function runLnsOfflineRankerExperiment(
  options: LnsOfflineRankerRunOptions = {}
): LnsOfflineRankerExperimentResult {
  const epochs = options.epochs ?? DEFAULT_LNS_OFFLINE_RANKER_EPOCHS;
  const learningRate = options.learningRate ?? DEFAULT_LNS_OFFLINE_RANKER_LEARNING_RATE;
  const l2 = options.l2 ?? DEFAULT_LNS_OFFLINE_RANKER_L2;
  const inferenceRepeats = options.inferenceRepeats ?? DEFAULT_LNS_OFFLINE_RANKER_INFERENCE_REPEATS;
  const data = resolveLabelData(options);
  const developmentLabels = rankedLabels(flattenSplitLabels(data.splits, "development"));
  const holdoutLabels = rankedLabels(flattenSplitLabels(data.splits, "holdout"));
  const model = trainLinearRanker(developmentLabels, epochs, learningRate, l2);
  const modelScorer = (label: LnsReplayPairwiseLabel) => scoreLinearRanker(model, label);
  const modelDevelopment = evaluateScorer("development", developmentLabels, modelScorer);
  const modelHoldout = evaluateScorer("holdout", holdoutLabels, modelScorer);
  const baselines = buildBaselineReports(developmentLabels, holdoutLabels);
  const gate = buildGate(data.leakage, developmentLabels, holdoutLabels, modelHoldout, baselines);
  const inference = measureInferenceTiming(holdoutLabels, model, inferenceRepeats);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...(data.seeds.length ? data.seeds : normalizeBenchmarkSeeds(options.seeds, "LNS offline ranker seeds")
      ?? [...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS])],
    splitCount: data.splits.length,
    audit: {
      cpuOnly: true,
      runtimeIntegration: false,
      solverDefaultsChanged: false,
      trainingTarget: "lns-pairwise-window-improvement",
      trainedOnNeutralPairs: false,
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
    decision: gate.passed ? "lns-offline-ranker-ready-for-online-ab" : "offline-diagnostics-only",
    summary: summarizeResult(gate, modelHoldout, baselines, inference),
  };
}

export function createLnsOfflineRankerSnapshot(
  result: LnsOfflineRankerExperimentResult
): LnsOfflineRankerSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function formatLnsOfflineRankerExperiment(
  result: LnsOfflineRankerExperimentResult
): string {
  const lines: string[] = [];
  lines.push("=== CPU-First LNS Offline Window Ranker ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Audit: cpu-only=${result.audit.cpuOnly} runtime-integration=${result.audit.runtimeIntegration} solver-defaults-changed=${result.audit.solverDefaultsChanged} trained-on-neutral-pairs=${result.audit.trainedOnNeutralPairs}`);
  lines.push(`Leakage: protected-holdout=${result.leakage.protectedHoldout} lns-overlap=${result.leakage.lnsOverlap.length ? result.leakage.lnsOverlap.join(", ") : "none"}`);
  lines.push(`Labels: total=${result.labels.labelCount} ranked=${result.labels.rankedLabelCount} neutral=${result.labels.neutralLabelCount} fingerprint=${result.labels.labelFingerprint.slice(0, 12)}`);
  for (const split of result.labels.splits) {
    lines.push(`- ${split.split}: cases=${split.selectedCaseNames.join(", ")} families=${split.pressureFamilies.join(", ")} labels=${split.labelCount} ranked=${split.rankedLabelCount} neutral=${split.neutralLabelCount}`);
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
