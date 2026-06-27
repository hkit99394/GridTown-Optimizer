const {
  assert,
  fs,
  os,
  path,
  OMITTED_SOLVER_OPTIMIZER,
  RECOMMENDED_INTERACTIVE_OPTIMIZER,
  getOptimizerAdapter,
  listOptimizerAdapters,
  resolveOptimizerName,
  solve,
  solveAsync,
  solveAuto,
  solveGreedy,
  solveCpSat,
  solveCpSatAsync,
  solveLns,
  startAutoSolve,
  startCpSatSolve,
  waitForFile,
  waitForHeartbeatToStop,
  buildMockSolution,
  startJsonBackgroundSolve,
  evaluateLayout,
  validateLayoutConstraints,
  validateSolution,
  computePopulationCapacityUpperBound,
  buildPlannerExplainabilityMap,
  GreedyAttemptState,
  computeRoadAnchorReachableEmptyFrontier,
  createRoadProbeScratch,
  measureBuildingConnectivityShadow,
  measureBuildingConnectivityShadowFromFrontier,
  pruneRedundantRoads,
  probeBuildingConnectedToRoads,
  forEachRectangleBorderCell,
  forEachRectangleCell,
  rectangleBorderCells,
  rectangleCells,
  buildFootprintGeometryCache,
  buildServiceGeometryCache,
  buildServiceEffectZoneSet,
  countServiceBoost,
  isBoostedByService,
  overlaps,
  residentialFootprint,
  serviceEffectZone,
  serviceFootprint
} = require("./optimizerHarnessDeps.cjs");
const { startGreedySolve, startLnsSolve } = require("../../dist/packages/runtime/dispatch/backgroundSolvers.js");
const { computeCpSatRequestFingerprint } = require("../../dist/packages/core/cpSatContinuation.js");

function testOptimizerRegistry() {
  assert.equal(OMITTED_SOLVER_OPTIMIZER, "auto");
  assert.equal(RECOMMENDED_INTERACTIVE_OPTIMIZER, "auto");
  assert.equal(resolveOptimizerName(undefined), "auto");
  assert.equal(resolveOptimizerName(null), "auto");
  assert.equal(resolveOptimizerName({}), "auto");
  assert.equal(resolveOptimizerName("unknown"), "auto");
  assert.equal(resolveOptimizerName({ optimizer: "auto" }), "auto");
  assert.equal(resolveOptimizerName({ optimizer: "greedy" }), "greedy");
  assert.equal(resolveOptimizerName({ optimizer: "cp-sat" }), "cp-sat");
  assert.equal(resolveOptimizerName({ optimizer: "lns" }), "lns");
  assert.equal(getOptimizerAdapter(undefined).name, "auto");
  assert.equal(getOptimizerAdapter("auto").name, "auto");
  assert.equal(getOptimizerAdapter("greedy").name, "greedy");
  assert.equal(getOptimizerAdapter({ optimizer: "cp-sat" }).name, "cp-sat");
  assert.equal(getOptimizerAdapter("lns").name, "lns");
  assert.deepEqual(
    listOptimizerAdapters()
      .map((adapter) => adapter.name)
      .sort(),
    ["auto", "cp-sat", "greedy", "lns"]
  );
}

function testGeometryHelperVisitorParity() {
  const rectangleKeys = [];
  forEachRectangleCell(1, 2, 2, 3, (r, c) => rectangleKeys.push(`${r},${c}`));
  assert.deepEqual(rectangleKeys, rectangleCells(1, 2, 2, 3));

  const borderKeys = [];
  forEachRectangleBorderCell(1, 2, 2, 3, (r, c) => borderKeys.push(`${r},${c}`));
  const expectedBorder = rectangleBorderCells(1, 2, 2, 3).map(([r, c]) => `${r},${c}`);
  assert.deepEqual([...new Set(borderKeys)].sort(), [...expectedBorder].sort());
}

function testBuildingGeometryHelpersParity() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 0, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const service = { r: 1, c: 0, rows: 1, cols: 2, range: 1 };
  const zoneSet = buildServiceEffectZoneSet(grid, service);
  const zoneArray = serviceEffectZone(grid, service);
  zoneSet.delete("0,0");
  zoneArray.length = 0;
  const rebuiltZoneSet = buildServiceEffectZoneSet(grid, service);
  const rebuiltZoneArray = serviceEffectZone(grid, service);

  assert.deepEqual([...rebuiltZoneSet].sort(), [...rebuiltZoneArray].sort());
  assert.equal(countServiceBoost(rebuiltZoneSet, 0, 0, 2, 2), 2);
  assert.equal(isBoostedByService(rebuiltZoneSet, 0, 0, 2, 2), true);
  assert.equal(isBoostedByService(rebuiltZoneSet, 3, 3, 1, 1), false);

  const occupied = new Set(["0,0", "1,1", "2,2"]);
  assert.equal(overlaps(occupied, 0, 0, 2, 2), true);
  assert.equal(overlaps(occupied, 0, 2, 1, 2), false);
}

