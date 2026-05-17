import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
} from "./greedyDeterministicAblations.js";
import {
  createLnsWindowReplaySnapshot,
  runLnsWindowReplayLabels,
} from "./lnsWindowReplayLabels.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS } from "./lns.js";
import {
  benchmarkGeneratedAt,
  countBenchmarkMatches,
  groupBenchmarkValuesBy,
  nonNegativeIntegerOrDefault,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import {
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  buildLnsReplayLabelScaleReadiness,
} from "./lnsReplayLabelReadiness.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkOptions,
  GreedyBenchmarkSuiteResult,
} from "./greedy.js";
import type {
  LnsBenchmarkCase,
  LnsReplayPressureFamilyLabel,
} from "./lns.js";
import type {
  CpSatOptions,
  GreedyConnectivityShadowPlacementTrace,
  GreedyRoadOpportunityCounterfactualTrace,
  GreedyRoadOpportunityTrace,
  LnsOptions,
} from "../core/types.js";
import type {
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel,
} from "./lnsWindowReplayLabels.js";
import type {
  LnsReplayLabelScaleReadiness,
  LnsReplayLabelScaleThresholds,
} from "./lnsReplayLabelReadiness.js";

export {
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  buildLnsReplayLabelScaleReadiness,
} from "./lnsReplayLabelReadiness.js";
export type {
  LnsReplayLabelFamilyScaleSummary,
  LnsReplayLabelScaleReadiness,
  LnsReplayLabelScaleThresholds,
  LnsReplayLabelSplitScaleReadiness,
} from "./lnsReplayLabelReadiness.js";

export type LearnedRankingLabelSplit = "development" | "holdout";

export type GreedyOrderingLabelSource =
  | "connectivity-shadow-decision"
  | "road-opportunity-counterfactual";

export interface LearnedRankingLabelSplitConfig {
  split: LearnedRankingLabelSplit;
  greedyCaseNames: readonly string[];
  lnsCaseNames: readonly string[];
}

export interface GreedyOrderingPlacementFeatures {
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  score?: number;
  shadowPenalty?: number;
  reachableBefore?: number;
  reachableAfter?: number;
  lostCells?: number;
  footprintCells?: number;
  disconnectedCells?: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
}

export interface GreedyOrderingLabel {
  id: string;
  split: LearnedRankingLabelSplit;
  caseName: string;
  seed: number;
  source: GreedyOrderingLabelSource;
  phase: string;
  target: "lower-connectivity-shadow" | "accepted-near-miss";
  selected: GreedyOrderingPlacementFeatures;
  rejected: GreedyOrderingPlacementFeatures;
  margin: number;
  reason?: GreedyRoadOpportunityCounterfactualTrace["reason"];
}

export interface GreedyOrderingLabelSplitResult {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  seeds: number[];
  labelCount: number;
  sourceCounts: Record<GreedyOrderingLabelSource, number>;
  labels: GreedyOrderingLabel[];
}

export interface LnsReplayLabelSplitResult {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  statusCounts: Record<LnsWindowReplaySnapshotLabel["status"], number>;
  replay: LnsWindowReplaySnapshot;
}

export interface LnsReplayPairwiseWindowSummary {
  windowIndex: number;
  selectionSource: LnsWindowReplaySnapshotLabel["selectionSource"];
  selectedByBaseline: boolean;
  totalPopulation: number;
  populationDelta: number;
  status: LnsWindowReplaySnapshotLabel["status"];
  window: LnsWindowReplaySnapshotLabel["window"];
  features: LnsWindowReplaySnapshotLabel["features"];
}

export interface LnsReplayPairwiseLabel {
  id: string;
  split: LearnedRankingLabelSplit;
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  labelIndex: number;
  target: "higher-window-improvement";
  status: "ranked" | "tie";
  margin: number;
  usable: true;
  better: LnsReplayPairwiseWindowSummary;
  worse: LnsReplayPairwiseWindowSummary;
}

