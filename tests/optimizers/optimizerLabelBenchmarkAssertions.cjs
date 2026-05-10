const {
  assert,
  childProcess,
  fs,
  path,
  buildExperimentRegistryEntry,
  buildLearnedRankingLabelFingerprint,
  buildLearnedRankingLabelRegistryEntryDraft,
  buildLearnedRankingLabelTelemetryManifest,
  buildLnsReplayLabelScaleReadiness,
  buildGreedyOfflineRankerRegistryEntryDraft,
  buildGreedyOfflineRankerTelemetryManifest,
  buildLnsWindowRankerBaselineRegistryEntryDraft,
  buildLnsWindowRankerBaselineTelemetryManifest,
  collectGreedyOrderingLabelsFromBenchmarkSuite,
  createGreedyOfflineRankerSnapshot,
  createLearnedRankingLabelSnapshot,
  createLnsWindowRankerBaselineSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
  STRICT_LNS_REPLAY_LABEL_PRESET,
  STRICT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  STRICT_LNS_REPLAY_LABEL_SEEDS,
  STRICT_LNS_REPLAY_LABEL_STATE_POLICIES,
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  createGreedyConnectivityShadowOrderingLabelSnapshot,
  DEFAULT_LNS_BENCHMARK_CORPUS,
  formatGreedyConnectivityShadowOrderingLabels,
  formatGreedyOfflineRankerExperiment,
  formatLearnedRankingLabelSuite,
  formatLnsWindowRankerBaselineExperiment,
  listGreedyConnectivityShadowOrderingLabelCaseNames,
  runGreedyConnectivityShadowOrderingLabels,
  runGreedyOfflineRankerExperiment,
  runLearnedRankingLabelSuite,
  runLnsWindowRankerBaselineExperiment,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  validateExperimentRegistryEntry
} = require("./optimizerHarnessDeps.cjs");

function testGreedyConnectivityShadowOrderingLabelRunner() {
  const labelCase = {
    name: "shadow-label-fixture",
    description: "Small fixture for connectivity-shadow ordering labels.",
    grid: [
      [0, 1, 1],
      [0, 1, 0],
      [1, 0, 0]
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
      greedy: {
        localSearch: false,
        restarts: 1,
        serviceRefineIterations: 0,
        exhaustiveServiceSearch: false
      }
    }
  };

  const result = runGreedyConnectivityShadowOrderingLabels([labelCase], {
    seeds: [7],
    maxLabelsPerCase: 1
  });
  const repeatedSnapshot = createGreedyConnectivityShadowOrderingLabelSnapshot(
    runGreedyConnectivityShadowOrderingLabels([labelCase], {
      seeds: [7],
      maxLabelsPerCase: 1
    })
  );
  const snapshot = createGreedyConnectivityShadowOrderingLabelSnapshot(result);
  const formatted = formatGreedyConnectivityShadowOrderingLabels(result);
  const benchmarkCase = result.cases[0];
  const label = benchmarkCase.labels[0];

  assert.equal(listGreedyConnectivityShadowOrderingLabelCaseNames().includes("row0-corridor-repair-pressure"), true);
  assert.equal(result.caseCount, 1);
  assert.equal(result.seedCount, 1);
  assert.equal(result.comparisonCount, 1);
  assert.deepEqual(result.seeds, [7]);
  assert.deepEqual(result.selectedCaseNames, ["shadow-label-fixture"]);
  assert.equal(result.maxLabelsPerCase, 1);
  assert.equal(result.labelCount, 1);
  assert.equal(benchmarkCase.seed, 7);
  assert.equal(benchmarkCase.traceCount >= 1, true);
  assert.equal(benchmarkCase.labelCount, 1);
  assert.equal(benchmarkCase.greedyOptions.connectivityShadowScoring, true);
  assert.equal(benchmarkCase.greedyOptions.profile, true);
  assert.equal(benchmarkCase.greedyOptions.randomSeed, 7);
  assert.equal(label.caseName, "shadow-label-fixture");
  assert.equal(label.seed, 7);
  assert.equal(label.labelIndex, 0);
  assert.equal(label.phase, "residential");
  assert.equal(label.score, 10);
  assert.equal(label.preferred, "candidate");
  assert.equal(label.shadowPenaltyMargin, Math.abs(label.features.shadowPenaltyDelta));
  assert.equal(label.features.shadowPenaltyDelta < 0, true);
  assert.equal(label.features.roadCostDelta, 0);
  assert.deepEqual(label.chosen, label.candidate);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.deepEqual(repeatedSnapshot, snapshot);
  assert.match(formatted, /=== Greedy Connectivity-Shadow Ordering Labels ===/);
  assert.match(formatted, /preferred=candidate/);
}

