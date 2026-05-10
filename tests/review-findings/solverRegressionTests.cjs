const {
  assert,
  CP_SAT_PORTFOLIO_CAPABILITY_LIMITS,
  solve,
  evaluateLayout,
  loadPlannerSharedModule
} = require("./helpers.cjs");

function testDistinctResidentialTypes() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: { localSearch: false }
  };

  const solution = solve(grid, params);
  const evaluation = evaluateLayout({
    grid,
    roads: solution.roads,
    services: [],
    residentials: solution.residentials,
    params
  });

  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual(solution.populations, [100, 10]);
  assert.deepEqual(solution.residentialTypeIndices, [1, 0]);
  assert.equal(evaluation.totalPopulation, 110);
  assert.equal(evaluation.valid, true);
}

function testNoRoadAnchorBoundaryThrows() {
  const grid = [
    [0, 0, 0],
    [0, 1, 1],
    [0, 1, 1]
  ];

  assert.throws(
    () => solve(grid, { optimizer: "greedy", basePop: 10, maxPop: 10, greedy: { localSearch: false } }),
    /No feasible solution found/
  );
}

function testEvaluatorHonorsCountCaps() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const roads = new Set(["0,0", "1,0", "2,0", "3,0"]);
  const residentials = [
    { r: 0, c: 1, rows: 2, cols: 2 },
    { r: 2, c: 1, rows: 2, cols: 2 }
  ];

  const evaluation = evaluateLayout({
    grid,
    roads,
    services: [],
    residentials,
    params: {
      basePop: 10,
      maxPop: 10,
      availableBuildings: { residentials: 1 }
    }
  });

  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join("\n"), /exceeding the limit of 1/);
}

function testResidentialCapStillAppliesWithTypedResidentials() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 2 },
      { w: 2, h: 2, min: 20, max: 20, avail: 2 }
    ],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false }
  };

  const solution = solve(grid, params);

  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.totalPopulation, 20);
}

function testNamedBuildingTypesAreAccepted() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ name: "Health Clinic", rows: 2, cols: 2, bonus: 40, range: 1, avail: 1 }],
    residentialTypes: [{ name: "The Aurora", w: 2, h: 2, min: 100, max: 140, avail: 1 }],
    availableBuildings: { residentials: 1, services: 1 },
    greedy: { localSearch: false }
  };

  const solution = solve(grid, params);
  assert.equal(solution.services.length, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.totalPopulation >= 100, true);
}

function testGreedySkipsServicesWithZeroMarginalGain() {
  const { solveGreedy } = require("city-builder/solver");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 2 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.services.length, 0);
  assert.equal(solution.residentials.length, 2);
  assert.equal(solution.totalPopulation, 200);
}

function testGreedyLocalSearchDoesNotRegressNontrivialSeed() {
  const { solveGreedy } = require("city-builder/solver");
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 80, range: 1, avail: 1 },
      { rows: 2, cols: 3, bonus: 60, range: 1, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 70, max: 130, avail: 2 },
      { w: 2, h: 3, min: 90, max: 210, avail: 2 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };

  const baseline = solveGreedy(grid, params);
  const improved = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      localSearch: true
    }
  });

  assert.equal(improved.totalPopulation >= baseline.totalPopulation, true);
}

function testIndexImportHasNoSideEffects() {
  const originalLog = console.log;
  const calls = [];
  console.log = (...args) => {
    calls.push(args.join(" "));
  };

  try {
    const indexPath = require.resolve("../../dist/index.js");
    delete require.cache[indexPath];
    const api = require(indexPath);
    assert.equal(typeof api.solve, "function");
    assert.equal(typeof api.evaluateLayout, "function");
    assert.equal(typeof api.validateLayoutConstraints, "function");
    assert.equal(typeof api.assertValidLayoutConstraints, "function");
    assert.deepEqual(calls, []);
    delete require.cache[indexPath];
  } finally {
    console.log = originalLog;
  }
}

function testCpSatPortfolioCapabilitiesAreExported() {
  const plannerShared = loadPlannerSharedModule();
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.defaultWorkers, 3);
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.defaultPerWorkerTimeLimitSeconds, 30);
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxWorkers, 8);
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalWorkerThreads, 8);
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxPerWorkerThreads, 4);
  assert.equal(CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalCpuBudgetSeconds, 28800);
  assert.deepEqual(JSON.parse(JSON.stringify(plannerShared.CP_SAT_PORTFOLIO_CAPABILITY_LIMITS)), {
    ...CP_SAT_PORTFOLIO_CAPABILITY_LIMITS
  });
}

async function runSolverRegressionTests() {
  testDistinctResidentialTypes();
  testNoRoadAnchorBoundaryThrows();
  testEvaluatorHonorsCountCaps();
  testResidentialCapStillAppliesWithTypedResidentials();
  testNamedBuildingTypesAreAccepted();
  testGreedySkipsServicesWithZeroMarginalGain();
  testGreedyLocalSearchDoesNotRegressNontrivialSeed();
  testIndexImportHasNoSideEffects();
  testCpSatPortfolioCapabilitiesAreExported();
}

module.exports = {
  runSolverRegressionTests
};
