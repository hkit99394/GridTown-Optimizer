#!/usr/bin/env python3

import sys
from collections import defaultdict
from pathlib import Path

try:
    from ortools.sat.python import cp_model
except ImportError as exc:
    print(
        "OR-Tools is not installed. Run scripts/setup-cp-sat.sh or install python/requirements-cp-sat.txt first.",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from cp_sat_model_types import BuiltCpSatModel, CpSatCandidateBundle, CpSatCellIndex, ObjectivePolicy
from cp_sat_candidates import (
    CandidatePlacementMaps,
    annotate_residential_population_upper_bounds,
    build_candidate_placement_maps,
    compute_total_population_upper_bound,
    enumerate_residential_candidates,
    enumerate_service_candidates,
    infer_max_services,
    prune_objectively_useless_service_candidates,
    collect_protected_road_cells,
    typed_service_bonus_upper_bound,
)
from cp_sat_grid import (
    index_reachable_allowed_cells,
    reachable_allowed_from_road_anchors,
    trim_road_eligible_cells,
)
from cp_sat_no_overlap import add_no_overlap_2d_occupancy_constraints, use_no_overlap_2d_encoding
from cp_sat_road_model import (
    add_aggregated_border_capacity_constraints,
    add_border_access_constraints,
    add_flow_connectivity_constraints,
    add_gate_implied_access_constraints,
    add_road_support_constraints,
    analyze_gate_access_constraints,
    create_road_network_variables,
)


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def add_per_type_availability_constraints(model, placement_vars, candidates, type_settings):
    by_type = defaultdict(list)
    for candidate_index, candidate in enumerate(candidates):
        by_type[candidate["typeIndex"]].append(candidate_index)
    for type_index, type_setting in enumerate(type_settings):
        avail = int(type_setting.get("avail", 0))
        if type_index in by_type:
            model.Add(sum(placement_vars[candidate_index] for candidate_index in by_type[type_index]) <= avail)


def add_occupancy_constraints(model, cell_count, road_vars, service_vars, service_candidates, residential_vars, residential_candidates):
    occupancy_terms = defaultdict(list)
    for candidate_index, variable in enumerate(service_vars):
        for cell_id in service_candidates[candidate_index]["cells"]:
            occupancy_terms[cell_id].append(variable)
    for candidate_index, variable in enumerate(residential_vars):
        for cell_id in residential_candidates[candidate_index]["cells"]:
            occupancy_terms[cell_id].append(variable)
    for cell_id in range(cell_count):
        model.Add(sum(occupancy_terms[cell_id]) + road_vars[cell_id] <= 1)


def build_objective_policy(cell_count: int, service_candidate_count: int) -> ObjectivePolicy:
    max_tie_break_penalty = cell_count + service_candidate_count
    return ObjectivePolicy(
        population_weight=max_tie_break_penalty + 1,
        max_tie_break_penalty=max_tie_break_penalty,
        tie_break_summary="maximize population, then minimize roads + services",
    )


def population_from_objective_value(objective_value: float | int | None, objective_policy: ObjectivePolicy) -> int | None:
    if objective_value is None:
        return None
    return int((int(objective_value) + objective_policy.max_tie_break_penalty) // objective_policy.population_weight)


def build_residential_population_boost_expression(service_vars, service_candidates, service_cover_sets, candidate_cells):
    boost_terms = []
    for service_index, cover_zone in enumerate(service_cover_sets):
        bonus = int(service_candidates[service_index]["bonus"] or 0)
        if bonus == 0 or not (candidate_cells & cover_zone):
            continue
        boost_terms.append(bonus * service_vars[service_index])
    return sum(boost_terms) if boost_terms else 0


def create_residential_population_variables(
    model,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
):
    service_cover_sets = [candidate["effect_zone"] for candidate in service_candidates]
    populations = []
    for candidate_index, candidate in enumerate(residential_candidates):
        population_upper_bound = int(candidate.get("populationUpperBound", candidate["max"]))
        pop_var = model.NewIntVar(0, population_upper_bound, f"population_{candidate_index}")
        boost_expr = build_residential_population_boost_expression(
            service_vars,
            service_candidates,
            service_cover_sets,
            set(candidate["cells"]),
        )
        model.Add(pop_var <= population_upper_bound * residential_vars[candidate_index])
        model.Add(pop_var <= candidate["base"] * residential_vars[candidate_index] + boost_expr)
        populations.append(pop_var)
    return populations


def create_summed_model_variable(model, upper_bound, name, terms):
    total_var = model.NewIntVar(0, upper_bound, name)
    model.Add(total_var == sum(terms))
    return total_var


def add_population_objective(model, cell_count, service_candidate_count, total_population, total_roads, total_services):
    objective_policy = build_objective_policy(cell_count, service_candidate_count)
    model.Maximize(total_population * objective_policy.population_weight - total_roads - total_services)
    return objective_policy


def add_population_model_and_objective(
    model,
    cell_count,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
    total_roads,
    total_population_upper_bound,
):
    populations = create_residential_population_variables(
        model,
        service_vars,
        service_candidates,
        residential_vars,
        residential_candidates,
    )
    total_population = create_summed_model_variable(
        model,
        total_population_upper_bound,
        "total_population",
        populations,
    )
    total_services = create_summed_model_variable(model, len(service_candidates), "total_services", service_vars)
    objective_policy = add_population_objective(
        model,
        cell_count,
        len(service_candidates),
        total_population,
        total_roads,
        total_services,
    )
    return populations, total_population, total_services, objective_policy


def reject_removed_road_connectivity_mode(params):
    cp_sat_options = params.get("cpSat") or {}
    if "roadConnectivityMode" in cp_sat_options:
        fail(
            "CP-SAT roadConnectivityMode is no longer supported; CP-SAT always uses anchor-components road connectivity."
        )


def create_building_selection_variables(model, params, service_candidates, residential_candidates):
    service_vars = [model.NewBoolVar(f"service_{candidate_index}") for candidate_index in range(len(service_candidates))]
    max_services = infer_max_services(params)
    if max_services is not None:
        model.Add(sum(service_vars) <= max_services)
    add_per_type_availability_constraints(model, service_vars, service_candidates, params.get("serviceTypes") or [])

    residential_vars = [model.NewBoolVar(f"residential_{index}") for index in range(len(residential_candidates))]
    available = params.get("availableBuildings") or {}
    max_residentials = available.get("residentials", params.get("maxResidentials"))
    if max_residentials is not None:
        model.Add(sum(residential_vars) <= int(max_residentials))
    residential_types = params.get("residentialTypes") or []
    if residential_types:
        add_per_type_availability_constraints(model, residential_vars, residential_candidates, residential_types)

    return service_vars, residential_vars


def build_cp_sat_cell_index(grid, params, placement_maps: CandidatePlacementMaps) -> CpSatCellIndex:
    reachable_allowed = reachable_allowed_from_road_anchors(grid)
    if not reachable_allowed:
        fail("No feasible solution found: no allowed road cell exists in row 0 or column 0.")
    protected_road_cells = collect_protected_road_cells(grid, params, reachable_allowed, placement_maps)
    road_eligible_cells = trim_road_eligible_cells(grid, reachable_allowed, protected_road_cells)

    allowed_cells, cell_to_id, id_to_cell = index_reachable_allowed_cells(grid, reachable_allowed)
    anchor_ids = [idx for idx, (r, c) in enumerate(allowed_cells) if r == 0 or c == 0]
    road_eligible_ids = {cell_to_id[cell] for cell in road_eligible_cells if cell in cell_to_id}

    return CpSatCellIndex(
        reachable_allowed=reachable_allowed,
        road_eligible_cells=road_eligible_cells,
        allowed_cells=allowed_cells,
        cell_to_id=cell_to_id,
        id_to_cell=id_to_cell,
        anchor_ids=anchor_ids,
        road_eligible_ids=road_eligible_ids,
    )


def build_cp_sat_candidate_bundle(grid, params, cell_to_id, placement_maps: CandidatePlacementMaps) -> CpSatCandidateBundle:
    service_candidates = enumerate_service_candidates(grid, params, cell_to_id, placement_maps.service)
    total_bonus_upper_bound = typed_service_bonus_upper_bound(params)
    residential_candidates = enumerate_residential_candidates(grid, params, cell_to_id, total_bonus_upper_bound, placement_maps)
    service_candidates = prune_objectively_useless_service_candidates(service_candidates, residential_candidates)
    residential_candidates = annotate_residential_population_upper_bounds(params, service_candidates, residential_candidates)
    total_population_upper_bound = compute_total_population_upper_bound(params, residential_candidates)

    return CpSatCandidateBundle(
        placement_maps=placement_maps,
        service_candidates=service_candidates,
        residential_candidates=residential_candidates,
        total_population_upper_bound=total_population_upper_bound,
    )


def add_cp_sat_layout_constraints(
    model,
    params,
    cell_count,
    road_network,
    id_to_cell,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
    gate_access_analysis,
):
    if use_no_overlap_2d_encoding(params):
        add_no_overlap_2d_occupancy_constraints(
            model,
            id_to_cell,
            road_network.road_vars,
            service_vars,
            service_candidates,
            residential_vars,
            residential_candidates,
        )
    else:
        add_occupancy_constraints(
            model,
            cell_count,
            road_network.road_vars,
            service_vars,
            service_candidates,
            residential_vars,
            residential_candidates,
        )
    add_border_access_constraints(
        model,
        road_network.road_vars,
        service_vars,
        service_candidates,
        residential_vars,
        residential_candidates,
    )
    add_aggregated_border_capacity_constraints(
        model,
        road_network.road_vars,
        service_vars,
        service_candidates,
        residential_vars,
        residential_candidates,
    )
    add_gate_implied_access_constraints(
        model,
        road_network.road_vars,
        service_vars,
        residential_vars,
        gate_access_analysis,
    )
    add_road_support_constraints(
        model,
        road_network.road_vars,
        road_network.road_neighbor_ids,
        road_network.root_vars,
    )


def build_model(grid, params) -> BuiltCpSatModel:
    if not grid or not grid[0]:
        fail("Grid must be non-empty.")

    reject_removed_road_connectivity_mode(params)
    placement_maps = build_candidate_placement_maps(grid, params)
    cell_index = build_cp_sat_cell_index(grid, params, placement_maps)
    candidates = build_cp_sat_candidate_bundle(grid, params, cell_index.cell_to_id, placement_maps)

    model = cp_model.CpModel()
    cell_count = len(cell_index.allowed_cells)
    road_network = create_road_network_variables(
        model,
        grid,
        cell_index.allowed_cells,
        cell_index.anchor_ids,
        cell_index.road_eligible_ids,
        cell_index.id_to_cell,
        cell_index.cell_to_id,
    )
    gate_access_analysis = analyze_gate_access_constraints(
        cell_index.road_eligible_ids,
        road_network.road_neighbor_ids,
        road_network.eligible_anchor_ids,
        candidates.service_candidates,
        candidates.residential_candidates,
    )

    service_vars, residential_vars = create_building_selection_variables(
        model,
        params,
        candidates.service_candidates,
        candidates.residential_candidates,
    )

    add_cp_sat_layout_constraints(
        model,
        params,
        cell_count,
        road_network,
        cell_index.id_to_cell,
        service_vars,
        candidates.service_candidates,
        residential_vars,
        candidates.residential_candidates,
        gate_access_analysis,
    )
    directed_edges = add_flow_connectivity_constraints(
        model,
        grid,
        cell_index.id_to_cell,
        cell_index.cell_to_id,
        cell_index.road_eligible_ids,
        road_network.road_vars,
        road_network.road_neighbor_ids,
        road_network.root_vars,
        road_network.eligible_anchor_ids,
        road_network.total_roads,
    )
    populations, total_population, total_services, objective_policy = add_population_model_and_objective(
        model,
        cell_count,
        service_vars,
        candidates.service_candidates,
        residential_vars,
        candidates.residential_candidates,
        road_network.total_roads,
        candidates.total_population_upper_bound,
    )

    return BuiltCpSatModel(
        model=model,
        allowed_cells=cell_index.allowed_cells,
        anchor_ids=cell_index.anchor_ids,
        road_vars=road_network.road_vars,
        root_vars=road_network.root_vars,
        service_vars=service_vars,
        service_candidates=candidates.service_candidates,
        residential_vars=residential_vars,
        residential_candidates=candidates.residential_candidates,
        populations=populations,
        total_roads=road_network.total_roads,
        total_services=total_services,
        total_population=total_population,
        total_population_upper_bound=candidates.total_population_upper_bound,
        objective_policy=objective_policy,
        id_to_cell=cell_index.id_to_cell,
        road_eligible_cells=sorted(cell_index.road_eligible_cells),
        directed_edges=directed_edges,
    )
