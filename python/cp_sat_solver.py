#!/usr/bin/env python3

import json
import os
import signal
import sys
import threading
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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

from cp_sat_runtime_support import (
    CpSatPortfolioWorkerResult,
    CpSatPortfolioWorkerSummary,
    CpSatSolveResult,
    CpSatTelemetry,
    CpSatTelemetryCollector,
    build_snapshot_response,
    build_solution_response,
    collect_cp_sat_telemetry,
    portfolio_worker_summary_payload,
    progress_payload,
    result_payload,
    solver_status_name,
)
from cp_sat_portfolio_support import (
    build_portfolio_worker_options,
    run_portfolio_workers,
    select_best_portfolio_result,
)


NO_RESIDENTIAL_TYPE = -1


@dataclass(frozen=True)
class CandidatePlacementMaps:
    service: dict[str, list[dict[str, int]]]
    residential: dict[str, list[dict[str, int]]]
    fallback_residential: dict[str, list[dict[str, int]]]


@dataclass(frozen=True)
class BuiltCpSatModel:
    model: Any
    allowed_cells: list[tuple[int, int]]
    row0_ids: list[int]
    road_vars: list[Any]
    root_vars: dict[int, Any]
    service_vars: list[Any]
    service_candidates: list[dict[str, Any]]
    residential_vars: list[Any]
    residential_candidates: list[dict[str, Any]]
    populations: list[Any]
    total_roads: Any
    total_services: Any
    total_population: Any
    total_population_upper_bound: int
    objective_policy: ObjectivePolicy
    id_to_cell: dict[int, tuple[int, int]]
    road_eligible_cells: list[tuple[int, int]]
    directed_edges: list[tuple[int, int, Any]]


@dataclass(frozen=True)
class ObjectivePolicy:
    population_weight: int
    max_tie_break_penalty: int
    tie_break_summary: str


@dataclass(frozen=True)
class GateAccessAnalysis:
    gate_downstream_cells: dict[int, set[int]]
    service_gate_requirements: dict[int, list[int]]
    residential_gate_requirements: dict[int, list[int]]
    service_candidate_indices_by_gate: dict[int, list[int]]
    residential_candidate_indices_by_gate: dict[int, list[int]]
    service_region_coefficients_by_gate: dict[int, dict[int, int]]
    residential_region_coefficients_by_gate: dict[int, dict[int, int]]


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def collect_solution(value_reader, built):
    roads = []
    for cell_id, road_var in enumerate(built.road_vars):
        if value_reader(road_var) != 1:
            continue
        r, c = built.id_to_cell[cell_id]
        roads.append(f"{r},{c}")

    services = []
    for candidate_index, variable in enumerate(built.service_vars):
        if value_reader(variable) != 1:
            continue
        candidate = built.service_candidates[candidate_index]
        services.append(
            {
                "r": candidate["r"],
                "c": candidate["c"],
                "rows": candidate["rows"],
                "cols": candidate["cols"],
                "range": candidate["range"],
                "bonus": candidate["bonus"],
                "typeIndex": candidate["typeIndex"],
            }
        )

    residentials = []
    populations = []
    for candidate_index, variable in enumerate(built.residential_vars):
        if value_reader(variable) != 1:
            continue
        candidate = built.residential_candidates[candidate_index]
        population = value_reader(built.populations[candidate_index])
        residentials.append(
            {
                "r": candidate["r"],
                "c": candidate["c"],
                "rows": candidate["rows"],
                "cols": candidate["cols"],
                "typeIndex": candidate["typeIndex"],
                "population": population,
            }
        )
        populations.append(population)

    return {
        "roads": roads,
        "services": services,
        "residentials": residentials,
        "populations": populations,
        "totalPopulation": sum(populations),
    }


def write_snapshot(snapshot_file_path: str, response) -> None:
    temp_path = f"{snapshot_file_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(response, handle)
    os.replace(temp_path, snapshot_file_path)


def is_allowed(grid, r: int, c: int) -> bool:
    return 0 <= r < len(grid) and 0 <= c < len(grid[0]) and grid[r][c] == 1


def orthogonal_neighbors(grid, r: int, c: int):
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        r2 = r + dr
        c2 = c + dc
        if 0 <= r2 < len(grid) and 0 <= c2 < len(grid[0]):
            yield (r2, c2)


def reachable_allowed_from_row0(grid):
    row0_cells = [(0, c) for c in range(len(grid[0])) if is_allowed(grid, 0, c)]
    if not row0_cells:
        return set()

    visited = set(row0_cells)
    queue = list(row0_cells)
    index = 0
    while index < len(queue):
        r, c = queue[index]
        index += 1
        for r2, c2 in orthogonal_neighbors(grid, r, c):
            if not is_allowed(grid, r2, c2):
                continue
            if (r2, c2) in visited:
                continue
            visited.add((r2, c2))
            queue.append((r2, c2))
    return visited


def rectangle_cells(r: int, c: int, rows: int, cols: int):
    return [(r + dr, c + dc) for dr in range(rows) for dc in range(cols)]


def build_blocked_prefix_sum(grid):
    h = len(grid)
    w = len(grid[0])
    prefix = [[0] * (w + 1) for _ in range(h + 1)]
    for r in range(h):
        row_blocked = 0
        for c in range(w):
            if grid[r][c] != 1:
                row_blocked += 1
            prefix[r + 1][c + 1] = prefix[r][c + 1] + row_blocked
    return prefix


def rectangle_blocked_count(prefix, r: int, c: int, rows: int, cols: int):
    r2 = r + rows
    c2 = c + cols
    return prefix[r2][c2] - prefix[r][c2] - prefix[r2][c] + prefix[r][c]


def enumerate_valid_placements(grid, blocked_prefix_sum, dimensions):
    h = len(grid)
    w = len(grid[0])
    placement_map = {}
    seen = set()
    for rows, cols in dimensions:
        key = f"{rows}x{cols}"
        if key in seen:
            continue
        seen.add(key)
        placements = []
        if rows <= h and cols <= w:
            for r in range(h - rows + 1):
                for c in range(w - cols + 1):
                    if rectangle_blocked_count(blocked_prefix_sum, r, c, rows, cols) != 0:
                        continue
                    placements.append({"r": r, "c": c, "rows": rows, "cols": cols})
        placement_map[key] = placements
    return placement_map


def rectangle_border_cells(grid, r: int, c: int, rows: int, cols: int):
    cells = set()
    for r0, c0 in rectangle_cells(r, c, rows, cols):
        for r1, c1 in orthogonal_neighbors(grid, r0, c0):
            if not (r <= r1 < r + rows and c <= c1 < c + cols):
                cells.add((r1, c1))
    return sorted(cells)


