const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { solve } = require("../dist/index.js");
const { evaluateLayout } = require("../dist/core/evaluator.js");
const { buildManualLayoutResponse, buildSolveResponse } = require("../dist/server/http/contracts.js");
const { SolveProgressLogWriter } = require("../dist/runtime/jobs/solveProgressLog.js");

function createFakeDomElement(overrides = {}) {
  return {
    value: "",
    checked: false,
    hidden: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: {
      setProperty() {},
    },
    parentElement: null,
    append() {},
    appendChild() {},
    setAttribute() {},
    querySelectorAll() {
      return [];
    },
    classList: {
      toggle() {},
    },
    ...overrides,
  };
}

function loadPlannerSharedModule() {
  const source = fs.readFileSync(path.resolve(__dirname, "../web/plannerShared.js"), "utf8");
  const context = {
    window: {
      setTimeout,
      clearTimeout,
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CityBuilderShared;
}

function loadPlannerRequestBuilderModule(crypto = undefined) {
  const source = fs.readFileSync(path.resolve(__dirname, "../web/plannerRequestBuilder.js"), "utf8");
  const context = {
    window: {
      crypto,
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    Uint32Array,
    Error,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CityBuilderRequestBuilder;
}

function loadPlannerWorkbenchModule() {
  const source = fs.readFileSync(path.resolve(__dirname, "../web/plannerWorkbench.js"), "utf8");
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  const context = {
    window: {},
    document: {
      createElement() {
        return createFakeDomElement();
      },
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    ResizeObserver,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CityBuilderWorkbench;
}

function loadPlannerSolveRuntimeModule() {
  const source = fs.readFileSync(path.resolve(__dirname, "../web/plannerSolveRuntime.js"), "utf8");
  const context = {
    window: {
      clearInterval,
      setInterval,
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    Error,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CityBuilderSolveRuntime;
}

function testDistinctResidentialTypes() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  const evaluation = evaluateLayout({
    grid,
    roads: solution.roads,
    services: [],
    residentials: solution.residentials,
    params,
  });

  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual(solution.populations, [100, 10]);
  assert.deepEqual(solution.residentialTypeIndices, [1, 0]);
  assert.equal(evaluation.totalPopulation, 110);
  assert.equal(evaluation.valid, true);
}

function testNoRowZeroRoadThrows() {
  const grid = [
    [0, 0, 0],
    [1, 1, 1],
    [1, 1, 1],
  ];

  assert.throws(() => solve(grid, { basePop: 10, maxPop: 10, greedy: { localSearch: false } }), /No feasible solution found/);
}

function testEvaluatorHonorsCountCaps() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const roads = new Set(["0,0", "1,0", "2,0", "3,0"]);
  const residentials = [
    { r: 0, c: 1, rows: 2, cols: 2 },
    { r: 2, c: 1, rows: 2, cols: 2 },
  ];

  const evaluation = evaluateLayout({
    grid,
    roads,
    services: [],
    residentials,
    params: {
      basePop: 10,
      maxPop: 10,
      availableBuildings: { residentials: 1 },
    },
  });

  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join("\n"), /exceeding the limit of 1/);
}

function testResidentialCapStillAppliesWithTypedResidentials() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 2 },
      { w: 2, h: 2, min: 20, max: 20, avail: 2 },
    ],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);

  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.totalPopulation, 20);
}

function testNamedBuildingTypesAreAccepted() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ name: "Health Clinic", rows: 2, cols: 2, bonus: 40, range: 1, avail: 1 }],
    residentialTypes: [{ name: "The Aurora", w: 2, h: 2, min: 100, max: 140, avail: 1 }],
    availableBuildings: { residentials: 1, services: 1 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  assert.equal(solution.services.length, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.totalPopulation >= 100, true);
}

function testGreedySkipsServicesWithZeroMarginalGain() {
  const { solveGreedy } = require("../dist/index.js");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 2 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false },
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.services.length, 0);
  assert.equal(solution.residentials.length, 2);
  assert.equal(solution.totalPopulation, 200);
}

function testGreedyLocalSearchDoesNotRegressNontrivialSeed() {
  const { solveGreedy } = require("../dist/index.js");
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 80, range: 1, avail: 1 },
      { rows: 2, cols: 3, bonus: 60, range: 1, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 70, max: 130, avail: 2 },
      { w: 2, h: 3, min: 90, max: 210, avail: 2 },
    ],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
    },
  };

  const baseline = solveGreedy(grid, params);
  const improved = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      localSearch: true,
    },
  });

  assert.equal(improved.totalPopulation >= baseline.totalPopulation, true);
}

