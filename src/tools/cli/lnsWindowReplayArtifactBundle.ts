import {
  buildBenchmarkArtifactRunId,
  buildModelExperimentFingerprint,
  createLnsWindowReplaySnapshot,
  formatLnsWindowReplayLabels,
  summarizeLnsWindowReplayRepeatability
} from "../../benchmarkApi.js";
import {
  buildCliArtifactRunMetadata,
  prepareArtifactBundleDirectory,
  writeJsonArtifact,
  writeTextArtifact
} from "./artifactBundleHelpers.js";

import type { LnsWindowReplayRepeatabilitySummary, LnsWindowReplaySuiteResult } from "../../benchmarkApi.js";

export interface LnsWindowReplayTelemetryManifest {
  schemaVersion: 1;
  source: "lns-window-replay-diagnostic-bundle";
  command: string;
  generatedAt: string;
  git: { commit: string; branch: string } | null;
  hardware: Record<string, unknown>;
  inputFingerprint: string;
  labelFingerprint: string;
  diagnosticsOnly: true;
  input: Record<string, unknown>;
  outputArtifacts: string[];
  repeatabilitySummary: LnsWindowReplayRepeatabilitySummary;
  metrics: Record<string, unknown>;
  notes?: string;
}

export interface LnsWindowReplayTelemetryManifestOptions {
  command: string;
  git?: { commit: string; branch: string } | null;
  hardware?: Record<string, unknown>;
  outputArtifacts: readonly string[];
  notes?: string;
}

export interface LnsWindowReplayRegistryEntryDraftOptions {
  runId?: string;
  commands: readonly string[];
  artifactPaths: readonly string[];
  decision?: string;
  summary?: string;
}

export interface LnsWindowReplayArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    replayJson: string;
    replayText: string;
    repeatabilitySummaryJson: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
    manifestJson: string;
  };
  command: string;
  generatedAt: string;
  inputFingerprint: string;
  labelFingerprint: string;
  caseCount: number;
  seedCount: number;
  stateCount: number;
  labelCount: number;
  rollForwardLabelCount: number;
  selectedCaseNames: string[];
  pressureFamilies: string[];
  repeatabilitySummary: LnsWindowReplayRepeatabilitySummary;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function buildLnsWindowReplayInputFingerprintPayload(result: LnsWindowReplaySuiteResult): Record<string, unknown> {
  return {
    schemaVersion: result.schemaVersion,
    selectedCaseNames: [...result.selectedCaseNames].sort(),
    pressureFamilies: [...result.pressureFamilies].sort(),
    seeds: [...result.seeds],
    maxWindows: result.maxWindows,
    explorationWindowCount: result.explorationWindowCount,
    repairTimeLimitSeconds: result.repairTimeLimitSeconds,
    rollForwardIterations: result.rollForwardIterations,
    rollForwardRepairTimeLimitSeconds: result.rollForwardRepairTimeLimitSeconds,
    statePolicies: [...result.statePolicies],
    capturedStatePolicies: [...result.capturedStatePolicies],
    stateCollectionIterations: result.stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds: result.stateCollectionRepairTimeLimitSeconds,
    featureSchemaVersion: result.featureSchemaVersion,
    cpSatNumWorkers: result.cpSatNumWorkers,
    cpSatModelFingerprints: [...result.cpSatModelFingerprints].sort()
  };
}

export function buildLnsWindowReplayInputFingerprint(result: LnsWindowReplaySuiteResult): string {
  return buildModelExperimentFingerprint(buildLnsWindowReplayInputFingerprintPayload(result));
}

export function buildLnsWindowReplayLabelFingerprint(result: LnsWindowReplaySuiteResult): string {
  return buildModelExperimentFingerprint(createLnsWindowReplaySnapshot(result));
}

