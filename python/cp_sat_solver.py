#!/usr/bin/env python3

import json
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


def enumerate_service_candidates(grid, params, cell_to_id):
    candidates = []
    h = len(grid)
    w = len(grid[0])
    service_types = params.get("serviceTypes") or []
    for type_index, service_type in enumerate(service_types):
        avail = int(service_type["avail"])
        if avail <= 0:
            continue
        effect_range = int(service_type["range"])
        bonus = int(service_type["bonus"])
        for rows, cols in service_type_orientations(service_type):
            if rows > h or cols > w:
                continue
            for r in range(h - rows + 1):
                for c in range(w - cols + 1):
                    cells = rectangle_cells(r, c, rows, cols)
                    if not all(is_allowed(grid, rr, cc) for rr, cc in cells):
                        continue
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
        for type_index, residential_type in enumerate(residential_types):
            avail = int(residential_type.get("avail", 0))
            if avail <= 0:
                continue
            w = int(residential_type["w"])
            h = int(residential_type["h"])
            orientations = {(h, w)}
            orientations.add((w, h))
            for rows, cols in orientations:
                if rows > len(grid) or cols > len(grid[0]):
                    continue
                for r in range(len(grid) - rows + 1):
                    for c in range(len(grid[0]) - cols + 1):
                        cells = rectangle_cells(r, c, rows, cols)
                        if not all(is_allowed(grid, rr, cc) for rr, cc in cells):
                            continue
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
                cells = rectangle_cells(r, c, rows, cols)
                if not all(is_allowed(grid, rr, cc) for rr, cc in cells):
                    continue
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


def solve():
    payload = json.load(sys.stdin)
    grid = payload["grid"]
    params = payload.get("params") or {}
    cp_sat_options = params.get("cpSat") or {}

    built = build_model(grid, params)
    model = built["model"]
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
    for cell_id, road_var in enumerate(built["road_vars"]):
        if solver.Value(road_var) != 1:
            continue
        r, c = built["id_to_cell"][cell_id]
        roads.append(f"{r},{c}")

    services = []
    for candidate_index, variable in enumerate(built["service_vars"]):
        if solver.Value(variable) != 1:
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
        if solver.Value(variable) != 1:
            continue
        candidate = built["residential_candidates"][candidate_index]
        population = solver.Value(built["populations"][candidate_index])
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
        "totalPopulation": sum(populations),
    }
    json.dump(response, sys.stdout)


if __name__ == "__main__":
    solve()
