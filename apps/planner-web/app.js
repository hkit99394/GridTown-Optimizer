/**
 * @typedef {Record<string, any>} JsonObject
 * @typedef {number[][]} PlannerGrid
 */

const CONFIG_STORAGE_KEY = "city-builder:planner-configs:v1";
const LAYOUT_STORAGE_KEY = "city-builder:planner-layouts:v1";
const SOLVE_STATUS_POLL_INTERVAL_MS = 1000;
const LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 30 * 1000;
const COMPARISON_PROGRESS_HINT_INTERVAL_MS = 60 * 1000;

const plannerWindow =
  /** @type {Window & { CityBuilderAppElements?: unknown, CityBuilderDefaults?: unknown, CityBuilderExpansion?: unknown, CityBuilderOnboarding?: unknown, CityBuilderPersistence?: unknown, CityBuilderRequestBuilder?: unknown, CityBuilderResults?: unknown, CityBuilderSamplePresets?: unknown, CityBuilderShared?: unknown, CityBuilderShell?: unknown, CityBuilderSolveRuntime?: unknown, CityBuilderWorkbench?: unknown, PlannerManualLayout?: unknown }} */
  (window);

const plannerModules = /** @type {Record<string, JsonObject>} */ ({
  appElements: plannerWindow.CityBuilderAppElements,
  defaults: plannerWindow.CityBuilderDefaults,
  shell: plannerWindow.CityBuilderShell,
  shared: plannerWindow.CityBuilderShared,
  onboarding: plannerWindow.CityBuilderOnboarding,
  persistence: plannerWindow.CityBuilderPersistence,
  solveRuntime: plannerWindow.CityBuilderSolveRuntime,
  expansion: plannerWindow.CityBuilderExpansion,
  manualLayout: plannerWindow.PlannerManualLayout,
  results: plannerWindow.CityBuilderResults,
  requestBuilder: plannerWindow.CityBuilderRequestBuilder,
  samplePresets: plannerWindow.CityBuilderSamplePresets,
  workbench: plannerWindow.CityBuilderWorkbench
});

if (Object.values(plannerModules).some((module) => !module)) {
  throw new Error(
    "plannerAppElements.js, plannerDefaults.js, plannerShell.js, plannerShared.js, plannerOnboarding.js, plannerPersistence.js, plannerSolveRuntime.js, plannerExpansion.js, plannerManualLayout.js, plannerResults.js, plannerRequestBuilder.js, plannerSamplePresets.js, and plannerWorkbench.js must load before app.js"
  );
}

const plannerDefaults =
  /** @type {{ DEFAULT_RESIDENTIAL_TYPES: JsonObject[], DEFAULT_SERVICE_TYPES: JsonObject[], SAMPLE_GRID: PlannerGrid }} */ (
    plannerModules.defaults
  );
const { DEFAULT_RESIDENTIAL_TYPES, DEFAULT_SERVICE_TYPES, SAMPLE_GRID } = plannerDefaults;

const {
  buildCpSatContinuationModelInput,
  buildCpSatWarmStartCheckpoint,
  clampInteger,
  cloneGrid,
  cloneJson,
  computeCpSatModelFingerprint,
  createGrid,
  createSavedEntryId,
  createSolveRequestId,
  delay,
  escapeHtml,
  formatElapsedTime,
  formatSavedTimestamp,
  getSavedLayoutElapsedMs,
  getSavedLayoutPopulation,
  isGridLike,
  normalizeElapsedMs,
  normalizeOptimizer,
  parseCatalogImportText,
  parseResidentialCatalogEntry,
  parseServiceCatalogEntry,
  readOptionalInteger,
  serializeResidentialTypeForCatalog,
  serializeServiceTypeForCatalog
} = plannerModules.shared;
const { createPlannerShellController } = plannerModules.shell;
const { createPlannerOnboardingController } = plannerModules.onboarding;
const { createPlannerPersistence } = plannerModules.persistence;
const { createSolveRuntime } = plannerModules.solveRuntime;
const { createExpansionAdviceController } = plannerModules.expansion;
const { createPlannerResultsController } = plannerModules.results;
const { createPlannerRequestBuilderController } = plannerModules.requestBuilder;
const { createSampleProblemPresets } = plannerModules.samplePresets;
const { createPlannerWorkbenchController } = plannerModules.workbench;
const { createPlannerAppElements } = plannerModules.appElements;
const sampleProblemPresets = createSampleProblemPresets({
  sampleGrid: SAMPLE_GRID,
  defaultServiceTypes: DEFAULT_SERVICE_TYPES,
  defaultResidentialTypes: DEFAULT_RESIDENTIAL_TYPES
});

