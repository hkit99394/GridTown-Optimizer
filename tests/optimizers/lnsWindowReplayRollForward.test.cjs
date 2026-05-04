const assert = require("node:assert/strict");

const {
  buildLearnedRankingLabelRegistryEntryDraft,
  buildLearnedRankingLabelTelemetryManifest,
  createLnsWindowReplaySnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_LNS_BENCHMARK_CORPUS,
  formatLearnedRankingLabelSuite,
  formatLnsWindowReplayLabels,
  runLearnedRankingLabelSuite,
  runLnsWindowReplayLabels
} = require("../../dist/benchmarkApi.js");
const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
const { buildMockSolution } = require("../helpers/solverFixtures.cjs");

const originalSolveCpSat = cpSatModule.solveCpSat;

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
    lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS,
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

  assert.deepEqual(
    {
      auditIterations: learned.audit.lnsReplay.rollForwardIterations,
      auditRepairTime: learned.audit.lnsReplay.rollForwardRepairTimeLimitSeconds,
      splitIterations: telemetry.lns.splits[0].rollForwardIterations,
      splitRepairTime: telemetry.lns.splits[0].rollForwardRepairTimeLimitSeconds,
      splitLabels: telemetry.lns.splits[0].rollForwardLabelCount,
      budgetIterations: registry.budget.lnsRollForwardIterations[0],
      budgetRepairTime: registry.budget.lnsRollForwardRepairTimeLimitSeconds[0],
      summaryIterations: registry.summaryMetrics.lnsRollForwardIterations
    },
    {
      auditIterations: 1,
      auditRepairTime: 0.05,
      splitIterations: 1,
      splitRepairTime: 0.05,
      splitLabels: 1,
      budgetIterations: 1,
      budgetRepairTime: 0.05,
      summaryIterations: 1
    }
  );
  assert.equal(registry.budget.lnsRollForwardLabelCount, 2);
  assert.match(formatLearnedRankingLabelSuite(learned), /lns-roll-forward=1x0.05s/);
} finally {
  cpSatModule.solveCpSat = originalSolveCpSat;
}

console.log("LNS window replay roll-forward tests passed.");
