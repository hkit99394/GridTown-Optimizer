const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SolveProgressLogWriter } = require("../dist/packages/runtime/jobs/solveProgressLog.js");
const { loadPlannerSolveRuntimeModule } = require("./helpers/plannerBrowserModules.cjs");

function testPlannerSolveProgressLogCapturesSnapshotAndFinalResult() {
  const runtimeModule = loadPlannerSolveRuntimeModule();
  const logAfterSnapshot = runtimeModule.appendSolveProgressLog(
    [],
    {
      optimizer: "cp-sat",
      solution: {
        optimizer: "cp-sat",
        totalPopulation: 1234,
        cpSatStatus: "FEASIBLE",
        cpSatTelemetry: {
          bestPopulationUpperBound: 1300,
          populationGapUpperBound: 66,
          secondsSinceLastImprovement: 4.5
        }
      },
      stats: {
        optimizer: "cp-sat",
        totalPopulation: 1234,
        cpSatStatus: "FEASIBLE"
      }
    },
    {
      elapsedMs: 60000,
      capturedAt: "2026-04-14T11:00:00.000Z",
      source: "live-snapshot"
    }
  );

  assert.equal(logAfterSnapshot.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(logAfterSnapshot[0])), {
    capturedAt: "2026-04-14T11:00:00.000Z",
    elapsedMs: 60000,
    source: "live-snapshot",
    optimizer: "cp-sat",
    hasFeasibleSolution: true,
    totalPopulation: 1234,
    cpSatStatus: "FEASIBLE",
    progressSummary: {
      currentScore: 1234,
      bestScore: 1234,
      activeStage: "cp-sat",
      reuseSource: null,
      elapsedTimeSeconds: 60,
      timeSinceImprovementSeconds: 4.5,
      stopReason: null,
      exactGap: 66,
      portfolioWorkerSummary: null
    },
    bestPopulationUpperBound: 1300,
    populationGapUpperBound: 66,
    solveWallTimeSeconds: null,
    lastImprovementAtSeconds: null,
    secondsSinceLastImprovement: 4.5,
    note: null
  });

  const logAfterFinal = runtimeModule.appendSolveProgressLog(
    logAfterSnapshot,
    {
      optimizer: "cp-sat",
      solution: {
        optimizer: "cp-sat",
        totalPopulation: 1250,
        cpSatStatus: "OPTIMAL",
        cpSatTelemetry: {
          bestPopulationUpperBound: 1250,
          populationGapUpperBound: 0,
          secondsSinceLastImprovement: 0.2
        }
      },
      stats: {
        optimizer: "cp-sat",
        totalPopulation: 1250,
        cpSatStatus: "OPTIMAL"
      }
    },
    {
      elapsedMs: 90000,
      capturedAt: "2026-04-14T11:00:30.000Z",
      source: "final-result"
    }
  );

  assert.equal(logAfterFinal.length, 2);
  assert.equal(logAfterFinal[1].source, "final-result");
  assert.equal(logAfterFinal[1].totalPopulation, 1250);
  assert.equal(logAfterFinal[1].cpSatStatus, "OPTIMAL");
  assert.equal(logAfterFinal[1].bestPopulationUpperBound, 1250);
  assert.equal(logAfterFinal[1].populationGapUpperBound, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(logAfterFinal[1].progressSummary)), {
    currentScore: 1250,
    bestScore: 1250,
    activeStage: "cp-sat",
    reuseSource: null,
    elapsedTimeSeconds: 90,
    timeSinceImprovementSeconds: 0.2,
    stopReason: null,
    exactGap: 0,
    portfolioWorkerSummary: null
  });
}

function testPlannerSolveProgressLogPrefersBackendProgressEntry() {
  const runtimeModule = loadPlannerSolveRuntimeModule();
  const progressEntry = {
    capturedAt: "2026-04-14T12:00:00.000Z",
    elapsedMs: 12000,
    source: "live-snapshot",
    optimizer: "auto",
    activeOptimizer: "lns",
    autoStage: {
      requestedOptimizer: "auto",
      activeStage: "lns",
      stageIndex: 2,
      cycleIndex: 1,
      consecutiveWeakCycles: 0,
      lastCycleImprovementRatio: null,
      stopReason: null,
      generatedSeeds: [
        { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
        { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 }
      ]
    },
    hasFeasibleSolution: true,
    totalPopulation: 321,
    cpSatStatus: null,
    progressSummary: {
      currentScore: 321,
      bestScore: 321,
      activeStage: "lns",
      reuseSource: "greedy",
      elapsedTimeSeconds: 12,
      timeSinceImprovementSeconds: null,
      stopReason: null,
      exactGap: null,
      portfolioWorkerSummary: null
    },
    bestPopulationUpperBound: null,
    populationGapUpperBound: null,
    solveWallTimeSeconds: null,
    lastImprovementAtSeconds: null,
    secondsSinceLastImprovement: null,
    note: "Backend canonical event."
  };
  const log = runtimeModule.appendSolveProgressLog(
    [],
    {
      progressEntry,
      solution: {
        optimizer: "cp-sat",
        totalPopulation: 999,
        cpSatStatus: "OPTIMAL"
      }
    },
    {
      elapsedMs: 99999,
      source: "final-result"
    }
  );

  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(log[0])), progressEntry);
  progressEntry.autoStage.stageIndex = 99;
  assert.equal(log[0].autoStage.stageIndex, 2);
}

