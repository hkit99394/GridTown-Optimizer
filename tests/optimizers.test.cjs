const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildDeterministicAblationGateReport,
  buildCrossModeBenchmarkParams,
  collectGreedyOrderingLabelsFromBenchmarkSuite,
  createLearnedRankingLabelSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
  createGreedyConnectivityShadowOrderingLabelSnapshot,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES,
  DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS,
  DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_BENCHMARK_SEEDS,
  DEFAULT_LNS_BENCHMARK_CORPUS,
  DEFAULT_LNS_BENCHMARK_OPTIONS,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatDeterministicAblationGateReport,
  formatCrossModeBenchmarkSuite,
  formatGreedyConnectivityShadowOrderingLabels,
  formatLearnedRankingLabelSuite,
  formatLnsNeighborhoodAblation,
  formatLnsBenchmarkSuite,
  formatLnsWindowReplayLabels,
  listCrossModeBenchmarkCaseNames,
  listGreedyConnectivityShadowOrderingLabelCaseNames,
  listLnsNeighborhoodAblationCaseNames,
  listLnsBenchmarkCaseNames,
  normalizeLnsBenchmarkOptions,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
  runGreedyConnectivityShadowOrderingLabels,
  runLearnedRankingLabelSuite,
  runLnsNeighborhoodAblation,
  runLnsWindowReplayLabels,
  runLnsBenchmarkSuite,
} = require("../dist/benchmarks/index.js");

const {
  createGreedyBenchmarkSnapshot,
  createGreedyDeterministicAblationSnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_GREEDY_BENCHMARK_OPTIONS,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
  DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  DEFAULT_CP_SAT_BENCHMARK_OPTIONS,
  OMITTED_SOLVER_OPTIMIZER,
  RECOMMENDED_INTERACTIVE_OPTIMIZER,
  getOptimizerAdapter,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyDeterministicAblation,
  formatGreedyBenchmarkSuite,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyDeterministicAblationCaseNames,
  listGreedyBenchmarkCaseNames,
  listOptimizerAdapters,
  normalizeGreedyBenchmarkOptions,
  resolveOptimizerName,
  listCpSatBenchmarkCaseNames,
  normalizeCpSatBenchmarkOptions,
  buildDecisionTraceFromSolution,
  buildTimeToQualityScorecard,
  parseDecisionTraceJsonl,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyDeterministicAblation,
  runGreedyBenchmarkSuite,
  runCpSatBenchmarkSuite,
  runCrossModeBenchmarkBudgetAblations: runCrossModeBenchmarkBudgetAblationsFromIndex,
  serializeDecisionTraceJsonl,
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
const { startJsonBackgroundSolve } = require("../dist/runtime/index.js");
const { applyDeterministicDominanceUpgrades } = require("../dist/core/dominanceUpgrades.js");
const { GreedyAttemptState } = require("../dist/greedy/attemptState.js");
const {
  createRoadOpportunityRecorder,
  recordRoadOpportunityPlacementFromOccupiedBuildings,
} = require("../dist/greedy/roadOpportunity.js");
const {
  computeRow0ReachableEmptyFrontier,
  createRoadProbeScratch,
  materializeDeferredRoadNetwork,
  measureBuildingConnectivityShadow,
  measureBuildingConnectivityShadowFromFrontier,
  pruneRedundantRoads,
  probeBuildingConnectedToRoads,
  roadSeedRow0Candidates,
  roadSeedRow0RepresentativeCandidates,
} = require("../dist/core/roads.js");
const {
  forEachRectangleBorderCell,
  forEachRectangleCell,
  rectangleBorderCells,
  rectangleCells,
} = require("../dist/core/grid.js");
const {
  buildFootprintGeometryCache,
  buildServiceGeometryCache,
  buildServiceEffectZoneSet,
  countServiceBoost,
  isBoostedByService,
  overlaps,
  residentialFootprint,
  serviceEffectZone,
  serviceFootprint,
} = require("../dist/core/buildings.js");

function testOptimizerRegistry() {
  assert.equal(OMITTED_SOLVER_OPTIMIZER, "auto");
  assert.equal(RECOMMENDED_INTERACTIVE_OPTIMIZER, "auto");
  assert.equal(resolveOptimizerName(undefined), "auto");
  assert.equal(resolveOptimizerName(null), "auto");
  assert.equal(resolveOptimizerName({}), "auto");
  assert.equal(resolveOptimizerName("unknown"), "auto");
  assert.equal(resolveOptimizerName({ optimizer: "auto" }), "auto");
  assert.equal(resolveOptimizerName({ optimizer: "greedy" }), "greedy");
  assert.equal(resolveOptimizerName({ optimizer: "cp-sat" }), "cp-sat");
  assert.equal(resolveOptimizerName({ optimizer: "lns" }), "lns");
  assert.equal(getOptimizerAdapter(undefined).name, "auto");
  assert.equal(getOptimizerAdapter("auto").name, "auto");
  assert.equal(getOptimizerAdapter("greedy").name, "greedy");
  assert.equal(getOptimizerAdapter({ optimizer: "cp-sat" }).name, "cp-sat");
  assert.equal(getOptimizerAdapter("lns").name, "lns");
  assert.deepEqual(
    listOptimizerAdapters().map((adapter) => adapter.name).sort(),
    ["auto", "cp-sat", "greedy", "lns"]
  );
}

function testGeometryHelperVisitorParity() {
  const rectangleKeys = [];
  forEachRectangleCell(1, 2, 2, 3, (r, c) => rectangleKeys.push(`${r},${c}`));
  assert.deepEqual(rectangleKeys, rectangleCells(1, 2, 2, 3));

  const borderKeys = [];
  forEachRectangleBorderCell(1, 2, 2, 3, (r, c) => borderKeys.push(`${r},${c}`));
  const expectedBorder = rectangleBorderCells(1, 2, 2, 3).map(([r, c]) => `${r},${c}`);
  assert.deepEqual([...new Set(borderKeys)].sort(), [...expectedBorder].sort());
}

function testBuildingGeometryHelpersParity() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 0, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const service = { r: 1, c: 0, rows: 1, cols: 2, range: 1 };
  const zoneSet = buildServiceEffectZoneSet(grid, service);
  const zoneArray = serviceEffectZone(grid, service);
  zoneSet.delete("0,0");
  zoneArray.length = 0;
  const rebuiltZoneSet = buildServiceEffectZoneSet(grid, service);
  const rebuiltZoneArray = serviceEffectZone(grid, service);

  assert.deepEqual([...rebuiltZoneSet].sort(), [...rebuiltZoneArray].sort());
  assert.equal(countServiceBoost(rebuiltZoneSet, 0, 0, 2, 2), 2);
  assert.equal(isBoostedByService(rebuiltZoneSet, 0, 0, 2, 2), true);
  assert.equal(isBoostedByService(rebuiltZoneSet, 3, 3, 1, 1), false);

  const occupied = new Set(["0,0", "1,1", "2,2"]);
  assert.equal(overlaps(occupied, 0, 0, 2, 2), true);
  assert.equal(overlaps(occupied, 0, 2, 1, 2), false);
}

function testBuildingGeometryCachesParity() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const services = [
    { r: 1, c: 1, rows: 1, cols: 2, range: 1 },
    { r: 1, c: 1, rows: 1, cols: 2, range: 2 },
  ];
  const serviceGeometry = buildServiceGeometryCache(grid, services);
  const footprintGeometry = buildFootprintGeometryCache([
    { r: 0, c: 0, rows: 2, cols: 2 },
    { r: 0, c: 0, rows: 2, cols: 2 },
  ]);
  const mutatedFootprint = serviceFootprint(services[0]);
  mutatedFootprint.pop();
  const mutatedEffectZone = serviceEffectZone(grid, services[0]);
  mutatedEffectZone.pop();

  assert.equal(Object.isFrozen(serviceGeometry.footprintKeysByIndex), true);
  assert.equal(Object.isFrozen(serviceGeometry.effectZoneKeysByIndex), true);
  assert.equal(Object.isFrozen(serviceGeometry.footprintKeysByIndex[0]), true);
  assert.equal(Object.isFrozen(serviceGeometry.effectZoneKeysByIndex[0]), true);
  assert.deepEqual([...serviceGeometry.footprintKeysByIndex[0]], serviceFootprint(services[0]));
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...buildServiceEffectZoneSet(grid, services[0])].sort()
  );
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[1]].sort(),
    [...buildServiceEffectZoneSet(grid, services[1])].sort()
  );
  assert.notDeepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...serviceGeometry.effectZoneKeysByIndex[1]].sort()
  );
  assert.deepEqual([...footprintGeometry.footprintKeysByIndex[0]], residentialFootprint(0, 0, 2, 2));
  assert.deepEqual([...footprintGeometry.footprintKeysByIndex[0]], [...footprintGeometry.footprintKeysByIndex[1]]);
  assert.deepEqual([...serviceGeometry.footprintKeysByIndex[0]], serviceFootprint(services[0]));
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...serviceEffectZone(grid, services[0])].sort()
  );
}

function testRoadProbePreservesEdgeBorderConnectivity() {
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ];
  const roads = new Set(["0,2"]);
  const occupied = new Set(roads);
  const adjacentProbe = probeBuildingConnectedToRoads(grid, roads, occupied, 1, 2, 1, 1);
  const bridgeProbe = probeBuildingConnectedToRoads(grid, roads, occupied, 1, 1, 1, 1);

  assert.deepEqual(adjacentProbe, { path: null });
  assert.equal((bridgeProbe?.path?.length ?? 0) > 0, true);
  assert.deepEqual(bridgeProbe?.path?.at(-1), [0, 2]);
}

function testRoadProbeScratchRepeatability() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  const roads = new Set(["0,4"]);
  const occupied = new Set(roads);
  const scratch = createRoadProbeScratch(grid);

  const first = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);
  const second = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);
  const interleaved = probeBuildingConnectedToRoads(grid, roads, occupied, 4, 0, 1, 1, scratch);
  const third = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  assert.equal((interleaved?.path?.length ?? 0) > 0, true);
}

function testRoadProbeScratchWorkspaceResetsBetweenCalls() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const roads = new Set(["0,3"]);
  const scratch = createRoadProbeScratch(grid);
  const occupiedWithBlocker = new Set([...roads, "1,2"]);
  const occupiedWithoutBlocker = new Set(roads);

  const blockedProbeWithScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithBlocker, 2, 2, 1, 1, scratch);
  const blockedProbeWithoutScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithBlocker, 2, 2, 1, 1);
  const clearProbeWithScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithoutBlocker, 2, 2, 1, 1, scratch);
  const clearProbeWithoutScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithoutBlocker, 2, 2, 1, 1);

  assert.deepEqual(blockedProbeWithScratch, blockedProbeWithoutScratch);
  assert.deepEqual(clearProbeWithScratch, clearProbeWithoutScratch);
}

function testBuildingConnectivityShadowMeasuresDisconnectedReachableCells() {
  const grid = [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
  ];
  const blockedBuildings = new Set();

  const placement = { r: 0, c: 1, rows: 1, cols: 1 };
  const shadow = measureBuildingConnectivityShadow(grid, blockedBuildings, placement);
  const shadowFromFrontier = measureBuildingConnectivityShadowFromFrontier(
    grid,
    blockedBuildings,
    computeRow0ReachableEmptyFrontier(grid, blockedBuildings),
    placement
  );

  assert.deepEqual(shadow, {
    reachableBefore: 5,
    reachableAfter: 2,
    lostCells: 3,
    footprintCells: 1,
    disconnectedCells: 2,
  });
  assert.deepEqual(shadowFromFrontier, shadow);
}

function testGreedyAttemptStateRejectsMismatchedProbeKind() {
  const grid = [
    [1, 1],
    [1, 1],
  ];
  const placement = { r: 1, c: 0, rows: 1, cols: 1 };

  const deferredAttempt = new GreedyAttemptState(grid, undefined, true);
  assert.equal(
    deferredAttempt.commitPlacement({ kind: "explicit", roadCost: 0, roadProbe: { path: null } }, placement),
    null
  );
  assert.equal(deferredAttempt.occupied.size, 0);

  const explicitAttempt = new GreedyAttemptState(grid, new Set(["0,0"]), false);
  assert.equal(
    explicitAttempt.commitPlacement({ kind: "deferred", roadCost: 0, frontierProbe: { distance: 0 } }, placement),
    null
  );
  assert.equal(explicitAttempt.occupied.size, 1);
  assert.equal(explicitAttempt.occupied.has("0,0"), true);
}

function testRoadPruningDropsConnectorsOnlyNeededByRowZeroBuildings() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const roads = new Set(["0,0", "1,0", "2,0", "0,1"]);
  const buildings = [
    { r: 0, c: 2, rows: 1, cols: 1 },
    { r: 1, c: 1, rows: 1, cols: 1 },
  ];

  const pruned = pruneRedundantRoads(grid, roads, buildings);

  assert.deepEqual([...pruned].sort(), ["0,1"]);
}

function testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval() {
  const grid = [
    [1, 1],
    [1, 1],
  ];
  const roads = new Set(["0,0", "1,0", "1,1"]);

  const pruned = pruneRedundantRoads(grid, roads, []);

  assert.deepEqual([...pruned].sort(), ["0,0"]);
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
  assert.equal(solution.autoStage.activeStage, solution.activeOptimizer);
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
    assert.equal(solution.autoStage.activeStage, "cp-sat");
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

function testAutoDirectRuntimeIgnoresMalformedOptionValues() {
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let capturedCpSatOptions = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = () => buildMockSolution({ optimizer: "lns", totalPopulation: 100 });
  cpSatModule.solveCpSat = (grid, params) => {
    capturedCpSatOptions = params.cpSat;
    return buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" });
  };

  try {
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      auto: {
        wallClockLimitSeconds: "bad",
        weakCycleImprovementThreshold: "bad",
        maxConsecutiveWeakCycles: "bad",
        cpSatStageTimeLimitSeconds: "bad",
        cpSatStageNoImprovementTimeoutSeconds: "bad",
      },
    });

    assert.equal(solution.autoStage.stopReason, "optimal");
    assert.ok(capturedCpSatOptions);
    assert.equal(capturedCpSatOptions.timeLimitSeconds, 30);
    assert.equal(capturedCpSatOptions.noImprovementTimeoutSeconds, 10);
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
      throw new Error("CP-SAT backend exited after streaming a feasible incumbent.");
    }),
    cancel() {},
    getLatestSnapshot: () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "FEASIBLE" }),
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: 100,
      activeOptimizer: "cp-sat",
      autoStage: null,
      cpSatStatus: "FEASIBLE",
    }),
  });

  try {
    const solution = await startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
    }).promise;

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
      throw new Error("CP-SAT backend wrote a snapshot artifact but no final result.");
    }),
    cancel() {},
    getLatestSnapshot: () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 100, cpSatStatus: "OPTIMAL" }),
    getLatestSnapshotState: () => ({
      hasFeasibleSolution: true,
      totalPopulation: 100,
      activeOptimizer: "cp-sat",
      autoStage: null,
      cpSatStatus: "OPTIMAL",
    }),
  });

  try {
    const solution = await startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
    }).promise;

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
    assert.equal(solution.autoStage.activeStage, "lns");
    assert.ok(elapsedMs >= 1500 && elapsedMs < 5000);
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
  }
}

function testAutoSyncWallClockCapKeepsExplicitStopReasonWhenLnsThrows() {
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
      // Busy-wait until the shared auto stop file fires, then emulate the stage aborting.
    }
    throw new Error("LNS noticed the stop file and aborted before returning a final solution.");
  };

  try {
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 5 },
      auto: { wallClockLimitSeconds: 2 },
    });

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
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  const originalSolveLns = lnsModule.solveLns;
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let observedLnsOptions = null;

  solverModule.solveGreedy = () => buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  lnsModule.solveLns = (_grid, params) => {
    observedLnsOptions = params.lns;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 120 });
  };
  cpSatModule.solveCpSat = () => buildMockSolution({ optimizer: "cp-sat", totalPopulation: 120, cpSatStatus: "OPTIMAL" });

  try {
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 4,
        seedTimeLimitSeconds: 5,
        repairTimeLimitSeconds: 0.5,
        focusedRepairTimeLimitSeconds: 0.75,
        escalatedRepairTimeLimitSeconds: 1.25,
      },
      cpSat: { timeLimitSeconds: 5, noImprovementTimeoutSeconds: 5, numWorkers: 1 },
      auto: { wallClockLimitSeconds: 2.5 },
    });

    assert.equal(solution.autoStage.stopReason, "optimal");
    assert(observedLnsOptions);
    assert.equal(typeof observedLnsOptions.wallClockLimitSeconds, "number");
    assert.ok(observedLnsOptions.wallClockLimitSeconds > 1);
    assert.ok(observedLnsOptions.wallClockLimitSeconds < 2);
    assert.ok(observedLnsOptions.seedTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.ok(observedLnsOptions.repairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.equal(observedLnsOptions.repairTimeLimitSeconds, 0.5);
    assert.equal(observedLnsOptions.focusedRepairTimeLimitSeconds, 0.75);
    assert.equal(observedLnsOptions.escalatedRepairTimeLimitSeconds, 1.25);
    assert.ok(observedLnsOptions.focusedRepairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.ok(observedLnsOptions.escalatedRepairTimeLimitSeconds <= observedLnsOptions.wallClockLimitSeconds);
    assert.ok(observedLnsOptions.escalatedRepairTimeLimitSeconds > observedLnsOptions.repairTimeLimitSeconds);
    assert.deepEqual(solution.autoStage.stageRuns.map((run) => run.stage), ["greedy", "lns", "cp-sat"]);
    assert.equal(solution.autoStage.stageRuns[1].improvement, 20);
    assert.equal(solution.autoStage.stageRuns[2].improvement, 0);
    assert.equal(solution.autoStage.stageRuns[2].cpSatStatus, "OPTIMAL");
    assert.equal(typeof solution.autoStage.stageRuns[1].elapsedSeconds, "number");
    const trace = buildDecisionTraceFromSolution(solution, { optimizer: "auto" });
    assert(trace.some((event) =>
      event.kind === "auto-stage"
      && event.activeStage === "lns"
      && event.reason.includes("completed")
      && event.evidence.improvement === 20
    ));
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
    lnsModule.solveLns = originalSolveLns;
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testAutoSyncGreedyCanRunPastFormerStageBudget() {
  const solverModule = require("../dist/greedy/solver.js");
  const lnsModule = require("../dist/lns/solver.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
      stoppedByUser: greedyStoppedByUser,
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
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      lns: { iterations: 1, maxNoImprovementIterations: 1, repairTimeLimitSeconds: 1 },
      cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
      auto: { wallClockLimitSeconds: 4 },
    });
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
  const greedyBridgeModule = require("../dist/greedy/bridge.js");
  const lnsBridgeModule = require("../dist/lns/bridge.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
        cpSatStatus: null,
      }),
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
        cpSatStatus: null,
      }),
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
        cpSatStatus: solution.cpSatStatus,
      }),
    };
  };

  try {
    const startedAt = Date.now();
    const solution = await startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
      auto: { wallClockLimitSeconds: 4 },
    }).promise;
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
  const solverModule = require("../dist/greedy/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  let capturedGreedyOptions = null;

  solverModule.solveGreedy = (grid, params) => {
    capturedGreedyOptions = params.greedy;
    return buildMockSolution({ optimizer: "greedy", totalPopulation: 100 });
  };

  try {
    const solution = solveAuto([[1, 1], [1, 1]], {
      optimizer: "auto",
      greedy: {
        localSearch: true,
        restarts: 20,
        serviceRefineIterations: 4,
        serviceRefineCandidateLimit: 60,
        exhaustiveServiceSearch: true,
        densityTieBreaker: true,
        densityTieBreakerTolerancePercent: 25,
        serviceExactPoolLimit: 22,
        serviceExactMaxCombinations: 12000,
      },
      lns: { iterations: 1, maxNoImprovementIterations: 1, neighborhoodRows: 2, neighborhoodCols: 2, repairTimeLimitSeconds: 1 },
      cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
      auto: { wallClockLimitSeconds: 10 },
    });

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
    assert.equal(capturedGreedyOptions.profile, true);
    assert.equal(solution.autoStage.greedySeedStage.restarts, 4);
    assert.equal(solution.autoStage.greedySeedStage.serviceRefineIterations, 1);
    assert.equal(solution.autoStage.greedySeedStage.exhaustiveServiceSearch, false);
    assert.equal(solution.autoStage.greedySeedStage.totalPopulation, 100);
    assert.equal(typeof solution.autoStage.greedySeedStage.elapsedSeconds, "number");
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
  }
}

