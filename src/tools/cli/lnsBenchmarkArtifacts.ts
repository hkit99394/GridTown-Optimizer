import fs from "node:fs";
import path from "node:path";

import {
  buildLnsWindowRankerOnlineAblationRegistryEntryDraft,
  buildLnsWindowRankerOnlineAblationTelemetryManifest,
  buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft,
  buildLnsWindowRankerOnlineCalibrationTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createLnsWindowRankerOnlineAblationSnapshot,
  createLnsWindowRankerOnlineCalibrationSnapshot,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  formatLnsWindowRankerOnlineAblation,
  formatLnsWindowRankerOnlineCalibration,
  resolveExperimentRegistryGitMetadata
} from "../../benchmarkApi.js";
import type {
  LnsWindowRankerOnlineAblationSnapshot,
  LnsWindowRankerOnlineAblationSuiteResult,
  LnsWindowRankerOnlineCalibrationSuiteResult,
  LnsWindowRankerOnlineProtectedCorpus,
  runLnsWindowRankerOnlineAblation
} from "../../benchmarkApi.js";
import {
  assertArtifactPathNotObsolete,
  completeAppendableRegistryEntry,
  defaultCliReplayCommand,
  normalizeRepoRelativePath,
  prepareArtifactBundleDirectory,
  writeJsonArtifact,
  writeTextArtifact
} from "./artifactBundleHelpers.js";

export type LnsWindowRankerRuntimeModel = Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["model"];
export type LnsWindowRankerFeatureDeltaGate = NonNullable<
  Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["featureDeltaGates"]
>[number];
export type LnsWindowRankerSelectedFeatureGate = NonNullable<
  Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["selectedFeatureGates"]
>[number];
export type LnsWindowRankerSelectedFeatureGateGroup = NonNullable<
  Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["selectedFeatureGateGroups"]
>[number];

export interface LnsWindowRankerOnlineArtifactArgs {
  windowRankerModelPath?: string;
  windowRankerSuppressionModelPath?: string;
  windowRankerArtifactDir?: string;
  windowRankerProtectedHoldout: boolean;
  windowRankerProtectedCorpus?: LnsWindowRankerOnlineProtectedCorpus;
  windowRankerRunId?: string;
  windowRankerDecision?: string;
  windowRankerSummary?: string;
  windowRankerRegistryPath?: string;
  windowRankerRegisterDryRun: boolean;
  forceArtifactDir: boolean;
}

export interface LnsWindowRankerOnlineArtifactManifest {
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
  suppressionModelFingerprint?: string | null;
  suppressionMinScoreDelta?: number | null;
  protectedCorpus?: LnsWindowRankerOnlineProtectedCorpus;
  minScoreDelta: number | null;
  allowedTransitions?: string[];
  selectedFeatureGates?: LnsWindowRankerSelectedFeatureGate[];
  selectedFeatureGateGroups?: LnsWindowRankerSelectedFeatureGateGroup[];
  featureDeltaGates?: LnsWindowRankerFeatureDeltaGate[];
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
  suppressionModelPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readWindowRankerModel(
  modelPath: string,
  label: "--window-ranker-model" | "--window-ranker-suppression-model" = "--window-ranker-model"
): LnsWindowRankerRuntimeModel {
  const repoRelativePath = normalizeRepoRelativePath(modelPath, label);
  assertArtifactPathNotObsolete(repoRelativePath, label);
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  const candidate =
    isRecord(parsed) && isRecord(parsed.model) && isRecord(parsed.model.weights) ? parsed.model : parsed;
  if (!isRecord(candidate) || !isRecord(candidate.weights)) {
    throw new Error(`${label} must point to a model JSON object with a weights object.`);
  }
  return candidate as unknown as LnsWindowRankerRuntimeModel;
}

export function readWindowRankerOnlineScorecard(scorecardPath: string): LnsWindowRankerOnlineAblationSnapshot {
  const repoRelativePath = normalizeRepoRelativePath(scorecardPath, "--window-replay-online-scorecard");
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
}

function defaultWindowRankerOnlineArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter(
    (arg) => arg !== "--window-ranker-register-dry-run" && !arg.startsWith("--window-ranker-registry=")
  );
  return defaultCliReplayCommand("dist/lnsBenchmarkCli.js", replayArgs);
}

function registerWindowRankerOnlineArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: LnsWindowRankerOnlineArtifactArgs
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

function onlineAblationSuppressionModelFingerprint(result: LnsWindowRankerOnlineAblationSuiteResult): string | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.suppressionModelFingerprint ?? null
  );
}

function onlineAblationSuppressionMinScoreDelta(result: LnsWindowRankerOnlineAblationSuiteResult): number | null {
  return (
    result.cases.flatMap((entry) => entry.variants).find((variant) => variant.variantName === "window-ranker")
      ?.windowRanker?.suppressionMinScoreDelta ?? null
  );
}

function onlineAblationAllowedTransitions(result: LnsWindowRankerOnlineAblationSuiteResult): string[] | undefined {
  const allowedTransitions = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.windowRanker?.allowedTransitions;
  return allowedTransitions ? [...allowedTransitions] : undefined;
}

function onlineAblationFeatureDeltaGates(
  result: LnsWindowRankerOnlineAblationSuiteResult
): LnsWindowRankerFeatureDeltaGate[] | undefined {
  const featureDeltaGates = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.windowRanker?.featureDeltaGates;
  return featureDeltaGates && featureDeltaGates.length > 0 ? [...featureDeltaGates] : undefined;
}

function onlineAblationSelectedFeatureGates(
  result: LnsWindowRankerOnlineAblationSuiteResult
): LnsWindowRankerSelectedFeatureGate[] | undefined {
  const selectedFeatureGates = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.windowRanker?.selectedFeatureGates;
  return selectedFeatureGates && selectedFeatureGates.length > 0 ? [...selectedFeatureGates] : undefined;
}

function onlineAblationSelectedFeatureGateGroups(
  result: LnsWindowRankerOnlineAblationSuiteResult
): LnsWindowRankerSelectedFeatureGateGroup[] | undefined {
  const selectedFeatureGateGroups = result.cases
    .flatMap((entry) => entry.variants)
    .find((variant) => variant.variantName === "window-ranker")?.windowRanker?.selectedFeatureGateGroups;
  return selectedFeatureGateGroups && selectedFeatureGateGroups.length > 0
    ? selectedFeatureGateGroups.map((group) => [...group])
    : undefined;
}

function onlineCalibrationTopMeanSummary(result: LnsWindowRankerOnlineCalibrationSuiteResult) {
  return (
    result.thresholdSummaries.find((entry) => entry.minScoreDelta === result.topMeanPopulationDeltaMinScoreDelta) ??
    result.thresholdSummaries[0]
  );
}

function prepareWindowRankerOnlineArtifactBundle(
  args: LnsWindowRankerOnlineArtifactArgs,
  argv: readonly string[],
  scorecardBaseName: string
): WindowRankerOnlineArtifactBundlePaths {
  if (args.windowRankerArtifactDir === undefined) {
    throw new Error("LNS window ranker online artifact directory is required.");
  }
  if (args.windowRankerModelPath === undefined) {
    throw new Error("LNS window ranker online artifacts require --window-ranker-model.");
  }
  const artifacts = prepareArtifactBundleDirectory(args.windowRankerArtifactDir, "--window-ranker-artifact-dir", {
    force: args.forceArtifactDir
  });
  const scorecardJsonFile = `${scorecardBaseName}.json`;
  const scorecardTextFile = `${scorecardBaseName}.txt`;
  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      scorecardJson: artifacts.artifactPath(scorecardJsonFile),
      scorecardText: artifacts.artifactPath(scorecardTextFile),
      telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json")
    },
    absoluteArtifactPaths: {
      scorecardJson: artifacts.absoluteArtifactPath(scorecardJsonFile),
      scorecardText: artifacts.absoluteArtifactPath(scorecardTextFile),
      telemetryManifestJson: artifacts.absoluteArtifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifacts.absoluteArtifactPath("registry-entry-draft.json")
    },
    command: defaultWindowRankerOnlineArtifactCommand(argv),
    modelPath: normalizeRepoRelativePath(args.windowRankerModelPath, "--window-ranker-model"),
    ...(args.windowRankerSuppressionModelPath === undefined
      ? {}
      : {
          suppressionModelPath: normalizeRepoRelativePath(
            args.windowRankerSuppressionModelPath,
            "--window-ranker-suppression-model"
          )
        })
  };
}

