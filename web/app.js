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
const COMPARISON_PROGRESS_HINT_INTERVAL_MS = 60 * 1000;

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
    useDisplayedHint: true,
  },
  lns: {
    iterations: 12,
    maxNoImprovementIterations: 4,
    neighborhoodRows: 6,
    neighborhoodCols: 8,
    repairTimeLimitSeconds: 5,
    useDisplayedSeed: true,
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
  selectedMapBuilding: null,
  selectedMapCell: null,
  layoutEditor: {
    mode: "inspect",
    pendingPlacement: null,
    isApplying: false,
    edited: false,
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
  greedyRestarts: document.querySelector("#greedyRestarts"),
  greedyServiceRefineIterations: document.querySelector("#greedyServiceRefineIterations"),
  greedyServiceRefineCandidateLimit: document.querySelector("#greedyServiceRefineCandidateLimit"),
  greedyExhaustiveServiceSearch: document.querySelector("#greedyExhaustiveServiceSearch"),
  greedyServiceExactPoolLimit: document.querySelector("#greedyServiceExactPoolLimit"),
  greedyServiceExactMaxCombinations: document.querySelector("#greedyServiceExactMaxCombinations"),
  lnsIterations: document.querySelector("#lnsIterations"),
  lnsMaxNoImprovementIterations: document.querySelector("#lnsMaxNoImprovementIterations"),
  lnsNeighborhoodRows: document.querySelector("#lnsNeighborhoodRows"),
  lnsNeighborhoodCols: document.querySelector("#lnsNeighborhoodCols"),
  lnsRepairTimeLimitSeconds: document.querySelector("#lnsRepairTimeLimitSeconds"),
  lnsNumWorkers: document.querySelector("#lnsNumWorkers"),
  lnsLogSearchProgress: document.querySelector("#lnsLogSearchProgress"),
  lnsPythonExecutable: document.querySelector("#lnsPythonExecutable"),
  lnsUseDisplayedSeed: document.querySelector("#lnsUseDisplayedSeed"),
  cpSatTimeLimitSeconds: document.querySelector("#cpSatTimeLimitSeconds"),
  cpSatNumWorkers: document.querySelector("#cpSatNumWorkers"),
  cpSatLogSearchProgress: document.querySelector("#cpSatLogSearchProgress"),
  cpSatPythonExecutable: document.querySelector("#cpSatPythonExecutable"),
  cpSatUseDisplayedHint: document.querySelector("#cpSatUseDisplayedHint"),
  lnsSeedStatus: document.querySelector("#lnsSeedStatus"),
  cpSatHintStatus: document.querySelector("#cpSatHintStatus"),
  resizeGridButton: document.querySelector("#resizeGridButton"),
  fillAllowedButton: document.querySelector("#fillAllowedButton"),
  clearGridButton: document.querySelector("#clearGridButton"),
  sampleGridButton: document.querySelector("#sampleGridButton"),
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

function getDisplayedLayoutCheckpoint() {
  if (!state.result?.solution || !state.resultContext?.grid || !state.resultContext?.params) return null;
  try {
    return buildCpSatWarmStartCheckpoint(state.result, state.resultContext, state.resultElapsedMs);
  } catch {
    return null;
  }
}

function getDisplayedLayoutSourceLabel() {
  const name = elements.layoutStorageName?.value?.trim();
  return name || "the displayed output";
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
  state.optimizer = normalizeOptimizer(optimizer);
  if (params.greedy) {
    state.greedy = {
      ...state.greedy,
      ...params.greedy,
    };
  }
  if (params.lns) {
    state.lns = {
      ...state.lns,
      ...params.lns,
    };
  }

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
  if (!elements.cpSatHintStatus) return;
  if (!state.cpSat.useDisplayedHint) {
    elements.cpSatHintStatus.textContent = "Default CP-SAT hinting from the displayed output is turned off.";
    return;
  }

  const checkpoint = getDisplayedLayoutCheckpoint();
  if (!checkpoint) {
    elements.cpSatHintStatus.textContent = "No displayed output is available to use as a CP-SAT hint.";
    return;
  }

  const sourceLabel = getDisplayedLayoutSourceLabel();
  const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
  let message = `Using ${sourceLabel} as the default CP-SAT hint. Best population ${population}.`;

  try {
    const previewRequest = buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false });
    const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
    if (state.optimizer !== "cp-sat") {
      message = `${sourceLabel} is ready as the default CP-SAT hint. Switch to CP-SAT to use it.`;
    } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
      message = `${sourceLabel} is displayed, but the current grid or building settings no longer match it for CP-SAT hinting.`;
    }
  } catch {
    if (state.optimizer !== "cp-sat") {
      message = `${sourceLabel} is ready as the default CP-SAT hint. Switch to CP-SAT to use it.`;
    } else {
      message = `${sourceLabel} is displayed. Finish the current inputs to use it as a CP-SAT hint.`;
    }
  }

  elements.cpSatHintStatus.textContent = message;
}

function renderLnsSeedStatus() {
  if (!elements.lnsSeedStatus) return;
  if (!state.lns.useDisplayedSeed) {
    elements.lnsSeedStatus.textContent = "Default LNS seeding from the displayed output is turned off.";
    return;
  }

  const checkpoint = getDisplayedLayoutCheckpoint();
  if (!checkpoint) {
    elements.lnsSeedStatus.textContent = "No displayed output is available to use as an LNS seed.";
    return;
  }

  const sourceLabel = getDisplayedLayoutSourceLabel();
  const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
  let message = `Using ${sourceLabel} as the default LNS seed. Best population ${population}.`;

  try {
    const previewRequest = buildSolveRequest({
      hintMismatch: "ignore",
      includeWarmStartHint: false,
      includeLnsSeed: false,
    });
    const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
    if (state.optimizer !== "lns") {
      message = `${sourceLabel} is ready as the default LNS seed. Switch to LNS to use it.`;
    } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
      message = `${sourceLabel} is displayed, but the current grid or building settings no longer match it for LNS seeding.`;
    }
  } catch {
    if (state.optimizer !== "lns") {
      message = `${sourceLabel} is ready as the default LNS seed. Switch to LNS to use it.`;
    } else {
      message = `${sourceLabel} is displayed. Finish the current inputs to use it as an LNS seed.`;
    }
  }

  elements.lnsSeedStatus.textContent = message;
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

function normalizeOptimizer(optimizer) {
  return optimizer === "cp-sat" || optimizer === "lns" ? optimizer : "greedy";
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
    lns: cloneJson(state.lns),
  };
}

function applyConfigSnapshot(snapshot) {
  state.grid = isGridLike(snapshot?.grid) ? cloneGrid(snapshot.grid) : cloneGrid(SAMPLE_GRID);
  state.optimizer = normalizeOptimizer(snapshot?.optimizer);
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
  state.lns = {
    ...state.lns,
    ...(snapshot?.lns ?? {}),
  };
}

function clearRenderedResultState() {
  state.result = null;
  state.resultIsLiveSnapshot = false;
  state.resultError = "";
  state.selectedMapBuilding = null;
  state.selectedMapCell = null;
  state.layoutEditor.mode = "inspect";
  state.layoutEditor.pendingPlacement = null;
  state.layoutEditor.edited = false;
  state.layoutEditor.status = "";
  state.layoutEditor.isApplying = false;
  clearExpansionAdvice();
}

function clearExpansionAdvice() {
  state.expansionAdvice.isRunning = false;
  state.expansionAdvice.status = "";
  state.expansionAdvice.result = null;
  state.expansionAdvice.error = "";
}

function formatSignedPopulationDelta(delta) {
  const amount = Number(delta ?? 0);
  if (amount > 0) return `+${amount.toLocaleString()}`;
  if (amount < 0) return `-${Math.abs(amount).toLocaleString()}`;
  return "0";
}

function readExpansionCandidateFlags() {
  const hasServiceCandidate = Boolean(String(state.expansionAdvice.nextServiceText ?? "").trim());
  const hasResidentialCandidate = Boolean(String(state.expansionAdvice.nextResidentialText ?? "").trim());
  return {
    hasServiceCandidate,
    hasResidentialCandidate,
    hasAnyCandidate: hasServiceCandidate || hasResidentialCandidate,
    hasBothCandidates: hasServiceCandidate && hasResidentialCandidate,
  };
}

function getDisplayedResultSummary() {
  if (!state.result || !state.resultContext) {
    throw new Error("Run or load a layout before comparing additions.");
  }
  return {
    totalPopulation: Number(state.result.stats?.totalPopulation ?? state.result.solution?.totalPopulation ?? 0),
    serviceCount: Number(state.result.stats?.serviceCount ?? state.result.solution?.services?.length ?? 0),
    residentialCount: Number(state.result.stats?.residentialCount ?? state.result.solution?.residentials?.length ?? 0),
  };
}