function testIndexImportHasNoSideEffects() {
  const originalLog = console.log;
  const calls = [];
  console.log = (...args) => {
    calls.push(args.join(" "));
  };

  try {
    const indexPath = require.resolve("../dist/index.js");
    delete require.cache[indexPath];
    const api = require(indexPath);
    assert.equal(typeof api.solve, "function");
    assert.equal(typeof api.evaluateLayout, "function");
    assert.deepEqual(calls, []);
    delete require.cache[indexPath];
  } finally {
    console.log = originalLog;
  }
}

function testPlannerServiceAvailabilityRoundTrip() {
  const plannerShared = loadPlannerSharedModule();
  const serialized = plannerShared.serializeServiceTypeForCatalog({
    name: "Health Clinic",
    rows: 2,
    cols: 2,
    bonus: 40,
    range: 1,
    avail: 3,
  });
  assert.equal(serialized.avail, "3");

  const parsed = plannerShared.parseServiceCatalogEntry(serialized, 0);
  assert.equal(parsed.avail, 3);

  const imported = plannerShared.parseCatalogImportText(
    ["Name\tBonus\tSize\tEffective\tAvail", "Health Clinic\t40\t2x2\t4x4\t3"].join("\n")
  );
  assert.equal(imported.services.length, 1);
  assert.equal(imported.services[0].avail, "3");

  const importedLegacy = plannerShared.parseCatalogImportText(
    ["Name\tBonus\tSize\tEffective", "Health Clinic\t40\t2x2\t4x4"].join("\n")
  );
  assert.equal(importedLegacy.services[0].avail, "1");
}

function testPlannerAutoFillsCpSatRandomSeed() {
  const plannerRequestBuilder = loadPlannerRequestBuilderModule({
    getRandomValues(array) {
      array[0] = 123456789;
      return array;
    },
  });
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid: [[1, 1], [1, 1]],
      serviceTypes: [],
      residentialTypes: [],
      availableBuildings: {
        services: "",
        residentials: "",
      },
      greedy: {
        localSearch: true,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
      },
      cpSat: {
        timeLimitSeconds: "",
        noImprovementTimeoutSeconds: "",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
        useDisplayedHint: false,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 1,
        neighborhoodCols: 1,
        repairTimeLimitSeconds: 1,
        useDisplayedSeed: false,
      },
      result: null,
      resultContext: null,
      resultElapsedMs: 0,
    },
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" },
    },
    helpers: {
      buildCpSatContinuationModelInput() {
        return {};
      },
      buildCpSatWarmStartCheckpoint() {
        throw new Error("Warm-start checkpoint should not be requested in this test.");
      },
      clampInteger(value, fallback, min = 0) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.floor(parsed));
      },
      cloneGrid(grid) {
        return JSON.parse(JSON.stringify(grid));
      },
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      computeCpSatModelFingerprint() {
        return "fingerprint";
      },
      getSavedLayoutElapsedMs() {
        return 0;
      },
      readOptionalInteger(value, min = 0) {
        if (value === "" || value === null || value === undefined) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.max(min, Math.floor(parsed));
      },
      parseResidentialCatalogEntry(entry) {
        return entry;
      },
      parseServiceCatalogEntry(entry) {
        return entry;
      },
    },
  });

  assert.equal(controller.ensureCpSatRandomSeed(), 123456789);
  const request = controller.buildSolveRequest();
  assert.equal(request.params.cpSat.randomSeed, 123456789);
  assert.equal(controller.ensureCpSatRandomSeed(), 123456789);
}

