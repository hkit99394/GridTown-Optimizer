# Solver Roadmap

## Goal

Maximize feasible city population under a fixed wall-clock and CPU budget.

The solver roadmap is now centered on the fastest path to better solutions:

1. Keep `auto` as the default quality path.
2. Keep CP-SAT aligned with the formal problem semantics.
3. Make LNS adaptive and evidence-driven.
4. Expand benchmark coverage around planner workflows and pressure cases.
5. Promote learned guidance, portfolio, GPU, distributed solving, or alternative solvers only after protected equal-budget evidence says they help.

Primary metrics:

- Time to first feasible incumbent.
- Population at fixed checkpoints: 1s, 5s, 30s, 120s.
- Time to best solution.
- Improvement per extra CPU-second.
- CP-SAT status, upper bound, and population gap when available.
- Repeatability across fixed seeds, map families, and planner workflows.
- Exact validation of every reported final layout.

## Runtime Posture

The default path stays incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof.
4. `auto` orchestrates the budget and keeps the best incumbent.
5. Standalone `greedy`, `LNS`, `CP-SAT`, and explicit portfolio modes remain experiment tools.

| Mode | Role | Default Use |
| --- | --- | --- |
| `auto` | Main quality path | Best feasible population per wall-clock budget |
| `greedy` | Fast incumbent and diagnostics | Seed generation, baseline, counterfactual traces |
| `LNS` | Main improvement engine | Adaptive repair around incumbent layouts |
| `CP-SAT` | Exact backend | Small proofs, local repairs, bounded polishing, model-alignment checks |
| CP-SAT portfolio | Explicit research mode | Only after CPU-normalized scorecards beat single CP-SAT |
| Learned guidance | Future feature-flag path | Only after offline and online holdout gates pass |

## Delivered Baseline

Completed solver work has moved to [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md).

Current reviewed baseline:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- `auto` follows the incumbent-first `greedy -> LNS -> CP-SAT` workflow and preserves bounded CP-SAT reserve time.
- Cross-mode progress, decision traces, JSONL export, time-to-quality scorecards, and budget-policy signals are available for reproducible comparison.
- LNS has deterministic/probabilistic neighborhoods, improvement guards, replay labels, and budget controls.
- Greedy has phase guardrails, profile counters, final road cleanup, connectivity-shadow traces, guarded opt-in connectivity-shadow scoring, and road-opportunity counterfactuals.
- Experiment registry hardening exists through validation/check tooling, append helpers, and strict metadata gates.
- Planner explainability, saved layouts, manual validation, continuation hints, and expansion comparison create a real product loop around the solver.
- The 2026-04-28 health check passed `npm test`; Auto matched the best population on the four 5s seed-7 default scorecard cases.
- CP-SAT portfolio measurement tied single CP-SAT on the tiny paired run while spending more configured worker CPU, so portfolio remains explicit-only.
- Low-risk learned-ranking labels exist for offline diagnostics only; no model has been trained or promoted.
- CP-SAT road-semantics alignment and scorecard closeout are delivered. The 2026-04-30 six-case single-worker scorecard reached `OPTIMAL` on tiny, corridor, gate, service-pressure, multi-anchor, and dense saturated families.

## Strategic Shift

The next stage is not "train first" or "add more modes." The next stage is:

1. Verify that the exact backend encodes the same road semantics as the formal spec and TypeScript validator.
2. Use adaptive LNS as the main time-to-good-solution engine.
3. Turn the benchmark and experiment registry into the promotion gate for every solver change.
4. Measure the planner's actual workflow: solve, inspect, edit, validate, reuse, compare next addition.

Reasoning:

- The problem is a hybrid of rectangle packing, set packing, service/facility coverage, and road-network design.
- CP-SAT is the right exact backend, and its road-connectivity formulation plus scorecard evidence now match the per-component anchor rule.
- LNS already matches the research shape for this kind of problem; adaptive destroy/repair operators are likely higher leverage than another global solver mode.
- Current learned labels are useful but too small, especially for LNS, to justify runtime model hooks.
- Tiny saturated cases are useful smoke tests but weak promotion evidence.