function testBuildingGeometryCachesParity() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1]
  ];
  const services = [
    { r: 1, c: 1, rows: 1, cols: 2, range: 1 },
    { r: 1, c: 1, rows: 1, cols: 2, range: 2 }
  ];
  const serviceGeometry = buildServiceGeometryCache(grid, services);
  const footprintGeometry = buildFootprintGeometryCache([
    { r: 0, c: 0, rows: 2, cols: 2 },
    { r: 0, c: 0, rows: 2, cols: 2 }
  ]);
  const mutatedFootprint = serviceFootprint(services[0]);
  mutatedFootprint.pop();
  const mutatedEffectZone = serviceEffectZone(grid, services[0]);
  mutatedEffectZone.pop();

  assert.equal(Object.isFrozen(serviceGeometry.footprintKeysByIndex), true);
  assert.equal(Object.isFrozen(serviceGeometry.effectZoneKeysByIndex), true);
  assert.equal(Object.isFrozen(serviceGeometry.footprintKeysByIndex[0]), true);
  assert.equal(Object.isFrozen(serviceGeometry.effectZoneKeysByIndex[0]), true);
  assert.deepEqual([...serviceGeometry.footprintKeysByIndex[0]], serviceFootprint(services[0]));
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...buildServiceEffectZoneSet(grid, services[0])].sort()
  );
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[1]].sort(),
    [...buildServiceEffectZoneSet(grid, services[1])].sort()
  );
  assert.notDeepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...serviceGeometry.effectZoneKeysByIndex[1]].sort()
  );
  assert.deepEqual([...footprintGeometry.footprintKeysByIndex[0]], residentialFootprint(0, 0, 2, 2));
  assert.deepEqual([...footprintGeometry.footprintKeysByIndex[0]], [...footprintGeometry.footprintKeysByIndex[1]]);
  assert.deepEqual([...serviceGeometry.footprintKeysByIndex[0]], serviceFootprint(services[0]));
  assert.deepEqual(
    [...serviceGeometry.effectZoneKeysByIndex[0]].sort(),
    [...serviceEffectZone(grid, services[0])].sort()
  );
}

function testPlannerExplainabilityMapSummarizesOpportunityAndRisk() {
  const grid = [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 1]
  ];
  const params = {
    serviceTypes: [{ name: "Clinic", rows: 1, cols: 1, range: 1, bonus: 50, avail: 2 }],
    residentialTypes: [{ name: "Studio", w: 1, h: 1, min: 10, max: 30, avail: 1 }]
  };
  const solution = {
    roads: new Set(["1,1"]),
    services: [{ r: 0, c: 0, rows: 1, cols: 1, range: 1 }],
    serviceTypeIndices: [0],
    servicePopulationIncreases: [50],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const map = buildPlannerExplainabilityMap(grid, params, solution);

  assert.equal(map.schemaVersion, 1);
  assert.equal(map.rows, 3);
  assert.equal(map.cols, 3);
  assert.equal(map.cells.length, 3);
  assert.equal(map.cells[0].length, 3);
  assert.equal(map.cells[0][1].serviceValue, 50);
  assert.equal(map.cells[0][1].roadAnchorReachable, true);
  assert.equal(map.cells[0][1].roadAnchorDistance, 0);
  assert.equal(map.cells[0][1].residentialOpportunity, 30);
  assert.equal(map.cells[0][1].bestServiceBonus, 50);
  assert.equal(map.cells[1][1].occupiedKind, "road");
  assert.equal(map.cells[1][1].connectivityFootprintCells, 1);
  assert.ok(map.cells[1][1].connectivityDisconnectedCells > 0);
  assert.equal(map.maxServiceValue, 50);
  assert.equal(map.maxResidentialOpportunity, 30);
  assert.ok(map.maxConnectivityDisconnectedCells > 0);
  assert.equal(typeof map.roadAnchorReachableCellCount, "number");
}

function testPopulationCapacityUpperBoundUsesFiniteResidentialCapacity() {
  assert.equal(
    computePopulationCapacityUpperBound({
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 100, avail: 2 },
        { w: 2, h: 3, min: 20, max: 250, avail: 1 }
      ],
      availableBuildings: { residentials: 2 }
    }),
    350
  );
  assert.equal(
    computePopulationCapacityUpperBound({
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 100, avail: 2 },
        { w: 2, h: 3, min: 20, max: 250, avail: 1 }
      ]
    }),
    450
  );
  assert.equal(computePopulationCapacityUpperBound({ maxResidentials: 3, maxPop: 40 }), 120);
  assert.equal(
    computePopulationCapacityUpperBound({
      availableBuildings: { residentials: 2 },
      residentialSettings: {
        "2x2": { min: 10, max: 60 },
        "2x3": { min: 20, max: 90 }
      }
    }),
    180
  );
  assert.equal(computePopulationCapacityUpperBound({ maxPop: 40 }), null);
  assert.equal(computePopulationCapacityUpperBound({ availableBuildings: { residentials: 0 }, maxPop: 40 }), 0);
}

