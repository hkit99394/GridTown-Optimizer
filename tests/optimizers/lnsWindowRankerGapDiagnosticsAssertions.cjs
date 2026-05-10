const assert = require("node:assert/strict");

const {
  buildLnsWindowRankerGapDiagnosticsRegistryEntryDraft,
  buildLnsWindowRankerGapDiagnosticsTelemetryManifest,
  buildLnsWindowRankerRegistryEntryDraft,
  formatLnsWindowRankerGapDiagnostics,
  formatLnsWindowRankerExperiment,
  runLnsWindowRankerGapDiagnostics,
  runLnsWindowRankerExperiment
} = require("city-builder/benchmarks");
const { cloneFixtureWithRollForwardTargets } = require("./lnsWindowRankerFixtures.cjs");

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

function runLnsWindowRankerGapDiagnosticsAssertions() {
  testLnsWindowRankerGapDiagnostics();
  testLnsWindowRankerGapDiagnosticsSupplementalReplayLabels();
  testLnsWindowRankerSupplementalReplayCalibration();
}

module.exports = { runLnsWindowRankerGapDiagnosticsAssertions };
