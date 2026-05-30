const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function testCandidateEvaluatorValidityScriptCreatesArtifacts() {
  const artifactDir = "artifacts/tmp-candidate-evaluator-validity-test";
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });

  try {
    const result = childProcess.spawnSync(
      process.execPath,
      [
        "scripts/generate-candidate-evaluator-validity.mjs",
        `--artifact-dir=${artifactDir}`,
        "--candidate-id=test-candidate",
        "--run-id=candidate-evaluator-validity-test",
        "--decision=l0-automation-smoke",
        "--fresh-holdout-note=smoke nomination note",
        "--cp-sat-no-overlap2d",
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--cases=manual-layout-replay-warm-start,expansion-comparison-replay"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.artifactDir, artifactDir);
    assert.equal(manifest.runId, "candidate-evaluator-validity-test");
    assert.equal(manifest.candidateId, "test-candidate");
    assert.deepEqual(manifest.candidateOptions, { cpSatUseNoOverlap2d: true });
    assert.equal(manifest.rowCount, 2);
    assert.equal(manifest.validCount, 2);
    assert.equal(manifest.invalidCount, 0);
    assert.equal(manifest.populationMismatchCount, 0);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.validityJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.validityText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.registryEntryDraftJson)), true);

    const validity = readJson(manifest.artifactPaths.validityJson);
    const telemetry = readJson(manifest.artifactPaths.telemetryManifestJson);
    const registryDraft = readJson(manifest.artifactPaths.registryEntryDraftJson);
    assert.equal(validity.schemaVersion, 1);
    assert.equal(validity.candidateId, "test-candidate");
    assert.deepEqual(validity.candidateOptions, { cpSatUseNoOverlap2d: true });
    assert.deepEqual(validity.casesBySplit, {
      development: ["manual-layout-replay-warm-start"],
      holdout: ["expansion-comparison-replay"]
    });
    assert.deepEqual(validity.modes, ["greedy"]);
    assert.equal(validity.summary.validCount, 2);
    assert.equal(validity.summary.populationMismatchCount, 0);
    assert.equal(telemetry.source, "candidate-evaluator-validity");
    assert.deepEqual(telemetry.candidateOptions, { cpSatUseNoOverlap2d: true });
    assert.equal(telemetry.suite.rowCount, 2);
    assert.equal(registryDraft.artifactType, "ablation-gate");
    assert.equal(registryDraft.decision, "l0-automation-smoke");
    assert.deepEqual(registryDraft.model, { cpSatUseNoOverlap2d: true });
    assert.equal(registryDraft.splitStatus.protectedHoldout, true);
    assert.equal(registryDraft.splitStatus.freshHoldoutNote, "smoke nomination note");
    assert.deepEqual(registryDraft.seeds, [7]);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

testCandidateEvaluatorValidityScriptCreatesArtifacts();
console.log("Candidate evaluator-validity script tests passed.");
