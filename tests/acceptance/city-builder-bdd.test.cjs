const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { Readable } = require("node:stream");

const { evaluateLayout, solve, validateSolution } = require("city-builder/solver");
const optimizerRegistry = require("../../dist/packages/runtime/dispatch/optimizerRegistry.js");
const { createPlannerRequestHandler } = require("../../dist/apps/planner-server/http/requestHandler.js");

const scenarios = [];

function allowedGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
}

function scenario(name, run) {
  scenarios.push({ name, run });
}

async function runScenario(name, run) {
  try {
    await run();
  } catch (error) {
    if (error && typeof error === "object" && "message" in error) {
      error.message = `${name}\n${error.message}`;
    }
    throw error;
  }
}

function assertValid(result) {
  assert.equal(result.valid, true, result.errors.join("\n"));
}

function assertInvalid(result, pattern) {
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), pattern);
}

function assertInvalidMatches(result, patterns) {
  assert.equal(result.valid, false);
  const errors = result.errors.join("\n");
  for (const pattern of patterns) {
    assert.match(errors, pattern);
  }
}

function createMockRequest(method, url, body = "", headers = undefined) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = headers ?? (body ? { "content-type": "application/json" } : {});
  return stream;
}

function createMockResponse() {
  const response = new EventEmitter();
  response.statusCode = 0;
  response.headers = {};
  response.body = "";
  response.writableEnded = false;
  response.writeHead = function writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers ?? {};
  };
  response.end = function end(chunk) {
    this.writableEnded = true;
    if (chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    }
  };
  return response;
}

async function invoke(handler, { method = "GET", url = "/", json = undefined, body = undefined, headers = undefined }) {
  const payloadBody = json === undefined ? (body ?? "") : JSON.stringify(json);
  const req = createMockRequest(method, url, payloadBody, headers);
  const res = createMockResponse();
  await handler(req, res);
  let payload = null;
  if ((res.headers["Content-Type"] || res.headers["content-type"] || "").includes("application/json")) {
    payload = JSON.parse(res.body || "{}");
  }
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
    payload,
  };
}

function createAcceptanceRequestHandler() {
  return createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../../apps/planner-web"),
  });
}

function buildTinySolvePayload() {
  return {
    grid: allowedGrid(4, 4),
    params: {
      optimizer: "greedy",
      residentialTypes: [{ name: "Test Residence", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false },
    },
  };
}

function backgroundHandleForSolution(solution) {
  return {
    promise: Promise.resolve(solution),
    cancel() {},
    getLatestSnapshot() {
      return solution;
    },
    getLatestSnapshotState() {
      return {
        hasFeasibleSolution: true,
        totalPopulation: solution.totalPopulation,
        activeOptimizer: solution.activeOptimizer,
        autoStage: solution.autoStage,
        cpSatStatus: solution.cpSatStatus ?? null,
      };
    },
  };
}

function withAutoMetadata(solution) {
  return {
    ...solution,
    optimizer: "auto",
    activeOptimizer: "greedy",
    autoStage: {
      requestedOptimizer: "auto",
      activeStage: "greedy",
      stageIndex: 1,
      cycleIndex: 0,
      consecutiveWeakCycles: 0,
      lastCycleImprovementRatio: null,
      stopReason: "completed-plan",
      generatedSeeds: [
        { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
      ],
    },
  };
}

scenario(
  "[CB-BDD-001] Given a service reaches a residential, when the layout is evaluated, then the residential is boosted and capped",
  () => {
    const grid = allowedGrid(4, 6);
    const params = {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 150, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
    };
    const roads = new Set(["0,1", "0,4"]);
    const services = [{ r: 1, c: 1, rows: 2, cols: 2, range: 2, bonus: 80 }];
    const residentials = [{ r: 1, c: 4, rows: 2, cols: 2 }];

    const evaluated = evaluateLayout({ grid, roads, services, residentials, params });

    assertValid(evaluated);
    assert.deepEqual(evaluated.boosts, [80]);
    assert.deepEqual(
      evaluated.populations.map((residential) => residential.population),
      [150]
    );
    assert.equal(evaluated.totalPopulation, 150);

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads,
        services: services.map(({ bonus, ...service }) => service),
        serviceTypeIndices: [0],
        servicePopulationIncreases: [80],
        residentials,
        residentialTypeIndices: [0],
        populations: [150],
        totalPopulation: 150,
      },
    });

    assertValid(validation);
  }
);

