from collections import defaultdict
from dataclasses import dataclass

from cp_sat_grid import (
    build_blocked_prefix_sum,
    enumerate_valid_placements,
    rectangle_border_cells,
    rectangle_cells,
    road_anchor_cells,
    service_effect_zone,
)
from cp_sat_road_model import touches_road_anchor_boundary


NO_RESIDENTIAL_TYPE = -1


@dataclass(frozen=True)
class CandidatePlacementMaps:
    service: dict[str, list[dict[str, int]]]
    residential: dict[str, list[dict[str, int]]]
    fallback_residential: dict[str, list[dict[str, int]]]


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


def collect_orientation_dimensions(building_types, orientation_fn):
    return [dimension for building_type in building_types for dimension in orientation_fn(building_type)]


def enumerate_placements_for_types(grid, blocked_prefix_sum, building_types, orientation_fn):
    return enumerate_valid_placements(grid, blocked_prefix_sum, collect_orientation_dimensions(building_types, orientation_fn))


def iter_active_type_orientations(building_types, orientation_fn):
    for building_type in building_types:
        if int(building_type.get("avail", 0)) <= 0:
            continue
        yield from orientation_fn(building_type)


def add_protected_reachable_border_cells(
    protected,
    grid,
    reachable_allowed,
    placement_map,
    dimensions,
    road_anchor_boundary_enabled=True,
):
    for rows, cols in dimensions:
        for placement in placement_map.get(f"{rows}x{cols}", []):
            if touches_road_anchor_boundary(placement, road_anchor_boundary_enabled):
                continue
            for cell in rectangle_border_cells(grid, placement["r"], placement["c"], rows, cols):
                if cell in reachable_allowed:
                    protected.add(cell)


def build_candidate_placement_maps(grid, params) -> CandidatePlacementMaps:
    blocked_prefix_sum = build_blocked_prefix_sum(grid)
    service_types = params.get("serviceTypes") or []
    service_placement_map = enumerate_placements_for_types(grid, blocked_prefix_sum, service_types, service_type_orientations)

    residential_types = params.get("residentialTypes")
    residential_placement_map = {}
    fallback_residential_placement_map = {}
    if residential_types:
        residential_placement_map = enumerate_placements_for_types(
            grid,
            blocked_prefix_sum,
            residential_types,
            residential_type_orientations,
        )
    else:
        fallback_residential_placement_map = enumerate_valid_placements(grid, blocked_prefix_sum, [(2, 2), (2, 3)])

    return CandidatePlacementMaps(
        service=service_placement_map,
        residential=residential_placement_map,
        fallback_residential=fallback_residential_placement_map,
    )


def collect_protected_road_cells(
    grid,
    params,
    reachable_allowed,
    placement_maps: CandidatePlacementMaps,
    fixed_road_cells=None,
    use_fixed_road_anchors_only=False,
):
    road_anchor_boundary_enabled = not use_fixed_road_anchors_only
    protected = {
        cell
        for cell in road_anchor_cells(grid, fixed_road_cells, use_fixed_road_anchors_only)
        if cell in reachable_allowed
    }
    service_types = params.get("serviceTypes") or []
    add_protected_reachable_border_cells(
        protected,
        grid,
        reachable_allowed,
        placement_maps.service,
        iter_active_type_orientations(service_types, service_type_orientations),
        road_anchor_boundary_enabled,
    )

    residential_types = params.get("residentialTypes")
    if residential_types:
        add_protected_reachable_border_cells(
            protected,
            grid,
            reachable_allowed,
            placement_maps.residential,
            iter_active_type_orientations(residential_types, residential_type_orientations),
            road_anchor_boundary_enabled,
        )
    else:
        add_protected_reachable_border_cells(
            protected,
            grid,
            reachable_allowed,
            placement_maps.fallback_residential,
            ((2, 2), (2, 3)),
            road_anchor_boundary_enabled,
        )

    return protected


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

    pruned = []
    for group in group_service_candidates_by_signature(candidates).values():
        for candidate in group:
            if not is_dominated_service_candidate(candidate, group, always_available_types):
                pruned.append(candidate)

    return pruned


def service_candidate_signature(candidate):
    return (candidate["r"], candidate["c"], candidate["rows"], candidate["cols"])


def group_service_candidates_by_signature(candidates):
    candidates_by_signature = defaultdict(list)
    for candidate in candidates:
        candidates_by_signature[service_candidate_signature(candidate)].append(candidate)
    return candidates_by_signature


def is_dominated_service_candidate(candidate, group, always_available_types):
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
            return True
    return False


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


