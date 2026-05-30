const assert = require("node:assert/strict");

const {
  buildCrossModeBenchmarkTelemetryManifest,
  buildPopulationAttainmentMetrics,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  runCrossModeBenchmarkSuite
} = require("city-builder/benchmarks");
const {
  buildDecisionTraceFromSolution,
  buildTimeToQualityScorecard,
  parseDecisionTraceJsonl,
  serializeDecisionTraceJsonl
} = require("city-builder/solver");
const { buildCrossModeMockSolve } = require("../helpers/crossModeBenchmarkFixtures.cjs");
const { delay } = require("../helpers/processHelpers.cjs");
const { buildMockSolution } = require("../helpers/solverFixtures.cjs");
const { buildCpSatTelemetry, buildCrossModeBenchmarkCase } = require("./crossModeBenchmarkTestHelpers.cjs");

async function testCrossModeBenchmarkSuiteAssertions() {
  assert.deepEqual(
    buildPopulationAttainmentMetrics({
      totalPopulation: 9400,
      capacityUpperBound: 10000,
      baselinePopulation: 9300,
      elapsedSeconds: 2
    }),
    {
      populationCapacityUpperBound: 10000,
      populationGapToCapacity: 600,
      capacityUtilization: 0.94,
      gapClosedVsZero: 0.94,
      baselinePopulation: 9300,
      gapClosedVsBaseline: 0.143,
      gapClosedPerSecond: 0.071
    }
  );
  assert.equal(
    buildPopulationAttainmentMetrics({
      totalPopulation: 10100,
      capacityUpperBound: 10000,
      baselinePopulation: 10000,
      elapsedSeconds: 1
    }).gapClosedVsBaseline,
    null
  );

  const benchmarkCase = buildCrossModeBenchmarkCase();
  const result = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["greedy"],
    budgetsSeconds: [3],
    seeds: [5],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    }
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["mock-scorecard"]);
  assert.deepEqual(result.budgetsSeconds, [3]);
  assert.deepEqual(result.seeds, [5]);
  assert.deepEqual(result.modes, ["greedy"]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].split, "development");
  assert.deepEqual(result.cases[0].workflowTags, []);
  assert.equal(result.cases[0].results.length, 1);
  assert.equal(result.cases[0].results[0].mode, "greedy");
  assert.equal(result.cases[0].results[0].winVsAuto, "no-auto");
  assert.equal(result.cases[0].results[0].scoreDeltaVsAuto, null);
  const tiedPopulationResult = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["greedy", "lns"],
    budgetsSeconds: [3],
    seeds: [5],
    solve: async (_grid, params, context) => {
      await delay(context.mode === "greedy" ? 30 : 1);
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation: 42 });
    }
  });
  const tiedGreedy = tiedPopulationResult.cases[0].results.find((entry) => entry.mode === "greedy");
  const tiedLns = tiedPopulationResult.cases[0].results.find((entry) => entry.mode === "lns");
  assert.equal(tiedGreedy.rank, 1);
  assert.equal(tiedLns.rank, 1);
  assert.deepEqual(tiedPopulationResult.cases[0].winnerModes, ["greedy", "lns"]);
  assert.equal(result.cases[0].results[0].progressSummary.activeStage, "greedy");
  assert.equal(result.cases[0].populationCapacityUpperBound, 1);
  assert.equal(result.cases[0].results[0].attainment.populationCapacityUpperBound, 1);
  assert.equal(result.cases[0].results[0].attainment.capacityUtilization, 1);
  assert.equal(typeof result.cases[0].results[0].budgetAllocationSignal.budgetUtilizationRatio, "number");
  assert.equal(result.cases[0].results[0].budgetAllocationSignal.scoreDeltaVsAuto, null);
  assert.equal(result.cases[0].results[0].telemetry.schemaVersion, 1);
  assert.equal(result.cases[0].results[0].telemetry.caseName, "mock-scorecard");
  assert.equal(result.cases[0].results[0].telemetry.mode, "greedy");
  assert.equal(result.cases[0].results[0].telemetry.budgetSeconds, 3);
  assert.equal(result.cases[0].results[0].telemetry.seed, 5);
  assert.equal(result.cases[0].results[0].telemetry.solverParams.greedy.timeLimitSeconds, 3);
  assert.equal(result.cases[0].results[0].telemetry.score.attainment.populationCapacityUpperBound, 1);
  assert.equal(typeof result.cases[0].results[0].telemetry.timing.wallClockSeconds, "number");
  assert.equal(result.cases[0].results[0].telemetry.cpu.workerCpuBudgetSeconds, 3);
  assert.equal(result.modeSummaries[0].mode, "greedy");
  assert.equal(result.problemSizeSummaries[0].problemSizeBand, "tiny");
  assert.equal(result.budgetPolicySignals.length, 1);
  assert.equal(result.budgetPolicySignals[0].caseName, "mock-scorecard");
  assert.equal(result.budgetPolicySignals[0].recommendation, "add-auto-baseline");

  const productWorkflowResult = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    names: ["manual-layout-replay-warm-start"],
    modes: ["greedy"],
    budgetsSeconds: [1],
    seeds: [7],
    solve: (_grid, params, context) =>
      buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: context.benchmarkCase.params.cpSat.warmStartHint.solution.totalPopulation,
        roads: context.benchmarkCase.params.cpSat.warmStartHint.solution.roads,
        residentials: context.benchmarkCase.params.cpSat.warmStartHint.solution.residentials,
        services: context.benchmarkCase.params.cpSat.warmStartHint.solution.services
      })
  });
  assert.equal(productWorkflowResult.caseCount, 1);
  assert.equal(productWorkflowResult.selectedCaseNames[0], "manual-layout-replay-warm-start");
  assert.equal(productWorkflowResult.cases[0].split, "development");
  assert.deepEqual(productWorkflowResult.cases[0].workflowTags, ["manual-layout-replay"]);
  assert.equal(productWorkflowResult.cases[0].bestScore, 160);

  const mocked = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["auto", "greedy", "lns", "cp-sat-portfolio"],
    budgetsSeconds: [3],
    seeds: [5, 11],
    portfolio: { workerCount: 2 },
    solve: buildCrossModeMockSolve()
  });

  assert.equal(mocked.cases.length, 2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "greedy").winVsAuto, "win");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").winVsAuto, "loss");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").winVsAuto, "tie");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").lnsSeedTimeLimitSeconds, 2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").lnsSeedWallClockSeconds, 0.2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedTimeLimitSeconds, 3);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedElapsedSeconds, 0.1);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedProfilePhaseCount, 1);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").workerCpuBudgetSeconds, 6);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "greedy").winRateVsAuto, 1);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "lns").winRateVsAuto, 0);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "greedy").populationStdDev, 0.5);
  assert.equal(mocked.budgetPolicySignals.length, 2);
  assert.equal(mocked.budgetPolicySignals[0].recommendation, "shift-auto-budget-to-greedy");
  assert.equal(mocked.budgetPolicySignals[0].autoDeltaToBest, 2);
  assert.equal(mocked.budgetPolicySignals[0].lnsScoreDeltaVsAuto, -2);
  assert.equal(mocked.budgetPolicySignals[0].autoLnsStageElapsedSeconds, 1.5);
  assert.equal(mocked.budgetPolicySignals[0].autoLnsStageImprovement, 0);
  assert.equal(mocked.budgetPolicySignals[0].autoCpSatStageElapsedSeconds, 0.7);
  assert.equal(mocked.budgetPolicySignals[0].autoCpSatStageImprovement, 3);
  assert.match(mocked.budgetPolicySignals[0].reason, /Greedy beat Auto by 2 population/);
  assert.match(mocked.budgetPolicySignals[0].reason, /Auto LNS used 1\.500s/);
  assert.match(mocked.budgetPolicySignals[0].reason, /Auto CP-SAT used 0\.700s for \+3/);
  assert.equal(
    mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").progressSummary.portfolioWorkerSummary
      .feasibleWorkers,
    1
  );
  const mockedAuto = mocked.cases[0].results.find((entry) => entry.mode === "auto");
  const mockedGreedy = mocked.cases[0].results.find((entry) => entry.mode === "greedy");
  const mockedLns = mocked.cases[0].results.find((entry) => entry.mode === "lns");
  const mockedPortfolio = mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio");
  assert.equal(mockedGreedy.roadSemantics.status, "anchor-connected");
  assert.equal(mockedGreedy.attainment.baselinePopulation, mockedAuto.totalPopulation);
  assert.equal(mockedGreedy.attainment.gapClosedVsBaseline, null);
  assert.equal(mockedGreedy.roadSemantics.anchorRoadCount, 1);
  assert.equal(mockedGreedy.roadSemantics.anchorConnectedRoadRatio, 1);
  assert.equal(mockedGreedy.roadSemantics.roadAdjacentBuildingCount, 1);
  assert.equal(mockedLns.roadSemantics.status, "no-anchor-touch");
  assert.equal(mockedLns.roadSemantics.anchorConnectedRoadCount, 0);
  assert.equal(mockedPortfolio.roadSemantics.status, "disconnected");
  assert.equal(mockedPortfolio.roadSemantics.disconnectedRoadCount, 1);
  assert.equal(mockedAuto.budgetAllocationSignal.scoreDeltaVsAuto, 0);
  assert.equal(mockedLns.budgetAllocationSignal.scoreDeltaVsAuto, -2);
  assert.equal(mockedLns.budgetAllocationSignal.signal, "under-used-budget");
  assert(mockedLns.budgetAllocationSignal.budgetRemainingSeconds > 2);
  assert.match(mockedLns.budgetAllocationSignal.reason, /small share/);
  assert(mockedAuto.decisionTrace.some((event) => event.kind === "auto-stage"));
  assert(mockedAuto.decisionTrace.some((event) => event.kind === "greedy-phase"));
  const mockedAutoLnsNeighborhood = mockedAuto.decisionTrace.find((event) => event.kind === "lns-neighborhood");
  assert(mockedAutoLnsNeighborhood);
  assert.equal(mockedAutoLnsNeighborhood.activeStage, "lns");
  assert.equal(mockedAutoLnsNeighborhood.elapsedMs, 1500);
  assert(mockedLns.decisionTrace.some((event) => event.kind === "lns-neighborhood"));
  assert(mockedPortfolio.decisionTrace.some((event) => event.kind === "cp-sat-progress"));
  assert.equal(mockedAuto.timeToQuality.bestScore, 10);
  assert.equal(mockedLns.timeToQuality.finalScore, 8);
  assert.equal(mockedAuto.timeToQuality.timeCheckpoints.find((entry) => entry.elapsedMs === 5000).bestScore, 10);
  assert.equal(mockedAuto.timeToQuality.qualityTargets.find((entry) => entry.ratio === 1).reachedScore, 10);
  assert.match(mockedPortfolio.checkpointReason, /CP-SAT portfolio worker|CP-SAT FEASIBLE/);
  assert.equal(mocked.portfolioEfficiencySignals.length, 0);
  assert.equal(mockedAuto.telemetry.stageCount, mockedAuto.telemetry.stages.length);
  assert(mockedAuto.telemetry.stages.some((entry) => entry.kind === "auto-stage" && entry.stage === "lns"));
  const mockedGreedyServiceMasterStage = mockedGreedy.telemetry.stages.find(
    (entry) => entry.kind === "greedy-profile" && entry.phase === "serviceMasterDecomposition"
  );
  assert(mockedGreedyServiceMasterStage);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterCandidatesConsidered, 8);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterCandidatesShortlisted, 4);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterLayouts, 6);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterFeasibleLayouts, 5);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterImprovingLayouts, 1);
  assert.equal(mockedGreedyServiceMasterStage.candidateCounts.serviceMasterNoGoodSkips, 2);
  assert.equal(
    mockedAuto.telemetry.stages.find((entry) => entry.kind === "lns-neighborhood").operatorOutcome,
    "neutral"
  );
  assert.equal(mockedLns.telemetry.stages.find((entry) => entry.kind === "lns").candidateCounts.iterationsStarted, 1);
  assert.equal(mockedPortfolio.telemetry.cpu.workerCpuBudgetSeconds, 6);
  assert.equal(mockedPortfolio.telemetry.score.cpSatStatus, "FEASIBLE");
  assert.equal(mockedPortfolio.telemetry.stages.filter((entry) => entry.kind === "cp-sat-portfolio-worker").length, 2);
  const mockedTelemetryManifest = buildCrossModeBenchmarkTelemetryManifest(mocked, {
    command: "node dist/crossModeBenchmarkCli.js --json",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/telemetry-manifest-test"
    },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      memoryBytes: 16,
      gpuUsed: false
    }
  });
  assert.equal(mockedTelemetryManifest.schemaVersion, 1);
  assert.equal(mockedTelemetryManifest.source, "cross-mode-benchmark");
  assert.equal(mockedTelemetryManifest.command, "node dist/crossModeBenchmarkCli.js --json");
  assert.equal(mockedTelemetryManifest.git.branch, "features/telemetry-manifest-test");
  assert.equal(mockedTelemetryManifest.hardware.cpuModel, "Test CPU");
  assert.equal(mockedTelemetryManifest.suite.totalRuns, 8);
  assert.equal(mockedTelemetryManifest.runs.length, 8);
  assert(
    mockedTelemetryManifest.runs.some(
      (entry) =>
        entry.caseName === "mock-scorecard" &&
        entry.mode === "lns" &&
        entry.stages.some((stage) => stage.kind === "lns-neighborhood" && stage.operatorOutcome === "neutral")
    )
  );

  const telemetry = buildCpSatTelemetry;
  const portfolioCompared = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["cp-sat", "cp-sat-portfolio"],
    budgetsSeconds: [3],
    seeds: [5],
    portfolio: { workerCount: 2 },
    solve: async (_grid, params, context) => {
      await delay(context.mode === "cp-sat" ? 50 : 1);
      const totalPopulation = context.mode === "cp-sat-portfolio" ? 24 : 10;
      const solution = buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation,
        cpSatStatus: "FEASIBLE"
      });
      solution.cpSatTelemetry = telemetry(totalPopulation, context.mode === "cp-sat" ? 2 : 1);
      if (context.mode === "cp-sat-portfolio") {
        solution.cpSatPortfolio = {
          workerCount: 2,
          selectedWorkerIndex: 1,
          workers: [
            {
              workerIndex: 0,
              randomSeed: context.seed,
              randomizeSearch: true,
              numWorkers: 1,
              status: "FEASIBLE",
              feasible: true,
              totalPopulation: 12,
              telemetry: telemetry(12, 1)
            },
            {
              workerIndex: 1,
              randomSeed: context.seed + 101,
              randomizeSearch: true,
              numWorkers: 1,
              status: "FEASIBLE",
              feasible: true,
              totalPopulation,
              telemetry: telemetry(totalPopulation, 1)
            }
          ]
        };
      }
      return solution;
    }
  });
  assert.equal(portfolioCompared.portfolioEfficiencySignals.length, 1);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].scoreDelta, 14);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].portfolioWorkerCpuBudgetSeconds, 6);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].portfolioObservedWorkerCpuSeconds, 2);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].cpuBudgetEfficiencyRatio, 1.2);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].recommendation, "portfolio-cpu-win");

  const lnsTraceJsonl = serializeDecisionTraceJsonl(mockedLns.decisionTrace);
  assert.equal(parseDecisionTraceJsonl(lnsTraceJsonl).length, mockedLns.decisionTrace.length);
  assert.match(formatCrossModeBenchmarkDecisionTraceJsonl(mocked), /"schemaVersion":1/);
  const zeroElapsedTrace = buildDecisionTraceFromSolution(
    {
      ...buildMockSolution({ optimizer: "cp-sat", totalPopulation: 5, cpSatStatus: "FEASIBLE" }),
      cpSatTelemetry: {
        solveWallTimeSeconds: 3,
        userTimeSeconds: 3,
        solutionCount: 1,
        incumbentObjectiveValue: 5,
        bestObjectiveBound: 5,
        objectiveGap: 0,
        incumbentPopulation: 5,
        bestPopulationUpperBound: 5,
        populationGapUpperBound: 0,
        lastImprovementAtSeconds: 0,
        secondsSinceLastImprovement: 3,
        numBranches: 0,
        numConflicts: 0
      }
    },
    { elapsedTimeSeconds: 0 }
  );
  const zeroElapsedCpSatProgressEvents = zeroElapsedTrace.filter((event) => event.kind === "cp-sat-progress");
  assert.equal(zeroElapsedCpSatProgressEvents[0].elapsedMs, 0);
  assert.equal(zeroElapsedCpSatProgressEvents[0].evidence.solveWallTimeSeconds, 3);
  const terminalCpSatProgress = zeroElapsedCpSatProgressEvents.find((event) => event.decision === "bounded");
  assert(terminalCpSatProgress);
  assert.equal(terminalCpSatProgress.elapsedMs, 3000);
  assert.equal(zeroElapsedTrace.find((event) => event.kind === "checkpoint").elapsedMs, 0);
  const cumulativeScorecard = buildTimeToQualityScorecard(
    [
      {
        schemaVersion: 1,
        runId: "synthetic",
        sequence: 0,
        eventId: "synthetic:0000",
        elapsedMs: 1000,
        optimizer: "greedy",
        activeStage: "greedy",
        kind: "checkpoint",
        decision: "improved",
        reason: "Synthetic improvement.",
        score: { before: null, after: 20, best: 20, delta: 20, upperBound: null, gap: null }
      },
      {
        schemaVersion: 1,
        runId: "synthetic",
        sequence: 1,
        eventId: "synthetic:0001",
        elapsedMs: 2000,
        optimizer: "greedy",
        activeStage: "greedy",
        kind: "checkpoint",
        decision: "stalled",
        reason: "Synthetic lower side event.",
        score: { before: 20, after: 10, best: 10, delta: -10, upperBound: null, gap: null }
      }
    ],
    { finalElapsedMs: 3000, finalScore: 10, timeCheckpointsMs: [2500, Number.NaN], qualityTargetRatios: [1] }
  );
  assert.equal(cumulativeScorecard.timeCheckpoints.length, 1);
  assert.equal(cumulativeScorecard.timeCheckpoints[0].bestScore, 20);
  assert.equal(cumulativeScorecard.qualityTargets[0].reachedAtMs, 1000);

  const formatted = formatCrossModeBenchmarkSuite(result);
  assert.match(formatted, /=== Cross-Mode Benchmark Scorecard ===/);
  assert.match(formatted, /Equal wall-clock budgets: 3s per mode/);
  assert.match(formatted, /progress=current=/);
  assert.match(formatted, /quality=first-feasible=/);
  assert.match(formatted, /attainment=cap=/);
  assert.match(formatted, /road-semantics=/);
  assert.match(formatted, /budget-signal=/);
  const mockedFormatted = formatCrossModeBenchmarkSuite(mocked);
  assert.match(mockedFormatted, /road-semantics=anchor-connected anchor-roads=1 anchor-connected=1 disconnected=0/);
  assert.match(mockedFormatted, /road-semantics=no-anchor-touch anchor-roads=0 anchor-connected=0/);
  assert.match(mockedFormatted, /road-semantics=disconnected anchor-roads=1 anchor-connected=1 disconnected=1/);
  assert.match(mockedFormatted, /seed-policy=.*lns-seed-limit:2\.000s/);
  assert.match(mockedFormatted, /seed-policy=.*auto-greedy-seed-limit:3\.000s/);
  assert.match(mockedFormatted, /budget-signal=under-used-budget/);
  assert.match(mockedFormatted, /Budget policy signals:/);
  assert.match(mockedFormatted, /recommendation=shift-auto-budget-to-greedy/);
  assert.match(mockedFormatted, /auto-gap=2/);
  assert.match(mockedFormatted, /reason=/);
}

module.exports = { testCrossModeBenchmarkSuiteAssertions };
