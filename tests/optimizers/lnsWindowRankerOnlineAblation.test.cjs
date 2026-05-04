const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const {
  buildLnsWindowRankerOnlineAblationRegistryEntryDraft,
  buildLnsWindowRankerOnlineAblationTelemetryManifest,
  createLnsWindowRankerOnlineCalibrationSnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS,
  formatLnsWindowRankerOnlineCalibration,
  formatLnsWindowRankerOnlineAblation,
  runLnsWindowRankerOnlineCalibration,
  runLnsWindowRankerOnlineAblation
} = require("../../dist/benchmarkApi.js");

function buildMockSolution(params) {
  const ranker = params.lns?.windowRanker;
  const usesRanker = Boolean(ranker?.model);
  const overridesBaseline = usesRanker && (ranker.minScoreDelta ?? 0) < 0.2;
  const totalPopulation = overridesBaseline ? 120 : 100;
  const windowRankerSelection = usesRanker
    ? {
        source: "learned-window-ranker",
        modelFingerprint: "fnv1a:test-online",
        featureSchemaVersion: 2,
        candidateCount: 2,
        baselineScore: 0.1,
        selectedScore: overridesBaseline ? 0.4 : 0.25,
        scoreDelta: overridesBaseline ? 0.3 : 0.15,
        selectedByBaseline: !overridesBaseline,
        ...(overridesBaseline ? {} : { fallbackReason: "score-delta-below-threshold" })
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
            overrides: overridesBaseline ? 1 : 0,
            fallbackDecisions: overridesBaseline ? 1 : 2
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
    assert.equal(result.variantSummaries[1].overrideOutcomeCount, 1);
    assert.equal(result.variantSummaries[1].overrideImprovedOutcomeCount, 1);
    assert.equal(result.variantSummaries[1].overrideNeutralOutcomeCount, 0);
    assert.equal(result.variantSummaries[1].fallbackOutcomeCount, 0);
    assert.equal(result.variantSummaries[1].meanOverrideScoreDelta, 0.3);
    assert.equal(result.variantSummaries[1].overrideFinalImprovedCaseCount, 1);
    assert.equal(result.variantSummaries[1].overrideFinalNeutralCaseCount, 0);
    assert.equal(result.variantSummaries[1].overrideFinalRegressedCaseCount, 0);
    assert.equal(result.variantSummaries[1].meanOverrideFinalPopulationDelta, 20);
    assert.deepEqual(result.cases[0].variants[1].finalOutcome, {
      status: "improved",
      populationDeltaVsBaseline: 20,
      hasOverride: true,
      hasFallback: false
    });

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
    assert.match(formatLnsWindowRankerOnlineAblation(result), /override-improved=1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /override-final=1\/0\/0/);

    const telemetryManifest = buildLnsWindowRankerOnlineAblationTelemetryManifest(result, {
      command: "node dist/lnsBenchmarkCli.js --window-ranker-online-ablation",
      inputArtifacts: ["artifacts/model.json"],
      outputArtifacts: ["artifact.json"]
    });
    assert.equal(telemetryManifest.source, "model-experiment");
    assert.equal(telemetryManifest.modelFingerprint, "fnv1a:test-online");
    assert.equal(telemetryManifest.metrics.meanPopulationDeltaVsBaseline, 20);
    assert.equal(telemetryManifest.metrics.rankerOverrideCount, 1);
    assert.equal(telemetryManifest.metrics.overrideImprovedOutcomeCount, 1);
    assert.equal(telemetryManifest.metrics.overrideNeutralOutcomeCount, 0);
    assert.equal(telemetryManifest.metrics.overrideFinalImprovedCaseCount, 1);
    assert.equal(telemetryManifest.metrics.meanOverrideFinalPopulationDelta, 20);

    const registryDraft = buildLnsWindowRankerOnlineAblationRegistryEntryDraft(result, {
      commands: ["node dist/lnsBenchmarkCli.js --window-ranker-online-ablation"],
      artifactPaths: ["artifact.json"],
      modelPath: "artifacts/model.json"
    });
    assert.equal(registryDraft.artifactType, "model-experiment");
    assert.equal(registryDraft.modelFingerprint, "fnv1a:test-online");
    assert.deepEqual(registryDraft.seeds, [7]);
    assert.equal(registryDraft.budget.minScoreDelta, 0.05);
    assert.equal(registryDraft.budget.comparisonCount, 1);
    assert.equal(registryDraft.budget.overrideImprovedOutcomeCount, 1);
    assert.equal(registryDraft.budget.overrideNeutralOutcomeCount, 0);
    assert.equal(registryDraft.budget.overrideFinalImprovedCaseCount, 1);
    assert.equal(registryDraft.budget.overrideFinalNeutralCaseCount, 0);
    assert.equal(registryDraft.budget.overrideFinalRegressedCaseCount, 0);
    assert.equal(registryDraft.model.modelPath, "artifacts/model.json");
    assert.equal(registryDraft.splitStatus.protectedHoldout, false);
    assert.equal(registryDraft.summaryMetrics.meanPopulationDeltaVsBaseline, 20);

    const protectedDraft = buildLnsWindowRankerOnlineAblationRegistryEntryDraft(result, {
      commands: ["node dist/lnsBenchmarkCli.js --window-ranker-online-ablation --window-ranker-protected-holdout"],
      artifactPaths: ["artifact.json"],
      protectedHoldout: true
    });
    assert.equal(protectedDraft.splitStatus.protectedHoldout, true);
    assert.deepEqual(protectedDraft.cases, { development: [], holdout: ["online-ranker-fixture"] });
    assert.equal(protectedDraft.splitStatus.leakage, "none");
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

  const protectedResult = childProcess.spawnSync(
    process.execPath,
    [cliPath, "--list", "--window-ranker-online-ablation", "--window-ranker-protected-holdout"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(protectedResult.status, 0, protectedResult.stderr);
  assert.match(protectedResult.stdout, /lns-holdout-corridor-weave-pressure/);
  assert.match(protectedResult.stdout, /lns-holdout-anchor-service-shelf-pressure/);
  assert.equal(DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS.length, 5);
}

function testOnlineCalibrationSummarizesThresholdSweep() {
  const lnsSolverModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsSolverModule.solveLns;
  lnsSolverModule.solveLns = (_grid, params) => buildMockSolution(params);

  try {
    const result = runLnsWindowRankerOnlineCalibration(
      [
        {
          name: "online-ranker-calibration-fixture",
          description: "Small fixture for online LNS ranker threshold calibration.",
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
        minScoreDeltas: [0, 0.2],
        model: {
          modelType: "lns-window-linear-pairwise-ranker",
          modelFingerprint: "fnv1a:test-online",
          featureSchemaVersion: 2,
          weights: { selectedByBaseline: -1 }
        },
        lns: {
          iterations: 2,
          repairTimeLimitSeconds: 0.25
        }
      }
    );

    assert.deepEqual(result.minScoreDeltas, [0, 0.2]);
    assert.equal(result.topMeanPopulationDeltaMinScoreDelta, 0);
    assert.equal(result.topSafeMinScoreDelta, 0);
    assert.equal(result.thresholdSummaries[0].meanPopulationDeltaVsBaseline, 20);
    assert.equal(result.thresholdSummaries[0].rankerOverrideCount, 1);
    assert.equal(result.thresholdSummaries[1].meanPopulationDeltaVsBaseline, 0);
    assert.equal(result.thresholdSummaries[1].rankerFallbackDecisionCount, 2);
    assert.equal(result.thresholdSummaries[1].safetyGatePassed, true);

    const snapshot = createLnsWindowRankerOnlineCalibrationSnapshot(result);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(Object.hasOwn(snapshot.thresholdSummaries[0], "meanWallClockDeltaVsBaselineSeconds"), false);
    assert.match(formatLnsWindowRankerOnlineCalibration(result), /=== LNS Window Ranker Threshold Sweep ===/);
    assert.match(formatLnsWindowRankerOnlineCalibration(result), /min-score-delta=0.2/);
  } finally {
    lnsSolverModule.solveLns = originalSolveLns;
  }
}

testOnlineAblationRunnerComparesEqualBudgets();
testLnsBenchmarkCliListsOnlineAblationCases();
testOnlineCalibrationSummarizesThresholdSweep();
