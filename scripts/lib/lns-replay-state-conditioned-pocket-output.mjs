import { SCRIPT_PATH } from "./lns-replay-state-conditioned-pocket-config.mjs";

function formatCandidate(candidate) {
  return [
    `${candidate.expression}: selected=${candidate.selected} improved=${candidate.improved} regressed=${candidate.regressed} neutral=${candidate.neutral} unknown=${candidate.unknown} best=${candidate.bestDelta} worst=${candidate.worstDelta} repeatabilitySafe=${candidate.repeatabilitySafeSelected} durable=${candidate.durablePocket}`,
    `  states=${Object.entries(candidate.byStatePolicy)
      .map(([state, counts]) => `${state}:${counts.improved}/${counts.selected}`)
      .join(", ")}`,
    `  families=${Object.entries(candidate.byPressureFamily)
      .map(([family, counts]) => `${family}:${counts.improved}/${counts.selected}`)
      .join(", ")}`
  ].join("\n");
}

function formatScan(scan) {
  const lines = [
    "LNS replay state-conditioned durable pocket discovery",
    `generatedAt=${scan.generatedAt}`,
    `sourceRoot=${scan.sourceRoot}`,
    `sourceArtifacts=${scan.sourceSummary.sourceArtifactCount}`,
    `cases=${scan.sourceSummary.caseCount}`,
    `seeds=${scan.sourceSummary.seeds.join(",")}`,
    `labels=${scan.sourceSummary.labelCount}`,
    `rollForwardLabels=${scan.sourceSummary.rollForwardLabelCount}`,
    `repeatabilitySafeBuckets=${scan.oracleSummary.repeatabilitySafeBucketCount}/${scan.oracleSummary.bucketCount}`,
    `repeatabilitySafeBucketLabels=${scan.oracleSummary.repeatabilitySafeBucketLabels.improved}/${scan.oracleSummary.repeatabilitySafeBucketLabels.selected} improved/selected`,
    `featureIdenticalConflictBuckets=${scan.oracleSummary.featureIdenticalConflictBucketCount}`,
    `atoms=${scan.discovery.atomCount}`,
    `searchedCandidates=${scan.discovery.searchedCandidateCount}`,
    `safeCandidates=${scan.discovery.safeCandidateCount}`,
    `blockedCandidates=${scan.discovery.blockedCandidateCount}`,
    `inputFingerprint=${scan.inputFingerprint}`,
    `scanFingerprint=${scan.scanFingerprint}`,
    "",
    "Top safe candidates:"
  ];
  if (scan.discovery.safeCandidates.length === 0) {
    lines.push("  none");
  } else {
    for (const candidate of scan.discovery.safeCandidates) lines.push(formatCandidate(candidate));
  }
  lines.push("", "Top blocked candidates:");
  if (scan.discovery.blockedCandidates.length === 0) {
    lines.push("  none");
  } else {
    for (const candidate of scan.discovery.blockedCandidates) lines.push(formatCandidate(candidate));
  }
  return lines.join("\n");
}

function artifactPathsFor(artifacts) {
  return {
    scanJson: artifacts.artifactPath("state-conditioned-pockets.json"),
    scanText: artifacts.artifactPath("state-conditioned-pockets.txt"),
    telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
    registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
    manifestJson: artifacts.artifactPath("manifest.json")
  };
}

function diagnosticArtifactPaths(artifactPaths) {
  return Object.entries(artifactPaths)
    .filter(([name]) => name !== "registryEntryDraftJson")
    .map(([, artifactPath]) => artifactPath);
}

