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
- Deterministic ablations before model training are closed as an evidence gate; see [SOLVER_ABLATION_DECISIONS.md](../decisions/SOLVER_ABLATION_DECISIONS.md). No deterministic variant is ready for default promotion. Blocked variants stay out of defaults, Greedy connectivity-shadow scoring is a label target, and LNS anchor/window variants require counterfactual replay labels before learned ranking.
- Low-risk learned ranking labels are closed as a label-collection gate; see `artifacts/learned-ranking-labels/2026-04-27/`. The bundle contains split-protected Greedy ordering labels and LNS replay labels with schema/audit metadata, but no model was trained and no defaults changed.
- Planner explainability maps are closed. Solve and manual-layout responses now include a first-class explainability grid, and the planner can switch between layout, service-value, placement-opportunity, and connectivity-risk map modes.
- CPU parallelism and portfolio work is closed as a measurement/safety gate; see `artifacts/cp-sat-portfolio/2026-04-28/`. Portfolio workers now preserve parseable JSON when search logging is requested, expose per-worker telemetry, and scorecards report CPU-normalized portfolio-vs-single signals. The measured tiny paired run tied population while spending extra CPU budget, and the larger failed artifact remains no-promotion evidence.
- Next-stage review is adopted as an infrastructure plan, not a solver-default promotion plan; see [NEXT_STAGE_REVIEW.md](NEXT_STAGE_REVIEW.md). Its first work is roadmap reconciliation, experiment registry hardening, and label-scale readiness gates.
- Experiment registry seeding has started at `artifacts/experiments/index.jsonl`. Treat the registry as partial infrastructure: existing evidence is discoverable, but validation/check tooling, append helpers, hardware metadata coverage, and backfill quality checks still need to land before promotion decisions depend on it.

| Rank | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| 1 | Roadmap reconciliation | 3.0 | Keep solver defaults unchanged while making roadmap status explicit as delivered, partial, needs-scale, or not-started. | A new engineer can tell that traces, ablations, labels, portfolio measurement, and registry seeding exist, while model training and default promotion do not. |
| 2 | Experiment registry hardening | 3.0 | Build validation/check tooling, append helpers, and metadata completeness rules around the seeded registry. | New benchmark and label artifacts can be checked and appended with commit, command, split, budget, hardware, model, and decision metadata. |
| 3 | LNS replay label scale-up | 4.0 | Grow replay labels across corridor, gate, footprint-pressure, and service-pressure families before training LNS rankers. | Protected development and holdout splits reach the label-scale gates for usable, non-neutral, and family-balanced replay labels. |
| 4 | CPU-first Greedy offline ranker | 3.5 | Use the healthier Greedy label bundle for an offline diagnostic ranker before any runtime hook or promotion. | A small CPU model beats deterministic ordering, random ordering, and single-feature baselines on protected holdout without leaked case names. |

## Gated Priorities

These are not next actions. They need the trigger in the first column before moving back into the active table.

| Trigger | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| Registry tooling exists and LNS label-scale gates pass | Learned LNS window ranking | 4.0 | Train and evaluate LNS window rankers only after replay labels include enough non-neutral protected-holdout signal beyond baseline top-k. | Offline holdout ranking beats deterministic, random, and single-feature baselines; online paired A/B improves population or time-to-best without worst-decile regression. |
| Greedy offline ranker beats deterministic order on protected holdout | Feature-flagged learned Greedy service re-ranking | 3.5 | Add scorer adapter, model-load fallback, and equal-budget online A/B only after CPU-first offline diagnostics justify runtime work. | Online paired seeded benchmarks improve fixed-budget population or time-to-best with exact validation and bounded inference overhead. |
| LNS offline ranker beats baselines after label gates pass | Feature-flagged learned LNS window ranking | 3.5 | Add LNS scorer hooks only after replay labels and offline holdout metrics show useful ranking signal. | Online paired seeded benchmarks improve fixed-budget population or time-to-best without worst-decile regression. |
| Future pressure cases show a population win over baseline | Auto/LNS policy ablations | 3.5 | Keep baseline after the 5s/30s coverage slices; run 120s only when a new focused slice beats baseline on population. | New evidence beats baseline on Auto/LNS population without extra wall-clock. |
| CPU-first model or replay workflow is measurably bottlenecked | GPU research acceleration | 2.5 | Use GPU for training, batched feature extraction, or inference only after CPU baselines exist and artifacts capture hardware/runtime metadata. | GPU reduces time-to-label, time-to-train, or inference overhead while preserving CPU/GPU parity and equal-budget solver gates. |
| Improvement loop proves a CPU-normalized bottleneck | Portfolio, distributed, or alternative solver work | 2.0 | Keep CP-SAT portfolio, distributed solving, and GPU solver adapters explicit-only until the registry can prove equal-budget wins. | Population or time-to-best improves under CPU-normalized accounting with exact validation and no Auto-default coupling. |

## Combined Ordering

1. Reconcile roadmap status so delivered, partial, needs-scale, and not-started work is explicit.
2. Harden the seeded experiment registry with validation/check tooling, append helpers, and required metadata coverage.
3. Scale LNS replay labels and generated pressure cases until protected splits have enough usable and non-neutral signal.
4. Train a CPU-first Greedy offline ranker as a diagnostic, using deterministic, random, and single-feature baselines.
5. Train an LNS offline ranker only after the replay label-scale gates pass.
6. Add feature-flagged online Greedy/LNS ranking hooks only after offline holdout wins, with deterministic fallbacks and equal-budget A/B.
7. Add GPU training or inference acceleration only after a CPU-first model is useful and a measured bottleneck exists.
8. Revisit portfolio, distributed solving, or alternative GPU solvers only after the improvement loop can prove CPU-normalized wins.

## Discipline

- Roads are support cells, not blockers. The real blocker is building placement that prevents future buildings or available cells from reaching the road-anchor boundary.
- Any available cell can be treated as a road candidate until a building occupies it.
- Buildings that touch row `0` or column `0` are already connected by the anchor rule and must not keep unnecessary connector roads alive.
- Final road cleanup should remove support roads that do not affect anchor-boundary road connectivity or building access.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Auto LNS stages must preserve any reserved CP-SAT time by capping seed and repair sub-budgets.
- Learned guidance is not ready until traces show repeated, explainable ranking mistakes and enough counterfactual labels exist.
- CPU parallelism is useful only when measured against wall-clock and CPU-second cost.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned.