export interface LnsReplayPairwiseFamilyScaleSummary {
  pressureFamily: LnsReplayPressureFamilyLabel;
  caseNames: string[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
}

export interface LnsReplayPairwiseSplitScaleReadiness {
  split: LearnedRankingLabelSplit;
  pressureFamilyCount: number;
  seedCount: number;
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
  passed: boolean;
  failedReasons: string[];
  families: LnsReplayPairwiseFamilyScaleSummary[];
}

export interface LnsReplayPairwiseScaleReadiness {
  thresholds: LnsReplayLabelScaleThresholds;
  passed: boolean;
  splitReadiness: LnsReplayPairwiseSplitScaleReadiness[];
}

export interface LnsReplayPairwiseSplitResult {
  split: LearnedRankingLabelSplit;
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
  labels: LnsReplayPairwiseLabel[];
}

export interface LearnedRankingLeakageReport {
  developmentGreedyCases: string[];
  holdoutGreedyCases: string[];
  developmentLnsCases: string[];
  holdoutLnsCases: string[];
  greedyOverlap: string[];
  lnsOverlap: string[];
  protectedHoldout: boolean;
}

export interface LearnedRankingAuditMetadata {
  learnedModel: null;
  greedy: {
    profile: true;
    connectivityShadowScoring: true;
  };
  lnsReplay: {
    cpSatNumWorkers: 1;
    incumbentStatePolicy: "initial-incumbent";
    candidateWindowPolicy: "baseline-ranked-top-k" | "baseline-ranked-top-k-plus-tail-exploration";
    explorationWindowCount: number;
  };
}

export interface LearnedRankingLabelSuiteResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  splitCount: number;
  audit: LearnedRankingAuditMetadata;
  greedy: {
    labelCount: number;
    sourceCounts: Record<GreedyOrderingLabelSource, number>;
    splits: GreedyOrderingLabelSplitResult[];
  };
  lns: {
    labelCount: number;
    rawReplayScaleReadiness: LnsReplayLabelScaleReadiness<LearnedRankingLabelSplit>;
    scaleReadiness: LnsReplayPairwiseScaleReadiness;
    splits: LnsReplayLabelSplitResult[];
    pairwiseSplits: LnsReplayPairwiseSplitResult[];
  };
  leakage: LearnedRankingLeakageReport;
}

export interface LearnedRankingLabelSnapshot
  extends Omit<LearnedRankingLabelSuiteResult, "generatedAt"> {}

export interface LearnedRankingLabelRunOptions {
  seeds?: readonly number[];
  splitConfigs?: readonly LearnedRankingLabelSplitConfig[];
  greedyCorpus?: readonly GreedyBenchmarkCase[];
  lnsCorpus?: readonly LnsBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  maxWindows?: number;
  repairTimeLimitSeconds?: number;
  explorationWindowCount?: number;
}

export const DEFAULT_LEARNED_RANKING_LABEL_SPLITS: readonly LearnedRankingLabelSplitConfig[] =
  Object.freeze([
    {
      split: "development",
      greedyCaseNames: [
        "cap-sweep-mixed",
        "service-local-neighborhood",
        "step14-service-lookahead-reranker",
        "row0-corridor-repair-pressure",
      ],
      lnsCaseNames: [
        "compact-service-repair",
        "lns-service-split-pressure",
        "seeded-service-anchor-pressure",
        "lns-corridor-squeeze-pressure",
        "lns-gate-split-pressure",
        "lns-footprint-mix-pressure",
      ],
    },
    {
      split: "holdout",
      greedyCaseNames: DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES.filter((name) =>
        name === "fixed-service-realization-complete"
        || name === "geometry-occupancy-hot-path"
        || name === "typed-footprint-pressure"
        || name === "typed-availability-pressure"
      ),
      lnsCaseNames: [
        "row0-anchor-repair",
        "lns-corridor-split-pressure",
        "lns-gate-choke-pressure",
        "lns-anchor-split-pressure",
        "lns-footprint-split-pressure",
        "lns-service-overlap-pressure",
      ],
    },
  ]);

function emptySourceCounts(): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": 0,
    "road-opportunity-counterfactual": 0,
  };
}

function sumGreedySourceCounts(
  splits: readonly GreedyOrderingLabelSplitResult[]
): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision":
      sumBenchmarkBy(splits, (split) => split.sourceCounts["connectivity-shadow-decision"]),
    "road-opportunity-counterfactual":
      sumBenchmarkBy(splits, (split) => split.sourceCounts["road-opportunity-counterfactual"]),
  };
}

function countSources(labels: readonly GreedyOrderingLabel[]): Record<GreedyOrderingLabelSource, number> {
  const counts = emptySourceCounts();
  for (const label of labels) {
    counts[label.source]++;
  }
  return counts;
}

function emptyLnsStatusCounts(): Record<LnsWindowReplaySnapshotLabel["status"], number> {
  return {
    improved: 0,
    neutral: 0,
    regressed: 0,
    invalid: 0,
    "recoverable-failure": 0,
  };
}

function countLnsStatuses(
  replay: LnsWindowReplaySnapshot
): Record<LnsWindowReplaySnapshotLabel["status"], number> {
  const counts = emptyLnsStatusCounts();
  for (const benchmarkCase of replay.cases) {
    for (const label of benchmarkCase.labels) {
      counts[label.status]++;
    }
  }
  return counts;
}

