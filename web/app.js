const SAMPLE_GRID = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
];

const DEFAULT_SERVICE_TYPES = [
  { name: "Elementary School", bonus: "126", size: "2x2", effective: "12x12", avail: "1" },
  { name: "Town Bank", bonus: "224", size: "2x2", effective: "12x12", avail: "1" },
  { name: "Health Clinic", bonus: "108", size: "2x2", effective: "10x10", avail: "1" },
  { name: "Gas Station", bonus: "118", size: "2x2", effective: "12x12", avail: "1" },
  { name: "Townsquare", bonus: "115", size: "2x2", effective: "10x10", avail: "1" },
  { name: "Fire Station", bonus: "204", size: "2x2", effective: "10x10", avail: "1" },
  { name: "Mining Museum", bonus: "224", size: "2x2", effective: "12x12", avail: "1" },
  { name: "Square", bonus: "364", size: "2x3", effective: "10x11", avail: "1" },
  { name: "Park", bonus: "215", size: "2x3", effective: "12x13", avail: "1" },
  { name: "Congress Center", bonus: "270", size: "4x2", effective: "14x12", avail: "1" },
  { name: "Cinema", bonus: "189", size: "2x2", effective: "10x10", avail: "1" },
  { name: "Supermarket", bonus: "386", size: "3x2", effective: "13x12", avail: "1" },
];

const DEFAULT_RESIDENTIAL_TYPES = [
  { name: "Suburban Residence", resident: "150/450", size: "2x2", avail: "3" },
  { name: "The Belvedere", resident: "520/1560", size: "2x3", avail: "2" },
  { name: "The Aurora", resident: "600/1800", size: "2x2", avail: "1" },
  { name: "Radiant Residence", resident: "260/780", size: "2x3", avail: "2" },
  { name: "The Metropolis", resident: "480/1440", size: "2x3", avail: "2" },
  { name: "The Rockefeller", resident: "260/780", size: "2x2", avail: "2" },
  { name: "The Gatsby", resident: "320/960", size: "2x2", avail: "2" },
  { name: "Monrose Residences", resident: "160/480", size: "2x2", avail: "2" },
  { name: "The Palisades", resident: "240/720", size: "2x3", avail: "3" },
  { name: "The Ambassador", resident: "540/1620", size: "2x3", avail: "2" },
  { name: "Pinnacle suites", resident: "720/2160", size: "2x3", avail: "2" },
  { name: "The Elysian", resident: "250/750", size: "2x3", avail: "3" },
  { name: "The Broadway", resident: "750/2250", size: "2x3", avail: "2" },
  { name: "Opal Vista", resident: "500/1500", size: "2x3", avail: "1" },
  { name: "The Eisenhower", resident: "280/840", size: "2x2", avail: "2" },
  { name: "The Grand Eden", resident: "300/900", size: "2x2", avail: "1" },
  { name: "Celestial", resident: "300/900", size: "2x2", avail: "1" },
  { name: "The Jetset", resident: "480/1440", size: "2x2", avail: "1" },
  { name: "The Cosmopolitan", resident: "500/1500", size: "2x3", avail: "2" },
  { name: "Golden Era Estates", resident: "720/2160", size: "2x3", avail: "2" },
  { name: "Heritage House", resident: "300/900", size: "2x2", avail: "2" },
  { name: "Vintage Vista", resident: "140/420", size: "2x2", avail: "2" },
  { name: "Serenade Pointe", resident: "500/1500", size: "2x2", avail: "1" },
  { name: "Serene Heights", resident: "150/450", size: "2x2", avail: "1" },
];

const CONFIG_STORAGE_KEY = "city-builder:planner-configs:v1";
const LAYOUT_STORAGE_KEY = "city-builder:planner-layouts:v1";
const SOLVE_STATUS_POLL_INTERVAL_MS = 1000;
const LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 5 * 1000;
const COMPARISON_PROGRESS_HINT_INTERVAL_MS = 60 * 1000;

const plannerModules = {
  shell: window.CityBuilderShell,
  shared: window.CityBuilderShared,
  persistence: window.CityBuilderPersistence,
  solveRuntime: window.CityBuilderSolveRuntime,
  expansion: window.CityBuilderExpansion,
  results: window.CityBuilderResults,
  requestBuilder: window.CityBuilderRequestBuilder,
  workbench: window.CityBuilderWorkbench,
};

