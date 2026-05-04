import { benchmarkGeneratedAt, uniqueBenchmarkValues } from "./benchmarkOptions.js";
import {
  buildModelExperimentFingerprint,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest
} from "./modelExperimentArtifacts.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";

import type { LearnedRankingLabelSnapshot, LearnedRankingLabelSplit } from "./learnedRankingLabels.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS } from "./lns.js";
import type { LnsReplayPressureFamilyLabel } from "./lns.js";
import type {
  LnsWindowReplaySeedHintKind,
  LnsWindowReplaySnapshotCaseResult,
  LnsWindowReplaySnapshotLabel
} from "./lnsWindowReplayLabels.js";
import type {
  ModelExperimentRegistryEntryDraftOptions,
  ModelExperimentTelemetryManifest,
  ModelExperimentTelemetryManifestOptions
} from "./modelExperimentArtifacts.js";

export const LNS_WINDOW_RANKER_BASELINE_NAMES = Object.freeze([
  "baseline-selected-window",
  "operator-score",
  "stable-random",
  "connectivity-shadow",
  "fragmentation",
  "candidate-loss",
  "residential-headroom",
  "service-bonus"
] as const);

export type LnsWindowRankerBaselineName = (typeof LNS_WINDOW_RANKER_BASELINE_NAMES)[number];
export type LnsWindowRankerLabelTarget = "immediate-improvement" | "roll-forward-final-lift";

export interface LnsWindowRankerBaselineRunOptions {
  randomBaselineSeed?: number;
  topK?: number;
  target?: LnsWindowRankerLabelTarget;
  allowWeakSeedReplayLabels?: boolean;
}

export interface LnsWindowRankerMetricSummary {
  decisionCount: number;
  opportunityCount: number;
  usableLabelCount: number;
  bestImprovementTotal: number;
  selectedImprovementTotal: number;
  regretTotal: number;
  meanRegret: number;
  improvementCaptureRate: number;
  hitAt1Count: number;
  hitAt1: number;
  hitAtKCount: number;
  hitAtK: number;
  selectedImprovedCount: number;
  selectedImprovedRate: number;
}

export interface LnsWindowRankerBreakdownMetrics extends LnsWindowRankerMetricSummary {
  key: string;
}

export interface LnsWindowRankerSplitEvaluation extends LnsWindowRankerMetricSummary {
  split: LearnedRankingLabelSplit;
  pressureFamilyMetrics: LnsWindowRankerBreakdownMetrics[];
  statePolicyMetrics: LnsWindowRankerBreakdownMetrics[];
  seedHintMetrics: LnsWindowRankerBreakdownMetrics[];
}

export interface LnsWindowRankerBaselineEvaluation {
  name: LnsWindowRankerBaselineName;
  description: string;
  development: LnsWindowRankerSplitEvaluation;
  holdout: LnsWindowRankerSplitEvaluation;
}

export interface LnsWindowRankerLabelSplitSummary {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  opportunityCount: number;
  capturedStatePolicies: string[];
}

export interface LnsWindowRankerBaselineSummary {
  passed: boolean;
  failedReasons: string[];
  bestBaselineName: LnsWindowRankerBaselineName;
  bestBaselineHoldoutCaptureRate: number;
  bestBaselineHoldoutHitAt1: number;
  bestBaselineHoldoutHitAtK: number;
  deterministicHoldoutCaptureRate: number;
  randomHoldoutCaptureRate: number;
}

export interface LnsWindowRankerBaselineModel {
  schemaVersion: 1;
  modelType: "lns-window-ranking-baseline-sweep";
  purpose: "offline-diagnostics-only";
  trained: false;
  runtimeDefaultChanged: false;
  solverDefaultChanged: false;
  featureSchemaVersion: number | null;
  topK: number;
  target: LnsWindowRankerLabelTarget;
  weakSeedReplayLabelsAllowed: boolean;
  baselineNames: LnsWindowRankerBaselineName[];
  bestBaselineName: LnsWindowRankerBaselineName;
}