function writeWindowRankerOnlineArtifactFiles(
  paths: WindowRankerOnlineArtifactBundlePaths,
  scorecardSnapshot: Record<string, unknown>,
  scorecardText: string,
  telemetryManifest: unknown,
  registryEntryDraft: Record<string, unknown>,
  force: boolean
): void {
  writeJsonArtifact(paths.absoluteArtifactPaths.scorecardJson, scorecardSnapshot, { force });
  writeTextArtifact(paths.absoluteArtifactPaths.scorecardText, `${scorecardText}\n`, { force });
  writeJsonArtifact(paths.absoluteArtifactPaths.telemetryManifestJson, telemetryManifest, { force });
  writeJsonArtifact(paths.absoluteArtifactPaths.registryEntryDraftJson, registryEntryDraft, { force });
}

export function writeWindowRankerOnlineArtifactBundle(
  result: LnsWindowRankerOnlineAblationSuiteResult,
  args: LnsWindowRankerOnlineArtifactArgs,
  argv: readonly string[]
): LnsWindowRankerOnlineArtifactManifest {
  const paths = prepareWindowRankerOnlineArtifactBundle(args, argv, "lns-window-ranker-online-ablation");
  const telemetryManifest = buildLnsWindowRankerOnlineAblationTelemetryManifest(result, {
    command: paths.command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts: [
      paths.modelPath,
      ...(paths.suppressionModelPath === undefined ? [] : [paths.suppressionModelPath])
    ],
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
    suppressionModelPath: paths.suppressionModelPath,
    protectedHoldout: args.windowRankerProtectedHoldout,
    protectedCorpus: args.windowRankerProtectedCorpus
  });

  writeWindowRankerOnlineArtifactFiles(
    paths,
    {
      ...createLnsWindowRankerOnlineAblationSnapshot(result),
      generatedAt: result.generatedAt
    },
    formatLnsWindowRankerOnlineAblation(result),
    telemetryManifest,
    registryEntryDraft,
    args.forceArtifactDir
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
    suppressionModelFingerprint: onlineAblationSuppressionModelFingerprint(result),
    suppressionMinScoreDelta: onlineAblationSuppressionMinScoreDelta(result),
    protectedCorpus: args.windowRankerProtectedCorpus,
    minScoreDelta: onlineAblationMinScoreDelta(result),
    allowedTransitions: onlineAblationAllowedTransitions(result),
    selectedFeatureGates: onlineAblationSelectedFeatureGates(result),
    selectedFeatureGateGroups: onlineAblationSelectedFeatureGateGroups(result),
    featureDeltaGates: onlineAblationFeatureDeltaGates(result),
    meanPopulationDeltaVsBaseline: summary.meanPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
    regressedCaseCount: summary.regressedCaseCount,
    registry
  };
}