def service_effect_zone(grid, r: int, c: int, rows: int, cols: int, effect_range: int):
    h = len(grid)
    w = len(grid[0])
    r_min = max(0, r - effect_range)
    r_max = min(h - 1, r + rows - 1 + effect_range)
    c_min = max(0, c - effect_range)
    c_max = min(w - 1, c + cols - 1 + effect_range)
    zone = []
    for rr in range(r_min, r_max + 1):
        for cc in range(c_min, c_max + 1):
            in_footprint = r <= rr < r + rows and c <= cc < c + cols
            if in_footprint:
                continue
            if is_allowed(grid, rr, cc):
                zone.append((rr, cc))
    return zone


def infer_max_services(params, service_candidate_count: int | None = None):
    available = params.get("availableBuildings") or {}
    max_services = available.get("services", params.get("maxServices"))
    if max_services is not None:
        return int(max_services)
    return service_candidate_count


def infer_service_slot_cap(params, service_types):
    total_available = sum(max(0, int(service_type.get("avail", 0))) for service_type in service_types)
    max_services = infer_max_services(params)
    if max_services is None:
        return total_available
    return min(int(max_services), total_available)


def touches_road_anchor_row(candidate):
    return int(candidate["r"]) == 0


def service_type_orientations(service_type):
    rows = int(service_type["rows"])
    cols = int(service_type["cols"])
    orientations = [(rows, cols)]
    if bool(service_type.get("allowRotation", True)) and rows != cols:
        orientations.append((cols, rows))
    return orientations


def residential_type_orientations(residential_type):
    return sorted(
        {
            (int(residential_type["h"]), int(residential_type["w"])),
            (int(residential_type["w"]), int(residential_type["h"])),
        }
    )


def build_candidate_placement_maps(grid, params) -> CandidatePlacementMaps:
    blocked_prefix_sum = build_blocked_prefix_sum(grid)
    service_types = params.get("serviceTypes") or []
    service_placement_map = enumerate_valid_placements(
        grid,
        blocked_prefix_sum,
        [dimension for service_type in service_types for dimension in service_type_orientations(service_type)],
    )

    residential_types = params.get("residentialTypes")
    residential_placement_map = {}
    fallback_residential_placement_map = {}
    if residential_types:
        residential_placement_map = enumerate_valid_placements(
            grid,
            blocked_prefix_sum,
            [dimension for residential_type in residential_types for dimension in residential_type_orientations(residential_type)],
        )
    else:
        fallback_residential_placement_map = enumerate_valid_placements(grid, blocked_prefix_sum, [(2, 2), (2, 3)])

    return CandidatePlacementMaps(
        service=service_placement_map,
        residential=residential_placement_map,
        fallback_residential=fallback_residential_placement_map,
    )
def collect_protected_road_cells(grid, params, reachable_allowed, placement_maps: CandidatePlacementMaps):
    protected = {(0, c) for c in range(len(grid[0])) if (0, c) in reachable_allowed}
    service_types = params.get("serviceTypes") or []
    for service_type in service_types:
        if int(service_type.get("avail", 0)) <= 0:
            continue
        for rows, cols in service_type_orientations(service_type):
            for placement in placement_maps.service.get(f"{rows}x{cols}", []):
                if touches_road_anchor_row(placement):
                    continue
                for cell in rectangle_border_cells(grid, placement["r"], placement["c"], rows, cols):
                    if cell in reachable_allowed:
                        protected.add(cell)

    residential_types = params.get("residentialTypes")
    if residential_types:
        for residential_type in residential_types:
            if int(residential_type.get("avail", 0)) <= 0:
                continue
            for rows, cols in residential_type_orientations(residential_type):
                for placement in placement_maps.residential.get(f"{rows}x{cols}", []):
                    if touches_road_anchor_row(placement):
                        continue
                    for cell in rectangle_border_cells(grid, placement["r"], placement["c"], rows, cols):
                        if cell in reachable_allowed:
                            protected.add(cell)
    else:
        for rows, cols in ((2, 2), (2, 3)):
            for placement in placement_maps.fallback_residential.get(f"{rows}x{cols}", []):
                if touches_road_anchor_row(placement):
                    continue
                for cell in rectangle_border_cells(grid, placement["r"], placement["c"], rows, cols):
                    if cell in reachable_allowed:
                        protected.add(cell)

    return protected


def trim_road_eligible_cells(grid, reachable_allowed, protected_cells):
    neighbors = {
        cell: [neighbor for neighbor in orthogonal_neighbors(grid, cell[0], cell[1]) if neighbor in reachable_allowed]
        for cell in reachable_allowed
    }
    degrees = {cell: len(adjacent) for cell, adjacent in neighbors.items()}
    removed = set()
    queue = [cell for cell in reachable_allowed if cell not in protected_cells and degrees[cell] <= 1]
    index = 0

    while index < len(queue):
        cell = queue[index]
        index += 1
        if cell in removed or cell in protected_cells:
            continue
        if degrees[cell] > 1:
            continue
        removed.add(cell)
        for neighbor in neighbors[cell]:
            if neighbor in removed:
                continue
            degrees[neighbor] -= 1
            if neighbor not in protected_cells and degrees[neighbor] <= 1:
                queue.append(neighbor)

    return reachable_allowed - removed


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


def index_reachable_allowed_cells(grid, reachable_allowed):
    allowed_cells = []
    cell_to_id = {}
    id_to_cell = {}
    for r in range(len(grid)):
        for c in range(len(grid[0])):
            if (r, c) not in reachable_allowed:
                continue
            idx = len(allowed_cells)
            allowed_cells.append((r, c))
            cell_to_id[(r, c)] = idx
            id_to_cell[idx] = (r, c)
    return allowed_cells, cell_to_id, id_to_cell


def build_road_neighbor_ids(grid, id_to_cell, cell_to_id, road_eligible_ids):
    road_neighbor_ids = {}
    for cell_id, (r, c) in id_to_cell.items():
        road_neighbor_ids[cell_id] = [
            cell_to_id[(r2, c2)]
            for r2, c2 in orthogonal_neighbors(grid, r, c)
            if (r2, c2) in cell_to_id and cell_to_id[(r2, c2)] in road_eligible_ids
        ]
    return road_neighbor_ids


def compute_reachable_road_ids_without_gate(road_neighbor_ids, road_eligible_ids, eligible_row0_ids, blocked_gate_id):
    start_ids = [cell_id for cell_id in eligible_row0_ids if cell_id != blocked_gate_id]
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


def compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_row0_ids):
    road_eligible_ids = set(road_eligible_ids)
    gate_downstream_cells = {}
    for gate_id in road_eligible_ids:
        reachable_without_gate = compute_reachable_road_ids_without_gate(
            road_neighbor_ids, road_eligible_ids, eligible_row0_ids, gate_id
        )
        downstream = road_eligible_ids - reachable_without_gate - {gate_id}
        if downstream:
            gate_downstream_cells[gate_id] = downstream
    return gate_downstream_cells