function replayCommand(defaultCliReplayCommand, options, normalizeRepoRelativePath) {
  const argv = [
    `--source-root=${normalizeRepoRelativePath(options.sourceRoot)}`,
    `--artifact-dir=${options.artifactDir}`,
    ...(options.includePressureFamilies === undefined
      ? []
      : [`--include-pressure-family=${[...options.includePressureFamilies].sort().join(",")}`]),
    ...(options.excludePressureFamilies.size === 0
      ? []
      : [`--exclude-pressure-family=${[...options.excludePressureFamilies].sort().join(",")}`]),
    `--min-improved-labels=${options.minImprovedLabels}`,
    `--max-atoms=${options.maxAtoms}`,
    `--max-group-size=${options.maxGroupSize}`,
    `--top=${options.top}`
  ];
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

export function writeStateConditionedPocketArtifacts({
  artifactHelpers,
  benchmarkApi,
  artifacts,
  options,
  scan,
  normalizeRepoRelativePath
}) {
  const artifactPaths = artifactPathsFor(artifacts);
  const outputArtifacts = diagnosticArtifactPaths(artifactPaths);
  const command = replayCommand(artifactHelpers.defaultCliReplayCommand, options, normalizeRepoRelativePath);
  const telemetryManifest = {
    schemaVersion: 1,
    source: "lns-replay-state-conditioned-pocket-discovery",
    command,
    generatedAt: scan.generatedAt,
    git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
    hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
    diagnosticsOnly: true,
    inputFingerprint: scan.inputFingerprint,
    scanFingerprint: scan.scanFingerprint,
    sourceRoot: scan.sourceRoot,
    outputArtifacts,
    metrics: {
      sourceArtifactCount: scan.sourceSummary.sourceArtifactCount,
      caseCount: scan.sourceSummary.caseCount,
      seedCount: scan.sourceSummary.seeds.length,
      labelCount: scan.sourceSummary.labelCount,
      rollForwardLabelCount: scan.sourceSummary.rollForwardLabelCount,
      repeatabilitySafeBucketCount: scan.oracleSummary.repeatabilitySafeBucketCount,
      featureIdenticalConflictBucketCount: scan.oracleSummary.featureIdenticalConflictBucketCount,
      atomCount: scan.discovery.atomCount,
      searchedCandidateCount: scan.discovery.searchedCandidateCount,
      safeCandidateCount: scan.discovery.safeCandidateCount,
      blockedCandidateCount: scan.discovery.blockedCandidateCount,
      topSafeCandidate: scan.discovery.safeCandidates[0] ?? null
    },
    notes:
      "Diagnostics-only state-conditioned replay pocket discovery over existing LNS replay labels; no solver default changed."
  };
  const registryEntryDraft = {
    schemaVersion: 1,
    runId: `lns-replay-state-conditioned-pockets-${scan.scanFingerprint.slice(-8)}`,
    artifactType: "ablation-gate",
    generatedAt: scan.generatedAt,
    commands: [command],
    artifactPaths: outputArtifacts,
    cases: scan.sourceSummary.cases,
    caseFamilies: ["lns-window-replay", ...scan.sourceSummary.pressureFamilies.map((family) => `lns-${family}`)].sort(),
    seeds: scan.sourceSummary.seeds,
    inputFingerprint: scan.inputFingerprint,
    datasetFingerprint: scan.scanFingerprint,
    splitStatus: {
      diagnosticsOnly: true,
      source: "existing-lns-window-replay-state-conditioned-pocket-discovery",
      sourceRoot: scan.sourceRoot,
      sourceArtifactCount: scan.sourceSummary.sourceArtifactCount
    },
    budget: {
      sourceArtifactCount: scan.sourceSummary.sourceArtifactCount,
      caseCount: scan.sourceSummary.caseCount,
      seedCount: scan.sourceSummary.seeds.length,
      labelCount: scan.sourceSummary.labelCount,
      rollForwardLabelCount: scan.sourceSummary.rollForwardLabelCount,
      atomCount: scan.discovery.atomCount,
      searchedCandidateCount: scan.discovery.searchedCandidateCount
    },
    hardware: telemetryManifest.hardware,
    model: {
      trained: false,
      diagnosticsOnly: true,
      labelSource: "existing-lns-window-replay-labels",
      discoveryKind: "state-conditioned-repeatability-safe-pocket-search"
    },
    decision: "diagnostics-only",
    summary:
      "Existing protected LNS replay labels mined for state-conditioned repeatability-safe durable pockets; no solver default changed.",
    summaryMetrics: telemetryManifest.metrics
  };
  const manifest = {
    artifactDir: artifacts.artifactDir,
    artifactPaths,
    command,
    generatedAt: scan.generatedAt,
    inputFingerprint: scan.inputFingerprint,
    scanFingerprint: scan.scanFingerprint,
    sourceRoot: scan.sourceRoot,
    sourceSummary: scan.sourceSummary,
    generator: {
      script: SCRIPT_PATH,
      requiresBuild: true,
      command
    }
  };

  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("state-conditioned-pockets.json"), scan, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeTextArtifact(
    artifacts.absoluteArtifactPath("state-conditioned-pockets.txt"),
    `${formatScan(scan)}\n`,
    {
      force: options.forceArtifactDir
    }
  );
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, {
    force: options.forceArtifactDir
  });
}
