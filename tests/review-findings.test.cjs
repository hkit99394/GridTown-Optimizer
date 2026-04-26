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
      add() {},
      remove() {},
      toggle() {},
    },
    ...overrides,
  };
}

function loadBrowserModule(relativePath, options = {}) {
  const {
    window = {},
    context: extraContext = {},
  } = options;
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  const sandbox = {
    window,
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
    ...extraContext,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window;
}

function loadPlannerSharedModule() {
  return loadBrowserModule("../web/plannerShared.js", {
    window: {
      setTimeout,
      clearTimeout,
    },
  }).CityBuilderShared;
}

function loadPlannerRequestBuilderModule(crypto = undefined) {
  return loadBrowserModule("../web/plannerRequestBuilder.js", {
    window: {
      crypto,
    },
    context: {
      Uint32Array,
      Error,
    },
  }).CityBuilderRequestBuilder;
}

function loadPlannerExpansionModule(fetch) {
  return loadBrowserModule("../web/plannerExpansion.js", {
    context: {
      Error,
      fetch,
      URLSearchParams,
    },
  }).CityBuilderExpansion;
}

function loadPlannerWorkbenchModule() {
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  return loadBrowserModule("../web/plannerWorkbench.js", {
    window: {},
    context: {
      document: {
        createElement() {
          return createFakeDomElement();
        },
      },
      ResizeObserver,
    },
  }).CityBuilderWorkbench;
}

function loadPlannerSolveRuntimeModule() {
  return loadBrowserModule("../web/plannerSolveRuntime.js", {
    window: {
      clearInterval,
      setInterval,
    },
    context: {
      Error,
    },
  }).CityBuilderSolveRuntime;
}

function loadPlannerShellModule() {
  return loadBrowserModule("../web/plannerShell.js").CityBuilderShell;
}

function loadPlannerResultsModule(options = {}) {
  return loadBrowserModule("../web/plannerResults.js", options).CityBuilderResults;
}

function loadPlannerPersistenceModule(localStorage = undefined) {
  return loadBrowserModule("../web/plannerPersistence.js", {
    window: {
      localStorage,
    },
    context: {
      document: {
        createElement() {
          return createFakeDomElement();
        },
      },
    },
  }).CityBuilderPersistence;
}

function testDistinctResidentialTypes() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "greedy",
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

  assert.throws(
    () => solve(grid, { optimizer: "greedy", basePop: 10, maxPop: 10, greedy: { localSearch: false } }),
    /No feasible solution found/
  );
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
    optimizer: "greedy",
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
    optimizer: "greedy",
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
  assert.equal(Object.prototype.hasOwnProperty.call(request.params.cpSat, "useDisplayedHint"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.params.lns, "useDisplayedSeed"), false);
}

