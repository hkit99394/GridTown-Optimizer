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
  { name: "Elementary School", bonus: "126", size: "2x2", effective: "12x12" },
  { name: "Town Bank", bonus: "224", size: "2x2", effective: "12x12" },
  { name: "Health Clinic", bonus: "108", size: "2x2", effective: "10x10" },
  { name: "Gas Station", bonus: "118", size: "2x2", effective: "12x12" },
  { name: "Townsquare", bonus: "115", size: "2x2", effective: "10x10" },
  { name: "Fire Station", bonus: "204", size: "2x2", effective: "10x10" },
  { name: "Mining Museum", bonus: "224", size: "2x2", effective: "12x12" },
  { name: "Square", bonus: "364", size: "2x3", effective: "10x11" },
  { name: "Park", bonus: "215", size: "2x3", effective: "12x13" },
  { name: "Congress Center", bonus: "270", size: "4x2", effective: "14x12" },
  { name: "Cinema", bonus: "189", size: "2x2", effective: "10x10" },
  { name: "Supermarket", bonus: "386", size: "3x2", effective: "13x12" },
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
const LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 60 * 1000;

const state = {
  grid: cloneGrid(SAMPLE_GRID),
  paintMode: "toggle",
  optimizer: "greedy",
  serviceTypes: DEFAULT_SERVICE_TYPES.map((entry) => ({ ...entry })),
  residentialTypes: DEFAULT_RESIDENTIAL_TYPES.map((entry) => ({ ...entry })),
  availableBuildings: {
    services: "",
    residentials: "",
  },
  greedy: {
    localSearch: true,
    restarts: 20,
    serviceRefineIterations: 4,
    serviceRefineCandidateLimit: 60,
    exhaustiveServiceSearch: true,
    serviceExactPoolLimit: 22,
    serviceExactMaxCombinations: 12000,
  },
  cpSat: {
    timeLimitSeconds: "",
    numWorkers: 8,
    logSearchProgress: false,
    pythonExecutable: "",
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
  cpSatWarmStart: null,
};

const elements = {
  gridRows: document.querySelector("#gridRows"),
  gridCols: document.querySelector("#gridCols"),
  gridEditor: document.querySelector("#gridEditor"),
  gridStats: document.querySelector("#gridStats"),
  paintModeToggle: document.querySelector("#paintModeToggle"),
  solverToggle: document.querySelector("#solverToggle"),
  greedyPanel: document.querySelector("#greedyPanel"),
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
  serviceResultList: document.querySelector("#serviceResultList"),
  residentialResultList: document.querySelector("#residentialResultList"),
  resultMapGrid: document.querySelector("#resultMapGrid"),
  resultOverlay: document.querySelector("#resultOverlay"),
  layoutStorageName: document.querySelector("#layoutStorageName"),
  saveLayoutButton: document.querySelector("#saveLayoutButton"),
  savedLayoutsSelect: document.querySelector("#savedLayoutsSelect"),
  loadLayoutButton: document.querySelector("#loadLayoutButton"),
  deleteLayoutButton: document.querySelector("#deleteLayoutButton"),
  layoutStorageStatus: document.querySelector("#layoutStorageStatus"),
  greedyLocalSearch: document.querySelector("#greedyLocalSearch"),
  greedyRestarts: document.querySelector("#greedyRestarts"),
  greedyServiceRefineIterations: document.querySelector("#greedyServiceRefineIterations"),
  greedyServiceRefineCandidateLimit: document.querySelector("#greedyServiceRefineCandidateLimit"),
  greedyExhaustiveServiceSearch: document.querySelector("#greedyExhaustiveServiceSearch"),
  greedyServiceExactPoolLimit: document.querySelector("#greedyServiceExactPoolLimit"),
  greedyServiceExactMaxCombinations: document.querySelector("#greedyServiceExactMaxCombinations"),
  cpSatTimeLimitSeconds: document.querySelector("#cpSatTimeLimitSeconds"),
  cpSatNumWorkers: document.querySelector("#cpSatNumWorkers"),
  cpSatLogSearchProgress: document.querySelector("#cpSatLogSearchProgress"),
  cpSatPythonExecutable: document.querySelector("#cpSatPythonExecutable"),
  cpSatHintStatus: document.querySelector("#cpSatHintStatus"),
  clearCpSatHintButton: document.querySelector("#clearCpSatHintButton"),
  resizeGridButton: document.querySelector("#resizeGridButton"),
  fillAllowedButton: document.querySelector("#fillAllowedButton"),
  clearGridButton: document.querySelector("#clearGridButton"),
  sampleGridButton: document.querySelector("#sampleGridButton"),
  checkerGridButton: document.querySelector("#checkerGridButton"),
  useLayoutAsHintButton: document.querySelector("#useLayoutAsHintButton"),
};

function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

function createGrid(rows, cols, value = 1) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSavedEntryId() {
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    entries.sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort();
}

function buildServiceCandidateKey(service, typeIndex) {
  return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
}

function buildResidentialCandidateKey(residential, typeIndex) {
  return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
}

function serializeServiceTypeForCatalog(serviceType) {
  return {
    name: serviceType?.name ?? "",
    bonus: String(serviceType?.bonus ?? ""),
    size: `${serviceType?.rows ?? 0}x${serviceType?.cols ?? 0}`,
    effective: `${(serviceType?.rows ?? 0) + (serviceType?.range ?? 0) * 2}x${(serviceType?.cols ?? 0) + (serviceType?.range ?? 0) * 2}`,
  };
}

function serializeResidentialTypeForCatalog(residentialType) {
  return {
    name: residentialType?.name ?? "",
    resident: `${residentialType?.min ?? 0}/${residentialType?.max ?? 0}`,
    size: `${residentialType?.w ?? 0}x${residentialType?.h ?? 0}`,
    avail: String(residentialType?.avail ?? ""),
  };
}

function buildCpSatContinuationModelInput(request) {
  const params = request?.params ?? {};
  const modelParams = {
    optimizer: "cp-sat",
    ...(Array.isArray(params.serviceTypes) ? { serviceTypes: cloneJson(params.serviceTypes) } : {}),
    ...(Array.isArray(params.residentialTypes) ? { residentialTypes: cloneJson(params.residentialTypes) } : {}),
    ...(params.residentialSettings ? { residentialSettings: cloneJson(params.residentialSettings) } : {}),
    ...(params.basePop != null ? { basePop: params.basePop } : {}),
    ...(params.maxPop != null ? { maxPop: params.maxPop } : {}),
    ...(params.availableBuildings ? { availableBuildings: cloneJson(params.availableBuildings) } : {}),
    ...(params.maxServices != null ? { maxServices: params.maxServices } : {}),
    ...(params.maxResidentials != null ? { maxResidentials: params.maxResidentials } : {}),
  };

  return {
    grid: cloneGrid(request.grid),
    params: modelParams,
  };
}

function computeCpSatModelFingerprint(modelInput) {
  return `fnv1a:${hashString(stableStringify(modelInput))}`;
}

function buildCpSatWarmStartCheckpoint(result, resultContext, elapsedMs) {
  if (!result?.solution || !resultContext?.grid || !resultContext?.params) {
    throw new Error("This saved layout does not include enough data to build a CP-SAT hint.");
  }

  const solution = result.solution;
  const modelInput = buildCpSatContinuationModelInput(resultContext);
  const roadKeys = sortedUnique(Array.isArray(solution.roads) ? solution.roads : []);
  const serviceCandidateKeys = sortedUnique(
    (solution.services ?? []).map((service, index) => buildServiceCandidateKey(service, solution.serviceTypeIndices?.[index] ?? -1))
  );
  const residentialCandidateKeys = sortedUnique(
    (solution.residentials ?? []).map((residential, index) =>
      buildResidentialCandidateKey(residential, solution.residentialTypeIndices?.[index] ?? -1)
    )
  );
  const candidateUniverseHash = `fnv1a:${hashString(
    stableStringify({
      roads: roadKeys,
      services: serviceCandidateKeys,
      residentials: residentialCandidateKeys,
    })
  )}`;

  return {
    kind: "city-builder.cp-sat-checkpoint",
    version: 1,
    compatibility: {
      modelEncodingVersion: "cp-sat-layout-v1",
      candidateKeyVersion: 1,
      modelFingerprint: computeCpSatModelFingerprint(modelInput),
      candidateUniverseHash,
      createdWith: {},
    },
    modelInput,
    runtimeDefaults: {
      ...(resultContext.params?.cpSat?.numWorkers != null ? { numWorkers: resultContext.params.cpSat.numWorkers } : {}),
      ...(resultContext.params?.cpSat?.randomSeed != null ? { randomSeed: resultContext.params.cpSat.randomSeed } : {}),
      ...(resultContext.params?.cpSat?.randomizeSearch != null ? { randomizeSearch: resultContext.params.cpSat.randomizeSearch } : {}),
      ...(resultContext.params?.cpSat?.logSearchProgress != null ? { logSearchProgress: resultContext.params.cpSat.logSearchProgress } : {}),
    },
    incumbent: {
      status: solution.cpSatStatus === "OPTIMAL" ? "OPTIMAL" : "FEASIBLE",
      objective: {
        name: "totalPopulation",
        sense: "maximize",
        value: Number(solution.totalPopulation ?? 0),
        bestBound: null,
      },
      elapsedMs: normalizeElapsedMs(elapsedMs),
      stoppedByUser: Boolean(solution.stoppedByUser || result.stats?.stoppedByUser),
    },
    hint: {
      roadKeys,
      serviceCandidateKeys,
      residentialCandidateKeys,
      solution: {
        roads: roadKeys,
        services: (solution.services ?? []).map((service, index) => ({
          r: service.r,
          c: service.c,
          rows: service.rows,
          cols: service.cols,
          range: service.range,
          typeIndex: solution.serviceTypeIndices?.[index] ?? -1,
          bonus: solution.servicePopulationIncreases?.[index] ?? 0,
        })),
        residentials: (solution.residentials ?? []).map((residential, index) => ({
          r: residential.r,
          c: residential.c,
          rows: residential.rows,
          cols: residential.cols,
          typeIndex: solution.residentialTypeIndices?.[index] ?? -1,
          population: solution.populations?.[index] ?? 0,
        })),
        populations: cloneJson(solution.populations ?? []),
        totalPopulation: Number(solution.totalPopulation ?? 0),
      },
    },
    resumePolicy: {
      requireExactModelMatch: true,
      applyHints: true,
      repairHint: true,
      fixVariablesToHintedValue: false,
      objectiveCutoff: {
        op: ">=",
        value: Number(solution.totalPopulation ?? 0),
        preferStrictImprove: false,
      },
    },
  };
}

function getSavedLayoutCheckpoint(entry) {
  if (entry?.continueCpSat) {
    return cloneJson(entry.continueCpSat);
  }
  return buildCpSatWarmStartCheckpoint(entry?.result, entry?.resultContext, getSavedLayoutElapsedMs(entry));
}

function clearCpSatWarmStart(options = {}) {
  const { message = "", silent = false, refreshPreview = true } = options;
  state.cpSatWarmStart = null;
  if (refreshPreview) {
    updatePayloadPreview();
  } else {
    renderCpSatHintStatus();
  }
  if (!silent && message) {
    setSolveState(message);
  }
}

function applySolveRequestToPlanner(request, options = {}) {
  const { preserveCpSatRuntime = true, optimizer = "cp-sat" } = options;
  if (!isGridLike(request?.grid) || typeof request?.params !== "object" || request.params == null) {
    throw new Error("That saved layout does not include a usable planner configuration.");
  }

  const params = request.params;
  state.grid = cloneGrid(request.grid);
  state.serviceTypes = Array.isArray(params.serviceTypes)
    ? params.serviceTypes.map((serviceType) => serializeServiceTypeForCatalog(serviceType))
    : [];
  state.residentialTypes = Array.isArray(params.residentialTypes)
    ? params.residentialTypes.map((residentialType) => serializeResidentialTypeForCatalog(residentialType))
    : [];
  state.availableBuildings = {
    services: params.availableBuildings?.services != null ? String(params.availableBuildings.services) : (params.maxServices != null ? String(params.maxServices) : ""),
    residentials: params.availableBuildings?.residentials != null
      ? String(params.availableBuildings.residentials)
      : (params.maxResidentials != null ? String(params.maxResidentials) : ""),
  };
  state.optimizer = optimizer === "greedy" ? "greedy" : "cp-sat";

  if (!preserveCpSatRuntime && params.cpSat) {
    state.cpSat = {
      ...state.cpSat,
      ...(params.cpSat.timeLimitSeconds != null ? { timeLimitSeconds: String(params.cpSat.timeLimitSeconds) } : {}),
      ...(params.cpSat.numWorkers != null ? { numWorkers: params.cpSat.numWorkers } : {}),
      ...(params.cpSat.logSearchProgress != null ? { logSearchProgress: Boolean(params.cpSat.logSearchProgress) } : {}),
      ...(params.cpSat.pythonExecutable != null ? { pythonExecutable: String(params.cpSat.pythonExecutable) } : {}),
    };
  }

  syncPlannerFromState();
}

function renderCpSatHintStatus() {
  if (!elements.cpSatHintStatus || !elements.clearCpSatHintButton) return;
  if (!state.cpSatWarmStart) {
    elements.cpSatHintStatus.textContent = "No saved layout selected as a CP-SAT hint.";
    elements.clearCpSatHintButton.disabled = true;
    return;
  }

  const checkpoint = state.cpSatWarmStart.checkpoint;
  const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
  let message = `Using saved layout "${state.cpSatWarmStart.name}" as a CP-SAT hint. Best population ${population}.`;

  try {
    const previewRequest = buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false });
    const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
    if (state.optimizer !== "cp-sat") {
      message = `Saved layout "${state.cpSatWarmStart.name}" is selected as a hint. Switch to CP-SAT to use it.`;
    } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
      message = `Saved layout "${state.cpSatWarmStart.name}" is selected as a hint, but the current grid or building settings no longer match it.`;
    }
  } catch {
    if (state.optimizer !== "cp-sat") {
      message = `Saved layout "${state.cpSatWarmStart.name}" is selected as a hint. Switch to CP-SAT to use it.`;
    } else {
      message = `Saved layout "${state.cpSatWarmStart.name}" is selected as a hint. Finish the current inputs to use it.`;
    }
  }

  elements.cpSatHintStatus.textContent = message;
  elements.clearCpSatHintButton.disabled = state.isSolving ? true : false;
}

