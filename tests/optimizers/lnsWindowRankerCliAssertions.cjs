const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildFixture } = require("./lnsWindowRankerFixtures.cjs");

function testLnsWindowRankerCliArtifacts() {
  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "lnsWindowRankerCli.js");
  const tempRoot = `artifacts/tmp-lns-window-ranker-${process.pid}`;
  const artifactDir = `${tempRoot}/bundle`;
  const labelsPath = `${tempRoot}/inputs/labels.json`;
  const absoluteTempRoot = path.join(repoRoot, tempRoot);
  fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(path.join(repoRoot, labelsPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, labelsPath), `${JSON.stringify(buildFixture(), null, 2)}\n`);
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        `--artifact-dir=${artifactDir}`,
        "--top-k=2",
        "--epochs=4",
        "--learning-rate=0.05",
        "--margin-weight-cap=500",
        "--baseline-tie-break",
        "--exclude-weak-replay-seed-labels",
        "--exclude-repeatability-conflicts",
        "--ranker-run-id=tmp-lns-window-ranker-test",
        "--ranker-register-dry-run",
        "--json"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(artifactResult.status, 0, artifactResult.stderr || artifactResult.stdout);
    const artifactManifest = JSON.parse(artifactResult.stdout);
    assert.equal(artifactManifest.artifactDir, artifactDir);
    assert.equal(artifactManifest.runId, "tmp-lns-window-ranker-test");
    assert.equal(artifactManifest.passed, true);
    assert.equal(artifactManifest.modelHoldoutCaptureRate, 1);
    assert(artifactManifest.modelHoldoutCaptureRate > artifactManifest.bestBaselineHoldoutCaptureRate);
    assert.equal(artifactManifest.registry.appended, false);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson)), true);
    const modelArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson), "utf8")
    );
    assert.equal(modelArtifact.trained, true);
    assert.equal(modelArtifact.runtimeDefaultChanged, false);
    assert.equal(modelArtifact.training.baselineTieBreak, true);
    assert.equal(modelArtifact.training.allowWeakSeedReplayLabels, false);
    assert.equal(modelArtifact.training.excludeFeatureIdenticalRepeatabilityConflicts, true);

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--ranker-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--labels=<path> is required/);
  } finally {
    fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  }
}

function runLnsWindowRankerCliAssertions() {
  testLnsWindowRankerCliArtifacts();
}

module.exports = { runLnsWindowRankerCliAssertions };