function buildExpansionBaseRequest() {
  const summary = getDisplayedResultSummary();
  const request = cloneJson(state.resultContext);
  const plannerSolveRequest = buildSolveRequest({
    hintMismatch: "ignore",
    includeWarmStartHint: false,
    includeLnsSeed: false,
  });
  request.params.optimizer = plannerSolveRequest.params.optimizer;
  request.params.greedy = cloneJson(plannerSolveRequest.params.greedy ?? {});
  request.params.cpSat = cloneJson(plannerSolveRequest.params.cpSat ?? {});
  request.params.lns = cloneJson(plannerSolveRequest.params.lns ?? {});
  delete request.params.maxServices;
  delete request.params.maxResidentials;
  request.params.availableBuildings = {
    services: summary.serviceCount,
    residentials: summary.residentialCount,
  };
  return {
    request,
    baseline: summary,
  };
}

function buildComparisonDisplayedLayoutCheckpointPayload() {
  const checkpoint = getDisplayedLayoutCheckpoint();
  if (!checkpoint) return null;
  return {
    sourceName: `${getDisplayedLayoutSourceLabel()} (comparison baseline)`,
    modelFingerprint: checkpoint.compatibility.modelFingerprint,
    roadKeys: cloneJson(checkpoint.hint.roadKeys),
    serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
    residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
    solution: cloneJson(checkpoint.hint.solution),
    hintConflictLimit: 20,
  };
}

function attachComparisonSeedOrHint(request) {
  if (request.params.optimizer === "cp-sat" && !state.cpSat.useDisplayedHint) {
    return request;
  }
  if (request.params.optimizer === "lns" && !state.lns.useDisplayedSeed) {
    return request;
  }

  const payload = buildComparisonDisplayedLayoutCheckpointPayload();
  if (!payload) return request;

  if (request.params.optimizer === "cp-sat") {
    request.params.cpSat = {
      ...(request.params.cpSat ?? {}),
      warmStartHint: cloneJson(payload),
    };
  } else if (request.params.optimizer === "lns") {
    request.params.lns = {
      ...(request.params.lns ?? {}),
      seedHint: cloneJson(payload),
    };
  }

  return request;
}

function buildExpansionScenarioRequest(kind) {
  const { request, baseline } = buildExpansionBaseRequest();
  request.params.availableBuildings = {
    services: baseline.serviceCount + (kind === "service" ? 1 : 0),
    residentials: baseline.residentialCount + (kind === "residential" ? 1 : 0),
  };

  if (kind === "service") {
    const serviceCandidate = parseExpansionServiceCandidate(state.expansionAdvice.nextServiceText);
    request.params.serviceTypes = [...(request.params.serviceTypes ?? []), serviceCandidate];
    return {
      request: attachComparisonSeedOrHint(request),
      candidateName: serviceCandidate.name,
      baseline,
    };
  }

  const residentialCandidate = parseExpansionResidentialCandidate(state.expansionAdvice.nextResidentialText);
  request.params.residentialTypes = [...(request.params.residentialTypes ?? []), residentialCandidate];
  return {
    request: attachComparisonSeedOrHint(request),
    candidateName: residentialCandidate.name,
    baseline,
  };
}

function buildExpansionProgressMessage(candidateName, payload) {
  const optimizerLabel = getOptimizerLabel(payload?.optimizer || state.optimizer);
  if (typeof payload?.bestTotalPopulation === "number") {
    return `Testing ${candidateName} with ${optimizerLabel}. Latest reported best population: ${Number(payload.bestTotalPopulation).toLocaleString()}.`;
  }
  if (payload?.hasFeasibleSolution) {
    return `Testing ${candidateName} with ${optimizerLabel}. A feasible layout is available and still improving.`;
  }
  return `Testing ${candidateName} with ${optimizerLabel}. Still searching for the first feasible layout.`;
}

