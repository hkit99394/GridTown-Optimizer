# Solver Roadmap Delivered

This file keeps completed solver-roadmap work out of the main roadmap. The active plan lives in [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md).

## Delivered Work

Reviewed through 2026-04-27.

### 1. Full Solver Stack

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available across backend, planner, and CLI flows.
- `auto` uses the staged `greedy -> LNS -> CP-SAT` workflow when time budget allows.
- Raw solver modes remain available for diagnostics and experiments.

### 2. Incumbent-First Quality Path

- Greedy provides fast feasible incumbents.
- LNS improves incumbents under bounded time.
- CP-SAT can use incumbents for bounded deep improvement or proof.

### 3. Reproducibility And Benchmark Visibility

- Solver runs expose enough metadata for repeatable comparisons.
- Benchmark output supports exact-run inspection and cross-mode comparison.
- Progress reporting is unified enough to compare Greedy, LNS, CP-SAT, and Auto behavior.

### 4. LNS Neighborhood Selection

- LNS includes deterministic and probabilistic neighborhood selection.
- Candidate windows can be scored and limited.
- Improvement, stopping, and budget policies are guarded.

### 5. Reusable Solver-State Hardening

- Shared solve state was hardened to reduce cross-run contamination.
- Planner/runtime contracts now keep Auto behavior clearer.
- Input and output validation safeguards are part of the solver path.

### 6. Greedy Runtime Guardrails

- Greedy has runtime limits and safer phase transitions.
- Phase boundaries are clearer for diagnostics.
- Phase-level timing and quality counters are available.

### 7. Solve Admission And Route Safety

- Solver entry points are guarded so expensive paths are intentional.
- Routing and planner execution have safer defaults.
- Unsupported or unsafe combinations are rejected earlier.

### 8. CP-SAT Portfolio Initiation

- CP-SAT portfolio work is guarded.
- Portfolio behavior no longer competes with the default Auto/LNS path unless explicitly enabled.
- CP-SAT remains available for bounded experiments and exact checks.

### 9. Cross-Mode Scorecards

- Benchmark scorecards can compare solver modes.
- Progress events are normalized enough to track population over time.
- Existing output supports time-to-quality review.

### 10. Delivered LNS Follow-Up

- LNS stopping and budget policy were tightened.
- Neighborhood scoring and candidate limits were added.
- Benchmarks can compare LNS behavior across runs.
- LNS remains the main improvement engine after Greedy.

### 11. Shared Decision Traces And Time-To-Quality Scorecards

- Greedy, LNS, CP-SAT, CP-SAT portfolio, and Auto now feed a common decision-trace event model.
- Trace events capture checkpoints, stage transitions, phase outcomes, neighborhood outcomes, CP-SAT progress, score deltas, upper bounds, and compact evidence fields.
- Cross-mode benchmark results include `decisionTrace`, `timeToQuality`, and a summarized checkpoint reason per mode.
- Time-to-quality scorecards report first feasible time, first improvement time, best score time, fixed checkpoint scores, and quality target reach times.
- Cross-mode benchmark CLI supports JSONL trace export with `--trace-jsonl`.
- Cross-mode scorecards now include per-mode `budgetAllocationSignal` data and suite-level `budgetPolicySignals` so Auto/LNS budget tuning can start from measured trace evidence.

### 12. Road Finalization And Row-0 Anchor Cleanup

- Greedy finalization now prunes redundant road cells after connectivity is ensured.
- Deferred road materialization uses the same pruning pass before returning the final road set.
- Buildings that touch row `0` are treated as connected by the anchor rule and no longer keep connector roads alive.
- The pruning pass preserves a single row-0-connected explicit road network and verifies every non-row-0 building still has road access.
- Regression coverage checks that row-0-connected buildings do not force unnecessary road cells, and benchmark snapshots were updated for lower final road counts.

### 13. Planner Saved-Layout Score Visibility

