#!/usr/bin/env python3

import json
import os
import signal
import sys
from collections import defaultdict

try:
    from ortools.sat.python import cp_model
except ImportError as exc:
    print(
        "OR-Tools is not installed. Run scripts/setup-cp-sat.sh or install python/requirements-cp-sat.txt first.",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


NO_RESIDENTIAL_TYPE = -1


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def status_name_for(status: int) -> str:
    return {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, f"STATUS_{status}")


def collect_solution(value_reader, built):
    roads = []
    for cell_id, road_var in enumerate(built["road_vars"]):
        if value_reader(road_var) != 1:
            continue
        r, c = built["id_to_cell"][cell_id]
        roads.append(f"{r},{c}")

    services = []
    for candidate_index, variable in enumerate(built["service_vars"]):
        if value_reader(variable) != 1:
            continue
        candidate = built["service_candidates"][candidate_index]
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
    for candidate_index, variable in enumerate(built["residential_vars"]):
        if value_reader(variable) != 1:
            continue
        candidate = built["residential_candidates"][candidate_index]
        population = value_reader(built["populations"][candidate_index])
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


def touches_road_anchor_row(candidate):
    return int(candidate["r"]) == 0


def service_type_orientations(service_type):
    rows = int(service_type["rows"])
    cols = int(service_type["cols"])
    orientations = [(rows, cols)]
    if bool(service_type.get("allowRotation", True)) and rows != cols:
        orientations.append((cols, rows))
    return orientations


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


def enumerate_service_candidates(grid, params, cell_to_id):
    candidates = []
    service_types = params.get("serviceTypes") or []
    blocked_prefix_sum = build_blocked_prefix_sum(grid)
    placement_map = enumerate_valid_placements(
        grid,
        blocked_prefix_sum,
        [dimension for service_type in service_types for dimension in service_type_orientations(service_type)],
    )
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
                border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
                if not border:
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
    return candidates


def enumerate_residential_candidates(grid, params, cell_to_id, total_bonus_upper_bound: int):
    candidates = []
    residential_types = params.get("residentialTypes")
    if residential_types:
        blocked_prefix_sum = build_blocked_prefix_sum(grid)
        placement_map = enumerate_valid_placements(
            grid,
            blocked_prefix_sum,
            [
                dimension
                for residential_type in residential_types
                for dimension in {(int(residential_type["h"]), int(residential_type["w"])), (int(residential_type["w"]), int(residential_type["h"]))}
            ],
        )
        type_order = sorted(
            range(len(residential_types)),
            key=lambda index: (
                -residential_type_priority(residential_types[index]),
                -int(residential_types[index]["max"]),
                -int(residential_types[index]["min"]),
                int(residential_types[index]["w"]) * int(residential_types[index]["h"]),
                -int(residential_types[index].get("avail", 0)),
                index,
            ),
        )
        for type_index in type_order:
            residential_type = residential_types[type_index]
            avail = int(residential_type.get("avail", 0))
            if avail <= 0:
                continue
            w = int(residential_type["w"])
            h = int(residential_type["h"])
            orientations = {(h, w)}
            orientations.add((w, h))
            for rows, cols in orientations:
                for placement in placement_map.get(f"{rows}x{cols}", []):
                    r = placement["r"]
                    c = placement["c"]
                    cells = rectangle_cells(r, c, rows, cols)
                    border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
                    if not border:
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
    blocked_prefix_sum = build_blocked_prefix_sum(grid)
    for rows, cols in ((2, 2), (2, 3)):
        key = f"{rows}x{cols}"
        size_setting = settings.get(key) or {}
        base = int(size_setting.get("min", base_pop))
        max_pop = size_setting.get("max", fallback_max)
        if max_pop is None:
            max_pop = base + total_bonus_upper_bound
        else:
            max_pop = int(max_pop)
        for r in range(len(grid) - rows + 1):
            for c in range(len(grid[0]) - cols + 1):
                if rectangle_blocked_count(blocked_prefix_sum, r, c, rows, cols) != 0:
                    continue
                cells = rectangle_cells(r, c, rows, cols)
                border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
                if not border:
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


def build_model(grid, params):
    if not grid or not grid[0]:
        fail("Grid must be non-empty.")

    allowed_cells = []
    cell_to_id = {}
    id_to_cell = {}
    for r in range(len(grid)):
        for c in range(len(grid[0])):
            if grid[r][c] != 1:
                continue
            idx = len(allowed_cells)
            allowed_cells.append((r, c))
            cell_to_id[(r, c)] = idx
            id_to_cell[idx] = (r, c)

    row0_ids = [idx for idx, (r, _) in enumerate(allowed_cells) if r == 0]
    if not row0_ids:
        fail("No feasible solution found: no allowed road cell exists in row 0.")

    service_candidates = enumerate_service_candidates(grid, params, cell_to_id)
    total_bonus_upper_bound = typed_service_bonus_upper_bound(params)
    residential_candidates = enumerate_residential_candidates(grid, params, cell_to_id, total_bonus_upper_bound)

    model = cp_model.CpModel()
    cell_count = len(allowed_cells)
    road_vars = [model.NewBoolVar(f"road_{idx}") for idx in range(cell_count)]

    root_vars = {idx: model.NewBoolVar(f"root_{idx}") for idx in row0_ids}
    model.Add(sum(root_vars.values()) == 1)
    for idx, root_var in root_vars.items():
        model.Add(root_var <= road_vars[idx])

    total_roads = model.NewIntVar(1, cell_count, "total_roads")
    model.Add(total_roads == sum(road_vars))

    service_vars = [model.NewBoolVar(f"service_{candidate_index}") for candidate_index in range(len(service_candidates))]
    max_services = infer_max_services(params)
    if max_services is not None:
        model.Add(sum(service_vars) <= max_services)
    service_types = params.get("serviceTypes") or []
    by_type = defaultdict(list)
    for candidate_index, candidate in enumerate(service_candidates):
        by_type[candidate["typeIndex"]].append(candidate_index)
    for type_index, service_type in enumerate(service_types):
        avail = int(service_type.get("avail", 0))
        if type_index in by_type:
            model.Add(sum(service_vars[candidate_index] for candidate_index in by_type[type_index]) <= avail)

    residential_vars = [model.NewBoolVar(f"residential_{index}") for index in range(len(residential_candidates))]

    available = params.get("availableBuildings") or {}
    max_residentials = available.get("residentials", params.get("maxResidentials"))
    if max_residentials is not None:
        model.Add(sum(residential_vars) <= int(max_residentials))

    residential_types = params.get("residentialTypes") or []
    if residential_types:
        by_type = defaultdict(list)
        for candidate_index, candidate in enumerate(residential_candidates):
            by_type[candidate["typeIndex"]].append(candidate_index)
        for type_index, residential_type in enumerate(residential_types):
            avail = int(residential_type.get("avail", 0))
            if type_index in by_type:
                model.Add(sum(residential_vars[candidate_index] for candidate_index in by_type[type_index]) <= avail)

    occupancy_terms = defaultdict(list)
    for candidate_index, variable in enumerate(service_vars):
        for cell_id in service_candidates[candidate_index]["cells"]:
            occupancy_terms[cell_id].append(variable)
    for candidate_index, variable in enumerate(residential_vars):
        for cell_id in residential_candidates[candidate_index]["cells"]:
            occupancy_terms[cell_id].append(variable)
    for cell_id in range(cell_count):
        model.Add(sum(occupancy_terms[cell_id]) + road_vars[cell_id] <= 1)

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

    directed_edges = []
    incoming = defaultdict(list)
    outgoing = defaultdict(list)
    for cell_id, (r, c) in id_to_cell.items():
        for neighbor in orthogonal_neighbors(grid, r, c):
            if neighbor not in cell_to_id:
                continue
            neighbor_id = cell_to_id[neighbor]
            flow_var = model.NewIntVar(0, cell_count, f"flow_{cell_id}_{neighbor_id}")
            model.Add(flow_var <= cell_count * road_vars[cell_id])
            model.Add(flow_var <= cell_count * road_vars[neighbor_id])
            directed_edges.append((cell_id, neighbor_id, flow_var))
            outgoing[cell_id].append(flow_var)
            incoming[neighbor_id].append(flow_var)

    root_supply = {}
    for cell_id in row0_ids:
        supply_var = model.NewIntVar(0, cell_count, f"root_supply_{cell_id}")
        model.Add(supply_var <= cell_count * root_vars[cell_id])
        root_supply[cell_id] = supply_var
    model.Add(sum(root_supply.values()) == total_roads)

    for cell_id in range(cell_count):
        inflow = sum(incoming[cell_id])
        if cell_id in root_supply:
            inflow += root_supply[cell_id]
        model.Add(inflow == sum(outgoing[cell_id]) + road_vars[cell_id])

    service_cover_sets = []
    for candidate in service_candidates:
        service_cover_sets.append(candidate["effect_zone"])

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

    service_penalty_terms = service_vars
    penalty_cap = cell_count + len(service_candidates) + 1
    model.Maximize(sum(populations) * penalty_cap - sum(road_vars) - sum(service_penalty_terms))

    return {
        "model": model,
        "allowed_cells": allowed_cells,
        "row0_ids": row0_ids,
        "road_vars": road_vars,
        "root_vars": root_vars,
        "service_vars": service_vars,
        "service_candidates": service_candidates,
        "residential_vars": residential_vars,
        "residential_candidates": residential_candidates,
        "populations": populations,
        "id_to_cell": id_to_cell,
    }


def apply_warm_start_hint(model, built, warm_start_hint):
    if not warm_start_hint:
        return

    road_keys = {str(key) for key in warm_start_hint.get("roadKeys") or []}
    service_keys = {str(key) for key in warm_start_hint.get("serviceCandidateKeys") or []}
    residential_keys = {str(key) for key in warm_start_hint.get("residentialCandidateKeys") or []}
    residential_population_by_key = {}
    for residential in ((warm_start_hint.get("solution") or {}).get("residentials") or []):
        key = residential_candidate_key(residential)
        residential_population_by_key[key] = int(residential.get("population", 0))

    road_lookup = {f"{r},{c}": idx for idx, (r, c) in enumerate(built["allowed_cells"])}
    service_lookup = {
        service_candidate_key(candidate): candidate_index
        for candidate_index, candidate in enumerate(built["service_candidates"])
    }
    residential_lookup = {
        residential_candidate_key(candidate): candidate_index
        for candidate_index, candidate in enumerate(built["residential_candidates"])
    }

    selected_road_ids = {road_lookup[key] for key in road_keys if key in road_lookup}
    selected_service_ids = {service_lookup[key] for key in service_keys if key in service_lookup}
    selected_residential_ids = {residential_lookup[key] for key in residential_keys if key in residential_lookup}

    for cell_id, variable in enumerate(built["road_vars"]):
        model.AddHint(variable, 1 if cell_id in selected_road_ids else 0)

    hinted_root_id = next((cell_id for cell_id in built["row0_ids"] if cell_id in selected_road_ids), None)
    if hinted_root_id is not None:
        for cell_id, variable in built["root_vars"].items():
            model.AddHint(variable, 1 if cell_id == hinted_root_id else 0)

    for candidate_index, variable in enumerate(built["service_vars"]):
        model.AddHint(variable, 1 if candidate_index in selected_service_ids else 0)

    for candidate_index, variable in enumerate(built["residential_vars"]):
        model.AddHint(variable, 1 if candidate_index in selected_residential_ids else 0)
        candidate = built["residential_candidates"][candidate_index]
        key = residential_candidate_key(candidate)
        population = residential_population_by_key.get(key, 0)
        model.AddHint(built["populations"][candidate_index], population)

    objective_lower_bound = warm_start_hint.get("objectiveLowerBound")
    if objective_lower_bound not in (None, ""):
        cutoff = int(objective_lower_bound)
        if bool(warm_start_hint.get("preferStrictImprove")):
            cutoff += 1
        model.Add(sum(built["populations"]) >= cutoff)


def apply_local_neighborhood_fixing(model, built, warm_start_hint):
    if not warm_start_hint or not bool(warm_start_hint.get("fixOutsideNeighborhoodToHintedValue")):
        return

    neighborhood_window = warm_start_hint.get("neighborhoodWindow") or {}
    rows = int(neighborhood_window.get("rows", 0) or 0)
    cols = int(neighborhood_window.get("cols", 0) or 0)
    if rows <= 0 or cols <= 0:
        return

    road_keys = {str(key) for key in warm_start_hint.get("roadKeys") or []}
    service_keys = {str(key) for key in warm_start_hint.get("serviceCandidateKeys") or []}
    residential_keys = {str(key) for key in warm_start_hint.get("residentialCandidateKeys") or []}

    road_lookup = {f"{r},{c}": idx for idx, (r, c) in enumerate(built["allowed_cells"])}
    selected_road_ids = {road_lookup[key] for key in road_keys if key in road_lookup}
    selected_service_ids = {
        candidate_index
        for candidate_index, candidate in enumerate(built["service_candidates"])
        if service_candidate_key(candidate) in service_keys
    }
    selected_residential_ids = {
        candidate_index
        for candidate_index, candidate in enumerate(built["residential_candidates"])
        if residential_candidate_key(candidate) in residential_keys
    }

    top = int(neighborhood_window.get("top", 0))
    left = int(neighborhood_window.get("left", 0))
    bottom = top + rows
    right = left + cols

    for cell_id, variable in enumerate(built["road_vars"]):
        r, c = built["allowed_cells"][cell_id]
        if top <= r < bottom and left <= c < right:
            continue
        model.Add(variable == (1 if cell_id in selected_road_ids else 0))

    hinted_root_id = next((cell_id for cell_id in built["row0_ids"] if cell_id in selected_road_ids), None)
    if hinted_root_id is not None:
        for cell_id, variable in built["root_vars"].items():
            model.Add(variable == (1 if cell_id == hinted_root_id else 0))

    for candidate_index, variable in enumerate(built["service_vars"]):
        candidate = built["service_candidates"][candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in selected_service_ids else 0))

    for candidate_index, variable in enumerate(built["residential_vars"]):
        candidate = built["residential_candidates"][candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in selected_residential_ids else 0))