async function runComparisonSolve(request, candidateName) {
  const requestId = `${createSolveRequestId()}-compare`;
  const startResponse = await fetch("/api/solve/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...request,
      requestId,
    }),
  });
  const startPayload = await startResponse.json();
  if (!startResponse.ok || !startPayload.ok) {
    throw new Error(startPayload.error || "Failed to start the candidate comparison.");
  }

  let nextProgressHintAt = Date.now() + COMPARISON_PROGRESS_HINT_INTERVAL_MS;
  while (true) {
    const response = await fetch(`/api/solve/status?${new URLSearchParams({ requestId }).toString()}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Failed to read candidate comparison status.");
    }

    if (payload.jobStatus === "running") {
      if (Date.now() >= nextProgressHintAt) {
        state.expansionAdvice.status = buildExpansionProgressMessage(candidateName, payload);
        renderExpansionAdvice();
        nextProgressHintAt = Date.now() + COMPARISON_PROGRESS_HINT_INTERVAL_MS;
      }
      await delay(SOLVE_STATUS_POLL_INTERVAL_MS);
      continue;
    }

    if (payload.solution) {
      return payload;
    }

    throw new Error(payload.error || "Candidate comparison failed.");
  }
}

function renderExpansionAdvice() {
  if (!elements.expansionAdviceStatus || !elements.expansionAdviceMetrics) return;

  const hasResult = Boolean(state.result && state.resultContext);
  const { hasAnyCandidate, hasBothCandidates, hasServiceCandidate, hasResidentialCandidate } = readExpansionCandidateFlags();

  if (!hasResult) {
    elements.expansionAdviceStatus.textContent =
      "Run or load a layout first, then enter the next service and/or next residential candidate to estimate the impact.";
    elements.expansionAdviceMetrics.hidden = true;
    return;
  }

  if (state.expansionAdvice.isRunning) {
    elements.expansionAdviceStatus.textContent = state.expansionAdvice.status || "Comparing candidate additions...";
    elements.expansionAdviceMetrics.hidden = true;
    return;
  }

  if (state.expansionAdvice.error) {
    elements.expansionAdviceStatus.textContent = state.expansionAdvice.error;
    elements.expansionAdviceMetrics.hidden = true;
    return;
  }

  if (!state.expansionAdvice.result) {
    elements.expansionAdviceStatus.textContent = hasBothCandidates
      ? "Ready to compare both typed additions against the current displayed layout."
      : hasServiceCandidate
        ? "Ready to estimate the service addition against the current displayed layout."
        : hasResidentialCandidate
          ? "Ready to estimate the residential addition against the current displayed layout."
          : hasAnyCandidate
            ? "Ready to estimate the typed addition against the current displayed layout."
            : "Enter the next service and/or next residential candidate to estimate the population impact.";
    elements.expansionAdviceMetrics.hidden = true;
    return;
  }

  const result = state.expansionAdvice.result;
  elements.expansionAdviceStatus.textContent = result.detail;
  elements.expansionAdviceWinner.textContent = result.winner;
  elements.expansionAdviceBaseline.textContent = Number(result.baselinePopulation).toLocaleString();
  elements.expansionAdviceServiceOutcome.textContent =
    result.servicePopulation == null
      ? "Not tested"
      : `${Number(result.servicePopulation).toLocaleString()} (${formatSignedPopulationDelta(result.serviceDelta)})`;
  elements.expansionAdviceResidentialOutcome.textContent =
    result.residentialPopulation == null
      ? "Not tested"
      : `${Number(result.residentialPopulation).toLocaleString()} (${formatSignedPopulationDelta(result.residentialDelta)})`;
  elements.expansionAdviceMetrics.hidden = false;
}

async function compareExpansionOptions() {
  if (state.isSolving || state.expansionAdvice.isRunning) return;

  try {
    const { hasAnyCandidate, hasServiceCandidate, hasResidentialCandidate, hasBothCandidates } = readExpansionCandidateFlags();
    if (!hasAnyCandidate) {
      throw new Error("Enter at least one next-building candidate before estimating the impact.");
    }

    const baselineScenario = buildExpansionBaseRequest();
    const serviceScenario = hasServiceCandidate ? buildExpansionScenarioRequest("service") : null;
    const residentialScenario = hasResidentialCandidate ? buildExpansionScenarioRequest("residential") : null;
    const baselinePopulation = Number(baselineScenario.baseline.totalPopulation ?? 0);

    state.expansionAdvice.isRunning = true;
    state.expansionAdvice.error = "";
    state.expansionAdvice.result = null;
    state.expansionAdvice.status =
      `Using the displayed layout as the baseline at ${baselinePopulation.toLocaleString()}.`;
    renderExpansionAdvice();
    syncActionAvailability();

    const servicePayload = serviceScenario
      ? (
        state.expansionAdvice.status = `Testing service option "${serviceScenario.candidateName}"...`,
        renderExpansionAdvice(),
        await runComparisonSolve(serviceScenario.request, `service option "${serviceScenario.candidateName}"`)
      )
      : null;
    const residentialPayload = residentialScenario
      ? (
        state.expansionAdvice.status = `Testing residential option "${residentialScenario.candidateName}"...`,
        renderExpansionAdvice(),
        await runComparisonSolve(residentialScenario.request, `residential option "${residentialScenario.candidateName}"`)
      )
      : null;
    const servicePopulation = servicePayload
      ? Number(servicePayload.stats?.totalPopulation ?? servicePayload.solution?.totalPopulation ?? 0)
      : null;
    const residentialPopulation = residentialPayload
      ? Number(residentialPayload.stats?.totalPopulation ?? residentialPayload.solution?.totalPopulation ?? 0)
      : null;
    const serviceDelta = servicePopulation == null ? null : servicePopulation - baselinePopulation;
    const residentialDelta = residentialPopulation == null ? null : residentialPopulation - baselinePopulation;

    let winner = "Remain current layout";
    let detail = `Baseline reaches ${baselinePopulation.toLocaleString()}.`;

    if (hasBothCandidates && serviceScenario && residentialScenario && serviceDelta != null && residentialDelta != null) {
      detail =
        `Baseline reaches ${baselinePopulation.toLocaleString()}, ${serviceScenario.candidateName} reaches `
        + `${servicePopulation.toLocaleString()} (${formatSignedPopulationDelta(serviceDelta)}), `
        + `${residentialScenario.candidateName} reaches ${residentialPopulation.toLocaleString()} `
        + `(${formatSignedPopulationDelta(residentialDelta)}).`;

      if (serviceDelta <= 0 && residentialDelta <= 0) {
        winner = "Remain current layout";
        detail =
          `Neither typed addition improves the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline `
          + `of ${baselinePopulation.toLocaleString()}.`;
      } else if (serviceDelta > residentialDelta) {
        winner = `Add ${serviceScenario.candidateName}`;
      } else if (residentialDelta > serviceDelta) {
        winner = `Add ${residentialScenario.candidateName}`;
      } else {
        winner = "Tie";
        detail =
          `Both additions improve the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline by `
          + `${formatSignedPopulationDelta(serviceDelta)}.`;
      }
    } else if (serviceScenario && serviceDelta != null) {
      winner = serviceDelta > 0 ? `Add ${serviceScenario.candidateName}` : "Remain current layout";
      detail = serviceDelta > 0
        ? `${serviceScenario.candidateName} raises the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline from `
          + `${baselinePopulation.toLocaleString()} to ${servicePopulation.toLocaleString()} `
          + `(${formatSignedPopulationDelta(serviceDelta)}).`
        : `${serviceScenario.candidateName} reaches ${servicePopulation.toLocaleString()} `
          + `(${formatSignedPopulationDelta(serviceDelta)}), so keeping the current layout is still better than the baseline `
          + `of ${baselinePopulation.toLocaleString()}.`;
    } else if (residentialScenario && residentialDelta != null) {
      winner = residentialDelta > 0 ? `Add ${residentialScenario.candidateName}` : "Remain current layout";
      detail = residentialDelta > 0
        ? `${residentialScenario.candidateName} raises the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline from `
          + `${baselinePopulation.toLocaleString()} to ${residentialPopulation.toLocaleString()} `
          + `(${formatSignedPopulationDelta(residentialDelta)}).`
        : `${residentialScenario.candidateName} reaches ${residentialPopulation.toLocaleString()} `
          + `(${formatSignedPopulationDelta(residentialDelta)}), so keeping the current layout is still better than the baseline `
          + `of ${baselinePopulation.toLocaleString()}.`;
    }

    state.expansionAdvice.isRunning = false;
    state.expansionAdvice.status = "";
    state.expansionAdvice.result = {
      winner,
      detail,
      baselinePopulation,
      servicePopulation,
      serviceDelta,
      residentialPopulation,
      residentialDelta,
    };
    renderExpansionAdvice();
  } catch (error) {
    state.expansionAdvice.isRunning = false;
    state.expansionAdvice.result = null;
    state.expansionAdvice.error = error instanceof Error
      ? error.message
      : "Failed to compare the typed additions.";
    renderExpansionAdvice();
  } finally {
    syncActionAvailability();
  }
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
  elements.expansionNextService.value = state.expansionAdvice.nextServiceText;
  elements.expansionNextResidential.value = state.expansionAdvice.nextResidentialText;
  renderGrid();
  renderServiceTypes();
  renderResidentialTypes();
  updatePayloadPreview();
  updateSummary();
  renderExpansionAdvice();
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
  clearExpansionAdvice();
  const loadedResultContext = cloneJson(entry.resultContext);
  state.selectedMapBuilding = null;
  state.selectedMapCell = null;
  state.layoutEditor.mode = "inspect";
  state.layoutEditor.pendingPlacement = null;
  state.layoutEditor.edited = false;
  state.layoutEditor.status = "";
  state.result = cloneJson(entry.result);
  state.resultIsLiveSnapshot = false;
  state.resultContext = loadedResultContext;
  state.resultError = "";
  applySolveRequestToPlanner(loadedResultContext, {
    preserveCpSatRuntime: false,
    optimizer: loadedResultContext?.params?.optimizer ?? state.optimizer,
  });
  const elapsedMs = getSavedLayoutElapsedMs(entry);
  setResultElapsed(elapsedMs, { syncTimerWhenIdle: true });
  renderResults();
  elements.layoutStorageName.value = entry.name;
  setSolveState(`Loaded saved layout "${entry.name}" and restored its planner settings.`);
  elements.layoutStorageStatus.textContent =
    `Displaying saved layout "${entry.name}" with its saved settings and elapsed ${formatElapsedTime(elapsedMs)}.`;
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

function parseExpansionServiceCandidate(text) {
  const match = String(text ?? "").trim().match(/^\s*(.+?)(?:\s*,\s*|\t+)(\d+)(?:\s*,\s*|\t+)(\d+\s*x\s*\d+)(?:\s*,\s*|\t+)(\d+\s*x\s*\d+)\s*$/i);
  if (!match) {
    throw new Error("Next service must look like: Name, Bonus, 2x2, 12x12");
  }
  const [, name, bonus, size, effective] = match;
  return parseServiceCatalogEntry(
    {
      name: name.trim(),
      bonus: bonus.trim(),
      size: size.replaceAll(" ", ""),
      effective: effective.replaceAll(" ", ""),
    },
    state.serviceTypes.length
  );
}

function parseExpansionResidentialCandidate(text) {
  const match = String(text ?? "").trim().match(/^\s*(.+?)(?:\s*,\s*|\t+)(\d+\s*\/\s*\d+)(?:\s*,\s*|\t+|\s+)(\d+\s*x\s*\d+)\s*$/i);
  if (!match) {
    throw new Error("Next residential must look like: Name, 780/2340, 2x3");
  }
  const [, name, resident, size] = match;
  return parseResidentialCatalogEntry(
    {
      name: name.trim(),
      resident: resident.replaceAll(" ", ""),
      size: size.replaceAll(" ", ""),
      avail: "1",
    },
    state.residentialTypes.length
  );
}

function lookupServiceName(typeIndex) {
  const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
  return type?.name || `Service Type ${typeIndex + 1}`;
}

function lookupResidentialName(typeIndex) {
  const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
  return type?.name || `Residential Type ${typeIndex + 1}`;
}

function getSelectedMapPlacement(solution, selection = state.selectedMapBuilding) {
  if (!solution || !selection || !Number.isInteger(selection.index) || selection.index < 0) return null;
  if (selection.kind === "service") {
    const placement = solution.services?.[selection.index];
    return placement ? { kind: "service", placement, index: selection.index } : null;
  }
  if (selection.kind === "residential") {
    const placement = solution.residentials?.[selection.index];
    return placement ? { kind: "residential", placement, index: selection.index } : null;
  }
  return null;
}

function getSelectedMapCell(grid = state.resultContext?.grid ?? state.grid) {
  if (!grid?.length || !state.selectedMapCell) return null;
  const { r, c } = state.selectedMapCell;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  if (r < 0 || c < 0 || r >= grid.length || c >= (grid[0]?.length ?? 0)) return null;
  return { r, c };
}

function getLayoutEditModeLabel(mode = state.layoutEditor.mode) {
  if (mode === "road") return "Road";
  if (mode === "erase") return "Erase";
  if (mode === "move") return "Move";
  if (mode === "place-service") return "Place service";
  if (mode === "place-residential") return "Place residential";
  return "Inspect";
}

function getSelectedPlacementLabel(solution = state.result?.solution) {
  const selected = getSelectedMapPlacement(solution);
  if (!selected) return "";
  return `${selected.kind === "service" ? "S" : "R"}${selected.index + 1}`;
}

function setLayoutEditMode(mode, pendingPlacement = null) {
  state.layoutEditor.mode = mode;
  state.layoutEditor.pendingPlacement = pendingPlacement;
  state.layoutEditor.status = "";
  if (mode === "inspect") {
    state.selectedMapCell = null;
  }
  renderLayoutEditorControls();
}

function renderLayoutEditorControls() {
  if (!elements.layoutEditModeToggle || !elements.layoutEditorStatus) return;
  const pendingPlacement = state.layoutEditor.pendingPlacement;
  const selectedLabel = getSelectedPlacementLabel();

  for (const button of elements.layoutEditModeToggle.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.layoutEditMode === state.layoutEditor.mode);
  }

  let message = state.layoutEditor.status;
  if (!message) {
    if (!state.result || !state.resultContext) {
      message = "Run or load a layout to edit it.";
    } else if (state.layoutEditor.isApplying) {
      message = "Re-evaluating the edited layout...";
    } else if (state.layoutEditor.mode === "place-service" && pendingPlacement) {
      message = `Placing ${pendingPlacement.name}. Click the map to set its top-left cell.`;
    } else if (state.layoutEditor.mode === "place-residential" && pendingPlacement) {
      message = `Placing ${pendingPlacement.name}. Click the map to set its top-left cell.`;
    } else if (state.layoutEditor.mode === "road") {
      message = "Road mode: click an empty allowed cell to add road, or an existing road cell to remove it.";
    } else if (state.layoutEditor.mode === "erase") {
      message = "Erase mode: click a road, service, or residential building to remove it.";
    } else if (state.layoutEditor.mode === "move") {
      message = selectedLabel
        ? `Move mode: click a new top-left cell for ${selectedLabel}.`
        : "Move mode: select a building first, then click its new top-left cell.";
    } else if (state.layoutEditor.edited) {
      message = "Manual edits are active. This displayed layout can be reused as an LNS seed or CP-SAT hint.";
    } else {
      message = "Inspect mode: click a map cell to inspect it, or choose a remaining building to place.";
    }
  }

  elements.layoutEditorStatus.textContent = message;
}

function footprintCellsForPlacement(placement) {
  const cells = [];
  for (let dr = 0; dr < placement.rows; dr += 1) {
    for (let dc = 0; dc < placement.cols; dc += 1) {
      cells.push({ r: placement.r + dr, c: placement.c + dc });
    }
  }
  return cells;
}

function getOccupiedCells(solution, options = {}) {
  const { excludeKind = null, excludeIndex = -1 } = options;
  const occupied = new Set();

  (solution.services ?? []).forEach((service, index) => {
    if (excludeKind === "service" && excludeIndex === index) return;
    footprintCellsForPlacement(service).forEach((cell) => occupied.add(`${cell.r},${cell.c}`));
  });

  (solution.residentials ?? []).forEach((residential, index) => {
    if (excludeKind === "residential" && excludeIndex === index) return;
    footprintCellsForPlacement(residential).forEach((cell) => occupied.add(`${cell.r},${cell.c}`));
  });

  return occupied;
}

function ensurePlacementFitsGrid(grid, placement) {
  if (!grid?.length) throw new Error("No grid is available for manual editing.");
  if (placement.r < 0 || placement.c < 0) {
    throw new Error("Placements must stay within the grid.");
  }
  if (placement.r + placement.rows > grid.length || placement.c + placement.cols > (grid[0]?.length ?? 0)) {
    throw new Error("That building would extend beyond the grid.");
  }

  footprintCellsForPlacement(placement).forEach((cell) => {
    if (grid[cell.r]?.[cell.c] !== 1) {
      throw new Error("That placement touches a blocked cell.");
    }
  });
}

function ensurePlacementIsClear(solution, placement, options = {}) {
  const occupied = getOccupiedCells(solution, options);
  const roads = new Set(solution.roads ?? []);

  footprintCellsForPlacement(placement).forEach((cell) => {
    const key = `${cell.r},${cell.c}`;
    if (occupied.has(key)) {
      throw new Error("That placement overlaps another building.");
    }
    if (roads.has(key)) {
      throw new Error("That placement overlaps a road. Remove the road first or choose another cell.");
    }
  });
}

function buildServicePlacementForType(typeIndex, row, col) {
  const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
  if (!type) throw new Error("That service type is no longer available in the current settings.");
  return {
    placement: {
      r: row,
      c: col,
      rows: Number(type.rows),
      cols: Number(type.cols),
      range: Number(type.range),
    },
    bonus: Number(type.bonus ?? 0),
    name: type.name || `Service Type ${typeIndex + 1}`,
  };
}

function buildResidentialPlacementForType(typeIndex, row, col) {
  const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
  if (!type) throw new Error("That residential type is no longer available in the current settings.");
  return {
    placement: {
      r: row,
      c: col,
      rows: Number(type.h),
      cols: Number(type.w),
    },
    population: Number(type.min ?? 0),
    name: type.name || `Residential Type ${typeIndex + 1}`,
  };
}

async function evaluateEditedLayout(nextSolution, options = {}) {
  if (!state.resultContext?.grid || !state.resultContext?.params) {
    throw new Error("Run or load a layout before editing it.");
  }

  const { message = "Manual layout updated.", selectedBuilding = null, selectedCell = null, keepMode = false } = options;
  state.layoutEditor.isApplying = true;
  state.layoutEditor.status = "Re-evaluating the edited layout...";
  syncActionAvailability();
  renderLayoutEditorControls();

  try {
    const response = await fetch("/api/layout/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grid: state.resultContext.grid,
        params: state.resultContext.params,
        solution: nextSolution,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      if (response.status === 405) {
        throw new Error("Manual layout editing needs the updated web server. Restart `npm run web` once, then try the action again.");
      }
      throw new Error(payload.error || "Failed to evaluate the edited layout.");
    }

    clearExpansionAdvice();
    state.result = payload;
    state.resultIsLiveSnapshot = false;
    state.resultError = "";
    state.selectedMapBuilding = selectedBuilding;
    state.selectedMapCell = selectedCell;
    state.layoutEditor.edited = true;
    state.layoutEditor.status = message;
    if (!keepMode) {
      state.layoutEditor.mode = "inspect";
      state.layoutEditor.pendingPlacement = null;
    }
    setSolveState(message);
    renderResults();
  } finally {
    state.layoutEditor.isApplying = false;
    syncActionAvailability();
    renderLayoutEditorControls();
  }
}

function cloneEditableSolution() {
  if (!state.result?.solution) {
    throw new Error("Run or load a layout before editing it.");
  }
  return cloneJson(state.result.solution);
}

function removePlacementFromSolution(solution, selection) {
  if (!selection) throw new Error("Select a building first.");
  if (selection.kind === "service") {
    solution.services.splice(selection.index, 1);
    solution.serviceTypeIndices.splice(selection.index, 1);
    solution.servicePopulationIncreases.splice(selection.index, 1);
    return;
  }
  if (selection.kind === "residential") {
    solution.residentials.splice(selection.index, 1);
    solution.residentialTypeIndices.splice(selection.index, 1);
    solution.populations.splice(selection.index, 1);
  }
}

async function toggleManualRoad(row, col) {
  const grid = state.resultContext?.grid ?? state.grid;
  if (grid?.[row]?.[col] !== 1) {
    throw new Error("Roads can only be edited on allowed cells.");
  }
  if (findBuildingAtCell(state.result?.solution, row, col)) {
    throw new Error("That cell is occupied by a building. Move or erase the building first.");
  }

  const nextSolution = cloneEditableSolution();
  const key = `${row},${col}`;
  const roads = new Set(nextSolution.roads ?? []);
  if (roads.has(key)) {
    roads.delete(key);
  } else {
    roads.add(key);
  }
  nextSolution.roads = Array.from(roads);
  await evaluateEditedLayout(nextSolution, {
    message: roads.has(key) ? `Added road at (${row}, ${col}).` : `Removed road at (${row}, ${col}).`,
    selectedCell: { r: row, c: col },
    keepMode: true,
  });
}

async function eraseAtCell(row, col) {
  const selected = findBuildingAtCell(state.result?.solution, row, col);
  if (selected) {
    const nextSolution = cloneEditableSolution();
    removePlacementFromSolution(nextSolution, selected);
    await evaluateEditedLayout(nextSolution, {
      message: `Removed ${selected.kind === "service" ? "service" : "residential"} ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
      selectedCell: { r: row, c: col },
      keepMode: true,
    });
    return;
  }

  const key = `${row},${col}`;
  const nextSolution = cloneEditableSolution();
  if (!(nextSolution.roads ?? []).includes(key)) {
    throw new Error("There is no road or building at that cell to erase.");
  }
  nextSolution.roads = (nextSolution.roads ?? []).filter((roadKey) => roadKey !== key);
  await evaluateEditedLayout(nextSolution, {
    message: `Removed road at (${row}, ${col}).`,
    selectedCell: { r: row, c: col },
    keepMode: true,
  });
}

