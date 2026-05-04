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
  formatLnsWindowRankerExperiment,
  resolveExperimentRegistryGitMetadata,
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

import type { LearnedRankingLabelSnapshot, LnsWindowRankerExperimentResult } from "../../benchmarkApi.js";

interface ParsedLnsWindowRankerArgs {
  json: boolean;
  labelsPath?: string;
  epochs?: number;
  learningRate?: number;
  marginWeightCap?: number;
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

function parseArgs(argv: string[]): ParsedLnsWindowRankerArgs {
  let json = false;
  let labelsPath: string | undefined;
  let epochs: number | undefined;
  let learningRate: number | undefined;
  let marginWeightCap: number | undefined;
  let topK: number | undefined;
  let randomBaselineSeed: number | undefined;
  let artifactDir: string | undefined;
  let rankerRunId: string | undefined;
  let rankerDecision: string | undefined;
  let rankerSummary: string | undefined;
  let rankerRegistryPath: string | undefined;
  let rankerRegisterDryRun = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    labels: (value) => {
      labelsPath = value;
    },
    "label-artifact": (value) => {
      labelsPath = value;
    },
    epochs: (value) => {
      epochs = parsePositiveInteger(value, "epochs");
    },
    "learning-rate": (value) => {
      learningRate = parsePositiveNumber(value, "learning rate");
    },
    "margin-weight-cap": (value) => {
      marginWeightCap = parsePositiveNumber(value, "margin weight cap");
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
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    throw new Error(`Unknown LNS window ranker argument: ${arg}`);
  }

  return {
    json,
    labelsPath,
    epochs,
    learningRate,
    marginWeightCap,
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
  const telemetryManifest = buildLnsWindowRankerTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts: [normalizeRepoRelativePath(labelsPath, "--labels")],
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

  const labelSnapshot = readLabelSnapshot(args.labelsPath);
  const result = runLnsWindowRankerExperiment(labelSnapshot, {
    randomBaselineSeed: args.randomBaselineSeed,
    topK: args.topK,
    training: {
      epochs: args.epochs,
      learningRate: args.learningRate,
      marginWeightCap: args.marginWeightCap
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
