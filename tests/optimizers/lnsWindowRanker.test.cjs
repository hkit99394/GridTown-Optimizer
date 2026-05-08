const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildExperimentRegistryEntry,
  buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft,
  buildLnsWindowRankerGapDiagnosticsTelemetryManifest,
  buildLnsWindowRankerRegistryEntryDraft,
  buildLnsWindowRankerTelemetryManifest,
  formatLnsWindowRankerGapDiagnostics,
  createLnsWindowRankerSnapshot,
  formatLnsWindowRankerExperiment,
  runLnsWindowRankerGapDiagnostics,
  runLnsWindowRankerExperiment,
  validateExperimentRegistryEntry
} = require("city-builder/benchmarks");

function buildLabel({
  windowIndex,
  operatorScore,
  improvement,
  selectedByBaseline = false,
  serviceCandidates = 0,
  residentialHeadroomCandidate = 0,
  residentialHeadroom = 0,
  serviceBonus = 0,
  anchorReachable = 0,
  newlyReachable = 0,
  operator = "service-anchor"
}) {
  return {
    windowIndex,
    operatorScore,
    selectedByBaseline,
    operator,
    improvement,
    populationDelta: improvement,
    status: improvement > 0 ? "improved" : "neutral",
    usable: true,
    features: {
      schemaVersion: 2,
      area: 4,
      touchesRoadAnchorBoundary: false,
      roadCountInside: 0,
      serviceCountInside: 0,
      residentialCountInside: 0,
      residentialHeadroomInside: residentialHeadroom,
      serviceBonusInside: serviceBonus,
      connectivityShadow: {
        reachableEmptyCellsBefore: 0,
        reachableEmptyCellsAfterClearingWindow: newlyReachable,
        newlyReachableEmptyCellsIfCleared: newlyReachable,
        disconnectedEmptyCellsBefore: 0,
        disconnectedEmptyCellsAfterClearingWindow: 0,
        clearedBuildingFootprintCells: 0
      },
      fragmentation: {
        emptyComponentCountBefore: 1,
        emptyComponentCountAfterClearingWindow: 1,
        componentDeltaAfterClearingWindow: 0,
        allowedWindowCellCount: 4,
        anchorReachableWindowCellCount: anchorReachable,
        narrowGateCellCount: 0
      },
      candidateLoss: {
        serviceCandidatesIntersectingWindow: serviceCandidates,
        residentialCandidatesIntersectingWindow: 0,
        serviceCandidatesBlockedByIncumbent: 0,
        residentialCandidatesBlockedByIncumbent: 0,
        serviceCandidateBonusInside: 0,
        maxServiceCandidateBonusInside: 0,
        residentialCandidateHeadroomInside: residentialHeadroomCandidate,
        serviceTypeCounts: {},
        residentialTypeCounts: {}
      }
    }
  };
}

function buildCase(name, split, pressureFamily, bestImprovement, seedHintKind = "curated") {
  const labels = [
    buildLabel({
      windowIndex: 0,
      operatorScore: 10,
      improvement: 0,
      selectedByBaseline: true,
      operator: "weak-service",
      residentialHeadroom: 900,
      residentialHeadroomCandidate: 900,
      anchorReachable: 4,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 1,
      operatorScore: 2,
      improvement: bestImprovement,
      operator: "service-overlap",
      serviceCandidates: 10,
      residentialHeadroomCandidate: 0,
      anchorReachable: 1,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 2,
      operatorScore: 1,
      improvement: Math.floor(bestImprovement / 4),
      operator: "sliding",
      serviceCandidates: 2,
      residentialHeadroomCandidate: 500,
      anchorReachable: 1,
      newlyReachable: 0
    })
  ];

  return {
    name,
    description: `${name} replay fixture`,
    pressureFamily,
    seed: 7,
    seedHintKind,
    seedHintSourceName: seedHintKind === "weak-replay" ? `${name}-weak-replay-seed` : name,
    statePolicy: "initial-incumbent",
    stateIndex: 0,
    stateSourceIteration: null,
    stateSourceStatus: "initial-incumbent",
    stateStagnantIterations: 0,
    gridRows: 4,
    gridCols: 4,
    incumbentPopulation: 0,
    candidateWindowCount: labels.length,
    replayedWindowCount: labels.length,
    baselineSelectedWindow: null,
    baselineSelectedOperator: null,
    labels: labels.map((label) => ({
      ...label,
      caseName: name,
      pressureFamily,
      seed: 7,
      seedHintKind,
      seedHintSourceName: seedHintKind === "weak-replay" ? `${name}-weak-replay-seed` : name,
      statePolicy: "initial-incumbent",
      stateIndex: 0,
      stateSourceIteration: null,
      stateSourceStatus: "initial-incumbent",
      stateStagnantIterations: 0,
      operator: label.operator,
      selectionSource: "baseline-top-k",
      window: { top: 0, left: label.windowIndex, rows: 2, cols: 2 },
      incumbentPopulation: 0,
      totalPopulation: label.improvement,
      cpSatStatus: "OPTIMAL",
      repairTimeLimitSeconds: 1,
      cpSat: {
        modelEncodingVersion: "cp-sat-layout-v1",
        candidateKeyVersion: 1,
        modelFingerprint: "fnv1a:00000000",
        warmStartFixOutsideNeighborhood: true,
        modelSize: null
      },
      validation: {
        valid: true,
        recomputedTotalPopulation: label.improvement
      }
    })),
    split
  };
}

function cloneFixtureWithWeakReplaySeedCases() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  const weakNames = new Set(["dev-service-a", "holdout-service-a"]);
  for (const split of fixture.lns.splits) {
    for (const benchmarkCase of split.replay.cases) {
      if (!weakNames.has(benchmarkCase.name)) continue;
      benchmarkCase.seedHintKind = "weak-replay";
      benchmarkCase.seedHintSourceName = `${benchmarkCase.name}-weak-replay-seed`;
      for (const label of benchmarkCase.labels) {
        label.seedHintKind = benchmarkCase.seedHintKind;
        label.seedHintSourceName = benchmarkCase.seedHintSourceName;
      }
    }
  }
  return fixture;
}

