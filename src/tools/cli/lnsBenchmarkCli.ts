import {
  buildDeterministicAblationGateReport,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  createLnsWindowRankerOnlineCalibrationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS,
  DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS,
  DEFAULT_LNS_WINDOW_RANKER_ONLINE_FRESH_PRESSURE_HOLDOUT_CORPUS,
  DEFAULT_LNS_WINDOW_RANKER_ONLINE_PRODUCT_PROMOTION_CORPUS,
  DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS,
  ExperimentRegistryValidationError,
  formatDeterministicAblationGateReport,
  formatExperimentRegistryIssues,
  formatLnsNeighborhoodAblation,
  formatLnsBenchmarkSuite,
  formatLnsWindowRankerOnlineCalibration,
  formatLnsWindowRankerOnlineAblation,
  formatLnsWindowReplayLabels,
  listLnsWindowRankerOnlineAblationCaseNames,
  listLnsNeighborhoodAblationCaseNames,
  listLnsBenchmarkCaseNames,
  listLnsWindowReplayCaseNames,
  runLnsNeighborhoodAblation,
  runLnsWindowRankerOnlineCalibration,
  runLnsWindowRankerOnlineAblation,
  runLnsWindowReplayLabelsFromOnlineDecisionStates,
  runLnsWindowReplayLabels,
  runLnsBenchmarkSuite
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  countEnabledCliModes,
  isCliFlag,
  parseNameList,
  parseNonNegativeNumber,
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber
} from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliText
} from "../../apps/cliOutput.js";
import {
  formatLnsWindowReplayArtifactManifest,
  writeLnsWindowReplayArtifactBundle
} from "./lnsWindowReplayArtifactBundle.js";
import {
  formatWindowRankerOnlineArtifactManifest,
  readWindowRankerModel,
  readWindowRankerOnlineScorecard,
  writeWindowRankerOnlineArtifactBundle,
  writeWindowRankerOnlineCalibrationArtifactBundle
} from "./lnsBenchmarkArtifacts.js";
import type {
  LnsNeighborhoodAblationVariantName,
  LnsWindowRankerOnlineProtectedCorpus,
  LnsWindowReplayStatePolicy
} from "../../benchmarkApi.js";
import type {
  LnsWindowRankerFeatureDeltaGate,
  LnsWindowRankerSelectedFeatureGate,
  LnsWindowRankerSelectedFeatureGateGroup
} from "./lnsBenchmarkArtifacts.js";

type LnsWindowRankerOperatorTransition = NonNullable<
  Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["allowedTransitions"]
>[number];