if (Object.values(plannerModules).some((module) => !module)) {
  throw new Error(
    "plannerShell.js, plannerShared.js, plannerPersistence.js, plannerSolveRuntime.js, plannerExpansion.js, plannerResults.js, plannerRequestBuilder.js, and plannerWorkbench.js must load before app.js"
  );
}

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
  isGridLike,
  normalizeElapsedMs,
  normalizeOptimizer,
  parseCatalogImportText,
  parseResidentialCatalogEntry,
  parseServiceCatalogEntry,
  readOptionalInteger,
  serializeResidentialTypeForCatalog,
  serializeServiceTypeForCatalog,
} = plannerModules.shared;
const { createPlannerShellController } = plannerModules.shell;
const { createPlannerPersistence } = plannerModules.persistence;
const { createSolveRuntime } = plannerModules.solveRuntime;
const { createExpansionAdviceController } = plannerModules.expansion;
const { createPlannerResultsController } = plannerModules.results;
const { createPlannerRequestBuilderController } = plannerModules.requestBuilder;
const { createPlannerWorkbenchController } = plannerModules.workbench;

const state = {
  grid: cloneGrid(SAMPLE_GRID),
  paintMode: "toggle",
  optimizer: "auto",
  serviceTypes: DEFAULT_SERVICE_TYPES.map((entry) => ({ ...entry })),
  residentialTypes: DEFAULT_RESIDENTIAL_TYPES.map((entry) => ({ ...entry })),
  availableBuildings: {
    services: "",
    residentials: "",
  },
  // Standalone Greedy intentionally uses the heavy heuristic profile; Auto clamps
  // these values when it only needs a fast seed stage.
  greedy: {
    localSearch: true,
    randomSeed: "",
    restarts: 20,
    serviceRefineIterations: 4,
    serviceRefineCandidateLimit: 60,
    exhaustiveServiceSearch: true,
    diagnostics: false,
    serviceExactPoolLimit: 22,
    serviceExactMaxCombinations: 12000,
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
      perWorkerTimeLimitSeconds: "30",
      perWorkerNumWorkers: 1,
      randomizeSearch: true,
    },
  },
  lns: {
    iterations: 12,
    maxNoImprovementIterations: 4,
    neighborhoodRows: 6,
    neighborhoodCols: 8,
    repairTimeLimitSeconds: 5,
    useDisplayedSeed: true,
  },
  auto: {
    wallClockLimitSeconds: "",
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
  solveProgressLog: [],
  selectedMapBuilding: null,
  selectedMapCell: null,
  layoutEditor: {
    mode: "inspect",
    pendingPlacement: null,
    isApplying: false,
    edited: false,
    pendingValidation: false,
    status: "",
  },
  expansionAdvice: {
    isRunning: false,
    nextServiceText: "",
    nextResidentialText: "",
    status: "",
    result: null,
    error: "",
  },
};