function testRoadProbePreservesEdgeBorderConnectivity() {
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const roads = new Set(["0,2"]);
  const occupied = new Set(roads);
  const adjacentProbe = probeBuildingConnectedToRoads(grid, roads, occupied, 1, 2, 1, 1);
  const bridgeProbe = probeBuildingConnectedToRoads(grid, roads, occupied, 1, 1, 1, 1);

  assert.deepEqual(adjacentProbe, { path: null });
  assert.equal((bridgeProbe?.path?.length ?? 0) > 0, true);
  assert.deepEqual(bridgeProbe?.path?.at(-1), [0, 2]);
}

function testRoadProbeScratchRepeatability() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1]
  ];
  const roads = new Set(["0,4"]);
  const occupied = new Set(roads);
  const scratch = createRoadProbeScratch(grid);

  const first = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);
  const second = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);
  const interleaved = probeBuildingConnectedToRoads(grid, roads, occupied, 4, 0, 1, 1, scratch);
  const third = probeBuildingConnectedToRoads(grid, roads, occupied, 2, 2, 1, 1, scratch);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  assert.deepEqual(interleaved, { path: null });
}

function testRoadProbeScratchWorkspaceResetsBetweenCalls() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const roads = new Set(["0,3"]);
  const scratch = createRoadProbeScratch(grid);
  const occupiedWithBlocker = new Set([...roads, "1,2"]);
  const occupiedWithoutBlocker = new Set(roads);

  const blockedProbeWithScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithBlocker, 2, 2, 1, 1, scratch);
  const blockedProbeWithoutScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithBlocker, 2, 2, 1, 1);
  const clearProbeWithScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithoutBlocker, 2, 2, 1, 1, scratch);
  const clearProbeWithoutScratch = probeBuildingConnectedToRoads(grid, roads, occupiedWithoutBlocker, 2, 2, 1, 1);

  assert.deepEqual(blockedProbeWithScratch, blockedProbeWithoutScratch);
  assert.deepEqual(clearProbeWithScratch, clearProbeWithoutScratch);
}

function testBuildingConnectivityShadowMeasuresDisconnectedReachableCells() {
  const grid = [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0]
  ];
  const blockedBuildings = new Set();

  const placement = { r: 0, c: 1, rows: 1, cols: 1 };
  const shadow = measureBuildingConnectivityShadow(grid, blockedBuildings, placement);
  const shadowFromFrontier = measureBuildingConnectivityShadowFromFrontier(
    grid,
    blockedBuildings,
    computeRoadAnchorReachableEmptyFrontier(grid, blockedBuildings),
    placement
  );

  assert.deepEqual(shadow, {
    reachableBefore: 5,
    reachableAfter: 2,
    lostCells: 3,
    footprintCells: 1,
    disconnectedCells: 2
  });
  assert.deepEqual(shadowFromFrontier, shadow);
}

function testGreedyAttemptStateRejectsMismatchedProbeKind() {
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const placement = { r: 1, c: 0, rows: 1, cols: 1 };

  const deferredAttempt = new GreedyAttemptState(grid, {}, undefined, true);
  assert.equal(
    deferredAttempt.commitPlacement({ kind: "explicit", roadCost: 0, roadProbe: { path: null } }, placement),
    null
  );
  assert.equal(deferredAttempt.occupied.size, 0);

  const explicitAttempt = new GreedyAttemptState(grid, {}, new Set(["0,0"]), false);
  assert.equal(
    explicitAttempt.commitPlacement({ kind: "deferred", roadCost: 0, frontierProbe: { distance: 0 } }, placement),
    null
  );
  assert.equal(explicitAttempt.occupied.size, 1);
  assert.equal(explicitAttempt.occupied.has("0,0"), true);
}

