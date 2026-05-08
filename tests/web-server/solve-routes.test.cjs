const assert = require("node:assert/strict");

const optimizerRegistry = require("../../dist/packages/runtime/dispatch/optimizerRegistry.js");
const { solve } = require("city-builder/solver");
const {
  assertPlannerExplainabilityPayload,
  buildTinySolvePayload,
  createDeferred,
  createMockRequest,
  createMockResponse,
  createRouteTestHandler,
  invoke,
  waitForNextTurn,
  waitForSolve
} = require("./routeTestServer.cjs");

/**
 * @typedef {import("../../dist/packages/core/index.js").SolverParams} SolverParams
 * @typedef {ReturnType<typeof createRouteTestHandler>["handler"]} RouteTestHandler
 */

/**
 * @typedef {SolverParams & {
 *   cpSat: NonNullable<SolverParams["cpSat"]>,
 *   greedy: NonNullable<SolverParams["greedy"]>,
 *   lns: NonNullable<SolverParams["lns"]>
 * }} CapturedSanitizedParams
 */

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testHttpSolveStripsLocalRuntimePathOptions(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  /** @type {SolverParams | null} */
  let capturedParams = null;

  optimizerRegistry.getOptimizerAdapter = (params) => ({
    name: "greedy",
    solve() {
      throw new Error("HTTP solve sanitization test should use the background adapter.");
    },
    startBackgroundSolve(_grid, paramsFromStart) {
      capturedParams = paramsFromStart ?? params;
      return {
        promise: Promise.resolve(backgroundSolution),
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null
          };
        }
      };
    }
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          cpSat: {
            pythonExecutable: "/tmp/evil-python",
            scriptPath: "/tmp/evil.py",
            stopFilePath: "/tmp/stop",
            snapshotFilePath: "/tmp/snapshot.json",
            numWorkers: 1
          },
          greedy: {
            ...solvePayload.params.greedy,
            stopFilePath: "/tmp/greedy-stop",
            snapshotFilePath: "/tmp/greedy-snapshot.json"
          },
          lns: {
            stopFilePath: "/tmp/lns-stop",
            snapshotFilePath: "/tmp/lns-snapshot.json"
          }
        }
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    if (capturedParams === null) {
      assert.fail("Expected sanitized solver params to be captured.");
    }
    const sanitizedParams = /** @type {CapturedSanitizedParams} */ (/** @type {unknown} */ (capturedParams));
    assert.equal(sanitizedParams.cpSat.pythonExecutable, undefined);
    assert.equal(sanitizedParams.cpSat.scriptPath, undefined);
    assert.equal(sanitizedParams.cpSat.stopFilePath, undefined);
    assert.equal(sanitizedParams.cpSat.snapshotFilePath, undefined);
    assert.equal(sanitizedParams.cpSat.numWorkers, 1);
    assert.equal(sanitizedParams.greedy.stopFilePath, undefined);
    assert.equal(sanitizedParams.greedy.snapshotFilePath, undefined);
    assert.equal(sanitizedParams.lns.stopFilePath, undefined);
    assert.equal(sanitizedParams.lns.snapshotFilePath, undefined);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testStartSolveLeavesStandaloneGreedyTimeLimitUnset(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  /** @type {SolverParams | null} */
  let capturedParams = null;

  optimizerRegistry.getOptimizerAdapter = (params) => ({
    name: "greedy",
    solve() {
      throw new Error("Greedy unset time-limit test should use the background adapter.");
    },
    startBackgroundSolve(_grid, paramsFromStart) {
      capturedParams = paramsFromStart ?? params;
      return {
        promise: Promise.resolve(backgroundSolution),
        cancel() {},
        getLatestSnapshot() {
          return backgroundSolution;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: true,
            totalPopulation: backgroundSolution.totalPopulation
          };
        }
      };
    }
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "greedy",
          greedy: {
            ...solvePayload.params.greedy,
            timeLimitSeconds: undefined
          }
        },
        requestId: "unset-greedy-time-limit"
      }
    });

    assert.equal(result.statusCode, 202);
    const unsetTimeLimitParams = capturedParams;
    if (unsetTimeLimitParams === null) {
      assert.fail("Expected solver params to be captured.");
    }
    const sanitizedParams = /** @type {CapturedSanitizedParams} */ (/** @type {unknown} */ (unsetTimeLimitParams));
    assert.equal(sanitizedParams.greedy.timeLimitSeconds, undefined);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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
            totalPopulation: null
          };
        }
      };
    }
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: solvePayload
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.stats.totalPopulation, 100);
    assert.equal(result.payload.solution.residentials.length, 1);
    assertPlannerExplainabilityPayload(result.payload, solvePayload.grid);
    assert.equal(startBackgroundSolveCalled, true);
    assert.equal(solveCalled, false);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
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
            totalPopulation: null
          };
        }
      };
    }
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat"
        }
      }
    });

    assert.equal(result.statusCode, 500);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "CP-SAT backend returned invalid JSON: broken payload");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testImmediateSolveCancelsOnDisconnect(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let cancelCalled = false;
  const handlePromiseDeferred = createDeferred();
  /** @type {NodeJS.Timeout | null} */
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
            totalPopulation: null
          };
        }
      };
    }
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
  const { handler } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-capacity-background-",
    maxRunningSolves: 1
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
            totalPopulation: null
          };
        }
      };
    }
  });

  try {
    const requestId = "capacity-background-running";
    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId
      }
    });
    assert.equal(startResult.statusCode, 202);
    await startBackgroundSolveDeferred.promise;

    const immediateResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: solvePayload
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
  const { handler } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-capacity-immediate-",
    maxRunningSolves: 1
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
            totalPopulation: null
          };
        }
      };
    }
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
        requestId: "capacity-immediate-running"
      }
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

async function main() {
  const { handler } = createRouteTestHandler();
  await testHttpSolveStripsLocalRuntimePathOptions(handler);
  await testStartSolveLeavesStandaloneGreedyTimeLimitUnset(handler);
  await testImmediateSolveRoute(handler);
  await testImmediateSolveBackendJsonErrorsReturnInternalServerError(handler);
  await testImmediateSolveCancelsOnDisconnect(handler);
  await testBackgroundSolveRejectsImmediateSolveAtCapacity();
  await testImmediateSolveRejectsBackgroundSolveAtCapacity();

  console.log("Web server solve route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