function countUsableLnsLabels(replay: LnsWindowReplaySnapshot): number {
  return sumBenchmarkBy(
    replay.cases,
    (benchmarkCase) => countBenchmarkMatches(benchmarkCase.labels, (label) => label.usable)
  );
}

function lnsPairwiseWindowSummary(label: LnsWindowReplaySnapshotLabel): LnsReplayPairwiseWindowSummary {
  return {
    windowIndex: label.windowIndex,
    selectionSource: label.selectionSource,
    selectedByBaseline: label.selectedByBaseline,
    totalPopulation: label.totalPopulation,
    populationDelta: label.populationDelta,
    status: label.status,
    window: { ...label.window },
    features: { ...label.features },
  };
}

function pairwiseLabelId(
  split: LearnedRankingLabelSplit,
  caseName: string,
  seed: number | null,
  labelIndex: number
): string {
  return `${split}:${caseName}:${seed ?? "case-default"}:lns-window-pair:${labelIndex}`;
}

function buildAllPairwiseLabelsForSplit(
  split: LearnedRankingLabelSplit,
  replay: LnsWindowReplaySnapshot
): LnsReplayPairwiseLabel[] {
  const labels: LnsReplayPairwiseLabel[] = [];
  for (const benchmarkCase of replay.cases) {
    const usableLabels = benchmarkCase.labels.filter((label) => label.usable);
    let labelIndex = 0;
    for (let leftIndex = 0; leftIndex < usableLabels.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < usableLabels.length; rightIndex += 1) {
        const left = usableLabels[leftIndex]!;
        const right = usableLabels[rightIndex]!;
        const leftWins = left.populationDelta >= right.populationDelta;
        const better = leftWins ? left : right;
        const worse = leftWins ? right : left;
        const margin = Math.abs(left.populationDelta - right.populationDelta);
        labels.push({
          id: pairwiseLabelId(split, benchmarkCase.name, benchmarkCase.seed, labelIndex++),
          split,
          caseName: benchmarkCase.name,
          pressureFamily: benchmarkCase.pressureFamily,
          seed: benchmarkCase.seed,
          labelIndex,
          target: "higher-window-improvement",
          status: margin > 0 ? "ranked" : "tie",
          margin,
          usable: true,
          better: lnsPairwiseWindowSummary(better),
          worse: lnsPairwiseWindowSummary(worse),
        });
      }
    }
  }
  return labels;
}

function rotateTake<T>(values: readonly T[], count: number, offset: number): T[] {
  if (count <= 0 || values.length === 0) return [];
  const out: T[] = [];
  for (let index = 0; index < values.length && out.length < count; index += 1) {
    out.push(values[(index + offset) % values.length]!);
  }
  return out;
}

function balancePairwiseLabels(
  labels: readonly LnsReplayPairwiseLabel[],
  thresholds = DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS
): LnsReplayPairwiseLabel[] {
  const nonNeutral = labels.filter((label) => label.status === "ranked");
  const neutral = labels.filter((label) => label.status === "tie");
  const selected = new Map<string, LnsReplayPairwiseLabel>();
  for (const label of nonNeutral) selected.set(label.id, label);

  const familyGroups = groupBenchmarkValuesBy(labels, (label) => label.pressureFamily);
  let offset = 0;
  for (const familyLabels of familyGroups.values()) {
    const family = familyLabels[0]?.pressureFamily;
    if (family === undefined) continue;
    const selectedFamilyLabels = () => [...selected.values()].filter((label) => label.pressureFamily === family);
    const selectedFamilySeeds = () => new Set(
      selectedFamilyLabels()
        .map((label) => label.seed)
        .filter((seed): seed is number => seed !== null)
    );
    const labelsBySeed = groupBenchmarkValuesBy(
      familyLabels.filter((label) => label.seed !== null),
      (label) => label.seed
    );
    for (const [seed, seedLabels] of labelsBySeed.entries()) {
      if (selectedFamilySeeds().size >= thresholds.minSeedsPerFamily) break;
      if (selectedFamilySeeds().has(seed as number)) continue;
      const candidate = seedLabels.find((label) => !selected.has(label.id));
      if (candidate) selected.set(candidate.id, candidate);
    }
    const selectedFamilyCount = countBenchmarkMatches([...selected.values()], (label) =>
      label.pressureFamily === family
    );
    const needed = Math.max(0, thresholds.minUsableLabelsPerFamily - selectedFamilyCount);
    const neutralFamilyLabels = familyLabels.filter((label) => label.status === "tie" && !selected.has(label.id));
    for (const label of rotateTake(neutralFamilyLabels, needed, offset++)) {
      selected.set(label.id, label);
    }
  }

  const selectedValues = () => [...selected.values()];
  const maxNeutralCount = nonNeutral.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.floor((thresholds.maxNeutralLabelRatio / (1 - thresholds.maxNeutralLabelRatio)) * nonNeutral.length);
  let selectedNeutralCount = countBenchmarkMatches(selectedValues(), (label) => label.status === "tie");
  const totalNeeded = Math.max(0, thresholds.minUsableLabelsPerSplit - selected.size);
  const neutralBudget = Math.max(0, maxNeutralCount - selectedNeutralCount);
  const extraNeutralCount = Math.min(totalNeeded, neutralBudget);
  const remainingNeutral = neutral.filter((label) => !selected.has(label.id));
  for (const label of rotateTake(remainingNeutral, extraNeutralCount, offset)) {
    selected.set(label.id, label);
  }
  selectedNeutralCount = countBenchmarkMatches(selectedValues(), (label) => label.status === "tie");
  if (selectedNeutralCount > maxNeutralCount) {
    const selectedNonNeutral = selectedValues().filter((label) => label.status === "ranked");
    const selectedNeutral = selectedValues().filter((label) => label.status === "tie").slice(0, maxNeutralCount);
    return [...selectedNonNeutral, ...selectedNeutral].sort(comparePairwiseLabels);
  }

  return selectedValues().sort(comparePairwiseLabels);
}

