import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES
} from "./greedyDeterministicAblations.js";
import {
  createLnsWindowReplaySnapshot,
  LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
  runLnsWindowReplayLabels
} from "./lnsWindowReplayLabels.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS } from "./lns.js";
import {
  benchmarkGeneratedAt,
  countBenchmarkMatches,
  nonNegativeIntegerOrDefault,
  positiveIntegerOrDefault,
  sumBenchmarkBy,
  uniqueBenchmarkValues
} from "./benchmarkOptions.js";
import {
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  buildLnsReplayLabelScaleReadiness
} from "./lnsReplayLabelReadiness.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";

import type { GreedyBenchmarkSuiteResult } from "./greedy.js";
import type {
  GreedyConnectivityShadowPlacementTrace,
  GreedyRoadOpportunityCounterfactualTrace,
  GreedyRoadOpportunityTrace
} from "../core/index.js";
import type {
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel,
  LnsWindowReplayStatePolicy
} from "./lnsWindowReplayLabels.js";
import type {
  GreedyOrderingLabel,
  GreedyOrderingLabelSource,
  GreedyOrderingLabelSplitResult,
  GreedyOrderingPlacementFeatures,
  LearnedRankingLabelRegistryEntryDraftOptions,
  LearnedRankingLabelRunPreset,
  LearnedRankingLabelRunOptions,
  LearnedRankingLabelSplit,
  LearnedRankingLabelSplitConfig,
  LearnedRankingLabelSnapshot,
  LearnedRankingLabelSuiteResult,
  LearnedRankingLabelTelemetryManifest,
  LearnedRankingLabelTelemetryManifestOptions,
  LearnedRankingLeakageReport,
  LnsReplayLabelSplitResult
} from "./learnedRankingLabelTypes.js";

export {
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  buildLnsReplayLabelScaleReadiness
} from "./lnsReplayLabelReadiness.js";
export type {
  GreedyOrderingLabel,
  GreedyOrderingLabelSource,
  GreedyOrderingLabelSplitResult,
  GreedyOrderingPlacementFeatures,
  LearnedRankingAuditMetadata,
  LearnedRankingLabelRegistryEntryDraftOptions,
  LearnedRankingLabelRunPreset,
  LearnedRankingLabelRunOptions,
  LearnedRankingLabelSnapshot,
  LearnedRankingLabelSplit,
  LearnedRankingLabelSplitConfig,
  LearnedRankingLabelSuiteResult,
  LearnedRankingLabelTelemetryManifest,
  LearnedRankingLabelTelemetryManifestOptions,
  LearnedRankingLeakageReport,
  LnsReplayLabelSplitResult
} from "./learnedRankingLabelTypes.js";
export type {
  LnsReplayLabelFamilyScaleSummary,
  LnsReplayLabelScaleReadiness,
  LnsReplayLabelScaleThresholds,
  LnsReplayLabelSplitScaleReadiness
} from "./lnsReplayLabelReadiness.js";

export const DEFAULT_LEARNED_RANKING_LNS_REPLAY_MAX_WINDOWS = 14;
export const DEFAULT_LEARNED_RANKING_LNS_REPLAY_EXPLORATION_WINDOWS = 4;
export const STRICT_LNS_REPLAY_LABEL_PRESET: LearnedRankingLabelRunPreset = "strict-lns-replay";
export const STRICT_LNS_REPLAY_LABEL_SEEDS: readonly number[] = Object.freeze([
  ...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS
]);
export const STRICT_LNS_REPLAY_LABEL_STATE_POLICIES: readonly LnsWindowReplayStatePolicy[] = Object.freeze([
  "initial-incumbent",
  "post-first-improvement",
  "post-stagnation"
]);
export const STRICT_LNS_REPLAY_LABEL_STATE_COLLECTION_ITERATIONS = 4;
export const STRICT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS = Object.freeze({
  ...DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  requiredStatePolicies: STRICT_LNS_REPLAY_LABEL_STATE_POLICIES
});

function normalizeLearnedRankingLabelRunPreset(
  preset: LearnedRankingLabelRunPreset | undefined
): LearnedRankingLabelRunPreset | null {
  if (preset === undefined) return null;
  if (preset === STRICT_LNS_REPLAY_LABEL_PRESET) return preset;
  throw new Error(`Unknown learned-ranking label preset: ${String(preset)}.`);
}