async function testAutoAsyncClampsHeavyGreedyStageSettings() {
  const greedyBridgeModule = require("../dist/greedy/bridge.js");
  const lnsBridgeModule = require("../dist/lns/bridge.js");
  const cpSatModule = require("../dist/cp-sat/solver.js");
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
      cpSatStatus: solution.cpSatStatus ?? null,
    }),
  });

  greedyBridgeModule.startGreedySolve = (grid, params) => {
    capturedGreedyOptions = params.greedy;
    return buildBackgroundHandle(buildMockSolution({ optimizer: "greedy", totalPopulation: 100 }));
  };
  lnsBridgeModule.startLnsSolve = () => buildBackgroundHandle(buildMockSolution({ optimizer: "lns", totalPopulation: 120 }));
  cpSatModule.startCpSatSolve = () => buildBackgroundHandle(buildMockSolution({
    optimizer: "cp-sat",
    totalPopulation: 120,
    cpSatStatus: "OPTIMAL",
  }));

  try {
    const solution = await startAutoSolve([[1, 1], [1, 1]], {
      optimizer: "auto",
      greedy: {
        localSearch: true,
        restarts: 20,
        serviceRefineIterations: 4,
        serviceRefineCandidateLimit: 60,
        exhaustiveServiceSearch: true,
        densityTieBreaker: true,
        densityTieBreakerTolerancePercent: 25,
        serviceExactPoolLimit: 22,
        serviceExactMaxCombinations: 12000,
      },
      lns: { iterations: 1, maxNoImprovementIterations: 1, neighborhoodRows: 2, neighborhoodCols: 2, repairTimeLimitSeconds: 1 },
      cpSat: { timeLimitSeconds: 1, noImprovementTimeoutSeconds: 1, numWorkers: 1 },
      auto: { wallClockLimitSeconds: 10 },
    }).promise;

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
    assert.equal(capturedGreedyOptions.profile, true);
    assert.equal(solution.autoStage.greedySeedStage.restarts, 4);
    assert.equal(solution.autoStage.greedySeedStage.serviceRefineIterations, 1);
    assert.equal(solution.autoStage.greedySeedStage.exhaustiveServiceSearch, false);
    assert.equal(solution.autoStage.greedySeedStage.totalPopulation, 100);
    assert.equal(typeof solution.autoStage.greedySeedStage.elapsedSeconds, "number");
  } finally {
    greedyBridgeModule.startGreedySolve = originalStartGreedySolve;
    lnsBridgeModule.startLnsSolve = originalStartLnsSolve;
    cpSatModule.startCpSatSolve = originalStartCpSatSolve;
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

async function waitForFile(filePath, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${filePath}.`);
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

async function waitForHeartbeatToStop(heartbeatPath, timeoutMs = 1500) {
  const startedAt = Date.now();
  let previousHeartbeat = readFileIfPresent(heartbeatPath);
  let stableSince = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await delay(30);
    const currentHeartbeat = readFileIfPresent(heartbeatPath);
    if (currentHeartbeat === previousHeartbeat) {
      if (Date.now() - stableSince >= 150) return;
      continue;
    }
    previousHeartbeat = currentHeartbeat;
    stableSince = Date.now();
  }

  assert.fail("Background child process kept writing heartbeats after cancellation.");
}

function testGreedyDispatcher() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
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

async function testPublicSolverDispatchValidatesInputs() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];

  assert.throws(
    () => solve(grid, { optimizer: "bogus" }),
    /Invalid solver input: Solver params optimizer must be one of auto, greedy, cp-sat, or lns\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { restarts: 0 } }),
    /Invalid solver input: Greedy option greedy\.restarts must be an integer between 1 and 100\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { diagnostics: "yes" } }),
    /Invalid solver input: Greedy option greedy\.diagnostics must be a boolean\./
  );
  await assert.rejects(
    () => solveAsync(grid, { optimizer: "greedy", greedy: { restarts: 0 } }),
    /Invalid solver input: Greedy option greedy\.restarts must be an integer between 1 and 100\./
  );
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

function testGreedyConnectivityShadowScoringIsOptInTieBreaker() {
  const grid = [
    [1, 1],
    [1, 0],
    [1, 0],
  ];
  const baseParams = {
    optimizer: "greedy",
    residentialTypes: [
      { w: 1, h: 1, min: 10, max: 10, avail: 1 },
    ],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };
  const defaultSolution = solveGreedy(grid, structuredClone(baseParams));
  const explicitOff = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: false,
    },
  });
  const profiledDefault = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      profile: true,
    },
  });
  const enabled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: true,
    },
  });
  const enabledProfiled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: true,
      profile: true,
    },
  });
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "greedy-shadow-snapshot-"));
  const snapshotFilePath = path.join(snapshotDir, "snapshot.json");

  try {
    const snapshotted = solveGreedy(grid, {
      ...structuredClone(baseParams),
      greedy: {
        ...baseParams.greedy,
        connectivityShadowScoring: true,
        snapshotFilePath,
      },
    });
    const snapshot = JSON.parse(fs.readFileSync(snapshotFilePath, "utf8"));

    assert.deepEqual(defaultSolution.residentials, [{ r: 0, c: 0, rows: 1, cols: 1 }]);
    assert.deepEqual(explicitOff.residentials, defaultSolution.residentials);
    assert.deepEqual(profiledDefault.residentials, defaultSolution.residentials);
    assert.deepEqual([...explicitOff.roads].sort(), [...defaultSolution.roads].sort());
    assert.equal(defaultSolution.totalPopulation, enabled.totalPopulation);
    assert.deepEqual(enabled.residentials, [{ r: 0, c: 1, rows: 1, cols: 1 }]);
    assert.deepEqual([...enabled.roads].sort(), ["0,0"]);
    assert.deepEqual(enabledProfiled.residentials, enabled.residentials);
    assert(enabledProfiled.greedyProfile.counters.roads.connectivityShadowScoreTies > 0);
    assert(enabledProfiled.greedyProfile.counters.roads.connectivityShadowScoreWins > 0);
    assert(enabledProfiled.greedyProfile.connectivityShadowDecisions.length > 0);
    assert.equal(enabledProfiled.greedyProfile.connectivityShadowDecisions[0].phase, "residential");
    assert.deepEqual(enabledProfiled.greedyProfile.connectivityShadowDecisions[0].chosen, {
      r: 0,
      c: 1,
      rows: 1,
      cols: 1,
      roadCost: 0,
      typeIndex: 0,
    });
    assert.deepEqual(snapshotted.residentials, enabled.residentials);
    assert.deepEqual(snapshot.residentials, enabled.residentials);
    assert.equal(validateSolution({ grid, solution: enabled, params: baseParams }).valid, true);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

function testGreedyConnectivityShadowOrderingLabelRunner() {
  const labelCase = {
    name: "shadow-label-fixture",
    description: "Small fixture for connectivity-shadow ordering labels.",
    grid: [
      [1, 1],
      [1, 0],
      [1, 0],
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [
        { w: 1, h: 1, min: 10, max: 10, avail: 1 },
      ],
      availableBuildings: { services: 0, residentials: 1 },
      greedy: {
        localSearch: false,
        restarts: 1,
        serviceRefineIterations: 0,
        exhaustiveServiceSearch: false,
      },
    },
  };

  const result = runGreedyConnectivityShadowOrderingLabels([labelCase], {
    seeds: [7],
    maxLabelsPerCase: 1,
  });
  const repeatedSnapshot = createGreedyConnectivityShadowOrderingLabelSnapshot(
    runGreedyConnectivityShadowOrderingLabels([labelCase], {
      seeds: [7],
      maxLabelsPerCase: 1,
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
              incumbentShadowPenalty: 5,
            },
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
                  typeIndex: 0,
                },
              ],
            },
          ],
        },
      },
    ],
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

  const result = runLearnedRankingLabelSuite({
    seeds: [7],
    splitConfigs: [
      {
        split: "development",
        greedyCaseNames: ["typed-housing-baseline"],
        lnsCaseNames: ["typed-housing-single"],
      },
      {
        split: "holdout",
        greedyCaseNames: ["deterministic-tie-breaks"],
        lnsCaseNames: ["row0-anchor-repair"],
      },
    ],
    greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    maxWindows: 1,
    repairTimeLimitSeconds: 0.1,
  });
  const snapshot = createLearnedRankingLabelSnapshot(result);
  const formatted = formatLearnedRankingLabelSuite(result);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.audit.learnedModel, null);
  assert.equal(result.audit.lnsReplay.cpSatNumWorkers, 1);
  assert.equal(result.leakage.protectedHoldout, true);
  assert.deepEqual(result.leakage.greedyOverlap, []);
  assert.deepEqual(result.leakage.lnsOverlap, []);
  assert.equal(result.lns.labelCount, 2);
  assert.equal(result.lns.splits[0].usableLabelCount, 1);
  assert.equal(result.lns.splits[0].replay.schemaVersion, 1);
  assert.equal(result.lns.splits[0].replay.cases[0].labels[0].usable, true);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.match(formatted, /Low-Risk Learned Ranking Labels/);
  assert.match(formatted, /protected-holdout=true/);
  assert.match(formatted, /learned-model=none/);
  assert.throws(
    () => runLearnedRankingLabelSuite({
      splitConfigs: [
        {
          split: "development",
          greedyCaseNames: ["typed-housing-baseline"],
          lnsCaseNames: ["typed-housing-single"],
        },
        {
          split: "holdout",
          greedyCaseNames: ["typed-housing-baseline"],
          lnsCaseNames: ["row0-anchor-repair"],
        },
      ],
      greedyCorpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
      lnsCorpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    }),
    /development\/holdout split overlap is not allowed/
  );
}

function testGreedyRoadOpportunityCounterfactualsAreBoundedAndObservational() {
  const grid = [
    [1, 1],
    [1, 0],
    [1, 0],
  ];
  const baseParams = {
    optimizer: "greedy",
    residentialTypes: [
      { w: 1, h: 1, min: 10, max: 10, avail: 1 },
    ],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };

  const baseline = solveGreedy(grid, structuredClone(baseParams));
  const profiled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      profile: true,
    },
  });
  const trace = profiled.greedyProfile.roadOpportunityTraces.find((entry) =>
    entry.phase === "residential" && (entry.counterfactuals?.length ?? 0) > 0
  );

  assert.deepEqual(profiled.residentials, baseline.residentials);
  assert.deepEqual([...profiled.roads].sort(), [...baseline.roads].sort());
  assert.equal(profiled.totalPopulation, baseline.totalPopulation);
  assert(trace);
  assert.equal(trace.score, 10);
  assert(trace.counterfactuals.length <= 3);

  const counterfactual = trace.counterfactuals.find((entry) => entry.reason === "same-score-tie");
  assert(counterfactual);
  assert.equal(counterfactual.score, 10);
  assert.equal(counterfactual.scoreDelta, 0);
  assert.equal(counterfactual.roadCostDelta, counterfactual.roadCost - trace.roadCost);
  assert.equal(counterfactual.lostCells, counterfactual.reachableBefore - counterfactual.reachableAfter);
}

function testRoadOpportunityLocalSearchMeasurementUsesPostRemoveOccupancy() {
  const grid = [
    [1],
    [1],
    [1],
  ];
  const { traces, recordRoadOpportunity } = createRoadOpportunityRecorder(true);
  const probe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } };

  for (let index = 0; index < 80; index++) {
    recordRoadOpportunityPlacementFromOccupiedBuildings({
      grid,
      occupiedBuildings: new Set(),
      placement: { r: 1, c: 0, rows: 1, cols: 1 },
      probe,
      phase: "residential",
      record: recordRoadOpportunity,
      score: 10,
    });
  }

  recordRoadOpportunityPlacementFromOccupiedBuildings({
    grid,
    occupiedBuildings: new Set(),
    placement: { r: 2, c: 0, rows: 1, cols: 1 },
    probe,
    phase: "residential-local-search",
    record: recordRoadOpportunity,
    score: 10,
    moveKind: "residential-move",
  });

  const localTrace = traces.find((entry) => entry.phase === "residential-local-search");
  assert.equal(traces.filter((entry) => entry.phase === "residential").length, 64);
  assert(localTrace);
  assert.equal(localTrace.moveKind, "residential-move");
  assert.equal(localTrace.reachableBefore, 3);
  assert.equal(localTrace.reachableAfter, 2);
  assert.equal(localTrace.lostCells, 1);
}

function testGreedyStopFileCancelsBeforePrecompute() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "greedy-stop-precompute-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
    assert.throws(
      () => solveGreedy(grid, {
        residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 4 }],
        availableBuildings: { services: 0, residentials: 4 },
        greedy: {
          localSearch: false,
          restarts: 1,
          stopFilePath,
        },
      }),
      /Greedy solve was stopped before finding a feasible solution\./
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testGreedyWallClockBudgetStopsWithBestSolution() {
  const originalDateNow = Date.now;
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    return dateNowCalls < 100 ? 1000 : 3000;
  };

  try {
    const grid = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ];
    const solution = solveGreedy(grid, {
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
      greedy: {
        localSearch: false,
        restarts: 3000,
        timeLimitSeconds: 1,
      },
    });

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.stoppedByTimeLimit, true);
    assert.equal(solution.stoppedByUser, undefined);
    assert.equal(dateNowCalls >= 100, true);
  } finally {
    Date.now = originalDateNow;
  }
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

  const slidingOnlyWindows = buildNeighborhoodWindows(grid, params, incumbent, {
    iterations: 3,
    maxNoImprovementIterations: 2,
    neighborhoodRows: 3,
    neighborhoodCols: 3,
    neighborhoodAnchorPolicy: "sliding-only",
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: "",
  });

  assert.notDeepEqual(slidingOnlyWindows[0], weakServiceWindow);
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

try:
    module.build_portfolio_worker_options({"portfolio": {"workerCount": 2}})
    missing_budget_error = None
except ValueError as error:
    missing_budget_error = str(error)

try:
    module.build_portfolio_worker_options({
        "portfolio": {
            "workerCount": 4,
            "perWorkerNumWorkers": 3,
            "perWorkerTimeLimitSeconds": 30,
        }
    })
    worker_thread_error = None
except ValueError as error:
    worker_thread_error = str(error)

try:
    module.build_portfolio_worker_options({
        "portfolio": {
            "workerCount": 8,
            "perWorkerNumWorkers": 1,
            "perWorkerTimeLimitSeconds": 4000,
        }
    })
    cpu_budget_error = None
except ValueError as error:
    cpu_budget_error = str(error)

try:
    module.build_portfolio_worker_options({
        "timeLimitSeconds": 10,
        "portfolio": {
            "randomSeeds": [1, 2, 3, 4, 5, 6, 7, 8, 9],
        }
    })
    too_many_seeds_error = None
except ValueError as error:
    too_many_seeds_error = str(error)

try:
    module.build_portfolio_worker_options({
        "timeLimitSeconds": 10,
        "portfolio": {
            "randomSeeds": [11, 11],
        }
    })
    duplicate_seeds_error = None
except ValueError as error:
    duplicate_seeds_error = str(error)

print(json.dumps({
    "results": results,
    "missingBudgetError": missing_budget_error,
    "workerThreadError": worker_thread_error,
    "cpuBudgetError": cpu_budget_error,
    "tooManySeedsError": too_many_seeds_error,
    "duplicateSeedsError": duplicate_seeds_error,
}))
`;

  const result = childProcess.spawnSync("python3", ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT portfolio fallback helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.results, [
    { workerIndex: 0, seed: 7 },
    { workerIndex: 1, seed: 9 },
  ]);
  assert.match(payload.missingBudgetError, /requires timeLimitSeconds/);
  assert.match(payload.workerThreadError, /exceeding the 8 worker portfolio limit/);
  assert.match(payload.cpuBudgetError, /exceeding the 28800\.0 second portfolio budget/);
  assert.match(payload.tooManySeedsError, /must contain between 1 and 8 seeds/);
  assert.match(payload.duplicateSeedsError, /must not contain duplicate seeds/);
}

async function testBackgroundSolveCancellationKillsProcessGroupChildren() {
  if (process.platform === "win32") {
    console.log("Skipping process-group cancellation regression on Windows.");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-bg-cancel-"));
  const childScriptPath = path.join(tempDir, "heartbeat-child.cjs");
  const parentScriptPath = path.join(tempDir, "portfolio-parent.cjs");
  const childPidFilePath = path.join(tempDir, "child.pid");
  const heartbeatPath = path.join(tempDir, "heartbeat.txt");
  let childPid = null;
  let heartbeatStopped = false;

  fs.writeFileSync(
    childScriptPath,
    `
const fs = require("node:fs");
const heartbeatPath = process.argv[2];
setInterval(() => {
  try {
    fs.writeFileSync(heartbeatPath, String(Date.now()));
  } catch {}
}, 20);
setInterval(() => {}, 1000);
`,
    "utf8"
  );
  fs.writeFileSync(
    parentScriptPath,
    `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const childScriptPath = process.argv[2];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input || "{}");
  const child = spawn(process.execPath, [childScriptPath, request.heartbeatPath], {
    stdio: "ignore",
  });
  fs.writeFileSync(request.childPidFilePath, String(child.pid));
  setInterval(() => {}, 1000);
});
`,
    "utf8"
  );

  try {
    const handle = startJsonBackgroundSolve({
      solverLabel: "Test CP-SAT portfolio",
      stopDirectoryPrefix: "city-builder-bg-cancel-test-",
      command: process.execPath,
      args: [parentScriptPath, childScriptPath],
      buildRequest: ({ stopFilePath, snapshotFilePath }) => ({
        stopFilePath,
        snapshotFilePath,
        childPidFilePath,
        heartbeatPath,
      }),
      parseRaw: JSON.parse,
      materializeSolution: () => buildMockSolution({ optimizer: "cp-sat", stoppedByUser: true }),
      getSnapshotState: () => ({
        hasFeasibleSolution: false,
        totalPopulation: null,
      }),
      stoppedBeforeFeasibleMessage: "Test portfolio solve stopped before feasible.",
      noSolutionMessage: "Test portfolio solve returned no solution.",
      forcedTerminationDelayMs: 40,
    });

    await waitForFile(childPidFilePath);
    await waitForFile(heartbeatPath);
    childPid = Number(fs.readFileSync(childPidFilePath, "utf8"));
    assert.equal(Number.isInteger(childPid) && childPid > 0, true);

    handle.cancel();
    await assert.rejects(handle.promise, /Test portfolio solve stopped before feasible/);
    await waitForHeartbeatToStop(heartbeatPath);
    heartbeatStopped = true;
  } finally {
    if (!heartbeatStopped && Number.isInteger(childPid)) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

function testLnsBenchmarkCorpusHelpers() {
  const names = DEFAULT_LNS_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert(names.includes("seeded-service-anchor-pressure"));
  assert.deepEqual(listLnsBenchmarkCaseNames(), names);

  const normalized = normalizeLnsBenchmarkOptions(
    {
      iterations: 4,
      wallClockLimitSeconds: 20,
    },
    {
      neighborhoodRows: 5,
      repairTimeLimitSeconds: 2,
    }
  );

  assert.equal(normalized.iterations, 4);
  assert.equal(normalized.maxNoImprovementIterations, DEFAULT_LNS_BENCHMARK_OPTIONS.maxNoImprovementIterations);
  assert.equal(normalized.wallClockLimitSeconds, 20);
  assert.equal(normalized.neighborhoodRows, 5);
  assert.equal(normalized.neighborhoodCols, DEFAULT_LNS_BENCHMARK_OPTIONS.neighborhoodCols);
  assert.equal(normalized.repairTimeLimitSeconds, 2);

  assert.throws(
    () => runLnsBenchmarkSuite(DEFAULT_LNS_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown LNS benchmark case\(s\): missing-case/
  );

  const lnsModule = require("../dist/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;
  let observedParams = null;

  lnsModule.solveLns = (grid, params) => {
    observedParams = params;
    grid[0][0] = 0;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 77, cpSatStatus: "FEASIBLE" });
  };

  try {
    const result = runLnsBenchmarkSuite(DEFAULT_LNS_BENCHMARK_CORPUS, {
      names: ["typed-housing-single"],
      lns: {
        iterations: 3,
        wallClockLimitSeconds: 20,
      },
      cpSat: {
        randomSeed: 29,
        numWorkers: 1,
      },
      greedy: {
        randomSeed: 31,
        profile: true,
      },
    });

    assert.equal(result.caseCount, 1);
    assert.deepEqual(result.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(result.results[0].name, "typed-housing-single");
    assert.equal(result.results[0].totalPopulation, 77);
    assert.equal(result.results[0].roadCount, 1);
    assert.equal(result.results[0].residentialCount, 1);
    assert.equal(result.results[0].cpSatStatus, "FEASIBLE");
    assert.equal(result.results[0].lnsOptions.iterations, 3);
    assert.equal(result.results[0].lnsOptions.wallClockLimitSeconds, 20);
    assert.equal(result.results[0].cpSatOptions.randomSeed, 29);
    assert.equal(result.results[0].greedyOptions.randomSeed, 31);
    assert(result.results[0].wallClockSeconds >= 0);
    assert.equal(DEFAULT_LNS_BENCHMARK_CORPUS[0].grid[0][0], 1);

    assert.equal(observedParams.optimizer, "lns");
    assert.equal(observedParams.lns.iterations, 3);
    assert.equal(observedParams.lns.maxNoImprovementIterations, DEFAULT_LNS_BENCHMARK_OPTIONS.maxNoImprovementIterations);
    assert.equal(observedParams.cpSat.randomSeed, 29);
    assert.equal(observedParams.greedy.randomSeed, 31);

    const snapshot = createLnsBenchmarkSnapshot(result);
    assert.equal(Object.hasOwn(snapshot.results[0], "wallClockSeconds"), false);
    assert.match(formatLnsBenchmarkSuite(result), /=== LNS Benchmark Suite ===/);
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsNeighborhoodAblationRunner() {
  const ablationCase = {
    name: "lns-neighborhood-ablation-fixture",
    description: "Small fixture for deterministic LNS neighborhood matrix comparisons.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 100, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: {
        localSearch: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16,
      },
    },
  };
  const variants = DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS.filter((variant) =>
    variant.name === "baseline" || variant.name === "small-2x2"
  );
  const lnsModule = require("../dist/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;
  const observedRuns = [];

  lnsModule.solveLns = (grid, params) => {
    observedRuns.push({
      window: `${params.lns.neighborhoodRows}x${params.lns.neighborhoodCols}`,
      greedySeed: params.greedy.randomSeed,
      cpSatSeed: params.cpSat.randomSeed,
    });
    grid[0][0] = 0;
    return {
      ...buildMockSolution({
        optimizer: "lns",
        totalPopulation: params.lns.neighborhoodRows === 2 ? 90 : 70,
        cpSatStatus: "FEASIBLE",
      }),
      lnsTelemetry: {
        stopReason: "iteration-limit",
        seedSource: "greedy",
        seedWallClockSeconds: 0,
        seedTimeLimitSeconds: null,
        wallClockLimitSeconds: null,
        noImprovementTimeoutSeconds: null,
        focusedRepairTimeLimitSeconds: 1,
        escalatedRepairTimeLimitSeconds: 1,
        iterationsStarted: 1,
        iterationsCompleted: 1,
        improvingIterations: params.lns.neighborhoodRows === 2 ? 1 : 0,
        neutralIterations: params.lns.neighborhoodRows === 2 ? 0 : 1,
        recoverableFailures: 0,
        skippedIterations: 0,
        finalStagnantIterations: 0,
        outcomes: [
          {
            iteration: 0,
            phase: "focused",
            window: { top: 1, left: 0, rows: params.lns.neighborhoodRows, cols: params.lns.neighborhoodCols },
            stagnantIterationsBefore: 0,
            staleSecondsBefore: 0,
            repairTimeLimitSeconds: 1,
            wallClockSeconds: 0,
            populationBefore: 70,
            populationAfter: params.lns.neighborhoodRows === 2 ? 90 : 70,
            improvement: params.lns.neighborhoodRows === 2 ? 20 : 0,
            status: params.lns.neighborhoodRows === 2 ? "improved" : "neutral",
          },
        ],
      },
    };
  };

  try {
    const result = runLnsNeighborhoodAblation([ablationCase], { variants });
    const formatted = formatLnsNeighborhoodAblation(result);
    const snapshot = createLnsNeighborhoodAblationSnapshot(result);
    const benchmarkCase = result.cases[0];
    const baselineSummary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
    const smallWindowSummary = result.variantSummaries.find((entry) => entry.variantName === "small-2x2");
    const smallWindow = benchmarkCase.variants.find((entry) => entry.variantName === "small-2x2");

    assert.equal(DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES.includes("compact-service-repair"), true);
    assert.equal(listLnsNeighborhoodAblationCaseNames().includes("row0-anchor-repair"), true);
    assert.equal(result.caseCount, 1);
    assert.equal(result.seedCount, 1);
    assert.equal(result.comparisonCount, 1);
    assert.deepEqual(result.selectedCaseNames, ["lns-neighborhood-ablation-fixture"]);
    assert.deepEqual(result.variants, ["baseline", "small-2x2"]);
    assert.deepEqual(result.variantExecutionOrders, [
      { seed: null, variants: ["baseline", "small-2x2"] },
    ]);
    assert.deepEqual(snapshot.variantExecutionOrders, result.variantExecutionOrders);
    assert.deepEqual(observedRuns.map((entry) => entry.window), ["3x3", "2x2"]);
    assert.equal(result.coverage.caseCount, 1);
    assert.equal(result.coverage.seedCount, 1);
    assert.equal(result.coverage.comparisonCount, 1);
    assert.equal(result.coverage.runCount, 2);
    assert.equal(result.coverage.variantCount, 2);
    assert.equal(result.coverage.gridCellCount, 16);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(Object.hasOwn(snapshot.variantSummaries[0], "meanWallClockSeconds"), false);
    assert.equal(Object.hasOwn(snapshot.cases[0].baseline, "wallClockSeconds"), false);
    assert.equal(benchmarkCase.baseline.totalPopulation, 70);
    assert.equal(benchmarkCase.baseline.populationDeltaVsBaseline, 0);
    assert.equal(benchmarkCase.baseline.lnsOptions.neighborhoodAnchorPolicy, "ranked");
    assert.equal(baselineSummary.winRate, 0);
    assert.equal(baselineSummary.regressionRate, 0);
    assert.equal(baselineSummary.unchangedRate, 1);
    assert.equal(baselineSummary.worstPopulationDeltaVsBaseline, 0);
    assert.equal(baselineSummary.worstPopulationDeltaCaseName, "lns-neighborhood-ablation-fixture");
    assert.equal(baselineSummary.worstPopulationDeltaSeed, null);
    assert.equal(baselineSummary.firstWindowMovementCount, 0);
    assert.equal(baselineSummary.firstWindowMovementRate, 0);
    assert.equal(smallWindow.totalPopulation, 90);
    assert.equal(smallWindow.populationDeltaVsBaseline, 20);
    assert.equal(smallWindowSummary.improvedCaseCount, 1);
    assert.equal(smallWindowSummary.regressedCaseCount, 0);
    assert.equal(smallWindowSummary.unchangedCaseCount, 0);
    assert.equal(smallWindowSummary.winRate, 1);
    assert.equal(smallWindowSummary.regressionRate, 0);
    assert.equal(smallWindowSummary.unchangedRate, 0);
    assert.equal(smallWindowSummary.worstPopulationDeltaVsBaseline, 20);
    assert.equal(smallWindowSummary.bestPopulationDeltaCaseName, "lns-neighborhood-ablation-fixture");
    assert.equal(smallWindowSummary.bestPopulationDeltaSeed, null);
    assert.equal(smallWindowSummary.firstWindowMovementCount, 1);
    assert.equal(smallWindowSummary.firstWindowMovementRate, 1);
    assert.equal(smallWindowSummary.windowSequenceMovementCount, 1);
    assert.equal(smallWindowSummary.windowSequenceMovementRate, 1);
    assert.equal(smallWindowSummary.anchorCoordinateMovementCount, 0);
    assert.equal(smallWindowSummary.anchorCoordinateMovementRate, 0);
    assert.equal(smallWindow.lnsOptions.neighborhoodRows, 2);
    assert.equal(smallWindow.lnsOptions.neighborhoodCols, 2);
    assert.equal(smallWindow.improvingIterations, 1);
    assert.equal(smallWindow.outcomes[0].window.rows, 2);
    assert.equal(smallWindow.outcomes[0].status, "improved");
    assert.match(formatted, /=== LNS Neighborhood Ablation Matrix ===/);
    assert.match(formatted, /small-2x2=population:90/);
    assert.match(formatted, /window:2x2/);
    assert.match(formatted, /win-rate=100\.0%/);
    assert.match(formatted, /first-window-moved=1\/1/);
    assert.match(formatted, /first-window:1:0:2x2\/improved\/\+20/);

    observedRuns.length = 0;
    const seededResult = runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7, 19] });
    const seededFormatted = formatLnsNeighborhoodAblation(seededResult);

    assert.deepEqual(seededResult.seeds, [7, 19]);
    assert.equal(seededResult.caseCount, 1);
    assert.equal(seededResult.seedCount, 2);
    assert.equal(seededResult.comparisonCount, 2);
    assert.deepEqual(seededResult.selectedCaseNames, ["lns-neighborhood-ablation-fixture"]);
    assert.deepEqual(seededResult.cases.map((entry) => entry.seed), [7, 19]);
    assert.deepEqual(seededResult.variantExecutionOrders, [
      { seed: 7, variants: ["baseline", "small-2x2"] },
      { seed: 19, variants: ["small-2x2", "baseline"] },
    ]);
    assert.deepEqual(
      seededResult.cases.map((entry) => entry.variants.map((variant) => variant.variantName)),
      [
        ["baseline", "small-2x2"],
        ["baseline", "small-2x2"],
      ]
    );
    assert.equal(seededResult.coverage.caseCount, 1);
    assert.equal(seededResult.coverage.seedCount, 2);
    assert.equal(seededResult.coverage.comparisonCount, 2);
    assert.equal(seededResult.coverage.runCount, 4);
    assert.equal(seededResult.variantSummaries[0].caseCount, 1);
    assert.equal(seededResult.variantSummaries[0].seedCount, 2);
    assert.equal(seededResult.variantSummaries[0].comparisonCount, 2);
    assert.equal(seededResult.variantSummaries[0].unchangedRate, 1);
    assert.equal(seededResult.variantSummaries[1].winRate, 1);
    assert.equal(seededResult.variantSummaries[1].firstWindowMovementCount, 2);
    assert.equal(seededResult.variantSummaries[1].firstWindowMovementRate, 1);
    assert.deepEqual(
      observedRuns.map((entry) => `${entry.greedySeed}/${entry.cpSatSeed}/${entry.window}`),
      ["7/7/3x3", "7/7/2x2", "19/19/2x2", "19/19/3x3"]
    );
    for (const seededCase of seededResult.cases) {
      for (const variant of seededCase.variants) {
        assert.equal(variant.seed, seededCase.seed);
      }
    }
    assert.match(seededFormatted, /Seeds: 7, 19/);
    assert.match(seededFormatted, /comparisons=2/);

    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], {
        variants: [{ name: "small-2x2", description: "Invalid missing baseline.", lns: { neighborhoodRows: 2 } }],
      }),
      /must include the baseline variant/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], {
        variantNames: ["small-2x2", "small-2x2"],
      }),
      /requested variants must use unique names/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7.5] }),
      /must contain only integer seeds between 0 and 2147483647/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [2147483648] }),
      /must contain only integer seeds between 0 and 2147483647/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7, 7] }),
      /must not contain duplicate seeds/
    );
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsNeighborhoodAblationWindowSequenceMovement() {
  const ablationCase = {
    name: "lns-window-sequence-movement-fixture",
    description: "Small fixture for later-window movement tracking.",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
  };
  const variants = [
    { name: "baseline", description: "Baseline ranked anchors.", lns: { neighborhoodAnchorPolicy: "ranked" } },
    { name: "weak-service-first", description: "Alternative anchors.", lns: { neighborhoodAnchorPolicy: "weak-service-first" } },
  ];
  const lnsModule = require("../dist/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;

  lnsModule.solveLns = (_grid, params) => {
    const shifted = params.lns.neighborhoodAnchorPolicy === "weak-service-first";
    const windows = shifted
      ? [{ top: 0, left: 0, rows: 3, cols: 3 }, { top: 2, left: 2, rows: 3, cols: 3 }]
      : [{ top: 0, left: 0, rows: 3, cols: 3 }, { top: 1, left: 1, rows: 3, cols: 3 }];
    return {
      ...buildMockSolution({ optimizer: "lns", totalPopulation: 70, cpSatStatus: "FEASIBLE" }),
      lnsTelemetry: {
        stopReason: "iteration-limit",
        seedSource: "greedy",
        seedWallClockSeconds: 0,
        seedTimeLimitSeconds: null,
        wallClockLimitSeconds: null,
        noImprovementTimeoutSeconds: null,
        focusedRepairTimeLimitSeconds: 1,
        escalatedRepairTimeLimitSeconds: 1,
        iterationsStarted: 2,
        iterationsCompleted: 2,
        improvingIterations: 0,
        neutralIterations: 2,
        recoverableFailures: 0,
        skippedIterations: 0,
        finalStagnantIterations: 2,
        outcomes: windows.map((window, iteration) => ({
          iteration,
          phase: "focused",
          window,
          stagnantIterationsBefore: iteration,
          staleSecondsBefore: 0,
          repairTimeLimitSeconds: 1,
          wallClockSeconds: 0,
          populationBefore: 70,
          populationAfter: 70,
          improvement: 0,
          status: "neutral",
        })),
      },
    };
  };

  try {
    const result = runLnsNeighborhoodAblation([ablationCase], { variants });
    const summary = result.variantSummaries.find((entry) => entry.variantName === "weak-service-first");

    assert.equal(summary.firstWindowMovementCount, 0);
    assert.equal(summary.firstWindowMovementRate, 0);
    assert.equal(summary.windowSequenceMovementCount, 1);
    assert.equal(summary.windowSequenceMovementRate, 1);
    assert.equal(summary.anchorCoordinateMovementCount, 1);
    assert.equal(summary.anchorCoordinateMovementRate, 1);
    assert.match(formatLnsNeighborhoodAblation(result), /window-sequence-moved=1\/1/);
    assert.match(formatLnsNeighborhoodAblation(result), /anchor-coordinate-moved=1\/1/);
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsSeededServiceAnchorPressureBenchmarkCase() {
  const result = runLnsNeighborhoodAblation(undefined, {
    names: ["seeded-service-anchor-pressure"],
    variantNames: ["sliding-only", "weak-service-first"],
  });
  const seededSnapshot = createLnsNeighborhoodAblationSnapshot(runLnsNeighborhoodAblation(undefined, {
    names: ["seeded-service-anchor-pressure"],
    variantNames: ["sliding-only", "weak-service-first"],
    seeds: [7],
  }));
  const repeatedSeededSnapshot = createLnsNeighborhoodAblationSnapshot(runLnsNeighborhoodAblation(undefined, {
    names: ["seeded-service-anchor-pressure"],
    variantNames: ["sliding-only", "weak-service-first"],
    seeds: [7],
  }));
  const benchmarkCase = result.cases[0];
  const slidingOnly = benchmarkCase.variants.find((entry) => entry.variantName === "sliding-only");
  const weakServiceFirst = benchmarkCase.variants.find((entry) => entry.variantName === "weak-service-first");

  assert.deepEqual(repeatedSeededSnapshot, seededSnapshot);
  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["seeded-service-anchor-pressure"]);
  assert.equal(benchmarkCase.baseline.totalPopulation, 200);
  assert.equal(slidingOnly.totalPopulation, 100);
  assert.equal(slidingOnly.populationDeltaVsBaseline, -100);
  assert.equal(weakServiceFirst.totalPopulation, 200);
  assert.equal(benchmarkCase.baseline.outcomes[0].window.left, 3);
  assert.equal(slidingOnly.outcomes[0].window.left, 0);
  assert.equal(weakServiceFirst.outcomes[0].status, "improved");
}

function testLnsWindowReplayLabelRunner() {
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const observedRepairs = [];

  cpSatModule.solveCpSat = (_grid, params) => {
    const window = params.cpSat.warmStartHint.neighborhoodWindow;
    observedRepairs.push({
      timeLimitSeconds: params.cpSat.timeLimitSeconds,
      fixOutsideNeighborhoodToHintedValue: params.cpSat.warmStartHint.fixOutsideNeighborhoodToHintedValue,
      window: { ...window },
      incumbentPopulation: params.cpSat.warmStartHint.solution.totalPopulation,
    });
    return buildMockSolution({
      optimizer: "cp-sat",
      totalPopulation: window.top === 1 && window.left === 3 ? 200 : 90,
      cpSatStatus: "FEASIBLE",
    });
  };

  try {
    const result = runLnsWindowReplayLabels(undefined, {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 2,
      repairTimeLimitSeconds: 0.25,
    });
    const repeatedSnapshot = createLnsWindowReplaySnapshot(runLnsWindowReplayLabels(undefined, {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 2,
      repairTimeLimitSeconds: 0.25,
    }));
    const snapshot = createLnsWindowReplaySnapshot(result);
    const formatted = formatLnsWindowReplayLabels(result);
    const benchmarkCase = result.cases[0];
    const selectedLabel = benchmarkCase.labels.find((label) => label.selectedByBaseline);
    const regressedLabel = benchmarkCase.labels.find((label) => !label.selectedByBaseline);

    assert.equal(result.caseCount, 1);
    assert.equal(result.seedCount, 1);
    assert.equal(result.comparisonCount, 1);
    assert.deepEqual(result.seeds, [7]);
    assert.deepEqual(result.selectedCaseNames, ["seeded-service-anchor-pressure"]);
    assert.equal(result.maxWindows, 2);
    assert.equal(result.repairTimeLimitSeconds, 0.25);
    assert.equal(result.labelCount, 2);
    assert.equal(benchmarkCase.incumbentPopulation, 100);
    assert.equal(benchmarkCase.replayedWindowCount, 2);
    assert.equal(benchmarkCase.candidateWindowCount >= 2, true);
    assert.equal(selectedLabel.window.left, 3);
    assert.equal(selectedLabel.populationDelta, 100);
    assert.equal(selectedLabel.improvement, 100);
    assert.equal(selectedLabel.status, "invalid");
    assert.equal(selectedLabel.usable, false);
    assert.equal(regressedLabel.populationDelta, -10);
    assert.equal(regressedLabel.improvement, 0);
    assert.equal(regressedLabel.status, "invalid");
    assert.equal(regressedLabel.usable, false);
    assert.equal(selectedLabel.features.selectedByBaseline, true);
    assert.equal(selectedLabel.features.area, 9);
    assert.equal(typeof selectedLabel.validation.valid, "boolean");
    assert.equal(selectedLabel.validation.recomputedTotalPopulation >= 0, true);
    assert.equal(selectedLabel.features.serviceCountInside >= 1, true);
    assert.equal(selectedLabel.features.residentialHeadroomInside >= 0, true);
    assert.deepEqual(
      observedRepairs.slice(0, 2).map((entry) => entry.timeLimitSeconds),
      [0.25, 0.25]
    );
    assert.equal(observedRepairs[0].fixOutsideNeighborhoodToHintedValue, true);
    assert.equal(observedRepairs[0].incumbentPopulation, 100);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(Object.hasOwn(snapshot.cases[0].labels[0], "wallClockSeconds"), false);
    assert.deepEqual(repeatedSnapshot, snapshot);
    assert.match(formatted, /=== LNS Window Replay Labels ===/);
    assert.match(formatted, /delta=\+100/);
    assert.match(formatted, /delta=-10/);
    assert.match(formatted, /usable=false/);
    assert.match(formatted, /improvement=\+100/);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

async function testCrossModeBenchmarkHelpers() {
  const names = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS, [5, 30, 120]);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_SEEDS, [7, 19, 37]);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_MODES, ["auto", "greedy", "lns", "cp-sat", "cp-sat-portfolio"]);
  assert.equal(typeof runCrossModeBenchmarkBudgetAblationsFromIndex, "function");
  assert.equal(new Set(names).size, names.length);
  assert(names.includes("row0-corridor-repair-pressure"));
  assert.deepEqual(listCrossModeBenchmarkCaseNames(), names);

  const ablationCoverageCase = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS.find(
    (entry) => entry.name === "row0-corridor-repair-pressure"
  );
  assert.equal(ablationCoverageCase.problemSizeBand, "small");
  assert.equal(ablationCoverageCase.grid.length, 6);
  assert.equal(ablationCoverageCase.params.serviceTypes.length, 2);
  assert.equal(ablationCoverageCase.params.residentialTypes.length, 2);

  const benchmarkCase = {
    name: "mock-scorecard",
    description: "Mock scorecard case for equal-budget mode option checks.",
    problemSizeBand: "tiny",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    params: {
      residentialTypes: [{ w: 1, h: 1, min: 1, max: 1, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
  };

  const greedyParams = buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: 3, seeds: [5] });
  assert.equal(greedyParams.optimizer, "greedy");
  assert.equal(greedyParams.greedy.timeLimitSeconds, 3);
  assert.equal(greedyParams.greedy.randomSeed, 5);

  const autoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", { budgetSeconds: 3, seeds: [5] });
  assert.equal(autoParams.optimizer, "auto");
  assert.equal(autoParams.auto.wallClockLimitSeconds, 3);
  assert.equal(autoParams.auto.randomSeed, 5);
  assert.equal(autoParams.lns.wallClockLimitSeconds, 3);
  assert.equal(autoParams.cpSat.timeLimitSeconds, 3);
  assert.equal(autoParams.cpSat.portfolio, undefined);
  assert.deepEqual(DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.map((policy) => policy.name), [
    "baseline",
    "seed-light",
    "repair-heavy",
    "cp-sat-reserve-heavy",
  ]);
  const coverageNames = DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(coverageNames).size, coverageNames.length);
  assert(coverageNames.includes("typed-footprint-pressure"));
  assert(coverageNames.includes("deferred-road-packing-gain"));
  assert(coverageNames.includes("service-local-neighborhood"));
  assert(coverageNames.includes("row0-anchor-repair"));
  assert.deepEqual(
    listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS),
    coverageNames
  );
  assert.throws(
    () => buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: -1, seeds: [5] }),
    /budget seconds must be a finite number greater than 0/
  );

  const tunedLnsParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", { budgetSeconds: 30, seeds: [5] });
  assert.equal(tunedLnsParams.lns.wallClockLimitSeconds, 30);
  assert.equal(tunedLnsParams.lns.seedTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.repairTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.focusedRepairTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.escalatedRepairTimeLimitSeconds, 3);
  assert.equal(tunedLnsParams.lns.iterations, 14);
  assert.equal(tunedLnsParams.lns.maxNoImprovementIterations, 14);

  const expectedAblationLnsPolicies = [
    {
      budgetSeconds: 5,
      seedTimeLimitSeconds: 1,
      repairTimeLimitSeconds: 1,
      focusedRepairTimeLimitSeconds: 1,
      escalatedRepairTimeLimitSeconds: 1,
      iterations: 4,
      maxNoImprovementIterations: 4,
    },
    {
      budgetSeconds: 30,
      seedTimeLimitSeconds: 2,
      repairTimeLimitSeconds: 2,
      focusedRepairTimeLimitSeconds: 2,
      escalatedRepairTimeLimitSeconds: 3,
      iterations: 14,
      maxNoImprovementIterations: 14,
    },
    {
      budgetSeconds: 120,
      seedTimeLimitSeconds: 5,
      repairTimeLimitSeconds: 5,
      focusedRepairTimeLimitSeconds: 5,
      escalatedRepairTimeLimitSeconds: 10,
      iterations: 23,
      maxNoImprovementIterations: 23,
    },
  ];
  for (const corpusCase of DEFAULT_CROSS_MODE_BENCHMARK_CORPUS) {
    const ablationLnsPolicies = DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS.map((budgetSeconds) => {
      const params = buildCrossModeBenchmarkParams(corpusCase, "lns", { budgetSeconds, seeds: [5] });
      return {
        budgetSeconds,
        seedTimeLimitSeconds: params.lns.seedTimeLimitSeconds,
        repairTimeLimitSeconds: params.lns.repairTimeLimitSeconds,
        focusedRepairTimeLimitSeconds: params.lns.focusedRepairTimeLimitSeconds,
        escalatedRepairTimeLimitSeconds: params.lns.escalatedRepairTimeLimitSeconds,
        iterations: params.lns.iterations,
        maxNoImprovementIterations: params.lns.maxNoImprovementIterations,
      };
    });
    assert.deepEqual(ablationLnsPolicies, expectedAblationLnsPolicies);
  }

  const explicitLnsParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", {
    budgetSeconds: 30,
    seeds: [5],
    lns: {
      seedTimeLimitSeconds: 5,
      repairTimeLimitSeconds: 7,
      focusedRepairTimeLimitSeconds: 4,
      escalatedRepairTimeLimitSeconds: 6,
      iterations: 3,
      maxNoImprovementIterations: 2,
    },
  });
  assert.equal(explicitLnsParams.lns.seedTimeLimitSeconds, 5);
  assert.equal(explicitLnsParams.lns.repairTimeLimitSeconds, 7);
  assert.equal(explicitLnsParams.lns.focusedRepairTimeLimitSeconds, 4);
  assert.equal(explicitLnsParams.lns.escalatedRepairTimeLimitSeconds, 6);
  assert.equal(explicitLnsParams.lns.iterations, 3);
  assert.equal(explicitLnsParams.lns.maxNoImprovementIterations, 2);

  const seedLightPolicy = DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.find((policy) => policy.name === "seed-light");
  const seedLightParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", {
    budgetSeconds: 20,
    seeds: [5],
    budgetAblationPolicy: seedLightPolicy,
  });
  assert.equal(seedLightParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(seedLightParams.lns.repairTimeLimitSeconds, 2);
  assert.equal(seedLightParams.lns.focusedRepairTimeLimitSeconds, 2);
  assert.equal(seedLightParams.lns.escalatedRepairTimeLimitSeconds, 3);

  const reserveHeavyPolicy = DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.find((policy) => policy.name === "cp-sat-reserve-heavy");
  const reserveHeavyParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 20,
    seeds: [5],
    budgetAblationPolicy: reserveHeavyPolicy,
  });
  assert.equal(reserveHeavyParams.auto.cpSatStageReserveRatio, 0.35);
  assert.equal(reserveHeavyParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(reserveHeavyParams.lns.repairTimeLimitSeconds, 2);

  const portfolioParams = buildCrossModeBenchmarkParams(benchmarkCase, "cp-sat-portfolio", {
    budgetSeconds: 3,
    seeds: [5],
    portfolio: { workerCount: 2 },
  });
  assert.equal(portfolioParams.optimizer, "cp-sat");
  assert.equal(portfolioParams.cpSat.timeLimitSeconds, 3);
  assert.equal(portfolioParams.cpSat.maxDeterministicTime, 3);
  assert.equal(portfolioParams.cpSat.portfolio.workerCount, 2);
  assert.deepEqual(portfolioParams.cpSat.portfolio.randomSeeds, [5, 106]);
  assert.equal(portfolioParams.cpSat.portfolio.totalCpuBudgetSeconds, 6);

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
      serviceExactMaxCombinations: 1,
    },
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["mock-scorecard"]);
  assert.deepEqual(result.budgetsSeconds, [3]);
  assert.deepEqual(result.seeds, [5]);
  assert.deepEqual(result.modes, ["greedy"]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].results.length, 1);
  assert.equal(result.cases[0].results[0].mode, "greedy");
  assert.equal(result.cases[0].results[0].winVsAuto, "no-auto");
  assert.equal(result.cases[0].results[0].scoreDeltaVsAuto, null);
  assert.equal(result.cases[0].results[0].progressSummary.activeStage, "greedy");
  assert.equal(typeof result.cases[0].results[0].budgetAllocationSignal.budgetUtilizationRatio, "number");
  assert.equal(result.cases[0].results[0].budgetAllocationSignal.scoreDeltaVsAuto, null);
  assert.equal(result.modeSummaries[0].mode, "greedy");
  assert.equal(result.problemSizeSummaries[0].problemSizeBand, "tiny");
  assert.equal(result.budgetPolicySignals.length, 1);
  assert.equal(result.budgetPolicySignals[0].caseName, "mock-scorecard");
  assert.equal(result.budgetPolicySignals[0].recommendation, "add-auto-baseline");

  const mocked = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["auto", "greedy", "lns", "cp-sat-portfolio"],
    budgetsSeconds: [3],
    seeds: [5, 11],
    portfolio: { workerCount: 2 },
    solve: async (_grid, params, context) => {
      const seedBonus = context.seed === 11 ? 1 : 0;
      const modeScores = {
        auto: 10 + seedBonus,
        greedy: 12 + seedBonus,
        lns: 8 + seedBonus,
        "cp-sat-portfolio": 10 + seedBonus,
      };
      const solution = buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: modeScores[context.mode],
        cpSatStatus: params.optimizer === "cp-sat" ? "FEASIBLE" : undefined,
      });
      if (context.mode === "auto") {
        solution.activeOptimizer = "lns";
        solution.autoStage = {
          requestedOptimizer: "auto",
          activeStage: "lns",
          stageIndex: 2,
          cycleIndex: 1,
          consecutiveWeakCycles: 0,
          lastCycleImprovementRatio: null,
          stopReason: "wall-clock-cap",
          generatedSeeds: [{ stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: context.seed }],
          stageRuns: [
            {
              stage: "greedy",
              stageIndex: 1,
              cycleIndex: 0,
              randomSeed: context.seed,
              startedAtSeconds: 0,
              elapsedSeconds: 0.1,
              completedAtSeconds: 0.1,
              populationBefore: null,
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: null,
            },
            {
              stage: "lns",
              stageIndex: 2,
              cycleIndex: 1,
              randomSeed: context.seed + 1,
              startedAtSeconds: 0.1,
              elapsedSeconds: 1.1,
              completedAtSeconds: 1.2,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 0,
              lnsStopReason: "iteration-limit",
            },
            {
              stage: "lns",
              stageIndex: 3,
              cycleIndex: 2,
              randomSeed: context.seed + 2,
              startedAtSeconds: 1.2,
              elapsedSeconds: 0.4,
              completedAtSeconds: 1.6,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 0,
              lnsStopReason: "iteration-limit",
            },
            {
              stage: "cp-sat",
              stageIndex: 4,
              cycleIndex: 2,
              randomSeed: context.seed + 3,
              startedAtSeconds: 1.6,
              elapsedSeconds: 0.2,
              completedAtSeconds: 1.8,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 1,
              cpSatStatus: "FEASIBLE",
            },
            {
              stage: "cp-sat",
              stageIndex: 5,
              cycleIndex: 3,
              randomSeed: context.seed + 4,
              startedAtSeconds: 1.8,
              elapsedSeconds: 0.5,
              completedAtSeconds: 2.3,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 2,
              cpSatStatus: "FEASIBLE",
            },
          ],
          greedySeedStage: {
            timeLimitSeconds: 3,
            localSearch: true,
            restarts: 4,
            serviceRefineIterations: 1,
            serviceRefineCandidateLimit: 30,
            exhaustiveServiceSearch: false,
            serviceExactPoolLimit: 25,
            serviceExactMaxCombinations: 2000,
            totalPopulation: modeScores[context.mode],
            elapsedSeconds: 0.1,
            phases: [
              {
                name: "constructiveCapSearch",
                runs: 1,
                elapsedMs: 4,
                bestPopulationBefore: 0,
                bestPopulationAfter: modeScores[context.mode],
                bestPopulationDelta: modeScores[context.mode],
                candidatePopulationBefore: 0,
                candidatePopulationAfter: modeScores[context.mode],
                candidatePopulationDelta: modeScores[context.mode],
                improvements: 1,
              },
            ],
          },
        };
        solution.lnsTelemetry = {
          stopReason: "iteration-limit",
          seedSource: "hint",
          seedTimeLimitSeconds: 0.2,
          seedWallClockSeconds: 0.2,
          wallClockLimitSeconds: 1.1,
          noImprovementTimeoutSeconds: null,
          focusedRepairTimeLimitSeconds: 1,
          escalatedRepairTimeLimitSeconds: 1,
          iterationsStarted: 1,
          iterationsCompleted: 1,
          improvingIterations: 0,
          neutralIterations: 1,
          recoverableFailures: 0,
          skippedIterations: 0,
          finalStagnantIterations: 1,
          elapsedSeconds: 0.3,
          outcomes: [
            {
              iteration: 0,
              phase: "focused",
              window: { top: 0, left: 0, rows: 2, cols: 2 },
              stagnantIterationsBefore: 0,
              staleSecondsBefore: 0,
              repairTimeLimitSeconds: 1,
              wallClockSeconds: 0.1,
              populationBefore: modeScores[context.mode],
              populationAfter: modeScores[context.mode],
              improvement: 0,
              status: "neutral",
              cpSatStatus: "FEASIBLE",
            },
          ],
        };
      }
      if (context.mode === "lns") {
        solution.lnsTelemetry = {
          stopReason: "iteration-limit",
          seedSource: "greedy",
          seedTimeLimitSeconds: 2,
          seedWallClockSeconds: 0.2,
          wallClockLimitSeconds: 3,
          noImprovementTimeoutSeconds: null,
          focusedRepairTimeLimitSeconds: 1,
          escalatedRepairTimeLimitSeconds: 1,
          iterationsStarted: 1,
          iterationsCompleted: 1,
          improvingIterations: 0,
          neutralIterations: 1,
          recoverableFailures: 0,
          skippedIterations: 0,
          finalStagnantIterations: 1,
          elapsedSeconds: 1,
          outcomes: [
            {
              iteration: 0,
              phase: "focused",
              window: { top: 0, left: 0, rows: 2, cols: 2 },
              stagnantIterationsBefore: 0,
              staleSecondsBefore: 0,
              repairTimeLimitSeconds: 1,
              wallClockSeconds: 0.1,
              populationBefore: modeScores[context.mode],
              populationAfter: modeScores[context.mode],
              improvement: 0,
              status: "neutral",
              cpSatStatus: "FEASIBLE",
            },
          ],
        };
      }
      if (context.mode === "cp-sat-portfolio") {
        solution.cpSatTelemetry = {
          solveWallTimeSeconds: 1,
          userTimeSeconds: 1,
          solutionCount: 1,
          incumbentObjectiveValue: modeScores[context.mode],
          bestObjectiveBound: modeScores[context.mode] + 2,
          objectiveGap: 2,
          incumbentPopulation: modeScores[context.mode],
          bestPopulationUpperBound: modeScores[context.mode] + 2,
          populationGapUpperBound: 2,
          lastImprovementAtSeconds: 0.5,
          secondsSinceLastImprovement: 0.5,
          numBranches: 0,
          numConflicts: 0,
        };
        solution.cpSatPortfolio = {
          workerCount: 2,
          selectedWorkerIndex: 1,
          workers: [
            { workerIndex: 0, randomSeed: context.seed, randomizeSearch: true, numWorkers: 1, status: "UNKNOWN", feasible: false, totalPopulation: null },
            { workerIndex: 1, randomSeed: context.seed + 101, randomizeSearch: true, numWorkers: 1, status: "FEASIBLE", feasible: true, totalPopulation: modeScores[context.mode] },
          ],
        };
      }
      return solution;
    },
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
    mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").progressSummary.portfolioWorkerSummary.feasibleWorkers,
    1
  );
  const mockedAuto = mocked.cases[0].results.find((entry) => entry.mode === "auto");
  const mockedLns = mocked.cases[0].results.find((entry) => entry.mode === "lns");
  const mockedPortfolio = mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio");
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
        numConflicts: 0,
      },
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
        score: { before: null, after: 20, best: 20, delta: 20, upperBound: null, gap: null },
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
        score: { before: 20, after: 10, best: 10, delta: -10, upperBound: null, gap: null },
      },
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
  assert.match(formatted, /budget-signal=/);
  const mockedFormatted = formatCrossModeBenchmarkSuite(mocked);
  assert.match(mockedFormatted, /seed-policy=.*lns-seed-limit:2\.000s/);
  assert.match(mockedFormatted, /seed-policy=.*auto-greedy-seed-limit:3\.000s/);
  assert.match(mockedFormatted, /budget-signal=under-used-budget/);
  assert.match(mockedFormatted, /Budget policy signals:/);
  assert.match(mockedFormatted, /recommendation=shift-auto-budget-to-greedy/);
  assert.match(mockedFormatted, /auto-gap=2/);
  assert.match(mockedFormatted, /reason=/);

  const ablations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto", "lns"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      {
        name: "reserve-heavy",
        description: "Mock reserve-heavy policy.",
        autoCpSatStageReserveRatio: 0.35,
        lnsSeedBudgetRatio: 0.1,
        lnsRepairBudgetRatio: 0.2,
      },
    ],
    solve: async (_grid, params, context) => {
      const reserveBonus = params.auto?.cpSatStageReserveRatio === 0.35 ? 5 : 0;
      const totalPopulation = context.mode === "auto" ? 10 + reserveBonus : 9;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation });
    },
  });
  assert.equal(ablations.policies.length, 2);
  assert.equal(ablations.baselinePolicyName, "baseline");
  assert.equal(ablations.bestPolicyName, "reserve-heavy");
  assert.equal(ablations.policies[0].meanAutoPopulation, 10);
  assert.equal(ablations.policies[1].meanAutoPopulation, 15);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanLnsPopulation, 0);
  assert.equal(ablations.policies[1].budgetSummaries.length, 1);
  assert.equal(ablations.policies[1].budgetSummaries[0].budgetSeconds, 3);
  assert.equal(ablations.policies[1].budgetSummaries[0].meanAutoPopulation, 15);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanLnsPopulation, 0);
  assert.equal(ablations.budgetedModeSeconds, 12);
  assert(
    ablations.policies[1].suite.cases[0].results
      .find((entry) => entry.mode === "auto")
      .decisionTrace.some((event) => event.runId.includes("policy-reserve-heavy"))
  );
  const ablationText = formatCrossModeBenchmarkBudgetAblations(ablations);
  assert.match(ablationText, /=== Cross-Mode Budget Ablations ===/);
  assert.match(ablationText, /Coverage: policies=2 scorecards=2 mode-runs=4 budgeted-mode-seconds=12/);
  assert.match(ablationText, /reserve-heavy/);
  assert.match(ablationText, /delta-vs-baseline=\+5/);
  assert.match(ablationText, /auto-delta-vs-baseline=\+5/);
  assert.match(ablationText, /lns-delta-vs-baseline=0/);
  assert.match(ablationText, /budget=3s cases=1 mean-best=15\.0/);

  const reorderedAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      {
        name: "reserve-heavy",
        description: "Mock reserve-heavy policy.",
        autoCpSatStageReserveRatio: 0.35,
      },
      { name: "baseline", description: "Mock baseline." },
    ],
    solve: async (_grid, params) => {
      const reserveBonus = params.auto?.cpSatStageReserveRatio === 0.35 ? 5 : 0;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation: 10 + reserveBonus });
    },
  });
  assert.equal(reorderedAblations.baselinePolicyName, "baseline");
  assert.equal(reorderedAblations.policies[0].policyName, "reserve-heavy");
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanLnsPopulation, null);
  assert.equal(reorderedAblations.policies[1].deltaVsBaselineMeanBestPopulation, 0);

  const tiedAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "aaa-tie", description: "Alphabetically first tied policy." },
      { name: "baseline", description: "Mock baseline." },
    ],
    solve: async (_grid, params) => buildMockSolution({ optimizer: params.optimizer, totalPopulation: 10 }),
  });
  assert.equal(tiedAblations.baselinePolicyName, "baseline");
  assert.equal(tiedAblations.bestPolicyName, "baseline");
  assert.equal(tiedAblations.topPolicyName, "baseline");
  assert.equal(tiedAblations.topPolicyRankingBasis, "mean-auto-population");
  assert.deepEqual(tiedAblations.topPolicyTiedPolicyNames, ["aaa-tie", "baseline"]);
  assert.match(formatCrossModeBenchmarkBudgetAblations(tiedAblations), /tied=aaa-tie,baseline/);

  const lnsOnlyAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["greedy", "lns"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      { name: "lns-win", description: "Mock LNS improvement." },
    ],
    solve: async (_grid, params, context) => {
      const totalPopulation = context.mode === "greedy"
        ? 20
        : context.budgetAblationPolicyName === "lns-win"
          ? 15
          : 10;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation });
    },
  });
  assert.equal(lnsOnlyAblations.topPolicyRankingBasis, "mean-lns-population");
  assert.equal(lnsOnlyAblations.topPolicyName, "lns-win");
  assert.equal(lnsOnlyAblations.bestPolicyName, "lns-win");
  assert.deepEqual(lnsOnlyAblations.topPolicyTiedPolicyNames, ["lns-win"]);

  await assert.rejects(
    () => runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
      modes: ["auto"],
      budgetsSeconds: [3],
      seeds: [5],
      baselinePolicyName: "missing-baseline",
      policies: [{ name: "baseline", description: "Mock baseline." }],
      solve: async () => {
        throw new Error("baseline validation should run before suite execution");
      },
    }),
    /baseline policy not found: missing-baseline/
  );

  await assert.rejects(
    () => runCrossModeBenchmarkSuite([benchmarkCase], { names: ["missing-case"], modes: ["greedy"] }),
    /Unknown cross-mode benchmark case\(s\): missing-case/
  );
}