const state = /** @type {JsonObject} */ ({
  grid: cloneGrid(SAMPLE_GRID),
  paintMode: "toggle",
  advancedMode: false,
  optimizer: "auto",
  serviceTypes: DEFAULT_SERVICE_TYPES.map((entry) => ({ ...entry })),
  residentialTypes: DEFAULT_RESIDENTIAL_TYPES.map((entry) => ({ ...entry })),
  availableBuildings: {
    services: "",
    residentials: ""
  },
  // Standalone Greedy intentionally uses the heavy heuristic profile; Auto clamps
  // these values when it only needs a fast seed stage.
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
  auto: {
    wallClockLimitSeconds: "",
    continueAfterPopulationCapSeconds: ""
  },
  isPainting: false,
  isSolving: false,
  isStopping: false,
  activeSolveRequestId: "",
  solveTimerStartedAt: 0,
  solveTimerElapsedMs: 0,
  solveTimerHandle: 0,
  solveTimerFrozen: true,
  result: null,
  resultIsLiveSnapshot: false,
  resultError: "",
  resultContext: null,
  resultElapsedMs: 0,
  resultHeatmapEnabled: false,
  resultExplainabilityMode: "layout",
  solveProgressLog: [],
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
  }
});

const elements = /** @type {JsonObject} */ (createPlannerAppElements(document));

/** @type {JsonObject} */
let expansionAdviceController = /** @type {JsonObject} */ (/** @type {unknown} */ (null));
/** @type {JsonObject} */
let resultsController = /** @type {JsonObject} */ (/** @type {unknown} */ (null));
/** @type {JsonObject} */
let requestBuilderController = /** @type {JsonObject} */ (/** @type {unknown} */ (null));
/** @type {JsonObject} */
let workbenchController = /** @type {JsonObject} */ (/** @type {unknown} */ (null));

function readExpansionCandidateFlagsFallback() {
  const hasServiceCandidate = Boolean(String(state.expansionAdvice.nextServiceText ?? "").trim());
  const hasResidentialCandidate = Boolean(String(state.expansionAdvice.nextResidentialText ?? "").trim());
  return {
    hasServiceCandidate,
    hasResidentialCandidate,
    hasAnyCandidate: hasServiceCandidate || hasResidentialCandidate,
    hasBothCandidates: hasServiceCandidate && hasResidentialCandidate
  };
}

const shellController = createPlannerShellController({
  state,
  elements,
  callbacks: {
    hasSelectedBuilding: () => resultsController?.hasSelectedBuilding(),
    readExpansionCandidateFlags: () =>
      expansionAdviceController?.readExpansionCandidateFlags() ?? readExpansionCandidateFlagsFallback()
  }
});

function clearRenderedResultState() {
  state.result = null;
  state.resultIsLiveSnapshot = false;
  state.resultError = "";
  state.solveProgressLog = [];
  state.selectedMapBuilding = null;
  state.selectedMapCell = null;
  state.layoutEditor.mode = "inspect";
  state.layoutEditor.pendingPlacement = null;
  state.layoutEditor.edited = false;
  state.layoutEditor.pendingValidation = false;
  state.layoutEditor.status = "";
  state.layoutEditor.isApplying = false;
  clearExpansionAdvice();
}

