# Solver Roadmap Delivered

This file keeps completed solver-roadmap context out of the active plan. The current plan lives in [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md).

Reviewed through 2026-05-02.

## Delivered Snapshot

| Area                     | Delivered State                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solver stack             | `greedy`, `LNS`, `CP-SAT`, and `auto` are available across backend, planner, and CLI flows. `auto` uses the incumbent-first `greedy -> LNS -> CP-SAT` path when budget allows.                        |
| Greedy                   | Greedy has runtime guardrails, phase counters, final road cleanup, connectivity-shadow diagnostics, road-opportunity counterfactuals, deterministic ablations, and a diagnostics-only offline ranker. |
| LNS                      | LNS has deterministic/probabilistic windows, adaptive semantic operators, replay labels, improvement guards, small-window DP as an opt-in repair backend, and budget-aware telemetry.                 |
| CP-SAT                   | CP-SAT supports exact repair/proof, warm starts, async progress, portfolio experiments, model-size telemetry, and aligned per-component road-anchor semantics.                                        |
| Auto                     | Auto records stage summaries and detailed traces, preserves CP-SAT reserve time, applies trace-tuned LNS defaults, and now shares one plan runner for sync and background execution.                  |
| Planner workflows        | Saved-layout population visibility, manual validation, continuation hints, explainability maps, solved-map inspection, and expansion comparison are available around the solver loop.                 |
| Benchmarks and telemetry | Cross-mode scorecards, time-to-quality reporting, JSONL traces, budget ablations, product-corpus artifacts, workflow replay artifacts, and telemetry manifests are available.                         |
| Experiment registry      | Registry validation, append helpers, strict metadata gates, artifact-path checks, and dry-run support exist for benchmark, label, workflow, and model-experiment artifacts.                           |
| Learned guidance         | Label bundles, protected splits, LNS replay pressure cases, and a CPU-first Greedy offline ranker exist for diagnostics. No learned runtime scorer has been promoted.                                 |
| Guarded experiments      | CP-SAT portfolio, service-master decomposition, exact small-window DP repair, connectivity-shadow scoring, and learned rankers remain explicit, opt-in, or gated.                                     |

## Key Evidence Artifacts

- `artifacts/health-checks/2026-04-28/`: local health check supporting the current Auto default posture.
- `artifacts/deterministic-ablations/2026-04-27/`: Greedy/LNS deterministic ablation closeout; no deterministic variant promoted.
- `artifacts/learned-ranking-labels/2026-04-27/`: low-risk label bundle with protected development/holdout splits; no model trained from this bundle.
- `artifacts/cp-sat-portfolio/2026-04-28/`: portfolio tied single CP-SAT on the tiny paired run while spending more configured worker CPU, so portfolio stayed explicit-only.
- `artifacts/cp-sat-road-semantics/2026-04-30/`: CP-SAT road-semantics alignment evidence; the six-case 5s single-worker scorecard reached `OPTIMAL`.
- `artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37/`: promotion-grade product-corpus scorecard with protected holdout coverage across modes, budgets, and seeds.
- `artifacts/experiments/index.jsonl`: append-only registry for solver evidence and promotion decisions.

## Important Outcomes

- `auto` remains the recommended quality path.
- CP-SAT now matches the formal per-component road-anchor rule.
- Adaptive LNS is the main improvement path after Greedy.
- Product-shaped scorecards and telemetry manifests are now the promotion gate for solver changes.
- Service-master decomposition showed a focused opt-in pressure win, but still needs wider equal-budget evidence before promotion.
- The CPU-first Greedy offline ranker beat offline baselines on protected holdout, but runtime learned guidance still requires online equal-budget evidence with inference overhead counted.
- Portfolio, GPU, distributed solving, external solvers, learned runtime scorers, and global DP remain gated research tracks.

## Maintenance Watchpoints

- Keep deterministic benchmark seeds stable when changing solver scoring.
- Keep CP-SAT repair experiments guarded; previous `repair_hint` plus multi-worker repair paths were unstable.
- Keep final road pruning conservative and evaluator-valid.
- Keep `greedy.profile` observational; profiling must not change placement behavior.
- Keep Auto budget slicing honest so LNS work does not spend reserved CP-SAT time by accident.
- Keep the experiment registry append-only; corrected metadata should use a new `runId`.
- Keep LNS replay pressure cases as label-generation infrastructure until strict artifacts pass readiness, offline baselines, and online gates.