def compute_candidate_gate_requirements(candidates, gate_downstream_cells, road_eligible_ids):
    road_eligible_ids = set(road_eligible_ids)
    gate_requirements = defaultdict(list)
    for candidate_index, candidate in enumerate(candidates):
        if touches_road_anchor_row(candidate):
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


def analyze_gate_access_constraints(road_eligible_ids, road_neighbor_ids, eligible_row0_ids, service_candidates, residential_candidates):
    gate_downstream_cells = compute_gate_downstream_cells(road_neighbor_ids, road_eligible_ids, eligible_row0_ids)
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


def add_border_access_constraints(model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates):
    for candidate_index, variable in enumerate(service_vars):
        border = service_candidates[candidate_index]["border"]
        if touches_road_anchor_row(service_candidates[candidate_index]):
            continue
        model.Add(sum(road_vars[cell_id] for cell_id in border) >= variable)
    for candidate_index, variable in enumerate(residential_vars):
        border = residential_candidates[candidate_index]["border"]
        if touches_road_anchor_row(residential_candidates[candidate_index]):
            continue
        model.Add(sum(road_vars[cell_id] for cell_id in border) >= variable)


def build_border_access_capacity_coefficients(cell_count, candidates):
    coefficients = [0] * cell_count
    non_anchor_candidate_indices = []
    for candidate_index, candidate in enumerate(candidates):
        if touches_road_anchor_row(candidate):
            continue
        non_anchor_candidate_indices.append(candidate_index)
        for cell_id in candidate["border"]:
            coefficients[cell_id] += 1
    return non_anchor_candidate_indices, coefficients


def add_aggregated_border_capacity_constraints(model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates):
    service_indices, service_coefficients = build_border_access_capacity_coefficients(len(road_vars), service_candidates)
    if service_indices:
        model.Add(
            sum(service_vars[candidate_index] for candidate_index in service_indices)
            <= sum(coefficient * road_vars[cell_id] for cell_id, coefficient in enumerate(service_coefficients) if coefficient > 0)
        )

    residential_indices, residential_coefficients = build_border_access_capacity_coefficients(len(road_vars), residential_candidates)
    if residential_indices:
        model.Add(
            sum(residential_vars[candidate_index] for candidate_index in residential_indices)
            <= sum(coefficient * road_vars[cell_id] for cell_id, coefficient in enumerate(residential_coefficients) if coefficient > 0)
        )

    combined_indices = [(service_vars, candidate_index) for candidate_index in service_indices] + [
        (residential_vars, candidate_index) for candidate_index in residential_indices
    ]
    if combined_indices:
        combined_coefficients = [
            service_coefficients[cell_id] + residential_coefficients[cell_id] for cell_id in range(len(road_vars))
        ]
        model.Add(
            sum(variable_list[candidate_index] for variable_list, candidate_index in combined_indices)
            <= sum(coefficient * road_vars[cell_id] for cell_id, coefficient in enumerate(combined_coefficients) if coefficient > 0)
        )


def add_gate_implied_access_constraints(
    model,
    road_vars,
    service_vars,
    residential_vars,
    gate_access_analysis: GateAccessAnalysis,
):
    for candidate_index, gate_ids in gate_access_analysis.service_gate_requirements.items():
        for gate_id in gate_ids:
            model.Add(service_vars[candidate_index] <= road_vars[gate_id])

    for candidate_index, gate_ids in gate_access_analysis.residential_gate_requirements.items():
        for gate_id in gate_ids:
            model.Add(residential_vars[candidate_index] <= road_vars[gate_id])

    for gate_id in gate_access_analysis.gate_downstream_cells:
        gated_service_indices = gate_access_analysis.service_candidate_indices_by_gate.get(gate_id, [])
        if gated_service_indices:
            service_coefficients = gate_access_analysis.service_region_coefficients_by_gate.get(gate_id, {})
            model.Add(
                sum(service_vars[candidate_index] for candidate_index in gated_service_indices)
                <= sum(
                    coefficient * road_vars[cell_id]
                    for cell_id, coefficient in service_coefficients.items()
                )
            )

        gated_residential_indices = gate_access_analysis.residential_candidate_indices_by_gate.get(gate_id, [])
        if gated_residential_indices:
            residential_coefficients = gate_access_analysis.residential_region_coefficients_by_gate.get(gate_id, {})
            model.Add(
                sum(residential_vars[candidate_index] for candidate_index in gated_residential_indices)
                <= sum(
                    coefficient * road_vars[cell_id]
                    for cell_id, coefficient in residential_coefficients.items()
                )
            )

        if gated_service_indices or gated_residential_indices:
            combined_coefficients = defaultdict(int)
            for cell_id, coefficient in gate_access_analysis.service_region_coefficients_by_gate.get(gate_id, {}).items():
                combined_coefficients[cell_id] += coefficient
            for cell_id, coefficient in gate_access_analysis.residential_region_coefficients_by_gate.get(
                gate_id, {}
            ).items():
                combined_coefficients[cell_id] += coefficient

            model.Add(
                sum(service_vars[candidate_index] for candidate_index in gated_service_indices)
                + sum(residential_vars[candidate_index] for candidate_index in gated_residential_indices)
                <= sum(
                    coefficient * road_vars[cell_id]
                    for cell_id, coefficient in combined_coefficients.items()
                )
            )


def add_road_support_constraints(model, road_vars, road_neighbor_ids, root_vars):
    for cell_id, variable in enumerate(road_vars):
        support_terms = [road_vars[neighbor_id] for neighbor_id in road_neighbor_ids[cell_id]]
        if cell_id in root_vars:
            support_terms.append(root_vars[cell_id])
        model.Add(variable <= sum(support_terms))


def add_flow_connectivity_constraints(
    model,
    grid,
    id_to_cell,
    cell_to_id,
    road_eligible_ids,
    road_vars,
    road_neighbor_ids,
    root_vars,
    eligible_row0_ids,
    total_roads,
):
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

    for cell_id, neighbor_id in undirected_adjacent_pairs(road_neighbor_ids):
        if cell_id not in road_eligible_ids or neighbor_id not in road_eligible_ids:
            continue
        forward = directed_edge_vars[(cell_id, neighbor_id)]
        backward = directed_edge_vars[(neighbor_id, cell_id)]
        model.Add(forward + backward <= total_roads - 1)

    root_supply = {}
    for cell_id in eligible_row0_ids:
        supply_var = model.NewIntVar(0, cell_count, f"root_supply_{cell_id}")
        model.Add(supply_var <= cell_count * root_vars[cell_id])
        root_supply[cell_id] = supply_var
    model.Add(sum(root_supply.values()) == total_roads)

    for cell_id in range(cell_count):
        inflow = sum(incoming[cell_id])
        if cell_id in root_vars:
            model.Add(sum(incoming[cell_id]) == 0).OnlyEnforceIf(root_vars[cell_id])
        if cell_id in root_supply:
            inflow += root_supply[cell_id]
        model.Add(inflow <= total_roads)
        model.Add(inflow == sum(outgoing[cell_id]) + road_vars[cell_id])
        if cell_id not in root_supply:
            model.Add(inflow >= road_vars[cell_id])

    return directed_edges


