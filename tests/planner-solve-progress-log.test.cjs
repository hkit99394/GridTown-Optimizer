const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readLatestSolveProgressLogByRequestId,
  SolveProgressLogWriter
} = require("../dist/packages/runtime/jobs/solveProgressLog.js");
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

function testFilesystemSolveLogFinishWithSolutionSampleWritesTerminalDocumentInOneFlush() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-terminal-"));
  const requestId = "terminal-final-sample";
  const capturedDocuments = [];
  const originalWriteFileSync = fs.writeFileSync;
  let payload;

  fs.writeFileSync = function patchedWriteFileSync(filePath, data, options) {
    if (
      typeof filePath === "string" &&
      filePath.includes(requestId) &&
      filePath.endsWith(".tmp") &&
      typeof data === "string"
    ) {
      capturedDocuments.push(JSON.parse(data));
    }
    return originalWriteFileSync.call(fs, filePath, data, options);
  };

  try {
    const writer = new SolveProgressLogWriter({
      rootDirectory: tempRoot,
      requestId,
      optimizer: "greedy",
      grid: [[1]],
      params: { optimizer: "greedy" },
      createdAtMs: Date.parse("2026-04-14T21:00:00.000Z")
    });
    const solution = {
      optimizer: "greedy",
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

    writer.finishWithSolutionSample("completed", {
      finishedAtMs: Date.parse("2026-04-14T21:00:01.234Z"),
      elapsedMs: 1234,
      solution,
      message: "Solve completed."
    });

    payload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  const partialFinalDocuments = capturedDocuments.filter((document) => {
    const lastEntry = document.entries[document.entries.length - 1] ?? null;
    return document.status === "running" && lastEntry?.source === "final-result";
  });
  const terminalDocuments = capturedDocuments.filter((document) => {
    const lastEntry = document.entries[document.entries.length - 1] ?? null;
    return document.status === "completed" && Boolean(document.finalResult) && lastEntry?.source === "final-result";
  });

  assert.equal(capturedDocuments.length, 1);
  assert.deepEqual(partialFinalDocuments, []);
  assert.equal(terminalDocuments.length, 1);
  assert.equal(payload.status, "completed");
  assert.equal(payload.message, "Solve completed.");
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].source, "final-result");
  assert.equal(payload.entries[0].capturedAt, "2026-04-14T21:00:01.234Z");
  assert.equal(payload.finalResult.totalPopulation, 10);
  assert.equal(payload.finalResult.solution.totalPopulation, 10);
}

function testFilesystemSolveLogUsesUniqueFilesForRepeatedRequestIds() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-collision-"));
  const requestId = "reused-request-id";
  const createdAtMs = Date.parse("2026-04-14T22:00:00.123Z");
  const writerOne = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId,
    optimizer: "greedy",
    grid: [[1]],
    params: { optimizer: "greedy" },
    createdAtMs
  });
  const writerTwo = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId,
    optimizer: "greedy",
    grid: [[1]],
    params: { optimizer: "greedy" },
    createdAtMs
  });

  writerOne.appendPendingSample({
    capturedAt: "2026-04-14T22:00:01.000Z",
    elapsedMs: 1000,
    note: "First solve."
  });
  writerTwo.appendPendingSample({
    capturedAt: "2026-04-14T22:00:02.000Z",
    elapsedMs: 2000,
    note: "Second solve."
  });

  assert.notEqual(writerOne.filePath, writerTwo.filePath);
  assert.match(path.basename(writerOne.filePath), /^20260414T220000123Z-reused-request-id(?:-\d+)?\.json$/);
  assert.match(path.basename(writerTwo.filePath), /^20260414T220000123Z-reused-request-id(?:-\d+)?\.json$/);
  assert.equal(fs.existsSync(writerOne.filePath), true);
  assert.equal(fs.existsSync(writerTwo.filePath), true);

  const firstPayload = JSON.parse(fs.readFileSync(writerOne.filePath, "utf8"));
  const secondPayload = JSON.parse(fs.readFileSync(writerTwo.filePath, "utf8"));
  assert.equal(firstPayload.entries[0].note, "First solve.");
  assert.equal(secondPayload.entries[0].note, "Second solve.");

  const recovered = readLatestSolveProgressLogByRequestId(tempRoot, requestId);
  assert.ok(recovered);
  assert.equal(recovered.filePath, writerTwo.filePath);
  assert.equal(recovered.document.entries[0].note, "Second solve.");
}

