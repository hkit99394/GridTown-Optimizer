const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const {
  createLnsWindowRankerOnlineAblationSnapshot,
  formatLnsWindowRankerOnlineAblation,
  runLnsWindowRankerOnlineAblation
} = require("../../dist/benchmarkApi.js");

function buildMockSolution(params) {
  const ranker = params.lns?.windowRanker;
  const usesRanker = Boolean(ranker?.model);
  const totalPopulation = usesRanker ? 120 : 100;
  const windowRankerSelection = usesRanker
    ? {
        source: "learned-window-ranker",
        modelFingerprint: "fnv1a:test-online",
        featureSchemaVersion: 2,
        candidateCount: 2,
        baselineScore: 0.1,
        selectedScore: 0.4,
        scoreDelta: 0.3,
        selectedByBaseline: false
      }
    : undefined;

  return {
    optimizer: "lns",
    roads: new Set(["0,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation,
    cpSatStatus: "FEASIBLE",
    lnsTelemetry: {
      stopReason: "iteration-limit",
      seedSource: "hint",
      seedWallClockSeconds: 0,
      seedTimeLimitSeconds: null,
      wallClockLimitSeconds: null,
      noImprovementTimeoutSeconds: null,
      focusedRepairTimeLimitSeconds: 0.25,
      escalatedRepairTimeLimitSeconds: 0.25,
      iterationsStarted: 1,
      iterationsCompleted: 1,
      improvingIterations: usesRanker ? 1 : 0,
      neutralIterations: usesRanker ? 0 : 1,
      recoverableFailures: 0,
      skippedIterations: 0,
      finalStagnantIterations: usesRanker ? 0 : 1,
      elapsedSeconds: 0,
      windowRanker: usesRanker
        ? {
            enabled: true,
            modelFingerprint: "fnv1a:test-online",
            featureSchemaVersion: 2,
            minScoreDelta: ranker.minScoreDelta ?? 0,
            decisions: 2,
            overrides: 1,
            fallbackDecisions: 1
          }
        : undefined,
      outcomes: [
        {
          iteration: 0,
          phase: "focused",
          operator: "sliding",
          window: { top: 0, left: 0, rows: 2, cols: 2 },
          stagnantIterationsBefore: 0,
          staleSecondsBefore: 0,
          repairTimeLimitSeconds: 0.25,
          wallClockSeconds: 0,
          populationBefore: 100,
          populationAfter: totalPopulation,
          improvement: totalPopulation - 100,
          status: usesRanker ? "improved" : "neutral",
          windowRankerSelection
        }
      ]
    }
  };
}

function testOnlineAblationRunnerComparesEqualBudgets() {
  const lnsSolverModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsSolverModule.solveLns;
  const observedParams = [];
  lnsSolverModule.solveLns = (_grid, params) => {
    observedParams.push(params);
    return buildMockSolution(params);
  };

  try {
    const result = runLnsWindowRankerOnlineAblation(
      [
        {
          name: "online-ranker-fixture",
          description: "Small fixture for online LNS ranker A/B scorecards.",
          grid: [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1]
          ],
          params: {
            optimizer: "lns",
            residentialTypes: [{ w: 1, h: 1, min: 10, max: 20, avail: 1 }]
          }
        }
      ],
      {
        seeds: [7],
        model: {
          modelType: "lns-window-linear-pairwise-ranker",
          modelFingerprint: "fnv1a:test-online",
          featureSchemaVersion: 2,
          weights: { selectedByBaseline: -1 }
        },
        minScoreDelta: 0.05,
        lns: {
          iterations: 2,
          repairTimeLimitSeconds: 0.25
        },
        cpSat: {
          numWorkers: 1
        },
        greedy: {
          profile: true
        }
      }
    );

    assert.equal(result.caseCount, 1);
    assert.equal(result.seedCount, 1);
    assert.equal(result.comparisonCount, 1);
    assert.deepEqual(result.variants, ["baseline", "window-ranker"]);
    assert.equal(result.coverage.runCount, 2);
    assert.equal(result.cases[0].baseline.totalPopulation, 100);
    assert.equal(result.cases[0].variants[1].totalPopulation, 120);
    assert.equal(result.cases[0].variants[1].populationDeltaVsBaseline, 20);
    assert.equal(result.variantSummaries[1].rankerDecisionCount, 2);
    assert.equal(result.variantSummaries[1].rankerOverrideCount, 1);
    assert.equal(result.variantSummaries[1].rankerFallbackDecisionCount, 1);
    assert.equal(result.variantSummaries[1].improvedCaseCount, 1);
    assert.equal(result.variantSummaries[1].regressedCaseCount, 0);

    assert.equal(observedParams.length, 2);
    assert.equal(observedParams[0].lns.iterations, observedParams[1].lns.iterations);
    assert.equal(observedParams[0].lns.repairTimeLimitSeconds, observedParams[1].lns.repairTimeLimitSeconds);
    assert.equal(observedParams[0].lns.windowRanker, undefined);
    assert.equal(observedParams[1].lns.windowRanker.model.modelFingerprint, "fnv1a:test-online");
    assert.equal(observedParams[1].lns.windowRanker.minScoreDelta, 0.05);
    assert.equal(observedParams[0].greedy.randomSeed, 7);
    assert.equal(observedParams[1].greedy.randomSeed, 7);
    assert.equal(observedParams[0].cpSat.randomSeed, 7);
    assert.equal(observedParams[1].cpSat.randomSeed, 7);

    const snapshot = createLnsWindowRankerOnlineAblationSnapshot(result);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(Object.hasOwn(snapshot.cases[0].variants[1], "wallClockSeconds"), false);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /=== LNS Window Ranker Online A\/B ===/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /overrides=1/);
  } finally {
    lnsSolverModule.solveLns = originalSolveLns;
  }
}

function testLnsBenchmarkCliListsOnlineAblationCases() {
  const cliPath = path.join(repoRoot, "dist", "lnsBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--list", "--window-ranker-online-ablation"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compact-service-repair/);
  assert.match(result.stdout, /lns-gate-choke-pressure/);
}

testOnlineAblationRunnerComparesEqualBudgets();
testLnsBenchmarkCliListsOnlineAblationCases();
