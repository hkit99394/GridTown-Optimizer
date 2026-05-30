const {
  assert,
  buildManualLayoutResponse,
  createFakeDomElement,
  loadPlannerExpansionModule,
  loadPlannerSharedModule
} = require("./helpers.cjs");

async function testPlannerExpansionUsesSharedContinuationPayloadContract() {
  const plannerShared = loadPlannerSharedModule();
  const grid = Array.from({ length: 4 }, () => [1, 1, 1, 1]);
  const residentialType = { name: "Residential 1", w: 2, h: 2, min: 10, max: 10, avail: 1 };
  const serviceType = plannerShared.parseServiceCatalogEntry(
    { name: "Clinic", bonus: "5", size: "1x1", effective: "3x3" },
    0
  );
  const baselineParams = {
    optimizer: "auto",
    serviceTypes: [],
    residentialTypes: [residentialType],
    availableBuildings: { services: 0, residentials: 1 },
    cpSat: {},
    lns: {}
  };
  const comparisonParams = {
    ...baselineParams,
    serviceTypes: [serviceType],
    availableBuildings: { services: 1, residentials: 1 }
  };
  const validResult = buildManualLayoutResponse(grid, comparisonParams, {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  });
  const checkpoint = plannerShared.buildCpSatWarmStartCheckpoint(validResult, { grid, params: comparisonParams }, 0);
  checkpoint.resumePolicy.objectiveCutoff.preferStrictImprove = true;
  checkpoint.resumePolicy.fixVariablesToHintedValue = true;

  let capturedStartRequest = null;
  const plannerExpansion = loadPlannerExpansionModule(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText === "/api/solve/start") {
      capturedStartRequest = JSON.parse(String(options.body));
      return {
        ok: true,
        async json() {
          return { ok: true, requestId: capturedStartRequest.requestId };
        }
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
            solution: { totalPopulation: 12 }
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL ${urlText}`);
  });
  const state = {
    isSolving: false,
    optimizer: "auto",
    grid,
    serviceTypes: [],
    residentialTypes: [plannerShared.serializeResidentialTypeForCatalog(residentialType)],
    availableBuildings: { services: "0", residentials: "1" },
    greedy: {},
    cpSat: { useDisplayedHint: true },
    lns: { useDisplayedSeed: true },
    result: validResult,
    resultContext: { grid, params: baselineParams },
    expansionAdvice: {
      nextServiceText: "Clinic, 5, 1x1, 3x3",
      nextResidentialText: "",
      isRunning: false,
      status: "",
      result: null,
      error: ""
    }
  };

  const controller = plannerExpansion.createExpansionAdviceController({
    state,
    elements: {
      expansionAdviceStatus: createFakeDomElement(),
      expansionAdviceMetrics: createFakeDomElement(),
      expansionAdviceWinner: createFakeDomElement(),
      expansionAdviceBaseline: createFakeDomElement(),
      expansionAdviceServiceOutcome: createFakeDomElement(),
      expansionAdviceResidentialOutcome: createFakeDomElement()
    },
    constants: { COMPARISON_PROGRESS_HINT_INTERVAL_MS: 1, SOLVE_STATUS_POLL_INTERVAL_MS: 1 },
    helpers: {
      buildCpSatContinuationModelInput: plannerShared.buildCpSatContinuationModelInput,
      cloneJson: plannerShared.cloneJson,
      computeCpSatModelFingerprint: plannerShared.computeCpSatModelFingerprint,
      createSolveRequestId: () => "expansion-shared-continuation-test",
      delay: async () => {},
      parseResidentialCatalogEntry: plannerShared.parseResidentialCatalogEntry,
      parseServiceCatalogEntry: plannerShared.parseServiceCatalogEntry
    },
    callbacks: {
      buildSolveRequest: () => ({
        grid: plannerShared.cloneGrid(grid),
        params: { optimizer: state.optimizer, greedy: {}, cpSat: {}, lns: {} }
      }),
      getDisplayedLayoutCheckpoint: () => checkpoint,
      getDisplayedLayoutSourceLabel: () => "Displayed layout",
      getOptimizerLabel: () => "Auto",
      syncActionAvailability() {}
    }
  });

  await controller.compareExpansionOptions();

  assert.ok(capturedStartRequest);
  const warmStartHint = capturedStartRequest.params.cpSat.warmStartHint;
  const seedHint = capturedStartRequest.params.lns.seedHint;
  assert.equal(warmStartHint.sourceName, "Displayed layout (comparison baseline)");
  assert.equal(warmStartHint.modelFingerprint, checkpoint.compatibility.modelFingerprint);
  assert.equal(warmStartHint.objectiveLowerBound, 10);
  assert.equal(warmStartHint.preferStrictImprove, true);
  assert.equal(warmStartHint.repairHint, true);
  assert.equal(warmStartHint.fixVariablesToHintedValue, true);
  assert.equal(warmStartHint.solution, undefined);
  assert.equal(seedHint.objectiveLowerBound, 10);
  assert.equal(seedHint.preferStrictImprove, true);
  assert.equal(seedHint.fixVariablesToHintedValue, true);
  assert.ok(seedHint.solution);
}

async function runPlannerContinuationPayloadTests() {
  await testPlannerExpansionUsesSharedContinuationPayloadContract();
}

module.exports = {
  runPlannerContinuationPayloadTests
};
