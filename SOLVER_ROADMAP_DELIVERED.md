# Solver Roadmap Delivered

This file keeps completed solver-roadmap work out of the main roadmap. The active plan lives in [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md).

## Delivered Work

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

## Maintenance Watchpoints

- Keep deterministic benchmark seeds stable when changing solver scoring.
- Keep CP-SAT repair experiments guarded because `repair_hint` plus multi-worker repair previously caused instability.
- Keep distributed or portfolio solving behind proof that single-machine policy is no longer the bottleneck.
- Keep learned guidance separate from core runtime correctness until traces and labels are strong enough.
