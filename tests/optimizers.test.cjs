const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createGreedyBenchmarkSnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_GREEDY_BENCHMARK_OPTIONS,
  DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  DEFAULT_CP_SAT_BENCHMARK_OPTIONS,
  getOptimizerAdapter,
  formatGreedyBenchmarkSuite,
  listGreedyBenchmarkCaseNames,
  listOptimizerAdapters,
  normalizeGreedyBenchmarkOptions,
  resolveOptimizerName,
  listCpSatBenchmarkCaseNames,
  normalizeCpSatBenchmarkOptions,
  runGreedyBenchmarkSuite,
  runCpSatBenchmarkSuite,
  solve,
  solveAsync,
  solveAuto,
  solveGreedy,
  solveCpSat,
  solveCpSatAsync,
  solveLns,
  startAutoSolve,
  validateSolution,
  validateSolutionMap,
} = require("../dist/index.js");
const { parseCpSatRawSolution } = require("../dist/cp-sat/solver.js");
const { buildNeighborhoodWindows } = require("../dist/lns/solver.js");
const { roadSeedRow0Candidates, roadSeedRow0RepresentativeCandidates } = require("../dist/core/roads.js");

function testOptimizerRegistry() {
  assert.equal(resolveOptimizerName(undefined), "greedy");
  assert.equal(resolveOptimizerName({ optimizer: "auto" }), "auto");
  assert.equal(resolveOptimizerName({ optimizer: "cp-sat" }), "cp-sat");
  assert.equal(resolveOptimizerName({ optimizer: "lns" }), "lns");
  assert.equal(getOptimizerAdapter("auto").name, "auto");
  assert.equal(getOptimizerAdapter("greedy").name, "greedy");
  assert.equal(getOptimizerAdapter({ optimizer: "cp-sat" }).name, "cp-sat");
  assert.equal(getOptimizerAdapter("lns").name, "lns");
  assert.deepEqual(
    listOptimizerAdapters().map((adapter) => adapter.name).sort(),
    ["auto", "cp-sat", "greedy", "lns"]
  );
}

async function maybeTestAutoOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) return;

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "auto",
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
    },
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 1,
      noImprovementTimeoutSeconds: 1,
      numWorkers: 1,
    },
    auto: {
      wallClockLimitSeconds: 15,
    },
  };

  const solution = await solveAsync(grid, params);

  assert.equal(solution.optimizer, "auto");
  assert.equal(solution.totalPopulation, 100);
  assert.ok(solution.activeOptimizer === "greedy" || solution.activeOptimizer === "lns" || solution.activeOptimizer === "cp-sat");
  assert.ok(solution.autoStage);
  assert.ok(solution.autoStage.generatedSeeds.length >= 3);
  assert.ok(solution.autoStage.stopReason);
}

function testAutoKeepsEqualPopulationOptimalCpSatResult() {
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = () => buildMockSolution({ optimizer: "lns", totalPopulation: 100 });
  cpSatModule.solveCpSat = () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" });

  try {
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      auto: { wallClockLimitSeconds: 10 },
    });

    assert.equal(solution.cpSatStatus, "OPTIMAL");
    assert.equal(solution.activeOptimizer, "cp-sat");
    assert.equal(solution.autoStage.stopReason, "optimal");
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoPreservesUserWarmStartMetadata() {
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
    solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      cpSat: {
        timeLimitSeconds: 5,
        objectiveLowerBound: 70,
        warmStartHint: {
          sourceName: "checkpoint",
          modelFingerprint: "fingerprint-1",
          preferStrictImprove: true,
          objectiveLowerBound: 75,
          roads: ["0,0"],
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 55,
          },
        },
      },
      auto: { wallClockLimitSeconds: 10 },
    });

    assert.ok(capturedCpSatOptions);
    assert.equal(capturedCpSatOptions.warmStartHint.modelFingerprint, "fingerprint-1");
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

async function testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns() {
  const greedyBridgeModule = require("../dist/greedy/bridge.js");
  const lnsBridgeModule = require("../dist/lns/bridge.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
        cpSatStatus: solution.cpSatStatus ?? null,
      }),
    };
  };

  greedyBridgeModule.startGreedySolve = () => buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () => buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
  cpSatModule.startCpSatSolve = () => {
    cpSatStarted = true;
    return buildBackgroundHandle(buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" }), 50);
  };

  try {
    const handle = startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
      auto: { wallClockLimitSeconds: 10 },
    });

    while (!cpSatStarted) {
      await delay(5);
    }
    handle.cancel();

    const solution = await handle.promise;
    assert.equal(solution.autoStage.stopReason, "cancelled");
    assert.equal(solution.stoppedByUser, true);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

async function testAutoAsyncStageErrorKeepsIncumbentWithExplicitStopReason() {
  const greedyBridgeModule = require("../dist/greedy/bridge.js");
  const lnsBridgeModule = require("../dist/lns/bridge.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
      cpSatStatus: solution.cpSatStatus ?? null,
    }),
  });

  greedyBridgeModule.startGreedySolve = () => buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  lnsBridgeModule.startLnsSolve = () => buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 100 }));
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
      cpSatStatus: null,
    }),
  });

  try {
    const solution = await startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
    }).promise;

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.autoStage.stopReason, "stage-error");
    assert.equal(solution.stoppedByUser, false);
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
  }
}

function testAutoSyncWallClockCapStopsRunningLnsStage() {
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
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
      stoppedByUser: fs.existsSync(observedStopFilePath),
    });
  };

  try {
    const startedAt = Date.now();
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 5 },
      auto: { wallClockLimitSeconds: 2 },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(typeof observedStopFilePath, "string");
    assert.equal(solution.autoStage.stopReason, "wall-clock-cap");
    assert.equal(solution.activeOptimizer, "lns");
    assert.ok(elapsedMs >= 1500 && elapsedMs < 5000);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
  }
}

function resolveCpSatPython() {
  const venvPython = path.resolve(__dirname, "../.venv-cp-sat/bin/python");
  const candidates = [fs.existsSync(venvPython) ? venvPython : null, process.env.CITY_BUILDER_CP_SAT_PYTHON || null, "python3"].filter(
    Boolean
  );

  for (const pythonExecutable of candidates) {
    const importCheck = childProcess.spawnSync(pythonExecutable, ["-c", "import ortools"], {
      encoding: "utf8",
    });
    if (importCheck.status === 0) {
      return pythonExecutable;
    }
  }

  console.log("Skipping CP-SAT optimizer test because no Python runtime with OR-Tools is configured.");
  return null;
}

function buildMockSolution({
  optimizer = "greedy",
  totalPopulation = 0,
  cpSatStatus,
  stoppedByUser,
} = {}) {
  const hasPopulation = totalPopulation > 0;
  return {
    optimizer,
    ...(cpSatStatus ? { cpSatStatus } : {}),
    ...(stoppedByUser !== undefined ? { stoppedByUser } : {}),
    roads: new Set(["0,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: hasPopulation ? [{ r: 1, c: 1, rows: 2, cols: 2 }] : [],
    residentialTypeIndices: hasPopulation ? [-1] : [],
    populations: hasPopulation ? [totalPopulation] : [],
    totalPopulation,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testGreedyDispatcher() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { services: 0, residentials: 2 },
    greedy: { localSearch: false },
  };

  const dispatched = solve(grid, params);
  const direct = solveGreedy(grid, params);

  assert.equal(dispatched.optimizer, "greedy");
  assert.equal(dispatched.totalPopulation, direct.totalPopulation);
}

function testGreedyRandomSeedIsDeterministic() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 60, range: 1, avail: 1 },
      { rows: 2, cols: 3, bonus: 90, range: 1, avail: 1 },
      { rows: 3, cols: 2, bonus: 70, range: 2, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 180, avail: 2 },
      { w: 2, h: 3, min: 120, max: 260, avail: 2 },
    ],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: false,
      randomSeed: 17,
      restarts: 4,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };

  const first = solveGreedy(grid, params);
  const second = solveGreedy(grid, params);

  assert.equal(first.totalPopulation, second.totalPopulation);
  assert.deepEqual([...first.roads].sort(), [...second.roads].sort());
  assert.deepEqual(first.services, second.services);
  assert.deepEqual(first.serviceTypeIndices, second.serviceTypeIndices);
  assert.deepEqual(first.servicePopulationIncreases, second.servicePopulationIncreases);
  assert.deepEqual(first.residentials, second.residentials);
  assert.deepEqual(first.residentialTypeIndices, second.residentialTypeIndices);
  assert.deepEqual(first.populations, second.populations);
}

