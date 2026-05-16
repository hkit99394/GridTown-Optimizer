const {
  assert,
  createFakeDomElement,
  loadPlannerPersistenceModule,
  loadPlannerRequestBuilderModule,
  loadPlannerSharedModule,
  loadPlannerShellModule,
  loadPlannerWorkbenchModule
} = require("./helpers.cjs");

function testPlannerSavedLayoutRestoreRoundTripsHintSeedTogglesAndPortfolio() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const plannerWorkbench = loadPlannerWorkbenchModule();
  const grid = [
    [1, 1],
    [1, 1]
  ];

  const requestBuilderController = plannerRequestBuilder.createPlannerRequestBuilderController({
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
        useDisplayedHint: false,
        portfolio: {
          enabled: true,
          workerCount: "4",
          randomSeeds: "17, 23, 29",
          perWorkerTimeLimitSeconds: "12",
          perWorkerNumWorkers: "99",
          randomizeSearch: false
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
    },
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

  const savedRequest = requestBuilderController.buildSolveRequest();
  assert.equal(Object.prototype.hasOwnProperty.call(savedRequest.params.cpSat, "useDisplayedHint"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(savedRequest.params.lns, "useDisplayedSeed"), false);
  assert.equal(savedRequest.params.cpSat.portfolio.workerCount, 3);
  assert.deepEqual(Array.from(savedRequest.params.cpSat.portfolio.randomSeeds), [17, 23, 29]);
  assert.equal(savedRequest.params.cpSat.portfolio.totalCpuBudgetSeconds, 28800);
  assert.equal(savedRequest.params.cpSat.portfolio.perWorkerTimeLimitSeconds, 12);
  assert.equal(savedRequest.params.cpSat.portfolio.perWorkerNumWorkers, 2);
  assert.equal(savedRequest.params.cpSat.portfolio.randomizeSearch, false);

  const restoredState = {
    optimizer: "greedy",
    isSolving: false,
    grid,
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
      randomSeed: "",
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
      useDisplayedHint: true,
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
      useDisplayedSeed: true
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: ""
    }
  };

  const workbenchController = plannerWorkbench.createPlannerWorkbenchController({
    state: restoredState,
    elements: {
      gridRows: createFakeDomElement(),
      gridCols: createFakeDomElement(),
      expansionNextService: createFakeDomElement(),
      expansionNextResidential: createFakeDomElement(),
      gridEditor: createFakeDomElement(),
      resultMapGrid: createFakeDomElement(),
      paintModeToggle: createFakeDomElement(),
      solverToggle: createFakeDomElement(),
      greedyPanel: createFakeDomElement(),
      lnsPanel: createFakeDomElement(),
      cpSatPanel: createFakeDomElement(),
      greedyLocalSearch: createFakeDomElement(),
      greedyRandomSeed: createFakeDomElement(),
      greedyRestarts: createFakeDomElement(),
      greedyServiceRefineIterations: createFakeDomElement(),
      greedyServiceRefineCandidateLimit: createFakeDomElement(),
      greedyExhaustiveServiceSearch: createFakeDomElement(),
      greedyServiceExactPoolLimit: createFakeDomElement(),
      greedyServiceExactMaxCombinations: createFakeDomElement(),
      lnsIterations: createFakeDomElement(),
      lnsMaxNoImprovementIterations: createFakeDomElement(),
      lnsNeighborhoodRows: createFakeDomElement(),
      lnsNeighborhoodCols: createFakeDomElement(),
      lnsRepairTimeLimitSeconds: createFakeDomElement(),
      lnsNumWorkers: createFakeDomElement(),
      lnsLogSearchProgress: createFakeDomElement(),
      lnsPythonExecutable: createFakeDomElement(),
      lnsUseDisplayedSeed: createFakeDomElement(),
      cpSatTimeLimitSeconds: createFakeDomElement(),
      cpSatNoImprovementTimeoutSeconds: createFakeDomElement(),
      cpSatRandomSeed: createFakeDomElement(),
      cpSatNumWorkers: createFakeDomElement(),
      cpSatLogSearchProgress: createFakeDomElement(),
      cpSatPythonExecutable: createFakeDomElement(),
      cpSatUseDisplayedHint: createFakeDomElement(),
      cpSatPortfolioEnabled: createFakeDomElement(),
      cpSatPortfolioWorkerCount: createFakeDomElement(),
      cpSatPortfolioRandomSeeds: createFakeDomElement(),
      cpSatPortfolioPerWorkerTimeLimitSeconds: createFakeDomElement(),
      cpSatPortfolioPerWorkerNumWorkers: createFakeDomElement(),
      cpSatPortfolioRandomizeSearch: createFakeDomElement(),
      maxServices: createFakeDomElement(),
      maxResidentials: createFakeDomElement(),
      serviceList: createFakeDomElement(),
      residentialList: createFakeDomElement(),
      gridStats: createFakeDomElement(),
      runtimePresetStatus: createFakeDomElement(),
      summaryGridSize: createFakeDomElement(),
      summaryAllowedCells: createFakeDomElement(),
      summaryServiceTypes: createFakeDomElement(),
      summaryResidentialTypes: createFakeDomElement(),
      summaryOptimizer: createFakeDomElement(),
      payloadPreview: createFakeDomElement()
    },
    constants: {
      sampleGrid: [[1]]
    },
    helpers: {
      cloneGrid: plannerShared.cloneGrid,
      createGrid: plannerShared.createGrid,
      escapeHtml: plannerShared.escapeHtml,
      isGridLike: plannerShared.isGridLike,
      normalizeOptimizer: plannerShared.normalizeOptimizer,
      parseCatalogImportText: plannerShared.parseCatalogImportText,
      serializeResidentialTypeForCatalog: plannerShared.serializeResidentialTypeForCatalog,
      serializeServiceTypeForCatalog: plannerShared.serializeServiceTypeForCatalog
    },
    callbacks: {
      getOptimizerLabel(optimizer) {
        return optimizer === "cp-sat" ? "CP-SAT" : optimizer === "lns" ? "LNS" : "Greedy";
      },
      refreshResultOverlay() {},
      renderExpansionAdvice() {},
      setSolveState() {},
      updatePayloadPreview() {}
    }
  });

  workbenchController.applySolveRequestToPlanner(savedRequest, {
    preserveCpSatRuntime: false,
    optimizer: savedRequest.params.optimizer
  });

  assert.equal(restoredState.cpSat.useDisplayedHint, true);
  assert.equal(restoredState.lns.useDisplayedSeed, true);
  assert.equal(restoredState.cpSat.portfolio.enabled, true);
  assert.equal(restoredState.cpSat.portfolio.workerCount, 3);
  assert.equal(restoredState.cpSat.portfolio.randomSeeds, "17, 23, 29");
  assert.equal(restoredState.cpSat.portfolio.perWorkerTimeLimitSeconds, "12");
  assert.equal(restoredState.cpSat.portfolio.perWorkerNumWorkers, 2);
  assert.equal(restoredState.cpSat.portfolio.randomizeSearch, false);
}

function testPlannerRuntimePresetAppliesBoundedCpSatPolicy() {
  const plannerWorkbench = loadPlannerWorkbenchModule();
  let payloadPreviewUpdates = 0;
  let solveStateMessage = "";
  const state = {
    isSolving: false,
    grid: [
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1]
    ],
    optimizer: "greedy",
    serviceTypes: [{ name: "Clinic" }],
    residentialTypes: [{ name: "Tower" }],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
      randomSeed: "",
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
      randomSeed: "31",
      numWorkers: 2,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false
    },
    lns: {
      iterations: 12,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 5,
      useDisplayedSeed: false
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: ""
    }
  };
  const elements = {
    solverToggle: { querySelectorAll: () => [] },
    greedyPanel: { hidden: false },
    lnsPanel: { hidden: true },
    cpSatPanel: { hidden: true },
    runtimePresetStatus: { textContent: "" },
    greedyLocalSearch: { checked: false },
    greedyRandomSeed: { value: "" },
    greedyRestarts: { value: "" },
    greedyServiceRefineIterations: { value: "" },
    greedyServiceRefineCandidateLimit: { value: "" },
    greedyExhaustiveServiceSearch: { checked: false },
    greedyServiceExactPoolLimit: { value: "" },
    greedyServiceExactMaxCombinations: { value: "" },
    lnsIterations: { value: "" },
    lnsMaxNoImprovementIterations: { value: "" },
    lnsNeighborhoodRows: { value: "" },
    lnsNeighborhoodCols: { value: "" },
    lnsRepairTimeLimitSeconds: { value: "" },
    lnsNumWorkers: { value: "" },
    lnsLogSearchProgress: { checked: false },
    lnsPythonExecutable: { value: "" },
    lnsUseDisplayedSeed: { checked: false },
    cpSatTimeLimitSeconds: { value: "" },
    cpSatNoImprovementTimeoutSeconds: { value: "" },
    cpSatRandomSeed: { value: "" },
    cpSatNumWorkers: { value: "" },
    cpSatLogSearchProgress: { checked: false },
    cpSatPythonExecutable: { value: "" },
    cpSatUseDisplayedHint: { checked: false },
    maxServices: { value: "" },
    maxResidentials: { value: "" },
    summaryGridSize: { textContent: "" },
    summaryAllowedCells: { textContent: "" },
    summaryServiceTypes: { textContent: "" },
    summaryResidentialTypes: { textContent: "" },
    summaryOptimizer: { textContent: "" }
  };
  const controller = plannerWorkbench.createPlannerWorkbenchController({
    state,
    elements,
    constants: {
      sampleGrid: [[1]]
    },
    helpers: {
      cloneGrid(grid) {
        return JSON.parse(JSON.stringify(grid));
      },
      createGrid(rows, cols, value) {
        return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
      },
      escapeHtml(value) {
        return String(value);
      },
      isGridLike(value) {
        return Array.isArray(value);
      },
      normalizeOptimizer(value) {
        return value === "cp-sat" || value === "lns" ? value : "greedy";
      },
      parseCatalogImportText() {
        return {};
      },
      serializeResidentialTypeForCatalog(entry) {
        return entry;
      },
      serializeServiceTypeForCatalog(entry) {
        return entry;
      }
    },
    callbacks: {
      getOptimizerLabel(optimizer) {
        return optimizer === "cp-sat" ? "CP-SAT" : optimizer === "lns" ? "LNS" : "Greedy";
      },
      refreshResultOverlay() {},
      renderExpansionAdvice() {},
      setSolveState(message) {
        solveStateMessage = message;
      },
      updatePayloadPreview() {
        payloadPreviewUpdates += 1;
      }
    }
  });

  controller.applyRuntimePreset("bounded-cp-sat");

  assert.equal(state.optimizer, "cp-sat");
  assert.equal(state.cpSat.timeLimitSeconds, "30");
  assert.equal(state.cpSat.noImprovementTimeoutSeconds, "10");
  assert.equal(state.cpSat.numWorkers, 8);
  assert.equal(state.cpSat.useDisplayedHint, true);
  assert.equal(elements.cpSatTimeLimitSeconds.value, "30");
  assert.equal(elements.cpSatNoImprovementTimeoutSeconds.value, "10");
  assert.equal(elements.cpSatUseDisplayedHint.checked, true);
  assert.equal(elements.summaryOptimizer.textContent, "CP-SAT");
  assert.equal(solveStateMessage.includes("Bounded CP-SAT"), true);
  assert.equal(payloadPreviewUpdates > 0, true);
  assert.equal(controller.countAllowedCells(), 8);
}

