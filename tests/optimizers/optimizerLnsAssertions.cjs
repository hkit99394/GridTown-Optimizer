const {
  assert,
  fs,
  path,
  solve,
  solveGreedy,
  solveCpSat,
  solveLns,
  validateSolution,
  resolveCpSatPython,
  buildAdaptiveNeighborhoodCandidates,
  buildLnsWarmStartHint,
  buildNeighborhoodWindows,
  repairSmallWindowWithDp,
  applyDeterministicDominanceUpgrades
} = require("./optimizerHarnessDeps.cjs");

function testLnsNeighborhoodWindowsPrioritizeWeakServicesAndUpgradeHeadroom() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 30, range: 1, avail: 2 },
      { rows: 2, cols: 2, bonus: 180, range: 4, avail: 2 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 150, avail: 1 },
      { w: 2, h: 2, min: 100, max: 500, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 2 },
    lns: {
      iterations: 3,
      maxNoImprovementIterations: 2,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      repairTimeLimitSeconds: 1
    }
  };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [
      { r: 1, c: 4, rows: 2, cols: 2, range: 1 },
      { r: 1, c: 0, rows: 2, cols: 2, range: 4 }
    ],
    serviceTypeIndices: [0, 1],
    servicePopulationIncreases: [30, 180],
    residentials: [
      { r: 4, c: 0, rows: 2, cols: 2 },
      { r: 4, c: 4, rows: 2, cols: 2 }
    ],
    residentialTypeIndices: [1, 0],
    populations: [280, 150],
    totalPopulation: 430
  };

  const windows = buildNeighborhoodWindows(grid, params, incumbent, {
    iterations: 3,
    maxNoImprovementIterations: 2,
    neighborhoodRows: 3,
    neighborhoodCols: 3,
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: ""
  });
  const operatorCandidates = buildAdaptiveNeighborhoodCandidates(grid, params, incumbent, {
    iterations: 3,
    maxNoImprovementIterations: 2,
    neighborhoodRows: 3,
    neighborhoodCols: 3,
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: ""
  });
  const operators = new Set(operatorCandidates.map((candidate) => candidate.operator));
  for (const operator of [
    "weak-service",
    "residential-headroom",
    "frontier-congestion",
    "gate-choke",
    "service-overlap",
    "random-exploration"
  ]) {
    assert.equal(operators.has(operator), true, `expected LNS operator ${operator}`);
  }
  const indexOfWindow = (target) =>
    windows.findIndex(
      (window) =>
        window.top === target.top &&
        window.left === target.left &&
        window.rows === target.rows &&
        window.cols === target.cols
    );

  const weakServiceWindow = { top: 1, left: 3, rows: 3, cols: 3 };
  const strongServiceWindow = { top: 1, left: 0, rows: 3, cols: 3 };
  const highHeadroomResidentialWindow = { top: 3, left: 0, rows: 3, cols: 3 };
  const saturatedResidentialWindow = { top: 3, left: 3, rows: 3, cols: 3 };

  assert.equal(indexOfWindow(weakServiceWindow), 0);
  assert.ok(indexOfWindow(strongServiceWindow) > indexOfWindow(weakServiceWindow));
  assert.ok(indexOfWindow(highHeadroomResidentialWindow) >= 0);
  assert.ok(indexOfWindow(highHeadroomResidentialWindow) < indexOfWindow(saturatedResidentialWindow));

  const slidingOnlyWindows = buildNeighborhoodWindows(grid, params, incumbent, {
    iterations: 3,
    maxNoImprovementIterations: 2,
    neighborhoodRows: 3,
    neighborhoodCols: 3,
    neighborhoodAnchorPolicy: "sliding-only",
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: ""
  });

  assert.notDeepEqual(slidingOnlyWindows[0], weakServiceWindow);
}