async function placePendingBuilding(row, col) {
  const pending = state.layoutEditor.pendingPlacement;
  if (!pending) {
    throw new Error("Choose a remaining building to place first.");
  }

  const grid = state.resultContext?.grid ?? state.grid;
  const nextSolution = cloneEditableSolution();

  if (pending.kind === "service") {
    const candidate = buildServicePlacementForType(pending.typeIndex, row, col);
    ensurePlacementFitsGrid(grid, candidate.placement);
    ensurePlacementIsClear(nextSolution, candidate.placement);
    nextSolution.services.push(candidate.placement);
    nextSolution.serviceTypeIndices.push(pending.typeIndex);
    nextSolution.servicePopulationIncreases.push(candidate.bonus);
    await evaluateEditedLayout(nextSolution, {
      message: `Placed ${pending.name} at (${row}, ${col}).`,
      selectedBuilding: { kind: "service", index: nextSolution.services.length - 1 },
    });
    return;
  }

  const candidate = buildResidentialPlacementForType(pending.typeIndex, row, col);
  ensurePlacementFitsGrid(grid, candidate.placement);
  ensurePlacementIsClear(nextSolution, candidate.placement);
  nextSolution.residentials.push(candidate.placement);
  nextSolution.residentialTypeIndices.push(pending.typeIndex);
  nextSolution.populations.push(candidate.population);
  await evaluateEditedLayout(nextSolution, {
    message: `Placed ${pending.name} at (${row}, ${col}).`,
    selectedBuilding: { kind: "residential", index: nextSolution.residentials.length - 1 },
  });
}

