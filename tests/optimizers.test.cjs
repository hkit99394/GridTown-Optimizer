const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { solve, solveGreedy, solveCpSat, validateSolution, validateSolutionMap } = require("../dist/index.js");

function resolveCpSatPython() {
  const venvPython = path.resolve(__dirname, "../.venv-cp-sat/bin/python");
  const candidates = [fs.existsSync(venvPython) ? venvPython : null, process.env.CITY_BUILDER_CP_SAT_PYTHON || null, "python3"].filter(
    Boolean
  );

  for (const pythonExecutable of candidates) {
    const importCheck = childProcess.spawnSync(pythonExecutable, ["-c", "import ortools"], {
      encoding: "utf8",
    });
    if (importCheck.status === 0) {
      return pythonExecutable;
    }
  }

  console.log("Skipping CP-SAT optimizer test because no Python runtime with OR-Tools is configured.");
  return null;
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
  assert.equal(typeof solution.cpSatObjectivePolicy?.populationWeight, "number");
  assert.equal(solution.cpSatObjectivePolicy?.summary, "maximize population, then minimize roads + services");
  assert.equal(typeof solution.cpSatTelemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof solution.cpSatTelemetry?.bestObjectiveBound, "number");
  assert.equal(typeof solution.cpSatTelemetry?.solutionCount, "number");
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

function maybeTestCpSatBackendJsonContractSmoke() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 15, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 40, max: 55, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    cpSat: { timeLimitSeconds: 5, numWorkers: 1 },
  };

  const result = childProcess.spawnSync(
    pythonExecutable,
    [scriptPath],
    {
      input: JSON.stringify({ grid, params }),
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to run CP-SAT backend smoke test.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.status, "string");
  assert.match(payload.status, /^(OPTIMAL|FEASIBLE)$/);
  assert(Array.isArray(payload.roads));
  assert(Array.isArray(payload.services));
  assert(Array.isArray(payload.residentials));
  assert(Array.isArray(payload.populations));
  assert.equal(payload.populations.length, payload.residentials.length);
  assert.equal(payload.totalPopulation, payload.populations.reduce((sum, value) => sum + value, 0));
  assert.equal(typeof payload.objectivePolicy?.populationWeight, "number");
  assert.equal(typeof payload.objectivePolicy?.maxTieBreakPenalty, "number");
  assert.equal(typeof payload.objectivePolicy?.summary, "string");
  assert.equal(typeof payload.telemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof payload.telemetry?.userTimeSeconds, "number");
  assert.equal(typeof payload.telemetry?.solutionCount, "number");
  assert.equal(typeof payload.telemetry?.bestObjectiveBound, "number");
  assert.equal(typeof payload.telemetry?.objectiveGap, "number");
  assert.equal(typeof payload.telemetry?.bestPopulationUpperBound, "number");
  assert.equal(typeof payload.telemetry?.populationGapUpperBound, "number");
  assert.equal(typeof payload.telemetry?.lastImprovementAtSeconds, "number");
  assert.equal(typeof payload.telemetry?.secondsSinceLastImprovement, "number");
  assert.equal(typeof payload.telemetry?.numBranches, "number");
  assert.equal(typeof payload.telemetry?.numConflicts, "number");
}

function maybeTestCpSatObjectivePolicyHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 0, "range": 0, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 10, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)