function formatSavedTimestamp(savedAt) {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function normalizeElapsedMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function readStoredEntries(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredEntries(storageKey, entries) {
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
}

function populateSavedSelect(selectElement, entries, placeholder, labelBuilder = null) {
  selectElement.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = placeholder;
  selectElement.append(emptyOption);

  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = labelBuilder ? labelBuilder(entry) : `${entry.name} • ${formatSavedTimestamp(entry.savedAt)}`;
    selectElement.append(option);
  });
}

function refreshSavedConfigOptions(selectedId = "") {
  const entries = readStoredEntries(CONFIG_STORAGE_KEY);
  populateSavedSelect(elements.savedConfigsSelect, entries, "Select a saved input setup");
  if (selectedId && entries.some((entry) => entry.id === selectedId)) {
    elements.savedConfigsSelect.value = selectedId;
  }
}

function refreshSavedLayoutOptions(selectedId = "") {
  const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
  populateSavedSelect(
    elements.savedLayoutsSelect,
    entries,
    "Select a saved layout",
    (entry) => `${entry.name} • ${formatElapsedTime(getSavedLayoutElapsedMs(entry))} • ${formatSavedTimestamp(entry.savedAt)}`
  );
  if (selectedId && entries.some((entry) => entry.id === selectedId)) {
    elements.savedLayoutsSelect.value = selectedId;
  }
}

function clampInteger(value, fallback, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.floor(number));
}

function readOptionalInteger(value, min = 1) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(min, Math.floor(number));
}

