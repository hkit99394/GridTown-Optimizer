const assert = require("node:assert/strict");

const { evaluateLayout, validateSolution } = require("../../dist/index.js");

function allowedGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
}

function scenario(name, run) {
  try {
    run();
  } catch (error) {
    error.message = `${name}\n${error.message}`;
    throw error;
  }
}

function assertValid(result) {
  assert.equal(result.valid, true, result.errors.join("\n"));
}

function assertInvalid(result, pattern) {
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), pattern);
}

scenario(
  "Given a service reaches a residential, when the layout is evaluated, then the residential is boosted and capped",
  () => {
    const grid = allowedGrid(4, 6);
    const params = {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 150, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
    };
    const roads = new Set(["0,1", "0,4"]);
    const services = [{ r: 1, c: 1, rows: 2, cols: 2, range: 2, bonus: 80 }];
    const residentials = [{ r: 1, c: 4, rows: 2, cols: 2 }];

    const evaluated = evaluateLayout({ grid, roads, services, residentials, params });

    assertValid(evaluated);
    assert.deepEqual(evaluated.boosts, [80]);
    assert.deepEqual(
      evaluated.populations.map((residential) => residential.population),
      [150]
    );
    assert.equal(evaluated.totalPopulation, 150);

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads,
        services: services.map(({ bonus, ...service }) => service),
        serviceTypeIndices: [0],
        servicePopulationIncreases: [80],
        residentials,
        residentialTypeIndices: [0],
        populations: [150],
        totalPopulation: 150,
      },
    });

    assertValid(validation);
  }
);

scenario(
  "Given a road component is away from the anchor boundary, when the solution is validated, then the solution is rejected",
  () => {
    const grid = allowedGrid(4, 4);
    const params = {
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
    };

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["2,2"]),
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [{ r: 2, c: 3, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [10],
        totalPopulation: 10,
      },
    });

    assertInvalid(validation, /row 0 or column 0/);
  }
);

scenario(
  "Given two buildings claim the same cell, when the solution is validated, then the solution is rejected",
  () => {
    const grid = allowedGrid(4, 4);
    const params = {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 10, range: 1, avail: 1 }],
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 20, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
    };

    const validation = validateSolution({
      grid,
      params,
      solution: {
        optimizer: "greedy",
        roads: new Set(["0,1", "0,3", "1,3", "2,3"]),
        services: [{ r: 1, c: 1, rows: 2, cols: 2, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [10],
        residentials: [{ r: 2, c: 2, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [20],
        totalPopulation: 20,
      },
    });

    assertInvalid(validation, /overlap|already occupied/i);
  }
);