def build_service_type_order(service_types):
    return sorted(
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


def materialize_candidate_geometry(grid, cell_to_id, placement, rows, cols, road_anchor_boundary_enabled=True):
    r = int(placement["r"])
    c = int(placement["c"])
    cells = rectangle_cells(r, c, rows, cols)
    if not all(cell in cell_to_id for cell in cells):
        return None

    border = [cell_to_id[cell] for cell in rectangle_border_cells(grid, r, c, rows, cols) if cell in cell_to_id]
    if not border and not touches_road_anchor_boundary(placement, road_anchor_boundary_enabled):
        return None

    return {
        "r": r,
        "c": c,
        "rows": rows,
        "cols": cols,
        "cells": [cell_to_id[cell] for cell in cells],
        "border": sorted(set(border)),
    }


def build_service_candidate(
    grid,
    cell_to_id,
    placement,
    rows,
    cols,
    type_index,
    effect_range,
    bonus,
    road_anchor_boundary_enabled=True,
):
    candidate = materialize_candidate_geometry(grid, cell_to_id, placement, rows, cols, road_anchor_boundary_enabled)
    if candidate is None:
        return None

    candidate["range"] = effect_range
    candidate["typeIndex"] = type_index
    candidate["bonus"] = bonus
    candidate["effect_zone"] = {
        cell_to_id[cell]
        for cell in service_effect_zone(grid, candidate["r"], candidate["c"], rows, cols, effect_range)
        if cell in cell_to_id
    }
    return candidate


def resolve_candidate_max_population(configured_max, base_population, total_bonus_upper_bound):
    if configured_max is None:
        return int(base_population) + total_bonus_upper_bound
    return int(configured_max)


def build_residential_candidate(
    grid,
    cell_to_id,
    placement,
    rows,
    cols,
    type_index,
    base_population,
    max_population,
    road_anchor_boundary_enabled=True,
):
    candidate = materialize_candidate_geometry(grid, cell_to_id, placement, rows, cols, road_anchor_boundary_enabled)
    if candidate is None:
        return None

    candidate["typeIndex"] = type_index
    candidate["base"] = int(base_population)
    candidate["max"] = int(max_population)
    return candidate


def enumerate_service_candidates(grid, params, cell_to_id, placement_map, road_anchor_boundary_enabled=True):
    candidates = []
    service_types = params.get("serviceTypes") or []
    for type_index in build_service_type_order(service_types):
        service_type = service_types[type_index]
        avail = int(service_type["avail"])
        if avail <= 0:
            continue
        effect_range = int(service_type["range"])
        bonus = int(service_type["bonus"])
        for rows, cols in service_type_orientations(service_type):
            for placement in placement_map.get(f"{rows}x{cols}", []):
                candidate = build_service_candidate(
                    grid,
                    cell_to_id,
                    placement,
                    rows,
                    cols,
                    type_index,
                    effect_range,
                    bonus,
                    road_anchor_boundary_enabled,
                )
                if candidate is not None:
                    candidates.append(candidate)
    return prune_dominated_service_candidates(candidates, params)


def enumerate_residential_candidates(
    grid,
    params,
    cell_to_id,
    total_bonus_upper_bound: int,
    placement_maps: CandidatePlacementMaps,
    road_anchor_boundary_enabled=True,
):
    candidates = []
    residential_types = params.get("residentialTypes")
    if residential_types:
        placement_map = placement_maps.residential
        for type_index, residential_type in enumerate(residential_types):
            avail = int(residential_type.get("avail", 0))
            if avail <= 0:
                continue
            base_population = int(residential_type["min"])
            max_population = resolve_candidate_max_population(
                residential_type.get("max"),
                base_population,
                total_bonus_upper_bound,
            )
            for rows, cols in residential_type_orientations(residential_type):
                for placement in placement_map.get(f"{rows}x{cols}", []):
                    candidate = build_residential_candidate(
                        grid,
                        cell_to_id,
                        placement,
                        rows,
                        cols,
                        type_index,
                        base_population,
                        max_population,
                        road_anchor_boundary_enabled,
                    )
                    if candidate is not None:
                        candidates.append(candidate)
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
        max_pop = resolve_candidate_max_population(size_setting.get("max", fallback_max), base, total_bonus_upper_bound)
        for placement in placement_map.get(f"{rows}x{cols}", []):
            candidate = build_residential_candidate(
                grid,
                cell_to_id,
                placement,
                rows,
                cols,
                NO_RESIDENTIAL_TYPE,
                base,
                max_pop,
                road_anchor_boundary_enabled,
            )
            if candidate is not None:
                candidates.append(candidate)
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
