const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const benchmarkApi = require("../dist/benchmarkApi.js");
const { assertRegistryDraftAppendDryRun } = require("./helpers/experimentRegistryAppendDryRun.cjs");

const repoRoot = path.join(__dirname, "..");
const artifactRoot = path.join(repoRoot, "artifacts", "lns-online-selected-feature-gate-discovery");
const externalRawManifestPath = "artifacts/external-artifacts/2026-06-01/artifact-hygiene-unindexed-raw-manifest.json";

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
        .filter((filePath) => path.posix.basename(filePath) === "manifest.json")
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
  const discoveryTextPath = path.join(artifactDir, "online-selected-feature-gate-discovery.txt");
  const telemetryPath = path.join(artifactDir, "telemetry-manifest.json");
  const registryPath = path.join(artifactDir, "registry-entry-draft.json");
  const manifestPath = path.join(artifactDir, "manifest.json");
  const telemetry = readJson(telemetryPath);
  const registry = readJson(registryPath);
  const manifest = readJson(manifestPath);

  assert.equal(telemetry.schemaVersion, 2, relativeArtifactDir);
  assert.equal(registry.schemaVersion, benchmarkApi.EXPERIMENT_REGISTRY_SCHEMA_VERSION, relativeArtifactDir);
  assertRegistryDraftAppendDryRun(repoRoot, registryPath, {
    scratchRegistryPath: path.posix.join(
      "artifacts",
      "lns-online-selected-feature-gate-discovery",
      `tmp-contract-registry-${process.pid}.jsonl`
    )
  });

  assert.equal(registry.inputFingerprint, telemetry.inputFingerprint, relativeArtifactDir);
  assert.equal(manifest.inputFingerprint, telemetry.inputFingerprint, relativeArtifactDir);
  assert.equal(registry.datasetFingerprint, telemetry.discoveryFingerprint, relativeArtifactDir);
  assert.equal(manifest.discoveryFingerprint, telemetry.discoveryFingerprint, relativeArtifactDir);
  assert.equal(registry.reportFingerprint, telemetry.reportFingerprint, relativeArtifactDir);
  assert.equal(manifest.reportFingerprint, telemetry.reportFingerprint, relativeArtifactDir);

  assert.deepEqual(manifest.sourceScorecards, telemetry.sourceScorecards, relativeArtifactDir);
  assert.deepEqual(manifest.validationSourceScorecards, telemetry.validationSourceScorecards, relativeArtifactDir);
  assert.equal(telemetry.metrics.validationSourceScorecardCount, telemetry.validationSourceScorecards.length);
  assert.equal(registry.budget.validationSourceScorecardCount, telemetry.validationSourceScorecards.length);
  assert.equal(registry.summaryMetrics.validationSourceScorecardCount, telemetry.validationSourceScorecards.length);
  assert.equal(registry.summaryMetrics.validationOverrideTraceCount, telemetry.metrics.validationOverrideTraceCount);
  assert.equal(manifest.artifactDir, relativeArtifactDir, relativeArtifactDir);
  assert.deepEqual(
    registry.artifactPaths,
    [repoRelative(discoveryTextPath), repoRelative(telemetryPath), repoRelative(manifestPath), externalRawManifestPath],
    relativeArtifactDir
  );
  assert.equal(registry.artifactPaths.includes(repoRelative(discoveryPath)), false, relativeArtifactDir);
  assert.ok(fs.existsSync(path.join(repoRoot, externalRawManifestPath)), relativeArtifactDir);
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