export const DEFAULT_LEARNED_RANKING_LABEL_SPLITS: readonly LearnedRankingLabelSplitConfig[] = Object.freeze([
  {
    split: "development",
    greedyCaseNames: [
      "cap-sweep-mixed",
      "service-local-neighborhood",
      "step14-service-lookahead-reranker",
      "row0-corridor-repair-pressure"
    ],
    lnsCaseNames: [
      "compact-service-repair",
      "seeded-service-anchor-pressure",
      "lns-corridor-squeeze-pressure",
      "lns-gate-choke-pressure",
      "lns-footprint-mix-pressure"
    ]
  },
  {
    split: "holdout",
    greedyCaseNames: DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES.filter(
      (name) =>
        name === "fixed-service-realization-complete" ||
        name === "geometry-occupancy-hot-path" ||
        name === "typed-footprint-pressure" ||
        name === "typed-availability-pressure"
    ),
    lnsCaseNames: [
      "row0-anchor-repair",
      "lns-service-overlap-pressure",
      "lns-anchor-service-corner-pressure",
      "lns-gate-side-channel-pressure",
      "lns-footprint-bottleneck-pressure"
    ]
  }
]);

function emptySourceCounts(): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": 0,
    "road-opportunity-counterfactual": 0
  };
}

function sumGreedySourceCounts(
  splits: readonly GreedyOrderingLabelSplitResult[]
): Record<GreedyOrderingLabelSource, number> {
  return {
    "connectivity-shadow-decision": sumBenchmarkBy(
      splits,
      (split) => split.sourceCounts["connectivity-shadow-decision"]
    ),
    "road-opportunity-counterfactual": sumBenchmarkBy(
      splits,
      (split) => split.sourceCounts["road-opportunity-counterfactual"]
    )
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
    "recoverable-failure": 0
  };
}

function addLnsStatusCounts(
  left: Record<LnsWindowReplaySnapshotLabel["status"], number>,
  right: Record<LnsWindowReplaySnapshotLabel["status"], number>
): Record<LnsWindowReplaySnapshotLabel["status"], number> {
  return {
    improved: left.improved + right.improved,
    neutral: left.neutral + right.neutral,
    regressed: left.regressed + right.regressed,
    invalid: left.invalid + right.invalid,
    "recoverable-failure": left["recoverable-failure"] + right["recoverable-failure"]
  };
}

function countLnsStatuses(replay: LnsWindowReplaySnapshot): Record<LnsWindowReplaySnapshotLabel["status"], number> {
  const counts = emptyLnsStatusCounts();
  for (const benchmarkCase of replay.cases) {
    for (const label of benchmarkCase.labels) {
      counts[label.status]++;
    }
  }
  return counts;
}

function countUsableLnsLabels(replay: LnsWindowReplaySnapshot): number {
  return sumBenchmarkBy(replay.cases, (benchmarkCase) =>
    countBenchmarkMatches(benchmarkCase.labels, (label) => label.usable)
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
    ...(placement.range === undefined ? {} : { range: placement.range })
  };
}

function placementFeaturesFromOpportunityTrace(trace: GreedyRoadOpportunityTrace): GreedyOrderingPlacementFeatures {
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
    ...(trace.range === undefined ? {} : { range: trace.range })
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
    ...(trace.range === undefined ? {} : { range: trace.range })
  };
}

function samePlacement(
  left: GreedyConnectivityShadowPlacementTrace,
  right: GreedyConnectivityShadowPlacementTrace
): boolean {
  return (
    left.r === right.r &&
    left.c === right.c &&
    left.rows === right.rows &&
    left.cols === right.cols &&
    left.roadCost === right.roadCost &&
    left.typeIndex === right.typeIndex &&
    left.bonus === right.bonus &&
    left.range === right.range
  );
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
      const selectedPenalty = selectedIsCandidate ? decision.candidateShadowPenalty : decision.incumbentShadowPenalty;
      const rejectedPenalty = selectedIsCandidate ? decision.incumbentShadowPenalty : decision.candidateShadowPenalty;
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
        margin: rejectedPenalty - selectedPenalty
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
          reason: counterfactual.reason
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

function buildLeakageReport(splitConfigs: readonly LearnedRankingLabelSplitConfig[]): LearnedRankingLeakageReport {
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
    protectedHoldout: greedyOverlap.length === 0 && lnsOverlap.length === 0
  };
}

