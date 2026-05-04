import fs from "node:fs";
import path from "node:path";

import {
  buildDeterministicAblationGateReport,
  buildLnsWindowRankerOnlineAblationRegistryEntryDraft,
  buildLnsWindowRankerOnlineAblationTelemetryManifest,
  buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft,
  buildLnsWindowRankerOnlineCalibrationTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowRankerOnlineCalibrationSnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
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
  resolveExperimentRegistryGitMetadata,
  runLnsNeighborhoodAblation,
  runLnsWindowRankerOnlineCalibration,
  runLnsWindowRankerOnlineAblation,
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
  completeAppendableRegistryEntry,
  defaultCliReplayCommand,
  normalizeRepoRelativePath,
  writeJsonArtifact
} from "./artifactBundleHelpers.js";
import type {
  LnsNeighborhoodAblationVariantName,
  LnsWindowRankerOnlineCalibrationSuiteResult,
  LnsWindowRankerOnlineAblationSuiteResult,
  LnsWindowReplayStatePolicy
} from "../../benchmarkApi.js";

type LnsWindowRankerRuntimeModel = Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["model"];

interface ParsedBenchmarkArgs {
  json: boolean;
  neighborhoodAblation: boolean;
  windowReplayLabels: boolean;
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
  repairTimeLimitSeconds?: number;
  rollForwardIterations?: number;
  rollForwardRepairTimeLimitSeconds?: number;
  statePolicies?: LnsWindowReplayStatePolicy[];
  stateCollectionIterations?: number;
  stateCollectionRepairTimeLimitSeconds?: number;
  windowRankerModelPath?: string;
  windowRankerMinScoreDelta?: number;
  windowRankerMinScoreDeltas?: number[];
  windowRankerArtifactDir?: string;
  windowRankerProtectedHoldout: boolean;
  windowRankerRunId?: string;
  windowRankerDecision?: string;
  windowRankerSummary?: string;
  windowRankerRegistryPath?: string;
  windowRankerRegisterDryRun: boolean;
}

interface LnsWindowRankerOnlineArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    scorecardJson: string;
    scorecardText: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  modelFingerprint: string | null;
  minScoreDelta: number | null;
  minScoreDeltas?: number[];
  topMeanPopulationDeltaMinScoreDelta?: number | null;
  topSafeMinScoreDelta?: number | null;
  meanPopulationDeltaVsBaseline: number;
  worstPopulationDeltaVsBaseline: number;
  regressedCaseCount: number;
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

interface WindowRankerOnlineArtifactBundlePaths {
  artifactDir: string;
  artifactPaths: LnsWindowRankerOnlineArtifactManifest["artifactPaths"];
  absoluteArtifactPaths: LnsWindowRankerOnlineArtifactManifest["artifactPaths"];
  command: string;
  modelPath: string;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let neighborhoodAblation = false;
  let windowReplayLabels = false;
  let windowRankerOnlineAblation = false;
  let windowRankerThresholdSweep = false;
  let gateReport = false;
  let list = false;
  let ablationVariantNames: LnsNeighborhoodAblationVariantName[] | undefined;
  let seeds: number[] | undefined;
  let rotateVariantRunOrder: boolean | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let repairTimeLimitSeconds: number | undefined;
  let rollForwardIterations: number | undefined;
  let rollForwardRepairTimeLimitSeconds: number | undefined;
  let statePolicies: LnsWindowReplayStatePolicy[] | undefined;
  let stateCollectionIterations: number | undefined;
  let stateCollectionRepairTimeLimitSeconds: number | undefined;
  let windowRankerModelPath: string | undefined;
  let windowRankerMinScoreDelta: number | undefined;
  let windowRankerMinScoreDeltas: number[] | undefined;
  let windowRankerArtifactDir: string | undefined;
  let windowRankerProtectedHoldout = false;
  let windowRankerRunId: string | undefined;
  let windowRankerDecision: string | undefined;
  let windowRankerSummary: string | undefined;
  let windowRankerRegistryPath: string | undefined;
  let windowRankerRegisterDryRun = false;
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
    if (isCliFlag(arg, "--window-ranker-register-dry-run")) {
      windowRankerRegisterDryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--pressure-corpus")) {
      windowReplayLabels = true;
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
    repairTimeLimitSeconds,
    rollForwardIterations,
    rollForwardRepairTimeLimitSeconds,
    statePolicies,
    stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds,
    windowRankerModelPath,
    windowRankerMinScoreDelta,
    windowRankerMinScoreDeltas,
    windowRankerArtifactDir,
    windowRankerProtectedHoldout,
    windowRankerRunId,
    windowRankerDecision,
    windowRankerSummary,
    windowRankerRegistryPath,
    windowRankerRegisterDryRun
  };
}

