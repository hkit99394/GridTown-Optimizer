const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { solve } = require("../dist/index.js");
const { evaluateLayout } = require("../dist/evaluator.js");
const { buildManualLayoutResponse } = require("../dist/webServerHttp.js");

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
testManualLayoutResponseClearsSolverMetadata();

console.log("All review finding regression tests passed.");
