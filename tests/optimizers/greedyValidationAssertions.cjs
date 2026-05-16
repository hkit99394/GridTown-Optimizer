const assert = require("node:assert/strict");

const { solve, solveGreedy, validateSolution, validateSolutionMap } = require("city-builder/solver");

function testSolutionValidator() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: { localSearch: false }
  };

  const solution = solve(grid, params);
  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
  assert.equal(validation.recomputedTotalPopulation, solution.totalPopulation);

  const broken = {
    ...solution,
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation + 1
  };
  broken.populations[0] += 1;

  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /reports population/);
  assert.match(brokenValidation.errors.join("\n"), /reports total population/);
}

function testSolutionMapValidatorRejectsRoadsNotConnectedToAnchorBoundary() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false }
  };

  const solution = solve(grid, params);
  const broken = {
    ...solution,
    roads: new Set(["1,1", "1,2"])
  };

  const validation = validateSolutionMap({ grid, solution: broken, params });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /row 0 or column 0/);
  assert.match(validation.mapText, /^ {3}0123/m);
}

function testSolutionValidatorAllowsMultipleAnchorBoundaryRoadComponents() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    availableBuildings: { residentials: 0, services: 0 }
  };
  const solution = {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,3", "3,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testSolutionValidatorRejectsRoadComponentsWithoutAnchorBoundary() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    availableBuildings: { residentials: 0, services: 0 }
  };
  const solution = {
    optimizer: "greedy",
    roads: new Set(["0,0", "1,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /not connected to any row-0-or-column-0-connected road component/);
  assert.match(validation.errors.join("\n"), /Disconnected road cells: \(1,3\)\./);
}

function testSolutionValidatorAllowsColumn0AnchoredRoadComponent() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    availableBuildings: { residentials: 0, services: 0 }
  };
  const solution = {
    optimizer: "greedy",
    roads: new Set(["2,0", "2,1"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testTopRowBuildingCountsAsRoadConnected() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { residentials: 1, services: 0 }
  };
  const solution = {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [-1],
    populations: [10],
    totalPopulation: 10
  };

  const validation = validateSolutionMap({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testLeftColumnBuildingCountsAsRoadConnected() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { residentials: 1, services: 0 }
  };
  const solution = {
    roads: new Set(["3,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 1, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [-1],
    populations: [10],
    totalPopulation: 10
  };

  const validation = validateSolutionMap({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testGreedyRespectsTopRowConnectivityShortcut() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.roads.size > 0, true);
  assert.equal(validation.valid, true);
}

function testGreedySupportsShapedServices() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 }
    },
    availableBuildings: { services: 1, residentials: 2 },
    greedy: { localSearch: false }
  };

  const solution = solveGreedy(grid, params);
  assert.equal(solution.services.length, 1);
  assert.deepEqual(
    [solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b),
    [2, 3]
  );
  assert.equal(solution.services[0].range, 1);
  assert.deepEqual(solution.serviceTypeIndices, [0]);
  assert.deepEqual(solution.servicePopulationIncreases, [50]);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);

  const broken = {
    ...solution,
    services: [{ ...solution.services[0], range: 3 }]
  };
  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /does not match configured service type/);
}

function testGreedyResidentialPopulationCacheRespectsTypedVariants() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 },
    greedy: {
      localSearch: false,
      randomSeed: 31,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 4,
      serviceExactMaxCombinations: 16,
      profile: true
    }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual(
    [...solution.populations].sort((a, b) => a - b),
    [10, 100]
  );
  assert(solution.greedyProfile);
  assert(solution.greedyProfile.counters.precompute.residentialPopulationCacheEntries > 0);
  assert(solution.greedyProfile.counters.residentialPhase.populationCacheLookups > 0);
}

function testGreedyProfilingIsAdditive() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 60, max: 120, avail: 4 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: {
      localSearch: true,
      randomSeed: 29,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 32
    }
  };

  const withoutProfile = solveGreedy(grid, params);
  const withProfile = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      profile: true
    }
  });

  assert.equal(withoutProfile.greedyProfile, undefined);
  assert(withProfile.greedyProfile);
  assert.equal(withProfile.totalPopulation, withoutProfile.totalPopulation);
  assert.deepEqual(withProfile.services, withoutProfile.services);
  assert.deepEqual(withProfile.serviceTypeIndices, withoutProfile.serviceTypeIndices);
  assert.deepEqual(withProfile.servicePopulationIncreases, withoutProfile.servicePopulationIncreases);
  assert.deepEqual(withProfile.residentials, withoutProfile.residentials);
  assert.deepEqual(withProfile.residentialTypeIndices, withoutProfile.residentialTypeIndices);
  assert.deepEqual(withProfile.populations, withoutProfile.populations);
  assert.deepEqual([...withProfile.roads].sort(), [...withoutProfile.roads].sort());
  assert(withProfile.greedyProfile.counters.precompute.serviceCandidates > 0);
  assert(withProfile.greedyProfile.counters.residentialPhase.candidateScans > 0);
  assert(withProfile.greedyProfile.phases.some((phase) => phase.name === "precompute" && phase.elapsedMs >= 0));
  assert(
    withProfile.greedyProfile.phases.some(
      (phase) => phase.name === "residentialLocalSearch" && phase.candidatePopulationDelta >= 0
    )
  );
}

function testGreedyDensityTieBreakerPrefersCentralNearTies() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [],
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: 0
    }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 2, c: 2, rows: 1, cols: 1 }]);
  assert.equal(solution.validation?.valid, undefined);
}

function testGreedyDensityTieBreakerIsOptIn() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [],
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };

  const withoutDensity = solveGreedy(grid, params);
  const withDensity = solveGreedy(grid, {
    ...params,
    greedy: {
      ...params.greedy,
      densityTieBreaker: true,
      densityTieBreakerTolerancePercent: 2.5
    }
  });

  assert.deepEqual(withoutDensity.residentials, [{ r: 0, c: 0, rows: 1, cols: 1 }]);
  assert.deepEqual(withDensity.residentials, [{ r: 2, c: 2, rows: 1, cols: 1 }]);
  assert.equal(withDensity.totalPopulation, withoutDensity.totalPopulation);
}

function runGreedyValidationOptimizerTests() {
  testGreedyProfilingIsAdditive();
  testGreedyDensityTieBreakerPrefersCentralNearTies();
  testGreedyDensityTieBreakerIsOptIn();
  testSolutionValidator();
  testSolutionMapValidatorRejectsRoadsNotConnectedToAnchorBoundary();
  testSolutionValidatorAllowsMultipleAnchorBoundaryRoadComponents();
  testSolutionValidatorRejectsRoadComponentsWithoutAnchorBoundary();
  testSolutionValidatorAllowsColumn0AnchoredRoadComponent();
  testTopRowBuildingCountsAsRoadConnected();
  testLeftColumnBuildingCountsAsRoadConnected();
  testGreedyRespectsTopRowConnectivityShortcut();
  testGreedySupportsShapedServices();
  testGreedyResidentialPopulationCacheRespectsTypedVariants();
}

module.exports = {
  runGreedyValidationOptimizerTests
};