const STEP14_GREEDY_BENCHMARK_NAME = "step14-service-lookahead-reranker";
const STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME = "step14-deterministic-lookahead-ties";
const STEP14_ROW0_PATH_NULL_BENCHMARK_NAME = "step14-row0-path-null-reservation";
const STEP14_SCARCE_REFILL_BENCHMARK_NAME = "step14-scarce-type-sequential-refill";
const STEP14_FOLLOW_UP_BENCHMARK_NAMES = [
  STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME,
  STEP14_ROW0_PATH_NULL_BENCHMARK_NAME,
  STEP14_SCARCE_REFILL_BENCHMARK_NAME,
];
const GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION = "serviceLookaheadCandidates";
const GREEDY_LOOKAHEAD_DISABLED = { [GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION]: undefined };

function getRequiredGreedyBenchmarkCase(name) {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === name);
  assert.ok(benchmarkCase, `Missing greedy benchmark case: ${name}`);
  return benchmarkCase;
}

function withPatchedGreedySolver(solveGreedyImpl, callback) {
  const solverModule = require("../dist/greedy/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  solverModule.solveGreedy = solveGreedyImpl;

  try {
    return callback();
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
  }
}

function runGreedyServiceLookaheadBenchmarkPair(name, solveGreedyImpl) {
  const benchmarkName = name ?? STEP14_GREEDY_BENCHMARK_NAME;
  const runPair = () => {
    const baseline = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
      names: [benchmarkName],
      greedy: GREEDY_LOOKAHEAD_DISABLED,
    });
    const enabled = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
      names: [benchmarkName],
    });
    return { baseline, enabled };
  };

  return solveGreedyImpl ? withPatchedGreedySolver(solveGreedyImpl, runPair) : runPair();
}