function testGreedyExploresAllAllowedRowZeroSeeds() {
  const grid = [
    [1, 0, 1, 0],
    [0, 0, 1, 1],
    [0, 0, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
    ],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 1, c: 2, rows: 2, cols: 2 }]);
  assert.deepEqual([...solution.roads].sort(), ["0,2"]);
}

function testGreedyExploresMultipleRowZeroSeedsWithinOneComponent() {
  const grid = [
    [1, 1, 1, 0, 0],
    [1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
    ],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 0, c: 0, rows: 2, cols: 2 }]);
  assert.deepEqual([...solution.roads].sort(), ["0,2"]);
}

function testGreedyExploresWideRowZeroAnchors() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0],
  ];
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 40, range: 1, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 50, avail: 3 },
      { w: 2, h: 3, min: 15, max: 60, avail: 2 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 120);
}

function testGreedyExploresAnchorsBeyondLegacyRepresentativeCap() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 20 },
      { w: 2, h: 3, min: 15, max: 15, avail: 20 },
    ],
    availableBuildings: { services: 0, residentials: 20 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 80);
}

function testRowZeroSeedCandidatesIncludeAllAllowedRowZeroCells() {
  const singleComponentGrid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const disconnectedComponentGrid = [
    [1, 0, 1, 1, 0, 1],
    [1, 0, 1, 1, 0, 0],
  ];
  const wideComponentGrid = [
    Array.from({ length: 20 }, () => 1),
    Array.from({ length: 20 }, () => 1),
  ];

  assert.deepEqual(
    roadSeedRow0Candidates(singleComponentGrid).map((seed) => [...seed][0]),
    ["0,0", "0,1", "0,2", "0,3"]
  );
  assert.deepEqual(
    roadSeedRow0Candidates(disconnectedComponentGrid).map((seed) => [...seed][0]),
    ["0,0", "0,2", "0,3", "0,5"]
  );
  const wideSeeds = roadSeedRow0Candidates(wideComponentGrid).map((seed) => [...seed][0]);
  assert.equal(wideSeeds.length, 20);
  assert.equal(wideSeeds[0], "0,0");
  assert.equal(wideSeeds[wideSeeds.length - 1], "0,19");
}

function testRepresentativeRowZeroSeedCandidatesStayExhaustive() {
  const wideGrid = [
    Array.from({ length: 40 }, () => 1),
    Array.from({ length: 40 }, () => 1),
  ];

  const representativeColumns = roadSeedRow0RepresentativeCandidates(wideGrid, 12)
    .map((seed) => Number([...seed][0].split(",")[1]));

  assert.equal(representativeColumns.length, 40);
  assert.equal(representativeColumns[0], 0);
  assert.equal(representativeColumns[representativeColumns.length - 1], 39);
  for (let index = 1; index < representativeColumns.length; index++) {
    assert.ok(representativeColumns[index] > representativeColumns[index - 1]);
  }
}

function testLnsNeighborhoodWindowsPrioritizeWeakServicesAndUpgradeHeadroom() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 30, range: 1, avail: 2 },
      { rows: 2, cols: 2, bonus: 180, range: 4, avail: 2 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 150, avail: 1 },
      { w: 2, h: 2, min: 100, max: 500, avail: 1 },
    ],
    availableBuildings: { services: 2, residentials: 2 },
    lns: {
      iterations: 3,
      maxNoImprovementIterations: 2,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      repairTimeLimitSeconds: 1,
    },
  };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [
      { r: 1, c: 4, rows: 2, cols: 2, range: 1 },
      { r: 1, c: 0, rows: 2, cols: 2, range: 4 },
    ],
    serviceTypeIndices: [0, 1],
    servicePopulationIncreases: [30, 180],
    residentials: [
      { r: 4, c: 0, rows: 2, cols: 2 },
      { r: 4, c: 4, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [1, 0],
    populations: [280, 150],
    totalPopulation: 430,
  };

  const windows = buildNeighborhoodWindows(grid, params, incumbent, {
    iterations: 3,
    maxNoImprovementIterations: 2,
    neighborhoodRows: 3,
    neighborhoodCols: 3,
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: "",
  });
  const indexOfWindow = (target) =>
    windows.findIndex((window) =>
      window.top === target.top
      && window.left === target.left
      && window.rows === target.rows
      && window.cols === target.cols
    );

  const weakServiceWindow = { top: 1, left: 3, rows: 3, cols: 3 };
  const strongServiceWindow = { top: 1, left: 0, rows: 3, cols: 3 };
  const highHeadroomResidentialWindow = { top: 3, left: 0, rows: 3, cols: 3 };
  const saturatedResidentialWindow = { top: 3, left: 3, rows: 3, cols: 3 };

  assert.equal(indexOfWindow(weakServiceWindow), 0);
  assert.ok(indexOfWindow(strongServiceWindow) > indexOfWindow(weakServiceWindow));
  assert.ok(indexOfWindow(highHeadroomResidentialWindow) >= 0);
  assert.ok(indexOfWindow(highHeadroomResidentialWindow) < indexOfWindow(saturatedResidentialWindow));
}

function testLnsNeighborhoodWindowsEscalateWhenStagnating() {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => 1));
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 40, range: 2, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 300, avail: 1 },
    ],
    lns: {
      iterations: 6,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 3,
      neighborhoodCols: 4,
      repairTimeLimitSeconds: 1,
    },
  };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "0,6", "0,7", "0,8", "0,9"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0,
  };
  const options = {
    iterations: 6,
    maxNoImprovementIterations: 4,
    neighborhoodRows: 3,
    neighborhoodCols: 4,
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: "",
  };

  const staleWindows = buildNeighborhoodWindows(grid, params, incumbent, options, 2);
  assert.deepEqual(staleWindows[0], { top: 1, left: 0, rows: 7, cols: 8 });
  assert.deepEqual(staleWindows[1], { top: 1, left: 2, rows: 7, cols: 8 });

  const finalStageWindows = buildNeighborhoodWindows(grid, params, incumbent, options, 4);
  assert.ok(
    finalStageWindows.some((window) =>
      window.top === 1 && window.left === 0 && window.rows === 7 && window.cols === 10
    )
  );
  assert.ok(
    finalStageWindows.some((window) =>
      window.top === 0 && window.left === 0 && window.rows === 8 && window.cols === 10
    )
  );
}

async function maybeTestCpSatOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
  };

  const solution = await solveAsync(grid, params);
  const direct = await solveCpSatAsync(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(typeof solution.cpSatObjectivePolicy?.populationWeight, "number");
  assert.equal(solution.cpSatObjectivePolicy?.summary, "maximize population, then minimize roads + services");
  assert.equal(typeof solution.cpSatTelemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof solution.cpSatTelemetry?.bestObjectiveBound, "number");
  assert.equal(typeof solution.cpSatTelemetry?.solutionCount, "number");
  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual([...solution.residentialTypeIndices].sort((a, b) => a - b), [0, 1]);
  assert.equal(direct.totalPopulation, 110);
}

function maybeTestCpSatSyncCompatibility() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
  };

  const dispatched = solve(grid, params);
  const direct = solveCpSat(grid, params);

  assert.match(dispatched.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(dispatched.totalPopulation, 10);
  assert.equal(direct.totalPopulation, 10);
}

async function maybeTestCpSatSupportsShapedServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 },
    },
    availableBuildings: { services: 1, residentials: 2 },
  };

  const solution = await solveAsync(grid, params);
  const direct = await solveCpSatAsync(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.services.length, 1);
  assert.equal(direct.services.length, 1);
  assert.deepEqual([...solution.serviceTypeIndices], [0]);
  assert.deepEqual([...solution.servicePopulationIncreases], [50]);
  assert.deepEqual([...direct.serviceTypeIndices], [0]);
  assert.deepEqual([...direct.servicePopulationIncreases], [50]);
  assert.deepEqual([solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b), [2, 3]);
  assert.equal(solution.services[0].range, 1);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function maybeTestCpSatBackendJsonContractSmoke() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 15, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 40, max: 55, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    cpSat: { timeLimitSeconds: 5, numWorkers: 1 },
  };

  const result = childProcess.spawnSync(
    pythonExecutable,
    [scriptPath],
    {
      input: JSON.stringify({ grid, params }),
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to run CP-SAT backend smoke test.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.status, "string");
  assert.match(payload.status, /^(OPTIMAL|FEASIBLE)$/);
  assert(Array.isArray(payload.roads));
  assert(Array.isArray(payload.services));
  assert(Array.isArray(payload.residentials));
  assert(Array.isArray(payload.populations));
  assert.equal(payload.populations.length, payload.residentials.length);
  assert.equal(payload.totalPopulation, payload.populations.reduce((sum, value) => sum + value, 0));
  assert.equal(typeof payload.objectivePolicy?.populationWeight, "number");
  assert.equal(typeof payload.objectivePolicy?.maxTieBreakPenalty, "number");
  assert.equal(typeof payload.objectivePolicy?.summary, "string");
  assert.equal(typeof payload.telemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof payload.telemetry?.userTimeSeconds, "number");
  assert.equal(typeof payload.telemetry?.solutionCount, "number");
  assert.equal(typeof payload.telemetry?.bestObjectiveBound, "number");
  assert.equal(typeof payload.telemetry?.objectiveGap, "number");
  assert.equal(typeof payload.telemetry?.bestPopulationUpperBound, "number");
  assert.equal(typeof payload.telemetry?.populationGapUpperBound, "number");
  assert.equal(typeof payload.telemetry?.lastImprovementAtSeconds, "number");
  assert.equal(typeof payload.telemetry?.secondsSinceLastImprovement, "number");
  assert.equal(typeof payload.telemetry?.numBranches, "number");
  assert.equal(typeof payload.telemetry?.numConflicts, "number");
}

function maybeTestCpSatBackendStreamingProtocol() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    cpSat: { timeLimitSeconds: 5, numWorkers: 1, streamProgress: true, progressIntervalSeconds: 0 },
  };

  const result = childProcess.spawnSync(pythonExecutable, [scriptPath], {
    input: JSON.stringify({ grid, params }),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to run CP-SAT backend streaming protocol test.");
  }

  const lines = result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert(lines.length >= 2);
  assert(lines.some((entry) => entry.event === "progress"));
  const finalEntry = lines.at(-1);
  assert.equal(finalEntry.event, "result");
  assert.equal(typeof finalEntry.payload.totalPopulation, "number");
}

function maybeTestCpSatObjectivePolicyHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 0, "range": 0, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 10, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)

