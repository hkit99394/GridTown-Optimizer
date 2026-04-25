const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const optimizerRegistry = require("../dist/runtime/dispatch/optimizerRegistry.js");
const { SolveJobManager } = require("../dist/runtime/jobs/solveJobManager.js");
const { SolverInputError } = require("../dist/core/solverInputValidation.js");
const { createPlannerRequestHandler } = require("../dist/server/http/requestHandler.js");
const { solve } = require("../dist/index.js");

function createMockRequest(method, url, body = "") {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = body ? { "content-type": "application/json" } : {};
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

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function waitForNextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function testImmediateSolveCancelsOnDisconnect(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let cancelCalled = false;
  const handlePromiseDeferred = createDeferred();
  let fallbackResolveTimer = null;
  const startBackgroundSolveDeferred = createDeferred();

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      throw new Error("Immediate solves should use the non-blocking background adapter.");
    },
    startBackgroundSolve() {
      startBackgroundSolveDeferred.resolve();
      return {
        promise: handlePromiseDeferred.promise,
        cancel() {
          cancelCalled = true;
          handlePromiseDeferred.resolve(backgroundSolution);
        },
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
    },
  });

  try {
    const req = createMockRequest("POST", "/api/solve", JSON.stringify(solvePayload));
    const res = createMockResponse();
    const pending = handler(req, res);
    await startBackgroundSolveDeferred.promise;
    await waitForNextTurn();
    fallbackResolveTimer = setTimeout(() => {
      handlePromiseDeferred.resolve(backgroundSolution);
    }, 50);
    res.emit("close");
    await pending;
    clearTimeout(fallbackResolveTimer);
    fallbackResolveTimer = null;

    assert.equal(cancelCalled, true);
    assert.equal(res.writableEnded, false);
    assert.equal(res.body, "");
  } finally {
    if (fallbackResolveTimer) clearTimeout(fallbackResolveTimer);
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testBackgroundSolveRejectsImmediateSolveAtCapacity() {
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-capacity-background-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
      maxRunningSolves: 1,
    }),
  });
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const handlePromiseDeferred = createDeferred();
  const startBackgroundSolveDeferred = createDeferred();
  let startBackgroundSolveCalls = 0;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      throw new Error("Capacity route test should use the background adapter.");
    },
    startBackgroundSolve() {
      startBackgroundSolveCalls += 1;
      startBackgroundSolveDeferred.resolve();
      return {
        promise: handlePromiseDeferred.promise,
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
    },
  });

  try {
    const requestId = "capacity-background-running";
    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
      },
    });
    assert.equal(startResult.statusCode, 202);
    await startBackgroundSolveDeferred.promise;

    const immediateResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: solvePayload,
    });

    assert.equal(immediateResult.statusCode, 429);
    assert.equal(immediateResult.payload.ok, false);
    assert.match(immediateResult.payload.error, /Another solve is already running/);
    assert.equal(startBackgroundSolveCalls, 1);

    handlePromiseDeferred.resolve(backgroundSolution);
    await waitForSolve(handler, requestId);
  } finally {
    handlePromiseDeferred.resolve(backgroundSolution);
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsBackgroundSolveAtCapacity() {
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-capacity-immediate-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
      maxRunningSolves: 1,
    }),
  });
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const handlePromiseDeferred = createDeferred();
  const startBackgroundSolveDeferred = createDeferred();
  let startBackgroundSolveCalls = 0;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      throw new Error("Capacity route test should use the background adapter.");
    },
    startBackgroundSolve() {
      startBackgroundSolveCalls += 1;
      startBackgroundSolveDeferred.resolve();
      return {
        promise: handlePromiseDeferred.promise,
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
    },
  });

  try {
    const req = createMockRequest("POST", "/api/solve", JSON.stringify(solvePayload));
    const res = createMockResponse();
    const pending = handler(req, res);
    await startBackgroundSolveDeferred.promise;
    await waitForNextTurn();

    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId: "capacity-immediate-running",
      },
    });

    assert.equal(startResult.statusCode, 429);
    assert.equal(startResult.payload.ok, false);
    assert.match(startResult.payload.error, /Another solve is already running/);
    assert.equal(startBackgroundSolveCalls, 1);

    handlePromiseDeferred.resolve(backgroundSolution);
    await pending;
    assert.equal(res.statusCode, 200);
    assert.equal(res.writableEnded, true);
  } finally {
    handlePromiseDeferred.resolve(backgroundSolution);
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function invoke(handler, { method = "GET", url = "/", json = undefined, body = undefined }) {
  const payloadBody = json === undefined ? (body ?? "") : JSON.stringify(json);
  const req = createMockRequest(method, url, payloadBody);
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

async function waitForSolve(handler, requestId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    if (result.payload.jobStatus !== "running") {
      return result.payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for solve ${requestId}`);
}

function buildTinySolvePayload() {
  return {
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      residentialTypes: [
        { name: "Test Residence", w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false },
    },
  };
}

function buildWarmStartHintFromSolution(solution, overrides = {}) {
  return {
    ...overrides,
    solution: {
      roads: Array.from(solution.roads),
      services: solution.services.map((service, index) => ({
        ...service,
        typeIndex: solution.serviceTypeIndices[index],
        bonus: solution.servicePopulationIncreases[index],
      })),
      residentials: solution.residentials.map((residential, index) => ({
        ...residential,
        typeIndex: solution.residentialTypeIndices[index],
        population: solution.populations[index],
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation,
    },
  };
}

async function testHealthRoute(handler) {
  const result = await invoke(handler, { method: "GET", url: "/api/health" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
}

async function testStaticPlannerModules(handler) {
  const result = await invoke(handler, { method: "GET", url: "/plannerShell.js" });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /CityBuilderShell/);
}

async function testUnexpectedStaticServerErrorsReturnInternalServerError() {
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web-does-not-exist"),
  });

  const result = await invoke(handler, { method: "GET", url: "/" });

  assert.equal(result.statusCode, 500);
  assert.equal(result.payload.ok, false);
  assert.match(result.payload.error, /ENOENT/);
}

async function testMethodNotAllowed(handler) {
  const result = await invoke(handler, { method: "PUT", url: "/api/solve" });
  assert.equal(result.statusCode, 405);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Method not allowed.");
}

async function testImmediateSolveRoute(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let solveCalled = false;
  let startBackgroundSolveCalled = false;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      solveCalled = true;
      throw new Error("Immediate solves should use the non-blocking background adapter.");
    },
    startBackgroundSolve() {
      startBackgroundSolveCalled = true;
      return {
        promise: Promise.resolve(backgroundSolution),
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
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
    assert.equal(result.payload.stats.totalPopulation, 100);
    assert.equal(result.payload.solution.residentials.length, 1);
    assert.equal(startBackgroundSolveCalled, true);
    assert.equal(solveCalled, false);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveBackendJsonErrorsReturnInternalServerError(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "cp-sat",
    solve() {
      throw new Error("Immediate solves should use the non-blocking background adapter.");
    },
    startBackgroundSolve() {
      return {
        promise: Promise.reject(new Error("CP-SAT backend returned invalid JSON: broken payload")),
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
    },
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat",
        },
      },
    });

    assert.equal(result.statusCode, 500);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "CP-SAT backend returned invalid JSON: broken payload");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsInvalidLnsSeedHint(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {},
        },
      },
    },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Invalid solver input: LNS seed hint is missing the saved solution payload.");
}

async function testImmediateSolveRejectsMalformedLnsSeedFields(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {
            solution: {
              roads: [],
              services: [],
              residentials: [
                { r: null, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 },
              ],
              populations: [100],
              totalPopulation: 100,
            },
          },
        },
      },
    },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Invalid solver input: LNS seed hint solution.residentials[0].r must be an integer >= 0.");
}

async function testImmediateSolveRejectsStaleLnsSeedHintBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const reusableSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "lns",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Stale LNS seed should be rejected before starting the backend.");
      },
    };
  };

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "lns",
          lns: {
            iterations: 1,
            maxNoImprovementIterations: 1,
            neighborhoodRows: 2,
            neighborhoodCols: 2,
            seedHint: buildWarmStartHintFromSolution(reusableSolution, {
              modelFingerprint: "fnv1a:00000000",
            }),
          },
        },
      },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "Invalid solver input: LNS seed hint is stale for the current grid or building settings.");
    assert.equal(optimizerAdapterRequested, false);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsInvalidCpSatOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const reusableSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT input should be rejected before starting the backend.");
      },
    };
  };

  const cases = [
    {
      cpSat: { numWorkers: 0 },
      expectedError: "Invalid solver input: CP-SAT runtime option cpSat.numWorkers must be an integer >= 1.",
    },
    {
      cpSat: {
        numWorkers: 1,
        portfolio: {
          randomSeeds: [11, "bad"],
        },
      },
      expectedError: "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.randomSeeds[1] must be an integer >= 0.",
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: buildWarmStartHintFromSolution(reusableSolution, {
          modelFingerprint: "fnv1a:00000000",
        }),
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint is stale for the current grid or building settings.",
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: {
          solution: {
            roads: [],
            services: [],
            residentials: [
              { r: 0, c: 0, rows: 2, cols: 2, population: 100 },
            ],
            populations: [100],
            totalPopulation: 100,
          },
        },
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution.residentials[0].typeIndex must be an integer >= -1.",
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: {
          solution: {
            roads: [],
            services: [],
            residentials: [
              { r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 },
            ],
            populations: [100],
            totalPopulation: 100,
          },
        },
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution is invalid: Road network does not touch row 0.",
    },
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            optimizer: "cp-sat",
            cpSat: testCase.cpSat,
          },
        },
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsInvalidGreedyOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "greedy",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid greedy input should be rejected before starting the backend.");
      },
    };
  };

  const cases = [
    {
      greedy: "fast",
      expectedError: "Invalid solver input: Greedy options greedy must be an object.",
    },
    {
      greedy: { restarts: 0 },
      expectedError: "Invalid solver input: Greedy option greedy.restarts must be an integer between 1 and 100.",
    },
    {
      greedy: { serviceLookaheadCandidates: "many" },
      expectedError:
        "Invalid solver input: Greedy option greedy.serviceLookaheadCandidates must be an integer between 0 and 2000.",
    },
    {
      greedy: { timeLimitSeconds: 0 },
      expectedError: "Invalid solver input: Greedy option greedy.timeLimitSeconds must be a finite number > 0 and <= 86400.",
    },
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            greedy: testCase.greedy,
          },
        },
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolvePreservesTypedSolverInputErrors(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "lns",
    solve() {
      throw new Error("Immediate solves should use the non-blocking background adapter.");
    },
    startBackgroundSolve() {
      const error = new SolverInputError("Simulated typed validation failure.");
      error.message = "Simulated typed validation failure.";
      return {
        promise: Promise.reject(error),
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null,
          };
        },
      };
    },
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "lns",
          lns: {
            iterations: 1,
            maxNoImprovementIterations: 1,
            neighborhoodRows: 2,
            neighborhoodCols: 2,
          },
        },
      },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "Simulated typed validation failure.");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testLayoutEvaluateRoute(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: Array.from(solved.roads),
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, true);
  assert.equal(result.payload.stats.totalPopulation, 100);
  assert.equal(result.payload.solution.manualLayout, true);
  assert.equal(result.payload.stats.manualLayout, true);
  assert.equal(result.payload.stats.cpSatStatus, null);
}

async function testLayoutEvaluateRejectsMalformedSerializedSolutions(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: [{}],
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution,
    },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(
    result.payload.error,
    "Invalid solver input: Manual layout solution.roads[0] must be a road key like \"r,c\"."
  );
}

async function testLayoutEvaluateReportsWellFormedInvalidManualLayout(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: [],
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, false);
  assert.match(result.payload.validation.errors.join("\n"), /Road network does not touch row 0/);
  assert.equal(result.payload.solution.manualLayout, true);
}

async function testLayoutEvaluateRejectsInvalidProblemDefinition(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: Array.from(solved.roads),
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        residentialTypes: [
          { ...solvePayload.params.residentialTypes[0], avail: "1" },
        ],
      },
      solution: serializedSolution,
    },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(
    result.payload.error,
    "Invalid solver input: Problem definition residentialTypes[0].avail must be an integer >= 0."
  );
}

async function testBackgroundSolveRoutes(handler) {
  const solvePayload = buildTinySolvePayload();
  const requestId = "route-test-greedy";
  const startResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId,
    },
  });

  assert.equal(startResult.statusCode, 202);
  assert.equal(startResult.payload.ok, true);
  assert.equal(startResult.payload.requestId, requestId);
  assert.equal(startResult.payload.jobStatus, "running");
  assert.equal(typeof startResult.payload.progressLogFilePath, "string");

  const finalPayload = await waitForSolve(handler, requestId);
  assert.equal(finalPayload.jobStatus, "completed");
  assert.equal(finalPayload.stats.totalPopulation, 100);
  assert.equal(finalPayload.solution.residentials.length, 1);
  assert.equal(finalPayload.progressLogFilePath, startResult.payload.progressLogFilePath);

  const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
  assert.equal(persistedLog.requestId, requestId);
  assert.equal(persistedLog.status, "completed");
  assert.deepEqual(persistedLog.input.grid, solvePayload.grid);
  assert.equal(persistedLog.input.params.greedy.localSearch, false);
  assert.equal(Array.isArray(persistedLog.entries), true);
  assert.equal(persistedLog.entries.length >= 2, true);
  assert.equal(persistedLog.entries[0].hasFeasibleSolution, false);
  assert.equal(persistedLog.entries[0].totalPopulation, null);
  assert.equal(persistedLog.entries[persistedLog.entries.length - 1].source, "final-result");
}

async function testSolveStatusIncludesAutoStageMetadata(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = {
    ...solve(solvePayload.grid, solvePayload.params),
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
        { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 },
      ],
    },
  };
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const handlePromiseDeferred = createDeferred();

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "auto",
    solve() {
      throw new Error("Status route test should use the background adapter.");
    },
    startBackgroundSolve() {
      return {
        promise: handlePromiseDeferred.promise,
        cancel() {},
        getLatestSnapshot() {
          return backgroundSolution;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: true,
            totalPopulation: backgroundSolution.totalPopulation,
            activeOptimizer: backgroundSolution.activeOptimizer,
            autoStage: backgroundSolution.autoStage,
            cpSatStatus: null,
          };
        },
      };
    },
  });

  try {
    const requestId = "route-test-auto-status";
    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "auto",
        },
        requestId,
      },
    });

    assert.equal(startResult.statusCode, 202);
    assert.equal(startResult.payload.optimizer, "auto");

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
    });

    assert.equal(statusResult.statusCode, 200);
    assert.equal(statusResult.payload.activeOptimizer, "lns");
    assert.equal(statusResult.payload.autoStage.stageIndex, 2);
    assert.equal(statusResult.payload.autoStage.generatedSeeds.length, 2);

    handlePromiseDeferred.resolve(backgroundSolution);
    await waitForSolve(handler, requestId);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testRecoveredAutoFailureNormalizesTerminalMetadata() {
  const solvePayload = buildTinySolvePayload();
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-auto-recovery-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
    }),
  });
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const streamedSolution = {
    ...solve(solvePayload.grid, solvePayload.params),
    optimizer: "auto",
    activeOptimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    autoStage: {
      requestedOptimizer: "auto",
      activeStage: "cp-sat",
      stageIndex: 3,
      cycleIndex: 1,
      consecutiveWeakCycles: 0,
      lastCycleImprovementRatio: null,
      stopReason: null,
      generatedSeeds: [
        { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
        { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 },
        { stage: "cp-sat", stageIndex: 3, cycleIndex: 1, randomSeed: 17 },
      ],
    },
  };
  const recoveredSolution = {
    ...streamedSolution,
    activeOptimizer: "lns",
    autoStage: {
      ...streamedSolution.autoStage,
      activeStage: null,
      stageIndex: 2,
      cycleIndex: 1,
      stopReason: null,
      generatedSeeds: [
        { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
        { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 },
      ],
    },
  };

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "auto",
    solve() {
      throw new Error("Recovered-auto route test should use the background adapter.");
    },
    startBackgroundSolve() {
      let latestSnapshot = streamedSolution;
      return {
        promise: new Promise((resolve, reject) => {
          setTimeout(() => {
            latestSnapshot = recoveredSolution;
            reject(new Error("Auto backend exited after streaming a feasible incumbent."));
          }, 30);
        }),
        cancel() {},
        getLatestSnapshot() {
          return latestSnapshot;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: true,
            totalPopulation: latestSnapshot.totalPopulation,
            activeOptimizer: latestSnapshot.activeOptimizer,
            autoStage: latestSnapshot.autoStage,
            cpSatStatus: latestSnapshot.cpSatStatus,
          };
        },
      };
    },
  });

  try {
    const requestId = "route-test-auto-recovery";
    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "auto",
        },
        requestId,
      },
    });

    assert.equal(startResult.statusCode, 202);
    const finalPayload = await waitForSolve(handler, requestId);

    assert.equal(finalPayload.jobStatus, "completed");
    assert.equal(finalPayload.message, "Auto kept the best available incumbent after a later stage ended without a usable result.");
    assert.equal(finalPayload.stats.activeOptimizer, "cp-sat");
    assert.equal(finalPayload.stats.autoStage.activeStage, "cp-sat");
    assert.equal(finalPayload.stats.autoStage.stageIndex, 3);
    assert.equal(finalPayload.stats.autoStage.stopReason, "stage-error");
    assert.equal(finalPayload.solution.activeOptimizer, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.activeStage, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.stageIndex, 3);
    assert.equal(finalPayload.solution.autoStage.stopReason, "stage-error");

    const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
    assert.equal(persistedLog.message, "Auto kept the best available incumbent after a later stage ended without a usable result.");
    assert.equal(persistedLog.finalResult.solution.activeOptimizer, "cp-sat");
    assert.equal(persistedLog.finalResult.solution.autoStage.activeStage, "cp-sat");
    assert.equal(persistedLog.finalResult.solution.autoStage.stageIndex, 3);
    assert.equal(persistedLog.finalResult.solution.autoStage.stopReason, "stage-error");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidLnsSeedHint(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId: "invalid-lns-seed",
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {},
        },
      },
    },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Invalid solver input: LNS seed hint is missing the saved solution payload.");
}

async function testStartSolveRejectsInvalidCpSatOptionsBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT input should be rejected before starting a solve job.");
      },
    };
  };

  try {
    const requestId = "invalid-cp-sat-options";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat",
          cpSat: {
            numWorkers: 1,
            portfolio: {
              perWorkerNumWorkers: 0,
            },
          },
        },
      },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.perWorkerNumWorkers must be an integer >= 1."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidCpSatWarmStartBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT warm start should be rejected before starting a solve job.");
      },
    };
  };

  try {
    const requestId = "invalid-cp-sat-reusable-layout";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat",
          cpSat: {
            numWorkers: 1,
            warmStartHint: {
              solution: {
                roads: [],
                services: [],
                residentials: [
                  { r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 },
                ],
                populations: [100],
                totalPopulation: 100,
              },
            },
          },
        },
      },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution is invalid: Road network does not touch row 0."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidGreedyOptionsBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "greedy",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid greedy input should be rejected before starting a solve job.");
      },
    };
  };

  try {
    const requestId = "invalid-greedy-options";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          serviceExactMaxCombinations: 0,
        },
      },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: Legacy greedy option serviceExactMaxCombinations must be an integer between 1 and 100000."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testCancelMissingSolveRoute(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve/cancel",
    json: { requestId: "missing-solve" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.stopped, false);
}

async function testCompletedSolveJobsExpire() {
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-expiry-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
      completedJobRetentionMs: 50,
    }),
  });
  const solvePayload = buildTinySolvePayload();
  const requestId = "expiring-route-test-greedy";
  const startResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId,
    },
  });

  assert.equal(startResult.statusCode, 202);
  await waitForSolve(handler, requestId);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const expiredResult = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
  });

  assert.equal(expiredResult.statusCode, 404);
  assert.equal(expiredResult.payload.ok, false);
  assert.match(expiredResult.payload.error, /No solve job was found/);
  assert.equal(fs.existsSync(startResult.payload.progressLogFilePath), true);
}

async function main() {
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-logs-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
    }),
  });

  await testHealthRoute(handler);
  await testStaticPlannerModules(handler);
  await testUnexpectedStaticServerErrorsReturnInternalServerError();
  await testMethodNotAllowed(handler);
  await testImmediateSolveRoute(handler);
  await testImmediateSolveBackendJsonErrorsReturnInternalServerError(handler);
  await testImmediateSolveRejectsInvalidLnsSeedHint(handler);
  await testImmediateSolveRejectsMalformedLnsSeedFields(handler);
  await testImmediateSolveRejectsStaleLnsSeedHintBeforeStartingBackend(handler);
  await testImmediateSolveRejectsInvalidCpSatOptionsBeforeStartingBackend(handler);
  await testImmediateSolveRejectsInvalidGreedyOptionsBeforeStartingBackend(handler);
  await testImmediateSolvePreservesTypedSolverInputErrors(handler);
  await testImmediateSolveCancelsOnDisconnect(handler);
  await testBackgroundSolveRejectsImmediateSolveAtCapacity();
  await testImmediateSolveRejectsBackgroundSolveAtCapacity();
  await testLayoutEvaluateRoute(handler);
  await testLayoutEvaluateRejectsMalformedSerializedSolutions(handler);
  await testLayoutEvaluateReportsWellFormedInvalidManualLayout(handler);
  await testLayoutEvaluateRejectsInvalidProblemDefinition(handler);
  await testBackgroundSolveRoutes(handler);
  await testSolveStatusIncludesAutoStageMetadata(handler);
  await testRecoveredAutoFailureNormalizesTerminalMetadata();
  await testStartSolveRejectsInvalidLnsSeedHint(handler);
  await testStartSolveRejectsInvalidCpSatOptionsBeforeStartingJob(handler);
  await testStartSolveRejectsInvalidCpSatWarmStartBeforeStartingJob(handler);
  await testStartSolveRejectsInvalidGreedyOptionsBeforeStartingJob(handler);
  await testCancelMissingSolveRoute(handler);
  await testCompletedSolveJobsExpire();

  console.log("Web server route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
