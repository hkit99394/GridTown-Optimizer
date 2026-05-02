const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

function inspectCpSatPython(resolveCpSatPython, commandBody, failureMessage) {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return null;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

${commandBody}
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || failureMessage);
  }

  return JSON.parse(result.stdout);
}

function createCpSatPythonHelperAssertions(resolveCpSatPython) {
  return {
    maybeTestCpSatPopulationUpperBoundHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT population upper bound helpers."
      );
      if (!payload) return;

      assert.equal(payload.total_population_upper_bound, 20);
      assert(payload.residential_candidate_count > 2);
    },

    maybeTestCpSatResidentialPopulationUpperBoundHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT residential population upper bounds."
      );
      if (!payload) return;

      assert.equal(payload.population_upper_bound, 40);
      assert.equal(payload.total_population_upper_bound, 40);
    },

    maybeTestCpSatPrunesObjectivelyUselessServices() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT useless service pruning."
      );
      if (!payload) return;

      assert.equal(payload.service_candidate_count, 0);
    },

    maybeTestCpSatBorderAccessCapacityHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
candidates = [
    {"r": 0, "c": 1, "border": [0, 1]},
    {"r": 1, "c": 1, "border": [1, 2]},
    {"r": 2, "c": 1, "border": [2, 3]},
]
indices, coefficients = module.build_border_access_capacity_coefficients(5, candidates)

print(json.dumps({
    "indices": indices,
    "coefficients": coefficients,
}))
`,
        "Failed to inspect CP-SAT border access capacity helpers."
      );
      if (!payload) return;

      assert.deepEqual(payload.indices, [1, 2]);
      assert.deepEqual(payload.coefficients, [0, 1, 2, 1, 0]);
    },

    maybeTestCpSatGateRequirementHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
road_neighbor_ids = {
    0: [1],
    1: [0, 2, 3],
    2: [1],
    3: [1, 4],
    4: [3],
}
road_eligible_ids = {0, 1, 2, 3, 4}
eligible_anchor_ids = [0, 2]

gate_downstream = module.compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_anchor_ids)
candidates = [
    {"r": 2, "c": 2, "border": [4]},
    {"r": 2, "c": 2, "border": [2, 0]},
    {"r": 0, "c": 3, "border": [4]},
    {"r": 2, "c": 0, "border": [4]},
]
gate_requirements = module.compute_candidate_gate_requirements(candidates, gate_downstream, road_eligible_ids)

print(json.dumps({
    "gate_downstream": {str(key): sorted(value) for key, value in gate_downstream.items()},
    "gate_requirements": {str(key): value for key, value in gate_requirements.items()},
}))
`,
        "Failed to inspect CP-SAT gate requirement helpers."
      );
      if (!payload) return;

      assert.deepEqual(payload.gate_downstream, {
        1: [3, 4],
        3: [4],
      });
      assert.deepEqual(payload.gate_requirements, {
        0: [1, 3],
      });
    },

    maybeTestCpSatGateRegionalCapacityHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
candidates = [
    {"border": [0, 1, 4]},
    {"border": [1, 2, 4]},
    {"border": [2, 3]},
]
coefficients = module.build_gate_regional_capacity_coefficients(candidates, [0, 1], {1, 2, 4})