function comparePairwiseLabels(left: LnsReplayPairwiseLabel, right: LnsReplayPairwiseLabel): number {
  return left.split.localeCompare(right.split)
    || left.pressureFamily.localeCompare(right.pressureFamily)
    || left.caseName.localeCompare(right.caseName)
    || (left.seed ?? -1) - (right.seed ?? -1)
    || right.margin - left.margin
    || left.id.localeCompare(right.id);
}

function summarizePairwiseFamily(
  pressureFamily: LnsReplayPressureFamilyLabel,
  labels: readonly LnsReplayPairwiseLabel[]
): LnsReplayPairwiseFamilyScaleSummary {
  const usableLabels = labels.filter((label) => label.usable);
  const nonNeutralUsableLabelCount = countBenchmarkMatches(usableLabels, (label) => label.status === "ranked");
  const neutralUsableLabelCount = countBenchmarkMatches(usableLabels, (label) => label.status === "tie");
  return {
    pressureFamily,
    caseNames: uniqueBenchmarkValuesBy(labels, (label) => label.caseName),
    seeds: uniqueBenchmarkValues(
      labels
        .map((label) => label.seed)
        .filter((seed): seed is number => seed !== null)
    ),
    labelCount: labels.length,
    usableLabelCount: usableLabels.length,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio: usableLabels.length === 0 ? 1 : neutralUsableLabelCount / usableLabels.length,
  };
}

function buildPairwiseSplitReadiness(
  split: LnsReplayPairwiseSplitResult,
  thresholds: LnsReplayLabelScaleThresholds
): LnsReplayPairwiseSplitScaleReadiness {
  const families = [
    ...groupBenchmarkValuesBy(split.labels, (label) => label.pressureFamily).entries(),
  ]
    .map(([pressureFamily, labels]) => summarizePairwiseFamily(pressureFamily, labels))
    .sort((left, right) => left.pressureFamily.localeCompare(right.pressureFamily));
  const usableLabelCount = sumBenchmarkBy(families, (family) => family.usableLabelCount);
  const nonNeutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.nonNeutralUsableLabelCount);
  const neutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.neutralUsableLabelCount);
  const neutralLabelRatio = usableLabelCount === 0 ? 1 : neutralUsableLabelCount / usableLabelCount;
  const failedReasons: string[] = [];

  if (families.length < thresholds.minPressureFamilies) {
    failedReasons.push(`pressure-families ${families.length}/${thresholds.minPressureFamilies}`);
  }
  if (usableLabelCount < thresholds.minUsableLabelsPerSplit) {
    failedReasons.push(`usable-labels ${usableLabelCount}/${thresholds.minUsableLabelsPerSplit}`);
  }
  if (nonNeutralUsableLabelCount < thresholds.minNonNeutralLabelsPerSplit) {
    failedReasons.push(`non-neutral-labels ${nonNeutralUsableLabelCount}/${thresholds.minNonNeutralLabelsPerSplit}`);
  }
  if (neutralLabelRatio > thresholds.maxNeutralLabelRatio) {
    failedReasons.push(`neutral-ratio ${neutralLabelRatio.toFixed(3)}/${thresholds.maxNeutralLabelRatio}`);
  }
  for (const family of families) {
    if (family.seeds.length < thresholds.minSeedsPerFamily) {
      failedReasons.push(`${family.pressureFamily} seeds ${family.seeds.length}/${thresholds.minSeedsPerFamily}`);
    }
    if (family.usableLabelCount < thresholds.minUsableLabelsPerFamily) {
      failedReasons.push(`${family.pressureFamily} usable-labels ${family.usableLabelCount}/${thresholds.minUsableLabelsPerFamily}`);
    }
  }

  return {
    split: split.split,
    pressureFamilyCount: families.length,
    seedCount: split.seeds.length,
    usableLabelCount,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio,
    passed: failedReasons.length === 0,
    failedReasons,
    families,
  };
}

