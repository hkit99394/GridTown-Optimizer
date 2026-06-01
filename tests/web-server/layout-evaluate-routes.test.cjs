const assert = require("node:assert/strict");

const { solve } = require("city-builder/solver");
const {
  assertPlannerExplainabilityPayload,
  buildTinySolvePayload,
  createRouteTestHandler,
  invoke
} = require("./routeTestServer.cjs");

/**
 * @typedef {ReturnType<typeof createRouteTestHandler>["handler"]} RouteTestHandler
 */

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testLayoutEvaluateRejectsMalformedSerializedSolutions(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: ["1,"]
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

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testLayoutEvaluateReportsHugeOutOfGridManualPlacement(handler) {
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
        roads: ["0,2"],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 0, c: 0, rows: 1000000, cols: 1000000 }],
        residentialTypeIndices: [0],
        populations: [0],
        totalPopulation: 0
      }
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, false);
  assert.match(
    result.payload.validation.errors.join("\n"),
    /Residential at \(0,0\) size 1000000x1000000 extends beyond the grid/
  );
  assert.doesNotMatch(result.payload.validation.errors.join("\n"), /Map maximum size exceeded/);
  assertPlannerExplainabilityPayload(result.payload, [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ]);
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testLayoutEvaluateUsesAssignedTypesForLargeCatalogValidation(handler) {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 7 }, () => 1));
  const residentialTypes = [2, 2, 2, 3, 2, 5, 3, 2, 1, 2, 2, 1, 1, 2, 2, 1, 1, 1].map((avail, index) => ({
    name: `Tower ${index + 1}`,
    w: 1,
    h: 1,
    min: index + 1,
    max: index + 1,
    avail
  }));
  const residentialTypeIndices = residentialTypes.flatMap((type, typeIndex) =>
    Array.from({ length: type.avail }, () => typeIndex)
  );
  const residentials = residentialTypeIndices.map((_, index) => ({
    r: Math.floor(index / 7),
    c: index % 7,
    rows: 1,
    cols: 1
  }));

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      grid,
      params: {
        optimizer: "greedy",
        residentialTypes,
        availableBuildings: { residentials: residentials.length, services: 0 }
      },
      solution: {
        roads: [],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials,
        residentialTypeIndices,
        populations: residentialTypeIndices.map(() => 0),
        totalPopulation: 0
      }
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, false);
  assert.match(result.payload.validation.errors.join("\n"), /Road network does not touch row 0 or column 0/);
  assert.doesNotMatch(result.payload.validation.errors.join("\n"), /Map maximum size exceeded/);
  assert.equal(result.payload.validation.recomputedPopulations.length, residentials.length);
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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
  await testLayoutEvaluateReportsHugeOutOfGridManualPlacement(handler);
  await testLayoutEvaluateUsesAssignedTypesForLargeCatalogValidation(handler);
  await testLayoutEvaluateRejectsInvalidProblemDefinition(handler);

  console.log("Web server layout evaluation route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
