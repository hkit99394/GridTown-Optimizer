from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from cp_sat_grid import orthogonal_neighbors


@dataclass(frozen=True)
class RoadNetworkVariables:
    road_vars: list[Any]
    root_vars: dict[int, Any]
    eligible_anchor_ids: list[int]
    total_roads: Any
    road_neighbor_ids: dict[int, list[int]]


@dataclass(frozen=True)
class GateAccessAnalysis:
    gate_downstream_cells: dict[int, set[int]]
    service_gate_requirements: dict[int, list[int]]
    residential_gate_requirements: dict[int, list[int]]
    service_candidate_indices_by_gate: dict[int, list[int]]
    residential_candidate_indices_by_gate: dict[int, list[int]]
    service_region_coefficients_by_gate: dict[int, dict[int, int]]
    residential_region_coefficients_by_gate: dict[int, dict[int, int]]


def touches_road_anchor_boundary(candidate):
    return int(candidate["r"]) == 0 or int(candidate["c"]) == 0


def undirected_adjacent_pairs(cell_ids_by_neighbor):
    seen = set()
    pairs = []
    for cell_id, neighbors in cell_ids_by_neighbor.items():
        for neighbor_id in neighbors:
            edge = tuple(sorted((cell_id, neighbor_id)))
            if edge in seen:
                continue
            seen.add(edge)
            pairs.append(edge)
    return pairs


def build_road_neighbor_ids(grid, id_to_cell, cell_to_id, road_eligible_ids):
    road_neighbor_ids = {}
    for cell_id, (r, c) in id_to_cell.items():
        road_neighbor_ids[cell_id] = [
            cell_to_id[(r2, c2)]
            for r2, c2 in orthogonal_neighbors(grid, r, c)
            if (r2, c2) in cell_to_id and cell_to_id[(r2, c2)] in road_eligible_ids
        ]
    return road_neighbor_ids


def compute_reachable_road_ids_without_gate(road_neighbor_ids, road_eligible_ids, eligible_anchor_ids, blocked_gate_id):
    start_ids = [cell_id for cell_id in eligible_anchor_ids if cell_id != blocked_gate_id]
    visited = set(start_ids)
    queue = list(start_ids)
    index = 0
    while index < len(queue):
        cell_id = queue[index]
        index += 1
        for neighbor_id in road_neighbor_ids.get(cell_id, []):
            if neighbor_id == blocked_gate_id or neighbor_id not in road_eligible_ids or neighbor_id in visited:
                continue
            visited.add(neighbor_id)
            queue.append(neighbor_id)
    return visited


def compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_anchor_ids):
    road_eligible_ids = set(road_eligible_ids)
    gate_downstream_cells = {}
    for gate_id in road_eligible_ids:
        reachable_without_gate = compute_reachable_road_ids_without_gate(
            road_neighbor_ids, road_eligible_ids, eligible_anchor_ids, gate_id
        )
        downstream = road_eligible_ids - reachable_without_gate - {gate_id}
        if downstream:
            gate_downstream_cells[gate_id] = downstream
    return gate_downstream_cells


def compute_candidate_gate_requirements(candidates, gate_downstream_cells, road_eligible_ids):
    road_eligible_ids = set(road_eligible_ids)
    gate_requirements = defaultdict(list)
    for candidate_index, candidate in enumerate(candidates):
        if touches_road_anchor_boundary(candidate):
            continue
        viable_border = {cell_id for cell_id in candidate["border"] if cell_id in road_eligible_ids}
        if not viable_border:
            continue
        for gate_id, downstream_cells in gate_downstream_cells.items():
            if all(cell_id == gate_id or cell_id in downstream_cells for cell_id in viable_border):
                gate_requirements[candidate_index].append(gate_id)
    return gate_requirements


def build_gate_regional_capacity_coefficients(candidates, gate_candidate_indices, gate_region_cells):
    gate_region_cells = set(gate_region_cells)
    coefficients = defaultdict(int)
    for candidate_index in gate_candidate_indices:
        for cell_id in candidates[candidate_index]["border"]:
            if cell_id in gate_region_cells:
                coefficients[cell_id] += 1
    return coefficients


