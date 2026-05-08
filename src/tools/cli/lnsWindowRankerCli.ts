import fs from "node:fs";
import path from "node:path";

import {
  buildLnsWindowRankerRegistryEntryDraft,
  buildLnsWindowRankerTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createLnsWindowRankerSnapshot,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft,
  buildLnsWindowRankerGapDiagnosticsTelemetryManifest,
  formatLnsWindowRankerGapDiagnostics,
  formatLnsWindowRankerExperiment,
  resolveExperimentRegistryGitMetadata,
  runLnsWindowRankerGapDiagnostics,
  runLnsWindowRankerExperiment
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parsePositiveInteger,
  parsePositiveNumber
} from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import { writeCliJsonOrText } from "../../apps/cliOutput.js";
import {
  completeAppendableRegistryEntry,
  defaultCliReplayCommand,
  normalizeRepoRelativePath,
  writeJsonArtifact
} from "./artifactBundleHelpers.js";

import type {
  LearnedRankingLabelSnapshot,
  LnsWindowRankerExperimentResult,
  LnsWindowRankerGapDiagnosticsResult,
  LnsWindowRankerModel,
  LnsWindowRankerOnlineAblationSnapshot,
  LnsWindowReplaySnapshot
} from "../../benchmarkApi.js";
import type { LnsWindowRankerLabelTarget } from "../../benchmarkApi.js";

interface ParsedLnsWindowRankerArgs {
  json: boolean;
  labelsPath?: string;
  modelPath?: string;
  onlineScorecardPath?: string;
  supplementalReplayLabelPaths: string[];
  epochs?: number;
  learningRate?: number;
  marginWeightCap?: number;
  baselineTieBreak: boolean;
  gapDiagnostics: boolean;
  supplementalReplayCalibration: boolean;
  supplementalReplayCalibrationIgnoreBaselineFeature: boolean;
  target?: LnsWindowRankerLabelTarget;
  allowWeakSeedReplayLabels: boolean;
  excludeFeatureIdenticalRepeatabilityConflicts: boolean;
  topK?: number;
  randomBaselineSeed?: number;
  artifactDir?: string;
  rankerRunId?: string;
  rankerDecision?: string;
  rankerSummary?: string;
  rankerRegistryPath?: string;
  rankerRegisterDryRun: boolean;
}

interface LnsWindowRankerArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    experimentJson: string;
    experimentText: string;
    modelJson: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  passed: boolean;
  bestBaselineName: string;
  bestBaselineHoldoutCaptureRate: number;
  modelHoldoutCaptureRate: number;
  holdoutCaptureDeltaVsBestBaseline: number;
  modelFingerprint: string;
  datasetFingerprint: string;
  labelFingerprint: string;
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

interface LnsWindowRankerGapArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    diagnosticsJson: string;
    diagnosticsText: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  promotionBlocked: boolean;
  offlinePositiveOnlineNeutralCount: number;
  onlineOverrideCount: number;
  onlineFinalNeutralOverrideCount: number;
  rankerModelFingerprint: string;
  labelFingerprint: string;
  onlineScorecardFingerprint: string;
  supplementalReplayFingerprints: string[];
  offlineSupplementalDecisionCount: number;
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