const elements = {
  gridRows: document.querySelector("#gridRows"),
  gridCols: document.querySelector("#gridCols"),
  gridEditor: document.querySelector("#gridEditor"),
  gridStats: document.querySelector("#gridStats"),
  paintModeToggle: document.querySelector("#paintModeToggle"),
  solverToggle: document.querySelector("#solverToggle"),
  runtimePresetButtons: document.querySelector("#runtimePresetButtons"),
  runtimePresetStatus: document.querySelector("#runtimePresetStatus"),
  autoPanel: document.querySelector("#autoPanel"),
  autoWallClockLimitSeconds: document.querySelector("#autoWallClockLimitSeconds"),
  greedyPanel: document.querySelector("#greedyPanel"),
  lnsPanel: document.querySelector("#lnsPanel"),
  cpSatPanel: document.querySelector("#cpSatPanel"),
  maxServices: document.querySelector("#maxServices"),
  maxResidentials: document.querySelector("#maxResidentials"),
  catalogImportText: document.querySelector("#catalogImportText"),
  importCatalogTextButton: document.querySelector("#importCatalogTextButton"),
  catalogImportStatus: document.querySelector("#catalogImportStatus"),
  addServiceTypeButton: document.querySelector("#addServiceTypeButton"),
  addResidentialTypeButton: document.querySelector("#addResidentialTypeButton"),
  serviceList: document.querySelector("#serviceList"),
  residentialList: document.querySelector("#residentialList"),
  solveButton: document.querySelector("#solveButton"),
  stopSolveButton: document.querySelector("#stopSolveButton"),
  solveStatus: document.querySelector("#solveStatus"),
  solveTimer: document.querySelector("#solveTimer"),
  configStorageName: document.querySelector("#configStorageName"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  savedConfigsSelect: document.querySelector("#savedConfigsSelect"),
  loadConfigButton: document.querySelector("#loadConfigButton"),
  deleteConfigButton: document.querySelector("#deleteConfigButton"),
  configStorageStatus: document.querySelector("#configStorageStatus"),
  payloadPreview: document.querySelector("#payloadPreview"),
  summaryGridSize: document.querySelector("#summaryGridSize"),
  summaryAllowedCells: document.querySelector("#summaryAllowedCells"),
  summaryServiceTypes: document.querySelector("#summaryServiceTypes"),
  summaryResidentialTypes: document.querySelector("#summaryResidentialTypes"),
  summaryOptimizer: document.querySelector("#summaryOptimizer"),
  resultsEmpty: document.querySelector("#resultsEmpty"),
  resultsContent: document.querySelector("#resultsContent"),
  resultBadge: document.querySelector("#resultBadge"),
  validationNotice: document.querySelector("#validationNotice"),
  resultPopulation: document.querySelector("#resultPopulation"),
  resultRoadCount: document.querySelector("#resultRoadCount"),
  resultServiceCount: document.querySelector("#resultServiceCount"),
  resultResidentialCount: document.querySelector("#resultResidentialCount"),
  resultElapsed: document.querySelector("#resultElapsed"),
  resultSolverStatus: document.querySelector("#resultSolverStatus"),
  resultProgressSummary: document.querySelector("#resultProgressSummary"),
  resultProgressLog: document.querySelector("#resultProgressLog"),
  expansionNextService: document.querySelector("#expansionNextService"),
  expansionNextResidential: document.querySelector("#expansionNextResidential"),
  compareExpansionButton: document.querySelector("#compareExpansionButton"),
  expansionAdviceStatus: document.querySelector("#expansionAdviceStatus"),
  expansionAdviceMetrics: document.querySelector("#expansionAdviceMetrics"),
  expansionAdviceWinner: document.querySelector("#expansionAdviceWinner"),
  expansionAdviceBaseline: document.querySelector("#expansionAdviceBaseline"),
  expansionAdviceServiceOutcome: document.querySelector("#expansionAdviceServiceOutcome"),
  expansionAdviceResidentialOutcome: document.querySelector("#expansionAdviceResidentialOutcome"),
  serviceResultList: document.querySelector("#serviceResultList"),
  residentialResultList: document.querySelector("#residentialResultList"),
  remainingServiceList: document.querySelector("#remainingServiceList"),
  remainingResidentialList: document.querySelector("#remainingResidentialList"),
  resultMapGrid: document.querySelector("#resultMapGrid"),
  resultOverlay: document.querySelector("#resultOverlay"),
  layoutEditModeToggle: document.querySelector("#layoutEditModeToggle"),
  rotatePendingPlacementButton: document.querySelector("#rotatePendingPlacementButton"),
  validateEditedLayoutButton: document.querySelector("#validateEditedLayoutButton"),
  layoutEditorStatus: document.querySelector("#layoutEditorStatus"),
  selectedBuildingTitle: document.querySelector("#selectedBuildingTitle"),
  selectedBuildingSummary: document.querySelector("#selectedBuildingSummary"),
  moveSelectedBuildingButton: document.querySelector("#moveSelectedBuildingButton"),
  removeSelectedBuildingButton: document.querySelector("#removeSelectedBuildingButton"),
  selectedBuildingFacts: document.querySelector("#selectedBuildingFacts"),
  selectedBuildingId: document.querySelector("#selectedBuildingId"),
  selectedBuildingCategory: document.querySelector("#selectedBuildingCategory"),
  selectedBuildingPosition: document.querySelector("#selectedBuildingPosition"),
  selectedBuildingFootprint: document.querySelector("#selectedBuildingFootprint"),
  selectedBuildingEffect: document.querySelector("#selectedBuildingEffect"),
  selectedBuildingAvailability: document.querySelector("#selectedBuildingAvailability"),
  layoutStorageName: document.querySelector("#layoutStorageName"),
  saveLayoutButton: document.querySelector("#saveLayoutButton"),
  savedLayoutsSelect: document.querySelector("#savedLayoutsSelect"),
  loadLayoutButton: document.querySelector("#loadLayoutButton"),
  deleteLayoutButton: document.querySelector("#deleteLayoutButton"),
  layoutStorageStatus: document.querySelector("#layoutStorageStatus"),
  greedyLocalSearch: document.querySelector("#greedyLocalSearch"),
  greedyRandomSeed: document.querySelector("#greedyRandomSeed"),
  greedyRestarts: document.querySelector("#greedyRestarts"),
  greedyServiceRefineIterations: document.querySelector("#greedyServiceRefineIterations"),
  greedyServiceRefineCandidateLimit: document.querySelector("#greedyServiceRefineCandidateLimit"),
  greedyExhaustiveServiceSearch: document.querySelector("#greedyExhaustiveServiceSearch"),
  greedyDiagnostics: document.querySelector("#greedyDiagnostics"),
  greedyServiceExactPoolLimit: document.querySelector("#greedyServiceExactPoolLimit"),
  greedyServiceExactMaxCombinations: document.querySelector("#greedyServiceExactMaxCombinations"),
  greedyDiagnosticsBlock: document.querySelector("#greedyDiagnosticsBlock"),
  greedyDiagnosticsSummary: document.querySelector("#greedyDiagnosticsSummary"),
  greedyDiagnosticsServiceList: document.querySelector("#greedyDiagnosticsServiceList"),
  greedyDiagnosticsResidentialList: document.querySelector("#greedyDiagnosticsResidentialList"),
  lnsIterations: document.querySelector("#lnsIterations"),
  lnsMaxNoImprovementIterations: document.querySelector("#lnsMaxNoImprovementIterations"),
  lnsNeighborhoodRows: document.querySelector("#lnsNeighborhoodRows"),
  lnsNeighborhoodCols: document.querySelector("#lnsNeighborhoodCols"),
  lnsRepairTimeLimitSeconds: document.querySelector("#lnsRepairTimeLimitSeconds"),
  lnsPythonExecutable: document.querySelector("#lnsPythonExecutable"),
  lnsUseDisplayedSeed: document.querySelector("#lnsUseDisplayedSeed"),
  cpSatTimeLimitSeconds: document.querySelector("#cpSatTimeLimitSeconds"),
  cpSatNoImprovementTimeoutSeconds: document.querySelector("#cpSatNoImprovementTimeoutSeconds"),
  cpSatRandomSeed: document.querySelector("#cpSatRandomSeed"),
  cpSatNumWorkers: document.querySelector("#cpSatNumWorkers"),
  cpSatLogSearchProgress: document.querySelector("#cpSatLogSearchProgress"),
  cpSatPythonExecutable: document.querySelector("#cpSatPythonExecutable"),
  cpSatUseDisplayedHint: document.querySelector("#cpSatUseDisplayedHint"),
  cpSatPortfolioEnabled: document.querySelector("#cpSatPortfolioEnabled"),
  cpSatPortfolioWorkerCount: document.querySelector("#cpSatPortfolioWorkerCount"),
  cpSatPortfolioRandomSeeds: document.querySelector("#cpSatPortfolioRandomSeeds"),
  cpSatPortfolioPerWorkerTimeLimitSeconds: document.querySelector("#cpSatPortfolioPerWorkerTimeLimitSeconds"),
  cpSatPortfolioPerWorkerNumWorkers: document.querySelector("#cpSatPortfolioPerWorkerNumWorkers"),
  cpSatPortfolioRandomizeSearch: document.querySelector("#cpSatPortfolioRandomizeSearch"),
  lnsSeedStatus: document.querySelector("#lnsSeedStatus"),
  cpSatHintStatus: document.querySelector("#cpSatHintStatus"),
  resizeGridButton: document.querySelector("#resizeGridButton"),
  fillAllowedButton: document.querySelector("#fillAllowedButton"),
  clearGridButton: document.querySelector("#clearGridButton"),
  sampleGridButton: document.querySelector("#sampleGridButton"),
};

let expansionAdviceController = null;
let resultsController = null;
let requestBuilderController = null;
let workbenchController = null;

function readExpansionCandidateFlagsFallback() {
  const hasServiceCandidate = Boolean(String(state.expansionAdvice.nextServiceText ?? "").trim());
  const hasResidentialCandidate = Boolean(String(state.expansionAdvice.nextResidentialText ?? "").trim());
  return {
    hasServiceCandidate,
    hasResidentialCandidate,
    hasAnyCandidate: hasServiceCandidate || hasResidentialCandidate,
    hasBothCandidates: hasServiceCandidate && hasResidentialCandidate,
  };
}

const shellController = createPlannerShellController({
  state,
  elements,
  callbacks: {
    hasSelectedBuilding: () => resultsController?.hasSelectedBuilding(),
    readExpansionCandidateFlags: () => expansionAdviceController?.readExpansionCandidateFlags() ?? readExpansionCandidateFlagsFallback(),
  },
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
    readOptionalInteger,
  },
});