print(json.dumps({
    "population_weight": built.objective_policy.population_weight,
    "max_tie_break_penalty": built.objective_policy.max_tie_break_penalty,
    "service_candidate_count": len(built.service_candidates),
    "cell_count": len(built.allowed_cells),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT objective policy helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.max_tie_break_penalty, payload.cell_count + payload.service_candidate_count);
  assert.equal(payload.population_weight, payload.max_tie_break_penalty + 1);
}

function maybeTestCpSatRuntimeOptionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

solver = module.cp_model.CpSolver()
module.configure_solver_parameters(solver, {
    "timeLimitSeconds": 7,
    "maxDeterministicTime": 3.5,
    "numWorkers": 1,
    "randomSeed": 42,
    "randomizeSearch": True,
    "relativeGapLimit": 0.125,
    "absoluteGapLimit": 9,
    "logSearchProgress": True,
})

print(json.dumps({
    "max_time_in_seconds": solver.parameters.max_time_in_seconds,
    "max_deterministic_time": solver.parameters.max_deterministic_time,
    "num_search_workers": solver.parameters.num_search_workers,
    "random_seed": solver.parameters.random_seed,
    "randomize_search": solver.parameters.randomize_search,
    "relative_gap_limit": solver.parameters.relative_gap_limit,
    "absolute_gap_limit": solver.parameters.absolute_gap_limit,
    "log_search_progress": solver.parameters.log_search_progress,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT runtime option helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.max_time_in_seconds, 7);
  assert.equal(payload.max_deterministic_time, 3.5);
  assert.equal(payload.num_search_workers, 1);
  assert.equal(payload.random_seed, 42);
  assert.equal(payload.randomize_search, true);
  assert.equal(payload.relative_gap_limit, 0.125);
  assert.equal(payload.absolute_gap_limit, 9);
  assert.equal(payload.log_search_progress, true);

  const noLimitCommand = `
import importlib.util
import json
import math

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

baseline_solver = module.cp_model.CpSolver()
solver = module.cp_model.CpSolver()
module.configure_solver_parameters(solver, {
    "numWorkers": 1,
})

print(json.dumps({
    "baseline_is_infinite": math.isinf(baseline_solver.parameters.max_time_in_seconds),
    "configured_is_infinite": math.isinf(solver.parameters.max_time_in_seconds),
    "baseline_max_time_in_seconds": None if math.isinf(baseline_solver.parameters.max_time_in_seconds) else baseline_solver.parameters.max_time_in_seconds,
    "configured_max_time_in_seconds": None if math.isinf(solver.parameters.max_time_in_seconds) else solver.parameters.max_time_in_seconds,
}))
`;

  const noLimitResult = childProcess.spawnSync(pythonExecutable, ["-c", noLimitCommand], {
    encoding: "utf8",
  });
  if (noLimitResult.status !== 0) {
    throw new Error(noLimitResult.stderr?.trim() || noLimitResult.stdout?.trim() || "Failed to inspect CP-SAT default time limit behavior.");
  }

  const noLimitPayload = JSON.parse(noLimitResult.stdout);
  assert.equal(noLimitPayload.configured_is_infinite, noLimitPayload.baseline_is_infinite);
  assert.equal(noLimitPayload.configured_max_time_in_seconds, noLimitPayload.baseline_max_time_in_seconds);
}

function maybeTestCpSatWarmStartHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 30, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 40, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)
module.apply_warm_start_hints(built.model, built, {
    "roads": ["0,0", "0,1"],
    "services": [{"r": 1, "c": 2, "rows": 1, "cols": 1, "range": 1, "typeIndex": 0, "bonus": 30}],
    "residentials": [{"r": 0, "c": 0, "rows": 2, "cols": 2, "typeIndex": 0, "population": 40}],
    "totalPopulation": 40,
})
module.apply_objective_lower_bound(built.model, built, 40)

hint_proto = built.model.Proto().solution_hint
vars_to_values = dict(zip(hint_proto.vars, hint_proto.values))

print(json.dumps({
    "hint_count": len(hint_proto.vars),
    "total_population_hinted": vars_to_values.get(built.total_population.Index()),
    "total_services_hinted": vars_to_values.get(built.total_services.Index()),
    "total_roads_hinted": vars_to_values.get(built.total_roads.Index()),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT warm-start helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert(payload.hint_count > 0);
  assert.equal(payload.total_population_hinted, 40);
  assert.equal(payload.total_services_hinted, 1);
  assert.equal(payload.total_roads_hinted, 2);
}

function maybeTestCpSatSnapshotResponseHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_runtime_support.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_runtime_support", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Policy:
    population_weight = 17
    max_tie_break_penalty = 16
    tie_break_summary = "maximize population, then minimize roads + services"

class Built:
    objective_policy = Policy()

telemetry = module.CpSatTelemetry(
    solve_wall_time_seconds=1.25,
    user_time_seconds=1.2,
    solution_count=3,
    incumbent_objective_value=42.0,
    best_objective_bound=45.0,
    objective_gap=3.0,
    incumbent_population=40,
    best_population_upper_bound=43,
    population_gap_upper_bound=3,
    last_improvement_at_seconds=0.8,
    seconds_since_last_improvement=0.45,
    num_branches=12,
    num_conflicts=1,
)

response = module.build_snapshot_response(
    {
        "roads": ["0,0"],
        "services": [],
        "residentials": [],
        "populations": [],
        "totalPopulation": 40,
    },
    Built(),
    "FEASIBLE",
    telemetry,
    stopped_by_user=True,
)

print(json.dumps(response))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT snapshot response helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.stoppedByUser, true);
  assert.equal(payload.totalPopulation, 40);
  assert.equal(payload.objectivePolicy.populationWeight, 17);
  assert.equal(payload.telemetry.incumbentPopulation, 40);
}

function maybeTestCpSatNoImprovementTimeoutHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImmediateTimer:
    started = 0

    def __init__(self, interval, function):
        self.interval = interval
        self.function = function
        self.daemon = False

    def start(self):
        ImmediateTimer.started += 1
        self.function()

    def cancel(self):
        pass

module.threading.Timer = ImmediateTimer

grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 30, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 40, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

result = module.solve_single_cp_sat(grid, params, {
    "timeLimitSeconds": 5,
    "numWorkers": 1,
    "noImprovementTimeoutSeconds": 1,
})

print(json.dumps({
    "timer_started": ImmediateTimer.started,
    "feasible": result.feasible,
    "status": result.status,
    "stopped_by_user": None if result.response is None else result.response.get("stoppedByUser"),
    "total_population": result.total_population,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT no-improvement timeout helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert(payload.timer_started >= 1);
  assert.equal(payload.feasible, true);
  assert.equal(payload.stopped_by_user, false);
  assert.equal(typeof payload.total_population, "number");
}

function maybeTestCpSatSnapshotWritesTelemetry() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const snapshotFilePath = path.join(os.tmpdir(), `city-builder-test-cp-sat-snapshot-${process.pid}.json`);
  fs.rmSync(snapshotFilePath, { force: true });
  const command = `
import importlib.util
import json
import os

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
]
params = {
    "residentialTypes": [
        {"w": 2, "h": 2, "min": 10, "max": 10, "avail": 1},
        {"w": 2, "h": 2, "min": 100, "max": 100, "avail": 1},
    ],
    "availableBuildings": {"residentials": 2, "services": 0},
}

result = module.solve_single_cp_sat(grid, params, {
    "timeLimitSeconds": 5,
    "numWorkers": 1,
    "snapshotFilePath": ${JSON.stringify(snapshotFilePath)},
})

snapshot = None
if os.path.exists(${JSON.stringify(snapshotFilePath)}):
    with open(${JSON.stringify(snapshotFilePath)}, "r", encoding="utf-8") as handle:
        snapshot = json.load(handle)

print(json.dumps({
    "status": result.status,
    "snapshot_exists": snapshot is not None,
    "snapshot_has_telemetry": snapshot is not None and snapshot.get("telemetry") is not None,
    "snapshot_incumbent_population": None if snapshot is None else snapshot.get("telemetry", {}).get("incumbentPopulation"),
    "snapshot_solution_count": None if snapshot is None else snapshot.get("telemetry", {}).get("solutionCount"),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  fs.rmSync(snapshotFilePath, { force: true });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT snapshot telemetry output.");
  }

  const payload = JSON.parse(result.stdout);
  assert.match(payload.status ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(payload.snapshot_exists, true);
  assert.equal(payload.snapshot_has_telemetry, true);
  assert.equal(typeof payload.snapshot_incumbent_population, "number");
  assert.equal(typeof payload.snapshot_solution_count, "number");
}

async function maybeTestCpSatWarmStartContinuation() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    greedy: { localSearch: false, restarts: 1 },
  };

  const seed = solveGreedy(grid, params);
  const continued = await solveCpSatAsync(grid, {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
      randomSeed: 7,
      warmStartHint: seed,
      objectiveLowerBound: seed.totalPopulation,
    },
  });

  assert.match(continued.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert(continued.totalPopulation >= seed.totalPopulation);
}

function maybeTestCpSatPortfolioOptionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

worker_options = module.build_portfolio_worker_options({
    "timeLimitSeconds": 12,
    "maxDeterministicTime": 6,
    "numWorkers": 8,
    "stopFilePath": "/tmp/shared-stop-token",
    "snapshotFilePath": "/tmp/shared-snapshot.json",
    "portfolio": {
        "randomSeeds": [7, 9],
        "perWorkerTimeLimitSeconds": 2,
        "perWorkerMaxDeterministicTime": 1.5,
        "perWorkerNumWorkers": 1,
        "randomizeSearch": True,
    }
})

print(json.dumps(worker_options))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT portfolio option helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.length, 2);
  assert.deepEqual(
    payload.map((worker) => ({
      randomSeed: worker.randomSeed,
      timeLimitSeconds: worker.timeLimitSeconds,
      maxDeterministicTime: worker.maxDeterministicTime,
      numWorkers: worker.numWorkers,
      randomizeSearch: worker.randomizeSearch,
      stopFilePath: worker.stopFilePath,
      hasSnapshotFilePath: Object.prototype.hasOwnProperty.call(worker, "snapshotFilePath"),
      hasPortfolio: Object.prototype.hasOwnProperty.call(worker, "portfolio"),
    })),
    [
      {
        randomSeed: 7,
        timeLimitSeconds: 2,
        maxDeterministicTime: 1.5,
        numWorkers: 1,
        randomizeSearch: true,
        stopFilePath: "/tmp/shared-stop-token",
        hasSnapshotFilePath: false,
        hasPortfolio: false,
      },
      {
        randomSeed: 9,
        timeLimitSeconds: 2,
        maxDeterministicTime: 1.5,
        numWorkers: 1,
        randomizeSearch: true,
        stopFilePath: "/tmp/shared-stop-token",
        hasSnapshotFilePath: false,
        hasPortfolio: false,
      },
    ]
  );
}

function testCpSatPortfolioExecutorFallbackHelpers() {
  const scriptPath = path.resolve(__dirname, "../python/cp_sat_portfolio_support.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_portfolio_support", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RaisingProcessExecutor:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, *args, **kwargs):
        raise PermissionError("process pool blocked")

class FakeFuture:
    def __init__(self, value):
        self._value = value
    def result(self):
        return self._value

class FakeThreadExecutor:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, fn, *args, **kwargs):
        return FakeFuture(fn(*args, **kwargs))

module.concurrent.futures.ProcessPoolExecutor = RaisingProcessExecutor
module.concurrent.futures.ThreadPoolExecutor = FakeThreadExecutor
module.concurrent.futures.as_completed = lambda futures: futures

results = module.run_portfolio_workers(
    [[1]],
    {"optimizer": "cp-sat"},
    [{"randomSeed": 7}, {"randomSeed": 9}],
    lambda grid, params, worker_option, worker_index: {"workerIndex": worker_index, "seed": worker_option["randomSeed"]},
)
print(json.dumps(results))
`;

  const result = childProcess.spawnSync("python3", ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT portfolio fallback helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, [
    { workerIndex: 0, seed: 7 },
    { workerIndex: 1, seed: 9 },
  ]);
}

async function maybeTestCpSatPortfolioSolve() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const solution = await solveCpSatAsync(grid, {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      portfolio: {
        randomSeeds: [3, 11],
        perWorkerTimeLimitSeconds: 2,
        perWorkerNumWorkers: 1,
      },
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
  });

  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.totalPopulation, 110);
  assert.equal(solution.cpSatPortfolio?.workerCount, 2);
  assert.equal(solution.cpSatPortfolio?.workers.length, 2);
  assert.equal(typeof solution.cpSatPortfolio?.selectedWorkerIndex, "number");
  assert(solution.cpSatPortfolio?.workers.some((worker) => worker.feasible));
  assert(
    solution.cpSatPortfolio?.workers.some((worker) => worker.workerIndex === solution.cpSatPortfolio?.selectedWorkerIndex)
  );
}

async function maybeTestCpSatAsyncOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
  };

  const progressUpdates = [];
  const dispatched = await solveAsync(grid, params, {
    onProgress: (update) => progressUpdates.push(update),
    progressIntervalSeconds: 0,
  });
  const direct = await solveCpSatAsync(grid, params, {
    onProgress: (update) => progressUpdates.push(update),
    progressIntervalSeconds: 0,
  });

  assert.match(dispatched.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(dispatched.totalPopulation, 110);
  assert.equal(direct.totalPopulation, 110);
  assert(progressUpdates.length > 0);
  assert(progressUpdates.some((update) => update.kind === "incumbent" || update.kind === "bound"));
}

async function testCpSatBenchmarkCorpusHelpers() {
  const names = DEFAULT_CP_SAT_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(listCpSatBenchmarkCaseNames(), names);

  const normalized = normalizeCpSatBenchmarkOptions(
    {
      timeLimitSeconds: 12,
      portfolio: {
        workerCount: 2,
      },
    },
    {
      randomSeed: 7,
    }
  );

  assert.equal(normalized.timeLimitSeconds, 12);
  assert.equal(normalized.maxDeterministicTime, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.maxDeterministicTime);
  assert.equal(normalized.numWorkers, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.numWorkers);
  assert.equal(normalized.randomSeed, 7);
  assert.equal(normalized.randomizeSearch, false);
  assert.equal(normalized.progressIntervalSeconds, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.progressIntervalSeconds);
  assert.deepEqual(normalized.portfolio?.randomSeeds, [7, 108]);
  assert.equal(normalized.portfolio?.workerCount, 2);
  assert.equal(normalized.portfolio?.perWorkerTimeLimitSeconds, 12);
  assert.equal(normalized.portfolio?.perWorkerMaxDeterministicTime, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.maxDeterministicTime);
  assert.equal(normalized.portfolio?.perWorkerNumWorkers, 1);

  const normalizedWithExplicitSeeds = normalizeCpSatBenchmarkOptions(
    {
      portfolio: {
        workerCount: 99,
        randomSeeds: [2, 5, 8],
      },
    },
    undefined
  );

  assert.equal(normalizedWithExplicitSeeds.portfolio?.workerCount, 3);
  assert.deepEqual(normalizedWithExplicitSeeds.portfolio?.randomSeeds, [2, 5, 8]);

  await assert.rejects(
    () => runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown CP-SAT benchmark case\(s\): missing-case/
  );
}

function testGreedyBenchmarkCorpusHelpers() {
  const names = DEFAULT_GREEDY_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(listGreedyBenchmarkCaseNames(), names);

  const normalized = normalizeGreedyBenchmarkOptions(
    {
      localSearch: false,
      restarts: 4,
    },
    {
      randomSeed: 13,
    }
  );

  assert.equal(normalized.localSearch, false);
  assert.equal(normalized.profile, true);
  assert.equal(normalized.randomSeed, 13);
  assert.equal(normalized.restarts, 4);
  assert.equal(normalized.serviceRefineIterations, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineIterations);
  assert.equal(
    normalized.serviceRefineCandidateLimit,
    DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineCandidateLimit
  );
  assert.equal(normalized.exhaustiveServiceSearch, false);
  assert.equal(normalized.serviceExactPoolLimit, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactPoolLimit);
  assert.equal(
    normalized.serviceExactMaxCombinations,
    DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactMaxCombinations
  );

  assert.throws(
    () => runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown greedy benchmark case\(s\): missing-case/
  );

  const legacyResult = runGreedyBenchmarkSuite(
    [
      {
        name: "legacy-top-level",
        description: "Legacy top-level greedy options stay consistent in benchmarks.",
        grid: [
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        params: {
          optimizer: "greedy",
          residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
          availableBuildings: { services: 0, residentials: 1 },
          localSearch: false,
          restarts: 4,
          serviceRefineIterations: 0,
          serviceRefineCandidateLimit: 3,
          exhaustiveServiceSearch: false,
          serviceExactPoolLimit: 3,
          serviceExactMaxCombinations: 12,
        },
      },
    ],
    undefined
  );

  assert.equal(legacyResult.results[0].greedyOptions.localSearch, false);
  assert.equal(legacyResult.results[0].greedyOptions.restarts, 4);
}

function testGreedyBenchmarkSuite() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["cap-sweep-mixed"],
  });
  const snapshot = createGreedyBenchmarkSnapshot(result);

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["cap-sweep-mixed"]);
  assert.equal(result.results[0].name, "cap-sweep-mixed");
  assert.equal(result.results[0].greedyOptions.profile, true);
  assert(result.results[0].wallClockSeconds >= 0);
  assert(result.results[0].greedyProfile);
  assert(result.results[0].greedyProfile.counters.precompute.serviceCandidates > 0);
  assert(result.results[0].greedyProfile.counters.attempts.serviceCaps > 0);
  assert(result.results[0].greedyProfile.counters.precompute.residentialPopulationCacheEntries > 0);
  assert(result.results[0].greedyProfile.counters.residentialPhase.populationCacheLookups > 0);
  assert(result.results[0].greedyProfile.counters.localSearch.populationCacheLookups > 0);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.results[0], "wallClockSeconds"), false);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-sweep-mixed/);
  assert.match(formatGreedyBenchmarkSuite(result), /pop-cache=/);
}

function testGreedyConnectivityHeavyBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["bridge-connectivity-heavy"],
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["bridge-connectivity-heavy"]);
  assert.equal(result.results[0].name, "bridge-connectivity-heavy");
  assert.equal(result.results[0].greedyProfile.counters.roads.canConnectChecks > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeCalls > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeReuses > 0, true);
  assert.equal(result.results[0].totalPopulation > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /bridge-connectivity-heavy/);
  assert.match(formatGreedyBenchmarkSuite(result), /reuse=/);
}

async function maybeTestCpSatBenchmarkSuite() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const result = await runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      maxDeterministicTime: 5,
      numWorkers: 1,
      randomSeed: 13,
      progressIntervalSeconds: 0,
    },
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["compact-service-single"]);
  assert.equal(result.results[0].name, "compact-service-single");
  assert.match(result.results[0].cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(result.results[0].cpSatOptions.randomSeed, 13);
  assert(result.results[0].wallClockSeconds >= 0);
  assert.equal(typeof result.results[0].cpSatTelemetry?.solveWallTimeSeconds, "number");
  assert(result.results[0].progressTimeline.length > 0);

  const withoutTimeline = await runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
    includeProgressTimeline: false,
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      maxDeterministicTime: 5,
      numWorkers: 1,
      randomSeed: 13,
    },
  });

  assert.equal(withoutTimeline.results[0].progressTimeline.length, 0);

  const continuationGrid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const continuationParams = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    greedy: { localSearch: false, restarts: 1 },
  };
  const seed = solveGreedy(continuationGrid, continuationParams);
  const continuationBenchmark = await runCpSatBenchmarkSuite(
    [
      {
        name: "continued-single",
        description: "Continuation benchmark with a Solution warm start.",
        grid: continuationGrid,
        params: {
          ...continuationParams,
          optimizer: "cp-sat",
          cpSat: {
            warmStartHint: seed,
            objectiveLowerBound: seed.totalPopulation,
          },
        },
      },
    ],
    {
      cpSat: {
        pythonExecutable,
        timeLimitSeconds: 5,
        maxDeterministicTime: 5,
        numWorkers: 1,
        randomSeed: 19,
        progressIntervalSeconds: 0,
      },
    }
  );

  assert.match(continuationBenchmark.results[0].cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert(continuationBenchmark.results[0].cpSatOptions.warmStartHint);
  assert(continuationBenchmark.results[0].cpSatOptions.warmStartHint.roads instanceof Set);
}