interface ParsedBenchmarkArgs {
  json: boolean;
  neighborhoodAblation: boolean;
  windowReplayLabels: boolean;
  curatedReplaySeeds: boolean;
  naturalReplaySeeds: boolean;
  windowReplayProtectedHoldout: boolean;
  windowReplayProductPromotionHoldout: boolean;
  windowReplayFreshPressureHoldout: boolean;
  windowRankerOnlineAblation: boolean;
  gateReport: boolean;
  list: boolean;
  names: string[];
  windowRankerThresholdSweep: boolean;
  ablationVariantNames?: LnsNeighborhoodAblationVariantName[];
  seeds?: number[];
  rotateVariantRunOrder?: boolean;
  maxWindows?: number;
  explorationWindowCount?: number;
  lnsIterations?: number;
  repairTimeLimitSeconds?: number;
  rollForwardIterations?: number;
  rollForwardRepairTimeLimitSeconds?: number;
  statePolicies?: LnsWindowReplayStatePolicy[];
  stateCollectionIterations?: number;
  stateCollectionRepairTimeLimitSeconds?: number;
  windowReplayArtifactDir?: string;
  windowReplayOnlineScorecardPath?: string;
  windowRankerModelPath?: string;
  windowRankerMinScoreDelta?: number;
  windowRankerMinScoreDeltas?: number[];
  windowRankerSuppressionModelPath?: string;
  windowRankerSuppressionMinScoreDelta?: number;
  windowRankerAllowedTransitions?: LnsWindowRankerOperatorTransition[];
  windowRankerSelectedFeatureGates?: LnsWindowRankerSelectedFeatureGate[];
  windowRankerSelectedFeatureGateGroups?: LnsWindowRankerSelectedFeatureGateGroup[];
  windowRankerFeatureDeltaGates?: LnsWindowRankerFeatureDeltaGate[];
  windowRankerArtifactDir?: string;
  windowRankerProtectedHoldout: boolean;
  windowRankerProductPromotionHoldout: boolean;
  windowRankerFreshPressureHoldout: boolean;
  windowRankerProtectedCorpus?: LnsWindowRankerOnlineProtectedCorpus;
  windowRankerRunId?: string;
  windowRankerDecision?: string;
  windowRankerSummary?: string;
  windowRankerRegistryPath?: string;
  windowRankerRegisterDryRun: boolean;
  forceArtifactDir: boolean;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let neighborhoodAblation = false;
  let windowReplayLabels = false;
  let curatedReplaySeeds = false;
  let naturalReplaySeeds = false;
  let windowReplayProtectedHoldout = false;
  let windowReplayProductPromotionHoldout = false;
  let windowReplayFreshPressureHoldout = false;
  let windowRankerOnlineAblation = false;
  let windowRankerThresholdSweep = false;
  let gateReport = false;
  let list = false;
  let ablationVariantNames: LnsNeighborhoodAblationVariantName[] | undefined;
  let seeds: number[] | undefined;
  let rotateVariantRunOrder: boolean | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let lnsIterations: number | undefined;
  let repairTimeLimitSeconds: number | undefined;
  let rollForwardIterations: number | undefined;
  let rollForwardRepairTimeLimitSeconds: number | undefined;
  let statePolicies: LnsWindowReplayStatePolicy[] | undefined;
  let stateCollectionIterations: number | undefined;
  let stateCollectionRepairTimeLimitSeconds: number | undefined;
  let windowReplayArtifactDir: string | undefined;
  let windowReplayOnlineScorecardPath: string | undefined;
  let windowRankerModelPath: string | undefined;
  let windowRankerMinScoreDelta: number | undefined;
  let windowRankerMinScoreDeltas: number[] | undefined;
  let windowRankerSuppressionModelPath: string | undefined;
  let windowRankerSuppressionMinScoreDelta: number | undefined;
  let windowRankerAllowedTransitions: LnsWindowRankerOperatorTransition[] | undefined;
  let windowRankerSelectedFeatureGates: LnsWindowRankerSelectedFeatureGate[] | undefined;
  let windowRankerSelectedFeatureGateGroups: LnsWindowRankerSelectedFeatureGateGroup[] | undefined;
  let windowRankerFeatureDeltaGates: LnsWindowRankerFeatureDeltaGate[] | undefined;
  let windowRankerArtifactDir: string | undefined;
  let windowRankerProtectedHoldout = false;
  let windowRankerProductPromotionHoldout = false;
  let windowRankerFreshPressureHoldout = false;
  let windowRankerRunId: string | undefined;
  let windowRankerDecision: string | undefined;
  let windowRankerSummary: string | undefined;
  let windowRankerRegistryPath: string | undefined;
  let windowRankerRegisterDryRun = false;
  let forceArtifactDir = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    "ablation-variants": (value) => {
      ablationVariantNames = parseNameList(value, "ablation variant") as LnsNeighborhoodAblationVariantName[];
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    "max-windows": (value) => {
      maxWindows = parsePositiveInteger(value, "--max-windows");
    },
    "exploration-windows": (value) => {
      explorationWindowCount = parseNonNegativeInteger(value, "--exploration-windows");
    },
    iterations: (value) => {
      lnsIterations = parsePositiveInteger(value, "--iterations");
    },
    "lns-iterations": (value) => {
      lnsIterations = parsePositiveInteger(value, "--lns-iterations");
    },
    "repair-time": (value) => {
      repairTimeLimitSeconds = parsePositiveNumber(value, "--repair-time");
    },
    "roll-forward-iterations": (value) => {
      rollForwardIterations = parseNonNegativeInteger(value, "--roll-forward-iterations");
    },
    "roll-forward-repair-time": (value) => {
      rollForwardRepairTimeLimitSeconds = parsePositiveNumber(value, "--roll-forward-repair-time");
    },
    "state-policies": (value) => {
      statePolicies = parseNameList(value, "state policy") as LnsWindowReplayStatePolicy[];
    },
    "state-collection-iterations": (value) => {
      stateCollectionIterations = parsePositiveInteger(value, "--state-collection-iterations");
    },
    "state-collection-repair-time": (value) => {
      stateCollectionRepairTimeLimitSeconds = parsePositiveNumber(value, "--state-collection-repair-time");
    },
    "window-replay-artifact-dir": (value) => {
      windowReplayArtifactDir = value;
    },
    "window-replay-online-scorecard": (value) => {
      windowReplayLabels = true;
      windowReplayOnlineScorecardPath = value;
    },
    "window-ranker-model": (value) => {
      windowRankerModelPath = value;
    },
    "window-ranker-min-score-delta": (value) => {
      windowRankerMinScoreDelta = parseNonNegativeNumber(value, "--window-ranker-min-score-delta");
    },
    "window-ranker-min-score-deltas": (value) => {
      windowRankerOnlineAblation = true;
      windowRankerThresholdSweep = true;
      windowRankerMinScoreDeltas = parseNonNegativeNumberList(value, "--window-ranker-min-score-deltas");
    },
    "window-ranker-suppression-model": (value) => {
      windowRankerSuppressionModelPath = value;
    },
    "window-ranker-suppression-min-score-delta": (value) => {
      windowRankerSuppressionMinScoreDelta = parseNonNegativeNumber(
        value,
        "--window-ranker-suppression-min-score-delta"
      );
    },
    "window-ranker-allowed-transitions": (value) => {
      windowRankerAllowedTransitions = parseNameList(
        value,
        "window ranker allowed transition"
      ) as LnsWindowRankerOperatorTransition[];
    },
    "window-ranker-selected-feature-gates": (value) => {
      windowRankerSelectedFeatureGates = parseWindowRankerSelectedFeatureGates(value);
    },
    "window-ranker-feature-value-gates": (value) => {
      windowRankerSelectedFeatureGates = parseWindowRankerSelectedFeatureGates(value);
    },
    "window-ranker-selected-feature-gate-groups": (value) => {
      windowRankerSelectedFeatureGateGroups = parseWindowRankerSelectedFeatureGateGroups(value);
    },
    "window-ranker-feature-value-gate-groups": (value) => {
      windowRankerSelectedFeatureGateGroups = parseWindowRankerSelectedFeatureGateGroups(value);
    },
    "window-ranker-feature-delta-gates": (value) => {
      windowRankerFeatureDeltaGates = parseWindowRankerFeatureDeltaGates(value);
    },
    "window-ranker-feature-gates": (value) => {
      windowRankerFeatureDeltaGates = parseWindowRankerFeatureDeltaGates(value);
    },
    "window-ranker-artifact-dir": (value) => {
      windowRankerArtifactDir = value;
    },
    "artifact-dir": (value) => {
      windowRankerArtifactDir = value;
    },
    "window-ranker-run-id": (value) => {
      windowRankerRunId = value;
    },
    "window-ranker-decision": (value) => {
      windowRankerDecision = value;
    },
    "window-ranker-summary": (value) => {
      windowRankerSummary = value;
    },
    "window-ranker-registry": (value) => {
      windowRankerRegistryPath = value;
    }
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--list")) {
      list = true;
      continue;
    }
    if (isCliFlag(arg, "--gate-report", "--ablation-gate-report")) {
      gateReport = true;
      continue;
    }
    if (isCliFlag(arg, "--window-replay-labels", "--window-replay-label")) {
      windowReplayLabels = true;
      continue;
    }
    if (isCliFlag(arg, "--window-replay-protected-holdout", "--protected-window-replay-labels")) {
      windowReplayLabels = true;
      windowReplayProtectedHoldout = true;
      continue;
    }
    if (isCliFlag(arg, "--window-replay-product-promotion-holdout")) {
      windowReplayLabels = true;
      windowReplayProductPromotionHoldout = true;
      continue;
    }
    if (isCliFlag(arg, "--window-replay-fresh-pressure-holdout")) {
      windowReplayLabels = true;
      windowReplayFreshPressureHoldout = true;
      continue;
    }
    if (
      isCliFlag(arg, "--window-ranker-online-ablation", "--window-ranker-ablation", "--online-window-ranker-ablation")
    ) {
      windowRankerOnlineAblation = true;
      continue;
    }
    if (isCliFlag(arg, "--window-ranker-threshold-sweep", "--window-ranker-calibration")) {
      windowRankerOnlineAblation = true;
      windowRankerThresholdSweep = true;
      continue;
    }
    if (isCliFlag(arg, "--window-ranker-protected-holdout", "--protected-holdout")) {
      windowRankerOnlineAblation = true;
      windowRankerProtectedHoldout = true;
      continue;
    }
    if (isCliFlag(arg, "--window-ranker-product-promotion-holdout")) {
      windowRankerOnlineAblation = true;
      windowRankerProductPromotionHoldout = true;
      continue;
    }
    if (isCliFlag(arg, "--window-ranker-fresh-pressure-holdout")) {
      windowRankerOnlineAblation = true;
      windowRankerFreshPressureHoldout = true;
      continue;
    }
    if (isCliFlag(arg, "--window-ranker-register-dry-run")) {
      windowRankerRegisterDryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--force-artifact-dir")) {
      forceArtifactDir = true;
      continue;
    }
    if (isCliFlag(arg, "--pressure-corpus")) {
      windowReplayLabels = true;
      continue;
    }
    if (isCliFlag(arg, "--natural-replay-seeds", "--no-weak-replay-seeds")) {
      windowReplayLabels = true;
      naturalReplaySeeds = true;
      continue;
    }
    if (isCliFlag(arg, "--curated-replay-seeds", "--curated-lns-replay-seeds")) {
      windowReplayLabels = true;
      curatedReplaySeeds = true;
      continue;
    }
    if (isCliFlag(arg, "--rotate-variant-run-order")) {
      rotateVariantRunOrder = true;
      continue;
    }
    if (isCliFlag(arg, "--no-rotate-variant-run-order")) {
      rotateVariantRunOrder = false;
      continue;
    }
    if (
      isCliFlag(
        arg,
        "--neighborhood-ablation",
        "--neighborhood-ablations",
        "--deterministic-ablation",
        "--deterministic-ablations"
      )
    ) {
      neighborhoodAblation = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    names.push(arg);
  }