print(json.dumps({
    "population_weight": built.objective_policy.population_weight,
    "max_tie_break_penalty": built.objective_policy.max_tie_break_penalty,
    "service_candidate_count": len(built.service_candidates),
    "cell_count": len(built.allowed_cells),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT objective policy helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.max_tie_break_penalty, payload.cell_count + payload.service_candidate_count);
  assert.equal(payload.population_weight, payload.max_tie_break_penalty + 1);
}

function maybeTestCpSatRuntimeOptionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

solver = module.cp_model.CpSolver()
module.configure_solver_parameters(solver, {
    "timeLimitSeconds": 7,
    "maxDeterministicTime": 3.5,
    "numWorkers": 1,
    "randomSeed": 42,
    "randomizeSearch": True,
    "relativeGapLimit": 0.125,
    "absoluteGapLimit": 9,
    "logSearchProgress": True,
})

print(json.dumps({
    "max_time_in_seconds": solver.parameters.max_time_in_seconds,
    "max_deterministic_time": solver.parameters.max_deterministic_time,
    "num_search_workers": solver.parameters.num_search_workers,
    "random_seed": solver.parameters.random_seed,
    "randomize_search": solver.parameters.randomize_search,
    "relative_gap_limit": solver.parameters.relative_gap_limit,
    "absolute_gap_limit": solver.parameters.absolute_gap_limit,
    "log_search_progress": solver.parameters.log_search_progress,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT runtime option helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.max_time_in_seconds, 7);
  assert.equal(payload.max_deterministic_time, 3.5);
  assert.equal(payload.num_search_workers, 1);
  assert.equal(payload.random_seed, 42);
  assert.equal(payload.randomize_search, true);
  assert.equal(payload.relative_gap_limit, 0.125);
  assert.equal(payload.absolute_gap_limit, 9);
  assert.equal(payload.log_search_progress, true);
}

function maybeTestCpSatWarmStartHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 30, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 40, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)
module.apply_warm_start_hints(built.model, built, {
    "roads": ["0,0", "0,1"],
    "services": [{"r": 1, "c": 2, "rows": 1, "cols": 1, "range": 1, "typeIndex": 0, "bonus": 30}],
    "residentials": [{"r": 0, "c": 0, "rows": 2, "cols": 2, "typeIndex": 0, "population": 40}],
    "totalPopulation": 40,
})
module.apply_objective_lower_bound(built.model, built, 40)

hint_proto = built.model.Proto().solution_hint
vars_to_values = dict(zip(hint_proto.vars, hint_proto.values))

print(json.dumps({
    "hint_count": len(hint_proto.vars),
    "total_population_hinted": vars_to_values.get(built.total_population.Index()),
    "total_services_hinted": vars_to_values.get(built.total_services.Index()),
    "total_roads_hinted": vars_to_values.get(built.total_roads.Index()),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT warm-start helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert(payload.hint_count > 0);
  assert.equal(payload.total_population_hinted, 40);
  assert.equal(payload.total_services_hinted, 1);
  assert.equal(payload.total_roads_hinted, 2);
}

function maybeTestCpSatWarmStartContinuation() {
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
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    greedy: { localSearch: false, restarts: 1 },
  };

  const seed = solveGreedy(grid, params);
  const continued = solveCpSat(grid, {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
      randomSeed: 7,
      warmStartHint: seed,
      objectiveLowerBound: seed.totalPopulation,
    },
  });

  assert.match(continued.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert(continued.totalPopulation >= seed.totalPopulation);
}

function maybeTestCpSatPopulationUpperBoundHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
]
params = {
    "residentialTypes": [
        {"w": 2, "h": 2, "min": 10, "max": 100, "avail": 1},
        {"w": 2, "h": 2, "min": 10, "max": 40, "avail": 3},
    ],
    "availableBuildings": {"residentials": 2, "services": 0},
}

built = module.build_model(grid, params)

print(json.dumps({
    "total_population_upper_bound": built.total_population_upper_bound,
    "residential_candidate_count": len(built.residential_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT population upper bound helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.total_population_upper_bound, 20);
  assert(payload.residential_candidate_count > 2);
}

function maybeTestCpSatResidentialPopulationUpperBoundHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 30, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 100, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)
top_left = next(candidate for candidate in built.residential_candidates if candidate["r"] == 0 and candidate["c"] == 0)

print(json.dumps({
    "population_upper_bound": top_left["populationUpperBound"],
    "total_population_upper_bound": built.total_population_upper_bound,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT residential population upper bounds.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.population_upper_bound, 40);
  assert.equal(payload.total_population_upper_bound, 40);
}

function maybeTestCpSatPrunesObjectivelyUselessServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 1, "cols": 1, "bonus": 0, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 10, "max": 20, "avail": 1}],
    "availableBuildings": {"services": 1, "residentials": 1},
}

built = module.build_model(grid, params)

