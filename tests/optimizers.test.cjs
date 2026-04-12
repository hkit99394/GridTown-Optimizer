const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  solve,
  solveGreedy,
  solveCpSat,
  solveLns,
  validateSolution,
  validateSolutionMap,
  getOptimizerAdapter,
  listOptimizerAdapters,
  resolveOptimizerName,
} = require("../dist/index.js");

function testOptimizerRegistry() {
  assert.equal(resolveOptimizerName(undefined), "greedy");
  assert.equal(resolveOptimizerName({ optimizer: "cp-sat" }), "cp-sat");
  assert.equal(resolveOptimizerName({ optimizer: "lns" }), "lns");
  assert.equal(getOptimizerAdapter("greedy").name, "greedy");
  assert.equal(getOptimizerAdapter({ optimizer: "cp-sat" }).name, "cp-sat");
  assert.equal(getOptimizerAdapter("lns").name, "lns");
  assert.deepEqual(
    listOptimizerAdapters().map((adapter) => adapter.name).sort(),
    ["cp-sat", "greedy", "lns"]
  );
}

function resolveCpSatPython() {
  const venvPython = path.resolve(__dirname, "../.venv-cp-sat/bin/python");
  const pythonExecutable = fs.existsSync(venvPython) ? venvPython : process.env.CITY_BUILDER_CP_SAT_PYTHON;

  if (!pythonExecutable) {
    console.log("Skipping CP-SAT optimizer test because no CP-SAT python runtime is configured.");
    return null;
  }

  const importCheck = childProcess.spawnSync(pythonExecutable, ["-c", "import ortools"], {
    encoding: "utf8",
  });
  if (importCheck.status !== 0) {
    console.log("Skipping CP-SAT optimizer test because OR-Tools is not installed in the configured python runtime.");
    return null;
  }

  return pythonExecutable;
}

function testGreedyDispatcher() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { services: 0, residentials: 2 },
    greedy: { localSearch: false },
  };

  const dispatched = solve(grid, params);
  const direct = solveGreedy(grid, params);

  assert.equal(dispatched.optimizer, "greedy");
  assert.equal(dispatched.totalPopulation, direct.totalPopulation);
}

function maybeTestCpSatOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 },
    ],
    availableBuildings: { residentials: 2, services: 0 },
  };

  const solution = solve(grid, params);
  const direct = solveCpSat(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual([...solution.residentialTypeIndices].sort((a, b) => a - b), [0, 1]);
  assert.equal(direct.totalPopulation, 110);
}

function maybeTestCpSatSupportsShapedServices() {
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
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 },
    },
    availableBuildings: { services: 1, residentials: 2 },
  };

  const solution = solve(grid, params);
  const direct = solveCpSat(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.services.length, 1);
  assert.equal(direct.services.length, 1);
  assert.deepEqual([...solution.serviceTypeIndices], [0]);
  assert.deepEqual([...solution.servicePopulationIncreases], [50]);
  assert.deepEqual([...direct.serviceTypeIndices], [0]);
  assert.deepEqual([...direct.servicePopulationIncreases], [50]);
  assert.deepEqual([solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b), [2, 3]);
  assert.equal(solution.services[0].range, 1);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
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
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "lns",
    cpSat: {
      pythonExecutable,
      numWorkers: 1,
      timeLimitSeconds: 5,
    },
    lns: {
      iterations: 2,
      maxNoImprovementIterations: 2,
      repairTimeLimitSeconds: 1,
      neighborhoodRows: 3,
      neighborhoodCols: 3,
    },
    serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 180, avail: 2 },
      { w: 2, h: 3, min: 130, max: 260, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    greedy: {
      localSearch: true,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 10,
      exhaustiveServiceSearch: false,
    },
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
            bonus: greedySeed.servicePopulationIncreases[index] ?? 0,
          })),
          residentials: greedySeed.residentials.map((residential, index) => ({
            r: residential.r,
            c: residential.c,
            rows: residential.rows,
            cols: residential.cols,
            typeIndex: greedySeed.residentialTypeIndices[index] ?? -1,
            population: greedySeed.populations[index] ?? 0,
          })),
          populations: [...greedySeed.populations],
          totalPopulation: greedySeed.totalPopulation,
        },
      },
    },
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
        numWorkers: 1,
      },
      serviceTypes: [
        { rows: 2, cols: 2, bonus: 118, range: 5, avail: 1 },
        { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 600, avail: 1 },
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
                bonus: 118,
              },
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 218,
              },
            ],
            populations: [218],
            totalPopulation: 218,
          },
        },
      },
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
        numWorkers: 1,
      },
      serviceTypes: [
        { rows: 2, cols: 2, bonus: 480, range: 5, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 400, avail: 1 },
        { w: 2, h: 2, min: 100, max: 700, avail: 1 },
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
                bonus: 480,
              },
            ],
            residentials: [
              {
                r: 3,
                c: 1,
                rows: 2,
                cols: 2,
                typeIndex: 0,
                population: 400,
              },
            ],
            populations: [400],
            totalPopulation: 400,
          },
        },
      },
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

function testSolutionValidator() {
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
  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
  assert.equal(validation.recomputedTotalPopulation, solution.totalPopulation);

  const broken = {
    ...solution,
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation + 1,
  };
  broken.populations[0] += 1;

  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /reports population/);
  assert.match(brokenValidation.errors.join("\n"), /reports total population/);
}

function testSolutionMapValidatorRejectsRoadsNotConnectedToRow0() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false },
  };

  const solution = solve(grid, params);
  const broken = {
    ...solution,
    roads: new Set(["1,1", "1,2"]),
  };

  const validation = validateSolutionMap({ grid, solution: broken, params });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /row 0/);
  assert.match(validation.mapText, /^   0123/m);
}

function testTopRowBuildingCountsAsRoadConnected() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    basePop: 10,
    maxPop: 10,
    availableBuildings: { residentials: 1, services: 0 },
  };
  const solution = {
    roads: new Set(["0,3"]),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [{ r: 0, c: 0, rows: 2, cols: 2 }],
    residentialTypeIndices: [-1],
    populations: [10],
    totalPopulation: 10,
  };

  const validation = validateSolutionMap({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function testGreedySupportsShapedServices() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 },
    },
    availableBuildings: { services: 1, residentials: 2 },
    greedy: { localSearch: false },
  };

  const solution = solveGreedy(grid, params);
  assert.equal(solution.services.length, 1);
  assert.deepEqual([solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b), [2, 3]);
  assert.equal(solution.services[0].range, 1);
  assert.deepEqual(solution.serviceTypeIndices, [0]);
  assert.deepEqual(solution.servicePopulationIncreases, [50]);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);

  const broken = {
    ...solution,
    services: [{ ...solution.services[0], range: 3 }],
  };
  const brokenValidation = validateSolution({ grid, solution: broken, params });
  assert.equal(brokenValidation.valid, false);
  assert.match(brokenValidation.errors.join("\n"), /does not match configured service type/);
}

testOptimizerRegistry();
testGreedyDispatcher();
maybeTestCpSatOptimizer();
maybeTestCpSatSupportsShapedServices();
maybeTestLnsOptimizer();
testLnsDeterministicServiceUpgrade();
testLnsDeterministicResidentialUpgrade();
testSolutionValidator();
testSolutionMapValidatorRejectsRoadsNotConnectedToRow0();
testTopRowBuildingCountsAsRoadConnected();
testGreedySupportsShapedServices();

console.log("Optimizer backend tests passed.");