function buildPairwiseScaleReadiness(
  splits: readonly LnsReplayPairwiseSplitResult[],
  thresholds: LnsReplayLabelScaleThresholds = DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS
): LnsReplayPairwiseScaleReadiness {
  const splitReadiness = splits.map((split) => buildPairwiseSplitReadiness(split, thresholds));
  return {
    thresholds: { ...thresholds },
    passed: splitReadiness.length > 0 && splitReadiness.every((split) => split.passed),
    splitReadiness,
  };
}

function buildPairwiseSplitResult(
  split: LearnedRankingLabelSplit,
  selectedCaseNames: readonly string[],
  replay: LnsWindowReplaySnapshot
): LnsReplayPairwiseSplitResult {
  const labels = balancePairwiseLabels(buildAllPairwiseLabelsForSplit(split, replay));
  const usableLabelCount = countBenchmarkMatches(labels, (label) => label.usable);
  const nonNeutralUsableLabelCount = countBenchmarkMatches(labels, (label) => label.status === "ranked");
  const neutralUsableLabelCount = countBenchmarkMatches(labels, (label) => label.status === "tie");
  return {
    split,
    selectedCaseNames: [...selectedCaseNames],
    pressureFamilies: uniqueBenchmarkValuesBy(replay.cases, (benchmarkCase) => benchmarkCase.pressureFamily),
    seeds: [...replay.seeds],
    labelCount: labels.length,
    usableLabelCount,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio: usableLabelCount === 0 ? 1 : neutralUsableLabelCount / usableLabelCount,
    labels,
  };
}

function placementFeaturesFromShadowTrace(
  placement: GreedyConnectivityShadowPlacementTrace,
  shadowPenalty: number
): GreedyOrderingPlacementFeatures {
  return {
    r: placement.r,
    c: placement.c,
    rows: placement.rows,
    cols: placement.cols,
    roadCost: placement.roadCost,
    shadowPenalty,
    ...(placement.typeIndex === undefined ? {} : { typeIndex: placement.typeIndex }),
    ...(placement.bonus === undefined ? {} : { bonus: placement.bonus }),
    ...(placement.range === undefined ? {} : { range: placement.range }),
  };
}

function placementFeaturesFromOpportunityTrace(
  trace: GreedyRoadOpportunityTrace
): GreedyOrderingPlacementFeatures {
  return {
    r: trace.r,
    c: trace.c,
    rows: trace.rows,
    cols: trace.cols,
    roadCost: trace.roadCost,
    ...(trace.score === undefined ? {} : { score: trace.score }),
    reachableBefore: trace.reachableBefore,
    reachableAfter: trace.reachableAfter,
    lostCells: trace.lostCells,
    footprintCells: trace.footprintCells,
    disconnectedCells: trace.disconnectedCells,
    ...(trace.typeIndex === undefined ? {} : { typeIndex: trace.typeIndex }),
    ...(trace.bonus === undefined ? {} : { bonus: trace.bonus }),
    ...(trace.range === undefined ? {} : { range: trace.range }),
  };
}

function placementFeaturesFromCounterfactualTrace(
  trace: GreedyRoadOpportunityCounterfactualTrace
): GreedyOrderingPlacementFeatures {
  return {
    r: trace.r,
    c: trace.c,
    rows: trace.rows,
    cols: trace.cols,
    roadCost: trace.roadCost,
    score: trace.score,
    reachableBefore: trace.reachableBefore,
    reachableAfter: trace.reachableAfter,
    lostCells: trace.lostCells,
    footprintCells: trace.footprintCells,
    disconnectedCells: trace.disconnectedCells,
    ...(trace.typeIndex === undefined ? {} : { typeIndex: trace.typeIndex }),
    ...(trace.bonus === undefined ? {} : { bonus: trace.bonus }),
    ...(trace.range === undefined ? {} : { range: trace.range }),
  };
}