print(json.dumps({
    "service_candidate_count": len(built.service_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT useless service pruning.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.service_candidate_count, 0);
}

function maybeTestCpSatBorderAccessCapacityHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

candidates = [
    {"r": 0, "border": [0, 1]},
    {"r": 1, "border": [1, 2]},
    {"r": 2, "border": [2, 3]},
]
indices, coefficients = module.build_border_access_capacity_coefficients(5, candidates)

print(json.dumps({
    "indices": indices,
    "coefficients": coefficients,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT border access capacity helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.indices, [1, 2]);
  assert.deepEqual(payload.coefficients, [0, 1, 2, 1, 0]);
}

function maybeTestCpSatGateRequirementHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

road_neighbor_ids = {
    0: [1],
    1: [0, 2, 3],
    2: [1],
    3: [1, 4],
    4: [3],
}
road_eligible_ids = {0, 1, 2, 3, 4}
eligible_row0_ids = [0]

gate_downstream = module.compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_row0_ids)
candidates = [
    {"r": 2, "border": [4]},
    {"r": 2, "border": [2, 0]},
    {"r": 0, "border": [4]},
]
gate_requirements = module.compute_candidate_gate_requirements(candidates, gate_downstream, road_eligible_ids)

print(json.dumps({
    "gate_downstream": {str(key): sorted(value) for key, value in gate_downstream.items()},
    "gate_requirements": {str(key): value for key, value in gate_requirements.items()},
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT gate requirement helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.gate_downstream, {
    0: [1, 2, 3, 4],
    1: [2, 3, 4],
    3: [4],
  });
  assert.deepEqual(payload.gate_requirements, {
    0: [0, 1, 3],
    1: [0],
  });
}

function maybeTestCpSatGateRegionalCapacityHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

candidates = [
    {"border": [0, 1, 4]},
    {"border": [1, 2, 4]},
    {"border": [2, 3]},
]
coefficients = module.build_gate_regional_capacity_coefficients(candidates, [0, 1], {1, 2, 4})

print(json.dumps({
    "coefficients": {str(key): value for key, value in coefficients.items()},
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT gate regional capacity helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.coefficients, {
    1: 2,
    2: 1,
    4: 2,
  });
}

function maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 0, 1],
    [1, 1, 0, 1],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
    [0, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
  };

  const solution = solveCpSat(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.roads.size, 1);
  assert.equal(solution.residentials.length, 1);
  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.residentials[0].c, 0);
}

function maybeTestCpSatObjectiveAvoidsUselessServices() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
    },
    serviceTypes: [{ rows: 1, cols: 1, bonus: 0, range: 0, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
  };

  const solution = solveCpSat(grid, params);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(solution.services.length, 0);
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
  assert.deepEqual(solution.services[0], { r: 1, c: 2, rows: 3, cols: 2, range: 1 });
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

function maybeTestCpSatCandidateReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
]
allowed = []
cell_to_id = {}
for r, row in enumerate(grid):
    for c, cell in enumerate(row):
        if cell != 1:
            continue
        cell_to_id[(r, c)] = len(allowed)
        allowed.append((r, c))

strong_params = {
    "serviceTypes": [
        {"rows": 2, "cols": 2, "bonus": 100, "range": 1, "avail": 1},
        {"rows": 2, "cols": 2, "bonus": 10, "range": 0, "avail": 1},
    ],
    "availableBuildings": {"services": 1},
}
weak_room_params = {
    "serviceTypes": [
        {"rows": 2, "cols": 2, "bonus": 100, "range": 1, "avail": 1},
        {"rows": 2, "cols": 2, "bonus": 10, "range": 0, "avail": 1},
    ],
    "availableBuildings": {"services": 2},
}

strong_maps = module.build_candidate_placement_maps(grid, strong_params)
weak_room_maps = module.build_candidate_placement_maps(grid, weak_room_params)
strong_candidates = module.enumerate_service_candidates(grid, strong_params, cell_to_id, strong_maps.service)
weak_room_candidates = module.enumerate_service_candidates(grid, weak_room_params, cell_to_id, weak_room_maps.service)

print(json.dumps({
    "strong_count": len(strong_candidates),
    "weak_room_count": len(weak_room_candidates),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT candidate reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.strong_count, 9);
  assert.equal(payload.weak_room_count, 18);
}

function maybeTestCpSatReachabilityReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 0, 0, 0],
  [1, 1, 0, 1, 1],
  [0, 0, 0, 1, 1],
  [1, 1, 0, 1, 1],
  [1, 1, 0, 1, 1],
]
params = {
    "serviceTypes": [{"rows": 2, "cols": 2, "bonus": 20, "range": 1, "avail": 1}],
    "residentialTypes": [{"w": 2, "h": 2, "min": 50, "max": 100, "avail": 2}],
    "availableBuildings": {"services": 1, "residentials": 2},
}