export function buildLnsWindowReplayTelemetryManifest(
  result: LnsWindowReplaySuiteResult,
  options: LnsWindowReplayTelemetryManifestOptions
): LnsWindowReplayTelemetryManifest {
  const repeatabilitySummary = summarizeLnsWindowReplayRepeatability(result);
  return {
    schemaVersion: 1,
    source: "lns-window-replay-diagnostic-bundle",
    command: options.command,
    generatedAt: result.generatedAt,
    git: options.git ?? null,
    hardware: options.hardware ?? { captured: false, gpuUsed: false },
    inputFingerprint: buildLnsWindowReplayInputFingerprint(result),
    labelFingerprint: buildLnsWindowReplayLabelFingerprint(result),
    diagnosticsOnly: true,
    input: buildLnsWindowReplayInputFingerprintPayload(result),
    outputArtifacts: [...options.outputArtifacts],
    repeatabilitySummary,
    metrics: {
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      stateCount: result.stateCount,
      labelCount: result.labelCount,
      rollForwardLabelCount: result.rollForwardLabelCount,
      repeatabilityConflictBucketCount: repeatabilitySummary.conflictingFinalStatusBucketCount,
      repeatabilityFeatureIdenticalConflictBucketCount: repeatabilitySummary.featureIdenticalConflictBucketCount
    },
    ...(options.notes === undefined ? {} : { notes: options.notes })
  };
}

export function buildLnsWindowReplayRegistryEntryDraft(
  result: LnsWindowReplaySuiteResult,
  options: LnsWindowReplayRegistryEntryDraftOptions
): Record<string, unknown> {
  const repeatabilitySummary = summarizeLnsWindowReplayRepeatability(result);
  const labelFingerprint = buildLnsWindowReplayLabelFingerprint(result);
  return {
    schemaVersion: 1,
    runId:
      options.runId ??
      buildBenchmarkArtifactRunId("lns-window-replay-diagnostics", result.generatedAt, labelFingerprint.slice(-8)),
    artifactType: "label-bundle",
    generatedAt: result.generatedAt,
    commands: [...options.commands],
    artifactPaths: [...options.artifactPaths],
    cases: [...result.selectedCaseNames],
    caseFamilies: uniqueValues(["lns-window-replay", ...result.pressureFamilies.map((family) => `lns-${family}`)]),
    seeds: [...result.seeds],
    inputFingerprint: buildLnsWindowReplayInputFingerprint(result),
    labelFingerprint,
    splitStatus: {
      diagnosticsOnly: true,
      source: "lns-window-replay-diagnostic-bundle",
      statePolicies: [...result.statePolicies],
      capturedStatePolicies: [...result.capturedStatePolicies],
      repeatabilitySummary
    },
    budget: {
      seeds: [...result.seeds],
      maxWindows: result.maxWindows,
      explorationWindowCount: result.explorationWindowCount,
      repairTimeLimitSeconds: result.repairTimeLimitSeconds,
      rollForwardIterations: result.rollForwardIterations,
      rollForwardRepairTimeLimitSeconds: result.rollForwardRepairTimeLimitSeconds,
      stateCollectionIterations: result.stateCollectionIterations,
      stateCollectionRepairTimeLimitSeconds: result.stateCollectionRepairTimeLimitSeconds,
      cpSatNumWorkers: result.cpSatNumWorkers,
      caseCount: result.caseCount,
      stateCount: result.stateCount,
      labelCount: result.labelCount,
      rollForwardLabelCount: result.rollForwardLabelCount
    },
    model: {
      trained: false,
      diagnosticsOnly: true,
      labelSource: "lns-window-replay-labels",
      featureSchemaVersion: result.featureSchemaVersion
    },
    decision: options.decision ?? "diagnostics-only",
    summary: options.summary ?? "LNS window replay diagnostic label bundle; no solver default changed.",
    summaryMetrics: {
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      stateCount: result.stateCount,
      labelCount: result.labelCount,
      rollForwardLabelCount: result.rollForwardLabelCount,
      repeatabilityConflictBucketCount: repeatabilitySummary.conflictingFinalStatusBucketCount,
      repeatabilityFeatureIdenticalConflictBucketCount: repeatabilitySummary.featureIdenticalConflictBucketCount,
      repeatabilityFeatureIdenticalConflictLabelCount: repeatabilitySummary.featureIdenticalConflictLabelCount,
      statePolicies: [...result.statePolicies],
      capturedStatePolicies: [...result.capturedStatePolicies],
      cpSatModelFingerprints: [...result.cpSatModelFingerprints]
    }
  };
}

