const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const {
  buildLnsWindowRankerOnlineAblationRegistryEntryDraft,
  buildLnsWindowRankerOnlineAblationTelemetryManifest,
  buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft,
  buildLnsWindowRankerOnlineCalibrationTelemetryManifest,
  createLnsWindowRankerOnlineCalibrationSnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS,
  formatLnsWindowRankerOnlineCalibration,
  formatLnsWindowRankerOnlineAblation,
  runLnsWindowRankerOnlineCalibration,
  runLnsWindowRankerOnlineAblation
} = require("../../dist/benchmarkApi.js");

function featureDeltas(selected, baseline) {
  return Object.fromEntries(
    [...new Set([...Object.keys(selected), ...Object.keys(baseline)])].map((featureName) => [
      featureName,
      (selected[featureName] ?? 0) - (baseline[featureName] ?? 0)
    ])
  );
}

function buildMockSolution(params) {
  const ranker = params.lns?.windowRanker;
  const usesRanker = Boolean(ranker?.model);
  const overridesBaseline = usesRanker && (ranker.minScoreDelta ?? 0) < 0.2;
  const totalPopulation = overridesBaseline ? 120 : 100;
  const baselineFeatures = {
    selectedByBaseline: 1,
    serviceCandidatesIntersecting: 0,
    residentialCandidateHeadroom: 0.1
  };
  const selectedFeatures = overridesBaseline
    ? {
        selectedByBaseline: 0,
        serviceCandidatesIntersecting: 0.5,
        residentialCandidateHeadroom: 0.3
      }
    : baselineFeatures;
  const windowRankerSelection = usesRanker
    ? {
        source: "learned-window-ranker",
        modelFingerprint: "fnv1a:test-online",
        featureSchemaVersion: 2,
        candidateCount: 2,
        baselineScore: 0.1,
        selectedScore: overridesBaseline ? 0.4 : 0.25,
        scoreDelta: overridesBaseline ? 0.3 : 0.15,
        baselineCandidateIndex: 0,
        selectedCandidateIndex: overridesBaseline ? 1 : 0,
        baselineOperator: "sliding",
        selectedOperator: overridesBaseline ? "service-overlap" : "sliding",
        baselineWindow: { top: 0, left: 0, rows: 2, cols: 2 },
        selectedWindow: overridesBaseline
          ? { top: 0, left: 1, rows: 2, cols: 2 }
          : { top: 0, left: 0, rows: 2, cols: 2 },
        selectedByBaseline: !overridesBaseline,
        baselineFeatures,
        selectedFeatures,
        featureDeltas: featureDeltas(selectedFeatures, baselineFeatures),
        ...(overridesBaseline ? {} : { fallbackReason: "score-delta-below-threshold" })
      }
    : undefined;
  const roads = new Set(overridesBaseline ? ["0,0", "0,1"] : ["0,0"]);
  const services = overridesBaseline ? [{ r: 0, c: 1, rows: 1, cols: 1, range: 2 }] : [];
  const residentials = overridesBaseline ? [{ r: 1, c: 1, rows: 1, cols: 1 }] : [];

  return {
    optimizer: "lns",
    roads,
    services,
    serviceTypeIndices: services.map(() => 0),
    servicePopulationIncreases: services.map(() => 5),
    residentials,
    residentialTypeIndices: residentials.map(() => 0),
    populations: residentials.map(() => totalPopulation),
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
          operator: windowRankerSelection?.selectedOperator ?? "sliding",
          window: windowRankerSelection?.selectedWindow ?? { top: 0, left: 0, rows: 2, cols: 2 },
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
    assert.equal(result.variantSummaries[1].overrideChangedWindowCount, 1);
    assert.equal(result.variantSummaries[1].fallbackChangedWindowCount, 0);
    assert.equal(result.variantSummaries[1].overrideFeatureDeltaCount, 1);
    assert.equal(result.variantSummaries[1].fallbackFeatureDeltaCount, 0);
    assert.deepEqual(result.variantSummaries[1].overrideMeanFeatureDeltas, {
      residentialCandidateHeadroom: 0.2,
      selectedByBaseline: -1,
      serviceCandidatesIntersecting: 0.5
    });
    assert.deepEqual(result.variantSummaries[1].fallbackMeanFeatureDeltas, {});
    assert.deepEqual(result.variantSummaries[1].overrideTransitionCounts, { "sliding->service-overlap": 1 });
    assert.deepEqual(result.variantSummaries[1].fallbackTransitionCounts, {});
    assert.deepEqual(result.variantSummaries[1].overrideTransitionFeatureDeltaCounts, {
      "sliding->service-overlap": 1
    });
    assert.deepEqual(result.variantSummaries[1].fallbackTransitionFeatureDeltaCounts, {});
    assert.deepEqual(result.variantSummaries[1].overrideTransitionMeanFeatureDeltas, {
      "sliding->service-overlap": {
        residentialCandidateHeadroom: 0.2,
        selectedByBaseline: -1,
        serviceCandidatesIntersecting: 0.5
      }
    });
    assert.deepEqual(result.variantSummaries[1].fallbackTransitionMeanFeatureDeltas, {});
    assert.deepEqual(result.variantSummaries[1].overrideTransitionFinalOutcomeCounts, {
      "sliding->service-overlap": { improved: 1, neutral: 0, regressed: 0 }
    });
    assert.deepEqual(result.variantSummaries[1].fallbackTransitionFinalOutcomeCounts, {});
    assert.deepEqual(result.variantSummaries[1].overrideTransitionPressureFamilyCounts, {
      "sliding->service-overlap": { uncategorized: 1 }
    });
    assert.deepEqual(result.variantSummaries[1].fallbackTransitionPressureFamilyCounts, {});
    assert.equal(result.variantSummaries[1].overrideFinalImprovedCaseCount, 1);
    assert.equal(result.variantSummaries[1].overrideFinalNeutralCaseCount, 0);
    assert.equal(result.variantSummaries[1].overrideFinalRegressedCaseCount, 0);
    assert.equal(result.variantSummaries[1].meanOverrideFinalPopulationDelta, 20);
    assert.equal(result.variantSummaries[1].sameFinalLayoutCount, 0);
    assert.equal(result.variantSummaries[1].changedFinalLayoutCount, 1);
    assert.equal(result.variantSummaries[1].meanFinalLayoutPlacementDelta, 3);
    assert.equal(result.cases[0].variants[0].finalLayoutDeltaVsBaseline.sameFinalLayout, true);
    assert.equal(result.cases[0].variants[0].finalLayoutDeltaVsBaseline.placementDeltaCount, 0);
    assert.equal(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.sameFinalLayout, false);
    assert.equal(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.roadAddedCount, 1);
    assert.equal(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.serviceAddedCount, 1);
    assert.equal(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.residentialAddedCount, 1);
    assert.equal(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.placementDeltaCount, 3);
    assert.match(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.baselineFingerprint, /^fnv1a:/);
    assert.match(result.cases[0].variants[1].finalLayoutDeltaVsBaseline.variantFingerprint, /^fnv1a:/);
    assert.deepEqual(result.cases[0].variants[1].selectionDiagnostics, {
      overrideTransitionCounts: { "sliding->service-overlap": 1 },
      fallbackTransitionCounts: {},
      overrideChangedWindowCount: 1,
      fallbackChangedWindowCount: 0,
      overrideFeatureDeltaCount: 1,
      fallbackFeatureDeltaCount: 0,
      overrideMeanFeatureDeltas: {
        residentialCandidateHeadroom: 0.2,
        selectedByBaseline: -1,
        serviceCandidatesIntersecting: 0.5
      },
      fallbackMeanFeatureDeltas: {},
      overrideTransitionFeatureDeltaCounts: {
        "sliding->service-overlap": 1
      },
      fallbackTransitionFeatureDeltaCounts: {},
      overrideTransitionMeanFeatureDeltas: {
        "sliding->service-overlap": {
          residentialCandidateHeadroom: 0.2,
          selectedByBaseline: -1,
          serviceCandidatesIntersecting: 0.5
        }
      },
      fallbackTransitionMeanFeatureDeltas: {}
    });
    assert.deepEqual(result.cases[0].variants[1].selectionTrace, [
      {
        iteration: 0,
        phase: "focused",
        outcomeStatus: "improved",
        populationBefore: 100,
        populationAfter: 120,
        improvement: 20,
        stagnantIterationsBefore: 0,
        repairTimeLimitSeconds: 0.25,
        appliedOperator: "service-overlap",
        appliedWindow: { top: 0, left: 1, rows: 2, cols: 2 },
        transition: "sliding->service-overlap",
        changedWindow: true,
        selectionStatus: "override",
        candidateCount: 2,
        baselineCandidateIndex: 0,
        selectedCandidateIndex: 1,
        baselineOperator: "sliding",
        selectedOperator: "service-overlap",
        baselineWindow: { top: 0, left: 0, rows: 2, cols: 2 },
        selectedWindow: { top: 0, left: 1, rows: 2, cols: 2 },
        selectedByBaseline: false,
        baselineScore: 0.1,
        selectedScore: 0.4,
        scoreDelta: 0.3,
        modelFingerprint: "fnv1a:test-online",
        featureSchemaVersion: 2,
        baselineFeatures: {
          residentialCandidateHeadroom: 0.1,
          selectedByBaseline: 1,
          serviceCandidatesIntersecting: 0
        },
        selectedFeatures: {
          residentialCandidateHeadroom: 0.3,
          selectedByBaseline: 0,
          serviceCandidatesIntersecting: 0.5
        },
        featureDeltas: {
          residentialCandidateHeadroom: 0.19999999999999998,
          selectedByBaseline: -1,
          serviceCandidatesIntersecting: 0.5
        }
      }
    ]);
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
    assert.equal(snapshot.cases[0].variants[1].selectionTrace.length, 1);
    assert.equal(snapshot.cases[0].variants[1].finalLayoutDeltaVsBaseline.placementDeltaCount, 3);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /=== LNS Window Ranker Online A\/B ===/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /overrides=1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /traces=1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /trace:1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /layout-changed=1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /layout-delta:3/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /override-improved=1/);
    assert.match(formatLnsWindowRankerOnlineAblation(result), /override-final=1\/0\/0/);
    assert.match(
      formatLnsWindowRankerOnlineAblation(result),
      /override-transition-finals=sliding->service-overlap:1\/0\/0/
    );
    assert.match(
      formatLnsWindowRankerOnlineAblation(result),
      /override-transition-families=sliding->service-overlap\[uncategorized:1\]/
    );

    const telemetryManifest = buildLnsWindowRankerOnlineAblationTelemetryManifest(result, {
      command: "node dist/lnsBenchmarkCli.js --window-ranker-online-ablation",
      inputArtifacts: ["artifacts/model.json"],
      outputArtifacts: ["artifact.json"]
    });
    assert.equal(telemetryManifest.source, "model-experiment");
    assert.equal(telemetryManifest.modelFingerprint, "fnv1a:test-online");
    assert.equal(telemetryManifest.metrics.meanPopulationDeltaVsBaseline, 20);
    assert.equal(telemetryManifest.metrics.rankerOverrideCount, 1);
    assert.equal(telemetryManifest.metrics.selectionTraceCount, 1);
    assert.equal(telemetryManifest.metrics.changedFinalLayoutCount, 1);
    assert.equal(telemetryManifest.metrics.meanFinalLayoutPlacementDelta, 3);
    assert.equal(telemetryManifest.metrics.overrideImprovedOutcomeCount, 1);
    assert.equal(telemetryManifest.metrics.overrideNeutralOutcomeCount, 0);
    assert.equal(telemetryManifest.metrics.overrideFinalImprovedCaseCount, 1);
    assert.equal(telemetryManifest.metrics.meanOverrideFinalPopulationDelta, 20);
    assert.equal(telemetryManifest.metrics.overrideChangedWindowCount, 1);
    assert.equal(telemetryManifest.metrics.fallbackChangedWindowCount, 0);
    assert.equal(telemetryManifest.metrics.overrideFeatureDeltaCount, 1);
    assert.deepEqual(telemetryManifest.metrics.overrideMeanFeatureDeltas, {
      residentialCandidateHeadroom: 0.2,
      selectedByBaseline: -1,
      serviceCandidatesIntersecting: 0.5
    });
    assert.deepEqual(telemetryManifest.metrics.overrideTransitionFeatureDeltaCounts, {
      "sliding->service-overlap": 1
    });
    assert.deepEqual(telemetryManifest.metrics.overrideTransitionMeanFeatureDeltas, {
      "sliding->service-overlap": {
        residentialCandidateHeadroom: 0.2,
        selectedByBaseline: -1,
        serviceCandidatesIntersecting: 0.5
      }
    });
    assert.deepEqual(telemetryManifest.metrics.overrideTransitionCounts, { "sliding->service-overlap": 1 });
    assert.deepEqual(telemetryManifest.metrics.fallbackTransitionCounts, {});
    assert.deepEqual(telemetryManifest.metrics.overrideTransitionFinalOutcomeCounts, {
      "sliding->service-overlap": { improved: 1, neutral: 0, regressed: 0 }
    });
    assert.deepEqual(telemetryManifest.metrics.fallbackTransitionFinalOutcomeCounts, {});
    assert.deepEqual(telemetryManifest.metrics.overrideTransitionPressureFamilyCounts, {
      "sliding->service-overlap": { uncategorized: 1 }
    });
    assert.deepEqual(telemetryManifest.metrics.fallbackTransitionPressureFamilyCounts, {});

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
    assert.equal(registryDraft.budget.selectionTraceCount, 1);
    assert.equal(registryDraft.budget.changedFinalLayoutCount, 1);
    assert.equal(registryDraft.budget.meanFinalLayoutPlacementDelta, 3);
    assert.equal(registryDraft.budget.overrideFinalImprovedCaseCount, 1);
    assert.equal(registryDraft.budget.overrideFinalNeutralCaseCount, 0);
    assert.equal(registryDraft.budget.overrideFinalRegressedCaseCount, 0);
    assert.equal(registryDraft.model.modelPath, "artifacts/model.json");
    assert.equal(registryDraft.splitStatus.protectedHoldout, false);
    assert.equal(registryDraft.summaryMetrics.meanPopulationDeltaVsBaseline, 20);
    assert.equal(registryDraft.summaryMetrics.changedFinalLayoutCount, 1);
    assert.equal(registryDraft.summaryMetrics.meanFinalLayoutPlacementDelta, 3);
    assert.equal(registryDraft.summaryMetrics.overrideChangedWindowCount, 1);
    assert.equal(registryDraft.summaryMetrics.fallbackChangedWindowCount, 0);
    assert.equal(registryDraft.summaryMetrics.overrideFeatureDeltaCount, 1);
    assert.deepEqual(registryDraft.summaryMetrics.overrideMeanFeatureDeltas, {
      residentialCandidateHeadroom: 0.2,
      selectedByBaseline: -1,
      serviceCandidatesIntersecting: 0.5
    });
    assert.deepEqual(registryDraft.summaryMetrics.overrideTransitionFeatureDeltaCounts, {
      "sliding->service-overlap": 1
    });
    assert.deepEqual(registryDraft.summaryMetrics.overrideTransitionMeanFeatureDeltas, {
      "sliding->service-overlap": {
        residentialCandidateHeadroom: 0.2,
        selectedByBaseline: -1,
        serviceCandidatesIntersecting: 0.5
      }
    });
    assert.deepEqual(registryDraft.summaryMetrics.overrideTransitionCounts, { "sliding->service-overlap": 1 });
    assert.deepEqual(registryDraft.summaryMetrics.fallbackTransitionCounts, {});
    assert.deepEqual(registryDraft.summaryMetrics.overrideTransitionFinalOutcomeCounts, {
      "sliding->service-overlap": { improved: 1, neutral: 0, regressed: 0 }
    });
    assert.deepEqual(registryDraft.summaryMetrics.fallbackTransitionFinalOutcomeCounts, {});
    assert.deepEqual(registryDraft.summaryMetrics.overrideTransitionPressureFamilyCounts, {
      "sliding->service-overlap": { uncategorized: 1 }
    });
    assert.deepEqual(registryDraft.summaryMetrics.fallbackTransitionPressureFamilyCounts, {});

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

  const protectedSweepResult = childProcess.spawnSync(
    process.execPath,
    [cliPath, "--list", "--window-ranker-threshold-sweep", "--window-ranker-protected-holdout"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(protectedSweepResult.status, 0, protectedSweepResult.stderr);
  assert.match(protectedSweepResult.stdout, /lns-holdout-corridor-weave-pressure/);
  assert.match(protectedSweepResult.stdout, /lns-holdout-anchor-service-shelf-pressure/);
}

function testOnlineCalibrationSummarizesThresholdSweep() {
  const lnsSolverModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsSolverModule.solveLns;
  lnsSolverModule.solveLns = (_grid, params) => buildMockSolution(params);

  try {
    const model = {
      modelType: "lns-window-linear-pairwise-ranker",
      modelFingerprint: "fnv1a:test-online",
      featureSchemaVersion: 2,
      weights: { selectedByBaseline: -1 }
    };
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
        model,
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
    assert.equal(result.thresholdSummaries[0].changedFinalLayoutCount, 1);
    assert.equal(result.thresholdSummaries[0].meanFinalLayoutPlacementDelta, 3);
    assert.equal(result.thresholdSummaries[0].overrideChangedWindowCount, 1);
    assert.equal(result.thresholdSummaries[0].overrideFeatureDeltaCount, 1);
    assert.deepEqual(result.thresholdSummaries[0].overrideMeanFeatureDeltas, {
      residentialCandidateHeadroom: 0.2,
      selectedByBaseline: -1,
      serviceCandidatesIntersecting: 0.5
    });
    assert.deepEqual(result.thresholdSummaries[0].overrideTransitionFeatureDeltaCounts, {
      "sliding->service-overlap": 1
    });
    assert.deepEqual(result.thresholdSummaries[0].overrideTransitionMeanFeatureDeltas, {
      "sliding->service-overlap": {
        residentialCandidateHeadroom: 0.2,
        selectedByBaseline: -1,
        serviceCandidatesIntersecting: 0.5
      }
    });
    assert.deepEqual(result.thresholdSummaries[0].overrideTransitionCounts, { "sliding->service-overlap": 1 });
    assert.deepEqual(result.thresholdSummaries[0].overrideTransitionFinalOutcomeCounts, {
      "sliding->service-overlap": { improved: 1, neutral: 0, regressed: 0 }
    });
    assert.deepEqual(result.thresholdSummaries[0].overrideTransitionPressureFamilyCounts, {
      "sliding->service-overlap": { uncategorized: 1 }
    });
    assert.equal(result.thresholdSummaries[1].meanPopulationDeltaVsBaseline, 0);
    assert.equal(result.thresholdSummaries[1].rankerFallbackDecisionCount, 2);
    assert.equal(result.thresholdSummaries[1].changedFinalLayoutCount, 0);
    assert.equal(result.thresholdSummaries[1].meanFinalLayoutPlacementDelta, 0);
    assert.equal(result.thresholdSummaries[1].fallbackChangedWindowCount, 0);
    assert.equal(result.thresholdSummaries[1].fallbackFeatureDeltaCount, 1);
    assert.deepEqual(result.thresholdSummaries[1].fallbackMeanFeatureDeltas, {
      residentialCandidateHeadroom: 0,
      selectedByBaseline: 0,
      serviceCandidatesIntersecting: 0
    });
    assert.deepEqual(result.thresholdSummaries[1].fallbackTransitionFeatureDeltaCounts, { "sliding->sliding": 1 });
    assert.deepEqual(result.thresholdSummaries[1].fallbackTransitionMeanFeatureDeltas, {
      "sliding->sliding": {
        residentialCandidateHeadroom: 0,
        selectedByBaseline: 0,
        serviceCandidatesIntersecting: 0
      }
    });
    assert.deepEqual(result.thresholdSummaries[1].fallbackTransitionCounts, { "sliding->sliding": 1 });
    assert.deepEqual(result.thresholdSummaries[1].fallbackTransitionFinalOutcomeCounts, {
      "sliding->sliding": { improved: 0, neutral: 1, regressed: 0 }
    });
    assert.deepEqual(result.thresholdSummaries[1].fallbackTransitionPressureFamilyCounts, {
      "sliding->sliding": { uncategorized: 1 }
    });
    assert.equal(result.thresholdSummaries[1].safetyGatePassed, true);

    const snapshot = createLnsWindowRankerOnlineCalibrationSnapshot(result);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(Object.hasOwn(snapshot.thresholdSummaries[0], "meanWallClockDeltaVsBaselineSeconds"), false);
    const formatted = formatLnsWindowRankerOnlineCalibration(result);
    assert.match(formatted, /=== LNS Window Ranker Threshold Sweep ===/);
    assert.match(formatted, /min-score-delta=0.2/);
    assert.match(formatted, /override-transitions=sliding->service-overlap:1/);
    assert.match(formatted, /override-feature-deltas=selectedByBaseline:-1/);
    assert.match(formatted, /override-transition-feature-deltas=sliding->service-overlap\[selectedByBaseline:-1/);
    assert.match(formatted, /fallback-transitions=sliding->sliding:1/);
    assert.match(formatted, /override-transition-finals=sliding->service-overlap:1\/0\/0/);
    assert.match(formatted, /fallback-transition-finals=sliding->sliding:0\/1\/0/);

    const telemetryManifest = buildLnsWindowRankerOnlineCalibrationTelemetryManifest(result, {
      command: "node dist/lnsBenchmarkCli.js --window-ranker-threshold-sweep",
      model,
      inputArtifacts: ["artifacts/model.json"],
      outputArtifacts: ["artifacts/calibration.json"]
    });
    assert.equal(telemetryManifest.modelFingerprint, "fnv1a:test-online");
    assert.equal(telemetryManifest.metrics.thresholdCount, 2);
    assert.equal(telemetryManifest.metrics.topMeanPopulationDeltaMinScoreDelta, 0);
    assert.equal(telemetryManifest.metrics.safeThresholdCount, 2);
    assert.equal(telemetryManifest.metrics.thresholdSummaries[1].fallbackTransitionCounts["sliding->sliding"], 1);
    assert.equal(
      telemetryManifest.metrics.thresholdSummaries[1].fallbackTransitionFinalOutcomeCounts["sliding->sliding"].neutral,
      1
    );
    assert.equal(telemetryManifest.metrics.thresholdSummaries[0].changedFinalLayoutCount, 1);
    assert.equal(telemetryManifest.metrics.thresholdSummaries[1].changedFinalLayoutCount, 0);

    const registryDraft = buildLnsWindowRankerOnlineCalibrationRegistryEntryDraft(result, {
      commands: ["node dist/lnsBenchmarkCli.js --window-ranker-threshold-sweep"],
      artifactPaths: ["artifacts/calibration.json", "artifacts/calibration.txt", "artifacts/telemetry-manifest.json"],
      model,
      modelPath: "artifacts/model.json",
      protectedHoldout: true
    });
    assert.equal(registryDraft.model.modelPath, "artifacts/model.json");
    assert.equal(registryDraft.splitStatus.protectedHoldout, true);
    assert.equal(registryDraft.budget.thresholdCount, 2);
    assert.equal(registryDraft.budget.totalRuns, 4);
    assert.equal(registryDraft.summaryMetrics.thresholdSummaries[0].overrideChangedWindowCount, 1);
    assert.equal(
      registryDraft.summaryMetrics.thresholdSummaries[0].overrideTransitionPressureFamilyCounts[
        "sliding->service-overlap"
      ].uncategorized,
      1
    );
  } finally {
    lnsSolverModule.solveLns = originalSolveLns;
  }
}

testOnlineAblationRunnerComparesEqualBudgets();
testLnsBenchmarkCliListsOnlineAblationCases();
testOnlineCalibrationSummarizesThresholdSweep();
