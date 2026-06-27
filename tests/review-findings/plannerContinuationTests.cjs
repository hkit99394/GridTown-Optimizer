const {
  assert,
  solve,
  buildManualLayoutResponse,
  buildSolveResponse,
  createFakeDomElement,
  loadPlannerExpansionModule,
  loadPlannerPersistenceModule,
  loadPlannerRequestBuilderModule,
  loadPlannerSharedModule
} = require("./helpers.cjs");

function createMemoryLocalStorage() {
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

function testPlannerRequestBuilderRebuildsStaleSavedCheckpoint() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {}
  };
  const validManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  });
  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validManualResult, { grid, params }, 0);
  const staleCheckpoint = plannerShared.cloneJson(checkpoint);
  staleCheckpoint.compatibility.modelFingerprint = "fnv1a:00000000";
  staleCheckpoint.compatibility.candidateUniverseHash = "fnv1a:00000000";

  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid,
      serviceTypes: [],
      residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
      availableBuildings: {
        services: "0",
        residentials: "1"
      },
      greedy: {
        localSearch: false,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1
      },
      cpSat: {
        timeLimitSeconds: "",
        noImprovementTimeoutSeconds: "",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
        useDisplayedHint: false
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        repairTimeLimitSeconds: 1,
        useDisplayedSeed: false
      },
      result: null,
      resultContext: null,
      resultElapsedMs: 0
    },
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" }
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const savedCheckpoint = controller.getSavedLayoutCheckpoint({
    id: "stale-layout",
    name: "Stale Layout",
    savedAt: "2026-04-18T09:00:00.000Z",
    elapsedMs: 0,
    result: validManualResult,
    resultContext: { grid, params },
    continueCpSat: staleCheckpoint
  });

  assert.equal(savedCheckpoint.compatibility.modelFingerprint, checkpoint.compatibility.modelFingerprint);
  assert.equal(savedCheckpoint.compatibility.candidateUniverseHash, checkpoint.compatibility.candidateUniverseHash);
}

function testPlannerRequestBuilderSkipsInvalidDisplayedLayoutContinuation() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {}
  };
  const invalidManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,2", "1,2"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
      { r: 2, c: 0, rows: 2, cols: 2 }
    ],
    residentialTypeIndices: [0, 0],
    populations: [10, 10],
    totalPopulation: 20
  });
  const state = {
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true
    },
    result: invalidManualResult,
    resultContext: { grid, params },
    resultElapsedMs: 0
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" }
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements,
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  controller.renderCpSatHintStatus();
  controller.renderLnsSeedStatus();

  assert.match(elements.cpSatHintStatus.textContent, /Only valid layouts can be reused as a CP-SAT hint or LNS seed/);
  assert.match(elements.lnsSeedStatus.textContent, /Only valid layouts can be reused as a CP-SAT hint or LNS seed/);
  assert.equal(controller.getDisplayedLayoutCheckpoint(), null);

  const cpSatRequest = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(cpSatRequest.params.cpSat.warmStartHint, undefined);

  state.optimizer = "lns";
  const lnsRequest = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(lnsRequest.params.lns.seedHint, undefined);
}

function testPlannerRequestBuilderSkipsLegacyDisplayedLayoutContinuationWithoutValidation() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {}
  };
  const validManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  });
  const legacySavedResult = {
    ...validManualResult
  };
  delete legacySavedResult.validation;

  const state = {
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true
    },
    result: legacySavedResult,
    resultContext: { grid, params },
    resultElapsedMs: 0
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" }
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements,
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  controller.renderCpSatHintStatus();
  controller.renderLnsSeedStatus();

  assert.match(elements.cpSatHintStatus.textContent, /missing validation metadata/);
  assert.match(elements.lnsSeedStatus.textContent, /missing validation metadata/);
  assert.equal(controller.getDisplayedLayoutCheckpoint(), null);

  const cpSatRequest = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(cpSatRequest.params.cpSat.warmStartHint, undefined);

  state.optimizer = "lns";
  const lnsRequest = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(lnsRequest.params.lns.seedHint, undefined);
}