function assertProtectedHoldout(leakage: LearnedRankingLeakageReport): void {
  if (!leakage.protectedHoldout) {
    const overlaps = [
      leakage.greedyOverlap.length ? `Greedy: ${leakage.greedyOverlap.join(", ")}` : null,
      leakage.lnsOverlap.length ? `LNS: ${leakage.lnsOverlap.join(", ")}` : null
    ].filter((entry): entry is string => entry !== null);
    throw new Error(`Learned ranking development/holdout split overlap is not allowed. ${overlaps.join("; ")}`);
  }
}

export function runLearnedRankingLabelSuite(
  options: LearnedRankingLabelRunOptions = {}
): LearnedRankingLabelSuiteResult {
  const preset = normalizeLearnedRankingLabelRunPreset(options.preset);
  const strictPreset = preset === STRICT_LNS_REPLAY_LABEL_PRESET;
  const splitConfigs = options.splitConfigs ?? DEFAULT_LEARNED_RANKING_LABEL_SPLITS;
  validateSplitConfigs(splitConfigs);
  const leakage = buildLeakageReport(splitConfigs);
  assertProtectedHoldout(leakage);

  const seeds = normalizeBenchmarkSeeds(options.seeds, "learned ranking label seeds") ?? [
    ...(strictPreset ? STRICT_LNS_REPLAY_LABEL_SEEDS : DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS)
  ];
  const greedyCorpus = options.greedyCorpus ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS;
  const lnsCorpus = options.lnsCorpus ?? DEFAULT_LNS_REPLAY_LABEL_CORPUS;
  const maxWindows = positiveIntegerOrDefault(options.maxWindows, DEFAULT_LEARNED_RANKING_LNS_REPLAY_MAX_WINDOWS);
  const explorationWindowCount = nonNegativeIntegerOrDefault(
    options.explorationWindowCount,
    DEFAULT_LEARNED_RANKING_LNS_REPLAY_EXPLORATION_WINDOWS
  );
  const lnsStatePolicies =
    options.lnsStatePolicies ?? (strictPreset ? STRICT_LNS_REPLAY_LABEL_STATE_POLICIES : undefined);
  const lnsStateCollectionIterations =
    options.lnsStateCollectionIterations ??
    (strictPreset ? STRICT_LNS_REPLAY_LABEL_STATE_COLLECTION_ITERATIONS : undefined);
  const greedySplits: GreedyOrderingLabelSplitResult[] = [];
  const lnsSplits: LnsReplayLabelSplitResult[] = [];
  const lnsScaleThresholds = strictPreset ? STRICT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS : undefined;

  for (const config of splitConfigs) {
    const greedyLabels = seeds.flatMap((seed) => {
      const result = runGreedyBenchmarkSuite(greedyCorpus, {
        names: [...config.greedyCaseNames],
        greedy: {
          ...(options.greedy ?? {}),
          profile: true,
          connectivityShadowScoring: true,
          randomSeed: seed
        }
      });
      return collectGreedyOrderingLabelsFromBenchmarkSuite(result, config.split, seed);
    });
    greedySplits.push({
      split: config.split,
      selectedCaseNames: [...config.greedyCaseNames],
      seeds: [...seeds],
      labelCount: greedyLabels.length,
      sourceCounts: countSources(greedyLabels),
      labels: greedyLabels
    });

    const lnsReplay = runLnsWindowReplayLabels(lnsCorpus, {
      names: [...config.lnsCaseNames],
      seeds,
      lns: options.lns,
      cpSat: options.cpSat,
      maxWindows,
      explorationWindowCount,
      repairTimeLimitSeconds: options.repairTimeLimitSeconds,
      statePolicies: lnsStatePolicies,
      stateCollectionIterations: lnsStateCollectionIterations,
      stateCollectionRepairTimeLimitSeconds: options.lnsStateCollectionRepairTimeLimitSeconds
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
      replay: replaySnapshot
    });
  }

  const greedySourceCounts = sumGreedySourceCounts(greedySplits);
  const lnsReplayStatePolicies = uniqueBenchmarkValues(
    lnsSplits.flatMap((split) => split.replay.statePolicies)
  ) as LnsWindowReplayStatePolicy[];
  const lnsReplayPrimaryStatePolicy: LnsWindowReplayStatePolicy | "multiple" =
    lnsReplayStatePolicies.length === 1 ? lnsReplayStatePolicies[0]! : "multiple";
  const lnsReplayStateCollectionIterations = lnsSplits[0]?.replay.stateCollectionIterations ?? 4;
  const lnsReplayStateCollectionRepairTimeLimitSeconds =
    lnsSplits[0]?.replay.stateCollectionRepairTimeLimitSeconds ?? options.repairTimeLimitSeconds ?? 1;

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...seeds],
    splitCount: splitConfigs.length,
    audit: {
      learnedModel: null,
      greedy: {
        profile: true,
        connectivityShadowScoring: true
      },
      lnsReplay: {
        preset,
        cpSatNumWorkers: 1,
        incumbentStatePolicy: lnsReplayPrimaryStatePolicy,
        incumbentStatePolicies: lnsReplayStatePolicies,
        stateCollectionIterations: lnsReplayStateCollectionIterations,
        stateCollectionRepairTimeLimitSeconds: lnsReplayStateCollectionRepairTimeLimitSeconds,
        candidateWindowPolicy:
          explorationWindowCount > 0 ? "baseline-ranked-top-k-plus-tail-exploration" : "baseline-ranked-top-k",
        explorationWindowCount,
        featureSchemaVersion: LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION
      }
    },
    greedy: {
      labelCount: sumBenchmarkBy(greedySplits, (split) => split.labelCount),
      sourceCounts: greedySourceCounts,
      splits: greedySplits
    },
    lns: {
      labelCount: sumBenchmarkBy(lnsSplits, (split) => split.labelCount),
      scaleReadiness: buildLnsReplayLabelScaleReadiness(lnsSplits, lnsScaleThresholds),
      splits: lnsSplits
    },
    leakage
  };
}