function testFixedRoadsExtendRoadAnchorValidation() {
  const grid = [
    [0, 0, 0],
    [0, 1, 1],
    [0, 1, 1]
  ];
  const params = {
    fixedRoads: ["1,1"],
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }]
  };
  const solution = {
    roads: new Set(["1,1"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 1, c: 2, rows: 1, cols: 1 }],
    residentialTypeIndices: [0],
    populations: [10],
    totalPopulation: 10
  };

  const valid = validateSolution({ grid, params, solution });
  assert.equal(valid.valid, true);

  const withoutFixedAnchor = validateSolution({ grid, params: {}, solution });
  assert.equal(withoutFixedAnchor.valid, false);
  assert.match(withoutFixedAnchor.errors.join(" "), /row 0 or column 0/);

  const missingFixedRoad = validateSolution({
    grid,
    params,
    solution: {
      ...solution,
      roads: new Set()
    }
  });
  assert.equal(missingFixedRoad.valid, false);
  assert.match(missingFixedRoad.errors.join(" "), /Fixed road \(1,1\) is missing/);

  const noAnchorParams = { fixedRoads: [] };
  const zeroSolution = {
    roads: new Set(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };
  assert.equal(validateSolution({ grid, params: noAnchorParams, solution: zeroSolution }).valid, true);

  const boundaryRoadSolution = {
    ...zeroSolution,
    roads: new Set(["0,0"]),
    residentials: [{ r: 0, c: 1, rows: 1, cols: 1 }],
    residentialTypeIndices: [-1],
    populations: [10],
    totalPopulation: 10
  };
  const invalidExplicitNoAnchor = validateSolution({
    grid: [
      [1, 1],
      [1, 1]
    ],
    params: noAnchorParams,
    solution: boundaryRoadSolution
  });
  assert.equal(invalidExplicitNoAnchor.valid, false);
  assert.match(invalidExplicitNoAnchor.errors.join(" "), /configured fixed road anchor/);
}

function testRoadPruningDropsConnectorsOnlyNeededByAnchorBoundaryBuildings() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const roads = new Set(["0,0", "1,0", "2,0", "0,1"]);
  const buildings = [
    { r: 0, c: 2, rows: 1, cols: 1 },
    { r: 1, c: 1, rows: 1, cols: 1 }
  ];

  const pruned = pruneRedundantRoads(grid, roads, buildings);

  assert.deepEqual([...pruned].sort(), ["0,1"]);
}

function testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval() {
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const roads = new Set(["0,0", "1,0", "1,1"]);

  const pruned = pruneRedundantRoads(grid, roads, []);

  assert.deepEqual([...pruned].sort(), ["0,0"]);
}

function testValidateSolutionRejectsMalformedRoadSetKey() {
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const solution = {
    roads: new Set(["1,"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const validation = validateSolution({ grid, solution, params: {} });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /Road key "1," is malformed/);
}

function testValidateSolutionRejectsMalformedGridEvenWhenLayoutAvoidsBadCells() {
  const solution = {
    roads: new Set(["0,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const raggedValidation = validateSolution({
    grid: [[1, 1], [1]],
    solution,
    params: {}
  });

  assert.equal(raggedValidation.valid, false);
  assert.match(raggedValidation.errors.join("\n"), /Grid\[1\] must have length 2 to keep the grid rectangular\./);

  const nonBinaryValidation = validateSolution({
    grid: [
      [1, 1],
      [1, 2]
    ],
    solution,
    params: {}
  });

  assert.equal(nonBinaryValidation.valid, false);
  assert.match(nonBinaryValidation.errors.join("\n"), /Grid\[1\]\[1\] must be 0 or 1\./);
}

function testValidationApisRejectMalformedPlacementGeometryWithoutThrowing() {
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const params = {
    residentialTypes: [{ name: "Studio", w: 1, h: 1, min: 10, max: 20, avail: 10 }]
  };
  const cases = [
    {
      name: "zero service rows",
      services: [{ r: 0, c: 1, rows: 0, cols: 1, range: 1, bonus: 5 }],
      residentials: [],
      expected: /Service 0[\s\S]*rows must be an integer >= 1/
    },
    {
      name: "negative service cols",
      services: [{ r: 0, c: 1, rows: 1, cols: -1, range: 1, bonus: 5 }],
      residentials: [],
      expected: /Service 0[\s\S]*cols must be an integer >= 1/
    },
    {
      name: "fractional service range",
      services: [{ r: 0, c: 1, rows: 1, cols: 1, range: 1.5, bonus: 5 }],
      residentials: [],
      expected: /Service 0[\s\S]*range must be an integer >= 0/
    },
    {
      name: "fractional residential row",
      services: [],
      residentials: [{ r: 1.25, c: 1, rows: 1, cols: 1 }],
      expected: /Residential 0[\s\S]*r must be an integer >= 0/
    },
    {
      name: "NaN residential cols",
      services: [],
      residentials: [{ r: 1, c: 1, rows: 1, cols: NaN }],
      expected: /Residential 0[\s\S]*cols must be an integer >= 1/
    }
  ];

  for (const testCase of cases) {
    const layoutInput = {
      grid,
      roads: new Set(["0,0"]),
      services: testCase.services,
      residentials: testCase.residentials,
      params
    };
    const solution = {
      roads: layoutInput.roads,
      services: testCase.services.map((service) => ({
        r: service.r,
        c: service.c,
        rows: service.rows,
        cols: service.cols,
        range: service.range
      })),
      serviceTypeIndices: testCase.services.map(() => -1),
      servicePopulationIncreases: testCase.services.map((service) => service.bonus),
      residentials: testCase.residentials,
      residentialTypeIndices: testCase.residentials.map(() => 0),
      populations: testCase.residentials.map(() => 10),
      totalPopulation: testCase.residentials.length * 10
    };

    let constraints;
    let evaluation;
    let validation;
    assert.doesNotThrow(() => {
      constraints = validateLayoutConstraints(layoutInput);
      evaluation = evaluateLayout(layoutInput);
      validation = validateSolution({ grid, solution, params });
    }, testCase.name);

    assert.equal(constraints.valid, false, testCase.name);
    assert.equal(evaluation.valid, false, testCase.name);
    assert.equal(validation.valid, false, testCase.name);
    assert.match(constraints.errors.join("\n"), testCase.expected, testCase.name);
    assert.match(evaluation.errors.join("\n"), testCase.expected, testCase.name);
    assert.match(validation.errors.join("\n"), testCase.expected, testCase.name);
  }
}

async function testPublicSolverDispatchValidatesInputs() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];

  assert.throws(
    () => solve(grid, { optimizer: "bogus" }),
    /Invalid solver input: Solver params optimizer must be one of auto, greedy, cp-sat, or lns\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { restarts: 0 } }),
    /Invalid solver input: Greedy option greedy\.restarts must be an integer between 1 and 100\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { diagnostics: "yes" } }),
    /Invalid solver input: Greedy option greedy\.diagnostics must be a boolean\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { serviceMasterDecomposition: "yes" } }),
    /Invalid solver input: Greedy option greedy\.serviceMasterDecomposition must be a boolean\./
  );
  assert.throws(
    () => solve(grid, { optimizer: "greedy", greedy: { serviceMasterMaxLayouts: 0 } }),
    /Invalid solver input: Greedy option greedy\.serviceMasterMaxLayouts must be an integer between 1 and 100000\./
  );
  await assert.rejects(
    () => solveAsync(grid, { optimizer: "greedy", greedy: { restarts: 0 } }),
    /Invalid solver input: Greedy option greedy\.restarts must be an integer between 1 and 100\./
  );
}