built = module.build_model(grid, params)

print(json.dumps({
    "allowed_cells": built.allowed_cells,
    "service_candidates": [
        {"r": candidate["r"], "c": candidate["c"], "rows": candidate["rows"], "cols": candidate["cols"]}
        for candidate in built.service_candidates
    ],
    "residential_candidates": [
        {"r": candidate["r"], "c": candidate["c"], "rows": candidate["rows"], "cols": candidate["cols"]}
        for candidate in built.residential_candidates
    ],
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT reachability reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.allowed_cells, [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
  assert.deepEqual(payload.service_candidates, []);
  assert.deepEqual(payload.residential_candidates, [
    { r: 0, c: 0, rows: 2, cols: 2 },
  ]);
}

function maybeTestCpSatConnectivityHelperConstraints() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1, 1],
  [1, 1, 1],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)
model = built.model
model.Add(built.road_vars[0] == 1)
model.Add(built.road_vars[1] == 1)

solver = module.cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)
if status not in (module.cp_model.OPTIMAL, module.cp_model.FEASIBLE):
    raise RuntimeError("Failed to solve helper connectivity model.")

root_ids = [cell_id for cell_id, variable in built.root_vars.items() if solver.Value(variable) == 1]
roads = [built.allowed_cells[cell_id] for cell_id, variable in enumerate(built.road_vars) if solver.Value(variable) == 1]

print(json.dumps({
    "root_ids": root_ids,
    "roads": roads,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT connectivity helper constraints.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.root_ids, [0]);
  assert.deepEqual(payload.roads, [
    [0, 0],
    [0, 1],
  ]);
}

function maybeTestCpSatRoadEligibilityReductionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1],
  [1, 0],
  [1, 0],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)

print(json.dumps({
    "allowed_cells": built.allowed_cells,
    "road_eligible_cells": built.road_eligible_cells,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT road eligibility reduction helpers.");
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.allowed_cells, [
    [0, 0],
    [0, 1],
    [1, 0],
    [2, 0],
  ]);
  assert.deepEqual(payload.road_eligible_cells, [
    [0, 0],
    [0, 1],
  ]);
}

function maybeTestCpSatDisallowsBidirectionalRoadFlow() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

grid = [
  [1, 1],
]
params = {
    "availableBuildings": {"services": 0, "residentials": 0},
}

built = module.build_model(grid, params)
model = built.model
model.Add(built.road_vars[0] == 1)
model.Add(built.road_vars[1] == 1)
for source_id, target_id, flow_var in built.directed_edges:
    if (source_id, target_id) in ((0, 1), (1, 0)):
        model.Add(flow_var >= 1)

solver = module.cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)

print(json.dumps({
    "status": int(status),
    "infeasible": status == module.cp_model.INFEASIBLE,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT bidirectional flow constraints.");
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.infeasible, true);
}

testGreedyDispatcher();
maybeTestCpSatBackendJsonContractSmoke();
maybeTestCpSatObjectivePolicyHelpers();
maybeTestCpSatRuntimeOptionHelpers();
maybeTestCpSatWarmStartHelpers();
maybeTestCpSatPopulationUpperBoundHelpers();
maybeTestCpSatResidentialPopulationUpperBoundHelpers();
maybeTestCpSatOptimizer();
maybeTestCpSatWarmStartContinuation();
maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie();
maybeTestCpSatObjectiveAvoidsUselessServices();
maybeTestCpSatPrunesObjectivelyUselessServices();
maybeTestCpSatBorderAccessCapacityHelpers();
maybeTestCpSatGateRequirementHelpers();
maybeTestCpSatGateRegionalCapacityHelpers();
maybeTestCpSatSupportsShapedServices();
maybeTestCpSatCandidateReductionHelpers();
maybeTestCpSatReachabilityReductionHelpers();
maybeTestCpSatConnectivityHelperConstraints();
maybeTestCpSatRoadEligibilityReductionHelpers();
maybeTestCpSatDisallowsBidirectionalRoadFlow();
testSolutionValidator();
testSolutionMapValidatorRejectsRoadsNotConnectedToRow0();
testTopRowBuildingCountsAsRoadConnected();
testGreedySupportsShapedServices();

console.log("Optimizer backend tests passed.");
