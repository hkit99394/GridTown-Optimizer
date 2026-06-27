const {
  assert,
  buildManualLayoutResponse,
  loadPlannerRequestBuilderModule,
  loadPlannerSharedModule
} = require("./helpers.cjs");

function testManualLayoutResponseClearsSolverMetadata() {
  const response = buildManualLayoutResponse(
    [
      [1, 1],
      [1, 1]
    ],
    {
      basePop: 10,
      maxPop: 10,
      availableBuildings: { residentials: 0, services: 0 }
    },
    {
      optimizer: "cp-sat",
      cpSatStatus: "OPTIMAL",
      cpSatObjectivePolicy: {
        populationWeight: 5,
        maxTieBreakPenalty: 4,
        summary: "maximize population, then minimize roads + services"
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
        numConflicts: 0
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
            totalPopulation: 0
          }
        ]
      },
      stoppedByUser: true,
      roads: new Set(["0,0", "0,1"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0
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

function testManualLayoutResponseCleansRedundantRoads() {
  const response = buildManualLayoutResponse(
    [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    {
      residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 }
    },
    {
      roads: new Set(["0,1", "1,1", "2,1", "2,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
      residentialTypeIndices: [0],
      populations: [0],
      totalPopulation: 0
    }
  );

  assert.equal(response.validation.valid, true);
  assert.deepEqual([...response.solution.roads].sort(), ["2,0", "2,1"]);
  assert.equal(response.stats.roadCount, 2);
  assert.equal(response.stats.totalPopulation, 10);
}

function testManualLayoutResponsePreservesFixedRoadsDuringCleanup() {
  const response = buildManualLayoutResponse(
    [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    {
      fixedRoads: ["1,1"],
      residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 }
    },
    {
      fixedRoads: ["1,1"],
      roads: new Set(["0,1", "1,1", "2,1", "2,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
      residentialTypeIndices: [0],
      populations: [0],
      totalPopulation: 0
    }
  );

  assert.equal(response.validation.valid, true);
  assert.deepEqual([...response.solution.roads].sort(), ["1,1", "2,1"]);
  assert.deepEqual(response.solution.fixedRoads, ["1,1"]);
  assert.equal(response.stats.roadCount, 2);
}

function testManualLayoutResponsePreservesExplicitEmptyFixedRoads() {
  const response = buildManualLayoutResponse(
    [[1]],
    { fixedRoads: [], availableBuildings: { residentials: 0, services: 0 } },
    {
      fixedRoads: [],
      roads: new Set(),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0
    }
  );

  assert.equal(response.validation.valid, true);
  assert.deepEqual(response.solution.fixedRoads, []);
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
      totalPopulation: 0
    }
  );

  assert.equal(response.validation.valid, false);
  assert.match(response.validation.errors.join("\n"), /Road cell \(2,2\) is not allowed/);
  assert.deepEqual(response.validation.mapRows, [
    "   0",
    " 0 .",
    "",
    "Legend: # blocked  R road  S service  H residential  . empty"
  ]);
}

function testBuildCpSatWarmStartCheckpointRejectsInvalidLayouts() {
  const plannerShared = loadPlannerSharedModule();
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
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
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
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
  const legacySavedResult = {
    ...invalidManualResult
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

  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validManualResult, { grid, params }, 0);
  const legacySavedEntry = {
    id: "legacy-layout",
    name: "Legacy Layout",
    savedAt: "2026-04-18T09:00:00.000Z",
    elapsedMs: 0,
    result: legacySavedResult,
    resultContext: { grid, params },
    continueCpSat: checkpoint
  };

  assert.equal(controller.getSavedLayoutCheckpoint(legacySavedEntry), null);
}

async function runPlannerResponseTests() {
  testManualLayoutResponseClearsSolverMetadata();
  testManualLayoutResponseCleansRedundantRoads();
  testManualLayoutResponsePreservesFixedRoadsDuringCleanup();
  testManualLayoutResponsePreservesExplicitEmptyFixedRoads();
  testManualLayoutResponseReportsOutOfBoundsRoads();
  testBuildCpSatWarmStartCheckpointRejectsInvalidLayouts();
  testBuildCpSatWarmStartCheckpointRejectsLegacyLayoutsWithoutValidation();
  testPlannerRequestBuilderSkipsLegacySavedCheckpointWithoutValidation();
}

module.exports = {
  runPlannerResponseTests
};