  return {
    json,
    neighborhoodAblation,
    windowReplayLabels,
    curatedReplaySeeds,
    naturalReplaySeeds,
    windowReplayProtectedHoldout,
    windowReplayProductPromotionHoldout,
    windowReplayFreshPressureHoldout,
    windowRankerOnlineAblation,
    gateReport,
    list,
    names,
    windowRankerThresholdSweep,
    ablationVariantNames,
    seeds,
    rotateVariantRunOrder,
    maxWindows,
    explorationWindowCount,
    lnsIterations,
    repairTimeLimitSeconds,
    rollForwardIterations,
    rollForwardRepairTimeLimitSeconds,
    statePolicies,
    stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds,
    windowReplayArtifactDir,
    windowReplayOnlineScorecardPath,
    windowRankerModelPath,
    windowRankerMinScoreDelta,
    windowRankerMinScoreDeltas,
    windowRankerSuppressionModelPath,
    windowRankerSuppressionMinScoreDelta,
    windowRankerAllowedTransitions,
    windowRankerSelectedFeatureGates,
    windowRankerSelectedFeatureGateGroups,
    windowRankerFeatureDeltaGates,
    windowRankerArtifactDir,
    windowRankerProtectedHoldout,
    windowRankerProductPromotionHoldout,
    windowRankerFreshPressureHoldout,
    windowRankerProtectedCorpus: windowRankerFreshPressureHoldout
      ? "fresh-pressure-holdout"
      : windowRankerProductPromotionHoldout
        ? "product-promotion-holdout"
        : windowRankerProtectedHoldout
          ? "standard-protected-holdout"
          : undefined,
    windowRankerRunId,
    windowRankerDecision,
    windowRankerSummary,
    windowRankerRegistryPath,
    windowRankerRegisterDryRun,
    forceArtifactDir
  };
}