function testPlannerPersistenceBlocksImportedValidLayoutContinuationUntilRevalidated() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const residentialType = { name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 };
  const params = {
    optimizer: "cp-sat",
    serviceTypes: [],
    residentialTypes: [residentialType],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {}
  };
  const validManualSolution = {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  };
  const revalidatedResult = buildManualLayoutResponse(grid, params, validManualSolution);
  const tamperedImportedResult = plannerShared.cloneJson(revalidatedResult);
  tamperedImportedResult.solution.totalPopulation = 999;
  tamperedImportedResult.validation.recomputedTotalPopulation = 999;
  tamperedImportedResult.stats.totalPopulation = 999;
  const staleImportedCheckpoint = plannerShared.buildCpSatWarmStartCheckpoint(
    tamperedImportedResult,
    { grid, params },
    0
  );

  const state = {
    optimizer: "cp-sat",
    isSolving: false,
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog(residentialType)],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0,
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      edited: false,
      pendingValidation: false,
      isApplying: false,
      status: ""
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    auto: { wallClockLimitSeconds: "" }
  };
  const localStorage = createMemoryLocalStorage();
  const persistence = loadPlannerPersistenceModule(localStorage).createPlannerPersistence({
    state,
    elements: {
      savedLayoutsSelect: createFakeDomElement(),
      layoutStorageName: createFakeDomElement(),
      layoutStorageStatus: createFakeDomElement(),
      savedConfigsSelect: createFakeDomElement(),
      configStorageName: createFakeDomElement(),
      configStorageStatus: createFakeDomElement()
    },
    constants: {
      CONFIG_STORAGE_KEY: "configs",
      LAYOUT_STORAGE_KEY: "layouts",
      defaultResidentialTypes: [],
      defaultServiceTypes: [],
      sampleGrid: [[1]]
    },
    helpers: {
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      createSavedEntryId() {
        return "imported-layout";
      },
      formatElapsedTime: plannerShared.formatElapsedTime,
      formatSavedTimestamp: plannerShared.formatSavedTimestamp,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      isGridLike: plannerShared.isGridLike,
      normalizeElapsedMs: plannerShared.normalizeElapsedMs,
      normalizeOptimizer: plannerShared.normalizeOptimizer
    },
    callbacks: {
      applySolveRequestToPlanner() {},
      clearExpansionAdvice() {},
      clearRenderedResultState() {},
      renderResults() {},
      resetSolveTimer() {},
      setResultElapsed(value) {
        state.resultElapsedMs = value;
      },
      setSolveState() {},
      syncPlannerFromState() {}
    }
  });
  const requestBuilderController = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements: {
      cpSatRandomSeed: createFakeDomElement(),
      cpSatHintStatus: createFakeDomElement(),
      lnsSeedStatus: createFakeDomElement(),
      payloadPreview: createFakeDomElement(),
      layoutStorageName: createFakeDomElement({ value: "Imported tampered layout" })
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const summary = persistence.importSavedLayoutsFromText(
    JSON.stringify({
      layouts: [
        {
          name: "Imported tampered layout",
          result: tamperedImportedResult,
          resultContext: { grid, params },
          continueCpSat: staleImportedCheckpoint
        }
      ]
    })
  );
  assert.equal(summary?.selectedId, "imported-layout");

  const importedEntry = JSON.parse(localStorage.getItem("layouts"))[0];
  assert.equal(importedEntry.result.validation.valid, false);
  assert.equal(importedEntry.layoutEditorPendingValidation, true);
  assert.equal(importedEntry.continueCpSat, undefined);

  persistence.loadSelectedLayout();

  assert.equal(state.layoutEditor.pendingValidation, true);
  assert.equal(state.result.validation.valid, false);
  const importedRequest = requestBuilderController.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(importedRequest.params.cpSat.warmStartHint, undefined);

  const revalidatedContext = requestBuilderController.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  state.resultContext = revalidatedContext;
  state.result = buildManualLayoutResponse(grid, revalidatedContext.params, validManualSolution);
  state.layoutEditor.pendingValidation = false;
  const revalidatedCpSatRequest = requestBuilderController.buildSolveRequest({ hintMismatch: "ignore" });
  assert.ok(revalidatedCpSatRequest.params.cpSat.warmStartHint);

  state.optimizer = "lns";
  const revalidatedLnsRequest = requestBuilderController.buildSolveRequest({ hintMismatch: "ignore" });
  assert.ok(revalidatedLnsRequest.params.lns.seedHint);
}

