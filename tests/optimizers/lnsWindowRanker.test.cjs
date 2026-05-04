const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildExperimentRegistryEntry,
  buildLnsWindowRankerRegistryEntryDraft,
  buildLnsWindowRankerTelemetryManifest,
  createLnsWindowRankerSnapshot,
  formatLnsWindowRankerExperiment,
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
  newlyReachable = 0
}) {
  return {
    windowIndex,
    operatorScore,
    selectedByBaseline,
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
      residentialHeadroom: 900,
      residentialHeadroomCandidate: 900,
      anchorReachable: 4,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 1,
      operatorScore: 2,
      improvement: bestImprovement,
      serviceCandidates: 10,
      residentialHeadroomCandidate: 0,
      anchorReachable: 1,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 2,
      operatorScore: 1,
      improvement: Math.floor(bestImprovement / 4),
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
      operator: "service-anchor",
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
testLnsWindowRankerRollForwardTarget();
testLnsWindowRankerBaselineTieBreakTraining();
testLnsWindowRankerWeakReplaySeedFilter();
testLnsWindowRankerCliArtifacts();
