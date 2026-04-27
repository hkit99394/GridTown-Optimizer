import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
} from "./greedyDeterministicAblations.js";
import {
  createLnsWindowReplaySnapshot,
  runLnsWindowReplayLabels,
} from "./lnsWindowReplayLabels.js";
import {
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS,
} from "./lnsNeighborhoodAblations.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkOptions,
  GreedyBenchmarkSuiteResult,
} from "./greedy.js";
import type {
  LnsBenchmarkCase,
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
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  statusCounts: Record<LnsWindowReplaySnapshotLabel["status"], number>;
  replay: LnsWindowReplaySnapshot;
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
    candidateWindowPolicy: "baseline-ranked-top-k";
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
    splits: LnsReplayLabelSplitResult[];
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
        "seeded-service-anchor-pressure",
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
      lnsCaseNames: DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES.filter((name) =>
        name === "typed-housing-single"
        || name === "row0-anchor-repair"
      ),
    },
  ]);

function emptySourceCounts(): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": 0,
    "road-opportunity-counterfactual": 0,
  };
}

function addSourceCounts(
  left: Record<GreedyOrderingLabelSource, number>,
  right: Record<GreedyOrderingLabelSource, number>
): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision":
      left["connectivity-shadow-decision"] + right["connectivity-shadow-decision"],
    "road-opportunity-counterfactual":
      left["road-opportunity-counterfactual"] + right["road-opportunity-counterfactual"],
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
  return replay.cases.reduce(
    (caseTotal, benchmarkCase) =>
      caseTotal + benchmarkCase.labels.filter((label) => label.usable).length,
    0
  );
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return unique(left.filter((entry) => rightSet.has(entry)));
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
    if (unique(config.greedyCaseNames).length !== config.greedyCaseNames.length) {
      throw new Error(`Learned ranking ${config.split} split has duplicate Greedy cases.`);
    }
    if (unique(config.lnsCaseNames).length !== config.lnsCaseNames.length) {
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
  const lnsCorpus = options.lnsCorpus ?? DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CORPUS;
  const greedySplits: GreedyOrderingLabelSplitResult[] = [];
  const lnsSplits: LnsReplayLabelSplitResult[] = [];

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
      repairTimeLimitSeconds: options.repairTimeLimitSeconds,
    });
    const replaySnapshot = createLnsWindowReplaySnapshot(lnsReplay);
    lnsSplits.push({
      split: config.split,
      selectedCaseNames: [...config.lnsCaseNames],
      seeds: [...seeds],
      labelCount: lnsReplay.labelCount,
      usableLabelCount: countUsableLnsLabels(replaySnapshot),
      statusCounts: countLnsStatuses(replaySnapshot),
      replay: replaySnapshot,
    });
  }

  const greedySourceCounts = greedySplits.reduce(
    (counts, split) => addSourceCounts(counts, split.sourceCounts),
    emptySourceCounts()
  );

  return {
    generatedAt: new Date().toISOString(),
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
        candidateWindowPolicy: "baseline-ranked-top-k",
      },
    },
    greedy: {
      labelCount: greedySplits.reduce((total, split) => total + split.labelCount, 0),
      sourceCounts: greedySourceCounts,
      splits: greedySplits,
    },
    lns: {
      labelCount: lnsSplits.reduce((total, split) => total + split.labelCount, 0),
      splits: lnsSplits,
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
    `Audit: learned-model=${result.audit.learnedModel ?? "none"} greedy-profile=${result.audit.greedy.profile} greedy-connectivity-shadow=${result.audit.greedy.connectivityShadowScoring} lns-cp-sat-workers=${result.audit.lnsReplay.cpSatNumWorkers} lns-state=${result.audit.lnsReplay.incumbentStatePolicy} lns-windows=${result.audit.lnsReplay.candidateWindowPolicy}`
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
  for (const split of result.lns.splits) {
    lines.push(
      `- lns ${split.split}: cases=${split.selectedCaseNames.join(", ")} labels=${split.labelCount} usable=${split.usableLabelCount} improved=${split.statusCounts.improved} neutral=${split.statusCounts.neutral} regressed=${split.statusCounts.regressed} invalid=${split.statusCounts.invalid} recoverable-failure=${split.statusCounts["recoverable-failure"]} repair=${split.replay.repairTimeLimitSeconds}s max-windows=${split.replay.maxWindows}`
    );
  }
  return lines.join("\n");
}