export interface LnsWindowRankerBaselineExperimentResult {
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
  };
  labels: {
    labelCount: number;
    usableLabelCount: number;
    opportunityCount: number;
    splits: LnsWindowRankerLabelSplitSummary[];
  };
  evaluation: {
    baselines: LnsWindowRankerBaselineEvaluation[];
    summary: LnsWindowRankerBaselineSummary;
  };
  model: LnsWindowRankerBaselineModel;
  datasetFingerprint: string;
  labelFingerprint: string;
  modelFingerprint: string;
}

export interface LnsWindowRankerBaselineExperimentSnapshot extends Omit<
  LnsWindowRankerBaselineExperimentResult,
  "generatedAt"
> {}

export interface LnsWindowRankerBaselineTelemetryManifestOptions extends Pick<
  ModelExperimentTelemetryManifestOptions,
  "command" | "git" | "hardware" | "inputArtifacts" | "outputArtifacts" | "notes"
> {}

export interface LnsWindowRankerBaselineRegistryEntryDraftOptions extends Pick<
  ModelExperimentRegistryEntryDraftOptions,
  "runId" | "commands" | "artifactPaths" | "decision" | "summary"
> {}

interface ReplayDecisionGroup {
  split: LearnedRankingLabelSplit;
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  seedHintKind: LnsWindowReplaySeedHintKind | "unknown";
  statePolicy: string;
  stateIndex: number;
  labels: LnsWindowReplaySnapshotLabel[];
}

interface ScoredReplayLabel {
  label: LnsWindowReplaySnapshotLabel;
  score: number;
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function normalizeLnsWindowRankerLabelTarget(value: unknown): LnsWindowRankerLabelTarget {
  if (value === undefined || value === "immediate-improvement") return "immediate-improvement";
  if (value === "roll-forward-final-lift") return "roll-forward-final-lift";
  throw new Error(`Unknown LNS window ranker label target: ${String(value)}.`);
}

export function normalizeLnsWindowRankerWeakSeedAllowance(value: unknown): boolean {
  return value !== false;
}

function seedHintKindFromSource(
  sourceName: string | null | undefined,
  hasSeedHint: boolean
): LnsWindowReplaySeedHintKind {
  if (!hasSeedHint) return "none";
  return sourceName?.endsWith("-weak-replay-seed") ? "weak-replay" : "curated";
}

const DEFAULT_REPLAY_SEED_HINT_KIND_BY_CASE = new Map(
  DEFAULT_LNS_REPLAY_LABEL_CORPUS.map((benchmarkCase) => [
    benchmarkCase.name,
    seedHintKindFromSource(benchmarkCase.params.lns?.seedHint?.sourceName, Boolean(benchmarkCase.params.lns?.seedHint))
  ])
);

export function inferLnsWindowRankerReplaySeedHintKind(
  benchmarkCase: Pick<LnsWindowReplaySnapshotCaseResult, "name" | "seedHintKind" | "seedHintSourceName">
): LnsWindowReplaySeedHintKind | "unknown" {
  if (benchmarkCase.seedHintKind) return benchmarkCase.seedHintKind;
  if (benchmarkCase.seedHintSourceName) return seedHintKindFromSource(benchmarkCase.seedHintSourceName, true);
  return DEFAULT_REPLAY_SEED_HINT_KIND_BY_CASE.get(benchmarkCase.name) ?? "unknown";
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasTargetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): boolean {
  return target === "immediate-improvement" || typeof label.rollForward?.populationDeltaVsBaseline === "number";
}

function targetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): number {
  return target === "roll-forward-final-lift" ? (label.rollForward?.populationDeltaVsBaseline ?? 0) : label.improvement;
}

function stableRandomScore(seed: number, group: ReplayDecisionGroup, label: LnsWindowReplaySnapshotLabel): number {
  const hash = Number.parseInt(
    hashString(
      `${seed}:${group.split}:${group.caseName}:${group.seed}:${group.statePolicy}:${group.stateIndex}:${label.windowIndex}`
    ),
    16
  );
  return hash / 0xffffffff;
}

