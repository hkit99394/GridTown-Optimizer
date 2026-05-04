const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const {
  buildLearnedRankingLabelRegistryEntryDraft,
  buildLearnedRankingLabelTelemetryManifest,
  createLnsWindowReplaySnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS,
  formatLearnedRankingLabelSuite,
  formatLnsWindowReplayLabels,
  runLearnedRankingLabelSuite,
  runLnsWindowReplayLabels
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

  assert(naturalReplayCase);
  assert.equal(naturalReplayCase.params.lns?.seedHint, undefined);
  assert.equal(naturalReplayList.status, 0, naturalReplayList.stderr);
  assert.match(naturalReplayList.stdout, /lns-service-overlap-pressure/);

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