function createSolveRequestId() {
  return `solve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatElapsedTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSavedLayoutElapsedMs(entry) {
  return normalizeElapsedMs(entry?.elapsedMs ?? entry?.resultElapsedMs ?? entry?.result?.stats?.elapsedMs ?? 0);
}

function setResultElapsed(ms, options = {}) {
  const { syncTimerWhenIdle = false } = options;
  state.resultElapsedMs = normalizeElapsedMs(ms);
  if (elements.resultElapsed) {
    elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
  }
  if (syncTimerWhenIdle && !state.isSolving) {
    clearSolveTimerTicker();
    state.solveTimerStartedAt = 0;
    state.solveTimerElapsedMs = state.resultElapsedMs;
    state.solveTimerFrozen = true;
    renderSolveTimer();
  }
}

function renderSolveTimer() {
  elements.solveTimer.textContent = `Elapsed ${formatElapsedTime(state.solveTimerElapsedMs)}`;
}

function clearSolveTimerTicker() {
  if (state.solveTimerHandle) {
    window.clearInterval(state.solveTimerHandle);
    state.solveTimerHandle = 0;
  }
}

function syncSolveTimer() {
  if (!state.solveTimerStartedAt || state.solveTimerFrozen) {
    renderSolveTimer();
    return;
  }
  state.solveTimerElapsedMs = Date.now() - state.solveTimerStartedAt;
  renderSolveTimer();
}

function resetSolveTimer() {
  clearSolveTimerTicker();
  state.solveTimerStartedAt = 0;
  state.solveTimerElapsedMs = 0;
  state.solveTimerFrozen = true;
  renderSolveTimer();
}

function startSolveTimer() {
  clearSolveTimerTicker();
  state.solveTimerStartedAt = Date.now();
  state.solveTimerElapsedMs = 0;
  state.solveTimerFrozen = false;
  renderSolveTimer();
  state.solveTimerHandle = window.setInterval(syncSolveTimer, 250);
}

function pauseSolveTimer() {
  if (!state.solveTimerStartedAt || state.solveTimerFrozen) {
    renderSolveTimer();
    return;
  }
  state.solveTimerElapsedMs = Date.now() - state.solveTimerStartedAt;
  state.solveTimerFrozen = true;
  clearSolveTimerTicker();
  renderSolveTimer();
}

function resumeSolveTimer() {
  if (!state.solveTimerStartedAt || !state.solveTimerFrozen) return;
  state.solveTimerStartedAt = Date.now() - state.solveTimerElapsedMs;
  state.solveTimerFrozen = false;
  renderSolveTimer();
  state.solveTimerHandle = window.setInterval(syncSolveTimer, 250);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitTabularLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.includes("\t")) {
    return trimmed.split("\t").map((cell) => cell.trim());
  }
  return trimmed.split(/\s{2,}/).map((cell) => cell.trim());
}

function normalizeHeaderName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function parseCatalogImportBlock(lines) {
  if (!lines.length) return null;
  const header = splitTabularLine(lines[0]).map(normalizeHeaderName);
  const rows = lines.slice(1).map(splitTabularLine).filter((cells) => cells.length > 0);

  if (header.includes("name") && header.includes("resident") && header.includes("size") && header.includes("avail")) {
    const nameIndex = header.indexOf("name");
    const residentIndex = header.indexOf("resident");
    const sizeIndex = header.indexOf("size");
    const availIndex = header.indexOf("avail");
    return {
      kind: "residentials",
      rows: rows.map((cells) => ({
        name: cells[nameIndex] ?? "",
        resident: cells[residentIndex] ?? "",
        size: cells[sizeIndex] ?? "",
        avail: cells[availIndex] ?? "",
      })),
    };
  }

  if (header.includes("name") && header.includes("bonus") && header.includes("size") && header.includes("effective")) {
    const nameIndex = header.indexOf("name");
    const bonusIndex = header.indexOf("bonus");
    const sizeIndex = header.indexOf("size");
    const effectiveIndex = header.indexOf("effective");
    return {
      kind: "services",
      rows: rows.map((cells) => ({
        name: cells[nameIndex] ?? "",
        bonus: cells[bonusIndex] ?? "",
        size: cells[sizeIndex] ?? "",
        effective: cells[effectiveIndex] ?? "",
      })),
    };
  }

  return null;
}

function parseCatalogImportText(text) {
  const blocks = String(text ?? "")
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);

  let importedServices = null;
  let importedResidentials = null;

  for (const block of blocks) {
    const parsed = parseCatalogImportBlock(block);
    if (!parsed) continue;
    if (parsed.kind === "services") importedServices = parsed.rows;
    if (parsed.kind === "residentials") importedResidentials = parsed.rows;
  }

  if (!importedServices && !importedResidentials) {
    throw new Error("No supported table headers were found. Paste a service table, a residential table, or both.");
  }

  return {
    services: importedServices,
    residentials: importedResidentials,
  };
}

function getConfigSnapshot() {
  return {
    grid: cloneGrid(state.grid),
    optimizer: state.optimizer,
    serviceTypes: cloneJson(state.serviceTypes),
    residentialTypes: cloneJson(state.residentialTypes),
    availableBuildings: cloneJson(state.availableBuildings),
    greedy: cloneJson(state.greedy),
    cpSat: cloneJson(state.cpSat),
  };
}

function applyConfigSnapshot(snapshot) {
  state.grid = isGridLike(snapshot?.grid) ? cloneGrid(snapshot.grid) : cloneGrid(SAMPLE_GRID);
  state.optimizer = snapshot?.optimizer === "cp-sat" ? "cp-sat" : "greedy";
  state.serviceTypes = Array.isArray(snapshot?.serviceTypes)
    ? snapshot.serviceTypes.map((entry) => ({ ...entry }))
    : DEFAULT_SERVICE_TYPES.map((entry) => ({ ...entry }));
  state.residentialTypes = Array.isArray(snapshot?.residentialTypes)
    ? snapshot.residentialTypes.map((entry) => ({ ...entry }))
    : DEFAULT_RESIDENTIAL_TYPES.map((entry) => ({ ...entry }));
  state.availableBuildings = {
    services: snapshot?.availableBuildings?.services ?? "",
    residentials: snapshot?.availableBuildings?.residentials ?? "",
  };
  state.greedy = {
    ...state.greedy,
    ...(snapshot?.greedy ?? {}),
  };
  state.cpSat = {
    ...state.cpSat,
    ...(snapshot?.cpSat ?? {}),
  };
}

function clearRenderedResultState() {
  state.result = null;
  state.resultIsLiveSnapshot = false;
  state.resultError = "";
}

function isGridLike(grid) {
  return Array.isArray(grid)
    && grid.length > 0
    && grid.every((row) => Array.isArray(row) && row.length === grid[0].length && row.every((cell) => cell === 0 || cell === 1));
}

function syncPlannerFromState() {
  updateGridDimensionInputs();
  setOptimizer(state.optimizer);
  syncSolverFields();
  renderGrid();
  renderServiceTypes();
  renderResidentialTypes();
  updatePayloadPreview();
  updateSummary();
}

function saveCurrentConfig() {
  const name = elements.configStorageName.value.trim() || `Input ${new Date().toLocaleString()}`;
  const entries = readStoredEntries(CONFIG_STORAGE_KEY);
  const existingIndex = entries.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
  const id = existingIndex >= 0 ? entries[existingIndex].id : createSavedEntryId();
  const nextEntry = {
    id,
    name,
    savedAt: new Date().toISOString(),
    snapshot: getConfigSnapshot(),
  };
  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry;
  } else {
    entries.unshift(nextEntry);
  }
  writeStoredEntries(CONFIG_STORAGE_KEY, entries);
  refreshSavedConfigOptions(id);
  elements.configStorageName.value = name;
  elements.configStorageStatus.textContent = `Saved input setup "${name}".`;
}

function loadSelectedConfig() {
  if (state.isSolving) {
    elements.configStorageStatus.textContent = "Wait for the current solve to finish before loading a different input setup.";
    return;
  }
  const selectedId = elements.savedConfigsSelect.value;
  if (!selectedId) {
    elements.configStorageStatus.textContent = "Choose a saved input setup first.";
    return;
  }
  const entry = readStoredEntries(CONFIG_STORAGE_KEY).find((item) => item.id === selectedId);
  if (!entry?.snapshot) {
    elements.configStorageStatus.textContent = "That saved input setup could not be found.";
    refreshSavedConfigOptions();
    return;
  }
  clearCpSatWarmStart({ silent: true, refreshPreview: false });
  applyConfigSnapshot(entry.snapshot);
  clearRenderedResultState();
  state.resultContext = null;
  setResultElapsed(0);
  if (!state.isSolving) {
    resetSolveTimer();
  }
  syncPlannerFromState();
  renderResults();
  elements.configStorageName.value = entry.name;
  setSolveState(`Loaded input setup "${entry.name}".`);
  elements.configStorageStatus.textContent = `Loaded input setup "${entry.name}".`;
}

function deleteSelectedConfig() {
  const selectedId = elements.savedConfigsSelect.value;
  if (!selectedId) {
    elements.configStorageStatus.textContent = "Choose a saved input setup to delete.";
    return;
  }
  const entries = readStoredEntries(CONFIG_STORAGE_KEY);
  const entry = entries.find((item) => item.id === selectedId);
  writeStoredEntries(
    CONFIG_STORAGE_KEY,
    entries.filter((item) => item.id !== selectedId)
  );
  refreshSavedConfigOptions();
  elements.configStorageStatus.textContent = entry
    ? `Deleted input setup "${entry.name}".`
    : "Deleted the selected input setup.";
}

function saveCurrentLayout() {
  if (state.isSolving) {
    elements.layoutStorageStatus.textContent = "Wait for the current solve to finish before saving a layout.";
    return;
  }
  if (!state.result || !state.resultContext) {
    elements.layoutStorageStatus.textContent = "Run or load a result before saving a layout.";
    return;
  }
  const name = elements.layoutStorageName.value.trim() || `Layout ${new Date().toLocaleString()}`;
  const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
  const existingIndex = entries.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
  const id = existingIndex >= 0 ? entries[existingIndex].id : createSavedEntryId();
  const elapsedMs = normalizeElapsedMs(state.resultElapsedMs || state.solveTimerElapsedMs);
  const nextEntry = {
    id,
    name,
    savedAt: new Date().toISOString(),
    result: cloneJson(state.result),
    resultContext: cloneJson(state.resultContext),
    elapsedMs,
    continueCpSat: buildCpSatWarmStartCheckpoint(state.result, state.resultContext, elapsedMs),
  };
  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry;
  } else {
    entries.unshift(nextEntry);
  }
  writeStoredEntries(LAYOUT_STORAGE_KEY, entries);
  refreshSavedLayoutOptions(id);
  elements.layoutStorageName.value = name;
  elements.layoutStorageStatus.textContent = `Saved layout "${name}" with elapsed ${formatElapsedTime(elapsedMs)}.`;
}

function loadSelectedLayout() {
  if (state.isSolving) {
    elements.layoutStorageStatus.textContent = "Wait for the current solve to finish before loading a saved layout.";
    return;
  }
  const selectedId = elements.savedLayoutsSelect.value;
  if (!selectedId) {
    elements.layoutStorageStatus.textContent = "Choose a saved layout first.";
    return;
  }
  const entry = readStoredEntries(LAYOUT_STORAGE_KEY).find((item) => item.id === selectedId);
  if (!entry?.result || !entry?.resultContext) {
    elements.layoutStorageStatus.textContent = "That saved layout could not be found.";
    refreshSavedLayoutOptions();
    return;
  }
  clearCpSatWarmStart({ silent: true });
  state.result = cloneJson(entry.result);
  state.resultIsLiveSnapshot = false;
  state.resultContext = cloneJson(entry.resultContext);
  state.resultError = "";
  const elapsedMs = getSavedLayoutElapsedMs(entry);
  setResultElapsed(elapsedMs, { syncTimerWhenIdle: true });
  renderResults();
  elements.layoutStorageName.value = entry.name;
  setSolveState(`Loaded saved layout "${entry.name}" with elapsed ${formatElapsedTime(elapsedMs)}.`);
  elements.layoutStorageStatus.textContent = `Displaying saved layout "${entry.name}" with elapsed ${formatElapsedTime(elapsedMs)}.`;
}

function useSelectedLayoutAsCpSatHint() {
  if (state.isSolving) {
    elements.layoutStorageStatus.textContent = "Wait for the current solve to finish before selecting a CP-SAT hint.";
    return;
  }

  const selectedId = elements.savedLayoutsSelect.value;
  if (!selectedId) {
    elements.layoutStorageStatus.textContent = "Choose a saved layout first.";
    return;
  }

  const entry = readStoredEntries(LAYOUT_STORAGE_KEY).find((item) => item.id === selectedId);
  if (!entry?.result || !entry?.resultContext) {
    elements.layoutStorageStatus.textContent = "That saved layout could not be found.";
    refreshSavedLayoutOptions();
    return;
  }

  try {
    const checkpoint = getSavedLayoutCheckpoint(entry);
    state.cpSatWarmStart = {
      id: entry.id,
      name: entry.name,
      checkpoint,
    };
    applySolveRequestToPlanner(checkpoint.modelInput, { preserveCpSatRuntime: true, optimizer: "cp-sat" });
    state.result = cloneJson(entry.result);
    state.resultIsLiveSnapshot = false;
    state.resultContext = cloneJson(entry.resultContext);
    state.resultError = "";
    const elapsedMs = getSavedLayoutElapsedMs(entry);
    setResultElapsed(elapsedMs, { syncTimerWhenIdle: true });
    renderResults();
    renderCpSatHintStatus();
    setSolveState(`Ready to run CP-SAT with saved layout "${entry.name}" as a warm-start hint.`);
    elements.layoutStorageName.value = entry.name;
    elements.layoutStorageStatus.textContent = `Using saved layout "${entry.name}" as a CP-SAT hint.`;
  } catch (error) {
    clearCpSatWarmStart({ silent: true });
    elements.layoutStorageStatus.textContent = error instanceof Error
      ? error.message
      : "That saved layout could not be used as a CP-SAT hint.";
  }
}

function deleteSelectedLayout() {
  const selectedId = elements.savedLayoutsSelect.value;
  if (!selectedId) {
    elements.layoutStorageStatus.textContent = "Choose a saved layout to delete.";
    return;
  }
  const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
  const entry = entries.find((item) => item.id === selectedId);
  writeStoredEntries(
    LAYOUT_STORAGE_KEY,
    entries.filter((item) => item.id !== selectedId)
  );
  if (state.cpSatWarmStart?.id === selectedId) {
    clearCpSatWarmStart({ silent: true });
  }
  refreshSavedLayoutOptions();
  elements.layoutStorageStatus.textContent = entry ? `Deleted layout "${entry.name}".` : "Deleted the selected layout.";
}

function parsePair(value, separator, label) {
  const text = String(value ?? "").trim().toLowerCase();
  const parts = text.split(separator).map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length !== 2 || parts.some((part) => !Number.isInteger(part) || part <= 0)) {
    throw new Error(`${label} must be in the format A${separator}B using positive integers.`);
  }
  return parts;
}

function parseIntegerField(value, label, min = 0) {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${label} must be an integer greater than or equal to ${min}.`);
  }
  return number;
}

