from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model


@dataclass(frozen=True)
class CpSatTelemetry:
    solve_wall_time_seconds: float
    user_time_seconds: float
    solution_count: int
    incumbent_objective_value: float | None
    best_objective_bound: float | None
    objective_gap: float | None
    incumbent_population: int | None
    best_population_upper_bound: int | None
    population_gap_upper_bound: int | None
    last_improvement_at_seconds: float | None
    seconds_since_last_improvement: float | None
    num_branches: int
    num_conflicts: int


@dataclass(frozen=True)
class CpSatPortfolioWorkerSummary:
    worker_index: int
    random_seed: int | None
    randomize_search: bool
    num_workers: int
    status: str
    feasible: bool
    total_population: int | None


@dataclass(frozen=True)
class CpSatSolveResult:
    status: str
    feasible: bool
    objective_value: int | None
    total_population: int | None
    response: dict[str, Any] | None
    telemetry: CpSatTelemetry


@dataclass(frozen=True)
class CpSatPortfolioWorkerResult:
    summary: CpSatPortfolioWorkerSummary
    solve_result: CpSatSolveResult


class CpSatTelemetryCollector(cp_model.CpSolverSolutionCallback):
    def __init__(self, built=None, population_from_objective_value=None, progress_emitter=None, progress_interval_seconds=0.5):
        super().__init__()
        self._built = built
        self._population_from_objective_value = population_from_objective_value
        self._progress_emitter = progress_emitter
        self._progress_interval_seconds = float(progress_interval_seconds)
        self._last_progress_emit_at_seconds = None
        self.solution_count = 0
        self.last_improvement_at_seconds = None
        self.last_incumbent_objective_value = None
        self.last_incumbent_population = None
        self.last_best_objective_bound = None

    def on_solution_callback(self):
        self.solution_count += 1
        self.last_improvement_at_seconds = float(self.WallTime())
        self.last_incumbent_objective_value = float(self.ObjectiveValue())
        self.last_best_objective_bound = float(self.BestObjectiveBound())
        if self._built is not None:
            self.last_incumbent_population = int(self.Value(self._built.total_population))
        self._emit_progress("incumbent", force=True)

    def on_best_bound_callback(self, best_objective_bound):
        self.last_best_objective_bound = float(best_objective_bound)
        self._emit_progress("bound", force=False)

    def current_telemetry(self) -> CpSatTelemetry:
        best_population_upper_bound = None
        population_gap_upper_bound = None
        if self.last_best_objective_bound is not None and self._population_from_objective_value is not None and self._built is not None:
            best_population_upper_bound = self._population_from_objective_value(self.last_best_objective_bound, self._built.objective_policy)
            if best_population_upper_bound is not None and self.last_incumbent_population is not None:
                population_gap_upper_bound = max(0, best_population_upper_bound - self.last_incumbent_population)

        objective_gap = None
        if self.last_incumbent_objective_value is not None and self.last_best_objective_bound is not None:
            objective_gap = max(0.0, self.last_best_objective_bound - self.last_incumbent_objective_value)

        solve_wall_time_seconds = float(self.WallTime())
        seconds_since_last_improvement = None
        if self.last_improvement_at_seconds is not None:
            seconds_since_last_improvement = max(0.0, solve_wall_time_seconds - self.last_improvement_at_seconds)

        return CpSatTelemetry(
            solve_wall_time_seconds=solve_wall_time_seconds,
            user_time_seconds=float(self.UserTime()),
            solution_count=self.solution_count,
            incumbent_objective_value=self.last_incumbent_objective_value,
            best_objective_bound=self.last_best_objective_bound,
            objective_gap=objective_gap,
            incumbent_population=self.last_incumbent_population,
            best_population_upper_bound=best_population_upper_bound,
            population_gap_upper_bound=population_gap_upper_bound,
            last_improvement_at_seconds=self.last_improvement_at_seconds,
            seconds_since_last_improvement=seconds_since_last_improvement,
            num_branches=int(self.NumBranches()),
            num_conflicts=int(self.NumConflicts()),
        )

    def _emit_progress(self, kind: str, force: bool):
        if self._progress_emitter is None:
            return
        wall_time_seconds = float(self.WallTime())
        if (
            not force
            and self._last_progress_emit_at_seconds is not None
            and wall_time_seconds - self._last_progress_emit_at_seconds < self._progress_interval_seconds
        ):
            return
        self._last_progress_emit_at_seconds = wall_time_seconds
        self._progress_emitter(progress_payload(kind, telemetry=self.current_telemetry()))


def solver_status_name(status):
    return {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, f"STATUS_{status}")


def objective_policy_payload(policy):
    return {
        "populationWeight": policy.population_weight,
        "maxTieBreakPenalty": policy.max_tie_break_penalty,
        "summary": policy.tie_break_summary,
    }


