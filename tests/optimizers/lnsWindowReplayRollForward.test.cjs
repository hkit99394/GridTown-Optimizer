const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildLearnedRankingLabelRegistryEntryDraft,
  buildLearnedRankingLabelTelemetryManifest,
  buildExperimentRegistryEntry,
  createLnsWindowReplaySnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS,
  DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS,
  formatLearnedRankingLabelSuite,
  formatLnsWindowReplayLabels,
  formatLnsWindowReplayRepeatabilitySummary,
  runLearnedRankingLabelSuite,
  runLnsWindowRankerOnlineAblation,
  runLnsWindowReplayLabels,
  runLnsWindowReplayLabelsFromOnlineDecisionStates,
  summarizeLnsWindowReplayRepeatability,
  validateExperimentRegistryEntry,
  STRICT_LNS_REPLAY_LABEL_STATE_COLLECTION_ITERATIONS,
  STRICT_LNS_REPLAY_LABEL_STATE_POLICIES
} = require("../../dist/benchmarkApi.js");
const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
const { buildMockSolution } = require("../helpers/solverFixtures.cjs");

const originalSolveCpSat = cpSatModule.solveCpSat;
const repoRoot = path.join(__dirname, "../..");

function zeroPopulationRepair() {
  return buildMockSolution({
    optimizer: "cp-sat",
    totalPopulation: 0,
    cpSatStatus: "FEASIBLE",
    roads: ["0,0"],
    services: [],
    residentials: []
  });
}