function parseServiceCatalogEntry(entry, index) {
  const name = String(entry.name ?? "").trim();
  const [rows, cols] = parsePair(entry.size, "x", `Service ${index + 1} size`);
  const [effectiveRows, effectiveCols] = parsePair(entry.effective, "x", `Service ${index + 1} effective area`);
  const rangeByRows = (effectiveRows - rows) / 2;
  const rangeByCols = (effectiveCols - cols) / 2;
  if (!Number.isInteger(rangeByRows) || !Number.isInteger(rangeByCols) || rangeByRows !== rangeByCols || rangeByRows < 0) {
    throw new Error(
      `Service ${index + 1}${name ? ` (${name})` : ""} needs an Effective value that matches Size with the same outward range.`
    );
  }
  return {
    name: name || `Service ${index + 1}`,
    rows,
    cols,
    bonus: parseIntegerField(entry.bonus, `Service ${index + 1} bonus`, 0),
    range: rangeByRows,
    avail: 1,
    allowRotation: true,
  };
}

function parseResidentialCatalogEntry(entry, index) {
  const name = String(entry.name ?? "").trim();
  const [w, h] = parsePair(entry.size, "x", `Residential ${index + 1} size`);
  const [min, max] = parsePair(String(entry.resident ?? "").replaceAll(" ", ""), "/", `Residential ${index + 1} resident`);
  return {
    name: name || `Residential ${index + 1}`,
    w,
    h,
    min: Math.min(min, max),
    max: Math.max(min, max),
    avail: parseIntegerField(entry.avail, `Residential ${index + 1} avail`, 0),
  };
}

function lookupServiceName(typeIndex) {
  const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
  return type?.name || `Service Type ${typeIndex + 1}`;
}

function lookupResidentialName(typeIndex) {
  const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
  return type?.name || `Residential Type ${typeIndex + 1}`;
}

function setPaintMode(mode) {
  state.paintMode = mode;
  for (const button of elements.paintModeToggle.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.paintMode === mode);
  }
}

function setOptimizer(optimizer) {
  state.optimizer = optimizer;
  for (const button of elements.solverToggle.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.optimizer === optimizer);
  }
  elements.greedyPanel.hidden = optimizer !== "greedy";
  elements.cpSatPanel.hidden = optimizer !== "cp-sat";
  updateSummary();
}

function updateGridDimensionInputs() {
  elements.gridRows.value = String(state.grid.length);
  elements.gridCols.value = String(state.grid[0]?.length ?? 0);
}

function countAllowedCells() {
  return state.grid.reduce(
    (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + (cell === 1 ? 1 : 0), 0),
    0
  );
}

function getMatrixMetrics(cols, frameWidth, layoutMode = "adaptive") {
  const maxSize =
    cols <= 12 ? 34 :
    cols <= 18 ? 30 :
    cols <= 24 ? 24 :
    cols <= 30 ? 20 :
    cols <= 40 ? 16 :
    12;
  const minSize =
    cols <= 18 ? 18 :
    cols <= 30 ? 13 :
    10;
  const gap =
    cols <= 16 ? 6 :
    cols <= 30 ? 4 :
    2;
  const usableWidth = Math.max(220, (frameWidth || 0) - 40);
  const fitSize = Math.floor((usableWidth - gap * Math.max(cols - 1, 0)) / Math.max(cols, 1));
  if (layoutMode === "comfortable") {
    const preferredSize =
      cols <= 12 ? 34 :
      cols <= 18 ? 30 :
      cols <= 24 ? 26 :
      cols <= 30 ? 22 :
      cols <= 40 ? 18 :
      14;
    const comfortableMin =
      cols <= 24 ? 20 :
      cols <= 30 ? 18 :
      cols <= 40 ? 14 :
      12;
    const size = Math.max(comfortableMin, Math.min(maxSize, Math.max(fitSize || preferredSize, preferredSize)));
    return { size, gap };
  }
  const size = Math.max(minSize, Math.min(maxSize, fitSize || maxSize));
  return { size, gap };
}

function applyMatrixLayout(gridElement) {
  if (!gridElement) return;
  const cols = Number(gridElement.dataset.cols || 0);
  if (!cols) return;
  const frame = gridElement.parentElement;
  const layoutMode = gridElement.dataset.layoutMode || "adaptive";
  const { size, gap } = getMatrixMetrics(cols, frame?.clientWidth ?? 0, layoutMode);
  gridElement.style.setProperty("--matrix-cell-size", `${size}px`);
  gridElement.style.setProperty("--matrix-gap", `${gap}px`);
  gridElement.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
}

