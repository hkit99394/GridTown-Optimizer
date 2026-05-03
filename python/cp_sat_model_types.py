from dataclasses import dataclass
from typing import Any

from cp_sat_candidates import CandidatePlacementMaps


@dataclass(frozen=True)
class ObjectivePolicy:
    population_weight: int
    max_tie_break_penalty: int
    tie_break_summary: str


@dataclass(frozen=True)
class BuiltCpSatModel:
    model: Any
    allowed_cells: list[tuple[int, int]]
    anchor_ids: list[int]
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
class CpSatCellIndex:
    reachable_allowed: set[tuple[int, int]]
    road_eligible_cells: set[tuple[int, int]]
    allowed_cells: list[tuple[int, int]]
    cell_to_id: dict[tuple[int, int], int]
    id_to_cell: dict[int, tuple[int, int]]
    anchor_ids: list[int]
    road_eligible_ids: set[int]


@dataclass(frozen=True)
class CpSatCandidateBundle:
    placement_maps: CandidatePlacementMaps
    service_candidates: list[dict[str, Any]]
    residential_candidates: list[dict[str, Any]]
    total_population_upper_bound: int
