const {
  assert,
  childProcess,
  fs,
  os,
  path,
  solve,
  solveAsync,
  solveCpSat,
  solveCpSatAsync,
  materializeCpSatSolution,
  parseCpSatRawSolution,
  validateSolution,
  resolveCpSatPython
} = require("./optimizerHarnessDeps.cjs");

async function maybeTestCpSatOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 }
  };

  const solution = await solveAsync(grid, params);
  const direct = await solveCpSatAsync(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(typeof solution.cpSatObjectivePolicy?.populationWeight, "number");
  assert.equal(solution.cpSatObjectivePolicy?.summary, "maximize population, then minimize roads + services");
  assert.equal(typeof solution.cpSatTelemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof solution.cpSatTelemetry?.bestObjectiveBound, "number");
  assert.equal(typeof solution.cpSatTelemetry?.solutionCount, "number");
  assert.equal(solution.totalPopulation, 110);
  assert.deepEqual(
    [...solution.residentialTypeIndices].sort((a, b) => a - b),
    [0, 1]
  );
  assert.equal(direct.totalPopulation, 110);
}

async function maybeTestCpSatUsesColumnZeroRoadAnchor() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [0, 0, 0],
    [1, 1, 1],
    [1, 1, 1]
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
  const validation = validateSolution({ grid, solution, params });

  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(validation.valid, true);
  assert.equal(
    [...solution.roads].some((key) => key.endsWith(",0")),
    true
  );
  assert.equal(
    [...solution.roads].some((key) => key.startsWith("0,")),
    false
  );
}

async function maybeTestCpSatAllowsMultiAnchorComponentsInOptimization() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [0, 1, 0, 0, 0, 1, 0],
    [0, 1, 1, 0, 0, 1, 1],
    [0, 1, 1, 0, 0, 1, 1]
  ];
  const baseParams = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 2 }],
    availableBuildings: { residentials: 2, services: 0 }
  };

  const aligned = await solveCpSatAsync(grid, baseParams);
  const validation = validateSolution({ grid, solution: aligned, params: baseParams });

  assert.match(aligned.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(validation.valid, true);
  assert.equal(aligned.totalPopulation, 200);
  assert.deepEqual([...aligned.roads].sort(), ["0,1", "0,5"]);
}

async function maybeTestCpSatNoOverlap2dEncodingProducesValidSolution() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
      useNoOverlap2d: true
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 }
  };

  const solution = await solveCpSatAsync(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.totalPopulation, 110);
  assert.equal(validation.valid, true);
}

function maybeTestCpSatSyncCompatibility() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
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

  const dispatched = solve(grid, params);
  const direct = solveCpSat(grid, params);

  assert.match(dispatched.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(dispatched.totalPopulation, 10);
  assert.equal(direct.totalPopulation, 10);
}

function testCpSatRejectsSemanticallyInvalidRawSolution() {
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
  };
  const raw = parseCpSatRawSolution(
    JSON.stringify({
      roads: ["0,1"],
      services: [],
      residentials: [{ r: 1, c: 1, rows: 2, cols: 2, typeIndex: 0, population: 999 }],
      populations: [999],
      totalPopulation: 999,
      status: "FEASIBLE"
    })
  );

  assert.throws(
    () => materializeCpSatSolution(grid, params, raw),
    /CP-SAT backend produced an invalid solution payload: Residential 0 reports population 999, expected 10\. Solution reports total population 999, expected 10\./
  );
}

function testCpSatNormalizesUnderReportedRawPopulation() {
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 }
  };
  const raw = parseCpSatRawSolution(
    JSON.stringify({
      roads: ["0,1"],
      services: [],
      residentials: [{ r: 1, c: 1, rows: 2, cols: 2, typeIndex: 0, population: 1 }],
      populations: [1],
      totalPopulation: 1,
      status: "FEASIBLE"
    })
  );

  const solution = materializeCpSatSolution(grid, params, raw);

  assert.deepEqual(solution.populations, [10]);
  assert.equal(solution.totalPopulation, 10);
  assert.equal(validateSolution({ grid, solution, params }).valid, true);
}