function testPlannerBuildSolveRequestEnablesGreedyDiagnosticsOnlyForStandaloneGreedy() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "greedy",
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
      timeLimitSeconds: "3900",
      profile: true,
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: "2.5",
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      diagnostics: true,
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
  };
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
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

  const greedyRequest = controller.buildSolveRequest();
  assert.equal(greedyRequest.params.greedy.diagnostics, true);
  assert.equal(greedyRequest.params.greedy.profile, true);
  assert.equal(greedyRequest.params.greedy.timeLimitSeconds, 3900);
  assert.equal(greedyRequest.params.greedy.densityTieBreaker, true);
  assert.equal(greedyRequest.params.greedy.densityTieBreakerTolerancePercent, 2.5);

  state.optimizer = "auto";
  const autoRequest = controller.buildSolveRequest({ includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(autoRequest.params.greedy.diagnostics, false);
  assert.equal(autoRequest.params.greedy.profile, false);
  assert.equal(autoRequest.params.greedy.timeLimitSeconds, undefined);
  assert.equal(autoRequest.params.greedy.densityTieBreaker, false);
  assert.equal(autoRequest.params.greedy.densityTieBreakerTolerancePercent, undefined);

  state.optimizer = "cp-sat";
  const cpSatRequest = controller.buildSolveRequest({ includeWarmStartHint: false });
  assert.equal(cpSatRequest.params.greedy.diagnostics, false);
  assert.equal(cpSatRequest.params.greedy.profile, false);
  assert.equal(cpSatRequest.params.greedy.timeLimitSeconds, undefined);
  assert.equal(cpSatRequest.params.greedy.densityTieBreaker, false);
  assert.equal(cpSatRequest.params.greedy.densityTieBreakerTolerancePercent, undefined);
}

function testPlannerSavedLayoutRestoreRoundTripsHintSeedTogglesAndPortfolio() {
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
        portfolio: {
          enabled: true,
          workerCount: "4",
          randomSeeds: "17, 23, 29",
          perWorkerTimeLimitSeconds: "12",
          perWorkerNumWorkers: "99",
          randomizeSearch: false,
        },
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
      randomSeed: "31",
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

function testPlannerAutoMarksIgnoredSeedControlsUnavailable() {
  const plannerWorkbench = loadPlannerWorkbenchModule();
  const state = {
    grid: [[1, 1]],
    optimizer: "auto",
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: "",
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
      serviceExactMaxCombinations: 12000,
    },
    cpSat: {
      timeLimitSeconds: "",
      noImprovementTimeoutSeconds: "",
      randomSeed: "31",
      numWorkers: 8,
      logSearchProgress: false,
      pythonExecutable: "",
      useDisplayedHint: true,
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      neighborhoodRows: 1,
      neighborhoodCols: 1,
      repairTimeLimitSeconds: 1,
      useDisplayedSeed: true,
    },
    auto: {
      wallClockLimitSeconds: "",
    },
    expansionAdvice: {
      nextServiceText: "",
      nextResidentialText: "",
    },
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
    summaryOptimizer: createFakeDomElement(),
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
      },
    },
    callbacks: {
      getOptimizerLabel(optimizer) {
        return optimizer === "auto" ? "Auto" : optimizer;
      },
      refreshResultOverlay() {},
      renderExpansionAdvice() {},
      setSolveState() {},
      updatePayloadPreview() {},
    },
  });

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
      pendingPlacement: { canRotate: true },
    },
    expansionAdvice: {
      isRunning: false,
    },
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
      },
    },
    remainingServiceList: {
      querySelectorAll() {
        return [];
      },
    },
    remainingResidentialList: {
      querySelectorAll() {
        return [];
      },
    },
    solveStatus: { textContent: "" },
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
      },
    },
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
    },
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const constants = {
    CONFIG_STORAGE_KEY: "configs",
    LAYOUT_STORAGE_KEY: "layouts",
    defaultResidentialTypes: [],
    defaultServiceTypes: [],
    sampleGrid: [[1]],
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
      status: "",
    },
    result: null,
    resultContext: null,
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    optimizer: "greedy",
  };
  const elements = {
    savedLayoutsSelect: createFakeDomElement({ value: "layout-1" }),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement(),
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
      },
    },
    callbacks: {
      applySolveRequestToPlanner() {},
      clearExpansionAdvice() {},
      clearRenderedResultState() {},
      renderResults() {},
      resetSolveTimer() {},
      setResultElapsed() {},
      setSolveState() {},
      syncPlannerFromState() {},
    },
  });

  localStorage.setItem(constants.LAYOUT_STORAGE_KEY, JSON.stringify([
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
          totalPopulation: 0,
        },
        stats: {
          manualLayout: true,
          optimizer: undefined,
          totalPopulation: 0,
          roadCount: 0,
          serviceCount: 0,
          residentialCount: 0,
        },
        validation: {
          valid: false,
          errors: ["Invalid layout"],
        },
      },
      resultContext: {
        grid: [[1]],
        params: {
          optimizer: "greedy",
        },
      },
    },
  ]));

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
    },
  };
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const constants = {
    CONFIG_STORAGE_KEY: "configs",
    LAYOUT_STORAGE_KEY: "layouts",
    defaultResidentialTypes: [],
    defaultServiceTypes: [],
    sampleGrid: [[1]],
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
      status: "",
    },
    result: null,
    resultContext: null,
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    optimizer: "greedy",
  };
  const elements = {
    savedLayoutsSelect: createFakeDomElement({ value: "layout-1" }),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement(),
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
      },
    },
    callbacks: {
      applySolveRequestToPlanner() {},
      clearExpansionAdvice() {},
      clearRenderedResultState() {},
      renderResults() {},
      resetSolveTimer() {},
      setResultElapsed() {},
      setSolveState() {},
      syncPlannerFromState() {},
    },
  });

  localStorage.setItem(constants.LAYOUT_STORAGE_KEY, JSON.stringify([
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
          totalPopulation: 0,
        },
        stats: {
          manualLayout: true,
          optimizer: undefined,
          totalPopulation: 0,
          roadCount: 0,
          serviceCount: 0,
          residentialCount: 0,
        },
        validation: {
          valid: false,
          errors: ["Manual edits are pending validation. Use Validate layout when you're ready."],
        },
      },
      resultContext: {
        grid: [[1]],
        params: {
          optimizer: "greedy",
        },
      },
    },
  ]));

  persistence.loadSelectedLayout();

  assert.equal(state.layoutEditor.pendingValidation, true);
}