function samePlacement(
  left: GreedyConnectivityShadowPlacementTrace,
  right: GreedyConnectivityShadowPlacementTrace
): boolean {
  return left.r === right.r
    && left.c === right.c
    && left.rows === right.rows
    && left.cols === right.cols
    && left.roadCost === right.roadCost
    && left.typeIndex === right.typeIndex
    && left.bonus === right.bonus
    && left.range === right.range;
}

function labelId(
  split: LearnedRankingLabelSplit,
  caseName: string,
  seed: number,
  source: GreedyOrderingLabelSource,
  index: number
): string {
  return `${split}:${caseName}:${seed}:${source}:${index}`;
}

export function collectGreedyOrderingLabelsFromBenchmarkSuite(
  result: GreedyBenchmarkSuiteResult,
  split: LearnedRankingLabelSplit,
  seed: number
): GreedyOrderingLabel[] {
  const labels: GreedyOrderingLabel[] = [];

  for (const benchmark of result.results) {
    const profile = benchmark.greedyProfile;
    if (!profile) continue;

    let labelIndex = 0;
    for (const decision of profile.connectivityShadowDecisions ?? []) {
      const selectedIsCandidate = samePlacement(decision.chosen, decision.candidate);
      const selectedPenalty = selectedIsCandidate
        ? decision.candidateShadowPenalty
        : decision.incumbentShadowPenalty;
      const rejectedPenalty = selectedIsCandidate
        ? decision.incumbentShadowPenalty
        : decision.candidateShadowPenalty;
      labels.push({
        id: labelId(split, benchmark.name, seed, "connectivity-shadow-decision", labelIndex++),
        split,
        caseName: benchmark.name,
        seed,
        source: "connectivity-shadow-decision",
        phase: decision.phase,
        target: "lower-connectivity-shadow",
        selected: placementFeaturesFromShadowTrace(decision.chosen, selectedPenalty),
        rejected: placementFeaturesFromShadowTrace(decision.rejected, rejectedPenalty),
        margin: rejectedPenalty - selectedPenalty,
      });
    }

    for (const trace of profile.roadOpportunityTraces ?? []) {
      for (const counterfactual of trace.counterfactuals ?? []) {
        labels.push({
          id: labelId(split, benchmark.name, seed, "road-opportunity-counterfactual", labelIndex++),
          split,
          caseName: benchmark.name,
          seed,
          source: "road-opportunity-counterfactual",
          phase: trace.phase,
          target: "accepted-near-miss",
          selected: placementFeaturesFromOpportunityTrace(trace),
          rejected: placementFeaturesFromCounterfactualTrace(counterfactual),
          margin: counterfactual.lostCells - trace.lostCells,
          reason: counterfactual.reason,
        });
      }
    }
  }

  return labels;
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return uniqueBenchmarkValues(left.filter((entry) => rightSet.has(entry)));
}

function validateSplitConfigs(splitConfigs: readonly LearnedRankingLabelSplitConfig[]): void {
  const splits = splitConfigs.map((config) => config.split);
  if (new Set(splits).size !== splits.length) {
    throw new Error("Learned ranking label split configs must use each split at most once.");
  }
  if (!splits.includes("development") || !splits.includes("holdout")) {
    throw new Error("Learned ranking label collection requires development and holdout splits.");
  }
  for (const config of splitConfigs) {
    if (config.greedyCaseNames.length === 0) {
      throw new Error(`Learned ranking ${config.split} split must include at least one Greedy case.`);
    }
    if (config.lnsCaseNames.length === 0) {
      throw new Error(`Learned ranking ${config.split} split must include at least one LNS case.`);
    }
    if (uniqueBenchmarkValues(config.greedyCaseNames).length !== config.greedyCaseNames.length) {
      throw new Error(`Learned ranking ${config.split} split has duplicate Greedy cases.`);
    }
    if (uniqueBenchmarkValues(config.lnsCaseNames).length !== config.lnsCaseNames.length) {
      throw new Error(`Learned ranking ${config.split} split has duplicate LNS cases.`);
    }
  }
}

