# Solver Roadmap

## Goal

Maximize feasible city population under fixed wall-clock and CPU budgets, while preserving exact validation for every reported final layout.

The current strategy is intentionally conservative:

- Keep `auto` as the default quality path.
- Use Greedy for fast incumbents and diagnostics.
- Use LNS as the main improvement engine.
- Use CP-SAT for exact repair, polish, proof, bounds, labels, and semantic checks.
- Promote learned guidance, portfolio, GPU, distributed solving, or external solvers only after protected equal-budget evidence says they help.

Primary metrics are time to first feasible, population at 1s/5s/30s/120s, time to best, improvement per CPU-second, CP-SAT status/gap, repeatability across fixed seeds and planner workflows, and exact validation.

## Runtime Posture

The default solver path is incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof.
4. `auto` orchestrates the budget and keeps the best incumbent.

| Mode | Role | Default Use |
| --- | --- | --- |
| `auto` | Main quality path | Recommended solver mode |
| `greedy` | Fast incumbent and diagnostics | Seed generation, baseline, counterfactual traces |
| `LNS` | Main improvement engine | Adaptive repair around incumbent layouts |
| `CP-SAT` | Exact backend | Small proofs, local repairs, bounded polishing, semantic checks |
| CP-SAT portfolio | Explicit research mode | Only after CPU-normalized wins over single CP-SAT |
| Learned guidance | Future feature-flag path | Only after offline and online holdout gates pass |

## Current Baseline

Completed details live in [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md). The short version:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- Planner workflows now cover solve, inspect, edit, validate, reuse, explainability maps, saved layouts, and expansion comparison.
- CP-SAT road semantics are aligned with the formal per-component anchor rule, and the 2026-04-30 road-semantics scorecard reached `OPTIMAL` on the six-case single-worker suite.
- LNS has adaptive semantic operators, replay labels, budget controls, and telemetry.
- Auto uses trace-tuned LNS budget defaults while preserving the measured `0.2` CP-SAT reserve default and explicit caller overrides.
- Cross-mode scorecards, product-corpus artifacts, telemetry manifests, workflow replay artifacts, and experiment-registry draft paths exist for promotion evidence.
- Low-risk learned-ranking labels and a CPU-first Greedy offline ranker exist for diagnostics only. No learned runtime scorer has been promoted.
- CP-SAT portfolio, exact small-window DP repair, and service-master decomposition remain guarded or opt-in; they are not default Auto behavior.

## Active Priorities

No active next-stage solver priority is open after the CPU-first Greedy offline ranker closeout.

New solver work should move out of the gated table only when its trigger is satisfied. Until then, the right action is to preserve the current default posture and collect stronger evidence where a gate asks for it.

## Gated Priorities

These are not next actions by default. They become active only when their trigger is satisfied.

| Trigger | Candidate Work | Success Signal |
| --- | --- | --- |
| CP-SAT semantics and product corpus stay stable, and exact search quality remains a bottleneck | Geometry-native CP-SAT / `NoOverlap2D` experiment | Better propagation or time-to-best without model-size blowup. |
| Service-master scorecards show repeatable equal-budget wins | Promote service-master into Auto or Greedy seed policy | Beats current Auto or Greedy seed path on development and holdout pressure families with evaluator-valid layouts. |
| Strict LNS label artifacts pass readiness and offline baselines | Learned LNS window ranking | Offline holdout beats deterministic, random, and single-feature baselines; online A/B improves fixed-budget quality without worst-decile regression. |
| Greedy offline ranker evidence is paired with online equal-budget wins | Feature-flagged learned Greedy re-ranking | Online seeded benchmarks improve population or time-to-best with bounded inference overhead. |
| Portfolio scorecards show wall-clock and CPU-normalized wins | CP-SAT portfolio in Auto | Portfolio beats single CP-SAT on quality and CPU efficiency. |
| A CPU-first label, training, feature, or inference workflow becomes a measured bottleneck | GPU acceleration | GPU reduces the measured bottleneck while preserving solver quality gates. |
| Hosted or multi-user execution becomes a product requirement | Durable worker architecture | Status, cancellation, and snapshots survive process restarts and multi-instance routing. |
| Exact bounds or incumbents remain blocked after CP-SAT tuning | External MILP/SCIP/Gurobi/cuOpt research adapter | Better bounds or incumbents on selected families under exact evaluator validation. |

## Promotion Gates

Any default-path solver change must include:

- Exact validation for all final layouts.
- At least 3 fixed seeds.
- 1s, 5s, 30s, and 120s budget reporting when relevant.
- Protected development and holdout scorecards.
- Median population improvement, or equal population with at least 10% faster time-to-best.
- Worst-decile population delta `>= 0` unless a reviewed exception is documented.
- Regression rate `<= 5%`.
- CPU-budget efficiency no worse than 10% below baseline unless population improvement justifies it.
- Registered benchmark, hardware, split, command, model, artifact, and decision metadata.

## Guardrails

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity; solver backends and validators must agree.
- Final road cleanup should remove only roads that do not affect building access or anchor-boundary road connectivity.
- Auto LNS stages must preserve reserved CP-SAT time unless a future trace-backed policy changes that.
- Learned guidance is not ready until traces show repeated ranking mistakes and enough counterfactual labels exist.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism must be measured against both wall-clock and CPU-second cost.
- Distributed solving should wait until hosting requires durable jobs or single-machine policy is no longer the bottleneck.