function testPlannerBuildSolveRequestIncludesCpSatNoImprovementTimeout() {
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid: [[1, 1], [1, 1]],
      serviceTypes: [],
      residentialTypes: [],
      availableBuildings: {
        services: "",
        residentials: "",
      },
      greedy: {
        localSearch: true,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
      },
      cpSat: {
        timeLimitSeconds: "30",
        noImprovementTimeoutSeconds: "10",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
        useDisplayedHint: false,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 1,
        neighborhoodCols: 1,
        repairTimeLimitSeconds: 1,
        useDisplayedSeed: false,
      },
      result: null,
      resultContext: null,
      resultElapsedMs: 0,
    },
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" },
    },
    helpers: {
      buildCpSatContinuationModelInput() {
        return {};
      },
      buildCpSatWarmStartCheckpoint() {
        throw new Error("Warm-start checkpoint should not be requested in this test.");
      },
      clampInteger(value, fallback, min = 0) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.floor(parsed));
      },
      cloneGrid(grid) {
        return JSON.parse(JSON.stringify(grid));
      },
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      computeCpSatModelFingerprint() {
        return "fingerprint";
      },
      getSavedLayoutElapsedMs() {
        return 0;
      },
      readOptionalInteger(value, min = 0) {
        if (value === "" || value === null || value === undefined) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.max(min, Math.floor(parsed));
      },
      parseResidentialCatalogEntry(entry) {
        return entry;
      },
      parseServiceCatalogEntry(entry) {
        return entry;
      },
    },
  });

  const request = controller.buildSolveRequest();
  assert.equal(request.params.cpSat.timeLimitSeconds, 30);
  assert.equal(request.params.cpSat.noImprovementTimeoutSeconds, 10);
  assert.equal(request.params.cpSat.useDisplayedHint, false);
  assert.equal(request.params.lns.useDisplayedSeed, false);
}

function testPlannerSavedLayoutRestoreRoundTripsHintSeedToggles() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const plannerWorkbench = loadPlannerWorkbenchModule();
  const grid = [
    [1, 1],
    [1, 1],
  ];

  const requestBuilderController = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid,
      serviceTypes: [],
      residentialTypes: [
        plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
      ],
      availableBuildings: {
        services: "0",
        residentials: "1",
      },
      greedy: {
        localSearch: false,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
      },
      cpSat: {
        timeLimitSeconds: "",
        noImprovementTimeoutSeconds: "",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
        useDisplayedHint: false,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        repairTimeLimitSeconds: 1,
        useDisplayedSeed: false,
      },
      result: null,
      resultContext: null,
      resultElapsedMs: 0,
    },
    elements: {
      cpSatRandomSeed: createFakeDomElement(),
      cpSatHintStatus: createFakeDomElement(),
      lnsSeedStatus: createFakeDomElement(),
      payloadPreview: createFakeDomElement(),
      layoutStorageName: createFakeDomElement(),
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
  });

  const savedRequest = requestBuilderController.buildSolveRequest();
  assert.equal(savedRequest.params.cpSat.useDisplayedHint, false);
  assert.equal(savedRequest.params.lns.useDisplayedSeed, false);

  const restoredState = {
    optimizer: "greedy",
    isSolving: false,
    grid,
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: "",
    },
    greedy: {
      localSearch: true,
      randomSeed: "",
      restarts: 20,
      serviceRefineIterations: 4,
      serviceRefineCandidateLimit: 60,
      exhaustiveServiceSearch: true,
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
    },
    lns: {
      iterations: 12,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 6,
      neighborhoodCols: 8,
      repairTimeLimitSeconds: 5,
      useDisplayedSeed: true,
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: "",
    },
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
      payloadPreview: createFakeDomElement(),
    },
    constants: {
      sampleGrid: [[1]],
    },
    helpers: {
      cloneGrid: plannerShared.cloneGrid,
      createGrid: plannerShared.createGrid,
      escapeHtml: plannerShared.escapeHtml,
      isGridLike: plannerShared.isGridLike,
      normalizeOptimizer: plannerShared.normalizeOptimizer,
      parseCatalogImportText: plannerShared.parseCatalogImportText,
      serializeResidentialTypeForCatalog: plannerShared.serializeResidentialTypeForCatalog,
      serializeServiceTypeForCatalog: plannerShared.serializeServiceTypeForCatalog,
    },
    callbacks: {
      getOptimizerLabel(optimizer) {
        return optimizer === "cp-sat" ? "CP-SAT" : optimizer === "lns" ? "LNS" : "Greedy";
      },
      refreshResultOverlay() {},
      renderExpansionAdvice() {},
      setSolveState() {},
      updatePayloadPreview() {},
    },
  });

  workbenchController.applySolveRequestToPlanner(savedRequest, {
    preserveCpSatRuntime: false,
    optimizer: savedRequest.params.optimizer,
  });

  assert.equal(restoredState.cpSat.useDisplayedHint, false);
  assert.equal(restoredState.lns.useDisplayedSeed, false);
}