function testLnsNeighborhoodWindowsEscalateWhenStagnating() {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => 1));
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 40, range: 2, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 300, avail: 1 }],
    lns: {
      iterations: 6,
      maxNoImprovementIterations: 4,
      neighborhoodRows: 3,
      neighborhoodCols: 4,
      repairTimeLimitSeconds: 1
    }
  };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "0,6", "0,7", "0,8", "0,9"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };
  const options = {
    iterations: 6,
    maxNoImprovementIterations: 4,
    neighborhoodRows: 3,
    neighborhoodCols: 4,
    repairTimeLimitSeconds: 1,
    stopFilePath: "",
    snapshotFilePath: ""
  };

  const staleWindows = buildNeighborhoodWindows(grid, params, incumbent, options, 2);
  assert.deepEqual(staleWindows[0], { top: 1, left: 0, rows: 7, cols: 8 });
  assert.deepEqual(staleWindows[1], { top: 1, left: 2, rows: 7, cols: 8 });

  const finalStageWindows = buildNeighborhoodWindows(grid, params, incumbent, options, 4);
  assert.ok(
    finalStageWindows.some((window) => window.top === 1 && window.left === 0 && window.rows === 7 && window.cols === 10)
  );
  assert.ok(
    finalStageWindows.some((window) => window.top === 0 && window.left === 0 && window.rows === 8 && window.cols === 10)
  );
}

function maybeTestLnsOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5
    },
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3
    },
    serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 180, avail: 2 },
      { w: 2, h: 3, min: 130, max: 260, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    greedy: {
      localSearch: true,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 10,
      exhaustiveServiceSearch: false
    }
  };

  const greedySeed = solveGreedy(grid, { ...params, optimizer: "greedy" });
  const solution = solve(grid, params);
  const direct = solveLns(grid, params);
  const seeded = solveLns(grid, {
    ...params,
    lns: {
      ...params.lns,
      seedHint: {
        solution: {
          roads: [...greedySeed.roads],
          services: greedySeed.services.map((service, index) => ({
            r: service.r,
            c: service.c,
            rows: service.rows,
            cols: service.cols,
            range: service.range,
            typeIndex: greedySeed.serviceTypeIndices[index] ?? -1,
            bonus: greedySeed.servicePopulationIncreases[index] ?? 0
          })),
          residentials: greedySeed.residentials.map((residential, index) => ({
            r: residential.r,
            c: residential.c,
            rows: residential.rows,
            cols: residential.cols,
            typeIndex: greedySeed.residentialTypeIndices[index] ?? -1,
            population: greedySeed.populations[index] ?? 0
          })),
          populations: [...greedySeed.populations],
          totalPopulation: greedySeed.totalPopulation
        }
      }
    }
  });

  assert.equal(solution.optimizer, "lns");
  assert.equal(direct.optimizer, "lns");
  assert.equal(seeded.optimizer, "lns");
  assert.ok(solution.totalPopulation >= greedySeed.totalPopulation);
  assert.ok(direct.totalPopulation >= greedySeed.totalPopulation);
  assert.ok(seeded.totalPopulation >= greedySeed.totalPopulation);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testLnsRejectsInvalidSeedHint() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "lns",
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      seedHint: {
        solution: {
          roads: ["0,2", "1,2"],
          services: [],
          residentials: [
            { r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 },
            { r: 2, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 }
          ],
          populations: [10, 10],
          totalPopulation: 20
        }
      }
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  assert.throws(() => solveLns(grid, params), /Invalid solver input: LNS seed hint is invalid:/);
}

function testLnsRejectsMalformedSeedHintFields() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "lns",
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
      seedHint: {
        solution: {
          roads: [],
          services: [],
          residentials: [{ r: null, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 10 }],
          populations: [10],
          totalPopulation: 10
        }
      }
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  assert.throws(
    () => solveLns(grid, params),
    /Invalid solver input: LNS seed hint solution\.residentials\[0\]\.r must be an integer >= 0\./
  );
}

function maybeTestLnsExploresMultipleRoadAnchorSeeds() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 0, 1, 0],
    [0, 0, 1, 1],
    [0, 0, 1, 1]
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5
    },
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 2,
      neighborhoodCols: 2
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveLns(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.totalPopulation, 10);
  assert.equal(validation.valid, true);
}

