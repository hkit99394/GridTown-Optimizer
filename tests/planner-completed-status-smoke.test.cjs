const assert = require("node:assert/strict");

const { createFakeDomElement, loadPlannerSolveRuntimeModule } = require("./helpers/plannerBrowserModules.cjs");

function createSolveRuntimeState() {
  return {
    activeSolveRequestId: "",
    isSolving: false,
    isStopping: false,
    layoutEditor: {
      edited: false,
      isApplying: false,
      mode: "inspect",
      pendingPlacement: null,
      pendingValidation: false,
      status: ""
    },
    lns: { useDisplayedSeed: false },
    optimizer: "auto",
    result: null,
    resultContext: null,
    resultElapsedMs: 0,
    resultError: "",
    resultIsLiveSnapshot: false,
    selectedMapCell: null,
    solveProgressLog: [],
    solveTimerElapsedMs: 0,
    solveTimerFrozen: true,
    solveTimerHandle: 0,
    solveTimerStartedAt: 0
  };
}

function createTerminalPayload() {
  return {
    ok: true,
    requestId: "completed-status-smoke",
    optimizer: "auto",
    jobStatus: "completed",
    cancelRequested: false,
    elapsedMs: 240,
    solution: {
      roads: ["0,0"],
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [{ r: 0, c: 1, rows: 1, cols: 1 }],
      residentialTypeIndices: [0],
      populations: [40],
      totalPopulation: 40,
      optimizer: "auto",
      activeOptimizer: "greedy"
    },
    validation: {
      valid: true,
      errors: [],
      recomputedPopulations: [40],
      recomputedTotalPopulation: 40,
      populationValidation: {
        mode: "reported-invariants",
        populationSource: "solver-reported",
        totalPopulationSource: "reported-population-sum",
        reportedTotalPopulation: 40,
        reportedPopulationSum: 40
      }
    },
    stats: {
      optimizer: "auto",
      activeOptimizer: "greedy",
      cpSatStatus: null,
      stoppedByUser: false,
      totalPopulation: 40,
      roadCount: 1,
      serviceCount: 0,
      residentialCount: 1
    }
  };
}

function createRunningPayload() {
  return {
    ok: true,
    requestId: "completed-status-smoke",
    optimizer: "auto",
    jobStatus: "running",
    liveSnapshot: true,
    hasFeasibleSolution: true,
    bestTotalPopulation: 20,
    activeOptimizer: "greedy",
    solution: {
      roads: ["0,0"],
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [{ r: 0, c: 1, rows: 1, cols: 1 }],
      residentialTypeIndices: [0],
      populations: [20],
      totalPopulation: 20,
      optimizer: "auto",
      activeOptimizer: "greedy"
    },
    stats: {
      optimizer: "auto",
      activeOptimizer: "greedy",
      totalPopulation: 20,
      progressSummary: { bestScore: 20 }
    }
  };
}

function createJsonResponse(payload, options = {}) {
  const { delayMs = 0, ok = true, status = 200 } = options;
  return {
    ok,
    status,
    async json() {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return payload;
    }
  };
}

async function testSolveRuntimeAcceptsDelayedCompletedStatusPayload() {
  const statusUrls = [];
  const statusMessages = [];
  let renderCount = 0;
  let statusPolls = 0;

  const solveRuntime = loadPlannerSolveRuntimeModule(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText === "/api/solve/start") {
      const body = JSON.parse(String(options.body));
      assert.equal(body.requestId, "completed-status-smoke");
      return createJsonResponse({
        ok: true,
        requestId: body.requestId,
        optimizer: "auto",
        jobStatus: "running"
      });
    }

    if (urlText.startsWith("/api/solve/status")) {
      statusUrls.push(urlText);
      statusPolls += 1;
      return statusPolls === 1
        ? createJsonResponse(createRunningPayload())
        : createJsonResponse(createTerminalPayload(), { delayMs: 5 });
    }

    throw new Error(`Unexpected fetch URL ${urlText}`);
  });
  const elements = {
    resultElapsed: createFakeDomElement(),
    solveStatus: createFakeDomElement(),
    solveTimer: createFakeDomElement()
  };
  const state = createSolveRuntimeState();
  const controller = solveRuntime.createSolveRuntime({
    state,
    elements,
    constants: {
      LIVE_SNAPSHOT_REFRESH_INTERVAL_MS: 1000,
      SOLVE_STATUS_POLL_INTERVAL_MS: 1
    },
    helpers: {
      createSolveRequestId: () => "completed-status-smoke",
      delay: async () => {},
      formatElapsedTime: (ms) => `${ms}ms`,
      normalizeElapsedMs: (ms) => Math.max(0, Math.round(Number(ms) || 0))
    },
    callbacks: {
      buildSolveRequest: () => ({
        grid: [[1, 1]],
        params: {
          optimizer: "auto",
          greedy: {},
          cpSat: {},
          lns: {}
        }
      }),
      clearExpansionAdvice() {},
      ensureCpSatRandomSeed: () => 7,
      getDisplayedLayoutCheckpoint: () => null,
      getOptimizerLabel: (optimizer) => (optimizer === "auto" ? "Auto" : optimizer === "greedy" ? "Greedy" : optimizer),
      renderResults: () => {
        renderCount += 1;
      },
      setSolveState: (message) => {
        if (message !== null) {
          elements.solveStatus.textContent = message;
        }
        statusMessages.push(elements.solveStatus.textContent);
      }
    }
  });

  await controller.runSolve();

  assert.equal(state.isSolving, false);
  assert.equal(state.isStopping, false);
  assert.equal(state.activeSolveRequestId, "");
  assert.equal(state.resultError, "");
  assert.equal(state.resultIsLiveSnapshot, false);
  assert.equal(state.result.jobStatus, "completed");
  assert.equal(state.result.validation.populationValidation.mode, "reported-invariants");
  assert.equal(state.result.stats.totalPopulation, 40);
  assert.equal(renderCount >= 2, true);
  assert.equal(statusUrls[0].includes("includeSnapshot=1"), true);
  assert.equal(statusUrls.length, 2);
  assert.equal(statusMessages.includes("Solver run failed."), false);
}

async function runTests() {
  await testSolveRuntimeAcceptsDelayedCompletedStatusPayload();
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