function testPlannerRuntimePresetAppliesBoundedCpSatPolicy() {
  const plannerWorkbench = loadPlannerWorkbenchModule();
  let payloadPreviewUpdates = 0;
  let solveStateMessage = "";
  const state = {
    isSolving: false,
    grid: [[1, 1], [1, 1], [1, 1], [1, 1]],
    optimizer: "greedy",
    serviceTypes: [{ name: "Clinic" }],
    residentialTypes: [{ name: "Tower" }],
    availableBuildings: {
      services: "",
      residentials: "",
    },
    greedy: {
      localSearch: true,
      randomSeed: "",
      restarts: 20,
      serviceRefineIterations: 4,
      serviceRefineCandidateLimit: 60,
      exhaustiveServiceSearch: true,
      serviceExactPoolLimit: 22,
      serviceExactMaxCombinations: 12000,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 2,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false,
    },
    lns: {
      iterations: 12,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 5,
      useDisplayedSeed: false,
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: "",
    },
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
    summaryOptimizer: { textContent: "" },
  };
  const controller = plannerWorkbench.createPlannerWorkbenchController({
    state,
    elements,
    constants: {
      sampleGrid: [[1]],
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
      },
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
      },
    },
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

function testManualLayoutResponseClearsSolverMetadata() {
  const response = buildManualLayoutResponse(
    [
      [1, 1],
      [1, 1],
    ],
    {
      basePop: 10,
      maxPop: 10,
      availableBuildings: { residentials: 0, services: 0 },
    },
    {
      optimizer: "cp-sat",
      cpSatStatus: "OPTIMAL",
      cpSatObjectivePolicy: {
        populationWeight: 5,
        maxTieBreakPenalty: 4,
        summary: "maximize population, then minimize roads + services",
      },
      cpSatTelemetry: {
        solveWallTimeSeconds: 1,
        userTimeSeconds: 1,
        solutionCount: 1,
        incumbentObjectiveValue: 0,
        bestObjectiveBound: 0,
        objectiveGap: 0,
        incumbentPopulation: 0,
        bestPopulationUpperBound: 0,
        populationGapUpperBound: 0,
        lastImprovementAtSeconds: 0,
        secondsSinceLastImprovement: 0,
        numBranches: 0,
        numConflicts: 0,
      },
      cpSatPortfolio: {
        workerCount: 1,
        selectedWorkerIndex: 0,
        workers: [
          {
            workerIndex: 0,
            randomSeed: 1,
            randomizeSearch: true,
            numWorkers: 1,
            status: "OPTIMAL",
            feasible: true,
            totalPopulation: 0,
          },
        ],
      },
      stoppedByUser: true,
      roads: new Set(["0,0", "0,1"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0,
    }
  );

  assert.equal(response.solution.optimizer, undefined);
  assert.equal(response.solution.manualLayout, true);
  assert.equal(response.solution.cpSatStatus, undefined);
  assert.equal(response.solution.cpSatObjectivePolicy, undefined);
  assert.equal(response.solution.cpSatTelemetry, undefined);
  assert.equal(response.solution.cpSatPortfolio, undefined);
  assert.equal(response.solution.stoppedByUser, false);
  assert.equal(response.stats.optimizer, undefined);
  assert.equal(response.stats.manualLayout, true);
  assert.equal(response.stats.cpSatStatus, null);
  assert.equal(response.stats.stoppedByUser, false);
}

function testBuildCpSatWarmStartCheckpointRejectsInvalidLayouts() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
  };
  const invalidManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,2", "1,2"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
      { r: 2, c: 0, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [0, 0],
    populations: [10, 10],
    totalPopulation: 20,
  });

  assert.equal(invalidManualResult.validation.valid, false);
  assert.throws(
    () => plannerShared.buildCpSatWarmStartCheckpoint(invalidManualResult, { grid, params }, 0),
    /Only valid layouts can be reused as a CP-SAT hint or LNS seed/
  );
}

function testBuildCpSatWarmStartCheckpointRejectsLegacyLayoutsWithoutValidation() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
  };
  const invalidManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,2", "1,2"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
      { r: 2, c: 0, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [0, 0],
    populations: [10, 10],
    totalPopulation: 20,
  });
  const legacySavedResult = {
    ...invalidManualResult,
  };
  delete legacySavedResult.validation;

  assert.throws(
    () => plannerShared.buildCpSatWarmStartCheckpoint(legacySavedResult, { grid, params }, 0),
    /missing validation metadata/
  );
}