function buildLeakageReport(
  splitConfigs: readonly LearnedRankingLabelSplitConfig[]
): LearnedRankingLeakageReport {
  const development = splitConfigs.find((config) => config.split === "development")!;
  const holdout = splitConfigs.find((config) => config.split === "holdout")!;
  const greedyOverlap = intersection(development.greedyCaseNames, holdout.greedyCaseNames);
  const lnsOverlap = intersection(development.lnsCaseNames, holdout.lnsCaseNames);
  return {
    developmentGreedyCases: [...development.greedyCaseNames],
    holdoutGreedyCases: [...holdout.greedyCaseNames],
    developmentLnsCases: [...development.lnsCaseNames],
    holdoutLnsCases: [...holdout.lnsCaseNames],
    greedyOverlap,
    lnsOverlap,
    protectedHoldout: greedyOverlap.length === 0 && lnsOverlap.length === 0,
  };
}

function assertProtectedHoldout(leakage: LearnedRankingLeakageReport): void {
  if (!leakage.protectedHoldout) {
    const overlaps = [
      leakage.greedyOverlap.length ? `Greedy: ${leakage.greedyOverlap.join(", ")}` : null,
      leakage.lnsOverlap.length ? `LNS: ${leakage.lnsOverlap.join(", ")}` : null,
    ].filter((entry): entry is string => entry !== null);
    throw new Error(`Learned ranking development/holdout split overlap is not allowed. ${overlaps.join("; ")}`);
  }
}

export function runLearnedRankingLabelSuite(
  options: LearnedRankingLabelRunOptions = {}
): LearnedRankingLabelSuiteResult {
  const splitConfigs = options.splitConfigs ?? DEFAULT_LEARNED_RANKING_LABEL_SPLITS;
  validateSplitConfigs(splitConfigs);
  const leakage = buildLeakageReport(splitConfigs);
  assertProtectedHoldout(leakage);

  const seeds = normalizeBenchmarkSeeds(options.seeds, "learned ranking label seeds")
    ?? [...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS];
  const greedyCorpus = options.greedyCorpus ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS;
  const lnsCorpus = options.lnsCorpus ?? DEFAULT_LNS_REPLAY_LABEL_CORPUS;
  const explorationWindowCount = nonNegativeIntegerOrDefault(options.explorationWindowCount, 0);
  const greedySplits: GreedyOrderingLabelSplitResult[] = [];
  const lnsSplits: LnsReplayLabelSplitResult[] = [];
  const lnsPairwiseSplits: LnsReplayPairwiseSplitResult[] = [];

  for (const config of splitConfigs) {
    const greedyLabels = seeds.flatMap((seed) => {
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
    greedySplits.push({
      split: config.split,
      selectedCaseNames: [...config.greedyCaseNames],
      seeds: [...seeds],
      labelCount: greedyLabels.length,
      sourceCounts: countSources(greedyLabels),
      labels: greedyLabels,
    });

    const lnsReplay = runLnsWindowReplayLabels(lnsCorpus, {
      names: [...config.lnsCaseNames],
      seeds,
      lns: options.lns,
      cpSat: options.cpSat,
      maxWindows: options.maxWindows,
      explorationWindowCount,
      repairTimeLimitSeconds: options.repairTimeLimitSeconds,
    });
    const replaySnapshot = createLnsWindowReplaySnapshot(lnsReplay);
    lnsSplits.push({
      split: config.split,
      selectedCaseNames: [...config.lnsCaseNames],
      pressureFamilies: [...replaySnapshot.pressureFamilies],
      seeds: [...seeds],
      labelCount: lnsReplay.labelCount,
      usableLabelCount: countUsableLnsLabels(replaySnapshot),
      statusCounts: countLnsStatuses(replaySnapshot),
      replay: replaySnapshot,
    });
    lnsPairwiseSplits.push(buildPairwiseSplitResult(config.split, config.lnsCaseNames, replaySnapshot));
  }

  const greedySourceCounts = sumGreedySourceCounts(greedySplits);
  const rawReplayScaleReadiness = buildLnsReplayLabelScaleReadiness(lnsSplits);
  const pairwiseScaleReadiness = buildPairwiseScaleReadiness(lnsPairwiseSplits);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...seeds],
    splitCount: splitConfigs.length,
    audit: {
      learnedModel: null,
      greedy: {
        profile: true,
        connectivityShadowScoring: true,
      },
      lnsReplay: {
        cpSatNumWorkers: 1,
        incumbentStatePolicy: "initial-incumbent",
        candidateWindowPolicy: explorationWindowCount > 0
          ? "baseline-ranked-top-k-plus-tail-exploration"
          : "baseline-ranked-top-k",
        explorationWindowCount,
      },
    },
    greedy: {
      labelCount: sumBenchmarkBy(greedySplits, (split) => split.labelCount),
      sourceCounts: greedySourceCounts,
      splits: greedySplits,
    },
    lns: {
      labelCount: sumBenchmarkBy(lnsSplits, (split) => split.labelCount),
      rawReplayScaleReadiness,
      scaleReadiness: pairwiseScaleReadiness,
      splits: lnsSplits,
      pairwiseSplits: lnsPairwiseSplits,
    },
    leakage,
  };
}