function refreshMatrixLayouts() {
  applyMatrixLayout(elements.gridEditor);
  applyMatrixLayout(elements.resultMapGrid);
  refreshResultOverlay();
}

function buildCanvasCellLabel(value, row, col) {
  return `Cell ${row},${col} is ${value === 1 ? "allowed" : "blocked"}`;
}

function renderGrid() {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 0;
  elements.gridEditor.innerHTML = "";
  elements.gridEditor.dataset.cols = String(cols);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `grid-cell ${state.grid[r][c] === 1 ? "allowed" : "blocked"}`;
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.setAttribute("aria-label", buildCanvasCellLabel(state.grid[r][c], r, c));
      cell.title = `(${r}, ${c}) = ${state.grid[r][c]}`;
      elements.gridEditor.append(cell);
    }
  }
  updateGridStats();
  applyMatrixLayout(elements.gridEditor);
}

function updateGridStats() {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 0;
  const allowed = countAllowedCells();
  const total = rows * cols;
  elements.gridStats.textContent = `${rows} x ${cols} grid, ${allowed} allowed, ${total - allowed} blocked.`;
  updateSummary();
}

function applyPaint(cellElement) {
  const row = Number(cellElement.dataset.r);
  const col = Number(cellElement.dataset.c);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return;
  const current = state.grid[row][col];
  const next =
    state.paintMode === "toggle" ? (current === 1 ? 0 : 1) :
    state.paintMode === "allow" ? 1 :
    0;
  if (current === next) return;
  state.grid[row][col] = next;
  cellElement.classList.toggle("allowed", next === 1);
  cellElement.classList.toggle("blocked", next === 0);
  cellElement.setAttribute("aria-label", buildCanvasCellLabel(next, row, col));
  cellElement.title = `(${row}, ${col}) = ${next}`;
  updateGridStats();
  updatePayloadPreview();
}

function resizeGrid(rows, cols) {
  const next = createGrid(rows, cols, 1);
  for (let r = 0; r < Math.min(rows, state.grid.length); r += 1) {
    for (let c = 0; c < Math.min(cols, state.grid[0].length); c += 1) {
      next[r][c] = state.grid[r][c];
    }
  }
  state.grid = next;
  updateGridDimensionInputs();
  renderGrid();
  updatePayloadPreview();
}

function applyPreset(kind) {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 0;
  if (kind === "all") {
    state.grid = createGrid(rows, cols, 1);
  } else if (kind === "clear") {
    state.grid = createGrid(rows, cols, 0);
  } else if (kind === "checker") {
    state.grid = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ((r + c) % 2 === 0 ? 1 : 0))
    );
  } else {
    state.grid = cloneGrid(SAMPLE_GRID);
    updateGridDimensionInputs();
  }
  renderGrid();
  updatePayloadPreview();
}

function syncSolverFields() {
  elements.greedyLocalSearch.checked = state.greedy.localSearch;
  elements.greedyRestarts.value = String(state.greedy.restarts);
  elements.greedyServiceRefineIterations.value = String(state.greedy.serviceRefineIterations);
  elements.greedyServiceRefineCandidateLimit.value = String(state.greedy.serviceRefineCandidateLimit);
  elements.greedyExhaustiveServiceSearch.checked = state.greedy.exhaustiveServiceSearch;
  elements.greedyServiceExactPoolLimit.value = String(state.greedy.serviceExactPoolLimit);
  elements.greedyServiceExactMaxCombinations.value = String(state.greedy.serviceExactMaxCombinations);

  elements.cpSatTimeLimitSeconds.value = state.cpSat.timeLimitSeconds;
  elements.cpSatNumWorkers.value = String(state.cpSat.numWorkers);
  elements.cpSatLogSearchProgress.checked = state.cpSat.logSearchProgress;
  elements.cpSatPythonExecutable.value = state.cpSat.pythonExecutable;

  elements.maxServices.value = state.availableBuildings.services;
  elements.maxResidentials.value = state.availableBuildings.residentials;
}

function renderServiceTypes() {
  if (state.serviceTypes.length === 0) {
    elements.serviceList.innerHTML = `
      <div class="catalog-shell">
        <div class="catalog-empty">No service types yet. Add one to start the catalog.</div>
      </div>
    `;
    updateSummary();
    return;
  }

  const rows = state.serviceTypes.map((entry, index) => `
    <tr>
      <td class="catalog-index">${index + 1}</td>
      <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="serviceTypes" data-index="${index}" data-field="name" /></td>
      <td><input type="number" min="0" step="1" value="${escapeHtml(entry.bonus)}" data-collection="serviceTypes" data-index="${index}" data-field="bonus" /></td>
      <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="serviceTypes" data-index="${index}" data-field="size" /></td>
      <td><input type="text" value="${escapeHtml(entry.effective)}" data-collection="serviceTypes" data-index="${index}" data-field="effective" /></td>
      <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-service" data-index="${index}">Remove</button></td>
    </tr>
  `).join("");

  elements.serviceList.innerHTML = `
    <div class="catalog-shell">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Bonus</th>
            <th>Size</th>
            <th>Effective</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  updateSummary();
}

function renderResidentialTypes() {
  if (state.residentialTypes.length === 0) {
    elements.residentialList.innerHTML = `
      <div class="catalog-shell">
        <div class="catalog-empty">No residential types yet. Add one to start the catalog.</div>
      </div>
    `;
    updateSummary();
    return;
  }

  const rows = state.residentialTypes.map((entry, index) => `
    <tr>
      <td class="catalog-index">${index + 1}</td>
      <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="residentialTypes" data-index="${index}" data-field="name" /></td>
      <td><input type="text" value="${escapeHtml(entry.resident)}" data-collection="residentialTypes" data-index="${index}" data-field="resident" /></td>
      <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="residentialTypes" data-index="${index}" data-field="size" /></td>
      <td><input type="number" min="0" step="1" value="${escapeHtml(entry.avail)}" data-collection="residentialTypes" data-index="${index}" data-field="avail" /></td>
      <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-residential" data-index="${index}">Remove</button></td>
    </tr>
  `).join("");

  elements.residentialList.innerHTML = `
    <div class="catalog-shell">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Resident</th>
            <th>Size</th>
            <th>Avail</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  updateSummary();
}

function importCatalogText() {
  try {
    const imported = parseCatalogImportText(elements.catalogImportText.value);
    if (imported.services) {
      state.serviceTypes = imported.services.map((entry) => ({ ...entry }));
      renderServiceTypes();
    }
    if (imported.residentials) {
      state.residentialTypes = imported.residentials.map((entry) => ({ ...entry }));
      renderResidentialTypes();
    }
    updatePayloadPreview();
    const importedParts = [
      imported.services ? `${imported.services.length} service rows` : "",
      imported.residentials ? `${imported.residentials.length} residential rows` : "",
    ].filter(Boolean);
    elements.catalogImportStatus.textContent = `Imported ${importedParts.join(" and ")}.`;
  } catch (error) {
    elements.catalogImportStatus.textContent = error instanceof Error ? error.message : "Failed to import pasted tables.";
  }
}

function buildCpSatWarmStartHintPayload(grid, params, hintMismatch = "error") {
  if (params.optimizer !== "cp-sat" || !state.cpSatWarmStart) return undefined;

  const checkpoint = state.cpSatWarmStart.checkpoint;
  const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
  if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
    if (hintMismatch === "error") {
      throw new Error(
        `Saved layout "${state.cpSatWarmStart.name}" no longer matches the current grid or building settings. Clear the hint or restore the matching layout first.`
      );
    }
    return undefined;
  }

  return {
    sourceName: state.cpSatWarmStart.name,
    modelFingerprint: checkpoint.compatibility.modelFingerprint,
    roadKeys: cloneJson(checkpoint.hint.roadKeys),
    serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
    residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
    objectiveLowerBound: checkpoint.resumePolicy.objectiveCutoff.value,
    preferStrictImprove: Boolean(checkpoint.resumePolicy.objectiveCutoff.preferStrictImprove),
    repairHint: Boolean(checkpoint.resumePolicy.repairHint),
    fixVariablesToHintedValue: Boolean(checkpoint.resumePolicy.fixVariablesToHintedValue),
    hintConflictLimit: 20,
  };
}

