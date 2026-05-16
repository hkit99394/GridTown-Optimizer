const {
  assert,
  fs,
  buildDecisionTraceFromSolution,
  solveAsync,
  solveAuto,
  startAutoSolve,
  delay,
  resolveCpSatPython,
  buildMockSolution
} = require("./optimizerHarnessDeps.cjs");
const { computeCpSatRequestFingerprint } = require("../../dist/packages/core/cpSatContinuation.js");

async function maybeTestAutoOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) return;

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "auto",
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1
    },
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 1,
      noImprovementTimeoutSeconds: 1,
      numWorkers: 1
    },
    auto: {
      wallClockLimitSeconds: 15
    }
  };

  const solution = await solveAsync(grid, params);

  assert.equal(solution.optimizer, "auto");
  assert.equal(solution.totalPopulation, 100);
  assert.ok(
    solution.activeOptimizer === "greedy" || solution.activeOptimizer === "lns" || solution.activeOptimizer === "cp-sat"
  );
  assert.ok(solution.autoStage);
  assert.equal(solution.autoStage.activeStage, solution.activeOptimizer);
  assert.ok(solution.autoStage.generatedSeeds.length >= 3);
  assert.ok(solution.autoStage.stopReason);
}

function testAutoKeepsEqualPopulationOptimalCpSatResult() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = () => buildMockSolution({ optimizer: "lns", totalPopulation: 100 });
  cpSatModule.solveCpSat = () =>
    buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" });

  try {
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        auto: { wallClockLimitSeconds: 10 }
      }
    );

    assert.equal(solution.cpSatStatus, "OPTIMAL");
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "optimal");
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoPreservesUserWarmStartMetadata() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let capturedCpSatOptions = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 50 });
  lnsModule.solveLns = () => buildMockSolution({ optimizer: "lns", totalPopulation: 60 });
  cpSatModule.solveCpSat = (grid, params) => {
    capturedCpSatOptions = params.cpSat;
    return buildMockSolution({ optimizer: "cp-sat", totalPopulation: 60, cpSatStatus: "OPTIMAL" });
  };

  try {
    const grid = [
      [1, 1],
      [1, 1]
    ];
    const params = {
      optimizer: "auto",
      cpSat: {
        timeLimitSeconds: 5,
        objectiveLowerBound: 70,
        warmStartHint: {
          sourceName: "checkpoint",
          modelFingerprint: computeCpSatRequestFingerprint(grid, { optimizer: "auto" }),
          preferStrictImprove: true,
          objectiveLowerBound: 75,
          roads: ["0,0"],
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      },
      auto: { wallClockLimitSeconds: 10 }
    };

    solveAuto(grid, params);

    assert.ok(capturedCpSatOptions);
    assert.equal(capturedCpSatOptions.warmStartHint.modelFingerprint, computeCpSatRequestFingerprint(grid, params));
    assert.equal(capturedCpSatOptions.warmStartHint.preferStrictImprove, true);
    assert.equal(capturedCpSatOptions.warmStartHint.solution.totalPopulation, 60);
    assert.deepEqual(capturedCpSatOptions.warmStartHint.roads, ["0,0"]);
    assert.equal(capturedCpSatOptions.objectiveLowerBound, 75);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoDirectRuntimeRejectsMalformedOptionValues() {
  assert.throws(
    () =>
      solveAuto(
        [
          [1, 1],
          [1, 1]
        ],
        {
          optimizer: "auto",
          auto: {
            wallClockLimitSeconds: "bad",
            weakCycleImprovementThreshold: "bad",
            maxConsecutiveWeakCycles: "bad",
            cpSatStageTimeLimitSeconds: "bad",
            cpSatStageNoImprovementTimeoutSeconds: "bad"
          }
        }
      ),
    /Invalid solver input: Auto option auto\.wallClockLimitSeconds must be a finite number > 0 and <= 86400\./
  );
  assert.throws(
    () =>
      solveAuto(
        [
          [1, 1],
          [1, 1]
        ],
        {
          optimizer: "auto",
          auto: {
            maxConsecutiveWeakCycles: "bad",
            cpSatStageTimeLimitSeconds: "bad",
            cpSatStageNoImprovementTimeoutSeconds: "bad"
          }
        }
      ),
    /Invalid solver input: Auto option auto\.maxConsecutiveWeakCycles must be an integer between 1 and 100\./
  );
}

async function testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;
  let cpSatStarted = false;

  const buildBackgroundHandle = (solution, delayMs = 0) => {
    let cancelled = false;
    return {
      promise: delay(delayMs).then(() => ({ ...solution, ...(cancelled ? { stoppedByUser: true } : {}) })),
      cancel: () => {
        cancelled = true;
      },
      getLatestSnapshot: () => ({ ...solution, ...(cancelled ? { stoppedByUser: true } : {}) }),
      getLatestSnapshotState: () => ({
        hasFeasibleSolution: true,
        totalPopulation: solution.totalPopulation,
        activeOptimizer: solution.optimizer,
        autoStage: null,
        cpSatStatus: solution.cpSatStatus ?? null
      })
    };
  };

  greedyBridgeModule.startGreedySolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
  cpSatModule.startCpSatSolve = () => {
    cpSatStarted = true;
    return buildBackgroundHandle(
      buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" }),
      50
    );
  };

  try {
    const handle = startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        auto: { wallClockLimitSeconds: 10 }
      }
    );

    while (!cpSatStarted) {
      await delay(5);
    }
    handle.cancel();

    const solution = await handle.promise;
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "cancelled");
    assert.equal(solution.stoppedByUser, true);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

