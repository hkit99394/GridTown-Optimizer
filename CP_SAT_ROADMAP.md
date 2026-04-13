# CP-SAT Roadmap

## Goal

Strengthen `CP-SAT` as the exact/global solver for City Builder.

This roadmap is intentionally not about quality-per-minute. The focus here is:
- tighter exact modeling
- stronger propagation and bounds
- more stable long runs
- clearer exact-solver observability

## Current Solver Snapshot

In this branch, the CP-SAT backend currently:
- enumerates all service placements directly from the grid
- enumerates all residential placements directly from the grid
- enforces overlap with boolean occupancy constraints
- enforces road connectivity with a directed-flow formulation
- models residential population as `base + service boost`, capped by `max`
- optimizes a scaled objective that prioritizes population and uses roads/services as tie-break penalties
- exposes a configurable runtime surface: time limit, deterministic time, worker count, random seed, randomized search, gap limits, and search logging

Main implementation files:
- [python/cp_sat_solver.py](./python/cp_sat_solver.py)
- [src/cpSatSolver.ts](./src/cpSatSolver.ts)
- [src/types.ts](./src/types.ts)

## Priority Order

### 1. Add exactness-preserving candidate reduction

Expected impact: Highest

Why:
- the model currently builds every valid placement for each service and residential type
- that explodes the number of variables, overlap terms, and service coverage relations
- CP-SAT performance is highly sensitive to candidate count

Targets:
- add faster placement precomputation
- remove only provably dominated service candidates
- add only provably safe residential cuts or symmetry breaking
- avoid duplicate rotation / equivalent placement cases where exactness is preserved

Guardrail:
- do not use heuristic candidate pruning that can remove the true global optimum

### 2. Strengthen the road-connectivity formulation

Expected impact: Highest

Why:
- the current directed-flow model is likely the heaviest part of the exact formulation
- better connectivity propagation can reduce a large amount of useless search

Targets:
- audit the current flow encoding for redundant variables
- add implied constraints around root selection and road usage
- investigate whether a tighter connectivity formulation would dominate the current one

Questions:
- can edge-variable count be reduced?
- can the root/flow balance be tightened?
- can some road cells be eliminated from exact consideration safely?

### 3. Audit the exact objective explicitly

Status: Implemented

Expected impact: High

Why:
- the solver is not just “maximize population”
- it maximizes a scaled objective where roads and services are hard tie-break penalties under the chosen factor
- formulation work should be optimized against the real objective, not a simplified summary

Targets:
- confirm the current objective matches intended product behavior
- decide whether the current scaled form should remain, or be made more explicit as a lexicographic objective policy
- verify that future cuts and symmetry rules remain correct for this exact objective

Delivered:
- the CP-SAT objective is now expressed explicitly as `maximize population, then minimize roads + services`
- the scaling factor is named and audited against the maximum possible tie-break swing
- solver-level tests now cover both fewer-road and fewer-service tie-break behavior

### 4. Add stronger valid inequalities and implied bounds

Expected impact: High

Why:
- CP-SAT performs better when impossible or weak regions of the search tree are cut early
- the current model has room for stronger structural bounds

Targets:
- tighter upper bounds on achievable service bonus
- tighter residential count limits from frontage / road access structure
- local or regional upper bounds where they are provably safe
- stronger per-type availability cuts

### 5. Expand the CP-SAT runtime surface

Status: Implemented

Expected impact: Medium-high

Why:
- current runtime controls are minimal
- exact solving benefits from better control over search policy and stopping

Targets:
- expose `randomSeed`
- expose `randomizeSearch`
- add relative / absolute gap controls
- add deterministic time if useful
- keep worker count configurable, but make benchmarking reproducible

Delivered:
- CP-SAT options now expose `randomSeed`, `randomizeSearch`, `relativeGapLimit`, `absoluteGapLimit`, and `maxDeterministicTime`
- the Python backend applies those options through a dedicated solver-configuration helper
- regression tests now verify that the runtime options reach the OR-Tools solver object

### 6. Add exact-run telemetry

Status: Implemented

Expected impact: Medium-high

Why:
- long exact runs need more visibility than just final status
- users and developers need to distinguish:
  - new incumbent improvement
  - best-bound tightening
  - true search stagnation

Targets:
- surface incumbent value
- surface best bound
- surface optimality gap
- track time since last incumbent improvement

Delivered:
- the CP-SAT backend now emits final exact-run telemetry including incumbent objective, best bound, objective gap, population upper bound, and time since last improvement
- the TypeScript bridge now preserves that telemetry on `Solution.cpSatTelemetry`
- regression tests cover both backend JSON telemetry and the public CP-SAT solution contract

Note:
- this branch currently runs CP-SAT as a single blocking solve, so telemetry work likely needs callback-based reporting and a broader execution model

### 7. Add warm-start and continuation support

Expected impact: Medium

Why:
- the current CP-SAT path does not yet support warm-start hints or saved incumbent reuse
- exact continuation and guided re-solves will matter once the formulation is stronger

Targets:
- allow a saved incumbent to be injected safely
- support continuation runs from a known exact/feasible incumbent
- keep warm-start policy distinct from local-search or heuristic repair behavior

### 8. Add single-machine CP-SAT portfolio search

Expected impact: Medium

Why:
- several exact runs with different seeds and settings may outperform one monolithic run
- this is still much cheaper than distributed solving

Prerequisites:
- reproducible benchmarking
- richer telemetry
- a coordinator layer for multiple CP-SAT workers

### 9. Consider distributed CP-SAT last

Expected impact: Lowest near-term

Why:
- highest complexity
- depends on strong single-machine formulation first
- portfolio search is the better intermediate step

## Suggested Delivery Sequence

### Phase A: Formulation quality

Focus:
- candidate reduction
- symmetry reduction
- objective audit
- stronger connectivity modeling
- stronger valid cuts

Outcome:
- smaller, tighter exact model

### Phase B: Search control

Focus:
- richer parameter surface
- reproducible runs
- gap-aware stopping options

Outcome:
- better-controlled deep exact solves

### Phase C: Observability

Focus:
- incumbent / bound / gap reporting
- callback-based progress tracking
- benchmark harness and standard cases

Outcome:
- trustworthy evaluation of exact-solver changes

### Phase D: Multi-run exact strategies

Focus:
- warm-start / continuation support
- portfolio CP-SAT
- distributed solving only if later justified

Outcome:
- broader global-search coverage without weakening exactness

## Guardrails

- Keep this roadmap exact-solver focused; heuristic workflow belongs elsewhere.
- Prefer formulation improvements before orchestration complexity.
- Treat residential candidate pruning conservatively unless dominance is proven.
- Do not change the exact objective implicitly while tuning the model.
