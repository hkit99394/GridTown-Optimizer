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

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- `auto` follows the incumbent-first `greedy -> LNS -> CP-SAT` workflow and protects CP-SAT reserve time from LNS seed/repair overruns.
- Cross-mode progress, decision traces, JSONL export, time-to-quality scorecards, and budget-policy signals are available for reproducible comparison.
- LNS has deterministic/probabilistic neighborhoods, improvement guards, and budget controls.
- Greedy has phase guardrails, profile counters, final road cleanup, connectivity-shadow traces, guarded opt-in connectivity-shadow scoring, and road-opportunity constructive/local-search counterfactuals.
- Planner saved-layout selection surfaces saved population so layout choices stay score-oriented.

## Active Priorities

Impact scale: `5` is most significant for population per minute; lower scores are more speculative or dependent on earlier work. Rank is the recommended execution order, not raw impact order; instrumentation can stay ahead of higher-impact experiments when it creates the labels or safety evidence those experiments need.

Current status notes:

- Auto/LNS budget policy: keep `baseline`. Recent 5s/30s coverage slices did not produce an Auto population win for non-baseline policies, so 120s probes stay gated.
- Connectivity-shadow scoring: keep default-off. The guarded opt-in path is population/road-safe on the focused corpus but can spend extra CPU.
- Road opportunity traces: constructive and local-search chosen-vs-near-miss counterfactuals are available, including accepted residential local-search and service-neighborhood move kinds.
- Deterministic ablations before model training are closed as an evidence gate; see [SOLVER_ABLATION_DECISIONS.md](SOLVER_ABLATION_DECISIONS.md). No deterministic variant is ready for default promotion. Blocked variants stay out of defaults, Greedy connectivity-shadow scoring is a label target, and LNS anchor/window variants require counterfactual replay labels before learned ranking.
- Low-risk learned ranking labels are closed as a label-collection gate; see `artifacts/learned-ranking-labels/2026-04-27/`. The bundle contains split-protected Greedy ordering labels and LNS replay labels with schema/audit metadata, but no model was trained and no defaults changed.
- Planner explainability maps are closed. Solve and manual-layout responses now include a first-class explainability grid, and the planner can switch between layout, service-value, placement-opportunity, and connectivity-risk map modes.
- CPU parallelism and portfolio work is closed as a measurement/safety gate; see `artifacts/cp-sat-portfolio/2026-04-28/`. Portfolio workers now preserve parseable JSON when search logging is requested, expose per-worker telemetry, and scorecards report CPU-normalized portfolio-vs-single signals. The measured tiny paired run tied population while spending extra CPU budget, and the larger failed artifact remains no-promotion evidence.

| Rank | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| - | No active solver priority | - | Keep the default path on Auto/Greedy/LNS. Pull a gated item forward only when its trigger fires. | New evidence changes a gated decision without regressing population per wall-clock. |

## Gated Priorities

These are not next actions. They need the trigger in the first column before moving back into the active table.

| Trigger | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| Future pressure cases show a population win over baseline | Auto/LNS policy ablations | 3.5 | Keep baseline after the 5s/30s coverage slices; run 120s only when a new focused slice beats baseline on population. | New evidence beats baseline on Auto/LNS population without extra wall-clock. |

## Combined Ordering

1. Try learned Greedy service re-ranking only if held-out labels and benchmarks justify it.
2. Try learned LNS window re-ranking only after replay labels are trustworthy.
3. Reconsider CPU portfolio or replay parallelism only with CPU-normalized benchmark wins.
4. Consider value-guided seeds if seed quality is proven to bottleneck LNS.
5. Keep distributed CP-SAT, bandits, and full RL for later.

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