function testLearnedRankingLabelSuite() {
  const greedyFixtureSuite = {
    generatedAt: "2026-04-27T00:00:00.000Z",
    caseCount: 1,
    selectedCaseNames: ["label-fixture"],
    results: [
      {
        name: "label-fixture",
        description: "Synthetic profile label fixture.",
        gridRows: 3,
        gridCols: 3,
        totalPopulation: 10,
        roadCount: 1,
        serviceCount: 0,
        residentialCount: 1,
        greedyOptions: {},
        progressSummary: {},
        wallClockSeconds: 0,
        greedyProfile: {
          connectivityShadowDecisions: [
            {
              phase: "residential",
              score: 10,
              candidate: { r: 0, c: 1, rows: 1, cols: 1, roadCost: 0, typeIndex: 0 },
              incumbent: { r: 1, c: 1, rows: 1, cols: 1, roadCost: 1, typeIndex: 0 },
              chosen: { r: 0, c: 1, rows: 1, cols: 1, roadCost: 0, typeIndex: 0 },
              rejected: { r: 1, c: 1, rows: 1, cols: 1, roadCost: 1, typeIndex: 0 },
              candidateShadowPenalty: 1,
              incumbentShadowPenalty: 5
            }
          ],
          roadOpportunityTraces: [
            {
              phase: "residential",
              r: 0,
              c: 1,
              rows: 1,
              cols: 1,
              roadCost: 0,
              score: 10,
              reachableBefore: 3,
              reachableAfter: 2,
              lostCells: 1,
              footprintCells: 1,
              disconnectedCells: 0,
              typeIndex: 0,
              counterfactuals: [
                {
                  reason: "same-score-tie",
                  r: 1,
                  c: 1,
                  rows: 1,
                  cols: 1,
                  roadCost: 1,
                  score: 10,
                  scoreDelta: 0,
                  roadCostDelta: 1,
                  reachableBefore: 3,
                  reachableAfter: 1,
                  lostCells: 2,
                  footprintCells: 1,
                  disconnectedCells: 1,
                  typeIndex: 0
                }
              ]
            }
          ]
        }
      }
    ]
  };
  const orderingLabels = collectGreedyOrderingLabelsFromBenchmarkSuite(greedyFixtureSuite, "development", 7);

  assert.equal(DEFAULT_LEARNED_RANKING_LABEL_SPLITS.length, 2);
  assert.equal(orderingLabels.length, 2);
  assert.equal(orderingLabels[0].source, "connectivity-shadow-decision");
  assert.equal(orderingLabels[0].target, "lower-connectivity-shadow");
  assert.equal(orderingLabels[0].margin, 4);
  assert.equal(orderingLabels[1].source, "road-opportunity-counterfactual");
  assert.equal(orderingLabels[1].target, "accepted-near-miss");
  assert.equal(orderingLabels[1].margin, 1);

  const learnedLabelSplitConfigs = [
    {
      split: "development",
      greedyCaseNames: ["typed-housing-baseline"],
      lnsCaseNames: ["seeded-service-anchor-pressure"]
    },
    {
      split: "holdout",
      greedyCaseNames: ["deterministic-tie-breaks"],
      lnsCaseNames: ["row0-anchor-repair"]
    }
  ];
  const result = runLearnedRankingLabelSuite({
    seeds: [7],
    splitConfigs: learnedLabelSplitConfigs,
    greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    maxWindows: 1,
    explorationWindowCount: 0,
    repairTimeLimitSeconds: 0.1
  });
  const snapshot = createLearnedRankingLabelSnapshot(result);
  const formatted = formatLearnedRankingLabelSuite(result);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.audit.learnedModel, null);
  assert.equal(result.audit.lnsReplay.preset, null);
  assert.equal(result.audit.lnsReplay.cpSatNumWorkers, 1);
  assert.equal(result.audit.lnsReplay.featureSchemaVersion, 2);
  assert.equal(result.audit.lnsReplay.incumbentStatePolicy, "initial-incumbent");
  assert.deepEqual(result.audit.lnsReplay.incumbentStatePolicies, ["initial-incumbent"]);
  assert.equal(result.audit.lnsReplay.stateCollectionIterations, 4);
  assert.equal(result.audit.lnsReplay.stateCollectionRepairTimeLimitSeconds, 0.1);
  assert.equal(result.leakage.protectedHoldout, true);
  assert.deepEqual(result.leakage.greedyOverlap, []);
  assert.deepEqual(result.leakage.lnsOverlap, []);
  assert.equal(result.lns.labelCount, 2);
  assert.equal(result.lns.splits[0].usableLabelCount >= 0, true);
  assert.equal(result.lns.splits[0].replay.schemaVersion, 1);
  assert.equal(result.lns.splits[0].replay.featureSchemaVersion, 2);
  assert.equal(result.lns.splits[0].replay.cpSatNumWorkers, 1);
  assert.deepEqual(result.lns.splits[0].replay.statePolicies, ["initial-incumbent"]);
  assert.deepEqual(result.lns.splits[0].replay.capturedStatePolicies, ["initial-incumbent"]);
  assert.equal(result.lns.splits[0].replay.stateCollectionIterations, 4);
  assert.equal(result.lns.splits[0].replay.stateCollectionRepairTimeLimitSeconds, 0.1);
  assert.equal(result.lns.splits[0].replay.stateCount, 1);
  assert.equal(result.lns.splits[0].replay.cpSatModelFingerprints.length, 1);
  assert.deepEqual(result.lns.splits[0].pressureFamilies, ["anchor-service"]);
  assert.deepEqual(result.lns.splits[0].replay.pressureFamilies, ["anchor-service"]);
  assert.equal(result.lns.splits[0].replay.explorationWindowCount, 0);
  assert.equal(result.lns.splits[0].replay.cases[0].pressureFamily, "anchor-service");
  assert.equal(result.lns.splits[0].replay.cases[0].statePolicy, "initial-incumbent");
  assert.equal(typeof result.lns.splits[0].replay.cases[0].labels[0].usable, "boolean");
  assert.equal(result.lns.splits[0].replay.cases[0].labels[0].pressureFamily, "anchor-service");
  assert.equal(typeof result.lns.splits[0].replay.cases[0].labels[0].operator, "string");
  assert.equal(typeof result.lns.splits[0].replay.cases[0].labels[0].operatorScore, "number");
  assert.equal(result.lns.splits[0].replay.cases[0].labels[0].selectionSource, "baseline-top-k");
  assert.equal(result.lns.scaleReadiness.passed, false);
  assert.equal(
    result.lns.scaleReadiness.thresholds.minPressureFamilies,
    DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS.minPressureFamilies
  );
  assert.deepEqual(result.lns.scaleReadiness.thresholds.requiredStatePolicies, []);
  assert.deepEqual(result.lns.scaleReadiness.splitReadiness[0].capturedStatePolicies, ["initial-incumbent"]);
  assert.deepEqual(result.lns.scaleReadiness.splitReadiness[0].missingStatePolicies, []);
  assert.deepEqual(result.lns.scaleReadiness.splitReadiness[0].families[0].capturedStatePolicies, [
    "initial-incumbent"
  ]);
  assert.deepEqual(result.lns.scaleReadiness.splitReadiness[0].families[0].missingStatePolicies, []);
  assert.equal(result.lns.scaleReadiness.splitReadiness[0].failedReasons.length > 0, true);
  assert.equal(
    buildLnsReplayLabelScaleReadiness(result.lns.splits, {
      minPressureFamilies: 1,
      minSeedsPerFamily: 1,
      minUsableLabelsPerSplit: 0,
      minNonNeutralLabelsPerSplit: 0,
      minUsableLabelsPerFamily: 0,
      maxNeutralLabelRatio: 1
    }).passed,
    true
  );
  const familyStateReadiness = buildLnsReplayLabelScaleReadiness(
    [
      {
        split: "development",
        seeds: [7],
        replay: {
          cases: [
            {
              name: "anchor-initial",
              pressureFamily: "anchor-service",
              seed: 7,
              statePolicy: "initial-incumbent",
              labels: [{ status: "improved", usable: true }]
            },
            {
              name: "gate-first",
              pressureFamily: "gate",
              seed: 7,
              statePolicy: "post-first-improvement",
              labels: [{ status: "improved", usable: true }]
            }
          ]
        }
      }
    ],
    {
      minPressureFamilies: 2,
      minSeedsPerFamily: 1,
      minUsableLabelsPerSplit: 0,
      minNonNeutralLabelsPerSplit: 0,
      minUsableLabelsPerFamily: 0,
      maxNeutralLabelRatio: 1,
      requiredStatePolicies: ["initial-incumbent", "post-first-improvement"]
    }
  );
  assert.equal(familyStateReadiness.passed, false);
  assert.deepEqual(familyStateReadiness.splitReadiness[0].missingStatePolicies, []);
  assert.deepEqual(
    familyStateReadiness.splitReadiness[0].families.find((family) => family.pressureFamily === "anchor-service")
      .missingStatePolicies,
    ["post-first-improvement"]
  );
  assert.equal(
    familyStateReadiness.splitReadiness[0].failedReasons.includes(
      "anchor-service state-policies missing:post-first-improvement"
    ),
    true
  );
  assert.equal(buildLnsReplayLabelScaleReadiness([]).passed, false);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(snapshot.lns.scaleReadiness.passed, false);
  assert.match(formatted, /Low-Risk Learned Ranking Labels/);
  assert.match(formatted, /protected-holdout=true/);
  assert.match(formatted, /learned-model=none/);
  assert.match(formatted, /lns-preset=none/);
  assert.match(formatted, /lns-feature-schema=2/);
  assert.match(formatted, /LNS label-scale ready=false/);

  const strictPresetResult = runLearnedRankingLabelSuite({
    preset: STRICT_LNS_REPLAY_LABEL_PRESET,
    seeds: [7],
    splitConfigs: learnedLabelSplitConfigs,
    greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    maxWindows: 1,
    explorationWindowCount: 0,
    repairTimeLimitSeconds: 0.1,
    lnsStateCollectionIterations: 2
  });
  assert.deepEqual(STRICT_LNS_REPLAY_LABEL_SEEDS, DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS);
  assert.deepEqual(STRICT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS.requiredStatePolicies, [
    ...STRICT_LNS_REPLAY_LABEL_STATE_POLICIES
  ]);
  assert.equal(strictPresetResult.audit.lnsReplay.preset, STRICT_LNS_REPLAY_LABEL_PRESET);
  assert.deepEqual(strictPresetResult.audit.lnsReplay.incumbentStatePolicies, [
    ...STRICT_LNS_REPLAY_LABEL_STATE_POLICIES
  ]);
  assert.deepEqual(strictPresetResult.lns.splits[0].replay.statePolicies, [...STRICT_LNS_REPLAY_LABEL_STATE_POLICIES]);
  assert.deepEqual(strictPresetResult.lns.scaleReadiness.thresholds.requiredStatePolicies, [
    ...STRICT_LNS_REPLAY_LABEL_STATE_POLICIES
  ]);
  assert.equal(
    strictPresetResult.lns.scaleReadiness.splitReadiness[0].capturedStatePolicies.includes("initial-incumbent"),
    true
  );
  assert.equal(strictPresetResult.audit.lnsReplay.stateCollectionIterations, 2);

  const labelFingerprint = buildLearnedRankingLabelFingerprint(result);
  const labelTelemetryManifest = buildLearnedRankingLabelTelemetryManifest(result, {
    command: "node dist/learnedRankingLabelCli.js --json",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/label-telemetry-test"
    },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      memoryBytes: 16,
      gpuUsed: false
    }
  });
  assert.match(labelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(labelTelemetryManifest.source, "learned-ranking-label-bundle");
  assert.equal(labelTelemetryManifest.labelFingerprint, labelFingerprint);
  assert.equal(labelTelemetryManifest.audit.lnsReplay.preset, null);
  assert.equal(labelTelemetryManifest.suite.totalLabels, result.greedy.labelCount + result.lns.labelCount);
  assert.equal(labelTelemetryManifest.suite.protectedHoldout, true);
  assert.deepEqual(labelTelemetryManifest.lns.splits[0].statePolicies, ["initial-incumbent"]);
  assert.deepEqual(labelTelemetryManifest.lns.splits[0].capturedStatePolicies, ["initial-incumbent"]);
  assert.equal(labelTelemetryManifest.lns.splits[0].stateCount, 1);
  assert.equal(
    Object.values(labelTelemetryManifest.lns.statusCounts).reduce((sum, count) => sum + count, 0),
    result.lns.labelCount
  );
  const labelRegistryDraft = buildLearnedRankingLabelRegistryEntryDraft(result, {
    runId: "learned-label-test",
    commands: ["node dist/learnedRankingLabelCli.js --json"],
    artifactPaths: ["artifacts/labels/labels.json", "artifacts/labels/telemetry-manifest.json"]
  });
  assert.equal(labelRegistryDraft.artifactType, "label-bundle");
  assert.deepEqual(labelRegistryDraft.cases.development, ["seeded-service-anchor-pressure", "typed-housing-baseline"]);
  assert.equal(labelRegistryDraft.model.trained, false);
  assert.equal(labelRegistryDraft.labelFingerprint, labelFingerprint);
  assert.equal(labelRegistryDraft.budget.lnsFeatureSchemaVersion, 2);
  assert.equal(labelRegistryDraft.budget.lnsPresetApplied, 0);
  assert.equal(labelRegistryDraft.budget.lnsStatePolicyCount, 1);
  assert.equal(labelRegistryDraft.budget.lnsCapturedStatePolicyCount, 1);
  assert.deepEqual(labelRegistryDraft.budget.lnsStateCollectionIterations, [4]);
  assert.deepEqual(labelRegistryDraft.budget.lnsStateCollectionRepairTimeLimitSeconds, [0.1]);
  assert.deepEqual(labelRegistryDraft.budget.lnsCpSatNumWorkers, [1]);
  assert.deepEqual(labelRegistryDraft.summaryMetrics.lnsStatePolicies, ["initial-incumbent"]);
  assert.deepEqual(labelRegistryDraft.summaryMetrics.lnsCapturedStatePolicies, ["initial-incumbent"]);
  assert.equal(labelRegistryDraft.summaryMetrics.lnsReplayPreset, null);
  assert.equal(labelRegistryDraft.cpSatModelFingerprints.length > 0, true);
  assert.match(labelRegistryDraft.inputFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  const completedLabelRegistryEntry = buildExperimentRegistryEntry(labelRegistryDraft, {
    rootDir: path.join(__dirname, "../.."),
    gitMetadata: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/label-telemetry-test"
    }
  });
  const labelRegistryValidation = validateExperimentRegistryEntry(completedLabelRegistryEntry, {
    rootDir: path.join(__dirname, "../.."),
    validateArtifactPaths: false,
    strict: true
  });
  assert.deepEqual(labelRegistryValidation.issues, []);

  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "learnedRankingLabelCli.js");
  const artifactDir = `artifacts/tmp-learned-ranking-label-artifacts-${process.pid}`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${artifactDir}`,
        "--seeds=7",
        "--max-windows=1",
        "--repair-time=0.1",
        "--label-run-id=tmp-learned-ranking-label-artifact-test",
        "--label-register-dry-run",
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
    assert.equal(artifactManifest.runId, "tmp-learned-ranking-label-artifact-test");
    assert.equal(artifactManifest.registry.appended, false);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.labelsJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.labelsText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson)), true);
    const labelsArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.labelsJson), "utf8")
    );
    const telemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    const draftArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson), "utf8")
    );
    assert.equal(Object.hasOwn(labelsArtifact, "generatedAt"), false);
    assert.equal(telemetryArtifact.source, "learned-ranking-label-bundle");
    assert.equal(telemetryArtifact.labelFingerprint, artifactManifest.labelFingerprint);
    assert.equal(telemetryArtifact.audit.lnsReplay.featureSchemaVersion, 2);
    assert.match(telemetryArtifact.command, /--artifact-dir=artifacts\/tmp-learned-ranking-label-artifacts-/);
    assert.equal(draftArtifact.artifactType, "label-bundle");
    assert.equal(draftArtifact.model.trained, false);
    assert.equal(draftArtifact.labelFingerprint, artifactManifest.labelFingerprint);

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--label-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--label-register-dry-run requires --artifact-dir/);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }

  assert.throws(
    () =>
      runLearnedRankingLabelSuite({
        splitConfigs: [
          {
            split: "development",
            greedyCaseNames: ["typed-housing-baseline"],
            lnsCaseNames: ["typed-housing-single"]
          },
          {
            split: "holdout",
            greedyCaseNames: ["typed-housing-baseline"],
            lnsCaseNames: ["row0-anchor-repair"]
          }
        ],
        greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
        lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS
      }),
    /development\/holdout split overlap is not allowed/
  );
}

function testGreedyOfflineRankerExperiment() {
  const result = runGreedyOfflineRankerExperiment({
    seeds: [7],
    training: {
      epochs: 8
    }
  });
  const snapshot = createGreedyOfflineRankerSnapshot(result);
  const formatted = formatGreedyOfflineRankerExperiment(result);
  const deterministicBaseline = result.evaluation.baselines.find((entry) => entry.name === "deterministic-proxy");
  const randomBaseline = result.evaluation.baselines.find((entry) => entry.name === "stable-random");
  const singleFeatureBaseline = result.evaluation.baselines.find((entry) => entry.name === "best-single-feature");

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.audit.cpuOnly, true);
  assert.equal(result.audit.runtimeDefaultChanged, false);
  assert.equal(result.audit.solverDefaultChanged, false);
  assert.equal(result.audit.usesCaseNameFeature, false);
  assert.equal(result.leakage.protectedHoldout, true);
  assert.deepEqual(result.leakage.greedyOverlap, []);
  assert.equal(result.labels.labelCount, 1559);
  assert.equal(result.evaluation.model.development.labelCount, 646);
  assert.equal(result.evaluation.model.holdout.labelCount, 913);
  assert.equal(result.model.modelType, "greedy-linear-pairwise-perceptron");
  assert.equal(result.model.purpose, "offline-diagnostics-only");
  assert.equal(result.model.intercept, 0);
  assert.equal(result.model.trainedLabelCount, result.evaluation.model.development.labelCount);
  assert.equal(result.model.featureNames.includes("lowerShadowPenalty"), true);
  assert.equal(result.evaluation.summary.passed, true);
  assert.equal(result.evaluation.summary.bestBaselineName, "deterministic-proxy");
  assert.equal(result.evaluation.model.holdout.accuracy > deterministicBaseline.holdout.accuracy, true);
  assert.equal(result.evaluation.model.holdout.accuracy > randomBaseline.holdout.accuracy, true);
  assert.equal(result.evaluation.model.holdout.accuracy > singleFeatureBaseline.holdout.accuracy, true);
  assert.equal(singleFeatureBaseline.selectedFeatureName, "lowerShadowPenalty");
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.training, "wallClockSeconds"), false);
  assert.match(result.datasetFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(result.modelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(formatted, /CPU-First Greedy Offline Ranker/);
  assert.match(formatted, /Gate: passed=true/);
  assert.match(formatted, /offline diagnostics only/);

  const telemetryManifest = buildGreedyOfflineRankerTelemetryManifest(result, {
    command: "node dist/greedyOfflineRankerCli.js --seeds=7 --epochs=8",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/greedy-offline-ranker-test"
    },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      memoryBytes: 16,
      gpuUsed: false
    }
  });
  assert.equal(telemetryManifest.source, "model-experiment");
  assert.equal(telemetryManifest.model.trained, true);
  assert.equal(telemetryManifest.datasetFingerprint, result.datasetFingerprint);
  assert.equal(telemetryManifest.modelFingerprint, result.modelFingerprint);
  assert.equal(telemetryManifest.metrics.holdoutModelAccuracy, result.evaluation.model.holdout.accuracy);

  const registryDraft = buildGreedyOfflineRankerRegistryEntryDraft(result, {
    runId: "greedy-offline-ranker-test",
    commands: ["node dist/greedyOfflineRankerCli.js --seeds=7 --epochs=8"],
    artifactPaths: ["artifacts/greedy-ranker/model.json", "artifacts/greedy-ranker/telemetry-manifest.json"]
  });
  assert.equal(registryDraft.artifactType, "model-experiment");
  assert.equal(registryDraft.decision, "offline-greedy-ranker-beats-baselines");
  assert.equal(registryDraft.model.trained, true);
  assert.equal(registryDraft.splitStatus.protectedHoldout, true);
  assert.equal(registryDraft.summaryMetrics.holdoutModelAccuracy, result.evaluation.model.holdout.accuracy);
  const completedRegistryEntry = buildExperimentRegistryEntry(registryDraft, {
    rootDir: path.join(__dirname, "../.."),
    gitMetadata: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/greedy-offline-ranker-test"
    }
  });
  const registryValidation = validateExperimentRegistryEntry(completedRegistryEntry, {
    rootDir: path.join(__dirname, "../.."),
    validateArtifactPaths: false,
    strict: true
  });
  assert.deepEqual(registryValidation.issues, []);

  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "greedyOfflineRankerCli.js");
  const artifactDir = `artifacts/tmp-greedy-offline-ranker-${process.pid}`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${artifactDir}`,
        "--seeds=7",
        "--epochs=8",
        "--ranker-run-id=tmp-greedy-offline-ranker-test",
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
    assert.equal(artifactManifest.runId, "tmp-greedy-offline-ranker-test");
    assert.equal(artifactManifest.passed, true);
    assert.equal(artifactManifest.registry.appended, false);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson)), true);
    const modelArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson), "utf8")
    );
    const telemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    const draftArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson), "utf8")
    );
    assert.equal(modelArtifact.trained, true);
    assert.equal(telemetryArtifact.source, "model-experiment");
    assert.equal(telemetryArtifact.modelFingerprint, artifactManifest.modelFingerprint);
    assert.match(telemetryArtifact.command, /--artifact-dir=artifacts\/tmp-greedy-offline-ranker-/);
    assert.equal(draftArtifact.artifactType, "model-experiment");
    assert.equal(draftArtifact.model.trained, true);
    assert.equal(draftArtifact.modelFingerprint, artifactManifest.modelFingerprint);

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--ranker-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--ranker-register-dry-run requires --artifact-dir/);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

