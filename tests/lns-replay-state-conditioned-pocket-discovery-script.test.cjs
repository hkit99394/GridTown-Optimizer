const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-lns-replay-state-conditioned-pockets-${process.pid}`);
const sourceRoot = path.join(tempRoot, "source");
const outputDir = path.join(tempRoot, "out");
const filteredOutputDir = path.join(tempRoot, "out-filtered");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function label(overrides) {
  return {
    caseName: "state-pocket-fixture",
    pressureFamily: "service-pressure",
    seed: 7,
    statePolicy: "initial-incumbent",
    stateIndex: 0,
    stateSourceStatus: "initial-incumbent",
    stateStagnantIterations: 0,
    operator: "sliding",
    selectedByBaseline: false,
    selectionSource: "exploration-tail",
    operatorScore: 900,
    incumbentPopulation: 640,
    window: { top: 0, left: 0, rows: 3, cols: 4 },
    features: {
      schemaVersion: 2,
      roadCountInside: 0,
      area: 12,
      serviceCountInside: 0,
      residentialCountInside: 1,
      fragmentation: {
        emptyComponentCountBefore: 2,
        emptyComponentCountAfterClearingWindow: 2,
        componentDeltaAfterClearingWindow: 0,
        allowedWindowCellCount: 10,
        anchorReachableWindowCellCount: 10
      },
      connectivityShadow: {
        reachableEmptyCellsBefore: 20,
        reachableEmptyCellsAfterClearingWindow: 24,
        newlyReachableEmptyCellsIfCleared: 4,
        disconnectedEmptyCellsBefore: 0,
        disconnectedEmptyCellsAfterClearingWindow: 0,
        clearedBuildingFootprintCells: 2
      },
      candidateLoss: {
        serviceCandidatesIntersectingWindow: 12,
        residentialCandidatesIntersectingWindow: 11,
        serviceCandidatesBlockedByIncumbent: 5,
        residentialCandidatesBlockedByIncumbent: 9,
        serviceCandidateBonusInside: 3300,
        maxServiceCandidateBonusInside: 95,
        residentialCandidateHeadroomInside: 1400
      }
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
        seedCount: 2,
        seeds: [7, 19],
        selectedCaseNames: ["state-pocket-fixture"],
        pressureFamilies: ["service-pressure"],
        stateCount: 3,
        labelCount: labels.length,
        rollForwardLabelCount: labels.length,
        cases: [
          {
            name: "state-pocket-fixture",
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
    label({ seed: 7, rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 50 } }),
    label({ seed: 19, rollForward: { statusVsBaseline: "neutral", populationDeltaVsBaseline: 0 } }),
    label({
      seed: 37,
      statePolicy: "post-first-improvement",
      stateSourceStatus: "post-first-improvement",
      stateIndex: 1,
      window: { top: 0, left: 0, rows: 3, cols: 4 },
      rollForward: { statusVsBaseline: "regressed", populationDeltaVsBaseline: -40 }
    }),
    label({
      operator: "weak-service",
      selectedByBaseline: true,
      selectionSource: "baseline-top-k",
      features: {
        area: 9,
        roadCountInside: 1,
        fragmentation: { emptyComponentCountAfterClearingWindow: 1 },
        candidateLoss: { serviceCandidateBonusInside: 0 }
      },
      rollForward: { statusVsBaseline: "neutral", populationDeltaVsBaseline: 0 }
    }),
    label({
      caseName: "global-conflict-fixture",
      seed: 7,
      statePolicy: "online-decision",
      stateSourceStatus: "online-decision",
      stateIndex: 3,
      window: { top: 4, left: 1, rows: 2, cols: 3 },
      features: {
        area: 6,
        roadCountInside: 0,
        fragmentation: { emptyComponentCountAfterClearingWindow: 3 },
        candidateLoss: { serviceCandidateBonusInside: 1100 }
      },
      rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 30 }
    })
  ]);
  writeReplayArtifact("artifact-b", [
    label({
      caseName: "anchor-fixture",
      pressureFamily: "anchor-service",
      seed: 7,
      statePolicy: "online-decision",
      stateSourceStatus: "online-decision",
      operator: "placed-buildings",
      selectionSource: "exploration-tail",
      window: { top: 2, left: 2, rows: 3, cols: 3 },
      features: {
        area: 9,
        roadCountInside: 2,
        fragmentation: { emptyComponentCountAfterClearingWindow: 1 },
        candidateLoss: { serviceCandidateBonusInside: 0 }
      },
      rollForward: { statusVsBaseline: "improved", populationDeltaVsBaseline: 20 }
    })
  ]);
  writeReplayArtifact("artifact-c", [
    label({ seed: 23, rollForward: { statusVsBaseline: "neutral", populationDeltaVsBaseline: 0 } }),
    label({
      caseName: "global-conflict-fixture",
      seed: 19,
      statePolicy: "online-decision",
      stateSourceStatus: "online-decision",
      stateIndex: 3,
      window: { top: 4, left: 1, rows: 2, cols: 3 },
      features: {
        area: 6,
        roadCountInside: 0,
        fragmentation: { emptyComponentCountAfterClearingWindow: 3 },
        candidateLoss: { serviceCandidateBonusInside: 1100 }
      },
      rollForward: { statusVsBaseline: "regressed", populationDeltaVsBaseline: -30 }
    })
  ]);

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-replay-state-conditioned-pockets.mjs",
      `--source-root=${repoRelative(sourceRoot)}`,
      `--artifact-dir=${repoRelative(outputDir)}`,
      "--min-improved-labels=1",
      "--max-atoms=200",
      "--max-group-size=1",
      "--top=100"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const scan = JSON.parse(fs.readFileSync(path.join(outputDir, "state-conditioned-pockets.json"), "utf8"));
  assert.equal(scan.sourceSummary.sourceArtifactCount, 3);
  assert.equal(scan.sourceSummary.scannedRollForwardLabels, 8);
  assert.equal(scan.oracleSummary.repeatabilityScope, "global-filtered-rows");
  assert.equal(scan.oracleSummary.repeatabilitySafeBucketCount, 2);
  assert.equal(scan.oracleSummary.repeatabilitySafeBucketLabels.selected, 4);
  assert.equal(scan.oracleSummary.repeatabilitySafeBucketLabels.improved, 2);
  assert.equal(scan.oracleSummary.featureIdenticalConflictBucketCount, 1);
  assert(scan.discovery.safeCandidateCount > 0);
  assert(scan.discovery.blockedCandidateCount > 0);

  const stateCandidate = scan.discovery.safeCandidates.find((candidate) =>
    candidate.atoms.some((atom) => atom.expression === "statePolicy==initial-incumbent")
  );
  assert(stateCandidate, "expected a safe state-conditioned candidate");
  assert.equal(stateCandidate.regressed, 0);
  assert.equal(stateCandidate.improved, 1);
  assert.equal(stateCandidate.repeatabilitySafeSelected, 3);
  assert.match(fs.readFileSync(path.join(outputDir, "state-conditioned-pockets.txt"), "utf8"), /Top safe candidates:/);

  const filteredResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-replay-state-conditioned-pockets.mjs",
      `--source-root=${repoRelative(sourceRoot)}`,
      `--artifact-dir=${repoRelative(filteredOutputDir)}`,
      "--exclude-pressure-family=service-pressure",
      "--min-improved-labels=1",
      "--max-atoms=20",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(filteredResult.status, 0, filteredResult.stderr || filteredResult.stdout);
  const filteredScan = JSON.parse(
    fs.readFileSync(path.join(filteredOutputDir, "state-conditioned-pockets.json"), "utf8")
  );
  assert.deepEqual(filteredScan.options.excludePressureFamilies, ["service-pressure"]);
  assert.deepEqual(filteredScan.sourceSummary.pressureFamilies, ["anchor-service"]);
  assert.equal(filteredScan.sourceSummary.scannedRollForwardLabels, 1);
  assert.equal(filteredScan.oracleSummary.repeatabilitySafeBucketLabels.improved, 1);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS replay state-conditioned pocket discovery script tests passed.");