function buildSplit(name, cases) {
  const labelCount = cases.reduce((total, entry) => total + entry.labels.length, 0);
  return {
    split: name,
    selectedCaseNames: cases.map((entry) => entry.name),
    pressureFamilies: [...new Set(cases.map((entry) => entry.pressureFamily))],
    seeds: [7],
    labelCount,
    usableLabelCount: labelCount,
    statusCounts: {
      improved: cases.length * 2,
      neutral: cases.length,
      regressed: 0,
      invalid: 0,
      "recoverable-failure": 0
    },
    replay: {
      schemaVersion: 1,
      caseCount: cases.length,
      seedCount: 1,
      comparisonCount: cases.length,
      seeds: [7],
      selectedCaseNames: cases.map((entry) => entry.name),
      pressureFamilies: [...new Set(cases.map((entry) => entry.pressureFamily))],
      maxWindows: 3,
      explorationWindowCount: 0,
      repairTimeLimitSeconds: 1,
      statePolicies: ["initial-incumbent"],
      capturedStatePolicies: ["initial-incumbent"],
      stateCollectionIterations: 4,
      stateCollectionRepairTimeLimitSeconds: 1,
      stateCount: cases.length,
      featureSchemaVersion: 2,
      cpSatNumWorkers: 1,
      cpSatModelFingerprints: ["fnv1a:00000000"],
      labelCount,
      cases
    }
  };
}

function buildFixture() {
  const developmentCases = [
    buildCase("dev-service-a", "development", "service-pressure", 40),
    buildCase("dev-service-b", "development", "service-pressure", 35),
    buildCase("dev-gate-a", "development", "gate", 30)
  ];
  const holdoutCases = [
    buildCase("holdout-service-a", "holdout", "service-pressure", 50),
    buildCase("holdout-service-b", "holdout", "service-pressure", 45),
    buildCase("holdout-gate-a", "holdout", "gate", 40),
    buildCase("holdout-gate-b", "holdout", "gate", 35)
  ];

  return {
    schemaVersion: 1,
    seeds: [7],
    splitCount: 2,
    audit: {
      learnedModel: null,
      greedy: { profile: true, connectivityShadowScoring: true },
      lnsReplay: {
        preset: "strict-lns-replay",
        cpSatNumWorkers: 1,
        incumbentStatePolicy: "initial-incumbent",
        incumbentStatePolicies: ["initial-incumbent"],
        stateCollectionIterations: 4,
        stateCollectionRepairTimeLimitSeconds: 1,
        candidateWindowPolicy: "baseline-ranked-top-k",
        explorationWindowCount: 0,
        featureSchemaVersion: 2
      }
    },
    greedy: {
      labelCount: 0,
      sourceCounts: { "connectivity-shadow-decision": 0, "road-opportunity-counterfactual": 0 },
      splits: []
    },
    lns: {
      labelCount: 21,
      scaleReadiness: { passed: true, thresholds: {}, splitReadiness: [] },
      splits: [buildSplit("development", developmentCases), buildSplit("holdout", holdoutCases)]
    },
    leakage: {
      developmentGreedyCases: [],
      holdoutGreedyCases: [],
      developmentLnsCases: developmentCases.map((entry) => entry.name),
      holdoutLnsCases: holdoutCases.map((entry) => entry.name),
      greedyOverlap: [],
      lnsOverlap: [],
      protectedHoldout: true
    }
  };
}

function cloneFixtureWithBaselineReplayTies() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  for (const split of fixture.lns.splits) {
    const statusCounts = { improved: 0, neutral: 0, regressed: 0, invalid: 0, "recoverable-failure": 0 };
    for (const benchmarkCase of split.replay.cases) {
      const bestImprovement = Math.max(...benchmarkCase.labels.map((label) => label.improvement));
      const baselineLabel = benchmarkCase.labels.find((label) => label.selectedByBaseline);
      baselineLabel.improvement = bestImprovement;
      baselineLabel.populationDelta = bestImprovement;
      baselineLabel.status = "improved";
      baselineLabel.totalPopulation = bestImprovement;
      baselineLabel.validation.recomputedTotalPopulation = bestImprovement;
      for (const label of benchmarkCase.labels) statusCounts[label.status]++;
    }
    split.statusCounts = statusCounts;
  }
  return fixture;
}

function cloneFixtureWithRollForwardTargets() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  fixture.audit.lnsReplay.rollForwardIterations = 1;
  fixture.audit.lnsReplay.rollForwardRepairTimeLimitSeconds = 0.1;
  for (const split of fixture.lns.splits) {
    split.replay.rollForwardIterations = 1;
    split.replay.rollForwardRepairTimeLimitSeconds = 0.1;
    split.replay.rollForwardLabelCount = split.labelCount;
    for (const benchmarkCase of split.replay.cases) {
      for (const label of benchmarkCase.labels) {
        const finalDelta = label.windowIndex === 2 ? label.improvement + 100 : label.windowIndex === 1 ? 0 : -10;
        label.rollForward = {
          iterations: 1,
          repairTimeLimitSeconds: 0.1,
          seedPopulation: label.totalPopulation,
          totalPopulation: benchmarkCase.incumbentPopulation + finalDelta,
          populationDeltaFromIncumbent: finalDelta,
          populationDeltaFromRepair: finalDelta - label.populationDelta,
          baselineTotalPopulation: benchmarkCase.incumbentPopulation,
          populationDeltaVsBaseline: finalDelta,
          improvementVsBaseline: Math.max(0, finalDelta),
          statusVsBaseline: finalDelta > 0 ? "improved" : finalDelta < 0 ? "regressed" : "neutral"
        };
      }
    }
  }
  return fixture;
}

function cloneFixtureWithFeatureIdenticalRepeatabilityConflict() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const developmentSplit = fixture.lns.splits.find((split) => split.split === "development");
  const sourceCase = developmentSplit.replay.cases[0];
  const conflictCase = JSON.parse(JSON.stringify(sourceCase));
  conflictCase.seed = 19;
  for (const label of conflictCase.labels) {
    label.seed = 19;
    if (label.windowIndex !== 2) continue;
    label.rollForward.totalPopulation = 0;
    label.rollForward.populationDeltaFromIncumbent = -50;
    label.rollForward.populationDeltaFromRepair = -50 - label.populationDelta;
    label.rollForward.populationDeltaVsBaseline = -50;
    label.rollForward.improvementVsBaseline = 0;
    label.rollForward.statusVsBaseline = "regressed";
  }
  developmentSplit.replay.cases.push(conflictCase);
  developmentSplit.replay.caseCount += 1;
  developmentSplit.replay.comparisonCount += 1;
  developmentSplit.replay.stateCount += 1;
  developmentSplit.replay.seeds = [7, 19];
  developmentSplit.replay.seedCount = 2;
  developmentSplit.seeds = [7, 19];
  developmentSplit.labelCount += conflictCase.labels.length;
  developmentSplit.usableLabelCount += conflictCase.labels.length;
  developmentSplit.replay.labelCount += conflictCase.labels.length;
  developmentSplit.replay.rollForwardLabelCount += conflictCase.labels.length;
  fixture.lns.labelCount += conflictCase.labels.length;
  fixture.seeds = [7, 19];
  return fixture;
}