export function createLearnedRankingLabelSnapshot(result: LearnedRankingLabelSuiteResult): LearnedRankingLabelSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function buildLearnedRankingLabelFingerprint(result: LearnedRankingLabelSuiteResult): string {
  return `fnv1a:${hashString(stableStringify(createLearnedRankingLabelSnapshot(result)))}`;
}

function dateSlug(value: string): string {
  return value.slice(0, 10);
}

function assertNonEmptyStringList(values: readonly string[], label: string): void {
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`Learned ranking label ${label} must include at least one non-empty string.`);
  }
}

function learnedRankingCasesBySplit(
  result: LearnedRankingLabelSuiteResult
): Record<LearnedRankingLabelSplit, string[]> {
  const casesBySplit: Record<LearnedRankingLabelSplit, string[]> = {
    development: [],
    holdout: []
  };
  for (const split of result.greedy.splits) {
    casesBySplit[split.split].push(...split.selectedCaseNames);
  }
  for (const split of result.lns.splits) {
    casesBySplit[split.split].push(...split.selectedCaseNames);
  }
  return {
    development: uniqueBenchmarkValues(casesBySplit.development).sort(),
    holdout: uniqueBenchmarkValues(casesBySplit.holdout).sort()
  };
}

function learnedRankingCaseFamilies(result: LearnedRankingLabelSuiteResult): string[] {
  const pressureFamilies = uniqueBenchmarkValues(result.lns.splits.flatMap((split) => split.pressureFamilies)).map(
    (family) => `lns-${family}`
  );
  return uniqueBenchmarkValues([
    "greedy-connectivity-shadow",
    "greedy-road-opportunity",
    "lns-window-replay",
    ...pressureFamilies
  ]).sort();
}

function aggregateLnsStatusCounts(
  splits: readonly LnsReplayLabelSplitResult[]
): Record<LnsWindowReplaySnapshotLabel["status"], number> {
  return splits.reduce((counts, split) => addLnsStatusCounts(counts, split.statusCounts), emptyLnsStatusCounts());
}

