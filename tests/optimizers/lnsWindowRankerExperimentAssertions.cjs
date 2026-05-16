const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildExperimentRegistryEntry,
  buildLnsWindowRankerRegistryEntryDraft,
  buildLnsWindowRankerTelemetryManifest,
  createLnsWindowRankerSnapshot,
  formatLnsWindowRankerExperiment,
  runLnsWindowRankerBaselineExperiment,
  runLnsWindowRankerExperiment,
  scoreLnsWindowRankerReplayLabel,
  validateExperimentRegistryEntry
} = require("city-builder/benchmarks");
const {
  buildFixture,
  cloneFixtureWithBaselineReplayTies,
  cloneFixtureWithFeatureIdenticalRepeatabilityConflict,
  cloneFixtureWithRollForwardTargets,
  cloneFixtureWithWeakReplaySeedCases
} = require("./lnsWindowRankerFixtures.cjs");

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
  const baselineStallTarget = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      target: "roll-forward-baseline-stall-lift"
    }
  });
  const baselineSweep = runLnsWindowRankerBaselineExperiment(fixture, {
    topK: 2,
    target: "roll-forward-baseline-stall-lift"
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
  assert.equal(baselineStallTarget.model.training.target, "roll-forward-baseline-stall-lift");
  assert.equal(baselineStallTarget.labels.repeatabilitySummary.featureIdenticalConflictBucketCount, 1);
  assert.doesNotMatch(
    baselineStallTarget.evaluation.summary.failedReasons.join("; "),
    /feature-identical conflicts 1 buckets\/2 labels/
  );
  assert.equal(baselineSweep.model.target, "roll-forward-baseline-stall-lift");
  assert.equal(baselineSweep.labels.repeatabilitySummary.featureIdenticalConflictBucketCount, 1);
  assert.doesNotMatch(
    baselineSweep.evaluation.summary.failedReasons.join("; "),
    /feature-identical conflicts 1 buckets\/2 labels/
  );

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
  const baselineStallRegistryDraft = buildLnsWindowRankerRegistryEntryDraft(baselineStallTarget, fixture, {
    runId: "lns-window-ranker-baseline-stall-target-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --baseline-stall-target"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(baselineStallRegistryDraft.budget.trainingTargetRollForwardBaselineStallLift, 1);
  assert.equal(baselineStallRegistryDraft.summaryMetrics.targetRollForwardBaselineStallLift, 1);
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

function testLnsWindowRankerFeatureInteractionTraining() {
  const result = runLnsWindowRankerExperiment(buildFixture(), {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      featureInteractions: true
    }
  });
  const formatted = formatLnsWindowRankerExperiment(result);
  const baseFeatureCount = Object.keys(result.model.weights).length;
  const interactionFeatureCount = Object.keys(result.model.interactionWeights ?? {}).length;

  assert.equal(result.model.training.featureInteractions, true);
  assert(result.model.featureNames.length > baseFeatureCount);
  assert(interactionFeatureCount > 0);
  assert.match(formatted, /feature-interactions=true/);
  assert.match(formatted, /interaction-features=/);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(result, buildFixture(), {
    runId: "lns-window-ranker-feature-interactions-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --feature-interactions"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingFeatureInteractions, 1);
  assert.equal(registryDraft.budget.interactionFeatureCount, interactionFeatureCount);
  assert.equal(registryDraft.summaryMetrics.featureInteractions, true);
  assert.equal(registryDraft.summaryMetrics.interactionFeatureCount, interactionFeatureCount);
}

function testLnsWindowRankerTrajectoryFeatureTraining() {
  const result = runLnsWindowRankerExperiment(buildFixture(), {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500,
      trajectoryFeatures: true
    }
  });
  const formatted = formatLnsWindowRankerExperiment(result);
  const trajectoryFeatureCount = result.model.featureNames.filter(
    (featureName) =>
      featureName.startsWith("baselineOperator") ||
      featureName.startsWith("selectedOperator") ||
      featureName.startsWith("transition")
  ).length;

  assert.equal(result.model.training.trajectoryFeatures, true);
  assert.equal(result.model.featureSchemaVersion, 3);
  assert(trajectoryFeatureCount > 0);
  assert.equal(result.model.featureNames.includes("baselineOperatorWeakService"), true);
  assert.equal(result.model.featureNames.includes("selectedOperatorServiceOverlap"), true);
  assert.equal(result.model.featureNames.includes("transitionWeakServiceToServiceOverlap"), true);
  assert.equal(Object.hasOwn(result.model.weights, "transitionWeakServiceToServiceOverlap"), true);
  assert.match(formatted, /trajectory-features=true/);

  const registryDraft = buildLnsWindowRankerRegistryEntryDraft(result, buildFixture(), {
    runId: "lns-window-ranker-trajectory-features-test",
    commands: ["node dist/lnsWindowRankerCli.js --labels=labels.json --trajectory-features"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker.json"]
  });
  assert.equal(registryDraft.budget.trainingTrajectoryFeatures, 1);
  assert.equal(registryDraft.budget.trajectoryFeatureCount, trajectoryFeatureCount);
  assert.equal(registryDraft.summaryMetrics.trajectoryFeatures, true);
  assert.equal(registryDraft.summaryMetrics.trajectoryFeatureCount, trajectoryFeatureCount);
}

function testLnsWindowRankerModelSchemaValidation() {
  const fixture = buildFixture();
  const result = runLnsWindowRankerExperiment(fixture, {
    topK: 2,
    training: {
      epochs: 4,
      learningRate: 0.05,
      marginWeightCap: 500
    }
  });
  const label = fixture.lns.splits[0].replay.cases[0].labels[0];

  assert.throws(
    () =>
      scoreLnsWindowRankerReplayLabel(label, {
        ...result.model,
        weights: { ...result.model.weights, selectedByBasline: 1 }
      }),
    /LNS window ranker model\.weights\.selectedByBasline must be one of the LNS window ranker feature names/
  );

  assert.throws(
    () =>
      scoreLnsWindowRankerReplayLabel(label, {
        ...result.model,
        interactionWeights: { "selectedByBaseline*notAFeature": 1 }
      }),
    /LNS window ranker model\.interactionWeights keys must be pairwise feature names/
  );

  const score = scoreLnsWindowRankerReplayLabel(label, {
    ...result.model,
    featureNames: [...result.model.featureNames, "selectedByBaseline*selectedByBaseline"],
    interactionWeights: { "selectedByBaseline*selectedByBaseline": -1 }
  });
  assert.equal(typeof score, "number");
  assert.equal(Number.isFinite(score), true);
}

function runLnsWindowRankerExperimentAssertions() {
  testLnsWindowRankerExperiment();
  testLnsWindowRankerRepeatabilityConflictGate();
  testLnsWindowRankerRollForwardTarget();
  testLnsWindowRankerBaselineTieBreakTraining();
  testLnsWindowRankerWeakReplaySeedFilter();
  testLnsWindowRankerFeatureInteractionTraining();
  testLnsWindowRankerTrajectoryFeatureTraining();
  testLnsWindowRankerModelSchemaValidation();
}

module.exports = { runLnsWindowRankerExperimentAssertions };