def solve():
    payload = json.load(sys.stdin)
    grid = payload["grid"]
    params = payload.get("params") or {}
    cp_sat_options = params.get("cpSat") or {}
    warm_start_hint = cp_sat_options.get("warmStartHint")

    built = build_model(grid, params)
    model = built["model"]
    apply_warm_start_hint(model, built, warm_start_hint)
    apply_local_neighborhood_fixing(model, built, warm_start_hint)
    solver = cp_model.CpSolver()
    stop_requested = False
    stopped_by_user = False
    stop_file_path = cp_sat_options.get("stopFilePath")
    snapshot_file_path = cp_sat_options.get("snapshotFilePath")

    def request_stop(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    def should_stop() -> bool:
        return stop_requested or (bool(stop_file_path) and os.path.exists(stop_file_path))

    class SnapshotCallback(cp_model.CpSolverSolutionCallback):
        def __init__(self):
            super().__init__()
            self.latest_solution = None

        def OnSolutionCallback(self):
            nonlocal stopped_by_user
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

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    time_limit_seconds = cp_sat_options.get("timeLimitSeconds")
    if time_limit_seconds not in (None, ""):
        solver.parameters.max_time_in_seconds = float(time_limit_seconds)
    random_seed = cp_sat_options.get("randomSeed")
    if random_seed not in (None, ""):
        solver.parameters.random_seed = int(random_seed)
    if "randomizeSearch" in cp_sat_options:
        solver.parameters.randomize_search = bool(cp_sat_options.get("randomizeSearch"))
    solver.parameters.num_search_workers = int(cp_sat_options.get("numWorkers", 8))
    solver.parameters.log_search_progress = bool(cp_sat_options.get("logSearchProgress", False))
    if warm_start_hint:
        if "repairHint" in warm_start_hint:
            solver.parameters.repair_hint = bool(warm_start_hint.get("repairHint"))
        if "fixVariablesToHintedValue" in warm_start_hint:
            solver.parameters.fix_variables_to_their_hinted_value = bool(warm_start_hint.get("fixVariablesToHintedValue"))
        hint_conflict_limit = warm_start_hint.get("hintConflictLimit")
        if hint_conflict_limit not in (None, ""):
            solver.parameters.hint_conflict_limit = int(hint_conflict_limit)

    snapshot_callback = SnapshotCallback()

    def best_bound_callback(_bound):
        nonlocal stopped_by_user
        if should_stop():
            stopped_by_user = True
            solver.StopSearch()

    solver.best_bound_callback = best_bound_callback

    status = solver.solve(model, snapshot_callback)
    status_name = status_name_for(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if stopped_by_user and snapshot_callback.latest_solution is not None:
            status_name = "FEASIBLE"
        elif stopped_by_user:
            fail("CP-SAT solve was stopped before finding a feasible solution.")
        fail(f"No feasible solution found with CP-SAT. Status: {status_name}.")

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        response = collect_solution(solver.Value, built)
    elif snapshot_callback.latest_solution is not None:
        response = snapshot_callback.latest_solution
    else:
        fail("CP-SAT backend stopped without returning a feasible solution.")

    response["status"] = status_name
    response["stoppedByUser"] = stopped_by_user
    json.dump(response, sys.stdout)


if __name__ == "__main__":
    solve()