- Saved-layout dropdown entries now show saved population rather than elapsed time.
- Population is read from validation totals, result stats, solution totals, or residential population sums when needed.
- Saved-layout ordering and load behavior remain unchanged; the displayed selector metadata is now aligned with the solver goal.

### 14. Auto/LNS Budget And Trace Hardening

- Auto now records per-stage run summaries with start time, elapsed time, candidate population, accepted population, improvement, random seed, and stage status evidence.
- Auto LNS stages reserve time for the following CP-SAT stage and cap LNS seed, focused repair, and escalated repair budgets so they cannot consume that reserve.
- LNS passes the shared stop file into its internal greedy seed solve, so wall-clock and cancellation stops can interrupt seed generation.
- Auto decision traces now keep detailed final-stage LNS neighborhood and CP-SAT progress events with stage-start offsets instead of only coarse Auto stage completion events.
- Cross-mode budget policy signals use structured Auto stage evidence instead of matching human-readable reason text.
- Regression coverage checks Auto stage run metadata, LNS budget caps, Auto LNS trace detail, and CP-SAT last-improvement trace timing.

### 15. Cross-Mode Budget Ablation Runner

- Cross-mode benchmarks can now run named budget-ablation policies over the same cases, budgets, seeds, and modes.
- Built-in ablation policies compare the baseline, lighter LNS seed spending, heavier LNS repair spending, and heavier Auto CP-SAT reserve spending.
- `auto.cpSatStageReserveRatio` is configurable and validated so CP-SAT reserve allocation can be compared directly.
- Ablation text, JSON, and JSONL trace output are available through the scorecard CLI with `--budget-ablation` and `--ablation-policies=...`.
- Ablation trace run IDs include the policy name, so traces from multiple policies can be compared without event ID collisions.
- Ablation summaries include per-budget checkpoint rows so 5s, 30s, and 120s regressions are visible instead of being hidden by aggregate means.
- Auto stage summaries preserve LNS seed/repair counters and CP-SAT timing fields for trace-driven policy analysis even when a later stage wins the final incumbent.

### 16. Initial Auto/LNS Budget Ablation Review

- The corrected then-default three-case, seed `7`, 5s/30s sweep was executed and all built-in policies tied on Auto, LNS, and best population, so the baseline policy remained the recommended default for that corpus.
- Cross-mode LNS benchmark budgeting now lets the benchmark budget policy set seed, repair, focused repair, escalated repair, iteration, and no-improvement caps instead of inheriting corpus caps that mask policy differences.
- CP-SAT decision traces now separate incumbent improvement time from terminal status, bound, and gap timing so budget analysis does not treat proof evidence as if it happened at first incumbent time.
- Ablation baseline selection now resolves a named `baseline` policy even when callers pass policies out of order, and explicit missing baseline names fail before any expensive suite execution.
- Regression coverage checks default corpus LNS budget materialization at 5s/30s/120s, out-of-order baseline deltas, per-budget summaries, and CP-SAT terminal trace timing.

### 17. Auto/LNS Ablation Coverage Expansion

- Added a sparse row-zero `row0-corridor-repair-pressure` cross-mode case so budget ablations include a connectivity-pressure scenario that is not already saturated by the dense default maps.
- Added an opt-in `--coverage-corpus` scorecard corpus that combines the default cross-mode cases with selected harder Greedy and LNS benchmark cases for budget-policy probes.
- Ablation text and JSON summaries now report policy count, scorecard count, mode-run count, and separate best-score, Auto, and LNS deltas versus the resolved baseline policy.
- Ablation top-policy selection now prefers the baseline policy on population ties, labels the field as measured ranking rather than a promotion recommendation, exposes tied policy names for structured consumers, and uses LNS mean population for ranking when LNS is present without Auto.
- Ablation coverage summaries include budgeted mode-seconds so 30s and 120s matrices are not hidden behind identical mode-run counts.
- Auto LNS stage budgeting now allows focused and escalated repair caps to exceed the normal repair pass cap when a policy requests it, while still respecting the remaining Auto LNS stage wall-clock slice and preserving the CP-SAT reserve.
- Budget-policy signals aggregate all Auto LNS and CP-SAT stage cycles instead of reporting only the final matching stage event.
- Coverage-corpus 5s/30s slices kept the baseline Auto/LNS policy as the default; non-baseline policies tied or regressed Auto population, so no selective 120s probe is justified yet.
- Regression coverage checks the new coverage corpus, coverage reporting, explicit Auto/LNS baseline deltas, and escalated repair caps inside Auto stage budgeting.