function parseNonNegativeNumberList(value: string, label: string): number[] {
  const values = parseNumberList(value, label);
  if (values.some((entry) => entry < 0)) {
    throw new Error(`Expected ${label} to contain only non-negative finite numbers.`);
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readWindowRankerModel(modelPath: string): LnsWindowRankerRuntimeModel {
  const repoRelativePath = normalizeRepoRelativePath(modelPath, "--window-ranker-model");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  const candidate =
    isRecord(parsed) && isRecord(parsed.model) && isRecord(parsed.model.weights) ? parsed.model : parsed;
  if (!isRecord(candidate) || !isRecord(candidate.weights)) {
    throw new Error("--window-ranker-model must point to a model JSON object with a weights object.");
  }
  return candidate as unknown as LnsWindowRankerRuntimeModel;
}

function defaultWindowRankerOnlineArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter(
    (arg) => arg !== "--window-ranker-register-dry-run" && !arg.startsWith("--window-ranker-registry=")
  );
  return defaultCliReplayCommand("dist/lnsBenchmarkCli.js", replayArgs);
}

function registerWindowRankerOnlineArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedBenchmarkArgs
): LnsWindowRankerOnlineArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.windowRankerRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--window-ranker-registry"
  );
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "LNS window ranker online registry entry is invalid."
  );
  return {
    registryPath,
    dryRun: true,
    appended: false,
    runId: completedEntry.runId
  };
}

function onlineAblationRankerSummary(result: LnsWindowRankerOnlineAblationSuiteResult) {
  const summary = result.variantSummaries.find((entry) => entry.variantName === "window-ranker");
  if (!summary) {
    throw new Error("LNS window ranker online ablation artifact missing window-ranker summary.");
  }
  return summary;
}

function onlineAblationModelFingerprint(result: LnsWindowRankerOnlineAblationSuiteResult): string | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.modelFingerprint ?? null
  );
}

function onlineAblationMinScoreDelta(result: LnsWindowRankerOnlineAblationSuiteResult): number | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.minScoreDelta ?? null
  );
}

function onlineCalibrationTopMeanSummary(result: LnsWindowRankerOnlineCalibrationSuiteResult) {
  return (
    result.thresholdSummaries.find((entry) => entry.minScoreDelta === result.topMeanPopulationDeltaMinScoreDelta) ??
    result.thresholdSummaries[0]
  );
}

