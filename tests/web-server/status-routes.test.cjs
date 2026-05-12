const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const optimizerRegistry = require("../../dist/packages/runtime/dispatch/optimizerRegistry.js");
const { SolveJobManager } = require("../../dist/packages/runtime/jobs/solveJobManager.js");
const { SolveProgressLogWriter } = require("../../dist/packages/runtime/jobs/solveProgressLog.js");
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
  assert.equal(finalPayload.explainability, undefined);
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
    assert.equal(snapshotStatusResult.payload.liveSnapshot, true);
    assert.equal(snapshotStatusResult.payload.validation.valid, true);
    assert.equal(snapshotStatusResult.payload.validation.populationValidation.mode, "reported-invariants");
    assert.equal(snapshotStatusResult.payload.validation.populationValidation.populationSource, "solver-reported");
    assert.equal(snapshotStatusResult.payload.explainability, undefined);

    handlePromiseDeferred.resolve(backgroundSolution);
    await waitForSolve(handler, requestId);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testLiveSnapshotStatusValidatesReportedPopulationInvariants(handler) {
  const solvePayload = buildTinySolvePayload();
  /** @type {Solution} */
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  /** @type {Solution} */
  const inconsistentSnapshot = {
    ...backgroundSolution,
    totalPopulation: backgroundSolution.totalPopulation + 1,
    residentialTypeIndices: [...backgroundSolution.residentialTypeIndices, 0]
  };
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  const handlePromiseDeferred = /** @type {DeferredSolution} */ (createDeferred());

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      throw new Error("Status invariant route test should use the background adapter.");
    },
    startBackgroundSolve() {
      return {
        promise: handlePromiseDeferred.promise,
        cancel() {},
        getLatestSnapshot() {
          return inconsistentSnapshot;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: true,
            totalPopulation: inconsistentSnapshot.totalPopulation,
            activeOptimizer: null,
            autoStage: null,
            cpSatStatus: null
          };
        }
      };
    }
  });

  try {
    const requestId = "route-test-live-population-invariants";
    await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId
      }
    });

    const snapshotStatusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId, includeSnapshot: "1" }).toString()}`
    });

    assert.equal(snapshotStatusResult.statusCode, 200);
    assert.equal(snapshotStatusResult.payload.liveSnapshot, true);
    assert.equal(snapshotStatusResult.payload.validation.valid, false);
    assert.equal(snapshotStatusResult.payload.validation.populationValidation.mode, "reported-invariants");
    assert.equal(snapshotStatusResult.payload.validation.populationValidation.reportedTotalPopulation, 101);
    assert.equal(snapshotStatusResult.payload.validation.populationValidation.reportedPopulationSum, 100);
    assert.equal(snapshotStatusResult.payload.validation.recomputedTotalPopulation, 100);
    assert.match(
      snapshotStatusResult.payload.validation.errors.join("\n"),
      /residential type indices for 1 residentials/
    );
    assert.match(
      snapshotStatusResult.payload.validation.errors.join("\n"),
      /reported residential populations sum to 100/
    );

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

async function testShutdownRecoversLatestSnapshotBeforeFinalizing() {
  const solvePayload = buildTinySolvePayload();
  const backgroundSolution = solve(solvePayload.grid, solvePayload.params);
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-shutdown-recovery-"));
  const manager = new SolveJobManager({
    progressLogRoot,
    progressLogIntervalMs: 10,
    progressLogPollIntervalMs: 5
  });
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let forceKillCalled = false;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "greedy",
    solve() {
      throw new Error("Shutdown recovery test should use the background adapter.");
    },
    startBackgroundSolve() {
      return {
        promise: new Promise(() => {}),
        cancel() {},
        forceKill() {
          forceKillCalled = true;
        },
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
    const requestId = "shutdown-recovers-latest-snapshot";
    const job = manager.start(solvePayload.grid, solvePayload.params, requestId);

    manager.shutdownRunningSolves("Local web server stopped while a feasible incumbent existed.");

    const finalJob = manager.get(requestId);
    assert.equal(forceKillCalled, true);
    assert.equal(finalJob, job);
    assert.equal(finalJob.status, "stopped");
    const finalSolution = finalJob.solution;
    if (finalSolution === null) assert.fail("Expected shutdown recovery to preserve the latest feasible solution.");
    assert.equal(finalSolution.totalPopulation, 100);
    assert.equal(finalJob.error, null);
    assert.equal(finalJob.message, "Solve was stopped by user. Showing the best feasible result found so far.");
    assert.equal(finalJob.handle, null);

    const persistedLog = JSON.parse(fs.readFileSync(job.progressLogFilePath, "utf8"));
    assert.equal(persistedLog.status, "stopped");
    assert.equal(persistedLog.error, null);
    assert.equal(persistedLog.finalResult.solution.totalPopulation, 100);
    assert.equal(persistedLog.finalResult.solution.stoppedByUser, true);
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

async function testCompletedSolveStatusRecoversFromProgressLogAfterRetention() {
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

  assert.equal(expiredResult.statusCode, 200);
  assert.equal(expiredResult.payload.ok, true);
  assert.equal(expiredResult.payload.requestId, requestId);
  assert.equal(expiredResult.payload.jobStatus, "completed");
  assert.equal(expiredResult.payload.cancelRequested, false);
  assert.equal(expiredResult.payload.progressLogFilePath, startResult.payload.progressLogFilePath);
  assert.equal(expiredResult.payload.progressEntry.source, "final-result");
  assert.equal(expiredResult.payload.stats.totalPopulation, 100);
  assert.equal(expiredResult.payload.solution.residentials.length, 1);
  assert.equal(expiredResult.payload.explainability, undefined);
  assert.equal(fs.existsSync(startResult.payload.progressLogFilePath), true);
}

async function testStoppedProgressLogRecoversCompactSolveResponse() {
  const { handler, progressLogRoot } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-stopped-log-"
  });
  const solvePayload = buildTinySolvePayload();
  const requestId = "stopped-progress-log-status";
  const solution = {
    ...solve(solvePayload.grid, solvePayload.params),
    stoppedByUser: true
  };
  const writer = new SolveProgressLogWriter({
    rootDirectory: progressLogRoot,
    requestId,
    optimizer: "greedy",
    grid: solvePayload.grid,
    params: solvePayload.params,
    createdAtMs: Date.now()
  });
  writer.appendSolutionSample(solution, {
    elapsedMs: 250,
    source: "final-result"
  });
  writer.finish("stopped", {
    finishedAtMs: Date.now(),
    solution,
    message: "Solve was stopped by user. Showing the best feasible result found so far."
  });

  const result = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requestId, requestId);
  assert.equal(result.payload.jobStatus, "stopped");
  assert.equal(result.payload.cancelRequested, true);
  assert.equal(result.payload.progressLogFilePath, writer.filePath);
  assert.equal(result.payload.message, "Solve was stopped by user. Showing the best feasible result found so far.");
  assert.equal(result.payload.progressEntry.source, "final-result");
  assert.equal(result.payload.stats.stoppedByUser, true);
  assert.equal(result.payload.stats.totalPopulation, 100);
  assert.equal(result.payload.solution.stoppedByUser, true);
  assert.equal(result.payload.validation.valid, true);
  assert.equal(result.payload.explainability, undefined);
}

/**
 * @param {string} progressLogRoot
 * @param {string} requestId
 * @param {(payload: any) => void} mutate
 * @returns {string}
 */
function writeCorruptedCompletedProgressLog(progressLogRoot, requestId, mutate) {
  const solvePayload = buildTinySolvePayload();
  const solution = solve(solvePayload.grid, solvePayload.params);
  const writer = new SolveProgressLogWriter({
    rootDirectory: progressLogRoot,
    requestId,
    optimizer: "greedy",
    grid: solvePayload.grid,
    params: solvePayload.params,
    createdAtMs: Date.now()
  });
  writer.finishWithSolutionSample("completed", {
    finishedAtMs: Date.now(),
    elapsedMs: 100,
    solution
  });

  const payload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  mutate(payload);
  fs.writeFileSync(writer.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return writer.filePath;
}

async function testRecoveredProgressLogValidationReportsControlledTerminalError() {
  const { handler, progressLogRoot } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-corrupt-log-"
  });

  const invalidPopulationRequestId = "invalid-population-final-solution-status";
  const invalidPopulationFilePath = writeCorruptedCompletedProgressLog(
    progressLogRoot,
    invalidPopulationRequestId,
    (payload) => {
      payload.finalResult.solution.populations[0] += 1;
      payload.finalResult.solution.totalPopulation += 1;
      payload.finalResult.totalPopulation += 1;
    }
  );

  const invalidPopulationResult = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId: invalidPopulationRequestId }).toString()}`
  });

  assert.equal(invalidPopulationResult.statusCode, 200);
  assert.equal(invalidPopulationResult.payload.ok, true);
  assert.equal(invalidPopulationResult.payload.requestId, invalidPopulationRequestId);
  assert.equal(invalidPopulationResult.payload.jobStatus, "completed");
  assert.equal(invalidPopulationResult.payload.progressLogFilePath, invalidPopulationFilePath);
  assert.equal(invalidPopulationResult.payload.validation.valid, false);
  assert.match(invalidPopulationResult.payload.validation.errors.join("\n"), /reports population/);
  assert.match(invalidPopulationResult.payload.validation.errors.join("\n"), /reports total population/);
  assert.equal(invalidPopulationResult.payload.validation.recomputedTotalPopulation, 100);
  assert.equal(invalidPopulationResult.payload.explainability, undefined);

  const malformedSolutionRequestId = "malformed-final-solution-status";
  const malformedSolutionFilePath = writeCorruptedCompletedProgressLog(
    progressLogRoot,
    malformedSolutionRequestId,
    (payload) => {
      delete payload.finalResult.solution.roads;
    }
  );

  const malformedSolutionResult = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId: malformedSolutionRequestId }).toString()}`
  });

  assert.equal(malformedSolutionResult.statusCode, 200);
  assert.equal(malformedSolutionResult.payload.ok, true);
  assert.equal(malformedSolutionResult.payload.requestId, malformedSolutionRequestId);
  assert.equal(malformedSolutionResult.payload.jobStatus, "completed");
  assert.equal(malformedSolutionResult.payload.progressLogFilePath, malformedSolutionFilePath);
  assert.match(malformedSolutionResult.payload.error, /Recovered solve progress log is invalid/);
  assert.match(malformedSolutionResult.payload.error, /finalResult\.solution\.roads/);
  assert.equal(malformedSolutionResult.payload.stats, undefined);
  assert.equal(malformedSolutionResult.payload.solution, undefined);

  const malformedInputRequestId = "malformed-input-status";
  const malformedInputFilePath = writeCorruptedCompletedProgressLog(
    progressLogRoot,
    malformedInputRequestId,
    (payload) => {
      payload.input.params = null;
    }
  );

  const malformedInputResult = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId: malformedInputRequestId }).toString()}`
  });

  assert.equal(malformedInputResult.statusCode, 200);
  assert.equal(malformedInputResult.payload.ok, true);
  assert.equal(malformedInputResult.payload.requestId, malformedInputRequestId);
  assert.equal(malformedInputResult.payload.jobStatus, "completed");
  assert.equal(malformedInputResult.payload.progressLogFilePath, malformedInputFilePath);
  assert.match(malformedInputResult.payload.error, /Recovered solve progress log is invalid/);
  assert.match(malformedInputResult.payload.error, /Solver params/);
  assert.equal(malformedInputResult.payload.stats, undefined);
  assert.equal(malformedInputResult.payload.solution, undefined);
}