async function testAutoAsyncStageErrorKeepsIncumbentWithExplicitStopReason() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;

  const buildBackgroundHandle = (solution) => ({
    promise: Promise.resolve(solution),
    cancel() {},
    getLatestSnapshot: () => solution,
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: solution.totalPopulation,
      activeOptimizer: solution.optimizer,
      autoStage: null,
      cpSatStatus: solution.cpSatStatus ?? null
    })
  });

  greedyBridgeModule.startGreedySolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
  cpSatModule.startCpSatSolve = () => ({
    promise: delay(0).then(() => {
      throw new Error("CP-SAT backend exited without returning a solution.");
    }),
    cancel() {},
    getLatestSnapshot: () => null,
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: false,
      totalPopulation: null,
      activeOptimizer: "cp-sat",
      autoStage: null,
      cpSatStatus: null
    })
  });

  try {
    const solution = await startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto"
      }
    ).promise;

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "stage-error");
    assert.equal(solution.stoppedByUser, false);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

async function testAutoAsyncRecoveredStageSnapshotKeepsNonRecoveryTerminalMetadata() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;

  const buildBackgroundHandle = (solution) => ({
    promise: Promise.resolve(solution),
    cancel() {},
    getLatestSnapshot: () => solution,
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: solution.totalPopulation,
      activeOptimizer: solution.optimizer,
      autoStage: null,
      cpSatStatus: solution.cpSatStatus ?? null
    })
  });

  greedyBridgeModule.startGreedySolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
  cpSatModule.startCpSatSolve = () => ({
    promise: delay(0).then(() => {
      throw new Error("CP-SAT backend exited after streaming a feasible incumbent.");
    }),
    cancel() {},
    getLatestSnapshot: () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "FEASIBLE" }),
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: 100,
      activeOptimizer: "cp-sat",
      autoStage: null,
      cpSatStatus: "FEASIBLE"
    })
  });

  try {
    const solution = await startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto"
      }
    ).promise;

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "weak-cycle-limit");
    assert.equal(solution.stoppedByUser, false);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

async function testAutoAsyncRecoveredCpSatSnapshotKeepsCompletedMetadata() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;

  const buildBackgroundHandle = (solution) => ({
    promise: Promise.resolve(solution),
    cancel() {},
    getLatestSnapshot: () => solution,
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: solution.totalPopulation,
      activeOptimizer: solution.optimizer,
      autoStage: null,
      cpSatStatus: solution.cpSatStatus ?? null
    })
  });

  greedyBridgeModule.startGreedySolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
  cpSatModule.startCpSatSolve = () => ({
    promise: delay(0).then(() => {
      throw new Error("CP-SAT backend wrote a snapshot artifact but no final result.");
    }),
    cancel() {},
    getLatestSnapshot: () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" }),
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: 100,
      activeOptimizer: "cp-sat",
      autoStage: null,
      cpSatStatus: "OPTIMAL"
    })
  });

  try {
    const solution = await startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto"
      }
    ).promise;

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.cpSatStatus, "OPTIMAL");
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "optimal");
    assert.equal(solution.stoppedByUser, false);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