async function maybeTestCpSatSupportsShapedServices() {
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
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
    residentialSettings: {
      "2x2": { min: 100, max: 200 },
      "2x3": { min: 140, max: 260 }
    },
    availableBuildings: { services: 1, residentials: 2 }
  };

  const solution = await solveAsync(grid, params);
  const direct = await solveCpSatAsync(grid, params);

  assert.equal(solution.optimizer, "cp-sat");
  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.match(direct.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.services.length, 1);
  assert.equal(direct.services.length, 1);
  assert.deepEqual([...solution.serviceTypeIndices], [0]);
  assert.deepEqual([...solution.servicePopulationIncreases], [50]);
  assert.deepEqual([...direct.serviceTypeIndices], [0]);
  assert.deepEqual([...direct.servicePopulationIncreases], [50]);
  assert.deepEqual(
    [solution.services[0].rows, solution.services[0].cols].sort((a, b) => a - b),
    [2, 3]
  );
  assert.equal(solution.services[0].range, 1);

  const validation = validateSolution({ grid, solution, params });
  assert.equal(validation.valid, true);
}

function maybeTestCpSatBackendJsonContractSmoke() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 15, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 40, max: 55, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    cpSat: { timeLimitSeconds: 5, numWorkers: 1 }
  };

  const result = childProcess.spawnSync(pythonExecutable, [scriptPath], {
    input: JSON.stringify({ grid, params }),
    encoding: "utf8"
  });

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
  assert.equal(
    payload.totalPopulation,
    payload.populations.reduce((sum, value) => sum + value, 0)
  );
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
  assert.equal(typeof payload.telemetry?.modelSize?.variableCount, "number");
  assert.equal(typeof payload.telemetry?.modelSize?.booleanVariableCount, "number");
  assert.equal(typeof payload.telemetry?.modelSize?.constraintCount, "number");
  assert.equal(typeof payload.telemetry?.modelSize?.roadVariableCount, "number");
  assert.equal(typeof payload.telemetry?.modelSize?.serviceCandidateCount, "number");
  assert.equal(typeof payload.telemetry?.modelSize?.residentialCandidateCount, "number");
}

function maybeTestCpSatBackendStreamingProtocol() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    cpSat: { timeLimitSeconds: 5, numWorkers: 1, streamProgress: true, progressIntervalSeconds: 0 }
  };

  const result = childProcess.spawnSync(pythonExecutable, [scriptPath], {
    input: JSON.stringify({ grid, params }),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to run CP-SAT backend streaming protocol test."
    );
  }

  const lines = result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert(lines.length >= 2);
  assert(lines.some((entry) => entry.event === "progress"));
  const finalEntry = lines.at(-1);
  assert.equal(finalEntry.event, "result");
  assert.equal(typeof finalEntry.payload.totalPopulation, "number");
}

function maybeTestCpSatObjectivePolicyHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
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
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT objective policy helpers."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.max_tie_break_penalty, payload.cell_count + payload.service_candidate_count);
  assert.equal(payload.population_weight, payload.max_tie_break_penalty + 1);
}

function maybeTestCpSatNoOverlap2dModelEncodingHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
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
base_params = {
    "residentialTypes": [{"w": 1, "h": 1, "min": 10, "max": 10, "avail": 2}],
    "availableBuildings": {"services": 0, "residentials": 2},
}
candidate_params = {
    **base_params,
    "cpSat": {"useNoOverlap2d": True},
}

baseline = module.build_model(grid, base_params).model.Proto()
candidate = module.build_model(grid, candidate_params).model.Proto()

def count_constraints(proto, field_name):
    predicate_name = f"has_{field_name}"
    return sum(1 for constraint in proto.constraints if getattr(constraint, predicate_name)())