def prune_objectively_useless_service_candidates(service_candidates, residential_candidates):
    if not service_candidates:
        return service_candidates

    residential_cell_ids = {
        cell_id
        for candidate in residential_candidates
        for cell_id in candidate["cells"]
    }

    pruned = []
    for candidate in service_candidates:
        if candidate["bonus"] <= 0:
            continue
        if not residential_cell_ids or not (candidate["effect_zone"] & residential_cell_ids):
            continue
        pruned.append(candidate)
    return pruned


def compute_total_population_upper_bound(params, residential_candidates):
    if not residential_candidates:
        return 0

    available = params.get("availableBuildings") or {}
    max_residentials = available.get("residentials", params.get("maxResidentials"))
    residential_types = params.get("residentialTypes") or []

    if residential_types:
        candidate_maxima = []
        candidates_by_type = defaultdict(list)
        for candidate in residential_candidates:
            candidates_by_type[candidate["typeIndex"]].append(int(candidate.get("populationUpperBound", candidate["max"])))

        for type_index, residential_type in enumerate(residential_types):
            maxima = sorted(candidates_by_type.get(type_index, []), reverse=True)
            if not maxima:
                continue
            type_avail = max(0, int(residential_type.get("avail", 0)))
            candidate_maxima.extend(maxima[:type_avail])
    else:
        candidate_maxima = sorted(
            (int(candidate.get("populationUpperBound", candidate["max"])) for candidate in residential_candidates),
            reverse=True,
        )

    candidate_maxima.sort(reverse=True)
    if max_residentials is not None:
        candidate_maxima = candidate_maxima[: int(max_residentials)]
    return sum(candidate_maxima)


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


def annotate_residential_population_upper_bounds(params, service_candidates, residential_candidates):
    if not residential_candidates:
        return residential_candidates

    service_types = params.get("serviceTypes") or []
    if not service_types or not service_candidates:
        for candidate in residential_candidates:
            candidate["populationUpperBound"] = min(int(candidate["max"]), int(candidate["base"]))
        return residential_candidates

    service_slot_cap = infer_service_slot_cap(params, service_types)
    for candidate in residential_candidates:
        candidate_cells = set(candidate["cells"])
        bonuses = []
        covering_counts_by_type = defaultdict(int)
        for service_candidate in service_candidates:
            if not (candidate_cells & service_candidate["effect_zone"]):
                continue
            covering_counts_by_type[service_candidate["typeIndex"]] += 1

        for type_index, service_type in enumerate(service_types):
            cover_count = covering_counts_by_type.get(type_index, 0)
            if cover_count <= 0:
                continue
            bonus = int(service_type.get("bonus", 0))
            if bonus <= 0:
                continue
            type_avail = max(0, int(service_type.get("avail", 0)))
            bonuses.extend([bonus] * min(cover_count, type_avail))

        bonuses.sort(reverse=True)
        if service_slot_cap is not None:
            bonuses = bonuses[:service_slot_cap]

        candidate["populationUpperBound"] = min(int(candidate["max"]), int(candidate["base"]) + sum(bonuses))

    return residential_candidates


def add_population_model_and_objective(
    model,
    cell_count,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
    road_vars,
    total_roads,
    total_population_upper_bound,
):
    service_cover_sets = [candidate["effect_zone"] for candidate in service_candidates]
    populations = []
    for candidate_index, candidate in enumerate(residential_candidates):
        population_upper_bound = int(candidate.get("populationUpperBound", candidate["max"]))
        pop_var = model.NewIntVar(0, population_upper_bound, f"population_{candidate_index}")
        boost_terms = []
        candidate_cells = set(candidate["cells"])
        for service_index, cover_zone in enumerate(service_cover_sets):
            bonus = int(service_candidates[service_index]["bonus"] or 0)
            if bonus == 0 or not (candidate_cells & cover_zone):
                continue
            boost_terms.append(bonus * service_vars[service_index])
        boost_expr = sum(boost_terms) if boost_terms else 0
        model.Add(pop_var <= population_upper_bound * residential_vars[candidate_index])
        model.Add(pop_var <= candidate["base"] * residential_vars[candidate_index] + boost_expr)
        populations.append(pop_var)

    total_population = model.NewIntVar(0, total_population_upper_bound, "total_population")
    model.Add(total_population == sum(populations))

    total_services = model.NewIntVar(0, len(service_candidates), "total_services")
    model.Add(total_services == sum(service_vars))

    objective_policy = build_objective_policy(cell_count, len(service_candidates))
    model.Maximize(total_population * objective_policy.population_weight - total_roads - total_services)
    return populations, total_population, total_services, objective_policy


def prune_dominated_service_candidates(candidates, params):
    if not candidates:
        return candidates

    service_types = params.get("serviceTypes") or []
    if not service_types:
        return candidates

    service_slot_cap = infer_service_slot_cap(params, service_types)
    if service_slot_cap <= 0:
        return []

    always_available_types = {
        type_index
        for type_index, service_type in enumerate(service_types)
        if max(0, int(service_type.get("avail", 0))) >= service_slot_cap
    }
    if not always_available_types:
        return candidates

    candidates_by_signature = defaultdict(list)
    for candidate in candidates:
        signature = (candidate["r"], candidate["c"], candidate["rows"], candidate["cols"])
        candidates_by_signature[signature].append(candidate)

    pruned = []
    for group in candidates_by_signature.values():
        for candidate in group:
            dominated = False
            for other in group:
                if other is candidate:
                    continue
                if other["typeIndex"] not in always_available_types:
                    continue
                if other["bonus"] < candidate["bonus"]:
                    continue
                if not other["effect_zone"].issuperset(candidate["effect_zone"]):
                    continue
                if (
                    other["bonus"] > candidate["bonus"]
                    or other["effect_zone"] != candidate["effect_zone"]
                    or other["typeIndex"] < candidate["typeIndex"]
                ):
                    dominated = True
                    break
            if not dominated:
                pruned.append(candidate)

    return pruned


def service_type_priority(service_type):
    rows = int(service_type["rows"])
    cols = int(service_type["cols"])
    effect_range = int(service_type["range"])
    footprint_area = max(1, rows * cols)
    effect_area = (rows + 2 * effect_range) * (cols + 2 * effect_range)
    bonus = int(service_type["bonus"])
    return (bonus * effect_area) / footprint_area


def residential_type_priority(residential_type):
    area = max(1, int(residential_type["w"]) * int(residential_type["h"]))
    return int(residential_type["max"]) / area + int(residential_type["min"]) / area / 10


