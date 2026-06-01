#!/usr/bin/env python3

import json
import os
import signal
import sys
import threading
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
from cp_sat_model_types import BuiltCpSatModel, CpSatCandidateBundle, CpSatCellIndex, ObjectivePolicy
from cp_sat_model_builder import build_model, population_from_objective_value
from cp_sat_candidates import (
    CandidatePlacementMaps,
    NO_RESIDENTIAL_TYPE,
    add_protected_reachable_border_cells,
    annotate_residential_population_upper_bounds,
    build_candidate_placement_maps,
    build_residential_candidate,
    build_service_candidate,
    build_service_type_order,
    collect_orientation_dimensions,
    collect_protected_road_cells,
    compute_total_population_upper_bound,
    enumerate_placements_for_types,
    enumerate_residential_candidates,
    enumerate_service_candidates,
    group_service_candidates_by_signature,
    infer_max_services,
    infer_service_slot_cap,
    is_dominated_service_candidate,
    iter_active_type_orientations,
    materialize_candidate_geometry,
    prune_dominated_service_candidates,
    prune_objectively_useless_service_candidates,
    rectangle_intersects_window,
    residential_candidate_key,
    residential_type_orientations,
    residential_type_priority,
    resolve_candidate_max_population,
    service_candidate_key,
    service_candidate_signature,
    service_type_orientations,
    service_type_priority,
    typed_service_bonus_upper_bound,
)
from cp_sat_grid import (
    build_blocked_prefix_sum,
    build_reachable_neighbor_map,
    enumerate_valid_placements,
    index_reachable_allowed_cells,
    is_allowed,
    is_prunable_road_cell,
    orthogonal_neighbors,
    reachable_allowed_from_road_anchors,
    rectangle_blocked_count,
    rectangle_border_cells,
    rectangle_cells,
    road_anchor_cells,
    service_effect_zone,
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
    build_border_access_capacity_coefficients,
    build_gate_regional_capacity_coefficients,
    compute_candidate_gate_requirements,
    compute_gate_downstream_cells,
    create_road_network_variables,
    hinted_root_ids_from_selected_roads,
    touches_road_anchor_boundary,
)
from cp_sat_warm_start import (
    ResolvedWarmStartSelection,
    apply_local_neighborhood_fixing,
    apply_objective_lower_bound,
    apply_warm_start_hints,
    build_residential_population_lookup,
    configure_solver_hint_parameters,
    extract_warm_start_hint_payloads,
    resolve_warm_start_hint_indices,
    resolve_warm_start_selection,
    select_hint_candidate_indices,
)


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


def normalize_optional_positive_seconds(timeout_seconds):
    if timeout_seconds in (None, ""):
        return None
    timeout_seconds = float(timeout_seconds)
    if timeout_seconds <= 0:
        return None
    return timeout_seconds


def install_stop_signal_handlers(request_stop):
    install_signal_handlers = threading.current_thread() is threading.main_thread()
    previous_sigterm = signal.getsignal(signal.SIGTERM) if install_signal_handlers else None
    previous_sigint = signal.getsignal(signal.SIGINT) if install_signal_handlers else None
    if install_signal_handlers:
        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)
    return install_signal_handlers, previous_sigterm, previous_sigint


def restore_stop_signal_handlers(install_signal_handlers, previous_sigterm, previous_sigint):
    if not install_signal_handlers:
        return
    signal.signal(signal.SIGTERM, previous_sigterm)
    signal.signal(signal.SIGINT, previous_sigint)


def build_feasible_snapshot_payload(solution, built: BuiltCpSatModel, telemetry: CpSatTelemetry, stopped_by_user: bool):
    return build_snapshot_response(
        solution,
        built,
        "FEASIBLE",
        telemetry,
        stopped_by_user=stopped_by_user,
    )


def write_feasible_snapshot(snapshot_file_path, solution, built: BuiltCpSatModel, telemetry: CpSatTelemetry, stopped_by_user: bool):
    if not snapshot_file_path:
        return
    write_snapshot(
        snapshot_file_path,
        build_feasible_snapshot_payload(solution, built, telemetry, stopped_by_user),
    )


def telemetry_objective_value_as_int(telemetry: CpSatTelemetry):
    if telemetry.incumbent_objective_value is None:
        return None
    return int(round(telemetry.incumbent_objective_value))


def build_completed_cp_sat_result(solver, built: BuiltCpSatModel, status_name: str, telemetry: CpSatTelemetry, stopped_by_user: bool):
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


def build_interrupted_cp_sat_result(solution, built: BuiltCpSatModel, telemetry: CpSatTelemetry, stopped_by_user: bool):
    response = build_feasible_snapshot_payload(solution, built, telemetry, stopped_by_user)
    return CpSatSolveResult(
        status="FEASIBLE",
        feasible=True,
        objective_value=telemetry_objective_value_as_int(telemetry),
        total_population=response["totalPopulation"],
        response=response,
        telemetry=telemetry,
    )


