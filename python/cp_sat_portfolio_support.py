import concurrent.futures
import multiprocessing
import os
from concurrent.futures.process import BrokenProcessPool


def build_portfolio_worker_options(cp_sat_options):
    portfolio_options = cp_sat_options.get("portfolio") or {}
    explicit_seeds = portfolio_options.get("randomSeeds")
    if explicit_seeds:
        seeds = [int(seed) for seed in explicit_seeds]
    else:
        worker_count = max(1, int(portfolio_options.get("workerCount") or min(os.cpu_count() or 2, 4)))
        base_seed = int(cp_sat_options.get("randomSeed", 1))
        seeds = [base_seed + offset for offset in range(worker_count)]

    randomize_search = bool(portfolio_options.get("randomizeSearch", True))
    worker_options = []
    for seed in seeds:
        worker_option = dict(cp_sat_options)
        worker_option.pop("portfolio", None)
        worker_option["numWorkers"] = int(portfolio_options.get("perWorkerNumWorkers") or 1)
        worker_option["randomSeed"] = int(seed)
        worker_option["randomizeSearch"] = randomize_search
        if portfolio_options.get("perWorkerTimeLimitSeconds") is not None:
            worker_option["timeLimitSeconds"] = float(portfolio_options["perWorkerTimeLimitSeconds"])
        if portfolio_options.get("perWorkerMaxDeterministicTime") is not None:
            worker_option["maxDeterministicTime"] = float(portfolio_options["perWorkerMaxDeterministicTime"])
        worker_options.append(worker_option)
    return worker_options


def select_best_portfolio_result(results):
    feasible_results = [result for result in results if result.summary.feasible]
    if not feasible_results:
        return None

    status_rank = {"OPTIMAL": 2, "FEASIBLE": 1}
    return max(
        feasible_results,
        key=lambda result: (
            int(result.solve_result.objective_value),
            status_rank.get(result.solve_result.status, 0),
            -int(result.summary.worker_index),
        ),
    )


def run_portfolio_workers(grid, params, worker_options, worker_task):
    max_workers = max(1, len(worker_options))
    def run_with_executor(executor_factory):
        results = []
        with executor_factory() as executor:
            futures = [
                executor.submit(worker_task, grid, params, worker_option, worker_index)
                for worker_index, worker_option in enumerate(worker_options)
            ]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
        return results

    process_factory = lambda: concurrent.futures.ProcessPoolExecutor(
        max_workers=max_workers,
        mp_context=multiprocessing.get_context("spawn"),
    )
    thread_factory = lambda: concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)

    try:
        return run_with_executor(process_factory)
    except (PermissionError, BrokenProcessPool):
        return run_with_executor(thread_factory)