def enumerate_service_candidates(grid, params, cell_to_id, placement_map):
    candidates = []
    service_types = params.get("serviceTypes") or []
    type_order = sorted(
        range(len(service_types)),
        key=lambda index: (
            -service_type_priority(service_types[index]),
            -int(service_types[index]["bonus"]),
            -int(service_types[index]["range"]),
            int(service_types[index]["rows"]) * int(service_types[index]["cols"]),
            -int(service_types[index].get("avail", 0)),
            index,
        ),
    )
    for type_index in type_order:
        service_type = service_types[type_index]
        avail = int(service_type["avail"])
        if avail <= 0:
            continue
        effect_range = int(service_type["range"])
        bonus = int(service_type["bonus"])
        for rows, cols in service_type_orientations(service_type):
            for placement in placement_map.get(f"{rows}x{cols}", []):
                r = placement["r"]
                c = placement["c"]
                cells = rectangle_cells(r, c, rows, cols)
                if not all(cell in cell_to_id for cell in cells):
                    continue
                border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
                if not border and not touches_road_anchor_row(placement):
                    continue
                candidates.append(
                    {
                        "r": r,
                        "c": c,
                        "rows": rows,
                        "cols": cols,
                        "range": effect_range,
                        "typeIndex": type_index,
                        "bonus": bonus,
                        "cells": [cell_to_id[cell] for cell in cells],
                        "border": sorted(set(border)),
                        "effect_zone": {cell_to_id[cell] for cell in service_effect_zone(grid, r, c, rows, cols, effect_range) if cell in cell_to_id},
                    }
                )
    return prune_dominated_service_candidates(candidates, params)


def enumerate_residential_candidates(grid, params, cell_to_id, total_bonus_upper_bound: int, placement_maps: CandidatePlacementMaps):
    candidates = []
    residential_types = params.get("residentialTypes")
    if residential_types:
        placement_map = placement_maps.residential
        for type_index, residential_type in enumerate(residential_types):
            avail = int(residential_type.get("avail", 0))
            if avail <= 0:
                continue
            for rows, cols in residential_type_orientations(residential_type):
                for placement in placement_map.get(f"{rows}x{cols}", []):
                    r = placement["r"]
                    c = placement["c"]
                    cells = rectangle_cells(r, c, rows, cols)
                    if not all(cell in cell_to_id for cell in cells):
                        continue
                    border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
                    if not border and not touches_road_anchor_row(placement):
                        continue
                    max_pop = residential_type.get("max")
                    if max_pop is None:
                        max_pop = int(residential_type["min"]) + total_bonus_upper_bound
                    candidates.append(
                        {
                            "r": r,
                            "c": c,
                            "rows": rows,
                            "cols": cols,
                            "typeIndex": type_index,
                            "base": int(residential_type["min"]),
                            "max": int(max_pop),
                            "cells": [cell_to_id[cell] for cell in cells],
                            "border": sorted(set(border)),
                        }
                    )
        return candidates

    settings = params.get("residentialSettings") or {}
    base_pop = int(params.get("basePop", 0))
    fallback_max = params.get("maxPop")
    fallback_max = int(fallback_max) if fallback_max is not None else None
    placement_map = placement_maps.fallback_residential
    for rows, cols in ((2, 2), (2, 3)):
        key = f"{rows}x{cols}"
        size_setting = settings.get(key) or {}
        base = int(size_setting.get("min", base_pop))
        max_pop = size_setting.get("max", fallback_max)
        if max_pop is None:
            max_pop = base + total_bonus_upper_bound
        else:
            max_pop = int(max_pop)
        for placement in placement_map.get(f"{rows}x{cols}", []):
            r = placement["r"]
            c = placement["c"]
            cells = rectangle_cells(r, c, rows, cols)
            if not all(cell in cell_to_id for cell in cells):
                continue
            border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
            if not border and not touches_road_anchor_row(placement):
                continue
            candidates.append(
                {
                    "r": r,
                    "c": c,
                    "rows": rows,
                    "cols": cols,
                    "typeIndex": NO_RESIDENTIAL_TYPE,
                    "base": base,
                    "max": max_pop,
                    "cells": [cell_to_id[cell] for cell in cells],
                    "border": sorted(set(border)),
                }
            )
    return candidates


def typed_service_bonus_upper_bound(params):
    bonuses = []
    for service_type in params.get("serviceTypes") or []:
        bonus = int(service_type.get("bonus", 0))
        avail = max(0, int(service_type.get("avail", 0)))
        if bonus <= 0 or avail <= 0:
            continue
        bonuses.extend([bonus] * avail)

    max_services = infer_max_services(params)
    bonuses.sort(reverse=True)
    if max_services is not None:
        bonuses = bonuses[:max_services]
    return sum(bonuses)


def service_candidate_key(candidate) -> str:
    return f"service:{int(candidate['typeIndex'])}:{int(candidate['r'])}:{int(candidate['c'])}:{int(candidate['rows'])}:{int(candidate['cols'])}"


def residential_candidate_key(candidate) -> str:
    return f"residential:{int(candidate['typeIndex'])}:{int(candidate['r'])}:{int(candidate['c'])}:{int(candidate['rows'])}:{int(candidate['cols'])}"


def rectangle_intersects_window(candidate, neighborhood_window) -> bool:
    if not neighborhood_window:
        return False
    top = int(neighborhood_window.get("top", 0))
    left = int(neighborhood_window.get("left", 0))
    rows = int(neighborhood_window.get("rows", 0))
    cols = int(neighborhood_window.get("cols", 0))
    if rows <= 0 or cols <= 0:
        return False
    bottom = top + rows
    right = left + cols
    candidate_top = int(candidate["r"])
    candidate_left = int(candidate["c"])
    candidate_bottom = candidate_top + int(candidate["rows"])
    candidate_right = candidate_left + int(candidate["cols"])
    return candidate_top < bottom and candidate_bottom > top and candidate_left < right and candidate_right > left