def analyze_gate_access_constraints(road_eligible_ids, road_neighbor_ids, eligible_anchor_ids, service_candidates, residential_candidates):
    gate_downstream_cells = compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_anchor_ids)
    service_gate_requirements = compute_candidate_gate_requirements(service_candidates, gate_downstream_cells, road_eligible_ids)
    residential_gate_requirements = compute_candidate_gate_requirements(
        residential_candidates, gate_downstream_cells, road_eligible_ids
    )

    service_candidate_indices_by_gate = defaultdict(list)
    for candidate_index, gate_ids in service_gate_requirements.items():
        for gate_id in gate_ids:
            service_candidate_indices_by_gate[gate_id].append(candidate_index)

    residential_candidate_indices_by_gate = defaultdict(list)
    for candidate_index, gate_ids in residential_gate_requirements.items():
        for gate_id in gate_ids:
            residential_candidate_indices_by_gate[gate_id].append(candidate_index)

    service_region_coefficients_by_gate = {}
    residential_region_coefficients_by_gate = {}
    for gate_id, downstream_cells in gate_downstream_cells.items():
        gate_region_cells = set(downstream_cells)
        gate_region_cells.add(gate_id)

        gated_service_indices = service_candidate_indices_by_gate.get(gate_id, [])
        if gated_service_indices:
            service_region_coefficients_by_gate[gate_id] = dict(
                build_gate_regional_capacity_coefficients(service_candidates, gated_service_indices, gate_region_cells)
            )

        gated_residential_indices = residential_candidate_indices_by_gate.get(gate_id, [])
        if gated_residential_indices:
            residential_region_coefficients_by_gate[gate_id] = dict(
                build_gate_regional_capacity_coefficients(
                    residential_candidates, gated_residential_indices, gate_region_cells
                )
            )

    return GateAccessAnalysis(
        gate_downstream_cells=gate_downstream_cells,
        service_gate_requirements=service_gate_requirements,
        residential_gate_requirements=residential_gate_requirements,
        service_candidate_indices_by_gate=dict(service_candidate_indices_by_gate),
        residential_candidate_indices_by_gate=dict(residential_candidate_indices_by_gate),
        service_region_coefficients_by_gate=service_region_coefficients_by_gate,
        residential_region_coefficients_by_gate=residential_region_coefficients_by_gate,
    )


def add_candidate_border_access_constraints(model, road_vars, placement_vars, candidates):
    for candidate_index, variable in enumerate(placement_vars):
        candidate = candidates[candidate_index]
        if touches_road_anchor_boundary(candidate):
            continue
        model.Add(sum(road_vars[cell_id] for cell_id in candidate["border"]) >= variable)


def add_border_access_constraints(model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates):
    add_candidate_border_access_constraints(model, road_vars, service_vars, service_candidates)
    add_candidate_border_access_constraints(model, road_vars, residential_vars, residential_candidates)


def build_border_access_capacity_coefficients(cell_count, candidates):
    coefficients = [0] * cell_count
    non_anchor_candidate_indices = []
    for candidate_index, candidate in enumerate(candidates):
        if touches_road_anchor_boundary(candidate):
            continue
        non_anchor_candidate_indices.append(candidate_index)
        for cell_id in candidate["border"]:
            coefficients[cell_id] += 1
    return non_anchor_candidate_indices, coefficients


def iter_positive_capacity_terms(coefficients):
    items = coefficients.items() if isinstance(coefficients, dict) else enumerate(coefficients)
    for cell_id, coefficient in items:
        if coefficient > 0:
            yield cell_id, coefficient


def add_capacity_upper_bound_constraint(model, road_vars, lhs_terms, coefficients):
    model.Add(
        sum(lhs_terms)
        <= sum(coefficient * road_vars[cell_id] for cell_id, coefficient in iter_positive_capacity_terms(coefficients))
    )


def merge_sparse_capacity_coefficients(*coefficient_maps):
    combined_coefficients = defaultdict(int)
    for coefficient_map in coefficient_maps:
        for cell_id, coefficient in coefficient_map.items():
            combined_coefficients[cell_id] += coefficient
    return combined_coefficients


def add_aggregated_border_capacity_constraints(model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates):
    service_indices, service_coefficients = build_border_access_capacity_coefficients(len(road_vars), service_candidates)
    if service_indices:
        add_capacity_upper_bound_constraint(
            model,
            road_vars,
            [service_vars[candidate_index] for candidate_index in service_indices],
            service_coefficients,
        )

    residential_indices, residential_coefficients = build_border_access_capacity_coefficients(len(road_vars), residential_candidates)
    if residential_indices:
        add_capacity_upper_bound_constraint(
            model,
            road_vars,
            [residential_vars[candidate_index] for candidate_index in residential_indices],
            residential_coefficients,
        )

    combined_indices = [(service_vars, candidate_index) for candidate_index in service_indices] + [
        (residential_vars, candidate_index) for candidate_index in residential_indices
    ]
    if combined_indices:
        combined_coefficients = [
            service_coefficients[cell_id] + residential_coefficients[cell_id] for cell_id in range(len(road_vars))
        ]
        add_capacity_upper_bound_constraint(
            model,
            road_vars,
            [variable_list[candidate_index] for variable_list, candidate_index in combined_indices],
            combined_coefficients,
        )