def telemetry_payload(telemetry: CpSatTelemetry):
    return {
        "solveWallTimeSeconds": telemetry.solve_wall_time_seconds,
        "userTimeSeconds": telemetry.user_time_seconds,
        "solutionCount": telemetry.solution_count,
        "incumbentObjectiveValue": telemetry.incumbent_objective_value,
        "bestObjectiveBound": telemetry.best_objective_bound,
        "objectiveGap": telemetry.objective_gap,
        "incumbentPopulation": telemetry.incumbent_population,
        "bestPopulationUpperBound": telemetry.best_population_upper_bound,
        "populationGapUpperBound": telemetry.population_gap_upper_bound,
        "lastImprovementAtSeconds": telemetry.last_improvement_at_seconds,
        "secondsSinceLastImprovement": telemetry.seconds_since_last_improvement,
        "numBranches": telemetry.num_branches,
        "numConflicts": telemetry.num_conflicts,
    }


def portfolio_worker_summary_payload(summary: CpSatPortfolioWorkerSummary):
    return {
        "workerIndex": summary.worker_index,
        "randomSeed": summary.random_seed,
        "randomizeSearch": summary.randomize_search,
        "numWorkers": summary.num_workers,
        "status": summary.status,
        "feasible": summary.feasible,
        "totalPopulation": summary.total_population,
    }


def progress_payload(kind: str, telemetry: CpSatTelemetry | None = None, worker: CpSatPortfolioWorkerSummary | None = None):
    payload = {
        "event": "progress",
        "kind": kind,
    }
    if telemetry is not None:
        payload["telemetry"] = telemetry_payload(telemetry)
    if worker is not None:
        payload["worker"] = portfolio_worker_summary_payload(worker)
    return payload


def result_payload(response: dict[str, Any]):
    return {
        "event": "result",
        "payload": response,
    }


def collect_cp_sat_telemetry(solver, telemetry_collector: CpSatTelemetryCollector, status, built, population_from_objective_value):
    incumbent_objective_value = telemetry_collector.last_incumbent_objective_value
    incumbent_population = telemetry_collector.last_incumbent_population
    best_objective_bound = telemetry_collector.last_best_objective_bound
    best_population_upper_bound = None
    objective_gap = None
    population_gap_upper_bound = None

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        incumbent_objective_value = float(solver.ObjectiveValue())
        incumbent_population = int(solver.Value(built.total_population))
        best_objective_bound = float(solver.BestObjectiveBound())

    if incumbent_objective_value is not None and best_objective_bound is not None:
        objective_gap = max(0.0, best_objective_bound - incumbent_objective_value)

    if best_objective_bound is not None:
        best_population_upper_bound = population_from_objective_value(best_objective_bound, built.objective_policy)
        if best_population_upper_bound is not None and incumbent_population is not None:
            population_gap_upper_bound = max(0, best_population_upper_bound - incumbent_population)

    solve_wall_time_seconds = float(solver.WallTime())
    last_improvement_at_seconds = telemetry_collector.last_improvement_at_seconds
    seconds_since_last_improvement = None
    if last_improvement_at_seconds is not None:
        seconds_since_last_improvement = max(0.0, solve_wall_time_seconds - last_improvement_at_seconds)

    return CpSatTelemetry(
        solve_wall_time_seconds=solve_wall_time_seconds,
        user_time_seconds=float(solver.UserTime()),
        solution_count=telemetry_collector.solution_count,
        incumbent_objective_value=incumbent_objective_value,
        best_objective_bound=best_objective_bound,
        objective_gap=objective_gap,
        incumbent_population=incumbent_population,
        best_population_upper_bound=best_population_upper_bound,
        population_gap_upper_bound=population_gap_upper_bound,
        last_improvement_at_seconds=last_improvement_at_seconds,
        seconds_since_last_improvement=seconds_since_last_improvement,
        num_branches=int(solver.NumBranches()),
        num_conflicts=int(solver.NumConflicts()),
    )


def build_solution_response(solver, built, status_name: str, telemetry: CpSatTelemetry):
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

    return {
        "status": status_name,
        "roads": roads,
        "services": services,
        "residentials": residentials,
        "populations": populations,
        "totalPopulation": solver.Value(built.total_population),
        "objectivePolicy": objective_policy_payload(built.objective_policy),
        "telemetry": telemetry_payload(telemetry),
    }


def build_snapshot_response(snapshot_solution: dict[str, Any], built, status_name: str, telemetry: CpSatTelemetry, *, stopped_by_user: bool):
    return {
        **snapshot_solution,
        "status": status_name,
        "stoppedByUser": stopped_by_user,
        "objectivePolicy": objective_policy_payload(built.objective_policy),
        "telemetry": telemetry_payload(telemetry),
    }