function parseArgs(argv: string[]): ParsedLnsWindowRankerArgs {
  let json = false;
  let labelsPath: string | undefined;
  let modelPath: string | undefined;
  let onlineScorecardPath: string | undefined;
  let supplementalReplayLabelPaths: string[] = [];
  let epochs: number | undefined;
  let learningRate: number | undefined;
  let marginWeightCap: number | undefined;
  let baselineTieBreak = false;
  let gapDiagnostics = false;
  let supplementalReplayCalibration = false;
  let supplementalReplayCalibrationIgnoreBaselineFeature = false;
  let target: LnsWindowRankerLabelTarget | undefined;
  let allowWeakSeedReplayLabels = true;
  let excludeFeatureIdenticalRepeatabilityConflicts = false;
  let topK: number | undefined;
  let randomBaselineSeed: number | undefined;
  let artifactDir: string | undefined;
  let rankerRunId: string | undefined;
  let rankerDecision: string | undefined;
  let rankerSummary: string | undefined;
  let rankerRegistryPath: string | undefined;
  let rankerRegisterDryRun = false;
  const appendSupplementalReplayLabelPaths = (value: string) => {
    const paths = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (paths.length === 0) {
      throw new Error("--supplemental-replay-labels requires at least one path.");
    }
    supplementalReplayLabelPaths = [...supplementalReplayLabelPaths, ...paths];
  };
  const inlineOptions: Record<string, (value: string) => void> = {
    labels: (value) => {
      labelsPath = value;
    },
    "label-artifact": (value) => {
      labelsPath = value;
    },
    model: (value) => {
      modelPath = value;
    },
    "ranker-model": (value) => {
      modelPath = value;
    },
    "online-scorecard": (value) => {
      onlineScorecardPath = value;
    },
    "online-ablation": (value) => {
      onlineScorecardPath = value;
    },
    "supplemental-replay-labels": appendSupplementalReplayLabelPaths,
    "supplemental-lns-replay": appendSupplementalReplayLabelPaths,
    "supplemental-window-replay-labels": appendSupplementalReplayLabelPaths,
    epochs: (value) => {
      epochs = parsePositiveInteger(value, "epochs");
    },
    "learning-rate": (value) => {
      learningRate = parsePositiveNumber(value, "learning rate");
    },
    "margin-weight-cap": (value) => {
      marginWeightCap = parsePositiveNumber(value, "margin weight cap");
    },
    target: (value) => {
      if (
        value !== "immediate-improvement" &&
        value !== "roll-forward-final-lift" &&
        value !== "roll-forward-baseline-stall-lift"
      ) {
        throw new Error(`Unknown LNS window ranker target: ${value}`);
      }
      target = value;
    },
    "top-k": (value) => {
      topK = parsePositiveInteger(value, "top k");
    },
    "random-seed": (value) => {
      randomBaselineSeed = parsePositiveInteger(value, "random seed");
    },
    "artifact-dir": (value) => {
      artifactDir = value;
    },
    "ranker-run-id": (value) => {
      rankerRunId = value;
    },
    "ranker-decision": (value) => {
      rankerDecision = value;
    },
    "ranker-summary": (value) => {
      rankerSummary = value;
    },
    "ranker-registry": (value) => {
      rankerRegistryPath = value;
    }
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--ranker-register-dry-run")) {
      rankerRegisterDryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--baseline-tie-break", "--prefer-baseline-on-ties")) {
      baselineTieBreak = true;
      continue;
    }
    if (isCliFlag(arg, "--gap-diagnostics", "--offline-online-gap-diagnostics")) {
      gapDiagnostics = true;
      continue;
    }
    if (
      isCliFlag(
        arg,
        "--supplemental-replay-calibration",
        "--supplemental-replay-training",
        "--calibrate-supplemental-replay"
      )
    ) {
      supplementalReplayCalibration = true;
      continue;
    }
    if (
      isCliFlag(
        arg,
        "--supplemental-replay-calibration-ignore-baseline-feature",
        "--supplemental-replay-ignore-baseline-feature"
      )
    ) {
      supplementalReplayCalibrationIgnoreBaselineFeature = true;
      continue;
    }
    if (isCliFlag(arg, "--roll-forward-final-lift", "--final-lift-target")) {
      target = "roll-forward-final-lift";
      continue;
    }
    if (isCliFlag(arg, "--roll-forward-baseline-stall-lift", "--baseline-stall-target")) {
      target = "roll-forward-baseline-stall-lift";
      continue;
    }
    if (isCliFlag(arg, "--exclude-weak-replay-seed-labels", "--no-weak-replay-seed-labels")) {
      allowWeakSeedReplayLabels = false;
      continue;
    }
    if (isCliFlag(arg, "--exclude-feature-identical-repeatability-conflicts", "--exclude-repeatability-conflicts")) {
      excludeFeatureIdenticalRepeatabilityConflicts = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    throw new Error(`Unknown LNS window ranker argument: ${arg}`);
  }

  return {
    json,
    labelsPath,
    modelPath,
    onlineScorecardPath,
    supplementalReplayLabelPaths,
    epochs,
    learningRate,
    marginWeightCap,
    baselineTieBreak,
    gapDiagnostics,
    supplementalReplayCalibration,
    supplementalReplayCalibrationIgnoreBaselineFeature,
    target,
    allowWeakSeedReplayLabels,
    excludeFeatureIdenticalRepeatabilityConflicts,
    topK,
    randomBaselineSeed,
    artifactDir,
    rankerRunId,
    rankerDecision,
    rankerSummary,
    rankerRegistryPath,
    rankerRegisterDryRun
  };
}

function readLabelSnapshot(labelsPath: string): LearnedRankingLabelSnapshot {
  const repoRelativePath = normalizeRepoRelativePath(labelsPath, "--labels");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  return parsed as LearnedRankingLabelSnapshot;
}