export function writeWindowRankerOnlineCalibrationArtifactBundle(
  result: LnsWindowRankerOnlineCalibrationSuiteResult,
  model: LnsWindowRankerRuntimeModel,
  args: LnsWindowRankerOnlineArtifactArgs,
  argv: readonly string[]
): LnsWindowRankerOnlineArtifactManifest {
  const paths = prepareWindowRankerOnlineArtifactBundle(args, argv, "lns-window-ranker-online-calibration");
  const telemetryManifest = buildLnsWindowRankerOnlineCalibrationTelemetryManifest(result, {
    command: paths.command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    model,
    inputArtifacts: [
      paths.modelPath,
      ...(paths.suppressionModelPath === undefined ? [] : [paths.suppressionModelPath])
    ],
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
    suppressionModelPath: paths.suppressionModelPath,
    protectedHoldout: args.windowRankerProtectedHoldout,
    protectedCorpus: args.windowRankerProtectedCorpus
  });

  writeWindowRankerOnlineArtifactFiles(
    paths,
    {
      ...createLnsWindowRankerOnlineCalibrationSnapshot(result),
      generatedAt: result.generatedAt
    },
    formatLnsWindowRankerOnlineCalibration(result),
    telemetryManifest,
    registryEntryDraft,
    args.forceArtifactDir
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
    suppressionModelFingerprint: result.suppressionModelFingerprint,
    suppressionMinScoreDelta: result.suppressionMinScoreDelta,
    protectedCorpus: args.windowRankerProtectedCorpus,
    minScoreDelta: summary?.minScoreDelta ?? null,
    ...(result.allowedTransitions === undefined ? {} : { allowedTransitions: [...result.allowedTransitions] }),
    ...(result.selectedFeatureGates === undefined ? {} : { selectedFeatureGates: [...result.selectedFeatureGates] }),
    ...(result.selectedFeatureGateGroups === undefined
      ? {}
      : { selectedFeatureGateGroups: result.selectedFeatureGateGroups.map((group) => [...group]) }),
    ...(result.featureDeltaGates === undefined ? {} : { featureDeltaGates: [...result.featureDeltaGates] }),
    minScoreDeltas: [...result.minScoreDeltas],
    topMeanPopulationDeltaMinScoreDelta: result.topMeanPopulationDeltaMinScoreDelta,
    topSafeMinScoreDelta: result.topSafeMinScoreDelta,
    meanPopulationDeltaVsBaseline: summary?.meanPopulationDeltaVsBaseline ?? 0,
    worstPopulationDeltaVsBaseline: summary?.worstPopulationDeltaVsBaseline ?? 0,
    regressedCaseCount: summary?.regressedCaseCount ?? 0,
    registry
  };
}

export function formatWindowRankerOnlineArtifactManifest(manifest: LnsWindowRankerOnlineArtifactManifest): string {
  const lines = [
    `LNS window ranker online artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `model-fingerprint=${manifest.modelFingerprint ?? "n/a"}`,
    ...(manifest.suppressionModelFingerprint === undefined || manifest.suppressionModelFingerprint === null
      ? []
      : [`suppression-model-fingerprint=${manifest.suppressionModelFingerprint}`]),
    ...(manifest.suppressionMinScoreDelta === undefined || manifest.suppressionMinScoreDelta === null
      ? []
      : [`suppression-min-score-delta=${manifest.suppressionMinScoreDelta}`]),
    ...(manifest.protectedCorpus === undefined ? [] : [`protected-corpus=${manifest.protectedCorpus}`]),
    `min-score-delta=${manifest.minScoreDelta ?? "n/a"}`,
    ...(manifest.allowedTransitions === undefined
      ? []
      : [`allowed-transitions=${manifest.allowedTransitions.join(",")}`]),
    ...(manifest.selectedFeatureGates === undefined
      ? []
      : [
          `selected-feature-gates=${manifest.selectedFeatureGates
            .map((gate) =>
              gate.minValue === undefined
                ? `${gate.feature}<=${gate.maxValue}`
                : gate.maxValue === undefined
                  ? `${gate.feature}>=${gate.minValue}`
                  : `${gate.minValue}<=${gate.feature}<=${gate.maxValue}`
            )
            .join(",")}`
        ]),
    ...(manifest.selectedFeatureGateGroups === undefined
      ? []
      : [
          `selected-feature-gate-groups=${manifest.selectedFeatureGateGroups
            .map((group) =>
              group
                .map((gate) =>
                  gate.minValue === undefined
                    ? `${gate.feature}<=${gate.maxValue}`
                    : gate.maxValue === undefined
                      ? `${gate.feature}>=${gate.minValue}`
                      : `${gate.minValue}<=${gate.feature}<=${gate.maxValue}`
                )
                .join(",")
            )
            .join(";")}`
        ]),
    ...(manifest.featureDeltaGates === undefined
      ? []
      : [
          `feature-delta-gates=${manifest.featureDeltaGates
            .map((gate) =>
              gate.minDelta === undefined
                ? `${gate.feature}<=${gate.maxDelta}`
                : gate.maxDelta === undefined
                  ? `${gate.feature}>=${gate.minDelta}`
                  : `${gate.minDelta}<=${gate.feature}<=${gate.maxDelta}`
            )
            .join(",")}`
        ]),
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