function testAutoSyncWallClockCapStopsRunningLnsStage() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  let observedStopFilePath = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = (grid, params) => {
    observedStopFilePath = params.lns.stopFilePath;
    const startedAt = Date.now();
    while (!fs.existsSync(observedStopFilePath) && Date.now() - startedAt < 5000) {
      // Busy-wait so the external stop watcher must interrupt an in-flight sync stage.
    }
    return buildMockSolution({
      optimizer: "lns",
      totalPopulation: 100,
      stoppedByUser: fs.existsSync(observedStopFilePath)
    });
  };

  try {
    const startedAt = Date.now();
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 5 },
        auto: { wallClockLimitSeconds: 2 }
      }
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(typeof observedStopFilePath, "string");
    assert.equal(solution.autoStage.stopReason, "wall-clock-cap");
    assert.equal(solution.activeOptimizer, "lns");
    assert.equal(solution.autoStage.activeStage, "lns");
    assert.ok(elapsedMs >= 1500 && elapsedMs < 5000);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
  }
}

function testAutoSyncWallClockCapKeepsExplicitStopReasonWhenLnsThrows() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  let observedStopFilePath = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = (grid, params) => {
    observedStopFilePath = params.lns.stopFilePath;
    const startedAt = Date.now();
    while (!fs.existsSync(observedStopFilePath) && Date.now() - startedAt < 5000) {
      // Busy-wait until the shared auto stop file fires, then emulate the stage aborting.
    }
    throw new Error("LNS noticed the stop file and aborted before returning a final solution.");
  };

  try {
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 5 },
        auto: { wallClockLimitSeconds: 2 }
      }
    );

    assert.equal(typeof observedStopFilePath, "string");
    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.activeOptimizer, "lns");
    assert.equal(solution.autoStage.activeStage, "lns");
    assert.equal(solution.autoStage.stopReason, "wall-clock-cap");
    assert.equal(solution.stoppedByUser, false);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
  }
}

