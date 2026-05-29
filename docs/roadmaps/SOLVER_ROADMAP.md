# Solver Roadmap

## Purpose

Maximize feasible city population under fixed wall-clock and CPU budgets, while preserving exact validation for every reported final layout.

The current strategy is intentionally conservative:

- Keep `auto` as the default quality path.
- Use Greedy for fast incumbents and diagnostics.
- Use LNS as the main improvement engine after Greedy.
- Use CP-SAT for exact repair, bounded polish, proof, bounds, labels, and semantic checks.
- Promote learned guidance, portfolio, GPU, distributed solving, or external solver work only after protected equal-budget evidence says it helps.

Primary metrics are time to first feasible, population at relevant budgets, time to best, improvement per CPU-second, CP-SAT status/gap, repeatability across fixed seeds and planner workflows, and exact validation.

## Current Runtime Posture

The default solver path is incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof when budget allows.
4. `auto` orchestrates the budget and keeps the best incumbent.

| Mode             | Role                           | Default Use                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `auto`           | Main quality path              | Recommended solver mode.                                                                        |
| `greedy`         | Fast incumbent and diagnostics | Seed generation, baseline, and counterfactual traces.                                           |
| `LNS`            | Main improvement engine        | Adaptive repair around incumbent layouts.                                                       |
| `CP-SAT`         | Exact backend                  | Small proofs, local repairs, bounded polishing, semantic checks, and replay labels.             |
| CP-SAT portfolio | Explicit research mode         | Promote only after wall-clock and CPU-normalized wins over single CP-SAT.                       |
| Learned guidance | Future feature-flag path       | Greedy needs online equal-budget wins; learned LNS needs protected/fresh online value coverage. |

## Current Baseline

Completed baseline details live in [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md). The long May 2026 evidence narrative is archived in [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).

Short version:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- Planner workflows cover solve, inspect, edit, validate, reuse, explainability maps, saved layouts, and expansion comparison.
- CP-SAT road semantics match the formal per-component anchor rule.
- Auto uses trace-tuned LNS budget defaults while preserving the measured `0.2` CP-SAT reserve default and explicit caller overrides.
- Cross-mode scorecards, product-corpus artifacts, telemetry manifests, workflow replay artifacts, and experiment-registry draft paths exist for promotion evidence.
- Capacity-normalized benchmark metrics now report optimistic population bounds, capacity utilization, gap-to-capacity, and gap-closed-per-second. These metrics are context only, not proof of attainable population.

## Current Solver Posture

There is no ungated default-path solver change active after the May 2026 evidence tranche. Default `auto` remains the recommended quality path.

Current decisions:

- **Auto policy:** unchanged. Short-budget and repair-allocation evidence did not justify changing Greedy seed time, LNS repair time, or CP-SAT reserve defaults.
- **Service-master shortlist:** diagnostics-only. The opt-in Greedy shortlist is useful and evaluator-valid, but Auto/default ties baseline and the measurable lift is concentrated in standalone Greedy holdout rows.
- **Learned LNS ranking:** diagnostics-only. Offline and product-axis signals are real, but protected/fresh online value remains blocked by neutral overrides, all-fallback behavior, or safety/selectivity tradeoffs.
- **Greedy learned ranking:** diagnostics-only until online equal-budget wins include inference overhead.
- **CP-SAT portfolio, exact small-window DP repair, external solvers, GPU, and distributed solving:** gated research tracks, not default behavior.

## Active Evidence Tracks

No default-path promotion candidate is currently active.

Allowed near-term work is maintenance, diagnostics, or explicitly gated experimentation:

- Keep service-master decomposition opt-in while preserving its telemetry and evaluator-valid evidence.
- Use learned LNS artifacts for diagnosis, not runtime defaults, unless a new branch produces protected/fresh final-population value without regressions or final-neutral override blockers.
- Use capacity-normalized metrics to explain scorecards, not to tune defaults without separate protected equal-budget evidence.
- Reopen Auto policy only with a fresh reproducible outside-envelope failure or a candidate that first clears same-slice baseline-repeat controls.

## Planning Horizon

Ultimate goal: make `auto` the consistently best default solver path for planner users: fast first feasible layouts, stronger final population under fixed budgets, exact evaluator-valid results, and reliable long-running solve workflows.

Short run: protect the current default path and make the planner happy path obvious. The 0-4 week slice covers the Auto-first planner flow, Advanced-mode solver tuning, sample problem presets, CP-SAT readiness messaging, split quality-gate scripts, and a tighter artifact policy.

Middle run: improve evidence quality before changing behavior. Keep product-corpus, protected holdout, fresh holdout, evaluator-validity, CPU-cost, and time-to-best scorecards current enough that candidate solver changes can be judged without rebuilding the evidence framework each time.

Long run: promote only candidates that beat the current `auto` posture on protected equal-budget evidence. Service-master, learned guidance, portfolio, external solver, GPU, and distributed-worker work should stay opt-in or diagnostics-only until they clear the promotion gates below.

## Middle-Run Evidence Checklist

Use this checklist before treating any solver branch as a default-path candidate.

Initial audit on 2026-05-29: the evidence framework is ready for middle-run work. The product workflow corpus has explicit development and holdout coverage, `quality:evidence` covers registry/artifact/product-corpus contracts, and the artifact policy separates durable summaries/manifests from large raw evidence bundles. No default-path promotion candidate is active.