function buildLnsWindowRankerBaselineLabel({
  windowIndex,
  operatorScore,
  improvement,
  selectedByBaseline = false,
  candidateLoss = 0,
  residentialHeadroom = 0,
  serviceBonus = 0,
  newlyReachable = 0,
  anchorReachable = 0
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
        serviceCandidatesIntersectingWindow: candidateLoss,
        residentialCandidatesIntersectingWindow: candidateLoss,
        serviceCandidatesBlockedByIncumbent: 0,
        residentialCandidatesBlockedByIncumbent: 0,
        serviceCandidateBonusInside: candidateLoss * 10,
        maxServiceCandidateBonusInside: candidateLoss * 10,
        residentialCandidateHeadroomInside: candidateLoss * 20,
        serviceTypeCounts: {},
        residentialTypeCounts: {}
      }
    }
  };
}

function buildLnsWindowRankerBaselineCase(name, split, pressureFamily, labels) {
  return {
    name,
    description: `${name} replay fixture`,
    pressureFamily,
    seed: 7,
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

function buildLnsWindowRankerBaselineFixture() {
  const developmentCases = [
    buildLnsWindowRankerBaselineCase("dev-service", "development", "service-pressure", [
      buildLnsWindowRankerBaselineLabel({
        windowIndex: 0,
        operatorScore: 10,
        improvement: 0,
        selectedByBaseline: true
      }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 1, operatorScore: 4, improvement: 30, candidateLoss: 8 }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 2, operatorScore: 2, improvement: 10, candidateLoss: 2 })
    ]),
    buildLnsWindowRankerBaselineCase("dev-gate", "development", "gate", [
      buildLnsWindowRankerBaselineLabel({ windowIndex: 0, operatorScore: 9, improvement: 0, selectedByBaseline: true }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 1, operatorScore: 5, improvement: 20, candidateLoss: 7 }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 2, operatorScore: 1, improvement: 5, candidateLoss: 1 })
    ])
  ];
  const holdoutCases = [
    buildLnsWindowRankerBaselineCase("holdout-service", "holdout", "service-pressure", [
      buildLnsWindowRankerBaselineLabel({
        windowIndex: 0,
        operatorScore: 10,
        improvement: 0,
        selectedByBaseline: true
      }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 1, operatorScore: 3, improvement: 40, candidateLoss: 9 }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 2, operatorScore: 2, improvement: 10, candidateLoss: 2 })
    ]),
    buildLnsWindowRankerBaselineCase("holdout-gate", "holdout", "gate", [
      buildLnsWindowRankerBaselineLabel({ windowIndex: 0, operatorScore: 8, improvement: 0, selectedByBaseline: true }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 1, operatorScore: 4, improvement: 25, candidateLoss: 6 }),
      buildLnsWindowRankerBaselineLabel({ windowIndex: 2, operatorScore: 1, improvement: 5, candidateLoss: 1 })
    ])
  ];
  const split = (name, cases) => ({
    split: name,
    selectedCaseNames: cases.map((entry) => entry.name),
    pressureFamilies: [...new Set(cases.map((entry) => entry.pressureFamily))],
    seeds: [7],
    labelCount: cases.reduce((total, entry) => total + entry.labels.length, 0),
    usableLabelCount: cases.reduce((total, entry) => total + entry.labels.length, 0),
    statusCounts: { improved: 4, neutral: 2, regressed: 0, invalid: 0, "recoverable-failure": 0 },
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
      labelCount: cases.reduce((total, entry) => total + entry.labels.length, 0),
      cases
    }
  });

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
      labelCount: 12,
      scaleReadiness: { passed: true, thresholds: {}, splitReadiness: [] },
      splits: [split("development", developmentCases), split("holdout", holdoutCases)]
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