function testPlannerResultsRotatePendingPlacementUpdatesFootprint() {
  const plannerResults = loadPlannerResultsModule();
  const state = {
    isSolving: false,
    grid: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
    result: {
      solution: {
        roads: [],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0,
      },
      stats: {
        manualLayout: false,
      },
      validation: {
        valid: true,
        errors: [],
      },
    },
    resultContext: {
      grid: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      params: {
        serviceTypes: [{ name: "Depot", rows: 2, cols: 3, range: 1, bonus: 10, avail: 1 }],
        residentialTypes: [],
      },
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
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
  };
  const modeButtons = [
    createFakeDomElement({ dataset: { layoutEditMode: "inspect" } }),
    createFakeDomElement({ dataset: { layoutEditMode: "place-service" } }),
  ];
  const elements = {
    layoutEditModeToggle: {
      querySelectorAll() {
        return modeButtons;
      },
    },
    layoutEditorStatus: createFakeDomElement(),
    rotatePendingPlacementButton: createFakeDomElement(),
  };
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return String(value);
      },
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {},
    },
  });

  controller.setLayoutEditMode("place-service", {
    kind: "service",
    typeIndex: 0,
    name: "Depot",
    rows: 2,
    cols: 3,
    rotated: false,
    canRotate: true,
  });

  assert.match(elements.layoutEditorStatus.textContent, /Depot \(2x3\)/);
  assert.equal(elements.rotatePendingPlacementButton.textContent, "Rotate 90°");

  controller.handleRotatePendingPlacementAction();

  assert.equal(state.layoutEditor.pendingPlacement.rotated, true);
  assert.match(elements.layoutEditorStatus.textContent, /Depot \(3x2\)/);
  assert.equal(elements.rotatePendingPlacementButton.textContent, "Use original orientation");
}

function testPlannerResultsShowsAutoGeneratedSeedSummary() {
  const plannerResults = loadPlannerResultsModule({
    window: {
      getComputedStyle() {
        return {
          getPropertyValue() {
            return "";
          },
          paddingLeft: "0",
          paddingTop: "0",
        };
      },
    },
    context: {
      document: {
        createElement() {
          return createFakeDomElement();
        },
      },
    },
  });
  const autoStage = {
    requestedOptimizer: "auto",
    activeStage: "cp-sat",
    stageIndex: 3,
    cycleIndex: 1,
    consecutiveWeakCycles: 0,
    lastCycleImprovementRatio: 0.1,
    stopReason: "completed-plan",
    generatedSeeds: [
      { stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: 11 },
      { stage: "lns", stageIndex: 2, cycleIndex: 1, randomSeed: 13 },
      { stage: "cp-sat", stageIndex: 3, cycleIndex: 1, randomSeed: 17 },
    ],
  };
  const state = {
    isSolving: false,
    grid: [[1, 1]],
    result: {
      solution: {
        optimizer: "auto",
        activeOptimizer: "cp-sat",
        autoStage,
        roads: ["0,0"],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0,
      },
      stats: {
        optimizer: "auto",
        activeOptimizer: "cp-sat",
        autoStage,
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 0,
        roadCount: 1,
        serviceCount: 0,
        residentialCount: 0,
      },
      validation: {
        valid: true,
        errors: [],
      },
    },
    resultContext: {
      grid: [[1, 1]],
      params: {
        optimizer: "auto",
        cpSat: { randomSeed: 999 },
        serviceTypes: [],
        residentialTypes: [],
      },
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
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
  };
  const elements = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = createFakeDomElement();
      return target[key];
    },
  });
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return `${value}ms`;
      },
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return value === "cp-sat" ? "CP-SAT" : value === "auto" ? "Auto" : String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {},
    },
  });

  controller.renderResults();

  assert.match(elements.resultSolverStatus.textContent, /Auto -> CP-SAT/);
  assert.match(elements.resultSolverStatus.textContent, /generated 3 stage seeds/);
  assert.match(elements.resultSolverStatus.textContent, /latest CP-SAT 17/);
  assert.doesNotMatch(elements.resultSolverStatus.textContent, /999/);
}

