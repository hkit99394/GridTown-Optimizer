const {
  assert,
  createFakeDomElement,
  loadPlannerRequestBuilderModule,
  loadPlannerSharedModule
} = require("./helpers.cjs");

function testPlannerServiceAvailabilityRoundTrip() {
  const plannerShared = loadPlannerSharedModule();
  const serialized = plannerShared.serializeServiceTypeForCatalog({
    name: "Health Clinic",
    rows: 2,
    cols: 2,
    bonus: 40,
    range: 1,
    avail: 3
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
    }
  });
  const controller = plannerRequestBuilder.createPlannerRequestBuilderController({
    state: {
      optimizer: "cp-sat",
      grid: [
        [1, 1],
        [1, 1]
      ],
      serviceTypes: [],
      residentialTypes: [],
      availableBuildings: {
        services: "",
        residentials: ""
      },
      greedy: {
        localSearch: true,
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
        neighborhoodRows: 1,
        neighborhoodCols: 1,
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
      }
    }
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
      grid: [
        [1, 1],
        [1, 1]
      ],
      serviceTypes: [],
      residentialTypes: [],
      availableBuildings: {
        services: "",
        residentials: ""
      },
      greedy: {
        localSearch: true,
        randomSeed: "",
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1
      },
      cpSat: {
        timeLimitSeconds: "30",
        noImprovementTimeoutSeconds: "10",
        randomSeed: "",
        numWorkers: 8,
        logSearchProgress: false,
        pythonExecutable: "",
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
    },
    elements: {
      cpSatRandomSeed: { value: "" },
      cpSatHintStatus: { textContent: "" },
      lnsSeedStatus: { textContent: "" },
      payloadPreview: { textContent: "" },
      layoutStorageName: { value: "" }
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
      }
    }
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
    grid: [
      [1, 1],
      [1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
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

  const greedyRequest = controller.buildSolveRequest();
  assert.equal(greedyRequest.params.greedy.diagnostics, true);
  assert.equal(greedyRequest.params.greedy.profile, true);
  assert.equal(greedyRequest.params.greedy.timeLimitSeconds, 3900);
  assert.equal(greedyRequest.params.greedy.densityTieBreaker, true);
  assert.equal(greedyRequest.params.greedy.densityTieBreakerTolerancePercent, 2.5);

  state.optimizer = "auto";
  const autoRequest = controller.buildSolveRequest({ includeWarmStartHint: false, includeLnsSeed: false });
  assert.equal(autoRequest.params.greedy, undefined);

  state.optimizer = "cp-sat";
  const cpSatRequest = controller.buildSolveRequest({ includeWarmStartHint: false });
  assert.equal(cpSatRequest.params.greedy.diagnostics, false);
  assert.equal(cpSatRequest.params.greedy.profile, false);
  assert.equal(cpSatRequest.params.greedy.timeLimitSeconds, undefined);
  assert.equal(cpSatRequest.params.greedy.densityTieBreaker, false);
  assert.equal(cpSatRequest.params.greedy.densityTieBreakerTolerancePercent, undefined);
}

function testPlannerBuildSolveRequestPinsValidatedFixedRoads() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "greedy",
    grid: [
      [1, 1],
      [1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
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
    layoutEditor: {
      pendingValidation: false
    },
    result: {
      solution: {
        manualLayout: true,
        roads: ["1,1", "0,1", "1,1"],
        fixedRoads: ["1,1", "0,1", "1,1"]
      },
      stats: {
        manualLayout: true
      },
      validation: {
        valid: true
      }
    },
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

  assert.deepEqual([...controller.buildSolveRequest().params.fixedRoads], ["0,1", "1,1"]);

  state.layoutEditor.pendingValidation = true;
  assert.equal(controller.buildSolveRequest().params.fixedRoads, undefined);

  state.layoutEditor.pendingValidation = false;
  state.result.solution.fixedRoads = [];
  assert.equal(Object.prototype.hasOwnProperty.call(controller.buildSolveRequest().params, "fixedRoads"), true);
  assert.deepEqual([...controller.buildSolveRequest().params.fixedRoads], []);
}

function testPlannerBuildSolveRequestPreservesFixedRoadsFromSolvedContext() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "greedy",
    grid: [
      [1, 1],
      [1, 1]
    ],
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
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
    layoutEditor: {
      pendingValidation: false
    },
    result: {
      solution: {
        manualLayout: false,
        roads: ["1,1", "0,1"]
      },
      stats: {
        manualLayout: false
      },
      validation: {
        valid: true
      }
    },
    resultContext: {
      params: {
        fixedRoads: ["1,1", "0,1", "1,0"]
      }
    },
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

  assert.deepEqual([...controller.buildSolveRequest().params.fixedRoads], ["0,1", "1,1"]);
}

function testPlannerBuildSolveRequestUsesInitialRoadAnchors() {
  const plannerShared = loadPlannerSharedModule();
  const plannerRequestBuilder = loadPlannerRequestBuilderModule();
  const state = {
    optimizer: "greedy",
    grid: [
      [1, 1],
      [1, 1]
    ],
    roadAnchors: ["1,1", "0,1", "1,1", "9,9"],
    serviceTypes: [],
    residentialTypes: [],
    availableBuildings: {
      services: "",
      residentials: ""
    },
    greedy: {
      localSearch: true,
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
    layoutEditor: {
      pendingValidation: false
    },
    result: {
      solution: {
        manualLayout: false,
        roads: ["0,0"]
      },
      stats: {
        manualLayout: false
      },
      validation: {
        valid: true
      }
    },
    resultContext: {
      params: {
        fixedRoads: ["0,0"]
      }
    },
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

  assert.deepEqual([...controller.buildSolveRequest().params.fixedRoads], ["0,1", "1,1"]);

  state.roadAnchors = [];
  const emptyAnchorRequest = controller.buildSolveRequest();
  assert.equal(Object.prototype.hasOwnProperty.call(emptyAnchorRequest.params, "fixedRoads"), true);
  assert.deepEqual([...emptyAnchorRequest.params.fixedRoads], []);
}

async function runPlannerRequestBasicsTests() {
  testPlannerServiceAvailabilityRoundTrip();
  testPlannerAutoFillsCpSatRandomSeed();
  testPlannerBuildSolveRequestIncludesCpSatNoImprovementTimeout();
  testPlannerBuildSolveRequestEnablesGreedyDiagnosticsOnlyForStandaloneGreedy();
  testPlannerBuildSolveRequestPinsValidatedFixedRoads();
  testPlannerBuildSolveRequestPreservesFixedRoadsFromSolvedContext();
  testPlannerBuildSolveRequestUsesInitialRoadAnchors();
}

module.exports = {
  runPlannerRequestBasicsTests
};