function testPlannerRequestBuilderSkipsLegacySavedCheckpointWithoutValidation() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {},
  };
  const validManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10,
  });
  const legacySavedResult = {
    ...validManualResult,
  };
  delete legacySavedResult.validation;

  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid,
      serviceTypes: [],
      residentialTypes: [
        plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
      ],
      availableBuildings: {
        services: "0",
        residentials: "1",
      },
      greedy: {
        localSearch: false,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
      },
      cpSat: {
        timeLimitSeconds: "",
        noImprovementTimeoutSeconds: "",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
        useDisplayedHint: false,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        repairTimeLimitSeconds: 1,
        useDisplayedSeed: false,
      },
      result: null,
      resultContext: null,
      resultElapsedMs: 0,
    },
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
  });

  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validManualResult, { grid, params }, 0);
  const legacySavedEntry = {
    id: "legacy-layout",
    name: "Legacy Layout",
    savedAt: "2026-04-18T09:00:00.000Z",
    elapsedMs: 0,
    result: legacySavedResult,
    resultContext: { grid, params },
    continueCpSat: checkpoint,
  };

  assert.equal(controller.getSavedLayoutCheckpoint(legacySavedEntry), null);
}

function testPlannerRequestBuilderSkipsInvalidDisplayedLayoutContinuation() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {},
  };
  const invalidManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,2", "1,2"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
      { r: 2, c: 0, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [0, 0],
    populations: [10, 10],
    totalPopulation: 20,
  });
  const state = {
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
    ],
    availableBuildings: {
      services: "0",
      residentials: "1",
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true,
    },
    result: invalidManualResult,
    resultContext: { grid, params },
    resultElapsedMs: 0,
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
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
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    cpSat: {},
    lns: {},
  };
  const validManualResult = buildManualLayoutResponse(grid, params, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [
      { r: 0, c: 0, rows: 2, cols: 2 },
    ],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10,
  });
  const legacySavedResult = {
    ...validManualResult,
  };
  delete legacySavedResult.validation;

  const state = {
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
    ],
    availableBuildings: {
      services: "0",
      residentials: "1",
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true,
    },
    result: legacySavedResult,
    resultContext: { grid, params },
    resultElapsedMs: 0,
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
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

function testPlannerRequestBuilderIncludesHintAndSeedForAuto() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "auto",
    serviceTypes: [],
    residentialTypes: [{ name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 1 },
    cpSat: {},
    lns: {},
  };
  const validResult = buildSolveResponse(grid, { ...params, optimizer: "greedy" }, solve(grid, { ...params, optimizer: "greedy" }));

  const state = {
    optimizer: "auto",
    grid,
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
    ],
    availableBuildings: {
      services: "1",
      residentials: "1",
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true,
    },
    result: validResult,
    resultContext: { grid, params },
    resultElapsedMs: 0,
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
  });

  const request = controller.buildSolveRequest({ hintMismatch: "ignore" });
  assert.equal(request.params.optimizer, "auto");
  assert.ok(request.params.cpSat.warmStartHint);
  assert.ok(request.params.lns.seedHint);
}

function testPlannerRequestBuilderTreatsBlankAutoCapAsUnlimited() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];

  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: "",
    },
    grid,
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
    ],
    availableBuildings: {
      services: "1",
      residentials: "1",
    },
    greedy: {
      localSearch: false,
      randomSeed: "",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: false,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: false,
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0,
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
  });

  const unlimitedRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(unlimitedRequest.params.auto, undefined);

  state.auto.wallClockLimitSeconds = "90";
  const cappedRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(cappedRequest.params.auto.wallClockLimitSeconds, 90);
}