async function moveSelectedBuilding(row, col) {
  const currentSolution = state.result?.solution;
  const currentSelection = getSelectedMapPlacement(currentSolution);
  const clickedSelection = findBuildingAtCell(currentSolution, row, col);

  if (!currentSelection) {
    if (!clickedSelection) {
      throw new Error("Select a building first, then click its new top-left cell.");
    }
    state.selectedMapBuilding = clickedSelection;
    state.selectedMapCell = null;
    state.layoutEditor.status = `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`;
    renderResults();
    return;
  }

  if (
    clickedSelection
    && (clickedSelection.kind !== currentSelection.kind || clickedSelection.index !== currentSelection.index)
  ) {
    state.selectedMapBuilding = clickedSelection;
    state.selectedMapCell = null;
    state.layoutEditor.status = `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`;
    renderResults();
    return;
  }

  const grid = state.resultContext?.grid ?? state.grid;
  const nextSolution = cloneEditableSolution();
  const selection = getSelectedMapPlacement(nextSolution, currentSelection);
  if (!selection) {
    throw new Error("The selected building is no longer available to move.");
  }

  const nextPlacement = {
    ...selection.placement,
    r: row,
    c: col,
  };
  ensurePlacementFitsGrid(grid, nextPlacement);
  ensurePlacementIsClear(nextSolution, nextPlacement, {
    excludeKind: selection.kind,
    excludeIndex: selection.index,
  });

  if (selection.kind === "service") {
    nextSolution.services[selection.index] = nextPlacement;
  } else {
    nextSolution.residentials[selection.index] = nextPlacement;
  }

  await evaluateEditedLayout(nextSolution, {
    message: `Moved ${selection.kind === "service" ? "S" : "R"}${selection.index + 1} to (${row}, ${col}).`,
    selectedBuilding: { kind: selection.kind, index: selection.index },
    keepMode: true,
  });
}

function findBuildingAtCell(solution, row, col) {
  if (!solution || !Number.isInteger(row) || !Number.isInteger(col)) return null;

  for (let index = 0; index < (solution.services?.length ?? 0); index += 1) {
    const service = solution.services[index];
    if (
      row >= service.r
      && row < service.r + service.rows
      && col >= service.c
      && col < service.c + service.cols
    ) {
      return { kind: "service", index };
    }
  }

  for (let index = 0; index < (solution.residentials?.length ?? 0); index += 1) {
    const residential = solution.residentials[index];
    if (
      row >= residential.r
      && row < residential.r + residential.rows
      && col >= residential.c
      && col < residential.c + residential.cols
    ) {
      return { kind: "residential", index };
    }
  }

  return null;
}

function getSolvedCellKind(grid, solution, row, col) {
  if (grid?.[row]?.[col] !== 1) return "blocked";
  if (findBuildingAtCell(solution, row, col)?.kind === "service") return "service";
  if (findBuildingAtCell(solution, row, col)?.kind === "residential") return "residential";
  if ((solution?.roads ?? []).includes?.(`${row},${col}`)) return "road";
  return "empty";
}

function getCellBonusCoverage(solution, row, col) {
  const grid = state.resultContext?.grid ?? state.grid;
  if (!grid?.length || grid[row]?.[col] !== 1 || !solution) return [];

  return (solution.services ?? []).flatMap((service, index) => {
    const inFootprint =
      row >= service.r
      && row < service.r + service.rows
      && col >= service.c
      && col < service.c + service.cols;
    if (inFootprint) return [];

    const inEffect =
      row >= service.r - service.range
      && row <= service.r + service.rows - 1 + service.range
      && col >= service.c - service.range
      && col <= service.c + service.cols - 1 + service.range;
    if (!inEffect) return [];

    return [{
      id: `S${index + 1}`,
      name: lookupServiceName(solution.serviceTypeIndices?.[index] ?? -1),
      bonus: Number(solution.servicePopulationIncreases?.[index] ?? 0),
    }];
  });
}

function getTypeAvailabilitySummary(kind, typeIndex, solution) {
  const isService = kind === "service";
  const types = isService ? (state.resultContext?.params?.serviceTypes ?? []) : (state.resultContext?.params?.residentialTypes ?? []);
  const usedCounts = countPlacementsByType(
    isService ? solution?.serviceTypeIndices : solution?.residentialTypeIndices,
    types.length
  );
  const parsedAvailable = Number(types[typeIndex]?.avail ?? 0);
  const totalAvailable = Number.isFinite(parsedAvailable) ? Math.max(0, Math.floor(parsedAvailable)) : 0;
  const used = usedCounts[typeIndex] ?? 0;
  return {
    totalAvailable,
    used,
    remaining: Math.max(0, totalAvailable - used),
  };
}

function renderSelectedBuildingDetail(solution = state.result?.solution) {
  if (!elements.selectedBuildingTitle || !elements.selectedBuildingFacts || !elements.selectedBuildingSummary) return;

  const selected = getSelectedMapPlacement(solution);
  const selectedCell = getSelectedMapCell();
  if (!selected && !selectedCell) {
    elements.selectedBuildingTitle.textContent = "Building detail";
    elements.selectedBuildingSummary.textContent = solution
      ? "Click a service, residential, road, or empty cell on the solved map to inspect it here."
      : "Run or load a layout to inspect building details.";
    elements.selectedBuildingFacts.hidden = true;
    return;
  }

  if (!selected && selectedCell) {
    const kind = getSolvedCellKind(state.resultContext?.grid ?? state.grid, solution, selectedCell.r, selectedCell.c);
    const coverage = getCellBonusCoverage(solution, selectedCell.r, selectedCell.c);
    const totalBonus = coverage.reduce((sum, entry) => sum + entry.bonus, 0);
    const sourceText = coverage.length
      ? coverage.map((entry) => `${entry.name} (${entry.id})`).join(", ")
      : "no nearby service zones";
    const categoryLabel =
      kind === "road" ? "Road" :
      kind === "empty" ? "Empty cell" :
      kind === "blocked" ? "Blocked cell" :
      kind === "service" ? "Service cell" :
      "Residential cell";

    elements.selectedBuildingTitle.textContent = `${categoryLabel} (${selectedCell.r}, ${selectedCell.c})`;
    elements.selectedBuildingSummary.textContent =
      kind === "blocked"
        ? "Blocked cells do not receive service bonus coverage."
        : `Potential service bonus at this position is +${totalBonus} population from ${sourceText}.`;
    elements.selectedBuildingId.textContent = `${selectedCell.r},${selectedCell.c}`;
    elements.selectedBuildingCategory.textContent = categoryLabel;
    elements.selectedBuildingPosition.textContent = `Row ${selectedCell.r}, Col ${selectedCell.c}`;
    elements.selectedBuildingFootprint.textContent = "1x1 cell";
    elements.selectedBuildingEffect.textContent =
      kind === "blocked"
        ? "No service bonus applies here because the cell is blocked."
        : coverage.length
          ? `+${totalBonus} from ${coverage.map((entry) => `${entry.name} (${entry.id})`).join(", ")}`
          : "No nearby service bonus reaches this cell.";
    elements.selectedBuildingAvailability.textContent =
      kind === "empty"
        ? "Open cell"
        : kind === "road"
          ? "Occupied by road"
          : kind === "blocked"
            ? "Not buildable"
            : "Occupied by a building";
    elements.selectedBuildingFacts.hidden = false;
    return;
  }

  const isService = selected.kind === "service";
  const placement = selected.placement;
  const typeIndex = isService
    ? (solution.serviceTypeIndices?.[selected.index] ?? -1)
    : (solution.residentialTypeIndices?.[selected.index] ?? -1);
  const type = isService
    ? state.resultContext?.params?.serviceTypes?.[typeIndex]
    : state.resultContext?.params?.residentialTypes?.[typeIndex];
  const name = isService ? lookupServiceName(typeIndex) : lookupResidentialName(typeIndex);
  const buildingId = `${isService ? "S" : "R"}${selected.index + 1}`;
  const availability = getTypeAvailabilitySummary(selected.kind, typeIndex, solution);

  elements.selectedBuildingTitle.textContent = name;
  elements.selectedBuildingSummary.textContent = isService
    ? `${buildingId} is a service placement covering ${placement.rows}x${placement.cols} with range ${placement.range}.`
    : `${buildingId} is a residential placement contributing ${solution.populations?.[selected.index] ?? 0} population.`;
  elements.selectedBuildingId.textContent = buildingId;
  elements.selectedBuildingCategory.textContent = isService ? "Service" : "Residential";
  elements.selectedBuildingPosition.textContent = `Row ${placement.r}, Col ${placement.c}`;
  elements.selectedBuildingFootprint.textContent = `${placement.rows}x${placement.cols}`;
  elements.selectedBuildingEffect.textContent = isService
    ? `+${solution.servicePopulationIncreases?.[selected.index] ?? 0} population, range ${placement.range}, type bonus ${type?.bonus ?? 0}`
    : `${solution.populations?.[selected.index] ?? 0} population, type range ${type?.min ?? 0}-${type?.max ?? 0}`;
  elements.selectedBuildingAvailability.textContent =
    `${availability.remaining} left of ${availability.totalAvailable} for this type`;
  elements.selectedBuildingFacts.hidden = false;
}