def add_gate_presence_constraints(model, road_vars, placement_vars, gate_requirements):
    for candidate_index, gate_ids in gate_requirements.items():
        for gate_id in gate_ids:
            model.Add(placement_vars[candidate_index] <= road_vars[gate_id])


def add_gate_implied_access_constraints(
    model,
    road_vars,
    service_vars,
    residential_vars,
    gate_access_analysis: GateAccessAnalysis,
):
    add_gate_presence_constraints(model, road_vars, service_vars, gate_access_analysis.service_gate_requirements)
    add_gate_presence_constraints(model, road_vars, residential_vars, gate_access_analysis.residential_gate_requirements)

    for gate_id in gate_access_analysis.gate_downstream_cells:
        gated_service_indices = gate_access_analysis.service_candidate_indices_by_gate.get(gate_id, [])
        if gated_service_indices:
            service_coefficients = gate_access_analysis.service_region_coefficients_by_gate.get(gate_id, {})
            add_capacity_upper_bound_constraint(
                model,
                road_vars,
                [service_vars[candidate_index] for candidate_index in gated_service_indices],
                service_coefficients,
            )

        gated_residential_indices = gate_access_analysis.residential_candidate_indices_by_gate.get(gate_id, [])
        if gated_residential_indices:
            residential_coefficients = gate_access_analysis.residential_region_coefficients_by_gate.get(gate_id, {})
            add_capacity_upper_bound_constraint(
                model,
                road_vars,
                [residential_vars[candidate_index] for candidate_index in gated_residential_indices],
                residential_coefficients,
            )

        if gated_service_indices or gated_residential_indices:
            combined_coefficients = merge_sparse_capacity_coefficients(
                gate_access_analysis.service_region_coefficients_by_gate.get(gate_id, {}),
                gate_access_analysis.residential_region_coefficients_by_gate.get(gate_id, {}),
            )
            add_capacity_upper_bound_constraint(
                model,
                road_vars,
                [service_vars[candidate_index] for candidate_index in gated_service_indices]
                + [residential_vars[candidate_index] for candidate_index in gated_residential_indices],
                combined_coefficients,
            )


def add_road_support_constraints(model, road_vars, road_neighbor_ids, root_vars):
    for cell_id, variable in enumerate(road_vars):
        support_terms = [road_vars[neighbor_id] for neighbor_id in road_neighbor_ids[cell_id]]
        if cell_id in root_vars:
            support_terms.append(root_vars[cell_id])
        model.Add(variable <= sum(support_terms))


def build_directed_flow_network(model, grid, id_to_cell, cell_to_id, road_eligible_ids, road_vars):
    directed_edges = []
    directed_edge_vars = {}
    incoming = defaultdict(list)
    outgoing = defaultdict(list)
    cell_count = len(road_vars)

    for cell_id, (r, c) in id_to_cell.items():
        if cell_id not in road_eligible_ids:
            continue
        for neighbor in orthogonal_neighbors(grid, r, c):
            if neighbor not in cell_to_id:
                continue
            neighbor_id = cell_to_id[neighbor]
            if neighbor_id not in road_eligible_ids:
                continue
            flow_var = model.NewIntVar(0, cell_count, f"flow_{cell_id}_{neighbor_id}")
            model.Add(flow_var <= cell_count * road_vars[cell_id])
            model.Add(flow_var <= cell_count * road_vars[neighbor_id])
            directed_edges.append((cell_id, neighbor_id, flow_var))
            directed_edge_vars[(cell_id, neighbor_id)] = flow_var
            outgoing[cell_id].append(flow_var)
            incoming[neighbor_id].append(flow_var)

    return directed_edges, directed_edge_vars, incoming, outgoing


def add_opposing_flow_constraints(model, road_neighbor_ids, road_eligible_ids, directed_edge_vars, total_roads):
    for cell_id, neighbor_id in undirected_adjacent_pairs(road_neighbor_ids):
        if cell_id not in road_eligible_ids or neighbor_id not in road_eligible_ids:
            continue
        forward = directed_edge_vars[(cell_id, neighbor_id)]
        backward = directed_edge_vars[(neighbor_id, cell_id)]
        model.Add(forward + backward <= total_roads - 1)