try {
  const naturalReplayCase = DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS.find(
    (benchmarkCase) => benchmarkCase.name === "lns-service-overlap-pressure"
  );
  const naturalReplayList = childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, "dist", "lnsBenchmarkCli.js"), "--list", "--natural-replay-seeds"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const curatedReplayCase = DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS.find(
    (benchmarkCase) => benchmarkCase.name === "lns-service-overlap-pressure"
  );
  const curatedReplayList = childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, "dist", "lnsBenchmarkCli.js"), "--list", "--curated-replay-seeds"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const protectedReplayList = childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, "dist", "lnsBenchmarkCli.js"), "--list", "--window-replay-protected-holdout"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const productReplayList = childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, "dist", "lnsBenchmarkCli.js"), "--list", "--window-replay-product-promotion-holdout"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const freshReplayList = childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, "dist", "lnsBenchmarkCli.js"), "--list", "--window-replay-fresh-pressure-holdout"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert(naturalReplayCase);
  assert(curatedReplayCase);
  assert.equal(naturalReplayCase.params.lns?.seedHint, undefined);
  assert.match(curatedReplayCase.params.lns?.seedHint?.sourceName, /curated-first-improvement-seed$/);
  assert.equal(naturalReplayList.status, 0, naturalReplayList.stderr);
  assert.match(naturalReplayList.stdout, /lns-service-overlap-pressure/);
  assert.equal(curatedReplayList.status, 0, curatedReplayList.stderr);
  assert.match(curatedReplayList.stdout, /lns-service-overlap-pressure/);
  assert.equal(protectedReplayList.status, 0, protectedReplayList.stderr);
  assert.match(protectedReplayList.stdout, /lns-holdout-corridor-weave-pressure/);
  assert.equal(productReplayList.status, 0, productReplayList.stderr);
  assert.match(productReplayList.stdout, /lns-product-expansion-comparison-replay-pressure/);
  assert.equal(freshReplayList.status, 0, freshReplayList.stderr);
  assert.match(freshReplayList.stdout, /lns-fresh-product-expansion-side-pocket-pressure/);

  const curatedReplay = runLnsWindowReplayLabels(DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS, {
    names: ["lns-gate-choke-pressure", "lns-service-overlap-pressure"],
    seeds: [7],
    maxWindows: 14,
    explorationWindowCount: 4,
    repairTimeLimitSeconds: 0.1,
    statePolicies: STRICT_LNS_REPLAY_LABEL_STATE_POLICIES,
    stateCollectionIterations: STRICT_LNS_REPLAY_LABEL_STATE_COLLECTION_ITERATIONS,
    stateCollectionRepairTimeLimitSeconds: 0.1,
    rollForwardIterations: 1,
    rollForwardRepairTimeLimitSeconds: 0.1
  });
  const curatedOpportunityLabels = curatedReplay.cases
    .flatMap((benchmarkCase) => benchmarkCase.labels)
    .filter((label) => label.usable && label.rollForward?.improvementVsBaseline > 0);
  assert(curatedReplay.cases.every((benchmarkCase) => benchmarkCase.seedHintKind === "curated"));
  assert(curatedOpportunityLabels.length >= 2);

  cpSatModule.solveCpSat = zeroPopulationRepair;

  const replay = runLnsWindowReplayLabels(undefined, {
    names: ["seeded-service-anchor-pressure"],
    seeds: [7],
    maxWindows: 1,
    repairTimeLimitSeconds: 0.25,
    rollForwardIterations: 1,
    rollForwardRepairTimeLimitSeconds: 0.1
  });
  const replaySnapshot = createLnsWindowReplaySnapshot(replay);
  const replayLabel = replay.cases[0].labels[0];

  assert.deepEqual(
    {
      iterations: replay.rollForwardIterations,
      repairTime: replay.rollForwardRepairTimeLimitSeconds,
      labels: replay.rollForwardLabelCount,
      snapshotLabels: replaySnapshot.rollForwardLabelCount,
      status: replayLabel.rollForward.statusVsBaseline
    },
    { iterations: 1, repairTime: 0.1, labels: 1, snapshotLabels: 1, status: "neutral" }
  );
  assert.deepEqual(
    {
      seedPopulation: replayLabel.rollForward.seedPopulation,
      totalPopulation: replayLabel.rollForward.totalPopulation,
      incumbentDelta: replayLabel.rollForward.populationDeltaFromIncumbent,
      repairDelta: replayLabel.rollForward.populationDeltaFromRepair,
      baselineTotalPopulation: replayLabel.rollForward.baselineTotalPopulation,
      baselineDelta: replayLabel.rollForward.populationDeltaVsBaseline,
      baselineImprovement: replayLabel.rollForward.improvementVsBaseline
    },
    {
      seedPopulation: 0,
      totalPopulation: 0,
      incumbentDelta: -100,
      repairDelta: 0,
      baselineTotalPopulation: 0,
      baselineDelta: 0,
      baselineImprovement: 0
    }
  );
  assert.match(formatLnsWindowReplayLabels(replay), /roll-forward=population:0/);
  assert.match(formatLnsWindowReplayLabels(replay), /final-status:neutral/);
  const repeatabilitySummary = summarizeLnsWindowReplayRepeatability(replay);
  assert.deepEqual(
    {
      labels: repeatabilitySummary.rollForwardLabelCount,
      buckets: repeatabilitySummary.bucketCount,
      conflicts: repeatabilitySummary.conflictingFinalStatusBucketCount
    },
    { labels: 1, buckets: 1, conflicts: 0 }
  );
  assert.match(formatLnsWindowReplayLabels(replay), /Repeatability: roll-forward-labels=1/);

  const conflictingReplay = JSON.parse(JSON.stringify(replay));
  const cloneConflictCase = (seed, finalDelta, finalStatus, totalPopulation, baselineTotalPopulation) => {
    const benchmarkCase = JSON.parse(JSON.stringify(replay.cases[0]));
    const label = benchmarkCase.labels[0];
    benchmarkCase.seed = seed;
    benchmarkCase.labels = [label];
    label.seed = seed;
    label.totalPopulation = totalPopulation;
    label.rollForward.totalPopulation = totalPopulation;
    label.rollForward.baselineTotalPopulation = baselineTotalPopulation;
    label.rollForward.populationDeltaVsBaseline = finalDelta;
    label.rollForward.improvementVsBaseline = Math.max(0, finalDelta);
    label.rollForward.statusVsBaseline = finalStatus;
    return benchmarkCase;
  };
  conflictingReplay.seeds = [7, 19];
  conflictingReplay.seedCount = 2;
  conflictingReplay.caseCount = 2;
  conflictingReplay.stateCount = 2;
  conflictingReplay.comparisonCount = 2;
  conflictingReplay.labelCount = 2;
  conflictingReplay.rollForwardLabelCount = 2;
  conflictingReplay.cases = [
    cloneConflictCase(7, 10, "improved", 10, 0),
    cloneConflictCase(19, -10, "regressed", 0, 10)
  ];
  const conflictingRepeatability = summarizeLnsWindowReplayRepeatability(conflictingReplay);
  assert.deepEqual(
    {
      buckets: conflictingRepeatability.bucketCount,
      conflicts: conflictingRepeatability.conflictingFinalStatusBucketCount,
      featureIdenticalConflicts: conflictingRepeatability.featureIdenticalConflictBucketCount,
      conflictLabels: conflictingRepeatability.conflictingLabelCount
    },
    { buckets: 1, conflicts: 1, featureIdenticalConflicts: 1, conflictLabels: 2 }
  );
  assert.deepEqual(conflictingRepeatability.examples[0].statusCounts, {
    improved: 1,
    neutral: 0,
    regressed: 1,
    unknown: 0
  });
  assert.match(formatLnsWindowReplayRepeatabilitySummary(conflictingRepeatability), /feature-identical-conflicts=1/);

  const artifactDir = path.join(repoRoot, `artifacts/tmp-lns-window-replay-${process.pid}`);
  fs.rmSync(artifactDir, { recursive: true, force: true });
  const artifactResult = childProcess.spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "dist", "lnsBenchmarkCli.js"),
      "--window-replay-labels",
      "--seeds=7",
      "--max-windows=1",
      "--repair-time=0.05",
      "--state-policies=initial-incumbent",
      `--window-replay-artifact-dir=${path.relative(repoRoot, artifactDir)}`,
      "seeded-service-anchor-pressure",
      "--json"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(artifactResult.status, 0, artifactResult.stderr || artifactResult.stdout);
  const artifactManifest = JSON.parse(artifactResult.stdout);
  assert.equal(artifactManifest.caseCount, 1);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.replayJson)), true);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.replayText)), true);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.repeatabilitySummaryJson)), true);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson)), true);
  assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.manifestJson)), true);
  assert.match(artifactManifest.inputFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.match(artifactManifest.labelFingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(artifactManifest.repeatabilitySummary.conflictingFinalStatusBucketCount, 0);
  const telemetryManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson), "utf8")
  );
  const registryEntryDraft = JSON.parse(
    fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.registryEntryDraftJson), "utf8")
  );
  const expectedDiagnosticArtifacts = [
    artifactManifest.artifactPaths.replayJson,
    artifactManifest.artifactPaths.replayText,
    artifactManifest.artifactPaths.repeatabilitySummaryJson,
    artifactManifest.artifactPaths.manifestJson,
    artifactManifest.artifactPaths.telemetryManifestJson
  ];
  assert.equal(telemetryManifest.source, "lns-window-replay-diagnostic-bundle");
  assert.equal(telemetryManifest.diagnosticsOnly, true);
  assert.equal(telemetryManifest.inputFingerprint, artifactManifest.inputFingerprint);
  assert.equal(telemetryManifest.labelFingerprint, artifactManifest.labelFingerprint);
  assert.deepEqual(telemetryManifest.outputArtifacts, expectedDiagnosticArtifacts);
  assert.equal(registryEntryDraft.artifactType, "label-bundle");
  assert.equal(registryEntryDraft.decision, "diagnostics-only");
  assert.equal(registryEntryDraft.inputFingerprint, artifactManifest.inputFingerprint);
  assert.equal(registryEntryDraft.labelFingerprint, artifactManifest.labelFingerprint);
  assert.deepEqual(registryEntryDraft.artifactPaths, expectedDiagnosticArtifacts);
  const completedReplayRegistryEntry = buildExperimentRegistryEntry(registryEntryDraft, {
    rootDir: repoRoot,
    gitMetadata: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/replay-provenance-test"
    },
    now: new Date("2026-05-10T00:00:00.000Z")
  });
  const replayRegistryValidation = validateExperimentRegistryEntry(completedReplayRegistryEntry, {
    rootDir: repoRoot,
    validateArtifactPaths: true,
    strict: true
  });
  assert.deepEqual(replayRegistryValidation.issues, []);
  fs.rmSync(artifactDir, { recursive: true, force: true });

  const onlineScorecard = runLnsWindowRankerOnlineAblation(DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS, {
    names: ["seeded-service-anchor-pressure"],
    seeds: [7],
    model: {
      modelType: "lns-window-linear-pairwise-ranker",
      featureSchemaVersion: 2,
      weights: { selectedByBaseline: -1 }
    },
    minScoreDelta: 0,
    lns: {
      iterations: 1,
      repairTimeLimitSeconds: 0.05
    }
  });
  const onlineSnapshot = createLnsWindowRankerOnlineAblationSnapshot(onlineScorecard);
  const onlineTrace = onlineSnapshot.cases[0].variants.find((variant) => variant.variantName === "window-ranker")
    .selectionTrace[0];
  assert.equal(onlineTrace.decisionState.source, "online-window-ranker-decision-state");
  assert.equal(onlineTrace.decisionState.incumbentPopulation, onlineTrace.populationBefore);

  const onlineDecisionReplay = runLnsWindowReplayLabelsFromOnlineDecisionStates(
    onlineSnapshot,
    DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS,
    {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 1,
      repairTimeLimitSeconds: 0.05,
      rollForwardIterations: 1,
      rollForwardRepairTimeLimitSeconds: 0.05
    }
  );
  assert.equal(onlineDecisionReplay.cases[0].statePolicy, "online-decision");
  assert.equal(onlineDecisionReplay.cases[0].seedHintKind, "online-decision");
  assert.equal(onlineDecisionReplay.cases[0].onlineDecisionTrace.transition, onlineTrace.transition);
  assert(onlineDecisionReplay.cases[0].labels.some((label) => label.selectionSource === "online-baseline"));
  assert(
    onlineDecisionReplay.cases[0].labels.every(
      (label) => label.onlineDecisionTrace.transition === onlineTrace.transition
    )
  );

  const naturalReplay = runLnsWindowReplayLabels(DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS, {
    names: ["lns-service-overlap-pressure"],
    seeds: [7],
    maxWindows: 1,
    repairTimeLimitSeconds: 0.25
  });
  assert.equal(naturalReplay.cases[0].seedHintKind, "none");
  assert.equal(naturalReplay.cases[0].seedHintSourceName, null);
  assert.equal(naturalReplay.cases[0].labels[0].seedHintKind, "none");

  const splitConfigs = [
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
  const learned = runLearnedRankingLabelSuite({
    seeds: [7],
    splitConfigs,
    greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    lnsCorpus: DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS,
    maxWindows: 1,
    explorationWindowCount: 0,
    repairTimeLimitSeconds: 0.1,
    lnsRollForwardIterations: 1,
    lnsRollForwardRepairTimeLimitSeconds: 0.05
  });
  const telemetry = buildLearnedRankingLabelTelemetryManifest(learned, { command: "test" });
  const registry = buildLearnedRankingLabelRegistryEntryDraft(learned, {
    runId: "test",
    commands: ["test"],
    artifactPaths: ["artifacts/test/labels.json"]
  });
  const developmentReplayCase = learned.lns.splits.find((split) => split.split === "development").replay.cases[0];
  const holdoutReplayCase = learned.lns.splits.find((split) => split.split === "holdout").replay.cases[0];

  assert.deepEqual(
    {
      auditIterations: learned.audit.lnsReplay.rollForwardIterations,
      auditRepairTime: learned.audit.lnsReplay.rollForwardRepairTimeLimitSeconds,
      splitIterations: telemetry.lns.splits[0].rollForwardIterations,
      splitRepairTime: telemetry.lns.splits[0].rollForwardRepairTimeLimitSeconds,
      splitLabels: telemetry.lns.splits[0].rollForwardLabelCount,
      splitFinalStatus: telemetry.lns.splits[0].rollForwardStatusCounts.neutral,
      splitOpportunityLabels: telemetry.lns.splits[0].rollForwardOpportunityLabelCount,
      splitOpportunityCases: telemetry.lns.splits[0].rollForwardOpportunityCaseCount,
      budgetIterations: registry.budget.lnsRollForwardIterations[0],
      budgetRepairTime: registry.budget.lnsRollForwardRepairTimeLimitSeconds[0],
      summaryIterations: registry.summaryMetrics.lnsRollForwardIterations,
      summaryFinalStatus: registry.summaryMetrics.lnsRollForwardStatusCounts.neutral,
      summaryOpportunityLabels: registry.summaryMetrics.lnsRollForwardOpportunityLabelCount,
      summaryOpportunityCases: registry.summaryMetrics.lnsRollForwardOpportunityCaseCount
    },
    {
      auditIterations: 1,
      auditRepairTime: 0.05,
      splitIterations: 1,
      splitRepairTime: 0.05,
      splitLabels: 1,
      splitFinalStatus: 1,
      splitOpportunityLabels: 0,
      splitOpportunityCases: 0,
      budgetIterations: 1,
      budgetRepairTime: 0.05,
      summaryIterations: 1,
      summaryFinalStatus: 2,
      summaryOpportunityLabels: 0,
      summaryOpportunityCases: 0
    }
  );
  assert.deepEqual(telemetry.lns.rollForwardStatusCounts, { improved: 0, neutral: 2, regressed: 0, unknown: 0 });
  assert.equal(telemetry.lns.rollForwardOpportunityLabelCount, 0);
  assert.equal(telemetry.lns.rollForwardOpportunityCaseCount, 0);
  assert.deepEqual(registry.summaryMetrics.lnsRollForwardSplitDiagnostics[0], {
    split: "development",
    statusCounts: { improved: 0, neutral: 1, regressed: 0, unknown: 0 },
    opportunityLabelCount: 0,
    opportunityCaseCount: 0
  });
  assert.equal(developmentReplayCase.seedHintKind, "curated");
  assert.equal(holdoutReplayCase.seedHintKind, "none");
  assert.equal(registry.budget.lnsRollForwardLabelCount, 2);
  assert.equal(registry.budget.lnsRollForwardOpportunityLabelCount, 0);
  assert.equal(registry.budget.lnsRollForwardOpportunityCaseCount, 0);
  assert.match(formatLearnedRankingLabelSuite(learned), /lns-roll-forward=1x0.05s/);
  assert.match(
    formatLearnedRankingLabelSuite(learned),
    /roll-forward-status=improved:0 neutral:1 regressed:0 unknown:0/
  );
  assert.match(formatLearnedRankingLabelSuite(learned), /roll-forward-opportunities=labels:0 cases:0/);
} finally {
  cpSatModule.solveCpSat = originalSolveCpSat;
}

console.log("LNS window replay roll-forward tests passed.");
