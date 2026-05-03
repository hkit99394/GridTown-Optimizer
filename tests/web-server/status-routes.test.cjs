const assert = require("node:assert/strict");
const fs = require("node:fs");

const optimizerRegistry = require("../../dist/packages/runtime/dispatch/optimizerRegistry.js");
const { solve } = require("city-builder/solver");
const {
  buildTinySolvePayload,
  createDeferred,
  createRouteTestHandler,
  invoke,
  waitForSolve
} = require("./routeTestServer.cjs");

/**
 * @typedef {import("../../dist/packages/core/index.js").Solution} Solution
 * @typedef {import("../../dist/packages/core/index.js").SolverParams} SolverParams
 * @typedef {Parameters<typeof optimizerRegistry.getOptimizerAdapter>[0]} OptimizerAdapterRequest
 * @typedef {ReturnType<typeof createRouteTestHandler>["handler"]} RouteTestHandler
 */

/**
 * @typedef {{ promise: Promise<Solution>, resolve: (value?: Solution | PromiseLike<Solution>) => void }} DeferredSolution
 */

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testBackgroundSolveRoutes(handler) {
  const solvePayload = buildTinySolvePayload();
  const requestId = "route-test-greedy";
  const startResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId
    }
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

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testStartSolveDefaultsOmittedOptimizerToAuto(handler) {
  const solvePayload = buildTinySolvePayload();
  const { optimizer, ...paramsWithoutOptimizer } = solvePayload.params;
  assert.equal(optimizer, "greedy");
  /** @type {NonNullable<Solution["autoStage"]>} */
  const autoStage = {
    requestedOptimizer: "auto",
    activeStage: "greedy",
    stageIndex: 1,
    cycleIndex: 0,
    consecutiveWeakCycles: 0,
    lastCycleImprovementRatio: null,
    stopReason: "completed-plan",
    generatedSeeds: [{ stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 }]
  };
  /** @type {Solution} */
  const backgroundSolution = {
    ...solve(solvePayload.grid, solvePayload.params),
    optimizer: "auto",
    activeOptimizer: "greedy",
    autoStage
  };
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  /** @type {OptimizerAdapterRequest} */
  let adapterRequest = null;
  let adapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = (params) => {
    adapterRequested = true;
    adapterRequest = params;
    return {
      name: "auto",
      solve() {
        throw new Error("Default optimizer route test should use the background adapter.");
      },
      startBackgroundSolve() {
        return {
          promise: Promise.resolve(backgroundSolution),
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
              cpSatStatus: null
            };
          }
        };
      }
    };
  };

  try {
    const requestId = "route-test-default-auto";
    const startResult = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        grid: solvePayload.grid,
        params: paramsWithoutOptimizer,
        requestId
      }
    });

    assert.equal(startResult.statusCode, 202);
    assert.equal(startResult.payload.optimizer, "auto");
    assert.equal(adapterRequested, true);
    if (adapterRequest === undefined) {
      assert.equal(adapterRequest, undefined);
    } else if (typeof adapterRequest === "string") {
      assert.equal(adapterRequest, "auto");
    } else if (adapterRequest === null || typeof adapterRequest !== "object") {
      assert.fail("Expected the optimizer adapter to receive sanitized solver params.");
    } else {
      const requestedParams = /** @type {Pick<SolverParams, "optimizer">} */ (/** @type {unknown} */ (adapterRequest));
      assert.equal(requestedParams.optimizer, undefined);
    }

    const finalPayload = await waitForSolve(handler, requestId);
    assert.equal(finalPayload.stats.optimizer, "auto");
    assert.equal(finalPayload.stats.activeOptimizer, "greedy");

    const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
    assert.equal(persistedLog.optimizer, "auto");
    assert.equal(persistedLog.input.params.optimizer, undefined);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testSolveStatusIncludesAutoStageMetadata(handler) {
  const solvePayload = buildTinySolvePayload();
  /** @type {Solution} */
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
        { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 }
      ]
    }
  };
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const handlePromiseDeferred = /** @type {DeferredSolution} */ (createDeferred());

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
            cpSatStatus: null
          };
        }
      };
    }
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
          optimizer: "auto"
        },
        requestId
      }
    });

    assert.equal(startResult.statusCode, 202);
    assert.equal(startResult.payload.optimizer, "auto");

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
    });

    assert.equal(statusResult.statusCode, 200);
    assert.equal(statusResult.payload.activeOptimizer, "lns");
    assert.equal(statusResult.payload.autoStage.stageIndex, 2);
    assert.equal(statusResult.payload.autoStage.generatedSeeds.length, 2);

    const snapshotStatusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId, includeSnapshot: "1" }).toString()}`
    });

    assert.equal(snapshotStatusResult.statusCode, 200);
    assert.equal(snapshotStatusResult.payload.progressEntry.activeOptimizer, "lns");
    assert.equal(snapshotStatusResult.payload.progressEntry.autoStage.stageIndex, 2);
    assert.equal(snapshotStatusResult.payload.progressEntry.totalPopulation, backgroundSolution.totalPopulation);

    handlePromiseDeferred.resolve(backgroundSolution);
    await waitForSolve(handler, requestId);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testRecoveredAutoFailureNormalizesTerminalMetadata() {
  const solvePayload = buildTinySolvePayload();
  const { handler } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-auto-recovery-"
  });
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  /** @type {NonNullable<Solution["autoStage"]>} */
  const streamedAutoStage = {
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
      { stage: "cp-sat", stageIndex: 3, cycleIndex: 1, randomSeed: 17 }
    ]
  };
  /** @type {Solution} */
  const streamedSolution = {
    ...solve(solvePayload.grid, solvePayload.params),
    optimizer: "auto",
    activeOptimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    autoStage: streamedAutoStage
  };
  /** @type {NonNullable<Solution["autoStage"]>} */
  const recoveredAutoStage = {
    ...streamedAutoStage,
    activeStage: null,
    stageIndex: 2,
    cycleIndex: 1,
    stopReason: null,
    generatedSeeds: [
      { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
      { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 }
    ]
  };
  /** @type {Solution} */
  const recoveredSolution = {
    ...streamedSolution,
    activeOptimizer: "lns",
    autoStage: recoveredAutoStage
  };

  optimizerRegistry.getOptimizerAdapter = () => ({
    ...originalGetOptimizerAdapter("auto"),
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
            cpSatStatus: latestSnapshot.cpSatStatus
          };
        }
      };
    }
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
          optimizer: "auto"
        },
        requestId
      }
    });

    assert.equal(startResult.statusCode, 202);
    const finalPayload = await waitForSolve(handler, requestId);

    assert.equal(finalPayload.jobStatus, "completed");
    assert.equal(
      finalPayload.message,
      "Auto kept the best available incumbent after a later stage ended without a usable result."
    );
    assert.equal(finalPayload.stats.activeOptimizer, "cp-sat");
    assert.equal(finalPayload.stats.autoStage.activeStage, "cp-sat");
    assert.equal(finalPayload.stats.autoStage.stageIndex, 3);
    assert.equal(finalPayload.stats.autoStage.stopReason, "stage-error");
    assert.equal(finalPayload.solution.activeOptimizer, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.activeStage, "cp-sat");
    assert.equal(finalPayload.solution.autoStage.stageIndex, 3);
    assert.equal(finalPayload.solution.autoStage.stopReason, "stage-error");

    const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
    assert.equal(
      persistedLog.message,
      "Auto kept the best available incumbent after a later stage ended without a usable result."
    );
    assert.equal(persistedLog.finalResult.solution.activeOptimizer, "cp-sat");
    assert.equal(persistedLog.finalResult.solution.autoStage.activeStage, "cp-sat");
    assert.equal(persistedLog.finalResult.solution.autoStage.stageIndex, 3);
    assert.equal(persistedLog.finalResult.solution.autoStage.stopReason, "stage-error");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testCancelMissingSolveRoute(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve/cancel",
    json: { requestId: "missing-solve" }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.stopped, false);
}

async function testCompletedSolveJobsExpire() {
  const { handler } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-expiry-",
    completedJobRetentionMs: 50
  });
  const solvePayload = buildTinySolvePayload();
  const requestId = "expiring-route-test-greedy";
  const startResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId
    }
  });

  assert.equal(startResult.statusCode, 202);
  await waitForSolve(handler, requestId);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const expiredResult = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
  });

  assert.equal(expiredResult.statusCode, 404);
  assert.equal(expiredResult.payload.ok, false);
  assert.match(expiredResult.payload.error, /No solve job was found/);
  assert.equal(fs.existsSync(startResult.payload.progressLogFilePath), true);
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testBackgroundSolveRoutes(handler);
  await testStartSolveDefaultsOmittedOptimizerToAuto(handler);
  await testSolveStatusIncludesAutoStageMetadata(handler);
  await testRecoveredAutoFailureNormalizesTerminalMetadata();
  await testCancelMissingSolveRoute(handler);
  await testCompletedSolveJobsExpire();

  console.log("Web server status route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