function testPlannerAutoMarksIgnoredSeedControlsUnavailable() {
  const plannerWorkbench = loadPlannerWorkbenchModule();
  const state = {
    grid: [[1, 1]],
    optimizer: "auto",
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
      randomSeed: "17",
      timeLimitSeconds: "3900",
      profile: true,
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
      randomSeed: "31",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 1,
      neighborhoodCols: 1,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true
    },
    auto: {
      wallClockLimitSeconds: ""
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: ""
    }
  };
  const elements = {
    solverToggle: createFakeDomElement(),
    autoPanel: createFakeDomElement(),
    greedyPanel: createFakeDomElement(),
    lnsPanel: createFakeDomElement(),
    cpSatPanel: createFakeDomElement(),
    autoWallClockLimitSeconds: createFakeDomElement(),
    greedyLocalSearch: createFakeDomElement(),
    greedyRandomSeed: createFakeDomElement(),
    greedyTimeLimitSeconds: createFakeDomElement(),
    greedyProfile: createFakeDomElement(),
    greedyDensityTieBreaker: createFakeDomElement(),
    greedyDensityTieBreakerTolerancePercent: createFakeDomElement(),
    greedyRestarts: createFakeDomElement(),
    greedyServiceRefineIterations: createFakeDomElement(),
    greedyServiceRefineCandidateLimit: createFakeDomElement(),
    greedyExhaustiveServiceSearch: createFakeDomElement(),
    greedyServiceExactPoolLimit: createFakeDomElement(),
    greedyServiceExactMaxCombinations: createFakeDomElement(),
    lnsIterations: createFakeDomElement(),
    lnsMaxNoImprovementIterations: createFakeDomElement(),
    lnsNeighborhoodRows: createFakeDomElement(),
    lnsNeighborhoodCols: createFakeDomElement(),
    lnsRepairTimeLimitSeconds: createFakeDomElement(),
    lnsPythonExecutable: createFakeDomElement(),
    lnsUseDisplayedSeed: createFakeDomElement(),
    cpSatTimeLimitSeconds: createFakeDomElement(),
    cpSatNoImprovementTimeoutSeconds: createFakeDomElement(),
    cpSatRandomSeed: createFakeDomElement(),
    cpSatNumWorkers: createFakeDomElement(),
    cpSatLogSearchProgress: createFakeDomElement(),
    cpSatPythonExecutable: createFakeDomElement(),
    cpSatUseDisplayedHint: createFakeDomElement(),
    maxServices: createFakeDomElement(),
    maxResidentials: createFakeDomElement(),
    summaryGridSize: createFakeDomElement(),
    summaryAllowedCells: createFakeDomElement(),
    summaryServiceTypes: createFakeDomElement(),
    summaryResidentialTypes: createFakeDomElement(),
    summaryOptimizer: createFakeDomElement()
  };
  const controller = plannerWorkbench.createPlannerWorkbenchController({
    state,
    elements,
    constants: {
      sampleGrid: [[1]]
    },
    helpers: {
      cloneGrid(grid) {
        return JSON.parse(JSON.stringify(grid));
      },
      createGrid(rows, cols, value) {
        return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
      },
      escapeHtml(value) {
        return String(value);
      },
      isGridLike(value) {
        return Array.isArray(value);
      },
      normalizeOptimizer(value) {
        return value === "auto" || value === "cp-sat" || value === "lns" ? value : "greedy";
      },
      parseCatalogImportText() {
        return {};
      },
      serializeResidentialTypeForCatalog(entry) {
        return entry;
      },
      serializeServiceTypeForCatalog(entry) {
        return entry;
      }
    },
    callbacks: {
      getOptimizerLabel(optimizer) {
        return optimizer === "auto" ? "Auto" : optimizer;
      },
      refreshResultOverlay() {},
      renderExpansionAdvice() {},
      setSolveState() {},
      updatePayloadPreview() {}
    }
  });

  controller.setOptimizer("auto");

  assert.equal(elements.autoPanel.hidden, false);
  assert.equal(elements.greedyPanel.hidden, true);
  assert.equal(elements.lnsPanel.hidden, true);
  assert.equal(elements.cpSatPanel.hidden, true);

  controller.syncSolverFields();

  assert.equal(elements.greedyRandomSeed.disabled, true);
  assert.equal(elements.greedyRandomSeed.value, "");
  assert.match(elements.greedyRandomSeed.title, /Auto generates/);
  assert.equal(elements.greedyTimeLimitSeconds.disabled, true);
  assert.equal(elements.greedyTimeLimitSeconds.value, "");
  assert.match(elements.greedyTimeLimitSeconds.title, /Auto uses/);
  assert.equal(elements.greedyProfile.checked, false);
  assert.equal(elements.greedyProfile.disabled, true);
  assert.equal(elements.greedyDensityTieBreaker.checked, false);
  assert.equal(elements.greedyDensityTieBreaker.disabled, true);
  assert.equal(elements.greedyDensityTieBreakerTolerancePercent.disabled, true);
  assert.equal(elements.greedyDensityTieBreakerTolerancePercent.value, "");
  assert.equal(elements.cpSatRandomSeed.disabled, true);
  assert.equal(elements.cpSatRandomSeed.value, "");
  assert.match(elements.cpSatRandomSeed.title, /Auto generates/);
  assert.equal(elements.greedyExhaustiveServiceSearch.checked, false);
  assert.equal(elements.greedyExhaustiveServiceSearch.disabled, true);
  assert.equal(elements.greedyRestarts.max, "4");
  assert.equal(elements.greedyServiceExactMaxCombinations.max, "512");

  state.optimizer = "greedy";
  controller.syncSolverFields();

  assert.equal(elements.greedyTimeLimitSeconds.disabled, false);
  assert.equal(elements.greedyTimeLimitSeconds.value, "3900");
  assert.equal(elements.greedyProfile.checked, true);
  assert.equal(elements.greedyProfile.disabled, false);
  assert.equal(elements.greedyDensityTieBreaker.checked, true);
  assert.equal(elements.greedyDensityTieBreaker.disabled, false);
  assert.equal(elements.greedyDensityTieBreakerTolerancePercent.disabled, false);
  assert.equal(elements.greedyDensityTieBreakerTolerancePercent.value, "2.5");
  assert.equal(elements.greedyRestarts.max, "");
  assert.equal(elements.greedyServiceExactMaxCombinations.max, "");
}