def build_model(grid, params) -> BuiltCpSatModel:
    if not grid or not grid[0]:
        fail("Grid must be non-empty.")

    reachable_allowed = reachable_allowed_from_row0(grid)
    if not reachable_allowed:
        fail("No feasible solution found: no allowed road cell exists in row 0.")
    placement_maps = build_candidate_placement_maps(grid, params)
    protected_road_cells = collect_protected_road_cells(grid, params, reachable_allowed, placement_maps)
    road_eligible_cells = trim_road_eligible_cells(grid, reachable_allowed, protected_road_cells)

    allowed_cells, cell_to_id, id_to_cell = index_reachable_allowed_cells(grid, reachable_allowed)
    row0_ids = [idx for idx, (r, _) in enumerate(allowed_cells) if r == 0]
    road_eligible_ids = {cell_to_id[cell] for cell in road_eligible_cells if cell in cell_to_id}

    service_candidates = enumerate_service_candidates(grid, params, cell_to_id, placement_maps.service)
    total_bonus_upper_bound = typed_service_bonus_upper_bound(params)
    residential_candidates = enumerate_residential_candidates(grid, params, cell_to_id, total_bonus_upper_bound, placement_maps)
    service_candidates = prune_objectively_useless_service_candidates(service_candidates, residential_candidates)
    residential_candidates = annotate_residential_population_upper_bounds(params, service_candidates, residential_candidates)
    total_population_upper_bound = compute_total_population_upper_bound(params, residential_candidates)

    model = cp_model.CpModel()
    cell_count = len(allowed_cells)
    road_vars = [model.NewBoolVar(f"road_{idx}") for idx in range(cell_count)]
    for cell_id in range(cell_count):
        if cell_id not in road_eligible_ids:
            model.Add(road_vars[cell_id] == 0)

    root_vars = {idx: model.NewBoolVar(f"root_{idx}") for idx in row0_ids if idx in road_eligible_ids}
    model.Add(sum(root_vars.values()) == 1)
    for idx, root_var in root_vars.items():
        model.Add(root_var <= road_vars[idx])
    eligible_row0_ids = [cell_id for cell_id in row0_ids if cell_id in road_eligible_ids]
    for position, cell_id in enumerate(eligible_row0_ids):
        for earlier_cell_id in eligible_row0_ids[:position]:
            model.Add(root_vars[cell_id] + road_vars[earlier_cell_id] <= 1)

    total_roads = model.NewIntVar(1, cell_count, "total_roads")
    model.Add(total_roads == sum(road_vars))
    road_neighbor_ids = build_road_neighbor_ids(grid, id_to_cell, cell_to_id, road_eligible_ids)
    gate_access_analysis = analyze_gate_access_constraints(
        road_eligible_ids,
        road_neighbor_ids,
        eligible_row0_ids,
        service_candidates,
        residential_candidates,
    )

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

    add_occupancy_constraints(model, cell_count, road_vars, service_vars, service_candidates, residential_vars, residential_candidates)
    add_border_access_constraints(model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates)
    add_aggregated_border_capacity_constraints(
        model, road_vars, service_vars, service_candidates, residential_vars, residential_candidates
    )
    add_gate_implied_access_constraints(
        model,
        road_vars,
        service_vars,
        residential_vars,
        gate_access_analysis,
    )
    add_road_support_constraints(model, road_vars, road_neighbor_ids, root_vars)
    directed_edges = add_flow_connectivity_constraints(
        model,
        grid,
        id_to_cell,
        cell_to_id,
        road_eligible_ids,
        road_vars,
        road_neighbor_ids,
        root_vars,
        eligible_row0_ids,
        total_roads,
    )
    populations, total_population, total_services, objective_policy = add_population_model_and_objective(
        model,
        cell_count,
        service_vars,
        service_candidates,
        residential_vars,
        residential_candidates,
        road_vars,
        total_roads,
        total_population_upper_bound,
    )

    return BuiltCpSatModel(
        model=model,
        allowed_cells=allowed_cells,
        row0_ids=row0_ids,
        road_vars=road_vars,
        root_vars=root_vars,
        service_vars=service_vars,
        service_candidates=service_candidates,
        residential_vars=residential_vars,
        residential_candidates=residential_candidates,
        populations=populations,
        total_roads=total_roads,
        total_services=total_services,
        total_population=total_population,
        total_population_upper_bound=total_population_upper_bound,
        objective_policy=objective_policy,
        id_to_cell=id_to_cell,
        road_eligible_cells=sorted(road_eligible_cells),
        directed_edges=directed_edges,
    )


def configure_solver_parameters(solver, cp_sat_options):
    if cp_sat_options.get("timeLimitSeconds") is not None:
        solver.parameters.max_time_in_seconds = float(cp_sat_options["timeLimitSeconds"])
    if cp_sat_options.get("maxDeterministicTime") is not None:
        solver.parameters.max_deterministic_time = float(cp_sat_options["maxDeterministicTime"])
    solver.parameters.num_search_workers = int(cp_sat_options.get("numWorkers", 8))
    if cp_sat_options.get("randomSeed") is not None:
        solver.parameters.random_seed = int(cp_sat_options["randomSeed"])
    if cp_sat_options.get("randomizeSearch") is not None:
        solver.parameters.randomize_search = bool(cp_sat_options["randomizeSearch"])
    if cp_sat_options.get("relativeGapLimit") is not None:
        solver.parameters.relative_gap_limit = float(cp_sat_options["relativeGapLimit"])
    if cp_sat_options.get("absoluteGapLimit") is not None:
        solver.parameters.absolute_gap_limit = float(cp_sat_options["absoluteGapLimit"])
    solver.parameters.log_search_progress = bool(cp_sat_options.get("logSearchProgress", False))


def select_hint_candidate_indices(hint_candidates, candidates, kind):
    selected_indices = set()
    for hint in hint_candidates or []:
        if not isinstance(hint, dict):
            continue
        matches = [
            candidate_index
            for candidate_index, candidate in enumerate(candidates)
            if int(candidate["r"]) == int(hint.get("r", -1))
            and int(candidate["c"]) == int(hint.get("c", -1))
            and int(candidate["rows"]) == int(hint.get("rows", -1))
            and int(candidate["cols"]) == int(hint.get("cols", -1))
        ]
        if kind == "service":
            if hint.get("typeIndex") is not None:
                matches = [candidate_index for candidate_index in matches if candidates[candidate_index]["typeIndex"] == int(hint["typeIndex"])]
            if hint.get("range") is not None:
                matches = [candidate_index for candidate_index in matches if candidates[candidate_index]["range"] == int(hint["range"])]
            if hint.get("bonus") is not None:
                matches = [candidate_index for candidate_index in matches if candidates[candidate_index]["bonus"] == int(hint["bonus"])]
        else:
            if hint.get("typeIndex") is not None:
                matches = [candidate_index for candidate_index in matches if candidates[candidate_index]["typeIndex"] == int(hint["typeIndex"])]
        if len(matches) == 1:
            selected_indices.add(matches[0])
    return selected_indices


def apply_objective_lower_bound(model, built: BuiltCpSatModel, objective_lower_bound):
    if objective_lower_bound is None:
        return
    lower_bound = int(objective_lower_bound)
    if lower_bound > built.total_population_upper_bound:
        fail(
            f"Objective lower bound {lower_bound} exceeds the model upper bound {built.total_population_upper_bound}."
        )
    model.Add(built.total_population >= lower_bound)