function testPlannerRequestBuilderUsesBoundedGreedyProfileForAuto() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: "",
    },
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog({ w: 2, h: 2, min: 10, max: 10, avail: 1 }),
    ],
    availableBuildings: {
      services: "1",
      residentials: "1",
    },
    greedy: {
      localSearch: true,
      randomSeed: "17",
      restarts: 20,
      serviceRefineIterations: 4,
      serviceRefineCandidateLimit: 60,
      exhaustiveServiceSearch: true,
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
      useDisplayedHint: false,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: false,
    },
    result: null,
    resultContext: null,
    resultElapsedMs: 0,
  };
  const elements = {
    cpSatRandomSeed: { value: "" },
    cpSatHintStatus: { textContent: "" },
    lnsSeedStatus: { textContent: "" },
    payloadPreview: { textContent: "" },
    layoutStorageName: { value: "" },
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
  });

  const request = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(request.params.greedy.localSearch, true);
  assert.equal(request.params.greedy.randomSeed, 17);
  assert.equal(request.params.greedy.restarts, 8);
  assert.equal(request.params.greedy.serviceRefineIterations, 2);
  assert.equal(request.params.greedy.serviceRefineCandidateLimit, 40);
  assert.equal(request.params.greedy.exhaustiveServiceSearch, false);
  assert.equal(request.params.greedy.serviceExactPoolLimit, 16);
  assert.equal(request.params.greedy.serviceExactMaxCombinations, 4000);
}

function testPlannerSolveProgressLogCapturesSnapshotAndFinalResult() {
  const runtimeModule = loadPlannerSolveRuntimeModule();
  const logAfterSnapshot = runtimeModule.appendSolveProgressLog([], {
    optimizer: "cp-sat",
    solution: {
      optimizer: "cp-sat",
      totalPopulation: 1234,
      cpSatStatus: "FEASIBLE",
      cpSatTelemetry: {
        bestPopulationUpperBound: 1300,
        populationGapUpperBound: 66,
        secondsSinceLastImprovement: 4.5,
      },
    },
    stats: {
      optimizer: "cp-sat",
      totalPopulation: 1234,
      cpSatStatus: "FEASIBLE",
    },
  }, {
    elapsedMs: 60000,
    capturedAt: "2026-04-14T11:00:00.000Z",
    source: "live-snapshot",
  });

  assert.equal(logAfterSnapshot.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(logAfterSnapshot[0])), {
    capturedAt: "2026-04-14T11:00:00.000Z",
    elapsedMs: 60000,
    source: "live-snapshot",
    optimizer: "cp-sat",
    hasFeasibleSolution: true,
    totalPopulation: 1234,
    cpSatStatus: "FEASIBLE",
    bestPopulationUpperBound: 1300,
    populationGapUpperBound: 66,
    solveWallTimeSeconds: null,
    lastImprovementAtSeconds: null,
    secondsSinceLastImprovement: 4.5,
    note: null,
  });

  const logAfterFinal = runtimeModule.appendSolveProgressLog(logAfterSnapshot, {
    optimizer: "cp-sat",
    solution: {
      optimizer: "cp-sat",
      totalPopulation: 1250,
      cpSatStatus: "OPTIMAL",
      cpSatTelemetry: {
        bestPopulationUpperBound: 1250,
        populationGapUpperBound: 0,
        secondsSinceLastImprovement: 0.2,
      },
    },
    stats: {
      optimizer: "cp-sat",
      totalPopulation: 1250,
      cpSatStatus: "OPTIMAL",
    },
  }, {
    elapsedMs: 90000,
    capturedAt: "2026-04-14T11:00:30.000Z",
    source: "final-result",
  });

  assert.equal(logAfterFinal.length, 2);
  assert.equal(logAfterFinal[1].source, "final-result");
  assert.equal(logAfterFinal[1].totalPopulation, 1250);
  assert.equal(logAfterFinal[1].cpSatStatus, "OPTIMAL");
  assert.equal(logAfterFinal[1].bestPopulationUpperBound, 1250);
  assert.equal(logAfterFinal[1].populationGapUpperBound, 0);
}