function testPlannerRequestBuilderIncludesHintAndSeedForAuto() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "auto",
    serviceTypes: [],
    residentialTypes: [{ name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 1 },
    cpSat: {},
    lns: {}
  };
  const validResult = buildSolveResponse(
    grid,
    { ...params, optimizer: "greedy" },
    solve(grid, { ...params, optimizer: "greedy" })
  );

  const state = {
    optimizer: "auto",
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "1",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true
    },
    result: validResult,
    resultContext: { grid, params },
    resultElapsedMs: 0
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" }
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements,
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const request = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(request.params.optimizer, "auto");
  assert.ok(request.params.cpSat.warmStartHint);
  assert.ok(request.params.lns.seedHint);
  assert.equal(request.params.cpSat.warmStartHint.objectiveLowerBound, 10);
  assert.equal(request.params.cpSat.warmStartHint.preferStrictImprove, false);
  assert.equal(request.params.cpSat.warmStartHint.repairHint, true);
  assert.equal(request.params.cpSat.warmStartHint.fixVariablesToHintedValue, false);
  assert.equal(request.params.cpSat.warmStartHint.solution, undefined);
  assert.equal(request.params.lns.seedHint.objectiveLowerBound, 10);
  assert.equal(request.params.lns.seedHint.preferStrictImprove, false);
  assert.equal(request.params.lns.seedHint.repairHint, true);
  assert.equal(request.params.lns.seedHint.fixVariablesToHintedValue, false);
  assert.ok(request.params.lns.seedHint.solution);

  state.availableBuildings.residentials = "2";
  const staleAutoRequest = controller.buildSolveRequest();
  assert.equal(staleAutoRequest.params.optimizer, "auto");
  assert.equal(staleAutoRequest.params.cpSat, undefined);
  assert.equal(staleAutoRequest.params.lns, undefined);
}

