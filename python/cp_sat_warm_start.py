import sys
from dataclasses import dataclass
from typing import Any

from cp_sat_candidates import (
    rectangle_intersects_window,
    residential_candidate_key,
    service_candidate_key,
)
from cp_sat_road_model import hinted_root_ids_from_selected_roads


@dataclass(frozen=True)
class ResolvedWarmStartSelection:
    solution: dict[str, Any]
    selected_road_ids: set[int]
    selected_service_ids: set[int]
    selected_residential_ids: set[int]
    residential_population_by_key: dict[str, int]


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def extract_warm_start_hint_payloads(warm_start_hint):
    solution = warm_start_hint.get("solution") or {}
    road_keys = {
        str(key)
        for key in (warm_start_hint.get("roads") or warm_start_hint.get("roadKeys") or solution.get("roads") or [])
    }
    service_keys = {str(key) for key in warm_start_hint.get("serviceCandidateKeys") or []}
    residential_keys = {str(key) for key in warm_start_hint.get("residentialCandidateKeys") or []}
    service_hints = list(warm_start_hint.get("services") or solution.get("services") or [])
    residential_hints = list(warm_start_hint.get("residentials") or solution.get("residentials") or [])
    return solution, road_keys, service_keys, residential_keys, service_hints, residential_hints


def build_residential_population_lookup(residential_hints):
    residential_population_by_key = {}
    for residential in residential_hints:
        key = residential_candidate_key(residential)
        residential_population_by_key[key] = int(residential.get("population", 0))
    return residential_population_by_key


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
                matches = [
                    candidate_index
                    for candidate_index in matches
                    if candidates[candidate_index]["typeIndex"] == int(hint["typeIndex"])
                ]
            if hint.get("range") is not None:
                matches = [
                    candidate_index
                    for candidate_index in matches
                    if candidates[candidate_index]["range"] == int(hint["range"])
                ]
            if hint.get("bonus") is not None:
                matches = [
                    candidate_index
                    for candidate_index in matches
                    if candidates[candidate_index]["bonus"] == int(hint["bonus"])
                ]
        else:
            if hint.get("typeIndex") is not None:
                matches = [
                    candidate_index
                    for candidate_index in matches
                    if candidates[candidate_index]["typeIndex"] == int(hint["typeIndex"])
                ]
        if len(matches) == 1:
            selected_indices.add(matches[0])
    return selected_indices


def resolve_warm_start_hint_indices(
    built,
    road_keys,
    service_keys,
    residential_keys,
    service_hints,
    residential_hints,
):
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
    return selected_road_ids, selected_service_ids, selected_residential_ids


def resolve_warm_start_selection(built, warm_start_hint) -> ResolvedWarmStartSelection:
    (
        solution,
        road_keys,
        service_keys,
        residential_keys,
        service_hints,
        residential_hints,
    ) = extract_warm_start_hint_payloads(warm_start_hint)
    selected_road_ids, selected_service_ids, selected_residential_ids = resolve_warm_start_hint_indices(
        built,
        road_keys,
        service_keys,
        residential_keys,
        service_hints,
        residential_hints,
    )
    return ResolvedWarmStartSelection(
        solution=solution,
        selected_road_ids=selected_road_ids,
        selected_service_ids=selected_service_ids,
        selected_residential_ids=selected_residential_ids,
        residential_population_by_key=build_residential_population_lookup(residential_hints),
    )


def apply_objective_lower_bound(model, built, objective_lower_bound):
    if objective_lower_bound is None:
        return
    lower_bound = int(objective_lower_bound)
    if lower_bound > built.total_population_upper_bound:
        fail(
            f"Objective lower bound {lower_bound} exceeds the model upper bound {built.total_population_upper_bound}."
        )
    model.Add(built.total_population >= lower_bound)


