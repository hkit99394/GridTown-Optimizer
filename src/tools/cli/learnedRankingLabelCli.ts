import fs from "node:fs";
import path from "node:path";

import {
  buildLearnedRankingLabelRegistryEntryDraft,
  buildLearnedRankingLabelTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  createLearnedRankingLabelSnapshot,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatLearnedRankingLabelSuite,
  formatExperimentRegistryIssues,
  runLearnedRankingLabelSuite,
  resolveExperimentRegistryGitMetadata,
  STRICT_LNS_REPLAY_LABEL_PRESET
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNonNegativeInteger,
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

import type {
  LearnedRankingLabelRunPreset,
  LearnedRankingLabelSuiteResult,
  LnsWindowReplayStatePolicy
} from "../../benchmarkApi.js";

interface ParsedLabelArgs {
  json: boolean;
  preset?: LearnedRankingLabelRunPreset;
  seeds?: number[];
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
  lnsStatePolicies?: LnsWindowReplayStatePolicy[];
  lnsStateCollectionIterations?: number;
  lnsStateCollectionRepairTimeLimitSeconds?: number;
  artifactDir?: string;
  labelRunId?: string;
  labelDecision?: string;
  labelSummary?: string;
  labelRegistryPath?: string;
  labelRegisterDryRun: boolean;
}

interface LearnedRankingLabelArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    labelsJson: string;
    labelsText: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  greedyLabelCount: number;
  lnsLabelCount: number;
  labelFingerprint: unknown;
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

function parseLabelPreset(value: string): LearnedRankingLabelRunPreset {
  if (value === STRICT_LNS_REPLAY_LABEL_PRESET) return value;
  throw new Error(`Unknown learned-ranking label preset: ${value}`);
}

function parseArgs(argv: string[]): ParsedLabelArgs {
  let json = false;
  let preset: LearnedRankingLabelRunPreset | undefined;
  let seeds: number[] | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let repairTimeLimitSeconds: number | undefined;
  let lnsStatePolicies: LnsWindowReplayStatePolicy[] | undefined;
  let lnsStateCollectionIterations: number | undefined;
  let lnsStateCollectionRepairTimeLimitSeconds: number | undefined;
  let artifactDir: string | undefined;
  let labelRunId: string | undefined;
  let labelDecision: string | undefined;
  let labelSummary: string | undefined;
  let labelRegistryPath: string | undefined;
  let labelRegisterDryRun = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    preset: (value) => {
      preset = parseLabelPreset(value);
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    "max-windows": (value) => {
      maxWindows = parsePositiveInteger(value, "max windows");
    },
    "exploration-windows": (value) => {
      explorationWindowCount = parseNonNegativeInteger(value, "exploration windows");
    },
    "repair-time": (value) => {
      repairTimeLimitSeconds = parsePositiveNumber(value, "repair time");
    },
    "state-policies": (value) => {
      lnsStatePolicies = parseNameList(value, "state policy") as LnsWindowReplayStatePolicy[];
    },
    "state-collection-iterations": (value) => {
      lnsStateCollectionIterations = parsePositiveInteger(value, "state collection iterations");
    },
    "state-collection-repair-time": (value) => {
      lnsStateCollectionRepairTimeLimitSeconds = parsePositiveNumber(value, "state collection repair time");
    },
    "artifact-dir": (value) => {
      artifactDir = value;
    },
    "label-run-id": (value) => {
      labelRunId = value;
    },
    "label-decision": (value) => {
      labelDecision = value;
    },
    "label-summary": (value) => {
      labelSummary = value;
    },
    "label-registry": (value) => {
      labelRegistryPath = value;
    }
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--strict-lns-replay", "--strict-replay-labels")) {
      preset = STRICT_LNS_REPLAY_LABEL_PRESET;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    if (isCliFlag(arg, "--pressure-corpus")) {
      continue;
    }
    if (isCliFlag(arg, "--label-register-dry-run")) {
      labelRegisterDryRun = true;
      continue;
    }
    throw new Error(`Unknown learned-ranking label argument: ${arg}`);
  }

  return {
    json,
    preset,
    seeds,
    maxWindows,
    explorationWindowCount,
    repairTimeLimitSeconds,
    lnsStatePolicies,
    lnsStateCollectionIterations,
    lnsStateCollectionRepairTimeLimitSeconds,
    artifactDir,
    labelRunId,
    labelDecision,
    labelSummary,
    labelRegistryPath,
    labelRegisterDryRun
  };
}

function defaultLabelArtifactCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter((arg) => arg !== "--label-register-dry-run" && !arg.startsWith("--label-registry="));
  return defaultCliReplayCommand("dist/learnedRankingLabelCli.js", replayArgs);
}

function registerLabelArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedLabelArgs
): LearnedRankingLabelArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.labelRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--label-registry"
  );
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "Learned ranking label registry entry is invalid."
  );
  return {
    registryPath,
    dryRun: true,
    appended: false,
    runId: completedEntry.runId
  };
}

function writeLearnedRankingLabelArtifactBundle(
  result: LearnedRankingLabelSuiteResult,
  args: ParsedLabelArgs,
  argv: readonly string[]
): LearnedRankingLabelArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Learned ranking label artifact directory is required.");
  }
  const artifactDir = normalizeRepoRelativePath(args.artifactDir, "--artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const labelsJson = artifactPath("labels.json");
  const labelsText = artifactPath("labels.txt");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const command = defaultLabelArtifactCommand(argv);
  const telemetryManifest = buildLearnedRankingLabelTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata()
  });
  const registryEntryDraft = buildLearnedRankingLabelRegistryEntryDraft(result, {
    runId: args.labelRunId,
    commands: [command],
    artifactPaths: [labelsJson, labelsText, telemetryManifestJson],
    decision: args.labelDecision,
    summary: args.labelSummary
  });

  writeJsonArtifact(absoluteArtifactPath("labels.json"), createLearnedRankingLabelSnapshot(result));
  fs.writeFileSync(absoluteArtifactPath("labels.txt"), `${formatLearnedRankingLabelSuite(result)}\n`);
  writeJsonArtifact(absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  const registry = args.labelRegisterDryRun ? registerLabelArtifacts(registryEntryDraft, args) : undefined;

  return {
    artifactDir,
    artifactPaths: {
      labelsJson,
      labelsText,
      telemetryManifestJson,
      registryEntryDraftJson
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    greedyLabelCount: result.greedy.labelCount,
    lnsLabelCount: result.lns.labelCount,
    labelFingerprint: registryEntryDraft.labelFingerprint,
    registry
  };
}

function formatLearnedRankingLabelArtifactManifest(manifest: LearnedRankingLabelArtifactManifest): string {
  const lines = [
    `Learned-ranking label artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `labels-json=${manifest.artifactPaths.labelsJson}`,
    `labels-text=${manifest.artifactPaths.labelsText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ];
  if (manifest.registry !== undefined) {
    lines.push(`registry-dry-run=${manifest.registry.registryPath}`);
  }
  return lines.join("\n");
}

export function runLearnedRankingLabelCli(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.labelRegisterDryRun && args.artifactDir === undefined) {
    throw new Error("--label-register-dry-run requires --artifact-dir.");
  }
  if (args.labelRegistryPath !== undefined && !args.labelRegisterDryRun) {
    throw new Error("--label-registry requires --label-register-dry-run.");
  }

  const result = runLearnedRankingLabelSuite({
    preset: args.preset,
    seeds: args.seeds,
    maxWindows: args.maxWindows,
    explorationWindowCount: args.explorationWindowCount,
    repairTimeLimitSeconds: args.repairTimeLimitSeconds,
    lnsStatePolicies: args.lnsStatePolicies,
    lnsStateCollectionIterations: args.lnsStateCollectionIterations,
    lnsStateCollectionRepairTimeLimitSeconds: args.lnsStateCollectionRepairTimeLimitSeconds
  });

  if (args.artifactDir !== undefined) {
    const manifest = writeLearnedRankingLabelArtifactBundle(result, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatLearnedRankingLabelArtifactManifest(manifest));
    return;
  }

  writeCliJsonOrText(
    args.json,
    () => createLearnedRankingLabelSnapshot(result),
    () => formatLearnedRankingLabelSuite(result)
  );
}

runCliMain(runLearnedRankingLabelCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    console.error(error);
  }
});