function testAutoSyncReservesCpSatBudgetBeforeLnsStage() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let observedLnsOptions = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = (_grid, params) => {
    observedLnsOptions = params.lns;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 120 });
  };
  cpSatModule.solveCpSat = () =>
    buildMockSolution({ optimizer: "cp-sat", totalPopulation: 120, cpSatStatus: "OPTIMAL" });

  try {
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        lns: {
          iterations: 4,
          maxNoImprovementIterations: 4,
          seedTimeLimitSeconds: 5,
          repairTimeLimitSeconds: 0.5,
          focusedRepairTimeLimitSeconds: 0.75,
          escalatedRepairTimeLimitSeconds: 1.25
        },
        cpSat: { timeLimitSeconds: 5, noImprovementTimeoutSeconds: 5, numWorkers: 1 },
        auto: { wallClockLimitSeconds: 2.5 }
      }
    );

    assert.equal(solution.autoStage.stopReason, "optimal");
    assert(observedLnsOptions);
    assert.equal(typeof observedLnsOptions.wallClockLimitSeconds, "number");
    assert.ok(observedLnsOptions.wallClockLimitSeconds > 1);
    assert.ok(observedLnsOptions.wallClockLimitSeconds < 2);
    assert.ok(observedLnsOptions.seedTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.equal(observedLnsOptions.iterations, 4);
    assert.equal(observedLnsOptions.maxNoImprovementIterations, 4);
    assert.ok(observedLnsOptions.repairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.equal(observedLnsOptions.repairTimeLimitSeconds, 0.5);
    assert.equal(observedLnsOptions.focusedRepairTimeLimitSeconds, 0.75);
    assert.equal(observedLnsOptions.escalatedRepairTimeLimitSeconds, 1.25);
    assert.ok(observedLnsOptions.focusedRepairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.ok(observedLnsOptions.escalatedRepairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.ok(observedLnsOptions.escalatedRepairTimeLimitSeconds > observedLnsOptions.repairTimeLimitSeconds);
    assert.deepEqual(
      solution.autoStage.stageRuns.map((run) => run.stage),
      ["greedy", "lns", "cp-sat"]
    );
    assert.equal(solution.autoStage.stageRuns[1].improvement, 20);
    assert.equal(solution.autoStage.stageRuns[2].improvement, 0);
    assert.equal(solution.autoStage.stageRuns[2].cpSatStatus, "OPTIMAL");
    assert.equal(typeof solution.autoStage.stageRuns[1].elapsedSeconds, "number");
    const trace = buildDecisionTraceFromSolution(solution, { optimizer: "auto" });
    assert(
      trace.some(
        (event) =>
          event.kind === "auto-stage" &&
          event.activeStage === "lns" &&
          event.reason.includes("completed") &&
          event.evidence.improvement === 20
      )
    );
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoSyncUsesTraceTunedDefaultLnsBudget() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let observedLnsOptions = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = (_grid, params) => {
    observedLnsOptions = params.lns;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 140 });
  };
  cpSatModule.solveCpSat = () =>
    buildMockSolution({ optimizer: "cp-sat", totalPopulation: 140, cpSatStatus: "OPTIMAL" });

  try {
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        cpSat: { timeLimitSeconds: 9, noImprovementTimeoutSeconds: 5, numWorkers: 1 },
        auto: { wallClockLimitSeconds: 30 }
      }
    );

    assert.equal(solution.autoStage.stopReason, "optimal");
    assert(observedLnsOptions);
    assert.equal(observedLnsOptions.seedTimeLimitSeconds, 2);
    assert.equal(observedLnsOptions.repairTimeLimitSeconds, 2);
    assert.equal(observedLnsOptions.focusedRepairTimeLimitSeconds, 2);
    assert.equal(observedLnsOptions.escalatedRepairTimeLimitSeconds, 3);
    assert.equal(observedLnsOptions.maxNoImprovementIterations, observedLnsOptions.iterations);
    assert.ok(observedLnsOptions.iterations >= 10);
    assert.ok(observedLnsOptions.iterations <= 12);
    assert.ok(observedLnsOptions.wallClockLimitSeconds > 23);
    assert.ok(observedLnsOptions.wallClockLimitSeconds < 25);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoSyncGreedyCanRunPastFormerStageBudget() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let observedGreedyStopFilePath = null;
  let greedyStoppedByUser = null;
  let lnsCalled = false;
  let cpSatCalled = false;

  solverModule.solveGreedy = (grid, params) => {
    observedGreedyStopFilePath = params.greedy.stopFilePath;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1500 && !fs.existsSync(observedGreedyStopFilePath)) {
      // Busy-wait past the old 1s auto greedy-stage budget without triggering the shared stop file.
    }
    greedyStoppedByUser = fs.existsSync(observedGreedyStopFilePath);
    return buildMockSolution({
      optimizer: "greedy",
      totalPopulation: 100,
      stoppedByUser: greedyStoppedByUser
    });
  };
  lnsModule.solveLns = () => {
    lnsCalled = true;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 120 });
  };
  cpSatModule.solveCpSat = () => {
    cpSatCalled = true;
    return buildMockSolution({ optimizer: "cp-sat", totalPopulation: 120, cpSatStatus: "OPTIMAL" });
  };

  try {
    const startedAt = Date.now();
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 1 },
        cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
        auto: { wallClockLimitSeconds: 4 }
      }
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(typeof observedGreedyStopFilePath, "string");
    assert.equal(greedyStoppedByUser, false);
    assert.equal(lnsCalled, true);
    assert.equal(cpSatCalled, true);
    assert.equal(solution.totalPopulation, 120);
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "optimal");
    assert.ok(elapsedMs >= 1400 && elapsedMs < 4000);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