export function writeLnsWindowReplayArtifactBundle(
  result: LnsWindowReplaySuiteResult,
  artifactDirInput: string,
  argv: readonly string[],
  options: { force?: boolean } = {}
): LnsWindowReplayArtifactManifest {
  const artifacts = prepareArtifactBundleDirectory(artifactDirInput, "--window-replay-artifact-dir", {
    force: options.force
  });
  const repeatabilitySummary = summarizeLnsWindowReplayRepeatability(result);
  const metadata = buildCliArtifactRunMetadata("dist/lnsBenchmarkCli.js", argv);
  const outputArtifactPaths = [
    artifacts.artifactPath("lns-window-replay-labels.json"),
    artifacts.artifactPath("lns-window-replay-labels.txt"),
    artifacts.artifactPath("repeatability-summary.json"),
    artifacts.artifactPath("manifest.json"),
    artifacts.artifactPath("telemetry-manifest.json")
  ];
  const telemetryManifest = buildLnsWindowReplayTelemetryManifest(result, {
    command: metadata.command,
    git: metadata.git,
    hardware: metadata.hardware,
    outputArtifacts: outputArtifactPaths
  });
  const registryEntryDraft = buildLnsWindowReplayRegistryEntryDraft(result, {
    commands: [metadata.command],
    artifactPaths: outputArtifactPaths
  });
  const manifest: LnsWindowReplayArtifactManifest = {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      replayJson: artifacts.artifactPath("lns-window-replay-labels.json"),
      replayText: artifacts.artifactPath("lns-window-replay-labels.txt"),
      repeatabilitySummaryJson: artifacts.artifactPath("repeatability-summary.json"),
      telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
      manifestJson: artifacts.artifactPath("manifest.json")
    },
    command: metadata.command,
    generatedAt: result.generatedAt,
    inputFingerprint: telemetryManifest.inputFingerprint,
    labelFingerprint: telemetryManifest.labelFingerprint,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    stateCount: result.stateCount,
    labelCount: result.labelCount,
    rollForwardLabelCount: result.rollForwardLabelCount,
    selectedCaseNames: [...result.selectedCaseNames],
    pressureFamilies: [...result.pressureFamilies],
    repeatabilitySummary
  };

  writeJsonArtifact(
    artifacts.absoluteArtifactPath("lns-window-replay-labels.json"),
    createLnsWindowReplaySnapshot(result),
    { force: options.force }
  );
  writeTextArtifact(
    artifacts.absoluteArtifactPath("lns-window-replay-labels.txt"),
    `${formatLnsWindowReplayLabels(result)}\n`,
    { force: options.force }
  );
  writeJsonArtifact(artifacts.absoluteArtifactPath("repeatability-summary.json"), repeatabilitySummary, {
    force: options.force
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
    force: options.force
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
    force: options.force
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, { force: options.force });
  return manifest;
}

export function formatLnsWindowReplayArtifactManifest(manifest: LnsWindowReplayArtifactManifest): string {
  return [
    `LNS window replay label artifacts written to ${manifest.artifactDir}`,
    `cases=${manifest.caseCount}`,
    `seeds=${manifest.seedCount}`,
    `states=${manifest.stateCount}`,
    `labels=${manifest.labelCount}`,
    `roll-forward-labels=${manifest.rollForwardLabelCount}`,
    `repeatability-conflicts=${manifest.repeatabilitySummary.conflictingFinalStatusBucketCount}`,
    `repeatability-feature-identical-conflicts=${manifest.repeatabilitySummary.featureIdenticalConflictBucketCount}`,
    `replay-json=${manifest.artifactPaths.replayJson}`,
    `replay-text=${manifest.artifactPaths.replayText}`,
    `repeatability-summary=${manifest.artifactPaths.repeatabilitySummaryJson}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`,
    `manifest=${manifest.artifactPaths.manifestJson}`
  ].join("\n");
}