function buildSolveRequest(options = {}) {
  const { hintMismatch = "error", includeWarmStartHint = true } = options;
  const timeLimitSeconds = readOptionalInteger(state.cpSat.timeLimitSeconds, 1);
  const grid = cloneGrid(state.grid);
  const params = {
    optimizer: state.optimizer,
    serviceTypes: state.serviceTypes.map((entry, index) => parseServiceCatalogEntry(entry, index)),
    residentialTypes: state.residentialTypes.map((entry, index) => parseResidentialCatalogEntry(entry, index)),
    greedy: {
      localSearch: Boolean(state.greedy.localSearch),
      restarts: clampInteger(state.greedy.restarts, 1, 1),
      serviceRefineIterations: clampInteger(state.greedy.serviceRefineIterations, 0, 0),
      serviceRefineCandidateLimit: clampInteger(state.greedy.serviceRefineCandidateLimit, 1, 1),
      exhaustiveServiceSearch: Boolean(state.greedy.exhaustiveServiceSearch),
      serviceExactPoolLimit: clampInteger(state.greedy.serviceExactPoolLimit, 1, 1),
      serviceExactMaxCombinations: clampInteger(state.greedy.serviceExactMaxCombinations, 1, 1),
    },
    cpSat: {
      numWorkers: clampInteger(state.cpSat.numWorkers, 8, 1),
      logSearchProgress: Boolean(state.cpSat.logSearchProgress),
      ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
      ...(state.cpSat.pythonExecutable.trim() ? { pythonExecutable: state.cpSat.pythonExecutable.trim() } : {}),
    },
  };

  const maxServices = readOptionalInteger(state.availableBuildings.services, 1);
  const maxResidentials = readOptionalInteger(state.availableBuildings.residentials, 1);
  if (maxServices !== undefined || maxResidentials !== undefined) {
    params.availableBuildings = {};
    if (maxServices !== undefined) params.availableBuildings.services = maxServices;
    if (maxResidentials !== undefined) params.availableBuildings.residentials = maxResidentials;
  }

  if (includeWarmStartHint && params.optimizer === "cp-sat") {
    const warmStartHint = buildCpSatWarmStartHintPayload(grid, params, hintMismatch);
    if (warmStartHint) {
      params.cpSat.warmStartHint = warmStartHint;
    }
  }

  return {
    grid,
    params,
  };
}

function updatePayloadPreview() {
  try {
    elements.payloadPreview.textContent = JSON.stringify(buildSolveRequest({ hintMismatch: "ignore" }), null, 2);
  } catch (error) {
    elements.payloadPreview.textContent = `Payload not ready.\n${error instanceof Error ? error.message : "Unknown parsing error."}`;
  }
  renderCpSatHintStatus();
}

function updateSummary() {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 0;
  elements.summaryGridSize.textContent = `${rows} x ${cols}`;
  elements.summaryAllowedCells.textContent = String(countAllowedCells());
  elements.summaryServiceTypes.textContent = String(state.serviceTypes.length);
  elements.summaryResidentialTypes.textContent = String(state.residentialTypes.length);
  elements.summaryOptimizer.textContent = state.optimizer === "greedy" ? "Greedy" : "CP-SAT";
}

function syncActionAvailability() {
  elements.solveButton.disabled = state.isSolving;
  elements.solveButton.textContent = state.isSolving ? "Solving..." : "Run solver";
  elements.stopSolveButton.disabled = !(state.isSolving && state.activeSolveRequestId && !state.isStopping);
  elements.loadConfigButton.disabled = state.isSolving;
  elements.loadLayoutButton.disabled = state.isSolving;
  elements.useLayoutAsHintButton.disabled = state.isSolving;
  elements.saveLayoutButton.disabled = state.isSolving || !state.result || !state.resultContext;
  elements.clearCpSatHintButton.disabled = state.isSolving || !state.cpSatWarmStart;
}

function setSolveState(message) {
  elements.solveStatus.textContent = message;
  syncActionAvailability();
}

function getOptimizerLabel(optimizer) {
  return optimizer === "cp-sat" ? "CP-SAT" : "Greedy";
}

function buildSolveProgressMessage(payload) {
  const optimizer = payload.optimizer || state.optimizer;
  const optimizerLabel = getOptimizerLabel(optimizer);
  const bestLabel =
    typeof payload.bestTotalPopulation === "number"
      ? ` Best so far: ${Number(payload.bestTotalPopulation).toLocaleString()}.`
      : "";

  if (state.isStopping) {
    if (payload.hasFeasibleSolution) {
      return optimizer === "cp-sat"
        ? `Stop requested. Finalizing the best feasible ${optimizerLabel} result.${bestLabel}`
        : `Stop requested. Finalizing the best ${optimizerLabel} result found so far.${bestLabel}`;
    }
    return `Stop requested. Waiting for ${optimizerLabel} to stop. No result has been found yet.`;
  }

  if (payload.hasFeasibleSolution) {
    return optimizer === "cp-sat"
      ? `Running ${optimizerLabel} solver. Feasible solution found and still improving.${bestLabel}`
      : `Running ${optimizerLabel} solver. Search is still improving.${bestLabel}`;
  }

  return optimizer === "cp-sat"
    ? `Running ${optimizerLabel} solver. Searching for the first feasible solution...`
    : `Running ${optimizerLabel} solver. Searching for an initial result...`;
}

function applyRunningSnapshot(payload) {
  if (!payload?.solution || payload.jobStatus !== "running") return;
  state.result = payload;
  state.resultIsLiveSnapshot = true;
  state.resultError = "";
  setResultElapsed(state.solveTimerElapsedMs);
  renderResults();
}

async function requestStopSolve() {
  if (!state.isSolving || !state.activeSolveRequestId || state.isStopping) return;

  state.isStopping = true;
  pauseSolveTimer();
  setSolveState(`Stopping ${getOptimizerLabel(state.optimizer)} solver...`);

  try {
    const response = await fetch("/api/solve/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: state.activeSolveRequestId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Failed to send the stop request.");
    }
    setSolveState(
      payload.stopped
        ? (payload.message || `Stop requested. Finalizing the current ${getOptimizerLabel(state.optimizer)} run...`)
        : `The ${getOptimizerLabel(state.optimizer)} solve is no longer running.`
    );
  } catch (error) {
    state.isStopping = false;
    resumeSolveTimer();
    setSolveState(error instanceof Error ? error.message : "Failed to send the stop request.");
  }
}

function createSolvedMapMatrix(grid, solution) {
  const matrix = grid.map((row) => row.map((cell) => (cell === 1 ? "empty" : "blocked")));

  for (const roadKey of solution.roads) {
    const [row, col] = roadKey.split(",").map(Number);
    if (matrix[row]?.[col]) matrix[row][col] = "road";
  }

  for (const service of solution.services) {
    for (let dr = 0; dr < service.rows; dr += 1) {
      for (let dc = 0; dc < service.cols; dc += 1) {
        const row = service.r + dr;
        const col = service.c + dc;
        if (matrix[row]?.[col]) matrix[row][col] = "service";
      }
    }
  }

  for (const residential of solution.residentials) {
    for (let dr = 0; dr < residential.rows; dr += 1) {
      for (let dc = 0; dc < residential.cols; dc += 1) {
        const row = residential.r + dr;
        const col = residential.c + dc;
        if (matrix[row]?.[col]) matrix[row][col] = "residential";
      }
    }
  }

  return matrix;
}

function describeSolvedCell(kind, row, col, hoverLabel) {
  if (hoverLabel) {
    return `Solved cell ${row},${col} belongs to ${hoverLabel}`;
  }
  const label =
    kind === "road" ? "road" :
    kind === "service" ? "service building" :
    kind === "residential" ? "residential building" :
    kind === "blocked" ? "blocked" :
    "empty allowed";
  return `Solved cell ${row},${col} is ${label}`;
}

function createSolvedMapHoverLabels(solution, rows, cols) {
  const labels = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));

  solution.services.forEach((service, index) => {
    const name = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
    const hoverLabel = `${name} (S${index + 1})`;
    for (let dr = 0; dr < service.rows; dr += 1) {
      for (let dc = 0; dc < service.cols; dc += 1) {
        const row = service.r + dr;
        const col = service.c + dc;
        if (labels[row]?.[col] !== undefined) labels[row][col] = hoverLabel;
      }
    }
  });

  solution.residentials.forEach((residential, index) => {
    const name = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
    const population = solution.populations[index];
    const hoverLabel =
      population != null
        ? `${name} (R${index + 1}, pop ${population})`
        : `${name} (R${index + 1})`;
    for (let dr = 0; dr < residential.rows; dr += 1) {
      for (let dc = 0; dc < residential.cols; dc += 1) {
        const row = residential.r + dr;
        const col = residential.c + dc;
        if (labels[row]?.[col] !== undefined) labels[row][col] = hoverLabel;
      }
    }
  });

  return labels;
}

function readMatrixLayout(element) {
  const styles = window.getComputedStyle(element);
  return {
    cellSize: Number.parseFloat(styles.getPropertyValue("--matrix-cell-size")) || 28,
    gap: Number.parseFloat(styles.getPropertyValue("--matrix-gap")) || 6,
    paddingX: Number.parseFloat(styles.paddingLeft) || 18,
    paddingY: Number.parseFloat(styles.paddingTop) || 18,
  };
}

