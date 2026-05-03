const assert = require("node:assert/strict");

const { solve } = require("city-builder/solver");
const {
  assertPlannerExplainabilityPayload,
  buildTinySolvePayload,
  createRouteTestHandler,
  invoke
} = require("./routeTestServer.cjs");

async function testLayoutEvaluateRoute(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: Array.from(solved.roads)
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, true);
  assert.equal(result.payload.stats.totalPopulation, 100);
  assert.equal(result.payload.solution.manualLayout, true);
  assert.equal(result.payload.stats.manualLayout, true);
  assert.equal(result.payload.stats.cpSatStatus, null);
  assertPlannerExplainabilityPayload(result.payload, solvePayload.grid);
}

async function testLayoutEvaluateCleansRedundantRoads(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      grid: [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1]
      ],
      params: {
        optimizer: "greedy",
        residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
        availableBuildings: { residentials: 1, services: 0 }
      },
      solution: {
        roads: ["0,1", "1,1", "2,1", "2,0"],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [0],
        totalPopulation: 0
      }
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, true);
  assert.deepEqual([...result.payload.solution.roads].sort(), ["2,0", "2,1"]);
  assert.equal(result.payload.stats.roadCount, 2);
  assert.equal(result.payload.stats.totalPopulation, 10);
}

async function testLayoutEvaluateRejectsMalformedSerializedSolutions(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: [{}]
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution
    }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(
    result.payload.error,
    'Invalid solver input: Manual layout solution.roads[0] must be a road key like "r,c".'
  );
}

async function testLayoutEvaluateReportsWellFormedInvalidManualLayout(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: []
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, false);
  assert.match(result.payload.validation.errors.join("\n"), /Road network does not touch row 0 or column 0/);
  assert.equal(result.payload.solution.manualLayout, true);
}

async function testLayoutEvaluateRejectsInvalidProblemDefinition(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: Array.from(solved.roads)
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        residentialTypes: [{ ...solvePayload.params.residentialTypes[0], avail: "1" }]
      },
      solution: serializedSolution
    }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(
    result.payload.error,
    "Invalid solver input: Problem definition residentialTypes[0].avail must be an integer >= 0."
  );
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testLayoutEvaluateRoute(handler);
  await testLayoutEvaluateCleansRedundantRoads(handler);
  await testLayoutEvaluateRejectsMalformedSerializedSolutions(handler);
  await testLayoutEvaluateReportsWellFormedInvalidManualLayout(handler);
  await testLayoutEvaluateRejectsInvalidProblemDefinition(handler);

  console.log("Web server layout evaluation route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