function testLnsWindowRankerExperiment() {
  const fixture = buildFixture();
  const result = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    randomBaselineSeed: 3,
    training: { epochs: 4, learningRate: 0.05, marginWeightCap: 500 }
  });
  const snapshot = createLnsWindowRankerSnapshot(result);
  const formatted = formatLnsWindowRankerExperiment(result);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.audit.cpuOnly, true);
  assert.equal(result.audit.runtimeDefaultChanged, false);
  assert.equal(result.audit.solverDefaultChanged, false);
  assert.equal(result.audit.learnedRuntimeHook, null);
  assert.equal(result.audit.sourceLnsScaleReady, true);
  assert.equal(result.audit.weakSeedReplayLabelsAllowed, true);
  assert.equal(result.model.trained, true);
  assert.equal(result.model.modelType, "lns-window-linear-pairwise-ranker");
  assert.equal(result.model.purpose, "offline-diagnostics-only");
  assert.equal(result.model.topK, 2);
  assert.equal(result.model.training.allowWeakSeedReplayLabels, true);
  assert.equal(result.labels.labelCount, 21);
  assert.equal(result.labels.developmentDecisionCount, 3);
  assert.equal(result.labels.holdoutDecisionCount, 4);
  assert.equal(result.evaluation.summary.passed, true);
  assert.equal(result.evaluation.summary.failedReasons.length, 0);
  assert(result.evaluation.summary.modelHoldoutCaptureRate > result.evaluation.summary.bestBaselineHoldoutCaptureRate);
  assert.equal(result.evaluation.summary.modelHoldoutCaptureRate, 1);
  assert.deepEqual(
    result.evaluation.model.holdout.seedHintMetrics.map((entry) => entry.key),
    ["curated"]
  );
  assert.match(result.datasetFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(result.labelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(result.modelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.training, "wallClockSeconds"), false);
  assert.match(formatted, /CPU-First LNS Window Ranker/);
  assert.match(formatted, /offline diagnostics only/);

  const telemetryManifest = buildLnsWindowRankerTelemetryManifest(result, {
    command: "node dist/lnsWindowRankerCli.js --labels=labels.json",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/lns-window-ranker-test"
    },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      memoryBytes: 16,
      gpuUsed: false
    },
    inputArtifacts: ["artifacts/labels.json"]
  });
  assert.equal(telemetryManifest.source, "model-experiment");
  assert.equal(telemetryManifest.model.trained, true);
  assert.equal(telemetryManifest.model.runtimeDefaultChanged, false);
  assert.equal(telemetryManifest.labelFingerprint, result.labelFingerprint);
  assert.equal(telemetryManifest.metrics.modelHoldoutCaptureRate, 1);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(result, fixture, {
    runId: "lns-window-ranker-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.artifactType, "model-experiment");
  assert.equal(registryDraft.decision, "offline-lns-window-ranker-beats-baselines");
  assert.equal(registryDraft.model.trained, true);
  assert.equal(registryDraft.model.runtimeDefaultChanged, false);
  assert.equal(registryDraft.labelFingerprint, result.labelFingerprint);
  assert.equal(registryDraft.splitStatus.protectedHoldout, true);
  assert.equal(registryDraft.summaryMetrics.modelHoldoutCaptureRate, 1);
  assert.equal(registryDraft.summaryMetrics.weakSeedReplayLabelsAllowed, true);
  const completedRegistryEntry = buildExperimentRegistryEntry(registryDraft, {
    rootDir: path.join(__dirname, "../.."),
    gitMetadata: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/lns-window-ranker-test"
    }
  });
  const registryValidation = validateExperimentRegistryEntry(completedRegistryEntry, {
    rootDir: path.join(__dirname, "../.."),
    validateArtifactPaths: false,
    strict: true
  });
  assert.deepEqual(registryValidation.issues, []);
}

function testLnsWindowRankerRepeatabilityConflictGate() {
  const fixture = cloneFixtureWithFeatureIdenticalRepeatabilityConflict();
  const blocked = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift"
    }
  });
  const filtered = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift",
      excludeFeatureIdenticalRepeatabilityConflicts: true
    }
  });

  assert.equal(blocked.labels.repeatabilitySummary.featureIdenticalConflictBucketCount, 1);
  assert.equal(blocked.labels.repeatabilitySummary.featureIdenticalConflictLabelCount, 2);
  assert.equal(blocked.evaluation.summary.passed, false);
  assert.match(blocked.evaluation.summary.failedReasons.join("; "), /feature-identical conflicts 1 buckets\/2 labels/);
  assert.equal(blocked.labels.excludedFeatureIdenticalRepeatabilityConflictLabelCount, 0);
  assert.equal(filtered.model.training.excludeFeatureIdenticalRepeatabilityConflicts, true);
  assert.equal(filtered.labels.excludedFeatureIdenticalRepeatabilityConflictLabelCount, 2);
  assert.equal(filtered.labels.repeatabilitySummary.featureIdenticalConflictBucketCount, 1);
  assert.doesNotMatch(
    filtered.evaluation.summary.failedReasons.join("; "),
    /feature-identical conflicts 1 buckets\/2 labels/
  );
  assert.match(formatLnsWindowRankerExperiment(filtered), /repeatability-conflicts-excluded=true/);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(filtered, fixture, {
    runId: "lns-window-ranker-repeatability-filter-test",
    commands: [
      "node dist/lnsWindowRankerCli.js --labels=labels.json --roll-forward-final-lift --exclude-repeatability-conflicts"
    ],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingExcludeFeatureIdenticalRepeatabilityConflicts, 1);
  assert.equal(registryDraft.summaryMetrics.excludeFeatureIdenticalRepeatabilityConflicts, true);
  assert.equal(registryDraft.summaryMetrics.excludedFeatureIdenticalRepeatabilityConflictLabelCount, 2);
}

function testLnsWindowRankerWeakReplaySeedFilter() {
  const fixture = cloneFixtureWithWeakReplaySeedCases();
  const defaultResult = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: { epochs: 4, learningRate: 0.05, marginWeightCap: 500 }
  });
  const filteredResult = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      allowWeakSeedReplayLabels: false
    }
  });

  assert.equal(defaultResult.model.training.allowWeakSeedReplayLabels, true);
  assert.equal(filteredResult.model.training.allowWeakSeedReplayLabels, false);
  assert.equal(defaultResult.model.trainedDecisionCount, 3);
  assert.equal(filteredResult.model.trainedDecisionCount, 2);
  assert.equal(defaultResult.labels.holdoutDecisionCount, 4);
  assert.equal(filteredResult.labels.holdoutDecisionCount, 3);
  assert.deepEqual(
    defaultResult.evaluation.model.development.seedHintMetrics.map((entry) => entry.key),
    ["curated", "weak-replay"]
  );
  assert.deepEqual(
    filteredResult.evaluation.model.development.seedHintMetrics.map((entry) => entry.key),
    ["curated"]
  );
  assert.equal(filteredResult.evaluation.baselines[0].development.decisionCount, 2);
  assert.match(formatLnsWindowRankerExperiment(filteredResult), /weak-seed-labels=false/);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(filteredResult, fixture, {
    runId: "lns-window-ranker-weak-seed-filter-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --exclude-weak-replay-seed-labels"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingAllowWeakSeedReplayLabels, 0);
  assert.equal(registryDraft.summaryMetrics.weakSeedReplayLabelsAllowed, false);
}

