const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

async function testCrossModeBenchmarkCliAssertions() {
  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const artifactDir = `artifacts/tmp-cross-mode-scorecard-artifacts-${process.pid}`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${artifactDir}`,
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "typed-housing-single"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(artifactResult.status, 0, artifactResult.stderr || artifactResult.stdout);
    const artifactManifest = JSON.parse(artifactResult.stdout);
    assert.equal(artifactManifest.artifactDir, artifactDir);
    assert.deepEqual(Object.keys(artifactManifest.artifactPaths).sort(), [
      "scorecardJson",
      "scorecardText",
      "telemetryManifestJson"
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    const scorecardArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardJson), "utf8")
    );
    const telemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    assert.deepEqual(scorecardArtifact.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(telemetryArtifact.source, "cross-mode-benchmark");
    assert.match(telemetryArtifact.command, /--artifact-dir=artifacts\/tmp-cross-mode-scorecard-artifacts-/);
    assert.equal(telemetryArtifact.suite.totalRuns, 1);
    assert.equal(telemetryArtifact.runs[0].caseName, "typed-housing-single");
    assert.equal(telemetryArtifact.runs[0].mode, "greedy");
    assert.equal(telemetryArtifact.runs[0].budgetSeconds, 1);
    assert.equal(telemetryArtifact.runs[0].seed, 7);
    assert.equal(typeof telemetryArtifact.hardware.captured, "boolean");

    const ablationArtifactDir = `${artifactDir}-ablation`;
    const absoluteAblationArtifactDir = path.join(repoRoot, ablationArtifactDir);
    fs.rmSync(absoluteAblationArtifactDir, { recursive: true, force: true });
    const ablationArtifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${ablationArtifactDir}`,
        "--budget-ablation",
        "--ablation-policies=baseline,seed-light",
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "typed-housing-single"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(ablationArtifactResult.status, 0, ablationArtifactResult.stderr || ablationArtifactResult.stdout);
    const ablationArtifactManifest = JSON.parse(ablationArtifactResult.stdout);
    assert.equal(ablationArtifactManifest.artifactDir, ablationArtifactDir);
    assert.deepEqual(Object.keys(ablationArtifactManifest.artifactPaths).sort(), [
      "budgetAblationJson",
      "budgetAblationText",
      "decisionTraceJsonl",
      "registryEntryDraftJson",
      "telemetryManifestJson"
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.decisionTraceJsonl)), true);
    assert.equal(
      fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.telemetryManifestJson)),
      true
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.registryEntryDraftJson)),
      true
    );
    const budgetAblationArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationJson), "utf8")
    );
    const ablationTelemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    const ablationRegistryDraft = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.registryEntryDraftJson), "utf8")
    );
    assert.deepEqual(budgetAblationArtifact.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(budgetAblationArtifact.policies.length, 2);
    assert.equal(ablationTelemetryArtifact.source, "cross-mode-budget-ablation");
    assert.equal(ablationTelemetryArtifact.suite.policyCount, 2);
    assert.equal(ablationTelemetryArtifact.runs.length, 2);
    assert.equal(ablationTelemetryArtifact.runs[0].budgetAblationPolicyName, "baseline");
    assert.equal(ablationTelemetryArtifact.runs[0].budgetAblationPolicyApplied, true);
    assert.equal(ablationRegistryDraft.artifactType, "ablation-gate");
    assert.equal(ablationRegistryDraft.summaryMetrics.policies[0].policyApplicationSummary.appliedScorecardCount, 1);
    assert.equal(ablationRegistryDraft.budget.policyCount, 2);
    assert.deepEqual(ablationRegistryDraft.cases.development, ["typed-housing-single"]);

    const artifactWriterConflict = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--artifact-dir=${artifactDir}`, "--product-corpus", `--product-artifact-dir=${artifactDir}-product`],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(artifactWriterConflict.status, 0);
    assert.match(artifactWriterConflict.stderr, /Use only one artifact writer/);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
    fs.rmSync(`${absoluteArtifactDir}-product`, { recursive: true, force: true });
    fs.rmSync(`${absoluteArtifactDir}-ablation`, { recursive: true, force: true });
  }
}

module.exports = { testCrossModeBenchmarkCliAssertions };
