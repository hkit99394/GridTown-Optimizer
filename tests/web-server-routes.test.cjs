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
    "Invalid layout-evaluate payload. Expected { grid, params, solution } with a rectangular 0/1 grid."
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

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "auto",
    solve() {
      throw new Error("Recovered-auto route test should use the background adapter.");
    },
    startBackgroundSolve() {
      return {
        promise: Promise.reject(new Error("Auto backend exited after streaming a feasible incumbent.")),
        cancel() {},
        getLatestSnapshot() {
          return streamedSolution;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: true,
            totalPopulation: streamedSolution.totalPopulation,
            activeOptimizer: streamedSolution.activeOptimizer,
            autoStage: streamedSolution.autoStage,
            cpSatStatus: streamedSolution.cpSatStatus,
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
    assert.equal(finalPayload.stats.autoStage.stopReason, "stage-error");
    assert.equal(finalPayload.solution.activeOptimizer, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.activeStage, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.stopReason, "stage-error");

    const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
    assert.equal(persistedLog.message, "Auto kept the best available incumbent after a later stage ended without a usable result.");
    assert.equal(persistedLog.finalResult.solution.activeOptimizer, "cp-sat");
    assert.equal(persistedLog.finalResult.solution.autoStage.activeStage, "cp-sat");
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
  await testImmediateSolvePreservesTypedSolverInputErrors(handler);
  await testImmediateSolveCancelsOnDisconnect(handler);
  await testLayoutEvaluateRoute(handler);
  await testLayoutEvaluateRejectsMalformedSerializedSolutions(handler);
  await testBackgroundSolveRoutes(handler);
  await testSolveStatusIncludesAutoStageMetadata(handler);
  await testRecoveredAutoFailureNormalizesTerminalMetadata();
  await testStartSolveRejectsInvalidLnsSeedHint(handler);
  await testCancelMissingSolveRoute(handler);
  await testCompletedSolveJobsExpire();

  console.log("Web server route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