async function testDirectSolverEntrypointsValidateSharedInputs() {
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const invalidParams = {
    serviceTypes: [{ name: "Clinic", rows: 0, cols: 1, range: 1, bonus: 10, avail: 1 }],
    residentialTypes: [{ name: "Home", w: 1, h: 1, min: 1, max: 2, avail: 1 }]
  };
  const invalidServiceDimensions =
    /Invalid solver input: Problem definition serviceTypes\[0\]\.rows must be an integer >= 1\./;

  assert.throws(() => solveGreedy(grid, { ...invalidParams, optimizer: "greedy" }), invalidServiceDimensions);
  assert.throws(
    () =>
      solveAuto(grid, {
        ...invalidParams,
        optimizer: "auto",
        auto: { stageOrder: ["greedy"], wallClockLimitSeconds: 1 }
      }),
    invalidServiceDimensions
  );
  assert.throws(
    () => solveLns(grid, { ...invalidParams, optimizer: "lns", lns: { iterations: 1 } }),
    invalidServiceDimensions
  );
  assert.throws(() => solveCpSat(grid, { ...invalidParams, optimizer: "cp-sat" }), invalidServiceDimensions);
  assert.throws(
    () =>
      solveCpSat(grid, {
        optimizer: "cp-sat",
        cpSat: { useNoOverlap2d: "yes" }
      }),
    /Invalid solver input: CP-SAT experimental option cpSat\.useNoOverlap2d must be a boolean\./
  );
  assert.throws(
    () =>
      solveCpSat(grid, {
        optimizer: "cp-sat",
        cpSat: {
          warmStartHint: {
            solution: {
              roads: ["1,"],
              services: [],
              residentials: [],
              populations: [],
              totalPopulation: 0
            }
          }
        }
      }),
    /Invalid solver input: CP-SAT warm-start hint cpSat\.warmStartHint\.solution\.roads\[0\] must be a road key like "r,c"\./
  );
  assert.throws(
    () =>
      solveCpSat(grid, {
        optimizer: "cp-sat",
        cpSat: {
          warmStartHint: {
            roads: new Set(["0,0"])
          }
        }
      }),
    /Invalid solver input: CP-SAT warm-start hint cpSat\.warmStartHint\.services must be an array\./
  );
  assert.throws(
    () =>
      solveCpSat(grid, {
        optimizer: "cp-sat",
        cpSat: {
          warmStartHint: {
            modelFingerprint: computeCpSatRequestFingerprint(grid, { optimizer: "cp-sat" }),
            serviceCandidateKeys: ["service:-2:0:0:1:1"]
          }
        }
      }),
    /Invalid solver input: CP-SAT warm-start hint cpSat\.warmStartHint\.serviceCandidateKeys\[0\] must be a service candidate key\./
  );
  assert.throws(
    () =>
      solveCpSat(grid, {
        optimizer: "cp-sat",
        cpSat: {
          warmStartHint: {
            modelFingerprint: computeCpSatRequestFingerprint(grid, { optimizer: "cp-sat" }),
            residentialCandidateKeys: ["residential:0:00:0:1:1"]
          }
        }
      }),
    /Invalid solver input: CP-SAT warm-start hint cpSat\.warmStartHint\.residentialCandidateKeys\[0\] must be a residential candidate key\./
  );
  assert.equal(
    computeCpSatRequestFingerprint(grid, {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 1, h: 1, min: 1, max: 2, avail: 1 }],
      residentialSettings: { "1x1": { min: 99, max: 100 } },
      basePop: 99,
      maxPop: 100,
      availableBuildings: { residentials: 1 },
      maxResidentials: 99
    }),
    computeCpSatRequestFingerprint(grid, {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 1, h: 1, min: 1, max: 2, avail: 1 }],
      availableBuildings: { residentials: 1 }
    })
  );
  await assert.rejects(
    () => solveCpSatAsync(grid, { ...invalidParams, optimizer: "cp-sat" }),
    invalidServiceDimensions
  );
}