workbenchController = createPlannerWorkbenchController({
  state,
  elements,
  constants: {
    sampleGrid: SAMPLE_GRID,
  },
  helpers: {
    cloneGrid,
    createGrid,
    escapeHtml,
    isGridLike,
    normalizeOptimizer,
    parseCatalogImportText,
    serializeResidentialTypeForCatalog,
    serializeServiceTypeForCatalog,
  },
  callbacks: {
    getOptimizerLabel: shellController.getOptimizerLabel,
    refreshResultOverlay: () => resultsController?.refreshResultOverlay(),
    renderExpansionAdvice: () => expansionAdviceController?.renderExpansionAdvice(),
    setSolveState: shellController.setSolveState,
    updatePayloadPreview: () => requestBuilderController?.updatePayloadPreview(),
  },
});

expansionAdviceController = createExpansionAdviceController({
  state,
  elements,
  constants: {
    COMPARISON_PROGRESS_HINT_INTERVAL_MS,
    SOLVE_STATUS_POLL_INTERVAL_MS,
  },
  helpers: {
    buildCpSatContinuationModelInput,
    cloneJson,
    computeCpSatModelFingerprint,
    createSolveRequestId,
    delay,
    parseResidentialCatalogEntry,
    parseServiceCatalogEntry,
  },
  callbacks: {
    buildSolveRequest: requestBuilderController.buildSolveRequest,
    getDisplayedLayoutCheckpoint: requestBuilderController.getDisplayedLayoutCheckpoint,
    getDisplayedLayoutSourceLabel: requestBuilderController.getDisplayedLayoutSourceLabel,
    getOptimizerLabel: shellController.getOptimizerLabel,
    syncActionAvailability: shellController.syncActionAvailability,
  },
});