### 18. Connectivity-Shadow Instrumentation

- Added a pure building connectivity-shadow metric that measures row-0-reachable empty cells before and after a committed building footprint.
- Greedy profile counters now aggregate connectivity-shadow checks, total lost cells, footprint-consumed cells, downstream disconnected cells, and max per-placement losses.
- Greedy benchmark text reports `connectivity-shadow=...` so placement isolation pressure is visible before it affects scoring.
- Regression coverage checks a sparse row-0 corridor shadow case and verifies Greedy benchmark profile output includes the new counters.

### 19. Connectivity-Shadow Tie-Breaker

- Added default-off `greedy.connectivityShadowScoring` so Greedy can prefer equal-score placements that preserve more row-0-reachable future space.
- Candidate scoring uses the same building-only shadow model as profiling, but computes it independently of `greedy.profile` so profiling alone never changes placement behavior.
- Shadow comparison is deliberately lazy and tie-only: candidate shadow is computed only after normal Greedy score/density comparison ties, avoiding a full-frontier BFS on every candidate scan.
- Regression coverage checks default/off/profile behavior remains unchanged and that the opt-in tie-breaker chooses the less-disconnecting placement on a sparse row-0 corridor case.

### 20. Connectivity-Shadow Ablation Harness

- Added a Greedy benchmark ablation runner exposed by `--connectivity-shadow-ablation`, with supporting flags `--connectivity-shadow-scoring`, `--no-connectivity-shadow-scoring`, `--profile`, and `--no-profile`.
- Regression coverage verifies the CLI can toggle the option, keeps explicit-off population aligned with default, and can disable profiling for cleaner timing runs.
- Ran a focused profile-off Greedy slice across eight pressure/hot-path cases. Explicit off matched default population. Opt-in shadow scoring improved `service-local-neighborhood` by `+100`, but regressed `geometry-occupancy-hot-path` by `-30` and increased road count on several tied-population cases.
- Conclusion: keep `greedy.connectivityShadowScoring` default-off and treat this as evidence for calibration, not promotion.

### 21. Connectivity-Shadow Calibration Guard

- Greedy profile output now records bounded connectivity-shadow tie-break samples with phase, score, candidate placement, incumbent placement, chosen/rejected placement, road cost, and shadow penalty.
- The diagnostic slice showed the `geometry-occupancy-hot-path` regression came from residential shadow choices that preferred lower shadow at expensive road costs, while the useful `service-local-neighborhood` gain needed some bounded residential shadow choices.
- Calibrated shadow scoring to run only inside a bounded cheap-road window, then guard the final opt-in result against the normal Greedy result using the existing population and road-count solution comparator.
- The focused profile-on slice now improves `service-local-neighborhood` by `+80`, keeps `geometry-occupancy-hot-path` unchanged, and has total road delta `0`.
- The eight-case profile-off ablation now reports total population delta `+80`, one improved case, no regressions, seven unchanged cases, and total road delta `0`.
- Conclusion: the opt-in path is now population/road-safe on the focused corpus, but remains default-off because the guard can run the normal Greedy path as a fallback and therefore may spend extra CPU.

### 22. Road Opportunity Profile Instrumentation And Constructive Counterfactuals

