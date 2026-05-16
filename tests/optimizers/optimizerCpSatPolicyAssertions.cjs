const { assert, solveCpSatAsync, resolveCpSatPython, parseCpSatRawSolution } = require("./optimizerHarnessDeps.cjs");

function testCpSatRejectsDuplicatePortfolioWorkerIndices() {
  assert.throws(
    () =>
      parseCpSatRawSolution(
        JSON.stringify({
          status: "FEASIBLE",
          roads: ["0,0"],
          services: [],
          residentials: [],
          populations: [],
          totalPopulation: 0,
          portfolio: {
            workerCount: 2,
            selectedWorkerIndex: 0,
            workers: [
              {
                workerIndex: 0,
                randomSeed: 1,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0
              },
              {
                workerIndex: 0,
                randomSeed: 2,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0
              }
            ]
          }
        })
      ),
    /portfolio\.workers must have unique workerIndex values/
  );
}

function testCpSatRejectsDanglingSelectedPortfolioWorkerIndex() {
  assert.throws(
    () =>
      parseCpSatRawSolution(
        JSON.stringify({
          status: "FEASIBLE",
          roads: ["0,0"],
          services: [],
          residentials: [],
          populations: [],
          totalPopulation: 0,
          portfolio: {
            workerCount: 1,
            selectedWorkerIndex: 99,
            workers: [
              {
                workerIndex: 0,
                randomSeed: 1,
                randomizeSearch: true,
                numWorkers: 1,
                status: "FEASIBLE",
                feasible: true,
                totalPopulation: 0
              }
            ]
          }
        })
      ),
    /portfolio\.selectedWorkerIndex must reference a listed worker/
  );
}

async function maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 0, 1],
    [1, 1, 0, 1],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
    [0, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
  };

  const solution = await solveCpSatAsync(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.roads.size, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.residentials[0].c, 0);
}

async function maybeTestCpSatObjectiveAvoidsUselessServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    serviceTypes: [{ rows: 1, cols: 1, bonus: 0, range: 0, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 }
  };

  const solution = await solveCpSatAsync(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.services.length, 0);
}

module.exports = {
  testCpSatRejectsDuplicatePortfolioWorkerIndices,
  testCpSatRejectsDanglingSelectedPortfolioWorkerIndex,
  maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie,
  maybeTestCpSatObjectiveAvoidsUselessServices
};