function maybeTestLnsCanRepairRoadAnchorLayouts() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1]
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5
    },
    lns: {
      iterations: 1,
      maxNoImprovementIterations: 1,
      repairTimeLimitSeconds: 5,
      neighborhoodRows: 3,
      neighborhoodCols: 6
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 20 },
      { w: 2, h: 3, min: 15, max: 15, avail: 20 }
    ],
    availableBuildings: { residentials: 20, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const greedySolution = solveGreedy(grid, params);
  const solution = solveLns(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(greedySolution.totalPopulation, 85);
  assert.equal(solution.totalPopulation, 95);
  assert.notDeepEqual([...solution.roads].sort(), [...greedySolution.roads].sort());
  assert.equal(validation.valid, true);
}

function testLnsRunsFinalEscalationWithinConfiguredBudget() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const seenWindows = [];

  cpSatModule.solveCpSat = (grid, params) => {
    seenWindows.push({ ...params.cpSat.warmStartHint.neighborhoodWindow });
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(["0,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0
    };
  };

  try {
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => 1));
    solveLns(grid, {
      optimizer: "lns",
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 4,
        neighborhoodRows: 3,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 1,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    });
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }

  assert.equal(seenWindows.length, 4);
  assert.deepEqual(seenWindows[0], { top: 1, left: 0, rows: 3, cols: 4 });
  assert.deepEqual(seenWindows[1], { top: 1, left: 0, rows: 7, cols: 8 });
  assert.deepEqual(seenWindows[2], { top: 1, left: 2, rows: 7, cols: 8 });
  assert.deepEqual(seenWindows[seenWindows.length - 1], { top: 0, left: 0, rows: 8, cols: 10 });
}