- Added `roads.roadOpportunity*` profile counters and bounded `roadOpportunityTraces` for accepted constructive service/residential placements.
- Road opportunity traces pair the accepted placement's road cost with row-0-reachable frontier before/after counts, total lost cells, footprint-consumed cells, and downstream disconnected cells.
- The implementation reuses the same pre-commit connectivity-shadow measurement for both connectivity-shadow and road-opportunity profile counters at instrumented commit sites, avoiding duplicate profile-only frontier scans.
- Constructive placement traces now include bounded near-miss counterfactuals selected from high-score and low-road-cost candidate pools, without changing placement scoring.
- Greedy benchmark text reports `road-opportunity=...` plus sample `road-opportunity-placement=...` and `road-opportunity-counterfactual=...` rows.
- Focused profile output on `service-local-neighborhood` and `geometry-occupancy-hot-path` now exposes large downstream losses, including geometry placements that disconnect far more cells than their footprint consumes.

### 23. Road Opportunity Local-Search Move Counterfactuals

- Extended road-opportunity traces to accepted residential local-search add/move placements and service-neighborhood add/swap placements.
- Local-search traces carry `moveKind` metadata so accepted move families and near-miss alternatives can be separated in benchmark output.
- Residential local-search traces measure against building-only post-remove occupancy instead of the constructive attempt-state helper.
- Service-neighborhood swap traces measure against the occupied state after removing the replaced service; add traces measure against the incumbent building occupancy.
- The recorder reserves bounded trace capacity for local-search phases so constructive placements cannot crowd out later move traces.
- Focused tests cover local-search post-remove measurement, bounded constructive/local trace capacity, service-neighborhood trace emission, move-kind formatting, and profiling remaining observational.

### 24. Greedy And LNS Deterministic Ablation Matrices

- Added a Greedy deterministic ablation runner for restarts, local search, service neighborhoods/refinement/exact search, service lookahead, deferred roads, and connectivity-shadow scoring.
- Greedy deterministic ablations default profiling off for cleaner timing while still allowing callers to opt into diagnostic profile runs.
- Added an LNS neighborhood ablation runner with explicit anchor-policy switches for ranked anchors, sliding-only fallback, weak-service anchors, residential-opportunity anchors, frontier-congestion anchors, placed-building anchors, and fixed window-size variants.
- The Greedy and LNS benchmark CLIs expose the matrices with `--deterministic-ablation` / `--ordering-ablation` and `--neighborhood-ablation`, plus `--ablation-variants=...` for focused slices.
- Ablation summaries report median, worst-decile, best-case, population deltas versus baseline, wall-clock deltas, coverage counts, and per-case variant details.
- Greedy and LNS ablation CLIs support `--seeds=...`, pairing every variant against the same case/seed baseline and reporting seed/comparison coverage.
- Repeated-seed ablation summaries now include stability-gate metrics: win/regression/unchanged rates, best/worst population-delta case+seed labels, and LNS first-window, full-window-sequence, and anchor-coordinate movement counts/rates versus the matched baseline.
- Ablation JSON output now uses snapshot-friendly artifacts that omit generated timestamps and volatile wall-clock timing fields; explicit seeds are validated against the solver-supported random-seed range before a matrix run starts.
- Greedy and LNS ablations expose `--gate-report` for stable promote/keep-baseline/learning-target/blocked-regression reports, defaulting to seeds `7,19,37` when no explicit seed list is provided.
- LNS repeated-seed ablations rotate variant execution order by default to reduce wall-time order bias while keeping result rows in normalized variant order.
- LNS benchmark CLI exposes `--window-replay-labels` for bounded counterfactual replay of multiple candidate repair windows from the same incumbent under an equal CP-SAT repair budget, with stable JSON snapshots for label collection before learned window ranking.
- LNS neighborhood ablations include per-repair outcome/window summaries and a seeded service-anchor pressure case where ranked service anchors improve population while sliding-only misses the repair window.