async function testFailedProgressLogProjectsTerminalStatus() {
  const { handler, progressLogRoot } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-failed-log-"
  });
  const solvePayload = buildTinySolvePayload();
  const requestId = "failed-progress-log-status";
  const writer = new SolveProgressLogWriter({
    rootDirectory: progressLogRoot,
    requestId,
    optimizer: "greedy",
    grid: solvePayload.grid,
    params: solvePayload.params,
    createdAtMs: Date.now()
  });
  writer.appendPendingSample({
    elapsedMs: 125,
    note: "Solver was still searching before it failed."
  });
  writer.finish("failed", {
    finishedAtMs: Date.now(),
    error: "Backend exited before producing a feasible solution."
  });

  const result = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requestId, requestId);
  assert.equal(result.payload.jobStatus, "failed");
  assert.equal(result.payload.progressLogFilePath, writer.filePath);
  assert.equal(result.payload.progressEntry.note, "Solver was still searching before it failed.");
  assert.equal(result.payload.error, "Backend exited before producing a feasible solution.");
  assert.equal(result.payload.stats, undefined);
}

async function testOrphanedRunningProgressLogReportsLostStatus() {
  const { handler, progressLogRoot } = createRouteTestHandler({
    progressLogRootPrefix: "planner-route-orphaned-status-"
  });
  const solvePayload = buildTinySolvePayload();
  const requestId = "orphaned-running-status";
  const writer = new SolveProgressLogWriter({
    rootDirectory: progressLogRoot,
    requestId,
    optimizer: "greedy",
    grid: solvePayload.grid,
    params: solvePayload.params,
    createdAtMs: Date.now()
  });
  writer.appendPendingSample({
    elapsedMs: 125,
    note: "Still running before the server exited."
  });

  const result = await invoke(handler, {
    method: "GET",
    url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
  });

  assert.equal(result.statusCode, 410);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.requestId, requestId);
  assert.equal(result.payload.jobStatus, "failed");
  assert.equal(result.payload.progressLogFilePath, writer.filePath);
  assert.match(result.payload.error, /status was lost/);
  assert.match(result.payload.error, /stopped or restarted/);
  assert.equal(result.payload.progressEntry.note, "Still running before the server exited.");
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testBackgroundSolveRoutes(handler);
  await testStartSolveDefaultsOmittedOptimizerToAuto(handler);
  await testSolveStatusIncludesAutoStageMetadata(handler);
  await testLiveSnapshotStatusValidatesReportedPopulationInvariants(handler);
  await testRecoveredAutoFailureNormalizesTerminalMetadata();
  await testShutdownRecoversLatestSnapshotBeforeFinalizing();
  await testCancelMissingSolveRoute(handler);
  await testCompletedSolveStatusRecoversFromProgressLogAfterRetention();
  await testStoppedProgressLogRecoversCompactSolveResponse();
  await testRecoveredProgressLogValidationReportsControlledTerminalError();
  await testFailedProgressLogProjectsTerminalStatus();
  await testOrphanedRunningProgressLogReportsLostStatus();

  console.log("Web server status route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