function testFilesystemSolveLogRecoverySkipsTruncatedJsonAndTempWrites() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-recovery-"));
  const requestId = "recover-truncated-log";
  const writer = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId,
    optimizer: "greedy",
    grid: [[1, 1]],
    params: { optimizer: "greedy" },
    createdAtMs: Date.parse("2026-04-14T20:00:00.000Z")
  });

  writer.appendPendingSample({
    capturedAt: "2026-04-14T20:00:01.000Z",
    elapsedMs: 1000,
    note: "Valid progress survived."
  });

  const writerTempPrefix = `${path.basename(writer.filePath)}.`;
  assert.deepEqual(
    fs.readdirSync(tempRoot).filter((fileName) => fileName.startsWith(writerTempPrefix) && fileName.endsWith(".tmp")),
    []
  );

  fs.writeFileSync(
    path.join(tempRoot, "99991231T235959Z-recover-truncated-log.json"),
    `{"version":2,"requestId":"${requestId}","updatedAt":"2099-12-31T23:59:59.000Z",`,
    "utf8"
  );
  fs.writeFileSync(
    `${writer.filePath}.123.tmp`,
    JSON.stringify({
      version: 2,
      requestId,
      optimizer: "greedy",
      createdAt: "2099-12-31T23:59:59.000Z",
      updatedAt: "2099-12-31T23:59:59.000Z",
      status: "completed",
      input: { grid: [[1]], params: { optimizer: "greedy" } },
      entries: []
    }),
    "utf8"
  );
  const invalidEntryPayload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  invalidEntryPayload.updatedAt = "2099-12-31T23:59:58.000Z";
  invalidEntryPayload.entries[0].elapsedMs = -1;
  fs.writeFileSync(
    path.join(tempRoot, "99991231T235958Z-recover-truncated-log.json"),
    `${JSON.stringify(invalidEntryPayload, null, 2)}\n`,
    "utf8"
  );

  const recovered = readLatestSolveProgressLogByRequestId(tempRoot, requestId);

  assert.ok(recovered);
  assert.equal(recovered.filePath, writer.filePath);
  assert.equal(recovered.document.status, "running");
  assert.equal(recovered.document.entries.length, 1);
  assert.equal(recovered.document.entries[0].note, "Valid progress survived.");
}

function testFilesystemSolveLogRecoveryRejectsInconsistentFinalResult() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-invalid-final-"));
  const requestId = "invalid-final-log";
  const writer = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId,
    optimizer: "greedy",
    grid: [[1]],
    params: { optimizer: "greedy" },
    createdAtMs: Date.parse("2026-04-14T23:00:00.000Z")
  });
  const solution = {
    optimizer: "greedy",
    stoppedByUser: false,
    roads: new Set(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  writer.finishWithSolutionSample("completed", {
    finishedAtMs: Date.parse("2026-04-14T23:00:01.000Z"),
    elapsedMs: 1000,
    solution
  });

  const invalidPayload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  invalidPayload.finalResult.mapText = "stale-map-text";
  fs.writeFileSync(writer.filePath, `${JSON.stringify(invalidPayload, null, 2)}\n`, "utf8");

  const recovered = readLatestSolveProgressLogByRequestId(tempRoot, requestId);
  assert.equal(recovered, null);
}

function main() {
  testPlannerSolveProgressLogCapturesSnapshotAndFinalResult();
  testPlannerSolveProgressLogPrefersBackendProgressEntry();
  testFilesystemSolveLogTracksSolverClockAcrossHeartbeats();
  testFilesystemSolveLogFinishWithSolutionSampleWritesTerminalDocumentInOneFlush();
  testFilesystemSolveLogUsesUniqueFilesForRepeatedRequestIds();
  testFilesystemSolveLogRecoverySkipsTruncatedJsonAndTempWrites();
  testFilesystemSolveLogRecoveryRejectsInconsistentFinalResult();

  console.log("Planner solve progress log tests passed.");
}

main();
