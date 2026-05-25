# Solver Roadmap

## Purpose

Maximize feasible city population under fixed wall-clock and CPU budgets.

This roadmap is the current solver source of truth. It records the default runtime posture, the evidence that supports it, and the gates that future solver changes must clear before they affect defaults. Detailed historical delivery notes live in [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md).

The project optimizes through a hybrid stack:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves that incumbent through bounded repair.
3. `CP-SAT` supplies exact repair, bounded polish, and proof when useful.
4. `auto` orchestrates the budget and keeps the best validated incumbent.

Primary metrics:

- population at fixed checkpoints: 1s, 5s, 30s, and 120s
- time to first feasible incumbent
- time to best solution
- improvement per extra CPU-second
- CP-SAT status, upper bound, and population gap when available
- repeatability across fixed seeds, map families, and planner workflows
- exact validation of every reported final layout

## Current Runtime Posture

`auto` remains the recommended quality path.

| Mode             | Role                           | Default Use                                                            |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `auto`           | Main quality path              | Best feasible population per wall-clock budget                         |
| `greedy`         | Fast incumbent and diagnostics | Seed generation, baseline, counterfactual traces                       |
| `LNS`            | Main improvement engine        | Adaptive repair around incumbent layouts                               |
| `CP-SAT`         | Exact backend                  | Small proofs, local repairs, bounded polishing, model-alignment checks |
| CP-SAT portfolio | Explicit research mode         | Only after CPU-normalized scorecards beat single CP-SAT                |
| Learned guidance | Explicit feature-flag path     | Only after offline and online holdout gates produce real lift          |

Current defaults and non-defaults:

- Auto uses the Phase 5 fast-exact budget slice after protected coverage evidence showed equal population, equal configured CPU budget, faster time-to-best, and faster wall time.
- CP-SAT road semantics use per-component anchor connectivity: every explicit road component must touch row `0` or column `0`; roadless boundary-only layouts are valid.
- Adaptive LNS semantic operators are part of the measured LNS path.
- Small-window DP repair is feature-gated to eligible tiny windows and falls back to CP-SAT outside its guardrails.
- Service-master decomposition stays explicit-only because the targeted win came with higher mean wall time than Auto.
- `greedy.learnedServiceRanking` and `lns.learnedWindowRanking` stay opt-in; no learned scorer has been promoted into defaults.
- CP-SAT portfolio, GPU acceleration, distributed solving, and external solvers stay gated research tracks.

## Stable Evidence Base

The May 17 evidence pass turned the road-semantics fix into a registered benchmark base and closed the first solver-improvement loop around it.