scenario(
  "[CB-BDD-002] Given a road component is away from the anchor boundary, when the solution is validated, then the solution is rejected",
  () => {
    const grid = allowedGrid(4, 4);
    const params = {
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
    };

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["2,2"]),
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 2, c: 3, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [10],
        totalPopulation: 10,
      },
    });

    assertInvalid(validation, /row 0 or column 0/);
  }
);

scenario(
  "[CB-BDD-003] Given two buildings claim the same cell, when the solution is validated, then the solution is rejected",
  () => {
    const grid = allowedGrid(4, 4);
    const params = {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 10, range: 1, avail: 1 }],
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 20, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
    };

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["0,1", "0,3", "1,3", "2,3"]),
        services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [10],
        residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [20],
        totalPopulation: 20,
      },
    });

    assertInvalid(validation, /overlap|already occupied/i);
  }
);

scenario(
  "[CB-BDD-004] Given roads and buildings use blocked cells, when the solution is validated, then both are rejected",
  () => {
    const grid = [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ];
    const params = {
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
    };

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["0,0", "0,2", "1,2"]),
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [10],
        totalPopulation: 10,
      },
    });

    assertInvalidMatches(validation, [
      /Road cell \(0,0\) is not allowed/,
      /Residential at \(2,2\) uses non-allowed cell \(2,2\)/,
    ]);
  }
);

scenario(
  "[CB-BDD-005] Given building road connectivity is validated, when only anchor-boundary buildings bypass adjacency, then interior disconnected buildings are rejected",
  () => {
    const grid = allowedGrid(3, 4);
    const params = {
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
    };

    const interiorDisconnected = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["0,0"]),
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [10],
        totalPopulation: 10,
      },
    });

    assertInvalid(interiorDisconnected, /not adjacent to a road/);

    const boundaryConnected = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["2,0"]),
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 0, c: 3, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [10],
        totalPopulation: 10,
      },
    });

    assertValid(boundaryConnected);
  }
);

scenario(
  "[CB-BDD-006] Given an interactive solve omits optimizer, when the request runs, then auto is selected",
  async () => {
    const solvePayload = buildTinySolvePayload();
    const { optimizer, ...paramsWithoutOptimizer } = solvePayload.params;
    assert.equal(optimizer, "greedy");
    const autoSolution = withAutoMetadata(solve(solvePayload.grid, solvePayload.params));
    const handler = createAcceptanceRequestHandler();
    const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
    let resolvedOptimizer = null;
    let adapterRequest = null;

    optimizerRegistry.getOptimizerAdapter = (params) => {
      adapterRequest = params;
      resolvedOptimizer = originalGetOptimizerAdapter(params).name;
      return {
        name: resolvedOptimizer,
        solve() {
          throw new Error("Acceptance route scenarios should use the background adapter.");
        },
        startBackgroundSolve() {
          return backgroundHandleForSolution(autoSolution);
        },
      };
    };

    try {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          grid: solvePayload.grid,
          params: paramsWithoutOptimizer,
        },
      });

      assert.equal(result.statusCode, 200);
      assert.equal(result.payload.ok, true);
      assert.equal(adapterRequest.optimizer, undefined);
      assert.equal(resolvedOptimizer, "auto");
      assert.equal(result.payload.stats.optimizer, "auto");
      assert.equal(result.payload.stats.activeOptimizer, "greedy");
    } finally {
      optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
    }
  }
);

scenario(
  "[CB-BDD-007] Given the solve API returns a layout, when the response is built, then validation and stats match the solved layout",
  async () => {
    const solvePayload = buildTinySolvePayload();
    const solved = solve(solvePayload.grid, solvePayload.params);
    const handler = createAcceptanceRequestHandler();
    const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;

    optimizerRegistry.getOptimizerAdapter = () => ({
      name: "greedy",
      solve() {
        throw new Error("Acceptance route scenarios should use the background adapter.");
      },
      startBackgroundSolve() {
        return backgroundHandleForSolution(solved);
      },
    });

    try {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: solvePayload,
      });

      assert.equal(result.statusCode, 200);
      assert.equal(result.payload.ok, true);
      assert.equal(result.payload.validation.valid, true);
      assert.equal(result.payload.validation.recomputedTotalPopulation, solved.totalPopulation);
      assert.equal(result.payload.stats.totalPopulation, solved.totalPopulation);
      assert.equal(result.payload.stats.roadCount, solved.roads.size);
      assert.equal(result.payload.stats.residentialCount, solved.residentials.length);
      assert.equal(result.payload.solution.totalPopulation, solved.totalPopulation);
      assert.equal(result.payload.solution.roads.length, solved.roads.size);
    } finally {
      optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
    }
  }
);

async function main() {
  for (const { name, run } of scenarios) {
    await runScenario(name, run);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