function buildOnlineScorecardFixture() {
  return {
    caseCount: 1,
    seedCount: 1,
    comparisonCount: 1,
    seeds: [7],
    selectedCaseNames: ["protected-service"],
    variants: ["baseline", "window-ranker"],
    coverage: {
      caseCount: 1,
      seedCount: 1,
      comparisonCount: 1,
      variantCount: 2,
      runCount: 2,
      gridCellCount: 16
    },
    variantSummaries: [],
    cases: [
      {
        name: "protected-service",
        description: "Protected service online fixture",
        pressureFamily: "service-pressure",
        seed: 7,
        gridRows: 4,
        gridCols: 4,
        gridCells: 16,
        baseline: {
          variantName: "baseline",
          seed: 7,
          totalPopulation: 100,
          populationDeltaVsBaseline: 0,
          finalLayoutDeltaVsBaseline: {
            baselineFingerprint: "fnv1a:baseline",
            variantFingerprint: "fnv1a:baseline",
            sameFinalLayout: true,
            roadAddedCount: 0,
            roadRemovedCount: 0,
            roadDeltaCount: 0,
            serviceAddedCount: 0,
            serviceRemovedCount: 0,
            serviceDeltaCount: 0,
            residentialAddedCount: 0,
            residentialRemovedCount: 0,
            residentialDeltaCount: 0,
            buildingDeltaCount: 0,
            placementDeltaCount: 0
          }
        },
        variants: [
          {
            variantName: "baseline",
            seed: 7,
            totalPopulation: 100,
            populationDeltaVsBaseline: 0,
            finalLayoutDeltaVsBaseline: {
              baselineFingerprint: "fnv1a:baseline",
              variantFingerprint: "fnv1a:baseline",
              sameFinalLayout: true,
              roadAddedCount: 0,
              roadRemovedCount: 0,
              roadDeltaCount: 0,
              serviceAddedCount: 0,
              serviceRemovedCount: 0,
              serviceDeltaCount: 0,
              residentialAddedCount: 0,
              residentialRemovedCount: 0,
              residentialDeltaCount: 0,
              buildingDeltaCount: 0,
              placementDeltaCount: 0
            }
          },
          {
            variantName: "window-ranker",
            seed: 7,
            totalPopulation: 100,
            populationDeltaVsBaseline: 0,
            finalLayoutDeltaVsBaseline: {
              baselineFingerprint: "fnv1a:baseline",
              variantFingerprint: "fnv1a:ranker",
              sameFinalLayout: false,
              roadAddedCount: 1,
              roadRemovedCount: 0,
              roadDeltaCount: 1,
              serviceAddedCount: 0,
              serviceRemovedCount: 0,
              serviceDeltaCount: 0,
              residentialAddedCount: 1,
              residentialRemovedCount: 0,
              residentialDeltaCount: 1,
              buildingDeltaCount: 1,
              placementDeltaCount: 2
            },
            selectionDiagnostics: {
              overrideTransitionCounts: { "weak-service->sliding": 1 },
              fallbackTransitionCounts: {},
              overrideChangedWindowCount: 1,
              fallbackChangedWindowCount: 0,
              overrideFeatureDeltaCount: 1,
              fallbackFeatureDeltaCount: 0,
              overrideMeanFeatureDeltas: { selectedByBaseline: -1 },
              fallbackMeanFeatureDeltas: {},
              overrideTransitionFeatureDeltaCounts: { "weak-service->sliding": 1 },
              fallbackTransitionFeatureDeltaCounts: {},
              overrideTransitionMeanFeatureDeltas: { "weak-service->sliding": { selectedByBaseline: -1 } },
              fallbackTransitionMeanFeatureDeltas: {}
            },
            finalOutcome: {
              status: "neutral",
              populationDeltaVsBaseline: 0,
              hasOverride: true,
              hasFallback: false
            },
            selectionTrace: [
              {
                iteration: 0,
                phase: "focused",
                outcomeStatus: "neutral",
                populationBefore: 100,
                populationAfter: 100,
                improvement: 0,
                stagnantIterationsBefore: 0,
                repairTimeLimitSeconds: 0.25,
                appliedOperator: "sliding",
                appliedWindow: { top: 0, left: 1, rows: 2, cols: 2 },
                transition: "weak-service->sliding",
                changedWindow: true,
                selectionStatus: "override",
                candidateCount: 2,
                baselineCandidateIndex: 0,
                selectedCandidateIndex: 1,
                baselineOperator: "weak-service",
                selectedOperator: "sliding",
                baselineWindow: { top: 0, left: 0, rows: 2, cols: 2 },
                selectedWindow: { top: 0, left: 1, rows: 2, cols: 2 },
                selectedByBaseline: false,
                baselineScore: 0.1,
                selectedScore: 0.4,
                scoreDelta: 0.3,
                modelFingerprint: "fnv1a:test",
                featureSchemaVersion: 2,
                baselineFeatures: { selectedByBaseline: 1, residentialCandidateHeadroom: 1.8 },
                selectedFeatures: { selectedByBaseline: 0, residentialCandidateHeadroom: 1 },
                featureDeltas: { selectedByBaseline: -1, residentialCandidateHeadroom: -0.8 }
              }
            ],
            windowRanker: {
              enabled: true,
              modelFingerprint: "fnv1a:test",
              featureSchemaVersion: 2,
              minScoreDelta: 0.1,
              decisions: 1,
              overrides: 1,
              fallbackDecisions: 0,
              overrideRate: 1,
              fallbackRate: 0
            }
          }
        ]
      }
    ],
    generatedAt: "2026-05-05T00:00:00.000Z"
  };
}

function buildOnlineOnlyAnchorScorecardFixture() {
  const scorecard = JSON.parse(JSON.stringify(buildOnlineScorecardFixture()));
  scorecard.selectedCaseNames = ["protected-anchor"];
  scorecard.cases[0].name = "protected-anchor";
  scorecard.cases[0].description = "Protected anchor online fixture";
  scorecard.cases[0].pressureFamily = "anchor-service";
  return scorecard;
}

