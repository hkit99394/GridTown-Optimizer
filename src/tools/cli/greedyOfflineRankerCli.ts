import fs from "node:fs";
import path from "node:path";

import {
  buildGreedyOfflineRankerRegistryEntryDraft,
  buildGreedyOfflineRankerTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createGreedyOfflineRankerSnapshot,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  formatGreedyOfflineRankerExperiment,
  resolveExperimentRegistryGitMetadata,
  runGreedyOfflineRankerExperiment
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNumberList,
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

import type { GreedyOfflineRankerExperimentResult } from "../../benchmarkApi.js";

interface ParsedGreedyRankerArgs {
  json: boolean;
  seeds?: number[];
  epochs?: number;
  learningRate?: number;
  artifactDir?: string;
  rankerRunId?: string;
  rankerDecision?: string;
  rankerSummary?: string;
  rankerRegistryPath?: string;
  rankerRegisterDryRun: boolean;
}

interface GreedyRankerArtifactManifest {
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
  modelFingerprint: string;
  datasetFingerprint: string;
  holdoutAccuracy: number;
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

function parseArgs(argv: string[]): ParsedGreedyRankerArgs {
  let json = false;
  let seeds: number[] | undefined;
  let epochs: number | undefined;
  let learningRate: number | undefined;
  let artifactDir: string | undefined;
  let rankerRunId: string | undefined;
  let rankerDecision: string | undefined;
  let rankerSummary: string | undefined;
  let rankerRegistryPath: string | undefined;
  let rankerRegisterDryRun = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    epochs: (value) => {
      epochs = parsePositiveInteger(value, "epochs");
    },
    "learning-rate": (value) => {
      learningRate = parsePositiveNumber(value, "learning rate");
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
    throw new Error(`Unknown Greedy offline ranker argument: ${arg}`);
  }

  return {
    json,
    seeds,
    epochs,
    learningRate,
    artifactDir,
    rankerRunId,
    rankerDecision,
    rankerSummary,
    rankerRegistryPath,
    rankerRegisterDryRun
  };
}

function defaultRankerArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter((arg) => arg !== "--ranker-register-dry-run" && !arg.startsWith("--ranker-registry="));
  return defaultCliReplayCommand("dist/greedyOfflineRankerCli.js", replayArgs);
}

function registerRankerArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedGreedyRankerArgs
): GreedyRankerArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.rankerRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--ranker-registry"
  );
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "Greedy offline ranker registry entry is invalid."
  );
  return {
    registryPath,
    dryRun: true,
    appended: false,
    runId: completedEntry.runId
  };
}

function writeGreedyRankerArtifactBundle(
  result: GreedyOfflineRankerExperimentResult,
  args: ParsedGreedyRankerArgs,
  argv: readonly string[]
): GreedyRankerArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Greedy offline ranker artifact directory is required.");
  }
  const artifactDir = normalizeRepoRelativePath(args.artifactDir, "--artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const experimentJson = artifactPath("greedy-offline-ranker.json");
  const experimentText = artifactPath("greedy-offline-ranker.txt");
  const modelJson = artifactPath("model.json");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const command = defaultRankerArtifactCommand(argv);
  const telemetryManifest = buildGreedyOfflineRankerTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
    outputArtifacts: [experimentJson, experimentText, modelJson, telemetryManifestJson]
  });
  const registryEntryDraft = buildGreedyOfflineRankerRegistryEntryDraft(result, {
    runId: args.rankerRunId,
    commands: [command],
    artifactPaths: [experimentJson, experimentText, modelJson, telemetryManifestJson],
    decision: args.rankerDecision,
    summary: args.rankerSummary
  });

  writeJsonArtifact(absoluteArtifactPath("greedy-offline-ranker.json"), createGreedyOfflineRankerSnapshot(result));
  fs.writeFileSync(
    absoluteArtifactPath("greedy-offline-ranker.txt"),
    `${formatGreedyOfflineRankerExperiment(result)}\n`
  );
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
    modelFingerprint: result.modelFingerprint,
    datasetFingerprint: result.datasetFingerprint,
    holdoutAccuracy: result.evaluation.model.holdout.accuracy,
    registry
  };
}

function formatGreedyRankerArtifactManifest(manifest: GreedyRankerArtifactManifest): string {
  const lines = [
    `Greedy offline ranker artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `passed=${manifest.passed}`,
    `holdout-accuracy=${manifest.holdoutAccuracy.toFixed(4)}`,
    `model-fingerprint=${manifest.modelFingerprint}`,
    `dataset-fingerprint=${manifest.datasetFingerprint}`,
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

export function runGreedyOfflineRankerCli(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.rankerRegisterDryRun && args.artifactDir === undefined) {
    throw new Error("--ranker-register-dry-run requires --artifact-dir.");
  }
  if (args.rankerRegistryPath !== undefined && !args.rankerRegisterDryRun) {
    throw new Error("--ranker-registry requires --ranker-register-dry-run.");
  }

  const result = runGreedyOfflineRankerExperiment({
    seeds: args.seeds,
    training: {
      epochs: args.epochs,
      learningRate: args.learningRate
    }
  });

  if (args.artifactDir !== undefined) {
    const manifest = writeGreedyRankerArtifactBundle(result, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatGreedyRankerArtifactManifest(manifest));
    return;
  }

  writeCliJsonOrText(
    args.json,
    () => createGreedyOfflineRankerSnapshot(result),
    () => formatGreedyOfflineRankerExperiment(result)
  );
}

runCliMain(runGreedyOfflineRankerCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