function baselineDescription(name: LnsWindowRankerBaselineName): string {
  switch (name) {
    case "baseline-selected-window":
      return "The current deterministic LNS selected window, with operator score as tie-break.";
    case "operator-score":
      return "Current adaptive LNS operator score over candidate windows.";
    case "stable-random":
      return "Stable pseudo-random ordering keyed by split, case, seed, state, and window.";
    case "connectivity-shadow":
      return "Feature heuristic favoring newly reachable cells and lower disconnected shadow.";
    case "fragmentation":
      return "Feature heuristic favoring anchor-reachable windows with lower empty-space fragmentation.";
    case "candidate-loss":
      return "Feature heuristic favoring windows with intersecting service and residential candidate opportunity.";
    case "residential-headroom":
      return "Single-feature heuristic using residential headroom inside the replay window.";
    case "service-bonus":
      return "Single-feature heuristic using incumbent service bonus inside the replay window.";
  }
}

function scoreLabel(
  name: LnsWindowRankerBaselineName,
  group: ReplayDecisionGroup,
  label: LnsWindowReplaySnapshotLabel,
  randomBaselineSeed: number
): number {
  const features = label.features;
  switch (name) {
    case "baseline-selected-window":
      return (label.selectedByBaseline ? 1_000_000 : 0) + label.operatorScore;
    case "operator-score":
      return label.operatorScore;
    case "stable-random":
      return stableRandomScore(randomBaselineSeed, group, label);
    case "connectivity-shadow":
      return (
        numericValue(features.connectivityShadow.newlyReachableEmptyCellsIfCleared) * 4 +
        numericValue(features.connectivityShadow.reachableEmptyCellsAfterClearingWindow) -
        numericValue(features.connectivityShadow.disconnectedEmptyCellsAfterClearingWindow) * 2
      );
    case "fragmentation":
      return (
        numericValue(features.fragmentation.anchorReachableWindowCellCount) * 2 -
        numericValue(features.fragmentation.emptyComponentCountAfterClearingWindow) * 5 -
        numericValue(features.fragmentation.narrowGateCellCount)
      );
    case "candidate-loss":
      return (
        numericValue(features.candidateLoss.residentialCandidateHeadroomInside) / 20 +
        numericValue(features.candidateLoss.serviceCandidateBonusInside) / 20 +
        numericValue(features.candidateLoss.maxServiceCandidateBonusInside) / 20 +
        numericValue(features.candidateLoss.residentialCandidatesIntersectingWindow) * 2 +
        numericValue(features.candidateLoss.serviceCandidatesIntersectingWindow) * 2
      );
    case "residential-headroom":
      return numericValue(features.residentialHeadroomInside);
    case "service-bonus":
      return numericValue(features.serviceBonusInside);
  }
}

