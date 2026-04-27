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

Current reviewed baseline as of 2026-04-27:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through the backend/planner path.
- `auto` follows the staged `greedy -> LNS -> CP-SAT` quality workflow.
- Benchmark and reproducibility support exists for exact-run comparison.
- LNS has deterministic/probabilistic neighborhoods, improvement guards, and budget controls.
- Greedy has phase boundaries, runtime guardrails, and phase-level quality/timing counters.
- Solve admission, route safety, and reusable solver-state hardening are in place.
- CP-SAT portfolio initiation is guarded and no longer competes with the default path by accident.
- Cross-mode progress, unified decision traces, JSONL trace export, time-to-quality scorecards, and budget-policy signals are available.
- Auto records per-stage run summaries, preserves final-stage LNS/CP-SAT trace detail, and protects the CP-SAT reserve from LNS seed/repair overruns.
- Cross-mode budget ablation sweeps can compare named Auto/LNS seed, repair, and CP-SAT reserve policies with policy-scoped trace output, optional harder coverage cases, and separate Auto/LNS baseline deltas.
- Final Greedy road materialization prunes redundant support roads while preserving row-0 connectivity and building access.
- Greedy profile counters now measure building connectivity shadow: row-0-reachable empty cells lost by each committed building footprint, split into footprint consumption and downstream disconnection.
- Planner saved-layout selection surfaces saved population so layout choices are score-oriented.

## Active Priorities

Impact scale: `5` is most significant for population per minute; lower scores are more speculative or dependent on earlier work.

Current ablation note as of 2026-04-27: the corrected 5s/30s, seed `7`, earlier three-case default sweep tied all built-in policies on Auto, LNS, and best population before `row0-corridor-repair-pressure` was added to the default corpus. The runner also has an opt-in `--coverage-corpus` that combines the current default corpus with selected harder Greedy/LNS pressure cases; keep the baseline policy until coverage-corpus seeds at 5s/30s, followed only by selective 120s probes, produce a population win rather than only lower stage elapsed time.

Coverage-corpus slice as of 2026-04-27: `--coverage-corpus --modes=auto,lns --budgets=5,30 --seeds=19 typed-footprint-pressure deferred-road-packing-gain service-local-neighborhood row0-anchor-repair` kept `baseline` as the best Auto policy. `repair-heavy` tied baseline on Auto and LNS means, while `seed-light` lost Auto population at 5s (`-27.5`) despite a 30s LNS mean lift (`+5`), and `cp-sat-reserve-heavy` lost 5s Auto population (`-14.5`). No selective 120s probe is justified from this slice alone.

Additional 5s pressure slices as of 2026-04-27: adding `row0-corridor-repair-pressure` and running seed `19` across Auto/Greedy/LNS kept `baseline` and `repair-heavy` tied on Auto/LNS population, while `seed-light` and `cp-sat-reserve-heavy` regressed. Running seed `37` across Auto/LNS kept `baseline` best, with `repair-heavy` tied, `seed-light` lower by `-11` Auto mean, and `cp-sat-reserve-heavy` lower by `-3` Auto mean. No 5s evidence supports changing the default policy.

Targeted 30s repair-heavy probe as of 2026-04-27: `row0-corridor-repair-pressure`, seed `37`, Auto/LNS, `baseline` versus `repair-heavy` tied at `275` Auto/LNS mean population. `repair-heavy` reached the same score faster, but the promotion gate is population, so keep `baseline` and skip 120s from this evidence.

Remaining 30s coverage-corpus slice as of 2026-04-27: `--coverage-corpus --modes=auto,lns --budgets=30 --seeds=37 --ablation-policies=baseline,seed-light,repair-heavy,cp-sat-reserve-heavy typed-footprint-pressure deferred-road-packing-gain service-local-neighborhood row0-anchor-repair` (`32` mode-runs, `960` budgeted mode-seconds) kept `baseline` as the top Auto policy. `seed-light` and `cp-sat-reserve-heavy` tied baseline on Auto mean (`320`) while lifting standalone LNS mean by `+12.5`; `repair-heavy` lifted standalone LNS by `+12.5` but regressed Auto mean by `-5`. This does not justify a selective 120s probe or default policy change.

| Rank | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| 1 | Connectivity-shadow-aware placement scoring | 4.5 | Use the new connectivity-shadow profile metric to identify and penalize placements that isolate future row-0-reachable space. | Placement scoring avoids buildings that isolate high-value future space without reducing population on benchmark cases. |
| 2 | Road opportunity-cost instrumentation | 3.5 | Explain road and building choices in terms of remaining row-0-reachable space, not just current road length. | Traces identify placements that preserve or destroy future connection options. |
| 3 | Deterministic ablations before model training | 4.0 | Run controlled heuristics experiments before learned ranking. | We know which features and phases actually move population. |
| 4 | Held Auto/LNS policy ablations | 3.5 | Keep baseline after the 5s/30s coverage slices; run 120s only if future cases show a real population win. | New evidence beats baseline on Auto/LNS population without extra wall-clock. |
| 5 | Low-risk learned ranking | 3.0 | Start with service ordering or LNS window ordering only after trace and ablation gates pass. | Model ranking beats deterministic baseline on held-out maps. |
| 6 | Planner explainability maps | 3.0 | Add opportunity/risk maps for placement and connectivity decisions. | Humans can inspect why a placement is attractive or dangerous. |
| 7 | CPU parallelism and portfolio work | 2.5 | Use parallelism only where CPU-normalized benchmarks prove wall-clock gain. | Higher population per wall-clock without hiding wasted CPU. |

## Combined Ordering

1. Use deterministic building connectivity-shadow / opportunity-cost metrics to guide placement scoring.
2. Instrument road opportunity cost in terms of remaining row-0-reachable space.
3. Run ablations for Greedy ordering, LNS neighborhoods, and Auto budgets.
4. Keep Auto/LNS policy ablations on hold unless future pressure cases show a population win over baseline.
5. Try learned Greedy service re-ranking if traces show ordering mistakes.
6. Add counterfactual LNS labels, then try learned LNS window re-ranking.
7. Add CPU portfolio or replay parallelism only with CPU-normalized benchmark wins.
8. Add planner explainability maps once the underlying metrics are stable.
9. Consider value-guided seeds if seed quality is proven to bottleneck LNS.
10. Keep distributed CP-SAT, bandits, and full RL for later.

## Discipline

- Roads are support cells, not blockers. The real blocker is building placement that prevents future buildings or available cells from reaching row `0`.
- Any available cell can be treated as a road candidate until a building occupies it.
- Buildings that touch row `0` are already connected by the anchor rule and must not keep unnecessary connector roads alive.
- Final road cleanup should remove support roads that do not affect row-0 road connectivity or building access.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Auto LNS stages must preserve any reserved CP-SAT time by capping seed and repair sub-budgets.
- Learned guidance is not ready until traces show repeated, explainable ranking mistakes and enough counterfactual labels exist.
- CPU parallelism is useful only when measured against wall-clock and CPU-second cost.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned.