export function buildLearnedRankingLabelTelemetryManifest(
  result: LearnedRankingLabelSuiteResult,
  options: LearnedRankingLabelTelemetryManifestOptions
): LearnedRankingLabelTelemetryManifest {
  return {
    schemaVersion: 1,
    source: "learned-ranking-label-bundle",
    command: options.command,
    generatedAt: result.generatedAt,
    git: options.git ?? null,
    hardware: options.hardware ?? { captured: false, gpuUsed: false },
    labelFingerprint: buildLearnedRankingLabelFingerprint(result),
    suite: {
      splitCount: result.splitCount,
      totalLabels: result.greedy.labelCount + result.lns.labelCount,
      greedyLabelCount: result.greedy.labelCount,
      lnsLabelCount: result.lns.labelCount,
      seeds: [...result.seeds],
      protectedHoldout: result.leakage.protectedHoldout,
      lnsScaleReady: result.lns.scaleReadiness.passed,
      learnedModel: result.audit.learnedModel
    },
    audit: structuredClone(result.audit),
    greedy: {
      sourceCounts: { ...result.greedy.sourceCounts },
      splits: result.greedy.splits.map((split) => ({
        split: split.split,
        selectedCaseNames: [...split.selectedCaseNames],
        labelCount: split.labelCount,
        sourceCounts: { ...split.sourceCounts }
      }))
    },
    lns: {
      scaleReadiness: structuredClone(result.lns.scaleReadiness),
      statusCounts: aggregateLnsStatusCounts(result.lns.splits),
      splits: result.lns.splits.map((split) => ({
        split: split.split,
        selectedCaseNames: [...split.selectedCaseNames],
        pressureFamilies: [...split.pressureFamilies],
        labelCount: split.labelCount,
        usableLabelCount: split.usableLabelCount,
        statusCounts: { ...split.statusCounts },
        repairTimeLimitSeconds: split.replay.repairTimeLimitSeconds,
        maxWindows: split.replay.maxWindows,
        explorationWindowCount: split.replay.explorationWindowCount,
        statePolicies: [...split.replay.statePolicies],
        capturedStatePolicies: [...split.replay.capturedStatePolicies],
        stateCollectionIterations: split.replay.stateCollectionIterations,
        stateCollectionRepairTimeLimitSeconds: split.replay.stateCollectionRepairTimeLimitSeconds,
        stateCount: split.replay.stateCount,
        featureSchemaVersion: split.replay.featureSchemaVersion,
        cpSatNumWorkers: split.replay.cpSatNumWorkers,
        cpSatModelFingerprints: [...split.replay.cpSatModelFingerprints]
      }))
    }
  };
}