export function createLearnedRankingLabelSnapshot(
  result: LearnedRankingLabelSuiteResult
): LearnedRankingLabelSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

function formatCaseList(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

export function formatLearnedRankingLabelSuite(result: LearnedRankingLabelSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Low-Risk Learned Ranking Labels ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(
    `Audit: learned-model=${result.audit.learnedModel ?? "none"} greedy-profile=${result.audit.greedy.profile} greedy-connectivity-shadow=${result.audit.greedy.connectivityShadowScoring} lns-cp-sat-workers=${result.audit.lnsReplay.cpSatNumWorkers} lns-state=${result.audit.lnsReplay.incumbentStatePolicy} lns-windows=${result.audit.lnsReplay.candidateWindowPolicy} lns-exploration=${result.audit.lnsReplay.explorationWindowCount}`
  );
  lines.push(
    `Leakage: protected-holdout=${result.leakage.protectedHoldout} greedy-overlap=${formatCaseList(result.leakage.greedyOverlap)} lns-overlap=${formatCaseList(result.leakage.lnsOverlap)}`
  );
  lines.push(
    `Greedy labels: total=${result.greedy.labelCount} connectivity-shadow=${result.greedy.sourceCounts["connectivity-shadow-decision"]} road-opportunity=${result.greedy.sourceCounts["road-opportunity-counterfactual"]}`
  );
  for (const split of result.greedy.splits) {
    lines.push(
      `- greedy ${split.split}: cases=${split.selectedCaseNames.join(", ")} labels=${split.labelCount} connectivity-shadow=${split.sourceCounts["connectivity-shadow-decision"]} road-opportunity=${split.sourceCounts["road-opportunity-counterfactual"]}`
    );
  }
  lines.push(`LNS replay labels: total=${result.lns.labelCount}`);
  lines.push(`LNS raw replay-scale ready=${result.lns.rawReplayScaleReadiness.passed}`);
  for (const readiness of result.lns.rawReplayScaleReadiness.splitReadiness) {
    lines.push(
      `- lns-raw-scale ${readiness.split}: ready=${readiness.passed} families=${readiness.pressureFamilyCount} usable=${readiness.usableLabelCount} non-neutral=${readiness.nonNeutralUsableLabelCount} neutral-ratio=${readiness.neutralLabelRatio.toFixed(3)} failures=${readiness.failedReasons.length ? readiness.failedReasons.join("; ") : "none"}`
    );
  }
  lines.push(`LNS label-scale ready=${result.lns.scaleReadiness.passed}`);
  lines.push(`LNS pairwise label-scale ready=${result.lns.scaleReadiness.passed}`);
  for (const readiness of result.lns.scaleReadiness.splitReadiness) {
    lines.push(
      `- lns-pairwise-scale ${readiness.split}: ready=${readiness.passed} families=${readiness.pressureFamilyCount} usable=${readiness.usableLabelCount} non-neutral=${readiness.nonNeutralUsableLabelCount} neutral-ratio=${readiness.neutralLabelRatio.toFixed(3)} failures=${readiness.failedReasons.length ? readiness.failedReasons.join("; ") : "none"}`
    );
  }
  for (const split of result.lns.splits) {
    lines.push(
      `- lns ${split.split}: cases=${split.selectedCaseNames.join(", ")} families=${split.pressureFamilies.join(", ")} labels=${split.labelCount} usable=${split.usableLabelCount} improved=${split.statusCounts.improved} neutral=${split.statusCounts.neutral} regressed=${split.statusCounts.regressed} invalid=${split.statusCounts.invalid} recoverable-failure=${split.statusCounts["recoverable-failure"]} repair=${split.replay.repairTimeLimitSeconds}s max-windows=${split.replay.maxWindows} exploration=${split.replay.explorationWindowCount}`
    );
  }
  for (const split of result.lns.pairwiseSplits) {
    lines.push(
      `- lns-pairwise ${split.split}: cases=${split.selectedCaseNames.join(", ")} families=${split.pressureFamilies.join(", ")} labels=${split.labelCount} usable=${split.usableLabelCount} non-neutral=${split.nonNeutralUsableLabelCount} neutral=${split.neutralUsableLabelCount} neutral-ratio=${split.neutralLabelRatio.toFixed(3)}`
    );
  }
  return lines.join("\n");
}
