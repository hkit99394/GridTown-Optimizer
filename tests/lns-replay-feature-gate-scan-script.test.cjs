const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-lns-replay-feature-gate-scan-${process.pid}`);
const sourceRoot = path.join(tempRoot, "source");
const outputDir = path.join(tempRoot, "out");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function label(overrides) {
  return {
    caseName: "scan-fixture",
    pressureFamily: "service-pressure",
    seed: 7,
    statePolicy: "initial-incumbent",
    stateIndex: 0,
    operator: "sliding",
    selectedByBaseline: false,
    selectionSource: "fixture",
    window: { top: 0, left: 0, rows: 3, cols: 4 },
    features: {
      area: 12,
      fragmentation: { emptyComponentCountAfterClearingWindow: 1 },
      connectivityShadow: { newlyReachableEmptyCellsIfCleared: 2 }
    },
    rollForward: { statusVsBaseline: "neutral", populationDeltaVsBaseline: 0 },
    ...overrides
  };
}

function writeReplayArtifact(dirname, labels) {
  const artifactDir = path.join(sourceRoot, dirname);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "lns-window-replay-labels.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        caseCount: 1,
        seedCount: 1,
        seeds: [7],
        selectedCaseNames: ["scan-fixture"],
        pressureFamilies: ["service-pressure"],
        stateCount: 1,
        labelCount: labels.length,
        rollForwardLabelCount: labels.length,
        cases: [
          {
            name: "scan-fixture",
            pressureFamily: "service-pressure",
            seed: 7,
            statePolicy: "initial-incumbent",
            stateIndex: 0,
            labels
          }
        ]
      },
      null,
      2
    )
  );
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  writeReplayArtifact("artifact-a", [
    label({ rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 5 } }),
    label({
      features: {
        area: 12,
        fragmentation: { emptyComponentCountAfterClearingWindow: 3 },
        connectivityShadow: { newlyReachableEmptyCellsIfCleared: 1 }
      },
      rollForward: { statusVsBaseline: "regressed", populationDeltaVsBaseline: -10 }
    }),
    label({
      window: { top: 0, left: 1, rows: 3, cols: 4 },
      features: {
        area: 12,
        fragmentation: { emptyComponentCountAfterClearingWindow: 3 },
        connectivityShadow: { newlyReachableEmptyCellsIfCleared: 1 }
      },
      rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 8 }
    }),
    label({
      window: { top: 0, left: 1, rows: 3, cols: 4 },
      features: {
        area: 12,
        fragmentation: { emptyComponentCountAfterClearingWindow: 3 },
        connectivityShadow: { newlyReachableEmptyCellsIfCleared: 1 }
      },
      rollForward: { statusVsBaseline: "regressed", populationDeltaVsBaseline: -12 }
    }),
    label({ operator: "weak-service", rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 20 } })
  ]);
  writeReplayArtifact("artifact-b", [
    label({ selectedByBaseline: true, rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 30 } })
  ]);

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/summarize-lns-replay-feature-gate-scan.mjs",
      `--source-root=${repoRelative(sourceRoot)}`,
      `--artifact-dir=${repoRelative(outputDir)}`
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const scan = JSON.parse(fs.readFileSync(path.join(outputDir, "feature-gate-scan.json"), "utf8"));
  assert.equal(scan.sourceSummary.sourceArtifactCount, 2);
  assert.equal(scan.sourceSummary.labelCount, 6);
  assert.equal(scan.gates.slidingArea12.selected, 4);
  assert.equal(scan.gates.slidingArea12.improved, 2);
  assert.equal(scan.gates.slidingArea12.regressed, 2);
  assert.equal(scan.gates.slidingArea12.safeNoRegression, false);
  assert.equal(scan.gates.slidingArea12NoFeatureIdenticalRepeatabilityConflict.selected, 2);
  assert.equal(scan.gates.slidingArea12NoFeatureIdenticalRepeatabilityConflict.regressed, 1);
  assert.equal(scan.gates.slidingArea12RepeatabilitySafeBucket.selected, 0);
  assert.equal(scan.gates.slidingArea12RepeatabilitySafeBucket.safeNoRegression, false);
  assert.equal(scan.gates.slidingArea12ComponentsMax2.selected, 1);
  assert.equal(scan.gates.slidingArea12ComponentsMax2.safeNoRegression, true);
  assert.match(fs.readFileSync(path.join(outputDir, "feature-gate-scan.txt"), "utf8"), /slidingArea12:/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS replay feature-gate scan script tests passed.");