print(json.dumps({
    "baseline_no_overlap_2d": count_constraints(baseline, "no_overlap_2d"),
    "candidate_no_overlap_2d": count_constraints(candidate, "no_overlap_2d"),
    "candidate_interval_count": count_constraints(candidate, "interval"),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT NoOverlap2D model encoding."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.baseline_no_overlap_2d, 0);
  assert.equal(payload.candidate_no_overlap_2d, 1);
  assert(payload.candidate_interval_count > 0);
}

function maybeTestCpSatRuntimeOptionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
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
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT runtime option helpers."
    );
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

  const noLimitCommand = `
import importlib.util
import json
import math

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

baseline_solver = module.cp_model.CpSolver()
solver = module.cp_model.CpSolver()
module.configure_solver_parameters(solver, {
    "numWorkers": 1,
})

print(json.dumps({
    "baseline_is_infinite": math.isinf(baseline_solver.parameters.max_time_in_seconds),
    "configured_is_infinite": math.isinf(solver.parameters.max_time_in_seconds),
    "baseline_max_time_in_seconds": None if math.isinf(baseline_solver.parameters.max_time_in_seconds) else baseline_solver.parameters.max_time_in_seconds,
    "configured_max_time_in_seconds": None if math.isinf(solver.parameters.max_time_in_seconds) else solver.parameters.max_time_in_seconds,
}))
`;

  const noLimitResult = childProcess.spawnSync(pythonExecutable, ["-c", noLimitCommand], {
    encoding: "utf8"
  });
  if (noLimitResult.status !== 0) {
    throw new Error(
      noLimitResult.stderr?.trim() ||
        noLimitResult.stdout?.trim() ||
        "Failed to inspect CP-SAT default time limit behavior."
    );
  }

  const noLimitPayload = JSON.parse(noLimitResult.stdout);
  assert.equal(noLimitPayload.configured_is_infinite, noLimitPayload.baseline_is_infinite);
  assert.equal(noLimitPayload.configured_max_time_in_seconds, noLimitPayload.baseline_max_time_in_seconds);
}

function maybeTestCpSatWarmStartHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
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
    encoding: "utf8"
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

function maybeTestCpSatSnapshotResponseHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_runtime_support.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_runtime_support", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Policy:
    population_weight = 17
    max_tie_break_penalty = 16
    tie_break_summary = "maximize population, then minimize roads + services"

class Built:
    objective_policy = Policy()

telemetry = module.CpSatTelemetry(
    solve_wall_time_seconds=1.25,
    user_time_seconds=1.2,
    solution_count=3,
    incumbent_objective_value=42.0,
    best_objective_bound=45.0,
    objective_gap=3.0,
    incumbent_population=40,
    best_population_upper_bound=43,
    population_gap_upper_bound=3,
    last_improvement_at_seconds=0.8,
    seconds_since_last_improvement=0.45,
    num_branches=12,
    num_conflicts=1,
    model_size=module.CpSatModelSizeTelemetry(
        variable_count=30,
        boolean_variable_count=24,
        constraint_count=50,
        allowed_cell_count=16,
        road_eligible_cell_count=16,
        road_variable_count=16,
        root_variable_count=7,
        directed_edge_count=24,
        service_candidate_count=1,
        residential_candidate_count=4,
        population_variable_count=4,
    ),
)

response = module.build_snapshot_response(
    {
        "roads": ["0,0"],
        "services": [],
        "residentials": [],
        "populations": [],
        "totalPopulation": 40,
    },
    Built(),
    "FEASIBLE",
    telemetry,
    stopped_by_user=True,
)

print(json.dumps(response))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT snapshot response helpers."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.stoppedByUser, true);
  assert.equal(payload.totalPopulation, 40);
  assert.equal(payload.objectivePolicy.populationWeight, 17);
  assert.equal(payload.telemetry.incumbentPopulation, 40);
  assert.equal(payload.telemetry.modelSize.variableCount, 30);
}