async function testPlannerExpansionOmitsStaleComparisonHint() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    serviceTypes: [],
    residentialTypes: [{ name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    cpSat: {},
    lns: {}
  };
  const validResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  });
  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validResult, { grid, params }, 0);
  let capturedStartRequest = null;
  const plannerExpansion = loadPlannerExpansionModule(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText === "/api/solve/start") {
      capturedStartRequest = JSON.parse(String(options.body));
      return {
        ok: true,
        async json() {
          return { ok: true, requestId: capturedStartRequest.requestId };
        }
      };
    }
    if (urlText.startsWith("/api/solve/status")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            jobStatus: "completed",
            stats: { totalPopulation: 12 },
            solution: { totalPopulation: 12 }
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL ${urlText}`);
  });
  const state = {
    isSolving: false,
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog(params.residentialTypes[0])],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {},
    cpSat: {
      useDisplayedHint: true
    },
    lns: {
      useDisplayedSeed: true
    },
    result: validResult,
    resultContext: { grid, params },
    expansionAdvice: {
      nextServiceText: "Clinic, 5, 1x1, 3x3",
      nextResidentialText: "",
      isRunning: false,
      status: "",
      result: null,
      error: ""
    }
  };
  const controller = plannerExpansion.createExpansionAdviceController({
    state,
    elements: {
      expansionAdviceStatus: createFakeDomElement(),
      expansionAdviceMetrics: createFakeDomElement(),
      expansionAdviceWinner: createFakeDomElement(),
      expansionAdviceBaseline: createFakeDomElement(),
      expansionAdviceServiceOutcome: createFakeDomElement(),
      expansionAdviceResidentialOutcome: createFakeDomElement()
    },
    constants: {
      COMPARISON_PROGRESS_HINT_INTERVAL_MS: 1,
      SOLVE_STATUS_POLL_INTERVAL_MS: 1
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      createSolveRequestId() {
        return "expansion-test";
      },
      async delay() {},
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    },
    callbacks: {
      buildSolveRequest() {
        return {
          grid: plannerShared.cloneGrid(grid),
          params: {
            optimizer: state.optimizer,
            greedy: {},
            cpSat: {},
            lns: {}
          }
        };
      },
      getDisplayedLayoutCheckpoint() {
        return checkpoint;
      },
      getDisplayedLayoutSourceLabel() {
        return "Displayed layout";
      },
      getOptimizerLabel() {
        return "CP-SAT";
      },
      syncActionAvailability() {}
    }
  });

  await controller.compareExpansionOptions();

  assert.ok(capturedStartRequest);
  assert.equal(capturedStartRequest.clientRole, "expansion-comparison");
  assert.equal(capturedStartRequest.params.cpSat.warmStartHint, undefined);
}

async function testPlannerExpansionGivesRankedNextAdditionGuidance() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const requestPopulationById = new Map();
  const comparisonPopulations = [130, 115];
  const plannerExpansion = loadPlannerExpansionModule(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText === "/api/solve/start") {
      const body = JSON.parse(String(options.body));
      assert.equal(body.clientRole, "expansion-comparison");
      requestPopulationById.set(body.requestId, comparisonPopulations.shift());
      return {
        ok: true,
        async json() {
          return { ok: true, requestId: body.requestId };
        }
      };
    }
    if (urlText.startsWith("/api/solve/status")) {
      const requestId = new URLSearchParams(urlText.split("?")[1] ?? "").get("requestId");
      const totalPopulation = requestPopulationById.get(requestId) ?? 0;
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            jobStatus: "completed",
            stats: { totalPopulation },
            solution: { totalPopulation }
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL ${urlText}`);
  });
  const elements = {
    expansionAdviceStatus: createFakeDomElement(),
    expansionAdviceMetrics: createFakeDomElement(),
    expansionAdviceWinner: createFakeDomElement(),
    expansionAdviceBaseline: createFakeDomElement(),
    expansionAdviceServiceOutcome: createFakeDomElement(),
    expansionAdviceResidentialOutcome: createFakeDomElement()
  };
  const state = {
    isSolving: false,
    optimizer: "auto",
    grid,
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {},
    cpSat: {
      useDisplayedHint: false
    },
    lns: {
      useDisplayedSeed: false
    },
    result: {
      stats: {
        totalPopulation: 100,
        serviceCount: 0,
        residentialCount: 1
      },
      solution: {
        totalPopulation: 100,
        services: [],
        residentials: [{}]
      }
    },
    resultContext: {
      grid,
      params: {
        optimizer: "auto",
        serviceTypes: [],
        residentialTypes: [],
        availableBuildings: { services: 0, residentials: 1 }
      }
    },
    expansionAdvice: {
      nextServiceText: "Clinic, 30, 1x1, 3x3",
      nextResidentialText: "Homes, 10/25, 1x1",
      isRunning: false,
      status: "",
      result: null,
      error: ""
    }
  };
  let requestIdCounter = 0;
  const controller = plannerExpansion.createExpansionAdviceController({
    state,
    elements,
    constants: {
      COMPARISON_PROGRESS_HINT_INTERVAL_MS: 1,
      SOLVE_STATUS_POLL_INTERVAL_MS: 1
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      createSolveRequestId() {
        requestIdCounter += 1;
        return `expansion-guidance-${requestIdCounter}`;
      },
      async delay() {},
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    },
    callbacks: {
      buildSolveRequest() {
        return {
          grid: plannerShared.cloneGrid(grid),
          params: {
            optimizer: state.optimizer,
            greedy: {},
            cpSat: {},
            lns: {}
          }
        };
      },
      getDisplayedLayoutCheckpoint() {
        return null;
      },
      getDisplayedLayoutSourceLabel() {
        return "Displayed layout";
      },
      getOptimizerLabel(value) {
        return value === "auto" ? "Auto" : String(value);
      },
      syncActionAvailability() {}
    }
  });

  await controller.compareExpansionOptions();

  assert.equal(elements.expansionAdviceWinner.textContent, "Add Clinic");
  assert.match(elements.expansionAdviceStatus.textContent, /stronger next expansion/);
  assert.match(elements.expansionAdviceStatus.textContent, /population margin over the residential option/);
  assert.equal(elements.expansionAdviceServiceOutcome.textContent, "130 (+30)");
  assert.equal(elements.expansionAdviceResidentialOutcome.textContent, "115 (+15)");
}

function testPlannerRequestBuilderTreatsBlankAutoCapAsUnlimited() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];

  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: "",
      continueAfterPopulationCapSeconds: ""
    },
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "1",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      searchStrategy: "incumbent",
      eliteArchiveSize: 4,
      multiStartSeeds: 4,
      useDisplayedSeed: false
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" }
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements,
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const unlimitedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(unlimitedRequest.params.auto, undefined);

  state.auto.continueAfterPopulationCapSeconds = "300";
  const capGraceRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(capGraceRequest.params.auto.wallClockLimitSeconds, undefined);
  assert.equal(capGraceRequest.params.auto.continueAfterPopulationCapSeconds, 300);

  state.auto.wallClockLimitSeconds = "90";
  const cappedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(cappedRequest.params.auto.wallClockLimitSeconds, 90);
  assert.equal(cappedRequest.params.auto.continueAfterPopulationCapSeconds, 300);
}