function testPlannerShellRequiresManualValidationBeforeContinuationReuse() {
  const plannerShell = loadPlannerShellModule();
  const state = {
    isSolving: false,
    activeSolveRequestId: "",
    isStopping: false,
    result: { solution: {}, stats: {}, validation: { valid: false, errors: [] } },
    resultContext: { grid: [[1]], params: {} },
    layoutEditor: {
      isApplying: false,
      pendingValidation: true,
      pendingPlacement: { canRotate: true }
    },
    expansionAdvice: {
      isRunning: false
    }
  };
  const elements = {
    solveButton: { disabled: false, textContent: "" },
    stopSolveButton: { disabled: false },
    loadConfigButton: { disabled: false },
    loadLayoutButton: { disabled: false },
    saveLayoutButton: { disabled: false },
    lnsUseDisplayedSeed: { disabled: false },
    cpSatUseDisplayedHint: { disabled: false },
    expansionNextService: { disabled: false },
    expansionNextResidential: { disabled: false },
    compareExpansionButton: { disabled: false },
    moveSelectedBuildingButton: { disabled: false },
    removeSelectedBuildingButton: { disabled: false },
    rotatePendingPlacementButton: { disabled: true },
    validateEditedLayoutButton: { disabled: true },
    layoutEditModeToggle: {
      querySelectorAll() {
        return [];
      }
    },
    remainingServiceList: {
      querySelectorAll() {
        return [];
      }
    },
    remainingResidentialList: {
      querySelectorAll() {
        return [];
      }
    },
    solveStatus: { textContent: "" }
  };
  const controller = plannerShell.createPlannerShellController({
    state,
    elements,
    callbacks: {
      hasSelectedBuilding() {
        return false;
      },
      readExpansionCandidateFlags() {
        return { hasAnyCandidate: true };
      }
    }
  });

  controller.syncActionAvailability();

  assert.equal(elements.rotatePendingPlacementButton.disabled, false);
  assert.equal(elements.validateEditedLayoutButton.disabled, false);
  assert.equal(elements.solveButton.disabled, false);
  assert.equal(elements.lnsUseDisplayedSeed.disabled, true);
  assert.equal(elements.cpSatUseDisplayedHint.disabled, true);
  assert.equal(elements.compareExpansionButton.disabled, true);

  state.layoutEditor.isApplying = true;
  controller.syncActionAvailability();

  assert.equal(elements.solveButton.disabled, true);
  assert.equal(elements.loadConfigButton.disabled, true);
  assert.equal(elements.loadLayoutButton.disabled, true);
  assert.equal(elements.saveLayoutButton.disabled, true);

  state.layoutEditor.isApplying = false;

  state.layoutEditor.pendingValidation = false;
  controller.syncActionAvailability();

  assert.equal(elements.validateEditedLayoutButton.disabled, true);
  assert.equal(elements.lnsUseDisplayedSeed.disabled, false);
  assert.equal(elements.cpSatUseDisplayedHint.disabled, false);

  state.layoutEditor.pendingPlacement = null;
  controller.syncActionAvailability();

  assert.equal(elements.rotatePendingPlacementButton.disabled, true);

  state.result.solution.manualLayout = true;
  state.result.stats.manualLayout = true;
  controller.syncActionAvailability();

  assert.equal(elements.lnsUseDisplayedSeed.disabled, true);
  assert.equal(elements.cpSatUseDisplayedHint.disabled, true);
}