def solve_single_cp_sat(grid, params, cp_sat_options, progress_emitter=None):
    built = build_model(grid, params)
    model = built.model
    warm_start_hint = cp_sat_options.get("warmStartHint")
    apply_warm_start_hints(model, built, warm_start_hint)
    apply_local_neighborhood_fixing(model, built, warm_start_hint)
    apply_objective_lower_bound(model, built, cp_sat_options.get("objectiveLowerBound"))
    solver = cp_model.CpSolver()
    configure_solver_parameters(solver, cp_sat_options)
    stop_requested = False
    stopped_by_user = False
    stop_file_path = cp_sat_options.get("stopFilePath")
    snapshot_file_path = cp_sat_options.get("snapshotFilePath")

    def request_stop(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    def should_stop() -> bool:
        return stop_requested or (bool(stop_file_path) and os.path.exists(stop_file_path))

    class SnapshotTelemetryCollector(CpSatTelemetryCollector):
        def __init__(self):
            super().__init__(
                built=built,
                population_from_objective_value=population_from_objective_value,
                progress_emitter=progress_emitter,
                progress_interval_seconds=cp_sat_options.get("progressIntervalSeconds", 0.5),
            )
            self.latest_solution = None

        def on_solution_callback(self):
            nonlocal stopped_by_user
            super().on_solution_callback()
            self.latest_solution = collect_solution(self.Value, built)
            if snapshot_file_path:
                write_snapshot(
                    snapshot_file_path,
                    {
                        **self.latest_solution,
                        "status": "FEASIBLE",
                        "stoppedByUser": False,
                    },
                )
            if should_stop():
                stopped_by_user = True
                self.StopSearch()

    telemetry_collector = SnapshotTelemetryCollector()
    if warm_start_hint:
        repair_hint = warm_start_hint.get("repairHint")
        if repair_hint not in (None, ""):
            solver.parameters.repair_hint = bool(repair_hint)
        fix_variables = warm_start_hint.get("fixVariablesToHintedValue")
        if fix_variables not in (None, ""):
            solver.parameters.fix_variables_to_their_hinted_value = bool(fix_variables)
        hint_conflict_limit = warm_start_hint.get("hintConflictLimit")
        if hint_conflict_limit not in (None, ""):
            solver.parameters.hint_conflict_limit = int(hint_conflict_limit)

    install_signal_handlers = threading.current_thread() is threading.main_thread()
    previous_sigterm = signal.getsignal(signal.SIGTERM) if install_signal_handlers else None
    previous_sigint = signal.getsignal(signal.SIGINT) if install_signal_handlers else None
    try:
        if install_signal_handlers:
            signal.signal(signal.SIGTERM, request_stop)
            signal.signal(signal.SIGINT, request_stop)

        def best_bound_callback(bound):
            nonlocal stopped_by_user
            if should_stop():
                stopped_by_user = True
                solver.StopSearch()
                return
            if progress_emitter is not None:
                telemetry_collector.on_best_bound_callback(bound)

        solver.best_bound_callback = best_bound_callback
        if progress_emitter is not None and bool(cp_sat_options.get("logSearchProgress", False)):
            solver.log_callback = lambda message: print(message, file=sys.stderr, end="")

        status = solver.Solve(model, telemetry_collector)
    finally:
        if install_signal_handlers:
            signal.signal(signal.SIGTERM, previous_sigterm)
            signal.signal(signal.SIGINT, previous_sigint)

    status_name = solver_status_name(status)
    telemetry = collect_cp_sat_telemetry(
        solver,
        telemetry_collector,
        status,
        built,
        population_from_objective_value,
    )

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        response = build_solution_response(solver, built, status_name, telemetry)
        response["stoppedByUser"] = stopped_by_user
        return CpSatSolveResult(
            status=status_name,
            feasible=True,
            objective_value=int(solver.ObjectiveValue()),
            total_population=response["totalPopulation"],
            response=response,
            telemetry=telemetry,
        )

    if stopped_by_user and telemetry_collector.latest_solution is not None:
        response = build_snapshot_response(
            telemetry_collector.latest_solution,
            built,
            "FEASIBLE",
            telemetry,
            stopped_by_user=True,
        )
        objective_value = None
        if telemetry.incumbent_objective_value is not None:
            objective_value = int(round(telemetry.incumbent_objective_value))
        return CpSatSolveResult(
            status="FEASIBLE",
            feasible=True,
            objective_value=objective_value,
            total_population=response["totalPopulation"],
            response=response,
            telemetry=telemetry,
        )

    return CpSatSolveResult(
        status=status_name,
        feasible=False,
        objective_value=None,
        total_population=None,
        response=None,
        telemetry=telemetry,
    )

def portfolio_worker_task(grid, params, worker_option, worker_index):
    solve_result = solve_single_cp_sat(grid, params, worker_option)
    return CpSatPortfolioWorkerResult(
        summary=CpSatPortfolioWorkerSummary(
            worker_index=worker_index,
            random_seed=worker_option.get("randomSeed"),
            randomize_search=bool(worker_option.get("randomizeSearch", False)),
            num_workers=int(worker_option.get("numWorkers", 1)),
            status=solve_result.status,
            feasible=solve_result.feasible,
            total_population=solve_result.total_population,
        ),
        solve_result=solve_result,
    )

def solve_cp_sat_portfolio(grid, params, cp_sat_options, progress_emitter=None):
    worker_options = build_portfolio_worker_options(cp_sat_options)
    snapshot_file_path = cp_sat_options.get("snapshotFilePath")
    best_snapshot_result = None

    def on_worker_result(result):
        nonlocal best_snapshot_result
        if progress_emitter is not None:
            progress_emitter(progress_payload("portfolio-worker-complete", worker=result.summary))
        if snapshot_file_path and result.solve_result.response is not None:
            candidate_is_better = best_snapshot_result is None
            if not candidate_is_better:
                candidate_is_better = select_best_portfolio_result([best_snapshot_result, result]) is result
            if candidate_is_better:
                best_snapshot_result = result
                write_snapshot(
                    snapshot_file_path,
                    {
                        **result.solve_result.response,
                        "stoppedByUser": False,
                    },
                )

    results = run_portfolio_workers(
        grid,
        params,
        worker_options,
        portfolio_worker_task,
        on_result=on_worker_result,
    )
    best_result = select_best_portfolio_result(results)
    if best_result is None:
        statuses = ", ".join(
            f"worker {result.summary.worker_index}: {result.solve_result.status}"
            for result in sorted(results, key=lambda result: result.summary.worker_index)
        )
        fail(f"No feasible solution found with CP-SAT portfolio. Statuses: {statuses}.")

    response = best_result.solve_result.response
    if response is None:
        fail("CP-SAT portfolio produced a feasible worker without a serializable response.")
    response["portfolio"] = {
        "workerCount": len(worker_options),
        "selectedWorkerIndex": best_result.summary.worker_index,
        "workers": [
            portfolio_worker_summary_payload(result.summary)
            for result in sorted(results, key=lambda result: result.summary.worker_index)
        ],
    }
    return response


def apply_warm_start_hints(model, built: BuiltCpSatModel, warm_start_hint):
    if not warm_start_hint:
        return

    solution = warm_start_hint.get("solution") or {}
    road_keys = {
        str(key)
        for key in (warm_start_hint.get("roads") or warm_start_hint.get("roadKeys") or solution.get("roads") or [])
    }
    service_keys = {str(key) for key in warm_start_hint.get("serviceCandidateKeys") or []}
    residential_keys = {str(key) for key in warm_start_hint.get("residentialCandidateKeys") or []}
    service_hints = list(warm_start_hint.get("services") or solution.get("services") or [])
    residential_hints = list(warm_start_hint.get("residentials") or solution.get("residentials") or [])
    residential_population_by_key = {}
    for residential in residential_hints:
        key = residential_candidate_key(residential)
        residential_population_by_key[key] = int(residential.get("population", 0))

    road_lookup = {f"{r},{c}": idx for idx, (r, c) in enumerate(built.allowed_cells)}
    service_lookup = {
        service_candidate_key(candidate): candidate_index
        for candidate_index, candidate in enumerate(built.service_candidates)
    }
    residential_lookup = {
        residential_candidate_key(candidate): candidate_index
        for candidate_index, candidate in enumerate(built.residential_candidates)
    }

    selected_road_ids = {road_lookup[key] for key in road_keys if key in road_lookup}
    selected_service_ids = select_hint_candidate_indices(service_hints, built.service_candidates, "service")
    selected_service_ids.update({service_lookup[key] for key in service_keys if key in service_lookup})
    selected_residential_ids = select_hint_candidate_indices(residential_hints, built.residential_candidates, "residential")
    selected_residential_ids.update({residential_lookup[key] for key in residential_keys if key in residential_lookup})

    for cell_id, variable in enumerate(built.road_vars):
        model.AddHint(variable, 1 if cell_id in selected_road_ids else 0)

    hinted_root_id = next((cell_id for cell_id in built.row0_ids if cell_id in selected_road_ids), None)
    if hinted_root_id is not None:
        for cell_id, variable in built.root_vars.items():
            model.AddHint(variable, 1 if cell_id == hinted_root_id else 0)

    for candidate_index, variable in enumerate(built.service_vars):
        model.AddHint(variable, 1 if candidate_index in selected_service_ids else 0)

    for candidate_index, variable in enumerate(built.residential_vars):
        model.AddHint(variable, 1 if candidate_index in selected_residential_ids else 0)
        candidate = built.residential_candidates[candidate_index]
        key = residential_candidate_key(candidate)
        population = residential_population_by_key.get(key, 0)
        model.AddHint(built.populations[candidate_index], population)

    if selected_road_ids:
        model.AddHint(built.total_roads, len(selected_road_ids))
    if selected_service_ids or service_hints or service_keys:
        model.AddHint(built.total_services, len(selected_service_ids))
    hinted_total_population = warm_start_hint.get("totalPopulation", solution.get("totalPopulation"))
    if hinted_total_population is not None:
        hinted_total_population = int(hinted_total_population)
        hinted_total_population = max(0, min(hinted_total_population, built.total_population_upper_bound))
        model.AddHint(built.total_population, hinted_total_population)

    objective_lower_bound = warm_start_hint.get("objectiveLowerBound")
    if objective_lower_bound not in (None, ""):
        cutoff = int(objective_lower_bound)
        if bool(warm_start_hint.get("preferStrictImprove")):
            cutoff += 1
        model.Add(sum(built.populations) >= cutoff)


def apply_local_neighborhood_fixing(model, built: BuiltCpSatModel, warm_start_hint):
    if not warm_start_hint or not bool(warm_start_hint.get("fixOutsideNeighborhoodToHintedValue")):
        return

    neighborhood_window = warm_start_hint.get("neighborhoodWindow") or {}
    rows = int(neighborhood_window.get("rows", 0) or 0)
    cols = int(neighborhood_window.get("cols", 0) or 0)
    if rows <= 0 or cols <= 0:
        return

    solution = warm_start_hint.get("solution") or {}
    road_keys = {
        str(key)
        for key in (warm_start_hint.get("roads") or warm_start_hint.get("roadKeys") or solution.get("roads") or [])
    }
    service_keys = {str(key) for key in warm_start_hint.get("serviceCandidateKeys") or []}
    residential_keys = {str(key) for key in warm_start_hint.get("residentialCandidateKeys") or []}
    service_hints = list(warm_start_hint.get("services") or solution.get("services") or [])
    residential_hints = list(warm_start_hint.get("residentials") or solution.get("residentials") or [])

    road_lookup = {f"{r},{c}": idx for idx, (r, c) in enumerate(built.allowed_cells)}
    selected_road_ids = {road_lookup[key] for key in road_keys if key in road_lookup}
    selected_service_ids = select_hint_candidate_indices(service_hints, built.service_candidates, "service")
    selected_service_ids.update(
        {
            candidate_index
            for candidate_index, candidate in enumerate(built.service_candidates)
            if service_candidate_key(candidate) in service_keys
        }
    )
    selected_residential_ids = select_hint_candidate_indices(residential_hints, built.residential_candidates, "residential")
    selected_residential_ids.update(
        {
            candidate_index
            for candidate_index, candidate in enumerate(built.residential_candidates)
            if residential_candidate_key(candidate) in residential_keys
        }
    )

    top = int(neighborhood_window.get("top", 0))
    left = int(neighborhood_window.get("left", 0))
    bottom = top + rows
    right = left + cols

    for cell_id, variable in enumerate(built.road_vars):
        r, c = built.allowed_cells[cell_id]
        if top <= r < bottom and left <= c < right:
            continue
        model.Add(variable == (1 if cell_id in selected_road_ids else 0))

    hinted_root_id = next((cell_id for cell_id in built.row0_ids if cell_id in selected_road_ids), None)
    if hinted_root_id is not None:
        for cell_id, variable in built.root_vars.items():
            model.Add(variable == (1 if cell_id == hinted_root_id else 0))

    for candidate_index, variable in enumerate(built.service_vars):
        candidate = built.service_candidates[candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in selected_service_ids else 0))

    for candidate_index, variable in enumerate(built.residential_vars):
        candidate = built.residential_candidates[candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in selected_residential_ids else 0))


def solve():
    payload = json.load(sys.stdin)
    grid = payload["grid"]
    params = payload.get("params") or {}
    cp_sat_options = params.get("cpSat") or {}
    stream_progress = bool(cp_sat_options.get("streamProgress", False))

    def emit_stream_event(event):
        sys.stdout.write(json.dumps(event) + "\n")
        sys.stdout.flush()

    progress_emitter = emit_stream_event if stream_progress else None
    if cp_sat_options.get("portfolio"):
        response = solve_cp_sat_portfolio(grid, params, cp_sat_options, progress_emitter)
    else:
        result = solve_single_cp_sat(grid, params, cp_sat_options, progress_emitter)
        if not result.feasible:
            fail(f"No feasible solution found with CP-SAT. Status: {result.status}.")
        response = result.response
    if stream_progress:
        emit_stream_event(result_payload(response))
    else:
        json.dump(response, sys.stdout)


if __name__ == "__main__":
    solve()
