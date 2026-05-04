import fs from "node:fs";
import path from "node:path";

import {
  buildLnsWindowRankerBaselineRegistryEntryDraft,
  buildLnsWindowRankerBaselineTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createLnsWindowRankerBaselineSnapshot,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  formatLnsWindowRankerBaselineExperiment,
  resolveExperimentRegistryGitMetadata,
  runLnsWindowRankerBaselineExperiment
} from "../../benchmarkApi.js";
import { applyInlineOptionHandlers, isCliFlag, parsePositiveInteger } from "../../apps/cliParsing.js";
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
  LnsWindowRankerBaselineExperimentResult,
  LnsWindowRankerLabelTarget
} from "../../benchmarkApi.js";

interface ParsedLnsWindowRankerArgs {
  json: boolean;
  labelsPath?: string;
  topK?: number;
  target?: LnsWindowRankerLabelTarget;
  randomBaselineSeed?: number;
  artifactDir?: string;
  baselineRunId?: string;
  baselineDecision?: string;
  baselineSummary?: string;
  baselineRegistryPath?: string;
  baselineRegisterDryRun: boolean;
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
  let topK: number | undefined;
  let target: LnsWindowRankerLabelTarget | undefined;
  let randomBaselineSeed: number | undefined;
  let artifactDir: string | undefined;
  let baselineRunId: string | undefined;
  let baselineDecision: string | undefined;
  let baselineSummary: string | undefined;
  let baselineRegistryPath: string | undefined;
  let baselineRegisterDryRun = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    labels: (value) => {
      labelsPath = value;
    },
    "label-artifact": (value) => {
      labelsPath = value;
    },
    "top-k": (value) => {
      topK = parsePositiveInteger(value, "top k");
    },
    target: (value) => {
      if (value !== "immediate-improvement" && value !== "roll-forward-final-lift") {
        throw new Error(`Unknown LNS window ranker baseline target: ${value}`);
      }
      target = value;
    },
    "random-seed": (value) => {
      randomBaselineSeed = parsePositiveInteger(value, "random seed");
    },
    "artifact-dir": (value) => {
      artifactDir = value;
    },
    "baseline-run-id": (value) => {
      baselineRunId = value;
    },
    "baseline-decision": (value) => {
      baselineDecision = value;
    },
    "baseline-summary": (value) => {
      baselineSummary = value;
    },
    "baseline-registry": (value) => {
      baselineRegistryPath = value;
    }
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--baseline-register-dry-run")) {
      baselineRegisterDryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--roll-forward-final-lift", "--final-lift-target")) {
      target = "roll-forward-final-lift";
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    throw new Error(`Unknown LNS window ranker baseline argument: ${arg}`);
  }

  return {
    json,
    labelsPath,
    topK,
    target,
    randomBaselineSeed,
    artifactDir,
    baselineRunId,
    baselineDecision,
    baselineSummary,
    baselineRegistryPath,
    baselineRegisterDryRun
  };
}

function readLabelSnapshot(labelsPath: string): LearnedRankingLabelSnapshot {
  const repoRelativePath = normalizeRepoRelativePath(labelsPath, "--labels");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  return parsed as LearnedRankingLabelSnapshot;
}

function defaultBaselineArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter(
    (arg) => arg !== "--baseline-register-dry-run" && !arg.startsWith("--baseline-registry=")
  );
  return defaultCliReplayCommand("dist/lnsWindowRankerBaselineCli.js", replayArgs);
}

function registerBaselineArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedLnsWindowRankerArgs
): LnsWindowRankerArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.baselineRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--baseline-registry"
  );
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "LNS window ranker baseline registry entry is invalid."
  );
  return {
    registryPath,
    dryRun: true,
    appended: false,
    runId: completedEntry.runId
  };
}

function writeLnsWindowRankerArtifactBundle(
  result: LnsWindowRankerBaselineExperimentResult,
  labelsPath: string,
  args: ParsedLnsWindowRankerArgs,
  argv: readonly string[]
): LnsWindowRankerArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("LNS window ranker baseline artifact directory is required.");
  }
  const artifactDir = normalizeRepoRelativePath(args.artifactDir, "--artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const experimentJson = artifactPath("lns-window-ranker-baselines.json");
  const experimentText = artifactPath("lns-window-ranker-baselines.txt");
  const modelJson = artifactPath("model.json");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const command = defaultBaselineArtifactCommand(argv);
  const labelSnapshot = readLabelSnapshot(labelsPath);
  const telemetryManifest = buildLnsWindowRankerBaselineTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    inputArtifacts: [normalizeRepoRelativePath(labelsPath, "--labels")],
    outputArtifacts: [experimentJson, experimentText, modelJson, telemetryManifestJson]
  });
  const registryEntryDraft = buildLnsWindowRankerBaselineRegistryEntryDraft(result, labelSnapshot, {
    runId: args.baselineRunId,
    commands: [command],
    artifactPaths: [experimentJson, experimentText, modelJson, telemetryManifestJson],
    decision: args.baselineDecision,
    summary: args.baselineSummary
  });

  writeJsonArtifact(
    absoluteArtifactPath("lns-window-ranker-baselines.json"),
    createLnsWindowRankerBaselineSnapshot(result)
  );
  fs.writeFileSync(
    absoluteArtifactPath("lns-window-ranker-baselines.txt"),
    `${formatLnsWindowRankerBaselineExperiment(result)}\n`
  );
  writeJsonArtifact(absoluteArtifactPath("model.json"), result.model);
  writeJsonArtifact(absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  const registry = args.baselineRegisterDryRun ? registerBaselineArtifacts(registryEntryDraft, args) : undefined;

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
    modelFingerprint: result.modelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    labelFingerprint: result.labelFingerprint,
    registry
  };
}

function formatLnsWindowRankerArtifactManifest(manifest: LnsWindowRankerArtifactManifest): string {
  const lines = [
    `LNS window ranker baseline artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `passed=${manifest.passed}`,
    `best-baseline=${manifest.bestBaselineName}`,
    `holdout-capture=${manifest.bestBaselineHoldoutCaptureRate.toFixed(4)}`,
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

export function runLnsWindowRankerBaselineCli(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.labelsPath === undefined) {
    throw new Error("--labels=<path> is required.");
  }
  if (args.baselineRegisterDryRun && args.artifactDir === undefined) {
    throw new Error("--baseline-register-dry-run requires --artifact-dir.");
  }
  if (args.baselineRegistryPath !== undefined && !args.baselineRegisterDryRun) {
    throw new Error("--baseline-registry requires --baseline-register-dry-run.");
  }

  const labelSnapshot = readLabelSnapshot(args.labelsPath);
  const result = runLnsWindowRankerBaselineExperiment(labelSnapshot, {
    randomBaselineSeed: args.randomBaselineSeed,
    topK: args.topK,
    target: args.target
  });

  if (args.artifactDir !== undefined) {
    const manifest = writeLnsWindowRankerArtifactBundle(result, args.labelsPath, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatLnsWindowRankerArtifactManifest(manifest));
    return;
  }

  writeCliJsonOrText(
    args.json,
    () => createLnsWindowRankerBaselineSnapshot(result),
    () => formatLnsWindowRankerBaselineExperiment(result)
  );
}

runCliMain(runLnsWindowRankerBaselineCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
