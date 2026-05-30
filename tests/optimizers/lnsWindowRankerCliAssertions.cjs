const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildFixture, cloneFixtureWithRollForwardTargets } = require("./lnsWindowRankerFixtures.cjs");

function testLnsWindowRankerCliArtifacts() {
  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "lnsWindowRankerCli.js");
  const tempRoot = `artifacts/tmp-lns-window-ranker-${process.pid}`;
  const artifactDir = `${tempRoot}/bundle`;
  const labelsPath = `${tempRoot}/inputs/labels.json`;
  const supplementalReplayPath = `${tempRoot}/inputs/supplemental-replay.json`;
  const absoluteLabelsPath = path.join(repoRoot, labelsPath);
  const absoluteSupplementalReplayPath = path.join(repoRoot, supplementalReplayPath);
  const absoluteTempRoot = path.join(repoRoot, tempRoot);
  fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(path.join(repoRoot, labelsPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, labelsPath), `${JSON.stringify(buildFixture(), null, 2)}\n`);
  fs.writeFileSync(
    path.join(repoRoot, supplementalReplayPath),
    `${JSON.stringify(cloneFixtureWithRollForwardTargets().lns.splits[0].replay, null, 2)}\n`
  );
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${absoluteLabelsPath}`,
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

    const absoluteInputArtifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${absoluteLabelsPath}`,
        `--supplemental-replay-labels=${absoluteSupplementalReplayPath}`,
        "--supplemental-replay-calibration",
        `--artifact-dir=${tempRoot}/absolute-input-bundle`,
        "--top-k=1",
        "--epochs=1",
        "--json"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(
      absoluteInputArtifactResult.status,
      0,
      absoluteInputArtifactResult.stderr || absoluteInputArtifactResult.stdout
    );

    const supplementalResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        `--supplemental-replay-labels=${supplementalReplayPath}`,
        "--supplemental-replay-calibration",
        "--supplemental-replay-online-selected-suppression",
        "--supplemental-replay-online-selected-suppression-weight=0.25",
        "--supplemental-replay-protected-neutral-suppression",
        "--supplemental-replay-protected-neutral-suppression-weight=0.5",
        "--json"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(supplementalResult.status, 0, supplementalResult.stderr || supplementalResult.stdout);
    const supplementalSnapshot = JSON.parse(supplementalResult.stdout);
    assert.equal(supplementalSnapshot.model.training.supplementalReplayCalibration, true);
    assert.equal(supplementalSnapshot.model.training.supplementalReplayOnlineSelectedSuppression, true);
    assert.equal(supplementalSnapshot.model.training.supplementalReplayOnlineSelectedSuppressionWeight, 0.25);
    assert.equal(supplementalSnapshot.model.training.supplementalReplayProtectedNeutralSuppression, true);
    assert.equal(supplementalSnapshot.model.training.supplementalReplayProtectedNeutralSuppressionWeight, 0.5);

    const suppressionWeightGuard = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--labels=${labelsPath}`, "--supplemental-replay-online-selected-suppression-weight=0.25"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(suppressionWeightGuard.status, 0);
    assert.match(
      suppressionWeightGuard.stderr,
      /--supplemental-replay-online-selected-suppression-weight requires --supplemental-replay-online-selected-suppression/
    );

    const protectedNeutralGuard = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--labels=${labelsPath}`, "--supplemental-replay-protected-neutral-suppression"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(protectedNeutralGuard.status, 0);
    assert.match(
      protectedNeutralGuard.stderr,
      /--supplemental-replay-protected-neutral-suppression requires --supplemental-replay-calibration/
    );

    const protectedNeutralWeightGuard = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--labels=${labelsPath}`, "--supplemental-replay-protected-neutral-suppression-weight=0.25"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(protectedNeutralWeightGuard.status, 0);
    assert.match(
      protectedNeutralWeightGuard.stderr,
      /--supplemental-replay-protected-neutral-suppression-weight requires --supplemental-replay-protected-neutral-suppression/
    );

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--ranker-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--labels=<path> is required/);

    const obsoleteLabelsDir = `${tempRoot}/obsolete-labels`;
    const obsoleteLabelsPath = `${obsoleteLabelsDir}/labels.json`;
    fs.mkdirSync(path.join(repoRoot, obsoleteLabelsDir), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, `${obsoleteLabelsDir}/OBSOLETE.md`), "Obsolete labels.\n");
    fs.writeFileSync(path.join(repoRoot, obsoleteLabelsPath), `${JSON.stringify(buildFixture(), null, 2)}\n`);
    const obsoleteLabelsGuard = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--labels=${obsoleteLabelsPath}`, "--json"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(obsoleteLabelsGuard.status, 0);
    assert.match(obsoleteLabelsGuard.stderr, /--labels points to obsolete artifact bundle/);

    const obsoleteSupplementalPath = `${obsoleteLabelsDir}/supplemental-replay.json`;
    fs.writeFileSync(
      path.join(repoRoot, obsoleteSupplementalPath),
      `${JSON.stringify(cloneFixtureWithRollForwardTargets().lns.splits[0].replay, null, 2)}\n`
    );
    const obsoleteSupplementalGuard = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        `--supplemental-replay-labels=${obsoleteSupplementalPath}`,
        "--supplemental-replay-calibration",
        "--json"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(obsoleteSupplementalGuard.status, 0);
    assert.match(obsoleteSupplementalGuard.stderr, /--supplemental-replay-labels points to obsolete artifact bundle/);

    const obsoleteDir = `${tempRoot}/obsolete-model`;
    const obsoleteModelPath = `${obsoleteDir}/model.json`;
    fs.mkdirSync(path.join(repoRoot, obsoleteDir), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, `${obsoleteDir}/OBSOLETE.md`), "Obsolete test bundle.\n");
    fs.writeFileSync(
      path.join(repoRoot, obsoleteModelPath),
      `${JSON.stringify({ modelType: "lns-window-linear-pairwise-ranker", featureSchemaVersion: 2, weights: {} })}\n`
    );
    const obsoleteModelGuard = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        "--gap-diagnostics",
        `--model=${obsoleteModelPath}`,
        `--online-scorecard=${obsoleteDir}/scorecard.json`
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(obsoleteModelGuard.status, 0);
    assert.match(obsoleteModelGuard.stderr, /--model points to obsolete artifact bundle/);

    const normalModelPath = `${tempRoot}/inputs/model.json`;
    fs.writeFileSync(
      path.join(repoRoot, normalModelPath),
      `${JSON.stringify({ modelType: "lns-window-linear-pairwise-ranker", featureSchemaVersion: 2, weights: {} })}\n`
    );
    fs.writeFileSync(path.join(repoRoot, `${obsoleteDir}/scorecard.json`), "{}\n");
    const obsoleteScorecardGuard = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        "--gap-diagnostics",
        `--model=${normalModelPath}`,
        `--online-scorecard=${obsoleteDir}/scorecard.json`
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(obsoleteScorecardGuard.status, 0);
    assert.match(obsoleteScorecardGuard.stderr, /--online-scorecard points to obsolete artifact bundle/);
  } finally {
    fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  }
}

function runLnsWindowRankerCliAssertions() {
  testLnsWindowRankerCliArtifacts();
}

module.exports = { runLnsWindowRankerCliAssertions };