## Active Priorities

Impact scale: `5` is most significant for population per minute. Rank is the recommended execution order.

Status vocabulary:

- `delivered`: implemented and closed for its intended gate.
- `active`: next-stage work that can start now.
- `partial`: usable infrastructure exists, but coverage or metadata is incomplete.
- `needs-scale`: schema and path are proven, but evidence volume or holdout signal is too small.
- `not-started`: no implementation exists yet.
- `gated`: do not start until the trigger is satisfied.

| Rank | Priority | Status | Impact | Summary | Success Signal |
| --- | --- | --- | ---: | --- | --- |
| 1 | Service-master decomposition experiment | not-started | 3.5 | Treat service layouts as the master decision, then solve residential packing plus road repair as a subproblem; use no-good cuts or service swaps if useful. | Experimental mode beats Auto on service-overlap or facility-coverage pressure families without invalid layouts. |
| 2 | LNS replay label scale-up | needs-scale | 3.0 | Use adaptive operator outcomes and replay windows to grow split-protected LNS labels. | Development and holdout splits satisfy usable, non-neutral, and family-balanced label gates before any LNS ranker is trained. |
| 3 | CPU-first Greedy offline ranker | gated | 2.5 | Use the healthier Greedy label bundle for offline diagnostics only. | A small CPU model beats deterministic, random, and single-feature baselines on protected holdout without leaked case names. |

## Status Snapshot

| Area | Status | Evidence | Default Impact |
| --- | --- | --- | --- |
| Cross-mode scorecards, traces, and budget-policy signals | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), items 11 and 14-17 | Supports promotion gates; no default change by itself. |
| Deterministic Greedy/LNS ablation gates | delivered | [SOLVER_ABLATION_DECISIONS.md](../decisions/SOLVER_ABLATION_DECISIONS.md), `artifacts/deterministic-ablations/2026-04-27/` | No deterministic variant promoted; regressions remain blocked. |
| Low-risk learned-ranking label bundle | delivered | `artifacts/learned-ranking-labels/2026-04-27/` | Offline diagnostics only; no model trained and no defaults changed. |
| LNS replay label coverage | needs-scale | 84 usable replay labels in the 2026-04-27 bundle | Blocks learned LNS window ranking until scale and non-neutral holdout signal improve. |
| Generated pressure-case coverage | partial | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 30 | Useful starting point, but promotion needs broader workflow and adversarial coverage. |
| CP-SAT portfolio telemetry and CPU-normalized scorecards | delivered | `artifacts/cp-sat-portfolio/2026-04-28/` | Portfolio remains explicit-only; Auto does not route through it. |
| Experiment registry hardening | delivered | `artifacts/experiments/index.jsonl`; `npm run experiment-registry:check` | Future artifacts can be checked and appended with strict metadata. |
| CP-SAT road-semantics alignment | delivered | Core model, warm-start roots, removed legacy mode switch, model-size telemetry, and six-case scorecard delivered on 2026-04-30; CP-SAT scores 200 on `multi-anchor-road-components` | Exact backend now matches the spec on the adversarial case and no road-semantics scorecard regression was observed. |
| Solver telemetry manifests | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), items 33-36 | Cross-mode scorecards, product workflow replay artifacts, learned-ranking label bundles, and model-experiment artifact contracts now have telemetry manifests and strict registry draft paths. No model was trained and no default changed. |
| Adaptive LNS operator set | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 37 | LNS repair windows now carry semantic operator names, per-operator outcomes, and adaptive weights for weak-service, residential-headroom, frontier-congestion, gate/choke, service-overlap, random-exploration, placed-building, and sliding families. |
| Auto budget policy retuning | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 38 | Runtime Auto now applies the trace-tuned LNS budget defaults already used by scorecards, while keeping explicit user settings and the measured `0.2` CP-SAT reserve default intact. |
| CP-SAT async/portfolio failure-mode coverage | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 39 | Async and portfolio regressions now cover malformed progress, no-final-result streams, child diagnostics, process-pool fallback, worker future failure after sibling progress, cancellation process groups, and portfolio snapshot propagation. |
| Exact small-window DP repair | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 40 | Opt-in LNS repair can route eligible tiny windows through exact bitmask DP with CP-SAT fallback, outcome telemetry, evaluator validation, and CP-SAT comparison coverage where OR-Tools is available. No default changed. |
| Model training path | gated | No `python/ml/` scaffold, offline metric report, trained model, or feature-flagged scorer is promoted | No learned default path. |
| GPU, distributed solving, alternative solvers | gated | No CPU-first bottleneck evidence requiring them | Research-only until equal-budget wins exist. |