function testLnsWindowRankerBaselineExperiment() {
  const fixture = buildLnsWindowRankerBaselineFixture();
  const result = runLnsWindowRankerBaselineExperiment(fixture, { topK: 2, randomBaselineSeed: 3 });
  const snapshot = createLnsWindowRankerBaselineSnapshot(result);
  const formatted = formatLnsWindowRankerBaselineExperiment(result);
  const candidateLoss = result.evaluation.baselines.find((entry) => entry.name === "candidate-loss");
  const operatorScore = result.evaluation.baselines.find((entry) => entry.name === "operator-score");

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.audit.cpuOnly, true);
  assert.equal(result.audit.runtimeDefaultChanged, false);
  assert.equal(result.audit.solverDefaultChanged, false);
  assert.equal(result.audit.sourceLnsScaleReady, true);
  assert.equal(result.model.trained, false);
  assert.equal(result.model.modelType, "lns-window-ranking-baseline-sweep");
  assert.equal(result.model.topK, 2);
  assert.equal(result.labels.labelCount, 12);
  assert.equal(result.labels.opportunityCount, 4);
  assert.equal(result.evaluation.summary.passed, true);
  assert.equal(result.evaluation.summary.bestBaselineName, "candidate-loss");
  assert.equal(candidateLoss.holdout.improvementCaptureRate, 1);
  assert.equal(candidateLoss.holdout.hitAt1, 1);
  assert.equal(operatorScore.holdout.improvementCaptureRate, 0);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.match(result.datasetFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(result.labelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(result.modelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(formatted, /LNS Window-Ranking Baselines/);
  assert.match(formatted, /best-baseline=candidate-loss/);
  assert.match(formatted, /offline diagnostics only/);

  const telemetryManifest = buildLnsWindowRankerBaselineTelemetryManifest(result, {
    command: "node dist/lnsWindowRankerBaselineCli.js --labels=labels.json",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/lns-window-ranker-baseline-test"
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
  assert.equal(telemetryManifest.model.trained, false);
  assert.equal(telemetryManifest.labelFingerprint, result.labelFingerprint);
  assert.equal(telemetryManifest.metrics.bestBaselineName, "candidate-loss");

  const registryDraft = buildLnsWindowRankerBaselineRegistryEntryDraft(result, fixture, {
    runId: "lns-window-ranker-baseline-test",
    commands: ["node dist/lnsWindowRankerBaselineCli.js --labels=labels.json"],
    artifactPaths: ["artifacts/lns-ranker/lns-window-ranker-baselines.json"]
  });
  assert.equal(registryDraft.artifactType, "model-experiment");
  assert.equal(registryDraft.decision, "offline-lns-window-baselines-evidence");
  assert.equal(registryDraft.model.trained, false);
  assert.equal(registryDraft.labelFingerprint, result.labelFingerprint);
  assert.equal(registryDraft.splitStatus.protectedHoldout, true);
  assert.equal(registryDraft.summaryMetrics.bestBaselineName, "candidate-loss");
  const completedRegistryEntry = buildExperimentRegistryEntry(registryDraft, {
    rootDir: path.join(__dirname, "../.."),
    gitMetadata: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/lns-window-ranker-baseline-test"
    }
  });
  const registryValidation = validateExperimentRegistryEntry(completedRegistryEntry, {
    rootDir: path.join(__dirname, "../.."),
    validateArtifactPaths: false,
    strict: true
  });
  assert.deepEqual(registryValidation.issues, []);

  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "lnsWindowRankerBaselineCli.js");
  const tempRoot = `artifacts/tmp-lns-window-ranker-baselines-${process.pid}`;
  const artifactDir = `${tempRoot}/bundle`;
  const labelsPath = `${tempRoot}/inputs/labels.json`;
  const absoluteTempRoot = path.join(repoRoot, tempRoot);
  fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(path.join(repoRoot, labelsPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, labelsPath), `${JSON.stringify(fixture, null, 2)}\n`);
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--labels=${labelsPath}`,
        `--artifact-dir=${artifactDir}`,
        "--top-k=2",
        "--baseline-run-id=tmp-lns-window-ranker-baseline-test",
        "--baseline-register-dry-run",
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
    assert.equal(artifactManifest.runId, "tmp-lns-window-ranker-baseline-test");
    assert.equal(artifactManifest.passed, true);
    assert.equal(artifactManifest.bestBaselineName, "candidate-loss");
    assert.equal(artifactManifest.registry.appended, false);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.experimentText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson)), true);
    const modelArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.modelJson), "utf8")
    );
    assert.equal(modelArtifact.trained, false);

    const registryGuard = childProcess.spawnSync(process.execPath, [cliPath, "--baseline-register-dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(registryGuard.status, 0);
    assert.match(registryGuard.stderr, /--labels=<path> is required/);
  } finally {
    fs.rmSync(absoluteTempRoot, { recursive: true, force: true });
  }
}

function runOptimizerLabelBenchmarkAssertions() {
  testGreedyConnectivityShadowOrderingLabelRunner();
  testLearnedRankingLabelSuite();
  testGreedyOfflineRankerExperiment();
  testLnsWindowRankerBaselineExperiment();
}

module.exports = {
  runOptimizerLabelBenchmarkAssertions
};