function prepareWindowRankerOnlineArtifactBundle(
  args: ParsedBenchmarkArgs,
  argv: readonly string[],
  scorecardBaseName: string
): WindowRankerOnlineArtifactBundlePaths {
  if (args.windowRankerArtifactDir === undefined) {
    throw new Error("LNS window ranker online artifact directory is required.");
  }
  if (args.windowRankerModelPath === undefined) {
    throw new Error("LNS window ranker online artifacts require --window-ranker-model.");
  }
  const artifactDir = normalizeRepoRelativePath(args.windowRankerArtifactDir, "--window-ranker-artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const scorecardJsonFile = `${scorecardBaseName}.json`;
  const scorecardTextFile = `${scorecardBaseName}.txt`;
  return {
    artifactDir,
    artifactPaths: {
      scorecardJson: artifactPath(scorecardJsonFile),
      scorecardText: artifactPath(scorecardTextFile),
      telemetryManifestJson: artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifactPath("registry-entry-draft.json")
    },
    absoluteArtifactPaths: {
      scorecardJson: absoluteArtifactPath(scorecardJsonFile),
      scorecardText: absoluteArtifactPath(scorecardTextFile),
      telemetryManifestJson: absoluteArtifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: absoluteArtifactPath("registry-entry-draft.json")
    },
    command: defaultWindowRankerOnlineArtifactCommand(argv),
    modelPath: normalizeRepoRelativePath(args.windowRankerModelPath, "--window-ranker-model")
  };
}

function writeWindowRankerOnlineArtifactFiles(
  paths: WindowRankerOnlineArtifactBundlePaths,
  scorecardSnapshot: Record<string, unknown>,
  scorecardText: string,
  telemetryManifest: unknown,
  registryEntryDraft: Record<string, unknown>
): void {
  writeJsonArtifact(paths.absoluteArtifactPaths.scorecardJson, scorecardSnapshot);
  fs.writeFileSync(paths.absoluteArtifactPaths.scorecardText, `${scorecardText}\n`);
  writeJsonArtifact(paths.absoluteArtifactPaths.telemetryManifestJson, telemetryManifest);
  writeJsonArtifact(paths.absoluteArtifactPaths.registryEntryDraftJson, registryEntryDraft);
}

function writeWindowRankerOnlineArtifactBundle(
  result: LnsWindowRankerOnlineAblationSuiteResult,
  args: ParsedBenchmarkArgs,
  argv: readonly string[]
): LnsWindowRankerOnlineArtifactManifest {
  const paths = prepareWindowRankerOnlineArtifactBundle(args, argv, "lns-window-ranker-online-ablation");
  const telemetryManifest = buildLnsWindowRankerOnlineAblationTelemetryManifest(result, {
    command: paths.command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts: [paths.modelPath],
    outputArtifacts: [
      paths.artifactPaths.scorecardJson,
      paths.artifactPaths.scorecardText,
      paths.artifactPaths.telemetryManifestJson
    ]
  });
  const registryEntryDraft = buildLnsWindowRankerOnlineAblationRegistryEntryDraft(result, {
    runId: args.windowRankerRunId,
    commands: [paths.command],
    artifactPaths: [
      paths.artifactPaths.scorecardJson,
      paths.artifactPaths.scorecardText,
      paths.artifactPaths.telemetryManifestJson
    ],
    decision: args.windowRankerDecision,
    summary: args.windowRankerSummary,
    modelPath: paths.modelPath,
    protectedHoldout: args.windowRankerProtectedHoldout
  });

  writeWindowRankerOnlineArtifactFiles(
    paths,
    {
      ...createLnsWindowRankerOnlineAblationSnapshot(result),
      generatedAt: result.generatedAt
    },
    formatLnsWindowRankerOnlineAblation(result),
    telemetryManifest,
    registryEntryDraft
  );

  const summary = onlineAblationRankerSummary(result);
  const registry = args.windowRankerRegisterDryRun
    ? registerWindowRankerOnlineArtifacts(registryEntryDraft, args)
    : undefined;

  return {
    artifactDir: paths.artifactDir,
    artifactPaths: paths.artifactPaths,
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    modelFingerprint: onlineAblationModelFingerprint(result),
    minScoreDelta: onlineAblationMinScoreDelta(result),
    meanPopulationDeltaVsBaseline: summary.meanPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
    regressedCaseCount: summary.regressedCaseCount,
    registry
  };
}

function writeWindowRankerOnlineCalibrationArtifactBundle(
  result: LnsWindowRankerOnlineCalibrationSuiteResult,
  model: LnsWindowRankerRuntimeModel,
  args: ParsedBenchmarkArgs,
  argv: readonly string[]
): LnsWindowRankerOnlineArtifactManifest {
  const paths = prepareWindowRankerOnlineArtifactBundle(args, argv, "lns-window-ranker-online-calibration");
  const telemetryManifest = buildLnsWindowRankerOnlineCalibrationTelemetryManifest(result, {
    command: paths.command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    model,
    inputArtifacts: [paths.modelPath],
    outputArtifacts: [
      paths.artifactPaths.scorecardJson,
      paths.artifactPaths.scorecardText,
      paths.artifactPaths.telemetryManifestJson
    ]
  });
  const registryEntryDraft = buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft(result, {
    runId: args.windowRankerRunId,
    commands: [paths.command],
    artifactPaths: [
      paths.artifactPaths.scorecardJson,
      paths.artifactPaths.scorecardText,
      paths.artifactPaths.telemetryManifestJson
    ],
    decision: args.windowRankerDecision,
    summary: args.windowRankerSummary,
    model,
    modelPath: paths.modelPath,
    protectedHoldout: args.windowRankerProtectedHoldout
  });

  writeWindowRankerOnlineArtifactFiles(
    paths,
    {
      ...createLnsWindowRankerOnlineCalibrationSnapshot(result),
      generatedAt: result.generatedAt
    },
    formatLnsWindowRankerOnlineCalibration(result),
    telemetryManifest,
    registryEntryDraft
  );

  const summary = onlineCalibrationTopMeanSummary(result);
  const registry = args.windowRankerRegisterDryRun
    ? registerWindowRankerOnlineArtifacts(registryEntryDraft, args)
    : undefined;

  return {
    artifactDir: paths.artifactDir,
    artifactPaths: paths.artifactPaths,
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    modelFingerprint: result.modelFingerprint,
    minScoreDelta: summary?.minScoreDelta ?? null,
    minScoreDeltas: [...result.minScoreDeltas],
    topMeanPopulationDeltaMinScoreDelta: result.topMeanPopulationDeltaMinScoreDelta,
    topSafeMinScoreDelta: result.topSafeMinScoreDelta,
    meanPopulationDeltaVsBaseline: summary?.meanPopulationDeltaVsBaseline ?? 0,
    worstPopulationDeltaVsBaseline: summary?.worstPopulationDeltaVsBaseline ?? 0,
    regressedCaseCount: summary?.regressedCaseCount ?? 0,
    registry
  };
}

function formatWindowRankerOnlineArtifactManifest(manifest: LnsWindowRankerOnlineArtifactManifest): string {
  const lines = [
    `LNS window ranker online artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `model-fingerprint=${manifest.modelFingerprint ?? "n/a"}`,
    `min-score-delta=${manifest.minScoreDelta ?? "n/a"}`,
    ...(manifest.minScoreDeltas === undefined ? [] : [`min-score-deltas=${manifest.minScoreDeltas.join(",")}`]),
    ...(manifest.topMeanPopulationDeltaMinScoreDelta === undefined
      ? []
      : [`top-mean-delta-threshold=${manifest.topMeanPopulationDeltaMinScoreDelta ?? "n/a"}`]),
    ...(manifest.topSafeMinScoreDelta === undefined
      ? []
      : [`top-no-regression-threshold=${manifest.topSafeMinScoreDelta ?? "n/a"}`]),
    `mean-delta=${manifest.meanPopulationDeltaVsBaseline}`,
    `worst-delta=${manifest.worstPopulationDeltaVsBaseline}`,
    `regressed=${manifest.regressedCaseCount}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ];
  if (manifest.registry !== undefined) {
    lines.push(`registry-dry-run=${manifest.registry.registryPath}`);
  }
  return lines.join("\n");
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
  if (args.windowRankerArtifactDir !== undefined && !args.windowRankerOnlineAblation) {
    throw new Error("--window-ranker-artifact-dir is only available with --window-ranker-online-ablation.");
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
  if (args.list) {
    const names = args.neighborhoodAblation
      ? listLnsNeighborhoodAblationCaseNames()
      : args.windowReplayLabels
        ? listLnsWindowReplayCaseNames()
        : args.windowRankerOnlineAblation
          ? listLnsWindowRankerOnlineAblationCaseNames(
              args.windowRankerProtectedHoldout ? DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS : undefined
            )
          : listLnsBenchmarkCaseNames();
    writeCliList(names);
    return;
  }

  if (args.windowReplayLabels) {
    const result = runLnsWindowReplayLabels(undefined, {
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
    });

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
      args.windowRankerProtectedHoldout &&
      !args.windowRankerThresholdSweep &&
      args.windowRankerMinScoreDelta === undefined
    ) {
      throw new Error("--window-ranker-protected-holdout requires --window-ranker-min-score-delta=<value>.");
    }
    if (args.windowRankerThresholdSweep && args.windowRankerMinScoreDelta !== undefined) {
      throw new Error("Choose either --window-ranker-min-score-delta or --window-ranker-min-score-deltas, not both.");
    }
    const lns =
      args.repairTimeLimitSeconds === undefined
        ? undefined
        : {
            repairTimeLimitSeconds: args.repairTimeLimitSeconds
          };
    const model = readWindowRankerModel(args.windowRankerModelPath);
    const corpus = args.windowRankerProtectedHoldout
      ? DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS
      : undefined;
    if (args.windowRankerThresholdSweep) {
      const result = runLnsWindowRankerOnlineCalibration(corpus, {
        names: optionalCliNames(args.names),
        seeds: args.seeds,
        model,
        minScoreDeltas: args.windowRankerMinScoreDeltas,
        lns
      });

      if (args.windowRankerArtifactDir !== undefined) {
        const manifest = writeWindowRankerOnlineCalibrationArtifactBundle(result, model, args, argv);
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
      lns
    });

    if (args.windowRankerArtifactDir !== undefined) {
      const manifest = writeWindowRankerOnlineArtifactBundle(result, args, argv);
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