### 25. Deterministic Ablation Evidence Gate

- Closed the deterministic ablation priority as an evidence gate before model training.
- Persisted the closeout decision table in [SOLVER_ABLATION_DECISIONS.md](SOLVER_ABLATION_DECISIONS.md).
- Persisted the generated evidence bundle under `artifacts/deterministic-ablations/2026-04-27/`.
- Greedy evidence covers 9 cases, 10 variants, seeds `7,19,37`, 27 comparisons, and 270 runs.
- LNS evidence covers 4 cases, 8 variants, seeds `7,19,37`, 12 comparisons, and 96 runs.
- LNS replay evidence includes 84 equal-budget counterfactual window labels.
- No deterministic variant was promoted. Blocked variants remain out of defaults, Greedy connectivity-shadow scoring is an ordering-label target, and LNS anchor/window variants require replay labels before learned ranking.

### 26. Low-Risk Learned Ranking Labels

- Closed the low-risk learned ranking label priority as a label-collection gate before any model training.
- Added Greedy connectivity-shadow ordering labels with seed support, max-label caps, stable snapshots, text formatting, and `--connectivity-shadow-labels` CLI support.
- Added a combined `benchmark:labels` runner that packages Greedy ordering labels, Greedy road-opportunity near-miss labels, and split-aware LNS replay labels.
- The combined label bundle records schema version, seeds, split assignments, leakage checks, audit metadata, Greedy source counts, and LNS usable/status counts.
- LNS replay labels now include signed population deltas, validation results, `usable` flags, schema version, and an `invalid` status so illegal replay outputs are quarantined from training data instead of silently becoming labels.
- Persisted the generated evidence bundle under `artifacts/learned-ranking-labels/2026-04-27/`.
- The closeout bundle contains 4,593 Greedy labels and 84 LNS replay labels across seeds `7,19,37`, with protected development/holdout splits and no case overlap.
- No learned model was trained and no solver defaults changed; learned ranking remains gated on held-out offline metrics and equal-budget online benchmarks.

### 27. Planner Explainability Maps

- Solve and manual-layout HTTP responses now include a first-class planner explainability grid with schema version, dimensions, per-cell occupancy, row-0 reachability, service value, remaining service opportunity, residential opportunity, and connectivity-risk shadow metrics.
- The web planner exposes layout, service-value, placement-opportunity, and connectivity-risk map modes from the solved-map toolbar.
- Service-value mode preserves the existing flattened heatmap review behavior, while placement-opportunity and connectivity-risk modes keep building overlays visible so users can inspect attractive or dangerous cells in layout context.
- Selected-cell detail now surfaces planner-map context such as service value, residential opportunity, best remaining service bonus, row-0 distance, and connectivity risk.
- Regression coverage checks the backend response contract, the core explainability-map summary, and the planner heatmap modes.

## Maintenance Watchpoints

- Keep deterministic benchmark seeds stable when changing solver scoring.
- Keep CP-SAT repair experiments guarded because `repair_hint` plus multi-worker repair previously caused instability.
- Keep distributed or portfolio solving behind proof that single-machine policy is no longer the bottleneck.
- Keep learned guidance separate from core runtime correctness until traces and labels are strong enough.
- Keep final road pruning conservative: population and validity must not depend on the removed roads.
- Keep connectivity-shadow scoring default-off until wider benchmark evidence shows the guarded opt-in CPU cost is worth the population gain; `greedy.profile` must remain observational and must not affect placement choices.
- Keep Auto budget slicing honest: LNS seed and repair work may use the Auto LNS stage slice, but must not spend the CP-SAT reserve unless a future trace-backed policy explicitly changes that.
- Keep ablation matrices small by default; expand cases, modes, budgets, or policies only when the previous sweep gives a clear signal.
- Keep long ablation runs staged and timeout-bounded; the corrected 30s LNS budget can legitimately consume far more wall-clock than the previous capped corpus setup.