function testPlannerResultsShowsGreedyDiagnosticsReport() {
  function createRecordingElement(overrides = {}) {
    return createFakeDomElement({
      children: [],
      append(...children) {
        this.children.push(...children);
      },
      appendChild(child) {
        this.children.push(child);
      },
      ...overrides,
    });
  }

  const plannerResults = loadPlannerResultsModule({
    window: {
      getComputedStyle() {
        return {
          getPropertyValue() {
            return "";
          },
          paddingLeft: "0",
          paddingTop: "0",
        };
      },
    },
    context: {
      document: {
        createElement() {
          return createRecordingElement();
        },
      },
    },
  });
  const state = {
    isSolving: false,
    grid: [[1, 1], [1, 1]],
    result: {
      solution: {
        optimizer: "greedy",
        roads: [],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0,
        greedyDiagnostics: {
          version: 1,
          candidateLimit: 2000,
          examplesPerReason: 3,
          services: {
            candidateLimit: 2000,
            candidatesScanned: 1,
            candidatesSkippedAsPlaced: 0,
            truncated: false,
            placedCount: 0,
            overallAvailability: { limit: null, used: 0, remaining: null },
            availabilityByType: [],
            reasonCounts: { "no-service-coverage": 1 },
            examplesByReason: {
              "no-service-coverage": [
                {
                  kind: "service",
                  reason: "no-service-coverage",
                  reasons: ["no-service-coverage"],
                  r: 0,
                  c: 0,
                  rows: 1,
                  cols: 1,
                  typeIndex: 0,
                  typeName: "Clinic",
                  score: 0,
                },
              ],
            },
          },
          residentials: {
            candidateLimit: 2000,
            candidatesScanned: 1,
            candidatesSkippedAsPlaced: 0,
            truncated: false,
            placedCount: 0,
            overallAvailability: { limit: null, used: 0, remaining: null },
            availabilityByType: [],
            reasonCounts: { "base-only": 1 },
            examplesByReason: {
              "base-only": [
                {
                  kind: "residential",
                  reason: "base-only",
                  reasons: ["base-only"],
                  r: 0,
                  c: 0,
                  rows: 1,
                  cols: 1,
                  typeIndex: 0,
                  typeName: "House",
                  population: 10,
                  basePopulation: 10,
                },
              ],
            },
          },
        },
      },
      stats: {
        optimizer: "greedy",
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 0,
        roadCount: 0,
        serviceCount: 0,
        residentialCount: 0,
      },
      validation: {
        valid: true,
        errors: [],
      },
    },
    resultContext: {
      grid: [[1, 1], [1, 1]],
      params: {
        optimizer: "greedy",
        serviceTypes: [{ name: "Clinic", bonus: 10, rows: 1, cols: 1, range: 1, avail: 1 }],
        residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 20, avail: 1 }],
      },
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
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
  };
  const elements = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = createRecordingElement();
      return target[key];
    },
  });
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return `${value}ms`;
      },
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return value === "greedy" ? "Greedy" : String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {},
    },
  });

  controller.renderResults();

  assert.equal(elements.greedyDiagnosticsBlock.hidden, false);
  assert.match(elements.greedyDiagnosticsSummary.textContent, /1 unplaced service candidates/);
  assert.equal(elements.greedyDiagnosticsServiceList.children.length, 1);
  assert.equal(elements.greedyDiagnosticsResidentialList.children.length, 1);
  assert.match(elements.greedyDiagnosticsServiceList.children[0].children[0].textContent, /No service coverage: 1/);
  assert.match(elements.greedyDiagnosticsResidentialList.children[0].children[0].textContent, /Base population only: 1/);
}