function buildNeutralSupplementalReplaySnapshot(sourceCase, name, pressureFamily) {
  const benchmarkCase = JSON.parse(JSON.stringify(sourceCase));
  benchmarkCase.name = name;
  benchmarkCase.description = `${name} supplemental replay fixture`;
  benchmarkCase.pressureFamily = pressureFamily;
  benchmarkCase.statePolicy = "online-decision";
  benchmarkCase.stateIndex = 0;
  benchmarkCase.baselineSelectedOperator = "weak-service";
  benchmarkCase.labels = benchmarkCase.labels.map((label) => ({
    ...label,
    caseName: name,
    pressureFamily,
    statePolicy: "online-decision",
    stateIndex: 0,
    rollForward: {
      iterations: 1,
      repairTimeLimitSeconds: 0.1,
      seedPopulation: label.totalPopulation,
      totalPopulation: benchmarkCase.incumbentPopulation,
      populationDeltaFromIncumbent: 0,
      populationDeltaFromRepair: -label.populationDelta,
      baselineTotalPopulation: benchmarkCase.incumbentPopulation,
      populationDeltaVsBaseline: 0,
      improvementVsBaseline: 0,
      statusVsBaseline: "neutral"
    }
  }));
  return {
    schemaVersion: 1,
    caseCount: 1,
    seedCount: 1,
    comparisonCount: 1,
    seeds: [benchmarkCase.seed],
    selectedCaseNames: [benchmarkCase.name],
    pressureFamilies: [benchmarkCase.pressureFamily],
    maxWindows: benchmarkCase.labels.length,
    explorationWindowCount: 0,
    repairTimeLimitSeconds: 1,
    rollForwardIterations: 1,
    rollForwardRepairTimeLimitSeconds: 0.1,
    rollForwardLabelCount: benchmarkCase.labels.length,
    statePolicies: ["online-decision"],
    capturedStatePolicies: ["online-decision"],
    stateCollectionIterations: 4,
    stateCollectionRepairTimeLimitSeconds: 1,
    stateCount: 1,
    featureSchemaVersion: 2,
    cpSatNumWorkers: 1,
    cpSatModelFingerprints: [...new Set(benchmarkCase.labels.map((label) => label.cpSat.modelFingerprint))],
    labelCount: benchmarkCase.labels.length,
    cases: [benchmarkCase]
  };
}

function buildSlidingSelectorModel(model) {
  const slidingSelector = JSON.parse(JSON.stringify(model));
  slidingSelector.weights = Object.fromEntries(slidingSelector.featureNames.map((featureName) => [featureName, 0]));
  slidingSelector.weights.selectedByBaseline = -1;
  slidingSelector.weights.residentialCandidateHeadroom = 1;
  return slidingSelector;
}