def build_unsolved_cp_sat_result(status_name: str, telemetry: CpSatTelemetry):
    return CpSatSolveResult(
        status=status_name,
        feasible=False,
        objective_value=None,
        total_population=None,
        response=None,
        telemetry=telemetry,
    )


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
    stopped_for_no_improvement = False
    stop_file_path = cp_sat_options.get("stopFilePath")
    snapshot_file_path = cp_sat_options.get("snapshotFilePath")
    no_improvement_timeout_seconds = normalize_optional_positive_seconds(cp_sat_options.get("noImprovementTimeoutSeconds"))
    no_improvement_timer = None
    solve_finished = False

    def request_stop(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    def should_stop() -> bool:
        return stop_requested or (bool(stop_file_path) and os.path.exists(stop_file_path))

    def cancel_no_improvement_timer():
        nonlocal no_improvement_timer
        if no_improvement_timer is None:
            return
        no_improvement_timer.cancel()
        no_improvement_timer = None

    def stop_for_no_improvement():
        nonlocal stopped_for_no_improvement
        if no_improvement_timeout_seconds is None or solve_finished or should_stop() or stopped_for_no_improvement:
            return
        stopped_for_no_improvement = True
        solver.StopSearch()

    def schedule_no_improvement_timer():
        nonlocal no_improvement_timer
        if no_improvement_timeout_seconds is None:
            return
        cancel_no_improvement_timer()
        no_improvement_timer = threading.Timer(no_improvement_timeout_seconds, stop_for_no_improvement)
        no_improvement_timer.daemon = True
        no_improvement_timer.start()

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
                write_feasible_snapshot(
                    snapshot_file_path,
                    self.latest_solution,
                    built,
                    self.current_telemetry(),
                    stopped_by_user=False,
                )
            if should_stop():
                stopped_by_user = True
                self.StopSearch()
                return
            if (
                self.last_incumbent_population is not None
                and self.last_incumbent_population >= built.total_population_upper_bound
            ):
                self.StopSearch()
                return
            schedule_no_improvement_timer()

    telemetry_collector = SnapshotTelemetryCollector()
    configure_solver_hint_parameters(solver, warm_start_hint)

    install_signal_handlers, previous_sigterm, previous_sigint = install_stop_signal_handlers(request_stop)
    try:
        def best_bound_callback(bound):
            nonlocal stopped_by_user
            if should_stop():
                stopped_by_user = True
                solver.StopSearch()
                return
            if progress_emitter is not None:
                telemetry_collector.on_best_bound_callback(bound)
            if snapshot_file_path and telemetry_collector.latest_solution is not None:
                write_feasible_snapshot(
                    snapshot_file_path,
                    telemetry_collector.latest_solution,
                    built,
                    telemetry_collector.current_telemetry(),
                    stopped_by_user=False,
                )

        solver.best_bound_callback = best_bound_callback
        if progress_emitter is not None and bool(cp_sat_options.get("logSearchProgress", False)):
            solver.log_callback = lambda message: print(message, file=sys.stderr, end="")

        status = solver.Solve(model, telemetry_collector)
    finally:
        solve_finished = True
        cancel_no_improvement_timer()
        restore_stop_signal_handlers(install_signal_handlers, previous_sigterm, previous_sigint)

    status_name = solver_status_name(status)
    telemetry = collect_cp_sat_telemetry(
        solver,
        telemetry_collector,
        status,
        built,
        population_from_objective_value,
    )

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return build_completed_cp_sat_result(solver, built, status_name, telemetry, stopped_by_user)

    if stopped_by_user and telemetry_collector.latest_solution is not None:
        return build_interrupted_cp_sat_result(
            telemetry_collector.latest_solution,
            built,
            telemetry,
            stopped_by_user=True,
        )

    if stopped_for_no_improvement and telemetry_collector.latest_solution is not None:
        return build_interrupted_cp_sat_result(
            telemetry_collector.latest_solution,
            built,
            telemetry,
            stopped_by_user=False,
        )

    return build_unsolved_cp_sat_result(status_name, telemetry)

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
            telemetry=solve_result.telemetry,
        ),
        solve_result=solve_result,
    )

def solve_cp_sat_portfolio(grid, params, cp_sat_options, progress_emitter=None):
    worker_options = build_portfolio_worker_options(cp_sat_options)
    snapshot_file_path = cp_sat_options.get("snapshotFilePath")
    stop_file_path = cp_sat_options.get("stopFilePath")
    best_snapshot_result = None
    completed_results = []

    def on_worker_result(result):
        nonlocal best_snapshot_result, completed_results
        completed_results.append(result)
        if progress_emitter is not None:
            progress_emitter(progress_payload("portfolio-worker-complete", worker=result.summary))
        if snapshot_file_path and result.solve_result.response is not None:
            candidate_is_better = best_snapshot_result is None
            if not candidate_is_better:
                candidate_is_better = select_best_portfolio_result([best_snapshot_result, result]) is result
            if candidate_is_better:
                best_snapshot_result = result
                completed_by_index = {
                    completed.summary.worker_index: completed
                    for completed in completed_results
                }
                worker_summaries = []
                for worker_index, worker_option in enumerate(worker_options):
                    completed = completed_by_index.get(worker_index)
                    if completed is not None:
                        worker_summaries.append(portfolio_worker_summary_payload(completed.summary))
                    else:
                        worker_summaries.append({
                            "workerIndex": worker_index,
                            "randomSeed": worker_option.get("randomSeed"),
                            "randomizeSearch": bool(worker_option.get("randomizeSearch", False)),
                            "numWorkers": int(worker_option.get("numWorkers", 1)),
                            "status": "RUNNING",
                            "feasible": False,
                            "totalPopulation": None,
                            "telemetry": None,
                        })
                write_snapshot(
                    snapshot_file_path,
                    {
                        **result.solve_result.response,
                        "portfolio": {
                            "workerCount": len(worker_options),
                            "selectedWorkerIndex": best_snapshot_result.summary.worker_index,
                            "workers": worker_summaries,
                        },
                        "stoppedByUser": bool(stop_file_path and os.path.exists(stop_file_path)),
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