function testPlannerRequestBuilderLeavesStandaloneGreedyTimeLimitUnset() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "greedy",
    auto: { wallClockLimitSeconds: "" },
    grid: [
      [1, 1],
      [1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      timeLimitSeconds: "",
      profile: false,
      densityTieBreaker: false,
      densityTieBreakerTolerancePercent: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      diagnostics: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 1,
      logSearchProgress: false,
      useDisplayedHint: false
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 1,
      neighborhoodCols: 1,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: false
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" }
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const uncappedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(uncappedRequest.params.greedy.timeLimitSeconds, undefined);

  state.greedy.timeLimitSeconds = "7";
  const explicitCappedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(explicitCappedRequest.params.greedy.timeLimitSeconds, 7);
}

function testPlannerRequestBuilderKeepsAutoPayloadMinimal() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: "",
      continueAfterPopulationCapSeconds: ""
    },
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "1",
      residentials: "1"
    },
    greedy: {
      localSearch: true,
      randomSeed: "17",
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: "2.5",
      restarts: 20,
      serviceRefineIterations: 4,
      serviceRefineCandidateLimit: 60,
      exhaustiveServiceSearch: true,
      serviceExactPoolLimit: 22,
      serviceExactMaxCombinations: 12000
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: false
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" }
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements,
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const request = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(request.params.optimizer, "auto");
  assert.equal(request.params.greedy, undefined);
  assert.equal(request.params.cpSat, undefined);
  assert.equal(request.params.lns, undefined);

  state.lns.searchStrategy = "elite-archive";
  state.lns.eliteArchiveSize = "5";
  state.lns.multiStartSeeds = "7";
  const autoEliteArchiveRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(autoEliteArchiveRequest.params.optimizer, "auto");
  assert.equal(autoEliteArchiveRequest.params.greedy, undefined);
  assert.equal(autoEliteArchiveRequest.params.cpSat, undefined);
  assert.equal(autoEliteArchiveRequest.params.lns.searchStrategy, "elite-archive");
  assert.equal(autoEliteArchiveRequest.params.lns.eliteArchiveSize, 5);
  assert.equal(autoEliteArchiveRequest.params.lns.multiStartSeeds, 7);
  state.lns.searchStrategy = "incumbent";
  state.lns.eliteArchiveSize = 4;
  state.lns.multiStartSeeds = 4;

  state.optimizer = "legacy-or-missing";
  const normalizedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(normalizedRequest.params.optimizer, "auto");
  assert.equal(normalizedRequest.params.greedy, undefined);
  assert.equal(normalizedRequest.params.cpSat, undefined);
  assert.equal(normalizedRequest.params.lns, undefined);

  state.optimizer = "greedy";
  const greedyRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(greedyRequest.params.greedy.localSearch, true);
  assert.equal(greedyRequest.params.greedy.randomSeed, 17);
  assert.equal(greedyRequest.params.greedy.densityTieBreaker, true);
  assert.equal(greedyRequest.params.greedy.serviceExactMaxCombinations, 12000);
}