function rankLabels(
  group: ReplayDecisionGroup,
  baselineName: LnsWindowRankerBaselineName,
  randomBaselineSeed: number
): ScoredReplayLabel[] {
  return group.labels
    .map((label) => ({
      label,
      score: scoreLabel(baselineName, group, label, randomBaselineSeed)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.label.operatorScore - left.label.operatorScore ||
        left.label.windowIndex - right.label.windowIndex
    );
}

function emptyMetricSummary(): LnsWindowRankerMetricSummary {
  return {
    decisionCount: 0,
    opportunityCount: 0,
    usableLabelCount: 0,
    bestImprovementTotal: 0,
    selectedImprovementTotal: 0,
    regretTotal: 0,
    meanRegret: 0,
    improvementCaptureRate: 0,
    hitAt1Count: 0,
    hitAt1: 0,
    hitAtKCount: 0,
    hitAtK: 0,
    selectedImprovedCount: 0,
    selectedImprovedRate: 0
  };
}

function evaluateMetricSummary(
  groups: readonly ReplayDecisionGroup[],
  baselineName: LnsWindowRankerBaselineName,
  randomBaselineSeed: number,
  topK: number,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerMetricSummary {
  const summary = emptyMetricSummary();
  for (const group of groups) {
    if (group.labels.length === 0) continue;
    const ranked = rankLabels(group, baselineName, randomBaselineSeed);
    const selected = ranked[0]!.label;
    const bestImprovement = Math.max(...group.labels.map((label) => targetValue(label, target)));
    const selectedImprovement = Math.max(0, targetValue(selected, target));
    const opportunity = bestImprovement > 0;

    summary.decisionCount++;
    summary.usableLabelCount += group.labels.length;
    if (selectedImprovement > 0) summary.selectedImprovedCount++;
    if (!opportunity) continue;

    const topKLabels = ranked.slice(0, topK).map((entry) => entry.label);
    summary.opportunityCount++;
    summary.bestImprovementTotal += bestImprovement;
    summary.selectedImprovementTotal += Math.min(selectedImprovement, bestImprovement);
    summary.regretTotal += Math.max(0, bestImprovementDelta(bestImprovement, selectedImprovement));
    if (selectedImprovement === bestImprovement) summary.hitAt1Count++;
    if (topKLabels.some((label) => targetValue(label, target) === bestImprovement)) summary.hitAtKCount++;
  }

  return finalizeMetricSummary(summary);
}

function bestImprovementDelta(bestImprovement: number, selectedImprovement: number): number {
  return bestImprovement - selectedImprovement;
}

function finalizeMetricSummary(summary: LnsWindowRankerMetricSummary): LnsWindowRankerMetricSummary {
  return {
    ...summary,
    bestImprovementTotal: roundMetric(summary.bestImprovementTotal),
    selectedImprovementTotal: roundMetric(summary.selectedImprovementTotal),
    regretTotal: roundMetric(summary.regretTotal),
    meanRegret: summary.opportunityCount === 0 ? 0 : roundMetric(summary.regretTotal / summary.opportunityCount),
    improvementCaptureRate:
      summary.bestImprovementTotal === 0
        ? 0
        : roundMetric(summary.selectedImprovementTotal / summary.bestImprovementTotal),
    hitAt1: summary.opportunityCount === 0 ? 0 : roundMetric(summary.hitAt1Count / summary.opportunityCount),
    hitAtK: summary.opportunityCount === 0 ? 0 : roundMetric(summary.hitAtKCount / summary.opportunityCount),
    selectedImprovedRate:
      summary.decisionCount === 0 ? 0 : roundMetric(summary.selectedImprovedCount / summary.decisionCount)
  };
}

function groupByKey(
  groups: readonly ReplayDecisionGroup[],
  keyForGroup: (group: ReplayDecisionGroup) => string
): Map<string, ReplayDecisionGroup[]> {
  const grouped = new Map<string, ReplayDecisionGroup[]>();
  for (const group of groups) {
    const key = keyForGroup(group);
    const entries = grouped.get(key);
    if (entries) {
      entries.push(group);
    } else {
      grouped.set(key, [group]);
    }
  }
  return grouped;
}

function breakdownMetrics(
  groups: readonly ReplayDecisionGroup[],
  baselineName: LnsWindowRankerBaselineName,
  randomBaselineSeed: number,
  topK: number,
  target: LnsWindowRankerLabelTarget,
  keyForGroup: (group: ReplayDecisionGroup) => string
): LnsWindowRankerBreakdownMetrics[] {
  return [...groupByKey(groups, keyForGroup).entries()]
    .map(([key, keyGroups]) => ({
      key,
      ...evaluateMetricSummary(keyGroups, baselineName, randomBaselineSeed, topK, target)
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function evaluateSplit(
  split: LearnedRankingLabelSplit,
  groups: readonly ReplayDecisionGroup[],
  baselineName: LnsWindowRankerBaselineName,
  randomBaselineSeed: number,
  topK: number,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerSplitEvaluation {
  return {
    split,
    ...evaluateMetricSummary(groups, baselineName, randomBaselineSeed, topK, target),
    pressureFamilyMetrics: breakdownMetrics(
      groups,
      baselineName,
      randomBaselineSeed,
      topK,
      target,
      (group) => group.pressureFamily
    ),
    statePolicyMetrics: breakdownMetrics(
      groups,
      baselineName,
      randomBaselineSeed,
      topK,
      target,
      (group) => group.statePolicy
    ),
    seedHintMetrics: breakdownMetrics(
      groups,
      baselineName,
      randomBaselineSeed,
      topK,
      target,
      (group) => group.seedHintKind
    )
  };
}

function splitGroups(groups: readonly ReplayDecisionGroup[], split: LearnedRankingLabelSplit): ReplayDecisionGroup[] {
  return groups.filter((group) => group.split === split);
}

function buildBaselineEvaluations(
  groups: readonly ReplayDecisionGroup[],
  randomBaselineSeed: number,
  topK: number,
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerBaselineEvaluation[] {
  const developmentGroups = splitGroups(groups, "development");
  const holdoutGroups = splitGroups(groups, "holdout");
  return LNS_WINDOW_RANKER_BASELINE_NAMES.map((name) => ({
    name,
    description: baselineDescription(name),
    development: evaluateSplit("development", developmentGroups, name, randomBaselineSeed, topK, target),
    holdout: evaluateSplit("holdout", holdoutGroups, name, randomBaselineSeed, topK, target)
  }));
}

function compareBaselines(left: LnsWindowRankerBaselineEvaluation, right: LnsWindowRankerBaselineEvaluation): number {
  return (
    right.holdout.improvementCaptureRate - left.holdout.improvementCaptureRate ||
    right.holdout.hitAt1 - left.holdout.hitAt1 ||
    left.holdout.meanRegret - right.holdout.meanRegret ||
    left.name.localeCompare(right.name)
  );
}

function baselineByName(
  baselines: readonly LnsWindowRankerBaselineEvaluation[],
  name: LnsWindowRankerBaselineName
): LnsWindowRankerBaselineEvaluation {
  const baseline = baselines.find((entry) => entry.name === name);
  if (!baseline) throw new Error(`Missing LNS window baseline evaluation: ${name}.`);
  return baseline;
}

function buildSummary(
  labelSnapshot: LearnedRankingLabelSnapshot,
  baselines: readonly LnsWindowRankerBaselineEvaluation[]
): LnsWindowRankerBaselineSummary {
  const bestBaseline = [...baselines].sort(compareBaselines)[0]!;
  const deterministic = baselineByName(baselines, "operator-score");
  const random = baselineByName(baselines, "stable-random");
  const failedReasons: string[] = [];
  if (!labelSnapshot.leakage.protectedHoldout) {
    failedReasons.push("development/holdout label cases overlap");
  }
  if (!labelSnapshot.lns.scaleReadiness.passed) {
    failedReasons.push("source LNS label-scale readiness did not pass");
  }
  if (deterministic.development.decisionCount === 0) {
    failedReasons.push("development decision count is zero");
  }
  if (deterministic.holdout.decisionCount === 0) {
    failedReasons.push("holdout decision count is zero");
  }
  if (deterministic.holdout.opportunityCount === 0) {
    failedReasons.push("holdout improvement opportunity count is zero");
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    bestBaselineName: bestBaseline.name,
    bestBaselineHoldoutCaptureRate: bestBaseline.holdout.improvementCaptureRate,
    bestBaselineHoldoutHitAt1: bestBaseline.holdout.hitAt1,
    bestBaselineHoldoutHitAtK: bestBaseline.holdout.hitAtK,
    deterministicHoldoutCaptureRate: deterministic.holdout.improvementCaptureRate,
    randomHoldoutCaptureRate: random.holdout.improvementCaptureRate
  };
}

function assertLabelSnapshot(value: LearnedRankingLabelSnapshot): void {
  if (value.schemaVersion !== 1 || !Array.isArray(value.lns?.splits)) {
    throw new Error("LNS window ranker baseline input must be a learned-ranking label snapshot.");
  }
  const splitNames = value.lns.splits.map((split) => split.split);
  if (!splitNames.includes("development") || !splitNames.includes("holdout")) {
    throw new Error("LNS window ranker baseline input must include development and holdout LNS splits.");
  }
}

function collectReplayDecisionGroups(
  labelSnapshot: LearnedRankingLabelSnapshot,
  target: LnsWindowRankerLabelTarget,
  allowWeakSeedReplayLabels: boolean
): ReplayDecisionGroup[] {
  return labelSnapshot.lns.splits.flatMap((split) =>
    split.replay.cases.flatMap((benchmarkCase: LnsWindowReplaySnapshotCaseResult): ReplayDecisionGroup[] => {
      const seedKind = inferLnsWindowRankerReplaySeedHintKind(benchmarkCase);
      if (!allowWeakSeedReplayLabels && seedKind === "weak-replay") return [];
      const labels = benchmarkCase.labels.filter((label) => label.usable && hasTargetValue(label, target));
      if (labels.length === 0) return [];
      return [
        {
          split: split.split,
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

function labelSplitSummaries(
  labelSnapshot: LearnedRankingLabelSnapshot,
  groups: readonly ReplayDecisionGroup[],
  target: LnsWindowRankerLabelTarget
): LnsWindowRankerLabelSplitSummary[] {
  return labelSnapshot.lns.splits.map((split) => {
    const splitDecisionGroups = splitGroups(groups, split.split);
    return {
      split: split.split,
      selectedCaseNames: [...split.selectedCaseNames],
      pressureFamilies: [...split.pressureFamilies],
      seeds: [...split.seeds],
      labelCount: split.labelCount,
      usableLabelCount: splitDecisionGroups.reduce((total, group) => total + group.labels.length, 0),
      opportunityCount: splitDecisionGroups.filter(
        (group) => Math.max(...group.labels.map((label) => targetValue(label, target))) > 0
      ).length,
      capturedStatePolicies: [...split.replay.capturedStatePolicies]
    };
  });
}

function buildDatasetFingerprint(labelSnapshot: LearnedRankingLabelSnapshot): string {
  return `fnv1a:${hashString(stableStringify(labelSnapshot.lns))}`;
}

function buildLabelFingerprint(labelSnapshot: LearnedRankingLabelSnapshot): string {
  return `fnv1a:${hashString(stableStringify(labelSnapshot))}`;
}

function modelRecord(model: LnsWindowRankerBaselineModel): Record<string, unknown> {
  return model as unknown as Record<string, unknown>;
}

function summaryMetrics(result: LnsWindowRankerBaselineExperimentResult): Record<string, unknown> {
  return {
    passed: result.evaluation.summary.passed,
    bestBaselineName: result.evaluation.summary.bestBaselineName,
    bestBaselineHoldoutCaptureRate: result.evaluation.summary.bestBaselineHoldoutCaptureRate,
    bestBaselineHoldoutHitAt1: result.evaluation.summary.bestBaselineHoldoutHitAt1,
    bestBaselineHoldoutHitAtK: result.evaluation.summary.bestBaselineHoldoutHitAtK,
    deterministicHoldoutCaptureRate: result.evaluation.summary.deterministicHoldoutCaptureRate,
    randomHoldoutCaptureRate: result.evaluation.summary.randomHoldoutCaptureRate,
    target: result.model.target,
    weakSeedReplayLabelsAllowed: result.model.weakSeedReplayLabelsAllowed,
    developmentDecisionCount: baselineByName(result.evaluation.baselines, "operator-score").development.decisionCount,
    holdoutDecisionCount: baselineByName(result.evaluation.baselines, "operator-score").holdout.decisionCount,
    developmentOpportunityCount: baselineByName(result.evaluation.baselines, "operator-score").development
      .opportunityCount,
    holdoutOpportunityCount: baselineByName(result.evaluation.baselines, "operator-score").holdout.opportunityCount,
    sourceLnsScaleReady: result.audit.sourceLnsScaleReady
  };
}

export function runLnsWindowRankerBaselineExperiment(
  labelSnapshot: LearnedRankingLabelSnapshot,
  options: LnsWindowRankerBaselineRunOptions = {}
): LnsWindowRankerBaselineExperimentResult {
  assertLabelSnapshot(labelSnapshot);
  const randomBaselineSeed = positiveIntegerOrDefault(options.randomBaselineSeed, 17);
  const topK = positiveIntegerOrDefault(options.topK, 3);
  const target = normalizeLnsWindowRankerLabelTarget(options.target);
  const allowWeakSeedReplayLabels = normalizeLnsWindowRankerWeakSeedAllowance(options.allowWeakSeedReplayLabels);
  const groups = collectReplayDecisionGroups(labelSnapshot, target, allowWeakSeedReplayLabels);
  const baselines = buildBaselineEvaluations(groups, randomBaselineSeed, topK, target);
  const summary = buildSummary(labelSnapshot, baselines);
  const model: LnsWindowRankerBaselineModel = {
    schemaVersion: 1,
    modelType: "lns-window-ranking-baseline-sweep",
    purpose: "offline-diagnostics-only",
    trained: false,
    runtimeDefaultChanged: false,
    solverDefaultChanged: false,
    featureSchemaVersion: labelSnapshot.audit.lnsReplay.featureSchemaVersion ?? null,
    topK,
    target,
    weakSeedReplayLabelsAllowed: allowWeakSeedReplayLabels,
    baselineNames: [...LNS_WINDOW_RANKER_BASELINE_NAMES],
    bestBaselineName: summary.bestBaselineName
  };
  const datasetFingerprint = buildDatasetFingerprint(labelSnapshot);
  const labelFingerprint = buildLabelFingerprint(labelSnapshot);
  const modelFingerprint = buildModelExperimentFingerprint(model);
  const splitSummaries = labelSplitSummaries(labelSnapshot, groups, target);

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
      weakSeedReplayLabelsAllowed: allowWeakSeedReplayLabels
    },
    labels: {
      labelCount: labelSnapshot.lns.labelCount,
      usableLabelCount: splitSummaries.reduce((total, split) => total + split.usableLabelCount, 0),
      opportunityCount: splitSummaries.reduce((total, split) => total + split.opportunityCount, 0),
      splits: splitSummaries
    },
    evaluation: {
      baselines,
      summary
    },
    model,
    datasetFingerprint,
    labelFingerprint,
    modelFingerprint
  };
}

export function createLnsWindowRankerBaselineSnapshot(
  result: LnsWindowRankerBaselineExperimentResult
): LnsWindowRankerBaselineExperimentSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function buildLnsWindowRankerBaselineTelemetryManifest(
  result: LnsWindowRankerBaselineExperimentResult,
  options: LnsWindowRankerBaselineTelemetryManifestOptions
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
      "CPU-only LNS window-ranking baseline sweep; no learned runtime scorer or solver default changed."
  });
}

export function buildLnsWindowRankerBaselineRegistryEntryDraft(
  result: LnsWindowRankerBaselineExperimentResult,
  labelSnapshot: LearnedRankingLabelSnapshot,
  options: LnsWindowRankerBaselineRegistryEntryDraftOptions
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
      targetRollForwardFinalLift: result.model.target === "roll-forward-final-lift" ? 1 : 0,
      weakSeedReplayLabelsAllowed: result.model.weakSeedReplayLabelsAllowed ? 1 : 0,
      baselineCount: result.evaluation.baselines.length,
      lnsLabelCount: result.labels.labelCount,
      usableLabelCount: result.labels.usableLabelCount,
      opportunityCount: result.labels.opportunityCount,
      repairTimeLimitSeconds: uniqueBenchmarkValues(
        labelSnapshot.lns.splits.map((split) => split.replay.repairTimeLimitSeconds)
      ),
      maxWindows: uniqueBenchmarkValues(labelSnapshot.lns.splits.map((split) => split.replay.maxWindows)),
      explorationWindowCount: uniqueBenchmarkValues(
        labelSnapshot.lns.splits.map((split) => split.replay.explorationWindowCount)
      ),
      statePolicyCount: uniqueBenchmarkValues(labelSnapshot.lns.splits.flatMap((split) => split.replay.statePolicies))
        .length,
      capturedStatePolicyCount: uniqueBenchmarkValues(
        labelSnapshot.lns.splits.flatMap((split) => split.replay.capturedStatePolicies)
      ).length
    },
    model: modelRecord(result.model),
    decision: options.decision ?? "offline-lns-window-baselines-evidence",
    summary:
      options.summary ??
      `LNS window-ranking baseline sweep selected ${result.evaluation.summary.bestBaselineName} on holdout with ${result.evaluation.summary.bestBaselineHoldoutCaptureRate.toFixed(4)} improvement capture.`,
    labelFingerprint: result.labelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    modelFingerprint: result.modelFingerprint,
    summaryMetrics: summaryMetrics(result)
  });
}

function formatMetric(metrics: LnsWindowRankerMetricSummary): string {
  return `capture=${metrics.improvementCaptureRate.toFixed(4)} hit@1=${metrics.hitAt1.toFixed(4)} hit@k=${metrics.hitAtK.toFixed(4)} regret=${metrics.meanRegret.toFixed(2)} opportunities=${metrics.opportunityCount}/${metrics.decisionCount}`;
}

export function formatLnsWindowRankerBaselineExperiment(result: LnsWindowRankerBaselineExperimentResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window-Ranking Baselines ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(
    `Audit: cpu-only=${result.audit.cpuOnly} runtime-default-changed=${result.audit.runtimeDefaultChanged} source-preset=${result.audit.sourceLabelPreset ?? "none"} source-lns-scale-ready=${result.audit.sourceLnsScaleReady} target=${result.model.target} weak-seed-labels=${result.audit.weakSeedReplayLabelsAllowed}`
  );
  lines.push(
    `Labels: total=${result.labels.labelCount} usable=${result.labels.usableLabelCount} opportunities=${result.labels.opportunityCount} label-fingerprint=${result.labelFingerprint}`
  );
  lines.push(
    `Model: ${result.model.modelType} trained=${result.model.trained} target=${result.model.target} top-k=${result.model.topK} weak-seed-labels=${result.model.weakSeedReplayLabelsAllowed} model-fingerprint=${result.modelFingerprint}`
  );
  for (const split of result.labels.splits) {
    lines.push(
      `- labels ${split.split}: cases=${split.selectedCaseNames.join(", ")} families=${split.pressureFamilies.join(", ")} usable=${split.usableLabelCount} opportunities=${split.opportunityCount} states=${split.capturedStatePolicies.join(",")}`
    );
  }
  for (const baseline of result.evaluation.baselines) {
    lines.push(
      `- baseline ${baseline.name}: development=${formatMetric(baseline.development)} holdout=${formatMetric(baseline.holdout)}`
    );
  }
  lines.push(
    `Gate: passed=${result.evaluation.summary.passed} best-baseline=${result.evaluation.summary.bestBaselineName} holdout-capture=${result.evaluation.summary.bestBaselineHoldoutCaptureRate.toFixed(4)} failures=${result.evaluation.summary.failedReasons.length ? result.evaluation.summary.failedReasons.join("; ") : "none"}`
  );
  lines.push("Decision: offline diagnostics only; no LNS runtime scorer or solver default changed.");
  return lines.join("\n");
}