function countPlacementsByType(typeIndices, typeCount) {
  const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
  if (!Array.isArray(typeIndices)) return counts;
  typeIndices.forEach((typeIndex) => {
    if (Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < counts.length) {
      counts[typeIndex] += 1;
    }
  });
  return counts;
}

function renderRemainingAvailability(listElement, types, usedCounts, labelPrefix) {
  if (!listElement) return;
  listElement.innerHTML = "";

  const remainingEntries = Array.isArray(types)
    ? types.flatMap((type, index) => {
      const parsedAvailable = Number(type?.avail ?? 0);
      const totalAvailable = Number.isFinite(parsedAvailable) ? Math.max(0, Math.floor(parsedAvailable)) : 0;
      const used = usedCounts[index] ?? 0;
      const remaining = Math.max(0, totalAvailable - used);
      if (!remaining) return [];
      const isService = labelPrefix === "Service";
      return [{
        name: type?.name || `${labelPrefix} Type ${index + 1}`,
        kind: isService ? "service" : "residential",
        typeIndex: index,
        remaining,
        totalAvailable,
        detail: isService
          ? `${Number(type?.bonus ?? 0)}`
          : `${Number(type?.min ?? 0)}/${Number(type?.max ?? 0)}, ${Number(type?.w ?? 0)}x${Number(type?.h ?? 0)}`,
      }];
    })
    : [];

  if (remainingEntries.length === 0) {
    listElement.innerHTML = `<li>No ${labelPrefix.toLowerCase()} buildings remain available.</li>`;
    return;
  }

  remainingEntries.forEach((entry) => {
    const item = document.createElement("li");
    const summary = document.createElement("span");
    summary.textContent = `${entry.name} — ${entry.detail}, ${entry.remaining}/${entry.totalAvailable}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button ghost compact";
    button.textContent = "Place";
    button.disabled = state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext;
    button.dataset.action = entry.kind === "service" ? "place-remaining-service" : "place-remaining-residential";
    button.dataset.typeIndex = String(entry.typeIndex);
    button.dataset.name = entry.name;
    item.append(summary, button);
    listElement.append(item);
  });
}

function setPaintMode(mode) {
  state.paintMode = mode;
  for (const button of elements.paintModeToggle.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.paintMode === mode);
  }
}

function setOptimizer(optimizer) {
  state.optimizer = normalizeOptimizer(optimizer);
  for (const button of elements.solverToggle.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.optimizer === state.optimizer);
  }
  elements.greedyPanel.hidden = state.optimizer !== "greedy";
  elements.lnsPanel.hidden = state.optimizer !== "lns";
  elements.cpSatPanel.hidden = state.optimizer !== "cp-sat";
  syncSolverFields();
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

  elements.lnsIterations.value = String(state.lns.iterations);
  elements.lnsMaxNoImprovementIterations.value = String(state.lns.maxNoImprovementIterations);
  elements.lnsNeighborhoodRows.value = String(state.lns.neighborhoodRows);
  elements.lnsNeighborhoodCols.value = String(state.lns.neighborhoodCols);
  elements.lnsRepairTimeLimitSeconds.value = String(state.lns.repairTimeLimitSeconds);
  elements.lnsNumWorkers.value = String(state.cpSat.numWorkers);
  elements.lnsLogSearchProgress.checked = state.cpSat.logSearchProgress;
  elements.lnsPythonExecutable.value = state.cpSat.pythonExecutable;
  elements.lnsUseDisplayedSeed.checked = Boolean(state.lns.useDisplayedSeed);

  elements.cpSatTimeLimitSeconds.value = state.cpSat.timeLimitSeconds;
  elements.cpSatNumWorkers.value = String(state.cpSat.numWorkers);
  elements.cpSatLogSearchProgress.checked = state.cpSat.logSearchProgress;
  elements.cpSatPythonExecutable.value = state.cpSat.pythonExecutable;
  elements.cpSatUseDisplayedHint.checked = Boolean(state.cpSat.useDisplayedHint);

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
  if (params.optimizer !== "cp-sat" || !state.cpSat.useDisplayedHint) return undefined;

  const checkpoint = getDisplayedLayoutCheckpoint();
  if (!checkpoint) return undefined;
  const sourceLabel = getDisplayedLayoutSourceLabel();
  const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
  if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
    if (hintMismatch === "error") {
      throw new Error(
        `${sourceLabel} no longer matches the current grid or building settings. Turn off default hinting or restore matching inputs first.`
      );
    }
    return undefined;
  }

  return {
    sourceName: sourceLabel,
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

function buildLnsSeedPayload(grid, params, hintMismatch = "error") {
  if (params.optimizer !== "lns" || !state.lns.useDisplayedSeed) return undefined;

  const checkpoint = getDisplayedLayoutCheckpoint();
  if (!checkpoint) return undefined;
  const sourceLabel = getDisplayedLayoutSourceLabel();
  const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
  if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
    if (hintMismatch === "error") {
      throw new Error(
        `${sourceLabel} no longer matches the current grid or building settings. Turn off default seeding or restore matching inputs first.`
      );
    }
    return undefined;
  }

  return {
    sourceName: sourceLabel,
    modelFingerprint: checkpoint.compatibility.modelFingerprint,
    roadKeys: cloneJson(checkpoint.hint.roadKeys),
    serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
    residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
    solution: cloneJson(checkpoint.hint.solution),
    objectiveLowerBound: checkpoint.resumePolicy.objectiveCutoff.value,
    preferStrictImprove: Boolean(checkpoint.resumePolicy.objectiveCutoff.preferStrictImprove),
    repairHint: Boolean(checkpoint.resumePolicy.repairHint),
    fixVariablesToHintedValue: Boolean(checkpoint.resumePolicy.fixVariablesToHintedValue),
    hintConflictLimit: 20,
  };
}

function buildSolveRequest(options = {}) {
  const { hintMismatch = "error", includeWarmStartHint = true, includeLnsSeed = true } = options;
  const timeLimitSeconds = readOptionalInteger(state.cpSat.timeLimitSeconds, 1);
  const defaultNeighborhoodRows = Math.max(1, Math.ceil(state.grid.length / 2));
  const defaultNeighborhoodCols = Math.max(1, Math.ceil((state.grid[0]?.length ?? 1) / 2));
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
    lns: {
      iterations: clampInteger(state.lns.iterations, 12, 1),
      maxNoImprovementIterations: clampInteger(state.lns.maxNoImprovementIterations, 4, 1),
      neighborhoodRows: clampInteger(state.lns.neighborhoodRows, defaultNeighborhoodRows, 1),
      neighborhoodCols: clampInteger(state.lns.neighborhoodCols, defaultNeighborhoodCols, 1),
      repairTimeLimitSeconds: clampInteger(state.lns.repairTimeLimitSeconds, 5, 1),
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

  if (includeLnsSeed && params.optimizer === "lns") {
    const seedHint = buildLnsSeedPayload(grid, params, hintMismatch);
    if (seedHint) {
      params.lns.seedHint = seedHint;
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
  renderLnsSeedStatus();
}

function updateSummary() {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 0;
  elements.summaryGridSize.textContent = `${rows} x ${cols}`;
  elements.summaryAllowedCells.textContent = String(countAllowedCells());
  elements.summaryServiceTypes.textContent = String(state.serviceTypes.length);
  elements.summaryResidentialTypes.textContent = String(state.residentialTypes.length);
  elements.summaryOptimizer.textContent = getOptimizerLabel(state.optimizer);
}

function syncActionAvailability() {
  const { hasAnyCandidate } = readExpansionCandidateFlags();
  const hasSelectedBuilding = Boolean(getSelectedMapPlacement(state.result?.solution));
  const comparisonBusy = state.expansionAdvice.isRunning;
  const editorBusy = state.isSolving || state.layoutEditor.isApplying || comparisonBusy;
  elements.solveButton.disabled = state.isSolving || comparisonBusy;
  elements.solveButton.textContent = state.isSolving ? "Solving..." : "Run solver";
  elements.stopSolveButton.disabled = !(state.isSolving && state.activeSolveRequestId && !state.isStopping);
  elements.loadConfigButton.disabled = state.isSolving || comparisonBusy;
  elements.loadLayoutButton.disabled = state.isSolving || comparisonBusy;
  elements.saveLayoutButton.disabled = state.isSolving || comparisonBusy || !state.result || !state.resultContext;
  elements.lnsUseDisplayedSeed.disabled = editorBusy;
  elements.cpSatUseDisplayedHint.disabled = editorBusy;
  elements.expansionNextService.disabled = editorBusy || state.expansionAdvice.isRunning;
  elements.expansionNextResidential.disabled = editorBusy || state.expansionAdvice.isRunning;
  elements.compareExpansionButton.disabled =
    editorBusy
    || state.expansionAdvice.isRunning
    || !state.result
    || !state.resultContext
    || !hasAnyCandidate;
  if (elements.moveSelectedBuildingButton) {
    elements.moveSelectedBuildingButton.disabled = editorBusy || !state.result || !state.resultContext || !hasSelectedBuilding;
  }
  if (elements.removeSelectedBuildingButton) {
    elements.removeSelectedBuildingButton.disabled = editorBusy || !state.result || !state.resultContext || !hasSelectedBuilding;
  }
  if (elements.layoutEditModeToggle) {
    for (const button of elements.layoutEditModeToggle.querySelectorAll("button")) {
      button.disabled = editorBusy || !state.result || !state.resultContext;
    }
  }
  for (const button of elements.remainingServiceList?.querySelectorAll?.("button[data-action]") ?? []) {
    button.disabled = editorBusy || !state.result || !state.resultContext;
  }
  for (const button of elements.remainingResidentialList?.querySelectorAll?.("button[data-action]") ?? []) {
    button.disabled = editorBusy || !state.result || !state.resultContext;
  }
}

function setSolveState(message) {
  elements.solveStatus.textContent = message;
  syncActionAvailability();
}

function getOptimizerLabel(optimizer) {
  if (optimizer === "cp-sat") return "CP-SAT";
  if (optimizer === "lns") return "LNS";
  return "Greedy";
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
        : optimizer === "lns"
          ? `Stop requested. Finalizing the best ${optimizerLabel} result found after neighborhood repair.${bestLabel}`
          : `Stop requested. Finalizing the best ${optimizerLabel} result found so far.${bestLabel}`;
    }
    return `Stop requested. Waiting for ${optimizerLabel} to stop. No result has been found yet.`;
  }

  if (payload.hasFeasibleSolution) {
    return optimizer === "cp-sat"
      ? `Running ${optimizerLabel} solver. Feasible solution found and still improving.${bestLabel}`
      : optimizer === "lns"
        ? (
          state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
            ? `Running ${optimizerLabel} solver. Displayed seed is ready and neighborhood repairs are still improving.${bestLabel}`
            : `Running ${optimizerLabel} solver. Greedy seed is ready and neighborhood repairs are still improving.${bestLabel}`
        )
        : `Running ${optimizerLabel} solver. Search is still improving.${bestLabel}`;
  }

  if (optimizer === "cp-sat") {
    return `Running ${optimizerLabel} solver. Searching for the first feasible solution...`;
  }
  if (optimizer === "lns") {
    return state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
      ? `Running ${optimizerLabel} solver. Loading the displayed seed before neighborhood repair...`
      : `Running ${optimizerLabel} solver. Building the greedy seed before neighborhood repair...`;
  }
  return `Running ${optimizerLabel} solver. Searching for an initial result...`;
}

function applyRunningSnapshot(payload) {
  if (!payload?.solution || payload.jobStatus !== "running") return;
  clearExpansionAdvice();
  state.result = payload;
  state.resultIsLiveSnapshot = true;
  state.resultError = "";
  state.layoutEditor.edited = false;
  state.layoutEditor.status = "";
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

function createBuildingOverlay(kind, index, placement, layout, label, isSelected = false) {
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
  if (isSelected) outline.classList.add("selected");
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
    elements.resultOverlay.append(
      createBuildingOverlay(
        "service",
        index,
        service,
        layout,
        label,
        state.selectedMapBuilding?.kind === "service" && state.selectedMapBuilding?.index === index
      )
    );
  });
  solution.residentials.forEach((residential, index) => {
    const label = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
    elements.resultOverlay.append(
      createBuildingOverlay(
        "residential",
        index,
        residential,
        layout,
        label,
        state.selectedMapBuilding?.kind === "residential" && state.selectedMapBuilding?.index === index
      )
    );
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
    renderSelectedBuildingDetail(null);
    return;
  }

  const matrix = createSolvedMapMatrix(grid, solution);
  const cols = matrix[0]?.length ?? 0;
  const hoverLabels = createSolvedMapHoverLabels(solution, matrix.length, cols);
  state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
  state.selectedMapCell = getSelectedMapCell(grid);
  elements.resultMapGrid.innerHTML = "";
  elements.resultMapGrid.dataset.cols = String(cols);

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const kind = matrix[r][c];
      const hoverLabel = hoverLabels[r]?.[c] || "";
      const cell = document.createElement("div");
      cell.className = `grid-cell ${kind}`;
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.setAttribute("aria-label", describeSolvedCell(kind, r, c, hoverLabel));
      cell.title = hoverLabel || `(${r}, ${c}) ${kind}`;
      if (kind === "service" || kind === "residential") {
        cell.classList.add("selectable");
      }
      if (state.selectedMapCell?.r === r && state.selectedMapCell?.c === c) {
        cell.classList.add("selected");
      }
      elements.resultMapGrid.append(cell);
    }
  }

  applyMatrixLayout(elements.resultMapGrid);
  renderBuildingOverlay(solution);
  renderSelectedBuildingDetail(solution);
}

function renderResults() {
  syncActionAvailability();
  if (state.resultError) {
    state.resultIsLiveSnapshot = false;
    state.selectedMapBuilding = null;
    state.selectedMapCell = null;
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
    elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
    elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
    elements.resultMapGrid.innerHTML = "";
    delete elements.resultMapGrid.dataset.cols;
    clearResultOverlay();
    renderSelectedBuildingDetail(null);
    renderLayoutEditorControls();
    renderExpansionAdvice();
    return;
  }

  if (!state.result) {
    state.resultIsLiveSnapshot = false;
    state.selectedMapBuilding = null;
    state.selectedMapCell = null;
    elements.resultsEmpty.hidden = false;
    elements.resultsContent.hidden = true;
    elements.resultBadge.textContent = "Waiting";
    elements.resultBadge.className = "result-badge idle";
    elements.resultElapsed.textContent = "00:00";
    elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
    elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
    elements.resultMapGrid.innerHTML = "";
    delete elements.resultMapGrid.dataset.cols;
    clearResultOverlay();
    renderSelectedBuildingDetail(null);
    renderLayoutEditorControls();
    renderExpansionAdvice();
    return;
  }

  const { solution, stats, validation } = state.result;
  state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
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
      ? "Showing the best validated layout found so far while the solver keeps running. The first live capture appears as soon as an incumbent is available, then refreshes every 1 minute."
      : `The latest running snapshot needs review: ${validation.errors.join(" ")}`;
  } else if (state.layoutEditor.edited) {
    elements.resultBadge.textContent = validation.valid ? "Edited" : "Edited review";
    elements.resultBadge.className = `result-badge ${validation.valid ? "success" : "error"}`;
    elements.validationNotice.className = `notice ${validation.valid ? "info" : "error"}`;
    elements.validationNotice.textContent = validation.valid
      ? "The manual layout edit passed validation for the current grid and settings."
      : validation.errors.join(" ");
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
  elements.resultSolverStatus.textContent = state.layoutEditor.edited
    ? "manual edit"
    : liveSnapshot
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

  const serviceTypes = state.resultContext?.params?.serviceTypes ?? [];
  const residentialTypes = state.resultContext?.params?.residentialTypes ?? [];
  renderRemainingAvailability(
    elements.remainingServiceList,
    serviceTypes,
    countPlacementsByType(solution.serviceTypeIndices, serviceTypes.length),
    "Service"
  );
  renderRemainingAvailability(
    elements.remainingResidentialList,
    residentialTypes,
    countPlacementsByType(solution.residentialTypeIndices, residentialTypes.length),
    "Residential"
  );

  renderSolvedMap(solvedGrid, solution);
  renderLayoutEditorControls();
  renderExpansionAdvice();
}

async function waitForSolveResult(requestId) {
  let hasReceivedRunningSnapshot = false;
  let nextSnapshotRefreshAt = 0;
  while (true) {
    const shouldRequestSnapshot = !hasReceivedRunningSnapshot || Date.now() >= nextSnapshotRefreshAt;
    const searchParams = new URLSearchParams({ requestId });
    if (shouldRequestSnapshot) {
      searchParams.set("includeSnapshot", "1");
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
        hasReceivedRunningSnapshot = true;
        nextSnapshotRefreshAt = Date.now() + LIVE_SNAPSHOT_REFRESH_INTERVAL_MS;
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
  state.layoutEditor.mode = "inspect";
  state.layoutEditor.pendingPlacement = null;
  state.layoutEditor.status = "";
  clearExpansionAdvice();
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
    } else if (state.optimizer === "lns") {
      setSolveState(
        `${state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint() ? "Running LNS from the displayed seed" : "Running LNS from a greedy seed"} with ${request.params.lns.iterations} neighborhood repairs and a ${request.params.lns.repairTimeLimitSeconds}s repair cap...`
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
    state.layoutEditor.edited = false;
    state.layoutEditor.status = "";
    state.layoutEditor.mode = "inspect";
    state.layoutEditor.pendingPlacement = null;
    state.selectedMapCell = null;
    pauseSolveTimer();
    setResultElapsed(state.solveTimerElapsedMs);
    const stoppedByUser = Boolean(payload.solution?.stoppedByUser || payload.stats?.stoppedByUser);
    setSolveState(
      payload.message
        ? payload.message
        : stoppedByUser
          ? `Stopped early. Showing the best ${getOptimizerLabel(payload.stats.optimizer)} result found${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
          : `Solved with ${getOptimizerLabel(payload.stats.optimizer)}${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
    );
  } catch (error) {
    state.result = null;
    state.resultIsLiveSnapshot = false;
    state.resultError = error instanceof Error ? error.message : "Unknown solve error.";
    state.layoutEditor.edited = false;
    state.layoutEditor.status = "";
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
  elements.expansionNextService.value = state.expansionAdvice.nextServiceText;
  elements.expansionNextResidential.value = state.expansionAdvice.nextResidentialText;
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
      updatePayloadPreview();
    });
  });

  const lnsCpSatBindings = [
    ["lnsNumWorkers", "numWorkers", "number"],
    ["lnsLogSearchProgress", "logSearchProgress", "checkbox"],
    ["lnsPythonExecutable", "pythonExecutable", "text"],
  ];

  lnsCpSatBindings.forEach(([elementKey, stateKey, inputType]) => {
    elements[elementKey].addEventListener("input", () => {
      state.cpSat[stateKey] = inputType === "checkbox" ? elements[elementKey].checked : elements[elementKey].value;
      updatePayloadPreview();
    });
  });

  elements.lnsUseDisplayedSeed.addEventListener("change", () => {
    state.lns.useDisplayedSeed = elements.lnsUseDisplayedSeed.checked;
    updatePayloadPreview();
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

  elements.cpSatUseDisplayedHint.addEventListener("change", () => {
    state.cpSat.useDisplayedHint = elements.cpSatUseDisplayedHint.checked;
    updatePayloadPreview();
  });

  elements.maxServices.addEventListener("input", () => {
    state.availableBuildings.services = elements.maxServices.value;
    updatePayloadPreview();
  });

  elements.maxResidentials.addEventListener("input", () => {
    state.availableBuildings.residentials = elements.maxResidentials.value;
    updatePayloadPreview();
  });

  elements.expansionNextService.addEventListener("input", () => {
    state.expansionAdvice.nextServiceText = elements.expansionNextService.value;
    state.expansionAdvice.result = null;
    state.expansionAdvice.error = "";
    renderExpansionAdvice();
    syncActionAvailability();
  });

  elements.expansionNextResidential.addEventListener("input", () => {
    state.expansionAdvice.nextResidentialText = elements.expansionNextResidential.value;
    state.expansionAdvice.result = null;
    state.expansionAdvice.error = "";
    renderExpansionAdvice();
    syncActionAvailability();
  });

  elements.layoutEditModeToggle.addEventListener("click", (event) => {
    if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-layout-edit-mode]");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.layoutEditMode) return;
    setLayoutEditMode(button.dataset.layoutEditMode);
  });

  const handleRemainingPlacementClick = (event) => {
    if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const typeIndex = Number(button.dataset.typeIndex);
    const name = String(button.dataset.name ?? "").trim() || "Selected building";
    if (!Number.isInteger(typeIndex) || typeIndex < 0) return;
    if (button.dataset.action === "place-remaining-service") {
      setLayoutEditMode("place-service", { kind: "service", typeIndex, name });
    } else if (button.dataset.action === "place-remaining-residential") {
      setLayoutEditMode("place-residential", { kind: "residential", typeIndex, name });
    }
  };

  elements.remainingServiceList.addEventListener("click", handleRemainingPlacementClick);
  elements.remainingResidentialList.addEventListener("click", handleRemainingPlacementClick);

  elements.moveSelectedBuildingButton.addEventListener("click", () => {
    if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
    if (!getSelectedMapPlacement(state.result?.solution)) {
      state.layoutEditor.status = "Select a building first, then use Move selected.";
      renderLayoutEditorControls();
      return;
    }
    setLayoutEditMode("move");
  });

  elements.removeSelectedBuildingButton.addEventListener("click", async () => {
    if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
    const selected = getSelectedMapPlacement(state.result?.solution);
    if (!selected) {
      state.layoutEditor.status = "Select a building first, then use Remove selected.";
      renderLayoutEditorControls();
      return;
    }
    try {
      const nextSolution = cloneEditableSolution();
      removePlacementFromSolution(nextSolution, selected);
      await evaluateEditedLayout(nextSolution, {
        message: `Removed ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
      });
    } catch (error) {
      state.layoutEditor.status = error instanceof Error ? error.message : "Failed to remove the selected building.";
      renderLayoutEditorControls();
    }
  });

  elements.resultMapGrid.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !state.result?.solution) return;
    const cell = target.closest(".grid-cell");
    if (!(cell instanceof HTMLDivElement)) return;
    const row = Number(cell.dataset.r);
    const col = Number(cell.dataset.c);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;

    try {
      if (state.isSolving || state.layoutEditor.isApplying) {
        if (state.layoutEditor.mode !== "inspect") return;
      }
      if (state.layoutEditor.mode === "road") {
        await toggleManualRoad(row, col);
        return;
      }
      if (state.layoutEditor.mode === "erase") {
        await eraseAtCell(row, col);
        return;
      }
      if (state.layoutEditor.mode === "move") {
        await moveSelectedBuilding(row, col);
        return;
      }
      if (state.layoutEditor.mode === "place-service" || state.layoutEditor.mode === "place-residential") {
        await placePendingBuilding(row, col);
        return;
      }

      const selected = findBuildingAtCell(state.result.solution, row, col);
      state.selectedMapBuilding = selected;
      state.selectedMapCell = selected ? null : { r: row, c: col };
      renderSolvedMap(state.resultContext?.grid ?? state.grid, state.result.solution);
      renderLayoutEditorControls();
    } catch (error) {
      state.layoutEditor.status = error instanceof Error ? error.message : "Failed to apply that manual edit.";
      renderLayoutEditorControls();
    }
  });

  elements.compareExpansionButton.addEventListener("click", () => {
    compareExpansionOptions();
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

  elements.deleteLayoutButton.addEventListener("click", () => {
    deleteSelectedLayout();
  });

  elements.solveButton.addEventListener("click", () => {
    runSolve();
  });
  elements.stopSolveButton.addEventListener("click", () => {
    requestStopSolve();
  });
}

init();
