const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-lns-online-selected-feature-gate-discovery-${process.pid}`);
const sourceDir = path.join(tempRoot, "source");
const outputDir = path.join(tempRoot, "out");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function trace({ status, area, operatorScore }) {
  return {
    selectionStatus: "override",
    outcomeStatus: status,
    iteration: 0,
    transition: "weak-service->sliding",
    selectedOperator: "sliding",
    selectedFeatures: {
      area,
      operatorScore,
      selectedByBaseline: 0
    }
  };
}

function variant({ finalStatus, finalDelta, traceStatus, area, operatorScore }) {
  return {
    variantName: "window-ranker",
    seed: 7,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: [trace({ status: traceStatus, area, operatorScore })]
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
            name: "good-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({
                finalStatus: "improved",
                finalDelta: 50,
                traceStatus: "improved",
                area: 0.6,
                operatorScore: 9.74
              })
            ]
          },
          {
            name: "bad-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({
                finalStatus: "regressed",
                finalDelta: -50,
                traceStatus: "neutral",
                area: 0.45,
                operatorScore: 9.86
              })
            ]
          },
          {
            name: "neutral-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({ finalStatus: "neutral", finalDelta: 0, traceStatus: "neutral", area: 0.45, operatorScore: 7.5 })
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
      `--artifact-dir=${repoRelative(outputDir)}`,
      "--feature-allowlist=area,operatorScore",
      "--max-group-size=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const discovery = JSON.parse(
    fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(discovery.rowSummary.overrideTraceCount, 3);
  assert.equal(discovery.rowSummary.selectionImproved, 1);
  assert.equal(discovery.rowSummary.finalRegressed, 1);
  assert.equal(discovery.greedySelectedGateGroups.safeNoRegression, true);
  assert.equal(discovery.greedySelectedGateGroups.selectionImproved, 1);
  assert.equal(discovery.greedySelectedGateGroups.finalRegressed, 0);
  assert.match(discovery.greedySelectedGateGroups.cliArg, /area>=0\.6|area<=0\.6/);
  assert.match(
    fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.txt"), "utf8"),
    /greedy-selected-groups=/
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS online selected-feature gate discovery script tests passed.");