function testCpSatRejectsDuplicatePortfolioWorkerIndices() {
  assert.throws(
    () =>
      parseCpSatRawSolution(
        JSON.stringify({
          status: "FEASIBLE",
          roads: ["0,0"],
          services: [],
          residentials: [],
          populations: [],
          totalPopulation: 0,
          portfolio: {
            workerCount: 2,
            selectedWorkerIndex: 0,
            workers: [
              {
                workerIndex: 0,
                randomSeed: 1,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0,
              },
              {
                workerIndex: 0,
                randomSeed: 2,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0,
              },
            ],
          },
        })
      ),
    /portfolio\.workers must have unique workerIndex values/
  );
}

function testCpSatRejectsDanglingSelectedPortfolioWorkerIndex() {
  assert.throws(
    () =>
      parseCpSatRawSolution(
        JSON.stringify({
          status: "FEASIBLE",
          roads: ["0,0"],
          services: [],
          residentials: [],
          populations: [],
          totalPopulation: 0,
          portfolio: {
            workerCount: 1,
            selectedWorkerIndex: 99,
            workers: [
              {
                workerIndex: 0,
                randomSeed: 1,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0,
              },
            ],
          },
        })
      ),
    /portfolio\.selectedWorkerIndex must reference a listed worker/
  );
}

function maybeTestCpSatPopulationUpperBoundHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
]
params = {
    "residentialTypes": [
        {"w": 2, "h": 2, "min": 10, "max": 100, "avail": 1},
        {"w": 2, "h": 2, "min": 10, "max": 40, "avail": 3},
    ],
    "availableBuildings": {"residentials": 2, "services": 0},
}

built = module.build_model(grid, params)

print(json.dumps({
    "total_population_upper_bound": built.total_population_upper_bound,
    "residential_candidate_count": len(built.residential_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT population upper bound helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.total_population_upper_bound, 20);
  assert(payload.residential_candidate_count > 2);
}

function maybeTestCpSatResidentialPopulationUpperBoundHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 30, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 100, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)
top_left = next(candidate for candidate in built.residential_candidates if candidate["r"] == 0 and candidate["c"] == 0)

print(json.dumps({
    "population_upper_bound": top_left["populationUpperBound"],
    "total_population_upper_bound": built.total_population_upper_bound,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT residential population upper bounds.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.population_upper_bound, 40);
  assert.equal(payload.total_population_upper_bound, 40);
}

function maybeTestCpSatPrunesObjectivelyUselessServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 0, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 20, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)

print(json.dumps({
    "service_candidate_count": len(built.service_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT useless service pruning.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.service_candidate_count, 0);
}

function maybeTestCpSatBorderAccessCapacityHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

candidates = [
    {"r": 0, "border": [0, 1]},
    {"r": 1, "border": [1, 2]},
    {"r": 2, "border": [2, 3]},
]
indices, coefficients = module.build_border_access_capacity_coefficients(5, candidates)

print(json.dumps({
    "indices": indices,
    "coefficients": coefficients,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT border access capacity helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.indices, [1, 2]);
  assert.deepEqual(payload.coefficients, [0, 1, 2, 1, 0]);
}

function maybeTestCpSatGateRequirementHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

road_neighbor_ids = {
    0: [1],
    1: [0, 2, 3],
    2: [1],
    3: [1, 4],
    4: [3],
}
road_eligible_ids = {0, 1, 2, 3, 4}
eligible_row0_ids = [0]

gate_downstream = module.compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_row0_ids)
candidates = [
    {"r": 2, "border": [4]},
    {"r": 2, "border": [2, 0]},
    {"r": 0, "border": [4]},
]
gate_requirements = module.compute_candidate_gate_requirements(candidates, gate_downstream, road_eligible_ids)

print(json.dumps({
    "gate_downstream": {str(key): sorted(value) for key, value in gate_downstream.items()},
    "gate_requirements": {str(key): value for key, value in gate_requirements.items()},
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT gate requirement helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.gate_downstream, {
    0: [1, 2, 3, 4],
    1: [2, 3, 4],
    3: [4],
  });
  assert.deepEqual(payload.gate_requirements, {
    0: [0, 1, 3],
    1: [0],
  });
}

function maybeTestCpSatGateRegionalCapacityHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

candidates = [
    {"border": [0, 1, 4]},
    {"border": [1, 2, 4]},
    {"border": [2, 3]},
]
coefficients = module.build_gate_regional_capacity_coefficients(candidates, [0, 1], {1, 2, 4})

print(json.dumps({
    "coefficients": {str(key): value for key, value in coefficients.items()},
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT gate regional capacity helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.coefficients, {
    1: 2,
    2: 1,
    4: 2,
  });
}

async function maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 0, 1],
    [1, 1, 0, 1],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
    [0, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
  };

  const solution = await solveCpSatAsync(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.roads.size, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.residentials[0].c, 0);
}

async function maybeTestCpSatObjectiveAvoidsUselessServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    serviceTypes: [{ rows: 1, cols: 1, bonus: 0, range: 0, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
  };

  const solution = await solveCpSatAsync(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.services.length, 0);
}

function maybeTestLnsOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5,
    },
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
    },
    serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 180, avail: 2 },
      { w: 2, h: 3, min: 130, max: 260, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    greedy: {
      localSearch: true,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 10,
      exhaustiveServiceSearch: false,
    },
  };

  const greedySeed = solveGreedy(grid, { ...params, optimizer: "greedy" });
  const solution = solve(grid, params);
  const direct = solveLns(grid, params);
  const seeded = solveLns(grid, {
    ...params,
    lns: {
      ...params.lns,
      seedHint: {
        solution: {
          roads: [...greedySeed.roads],
          services: greedySeed.services.map((service, index) => ({
            r: service.r,
            c: service.c,
            rows: service.rows,
            cols: service.cols,
            range: service.range,
            typeIndex: greedySeed.serviceTypeIndices[index] ?? -1,
            bonus: greedySeed.servicePopulationIncreases[index] ?? 0,
          })),
          residentials: greedySeed.residentials.map((residential, index) => ({
            r: residential.r,
            c: residential.c,
            rows: residential.rows,
            cols: residential.cols,
            typeIndex: greedySeed.residentialTypeIndices[index] ?? -1,
            population: greedySeed.populations[index] ?? 0,
          })),
          populations: [...greedySeed.populations],
          totalPopulation: greedySeed.totalPopulation,
        },
      },
    },
  });

  assert.equal(solution.optimizer, "lns");
  assert.equal(direct.optimizer, "lns");
  assert.equal(seeded.optimizer, "lns");
  assert.ok(solution.totalPopulation >= greedySeed.totalPopulation);
  assert.ok(direct.totalPopulation >= greedySeed.totalPopulation);
  assert.ok(seeded.totalPopulation >= greedySeed.totalPopulation);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testLnsRejectsInvalidSeedHint() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "lns",
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      seedHint: {
        solution: {
          roads: ["0,2", "1,2"],
          services: [],
          residentials: [
            { r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 },
            { r: 2, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 },
          ],
          populations: [10, 10],
          totalPopulation: 20,
        },
      },
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  assert.throws(
    () => solveLns(grid, params),
    /Invalid solver input: LNS seed hint is invalid:/
  );
}

function testLnsRejectsMalformedSeedHintFields() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "lns",
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      seedHint: {
        solution: {
          roads: [],
          services: [],
          residentials: [
            { r: null, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 },
          ],
          populations: [10],
          totalPopulation: 10,
        },
      },
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  assert.throws(
    () => solveLns(grid, params),
    /Invalid solver input: LNS seed hint solution\.residentials\[0\]\.r must be an integer >= 0\./
  );
}

