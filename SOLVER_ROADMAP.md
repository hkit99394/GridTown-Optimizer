# Solver Roadmap

## Goal

Maximize population under a fixed wall-clock budget.

Primary target: highest population with the least time consumed. We judge solver changes by:

- Time to first feasible incumbent.
- Population at fixed checkpoints: 5s, 30s, 120s.
- Time to best solution.
- Improvement per extra CPU-second.
- Exact gap or upper bound when CP-SAT is used.
- Repeatability across fixed seeds and benchmark maps.

## Runtime Posture

The default quality path stays incumbent-first:

1. Build a strong feasible incumbent with `greedy`.
2. Improve cheaply with `LNS`.
3. Use `CP-SAT` only for bounded deep improvement or proof.
4. Let `auto` orchestrate solver choice under a time budget.
5. Keep raw `greedy`, `LNS`, and `CP-SAT` modes available for experiments.

| Mode | Role | Default Use |
| --- | --- | --- |
| `auto` | Main production mode | Best effort population per wall-clock budget |
| `greedy` | Fast incumbent | Baseline, diagnostics, seed generation |
| `LNS` | Main improvement engine | Repeated neighborhood repair around incumbent |
| `CP-SAT` | Deep improvement/proof | Small instances, bounded repairs, exact checks |
| CP-SAT portfolio | Later optimization | Only after single-worker Auto/LNS is trace-tuned |

## Delivered Baseline

Completed solver work has moved to [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md).

Current shipped baseline:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through the backend/planner path.
- `auto` follows the staged `greedy -> LNS -> CP-SAT` quality workflow.
- Benchmark and reproducibility support exists for exact-run comparison.
- LNS has deterministic/probabilistic neighborhoods, improvement guards, and budget controls.
- Greedy has phase boundaries, runtime guardrails, and phase-level quality/timing counters.
- Solve admission, route safety, and reusable solver-state hardening are in place.
- CP-SAT portfolio initiation is guarded and no longer competes with the default path by accident.
- Cross-mode progress and benchmark scorecards are available.

## Active Priorities

Impact scale: `5` is most significant for population per minute; lower scores are more speculative or dependent on earlier work.

| Rank | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| 1 | Shared decision traces and time-to-quality scorecards | 5.0 | Add unified JSONL traces for Greedy, LNS, CP-SAT, and Auto decisions. | We can explain why population improved or stalled at each checkpoint. |
| 2 | Building connectivity-shadow analysis | 4.5 | Measure how each proposed building placement reduces future feasible connected cells. | Placement scoring avoids buildings that isolate high-value future space. |
| 3 | Deterministic ablations before model training | 4.0 | Run controlled heuristics experiments before learned ranking. | We know which features and phases actually move population. |
| 4 | Tune Auto and LNS budget policy from traces | 4.0 | Reallocate time between Greedy, LNS, CP-SAT, restarts, and neighborhoods. | Better checkpoint population without more wall-clock time. |
| 5 | Low-risk learned ranking | 3.0 | Start with service ordering or LNS window ordering only after trace gates pass. | Model ranking beats deterministic baseline on held-out maps. |
| 6 | Planner explainability maps | 3.0 | Add opportunity/risk maps for placement and connectivity decisions. | Humans can inspect why a placement is attractive or dangerous. |
| 7 | CPU parallelism and portfolio work | 2.5 | Use parallelism only where CPU-normalized benchmarks prove wall-clock gain. | Higher population per wall-clock without hiding wasted CPU. |

## Combined Ordering

1. Add shared decision traces and time-to-quality scorecards.
2. Add deterministic building connectivity-shadow / opportunity-cost maps.
3. Run ablations for Greedy ordering, LNS neighborhoods, and Auto budgets.
4. Tune Auto and LNS budget allocation from trace results.
5. Try learned Greedy service re-ranking if traces show ordering mistakes.
6. Add counterfactual LNS labels, then try learned LNS window re-ranking.
7. Add CPU portfolio or replay parallelism only with CPU-normalized benchmark wins.
8. Add planner explainability maps once the underlying metrics are stable.
9. Consider value-guided seeds if seed quality is proven to bottleneck LNS.
10. Keep distributed CP-SAT, bandits, and full RL for later.

## Discipline

- Roads are support cells, not blockers. The real blocker is building placement that prevents future buildings or available cells from reaching row `0`.
- Any available cell can be treated as a road candidate until a building occupies it.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Learned guidance is not ready until traces show repeated, explainable ranking mistakes and enough counterfactual labels exist.
- CPU parallelism is useful only when measured against wall-clock and CPU-second cost.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned.