function solveGreedyBenchmarkCase(name, greedyOverrides) {
  const benchmarkCase = getRequiredGreedyBenchmarkCase(name);
  const params = structuredClone(benchmarkCase.params);
  params.greedy = {
    ...(params.greedy ?? {}),
    ...(greedyOverrides ?? {}),
    profile: true,
  };

  return {
    benchmarkCase,
    params,
    solution: solveGreedy(
      benchmarkCase.grid.map((row) => [...row]),
      params
    ),
  };
}

function solveValidatedGreedyBenchmarkCase(name, greedyOverrides) {
  const solved = solveGreedyBenchmarkCase(name, greedyOverrides);
  return {
    ...solved,
    validation: validateSolution({
      grid: solved.benchmarkCase.grid,
      solution: solved.solution,
      params: solved.params,
    }),
  };
}

function sortedRoads(solution) {
  return [...solution.roads].sort();
}

function assertStep14BenchmarkIsolation(name, expectedLocalSearch) {
  const benchmarkCase = getRequiredGreedyBenchmarkCase(name);
  const greedy = benchmarkCase.params.greedy ?? {};

  assert.equal(listGreedyBenchmarkCaseNames().includes(name), true);
  assert.match(benchmarkCase.description, /Step 14/i);
  assert.equal(greedy.serviceLookaheadCandidates, 4);
  assert.equal(greedy.localSearch, expectedLocalSearch);
  assert.equal(greedy.localSearchServiceMoves, false);
  assert.equal(greedy.serviceRefineIterations, 0);
  assert.equal(greedy.exhaustiveServiceSearch, false);

  return benchmarkCase;
}