function createBuildingOverlay(kind, index, placement, layout, label) {
  const outline = document.createElement("div");
  const pitch = layout.cellSize + layout.gap;
  const width = placement.cols * layout.cellSize + Math.max(0, placement.cols - 1) * layout.gap;
  const height = placement.rows * layout.cellSize + Math.max(0, placement.rows - 1) * layout.gap;
  const left = layout.paddingX + placement.c * pitch;
  const top = layout.paddingY + placement.r * pitch;
  const fontSize = Math.max(10, Math.min(13, layout.cellSize * 0.6));
  const tagHeight = Math.max(18, Math.min(22, layout.cellSize * 0.8));
  const minWidth = Math.max(24, Math.min(34, layout.cellSize * 1.4));
  const shortLabel = `${kind === "service" ? "S" : "R"}${index + 1}`;

  outline.className = `building-outline ${kind}`;
  outline.style.left = `${left}px`;
  outline.style.top = `${top}px`;
  outline.style.width = `${width}px`;
  outline.style.height = `${height}px`;
  outline.title = `${label} (${shortLabel})`;
  outline.setAttribute("aria-label", `${label} (${shortLabel}) at row ${placement.r}, column ${placement.c}`);

  const tag = document.createElement("span");
  tag.className = "building-tag";
  tag.textContent = shortLabel;
  tag.title = `${label} (${shortLabel})`;
  tag.style.fontSize = `${fontSize}px`;
  tag.style.height = `${tagHeight}px`;
  tag.style.minWidth = `${minWidth}px`;
  outline.append(tag);

  return outline;
}

function renderBuildingOverlay(solution) {
  elements.resultOverlay.innerHTML = "";
  if (!solution) return;

  const layout = readMatrixLayout(elements.resultMapGrid);
  solution.services.forEach((service, index) => {
    const label = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
    elements.resultOverlay.append(createBuildingOverlay("service", index, service, layout, label));
  });
  solution.residentials.forEach((residential, index) => {
    const label = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
    elements.resultOverlay.append(createBuildingOverlay("residential", index, residential, layout, label));
  });
}

function clearResultOverlay() {
  elements.resultOverlay.innerHTML = "";
}

function refreshResultOverlay() {
  if (!state.result?.solution || !elements.resultMapGrid.dataset.cols) {
    clearResultOverlay();
    return;
  }
  renderBuildingOverlay(state.result.solution);
}

function renderSolvedMap(grid, solution) {
  if (!grid?.length) {
    elements.resultMapGrid.innerHTML = "";
    delete elements.resultMapGrid.dataset.cols;
    clearResultOverlay();
    return;
  }

  const matrix = createSolvedMapMatrix(grid, solution);
  const cols = matrix[0]?.length ?? 0;
  const hoverLabels = createSolvedMapHoverLabels(solution, matrix.length, cols);
  elements.resultMapGrid.innerHTML = "";
  elements.resultMapGrid.dataset.cols = String(cols);

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const kind = matrix[r][c];
      const hoverLabel = hoverLabels[r]?.[c] || "";
      const cell = document.createElement("div");
      cell.className = `grid-cell ${kind}`;
      cell.setAttribute("aria-label", describeSolvedCell(kind, r, c, hoverLabel));
      cell.title = hoverLabel || `(${r}, ${c}) ${kind}`;
      elements.resultMapGrid.append(cell);
    }
  }

  applyMatrixLayout(elements.resultMapGrid);
  renderBuildingOverlay(solution);
}

function renderResults() {
  syncActionAvailability();
  if (state.resultError) {
    state.resultIsLiveSnapshot = false;
    elements.resultsEmpty.hidden = true;
    elements.resultsContent.hidden = false;
    elements.resultBadge.textContent = "Error";
    elements.resultBadge.className = "result-badge error";
    elements.validationNotice.className = "notice error";
    elements.validationNotice.textContent = state.resultError;
    elements.resultPopulation.textContent = "0";
    elements.resultRoadCount.textContent = "0";
    elements.resultServiceCount.textContent = "0";
    elements.resultResidentialCount.textContent = "0";
    elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
    elements.resultSolverStatus.textContent = "failed";
    elements.serviceResultList.innerHTML = "<li>No service placements available.</li>";
    elements.residentialResultList.innerHTML = "<li>No residential placements available.</li>";
    elements.resultMapGrid.innerHTML = "";
    delete elements.resultMapGrid.dataset.cols;
    clearResultOverlay();
    return;
  }

  if (!state.result) {
    state.resultIsLiveSnapshot = false;
    elements.resultsEmpty.hidden = false;
    elements.resultsContent.hidden = true;
    elements.resultBadge.textContent = "Waiting";
    elements.resultBadge.className = "result-badge idle";
    elements.resultElapsed.textContent = "00:00";
    elements.resultMapGrid.innerHTML = "";
    delete elements.resultMapGrid.dataset.cols;
    clearResultOverlay();
    return;
  }

  const { solution, stats, validation } = state.result;
  const stoppedByUser = Boolean(solution.stoppedByUser || stats.stoppedByUser);
  const liveSnapshot = Boolean(state.isSolving && state.resultIsLiveSnapshot);
  const solvedGrid = state.resultContext?.grid ?? state.grid;
  elements.resultsEmpty.hidden = true;
  elements.resultsContent.hidden = false;
  if (liveSnapshot) {
    elements.resultBadge.textContent = validation.valid ? "Live snapshot" : "Snapshot review";
    elements.resultBadge.className = `result-badge ${validation.valid ? "running" : "error"}`;
    elements.validationNotice.className = `notice ${validation.valid ? "info" : "error"}`;
    elements.validationNotice.textContent = validation.valid
      ? "Showing the best validated layout found so far while the solver keeps running. This view refreshes every 1 minute."
      : `The latest running snapshot needs review: ${validation.errors.join(" ")}`;
  } else {
    elements.resultBadge.textContent = validation.valid ? (stoppedByUser ? "Stopped" : "Validated") : "Needs review";
    elements.resultBadge.className = `result-badge ${validation.valid ? "success" : "error"}`;
    elements.validationNotice.className = `notice ${validation.valid ? "success" : "error"}`;
    elements.validationNotice.textContent = validation.valid
      ? (
        stoppedByUser
          ? `${getOptimizerLabel(stats.optimizer)} was stopped early. Showing the best validated result found so far.`
          : "The solver output passed validation for the current grid and settings."
      )
      : validation.errors.join(" ");
  }

  elements.resultPopulation.textContent = Number(stats.totalPopulation).toLocaleString();
  elements.resultRoadCount.textContent = String(stats.roadCount);
  elements.resultServiceCount.textContent = String(stats.serviceCount);
  elements.resultResidentialCount.textContent = String(stats.residentialCount);
  elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
  elements.resultSolverStatus.textContent = liveSnapshot
    ? `${stats.cpSatStatus || getOptimizerLabel(stats.optimizer)} (live)`
    : (
      stoppedByUser && stats.cpSatStatus
        ? `${stats.cpSatStatus} (stopped)`
        : stats.cpSatStatus || (stats.optimizer ?? "n/a")
    );

  elements.serviceResultList.innerHTML = "";
  if (solution.services.length === 0) {
    elements.serviceResultList.innerHTML = "<li>No service buildings were placed.</li>";
  } else {
    solution.services.forEach((service, index) => {
      const item = document.createElement("li");
      const typeLabel = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
      item.textContent =
        `${typeLabel} (S${index + 1}) at (${service.r}, ${service.c}) ` +
        `${service.rows}x${service.cols}, range ${service.range}, +${solution.servicePopulationIncreases[index] ?? 0}`;
      elements.serviceResultList.append(item);
    });
  }

  elements.residentialResultList.innerHTML = "";
  if (solution.residentials.length === 0) {
    elements.residentialResultList.innerHTML = "<li>No residential buildings were placed.</li>";
  } else {
    solution.residentials.forEach((residential, index) => {
      const item = document.createElement("li");
      const typeLabel = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
      item.textContent =
        `${typeLabel} (R${index + 1}) at (${residential.r}, ${residential.c}) ` +
        `${residential.rows}x${residential.cols}, pop ${solution.populations[index] ?? 0}`;
      elements.residentialResultList.append(item);
    });
  }

  renderSolvedMap(solvedGrid, solution);
}