function readRankerModel(modelPath: string): LnsWindowRankerModel {
  const repoRelativePath = normalizeRepoRelativePath(modelPath, "--model");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  return parsed as LnsWindowRankerModel;
}

function readOnlineScorecard(scorecardPath: string): LnsWindowRankerOnlineAblationSnapshot {
  const repoRelativePath = normalizeRepoRelativePath(scorecardPath, "--online-scorecard");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  return parsed as LnsWindowRankerOnlineAblationSnapshot;
}

function readSupplementalReplaySnapshot(replayPath: string): LnsWindowReplaySnapshot {
  const repoRelativePath = normalizeRepoRelativePath(replayPath, "--supplemental-replay-labels");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  return parsed as LnsWindowReplaySnapshot;
}

function defaultRankerArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter((arg) => arg !== "--ranker-register-dry-run" && !arg.startsWith("--ranker-registry="));
  return defaultCliReplayCommand("dist/lnsWindowRankerCli.js", replayArgs);
}

function registerRankerArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedLnsWindowRankerArgs
): LnsWindowRankerArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.rankerRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--ranker-registry"
  );
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "LNS window ranker registry entry is invalid."
  );
  return {
    registryPath,
    dryRun: true,
    appended: false,
    runId: completedEntry.runId
  };
}