function testLnsTelemetryRecordsRepairPolicyAndOutcomes() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const seenRepairBudgets = [];
  let attempts = 0;

  cpSatModule.solveCpSat = (_grid, params) => {
    attempts += 1;
    const improved = attempts === 2;
    seenRepairBudgets.push(params.cpSat.timeLimitSeconds);
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(["0,0", "1,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: improved ? [{ r: 1, c: 1, rows: 2, cols: 2 }] : [],
      residentialTypeIndices: improved ? [0] : [],
      populations: improved ? [10] : [],
      totalPopulation: improved ? 10 : 0
    };
  };

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 4,
        focusedRepairTimeLimitSeconds: 2,
        escalatedRepairTimeLimitSeconds: 3,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    });

    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.totalPopulation, 10);
    assert.deepEqual(seenRepairBudgets, [2, 3]);
    assert.equal(solution.lnsTelemetry.seedSource, "hint");
    assert.equal(solution.lnsTelemetry.stopReason, "population-cap-reached");
    assert.equal(solution.lnsTelemetry.seedTimeLimitSeconds, null);
    assert.equal(solution.lnsTelemetry.outcomes.length, 2);
    assert.equal(solution.lnsTelemetry.outcomes[0].phase, "focused");
    assert.equal(typeof solution.lnsTelemetry.outcomes[0].operator, "string");
    assert.equal(typeof solution.lnsTelemetry.outcomes[0].operatorWeight, "number");
    assert.equal(solution.lnsTelemetry.outcomes[0].status, "neutral");
    assert.equal(solution.lnsTelemetry.outcomes[1].phase, "escalated");
    assert.equal(typeof solution.lnsTelemetry.outcomes[1].operator, "string");
    assert.equal(solution.lnsTelemetry.outcomes[1].status, "improved");
    assert.equal(solution.lnsTelemetry.improvingIterations, 1);
    assert.equal(solution.lnsTelemetry.neutralIterations, 1);
    const neutralOperatorSummary = solution.lnsTelemetry.operatorSummaries.find(
      (summary) => summary.operator === solution.lnsTelemetry.outcomes[0].operator
    );
    const improvedOperatorSummary = solution.lnsTelemetry.operatorSummaries.find(
      (summary) => summary.operator === solution.lnsTelemetry.outcomes[1].operator
    );
    assert.equal(neutralOperatorSummary.attempts >= 1, true);
    assert.equal(neutralOperatorSummary.feasibleRepairs >= 1, true);
    assert.equal(neutralOperatorSummary.neutralRepairs >= 1, true);
    assert.equal(improvedOperatorSummary.attempts >= 1, true);
    assert.equal(improvedOperatorSummary.improvements, 1);
    assert.equal(improvedOperatorSummary.totalImprovement, 10);
    assert.ok(improvedOperatorSummary.weight > solution.lnsTelemetry.outcomes[1].operatorWeight);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsSmallWindowDpRepairImprovesWithoutCpSat() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let cpSatCalls = 0;

  cpSatModule.solveCpSat = () => {
    cpSatCalls += 1;
    throw new Error("CP-SAT should not run for eligible small-window DP repair.");
  };

  try {
    const grid = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ];
    const params = {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        neighborhoodAnchorPolicy: "sliding-only",
        smallWindowDpRepair: true,
        smallWindowDpMaxMutableCells: 9,
        smallWindowDpMaxCandidates: 8,
        smallWindowDpMaxStates: 10_000,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    };
    const solution = solveLns(grid, params);
    const validation = validateSolution({ grid, solution, params });
    const outcome = solution.lnsTelemetry.outcomes[0];

    assert.equal(cpSatCalls, 0);
    assert.equal(solution.totalPopulation, 10);
    assert.equal(validation.valid, true);
    assert.equal(solution.lnsTelemetry.stopReason, "population-cap-reached");
    assert.equal(outcome.status, "improved");
    assert.equal(outcome.repairBackend, "small-window-dp");
    assert.equal(outcome.smallWindowDp.status, "optimal");
    assert.equal(outcome.smallWindowDp.mutableCellCount, 9);
    assert.equal(outcome.smallWindowDp.roadMaskCount, 512);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsSmallWindowDpRepairFallsBackToCpSatWhenIneligible() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let cpSatCalls = 0;

  cpSatModule.solveCpSat = (_grid, params) => {
    cpSatCalls += 1;
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(params.cpSat.warmStartHint.solution.roads),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0
    };
  };

  try {
    const grid = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ];
    const solution = solveLns(grid, {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        smallWindowDpRepair: true,
        smallWindowDpMaxMutableCells: 1,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    });
    const outcome = solution.lnsTelemetry.outcomes[0];

    assert.equal(cpSatCalls, 1);
    assert.equal(outcome.status, "neutral");
    assert.equal(outcome.repairBackend, "cp-sat");
    assert.equal(outcome.cpSatStatus, "FEASIBLE");
    assert.equal(outcome.smallWindowDp.status, "ineligible-window-size");
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function maybeTestSmallWindowDpMatchesCpSatOnEligibleRepair() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const window = { top: 0, left: 0, rows: 3, cols: 3 };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
  };

  const dpResult = repairSmallWindowWithDp(grid, params, incumbent, window, {
    maxMutableCells: 9,
    maxCandidates: 8,
    maxStates: 10_000
  });
  const cpSatResult = solveCpSat(grid, {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      ...params.cpSat,
      warmStartHint: buildLnsWarmStartHint(incumbent, window)
    }
  });

  assert.equal(dpResult.status, "optimal");
  assert.equal(dpResult.solution.totalPopulation, 10);
  assert.equal(cpSatResult.totalPopulation, 10);
  assert.equal(validateSolution({ grid, solution: dpResult.solution, params }).valid, true);
  assert.equal(validateSolution({ grid, solution: cpSatResult, params }).valid, true);
}