function testFilesystemSolveLogTracksSolverClockAcrossHeartbeats() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solve-progress-log-"));
  const writer = new SolveProgressLogWriter({
    rootDirectory: tempRoot,
    requestId: "lag-test",
    optimizer: "cp-sat",
    grid: [[1]],
    params: { optimizer: "cp-sat", cpSat: { randomSeed: 7 } },
    createdAtMs: 0,
  });
  const feasibleSolution = {
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    cpSatTelemetry: {
      solveWallTimeSeconds: 49.774,
      userTimeSeconds: 49.774,
      solutionCount: 1,
      incumbentObjectiveValue: 10,
      bestObjectiveBound: 20,
      objectiveGap: 10,
      incumbentPopulation: 10,
      bestPopulationUpperBound: 20,
      populationGapUpperBound: 10,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 0,
      numBranches: 0,
      numConflicts: 0,
    },
    stoppedByUser: false,
    roads: new Set(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 10,
  };

  writer.appendSolutionSample(feasibleSolution, {
    elapsedMs: 100025,
    capturedAt: "2026-04-14T19:00:00.000Z",
    source: "live-snapshot",
  });

  writer.appendSolutionSample({
    ...feasibleSolution,
    cpSatTelemetry: {
      ...feasibleSolution.cpSatTelemetry,
      secondsSinceLastImprovement: 60,
    },
  }, {
    elapsedMs: 160025,
    capturedAt: "2026-04-14T19:01:00.000Z",
    source: "live-snapshot",
  });

  writer.finish("completed", {
    finishedAtMs: 160025,
    solution: feasibleSolution,
  });

  const payload = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
  assert.equal(payload.entries.length, 2);
  assert.deepEqual(payload.entries.map((entry) => ({
    solveWallTimeSeconds: entry.solveWallTimeSeconds,
    lastImprovementAtSeconds: entry.lastImprovementAtSeconds,
    secondsSinceLastImprovement: entry.secondsSinceLastImprovement,
  })), [
    {
      solveWallTimeSeconds: 49.774,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 0,
    },
    {
      solveWallTimeSeconds: 109.774,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 60,
    },
  ]);
  assert.deepEqual(payload.finalResult.mapRows, [
    "   0",
    " 0 .",
    "",
    "Legend: # blocked  R road  S service  H residential  . empty",
  ]);
  assert.equal(payload.finalResult.mapText, payload.finalResult.mapRows.join("\n"));
  assert.deepEqual(payload.finalResult.solution, {
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    cpSatTelemetry: {
      solveWallTimeSeconds: 109.774,
      userTimeSeconds: 109.774,
      solutionCount: 1,
      incumbentObjectiveValue: 10,
      bestObjectiveBound: 20,
      objectiveGap: 10,
      incumbentPopulation: 10,
      bestPopulationUpperBound: 20,
      populationGapUpperBound: 10,
      lastImprovementAtSeconds: 49.774,
      secondsSinceLastImprovement: 60,
      numBranches: 0,
      numConflicts: 0,
    },
    stoppedByUser: false,
    roads: [],
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 10,
  });
  assert.equal(payload.finalResult.solution.cpSatTelemetry.solveWallTimeSeconds, payload.entries[1].solveWallTimeSeconds);
  assert.equal(
    payload.finalResult.solution.cpSatTelemetry.secondsSinceLastImprovement,
    payload.entries[1].secondsSinceLastImprovement
  );
}

testDistinctResidentialTypes();
testNoRowZeroRoadThrows();
testEvaluatorHonorsCountCaps();
testResidentialCapStillAppliesWithTypedResidentials();
testNamedBuildingTypesAreAccepted();
testGreedySkipsServicesWithZeroMarginalGain();
testGreedyLocalSearchDoesNotRegressNontrivialSeed();
testIndexImportHasNoSideEffects();
testPlannerServiceAvailabilityRoundTrip();
testPlannerAutoFillsCpSatRandomSeed();
testPlannerBuildSolveRequestIncludesCpSatNoImprovementTimeout();
testPlannerSavedLayoutRestoreRoundTripsHintSeedToggles();
testPlannerRuntimePresetAppliesBoundedCpSatPolicy();
testManualLayoutResponseClearsSolverMetadata();
testBuildCpSatWarmStartCheckpointRejectsInvalidLayouts();
testBuildCpSatWarmStartCheckpointRejectsLegacyLayoutsWithoutValidation();
testPlannerRequestBuilderSkipsLegacySavedCheckpointWithoutValidation();
testPlannerRequestBuilderSkipsInvalidDisplayedLayoutContinuation();
testPlannerRequestBuilderSkipsLegacyDisplayedLayoutContinuationWithoutValidation();
testPlannerRequestBuilderIncludesHintAndSeedForAuto();
testPlannerRequestBuilderTreatsBlankAutoCapAsUnlimited();
testPlannerRequestBuilderUsesBoundedGreedyProfileForAuto();
testPlannerSolveProgressLogCapturesSnapshotAndFinalResult();
testFilesystemSolveLogTracksSolverClockAcrossHeartbeats();

console.log("All review finding regression tests passed.");