function testPlannerResultsAppliesServiceValueHeatmap() {
  function createRecordingElement(overrides = {}) {
    return createFakeDomElement({
      attributes: {},
      children: [],
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
      },
      append(...children) {
        this.children.push(...children);
      },
      appendChild(child) {
        this.children.push(child);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      ...overrides,
    });
  }

  const plannerResults = loadPlannerResultsModule({
    window: {
      getComputedStyle() {
        return {
          getPropertyValue() {
            return "";
          },
          paddingLeft: "0",
          paddingTop: "0",
        };
      },
    },
    context: {
      document: {
        createElement() {
          return createRecordingElement();
        },
      },
    },
  });
  const state = {
    isSolving: false,
    grid: [[1, 1, 1], [1, 1, 1]],
    result: {
      solution: {
        optimizer: "greedy",
        roads: [],
        services: [{ r: 0, c: 0, rows: 1, cols: 1, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [20],
        residentials: [{ r: 1, c: 1, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [30],
        totalPopulation: 30,
      },
      stats: {
        optimizer: "greedy",
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 30,
        roadCount: 0,
        serviceCount: 1,
        residentialCount: 1,
      },
      validation: {
        valid: true,
        errors: [],
      },
    },
    resultContext: {
      grid: [[1, 1, 1], [1, 1, 1]],
      params: {
        optimizer: "greedy",
        serviceTypes: [{ name: "Clinic", bonus: 20, rows: 1, cols: 1, range: 1, avail: 1 }],
        residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 30, avail: 1 }],
      },
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
    resultHeatmapEnabled: true,
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
  };
  const elements = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = createRecordingElement();
      return target[key];
    },
  });
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return `${value}ms`;
      },
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return value === "greedy" ? "Greedy" : String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {},
    },
  });

  controller.renderResults();

  const findCell = (row, col) =>
    elements.resultMapGrid.children.find((cell) => cell.dataset.r === String(row) && cell.dataset.c === String(col));
  const serviceCell = findCell(0, 0);
  const coveredCell = findCell(0, 1);
  const farCell = findCell(1, 2);

  assert.doesNotMatch(serviceCell.className, /heatmap-cell/);
  assert.match(coveredCell.className, /heatmap-cell/);
  assert.equal(coveredCell.dataset.serviceValue, "20");
  assert.equal(coveredCell.style["--heatmap-warm-alpha"], "0.76");
  assert.match(coveredCell.title, /service value \+20/);
  assert.match(coveredCell.attributes["aria-label"], /service value \+20/);
  assert.doesNotMatch(farCell.className, /heatmap-cell/);
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