function testFilesystemSolveLogTracksSolverClockAcrossHeartbeats() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-"));
  const writer = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId: "lag-test",
    optimizer: "cp-sat",
    grid: [[1]],
    params: { optimizer: "cp-sat", cpSat: { randomSeed: 7 } },
    createdAtMs: 0
  });
  const feasibleSolution = {
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    cpSatTelemetry: {
      solveWallTimeSeconds: 49.774,
      userTimeSeconds: 49.774,
      solutionCount: 1,
      incumbentObjectiveValue: 10,
      bestObjectiveBound: 20,
      objectiveGap: 10,
      incumbentPopulation: 10,
      bestPopulationUpperBound: 20,
      populationGapUpperBound: 10,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 0,
      numBranches: 0,
      numConflicts: 0
    },
    stoppedByUser: false,
    roads: new Set(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 10
  };

  writer.appendSolutionSample(feasibleSolution, {
    elapsedMs: 100025,
    capturedAt: "2026-04-14T19:00:00.000Z",
    source: "live-snapshot"
  });

  writer.appendSolutionSample(
    {
      ...feasibleSolution,
      cpSatTelemetry: {
        ...feasibleSolution.cpSatTelemetry,
        secondsSinceLastImprovement: 60
      }
    },
    {
      elapsedMs: 160025,
      capturedAt: "2026-04-14T19:01:00.000Z",
      source: "live-snapshot"
    }
  );

  writer.finish("completed", {
    finishedAtMs: 160025,
    solution: feasibleSolution
  });

  const payload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  assert.equal(payload.entries.length, 2);
  assert.deepEqual(
    payload.entries.map((entry) => ({
      solveWallTimeSeconds: entry.solveWallTimeSeconds,
      lastImprovementAtSeconds: entry.lastImprovementAtSeconds,
      secondsSinceLastImprovement: entry.secondsSinceLastImprovement
    })),
    [
      {
        solveWallTimeSeconds: 49.774,
        lastImprovementAtSeconds: 49.774,
        secondsSinceLastImprovement: 0
      },
      {
        solveWallTimeSeconds: 109.774,
        lastImprovementAtSeconds: 49.774,
        secondsSinceLastImprovement: 60
      }
    ]
  );
  assert.deepEqual(payload.finalResult.mapRows, [
    "   0",
    " 0 .",
    "",
    "Legend: # blocked  R road  S service  H residential  . empty"
  ]);
  assert.equal(payload.finalResult.mapText, payload.finalResult.mapRows.join("\n"));
  assert.deepEqual(payload.finalResult.solution, {
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    cpSatTelemetry: {
      solveWallTimeSeconds: 109.774,
      userTimeSeconds: 109.774,
      solutionCount: 1,
      incumbentObjectiveValue: 10,
      bestObjectiveBound: 20,
      objectiveGap: 10,
      incumbentPopulation: 10,
      bestPopulationUpperBound: 20,
      populationGapUpperBound: 10,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 60,
      numBranches: 0,
      numConflicts: 0
    },
    stoppedByUser: false,
    roads: [],
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 10
  });
  assert.equal(
    payload.finalResult.solution.cpSatTelemetry.solveWallTimeSeconds,
    payload.entries[1].solveWallTimeSeconds
  );
  assert.equal(
    payload.finalResult.solution.cpSatTelemetry.secondsSinceLastImprovement,
    payload.entries[1].secondsSinceLastImprovement
  );
}

function main() {
  testPlannerSolveProgressLogCapturesSnapshotAndFinalResult();
  testPlannerSolveProgressLogPrefersBackendProgressEntry();
  testFilesystemSolveLogTracksSolverClockAcrossHeartbeats();

  console.log("Planner solve progress log tests passed.");
}

main();
