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

async function testHttpSolveStripsLocalRuntimePathOptions(handler) {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
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
    assert.equal(capturedParams.cpSat.pythonExecutable, undefined);
    assert.equal(capturedParams.cpSat.scriptPath, undefined);
    assert.equal(capturedParams.cpSat.stopFilePath, undefined);
    assert.equal(capturedParams.cpSat.snapshotFilePath, undefined);
    assert.equal(capturedParams.cpSat.numWorkers, 1);
    assert.equal(capturedParams.greedy.stopFilePath, undefined);
    assert.equal(capturedParams.greedy.snapshotFilePath, undefined);
    assert.equal(capturedParams.lns.stopFilePath, undefined);
    assert.equal(capturedParams.lns.snapshotFilePath, undefined);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
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
  await testImmediateSolveRoute(handler);
  await testImmediateSolveBackendJsonErrorsReturnInternalServerError(handler);
  await testImmediateSolveCancelsOnDisconnect(handler);
  await testBackgroundSolveRejectsImmediateSolveAtCapacity(handler);
  await testImmediateSolveRejectsBackgroundSolveAtCapacity(handler);

  console.log("Web server solve route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