function testManualLayoutResponseReportsOutOfBoundsRoads() {
  const response = buildManualLayoutResponse(
    [[1]],
    {},
    {
      roads: new Set(["2,2"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0,
    }
  );

  assert.equal(response.validation.valid, false);
  assert.match(response.validation.errors.join("\n"), /Road cell \(2,2\) is not allowed/);
  assert.deepEqual(response.validation.mapRows, [
    "   0",
    " 0 .",
    "",
    "Legend: # blocked  R road  S service  H residential  . empty",
  ]);
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

function testPlannerRequestBuilderRebuildsStaleSavedCheckpoint() {
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
  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validManualResult, { grid, params }, 0);
  const staleCheckpoint = plannerShared.cloneJson(checkpoint);
  staleCheckpoint.compatibility.modelFingerprint = "fnv1a:00000000";
  staleCheckpoint.compatibility.candidateUniverseHash = "fnv1a:00000000";

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

  const savedCheckpoint = controller.getSavedLayoutCheckpoint({
    id: "stale-layout",
    name: "Stale Layout",
    savedAt: "2026-04-18T09:00:00.000Z",
    elapsedMs: 0,
    result: validManualResult,
    resultContext: { grid, params },
    continueCpSat: staleCheckpoint,
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

async function testPlannerExpansionOmitsStaleComparisonHint() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    serviceTypes: [],
    residentialTypes: [{ name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    cpSat: {},
    lns: {},
  };
  const validResult = buildManualLayoutResponse(grid, params, {
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
        },
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
            solution: { totalPopulation: 12 },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch URL ${urlText}`);
  });
  const state = {
    isSolving: false,
    optimizer: "cp-sat",
    grid,
    serviceTypes: [],
    residentialTypes: [
      plannerShared.serializeResidentialTypeForCatalog(params.residentialTypes[0]),
    ],
    availableBuildings: {
      services: "0",
      residentials: "1",
    },
    greedy: {},
    cpSat: {
      useDisplayedHint: true,
    },
    lns: {
      useDisplayedSeed: true,
    },
    result: validResult,
    resultContext: { grid, params },
    expansionAdvice: {
      nextServiceText: "Clinic, 5, 1x1, 3x3",
      nextResidentialText: "",
      isRunning: false,
      status: "",
      result: null,
      error: "",
    },
  };
  const controller = plannerExpansion.createExpansionAdviceController({
    state,
    elements: {
      expansionAdviceStatus: createFakeDomElement(),
      expansionAdviceMetrics: createFakeDomElement(),
      expansionAdviceWinner: createFakeDomElement(),
      expansionAdviceBaseline: createFakeDomElement(),
      expansionAdviceServiceOutcome: createFakeDomElement(),
      expansionAdviceResidentialOutcome: createFakeDomElement(),
    },
    constants: {
      COMPARISON_PROGRESS_HINT_INTERVAL_MS: 1,
      SOLVE_STATUS_POLL_INTERVAL_MS: 1,
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
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry,
    },
    callbacks: {
      buildSolveRequest() {
        return {
          grid: plannerShared.cloneGrid(grid),
          params: {
            optimizer: state.optimizer,
            greedy: {},
            cpSat: {},
            lns: {},
          },
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
      syncActionAvailability() {},
    },
  });

  await controller.compareExpansionOptions();

  assert.ok(capturedStartRequest);
  assert.equal(capturedStartRequest.params.cpSat.warmStartHint, undefined);
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
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: "2.5",
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
  assert.equal(request.params.greedy.randomSeed, undefined);
  assert.equal(request.params.greedy.timeLimitSeconds, undefined);
  assert.equal(request.params.greedy.profile, false);
  assert.equal(request.params.greedy.densityTieBreaker, false);
  assert.equal(request.params.greedy.densityTieBreakerTolerancePercent, undefined);
  assert.equal(request.params.cpSat.randomSeed, undefined);
  assert.equal(request.params.greedy.restarts, 4);
  assert.equal(request.params.greedy.serviceRefineIterations, 1);
  assert.equal(request.params.greedy.serviceRefineCandidateLimit, 24);
  assert.equal(request.params.greedy.exhaustiveServiceSearch, false);
  assert.equal(request.params.greedy.serviceExactPoolLimit, 8);
  assert.equal(request.params.greedy.serviceExactMaxCombinations, 512);

  state.optimizer = "legacy-or-missing";
  const normalizedRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(normalizedRequest.params.optimizer, "auto");
  assert.equal(normalizedRequest.params.greedy.restarts, 4);
  assert.equal(normalizedRequest.params.greedy.exhaustiveServiceSearch, false);
}

function testPlannerRequestBuilderKeepsPortfolioStandaloneOnly() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "auto",
    auto: {
      wallClockLimitSeconds: "",
    },
    grid: [
      [1, 1],
      [1, 1],
    ],
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
        randomizeSearch: true,
      },
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
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state,
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

  const autoRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(autoRequest.params.cpSat.portfolio, undefined);

  state.optimizer = "lns";
  const lnsRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(lnsRequest.params.cpSat.portfolio, undefined);

  state.optimizer = "cp-sat";
  const cpSatRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(cpSatRequest.params.cpSat.portfolio.workerCount, 3);
  assert.deepEqual(Array.from(cpSatRequest.params.cpSat.portfolio.randomSeeds), [31, 32, 33]);
  assert.equal(cpSatRequest.params.cpSat.portfolio.totalCpuBudgetSeconds, 28800);
  assert.equal(cpSatRequest.params.cpSat.portfolio.perWorkerTimeLimitSeconds, 30);
  assert.equal(cpSatRequest.params.cpSat.portfolio.perWorkerNumWorkers, 1);
  assert.equal(cpSatRequest.params.cpSat.portfolio.randomizeSearch, true);

  state.cpSat.portfolio.randomSeeds = "";
  state.cpSat.portfolio.workerCount = "4";
  state.cpSat.portfolio.perWorkerNumWorkers = "2";
  state.cpSat.portfolio.perWorkerTimeLimitSeconds = "99999";
  const cappedRequest = controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(cappedRequest.params.cpSat.portfolio.perWorkerTimeLimitSeconds, 3600);
  assert.equal(cappedRequest.params.cpSat.portfolio.perWorkerNumWorkers, 2);

  state.cpSat.portfolio.perWorkerTimeLimitSeconds = "30";
  state.cpSat.portfolio.perWorkerNumWorkers = "1";
  state.cpSat.portfolio.randomSeeds = "1, 2, 1";
  assert.throws(
    () => controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false }),
    /explicit seeds must be unique/
  );

  state.cpSat.portfolio.randomSeeds = "1, 2, 3, 4, 5";
  assert.throws(
    () => controller.buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false, includeLnsSeed: false }),
    /supports at most 4 explicit seeds/
  );
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
    progressSummary: {
      currentScore: 1234,
      bestScore: 1234,
      activeStage: "cp-sat",
      reuseSource: null,
      elapsedTimeSeconds: 60,
      timeSinceImprovementSeconds: 4.5,
      stopReason: null,
      exactGap: 66,
      portfolioWorkerSummary: null,
    },
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
  assert.deepEqual(JSON.parse(JSON.stringify(logAfterFinal[1].progressSummary)), {
    currentScore: 1250,
    bestScore: 1250,
    activeStage: "cp-sat",
    reuseSource: null,
    elapsedTimeSeconds: 90,
    timeSinceImprovementSeconds: 0.2,
    stopReason: null,
    exactGap: 0,
    portfolioWorkerSummary: null,
  });
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

async function main() {
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
  testPlannerBuildSolveRequestEnablesGreedyDiagnosticsOnlyForStandaloneGreedy();
  testPlannerSavedLayoutRestoreRoundTripsHintSeedTogglesAndPortfolio();
  testPlannerRuntimePresetAppliesBoundedCpSatPolicy();
  testPlannerAutoMarksIgnoredSeedControlsUnavailable();
  testPlannerShellRequiresManualValidationBeforeContinuationReuse();
  testPlannerPersistenceRestoresLegacyReviewedInvalidLayoutWithoutPendingFlag();
  testPlannerPersistenceRestoresLegacyPendingValidationLayoutWithoutFlag();
  testPlannerResultsRotatePendingPlacementUpdatesFootprint();
  testPlannerResultsShowsAutoGeneratedSeedSummary();
  testPlannerResultsShowsGreedyDiagnosticsReport();
  testPlannerResultsAppliesServiceValueHeatmap();
  testManualLayoutResponseClearsSolverMetadata();
  testManualLayoutResponseReportsOutOfBoundsRoads();
  testBuildCpSatWarmStartCheckpointRejectsInvalidLayouts();
  testBuildCpSatWarmStartCheckpointRejectsLegacyLayoutsWithoutValidation();
  testPlannerRequestBuilderSkipsLegacySavedCheckpointWithoutValidation();
  testPlannerRequestBuilderRebuildsStaleSavedCheckpoint();
  testPlannerRequestBuilderSkipsInvalidDisplayedLayoutContinuation();
  testPlannerRequestBuilderSkipsLegacyDisplayedLayoutContinuationWithoutValidation();
  testPlannerRequestBuilderIncludesHintAndSeedForAuto();
  await testPlannerExpansionOmitsStaleComparisonHint();
  testPlannerRequestBuilderTreatsBlankAutoCapAsUnlimited();
  testPlannerRequestBuilderUsesBoundedGreedyProfileForAuto();
  testPlannerRequestBuilderKeepsPortfolioStandaloneOnly();
  testPlannerSolveProgressLogCapturesSnapshotAndFinalResult();
  testFilesystemSolveLogTracksSolverClockAcrossHeartbeats();

  console.log("All review finding regression tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