function assertLookaheadCounters(result, evaluations, wins) {
  assert.equal(result.greedyProfile.counters.servicePhase.lookaheadEvaluations, evaluations);
  assert.equal(result.greedyProfile.counters.servicePhase.lookaheadWins, wins);
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
  assert.equal(normalized.serviceLookaheadCandidates, undefined);
  assert.equal(normalized.exhaustiveServiceSearch, false);
  assert.equal(normalized.serviceExactPoolLimit, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactPoolLimit);
  assert.equal(
    normalized.serviceExactMaxCombinations,
    DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactMaxCombinations
  );

  const normalizedLookahead = normalizeGreedyBenchmarkOptions(
    undefined,
    { [GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION]: 4 }
  );

  assert.equal(normalizedLookahead.serviceLookaheadCandidates, 4);

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

function testGreedyConnectivityShadowScoringAblationRunner() {
  const ablationCase = {
    name: "shadow-ablation-fixture",
    description: "Small fixture for baseline vs opt-in connectivity-shadow scoring.",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 2 }],
      availableBuildings: { services: 0, residentials: 2 },
      greedy: {
        localSearch: false,
        randomSeed: 11,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
        profile: true,
      },
    },
  };

  const result = runGreedyConnectivityShadowScoringAblation([ablationCase]);
  const formatted = formatGreedyConnectivityShadowScoringAblation(result);

  assert.equal(DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES.includes("row0-corridor-repair-pressure"), true);
  assert.equal(
    DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS.some((entry) => entry.name === "row0-corridor-repair-pressure"),
    true
  );
  assert.equal(listGreedyConnectivityShadowScoringAblationCaseNames().includes("bridge-connectivity-heavy"), true);
  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["shadow-ablation-fixture"]);
  assert.deepEqual(result.variants, ["baseline", "connectivity-shadow"]);
  assert.equal(result.coverage.caseCount, 1);
  assert.equal(result.coverage.runCount, 2);
  assert.equal(result.coverage.variantCount, 2);
  assert.equal(result.coverage.gridCellCount, 9);
  assert.equal(result.coverage.profileEnabledRuns, 2);
  assert.equal(result.cases[0].baseline.connectivityShadowScoring, false);
  assert.equal(result.cases[0].connectivityShadow.connectivityShadowScoring, true);
  assert.equal(result.cases[0].baseline.greedyOptions.connectivityShadowScoring, false);
  assert.equal(result.cases[0].connectivityShadow.greedyOptions.connectivityShadowScoring, true);
  assert.equal(
    result.cases[0].populationDelta,
    result.cases[0].connectivityShadow.totalPopulation - result.cases[0].baseline.totalPopulation
  );
  assert.equal(
    result.cases[0].wallClockDeltaSeconds,
    result.cases[0].connectivityShadow.wallClockSeconds - result.cases[0].baseline.wallClockSeconds
  );
  assert.match(formatted, /=== Greedy Connectivity-Shadow Scoring Ablation ===/);
  assert.match(formatted, /Coverage: cases=1 runs=2 variants=2 grid-cells=9/);
  assert.match(formatted, /Population delta:/);
  assert.match(formatted, /wall-delta=/);
  assert.match(formatted, /baseline=connectivityShadowScoring:false/);
  assert.match(formatted, /connectivity-shadow=connectivityShadowScoring:true/);
}

function testGreedyDeterministicAblationRunner() {
  const ablationCase = {
    name: "deterministic-ablation-fixture",
    description: "Small fixture for deterministic Greedy variant comparisons.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 40, avail: 3 }],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: {
        localSearch: true,
        localSearchServiceMoves: true,
        randomSeed: 11,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16,
        profile: true,
      },
    },
  };
  const variants = [
    { name: "baseline", description: "Baseline fixture settings.", greedy: {} },
    { name: "no-local-search", description: "Disable all local search.", greedy: { localSearch: false, localSearchServiceMoves: false } },
    { name: "deferred-roads", description: "Enable deferred road commitment.", greedy: { deferRoadCommitment: true } },
  ];

  const result = runGreedyDeterministicAblation([ablationCase], { variants });
  const formatted = formatGreedyDeterministicAblation(result);
  const snapshot = createGreedyDeterministicAblationSnapshot(result);
  const benchmarkCase = result.cases[0];
  const baselineSummary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
  const noLocalSearch = benchmarkCase.variants.find((entry) => entry.variantName === "no-local-search");

  assert.equal(DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES.includes("step14-service-lookahead-reranker"), true);
  assert.equal(listGreedyDeterministicAblationCaseNames().includes("row0-corridor-repair-pressure"), true);
  assert.equal(result.caseCount, 1);
  assert.equal(result.seedCount, 1);
  assert.equal(result.comparisonCount, 1);
  assert.deepEqual(result.seeds, []);
  assert.deepEqual(result.selectedCaseNames, ["deterministic-ablation-fixture"]);
  assert.deepEqual(result.variants, ["baseline", "no-local-search", "deferred-roads"]);
  assert.equal(result.coverage.caseCount, 1);
  assert.equal(result.coverage.seedCount, 1);
  assert.equal(result.coverage.comparisonCount, 1);
  assert.equal(result.coverage.runCount, 3);
  assert.equal(result.coverage.variantCount, 3);
  assert.equal(result.coverage.gridCellCount, 16);
  assert.equal(result.coverage.profileEnabledRuns, 0);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.variantSummaries[0], "meanWallClockSeconds"), false);
  assert.equal(Object.hasOwn(snapshot.cases[0].baseline, "wallClockSeconds"), false);
  assert.equal(benchmarkCase.baseline.greedyOptions.profile, false);
  assert.equal(benchmarkCase.baseline.populationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.meanPopulationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.winRate, 0);
  assert.equal(baselineSummary.regressionRate, 0);
  assert.equal(baselineSummary.unchangedRate, 1);
  assert.equal(baselineSummary.worstPopulationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.worstPopulationDeltaCaseName, "deterministic-ablation-fixture");
  assert.equal(baselineSummary.worstPopulationDeltaSeed, null);
  assert.equal(baselineSummary.bestPopulationDeltaCaseName, "deterministic-ablation-fixture");
  assert.equal(baselineSummary.bestPopulationDeltaSeed, null);
  assert.equal(noLocalSearch.greedyOptions.localSearch, false);
  assert.equal(
    noLocalSearch.populationDeltaVsBaseline,
    noLocalSearch.totalPopulation - benchmarkCase.baseline.totalPopulation
  );
  assert.match(formatted, /=== Greedy Deterministic Ablation Matrix ===/);
  assert.match(formatted, /Seeds: case-default/);
  assert.match(formatted, /worst-decile=/);
  assert.match(formatted, /win-rate=0\.0%/);
  assert.match(formatted, /unchanged-rate=100\.0%/);
  assert.match(formatted, /worst-case=deterministic-ablation-fixture\/case-default/);
  assert.match(formatted, /no-local-search=population:/);

  const seededResult = runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7, 19] });
  const seededFormatted = formatGreedyDeterministicAblation(seededResult);
  assert.deepEqual(seededResult.seeds, [7, 19]);
  assert.equal(seededResult.seedCount, 2);
  assert.equal(seededResult.caseCount, 1);
  assert.equal(seededResult.comparisonCount, 2);
  assert.deepEqual(seededResult.selectedCaseNames, ["deterministic-ablation-fixture"]);
  assert.equal(seededResult.coverage.caseCount, 1);
  assert.equal(seededResult.coverage.seedCount, 2);
  assert.equal(seededResult.coverage.comparisonCount, 2);
  assert.equal(seededResult.coverage.runCount, 6);
  assert.equal(seededResult.variantSummaries[0].caseCount, 1);
  assert.equal(seededResult.variantSummaries[0].seedCount, 2);
  assert.equal(seededResult.variantSummaries[0].comparisonCount, 2);
  assert.equal(seededResult.variantSummaries[0].unchangedRate, 1);
  assert.equal(seededResult.variantSummaries[0].worstPopulationDeltaSeed, 7);
  assert.equal(seededResult.variantSummaries[0].bestPopulationDeltaSeed, 7);
  assert.deepEqual(seededResult.cases.map((entry) => entry.seed), [7, 19]);
  assert.deepEqual(
    seededResult.cases.flatMap((entry) => entry.variants.map((variant) => variant.greedyOptions.randomSeed)),
    [7, 7, 7, 19, 19, 19]
  );
  for (const seededCase of seededResult.cases) {
    for (const variant of seededCase.variants) {
      assert.equal(variant.seed, seededCase.seed);
      assert.equal(variant.greedyOptions.randomSeed, seededCase.seed);
    }
  }
  assert.match(seededFormatted, /Seeds: 7, 19/);
  assert.match(seededFormatted, /comparisons=2/);
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], {
      variants: [{ name: "no-local-search", description: "Invalid missing baseline.", greedy: { localSearch: false } }],
    }),
    /must include the baseline variant/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], {
      variantNames: ["no-local-search", "no-local-search"],
    }),
    /requested variants must use unique names/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7.5] }),
    /must contain only integer seeds between 0 and 2147483647/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [4294967297] }),
    /must contain only integer seeds between 0 and 2147483647/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7, 7] }),
    /must not contain duplicate seeds/
  );
}

function testDeterministicAblationGateReport() {
  const summary = (variantName, overrides = {}) => ({
    variantName,
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 4,
    medianPopulationDeltaVsBaseline: 0,
    worstDecilePopulationDeltaVsBaseline: 0,
    bestPopulationDeltaVsBaseline: 0,
    worstPopulationDeltaVsBaseline: 0,
    winRate: 0,
    regressionRate: 0,
    unchangedRate: 1,
    bestPopulationDeltaCaseName: "case-a",
    bestPopulationDeltaSeed: 7,
    worstPopulationDeltaCaseName: "case-a",
    worstPopulationDeltaSeed: 7,
    ...overrides,
  });
  const greedySuite = {
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 4,
    seeds: [7, 19],
    selectedCaseNames: ["case-a", "case-b"],
    variants: ["baseline", "candidate", "target", "bad"],
    variantSummaries: [
      summary("baseline"),
      summary("candidate", {
        medianPopulationDeltaVsBaseline: 10,
        bestPopulationDeltaVsBaseline: 20,
        winRate: 0.75,
        unchangedRate: 0.25,
      }),
      summary("target", {
        bestPopulationDeltaVsBaseline: 10,
        winRate: 0.25,
        unchangedRate: 0.75,
      }),
      summary("bad", {
        worstDecilePopulationDeltaVsBaseline: -5,
        worstPopulationDeltaVsBaseline: -5,
        bestPopulationDeltaVsBaseline: 20,
        winRate: 0.25,
        regressionRate: 0.25,
        unchangedRate: 0.5,
      }),
    ],
  };
  const lnsSuite = {
    caseCount: 1,
    seedCount: 2,
    comparisonCount: 2,
    seeds: [7, 19],
    selectedCaseNames: ["lns-case"],
    variants: ["baseline", "moved-window"],
    variantSummaries: [
      summary("baseline", {
        caseCount: 1,
        comparisonCount: 2,
        firstWindowMovementRate: 0,
        windowSequenceMovementRate: 0,
        anchorCoordinateMovementRate: 0,
      }),
      summary("moved-window", {
        caseCount: 1,
        comparisonCount: 2,
        firstWindowMovementRate: 0,
        windowSequenceMovementRate: 1,
        anchorCoordinateMovementRate: 1,
      }),
    ],
  };

  const report = buildDeterministicAblationGateReport({ greedy: greedySuite, lns: lnsSuite });
  const formatted = formatDeterministicAblationGateReport(report);
  const greedyDecisions = report.suites.find((entry) => entry.suite === "greedy-deterministic").decisions;
  const lnsDecisions = report.suites.find((entry) => entry.suite === "lns-neighborhood").decisions;

  assert.deepEqual(DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS, [7, 19, 37]);
  assert.equal(report.reportType, "deterministic-ablation-gate");
  assert.equal(Object.hasOwn(report, "generatedAt"), false);
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "baseline").decision, "keep-baseline");
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "candidate").decision, "safe-deterministic-candidate");
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "target").decision, "learning-target");
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "bad").decision, "blocked-regression");
  assert.equal(lnsDecisions.find((entry) => entry.variantName === "moved-window").decision, "learning-target");
  assert.match(formatted, /Deterministic Ablation Gate Report/);
  assert.match(formatted, /candidate: safe-deterministic-candidate/);
  assert.match(formatted, /Collect counterfactual LNS window replay labels/);
  assert.throws(
    () => buildDeterministicAblationGateReport({}),
    /requires at least one suite result/
  );
}