## Gated Priorities

These are not next actions. Move them into the active table only after the trigger is satisfied.

| Trigger | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| CP-SAT semantics alignment and product corpus are stable | Geometry-native CP-SAT / `NoOverlap2D` experiment | 3.0 | Compare current cell-indexed set packing with optional-interval rectangle constraints. | Controlled scorecard shows propagation or time-to-best improvement without model-size blowup. |
| Service-overlap and coverage families expose a repeated bottleneck | Service-master / subproblem decomposition | 3.5 | Make service choice a master problem and residential/road repair a subproblem. | Beats Auto on targeted families and remains validated by the exact evaluator. |
| LNS label-scale gates pass | Learned LNS window ranking | 3.0 | Train and evaluate a ranker over adaptive LNS candidate windows. | Offline holdout beats deterministic, random, and single-feature baselines; online A/B improves fixed-budget quality without worst-decile regression. |
| Greedy offline ranker beats deterministic order on protected holdout | Feature-flagged learned Greedy re-ranking | 2.5 | Add scorer adapter, model-load fallback, and equal-budget online A/B. | Online paired seeded benchmarks improve population or time-to-best with bounded inference overhead. |
| Portfolio scorecards show CPU-normalized wins | CP-SAT portfolio in Auto | 2.0 | Let Auto route a controlled budget slice to portfolio only when CPU cost is justified. | Portfolio improves wall-clock quality and CPU-normalized efficiency versus single CP-SAT. |
| CPU-first workflow has a measured bottleneck | GPU acceleration | 2.0 | Use GPU for training, batched feature extraction, or inference only after CPU baseline is useful. | GPU reduces time-to-label, time-to-train, or inference overhead while preserving solver quality gates. |
| Hosted/multi-user execution becomes a product requirement | Durable worker architecture | 2.0 | Move jobs to a durable queue/status store before horizontal scale. | Status/cancel/snapshot behavior survives process restarts and multi-instance routing. |
| Exact-bound quality remains blocked after CP-SAT tuning | External MILP/SCIP/Gurobi/cuOpt research adapter | 1.5 | Use an external exact or relaxation backend as a science instrument, not a product dependency. | Produces better bounds or incumbents on selected families under exact evaluator validation. |

## Combined Ordering

1. Explore service-master decomposition if coverage/service pressure cases justify it.
2. Scale LNS replay labels from adaptive operator outcomes.
3. Revisit learned rankers only after offline holdout and equal-budget online gates pass.
4. Revisit portfolio, GPU, distributed workers, or alternative solvers only after they have a measured bottleneck and CPU-normalized win path.

## Discipline

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity. Solver backends and validators must agree on that rule.
- Buildings that touch row `0` or column `0` are connected by the anchor rule and should not keep unnecessary connector roads alive.
- Final road cleanup should remove support roads that do not affect anchor-boundary road connectivity or building access.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Auto LNS stages must preserve any reserved CP-SAT time by capping seed and repair sub-budgets in `src/packages/solvers/auto/stagePolicy.ts`.
- Learned guidance is not ready until traces show repeated, explainable ranking mistakes and enough counterfactual labels exist.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows, narrow profiles, and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism is useful only when measured against both wall-clock and CPU-second cost.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned or hosting requires durable jobs.