function writeLnsWindowRankerArtifactBundle(
  result: LnsWindowRankerExperimentResult,
  labelsPath: string,
  args: ParsedLnsWindowRankerArgs,
  argv: readonly string[]
): LnsWindowRankerArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("LNS window ranker artifact directory is required.");
  }
  const artifactDir = normalizeRepoRelativePath(args.artifactDir, "--artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const experimentJson = artifactPath("lns-window-ranker.json");
  const experimentText = artifactPath("lns-window-ranker.txt");
  const modelJson = artifactPath("model.json");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const command = defaultRankerArtifactCommand(argv);
  const labelSnapshot = readLabelSnapshot(labelsPath);
  const inputArtifacts = [
    normalizeRepoRelativePath(labelsPath, "--labels"),
    ...args.supplementalReplayLabelPaths.map((replayPath) =>
      normalizeRepoRelativePath(replayPath, "--supplemental-replay-labels")
    )
  ];
  const telemetryManifest = buildLnsWindowRankerTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts,
    outputArtifacts: [experimentJson, experimentText, modelJson, telemetryManifestJson]
  });
  const registryEntryDraft = buildLnsWindowRankerRegistryEntryDraft(result, labelSnapshot, {
    runId: args.rankerRunId,
    commands: [command],
    artifactPaths: [experimentJson, experimentText, modelJson, telemetryManifestJson],
    decision: args.rankerDecision,
    summary: args.rankerSummary
  });

  writeJsonArtifact(absoluteArtifactPath("lns-window-ranker.json"), createLnsWindowRankerSnapshot(result));
  fs.writeFileSync(absoluteArtifactPath("lns-window-ranker.txt"), `${formatLnsWindowRankerExperiment(result)}\n`);
  writeJsonArtifact(absoluteArtifactPath("model.json"), result.model);
  writeJsonArtifact(absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  const registry = args.rankerRegisterDryRun ? registerRankerArtifacts(registryEntryDraft, args) : undefined;

  return {
    artifactDir,
    artifactPaths: {
      experimentJson,
      experimentText,
      modelJson,
      telemetryManifestJson,
      registryEntryDraftJson
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    passed: result.evaluation.summary.passed,
    bestBaselineName: result.evaluation.summary.bestBaselineName,
    bestBaselineHoldoutCaptureRate: result.evaluation.summary.bestBaselineHoldoutCaptureRate,
    modelHoldoutCaptureRate: result.evaluation.summary.modelHoldoutCaptureRate,
    holdoutCaptureDeltaVsBestBaseline: result.evaluation.summary.holdoutCaptureDeltaVsBestBaseline,
    modelFingerprint: result.modelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    labelFingerprint: result.labelFingerprint,
    registry
  };
}

function writeLnsWindowRankerGapArtifactBundle(
  result: LnsWindowRankerGapDiagnosticsResult,
  labelsPath: string,
  modelPath: string,
  onlineScorecardPath: string,
  args: ParsedLnsWindowRankerArgs,
  argv: readonly string[]
): LnsWindowRankerGapArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("LNS window ranker gap diagnostics artifact directory is required.");
  }
  const artifactDir = normalizeRepoRelativePath(args.artifactDir, "--artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const diagnosticsJson = artifactPath("lns-window-ranker-gap-diagnostics.json");
  const diagnosticsText = artifactPath("lns-window-ranker-gap-diagnostics.txt");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const command = defaultRankerArtifactCommand(argv);
  const inputArtifacts = [
    normalizeRepoRelativePath(labelsPath, "--labels"),
    normalizeRepoRelativePath(modelPath, "--model"),
    normalizeRepoRelativePath(onlineScorecardPath, "--online-scorecard"),
    ...args.supplementalReplayLabelPaths.map((replayPath) =>
      normalizeRepoRelativePath(replayPath, "--supplemental-replay-labels")
    )
  ];
  const telemetryManifest = buildLnsWindowRankerGapDiagnosticsTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts,
    outputArtifacts: [diagnosticsJson, diagnosticsText, telemetryManifestJson]
  });
  const registryEntryDraft = buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft(result, {
    runId: args.rankerRunId,
    commands: [command],
    artifactPaths: [diagnosticsJson, diagnosticsText, telemetryManifestJson],
    decision: args.rankerDecision,
    summary: args.rankerSummary
  });

  writeJsonArtifact(absoluteArtifactPath("lns-window-ranker-gap-diagnostics.json"), result);
  fs.writeFileSync(
    absoluteArtifactPath("lns-window-ranker-gap-diagnostics.txt"),
    `${formatLnsWindowRankerGapDiagnostics(result)}\n`
  );
  writeJsonArtifact(absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  const registry = args.rankerRegisterDryRun ? registerRankerArtifacts(registryEntryDraft, args) : undefined;

  return {
    artifactDir,
    artifactPaths: {
      diagnosticsJson,
      diagnosticsText,
      telemetryManifestJson,
      registryEntryDraftJson
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    promotionBlocked: result.summary.promotionBlocked,
    offlinePositiveOnlineNeutralCount: result.summary.offlinePositiveOnlineNeutralCount,
    onlineOverrideCount: result.online.overrideCount,
    onlineFinalNeutralOverrideCount: result.online.finalNeutralOverrideCount,
    rankerModelFingerprint: result.inputs.rankerModelFingerprint,
    labelFingerprint: result.inputs.labelFingerprint,
    onlineScorecardFingerprint: result.inputs.onlineScorecardFingerprint,
    supplementalReplayFingerprints: result.inputs.supplementalReplayFingerprints,
    offlineSupplementalDecisionCount: result.offline.supplementalDecisionCount,
    registry
  };
}

function formatLnsWindowRankerArtifactManifest(manifest: LnsWindowRankerArtifactManifest): string {
  const lines = [
    `LNS window ranker artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `passed=${manifest.passed}`,
    `best-baseline=${manifest.bestBaselineName}`,
    `best-baseline-holdout-capture=${manifest.bestBaselineHoldoutCaptureRate.toFixed(4)}`,
    `model-holdout-capture=${manifest.modelHoldoutCaptureRate.toFixed(4)}`,
    `holdout-delta=${manifest.holdoutCaptureDeltaVsBestBaseline.toFixed(4)}`,
    `model-fingerprint=${manifest.modelFingerprint}`,
    `dataset-fingerprint=${manifest.datasetFingerprint}`,
    `label-fingerprint=${manifest.labelFingerprint}`,
    `experiment-json=${manifest.artifactPaths.experimentJson}`,
    `experiment-text=${manifest.artifactPaths.experimentText}`,
    `model-json=${manifest.artifactPaths.modelJson}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ];
  if (manifest.registry !== undefined) {
    lines.push(`registry-dry-run=${manifest.registry.registryPath}`);
  }
  return lines.join("\n");
}

function formatLnsWindowRankerGapArtifactManifest(manifest: LnsWindowRankerGapArtifactManifest): string {
  const lines = [
    `LNS window ranker gap diagnostics artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `promotion-blocked=${manifest.promotionBlocked}`,
    `offline-positive-online-neutral=${manifest.offlinePositiveOnlineNeutralCount}`,
    `online-overrides=${manifest.onlineOverrideCount}`,
    `online-final-neutral-overrides=${manifest.onlineFinalNeutralOverrideCount}`,
    `model-fingerprint=${manifest.rankerModelFingerprint}`,
    `label-fingerprint=${manifest.labelFingerprint}`,
    `online-scorecard-fingerprint=${manifest.onlineScorecardFingerprint}`,
    `supplemental-replay-fingerprints=${manifest.supplementalReplayFingerprints.length ? manifest.supplementalReplayFingerprints.join(",") : "none"}`,
    `offline-supplemental-decisions=${manifest.offlineSupplementalDecisionCount}`,
    `diagnostics-json=${manifest.artifactPaths.diagnosticsJson}`,
    `diagnostics-text=${manifest.artifactPaths.diagnosticsText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ];
  if (manifest.registry !== undefined) {
    lines.push(`registry-dry-run=${manifest.registry.registryPath}`);
  }
  return lines.join("\n");
}

export function runLnsWindowRankerCli(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.labelsPath === undefined) {
    throw new Error("--labels=<path> is required.");
  }
  if (args.rankerRegisterDryRun && args.artifactDir === undefined) {
    throw new Error("--ranker-register-dry-run requires --artifact-dir.");
  }
  if (args.rankerRegistryPath !== undefined && !args.rankerRegisterDryRun) {
    throw new Error("--ranker-registry requires --ranker-register-dry-run.");
  }
  if (args.gapDiagnostics) {
    if (args.modelPath === undefined) {
      throw new Error("--gap-diagnostics requires --model=<path>.");
    }
    if (args.onlineScorecardPath === undefined) {
      throw new Error("--gap-diagnostics requires --online-scorecard=<path>.");
    }
    const labelSnapshot = readLabelSnapshot(args.labelsPath);
    const model = readRankerModel(args.modelPath);
    const onlineScorecard = readOnlineScorecard(args.onlineScorecardPath);
    const supplementalReplaySnapshots = args.supplementalReplayLabelPaths.map(readSupplementalReplaySnapshot);
    const result = runLnsWindowRankerGapDiagnostics(labelSnapshot, model, onlineScorecard, {
      supplementalReplaySnapshots
    });
    if (args.artifactDir !== undefined) {
      const manifest = writeLnsWindowRankerGapArtifactBundle(
        result,
        args.labelsPath,
        args.modelPath,
        args.onlineScorecardPath,
        args,
        argv
      );
      writeCliJsonOrText(args.json, manifest, () => formatLnsWindowRankerGapArtifactManifest(manifest));
      return;
    }

    writeCliJsonOrText(args.json, result, () => formatLnsWindowRankerGapDiagnostics(result));
    return;
  }
  if (
    args.modelPath !== undefined ||
    args.onlineScorecardPath !== undefined ||
    (args.supplementalReplayLabelPaths.length > 0 && !args.supplementalReplayCalibration)
  ) {
    throw new Error(
      "--model and --online-scorecard are only available with --gap-diagnostics; --supplemental-replay-labels also requires --supplemental-replay-calibration for ranker training."
    );
  }
  if (args.supplementalReplayCalibration && args.supplementalReplayLabelPaths.length === 0) {
    throw new Error("--supplemental-replay-calibration requires --supplemental-replay-labels=<path>.");
  }
  if (args.supplementalReplayCalibrationIgnoreBaselineFeature && !args.supplementalReplayCalibration) {
    throw new Error(
      "--supplemental-replay-calibration-ignore-baseline-feature requires --supplemental-replay-calibration."
    );
  }

  const labelSnapshot = readLabelSnapshot(args.labelsPath);
  const supplementalReplaySnapshots = args.supplementalReplayLabelPaths.map(readSupplementalReplaySnapshot);
  const result = runLnsWindowRankerExperiment(labelSnapshot, {
    supplementalReplaySnapshots,
    randomBaselineSeed: args.randomBaselineSeed,
    topK: args.topK,
    training: {
      epochs: args.epochs,
      learningRate: args.learningRate,
      marginWeightCap: args.marginWeightCap,
      baselineTieBreak: args.baselineTieBreak,
      target: args.target,
      allowWeakSeedReplayLabels: args.allowWeakSeedReplayLabels,
      supplementalReplayCalibration: args.supplementalReplayCalibration,
      supplementalReplayCalibrationIgnoreBaselineFeature: args.supplementalReplayCalibrationIgnoreBaselineFeature,
      excludeFeatureIdenticalRepeatabilityConflicts: args.excludeFeatureIdenticalRepeatabilityConflicts
    }
  });

  if (args.artifactDir !== undefined) {
    const manifest = writeLnsWindowRankerArtifactBundle(result, args.labelsPath, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatLnsWindowRankerArtifactManifest(manifest));
    return;
  }

  writeCliJsonOrText(
    args.json,
    () => createLnsWindowRankerSnapshot(result),
    () => formatLnsWindowRankerExperiment(result)
  );
}

runCliMain(runLnsWindowRankerCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