async function waitForSolveResult(requestId) {
  let nextSnapshotRefreshAt = Date.now() + LIVE_SNAPSHOT_REFRESH_INTERVAL_MS;
  while (true) {
    const shouldRequestSnapshot = Date.now() >= nextSnapshotRefreshAt;
    const searchParams = new URLSearchParams({ requestId });
    if (shouldRequestSnapshot) {
      searchParams.set("includeSnapshot", "1");
      nextSnapshotRefreshAt = Date.now() + LIVE_SNAPSHOT_REFRESH_INTERVAL_MS;
    }

    const response = await fetch(`/api/solve/status?${searchParams.toString()}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Failed to read solver status.");
    }

    if (payload.jobStatus === "running") {
      if (payload.liveSnapshot && payload.solution) {
        applyRunningSnapshot(payload);
      }
      setSolveState(buildSolveProgressMessage(payload));
      await delay(SOLVE_STATUS_POLL_INTERVAL_MS);
      continue;
    }

    if (payload.solution) {
      return payload;
    }

    throw new Error(payload.error || (payload.jobStatus === "stopped" ? "Solve was stopped." : "Solve failed."));
  }
}

async function runSolve() {
  state.isSolving = true;
  state.isStopping = false;
  state.activeSolveRequestId = createSolveRequestId();
  state.resultIsLiveSnapshot = false;
  state.resultError = "";
  try {
    startSolveTimer();
    const request = buildSolveRequest();
    state.resultContext = request;
    if (state.optimizer === "cp-sat") {
      const timeLimitSeconds = request.params.cpSat?.timeLimitSeconds;
      setSolveState(
        timeLimitSeconds
          ? `Running CP-SAT solver with a ${timeLimitSeconds}s limit...`
          : "Running CP-SAT solver until it finishes or you stop it..."
      );
    } else {
      setSolveState("Running greedy solver...");
    }
    const startResponse = await fetch("/api/solve/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        requestId: state.activeSolveRequestId,
      }),
    });
    const startPayload = await startResponse.json();
    if (!startResponse.ok || !startPayload.ok) {
      throw new Error(startPayload.error || "Failed to start the solver.");
    }
    const payload = await waitForSolveResult(state.activeSolveRequestId);

    state.result = payload;
    state.resultIsLiveSnapshot = false;
    state.resultError = "";
    pauseSolveTimer();
    setResultElapsed(state.solveTimerElapsedMs);
    const stoppedByUser = Boolean(payload.solution?.stoppedByUser || payload.stats?.stoppedByUser);
    setSolveState(
      stoppedByUser
        ? `Stopped early. Showing the best ${getOptimizerLabel(payload.stats.optimizer)} result found${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
        : `Solved with ${getOptimizerLabel(payload.stats.optimizer)}${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
    );
  } catch (error) {
    state.result = null;
    state.resultIsLiveSnapshot = false;
    state.resultError = error instanceof Error ? error.message : "Unknown solve error.";
    pauseSolveTimer();
    setResultElapsed(state.solveTimerElapsedMs);
    setSolveState(/stopped/i.test(state.resultError) ? "Solver stopped." : "Solver run failed.");
  } finally {
    state.isSolving = false;
    state.isStopping = false;
    state.activeSolveRequestId = "";
    setSolveState(elements.solveStatus.textContent);
    renderResults();
  }
}

function handleCatalogInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const collectionName = target.dataset.collection;
  const index = Number(target.dataset.index);
  const field = target.dataset.field;
  if (!collectionName || !field || !Number.isInteger(index)) return;
  if (!Array.isArray(state[collectionName]) || !state[collectionName][index]) return;
  state[collectionName][index][field] = target.type === "checkbox" ? target.checked : target.value;
  updateSummary();
  updatePayloadPreview();
}

function handleCatalogClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-action]");
  if (!(button instanceof HTMLButtonElement)) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;

  if (button.dataset.action === "remove-service") {
    state.serviceTypes.splice(index, 1);
    renderServiceTypes();
  } else if (button.dataset.action === "remove-residential") {
    state.residentialTypes.splice(index, 1);
    renderResidentialTypes();
  } else {
    return;
  }

  updatePayloadPreview();
}

function initResizeHandling() {
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", refreshMatrixLayouts);
    return;
  }

  const observer = new ResizeObserver(() => {
    refreshMatrixLayouts();
  });

  if (elements.gridEditor.parentElement) observer.observe(elements.gridEditor.parentElement);
  if (elements.resultMapGrid.parentElement) observer.observe(elements.resultMapGrid.parentElement);
}

function init() {
  resetSolveTimer();
  updateGridDimensionInputs();
  setPaintMode(state.paintMode);
  setOptimizer(state.optimizer);
  syncSolverFields();
  renderGrid();
  renderServiceTypes();
  renderResidentialTypes();
  refreshSavedConfigOptions();
  refreshSavedLayoutOptions();
  updatePayloadPreview();
  renderResults();
  syncActionAvailability();
  initResizeHandling();
  requestAnimationFrame(refreshMatrixLayouts);

  elements.paintModeToggle.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.paintMode) return;
    setPaintMode(button.dataset.paintMode);
  });

  elements.solverToggle.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.optimizer) return;
    setOptimizer(button.dataset.optimizer);
    updatePayloadPreview();
  });

  elements.resizeGridButton.addEventListener("click", () => {
    const rows = clampInteger(elements.gridRows.value, state.grid.length, 1);
    const cols = clampInteger(elements.gridCols.value, state.grid[0].length, 1);
    resizeGrid(rows, cols);
  });

  elements.fillAllowedButton.addEventListener("click", () => applyPreset("all"));
  elements.clearGridButton.addEventListener("click", () => applyPreset("clear"));
  elements.sampleGridButton.addEventListener("click", () => applyPreset("sample"));
  elements.checkerGridButton.addEventListener("click", () => applyPreset("checker"));

  elements.gridEditor.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(".grid-cell");
    if (!(cell instanceof HTMLButtonElement)) return;
    state.isPainting = true;
    applyPaint(cell);
  });

  elements.gridEditor.addEventListener("pointerover", (event) => {
    if (!state.isPainting) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(".grid-cell");
    if (!(cell instanceof HTMLButtonElement)) return;
    applyPaint(cell);
  });

  window.addEventListener("pointerup", () => {
    state.isPainting = false;
  });

  elements.addServiceTypeButton.addEventListener("click", () => {
    state.serviceTypes.push({ name: "", bonus: "100", size: "2x2", effective: "10x10" });
    renderServiceTypes();
    updatePayloadPreview();
  });

  elements.addResidentialTypeButton.addEventListener("click", () => {
    state.residentialTypes.push({ name: "", resident: "120/360", size: "2x2", avail: "1" });
    renderResidentialTypes();
    updatePayloadPreview();
  });

  elements.serviceList.addEventListener("input", handleCatalogInput);
  elements.serviceList.addEventListener("change", handleCatalogInput);
  elements.serviceList.addEventListener("click", handleCatalogClick);

  elements.residentialList.addEventListener("input", handleCatalogInput);
  elements.residentialList.addEventListener("change", handleCatalogInput);
  elements.residentialList.addEventListener("click", handleCatalogClick);

  const greedyBindings = [
    ["greedyLocalSearch", "localSearch", "checkbox"],
    ["greedyRestarts", "restarts", "number"],
    ["greedyServiceRefineIterations", "serviceRefineIterations", "number"],
    ["greedyServiceRefineCandidateLimit", "serviceRefineCandidateLimit", "number"],
    ["greedyExhaustiveServiceSearch", "exhaustiveServiceSearch", "checkbox"],
    ["greedyServiceExactPoolLimit", "serviceExactPoolLimit", "number"],
    ["greedyServiceExactMaxCombinations", "serviceExactMaxCombinations", "number"],
  ];

  greedyBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.greedy[stateKey] = inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      updatePayloadPreview();
    });
  });

  const cpSatBindings = [
    ["cpSatTimeLimitSeconds", "timeLimitSeconds", "number"],
    ["cpSatNumWorkers", "numWorkers", "number"],
    ["cpSatLogSearchProgress", "logSearchProgress", "checkbox"],
    ["cpSatPythonExecutable", "pythonExecutable", "text"],
  ];

  cpSatBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.cpSat[stateKey] = inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      updatePayloadPreview();
    });
  });

  elements.maxServices.addEventListener("input", () => {
    state.availableBuildings.services = elements.maxServices.value;
    updatePayloadPreview();
  });

  elements.maxResidentials.addEventListener("input", () => {
    state.availableBuildings.residentials = elements.maxResidentials.value;
    updatePayloadPreview();
  });

  elements.importCatalogTextButton.addEventListener("click", () => {
    importCatalogText();
  });

  elements.saveConfigButton.addEventListener("click", () => {
    saveCurrentConfig();
  });

  elements.loadConfigButton.addEventListener("click", () => {
    loadSelectedConfig();
  });

  elements.deleteConfigButton.addEventListener("click", () => {
    deleteSelectedConfig();
  });

  elements.saveLayoutButton.addEventListener("click", () => {
    saveCurrentLayout();
  });

  elements.loadLayoutButton.addEventListener("click", () => {
    loadSelectedLayout();
  });

  elements.useLayoutAsHintButton.addEventListener("click", () => {
    useSelectedLayoutAsCpSatHint();
  });

  elements.deleteLayoutButton.addEventListener("click", () => {
    deleteSelectedLayout();
  });

  elements.clearCpSatHintButton.addEventListener("click", () => {
    clearCpSatWarmStart({ message: "Cleared the CP-SAT hint." });
  });

  elements.solveButton.addEventListener("click", () => {
    runSolve();
  });
  elements.stopSolveButton.addEventListener("click", () => {
    requestStopSolve();
  });
}

init();