| Phase | Area                                 | Evidence                                                                                                                                                                                                             | Decision                                                                                                                                                                                     |
| ----: | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | CP-SAT road-semantics closeout       | `artifacts/road-semantics-scorecard/2026-05-17/road-semantics-scorecard.json`; registry run `road-semantics-scorecard-2026-05-17-v2`                                                                                 | CP-SAT, TypeScript validation, and the formal spec agree on row/column anchors, multi-anchor road components, disconnected-road rejection, and roadless boundary layouts.                    |
|     2 | Product-shaped workflow corpus       | `artifacts/product-workflows/2026-05-17/product-workflow-benchmark.json`                                                                                                                                             | Eight planner-shaped cases with dev/holdout splits, manual-layout replay, expansion comparison, and 1s/5s/30s/120s reporting are the product workflow baseline.                              |
|     3 | Telemetry manifests                  | `artifacts/telemetry-manifests/2026-05-17/solver-telemetry-manifest.json`; `artifacts/telemetry-manifests/2026-05-17/product-workflow-telemetry-manifest.json`; registry run `solver-telemetry-manifests-2026-05-17` | Benchmark/workflow artifacts can explain stage timing, first feasible time, best score time, final status, validation, CP-SAT gaps, and LNS repair outcomes.                                 |
|     4 | Adaptive LNS operators               | `artifacts/adaptive-lns/2026-05-17/adaptive-lns-fixed-rectangle-scorecard.json`; registry run `adaptive-lns-operators-2026-05-17`                                                                                    | Adaptive semantic operators improved mean population by `+12.5` versus fixed-rectangle sliding windows across 24 paired comparisons with zero regressions.                                   |
|     5 | Auto budget retuning                 | `artifacts/auto-budget-retuning/2026-05-17/auto-budget-retuning-fast-exact-scorecard.json`; registry run `auto-budget-retuning-2026-05-17`                                                                           | `phase5-fast-exact` is promoted into Auto defaults: equal mean population, equal configured CPU budget, `0.139s` faster mean time-to-best, and `0.811s` faster mean wall time.               |
|     6 | Exact small-window DP repair         | `artifacts/small-window-dp/2026-05-17/small-window-dp-scorecard.json`; registry run `small-window-dp-repair-2026-05-17`                                                                                              | DP repair is shipped behind eligibility guardrails: zero regressions, tied mean population, and `0.0039s` mean eligible repair wall time versus roughly `0.541s` CP-SAT repair wall time.    |
|     7 | Service-master decomposition         | `artifacts/service-master/2026-05-17/service-master-scorecard.json`; registry run `service-master-decomposition-2026-05-17`                                                                                          | Explicit-only experiment: one facility-coverage win (`+100`), four ties, zero losses, zero invalid layouts, but higher mean wall time than Auto.                                             |
|     8 | LNS replay label scale-up            | `artifacts/lns-replay-label-scale/2026-05-17/lns-replay-label-scale.json`; registry run `lns-replay-label-scale-2026-05-17`                                                                                          | Pairwise label scale gates pass: development has `336` usable / `276` non-neutral labels, holdout has `224` usable / `144` non-neutral labels, and both splits cover five pressure families. |
|     9 | Greedy offline ranker                | `artifacts/greedy-offline-ranker/2026-05-17/greedy-offline-ranker.json`; registry run `greedy-offline-ranker-2026-05-17`                                                                                             | CPU-only Greedy ranker clears protected holdout baselines offline, but offline accuracy alone does not change defaults.                                                                      |
|    10 | Greedy learned online A/B            | `artifacts/greedy-online-ab/2026-05-17/greedy-online-ab.json`; registry run `greedy-learned-online-ab-2026-05-17`                                                                                                    | No promotion: guarded mode tied protected holdout population but was slower; exploratory mode regressed holdout.                                                                             |
|    11 | LNS offline window ranker            | `artifacts/lns-offline-ranker/2026-05-17/lns-offline-ranker.json`; registry run `lns-offline-ranker-2026-05-17`                                                                                                      | No promotion: the ranker beats random and single-feature baselines but ties the deterministic window proxy on protected holdout.                                                             |
|    12 | Enriched LNS ranker features         | `artifacts/lns-ranker-feature-enrichment/2026-05-17/lns-ranker-feature-enrichment.json`; registry run `lns-ranker-feature-enrichment-2026-05-17`                                                                     | Enriched offline ranker reaches `100.0%` protected holdout accuracy and feeds the Phase 13 feature flag.                                                                                     |
|    13 | LNS learned online A/B               | `artifacts/lns-online-ab/2026-05-17/lns-online-ab.json`; registry run `lns-learned-online-ab-2026-05-17`                                                                                                             | Feature flag remains opt-in: guarded mode had zero protected holdout losses and a small wall-clock win but no quality lift.                                                                  |
|    14 | LNS learned promotion review         | `artifacts/lns-promotion-review/2026-05-17/lns-promotion-review.json`; registry run `lns-learned-promotion-review-2026-05-17`                                                                                        | No promotion: product holdout tied `4/4` with zero losses and zero validation failures, but no quality lift and a `0.325s` mean wall regression.                                             |
|    15 | LNS learned guard calibration        | `artifacts/lns-guard-calibration/2026-05-17/lns-guard-calibration.json`; registry run `lns-learned-guard-calibration-2026-05-17`                                                                                     | No promotion retry: all five min-score ratios were regression-safe, but none produced product-holdout quality lift.                                                                          |
|    16 | LNS learned displacement diagnostics | `artifacts/lns-displacement-diagnostics/2026-05-17/lns-displacement-diagnostics.json`; registry run `lns-learned-displacement-diagnostics-2026-05-17`                                                                | Objective-gated: relaxed and widened learned configs displaced windows without final product-holdout lift, so the blocker is the window objective/labels rather than guard strictness.       |

## Current Decision Boundaries

Default-changing work must start from the evidence base above. The current boundaries are:

- Use the registered road-semantics, product workflow, telemetry, adaptive-LNS, and fast-exact Auto defaults as the benchmark baseline for future solver changes.
- Treat tiny saturated cases as smoke tests only; they are not promotion evidence.
- Keep learned guidance opt-in until a new scorer, feature target, label objective, or budget-coupled window objective produces real product-holdout lift.
- Keep service-master decomposition explicit until a cheaper master shortlist turns its facility-coverage upside into a practical wall-clock win.
- Keep small-window DP bounded to eligible tiny windows unless broader telemetry proves it should become part of Auto defaults.
- Keep CP-SAT portfolio explicit until it improves both wall-clock quality and CPU-normalized efficiency against single CP-SAT.
- Start GPU, distributed workers, and external exact/relaxation adapters only after a measured CPU-first bottleneck or hosted product requirement appears.

## Gated Next Work

These are not active by default. Move one into implementation only after its trigger is satisfied.

| Trigger                                                                     | Candidate Work                                    | Success Signal                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP-SAT semantics scorecard and product corpus remain stable                 | Geometry-native CP-SAT / `NoOverlap2D` experiment | Controlled scorecard improves propagation, time-to-best, or bound quality without model-size blowup or validation drift.                                           |
| New LNS scorer or window objective beats the Phase 16 displacement baseline | LNS learned promotion retry                       | Product/cross-mode review has zero validation failures, zero protected-holdout losses, no worst-decile regression, and a real quality or time-to-quality win.      |
| New Greedy features or guard beat the Phase 10 no-promotion baseline        | Greedy learned promotion retry                    | Paired seeded online benchmarks improve population or time-to-best with bounded inference overhead, zero protected-holdout losses, and no worst-decile regression. |
| Service-master telemetry identifies a cheap shortlist                       | Practical service-master follow-up                | Facility-coverage upside remains, mean wall time becomes competitive with Auto, and every final layout validates exactly.                                          |
| Small-window DP telemetry shows repeated eligible repair bottlenecks        | Auto-level DP enablement review                   | Eligible DP use improves time-to-best or wall time without population regression, invalid layouts, or CP-SAT fallback drift.                                       |
| Portfolio scorecards show CPU-normalized wins                               | CP-SAT portfolio in Auto                          | Portfolio improves wall-clock quality and CPU-normalized efficiency versus single CP-SAT.                                                                          |
| Hosted or multi-user execution becomes a product requirement                | Durable worker architecture                       | Status, cancel, and snapshot behavior survive process restarts and multi-instance routing.                                                                         |
| CPU-first workflow has a measured bottleneck                                | GPU acceleration                                  | GPU reduces time-to-label, time-to-train, feature extraction, or inference overhead while preserving solver quality gates.                                         |
| Exact-bound quality remains blocked after CP-SAT tuning                     | External MILP/SCIP/Gurobi/cuOpt research adapter  | Produces better bounds or incumbents on selected families under exact evaluator validation.                                                                        |

## Promotion Gates

Any default-path solver change must satisfy all applicable gates:

- final layouts pass exact validation
- protected holdout scorecard is present
- at least 3 fixed seeds are reported for promotion candidates
- 1s, 5s, 30s, and 120s budgets are reported where applicable
- population improves at fixed budget, or equal population is reached materially faster
- worst-decile population delta is non-negative unless a reviewed exception is documented
- regression rate is no more than 5%
- CPU-budget efficiency is not worse than 10% below baseline unless population improvement justifies the cost
- inference, portfolio, or parallel overhead is counted against wall-clock and CPU budget
- benchmark command, git metadata, hardware, split status, seeds, budgets, artifact paths, and decision metadata are registered
- the deterministic fallback path remains available for learned or experimental features

## Operating Discipline

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity. Solver backends and validators must agree on that rule.
- Buildings that touch row `0` or column `0` are connected by the anchor rule and should not keep unnecessary connector roads alive.
- Final road cleanup should remove support roads that do not affect anchor-boundary road connectivity or building access.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Auto LNS stages must preserve any reserved CP-SAT time by capping seed and repair sub-budgets.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Learned scores may reorder or allocate search effort, but they must not permanently prune candidates without exact solver evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows, narrow profiles, and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism is useful only when measured against both wall-clock and CPU-second cost.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned or hosting requires durable jobs.