function maybeTestCpSatNoImprovementTimeoutHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImmediateTimer:
    started = 0

    def __init__(self, interval, function):
        self.interval = interval
        self.function = function
        self.daemon = False

    def start(self):
        ImmediateTimer.started += 1
        self.function()

    def cancel(self):
        pass

module.threading.Timer = ImmediateTimer

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

result = module.solve_single_cp_sat(grid, params, {
    "timeLimitSeconds": 5,
    "numWorkers": 1,
    "noImprovementTimeoutSeconds": 1,
})

print(json.dumps({
    "timer_started": ImmediateTimer.started,
    "feasible": result.feasible,
    "status": result.status,
    "stopped_by_user": None if result.response is None else result.response.get("stoppedByUser"),
    "total_population": result.total_population,
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT no-improvement timeout helpers."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert(payload.timer_started >= 1);
  assert.equal(payload.feasible, true);
  assert.equal(payload.stopped_by_user, false);
  assert.equal(typeof payload.total_population, "number");
}

function maybeTestCpSatSnapshotWritesTelemetry() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const snapshotFilePath = path.join(os.tmpdir(), `city-builder-test-cp-sat-snapshot-${process.pid}.json`);
  fs.rmSync(snapshotFilePath, { force: true });
  const command = `
import importlib.util
import json
import os

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
    "residentialTypes": [
        {"w": 2, "h": 2, "min": 10, "max": 10, "avail": 1},
        {"w": 2, "h": 2, "min": 100, "max": 100, "avail": 1},
    ],
    "availableBuildings": {"residentials": 2, "services": 0},
}

result = module.solve_single_cp_sat(grid, params, {
    "timeLimitSeconds": 5,
    "numWorkers": 1,
    "snapshotFilePath": ${JSON.stringify(snapshotFilePath)},
})

snapshot = None
if os.path.exists(${JSON.stringify(snapshotFilePath)}):
    with open(${JSON.stringify(snapshotFilePath)}, "r", encoding="utf-8") as handle:
        snapshot = json.load(handle)

print(json.dumps({
    "status": result.status,
    "snapshot_exists": snapshot is not None,
    "snapshot_has_telemetry": snapshot is not None and snapshot.get("telemetry") is not None,
    "snapshot_incumbent_population": None if snapshot is None else snapshot.get("telemetry", {}).get("incumbentPopulation"),
    "snapshot_solution_count": None if snapshot is None else snapshot.get("telemetry", {}).get("solutionCount"),
}))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8"
  });
  fs.rmSync(snapshotFilePath, { force: true });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT snapshot telemetry output."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.match(payload.status ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(payload.snapshot_exists, true);
  assert.equal(payload.snapshot_has_telemetry, true);
  assert.equal(typeof payload.snapshot_incumbent_population, "number");
  assert.equal(typeof payload.snapshot_solution_count, "number");
}

module.exports = {
  maybeTestCpSatOptimizer,
  maybeTestCpSatUsesColumnZeroRoadAnchor,
  maybeTestCpSatAllowsMultiAnchorComponentsInOptimization,
  maybeTestCpSatNoOverlap2dEncodingProducesValidSolution,
  maybeTestCpSatSyncCompatibility,
  testCpSatRejectsSemanticallyInvalidRawSolution,
  testCpSatNormalizesUnderReportedRawPopulation,
  maybeTestCpSatSupportsShapedServices,
  maybeTestCpSatBackendJsonContractSmoke,
  maybeTestCpSatBackendStreamingProtocol,
  maybeTestCpSatObjectivePolicyHelpers,
  maybeTestCpSatNoOverlap2dModelEncodingHelpers,
  maybeTestCpSatRuntimeOptionHelpers,
  maybeTestCpSatWarmStartHelpers,
  maybeTestCpSatSnapshotResponseHelpers,
  maybeTestCpSatNoImprovementTimeoutHelpers,
  maybeTestCpSatSnapshotWritesTelemetry
};