function testPlannerPersistenceRestoresLegacyReviewedInvalidLayoutWithoutPendingFlag() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const constants = {
    CONFIG_STORAGE_KEY: "configs",
    LAYOUT_STORAGE_KEY: "layouts",
    defaultResidentialTypes: [],
    defaultServiceTypes: [],
    sampleGrid: [[1]]
  };
  const state = {
    isSolving: false,
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      isApplying: true,
      edited: false,
      pendingValidation: false,
      status: ""
    },
    result: null,
    resultContext: null,
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    optimizer: "greedy"
  };
  const elements = {
    savedLayoutsSelect: createFakeDomElement({ value: "layout-1" }),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement()
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state,
    elements,
    constants,
    helpers: {
      buildCpSatWarmStartCheckpoint() {
        return null;
      },
      cloneGrid(value) {
        return JSON.parse(JSON.stringify(value));
      },
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      createSavedEntryId() {
        return "saved-id";
      },
      formatElapsedTime(value) {
        return String(value);
      },
      formatSavedTimestamp(value) {
        return String(value);
      },
      getSavedLayoutElapsedMs(entry) {
        return entry.elapsedMs ?? 0;
      },
      isGridLike(value) {
        return Array.isArray(value);
      },
      normalizeElapsedMs(value) {
        return Number(value) || 0;
      },
      normalizeOptimizer(value) {
        return value === "auto" || value === "lns" || value === "cp-sat" ? value : "greedy";
      }
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

  localStorage.setItem(
    constants.LAYOUT_STORAGE_KEY,
    JSON.stringify([
      {
        id: "layout-1",
        name: "Reviewed invalid layout",
        savedAt: "2026-04-19T00:00:00.000Z",
        elapsedMs: 123,
        result: {
          solution: {
            manualLayout: true,
            roads: [],
            services: [],
            serviceTypeIndices: [],
            servicePopulationIncreases: [],
            residentials: [],
            residentialTypeIndices: [],
            populations: [],
            totalPopulation: 0
          },
          stats: {
            manualLayout: true,
            optimizer: undefined,
            totalPopulation: 0,
            roadCount: 0,
            serviceCount: 0,
            residentialCount: 0
          },
          validation: {
            valid: false,
            errors: ["Invalid layout"]
          }
        },
        resultContext: {
          grid: [[1]],
          params: {
            optimizer: "greedy"
          }
        }
      }
    ])
  );

  persistence.loadSelectedLayout();

  assert.equal(state.layoutEditor.pendingValidation, false);
  assert.equal(state.layoutEditor.isApplying, false);
}

function testPlannerPersistenceRestoresLegacyPendingValidationLayoutWithoutFlag() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const constants = {
    CONFIG_STORAGE_KEY: "configs",
    LAYOUT_STORAGE_KEY: "layouts",
    defaultResidentialTypes: [],
    defaultServiceTypes: [],
    sampleGrid: [[1]]
  };
  const state = {
    isSolving: false,
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      edited: false,
      pendingValidation: false,
      status: ""
    },
    result: null,
    resultContext: null,
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    optimizer: "greedy"
  };
  const elements = {
    savedLayoutsSelect: createFakeDomElement({ value: "layout-1" }),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement()
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state,
    elements,
    constants,
    helpers: {
      buildCpSatWarmStartCheckpoint() {
        return null;
      },
      cloneGrid(value) {
        return JSON.parse(JSON.stringify(value));
      },
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      createSavedEntryId() {
        return "saved-id";
      },
      formatElapsedTime(value) {
        return String(value);
      },
      formatSavedTimestamp(value) {
        return String(value);
      },
      getSavedLayoutElapsedMs(entry) {
        return entry.elapsedMs ?? 0;
      },
      isGridLike(value) {
        return Array.isArray(value);
      },
      normalizeElapsedMs(value) {
        return Number(value) || 0;
      },
      normalizeOptimizer(value) {
        return value === "auto" || value === "lns" || value === "cp-sat" ? value : "greedy";
      }
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

  localStorage.setItem(
    constants.LAYOUT_STORAGE_KEY,
    JSON.stringify([
      {
        id: "layout-1",
        name: "Pending invalid layout",
        savedAt: "2026-04-19T00:00:00.000Z",
        elapsedMs: 123,
        result: {
          solution: {
            manualLayout: true,
            roads: [],
            services: [],
            serviceTypeIndices: [],
            servicePopulationIncreases: [],
            residentials: [],
            residentialTypeIndices: [],
            populations: [],
            totalPopulation: 0
          },
          stats: {
            manualLayout: true,
            optimizer: undefined,
            totalPopulation: 0,
            roadCount: 0,
            serviceCount: 0,
            residentialCount: 0
          },
          validation: {
            valid: false,
            errors: ["Manual edits are pending validation. Use Validate layout when you're ready."]
          }
        },
        resultContext: {
          grid: [[1]],
          params: {
            optimizer: "greedy"
          }
        }
      }
    ])
  );

  persistence.loadSelectedLayout();

  assert.equal(state.layoutEditor.pendingValidation, true);
}

function testPlannerPersistenceSavedLayoutOptionsShowPopulation() {
  const plannerShared = loadPlannerSharedModule();
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const appendedLayoutOptions = [];
  const elements = {
    savedLayoutsSelect: createFakeDomElement({
      append(option) {
        appendedLayoutOptions.push(option);
      }
    }),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement()
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state: {
      isSolving: false,
      selectedMapBuilding: null,
      selectedMapCell: null,
      layoutEditor: {
        mode: "inspect",
        pendingPlacement: null,
        edited: false,
        pendingValidation: false,
        status: "",
        isApplying: false
      },
      result: null,
      resultContext: null,
      solveProgressLog: [],
      resultIsLiveSnapshot: false,
      resultError: "",
      optimizer: "greedy"
    },
    elements,
    constants: {
      CONFIG_STORAGE_KEY: "configs",
      LAYOUT_STORAGE_KEY: "layouts",
      defaultResidentialTypes: [],
      defaultServiceTypes: [],
      sampleGrid: [[1]]
    },
    helpers: {
      buildCpSatWarmStartCheckpoint() {
        return null;
      },
      cloneGrid: plannerShared.cloneGrid,
      cloneJson: plannerShared.cloneJson,
      createSavedEntryId: plannerShared.createSavedEntryId,
      formatElapsedTime(value) {
        return `elapsed-${value}`;
      },
      formatSavedTimestamp() {
        return "saved-date";
      },
      getSavedLayoutElapsedMs: plannerShared.getSavedLayoutElapsedMs,
      getSavedLayoutPopulation: plannerShared.getSavedLayoutPopulation,
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
      setResultElapsed() {},
      setSolveState() {},
      syncPlannerFromState() {}
    }
  });
  localStorage.setItem(
    "layouts",
    JSON.stringify([
      {
        id: "layout-1",
        name: "High score",
        savedAt: "2026-04-19T00:00:00.000Z",
        elapsedMs: 65000,
        result: {
          validation: {
            recomputedTotalPopulation: 1234
          },
          stats: {
            totalPopulation: 1200
          },
          solution: {
            populations: [600, 634],
            totalPopulation: 1234
          }
        }
      }
    ])
  );

  persistence.refreshSavedLayoutOptions();

  assert.equal(appendedLayoutOptions[1].textContent, "High score • Population 1,234 • saved-date");
  assert.doesNotMatch(appendedLayoutOptions[1].textContent, /elapsed-65000/);
}

async function runPlannerSavedLayoutTests() {
  testPlannerSavedLayoutRestoreRoundTripsHintSeedTogglesAndPortfolio();
  testPlannerRuntimePresetAppliesBoundedCpSatPolicy();
  testPlannerAutoMarksIgnoredSeedControlsUnavailable();
  testPlannerShellRequiresManualValidationBeforeContinuationReuse();
  testPlannerPersistenceRestoresLegacyReviewedInvalidLayoutWithoutPendingFlag();
  testPlannerPersistenceRestoresLegacyPendingValidationLayoutWithoutFlag();
  testPlannerPersistenceSavedLayoutOptionsShowPopulation();
}

module.exports = {
  runPlannerSavedLayoutTests
};
