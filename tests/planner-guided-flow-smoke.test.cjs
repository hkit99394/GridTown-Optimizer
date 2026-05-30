const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:net");

const {
  createFakeDomElement,
  loadPlannerDefaultsModule,
  loadPlannerExpansionModule,
  loadPlannerOnboardingModule,
  loadPlannerPersistenceModule,
  loadPlannerRequestBuilderModule,
  loadPlannerSamplePresetsModule,
  loadPlannerSharedModule
} = require("./helpers/plannerBrowserModules.cjs");

const HOST = "127.0.0.1";
const REQUEST_TIMEOUT_MS = 8000;
const SOLVE_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeLocalStorage() {
  const storage = new Map();
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };
}

function createEventTargetElement(overrides = {}) {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.push({ listener, type });
    },
    ...createFakeDomElement(overrides)
  };
}

async function findOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return address.port;
}

function startPlannerServer(port) {
  const logs = [];
  const child = spawn(process.execPath, ["dist/webServer.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      PROGRESS_LOG_INTERVAL_SECONDS: "1",
      PROGRESS_LOG_POLL_INTERVAL_SECONDS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  return { child, logs };
}

async function stopPlannerServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 1500);
  try {
    await once(child, "exit");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const bodyText = await response.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${bodyText}`);
  return { payload, statusCode: response.status };
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(baseUrl, "/api/health");
      assert.equal(health.payload.ok, true);
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError ?? new Error("Planner server did not become healthy.");
}

async function runSolve(baseUrl, request, requestId, clientRole = "guided-planner-smoke") {
  const start = await fetchJson(baseUrl, "/api/solve/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...request,
      requestId,
      clientRole
    })
  });
  assert.equal(start.statusCode, 202);
  assert.equal(start.payload.jobStatus, "running");

  const startedAt = Date.now();
  while (Date.now() - startedAt < SOLVE_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const status = await fetchJson(baseUrl, `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`);
    if (status.payload.jobStatus === "completed") return status.payload;
    assert.notEqual(status.payload.jobStatus, "failed", JSON.stringify(status.payload, null, 2));
  }

  throw new Error(`Solve ${requestId} did not complete within ${SOLVE_TIMEOUT_MS}ms.`);
}

function createPlannerState() {
  const defaults = loadPlannerDefaultsModule();
  return {
    grid: [],
    advancedMode: false,
    optimizer: "greedy",
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
      randomSeed: "",
      timeLimitSeconds: "",
      profile: false,
      densityTieBreaker: false,
      densityTieBreakerTolerancePercent: "2",
      restarts: 20,
      serviceRefineIterations: 4,
      serviceRefineCandidateLimit: 60,
      exhaustiveServiceSearch: true,
      diagnostics: false,
      serviceExactPoolLimit: 22,
      serviceExactMaxCombinations: 12000
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      useDisplayedHint: false,
      portfolio: {
        enabled: false,
        workerCount: 3,
        randomSeeds: "",
        perWorkerTimeLimitSeconds: "",
        perWorkerNumWorkers: 1,
        randomizeSearch: true
      }
    },
    lns: {
      iterations: 12,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 6,
      neighborhoodCols: 8,
      repairTimeLimitSeconds: 5,
      useDisplayedSeed: false
    },
    auto: {
      wallClockLimitSeconds: "1",
      continueAfterPopulationCapSeconds: ""
    },
    isSolving: false,
    isStopping: false,
    activeSolveRequestId: "",
    solveTimerElapsedMs: 0,
    result: null,
    resultContext: null,
    resultElapsedMs: 0,
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      isApplying: false,
      edited: false,
      pendingValidation: false,
      status: ""
    },
    expansionAdvice: {
      isRunning: false,
      nextServiceText: "",
      nextResidentialText: "",
      status: "",
      result: null,
      error: ""
    },
    defaults
  };
}

function createRequestBuilder(state, shared) {
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  return plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements: {
      cpSatRandomSeed: createFakeDomElement(),
      cpSatHintStatus: createFakeDomElement(),
      lnsSeedStatus: createFakeDomElement(),
      layoutStorageName: createFakeDomElement({ value: "Guided flow smoke" }),
      payloadPreview: createFakeDomElement()
    },
    helpers: {
      buildCpSatContinuationModelInput: shared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: shared.buildCpSatWarmStartCheckpoint,
      clampInteger: shared.clampInteger,
      cloneGrid: shared.cloneGrid,
      cloneJson: shared.cloneJson,
      computeCpSatModelFingerprint: shared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: shared.getSavedLayoutElapsedMs,
      readOptionalInteger: shared.readOptionalInteger,
      parseResidentialCatalogEntry: shared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: shared.parseServiceCatalogEntry
    }
  });
}

function loadOpenSmallSample(state, shared) {
  const defaults = state.defaults;
  const sampleProblemPresets = loadPlannerSamplePresetsModule().createSampleProblemPresets({
    sampleGrid: defaults.SAMPLE_GRID,
    defaultServiceTypes: defaults.DEFAULT_SERVICE_TYPES,
    defaultResidentialTypes: defaults.DEFAULT_RESIDENTIAL_TYPES
  });
  const onboarding = loadPlannerOnboardingModule({
    context: {
      fetch: async () => ({
        async json() {
          return { ok: true, cpSat: { ready: false, message: "CP-SAT setup is optional for this smoke." } };
        }
      })
    },
    window: {
      document: {
        body: {
          classList: {
            toggle() {}
          }
        }
      }
    }
  });
  const elements = {
    advancedModeToggle: createEventTargetElement(),
    cpSatReadinessStatus: createFakeDomElement(),
    runtimePresetStatus: createFakeDomElement(),
    sampleProblemButtons: createEventTargetElement()
  };
  const controller = onboarding.createPlannerOnboardingController({
    state,
    elements,
    sampleProblemPresets,
    helpers: {
      cloneGrid: shared.cloneGrid
    },
    callbacks: {
      setSolveState() {},
      syncPlannerFromState() {}
    }
  });

  controller.loadSampleProblem("open-small");
  state.auto.wallClockLimitSeconds = "1";
  state.cpSat.useDisplayedHint = false;
  state.lns.useDisplayedSeed = false;

  assert.equal(state.optimizer, "auto");
  assert.equal(state.grid.length, 8);
  assert.equal(elements.runtimePresetStatus.textContent, 'Loaded "Open 8 x 8" with Auto selected.');
}

function createPersistenceController(state, shared, localStorage) {
  const urlApi = {
    createObjectURL(blob) {
      assert.equal(blob instanceof Blob, true);
      return "blob:guided-flow-smoke";
    },
    revokeObjectURL() {}
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage, { URL: urlApi });
  const elements = {
    savedLayoutsSelect: createFakeDomElement(),
    layoutStorageName: createFakeDomElement({ value: "Guided flow smoke" }),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement()
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state,
    elements,
    constants: {
      CONFIG_STORAGE_KEY: "configs",
      LAYOUT_STORAGE_KEY: "layouts",
      defaultResidentialTypes: state.defaults.DEFAULT_RESIDENTIAL_TYPES,
      defaultServiceTypes: state.defaults.DEFAULT_SERVICE_TYPES,
      sampleGrid: state.defaults.SAMPLE_GRID
    },
    helpers: {
      buildCpSatWarmStartCheckpoint: shared.buildCpSatWarmStartCheckpoint,
      cloneGrid: shared.cloneGrid,
      cloneJson: shared.cloneJson,
      createSavedEntryId() {
        return "guided-flow-layout";
      },
      formatElapsedTime: shared.formatElapsedTime,
      formatSavedTimestamp: shared.formatSavedTimestamp,
      getSavedLayoutElapsedMs: shared.getSavedLayoutElapsedMs,
      getSavedLayoutPopulation: shared.getSavedLayoutPopulation,
      isGridLike: shared.isGridLike,
      normalizeElapsedMs: shared.normalizeElapsedMs,
      normalizeOptimizer: shared.normalizeOptimizer
    },
    callbacks: {
      applySolveRequestToPlanner() {},
      clearExpansionAdvice() {},
      clearRenderedResultState() {},
      renderResults() {},
      resetSolveTimer() {},
      setResultElapsed() {},
      setSolveState() {},
      syncPlannerFromState() {}
    }
  });
  return { elements, persistence };
}

async function compareNextExpansion(baseUrl, state, requestBuilder, shared) {
  const plannerExpansion = loadPlannerExpansionModule((url, options = {}) =>
    fetch(`${baseUrl}${url}`, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  );
  const elements = {
    expansionAdviceStatus: createFakeDomElement(),
    expansionAdviceMetrics: createFakeDomElement(),
    expansionAdviceWinner: createFakeDomElement(),
    expansionAdviceBaseline: createFakeDomElement(),
    expansionAdviceServiceOutcome: createFakeDomElement(),
    expansionAdviceResidentialOutcome: createFakeDomElement()
  };
  state.expansionAdvice.nextServiceText = "Pocket Clinic, 25, 1x1, 3x3";
  state.expansionAdvice.nextResidentialText = "Micro Homes, 8/12, 1x1";
  const controller = plannerExpansion.createExpansionAdviceController({
    state,
    elements,
    constants: {
      COMPARISON_PROGRESS_HINT_INTERVAL_MS: 1,
      SOLVE_STATUS_POLL_INTERVAL_MS: POLL_INTERVAL_MS
    },
    helpers: {
      buildCpSatContinuationModelInput: shared.buildCpSatContinuationModelInput,
      cloneJson: shared.cloneJson,
      computeCpSatModelFingerprint: shared.computeCpSatModelFingerprint,
      createSolveRequestId() {
        return `guided-flow-${Date.now()}`;
      },
      delay: sleep,
      parseResidentialCatalogEntry: shared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: shared.parseServiceCatalogEntry
    },
    callbacks: {
      buildSolveRequest(options) {
        return requestBuilder.buildSolveRequest(options);
      },
      getDisplayedLayoutCheckpoint() {
        return null;
      },
      getDisplayedLayoutSourceLabel() {
        return "Guided flow smoke";
      },
      getOptimizerLabel(optimizer) {
        return optimizer === "auto" ? "Auto" : String(optimizer);
      },
      syncActionAvailability() {}
    }
  });

  await controller.compareExpansionOptions();

  assert.equal(state.expansionAdvice.error, "");
  assert.equal(elements.expansionAdviceMetrics.hidden, false);
  assert.match(elements.expansionAdviceStatus.textContent, /Baseline|baseline|expansion|layout|Add|Hold|Both/);
  assert.notEqual(elements.expansionAdviceWinner.textContent, "");
  assert.notEqual(elements.expansionAdviceServiceOutcome.textContent, "");
  assert.notEqual(elements.expansionAdviceResidentialOutcome.textContent, "");
}

async function runGuidedFlowSmoke() {
  const port = await findOpenPort();
  const baseUrl = `http://${HOST}:${port}`;
  const { child, logs } = startPlannerServer(port);
  const shared = loadPlannerSharedModule();
  const state = createPlannerState();
  const localStorage = createFakeLocalStorage();

  try {
    await waitForServer(baseUrl);
    const root = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const rootHtml = await root.text();
    assert.match(rootHtml, /Input grid\/catalog/);
    assert.match(rootHtml, /Run recommended Auto/);
    assert.match(rootHtml, /Save\/export result/);
    assert.match(rootHtml, /Compare next expansion/);

    loadOpenSmallSample(state, shared);
    const requestBuilder = createRequestBuilder(state, shared);
    const solveRequest = requestBuilder.buildSolveRequest({
      hintMismatch: "ignore",
      includeWarmStartHint: false,
      includeLnsSeed: false
    });

    const result = await runSolve(baseUrl, solveRequest, `guided-flow-main-${Date.now()}`);
    assert.equal(result.validation.valid, true, result.validation.errors.join("\n"));
    assert.equal(result.validation.populationValidation.mode, "full-recompute");
    assert.equal(result.stats.optimizer, "auto");
    assert.equal(result.stats.totalPopulation > 0, true);

    const evaluated = await fetchJson(baseUrl, "/api/layout/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grid: solveRequest.grid,
        params: solveRequest.params,
        solution: result.solution
      })
    });
    assert.equal(evaluated.payload.validation.valid, true, evaluated.payload.validation.errors.join("\n"));
    assert.equal(evaluated.payload.stats.totalPopulation, result.stats.totalPopulation);

    state.result = result;
    state.resultContext = solveRequest;
    state.resultElapsedMs = result.elapsedMs ?? 0;
    const { elements: persistenceElements, persistence } = createPersistenceController(state, shared, localStorage);
    persistence.saveCurrentLayout();
    assert.match(persistenceElements.layoutStorageStatus.textContent, /Saved layout "Guided flow smoke"/);
    const savedLayouts = JSON.parse(localStorage.getItem("layouts") || "[]");
    assert.equal(savedLayouts.length, 1);
    assert.equal(savedLayouts[0].result.validation.valid, true);

    const exportPayload = persistence.exportSavedLayouts();
    assert.equal(exportPayload.kind, "city-builder.planner-layouts.v1");
    assert.equal(exportPayload.layouts.length, 1);
    assert.match(persistenceElements.layoutStorageStatus.textContent, /Exported 1 saved layout/);

    await compareNextExpansion(baseUrl, state, requestBuilder, shared);

    console.log(
      JSON.stringify({
        ok: true,
        optimizer: result.stats.optimizer,
        totalPopulation: result.stats.totalPopulation,
        savedLayouts: savedLayouts.length,
        expansionWinner: state.expansionAdvice.result?.winner ?? null
      })
    );
  } catch (error) {
    const serverLog = logs.join("").trim();
    if (serverLog) console.error(serverLog);
    throw error;
  } finally {
    await stopPlannerServer(child);
  }
}

runGuidedFlowSmoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