function windowReplayCorpus(args: ParsedBenchmarkArgs) {
  if (args.windowReplayFreshPressureHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_FRESH_PRESSURE_HOLDOUT_CORPUS;
  if (args.windowReplayProductPromotionHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_PRODUCT_PROMOTION_CORPUS;
  if (args.windowReplayProtectedHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS;
  if (args.curatedReplaySeeds) return DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS;
  if (args.naturalReplaySeeds) return DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS;
  return undefined;
}

function windowRankerOnlineCorpus(args: ParsedBenchmarkArgs) {
  if (args.windowRankerFreshPressureHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_FRESH_PRESSURE_HOLDOUT_CORPUS;
  if (args.windowRankerProductPromotionHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_PRODUCT_PROMOTION_CORPUS;
  if (args.windowRankerProtectedHoldout) return DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS;
  return undefined;
}

function windowRankerArtifactArgs(args: ParsedBenchmarkArgs): ParsedBenchmarkArgs {
  return {
    ...args,
    windowRankerProtectedHoldout:
      args.windowRankerProtectedHoldout ||
      args.windowRankerProductPromotionHoldout ||
      args.windowRankerFreshPressureHoldout
  };
}

function parseNonNegativeNumberList(value: string, label: string): number[] {
  const values = parseNumberList(value, label);
  if (values.some((entry) => entry < 0)) {
    throw new Error(`Expected ${label} to contain only non-negative finite numbers.`);
  }
  return values;
}

function parseWindowRankerFeatureDeltaGates(value: string): LnsWindowRankerFeatureDeltaGate[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("--window-ranker-feature-delta-gates must include at least one feature comparison.");
  }
  return entries.map((entry) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*(<=|>=)\s*(-?(?:\d+\.?\d*|\.\d+))$/.exec(entry);
    if (!match) {
      throw new Error(
        "--window-ranker-feature-delta-gates entries must look like operatorScore<=-6 or serviceCandidateBonus>=0.2."
      );
    }
    const feature = match[1] as LnsWindowRankerFeatureDeltaGate["feature"];
    const threshold = Number(match[3]);
    if (!Number.isFinite(threshold)) {
      throw new Error("--window-ranker-feature-delta-gates thresholds must be finite numbers.");
    }
    return match[2] === "<=" ? { feature, maxDelta: threshold } : { feature, minDelta: threshold };
  });
}

function parseWindowRankerSelectedFeatureGates(value: string): LnsWindowRankerSelectedFeatureGate[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("--window-ranker-selected-feature-gates must include at least one feature comparison.");
  }
  return entries.map((entry) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*(<=|>=)\s*(-?(?:\d+\.?\d*|\.\d+))$/.exec(entry);
    if (!match) {
      throw new Error(
        "--window-ranker-selected-feature-gates entries must look like serviceCandidateBonus>=5.58 or roadCountInside<=0."
      );
    }
    const feature = match[1] as LnsWindowRankerSelectedFeatureGate["feature"];
    const threshold = Number(match[3]);
    if (!Number.isFinite(threshold)) {
      throw new Error("--window-ranker-selected-feature-gates thresholds must be finite numbers.");
    }
    return match[2] === "<=" ? { feature, maxValue: threshold } : { feature, minValue: threshold };
  });
}

function parseWindowRankerSelectedFeatureGateGroups(value: string): LnsWindowRankerSelectedFeatureGateGroup[] {
  const groups = value
    .split(";")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
  if (groups.length === 0) {
    throw new Error(
      "--window-ranker-selected-feature-gate-groups must include at least one semicolon-separated gate group."
    );
  }
  return groups.map((group) => parseWindowRankerSelectedFeatureGates(group));
}

export function runLnsBenchmarkCli(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.gateReport && !args.neighborhoodAblation) {
    throw new Error("--gate-report is only available with --neighborhood-ablation.");
  }
  if (countEnabledCliModes([args.windowReplayLabels, args.neighborhoodAblation, args.windowRankerOnlineAblation]) > 1) {
    throw new Error(
      "Choose only one LNS benchmark mode: --window-replay-labels, --neighborhood-ablation, or --window-ranker-online-ablation."
    );
  }
  if (
    [
      args.windowReplayProtectedHoldout,
      args.windowReplayProductPromotionHoldout,
      args.windowReplayFreshPressureHoldout
    ].filter(Boolean).length > 1
  ) {
    throw new Error("Choose only one window-replay protected corpus selector.");
  }
  if (
    [
      args.windowRankerProtectedHoldout,
      args.windowRankerProductPromotionHoldout,
      args.windowRankerFreshPressureHoldout
    ].filter(Boolean).length > 1
  ) {
    throw new Error("Choose only one window-ranker protected corpus selector.");
  }
  if (args.windowRankerArtifactDir !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-artifact-dir is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerRunId !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-run-id is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerRunId !== undefined && args.windowRankerArtifactDir === undefined) {
    throw new Error("--window-ranker-run-id requires --window-ranker-artifact-dir.");
  }
  if (args.windowRankerDecision !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-decision is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerDecision !== undefined && args.windowRankerArtifactDir === undefined) {
    throw new Error("--window-ranker-decision requires --window-ranker-artifact-dir.");
  }
  if (args.windowRankerSummary !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-summary is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerSummary !== undefined && args.windowRankerArtifactDir === undefined) {
    throw new Error("--window-ranker-summary requires --window-ranker-artifact-dir.");
  }
  if (args.windowRankerModelPath !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-model is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerMinScoreDelta !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-min-score-delta is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerAllowedTransitions !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-allowed-transitions is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerSelectedFeatureGates !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-selected-feature-gates is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerSelectedFeatureGateGroups !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error(
      "--window-ranker-selected-feature-gate-groups is only available with --window-ranker-online-ablation."
    );
  }
  if (args.windowRankerFeatureDeltaGates !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-feature-delta-gates is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerSuppressionModelPath !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-suppression-model is only available with --window-ranker-online-ablation.");
  }
  if (args.windowRankerSuppressionMinScoreDelta !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error(
      "--window-ranker-suppression-min-score-delta is only available with --window-ranker-online-ablation."
    );
  }
  if (args.windowRankerSuppressionMinScoreDelta !== undefined && args.windowRankerSuppressionModelPath === undefined) {
    throw new Error("--window-ranker-suppression-min-score-delta requires --window-ranker-suppression-model=<path>.");
  }
  if (args.windowReplayArtifactDir !== undefined && !args.windowReplayLabels) {
    throw new Error("--window-replay-artifact-dir is only available with --window-replay-labels.");
  }
  if (
    args.forceArtifactDir &&
    args.windowRankerArtifactDir === undefined &&
    args.windowReplayArtifactDir === undefined
  ) {
    throw new Error("--force-artifact-dir requires --window-ranker-artifact-dir or --window-replay-artifact-dir.");
  }
  if (args.windowReplayOnlineScorecardPath !== undefined && !args.windowReplayLabels) {
    throw new Error("--window-replay-online-scorecard is only available with --window-replay-labels.");
  }
  if (args.windowRankerRegisterDryRun && args.windowRankerArtifactDir === undefined) {
    throw new Error("--window-ranker-register-dry-run requires --window-ranker-artifact-dir=<path>.");
  }
  if (args.windowRankerRegistryPath !== undefined && !args.windowRankerRegisterDryRun) {
    throw new Error("--window-ranker-registry is only used with --window-ranker-register-dry-run.");
  }
  if (args.list && args.windowRankerArtifactDir !== undefined) {
    throw new Error("--list cannot be combined with --window-ranker-artifact-dir.");
  }
  if (args.list && args.windowReplayArtifactDir !== undefined) {
    throw new Error("--list cannot be combined with --window-replay-artifact-dir.");
  }
  if (args.list && args.windowReplayOnlineScorecardPath !== undefined) {
    throw new Error("--list cannot be combined with --window-replay-online-scorecard.");
  }
  if (args.list) {
    const names = args.neighborhoodAblation
      ? listLnsNeighborhoodAblationCaseNames()
      : args.windowReplayLabels
        ? listLnsWindowReplayCaseNames(windowReplayCorpus(args))
        : args.windowRankerOnlineAblation
          ? listLnsWindowRankerOnlineAblationCaseNames(windowRankerOnlineCorpus(args))
          : listLnsBenchmarkCaseNames();
    writeCliList(names);
    return;
  }

  if (args.windowReplayLabels) {
    const replayOptions = {
      names: optionalCliNames(args.names),
      seeds: args.seeds,
      maxWindows: args.maxWindows,
      explorationWindowCount: args.explorationWindowCount,
      repairTimeLimitSeconds: args.repairTimeLimitSeconds,
      rollForwardIterations: args.rollForwardIterations,
      rollForwardRepairTimeLimitSeconds: args.rollForwardRepairTimeLimitSeconds,
      statePolicies: args.statePolicies,
      stateCollectionIterations: args.stateCollectionIterations,
      stateCollectionRepairTimeLimitSeconds: args.stateCollectionRepairTimeLimitSeconds
    };
    const result =
      args.windowReplayOnlineScorecardPath === undefined
        ? runLnsWindowReplayLabels(windowReplayCorpus(args), replayOptions)
        : runLnsWindowReplayLabelsFromOnlineDecisionStates(
            readWindowRankerOnlineScorecard(args.windowReplayOnlineScorecardPath),
            windowReplayCorpus(args),
            replayOptions
          );

    if (args.windowReplayArtifactDir !== undefined) {
      const manifest = writeLnsWindowReplayArtifactBundle(result, args.windowReplayArtifactDir, argv, {
        force: args.forceArtifactDir
      });
      writeCliJsonOrText(
        args.json,
        () => manifest,
        () => formatLnsWindowReplayArtifactManifest(manifest)
      );
      return;
    }

    writeCliJsonOrText(
      args.json,
      () => createLnsWindowReplaySnapshot(result),
      () => formatLnsWindowReplayLabels(result)
    );
    return;
  }

  if (args.windowRankerOnlineAblation) {
    if (!args.windowRankerModelPath) {
      throw new Error("--window-ranker-online-ablation requires --window-ranker-model=<path>.");
    }
    if (
      (args.windowRankerProtectedHoldout ||
        args.windowRankerProductPromotionHoldout ||
        args.windowRankerFreshPressureHoldout) &&
      !args.windowRankerThresholdSweep &&
      args.windowRankerMinScoreDelta === undefined
    ) {
      throw new Error("--window-ranker-protected-holdout requires --window-ranker-min-score-delta=<value>.");
    }
    if (args.windowRankerThresholdSweep && args.windowRankerMinScoreDelta !== undefined) {
      throw new Error("Choose either --window-ranker-min-score-delta or --window-ranker-min-score-deltas, not both.");
    }
    const lns =
      args.repairTimeLimitSeconds === undefined && args.lnsIterations === undefined
        ? undefined
        : {
            ...(args.lnsIterations === undefined ? {} : { iterations: args.lnsIterations }),
            ...(args.repairTimeLimitSeconds === undefined
              ? {}
              : { repairTimeLimitSeconds: args.repairTimeLimitSeconds })
          };
    const model = readWindowRankerModel(args.windowRankerModelPath);
    const suppressionModel =
      args.windowRankerSuppressionModelPath === undefined
        ? undefined
        : readWindowRankerModel(args.windowRankerSuppressionModelPath, "--window-ranker-suppression-model");
    const corpus = windowRankerOnlineCorpus(args);
    if (args.windowRankerThresholdSweep) {
      const result = runLnsWindowRankerOnlineCalibration(corpus, {
        names: optionalCliNames(args.names),
        seeds: args.seeds,
        model,
        minScoreDeltas: args.windowRankerMinScoreDeltas,
        suppressionModel,
        suppressionMinScoreDelta: args.windowRankerSuppressionMinScoreDelta,
        allowedTransitions: args.windowRankerAllowedTransitions,
        selectedFeatureGates: args.windowRankerSelectedFeatureGates,
        selectedFeatureGateGroups: args.windowRankerSelectedFeatureGateGroups,
        featureDeltaGates: args.windowRankerFeatureDeltaGates,
        lns
      });

      if (args.windowRankerArtifactDir !== undefined) {
        const manifest = writeWindowRankerOnlineCalibrationArtifactBundle(
          result,
          model,
          windowRankerArtifactArgs(args),
          argv
        );
        writeCliJsonOrText(
          args.json,
          () => manifest,
          () => formatWindowRankerOnlineArtifactManifest(manifest)
        );
        return;
      }

      writeCliJsonOrText(
        args.json,
        () => createLnsWindowRankerOnlineCalibrationSnapshot(result),
        () => formatLnsWindowRankerOnlineCalibration(result)
      );
      return;
    }

    const result = runLnsWindowRankerOnlineAblation(corpus, {
      names: optionalCliNames(args.names),
      seeds: args.seeds,
      model,
      minScoreDelta: args.windowRankerMinScoreDelta,
      suppressionModel,
      suppressionMinScoreDelta: args.windowRankerSuppressionMinScoreDelta,
      allowedTransitions: args.windowRankerAllowedTransitions,
      selectedFeatureGates: args.windowRankerSelectedFeatureGates,
      selectedFeatureGateGroups: args.windowRankerSelectedFeatureGateGroups,
      featureDeltaGates: args.windowRankerFeatureDeltaGates,
      lns
    });

    if (args.windowRankerArtifactDir !== undefined) {
      const manifest = writeWindowRankerOnlineArtifactBundle(result, windowRankerArtifactArgs(args), argv);
      writeCliJsonOrText(
        args.json,
        () => manifest,
        () => formatWindowRankerOnlineArtifactManifest(manifest)
      );
      return;
    }

    writeCliJsonOrText(
      args.json,
      () => createLnsWindowRankerOnlineAblationSnapshot(result),
      () => formatLnsWindowRankerOnlineAblation(result)
    );
    return;
  }

  if (args.neighborhoodAblation) {
    const result = runLnsNeighborhoodAblation(undefined, {
      names: optionalCliNames(args.names),
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
      rotateVariantRunOrder: args.rotateVariantRunOrder
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ lns: result });
      if (args.json) {
        writeCliJson(report);
        return;
      }
      writeCliText(formatDeterministicAblationGateReport(report));
      return;
    }

    writeCliJsonOrText(
      args.json,
      () => createLnsNeighborhoodAblationSnapshot(result),
      () => formatLnsNeighborhoodAblation(result)
    );
    return;
  }

  const result = runLnsBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names)
  });

  writeCliJsonOrText(
    args.json,
    () => createLnsBenchmarkSnapshot(result),
    () => formatLnsBenchmarkSuite(result)
  );
}

runCliMain(runLnsBenchmarkCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
