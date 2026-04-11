const assert = require("node:assert/strict");

const { solve } = require("../dist/solver.js");
const { evaluateLayout } = require("../dist/evaluator.js");

function testDistinctResidentialTypes() {
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
  const evaluation = evaluateLayout({
    grid,
    roads: solution.roads,
    services: [],
    residentials: solution.residentials,
    params,
  });

  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual(solution.populations, [100, 10]);
  assert.deepEqual(solution.residentialTypeIndices, [1, 0]);
  assert.equal(evaluation.totalPopulation, 110);
  assert.equal(evaluation.valid, true);
}

function testNoRowZeroRoadThrows() {
  const grid = [
    [0, 0, 0],
    [1, 1, 1],
    [1, 1, 1],
  ];

  assert.throws(() => solve(grid, { basePop: 10, maxPop: 10, greedy: { localSearch: false } }), /No feasible solution found/);
}

function testEvaluatorHonorsCountCaps() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const roads = new Set(["0,0", "1,0", "2,0", "3,0"]);
  const residentials = [
    { r: 0, c: 1, rows: 2, cols: 2 },
    { r: 2, c: 1, rows: 2, cols: 2 },
  ];

  const evaluation = evaluateLayout({
    grid,
    roads,
    services: [],
    residentials,
    params: {
      basePop: 10,
      maxPop: 10,
      availableBuildings: { residentials: 1 },
    },
  });

  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join("\n"), /exceeding the limit of 1/);
}

function testResidentialCapStillAppliesWithTypedResidentials() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 2 },
      { w: 2, h: 2, min: 20, max: 20, avail: 2 },
    ],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false },
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
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ name: "Health Clinic", rows: 2, cols: 2, bonus: 40, range: 1, avail: 1 }],
    residentialTypes: [{ name: "The Aurora", w: 2, h: 2, min: 100, max: 140, avail: 1 }],
    availableBuildings: { residentials: 1, services: 1 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  assert.equal(solution.services.length, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.totalPopulation >= 100, true);
}

function testIndexImportHasNoSideEffects() {
  const originalLog = console.log;
  const calls = [];
  console.log = (...args) => {
    calls.push(args.join(" "));
  };

  try {
    const indexPath = require.resolve("../dist/index.js");
    delete require.cache[indexPath];
    const api = require(indexPath);
    assert.equal(typeof api.solve, "function");
    assert.equal(typeof api.evaluateLayout, "function");
    assert.deepEqual(calls, []);
    delete require.cache[indexPath];
  } finally {
    console.log = originalLog;
  }
}

testDistinctResidentialTypes();
testNoRowZeroRoadThrows();
testEvaluatorHonorsCountCaps();
testResidentialCapStillAppliesWithTypedResidentials();
testNamedBuildingTypesAreAccepted();
testIndexImportHasNoSideEffects();

console.log("All review finding regression tests passed.");