function maybeTestLnsExploresMultipleRowZeroSeeds() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 0, 1, 0],
    [0, 0, 1, 1],
    [0, 0, 1, 1],
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5,
    },
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveLns(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.totalPopulation, 10);
  assert.equal(validation.valid, true);
}

function maybeTestLnsCanRepairRowZeroAnchorLayouts() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      repairTimeLimitSeconds: 5,
      neighborhoodRows: 3,
      neighborhoodCols: 6,
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 20 },
      { w: 2, h: 3, min: 15, max: 15, avail: 20 },
    ],
    availableBuildings: { residentials: 20, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const greedySolution = solveGreedy(grid, params);
  const solution = solveLns(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(greedySolution.totalPopulation, 80);
  assert.equal(solution.totalPopulation, 90);
  assert.notDeepEqual([...solution.roads].sort(), [...greedySolution.roads].sort());
  assert.equal(validation.valid, true);
}

function testLnsRunsFinalEscalationWithinConfiguredBudget() {
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const seenWindows = [];

  cpSatModule.solveCpSat = (grid, params) => {
    seenWindows.push({ ...params.cpSat.warmStartHint.neighborhoodWindow });
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(["0,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0,
    };
  };

  try {
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => 1));
    solveLns(grid, {
      optimizer: "lns",
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 4,
        neighborhoodRows: 3,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 1,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0,
          },
        },
      },
    });
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }

  assert.equal(seenWindows.length, 4);
  assert.deepEqual(seenWindows[0], { top: 1, left: 0, rows: 3, cols: 4 });
  assert.deepEqual(seenWindows[1], { top: 1, left: 0, rows: 7, cols: 8 });
  assert.deepEqual(seenWindows[2], { top: 1, left: 2, rows: 7, cols: 8 });
  assert.deepEqual(seenWindows[seenWindows.length - 1], { top: 0, left: 0, rows: 8, cols: 10 });
}

function testLnsDeterministicServiceUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-lns-upgrade-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const params = {
      optimizer: "lns",
      cpSat: {
        timeLimitSeconds: 1,
        numWorkers: 1,
      },
      serviceTypes: [
        { rows: 2, cols: 2, bonus: 118, range: 5, avail: 1 },
        { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 },
      ],
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 600, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        repairTimeLimitSeconds: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        stopFilePath,
        seedHint: {
          solution: {
            roads: ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"],
            services: [
              {
                r: 1,
                c: 1,
                rows: 2,
                cols: 2,
                range: 5,
                typeIndex: 0,
                bonus: 118,
              },
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 218,
              },
            ],
            populations: [218],
            totalPopulation: 218,
          },
        },
      },
    };

    const solution = solveLns(grid, params);
    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.serviceTypeIndices[0], 1);
    assert.equal(solution.servicePopulationIncreases[0], 480);
    assert.equal(solution.totalPopulation, 580);
    assert.equal(solution.populations[0], 580);

    const validation = validateSolution({ grid, solution, params });
    assert.equal(validation.valid, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testLnsDeterministicResidentialUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-lns-res-upgrade-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const params = {
      optimizer: "lns",
      cpSat: {
        timeLimitSeconds: 1,
        numWorkers: 1,
      },
      serviceTypes: [{ rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 400, avail: 1 },
        { w: 2, h: 2, min: 100, max: 700, avail: 1 },
      ],
      availableBuildings: { services: 1, residentials: 1 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        repairTimeLimitSeconds: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        stopFilePath,
        seedHint: {
          solution: {
            roads: ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"],
            services: [
              {
                r: 1,
                c: 1,
                rows: 2,
                cols: 2,
                range: 5,
                typeIndex: 0,
                bonus: 480,
              },
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 400,
              },
            ],
            populations: [400],
            totalPopulation: 400,
          },
        },
      },
    };

    const solution = solveLns(grid, params);
    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.residentialTypeIndices[0], 1);
    assert.equal(solution.totalPopulation, 580);
    assert.equal(solution.populations[0], 580);

    const validation = validateSolution({ grid, solution, params });
    assert.equal(validation.valid, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testSolutionValidator() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
  assert.equal(validation.recomputedTotalPopulation, solution.totalPopulation);

  const broken = {
    ...solution,
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation + 1,
  };
  broken.populations[0] += 1;

  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /reports population/);
  assert.match(brokenValidation.errors.join("\n"), /reports total population/);
}

function testSolutionMapValidatorRejectsRoadsNotConnectedToRow0() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  const broken = {
    ...solution,
    roads: new Set(["1,1", "1,2"]),
  };

  const validation = validateSolutionMap({ grid, solution: broken, params });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /row 0/);
  assert.match(validation.mapText, /^   0123/m);
}

function testTopRowBuildingCountsAsRoadConnected() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { residentials: 1, services: 0 },
  };
  const solution = {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [-1],
    populations: [10],
    totalPopulation: 10,
  };

  const validation = validateSolutionMap({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testGreedyRespectsTopRowConnectivityShortcut() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.roads.size > 0, true);
  assert.equal(validation.valid, true);
}

function testGreedySupportsShapedServices() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 },
    },
    availableBuildings: { services: 1, residentials: 2 },
    greedy: { localSearch: false },
  };

  const solution = solveGreedy(grid, params);
  assert.equal(solution.services.length, 1);
  assert.deepEqual([solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b), [2, 3]);
  assert.equal(solution.services[0].range, 1);
  assert.deepEqual(solution.serviceTypeIndices, [0]);
  assert.deepEqual(solution.servicePopulationIncreases, [50]);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);

  const broken = {
    ...solution,
    services: [{ ...solution.services[0], range: 3 }],
  };
  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /does not match configured service type/);
}

function testGreedyResidentialPopulationCacheRespectsTypedVariants() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: {
      localSearch: false,
      randomSeed: 31,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 4,
      serviceExactMaxCombinations: 16,
      profile: true,
    },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual([...solution.populations].sort((a, b) => a - b), [10, 100]);
  assert(solution.greedyProfile);
  assert(solution.greedyProfile.counters.precompute.residentialPopulationCacheEntries > 0);
  assert(solution.greedyProfile.counters.residentialPhase.populationCacheLookups > 0);
}

function testGreedyProfilingIsAdditive() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 60, max: 120, avail: 4 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: {
      localSearch: true,
      randomSeed: 29,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 32,
    },
  };

  const withoutProfile = solveGreedy(grid, params);
  const withProfile = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      profile: true,
    },
  });

  assert.equal(withoutProfile.greedyProfile, undefined);
  assert(withProfile.greedyProfile);
  assert.equal(withProfile.totalPopulation, withoutProfile.totalPopulation);
  assert.deepEqual(withProfile.services, withoutProfile.services);
  assert.deepEqual(withProfile.serviceTypeIndices, withoutProfile.serviceTypeIndices);
  assert.deepEqual(withProfile.servicePopulationIncreases, withoutProfile.servicePopulationIncreases);
  assert.deepEqual(withProfile.residentials, withoutProfile.residentials);
  assert.deepEqual(withProfile.residentialTypeIndices, withoutProfile.residentialTypeIndices);
  assert.deepEqual(withProfile.populations, withoutProfile.populations);
  assert.deepEqual([...withProfile.roads].sort(), [...withoutProfile.roads].sort());
  assert(withProfile.greedyProfile.counters.precompute.serviceCandidates > 0);
  assert(withProfile.greedyProfile.counters.residentialPhase.candidateScans > 0);
}

function maybeTestCpSatCandidateReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
allowed = []
cell_to_id = {}
for r, row in enumerate(grid):
    for c, cell in enumerate(row):
        if cell != 1:
            continue
        cell_to_id[(r, c)] = len(allowed)
        allowed.append((r, c))

