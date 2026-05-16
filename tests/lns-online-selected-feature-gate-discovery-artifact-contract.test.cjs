const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const benchmarkApi = require("../dist/benchmarkApi.js");
const { assertRegistryDraftAppendDryRun } = require("./helpers/experimentRegistryAppendDryRun.cjs");

const repoRoot = path.join(__dirname, "..");
const artifactRoot = path.join(repoRoot, "artifacts", "lns-online-selected-feature-gate-discovery");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findTrackedDiscoveryArtifactDirs(rootDir) {
  const result = childProcess.spawnSync("git", ["ls-files", "--", repoRelative(rootDir)], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || "git ls-files failed while enumerating checked-in discovery artifacts"
  );
  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .filter((filePath) => path.posix.basename(filePath) === "online-selected-feature-gate-discovery.json")
        .map((filePath) => path.join(repoRoot, ...path.posix.dirname(filePath).split("/")))
    )
  ].sort();
}

function writeUntrackedLegacyDiscoveryArtifact() {
  const artifactDir = path.join(artifactRoot, `tmp-untracked-schema-v1-${process.pid}`);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "online-selected-feature-gate-discovery.json"),
    JSON.stringify({ schemaVersion: 1 }, null, 2)
  );
  return artifactDir;
}

function assertTrackedDiscoveryArtifactContract(artifactDir) {
  const relativeArtifactDir = repoRelative(artifactDir);
  const discoveryPath = path.join(artifactDir, "online-selected-feature-gate-discovery.json");
  const telemetryPath = path.join(artifactDir, "telemetry-manifest.json");
  const registryPath = path.join(artifactDir, "registry-entry-draft.json");
  const manifestPath = path.join(artifactDir, "manifest.json");
  const discovery = readJson(discoveryPath);
  const telemetry = readJson(telemetryPath);
  const registry = readJson(registryPath);
  const manifest = readJson(manifestPath);

  assert.equal(discovery.schemaVersion, 2, relativeArtifactDir);
  assert.equal(telemetry.schemaVersion, 2, relativeArtifactDir);
  assert.equal(registry.schemaVersion, benchmarkApi.EXPERIMENT_REGISTRY_SCHEMA_VERSION, relativeArtifactDir);
  assert.ok(Array.isArray(discovery.validationSourceScorecards), relativeArtifactDir);
  assert.ok(discovery.validationRowSummary, relativeArtifactDir);
  assertRegistryDraftAppendDryRun(repoRoot, registryPath, {
    scratchRegistryPath: path.posix.join(
      "artifacts",
      "lns-online-selected-feature-gate-discovery",
      `tmp-contract-registry-${process.pid}.jsonl`
    )
  });

  assert.equal(telemetry.inputFingerprint, discovery.inputFingerprint, relativeArtifactDir);
  assert.equal(registry.inputFingerprint, discovery.inputFingerprint, relativeArtifactDir);
  assert.equal(manifest.inputFingerprint, discovery.inputFingerprint, relativeArtifactDir);
  assert.equal(telemetry.discoveryFingerprint, discovery.discoveryFingerprint, relativeArtifactDir);
  assert.equal(registry.datasetFingerprint, discovery.discoveryFingerprint, relativeArtifactDir);
  assert.equal(manifest.discoveryFingerprint, discovery.discoveryFingerprint, relativeArtifactDir);
  assert.equal(registry.reportFingerprint, telemetry.reportFingerprint, relativeArtifactDir);
  assert.equal(manifest.reportFingerprint, telemetry.reportFingerprint, relativeArtifactDir);

  assert.deepEqual(telemetry.sourceScorecards, discovery.sourceScorecards, relativeArtifactDir);
  assert.deepEqual(manifest.sourceScorecards, discovery.sourceScorecards, relativeArtifactDir);
  assert.deepEqual(telemetry.validationSourceScorecards, discovery.validationSourceScorecards, relativeArtifactDir);
  assert.deepEqual(manifest.validationSourceScorecards, discovery.validationSourceScorecards, relativeArtifactDir);
  assert.equal(telemetry.metrics.validationSourceScorecardCount, discovery.validationSourceScorecards.length);
  assert.equal(registry.budget.validationSourceScorecardCount, discovery.validationSourceScorecards.length);
  assert.equal(registry.summaryMetrics.validationSourceScorecardCount, discovery.validationSourceScorecards.length);
  assert.equal(telemetry.metrics.validationOverrideTraceCount, discovery.validationRowSummary.overrideTraceCount);
  assert.equal(registry.summaryMetrics.validationOverrideTraceCount, discovery.validationRowSummary.overrideTraceCount);
  assert.equal(manifest.artifactDir, relativeArtifactDir, relativeArtifactDir);
  assert.deepEqual(
    registry.artifactPaths,
    [
      repoRelative(discoveryPath),
      path.join(relativeArtifactDir, "online-selected-feature-gate-discovery.txt").split(path.sep).join(path.posix.sep),
      repoRelative(telemetryPath),
      repoRelative(manifestPath)
    ],
    relativeArtifactDir
  );
  assert.equal(manifest.artifactPaths.discoveryJson, repoRelative(discoveryPath), relativeArtifactDir);
  assert.equal(manifest.artifactPaths.telemetryManifestJson, repoRelative(telemetryPath), relativeArtifactDir);
  assert.equal(manifest.artifactPaths.registryEntryDraftJson, repoRelative(registryPath), relativeArtifactDir);
  assert.equal(manifest.artifactPaths.manifestJson, repoRelative(manifestPath), relativeArtifactDir);
}

const untrackedLegacyArtifactDir = writeUntrackedLegacyDiscoveryArtifact();
try {
  const artifactDirs = findTrackedDiscoveryArtifactDirs(artifactRoot);
  assert.ok(artifactDirs.length > 0, "expected at least one checked-in discovery artifact directory");
  assert.equal(artifactDirs.includes(untrackedLegacyArtifactDir), false, "untracked schema-v1 artifact was enumerated");
  for (const artifactDir of artifactDirs) assertTrackedDiscoveryArtifactContract(artifactDir);
} finally {
  fs.rmSync(untrackedLegacyArtifactDir, { recursive: true, force: true });
}

console.log("LNS online selected-feature gate discovery artifact contract tests passed.");