async function testAutoAsyncGreedyCanRunPastFormerStageBudget() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;
  let greedyResolve;
  let greedyCancelCalled = false;
  let lnsStarted = false;
  let cpSatStarted = false;

  greedyBridgeModule.startGreedySolve = () => {
    const snapshot = buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      greedyResolve({ ...snapshot, stoppedByUser: false });
    }, 1500);
    return {
      promise: new Promise((resolve) => {
        greedyResolve = resolve;
      }),
      cancel() {
        if (cancelled) return;
        cancelled = true;
        greedyCancelCalled = true;
        clearTimeout(timer);
        greedyResolve({ ...snapshot, stoppedByUser: true });
      },
      getLatestSnapshot: () => snapshot,
      getLatestSnapshotState: () => ({
        hasFeasibleSolution: true,
        totalPopulation: snapshot.totalPopulation,
        activeOptimizer: snapshot.optimizer,
        autoStage: null,
        cpSatStatus: null
      })
    };
  };
  lnsBridgeModule.startLnsSolve = () => {
    lnsStarted = true;
    const solution = buildMockSolution({ optimizer: "lns", totalPopulation: 120 });
    return {
      promise: Promise.resolve(solution),
      cancel() {},
      getLatestSnapshot: () => solution,
      getLatestSnapshotState: () => ({
        hasFeasibleSolution: true,
        totalPopulation: solution.totalPopulation,
        activeOptimizer: solution.optimizer,
        autoStage: null,
        cpSatStatus: null
      })
    };
  };
  cpSatModule.startCpSatSolve = () => {
    cpSatStarted = true;
    const solution = buildMockSolution({ optimizer: "cp-sat", totalPopulation: 120, cpSatStatus: "OPTIMAL" });
    return {
      promise: Promise.resolve(solution),
      cancel() {},
      getLatestSnapshot: () => solution,
      getLatestSnapshotState: () => ({
        hasFeasibleSolution: true,
        totalPopulation: solution.totalPopulation,
        activeOptimizer: solution.optimizer,
        autoStage: null,
        cpSatStatus: solution.cpSatStatus
      })
    };
  };

  try {
    const startedAt = Date.now();
    const solution = await startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        auto: { wallClockLimitSeconds: 4 }
      }
    ).promise;
    const elapsedMs = Date.now() - startedAt;

    assert.equal(greedyCancelCalled, false);
    assert.equal(lnsStarted, true);
    assert.equal(cpSatStarted, true);
    assert.equal(solution.totalPopulation, 120);
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.activeStage, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "optimal");
    assert.ok(elapsedMs >= 1400 && elapsedMs < 4000);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

function testAutoClampsHeavyGreedyStageSettings() {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  let capturedGreedyOptions = null;

  solverModule.solveGreedy = (grid, params) => {
    capturedGreedyOptions = params.greedy;
    return buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  };

  try {
    const solution = solveAuto(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        greedy: {
          localSearch: true,
          restarts: 20,
          serviceRefineIterations: 4,
          serviceRefineCandidateLimit: 60,
          exhaustiveServiceSearch: true,
          serviceMasterDecomposition: true,
          densityTieBreaker: true,
          densityTieBreakerTolerancePercent: 25,
          serviceExactPoolLimit: 22,
          serviceExactMaxCombinations: 12000,
          serviceMasterPoolLimit: 100,
          serviceMasterMaxLayouts: 50000
        },
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          repairTimeLimitSeconds: 1
        },
        cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
        auto: { wallClockLimitSeconds: 10 }
      }
    );

    assert.equal(solution.optimizer, "auto");
    assert.ok(capturedGreedyOptions);
    assert.equal(capturedGreedyOptions.restarts, 4);
    assert.equal(capturedGreedyOptions.serviceRefineIterations, 1);
    assert.equal(capturedGreedyOptions.serviceRefineCandidateLimit, 24);
    assert.equal(capturedGreedyOptions.exhaustiveServiceSearch, false);
    assert.equal(capturedGreedyOptions.densityTieBreaker, false);
    assert.equal(capturedGreedyOptions.densityTieBreakerTolerancePercent, 0);
    assert.equal(capturedGreedyOptions.serviceExactPoolLimit, 8);
    assert.equal(capturedGreedyOptions.serviceExactMaxCombinations, 512);
    assert.equal(capturedGreedyOptions.serviceMasterDecomposition, false);
    assert.equal(capturedGreedyOptions.serviceMasterPoolLimit, 12);
    assert.equal(capturedGreedyOptions.serviceMasterMaxLayouts, 256);
    assert.equal(capturedGreedyOptions.profile, true);
    assert.equal(solution.autoStage.greedySeedStage.restarts, 4);
    assert.equal(solution.autoStage.greedySeedStage.serviceRefineIterations, 1);
    assert.equal(solution.autoStage.greedySeedStage.exhaustiveServiceSearch, false);
    assert.equal(solution.autoStage.greedySeedStage.serviceMasterDecomposition, false);
    assert.equal(solution.autoStage.greedySeedStage.totalPopulation, 100);
    assert.equal(typeof solution.autoStage.greedySeedStage.elapsedSeconds, "number");
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
  }
}