function clearExpansionAdvice() {
  if (expansionAdviceController) {
    expansionAdviceController.clearExpansionAdvice();
    return;
  }
  state.expansionAdvice.isRunning = false;
  state.expansionAdvice.status = "";
  state.expansionAdvice.result = null;
  state.expansionAdvice.error = "";
}

const RESULT_EXPLAINABILITY_MODES = new Set(["layout", "service-value", "placement-opportunity", "connectivity-risk"]);

/**
 * @param {string} mode
 * @returns {string}
 */
function normalizeResultExplainabilityMode(mode) {
  return RESULT_EXPLAINABILITY_MODES.has(mode) ? mode : "layout";
}

function syncResultExplainabilityModeControl() {
  if (!elements.resultExplainabilityModeToggle) return;
  state.resultExplainabilityMode = normalizeResultExplainabilityMode(state.resultExplainabilityMode);
  state.resultHeatmapEnabled = state.resultExplainabilityMode === "service-value";

  for (const button of elements.resultExplainabilityModeToggle.querySelectorAll("button")) {
    const isActive = button.dataset.resultExplainabilityMode === state.resultExplainabilityMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

requestBuilderController = createPlannerRequestBuilderController({
  state,
  elements,
  helpers: {
    buildCpSatContinuationModelInput,
    buildCpSatWarmStartCheckpoint,
    clampInteger,
    cloneJson,
    cloneGrid,
    computeCpSatModelFingerprint,
    getSavedLayoutElapsedMs,
    parseResidentialCatalogEntry,
    parseServiceCatalogEntry,
    readOptionalInteger
  }
});

workbenchController = createPlannerWorkbenchController({
  state,
  elements,
  constants: {
    sampleGrid: SAMPLE_GRID
  },
  helpers: {
    cloneGrid,
    createGrid,
    escapeHtml,
    isGridLike,
    normalizeOptimizer,
    parseCatalogImportText,
    serializeResidentialTypeForCatalog,
    serializeServiceTypeForCatalog
  },
  callbacks: {
    getOptimizerLabel: shellController.getOptimizerLabel,
    refreshResultOverlay: () => resultsController?.refreshResultOverlay(),
    renderExpansionAdvice: () => expansionAdviceController?.renderExpansionAdvice(),
    setSolveState: shellController.setSolveState,
    updatePayloadPreview: () => requestBuilderController?.updatePayloadPreview()
  }
});

expansionAdviceController = createExpansionAdviceController({
  state,
  elements,
  constants: {
    COMPARISON_PROGRESS_HINT_INTERVAL_MS,
    SOLVE_STATUS_POLL_INTERVAL_MS
  },
  helpers: {
    buildCpSatContinuationModelInput,
    cloneJson,
    computeCpSatModelFingerprint,
    createSolveRequestId,
    delay,
    parseResidentialCatalogEntry,
    parseServiceCatalogEntry
  },
  callbacks: {
    buildSolveRequest: requestBuilderController.buildSolveRequest,
    getDisplayedLayoutCheckpoint: requestBuilderController.getDisplayedLayoutCheckpoint,
    getDisplayedLayoutSourceLabel: requestBuilderController.getDisplayedLayoutSourceLabel,
    getOptimizerLabel: shellController.getOptimizerLabel,
    syncActionAvailability: shellController.syncActionAvailability
  }
});

resultsController = createPlannerResultsController({
  state,
  elements,
  constants: {
    LIVE_SNAPSHOT_REFRESH_INTERVAL_MS
  },
  helpers: {
    cloneJson,
    formatElapsedTime
  },
  callbacks: {
    applyMatrixLayout: workbenchController.applyMatrixLayout,
    clearExpansionAdvice,
    getOptimizerLabel: shellController.getOptimizerLabel,
    renderExpansionAdvice: expansionAdviceController.renderExpansionAdvice,
    setSolveState: shellController.setSolveState,
    syncActionAvailability: shellController.syncActionAvailability
  }
});

const solveRuntimeController = createSolveRuntime({
  state,
  elements,
  constants: {
    LIVE_SNAPSHOT_REFRESH_INTERVAL_MS,
    SOLVE_STATUS_POLL_INTERVAL_MS
  },
  helpers: {
    createSolveRequestId,
    delay,
    formatElapsedTime,
    normalizeElapsedMs
  },
  callbacks: {
    buildSolveRequest: requestBuilderController.buildSolveRequest,
    clearExpansionAdvice,
    ensureCpSatRandomSeed: requestBuilderController.ensureCpSatRandomSeed,
    getDisplayedLayoutCheckpoint: requestBuilderController.getDisplayedLayoutCheckpoint,
    getOptimizerLabel: shellController.getOptimizerLabel,
    renderResults: resultsController.renderResults,
    setSolveState: shellController.setSolveState
  }
});

const persistenceController = createPlannerPersistence({
  state,
  elements,
  constants: {
    CONFIG_STORAGE_KEY,
    LAYOUT_STORAGE_KEY,
    defaultResidentialTypes: DEFAULT_RESIDENTIAL_TYPES,
    defaultServiceTypes: DEFAULT_SERVICE_TYPES,
    sampleGrid: SAMPLE_GRID
  },
  helpers: {
    buildCpSatWarmStartCheckpoint,
    cloneGrid,
    cloneJson,
    createSavedEntryId,
    formatElapsedTime,
    formatSavedTimestamp,
    getSavedLayoutElapsedMs,
    getSavedLayoutPopulation,
    isGridLike,
    normalizeElapsedMs,
    normalizeOptimizer
  },
  callbacks: {
    applySolveRequestToPlanner: workbenchController.applySolveRequestToPlanner,
    clearExpansionAdvice,
    clearRenderedResultState,
    renderResults: resultsController.renderResults,
    resetSolveTimer: solveRuntimeController.resetSolveTimer,
    setResultElapsed: solveRuntimeController.setResultElapsed,
    setSolveState: shellController.setSolveState,
    syncPlannerFromState: workbenchController.syncPlannerFromState
  }
});

const onboardingController = createPlannerOnboardingController({
  state,
  elements,
  sampleProblemPresets,
  helpers: {
    cloneGrid
  },
  callbacks: {
    setSolveState: shellController.setSolveState,
    syncPlannerFromState: () => workbenchController.syncPlannerFromState()
  }
});

function init() {
  solveRuntimeController.resetSolveTimer();
  workbenchController.updateGridDimensionInputs();
  workbenchController.setPaintMode(state.paintMode);
  workbenchController.setOptimizer(state.optimizer);
  workbenchController.syncSolverFields();
  workbenchController.renderGrid();
  workbenchController.renderServiceTypes();
  workbenchController.renderResidentialTypes();
  elements.expansionNextService.value = state.expansionAdvice.nextServiceText;
  elements.expansionNextResidential.value = state.expansionAdvice.nextResidentialText;
  persistenceController.refreshSavedConfigOptions();
  persistenceController.refreshSavedLayoutOptions();
  requestBuilderController.updatePayloadPreview();
  resultsController.renderResults();
  shellController.syncActionAvailability();
  onboardingController.init();
  workbenchController.initResizeHandling();
  requestAnimationFrame(() => workbenchController.refreshMatrixLayouts());

  elements.paintModeToggle.addEventListener(
    "click",
    /** @param {Event} event */ (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.paintMode) return;
      workbenchController.setPaintMode(button.dataset.paintMode);
    }
  );

  elements.solverToggle.addEventListener(
    "click",
    /** @param {Event} event */ (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.optimizer) return;
      workbenchController.setOptimizer(button.dataset.optimizer);
      requestBuilderController.updatePayloadPreview();
    }
  );

  elements.runtimePresetButtons.addEventListener(
    "click",
    /** @param {Event} event */ (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.runtimePreset) return;
      workbenchController.applyRuntimePreset(button.dataset.runtimePreset);
    }
  );

  elements.resizeGridButton.addEventListener("click", () => {
    const rows = clampInteger(elements.gridRows.value, state.grid.length, 1);
    const cols = clampInteger(elements.gridCols.value, state.grid[0].length, 1);
    workbenchController.resizeGrid(rows, cols);
  });

  elements.fillAllowedButton.addEventListener("click", () => workbenchController.applyPreset("all"));
  elements.clearGridButton.addEventListener("click", () => workbenchController.applyPreset("clear"));
  elements.sampleGridButton.addEventListener("click", () => workbenchController.applyPreset("sample"));

  elements.gridEditor.addEventListener(
    "pointerdown",
    /** @param {Event} event */ (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest(".grid-cell");
      if (!(cell instanceof HTMLButtonElement)) return;
      state.isPainting = true;
      workbenchController.applyPaint(cell);
    }
  );

  elements.gridEditor.addEventListener(
    "pointerover",
    /** @param {Event} event */ (event) => {
      if (!state.isPainting) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest(".grid-cell");
      if (!(cell instanceof HTMLButtonElement)) return;
      workbenchController.applyPaint(cell);
    }
  );

  window.addEventListener("pointerup", () => {
    state.isPainting = false;
  });

  elements.addServiceTypeButton.addEventListener("click", () => {
    state.serviceTypes.push({ name: "", bonus: "100", size: "2x2", effective: "10x10", avail: "1" });
    workbenchController.renderServiceTypes();
    requestBuilderController.updatePayloadPreview();
  });

  elements.addResidentialTypeButton.addEventListener("click", () => {
    state.residentialTypes.push({ name: "", resident: "120/360", size: "2x2", avail: "1" });
    workbenchController.renderResidentialTypes();
    requestBuilderController.updatePayloadPreview();
  });

  elements.serviceList.addEventListener("input", workbenchController.handleCatalogInput);
  elements.serviceList.addEventListener("change", workbenchController.handleCatalogInput);
  elements.serviceList.addEventListener("click", workbenchController.handleCatalogClick);

  elements.residentialList.addEventListener("input", workbenchController.handleCatalogInput);
  elements.residentialList.addEventListener("change", workbenchController.handleCatalogInput);
  elements.residentialList.addEventListener("click", workbenchController.handleCatalogClick);

  const greedyBindings = [
    ["greedyLocalSearch", "localSearch", "checkbox"],
    ["greedyRandomSeed", "randomSeed", "number"],
    ["greedyTimeLimitSeconds", "timeLimitSeconds", "number"],
    ["greedyProfile", "profile", "checkbox"],
    ["greedyDensityTieBreaker", "densityTieBreaker", "checkbox"],
    ["greedyDensityTieBreakerTolerancePercent", "densityTieBreakerTolerancePercent", "number"],
    ["greedyRestarts", "restarts", "number"],
    ["greedyServiceRefineIterations", "serviceRefineIterations", "number"],
    ["greedyServiceRefineCandidateLimit", "serviceRefineCandidateLimit", "number"],
    ["greedyExhaustiveServiceSearch", "exhaustiveServiceSearch", "checkbox"],
    ["greedyDiagnostics", "diagnostics", "checkbox"],
    ["greedyServiceExactPoolLimit", "serviceExactPoolLimit", "number"],
    ["greedyServiceExactMaxCombinations", "serviceExactMaxCombinations", "number"]
  ];

  greedyBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.greedy[stateKey] = inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      requestBuilderController.updatePayloadPreview();
    });
  });

  const lnsBindings = [
    ["lnsIterations", "iterations"],
    ["lnsMaxNoImprovementIterations", "maxNoImprovementIterations"],
    ["lnsNeighborhoodRows", "neighborhoodRows"],
    ["lnsNeighborhoodCols", "neighborhoodCols"],
    ["lnsRepairTimeLimitSeconds", "repairTimeLimitSeconds"]
  ];

  lnsBindings.forEach(([elementKey, stateKey]) => {
    elements[elementKey].addEventListener("input", () => {
      state.lns[stateKey] = elements[elementKey].value;
      requestBuilderController.updatePayloadPreview();
    });
  });

  elements.lnsUseDisplayedSeed.addEventListener("change", () => {
    state.lns.useDisplayedSeed = elements.lnsUseDisplayedSeed.checked;
    requestBuilderController.updatePayloadPreview();
  });

  if (elements.autoWallClockLimitSeconds) {
    elements.autoWallClockLimitSeconds.addEventListener("input", () => {
      state.auto.wallClockLimitSeconds = elements.autoWallClockLimitSeconds.value;
      requestBuilderController.updatePayloadPreview();
    });
  }
  if (elements.autoContinueAfterPopulationCapSeconds) {
    elements.autoContinueAfterPopulationCapSeconds.addEventListener("input", () => {
      state.auto.continueAfterPopulationCapSeconds = elements.autoContinueAfterPopulationCapSeconds.value;
      requestBuilderController.updatePayloadPreview();
    });
  }
  if (elements.autoPopulationCapGracePresetButton) {
    elements.autoPopulationCapGracePresetButton.addEventListener("click", () => {
      state.auto.continueAfterPopulationCapSeconds = "300";
      workbenchController.syncSolverFields();
      requestBuilderController.updatePayloadPreview();
      shellController.setSolveState("Auto will keep exploring for 5 minutes after the population cap is reached.");
    });
  }

  const cpSatBindings = [
    ["cpSatTimeLimitSeconds", "timeLimitSeconds", "number"],
    ["cpSatNoImprovementTimeoutSeconds", "noImprovementTimeoutSeconds", "number"],
    ["cpSatRandomSeed", "randomSeed", "number"],
    ["cpSatNumWorkers", "numWorkers", "number"],
    ["cpSatLogSearchProgress", "logSearchProgress", "checkbox"]
  ];

  cpSatBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.cpSat[stateKey] = inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      requestBuilderController.updatePayloadPreview();
    });
  });

  elements.cpSatUseDisplayedHint.addEventListener("change", () => {
    state.cpSat.useDisplayedHint = elements.cpSatUseDisplayedHint.checked;
    requestBuilderController.updatePayloadPreview();
  });

  elements.cpSatPortfolioEnabled.addEventListener("change", () => {
    state.cpSat.portfolio.enabled = elements.cpSatPortfolioEnabled.checked;
    workbenchController.syncSolverFields();
    requestBuilderController.updatePayloadPreview();
  });

  const cpSatPortfolioBindings = [
    ["cpSatPortfolioWorkerCount", "workerCount", "number"],
    ["cpSatPortfolioRandomSeeds", "randomSeeds", "text"],
    ["cpSatPortfolioPerWorkerTimeLimitSeconds", "perWorkerTimeLimitSeconds", "number"],
    ["cpSatPortfolioPerWorkerNumWorkers", "perWorkerNumWorkers", "number"],
    ["cpSatPortfolioRandomizeSearch", "randomizeSearch", "checkbox"]
  ];

  cpSatPortfolioBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.cpSat.portfolio[stateKey] =
        inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      workbenchController.syncSolverFields();
      requestBuilderController.updatePayloadPreview();
    });
  });

  elements.maxServices.addEventListener("input", () => {
    state.availableBuildings.services = elements.maxServices.value;
    requestBuilderController.updatePayloadPreview();
  });

  elements.maxResidentials.addEventListener("input", () => {
    state.availableBuildings.residentials = elements.maxResidentials.value;
    requestBuilderController.updatePayloadPreview();
  });

  elements.expansionNextService.addEventListener("input", () => {
    state.expansionAdvice.nextServiceText = elements.expansionNextService.value;
    state.expansionAdvice.result = null;
    state.expansionAdvice.error = "";
    expansionAdviceController.renderExpansionAdvice();
    shellController.syncActionAvailability();
  });

  elements.expansionNextResidential.addEventListener("input", () => {
    state.expansionAdvice.nextResidentialText = elements.expansionNextResidential.value;
    state.expansionAdvice.result = null;
    state.expansionAdvice.error = "";
    expansionAdviceController.renderExpansionAdvice();
    shellController.syncActionAvailability();
  });

  elements.layoutEditModeToggle.addEventListener("click", resultsController.handleLayoutEditToggleClick);
  elements.remainingServiceList.addEventListener("click", resultsController.handleRemainingPlacementClick);
  elements.remainingResidentialList.addEventListener("click", resultsController.handleRemainingPlacementClick);
  elements.rotatePendingPlacementButton.addEventListener("click", resultsController.handleRotatePendingPlacementAction);
  elements.validateEditedLayoutButton.addEventListener("click", resultsController.handleValidateEditedLayoutAction);
  elements.moveSelectedBuildingButton.addEventListener("click", resultsController.handleMoveSelectedAction);
  elements.removeSelectedBuildingButton.addEventListener("click", resultsController.handleRemoveSelectedAction);
  elements.resultMapGrid.addEventListener("click", resultsController.handleResultMapClick);
  if (elements.resultExplainabilityModeToggle) {
    syncResultExplainabilityModeControl();
    elements.resultExplainabilityModeToggle.addEventListener(
      "click",
      /** @param {Event} event */ (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest("button[data-result-explainability-mode]");
        if (!(button instanceof HTMLButtonElement)) return;
        state.resultExplainabilityMode = normalizeResultExplainabilityMode(
          button.dataset.resultExplainabilityMode ?? "layout"
        );
        syncResultExplainabilityModeControl();
        resultsController.renderResults();
      }
    );
  } else if (elements.resultHeatmapToggle) {
    elements.resultHeatmapToggle.checked = Boolean(state.resultHeatmapEnabled);
    elements.resultHeatmapToggle.addEventListener("change", () => {
      state.resultHeatmapEnabled = elements.resultHeatmapToggle.checked;
      state.resultExplainabilityMode = state.resultHeatmapEnabled ? "service-value" : "layout";
      resultsController.renderResults();
    });
  }

  elements.compareExpansionButton.addEventListener("click", () => {
    expansionAdviceController.compareExpansionOptions();
  });

  elements.importCatalogTextButton.addEventListener("click", () => {
    workbenchController.importCatalogText();
  });

  elements.saveConfigButton.addEventListener("click", () => {
    persistenceController.saveCurrentConfig();
  });

  elements.loadConfigButton.addEventListener("click", () => {
    persistenceController.loadSelectedConfig();
  });
  elements.exportConfigsButton.addEventListener("click", () => persistenceController.exportSavedConfigs());
  elements.importConfigsButton.addEventListener("click", () => elements.configImportFileInput.click());
  elements.configImportFileInput.addEventListener("change", async () => {
    await persistenceController.importSavedConfigsFromFile(elements.configImportFileInput.files?.[0]);
    elements.configImportFileInput.value = "";
  });

  elements.deleteConfigButton.addEventListener("click", () => {
    persistenceController.deleteSelectedConfig();
  });

  elements.saveLayoutButton.addEventListener("click", () => {
    persistenceController.saveCurrentLayout();
  });

  elements.loadLayoutButton.addEventListener("click", () => {
    persistenceController.loadSelectedLayout();
  });
  elements.exportLayoutsButton.addEventListener("click", () => persistenceController.exportSavedLayouts());
  elements.importLayoutsButton.addEventListener("click", () => elements.layoutImportFileInput.click());
  elements.layoutImportFileInput.addEventListener("change", async () => {
    await persistenceController.importSavedLayoutsFromFile(elements.layoutImportFileInput.files?.[0]);
    elements.layoutImportFileInput.value = "";
  });

  elements.deleteLayoutButton.addEventListener("click", () => {
    persistenceController.deleteSelectedLayout();
  });

  elements.solveButton.addEventListener("click", () => {
    solveRuntimeController.runSolve();
  });
  elements.stopSolveButton.addEventListener("click", () => {
    solveRuntimeController.requestStopSolve();
  });

  void solveRuntimeController.resumeActiveSolve();
}

init();