function testPlannerRequestBuilderKeepsPortfolioStandaloneOnly() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: ""
    },
    grid: [
      [1, 1],
      [1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 })],
    availableBuildings: {
      services: "0",
      residentials: "1"
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "31",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false,
      portfolio: {
        enabled: true,
        workerCount: "3",
        randomSeeds: "31, 32, 33",
        perWorkerTimeLimitSeconds: "",
        perWorkerNumWorkers: "1",
        randomizeSearch: true
      }
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: false
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
    elements: {
      cpSatRandomSeed: createFakeDomElement(),
      cpSatHintStatus: createFakeDomElement(),
      lnsSeedStatus: createFakeDomElement(),
      payloadPreview: createFakeDomElement(),
      layoutStorageName: createFakeDomElement()
    },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint: plannerShared.buildCpSatWarmStartCheckpoint,
      clampInteger: plannerShared.clampInteger,
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      readOptionalInteger: plannerShared.readOptionalInteger,
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    }
  });

  const autoRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(autoRequest.params.cpSat, undefined);

  state.optimizer = "lns";
  const lnsRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(lnsRequest.params.cpSat.portfolio, undefined);

  state.optimizer = "cp-sat";
  const unlimitedCpSatRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(Object.prototype.hasOwnProperty.call(unlimitedCpSatRequest.params.cpSat, "timeLimitSeconds"), false);
  assert.equal(unlimitedCpSatRequest.params.cpSat.portfolio.workerCount, 3);
  assert.deepEqual(Array.from(unlimitedCpSatRequest.params.cpSat.portfolio.randomSeeds), [31, 32, 33]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(unlimitedCpSatRequest.params.cpSat.portfolio, "totalCpuBudgetSeconds"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(unlimitedCpSatRequest.params.cpSat.portfolio, "perWorkerTimeLimitSeconds"),
    false
  );
  assert.equal(unlimitedCpSatRequest.params.cpSat.portfolio.perWorkerNumWorkers, 1);
  assert.equal(unlimitedCpSatRequest.params.cpSat.portfolio.randomizeSearch, true);

  state.cpSat.timeLimitSeconds = "45";
  const cpSatRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(cpSatRequest.params.cpSat.timeLimitSeconds, 45);
  assert.equal(cpSatRequest.params.cpSat.portfolio.workerCount, 3);
  assert.deepEqual(Array.from(cpSatRequest.params.cpSat.portfolio.randomSeeds), [31, 32, 33]);
  assert.equal(cpSatRequest.params.cpSat.portfolio.totalCpuBudgetSeconds, 28800);
  assert.equal(cpSatRequest.params.cpSat.portfolio.perWorkerTimeLimitSeconds, 45);
  assert.equal(cpSatRequest.params.cpSat.portfolio.perWorkerNumWorkers, 1);
  assert.equal(cpSatRequest.params.cpSat.portfolio.randomizeSearch, true);

  state.cpSat.portfolio.randomSeeds = "";
  state.cpSat.portfolio.workerCount = "4";
  state.cpSat.portfolio.perWorkerNumWorkers = "2";
  state.cpSat.portfolio.perWorkerTimeLimitSeconds = "99999";
  const cappedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(cappedRequest.params.cpSat.portfolio.perWorkerTimeLimitSeconds, 3600);
  assert.equal(cappedRequest.params.cpSat.portfolio.perWorkerNumWorkers, 2);

  state.cpSat.portfolio.perWorkerTimeLimitSeconds = "30";
  state.cpSat.portfolio.perWorkerNumWorkers = "1";
  state.cpSat.portfolio.randomSeeds = "1, 2, 1";
  assert.throws(
    () => controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false }),
    /explicit seeds must be unique/
  );

  state.cpSat.portfolio.randomSeeds = "1, 2, 3, 4, 5, 6, 7, 8";
  const maxSeedRequest = controller.buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false
  });
  assert.equal(maxSeedRequest.params.cpSat.portfolio.workerCount, 8);
  assert.deepEqual(Array.from(maxSeedRequest.params.cpSat.portfolio.randomSeeds), [1, 2, 3, 4, 5, 6, 7, 8]);

  state.cpSat.portfolio.randomSeeds = "1, 2, 3, 4, 5, 6, 7, 8, 9";
  assert.throws(
    () => controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false }),
    /supports at most 8 explicit seeds/
  );
}

async function runPlannerContinuationTests() {
  testPlannerRequestBuilderRebuildsStaleSavedCheckpoint();
  testPlannerRequestBuilderSkipsInvalidDisplayedLayoutContinuation();
  testPlannerRequestBuilderSkipsLegacyDisplayedLayoutContinuationWithoutValidation();
  testPlannerPersistenceBlocksImportedValidLayoutContinuationUntilRevalidated();
  testPlannerRequestBuilderIncludesHintAndSeedForAuto();
  await testPlannerExpansionOmitsStaleComparisonHint();
  await testPlannerExpansionGivesRankedNextAdditionGuidance();
  testPlannerRequestBuilderTreatsBlankAutoCapAsUnlimited();
  testPlannerRequestBuilderLeavesStandaloneGreedyTimeLimitUnset();
  testPlannerRequestBuilderKeepsAutoPayloadMinimal();
  testPlannerRequestBuilderKeepsPortfolioStandaloneOnly();
}

module.exports = {
  runPlannerContinuationTests
};