print(json.dumps({
    "coefficients": {str(key): value for key, value in coefficients.items()},
}))
`,
        "Failed to inspect CP-SAT gate regional capacity helpers."
      );
      if (!payload) return;

      assert.deepEqual(payload.coefficients, {
        1: 2,
        2: 1,
        4: 2,
      });
    },

    maybeTestCpSatCandidateReductionHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT candidate reduction helpers."
      );
      if (!payload) return;

      assert.equal(payload.strong_count, 9);
      assert.equal(payload.weak_room_count, 18);
    },

    maybeTestCpSatReachabilityReductionHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT reachability reduction helpers."
      );
      if (!payload) return;

      assert.deepEqual(payload.allowed_cells, [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [3, 0],
        [3, 1],
        [4, 0],
        [4, 1],
      ]);
      assert.deepEqual(payload.service_candidates, []);
      assert.deepEqual(payload.residential_candidates, [
        { r: 0, c: 0, rows: 2, cols: 2 },
        { r: 3, c: 0, rows: 2, cols: 2 },
      ]);
    },

    maybeTestCpSatConnectivityHelperConstraints() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT connectivity helper constraints."
      );
      if (!payload) return;

      assert(payload.root_ids.length >= 1);
      assert(payload.root_ids.every((cellId) => [0, 1].includes(cellId)));
      assert.deepEqual(payload.roads, [
        [0, 0],
        [0, 1],
      ]);
    },

    maybeTestCpSatAllowsMultipleAnchoredRoadComponents() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
def solve_forced_roads(grid, forced_cells):
    built = module.build_model(grid, {
        "availableBuildings": {"services": 0, "residentials": 0},
    })
    forced_cells = {tuple(cell) for cell in forced_cells}
    for cell_id, variable in enumerate(built.road_vars):
        built.model.Add(variable == (1 if built.allowed_cells[cell_id] in forced_cells else 0))

    solver = module.cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    status = solver.Solve(built.model)
    feasible = status in (module.cp_model.OPTIMAL, module.cp_model.FEASIBLE)
    return {
        "status": solver.StatusName(status),
        "feasible": feasible,
        "roads": [
            built.allowed_cells[cell_id]
            for cell_id, variable in enumerate(built.road_vars)
            if feasible and solver.Value(variable) == 1
        ],
        "root_cells": [
            built.allowed_cells[cell_id]
            for cell_id, variable in built.root_vars.items()
            if feasible and solver.Value(variable) == 1
        ],
    }

def inspect_multi_component_hinting():
    grid = [
        [1, 0, 1],
        [1, 0, 1],
    ]
    params = {
        "availableBuildings": {"services": 0, "residentials": 0},
    }
    built = module.build_model(grid, params)
    selected_road_ids = {
        cell_id
        for cell_id, cell in enumerate(built.allowed_cells)
        if cell in {(0, 0), (0, 2)}
    }
    hinted_root_cells = [
        built.allowed_cells[cell_id]
        for cell_id in sorted(module.hinted_root_ids_from_selected_roads(built, selected_road_ids))
    ]

    module.apply_warm_start_hints(built.model, built, {
        "roads": ["0,0", "0,2"],
    })
    hint_proto = built.model.Proto().solution_hint
    vars_to_values = dict(zip(hint_proto.vars, hint_proto.values))
    selected_root_hints = [
        built.allowed_cells[cell_id]
        for cell_id, variable in built.root_vars.items()
        if vars_to_values.get(variable.Index()) == 1
    ]

    fixed_built = module.build_model(grid, params)
    module.apply_local_neighborhood_fixing(fixed_built.model, fixed_built, {
        "roads": ["0,0", "0,2"],
        "fixOutsideNeighborhoodToHintedValue": True,
        "neighborhoodWindow": {"top": 1, "left": 0, "rows": 1, "cols": 1},
    })
    solver = module.cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    status = solver.Solve(fixed_built.model)

    return {
        "hinted_root_cells": hinted_root_cells,
        "selected_root_hints": selected_root_hints,
        "fixed_neighborhood_feasible": status in (module.cp_model.OPTIMAL, module.cp_model.FEASIBLE),
    }

anchored_components = solve_forced_roads(
    [
        [1, 0, 1],
        [1, 0, 1],
    ],
    [(0, 0), (0, 2)],
)
unanchored_component = solve_forced_roads(
    [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
    ],
    [(0, 0), (2, 1), (2, 2)],
)

print(json.dumps({
    "anchored_components": anchored_components,
    "unanchored_component": unanchored_component,
    "multi_component_hinting": inspect_multi_component_hinting(),
}))
`,
        "Failed to inspect CP-SAT multi-anchor road component constraints."
      );
      if (!payload) return;

      assert.equal(payload.anchored_components.feasible, true);
      assert.deepEqual(payload.anchored_components.roads, [
        [0, 0],
        [0, 2],
      ]);
      assert.deepEqual(payload.anchored_components.root_cells, [
        [0, 0],
        [0, 2],
      ]);
      assert.equal(payload.unanchored_component.feasible, false);
      assert.deepEqual(payload.multi_component_hinting.hinted_root_cells, [
        [0, 0],
        [0, 2],
      ]);
      assert.deepEqual(payload.multi_component_hinting.selected_root_hints, [
        [0, 0],
        [0, 2],
      ]);
      assert.equal(payload.multi_component_hinting.fixed_neighborhood_feasible, true);
    },

    maybeTestCpSatRoadEligibilityReductionHelpers() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT road eligibility reduction helpers."
      );
      if (!payload) return;

      assert.deepEqual(payload.allowed_cells, [
        [0, 0],
        [0, 1],
        [1, 0],
        [2, 0],
      ]);
      assert.deepEqual(payload.road_eligible_cells, [
        [0, 0],
        [0, 1],
        [1, 0],
        [2, 0],
      ]);
    },

    maybeTestCpSatDisallowsBidirectionalRoadFlow() {
      const payload = inspectCpSatPython(
        resolveCpSatPython,
        `
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
`,
        "Failed to inspect CP-SAT bidirectional flow constraints."
      );
      if (!payload) return;

      assert.equal(payload.infeasible, true);
    },
  };
}

module.exports = {
  createCpSatPythonHelperAssertions,
};
