const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(
  repoRoot,
  "artifacts",
  `tmp-lns-online-selected-feature-gate-discovery-validation-${process.pid}`
);
const sourceDir = path.join(tempRoot, "source");
const validationArtifactDir = path.join(tempRoot, "validation-artifact");
const validationDirectDir = path.join(tempRoot, "validation-direct");
const outputDir = path.join(tempRoot, "out");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function variantWithFeatures({ finalStatus, finalDelta, selectedFeatures }) {
  return {
    variantName: "window-ranker",
    seed: 11,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: [
      {
        selectionStatus: "override",
        outcomeStatus: "neutral",
        iteration: 0,
        transition: "weak-service->sliding",
        selectedOperator: "sliding",
        selectedFeatures
      }
    ]
  };
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "source-broad-positive-a",
            seed: 31,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 20,
                selectedFeatures: { sourceBroad: 1, protectedValue: 0, selectedByBaseline: 0 }
              })
            ]
          },
          {
            name: "source-broad-positive-b",
            seed: 31,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 15,
                selectedFeatures: { sourceBroad: 1, protectedValue: 0, selectedByBaseline: 0 }
              })
            ]
          },
          {
            name: "source-protected-positive",
            seed: 31,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 10,
                selectedFeatures: { sourceBroad: 0, protectedValue: 1, selectedByBaseline: 0 }
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );
  fs.mkdirSync(validationArtifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(validationArtifactDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "validation-broad-neutral",
            seed: 37,
            variants: [
              variantWithFeatures({
                finalStatus: "neutral",
                finalDelta: 0,
                selectedFeatures: { sourceBroad: 1, protectedValue: 0, selectedByBaseline: 0 }
              })
            ]
          },
          {
            name: "validation-protected-positive",
            seed: 37,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 25,
                selectedFeatures: { sourceBroad: 0, protectedValue: 1, selectedByBaseline: 0 }
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );
  fs.mkdirSync(validationDirectDir, { recursive: true });
  fs.writeFileSync(
    path.join(validationDirectDir, "validation-direct-scorecard.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "validation-direct-protected-positive",
            seed: 41,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 30,
                selectedFeatures: { sourceBroad: 0, protectedValue: 1, selectedByBaseline: 0 }
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(sourceDir)}`,
      `--validation-source-artifact=${repoRelative(validationArtifactDir)}`,
      `--validation-source-scorecard=${repoRelative(path.join(validationDirectDir, "validation-direct-scorecard.json"))}`,
      `--artifact-dir=${repoRelative(outputDir)}`,
      "--feature-allowlist=sourceBroad,protectedValue",
      "--target=final-improved",
      "--max-group-size=1",
      "--max-atoms-per-feature=10",
      "--max-total-atoms=20",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const discovery = JSON.parse(
    fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  const text = fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.txt"), "utf8");
  const telemetry = JSON.parse(fs.readFileSync(path.join(outputDir, "telemetry-manifest.json"), "utf8"));
  const registry = JSON.parse(fs.readFileSync(path.join(outputDir, "registry-entry-draft.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));

  assert.equal(discovery.sourceScorecards.length, 1);
  assert.equal(discovery.validationSourceScorecards.length, 2);
  assert.equal(discovery.rowSummary.overrideTraceCount, 3);
  assert.equal(discovery.rowSummary.targetImproved, 3);
  assert.equal(discovery.validationRowSummary.overrideTraceCount, 3);
  assert.equal(discovery.validationRowSummary.targetImproved, 2);
  assert.match(discovery.topCandidates[0].cliArg, /protectedValue/);
  assert.equal(discovery.topCandidates[0].targetImproved, 1);
  assert.equal(discovery.topCandidates[0].validation.selected, 2);
  assert.equal(discovery.topCandidates[0].validation.targetImproved, 2);
  assert.equal(discovery.topCandidates[0].validation.neutral, 0);
  assert.equal(discovery.topCandidates[0].validation.safetyRegressed, 0);
  assert.equal(discovery.topCandidates[0].validation.safeNoRegression, true);
  assert.equal(discovery.validationGreedySelectedGateGroups.targetImproved, 2);
  assert.equal(discovery.validationGreedySelectedGateGroups.safetyRegressed, 0);
  assert.equal(discovery.validationGreedySelectedGateGroups.safeNoRegression, true);
  assert.match(text, /validationSourceScorecards=2/);
  assert.match(text, /validation-selected=2/);
  assert.equal(telemetry.metrics.validationSourceScorecardCount, 2);
  assert.equal(telemetry.metrics.validationTargetImproved, 2);
  assert.equal(telemetry.metrics.topCandidateValidationTargetImproved, 2);
  assert.equal(telemetry.metrics.validationGreedyTargetImproved, 2);
  assert.equal(registry.splitStatus.validationSourceScorecardCount, 2);
  assert.equal(registry.budget.validationOverrideTraceCount, 3);
  assert.equal(registry.summaryMetrics.validationTargetImproved, 2);
  assert.equal(manifest.validationSourceScorecards.length, 2);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS online selected-feature gate discovery validation script tests passed.");