function testLnsWindowRankerGapDiagnostics() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const ranker = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift"
    }
  });
  const result = runLnsWindowRankerGapDiagnostics(fixture, ranker.model, buildOnlineScorecardFixture());
  const formatted = formatLnsWindowRankerGapDiagnostics(result);

  assert.equal(result.audit.target, "roll-forward-final-lift");
  assert.equal(result.offline.decisionCount, 7);
  assert.equal(result.online.overrideCount, 1);
  assert.equal(result.online.selectionTraceCount, 1);
  assert.equal(result.online.finalNeutralOverrideCount, 1);
  assert.equal(result.summary.promotionBlocked, true);
  assert.equal(result.summary.offlinePositiveOnlineNeutralCount, 1);
  assert.equal(result.summary.changedLayoutFinalNeutralTraceComparisonCount, 1);
  assert.equal(result.summary.zeroLayoutFinalNeutralTraceComparisonCount, 0);
  assert.equal(result.summary.mixedLayoutFinalNeutralTraceComparisonCount, 0);
  assert.equal(result.summary.traceComparisonLayoutSignatureCounts["changed-layout-final-neutral"], 1);
  assert.equal(result.summary.promotionSensitivity.suppressedTraceComparisonCount, 0);
  assert.equal(result.summary.promotionSensitivity.remainingTraceComparisonCount, 1);
  assert.equal(result.summary.promotionSensitivity.remainingPromotionBlocked, true);
  assert.deepEqual(result.summary.promotionSensitivity.remainingBlockers, ["changed-layout-no-lift-trajectory-depth"]);
  assert.equal(result.summary.promotionSensitivity.protectedReplayEvidenceGate.suppressedTraceComparisonCount, 0);
  assert.equal(result.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingTraceComparisonCount, 1);
  assert.equal(result.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingPromotionBlocked, true);
  assert.deepEqual(result.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingBlockers, [
    "changed-layout-no-lift-trajectory-depth"
  ]);
  assert.equal(result.recommendedExperiments.length, 1);
  assert.equal(result.recommendedExperiments[0].kind, "longer-roll-forward-replay");
  assert.equal(result.recommendedExperiments[0].evidenceStatus, "evidence-backed-blocker");
  assert.equal(result.recommendedExperiments[0].key, "service-pressure:weak-service->sliding");
  const join = result.joins.find((entry) => entry.key === "service-pressure:weak-service->sliding");
  assert.equal(join.diagnosis, "offline-positive-online-neutral");
  assert(join.offline.selectedPositiveCount > 0);
  assert.equal(join.online.finalNeutralCount, 1);
  const traceComparison = result.traceComparisons.find(
    (entry) => entry.key === "service-pressure:weak-service->sliding"
  );
  assert.equal(traceComparison.diagnosis, "offline-positive-online-neutral");
  assert.equal(traceComparison.offlineDecisionCount, 2);
  assert.equal(traceComparison.onlineTraceCount, 1);
  assert.equal(traceComparison.onlineNeutralTraceCount, 1);
  assert.equal(traceComparison.layoutSignature, "changed-layout-final-neutral");
  assert.equal(traceComparison.onlineSameFinalLayoutTraceCount, 0);
  assert.equal(traceComparison.onlineChangedFinalLayoutTraceCount, 1);
  assert.equal(traceComparison.onlineMissingFinalLayoutTraceCount, 0);
  assert.equal(traceComparison.onlineMeanFinalLayoutPlacementDelta, 2);
  assert.equal(traceComparison.onlineMeanImprovement, 0);
  assert.equal(traceComparison.onlineMeanPostSelectionTraceCount, 0);
  assert.equal(traceComparison.onlinePostSelectionImprovementTraceCount, 0);
  assert.equal(traceComparison.onlineMeanFinalPopulationDeltaFromSelectedAfter, 0);
  assert.equal(traceComparison.onlineSamples[0].selectedWindow.left, 1);
  assert.equal(traceComparison.onlineSamples[0].finalLayoutDeltaVsBaseline.placementDeltaCount, 2);
  assert.equal(traceComparison.onlineSamples[0].rankerTrajectoryAfterSelection.postSelectionTraceCount, 0);
  assert(traceComparison.topFeatureDeltaGaps.some((entry) => entry.featureName === "residentialCandidateHeadroom"));
  assert.match(formatted, /offline-positive-online-neutral/);
  assert.match(formatted, /Trace comparisons:/);
  assert.match(formatted, /Layout signatures: changed-layout-final-neutral:1/);
  assert.match(formatted, /Promotion sensitivity: suppress=zero-layout-final-neutral:0 remaining=1/);
  assert.match(formatted, /evidence-gate-suppress=online-active-no-offline-match:0/);
  assert.match(formatted, /online-traces=1/);
  assert.match(formatted, /layout-signature=changed-layout-final-neutral/);
  assert.match(formatted, /online-layout-changed=1/);
  assert.match(formatted, /online-ranker-post-improvements=0/);
  assert.match(formatted, /Recommended experiments:/);
  assert.match(formatted, /longer-roll-forward-replay/);

  const telemetryManifest = buildLnsWindowRankerGapDiagnosticsTelemetryManifest(result, {
    command: "node dist/lnsWindowRankerCli.js --gap-diagnostics",
    inputArtifacts: ["labels.json", "model.json", "scorecard.json"],
    outputArtifacts: ["gap.json"]
  });
  assert.equal(telemetryManifest.metrics.promotionBlocked, true);
  assert.equal(telemetryManifest.metrics.traceComparisonCount, 1);
  assert.equal(telemetryManifest.metrics.traceComparisonOnlineTraceCount, 1);
  assert.equal(telemetryManifest.metrics.traceComparisonChangedFinalLayoutTraceCount, 1);
  assert.equal(telemetryManifest.metrics.traceComparisonPostSelectionImprovementTraceCount, 0);
  assert.equal(telemetryManifest.metrics.recommendedExperimentCount, 1);
  assert.equal(telemetryManifest.metrics.longerRollForwardReplayRecommendationCount, 1);
  assert.equal(telemetryManifest.metrics.targetedProtectedReplayLabelRecommendationCount, 0);
  assert.equal(telemetryManifest.metrics.changedLayoutFinalNeutralTraceComparisonCount, 1);
  assert.equal(telemetryManifest.metrics.zeroLayoutFinalNeutralTraceComparisonCount, 0);
  assert.equal(telemetryManifest.metrics.promotionSensitivity.remainingPromotionBlocked, true);
  assert.deepEqual(telemetryManifest.metrics.promotionSensitivity.remainingBlockers, [
    "changed-layout-no-lift-trajectory-depth"
  ]);
  assert.equal(
    telemetryManifest.metrics.promotionSensitivity.protectedReplayEvidenceGate.remainingPromotionBlocked,
    true
  );
  assert.deepEqual(telemetryManifest.metrics.promotionSensitivity.protectedReplayEvidenceGate.remainingBlockers, [
    "changed-layout-no-lift-trajectory-depth"
  ]);
  assert.equal(telemetryManifest.metrics.traceComparisonLayoutSignatureCounts["changed-layout-final-neutral"], 1);
  assert.equal(telemetryManifest.labelFingerprint, result.inputs.labelFingerprint);

  const registryDraft = buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft(result, {
    runId: "lns-window-ranker-gap-test",
    commands: ["node dist/lnsWindowRankerCli.js --gap-diagnostics"],
    artifactPaths: ["artifacts/gap/lns-window-ranker-gap-diagnostics.json"]
  });
  assert.equal(registryDraft.artifactType, "model-experiment");
  assert.equal(registryDraft.budget.offlinePositiveOnlineNeutralCount, 1);
  assert.equal(registryDraft.budget.traceComparisonCount, 1);
  assert.equal(registryDraft.budget.traceComparisonChangedFinalLayoutTraceCount, 1);
  assert.equal(registryDraft.budget.traceComparisonPostSelectionImprovementTraceCount, 0);
  assert.equal(registryDraft.budget.recommendedExperimentCount, 1);
  assert.equal(registryDraft.budget.longerRollForwardReplayRecommendationCount, 1);
  assert.equal(registryDraft.budget.targetedProtectedReplayLabelRecommendationCount, 0);
  assert.equal(registryDraft.budget.changedLayoutFinalNeutralTraceComparisonCount, 1);
  assert.equal(registryDraft.budget.zeroLayoutFinalNeutralTraceComparisonCount, 0);
  assert.equal(registryDraft.budget.suppressedZeroLayoutFinalNeutralTraceComparisonCount, 0);
  assert.equal(registryDraft.budget.sensitivityRemainingTraceComparisonCount, 1);
  assert.equal(registryDraft.budget.sensitivityRemainingPromotionBlocked, 1);
  assert.equal(registryDraft.budget.protectedReplayEvidenceSuppressedTraceComparisonCount, 0);
  assert.equal(registryDraft.budget.protectedReplayEvidenceRemainingTraceComparisonCount, 1);
  assert.equal(registryDraft.budget.protectedReplayEvidenceRemainingPromotionBlocked, 1);
  assert.equal(registryDraft.summaryMetrics.promotionBlocked, true);

  const zeroLayoutScorecard = JSON.parse(JSON.stringify(buildOnlineScorecardFixture()));
  Object.assign(zeroLayoutScorecard.cases[0].variants[1].finalLayoutDeltaVsBaseline, {
    variantFingerprint: "fnv1a:baseline",
    sameFinalLayout: true,
    roadAddedCount: 0,
    roadRemovedCount: 0,
    roadDeltaCount: 0,
    serviceAddedCount: 0,
    serviceRemovedCount: 0,
    serviceDeltaCount: 0,
    residentialAddedCount: 0,
    residentialRemovedCount: 0,
    residentialDeltaCount: 0,
    buildingDeltaCount: 0,
    placementDeltaCount: 0
  });
  const zeroLayoutResult = runLnsWindowRankerGapDiagnostics(fixture, ranker.model, zeroLayoutScorecard);
  assert.equal(zeroLayoutResult.summary.zeroLayoutFinalNeutralTraceComparisonCount, 1);
  assert.equal(zeroLayoutResult.summary.promotionSensitivity.suppressedTraceComparisonCount, 1);
  assert.equal(zeroLayoutResult.summary.promotionSensitivity.remainingTraceComparisonCount, 0);
  assert.equal(zeroLayoutResult.summary.promotionSensitivity.remainingPromotionBlocked, false);
  assert.deepEqual(zeroLayoutResult.summary.promotionSensitivity.remainingBlockers, []);
  assert.equal(
    zeroLayoutResult.summary.promotionSensitivity.protectedReplayEvidenceGate.suppressedTraceComparisonCount,
    0
  );
  assert.equal(
    zeroLayoutResult.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingTraceComparisonCount,
    0
  );
  assert.equal(
    zeroLayoutResult.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingPromotionBlocked,
    false
  );
  assert.deepEqual(zeroLayoutResult.summary.promotionSensitivity.protectedReplayEvidenceGate.remainingBlockers, []);
  assert.deepEqual(zeroLayoutResult.recommendedExperiments, []);
}