function testBackgroundSolverStartersValidateSharedInputs() {
  const malformedGrid = [[1], [1, 1]];
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const invalidParams = {
    serviceTypes: [{ name: "Clinic", rows: 0, cols: 1, range: 1, bonus: 10, avail: 1 }],
    residentialTypes: [{ name: "Home", w: 1, h: 1, min: 1, max: 2, avail: 1 }]
  };
  const malformedGridMessage = /Invalid solver input: Grid\[1\] must have length 1 to keep the grid rectangular\./;
  const invalidServiceDimensions =
    /Invalid solver input: Problem definition serviceTypes\[0\]\.rows must be an integer >= 1\./;

  assert.throws(
    () =>
      startAutoSolve(malformedGrid, {
        optimizer: "auto",
        auto: { stageOrder: ["greedy"], wallClockLimitSeconds: 1 }
      }),
    malformedGridMessage
  );
  assert.throws(() => startCpSatSolve(malformedGrid, { optimizer: "cp-sat" }), malformedGridMessage);
  assert.throws(() => startGreedySolve(grid, { ...invalidParams, optimizer: "greedy" }), invalidServiceDimensions);
  assert.throws(
    () => startLnsSolve(grid, { ...invalidParams, optimizer: "lns", lns: { iterations: 1 } }),
    invalidServiceDimensions
  );
  assert.throws(() => startCpSatSolve(grid, { ...invalidParams, optimizer: "cp-sat" }), invalidServiceDimensions);
  assert.throws(
    () =>
      startAutoSolve(grid, {
        ...invalidParams,
        optimizer: "auto",
        auto: { stageOrder: ["greedy"], wallClockLimitSeconds: 1 }
      }),
    invalidServiceDimensions
  );
}

function testBackgroundSolveCleansTempDirectoryWhenRequestBuildFails() {
  const stopDirectoryPrefix = `city-builder-bg-request-failure-${process.pid}-${Date.now()}-`;

  assert.throws(
    () =>
      startJsonBackgroundSolve({
        solverLabel: "Test request builder",
        stopDirectoryPrefix,
        command: process.execPath,
        args: ["-e", ""],
        buildRequest: () => {
          throw new Error("request construction failed");
        },
        parseRaw: JSON.parse,
        materializeSolution: () => buildMockSolution({ optimizer: "cp-sat" }),
        getSnapshotState: () => ({
          hasFeasibleSolution: false,
          totalPopulation: null
        }),
        stoppedBeforeFeasibleMessage: "Test request builder stopped before feasible.",
        noSolutionMessage: "Test request builder returned no solution."
      }),
    /request construction failed/
  );

  const leakedDirectories = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(stopDirectoryPrefix));
  assert.deepEqual(leakedDirectories, []);
}