async function testAutoAsyncClampsHeavyGreedyStageSettings() {
  const greedyBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const lnsBridgeModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const cpSatModule = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
  const originalStartGreedySolve = greedyBridgeModule.startGreedySolve;
  const originalStartLnsSolve = lnsBridgeModule.startLnsSolve;
  const originalStartCpSatSolve = cpSatModule.startCpSatSolve;
  let capturedGreedyOptions = null;

  const buildBackgroundHandle = (solution) => ({
    promise: Promise.resolve(solution),
    cancel() {},
    getLatestSnapshot: () => solution,
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: solution.totalPopulation,
      activeOptimizer: solution.optimizer,
      autoStage: null,
      cpSatStatus: solution.cpSatStatus ?? null
    })
  });

  greedyBridgeModule.startGreedySolve = (grid, params) => {
    capturedGreedyOptions = params.greedy;
    return buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  };
  lnsBridgeModule.startLnsSolve = () =>
    buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 120 }));
  cpSatModule.startCpSatSolve = () =>
    buildBackgroundHandle(
      buildMockSolution({
        optimizer: "cp-sat",
        totalPopulation: 120,
        cpSatStatus: "OPTIMAL"
      })
    );

  try {
    const solution = await startAutoSolve(
      [
        [1, 1],
        [1, 1]
      ],
      {
        optimizer: "auto",
        greedy: {
          localSearch: true,
          restarts: 20,
          serviceRefineIterations: 4,
          serviceRefineCandidateLimit: 60,
          exhaustiveServiceSearch: true,
          serviceMasterDecomposition: true,
          densityTieBreaker: true,
          densityTieBreakerTolerancePercent: 25,
          serviceExactPoolLimit: 22,
          serviceExactMaxCombinations: 12000,
          serviceMasterPoolLimit: 100,
          serviceMasterMaxLayouts: 50000
        },
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          repairTimeLimitSeconds: 1
        },
        cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
        auto: { wallClockLimitSeconds: 10 }
      }
    ).promise;

    assert.equal(solution.optimizer, "auto");
    assert.ok(capturedGreedyOptions);
    assert.equal(capturedGreedyOptions.restarts, 4);
    assert.equal(capturedGreedyOptions.serviceRefineIterations, 1);
    assert.equal(capturedGreedyOptions.serviceRefineCandidateLimit, 24);
    assert.equal(capturedGreedyOptions.exhaustiveServiceSearch, false);
    assert.equal(capturedGreedyOptions.densityTieBreaker, false);
    assert.equal(capturedGreedyOptions.densityTieBreakerTolerancePercent, 0);
    assert.equal(capturedGreedyOptions.serviceExactPoolLimit, 8);
    assert.equal(capturedGreedyOptions.serviceExactMaxCombinations, 512);
    assert.equal(capturedGreedyOptions.serviceMasterDecomposition, false);
    assert.equal(capturedGreedyOptions.serviceMasterPoolLimit, 12);
    assert.equal(capturedGreedyOptions.serviceMasterMaxLayouts, 256);
    assert.equal(capturedGreedyOptions.profile, true);
    assert.equal(solution.autoStage.greedySeedStage.restarts, 4);
    assert.equal(solution.autoStage.greedySeedStage.serviceRefineIterations, 1);
    assert.equal(solution.autoStage.greedySeedStage.exhaustiveServiceSearch, false);
    assert.equal(solution.autoStage.greedySeedStage.serviceMasterDecomposition, false);
    assert.equal(solution.autoStage.greedySeedStage.totalPopulation, 100);
    assert.equal(typeof solution.autoStage.greedySeedStage.elapsedSeconds, "number");
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

async function runAutoOptimizerTests() {
  await maybeTestAutoOptimizer();
  testAutoPreservesUserWarmStartMetadata();
  testAutoDirectRuntimeRejectsMalformedOptionValues();
  await testAutoAsyncStageErrorKeepsIncumbentWithExplicitStopReason();
  await testAutoAsyncRecoveredStageSnapshotKeepsNonRecoveryTerminalMetadata();
  testAutoSyncWallClockCapStopsRunningLnsStage();
  testAutoSyncWallClockCapKeepsExplicitStopReasonWhenLnsThrows();
  testAutoSyncUsesTraceTunedDefaultLnsBudget();
  testAutoSyncGreedyCanRunPastFormerStageBudget();
  await testAutoAsyncGreedyCanRunPastFormerStageBudget();
  testAutoClampsHeavyGreedyStageSettings();
  await testAutoAsyncClampsHeavyGreedyStageSettings();
}

module.exports = {
  runAutoOptimizerTests,
  testAutoKeepsEqualPopulationOptimalCpSatResult,
  testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns,
  testAutoAsyncRecoveredCpSatSnapshotKeepsCompletedMetadata,
  testAutoSyncReservesCpSatBudgetBeforeLnsStage
};
