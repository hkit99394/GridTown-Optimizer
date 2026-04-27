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

## Maintenance Watchpoints

- Keep deterministic benchmark seeds stable when changing solver scoring.
- Keep CP-SAT repair experiments guarded because `repair_hint` plus multi-worker repair previously caused instability.
- Keep distributed or portfolio solving behind proof that single-machine policy is no longer the bottleneck.
- Keep learned guidance separate from core runtime correctness until traces and labels are strong enough.
- Keep final road pruning conservative: population and validity must not depend on the removed roads.