function testLnsWindowRankerGapDiagnosticsSupplementalReplayLabels() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const ranker = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift"
    }
  });
  const model = buildSlidingSelectorModel(ranker.model);
  const onlineScorecard = buildOnlineOnlyAnchorScorecardFixture();
  const baseline = runLnsWindowRankerGapDiagnostics(fixture, model, onlineScorecard);

  assert.equal(baseline.summary.onlineActiveNoOfflineMatchCount, 1);
  assert.equal(baseline.recommendedExperiments.length, 1);
  assert.equal(baseline.recommendedExperiments[0].kind, "targeted-protected-replay-labels");
  assert.equal(baseline.recommendedExperiments[0].key, "anchor-service:weak-service->sliding");

  const holdoutSplit = fixture.lns.splits.find((split) => split.split === "holdout");
  const supplementalReplay = buildNeutralSupplementalReplaySnapshot(
    holdoutSplit.replay.cases[0],
    "protected-anchor-supplemental",
    "anchor-service"
  );
  const result = runLnsWindowRankerGapDiagnostics(fixture, model, onlineScorecard, {
    supplementalReplaySnapshots: [supplementalReplay]
  });
  const formatted = formatLnsWindowRankerGapDiagnostics(result);

  assert.equal(result.audit.supplementalReplaySnapshotCount, 1);
  assert.equal(result.inputs.supplementalReplayFingerprints.length, 1);
  assert.equal(result.offline.supplementalDecisionCount, 1);
  assert.equal(result.summary.onlineActiveNoOfflineMatchCount, 0);
  assert.equal(result.summary.promotionBlocked, false);
  assert.equal(result.traceComparisons.length, 0);
  assert.deepEqual(result.recommendedExperiments, []);
  const join = result.joins.find((entry) => entry.key === "anchor-service:weak-service->sliding");
  assert.equal(join.diagnosis, "offline-neutral-online-neutral");
  assert.equal(join.offline.decisionCount, 1);
  assert.equal(join.offline.selectedPositiveCount, 0);
  assert.match(formatted, /supplemental-replay=1/);
  assert.match(formatted, /Offline: decisions=8 supplemental=1/);

  const conflictBaseline = runLnsWindowRankerGapDiagnostics(fixture, model, buildOnlineScorecardFixture());
  assert.equal(conflictBaseline.summary.offlinePositiveOnlineNeutralCount, 1);
  assert.equal(conflictBaseline.summary.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount, 0);
  assert.equal(conflictBaseline.summary.promotionBlocked, true);

  const neutralizingReplay = buildNeutralSupplementalReplaySnapshot(
    holdoutSplit.replay.cases[0],
    "protected-service-supplemental",
    "service-pressure"
  );
  const neutralized = runLnsWindowRankerGapDiagnostics(fixture, model, buildOnlineScorecardFixture(), {
    supplementalReplaySnapshots: [neutralizingReplay]
  });
  const neutralizedFormatted = formatLnsWindowRankerGapDiagnostics(neutralized);
  const neutralizedJoin = neutralized.joins.find((entry) => entry.key === "service-pressure:weak-service->sliding");
  assert.equal(neutralized.summary.offlinePositiveOnlineNeutralCount, 0);
  assert.equal(neutralized.summary.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount, 1);
  assert.equal(neutralized.summary.promotionBlocked, false);
  assert.equal(neutralized.traceComparisons.length, 0);
  assert.equal(neutralized.recommendedExperiments.length, 0);
  assert.equal(neutralizedJoin.diagnosis, "offline-neutral-online-neutral");
  assert.equal(neutralizedJoin.exactReplayNeutralizedOfflinePositiveOnlineNeutral, true);
  assert(neutralizedJoin.offline.selectedPositiveCount > 0);
  assert.equal(neutralizedJoin.offline.exactOnlineDecisionSupplementalDecisionCount, 1);
  assert.equal(neutralizedJoin.offline.exactOnlineDecisionSupplementalSelectedPositiveCount, 0);
  assert.match(neutralizedFormatted, /exact-replay-neutralized=1/);
  assert.match(neutralizedFormatted, /exact-replay-neutralized=true/);

  const telemetryManifest = buildLnsWindowRankerGapDiagnosticsTelemetryManifest(result, {
    command: "node dist/lnsWindowRankerCli.js --gap-diagnostics --supplemental-replay-labels=supplemental.json",
    inputArtifacts: ["labels.json", "model.json", "scorecard.json", "supplemental.json"],
    outputArtifacts: ["gap.json"]
  });
  assert.equal(telemetryManifest.metrics.offlineSupplementalDecisionCount, 1);
  assert.equal(telemetryManifest.metrics.targetedProtectedReplayLabelRecommendationCount, 0);
  assert.equal(
    buildLnsWindowRankerGapDiagnosticsTelemetryManifest(neutralized, {
      command: "node dist/lnsWindowRankerCli.js --gap-diagnostics --supplemental-replay-labels=supplemental.json",
      inputArtifacts: ["labels.json", "model.json", "scorecard.json", "supplemental.json"],
      outputArtifacts: ["gap.json"]
    }).metrics.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount,
    1
  );

  const registryDraft = buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft(result, {
    runId: "lns-window-ranker-gap-supplemental-test",
    commands: ["node dist/lnsWindowRankerCli.js --gap-diagnostics --supplemental-replay-labels=supplemental.json"],
    artifactPaths: ["artifacts/gap/lns-window-ranker-gap-diagnostics.json"]
  });
  assert.equal(registryDraft.budget.offlineSupplementalDecisionCount, 1);
  assert.equal(registryDraft.budget.targetedProtectedReplayLabelRecommendationCount, 0);
  assert.equal(registryDraft.summaryMetrics.offlineSupplementalDecisionCount, 1);
  const neutralizedRegistryDraft = buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft(neutralized, {
    runId: "lns-window-ranker-gap-neutralized-test",
    commands: ["node dist/lnsWindowRankerCli.js --gap-diagnostics --supplemental-replay-labels=supplemental.json"],
    artifactPaths: ["artifacts/gap/lns-window-ranker-gap-diagnostics.json"]
  });
  assert.equal(neutralizedRegistryDraft.budget.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount, 1);
  assert.equal(neutralizedRegistryDraft.summaryMetrics.exactReplayNeutralizedOfflinePositiveOnlineNeutralCount, 1);
}