resultsController = createPlannerResultsController({
  state,
  elements,
  helpers: {
    cloneJson,
    formatElapsedTime,
  },
  callbacks: {
    applyMatrixLayout: workbenchController.applyMatrixLayout,
    clearExpansionAdvice,
    getOptimizerLabel: shellController.getOptimizerLabel,
    renderExpansionAdvice: expansionAdviceController.renderExpansionAdvice,
    setSolveState: shellController.setSolveState,
    syncActionAvailability: shellController.syncActionAvailability,
  },
});

const solveRuntimeController = createSolveRuntime({
  state,
  elements,
  constants: {
    LIVE_SNAPSHOT_REFRESH_INTERVAL_MS,
    SOLVE_STATUS_POLL_INTERVAL_MS,
  },
  helpers: {
    createSolveRequestId,
    delay,
    formatElapsedTime,
    normalizeElapsedMs,
  },
  callbacks: {
    buildSolveRequest: requestBuilderController.buildSolveRequest,
    clearExpansionAdvice,
    ensureCpSatRandomSeed: requestBuilderController.ensureCpSatRandomSeed,
    getDisplayedLayoutCheckpoint: requestBuilderController.getDisplayedLayoutCheckpoint,
    getOptimizerLabel: shellController.getOptimizerLabel,
    renderResults: resultsController.renderResults,
    setSolveState: shellController.setSolveState,
  },
});