1. **Baseline freshness:** run `npm run quality:evidence` and a current product-corpus scorecard smoke before interpreting candidate results.
2. **Corpus coverage:** confirm development, protected holdout, fresh holdout, workflow tags, evaluator-validity replay, CPU cost, and time-to-best fields are present for the candidate's comparison family.
3. **Same-slice controls:** run baseline-repeat controls on the same cases, budgets, seeds, hardware, and command shape before broad scorecard interpretation.
4. **Promotion matrix:** for real candidates, report `auto`, `greedy`, `lns`, and `cp-sat` at 1s, 5s, 30s, and 120s with seeds `7,19,37`; include portfolio only when CPU-normalized efficiency is part of the claim.
5. **Artifact policy:** keep summaries, telemetry manifests, registry drafts, and the registry index in git; move large raw JSON bundles, replay labels, trace dumps, and temporary solve logs to external or release storage.
6. **Decision closeout:** record the exact command, commit, hardware, split metadata, artifact location, result summary, blockers, and default-path decision before changing runtime defaults.

## Closed Evidence Tracks

These summaries preserve the decision boundary. Detailed artifacts and intermediate investigation notes are in [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).

### Service-Master Shortlist

Decision: closed on 2026-05-28 as diagnostics-only.

Evidence:

- Greedy product-corpus ablation: positive standalone Greedy lift, no population regressions.
- 1s, 5s, and 30s Auto/Greedy slices: Auto/default remained unchanged with no regressions.
- Evaluator-validity rerun: 120/120 Greedy rows valid, 0 population mismatches.

Reopen only if a later branch shows broader protected holdout value beyond the current narrow standalone Greedy wins with acceptable cost.

### Strict LNS Replay Labels And Feature Payloads

Decision: closed as learned-LNS diagnostics-only.

Evidence:

- Strict, curated, natural-seed, roll-forward, repeatability, final-lift, product, protected, default replay-pressure, and fresh holdout branches generated useful labels and telemetry.
- Several offline rankers beat simple baselines, and some product/default replay-pressure scorecards showed value.
- Promotion stayed blocked because protected/fresh online scorecards were neutral, unsafe, all-fallback, or carried final-neutral override behavior.

Reopen only with new protected/fresh value coverage or a materially different model class that improves final population or time-to-best online without regressions or neutral override blockers.

### Short-Budget Auto Gap Triage

Decision: closed with current Auto defaults unchanged.

Evidence:

- Focused 1s/5s misses were diagnosed with product-corpus preflights, baseline-repeat controls, and preserved LNS stage traces.
- Candidate seed/repair/reserve policies did not clear broad product-corpus safety and repeatability gates.
- The prior expansion repair-time swing did not reproduce under the later same-slice stage-trace repeat.

Reopen only with a fresh reproducible outside-envelope failure or a new policy candidate that clears baseline-repeat controls before broad interpretation.

## Maintenance Backlog

These items are not solver-policy candidates. They track planner/runtime reliability follow-ups that protect long-running solve workflows.

1. **Planner completed-status resilience:** marked 2026-05-29 after a completed background solve surfaced as failed in the UI because final status polling performed heavyweight response validation. The immediate route fix keeps completed and recovered status responses on lightweight reported-invariant validation. Follow-up work should add a workflow-level smoke that completes a large background solve through `/api/solve/status`, asserts the terminal response returns promptly with `jobStatus: "completed"`, and checks that the UI does not convert terminal poll latency into a failed solve.

Recently completed maintenance:

- **Roadmap restructure:** completed 2026-05-29. The active roadmap was shortened to current posture, active tracks, closed decisions, gated priorities, promotion gates, guardrails, and maintenance backlog. The detailed May evidence narrative moved to [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).

## Gated Priorities

These are not next actions by default. They become active only when their trigger is satisfied.

| Trigger                                                                                          | Candidate Work                                         | Success Signal                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-SAT semantics and product corpus stay stable, and exact search quality remains a bottleneck   | Geometry-native CP-SAT / `NoOverlap2D` experiment      | Better propagation or time-to-best without model-size blowup.                                                                                                     |
| Service-master shortlist preserves focused wins and scorecards show repeatable equal-budget wins | Promote service-master into Auto or Greedy seed policy | Beats current Auto or Greedy seed path on development and holdout pressure families with evaluator-valid layouts, bounded CPU cost, and no worst-row regressions. |
| New protected/fresh LNS value coverage or a materially different model class appears             | Learned LNS window ranking                             | Active protected/fresh overrides improve final population or time-to-best online without regressions, final-neutral override blockers, or product-axis loss.      |
| Greedy offline ranker evidence is paired with online equal-budget wins                           | Feature-flagged learned Greedy re-ranking              | Online seeded benchmarks improve population or time-to-best with bounded inference overhead.                                                                      |
| Portfolio scorecards show wall-clock and CPU-normalized wins                                     | CP-SAT portfolio in Auto                               | Portfolio beats single CP-SAT on quality and CPU efficiency.                                                                                                      |
| A CPU-first label, training, feature, or inference workflow becomes a measured bottleneck        | GPU acceleration                                       | GPU reduces the measured bottleneck while preserving solver quality gates.                                                                                        |
| Hosted or multi-user execution becomes a product requirement                                     | Durable worker architecture                            | Status, cancellation, and snapshots survive process restarts and multi-instance routing.                                                                          |
| Exact bounds or incumbents remain blocked after CP-SAT tuning                                    | External MILP/SCIP/Gurobi/cuOpt research adapter       | Better bounds or incumbents on selected families under exact evaluator validation.                                                                                |

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
- Learned label/runtime infrastructure exists, but promotion is track-specific: Greedy needs online equal-budget wins with inference overhead counted, while learned LNS needs protected/fresh online value coverage or a materially different model class.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism must be measured against both wall-clock and CPU-second cost.
- Population upper bounds are optimistic benchmark context, not proven optima; do not use unreachable gaps as promotion blockers without exact proof or stronger feasibility bounds.
- Distributed solving should wait until hosting requires durable jobs or single-machine policy is no longer the bottleneck.