function testLnsWindowRankerSupplementalReplayCalibration() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const holdoutSplit = fixture.lns.splits.find((split) => split.split === "holdout");
  const supplementalReplay = buildNeutralSupplementalReplaySnapshot(
    holdoutSplit.replay.cases[0],
    "protected-service-calibration",
    "service-pressure"
  );
  const baseline = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift"
    }
  });
  const calibrated = runLnsWindowRankerExperiment(fixture, {
    supplementalReplaySnapshots: [supplementalReplay],
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift",
      supplementalReplayCalibration: true
    }
  });
  const calibratedIgnoringBaselineFeature = runLnsWindowRankerExperiment(fixture, {
    supplementalReplaySnapshots: [supplementalReplay],
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift",
      supplementalReplayCalibration: true,
      supplementalReplayCalibrationIgnoreBaselineFeature: true
    }
  });
  const formatted = formatLnsWindowRankerExperiment(calibrated);
  const ignoreBaselineFormatted = formatLnsWindowRankerExperiment(calibratedIgnoringBaselineFeature);
  assert.equal(calibrated.audit.supplementalReplayCalibration, true);
  assert.equal(calibrated.audit.supplementalReplaySnapshotCount, 1);
  assert.equal(calibrated.model.training.supplementalReplayCalibration, true);
  assert.equal(calibrated.model.training.supplementalReplayCalibrationIgnoreBaselineFeature, false);
  assert.equal(
    calibratedIgnoringBaselineFeature.model.training.supplementalReplayCalibrationIgnoreBaselineFeature,
    true
  );
  assert.equal(calibrated.labels.supplementalReplayDecisionCount, 1);
  assert.equal(calibrated.labels.supplementalReplayLabelCount, 3);
  assert.equal(calibrated.model.trainedDecisionCount, baseline.model.trainedDecisionCount + 1);
  assert(calibrated.model.trainedPairCount > baseline.model.trainedPairCount);
  assert(calibrated.model.weights.selectedByBaseline > baseline.model.weights.selectedByBaseline);
  assert(
    calibratedIgnoringBaselineFeature.model.weights.selectedByBaseline < calibrated.model.weights.selectedByBaseline
  );
  assert.equal(calibrated.evaluation.summary.passed, false);
  assert(
    calibrated.evaluation.summary.failedReasons.includes(
      "supplemental replay calibration is diagnostics-only and cannot promote a model"
    )
  );
  assert.match(formatted, /supplemental-replay-calibration=true/);
  assert.match(formatted, /supplemental-replay-calibration-ignore-baseline-feature=false/);
  assert.match(ignoreBaselineFormatted, /supplemental-replay-calibration-ignore-baseline-feature=true/);
  assert.match(formatted, /supplemental-decisions=1/);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(calibrated, fixture, {
    runId: "lns-window-ranker-supplemental-calibration-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --supplemental-replay-calibration"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.decision, "offline-lns-window-ranker-insufficient");
  assert.equal(registryDraft.budget.trainingSupplementalReplayCalibration, 1);
  assert.equal(registryDraft.budget.trainingSupplementalReplayCalibrationIgnoreBaselineFeature, 0);
  assert.equal(registryDraft.budget.supplementalReplayDecisionCount, 1);
  assert.equal(registryDraft.budget.supplementalReplayLabelCount, 3);
  assert.equal(registryDraft.summaryMetrics.supplementalReplayCalibration, true);
  assert.equal(registryDraft.summaryMetrics.supplementalReplayCalibrationIgnoreBaselineFeature, false);

  const ignoreBaselineRegistryDraft = buildLnsWindowRankerRegistryEntryDraft(
    calibratedIgnoringBaselineFeature,
    fixture,
    {
      runId: "lns-window-ranker-supplemental-calibration-ignore-baseline-test",
      commands: [
        "node dist/lnsWindowRankerCli.js --labels=labels.json --supplemental-replay-calibration --supplemental-replay-calibration-ignore-baseline-feature"
      ],
      artifactPaths: ["artifacts/lns-ranker/lns-window-ranker-ignore-baseline.json"]
    }
  );
  assert.equal(ignoreBaselineRegistryDraft.budget.trainingSupplementalReplayCalibration, 1);
  assert.equal(ignoreBaselineRegistryDraft.budget.trainingSupplementalReplayCalibrationIgnoreBaselineFeature, 1);
  assert.equal(ignoreBaselineRegistryDraft.summaryMetrics.supplementalReplayCalibrationIgnoreBaselineFeature, true);
}

function testLnsWindowRankerRollForwardTarget() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const result = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-final-lift"
    }
  });

  assert.equal(result.audit.labelTarget, "roll-forward-final-lift");
  assert.equal(result.model.training.target, "roll-forward-final-lift");
  assert.equal(result.labels.usableLabelCount, 21);
  assert.equal(result.labels.opportunityCount, 7);
  assert.equal(result.evaluation.model.holdout.opportunityCount, 4);
  assert.equal(result.evaluation.baselines[0].holdout.opportunityCount, 4);
  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(result, fixture, {
    runId: "lns-window-ranker-roll-forward-target-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --final-lift-target"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingTargetRollForwardFinalLift, 1);
  assert.equal(registryDraft.summaryMetrics.target, "roll-forward-final-lift");
}

function testLnsWindowRankerBaselineTieBreakTraining() {
  const fixture = cloneFixtureWithBaselineReplayTies();
  const defaultResult = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: { epochs: 4, learningRate: 0.05, marginWeightCap: 500 }
  });
  const tieBreakResult = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: { epochs: 4, learningRate: 0.05, marginWeightCap: 500, baselineTieBreak: true }
  });

  assert.equal(defaultResult.model.training.baselineTieBreak, false);
  assert.equal(tieBreakResult.model.training.baselineTieBreak, true);
  assert(tieBreakResult.model.trainedPairCount < defaultResult.model.trainedPairCount);
  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(tieBreakResult, fixture, {
    runId: "lns-window-ranker-baseline-tie-break-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --baseline-tie-break"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingBaselineTieBreak, 1);
}

function testLnsWindowRankerCliArtifacts() {
  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "lnsWindowRankerCli.js");
  const artifactDir = `artifacts/tmp-lns-window-ranker-${process.pid}`;
  const labelsPath = `${artifactDir}/labels.json`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, labelsPath), `${JSON.stringify(buildFixture(), null, 2)}\n`);
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
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

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--ranker-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--labels=<path> is required/);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

testLnsWindowRankerExperiment();
testLnsWindowRankerRepeatabilityConflictGate();
testLnsWindowRankerRollForwardTarget();
testLnsWindowRankerBaselineTieBreakTraining();
testLnsWindowRankerWeakReplaySeedFilter();
testLnsWindowRankerGapDiagnostics();
testLnsWindowRankerGapDiagnosticsSupplementalReplayLabels();
testLnsWindowRankerSupplementalReplayCalibration();
testLnsWindowRankerCliArtifacts();