function testGreedyStep14ServiceLookaheadBenchmarkCaseIsolated() {
  assertStep14BenchmarkIsolation(STEP14_GREEDY_BENCHMARK_NAME, true);
}

function testGreedyStep14FollowUpBenchmarkCasesStayIsolated() {
  for (const name of STEP14_FOLLOW_UP_BENCHMARK_NAMES) {
    assertStep14BenchmarkIsolation(name, false);
  }
}

function testGreedyServiceLookaheadIsOffByDefaultAndLeavesCorpusUnchangedWhenOff() {
  const { baseline } = runGreedyServiceLookaheadBenchmarkPair(STEP14_GREEDY_BENCHMARK_NAME);
  const untouchedCorpusCase = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
  });

  assert.deepEqual(baseline.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(baseline.results[0].totalPopulation, 240);
  assert.equal(baseline.results[0].serviceCount, 1);
  assert.equal(baseline.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations, 0);
  assert.equal(baseline.results[0].greedyProfile.counters.servicePhase.lookaheadWins, 0);
  assert.deepEqual(untouchedCorpusCase.selectedCaseNames, ["compact-service-single"]);
  assert.equal(untouchedCorpusCase.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(untouchedCorpusCase.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations, 0);
}

function testGreedyStep14ServiceLookaheadBenchmarkCaseImprovesWhenEnabled() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_GREEDY_BENCHMARK_NAME);

  assert.deepEqual(baseline.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(enabled.results[0].greedyOptions.serviceLookaheadCandidates, 4);
  assert.equal(baseline.results[0].totalPopulation, 240);
  assert.equal(enabled.results[0].totalPopulation, 275);
  assert.equal(enabled.results[0].serviceCount, 2);
  assert.equal(enabled.results[0].totalPopulation > baseline.results[0].totalPopulation, true);
  assert.equal(enabled.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations > 0, true);
  assert.equal(enabled.results[0].greedyProfile.counters.servicePhase.lookaheadWins > 0, true);
}

function testGreedyStep14DeterministicLookaheadTieBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  const baselineSolve = solveGreedyBenchmarkCase(
    STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME,
    GREEDY_LOOKAHEAD_DISABLED
  );
  const firstEnabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  const secondEnabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME]);
  assert.equal(enabled.results[0].name, STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  assert.equal(baseline.results[0].totalPopulation, 200);
  assert.equal(enabled.results[0].totalPopulation, 200);
  assert.equal(enabled.results[0].serviceCount, 1);
  assert.equal(enabled.results[0].residentialCount, 2);
  assertLookaheadCounters(enabled.results[0], 36, 1);
  assert.deepEqual(baselineSolve.solution.services, [
    { r: 1, c: 2, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(firstEnabledSolve.solution.services, [
    { r: 1, c: 2, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(firstEnabledSolve.solution.residentials, [
    { r: 0, c: 0, rows: 2, cols: 2 },
    { r: 0, c: 3, rows: 2, cols: 2 },
  ]);
  assert.deepEqual(firstEnabledSolve.solution.populations, [100, 100]);
  assert.deepEqual(sortedRoads(firstEnabledSolve.solution), ["0,2"]);
  assert.deepEqual(firstEnabledSolve.solution.services, baselineSolve.solution.services);
  assert.deepEqual(secondEnabledSolve.solution.services, firstEnabledSolve.solution.services);
  assert.deepEqual(secondEnabledSolve.solution.residentials, firstEnabledSolve.solution.residentials);
  assert.deepEqual(secondEnabledSolve.solution.populations, firstEnabledSolve.solution.populations);
  assert.deepEqual(sortedRoads(secondEnabledSolve.solution), sortedRoads(firstEnabledSolve.solution));
  assert.equal(firstEnabledSolve.validation.valid, true);
  assert.equal(secondEnabledSolve.validation.valid, true);
  assert.match(formatGreedyBenchmarkSuite(enabled), /step14=/);
}

function testGreedyStep14Row0PathNullReservationBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_ROW0_PATH_NULL_BENCHMARK_NAME);
  const baselineSolve = solveValidatedGreedyBenchmarkCase(
    STEP14_ROW0_PATH_NULL_BENCHMARK_NAME,
    GREEDY_LOOKAHEAD_DISABLED
  );
  const enabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_ROW0_PATH_NULL_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_ROW0_PATH_NULL_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].totalPopulation, 230);
  assert.equal(enabled.results[0].totalPopulation, 230);
  assert.equal(enabled.results[0].serviceCount, 1);
  assert.equal(enabled.results[0].residentialCount, 2);
  assertLookaheadCounters(enabled.results[0], 36, 4);
  assert.deepEqual(baselineSolve.solution.services, [
    { r: 1, c: 1, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(enabledSolve.solution.services, [
    { r: 0, c: 1, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(sortedRoads(baselineSolve.solution), ["0,0", "1,0"]);
  assert.deepEqual(sortedRoads(enabledSolve.solution), ["0,0"]);
  assert.deepEqual(enabledSolve.solution.residentials, [
    { r: 0, c: 2, rows: 3, cols: 2 },
    { r: 1, c: 0, rows: 2, cols: 2 },
  ]);
  assert.equal(enabledSolve.solution.services[0].r, 0);
  assert.equal(enabledSolve.solution.roads.size < baselineSolve.solution.roads.size, true);
  assert.equal(baselineSolve.validation.valid, true);
  assert.equal(enabledSolve.validation.valid, true);
}

function testGreedyStep14ScarceTypeSequentialRefillBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_SCARCE_REFILL_BENCHMARK_NAME);
  const baselineSolve = solveValidatedGreedyBenchmarkCase(
    STEP14_SCARCE_REFILL_BENCHMARK_NAME,
    GREEDY_LOOKAHEAD_DISABLED
  );
  const enabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_SCARCE_REFILL_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_SCARCE_REFILL_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].totalPopulation, 185);
  assert.equal(enabled.results[0].totalPopulation, 210);
  assert.equal(enabled.results[0].serviceCount, 2);
  assert.equal(enabled.results[0].residentialCount, 2);
  assertLookaheadCounters(enabled.results[0], 56, 2);
  assert.deepEqual(enabledSolve.solution.services, [
    { r: 1, c: 2, rows: 1, cols: 1, range: 1 },
    { r: 1, c: 0, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(enabledSolve.solution.residentialTypeIndices, [0, 1]);
  assert.deepEqual(enabledSolve.solution.populations, [120, 90]);
  assert.equal(
    enabledSolve.solution.residentialTypeIndices.filter((typeIndex) => typeIndex === 0).length,
    1
  );
  assert.equal(
    enabledSolve.solution.residentialTypeIndices.filter((typeIndex) => typeIndex === 1).length,
    1
  );
  assert.deepEqual(baselineSolve.solution.residentialTypeIndices, [0, 1]);
  assert.deepEqual(baselineSolve.solution.populations, [95, 90]);
  assert.equal(enabledSolve.solution.totalPopulation > baselineSolve.solution.totalPopulation, true);
  assert.equal(baselineSolve.validation.valid, true);
  assert.equal(enabledSolve.validation.valid, true);
}

function testGreedyStep14LookaheadCapsRefillDepthWhenMaxResidentialsIsOne() {
  const grid = [
    [0, 1, 1, 1, 1, 1],
    [1, 1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [0, 1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 0],
  ];
  const enabledParams = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
      { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 5 },
      { w: 2, h: 3, min: 90, max: 170, avail: 3 },
    ],
    availableBuildings: { residentials: 1 },
    greedy: {
      localSearch: false,
      localSearchServiceMoves: false,
      randomSeed: 13,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 6,
      serviceExactMaxCombinations: 64,
      serviceLookaheadCandidates: 4,
      profile: true,
    },
  };
  const baselineParams = structuredClone(enabledParams);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    serviceLookaheadCandidates: undefined,
  };

  const baseline = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const enabled = solveGreedy(
    grid.map((row) => [...row]),
    enabledParams
  );
  const validation = validateSolution({ grid, solution: enabled, params: enabledParams });

  assert.equal(baseline.totalPopulation, 170);
  assert.equal(enabled.totalPopulation, 170);
  assert.equal(enabled.residentials.length, 1);
  assert.deepEqual(enabled.services, [
    { r: 2, c: 3, rows: 1, cols: 2, range: 1 },
    { r: 2, c: 0, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(enabled.serviceTypeIndices, [2, 0]);
  assert.deepEqual(enabled.residentials, [
    { r: 2, c: 1, rows: 3, cols: 2 },
  ]);
  assert.deepEqual(enabled.residentialTypeIndices, [1]);
  assert.deepEqual(enabled.populations, [170]);
  assert.equal(enabled.greedyProfile.counters.servicePhase.lookaheadEvaluations > 0, true);
  assert.equal(enabled.greedyProfile.counters.servicePhase.lookaheadWins > 0, true);
  assert.equal(validation.valid, true);
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
  assert(result.results[0].greedyProfile.counters.roads.connectivityShadowChecks > 0);
  assert(result.results[0].greedyProfile.counters.roads.connectivityShadowLostCells > 0);
  assert(result.results[0].greedyProfile.counters.roads.roadOpportunityChecks > 0);
  assert(
    result.results[0].greedyProfile.counters.roads.roadOpportunityLostCells
      >= result.results[0].greedyProfile.counters.roads.roadOpportunityFootprintCells
  );
  assert(result.results[0].greedyProfile.roadOpportunityTraces.length > 0);
  assert.equal(result.results[0].greedyProfile.roadOpportunityTraces[0].reachableBefore >= 0, true);
  assert.equal(
    result.results[0].greedyProfile.roadOpportunityTraces[0].lostCells,
    result.results[0].greedyProfile.roadOpportunityTraces[0].reachableBefore
      - result.results[0].greedyProfile.roadOpportunityTraces[0].reachableAfter
  );
  assert(
    result.results[0].greedyProfile.counters.roads.connectivityShadowLostCells
      >= result.results[0].greedyProfile.counters.roads.connectivityShadowFootprintCells
  );
  assert(result.results[0].greedyProfile.phases.some((phase) => phase.name === "precompute" && phase.runs === 1));
  assert(
    result.results[0].greedyProfile.phases.some(
      (phase) => phase.name === "constructiveCapSearch" && phase.bestPopulationAfter !== null
    )
  );
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.results[0], "wallClockSeconds"), false);
  assert.equal(snapshot.results[0].progressSummary.elapsedTimeSeconds, null);
  assert.equal(Object.hasOwn(snapshot.results[0].greedyProfile.phases[0], "elapsedMs"), false);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-sweep-mixed/);
  assert.match(formatGreedyBenchmarkSuite(result), /pop-cache=/);
  assert.match(formatGreedyBenchmarkSuite(result), /local-service=/);
  assert.match(formatGreedyBenchmarkSuite(result), /phases=/);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-search=/);
  assert.match(formatGreedyBenchmarkSuite(result), /connectivity-shadow=/);
  assert.match(formatGreedyBenchmarkSuite(result), /connectivity-shadow-scoring=/);
  assert.match(formatGreedyBenchmarkSuite(result), /road-opportunity=/);
  assert.match(formatGreedyBenchmarkSuite(result), /counterfactuals:/);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
  assert.match(formatGreedyBenchmarkSuite(result), /step14=/);
}

function runGreedyBenchmarkCliJson(args) {
  const cliPath = path.join(__dirname, "..", "dist", "greedyBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--json", ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Greedy benchmark CLI failed.");
  }
  return JSON.parse(result.stdout);
}

function runLnsBenchmarkCli(args) {
  const cliPath = path.join(__dirname, "..", "dist", "lnsBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "LNS benchmark CLI failed.");
  }
  return result.stdout;
}

function testGreedyBenchmarkCliConnectivityShadowFlags() {
  const benchmarkName = "deterministic-tie-breaks";
  const defaultRun = runGreedyBenchmarkCliJson(["--no-profile", benchmarkName]);
  const disabledRun = runGreedyBenchmarkCliJson(["--no-connectivity-shadow-scoring", "--no-profile", benchmarkName]);
  const enabledRun = runGreedyBenchmarkCliJson(["--connectivity-shadow-scoring", "--no-profile", benchmarkName]);
  const labelRun = runGreedyBenchmarkCliJson([
    "--connectivity-shadow-labels",
    "--seeds=7",
    "--max-labels=1",
    benchmarkName,
  ]);

  assert.deepEqual(defaultRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(disabledRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(enabledRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(labelRun.selectedCaseNames, [benchmarkName]);
  assert.equal(defaultRun.results[0].greedyOptions.connectivityShadowScoring, undefined);
  assert.equal(disabledRun.results[0].greedyOptions.connectivityShadowScoring, false);
  assert.equal(enabledRun.results[0].greedyOptions.connectivityShadowScoring, true);
  assert.equal(enabledRun.results[0].greedyOptions.profile, false);
  assert.equal(disabledRun.results[0].totalPopulation, defaultRun.results[0].totalPopulation);
  assert.equal(labelRun.seedCount, 1);
  assert.deepEqual(labelRun.seeds, [7]);
  assert.equal(labelRun.maxLabelsPerCase, 1);
  assert.equal(labelRun.cases[0].greedyOptions.connectivityShadowScoring, true);
  assert.equal(labelRun.cases[0].greedyOptions.profile, true);
  assert.equal(Object.hasOwn(labelRun, "generatedAt"), false);
}

function testGreedyBenchmarkCliDeterministicAblationFlags() {
  const benchmarkName = "step14-service-lookahead-reranker";
  const result = runGreedyBenchmarkCliJson([
    "--deterministic-ablation",
    "--ablation-variants=no-local-search",
    "--seeds=7,19",
    benchmarkName,
  ]);

  assert.deepEqual(result.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(result.variants, ["baseline", "no-local-search"]);
  assert.deepEqual(result.seeds, [7, 19]);
  assert.equal(result.caseCount, 1);
  assert.equal(result.seedCount, 2);
  assert.equal(result.comparisonCount, 2);
  assert.equal(result.coverage.runCount, 4);
  assert.deepEqual(result.cases.map((entry) => entry.seed), [7, 19]);
  assert.equal(result.cases[0].baseline.greedyOptions.profile, false);
  assert.equal(result.cases[0].variants[1].greedyOptions.localSearch, false);
  assert.equal(result.cases[1].baseline.greedyOptions.randomSeed, 19);

  const gateReport = runGreedyBenchmarkCliJson([
    "--deterministic-ablation",
    "--gate-report",
    "--ablation-variants=no-local-search",
    benchmarkName,
  ]);
  assert.equal(gateReport.reportType, "deterministic-ablation-gate");
  assert.deepEqual(gateReport.suites[0].seeds, [7, 19, 37]);
  assert.equal(gateReport.suites[0].suite, "greedy-deterministic");
  assert.equal(Object.hasOwn(gateReport, "generatedAt"), false);
}

function testLnsBenchmarkCliNeighborhoodAblationSeedListParsing() {
  const output = runLnsBenchmarkCli(["--list", "--neighborhood-ablation", "--seeds=7,19"]);

  assert.match(output, /compact-service-repair/);
  assert.match(output, /row0-anchor-repair/);

  const gateReport = JSON.parse(runLnsBenchmarkCli([
    "--json",
    "--neighborhood-ablation",
    "--gate-report",
    "--seeds=7",
    "--ablation-variants=baseline,sliding-only",
    "seeded-service-anchor-pressure",
  ]));
  assert.equal(gateReport.reportType, "deterministic-ablation-gate");
  assert.equal(gateReport.suites[0].suite, "lns-neighborhood");
  assert.deepEqual(gateReport.suites[0].seeds, [7]);
  assert.equal(Object.hasOwn(gateReport, "generatedAt"), false);
}

function testGreedyDeterministicTieBreakBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["deterministic-tie-breaks"],
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["deterministic-tie-breaks"]);
  assert.equal(result.results[0].serviceCount, 0);
  assert.equal(result.results[0].residentialCount, 1);
  assert.equal(result.results[0].totalPopulation, 40);
  assert(result.results[0].greedyProfile);
  assert.match(formatGreedyBenchmarkSuite(result), /deterministic-tie-breaks/);
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

function testGridRectangleBorderCellsPreserveExpectedRing() {
  assert.deepEqual(rectangleBorderCells(2, 3, 2, 3), [
    [1, 3],
    [4, 3],
    [1, 4],
    [4, 4],
    [1, 5],
    [4, 5],
    [2, 2],
    [2, 6],
    [3, 2],
    [3, 6],
  ]);
  assert.deepEqual(rectangleBorderCells(0, 0, 1, 1), [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]);
}

function testGreedyGeometryOccupancyHotPathBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["geometry-occupancy-hot-path"],
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["geometry-occupancy-hot-path"]);
  assert.equal(result.results[0].name, "geometry-occupancy-hot-path");
  assert.equal(result.results[0].totalPopulation, 1030);
  assert.equal(result.results[0].serviceCount, 5);
  assert.equal(result.results[0].residentialCount, 6);
  assert.equal(result.results[0].greedyProfile.counters.servicePhase.candidateScans > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.residentialPhase.candidateScans > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.geometryCacheEntries > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeCalls > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.scratchProbeCalls > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
  assert.match(formatGreedyBenchmarkSuite(result), /geometry-occupancy-hot-path/);
  assert.match(formatGreedyBenchmarkSuite(result), /scratch=/);
}

function inferredPositiveServiceUpper(params) {
  const types = params.serviceTypes ?? [];
  const positiveBonuses = types.reduce(
    (sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0),
    0
  );
  const totalAvail = types.reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  return positiveBonuses > 0 ? Math.min(totalAvail, positiveBonuses) : totalAvail;
}

function testGreedyExplicitServiceCapIsMaximum() {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 2, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 150, avail: 4 }],
    availableBuildings: { services: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      profile: true,
    },
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(validation.valid, true);
  assert.equal(solution.totalPopulation, 200);
  assert.equal(solution.services.length, 0);
  assert.equal(solution.residentials.length, 2);
  assert.equal(solution.greedyProfile.counters.attempts.serviceCaps, 2);
}

function testGreedyExplicitCapSweepsAllAllowedLowerCaps() {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 32, range: 1, avail: 5 },
      { rows: 2, cols: 2, bonus: 58, range: 1, avail: 3 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 8 },
      { w: 2, h: 3, min: 95, max: 175, avail: 4 },
    ],
    availableBuildings: { services: 3 },
    greedy: {
      localSearch: false,
      randomSeed: 53,
      restarts: 3,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64,
      profile: true,
    },
  };

  const solution = solveGreedy(grid, params);
  const counters = solution.greedyProfile.counters.attempts;

  assert.equal(counters.serviceCaps, 4);
  assert.equal(counters.coarseCaps, 0);
  assert.equal(counters.refineCaps, 0);
  assert.equal(counters.capsSkipped, 0);
}

function testGreedySmallUpperKeepsFullCapSweep() {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "cap-sweep-mixed");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone({
      ...benchmarkCase.params,
      greedy: {
        ...benchmarkCase.params.greedy,
        profile: true,
      },
    })
  );
  const counters = solution.greedyProfile.counters.attempts;
  const upper = inferredPositiveServiceUpper(benchmarkCase.params);

  assert.equal(upper <= 6, true);
  assert.equal(counters.serviceCaps, upper + 1);
  assert.equal(counters.coarseCaps, 0);
  assert.equal(counters.refineCaps, 0);
  assert.equal(counters.capsSkipped, 0);
}