strong_params = {
    "serviceTypes": [
        {"rows": 2, "cols": 2, "bonus": 100, "range": 1, "avail": 1},
        {"rows": 2, "cols": 2, "bonus": 10, "range": 0, "avail": 1},
    ],
    "availableBuildings": {"services": 1},
}
weak_room_params = {
    "serviceTypes": [
        {"rows": 2, "cols": 2, "bonus": 100, "range": 1, "avail": 1},
        {"rows": 2, "cols": 2, "bonus": 10, "range": 0, "avail": 1},
    ],
    "availableBuildings": {"services": 2},
}

strong_maps = module.build_candidate_placement_maps(grid, strong_params)
weak_room_maps = module.build_candidate_placement_maps(grid, weak_room_params)
strong_candidates = module.enumerate_service_candidates(grid, strong_params, cell_to_id, strong_maps.service)
weak_room_candidates = module.enumerate_service_candidates(grid, weak_room_params, cell_to_id, weak_room_maps.service)

print(json.dumps({
    "strong_count": len(strong_candidates),
    "weak_room_count": len(weak_room_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT candidate reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.strong_count, 9);
  assert.equal(payload.weak_room_count, 18);
}

function maybeTestCpSatReachabilityReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 0, 0, 0],
  [1, 1, 0, 1, 1],
  [0, 0, 0, 1, 1],
  [1, 1, 0, 1, 1],
  [1, 1, 0, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 2, "cols": 2, "bonus": 20, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 50, "max": 100, "avail": 2}],
    "availableBuildings": {"services": 1, "residentials": 2},
}

built = module.build_model(grid, params)

print(json.dumps({
    "allowed_cells": built.allowed_cells,
    "service_candidates": [
        {"r": candidate["r"], "c": candidate["c"], "rows": candidate["rows"], "cols": candidate["cols"]}
        for candidate in built.service_candidates
    ],
    "residential_candidates": [
        {"r": candidate["r"], "c": candidate["c"], "rows": candidate["rows"], "cols": candidate["cols"]}
        for candidate in built.residential_candidates
    ],
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT reachability reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.allowed_cells, [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
  assert.deepEqual(payload.service_candidates, []);
  assert.deepEqual(payload.residential_candidates, [
    { r: 0, c: 0, rows: 2, cols: 2 },
  ]);
}

function maybeTestCpSatConnectivityHelperConstraints() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1],
  [1, 1, 1],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)
model = built.model
model.Add(built.road_vars[0] == 1)
model.Add(built.road_vars[1] == 1)

solver = module.cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)
if status not in (module.cp_model.OPTIMAL, module.cp_model.FEASIBLE):
    raise RuntimeError("Failed to solve helper connectivity model.")

root_ids = [cell_id for cell_id, variable in built.root_vars.items() if solver.Value(variable) == 1]
roads = [built.allowed_cells[cell_id] for cell_id, variable in enumerate(built.road_vars) if solver.Value(variable) == 1]

print(json.dumps({
    "root_ids": root_ids,
    "roads": roads,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT connectivity helper constraints.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.root_ids, [0]);
  assert.deepEqual(payload.roads, [
    [0, 0],
    [0, 1],
  ]);
}

function maybeTestCpSatRoadEligibilityReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1],
  [1, 0],
  [1, 0],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)

print(json.dumps({
    "allowed_cells": built.allowed_cells,
    "road_eligible_cells": built.road_eligible_cells,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT road eligibility reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.allowed_cells, [
    [0, 0],
    [0, 1],
    [1, 0],
    [2, 0],
  ]);
  assert.deepEqual(payload.road_eligible_cells, [
    [0, 0],
    [0, 1],
  ]);
}

function maybeTestCpSatDisallowsBidirectionalRoadFlow() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)
model = built.model
model.Add(built.road_vars[0] == 1)
model.Add(built.road_vars[1] == 1)
for source_id, target_id, flow_var in built.directed_edges:
    if (source_id, target_id) in ((0, 1), (1, 0)):
        model.Add(flow_var >= 1)

solver = module.cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)

print(json.dumps({
    "status": int(status),
    "infeasible": status == module.cp_model.INFEASIBLE,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT bidirectional flow constraints.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.infeasible, true);
}

async function main() {
  testGreedyDispatcher();
  testGreedyRandomSeedIsDeterministic();
  testGreedyExploresAllAllowedRowZeroSeeds();
  testGreedyExploresMultipleRowZeroSeedsWithinOneComponent();
  testGreedyExploresWideRowZeroAnchors();
  testGreedyExploresAnchorsBeyondLegacyRepresentativeCap();
  testRowZeroSeedCandidatesIncludeAllAllowedRowZeroCells();
  testRepresentativeRowZeroSeedCandidatesStayExhaustive();
  testLnsNeighborhoodWindowsPrioritizeWeakServicesAndUpgradeHeadroom();
  maybeTestCpSatBackendJsonContractSmoke();
  maybeTestCpSatBackendStreamingProtocol();
  maybeTestCpSatObjectivePolicyHelpers();
  maybeTestCpSatRuntimeOptionHelpers();
  maybeTestCpSatWarmStartHelpers();
  maybeTestCpSatSnapshotResponseHelpers();
  maybeTestCpSatNoImprovementTimeoutHelpers();
  maybeTestCpSatSnapshotWritesTelemetry();
  maybeTestCpSatPortfolioOptionHelpers();
  testCpSatPortfolioExecutorFallbackHelpers();
  maybeTestCpSatPopulationUpperBoundHelpers();
  maybeTestCpSatResidentialPopulationUpperBoundHelpers();
  await maybeTestCpSatOptimizer();
  maybeTestCpSatSyncCompatibility();
  await maybeTestCpSatAsyncOptimizer();
  await maybeTestAutoOptimizer();
  testAutoKeepsEqualPopulationOptimalCpSatResult();
  testAutoPreservesUserWarmStartMetadata();
  await testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns();
  await testAutoAsyncStageErrorKeepsIncumbentWithExplicitStopReason();
  testAutoSyncWallClockCapStopsRunningLnsStage();
  testGreedyProfilingIsAdditive();
  testGreedyBenchmarkCorpusHelpers();
  testGreedyBenchmarkSuite();
  testGreedyConnectivityHeavyBenchmarkCase();
  await testCpSatBenchmarkCorpusHelpers();
  await maybeTestCpSatBenchmarkSuite();
  await maybeTestCpSatWarmStartContinuation();
  await maybeTestCpSatPortfolioSolve();
  await maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie();
  await maybeTestCpSatObjectiveAvoidsUselessServices();
  maybeTestCpSatPrunesObjectivelyUselessServices();
  maybeTestCpSatBorderAccessCapacityHelpers();
  maybeTestCpSatGateRequirementHelpers();
  maybeTestCpSatGateRegionalCapacityHelpers();
  await maybeTestCpSatSupportsShapedServices();
  maybeTestCpSatCandidateReductionHelpers();
  maybeTestCpSatReachabilityReductionHelpers();
  maybeTestCpSatConnectivityHelperConstraints();
  maybeTestCpSatRoadEligibilityReductionHelpers();
  maybeTestCpSatDisallowsBidirectionalRoadFlow();
  testCpSatRejectsDuplicatePortfolioWorkerIndices();
  testCpSatRejectsDanglingSelectedPortfolioWorkerIndex();
  testSolutionValidator();
  testSolutionMapValidatorRejectsRoadsNotConnectedToRow0();
  testTopRowBuildingCountsAsRoadConnected();
  testGreedyRespectsTopRowConnectivityShortcut();
  testGreedySupportsShapedServices();
  testGreedyResidentialPopulationCacheRespectsTypedVariants();
  testLnsNeighborhoodWindowsEscalateWhenStagnating();
  testLnsRunsFinalEscalationWithinConfiguredBudget();
  maybeTestLnsOptimizer();
  testLnsRejectsInvalidSeedHint();
  testLnsRejectsMalformedSeedHintFields();
  maybeTestLnsExploresMultipleRowZeroSeeds();
  maybeTestLnsCanRepairRowZeroAnchorLayouts();
  testLnsDeterministicServiceUpgrade();
  testLnsDeterministicResidentialUpgrade();

  console.log("Optimizer backend tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