const persistenceController = createPlannerPersistence({
  state,
  elements,
  constants: {
    CONFIG_STORAGE_KEY,
    LAYOUT_STORAGE_KEY,
    defaultResidentialTypes: DEFAULT_RESIDENTIAL_TYPES,
    defaultServiceTypes: DEFAULT_SERVICE_TYPES,
    sampleGrid: SAMPLE_GRID,
  },
  helpers: {
    buildCpSatWarmStartCheckpoint,
    cloneGrid,
    cloneJson,
    createSavedEntryId,
    formatElapsedTime,
    formatSavedTimestamp,
    getSavedLayoutElapsedMs,
    isGridLike,
    normalizeElapsedMs,
    normalizeOptimizer,
  },
  callbacks: {
    applySolveRequestToPlanner: workbenchController.applySolveRequestToPlanner,
    clearExpansionAdvice,
    clearRenderedResultState,
    renderResults: resultsController.renderResults,
    resetSolveTimer: solveRuntimeController.resetSolveTimer,
    setResultElapsed: solveRuntimeController.setResultElapsed,
    setSolveState: shellController.setSolveState,
    syncPlannerFromState: workbenchController.syncPlannerFromState,
  },
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
  workbenchController.initResizeHandling();
  requestAnimationFrame(() => workbenchController.refreshMatrixLayouts());

  elements.paintModeToggle.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.paintMode) return;
    workbenchController.setPaintMode(button.dataset.paintMode);
  });

  elements.solverToggle.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.optimizer) return;
    workbenchController.setOptimizer(button.dataset.optimizer);
    requestBuilderController.updatePayloadPreview();
  });

  elements.runtimePresetButtons.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.runtimePreset) return;
    workbenchController.applyRuntimePreset(button.dataset.runtimePreset);
  });

  elements.resizeGridButton.addEventListener("click", () => {
    const rows = clampInteger(elements.gridRows.value, state.grid.length, 1);
    const cols = clampInteger(elements.gridCols.value, state.grid[0].length, 1);
    workbenchController.resizeGrid(rows, cols);
  });

  elements.fillAllowedButton.addEventListener("click", () => workbenchController.applyPreset("all"));
  elements.clearGridButton.addEventListener("click", () => workbenchController.applyPreset("clear"));
  elements.sampleGridButton.addEventListener("click", () => workbenchController.applyPreset("sample"));

  elements.gridEditor.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(".grid-cell");
    if (!(cell instanceof HTMLButtonElement)) return;
    state.isPainting = true;
    workbenchController.applyPaint(cell);
  });

  elements.gridEditor.addEventListener("pointerover", (event) => {
    if (!state.isPainting) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(".grid-cell");
    if (!(cell instanceof HTMLButtonElement)) return;
    workbenchController.applyPaint(cell);
  });

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
    ["greedyRestarts", "restarts", "number"],
    ["greedyServiceRefineIterations", "serviceRefineIterations", "number"],
    ["greedyServiceRefineCandidateLimit", "serviceRefineCandidateLimit", "number"],
    ["greedyExhaustiveServiceSearch", "exhaustiveServiceSearch", "checkbox"],
    ["greedyDiagnostics", "diagnostics", "checkbox"],
    ["greedyServiceExactPoolLimit", "serviceExactPoolLimit", "number"],
    ["greedyServiceExactMaxCombinations", "serviceExactMaxCombinations", "number"],
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
    ["lnsRepairTimeLimitSeconds", "repairTimeLimitSeconds"],
  ];

  lnsBindings.forEach(([elementKey, stateKey]) => {
    elements[elementKey].addEventListener("input", () => {
      state.lns[stateKey] = elements[elementKey].value;
      requestBuilderController.updatePayloadPreview();
    });
  });

  elements.lnsPythonExecutable.addEventListener("input", () => {
    state.cpSat.pythonExecutable = elements.lnsPythonExecutable.value;
    requestBuilderController.updatePayloadPreview();
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

  const cpSatBindings = [
    ["cpSatTimeLimitSeconds", "timeLimitSeconds", "number"],
    ["cpSatNoImprovementTimeoutSeconds", "noImprovementTimeoutSeconds", "number"],
    ["cpSatRandomSeed", "randomSeed", "number"],
    ["cpSatNumWorkers", "numWorkers", "number"],
    ["cpSatLogSearchProgress", "logSearchProgress", "checkbox"],
    ["cpSatPythonExecutable", "pythonExecutable", "text"],
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
    ["cpSatPortfolioRandomizeSearch", "randomizeSearch", "checkbox"],
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

  elements.deleteConfigButton.addEventListener("click", () => {
    persistenceController.deleteSelectedConfig();
  });

  elements.saveLayoutButton.addEventListener("click", () => {
    persistenceController.saveCurrentLayout();
  });

  elements.loadLayoutButton.addEventListener("click", () => {
    persistenceController.loadSelectedLayout();
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
}

init();