function testGreedyAdaptiveCapSearchWideBenchmarkCase() {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "adaptive-cap-search-wide");
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["adaptive-cap-search-wide"],
  });
  const counters = result.results[0].greedyProfile.counters.attempts;
  const upper = inferredPositiveServiceUpper(benchmarkCase.params);

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["adaptive-cap-search-wide"]);
  assert.equal(result.results[0].name, "adaptive-cap-search-wide");
  assert.equal(upper > 6, true);
  assert.equal(counters.serviceCaps < upper + 1, true);
  assert.equal(counters.coarseCaps > 0, true);
  assert.equal(counters.refineCaps > 0, true);
  assert.equal(counters.refineCaps <= counters.serviceCaps, true);
  assert.equal(counters.capsSkipped > 0, true);
  assert.equal(counters.serviceCaps + counters.capsSkipped, upper + 1);
  assert.equal(counters.restartCaps < counters.serviceCaps, true);
  assert.match(formatGreedyBenchmarkSuite(result), /adaptive-cap-search-wide/);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-search=/);
}

function testGreedyAdaptiveCapSearchMatchesBestExplicitCap() {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 28, range: 1, avail: 5 },
      { rows: 2, cols: 2, bonus: 50, range: 1, avail: 2 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 6 },
      { w: 2, h: 3, min: 95, max: 175, avail: 3 },
    ],
    greedy: {
      localSearch: false,
      randomSeed: 59,
      restarts: 2,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64,
    },
  };
  const upper = inferredPositiveServiceUpper(params);
  let bestExplicit = null;
  let bestExplicitCap = null;

  for (let cap = 0; cap <= upper; cap++) {
    const candidate = solveGreedy(
      grid.map((row) => [...row]),
      structuredClone({
        ...params,
        availableBuildings: { services: cap },
      })
    );
    if (!bestExplicit || candidate.totalPopulation > bestExplicit.totalPopulation) {
      bestExplicit = candidate;
      bestExplicitCap = cap;
    }
  }

  const adaptive = solveGreedy(
    grid.map((row) => [...row]),
    structuredClone({
      ...params,
      greedy: {
        ...params.greedy,
        profile: true,
      },
    })
  );

  assert.equal(upper > 6, true);
  assert.notEqual(bestExplicitCap, 0);
  assert.notEqual(bestExplicitCap, upper);
  assert.equal(adaptive.totalPopulation, bestExplicit.totalPopulation);
  assert.equal(adaptive.greedyProfile.counters.attempts.coarseCaps > 0, true);
  assert.equal(adaptive.greedyProfile.counters.attempts.refineCaps > 0, true);
}

function testGreedyIncrementalInvalidationPreservesBenchmarkOutputs() {
  const expectations = {
    "typed-housing-baseline": { totalPopulation: 110, serviceCount: 0, residentialCount: 2 },
    "compact-service-single": { totalPopulation: 370, serviceCount: 1, residentialCount: 2 },
    "cap-sweep-mixed": { totalPopulation: 460, serviceCount: 2, residentialCount: 3 },
    "bridge-connectivity-heavy": { totalPopulation: 400, serviceCount: 1, residentialCount: 3 },
    "geometry-occupancy-hot-path": { totalPopulation: 1030, serviceCount: 5, residentialCount: 6 },
    "typed-footprint-pressure": { totalPopulation: 450, serviceCount: 2, residentialCount: 4 },
    "adaptive-cap-search-wide": { totalPopulation: 870, serviceCount: 2, residentialCount: 6 },
    "crowded-invalidation-heavy": { totalPopulation: 747, serviceCount: 2, residentialCount: 6 },
    "service-local-neighborhood": { totalPopulation: 295, serviceCount: 2, residentialCount: 3 },
    "step14-deterministic-lookahead-ties": { totalPopulation: 200, serviceCount: 1, residentialCount: 2 },
    "step14-row0-path-null-reservation": { totalPopulation: 230, serviceCount: 1, residentialCount: 2 },
    "step14-scarce-type-sequential-refill": { totalPopulation: 210, serviceCount: 2, residentialCount: 2 },
  };

  for (const [name, expected] of Object.entries(expectations)) {
    const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, { names: [name] });
    const benchmark = result.results[0];

    assert.equal(benchmark.name, name);
    assert.equal(benchmark.totalPopulation, expected.totalPopulation);
    assert.equal(benchmark.serviceCount, expected.serviceCount);
    assert.equal(benchmark.residentialCount, expected.residentialCount);
  }
}

function testGreedyIncrementalInvalidationCounters() {
  const crowdedBenchmarkResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["crowded-invalidation-heavy"],
  });
  assert.equal(crowdedBenchmarkResult.caseCount, 1);
  assert.deepEqual(crowdedBenchmarkResult.selectedCaseNames, ["crowded-invalidation-heavy"]);
  assert.equal(crowdedBenchmarkResult.results[0].name, "crowded-invalidation-heavy");
  assert.match(formatGreedyBenchmarkSuite(crowdedBenchmarkResult), /crowded-invalidation-heavy/);
  assert.match(formatGreedyBenchmarkSuite(crowdedBenchmarkResult), /invalidation=/);

  const crowdedBenchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "crowded-invalidation-heavy");
  const focusedCrowdedParams = structuredClone(crowdedBenchmarkCase.params);
  focusedCrowdedParams.maxServices = 1;
  focusedCrowdedParams.greedy = {
    ...focusedCrowdedParams.greedy,
    localSearch: false,
    restarts: 1,
    serviceRefineIterations: 0,
    profile: true,
  };
  const focusedCrowdedSolution = solveGreedy(
    crowdedBenchmarkCase.grid.map((row) => [...row]),
    focusedCrowdedParams
  );
  const focusedCrowdedCounters = focusedCrowdedSolution.greedyProfile.counters;

  assert.equal(focusedCrowdedSolution.totalPopulation, 579);
  assert.equal(focusedCrowdedSolution.services.length, 1);
  assert.equal(focusedCrowdedSolution.residentials.length, 5);
  assert.equal(focusedCrowdedCounters.attempts.serviceCaps, 2);
  assert.equal(focusedCrowdedCounters.attempts.restarts, 0);
  assert.equal(focusedCrowdedCounters.attempts.localSearchIterations, 0);
  assert.equal(focusedCrowdedCounters.servicePhase.fixedPlacements, 0);
  assert.equal(focusedCrowdedCounters.servicePhase.candidateInvalidations > 0, true);
  assert.equal(focusedCrowdedCounters.servicePhase.scoreDirtyMarks > 0, true);
  assert.equal(focusedCrowdedCounters.servicePhase.scoreRecomputes > 0, true);
  assert.equal(focusedCrowdedCounters.residentialPhase.candidateInvalidations > 0, true);
  assert.equal(
    focusedCrowdedCounters.servicePhase.candidateScans <
      focusedCrowdedCounters.precompute.serviceCandidates
        * Math.max(1, focusedCrowdedCounters.servicePhase.placements),
    true
  );
  assert.equal(focusedCrowdedCounters.servicePhase.candidateScans < 500, true);
  assert.equal(
    focusedCrowdedCounters.residentialPhase.candidateScans <
      focusedCrowdedCounters.precompute.residentialCandidates
        * Math.max(1, focusedCrowdedCounters.residentialPhase.placements),
    true
  );

  const typedResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-availability-pressure"],
  });
  const typedCounters = typedResult.results[0].greedyProfile.counters;

  assert.equal(typedCounters.servicePhase.typeInvalidations > 0, true);
  assert.equal(typedCounters.residentialPhase.typeInvalidations > 0, true);

  const fixedServiceResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
  });
  const fixedServiceCounters = fixedServiceResult.results[0].greedyProfile.counters;

  assert.equal(fixedServiceCounters.attempts.serviceRefineTrials > 0, true);
  assert.equal(fixedServiceCounters.servicePhase.fixedPlacements > 0, true);
}

function testGreedyDeferredRoadCommitmentBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["deferred-road-packing-gain"],
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "deferred-road-packing-gain");
  const deferredParams = structuredClone(benchmarkCase.params);
  deferredParams.greedy = { ...deferredParams.greedy, profile: true };
  const deferredSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    deferredParams
  );
  const explicitParams = structuredClone(benchmarkCase.params);
  explicitParams.greedy = { ...explicitParams.greedy, deferRoadCommitment: false, profile: true };
  const explicitSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    explicitParams
  );
  const counters = deferredSolution.greedyProfile.counters;
  const validation = validateSolutionMap({
    grid: benchmarkCase.grid,
    solution: deferredSolution,
    params: deferredParams,
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["deferred-road-packing-gain"]);
  assert.equal(result.results[0].name, "deferred-road-packing-gain");
  assert.equal(result.results[0].totalPopulation, 260);
  assert.equal(result.results[0].roadCount, 3);
  assert.equal(result.results[0].serviceCount, 1);
  assert.equal(result.results[0].residentialCount, 2);
  assert.equal(deferredSolution.totalPopulation, 260);
  assert.equal(deferredSolution.roads.size, 3);
  assert.equal(explicitSolution.totalPopulation, 180);
  assert.equal(explicitSolution.roads.size, 2);
  assert.equal(deferredSolution.totalPopulation > explicitSolution.totalPopulation, true);
  assert.equal(validation.valid, true);
  assert.equal(counters.roads.deferredFrontierRecomputes > 0, true);
  assert.equal(counters.roads.deferredReconstructionSteps > 0, true);
  assert.equal(counters.roads.deferredReconstructionFailures >= 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /deferred-road-packing-gain/);
  assert.match(formatGreedyBenchmarkSuite(result), /deferred-roads=/);
}

function testGreedyDeferredRoadCommitmentKeepsTopRowShortcut() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false, deferRoadCommitment: true },
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.roads.size > 0, true);
  assert.equal(validation.valid, true);
}

function testGreedyDeferredRoadMaterializationFailsDeterministically() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const occupiedBuildings = new Set(["0,0", "0,1", "0,2", "0,3"]);
  const roads = materializeDeferredRoadNetwork(
    grid,
    undefined,
    occupiedBuildings,
    [{ r: 2, c: 1, rows: 1, cols: 1 }]
  );

  assert.equal(roads, null);
}

function testGreedyFixedServiceRealizationCompletenessBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["fixed-service-realization-complete"],
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "fixed-service-realization-complete");
  const improvedParams = structuredClone(benchmarkCase.params);
  improvedParams.greedy = { ...improvedParams.greedy, profile: true };
  const improvedSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    improvedParams
  );
  const baselineParams = structuredClone(benchmarkCase.params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    profile: true,
    serviceRefineIterations: 0,
    exhaustiveServiceSearch: false,
  };
  const baselineSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    baselineParams
  );
  const exhaustiveOnlyParams = structuredClone(benchmarkCase.params);
  exhaustiveOnlyParams.greedy = {
    ...exhaustiveOnlyParams.greedy,
    profile: true,
    serviceRefineIterations: 0,
  };
  const exhaustiveOnlySolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    exhaustiveOnlyParams
  );
  const counters = improvedSolution.greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["fixed-service-realization-complete"]);
  assert.equal(result.results[0].name, "fixed-service-realization-complete");
  assert.equal(result.results[0].totalPopulation, 300);
  assert.equal(result.results[0].serviceCount, 1);
  assert.equal(result.results[0].residentialCount, 3);
  assert.equal(improvedSolution.totalPopulation, 300);
  assert.equal(baselineSolution.totalPopulation, 240);
  assert.equal(exhaustiveOnlySolution.totalPopulation, 300);
  assert.equal(improvedSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.equal(exhaustiveOnlySolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.deepEqual(exhaustiveOnlySolution.services, [
    { r: 4, c: 2, rows: 1, cols: 2, range: 1 },
  ]);
  assert.deepEqual(exhaustiveOnlySolution.populations, [135, 105, 60]);
  assert.equal(exhaustiveOnlySolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(exhaustiveOnlySolution.greedyProfile.counters.attempts.exhaustiveTrials > 0, true);
  assert.equal(counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(counters.attempts.serviceRefineTrials > 0, true);
  assert.equal(counters.attempts.exhaustiveTrials > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /fixed-service-realization-complete/);
  assert.match(formatGreedyBenchmarkSuite(result), /fixed-set:/);
}

function testGreedyFixedServiceRealizationCompletenessImprovesMultiServiceRefineCase() {
  const grid = [
    [0, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [0, 0, 1, 0, 1, 1],
    [1, 1, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 48, range: 2, avail: 1 },
      { rows: 1, cols: 2, bonus: 67, range: 2, avail: 2 },
      { rows: 1, cols: 2, bonus: 47, range: 1, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 53, max: 157, avail: 5 },
      { w: 2, h: 3, min: 81, max: 171, avail: 2 },
    ],
    greedy: {
      localSearch: false,
      randomSeed: 498,
      restarts: 1,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 6,
      serviceExactMaxCombinations: 64,
      profile: true,
    },
  };

  const baselineParams = structuredClone(params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    serviceRefineIterations: 0,
  };
  const baselineSolution = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const improvedSolution = solveGreedy(
    grid.map((row) => [...row]),
    params
  );
  const baselineValidation = validateSolution({ grid, solution: baselineSolution, params: baselineParams });
  const improvedValidation = validateSolution({ grid, solution: improvedSolution, params });

  assert.equal(baselineValidation.valid, true);
  assert.equal(improvedValidation.valid, true);
  assert.equal(baselineSolution.totalPopulation, 291);
  assert.equal(improvedSolution.totalPopulation, 342);
  assert.equal(improvedSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.deepEqual(baselineSolution.serviceTypeIndices, [1, 1]);
  assert.deepEqual(improvedSolution.serviceTypeIndices, [1, 1]);
  assert.deepEqual(improvedSolution.services, [
    { r: 0, c: 4, rows: 1, cols: 2, range: 2 },
    { r: 1, c: 4, rows: 1, cols: 2, range: 2 },
  ]);
  assert.deepEqual(improvedSolution.populations, [171, 171]);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.serviceRefineTrials > 0, true);
}

function testGreedyServiceLocalNeighborhoodBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["service-local-neighborhood"],
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "service-local-neighborhood");
  const improvedParams = structuredClone(benchmarkCase.params);
  improvedParams.greedy = { ...improvedParams.greedy, profile: true };
  const improvedSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    improvedParams
  );
  const baselineParams = structuredClone(benchmarkCase.params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    profile: true,
    localSearch: true,
    localSearchServiceMoves: false,
  };
  const baselineSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    baselineParams
  );
  const counters = improvedSolution.greedyProfile.counters.localSearch;
  const serviceRoadOpportunityTraces = improvedSolution.greedyProfile.roadOpportunityTraces.filter(
    (trace) => trace.phase === "service-neighborhood"
  );
  const serviceAddTrace = serviceRoadOpportunityTraces.find((trace) => trace.moveKind === "service-add");

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["service-local-neighborhood"]);
  assert.equal(result.results[0].name, "service-local-neighborhood");
  assert.equal(result.results[0].totalPopulation, 295);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(result.results[0].residentialCount, 3);
  assert.equal(improvedSolution.totalPopulation, 295);
  assert.equal(baselineSolution.totalPopulation, 240);
  assert.equal(improvedSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials, 0);
  assert.equal(improvedSolution.greedyProfile.counters.localSearch.occupancyScratchReuses > 0, true);
  assert.equal(improvedSolution.greedyProfile.counters.roads.scratchProbeCalls > 0, true);
  assert.equal(counters.serviceRemoveChecks > 0, true);
  assert.equal(counters.serviceAddChecks > 0, true);
  assert.equal(counters.serviceSwapChecks > 0, true);
  assert.equal(counters.serviceNeighborhoodImprovements > 0, true);
  assert.equal(serviceRoadOpportunityTraces.length > 0, true);
  assert(serviceAddTrace);
  assert.equal((serviceAddTrace.counterfactuals?.length ?? 0) > 0, true);
  assert.equal(serviceAddTrace.lostCells, serviceAddTrace.reachableBefore - serviceAddTrace.reachableAfter);
  assert.equal(
    serviceAddTrace.counterfactuals.some((counterfactual) => counterfactual.moveKind !== undefined),
    true
  );
  assert.match(formatGreedyBenchmarkSuite(result), /service-local-neighborhood/);
  assert.match(formatGreedyBenchmarkSuite(result), /local-service=/);
  assert.match(formatGreedyBenchmarkSuite(result), /move:service-add/);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
}

function testGreedyResidualServiceBundleRepairAddsServiceAndRefillsResidentials() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 20, range: 1, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 80, max: 120, avail: 3 }],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: true,
      localSearchServiceMoves: true,
      randomSeed: 1,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 4,
      serviceExactMaxCombinations: 16,
      profile: true,
    },
  };
  const baselineParams = structuredClone(params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    localSearchServiceMoves: false,
  };

  const baseline = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const repaired = solveGreedy(
    grid.map((row) => [...row]),
    params
  );
  const validation = validateSolution({ grid, solution: repaired, params });
  const overlaps = (a, b) =>
    a.r < b.r + b.rows && a.r + a.rows > b.r && a.c < b.c + b.cols && a.c + a.cols > b.c;

  assert.equal(validation.valid, true);
  assert.equal(baseline.totalPopulation, 240);
  assert.equal(baseline.services.length, 0);
  assert.equal(repaired.totalPopulation, 280);
  assert.equal(repaired.totalPopulation > baseline.totalPopulation, true);
  assert.deepEqual(repaired.services, [
    { r: 1, c: 1, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(repaired.serviceTypeIndices, [0]);
  assert.deepEqual(repaired.populations, [100, 100, 80]);
  assert.equal(baseline.residentials.some((residential) => overlaps(repaired.services[0], residential)), true);
  assert.equal(repaired.greedyProfile.counters.localSearch.serviceAddChecks > 0, true);
  assert.equal(repaired.greedyProfile.counters.localSearch.serviceNeighborhoodImprovements > 0, true);
}

function testGreedyTypedFootprintPressureBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-footprint-pressure"],
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "typed-footprint-pressure");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone(benchmarkCase.params)
  );

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["typed-footprint-pressure"]);
  assert.equal(result.results[0].name, "typed-footprint-pressure");
  assert.equal(result.results[0].totalPopulation, 450);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(solution.totalPopulation, 450);
  assert.deepEqual(solution.serviceTypeIndices, [1, 0]);
  assert.deepEqual(solution.services, [
    { r: 2, c: 3, rows: 1, cols: 1, range: 2 },
    { r: 3, c: 3, rows: 1, cols: 1, range: 1 },
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [2, 2, 0, 1]);
  assert.deepEqual(solution.populations, [150, 150, 75, 75]);
  assert(result.results[0].greedyProfile);
  assert.equal(result.results[0].greedyProfile.counters.precompute.residentialScoringGroups > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.residentialScoringVariantsCollapsed > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.serviceCoverageGroups > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.servicePhase.groupedScoreLookups > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /typed-footprint-pressure/);
  assert.match(formatGreedyBenchmarkSuite(result), /grouped-score=/);
}

function testGreedyTypedAvailabilityPressureBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-availability-pressure"],
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "typed-availability-pressure");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone(benchmarkCase.params)
  );
  const counters = result.results[0].greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["typed-availability-pressure"]);
  assert.equal(result.results[0].name, "typed-availability-pressure");
  assert.equal(result.results[0].totalPopulation, 615);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(solution.totalPopulation, 615);
  assert.deepEqual(solution.serviceTypeIndices, [0, 0]);
  assert.equal(solution.services.length, 2);
  assert.deepEqual(solution.services, [
    { r: 3, c: 2, rows: 1, cols: 1, range: 2 },
    { r: 3, c: 3, rows: 1, cols: 1, range: 2 },
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [0, 1, 1, 1, 1]);
  assert.deepEqual(solution.populations, [175, 110, 110, 110, 110]);
  assert(result.results[0].greedyProfile);
  assert.equal(counters.servicePhase.availabilityDiscountedGroups > 0, true);
  assert.equal(
    counters.precompute.serviceStaticAvailabilityDiscountedGroups + counters.servicePhase.availabilityDiscountedGroups > 0,
    true
  );
  assert.match(formatGreedyBenchmarkSuite(result), /typed-availability-pressure/);
  assert.match(formatGreedyBenchmarkSuite(result), /discounted:/);
}

function testGreedyGroupedServiceScoringLeavesUntypedBenchmarkUndiscounted() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
  });
  const counters = result.results[0].greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["compact-service-single"]);
  assert.equal(counters.precompute.residentialScoringVariantsCollapsed, 0);
  assert.equal(counters.precompute.serviceStaticAvailabilityDiscountedGroups, 0);
  assert.equal(counters.servicePhase.availabilityDiscountedGroups, 0);
}

function testGreedyGroupedServiceScoringDiscountsLimitedFallbackTypes() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 65, range: 2, avail: 2 }],
    residentialTypes: [
      { w: 2, h: 2, min: 45, max: 180, avail: 1 },
      { w: 2, h: 2, min: 45, max: 90, avail: 1 },
    ],
    availableBuildings: { services: 2, residentials: 5 },
    greedy: {
      localSearch: true,
      randomSeed: 41,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64,
      profile: true,
    },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 265);
  assert.deepEqual(solution.serviceTypeIndices, [0, 0]);
  assert.deepEqual(solution.services, [
    { r: 2, c: 3, rows: 1, cols: 1, range: 2 },
    { r: 2, c: 2, rows: 1, cols: 1, range: 2 },
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [0, 1]);
  assert.deepEqual(solution.populations, [175, 90]);
  assert(solution.greedyProfile);
  assert.equal(solution.greedyProfile.counters.servicePhase.availabilityDiscountedGroups > 0, true);
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

function testLnsTelemetryRecordsRepairPolicyAndOutcomes() {
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const seenRepairBudgets = [];
  let attempts = 0;

  cpSatModule.solveCpSat = (_grid, params) => {
    attempts += 1;
    const improved = attempts === 2;
    seenRepairBudgets.push(params.cpSat.timeLimitSeconds);
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(["0,0", "1,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: improved ? [{ r: 1, c: 1, rows: 2, cols: 2 }] : [],
      residentialTypeIndices: improved ? [0] : [],
      populations: improved ? [10] : [],
      totalPopulation: improved ? 10 : 0,
    };
  };

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 4,
        focusedRepairTimeLimitSeconds: 2,
        escalatedRepairTimeLimitSeconds: 3,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
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

    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.totalPopulation, 10);
    assert.deepEqual(seenRepairBudgets, [2, 3]);
    assert.equal(solution.lnsTelemetry.seedSource, "hint");
    assert.equal(solution.lnsTelemetry.stopReason, "iteration-limit");
    assert.equal(solution.lnsTelemetry.seedTimeLimitSeconds, null);
    assert.equal(solution.lnsTelemetry.outcomes.length, 2);
    assert.equal(solution.lnsTelemetry.outcomes[0].phase, "focused");
    assert.equal(solution.lnsTelemetry.outcomes[0].status, "neutral");
    assert.equal(solution.lnsTelemetry.outcomes[1].phase, "escalated");
    assert.equal(solution.lnsTelemetry.outcomes[1].status, "improved");
    assert.equal(solution.lnsTelemetry.improvingIterations, 1);
    assert.equal(solution.lnsTelemetry.neutralIterations, 1);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsGreedySeedReportsBudgetAndProfile() {
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;

  cpSatModule.solveCpSat = (_grid, params) => ({
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    roads: new Set(params.cpSat.warmStartHint.solution.roads),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: params.cpSat.warmStartHint.solution.residentials.map((residential) => ({
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols,
    })),
    residentialTypeIndices: [...params.cpSat.warmStartHint.solution.residentials.map((residential) => residential.typeIndex)],
    populations: [...params.cpSat.warmStartHint.solution.populations],
    totalPopulation: params.cpSat.warmStartHint.solution.totalPopulation,
  });

  try {
    const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
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
        wallClockLimitSeconds: 10,
        repairTimeLimitSeconds: 2,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
      },
    });

    assert.equal(solution.lnsTelemetry.seedSource, "greedy");
    assert.equal(solution.lnsTelemetry.seedTimeLimitSeconds, 2);
    assert.equal(solution.lnsTelemetry.seedWallClockSeconds >= 0, true);
    assert(solution.greedyProfile);
    assert(solution.greedyProfile.phases.some((phase) => phase.name === "constructiveCapSearch" && phase.runs > 0));
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsStopsAfterNoImprovementTimeout() {
  const cpSatModule = require("../dist/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let attempts = 0;

  cpSatModule.solveCpSat = () => {
    attempts += 1;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5) {
      // Keep the synchronous fake repair running long enough for the stale timer.
    }
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
    const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      lns: {
        iterations: 10,
        maxNoImprovementIterations: 10,
        noImprovementTimeoutSeconds: 0.001,
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

    assert.equal(attempts, 1);
    assert.equal(solution.lnsTelemetry.stopReason, "stale-time-limit");
    assert.equal(solution.lnsTelemetry.outcomes[0].status, "neutral");
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsRejectsMalformedScalarOptions() {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
  assert.throws(
    () =>
      solveLns(grid, {
        optimizer: "lns",
        lns: {
          iterations: "many",
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
      }),
    /Invalid solver input: LNS option lns\.iterations must be an integer between 1 and 10000\./
  );
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

function testDeterministicDominanceServiceUpgradeHelper() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 118, range: 5, avail: 1 },
      { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 },
    ],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 600, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
  };
  const solution = applyDeterministicDominanceUpgrades(grid, params, {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 5 }],
    serviceTypeIndices: [0],
    servicePopulationIncreases: [118],
    residentials: [{ r: 3, c: 1, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [218],
    totalPopulation: 218,
  });

  assert.equal(solution.serviceTypeIndices[0], 1);
  assert.equal(solution.servicePopulationIncreases[0], 480);
  assert.equal(solution.totalPopulation, 580);
  assert.equal(solution.populations[0], 580);
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

function testDeterministicDominanceResidentialUpgradeHelper() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 400, avail: 1 },
      { w: 2, h: 2, min: 100, max: 700, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 1 },
  };
  const solution = applyDeterministicDominanceUpgrades(grid, params, {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 5 }],
    serviceTypeIndices: [0],
    servicePopulationIncreases: [480],
    residentials: [{ r: 3, c: 1, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [400],
    totalPopulation: 400,
  });

  assert.equal(solution.residentialTypeIndices[0], 1);
  assert.equal(solution.totalPopulation, 580);
  assert.equal(solution.populations[0], 580);
}

function testSolutionValidator() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
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
    optimizer: "greedy",
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

function testSolutionValidatorAllowsMultipleRow0AnchoredRoadComponents() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    availableBuildings: { residentials: 0, services: 0 },
  };
  const solution = {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0,
  };

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testSolutionValidatorRejectsRoadComponentsWithoutRow0Anchor() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    availableBuildings: { residentials: 0, services: 0 },
  };
  const solution = {
    optimizer: "greedy",
    roads: new Set(["0,0", "1,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0,
  };

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /not connected to any row-0-connected road component/);
  assert.match(validation.errors.join("\n"), /Disconnected road cells: \(1,3\)\./);
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
  assert(withProfile.greedyProfile.phases.some((phase) => phase.name === "precompute" && phase.elapsedMs >= 0));
  assert(
    withProfile.greedyProfile.phases.some(
      (phase) => phase.name === "residentialLocalSearch" && phase.candidatePopulationDelta >= 0
    )
  );
}

function testGreedyDensityTieBreakerPrefersCentralNearTies() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [],
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: 0,
    },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 2, c: 2, rows: 1, cols: 1 }]);
  assert.equal(solution.validation?.valid, undefined);
}

function testGreedyDensityTieBreakerIsOptIn() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [],
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };

  const withoutDensity = solveGreedy(grid, params);
  const withDensity = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: 2.5,
    },
  });

  assert.deepEqual(withoutDensity.residentials, [{ r: 0, c: 0, rows: 1, cols: 1 }]);
  assert.deepEqual(withDensity.residentials, [{ r: 2, c: 2, rows: 1, cols: 1 }]);
  assert.equal(withDensity.totalPopulation, withoutDensity.totalPopulation);
}

function testGreedyDiagnosticsAreOptInDeterministicAndAdditive() {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 20, range: 1, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 20 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };

  const withoutDiagnostics = solveGreedy(grid, params);
  const withDiagnostics = solveGreedy(grid, {
    ...params,
    greedy: { ...params.greedy, diagnostics: true },
  });
  const repeated = solveGreedy(grid, {
    ...params,
    greedy: { ...params.greedy, diagnostics: true },
  });

  assert.equal(withoutDiagnostics.greedyDiagnostics, undefined);
  assert(withDiagnostics.greedyDiagnostics);
  assert.deepEqual(withDiagnostics.greedyDiagnostics, repeated.greedyDiagnostics);
  assert.equal(withDiagnostics.totalPopulation, withoutDiagnostics.totalPopulation);
  assert.deepEqual(withDiagnostics.services, withoutDiagnostics.services);
  assert.deepEqual(withDiagnostics.serviceTypeIndices, withoutDiagnostics.serviceTypeIndices);
  assert.deepEqual(withDiagnostics.residentials, withoutDiagnostics.residentials);
  assert.deepEqual(withDiagnostics.residentialTypeIndices, withoutDiagnostics.residentialTypeIndices);
  assert.deepEqual(withDiagnostics.populations, withoutDiagnostics.populations);
  assert.equal(withDiagnostics.greedyDiagnostics.candidateLimit, 2000);
  assert.equal(withDiagnostics.greedyDiagnostics.examplesPerReason, 3);

  const serviceReasons = withDiagnostics.greedyDiagnostics.services.reasonCounts;
  const residentialReasons = withDiagnostics.greedyDiagnostics.residentials.reasonCounts;
  assert.equal(serviceReasons["availability-cap"] > 0, true);
  assert.equal(serviceReasons["blocked-footprint"] > 0, true);
  assert.equal(serviceReasons["no-road-path"] > 0, true);
  assert.equal(serviceReasons["lower-score-no-improvement"] > 0, true);
  assert.equal(residentialReasons["availability-cap"] > 0, true);
  assert.equal(residentialReasons["blocked-footprint"] > 0, true);
  assert.equal(residentialReasons["no-road-path"] > 0, true);
  assert.equal(residentialReasons["base-only"] > 0, true);
  assert.equal(
    withDiagnostics.greedyDiagnostics.services.examplesByReason["lower-score-no-improvement"].length <= 3,
    true
  );
  assert.equal(withDiagnostics.greedyDiagnostics.services.overallAvailability.remaining, 0);
  assert.equal(withDiagnostics.greedyDiagnostics.residentials.overallAvailability.remaining, 0);
}

function testGreedyDiagnosticsReportsNoServiceCoverage() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 50, range: 0, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 2 }],
    availableBuildings: { services: 2, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      diagnostics: true,
    },
  };

  const solution = solveGreedy(grid, params);
  const diagnostics = solution.greedyDiagnostics;

  assert(diagnostics);
  assert.equal(solution.services.length, 0);
  assert.equal(diagnostics.services.reasonCounts["no-service-coverage"] > 0, true);
  assert.equal(diagnostics.services.examplesByReason["no-service-coverage"][0].score, 0);
  assert.equal(diagnostics.services.overallAvailability.remaining, 2);
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
  testOptimizerRegistry();
  testGeometryHelperVisitorParity();
  testBuildingGeometryHelpersParity();
  testRoadProbePreservesEdgeBorderConnectivity();
  testRoadProbeScratchWorkspaceResetsBetweenCalls();
  testBuildingConnectivityShadowMeasuresDisconnectedReachableCells();
  testGreedyAttemptStateRejectsMismatchedProbeKind();
  testRoadPruningDropsConnectorsOnlyNeededByRowZeroBuildings();
  testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval();
  testGreedyDispatcher();
  await testPublicSolverDispatchValidatesInputs();
  testGreedyRandomSeedIsDeterministic();
  testGreedyConnectivityShadowScoringIsOptInTieBreaker();
  testGreedyConnectivityShadowOrderingLabelRunner();
  testLearnedRankingLabelSuite();
  testGreedyRoadOpportunityCounterfactualsAreBoundedAndObservational();
  testRoadOpportunityLocalSearchMeasurementUsesPostRemoveOccupancy();
  testGreedyStopFileCancelsBeforePrecompute();
  testGreedyWallClockBudgetStopsWithBestSolution();
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
  await testBackgroundSolveCancellationKillsProcessGroupChildren();
  maybeTestCpSatPopulationUpperBoundHelpers();
  maybeTestCpSatResidentialPopulationUpperBoundHelpers();
  await maybeTestCpSatOptimizer();
  maybeTestCpSatSyncCompatibility();
  await maybeTestCpSatAsyncOptimizer();
  await maybeTestAutoOptimizer();
  testAutoKeepsEqualPopulationOptimalCpSatResult();
  testAutoPreservesUserWarmStartMetadata();
  testAutoDirectRuntimeIgnoresMalformedOptionValues();
  await testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns();
  await testAutoAsyncStageErrorKeepsIncumbentWithExplicitStopReason();
  await testAutoAsyncRecoveredStageSnapshotKeepsNonRecoveryTerminalMetadata();
  await testAutoAsyncRecoveredCpSatSnapshotKeepsCompletedMetadata();
  testAutoSyncWallClockCapStopsRunningLnsStage();
  testAutoSyncWallClockCapKeepsExplicitStopReasonWhenLnsThrows();
  testAutoSyncReservesCpSatBudgetBeforeLnsStage();
  testAutoSyncGreedyCanRunPastFormerStageBudget();
  await testAutoAsyncGreedyCanRunPastFormerStageBudget();
  testAutoClampsHeavyGreedyStageSettings();
  await testAutoAsyncClampsHeavyGreedyStageSettings();
  testGreedyProfilingIsAdditive();
  testGreedyDensityTieBreakerPrefersCentralNearTies();
  testGreedyDensityTieBreakerIsOptIn();
  testGreedyDiagnosticsAreOptInDeterministicAndAdditive();
  testGreedyDiagnosticsReportsNoServiceCoverage();
  testGreedyBenchmarkCorpusHelpers();
  testGreedyConnectivityShadowScoringAblationRunner();
  testGreedyDeterministicAblationRunner();
  testDeterministicAblationGateReport();
  testGreedyBenchmarkCliConnectivityShadowFlags();
  testGreedyBenchmarkCliDeterministicAblationFlags();
  testLnsBenchmarkCliNeighborhoodAblationSeedListParsing();
  testGreedyStep14ServiceLookaheadBenchmarkCaseIsolated();
  testGreedyStep14FollowUpBenchmarkCasesStayIsolated();
  testGreedyServiceLookaheadIsOffByDefaultAndLeavesCorpusUnchangedWhenOff();
  testGreedyStep14ServiceLookaheadBenchmarkCaseImprovesWhenEnabled();
  testGreedyStep14DeterministicLookaheadTieBenchmarkCase();
  testGreedyStep14Row0PathNullReservationBenchmarkCase();
  testGreedyStep14ScarceTypeSequentialRefillBenchmarkCase();
  testGreedyStep14LookaheadCapsRefillDepthWhenMaxResidentialsIsOne();
  testGreedyBenchmarkSuite();
  testGreedyDeterministicTieBreakBenchmarkCase();
  testGreedyConnectivityHeavyBenchmarkCase();
  testGridRectangleBorderCellsPreserveExpectedRing();
  testBuildingGeometryCachesParity();
  testGreedyGeometryOccupancyHotPathBenchmarkCase();
  testRoadProbeScratchRepeatability();
  testGreedyExplicitServiceCapIsMaximum();
  testGreedyExplicitCapSweepsAllAllowedLowerCaps();
  testGreedySmallUpperKeepsFullCapSweep();
  testGreedyAdaptiveCapSearchWideBenchmarkCase();
  testGreedyAdaptiveCapSearchMatchesBestExplicitCap();
  testGreedyIncrementalInvalidationPreservesBenchmarkOutputs();
  testGreedyIncrementalInvalidationCounters();
  testGreedyDeferredRoadCommitmentBenchmarkCase();
  testGreedyDeferredRoadCommitmentKeepsTopRowShortcut();
  testGreedyDeferredRoadMaterializationFailsDeterministically();
  testGreedyFixedServiceRealizationCompletenessBenchmarkCase();
  testGreedyFixedServiceRealizationCompletenessImprovesMultiServiceRefineCase();
  testGreedyServiceLocalNeighborhoodBenchmarkCase();
  testGreedyResidualServiceBundleRepairAddsServiceAndRefillsResidentials();
  testGreedyTypedFootprintPressureBenchmarkCase();
  testGreedyTypedAvailabilityPressureBenchmarkCase();
  testGreedyGroupedServiceScoringLeavesUntypedBenchmarkUndiscounted();
  testGreedyGroupedServiceScoringDiscountsLimitedFallbackTypes();
  await testCpSatBenchmarkCorpusHelpers();
  testLnsBenchmarkCorpusHelpers();
  testLnsNeighborhoodAblationRunner();
  testLnsNeighborhoodAblationWindowSequenceMovement();
  testLnsSeededServiceAnchorPressureBenchmarkCase();
  testLnsWindowReplayLabelRunner();
  await testCrossModeBenchmarkHelpers();
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
  testSolutionValidatorAllowsMultipleRow0AnchoredRoadComponents();
  testSolutionValidatorRejectsRoadComponentsWithoutRow0Anchor();
  testTopRowBuildingCountsAsRoadConnected();
  testGreedyRespectsTopRowConnectivityShortcut();
  testGreedySupportsShapedServices();
  testGreedyResidentialPopulationCacheRespectsTypedVariants();
  testLnsNeighborhoodWindowsEscalateWhenStagnating();
  testLnsRunsFinalEscalationWithinConfiguredBudget();
  testLnsTelemetryRecordsRepairPolicyAndOutcomes();
  testLnsGreedySeedReportsBudgetAndProfile();
  testLnsStopsAfterNoImprovementTimeout();
  testLnsRejectsMalformedScalarOptions();
  maybeTestLnsOptimizer();
  testLnsRejectsInvalidSeedHint();
  testLnsRejectsMalformedSeedHintFields();
  maybeTestLnsExploresMultipleRowZeroSeeds();
  maybeTestLnsCanRepairRowZeroAnchorLayouts();
  testDeterministicDominanceServiceUpgradeHelper();
  testLnsDeterministicServiceUpgrade();
  testDeterministicDominanceResidentialUpgradeHelper();
  testLnsDeterministicResidentialUpgrade();

  console.log("Optimizer backend tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