export function buildLearnedRankingLabelRegistryEntryDraft(
  result: LearnedRankingLabelSuiteResult,
  options: LearnedRankingLabelRegistryEntryDraftOptions
): Record<string, unknown> {
  assertNonEmptyStringList([...options.commands], "commands");
  assertNonEmptyStringList([...options.artifactPaths], "artifact paths");

  const splitCases = learnedRankingCasesBySplit(result);
  const lnsStatusCounts = aggregateLnsStatusCounts(result.lns.splits);
  const lnsCpSatModelFingerprints = uniqueBenchmarkValues(
    result.lns.splits.flatMap((split) => split.replay.cpSatModelFingerprints)
  );
  const lnsCapturedStatePolicies = uniqueBenchmarkValues(
    result.lns.splits.flatMap((split) => split.replay.capturedStatePolicies)
  );
  const lnsReplayInputFingerprintPayload = {
    preset: result.audit.lnsReplay.preset,
    cpSatModelFingerprints: lnsCpSatModelFingerprints,
    statePolicies: result.audit.lnsReplay.incumbentStatePolicies,
    stateCollectionIterations: uniqueBenchmarkValues(
      result.lns.splits.map((split) => split.replay.stateCollectionIterations)
    ),
    stateCollectionRepairTimeLimitSeconds: uniqueBenchmarkValues(
      result.lns.splits.map((split) => split.replay.stateCollectionRepairTimeLimitSeconds)
    )
  };
  return {
    schemaVersion: 1,
    runId: options.runId ?? `learned-ranking-labels-${dateSlug(result.generatedAt)}`,
    artifactType: "label-bundle",
    generatedAt: result.generatedAt,
    commands: [...options.commands],
    artifactPaths: [...options.artifactPaths],
    cases: splitCases,
    caseFamilies: learnedRankingCaseFamilies(result),
    seeds: [...result.seeds],
    inputFingerprint: `fnv1a:${hashString(stableStringify(lnsReplayInputFingerprintPayload))}`,
    cpSatModelFingerprints: lnsCpSatModelFingerprints,
    splitStatus: {
      protectedHoldout: result.leakage.protectedHoldout,
      splitField: "LearnedRankingLabelSplitConfig.split",
      developmentCaseCount: splitCases.development.length,
      holdoutCaseCount: splitCases.holdout.length,
      leakage: result.leakage,
      lnsScaleReadiness: result.lns.scaleReadiness,
      notes: result.leakage.protectedHoldout
        ? "Learned-ranking labels keep development and holdout case names disjoint."
        : "Learned-ranking labels are not protected holdout evidence because split overlap exists."
    },
    budget: {
      seeds: [...result.seeds],
      splitCount: result.splitCount,
      greedyLabelCount: result.greedy.labelCount,
      lnsLabelCount: result.lns.labelCount,
      lnsRepairTimeLimitSeconds: uniqueBenchmarkValues(
        result.lns.splits.map((split) => split.replay.repairTimeLimitSeconds)
      ),
      lnsMaxWindows: uniqueBenchmarkValues(result.lns.splits.map((split) => split.replay.maxWindows)),
      lnsExplorationWindowCount: result.audit.lnsReplay.explorationWindowCount,
      lnsPresetApplied: result.audit.lnsReplay.preset === null ? 0 : 1,
      lnsStatePolicyCount: result.audit.lnsReplay.incumbentStatePolicies.length,
      lnsCapturedStatePolicyCount: lnsCapturedStatePolicies.length,
      lnsStateCollectionIterations: uniqueBenchmarkValues(
        result.lns.splits.map((split) => split.replay.stateCollectionIterations)
      ),
      lnsStateCollectionRepairTimeLimitSeconds: uniqueBenchmarkValues(
        result.lns.splits.map((split) => split.replay.stateCollectionRepairTimeLimitSeconds)
      ),
      lnsFeatureSchemaVersion: result.audit.lnsReplay.featureSchemaVersion,
      lnsCpSatNumWorkers: uniqueBenchmarkValues(result.lns.splits.map((split) => split.replay.cpSatNumWorkers))
    },
    model: {
      trained: false,
      learnedModel: result.audit.learnedModel,
      runtimeDefaultChanged: false,
      purpose: "offline-diagnostics-only"
    },
    decision: options.decision ?? "offline-label-bundle-only",
    summary:
      options.summary ??
      `Learned-ranking label bundle with ${result.greedy.labelCount} Greedy labels and ${result.lns.labelCount} LNS replay labels across ${result.splitCount} split(s).`,
    labelFingerprint: buildLearnedRankingLabelFingerprint(result),
    summaryMetrics: {
      greedySourceCounts: result.greedy.sourceCounts,
      lnsStatusCounts,
      protectedHoldout: result.leakage.protectedHoldout,
      lnsScaleReady: result.lns.scaleReadiness.passed,
      lnsScaleReadiness: result.lns.scaleReadiness,
      lnsReplayPreset: result.audit.lnsReplay.preset,
      lnsStatePolicies: [...result.audit.lnsReplay.incumbentStatePolicies],
      lnsCapturedStatePolicies,
      lnsCpSatModelFingerprints
    }
  };
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
    `Audit: learned-model=${result.audit.learnedModel ?? "none"} greedy-profile=${result.audit.greedy.profile} greedy-connectivity-shadow=${result.audit.greedy.connectivityShadowScoring} lns-preset=${result.audit.lnsReplay.preset ?? "none"} lns-cp-sat-workers=${result.audit.lnsReplay.cpSatNumWorkers} lns-state=${result.audit.lnsReplay.incumbentStatePolicies.join(",")} lns-state-collection=${result.audit.lnsReplay.stateCollectionIterations}x${result.audit.lnsReplay.stateCollectionRepairTimeLimitSeconds}s lns-windows=${result.audit.lnsReplay.candidateWindowPolicy} lns-exploration=${result.audit.lnsReplay.explorationWindowCount} lns-feature-schema=${result.audit.lnsReplay.featureSchemaVersion}`
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
  lines.push(`LNS label-scale ready=${result.lns.scaleReadiness.passed}`);
  for (const readiness of result.lns.scaleReadiness.splitReadiness) {
    lines.push(
      `- lns-scale ${readiness.split}: ready=${readiness.passed} families=${readiness.pressureFamilyCount} usable=${readiness.usableLabelCount} non-neutral=${readiness.nonNeutralUsableLabelCount} neutral-ratio=${readiness.neutralLabelRatio.toFixed(3)} failures=${readiness.failedReasons.length ? readiness.failedReasons.join("; ") : "none"}`
    );
  }
  for (const split of result.lns.splits) {
    lines.push(
      `- lns ${split.split}: cases=${split.selectedCaseNames.join(", ")} families=${split.pressureFamilies.join(", ")} labels=${split.labelCount} usable=${split.usableLabelCount} improved=${split.statusCounts.improved} neutral=${split.statusCounts.neutral} regressed=${split.statusCounts.regressed} invalid=${split.statusCounts.invalid} recoverable-failure=${split.statusCounts["recoverable-failure"]} repair=${split.replay.repairTimeLimitSeconds}s max-windows=${split.replay.maxWindows} exploration=${split.replay.explorationWindowCount}`
    );
  }
  return lines.join("\n");
}