async function testBackgroundSolveCachesUnchangedSnapshots() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-bg-cache-"));
  const workerScriptPath = path.join(tempDir, "snapshot-worker.cjs");
  const readyPath = path.join(tempDir, "ready.txt");
  let parseCount = 0;
  let materializeCount = 0;
  let snapshotFilePath = null;

  fs.writeFileSync(
    workerScriptPath,
    `
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input || "{}");
  fs.writeFileSync(request.snapshotFilePath, JSON.stringify({ totalPopulation: 10, status: "FEASIBLE" }));
  fs.writeFileSync(request.readyPath, "ready");
  setInterval(() => {}, 1000);
});
`,
    "utf8"
  );

  const handle = startJsonBackgroundSolve({
    solverLabel: "Test snapshot cache",
    stopDirectoryPrefix: "city-builder-bg-cache-test-",
    command: process.execPath,
    args: [workerScriptPath],
    buildRequest: (paths) => {
      snapshotFilePath = paths.snapshotFilePath;
      return {
        snapshotFilePath: paths.snapshotFilePath,
        readyPath
      };
    },
    parseRaw: (text) => {
      parseCount++;
      return JSON.parse(text);
    },
    materializeSolution: (raw, stoppedByUser) => {
      materializeCount++;
      return buildMockSolution({
        optimizer: "cp-sat",
        totalPopulation: raw.totalPopulation,
        cpSatStatus: raw.status,
        stoppedByUser
      });
    },
    getSnapshotState: (raw) => ({
      hasFeasibleSolution: Boolean(raw),
      totalPopulation: raw?.totalPopulation ?? null,
      cpSatStatus: raw?.status ?? null
    }),
    stoppedBeforeFeasibleMessage: "Test snapshot cache stopped before feasible.",
    noSolutionMessage: "Test snapshot cache returned no solution.",
    forcedTerminationDelayMs: 20
  });

  try {
    await waitForFile(readyPath);

    assert.equal(handle.getLatestSnapshotState().totalPopulation, 10);
    assert.equal(parseCount, 1);

    assert.equal(handle.getLatestSnapshotState().totalPopulation, 10);
    assert.equal(parseCount, 1);

    const firstSnapshot = handle.getLatestSnapshot();
    const secondSnapshot = handle.getLatestSnapshot();
    assert.equal(firstSnapshot?.totalPopulation, 10);
    assert.strictEqual(secondSnapshot, firstSnapshot);
    assert.equal(materializeCount, 1);
    assert.equal(parseCount, 1);

    assert.equal(typeof snapshotFilePath, "string");
    fs.writeFileSync(snapshotFilePath, JSON.stringify({ totalPopulation: 25, status: "FEASIBLE" }), "utf8");

    assert.equal(handle.getLatestSnapshotState().totalPopulation, 25);
    assert.equal(parseCount, 2);
    const updatedSnapshot = handle.getLatestSnapshot();
    assert.equal(updatedSnapshot?.totalPopulation, 25);
    assert.notStrictEqual(updatedSnapshot, firstSnapshot);
    assert.equal(materializeCount, 2);
  } finally {
    handle.forceKill?.();
    await handle.promise.catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testBackgroundSolveIgnoresInvalidLiveSnapshotMaterialization() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-bg-invalid-live-snapshot-"));
  const workerScriptPath = path.join(tempDir, "invalid-live-snapshot-worker.cjs");
  const readyPath = path.join(tempDir, "ready.txt");

  fs.writeFileSync(
    workerScriptPath,
    `
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input || "{}");
  fs.writeFileSync(request.snapshotFilePath, JSON.stringify({ totalPopulation: 10, status: "FEASIBLE" }));
  fs.writeFileSync(request.readyPath, "ready");
  setInterval(() => {}, 1000);
});
`,
    "utf8"
  );

  const handle = startJsonBackgroundSolve({
    solverLabel: "Test invalid live snapshot",
    stopDirectoryPrefix: "city-builder-bg-invalid-live-snapshot-test-",
    command: process.execPath,
    args: [workerScriptPath],
    buildRequest: (paths) => ({
      snapshotFilePath: paths.snapshotFilePath,
      readyPath
    }),
    parseRaw: JSON.parse,
    materializeSolution: () => {
      throw new Error("invalid live snapshot");
    },
    getSnapshotState: (raw) => ({
      hasFeasibleSolution: Boolean(raw),
      totalPopulation: raw?.totalPopulation ?? null,
      cpSatStatus: raw?.status ?? null
    }),
    stoppedBeforeFeasibleMessage: "Test invalid live snapshot stopped before feasible.",
    noSolutionMessage: "Test invalid live snapshot returned no solution.",
    forcedTerminationDelayMs: 20
  });

  try {
    await waitForFile(readyPath);

    assert.equal(handle.getLatestSnapshotState().hasFeasibleSolution, true);
    assert.equal(handle.getLatestSnapshotState().totalPopulation, 10);
    assert.equal(handle.getLatestSnapshot(), null);
  } finally {
    handle.forceKill?.();
    await handle.promise.catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testBackgroundSolveCancellationKillsProcessGroupChildren() {
  if (process.platform === "win32") {
    console.log("Skipping process-group cancellation regression on Windows.");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-bg-cancel-"));
  const childScriptPath = path.join(tempDir, "heartbeat-child.cjs");
  const parentScriptPath = path.join(tempDir, "portfolio-parent.cjs");
  const childPidFilePath = path.join(tempDir, "child.pid");
  const heartbeatPath = path.join(tempDir, "heartbeat.txt");
  let childPid = null;
  let heartbeatStopped = false;

  fs.writeFileSync(
    childScriptPath,
    `
const fs = require("node:fs");
const heartbeatPath = process.argv[2];
setInterval(() => {
  try {
    fs.writeFileSync(heartbeatPath, String(Date.now()));
  } catch {}
}, 20);
setInterval(() => {}, 1000);
`,
    "utf8"
  );
  fs.writeFileSync(
    parentScriptPath,
    `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const childScriptPath = process.argv[2];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input || "{}");
  const child = spawn(process.execPath, [childScriptPath, request.heartbeatPath], {
    stdio: "ignore",
  });
  fs.writeFileSync(request.childPidFilePath, String(child.pid));
  setInterval(() => {}, 1000);
});
`,
    "utf8"
  );

  try {
    const handle = startJsonBackgroundSolve({
      solverLabel: "Test CP-SAT portfolio",
      stopDirectoryPrefix: "city-builder-bg-cancel-test-",
      command: process.execPath,
      args: [parentScriptPath, childScriptPath],
      buildRequest: ({ stopFilePath, snapshotFilePath }) => ({
        stopFilePath,
        snapshotFilePath,
        childPidFilePath,
        heartbeatPath
      }),
      parseRaw: JSON.parse,
      materializeSolution: () => buildMockSolution({ optimizer: "cp-sat", stoppedByUser: true }),
      getSnapshotState: () => ({
        hasFeasibleSolution: false,
        totalPopulation: null
      }),
      stoppedBeforeFeasibleMessage: "Test portfolio solve stopped before feasible.",
      noSolutionMessage: "Test portfolio solve returned no solution.",
      forcedTerminationDelayMs: 40
    });

    await waitForFile(childPidFilePath);
    await waitForFile(heartbeatPath);
    childPid = Number(fs.readFileSync(childPidFilePath, "utf8"));
    assert.equal(Number.isInteger(childPid) && childPid > 0, true);

    handle.cancel();
    await assert.rejects(handle.promise, /Test portfolio solve stopped before feasible/);
    await waitForHeartbeatToStop(heartbeatPath);
    heartbeatStopped = true;
  } finally {
    if (!heartbeatStopped && Number.isInteger(childPid)) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch (_error) {
        // The child may have already exited after cancellation.
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runCoreOptimizerTests() {
  testOptimizerRegistry();
  testPopulationCapacityUpperBoundUsesFiniteResidentialCapacity();
  testValidateSolutionRejectsMalformedRoadSetKey();
  testValidateSolutionRejectsMalformedGridEvenWhenLayoutAvoidsBadCells();
  testValidationApisRejectMalformedPlacementGeometryWithoutThrowing();
  testFixedRoadsExtendRoadAnchorValidation();
  await testPublicSolverDispatchValidatesInputs();
  await testDirectSolverEntrypointsValidateSharedInputs();
  testBackgroundSolverStartersValidateSharedInputs();
  testBackgroundSolveCleansTempDirectoryWhenRequestBuildFails();
  await testBackgroundSolveCachesUnchangedSnapshots();
  await testBackgroundSolveIgnoresInvalidLiveSnapshotMaterialization();
  await testBackgroundSolveCancellationKillsProcessGroupChildren();
}

module.exports = {
  runCoreOptimizerTests,
  testOptimizerRegistry,
  testGeometryHelperVisitorParity,
  testBuildingGeometryHelpersParity,
  testBuildingGeometryCachesParity,
  testPlannerExplainabilityMapSummarizesOpportunityAndRisk,
  testPopulationCapacityUpperBoundUsesFiniteResidentialCapacity,
  testRoadProbePreservesEdgeBorderConnectivity,
  testRoadProbeScratchRepeatability,
  testRoadProbeScratchWorkspaceResetsBetweenCalls,
  testBuildingConnectivityShadowMeasuresDisconnectedReachableCells,
  testGreedyAttemptStateRejectsMismatchedProbeKind,
  testFixedRoadsExtendRoadAnchorValidation,
  testRoadPruningDropsConnectorsOnlyNeededByAnchorBoundaryBuildings,
  testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval,
  testValidateSolutionRejectsMalformedRoadSetKey,
  testValidateSolutionRejectsMalformedGridEvenWhenLayoutAvoidsBadCells,
  testValidationApisRejectMalformedPlacementGeometryWithoutThrowing,
  testPublicSolverDispatchValidatesInputs,
  testDirectSolverEntrypointsValidateSharedInputs,
  testBackgroundSolverStartersValidateSharedInputs,
  testBackgroundSolveCleansTempDirectoryWhenRequestBuildFails,
  testBackgroundSolveCachesUnchangedSnapshots,
  testBackgroundSolveIgnoresInvalidLiveSnapshotMaterialization,
  testBackgroundSolveCancellationKillsProcessGroupChildren
};