function testLnsGreedySeedReportsBudgetAndProfile() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;

  cpSatModule.solveCpSat = (_grid, params) => ({
    optimizer: "cp-sat",
    cpSatStatus: "FEASIBLE",
    roads: new Set(params.cpSat.warmStartHint.solution.roads),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: params.cpSat.warmStartHint.solution.residentials.map((residential) => ({
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols
    })),
    residentialTypeIndices: [
      ...params.cpSat.warmStartHint.solution.residentials.map((residential) => residential.typeIndex)
    ],
    populations: [...params.cpSat.warmStartHint.solution.populations],
    totalPopulation: params.cpSat.warmStartHint.solution.totalPopulation
  });

  try {
    const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: {
        localSearch: false,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        wallClockLimitSeconds: 10,
        repairTimeLimitSeconds: 2,
        neighborhoodRows: 2,
        neighborhoodCols: 2
      }
    });

    assert.equal(solution.lnsTelemetry.seedSource, "greedy");
    assert.equal(solution.lnsTelemetry.seedTimeLimitSeconds, 2);
    assert.equal(solution.lnsTelemetry.seedWallClockSeconds >= 0, true);
    assert(solution.greedyProfile);
    assert(solution.greedyProfile.phases.some((phase) => phase.name === "constructiveCapSearch" && phase.runs > 0));
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsStopsAfterNoImprovementTimeout() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let attempts = 0;

  cpSatModule.solveCpSat = () => {
    attempts += 1;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5) {
      // Keep the synchronous fake repair running long enough for the stale timer.
    }
    return {
      optimizer: "cp-sat",
      cpSatStatus: "FEASIBLE",
      roads: new Set(["0,0"]),
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0
    };
  };

  try {
    const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
    const solution = solveLns(grid, {
      optimizer: "lns",
      lns: {
        iterations: 10,
        maxNoImprovementIterations: 10,
        noImprovementTimeoutSeconds: 0.001,
        repairTimeLimitSeconds: 1,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    });

    assert.equal(attempts, 1);
    assert.equal(solution.lnsTelemetry.stopReason, "stale-time-limit");
    assert.equal(solution.lnsTelemetry.outcomes[0].status, "neutral");
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testLnsRejectsMalformedScalarOptions() {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
  assert.throws(
    () =>
      solveLns(grid, {
        optimizer: "lns",
        lns: {
          iterations: "many",
          seedHint: {
            solution: {
              roads: ["0,0"],
              services: [],
              residentials: [],
              populations: [],
              totalPopulation: 0
            }
          }
        }
      }),
    /Invalid solver input: LNS option lns\.iterations must be an integer between 1 and 10000\./
  );
  assert.throws(
    () =>
      solveLns(grid, {
        optimizer: "lns",
        lns: {
          smallWindowDpRepair: "yes",
          seedHint: {
            solution: {
              roads: ["0,0"],
              services: [],
              residentials: [],
              populations: [],
              totalPopulation: 0
            }
          }
        }
      }),
    /Invalid solver input: LNS option lns\.smallWindowDpRepair must be a boolean\./
  );
  assert.throws(
    () =>
      solveLns(grid, {
        optimizer: "lns",
        lns: {
          smallWindowDpMaxMutableCells: 25,
          seedHint: {
            solution: {
              roads: ["0,0"],
              services: [],
              residentials: [],
              populations: [],
              totalPopulation: 0
            }
          }
        }
      }),
    /Invalid solver input: LNS option lns\.smallWindowDpMaxMutableCells must be an integer between 1 and 24\./
  );
}

function testLnsDeterministicServiceUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-lns-upgrade-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const params = {
      optimizer: "lns",
      cpSat: {
        timeLimitSeconds: 1,
        numWorkers: 1
      },
      serviceTypes: [
        { rows: 2, cols: 2, bonus: 118, range: 5, avail: 1 },
        { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }
      ],
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 600, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        repairTimeLimitSeconds: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        stopFilePath,
        seedHint: {
          solution: {
            roads: ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"],
            services: [
              {
                r: 1,
                c: 1,
                rows: 2,
                cols: 2,
                range: 5,
                typeIndex: 0,
                bonus: 118
              }
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 218
              }
            ],
            populations: [218],
            totalPopulation: 218
          }
        }
      }
    };

    const solution = solveLns(grid, params);
    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.serviceTypeIndices[0], 1);
    assert.equal(solution.servicePopulationIncreases[0], 480);
    assert.equal(solution.totalPopulation, 580);
    assert.equal(solution.populations[0], 580);

    const validation = validateSolution({ grid, solution, params });
    assert.equal(validation.valid, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testDeterministicDominanceServiceUpgradeHelper() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 118, range: 5, avail: 1 },
      { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }
    ],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 600, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 }
  };
  const solution = applyDeterministicDominanceUpgrades(grid, params, {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 5 }],
    serviceTypeIndices: [0],
    servicePopulationIncreases: [118],
    residentials: [{ r: 3, c: 1, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [218],
    totalPopulation: 218
  });

  assert.equal(solution.serviceTypeIndices[0], 1);
  assert.equal(solution.servicePopulationIncreases[0], 480);
  assert.equal(solution.totalPopulation, 580);
  assert.equal(solution.populations[0], 580);
}

function testLnsDeterministicResidentialUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-lns-res-upgrade-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
    const params = {
      optimizer: "lns",
      cpSat: {
        timeLimitSeconds: 1,
        numWorkers: 1
      },
      serviceTypes: [{ rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 400, avail: 1 },
        { w: 2, h: 2, min: 100, max: 700, avail: 1 }
      ],
      availableBuildings: { services: 1, residentials: 1 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        repairTimeLimitSeconds: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        stopFilePath,
        seedHint: {
          solution: {
            roads: ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"],
            services: [
              {
                r: 1,
                c: 1,
                rows: 2,
                cols: 2,
                range: 5,
                typeIndex: 0,
                bonus: 480
              }
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 400
              }
            ],
            populations: [400],
            totalPopulation: 400
          }
        }
      }
    };

    const solution = solveLns(grid, params);
    assert.equal(solution.optimizer, "lns");
    assert.equal(solution.residentialTypeIndices[0], 1);
    assert.equal(solution.totalPopulation, 580);
    assert.equal(solution.populations[0], 580);

    const validation = validateSolution({ grid, solution, params });
    assert.equal(validation.valid, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testDeterministicDominanceResidentialUpgradeHelper() {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 400, avail: 1 },
      { w: 2, h: 2, min: 100, max: 700, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 1 }
  };
  const solution = applyDeterministicDominanceUpgrades(grid, params, {
    optimizer: "greedy",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 5 }],
    serviceTypeIndices: [0],
    servicePopulationIncreases: [480],
    residentials: [{ r: 3, c: 1, rows: 2, cols: 2 }],
    residentialTypeIndices: [0],
    populations: [400],
    totalPopulation: 400
  });

  assert.equal(solution.residentialTypeIndices[0], 1);
  assert.equal(solution.totalPopulation, 580);
  assert.equal(solution.populations[0], 580);
}

async function runLnsOptimizerTests() {
  testLnsNeighborhoodWindowsPrioritizeWeakServicesAndUpgradeHeadroom();
  testLnsNeighborhoodWindowsEscalateWhenStagnating();
  testLnsRunsFinalEscalationWithinConfiguredBudget();
  testLnsTelemetryRecordsRepairPolicyAndOutcomes();
  testLnsSmallWindowDpRepairImprovesWithoutCpSat();
  testLnsSmallWindowDpRepairFallsBackToCpSatWhenIneligible();
  testLnsGreedySeedReportsBudgetAndProfile();
  testLnsStopsAfterNoImprovementTimeout();
  testLnsRejectsMalformedScalarOptions();
  maybeTestSmallWindowDpMatchesCpSatOnEligibleRepair();
  maybeTestLnsOptimizer();
  testLnsRejectsInvalidSeedHint();
  testLnsRejectsMalformedSeedHintFields();
  maybeTestLnsExploresMultipleRoadAnchorSeeds();
  maybeTestLnsCanRepairRoadAnchorLayouts();
  testDeterministicDominanceServiceUpgradeHelper();
  testLnsDeterministicServiceUpgrade();
  testDeterministicDominanceResidentialUpgradeHelper();
  testLnsDeterministicResidentialUpgrade();
}

module.exports = {
  runLnsOptimizerTests
};