def configure_solver_hint_parameters(solver, warm_start_hint):
    if not warm_start_hint:
        return
    repair_hint = warm_start_hint.get("repairHint")
    if repair_hint not in (None, ""):
        solver.parameters.repair_hint = bool(repair_hint)
    fix_variables = warm_start_hint.get("fixVariablesToHintedValue")
    if fix_variables not in (None, ""):
        solver.parameters.fix_variables_to_their_hinted_value = bool(fix_variables)
    hint_conflict_limit = warm_start_hint.get("hintConflictLimit")
    if hint_conflict_limit not in (None, ""):
        solver.parameters.hint_conflict_limit = int(hint_conflict_limit)


def apply_warm_start_hints(model, built, warm_start_hint):
    if not warm_start_hint:
        return
    warm_start_selection = resolve_warm_start_selection(built, warm_start_hint)

    for cell_id, variable in enumerate(built.road_vars):
        model.AddHint(variable, 1 if cell_id in warm_start_selection.selected_road_ids else 0)

    hinted_root_ids = hinted_root_ids_from_selected_roads(built, warm_start_selection.selected_road_ids)
    if hinted_root_ids:
        for cell_id, variable in built.root_vars.items():
            model.AddHint(variable, 1 if cell_id in hinted_root_ids else 0)

    for candidate_index, variable in enumerate(built.service_vars):
        model.AddHint(variable, 1 if candidate_index in warm_start_selection.selected_service_ids else 0)

    for candidate_index, variable in enumerate(built.residential_vars):
        model.AddHint(variable, 1 if candidate_index in warm_start_selection.selected_residential_ids else 0)
        candidate = built.residential_candidates[candidate_index]
        key = residential_candidate_key(candidate)
        population = warm_start_selection.residential_population_by_key.get(key, 0)
        model.AddHint(built.populations[candidate_index], population)

    if warm_start_selection.selected_road_ids:
        model.AddHint(built.total_roads, len(warm_start_selection.selected_road_ids))
    if (
        warm_start_selection.selected_service_ids
        or warm_start_hint.get("services")
        or warm_start_hint.get("serviceCandidateKeys")
        or warm_start_selection.solution.get("services")
    ):
        model.AddHint(built.total_services, len(warm_start_selection.selected_service_ids))
    hinted_total_population = warm_start_hint.get("totalPopulation", warm_start_selection.solution.get("totalPopulation"))
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


def apply_local_neighborhood_fixing(model, built, warm_start_hint):
    if not warm_start_hint or not bool(warm_start_hint.get("fixOutsideNeighborhoodToHintedValue")):
        return

    neighborhood_window = warm_start_hint.get("neighborhoodWindow") or {}
    rows = int(neighborhood_window.get("rows", 0) or 0)
    cols = int(neighborhood_window.get("cols", 0) or 0)
    if rows <= 0 or cols <= 0:
        return

    warm_start_selection = resolve_warm_start_selection(built, warm_start_hint)

    top = int(neighborhood_window.get("top", 0))
    left = int(neighborhood_window.get("left", 0))
    bottom = top + rows
    right = left + cols

    for cell_id, variable in enumerate(built.road_vars):
        r, c = built.allowed_cells[cell_id]
        if top <= r < bottom and left <= c < right:
            continue
        model.Add(variable == (1 if cell_id in warm_start_selection.selected_road_ids else 0))

    hinted_root_ids = hinted_root_ids_from_selected_roads(built, warm_start_selection.selected_road_ids)
    if hinted_root_ids:
        for cell_id, variable in built.root_vars.items():
            r, c = built.allowed_cells[cell_id]
            if top <= r < bottom and left <= c < right:
                continue
            model.Add(variable == (1 if cell_id in hinted_root_ids else 0))

    for candidate_index, variable in enumerate(built.service_vars):
        candidate = built.service_candidates[candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in warm_start_selection.selected_service_ids else 0))

    for candidate_index, variable in enumerate(built.residential_vars):
        candidate = built.residential_candidates[candidate_index]
        if rectangle_intersects_window(candidate, neighborhood_window):
            continue
        model.Add(variable == (1 if candidate_index in warm_start_selection.selected_residential_ids else 0))
