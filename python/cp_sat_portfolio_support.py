import concurrent.futures
import multiprocessing
import os
from concurrent.futures.process import BrokenProcessPool

MAX_PORTFOLIO_WORKERS = 8
MAX_PORTFOLIO_WORKER_THREADS = 8
MAX_PORTFOLIO_TOTAL_CPU_SECONDS = 8 * 60 * 60
MAX_CP_SAT_NUM_WORKERS = 64
MAX_CP_SAT_TIME_LIMIT_SECONDS = 24 * 60 * 60
MAX_CP_SAT_RANDOM_SEED = 0x7FFFFFFF


def _is_int_value(value):
    return not isinstance(value, bool) and isinstance(value, int)


def _require_int_range(value, path, minimum, maximum):
    if not _is_int_value(value) or value < minimum or value > maximum:
        raise ValueError(f"{path} must be an integer between {minimum} and {maximum}.")
    return value


def _optional_int_range(options, key, path, minimum, maximum, fallback=None):
    if key not in options or options.get(key) is None:
        return fallback
    return _require_int_range(options.get(key), path, minimum, maximum)


def _require_positive_float(value, path, maximum):
    if isinstance(value, bool):
        raise ValueError(f"{path} must be a finite number > 0 and <= {maximum}.")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{path} must be a finite number > 0 and <= {maximum}.")
    if not parsed > 0 or parsed > maximum:
        raise ValueError(f"{path} must be a finite number > 0 and <= {maximum}.")
    return parsed


def _optional_positive_float(options, key, path, maximum, fallback=None):
    if key in options and options.get(key) is not None:
        return _require_positive_float(options.get(key), path, maximum)
    if fallback is None:
        return None
    return _require_positive_float(fallback, path, maximum)


def _optional_bool(options, key, fallback):
    if key not in options or options.get(key) is None:
        return fallback
    value = options.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean.")
    return value


def _build_portfolio_seeds(cp_sat_options, portfolio_options):
    explicit_seeds = portfolio_options.get("randomSeeds")
    if explicit_seeds is not None:
        if not isinstance(explicit_seeds, list):
            raise ValueError("portfolio.randomSeeds must be an array.")
        if len(explicit_seeds) == 0 or len(explicit_seeds) > MAX_PORTFOLIO_WORKERS:
            raise ValueError(f"portfolio.randomSeeds must contain between 1 and {MAX_PORTFOLIO_WORKERS} seeds.")
        seeds = [
            _require_int_range(seed, f"portfolio.randomSeeds[{index}]", 0, MAX_CP_SAT_RANDOM_SEED)
            for index, seed in enumerate(explicit_seeds)
        ]
        if len(set(seeds)) != len(seeds):
            raise ValueError("portfolio.randomSeeds must not contain duplicate seeds.")
        return seeds

    default_worker_count = min(os.cpu_count() or 2, 4)
    worker_count = _optional_int_range(
        portfolio_options,
        "workerCount",
        "portfolio.workerCount",
        1,
        MAX_PORTFOLIO_WORKERS,
        fallback=default_worker_count,
    )
    base_seed = _optional_int_range(
        cp_sat_options,
        "randomSeed",
        "randomSeed",
        0,
        MAX_CP_SAT_RANDOM_SEED,
        fallback=1,
    )
    seeds = [base_seed + offset for offset in range(worker_count)]
    if seeds[-1] > MAX_CP_SAT_RANDOM_SEED:
        raise ValueError(f"portfolio generated random seeds must be <= {MAX_CP_SAT_RANDOM_SEED}.")
    return seeds


def build_portfolio_worker_options(cp_sat_options):
    if not isinstance(cp_sat_options, dict):
        raise ValueError("cpSat options must be an object.")
    portfolio_options = cp_sat_options.get("portfolio") or {}
    if not isinstance(portfolio_options, dict):
        raise ValueError("portfolio must be an object.")
    seeds = _build_portfolio_seeds(cp_sat_options, portfolio_options)
    _optional_int_range(
        portfolio_options,
        "workerCount",
        "portfolio.workerCount",
        1,
        MAX_PORTFOLIO_WORKERS,
    )

    randomize_search = _optional_bool(portfolio_options, "randomizeSearch", True)
    per_worker_num_workers = _optional_int_range(
        portfolio_options,
        "perWorkerNumWorkers",
        "portfolio.perWorkerNumWorkers",
        1,
        MAX_CP_SAT_NUM_WORKERS,
        fallback=1,
    )

    requested_worker_threads = len(seeds) * per_worker_num_workers
    if requested_worker_threads > MAX_PORTFOLIO_WORKER_THREADS:
        raise ValueError(
            f"CP-SAT portfolio requests {requested_worker_threads} parallel CP-SAT workers, exceeding the {MAX_PORTFOLIO_WORKER_THREADS} worker portfolio limit."
        )

    per_worker_time_limit = _optional_positive_float(
        portfolio_options,
        "perWorkerTimeLimitSeconds",
        "portfolio.perWorkerTimeLimitSeconds",
        MAX_CP_SAT_TIME_LIMIT_SECONDS,
        fallback=cp_sat_options.get("timeLimitSeconds"),
    )
    if per_worker_time_limit is None:
        raise ValueError("CP-SAT portfolio requires timeLimitSeconds or portfolio.perWorkerTimeLimitSeconds.")

    total_cpu_budget = _optional_positive_float(
        portfolio_options,
        "totalCpuBudgetSeconds",
        "portfolio.totalCpuBudgetSeconds",
        MAX_PORTFOLIO_TOTAL_CPU_SECONDS,
        fallback=MAX_PORTFOLIO_TOTAL_CPU_SECONDS,
    )
    requested_cpu_seconds = len(seeds) * per_worker_num_workers * per_worker_time_limit
    if requested_cpu_seconds > total_cpu_budget:
        raise ValueError(
            f"CP-SAT portfolio requests {requested_cpu_seconds} total CPU seconds, exceeding the {total_cpu_budget} second portfolio budget."
        )

    worker_options = []
    for seed in seeds:
        worker_option = dict(cp_sat_options)
        worker_option.pop("portfolio", None)
        worker_option.pop("snapshotFilePath", None)
        worker_option["numWorkers"] = per_worker_num_workers
        worker_option["randomSeed"] = int(seed)
        worker_option["randomizeSearch"] = randomize_search
        worker_option["timeLimitSeconds"] = per_worker_time_limit
        worker_option["logSearchProgress"] = False
        if portfolio_options.get("perWorkerMaxDeterministicTime") is not None:
            per_worker_deterministic_time = _optional_positive_float(
                portfolio_options,
                "perWorkerMaxDeterministicTime",
                "portfolio.perWorkerMaxDeterministicTime",
                MAX_CP_SAT_TIME_LIMIT_SECONDS,
            )
            worker_option["maxDeterministicTime"] = per_worker_deterministic_time
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


def run_portfolio_workers(grid, params, worker_options, worker_task, on_result=None):
    max_workers = max(1, len(worker_options))
    def run_with_executor(executor_factory):
        results = []
        with executor_factory() as executor:
            futures = [
                executor.submit(worker_task, grid, params, worker_option, worker_index)
                for worker_index, worker_option in enumerate(worker_options)
            ]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                results.append(result)
                if on_result is not None:
                    on_result(result)
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
