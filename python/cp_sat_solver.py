#!/usr/bin/env python3

import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

try:
    from ortools.sat.python import cp_model
except ImportError as exc:
    print(
        "OR-Tools is not installed. Run scripts/setup-cp-sat.sh or install python/requirements-cp-sat.txt first.",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


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
    objective_policy: Any
    id_to_cell: dict[int, tuple[int, int]]
    road_eligible_cells: list[tuple[int, int]]
    directed_edges: list[tuple[int, int, Any]]


@dataclass(frozen=True)
class ObjectivePolicy:
    population_weight: int
    max_tie_break_penalty: int
    tie_break_summary: str


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


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


def build_objective_policy(cell_count: int, service_candidate_count: int) -> ObjectivePolicy:
    max_tie_break_penalty = cell_count + service_candidate_count
    return ObjectivePolicy(
        population_weight=max_tie_break_penalty + 1,
        max_tie_break_penalty=max_tie_break_penalty,
        tie_break_summary="maximize population, then minimize roads + services",
    )


def add_population_model_and_objective(
    model,
    cell_count,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
    road_vars,
    total_roads,
):
    service_cover_sets = [candidate["effect_zone"] for candidate in service_candidates]
    populations = []
    for candidate_index, candidate in enumerate(residential_candidates):
        pop_var = model.NewIntVar(0, candidate["max"], f"population_{candidate_index}")
        boost_terms = []
        candidate_cells = set(candidate["cells"])
        for service_index, cover_zone in enumerate(service_cover_sets):
            bonus = int(service_candidates[service_index]["bonus"] or 0)
            if bonus == 0 or not (candidate_cells & cover_zone):
                continue
            boost_terms.append(bonus * service_vars[service_index])
        boost_expr = sum(boost_terms) if boost_terms else 0
        model.Add(pop_var <= candidate["max"] * residential_vars[candidate_index])
        model.Add(pop_var <= candidate["base"] * residential_vars[candidate_index] + boost_expr)
        populations.append(pop_var)

    total_population_upper_bound = sum(candidate["max"] for candidate in residential_candidates)
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


def enumerate_service_candidates(grid, params, cell_to_id, placement_map):
    candidates = []
    service_types = params.get("serviceTypes") or []
    for type_index, service_type in enumerate(service_types):
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
        objective_policy=objective_policy,
        id_to_cell=id_to_cell,
        road_eligible_cells=sorted(road_eligible_cells),
        directed_edges=directed_edges,
    )


def solve():
    payload = json.load(sys.stdin)
    grid = payload["grid"]
    params = payload.get("params") or {}
    cp_sat_options = params.get("cpSat") or {}

    built = build_model(grid, params)
    model = built.model
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(cp_sat_options.get("timeLimitSeconds", 120))
    solver.parameters.num_search_workers = int(cp_sat_options.get("numWorkers", 8))
    solver.parameters.log_search_progress = bool(cp_sat_options.get("logSearchProgress", False))

    status = solver.Solve(model)
    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, f"STATUS_{status}")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        fail(f"No feasible solution found with CP-SAT. Status: {status_name}.")

    roads = []
    for cell_id, road_var in enumerate(built.road_vars):
        if solver.Value(road_var) != 1:
            continue
        r, c = built.id_to_cell[cell_id]
        roads.append(f"{r},{c}")

    services = []
    for candidate_index, variable in enumerate(built.service_vars):
        if solver.Value(variable) != 1:
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
        if solver.Value(variable) != 1:
            continue
        candidate = built.residential_candidates[candidate_index]
        population = solver.Value(built.populations[candidate_index])
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

    response = {
        "status": status_name,
        "roads": roads,
        "services": services,
        "residentials": residentials,
        "populations": populations,
        "totalPopulation": solver.Value(built.total_population),
        "objectivePolicy": {
            "populationWeight": built.objective_policy.population_weight,
            "maxTieBreakPenalty": built.objective_policy.max_tie_break_penalty,
            "summary": built.objective_policy.tie_break_summary,
        },
    }
    json.dump(response, sys.stdout)


if __name__ == "__main__":
    solve()