def create_root_supply_variables(model, eligible_anchor_ids, root_vars, cell_count, total_roads):
    root_supply = {}
    for cell_id in eligible_anchor_ids:
        supply_var = model.NewIntVar(0, cell_count, f"root_supply_{cell_id}")
        model.Add(supply_var <= cell_count * root_vars[cell_id])
        root_supply[cell_id] = supply_var
    model.Add(sum(root_supply.values()) == total_roads)
    return root_supply


def add_flow_balance_constraints(model, road_vars, incoming, outgoing, root_vars, root_supply, total_roads):
    for cell_id, road_var in enumerate(road_vars):
        base_inflow = sum(incoming[cell_id])
        if cell_id in root_vars:
            model.Add(base_inflow == 0).OnlyEnforceIf(root_vars[cell_id])
        inflow = base_inflow + root_supply[cell_id] if cell_id in root_supply else base_inflow
        model.Add(inflow <= total_roads)
        model.Add(inflow == sum(outgoing[cell_id]) + road_var)
        if cell_id not in root_supply:
            model.Add(inflow >= road_var)


def add_flow_connectivity_constraints(
    model,
    grid,
    id_to_cell,
    cell_to_id,
    road_eligible_ids,
    road_vars,
    road_neighbor_ids,
    root_vars,
    eligible_anchor_ids,
    total_roads,
):
    cell_count = len(road_vars)
    directed_edges, directed_edge_vars, incoming, outgoing = build_directed_flow_network(
        model,
        grid,
        id_to_cell,
        cell_to_id,
        road_eligible_ids,
        road_vars,
    )
    add_opposing_flow_constraints(model, road_neighbor_ids, road_eligible_ids, directed_edge_vars, total_roads)
    root_supply = create_root_supply_variables(model, eligible_anchor_ids, root_vars, cell_count, total_roads)
    add_flow_balance_constraints(model, road_vars, incoming, outgoing, root_vars, root_supply, total_roads)
    return directed_edges


def build_selected_road_adjacency(directed_edges, selected_road_ids):
    neighbors_by_road_id = defaultdict(list)
    for source_id, target_id, _flow_var in directed_edges:
        if source_id in selected_road_ids and target_id in selected_road_ids:
            neighbors_by_road_id[source_id].append(target_id)
    return neighbors_by_road_id


def connected_components_from_adjacency(selected_ids, neighbors_by_id):
    remaining = set(selected_ids)
    while remaining:
        start_id = next(iter(remaining))
        stack = [start_id]
        component_ids = []
        remaining.remove(start_id)

        while stack:
            cell_id = stack.pop()
            component_ids.append(cell_id)
            for neighbor_id in neighbors_by_id[cell_id]:
                if neighbor_id not in remaining:
                    continue
                remaining.remove(neighbor_id)
                stack.append(neighbor_id)

        yield component_ids


def hinted_root_ids_from_selected_roads(built, selected_road_ids):
    selected_road_ids = set(selected_road_ids)
    if not selected_road_ids:
        return set()

    neighbors_by_road_id = build_selected_road_adjacency(built.directed_edges, selected_road_ids)
    root_ids = set()
    for component_ids in connected_components_from_adjacency(selected_road_ids, neighbors_by_road_id):
        component_root_id = next((cell_id for cell_id in built.anchor_ids if cell_id in component_ids), None)
        if component_root_id is not None:
            root_ids.add(component_root_id)

    return root_ids


def create_road_network_variables(
    model,
    grid,
    allowed_cells,
    anchor_ids,
    road_eligible_ids,
    id_to_cell,
    cell_to_id,
):
    cell_count = len(allowed_cells)
    road_vars = [model.NewBoolVar(f"road_{idx}") for idx in range(cell_count)]
    for cell_id in range(cell_count):
        if cell_id not in road_eligible_ids:
            model.Add(road_vars[cell_id] == 0)

    root_vars = {idx: model.NewBoolVar(f"root_{idx}") for idx in anchor_ids if idx in road_eligible_ids}
    for idx, root_var in root_vars.items():
        model.Add(root_var <= road_vars[idx])

    eligible_anchor_ids = [cell_id for cell_id in anchor_ids if cell_id in road_eligible_ids]
    model.Add(sum(root_vars.values()) >= 1)

    total_roads = model.NewIntVar(1, cell_count, "total_roads")
    model.Add(total_roads == sum(road_vars))
    road_neighbor_ids = build_road_neighbor_ids(grid, id_to_cell, cell_to_id, road_eligible_ids)
    return RoadNetworkVariables(
        road_vars=road_vars,
        root_vars=root_vars,
        eligible_anchor_ids=eligible_anchor_ids,
        total_roads=total_roads,
        road_neighbor_ids=road_neighbor_ids,
    )
