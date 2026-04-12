# CP-SAT Roadmap

## Goal

Improve `CP-SAT` as the global solver.

This roadmap is intentionally not optimized for quality-per-minute. The focus here is:
- stronger exact search
- better bounds
- more stable long runs
- clearer progress visibility

## Current Model Summary

Today the CP-SAT backend:
- enumerates all valid service placements
- enumerates all valid residential placements
- enforces overlap and road-adjacency constraints
- models road connectivity with directed flow
- maximizes a scaled objective: `sum(populations) * penalty_cap - roads - services`
- supports warm-start hints and neighborhood fixing

Key implementation files:
- [python/cp_sat_solver.py](/Users/jacktam/Documents/Project/TranStation3.Resource/python/cp_sat_solver.py)
- [src/cpSatSolver.ts](/Users/jacktam/Documents/Project/TranStation3.Resource/src/cpSatSolver.ts)
- [src/types.ts](/Users/jacktam/Documents/Project/TranStation3.Resource/src/types.ts)

## Priority Order

### 1. Reduce candidate symmetry and dominated placements

Expected impact: Highest

Why:
- the model currently enumerates many placements that are structurally similar
- symmetric or provably dominated candidates make the branch-and-bound search much larger
- this hurts both incumbent discovery and lower-bound progress

Targets:
- prune provably dominated service candidates before model creation
- apply only provably safe residential cuts and symmetry breaking before model creation
- reduce equivalent rotation / placement duplicates where possible
- add stronger ordering rules for otherwise equivalent candidates

Examples:
- same-footprint service placements where one type is strictly weaker
- residential variants that can be removed only when dominance is proven under the exact model bounds
- mirrored or duplicate orientation cases that produce equivalent decisions

### 2. Strengthen the road-connectivity model

Expected impact: Highest

Why:
- road connectivity is currently enforced with directed flow variables on road edges
- this is likely one of the heaviest parts of the model
- exact solving quality depends heavily on how well this part propagates

Targets:
- review the current flow encoding for redundant variables and weak constraints
- add implied constraints that tighten the root / road / flow relationship
- evaluate whether a different connectivity encoding would propagate better

Questions to answer:
- can we reduce edge-variable count?
- can we tighten root supply / flow balance further?
- can we pre-eliminate road cells that can never participate in a useful connected plan?

### 3. Add stronger valid inequalities and implied bounds

Expected impact: High

Why:
- the model should cut impossible or clearly weak regions of the search tree earlier
- CP-SAT performs better when the formulation carries more structural knowledge

Targets:
- tighter service-count upper bounds from actual candidate structure
- tighter residential-count upper bounds from frontage / road access
- local bounds around service coverage and residential capacity
- implied limits on combinations that cannot improve the objective

Examples:
- upper bounds on population achievable in subregions
- bounds from total available service bonus versus residential cap structure
- stronger per-type availability cuts where candidate sets are sparse

### 4. Audit the objective formulation explicitly

Expected impact: High

Why:
- the current model does not simply maximize population
- it maximizes `sum(populations) * penalty_cap - roads - services`
- that makes roads and services a hard tie-break at the chosen scale, which affects symmetry, bounds, and search behavior

Targets:
- confirm the objective matches the intended exact optimization goal
- verify whether road and service penalties should remain a strict tie-break or become an explicit lexicographic policy
- review whether formulation changes elsewhere are being optimized against the right objective assumptions

Questions to answer:
- should the solver optimize `population first, then roads/services`, exactly as it does now?
- is the current `penalty_cap` construction the cleanest expression of that intent?
- are there alternative exact formulations that would strengthen bounds or reduce symmetry?

### 5. Improve warm-start and incumbent usage

Expected impact: High

Why:
- warm starts are useful, but they are only one part of exact search
- we should use incumbents to guide search without accidentally over-constraining it

Targets:
- review when `objectiveLowerBound` should be applied
- distinguish “use incumbent as guidance” from “force strict improvement immediately”
- make warm-start policy explicit for:
  - exact deep solve
  - improvement-only solve
  - continuation solve from saved layouts

Important note:
- current warm starts can add a hard population cutoff, which is useful for improvement runs but can also delay the next feasible incumbent

### 6. Expose richer CP-SAT search parameters

Expected impact: Medium-high

Why:
- the backend currently exposes only a small portion of CP-SAT’s tuning surface
- for a global solver, gap control and search policy matter a lot

Candidates:
- relative gap limit
- absolute gap limit
- deterministic time
- worker allocation controls
- stable advanced search settings after validation

Non-goal:
- do not reintroduce the known unsafe local `repair_hint` crash path without proving it is fixed in the runtime

### 7. Improve exact-run telemetry

Expected impact: Medium-high

Why:
- a long exact run should be understandable even without a new incumbent
- bound movement is essential for evaluating whether the solver is still making progress

Important prerequisite:
- today the backend callback can observe bound movement, but the web job layer does not preserve or expose it
- this requires a broader snapshot/status schema, not only UI work

Metrics to expose:
- incumbent value
- best bound
- optimality gap
- time since last incumbent improvement
- solver status transitions

Planner value:
- lets the user tell the difference between:
  - improving incumbent
  - tightening proof only
  - truly stalled search

Concrete work:
- preserve best-bound updates from the solver callback
- extend the background job status shape beyond `hasFeasibleSolution` and `totalPopulation`
- thread those fields through the request handler and planner runtime

### 8. Make benchmarking reproducible

Expected impact: Medium

Why:
- exact-model tuning is hard to evaluate without stable experiments
- current runs can vary due to seeds, workers, and hinted incumbents

Targets:
- expose and consistently use CP-SAT random seed for experiments
- stabilize greedy seed generation when CP-SAT depends on a greedy-produced hint
- define benchmark cases and standard run configurations

Success criteria:
- same benchmark instance and settings give comparable trajectories
- model changes can be judged by evidence rather than anecdote

### 9. Add single-machine portfolio CP-SAT

Expected impact: Medium

Why:
- several exact runs with different seeds and parameter mixes can outperform one monolithic run
- this is still much simpler than true distributed solving

Prerequisites:
- reproducible benchmarking
- richer telemetry
- coordinator support for multiple workers and shared best-result reporting
- backend status/schema support for aggregated incumbent and bound updates

Current gap:
- today one request maps to one background solve handle
- portfolio search will need a coordinator layer rather than simply spawning more workers under the current job model

Planned shape:
- 2-4 parallel CP-SAT workers
- varied seeds and search settings
- aggregate best incumbent and best bound in one coordinator
- early-stop laggards when useful

### 10. Consider multi-machine distributed CP-SAT last

Expected impact: Lowest near-term

Why:
- highest implementation complexity
- depends on strong single-machine formulation first
- portfolio search is the better intermediate step

## Suggested Delivery Sequence

### Phase A: Formulation quality

Focus:
- candidate pruning
- symmetry reduction
- objective audit
- stronger connectivity modeling
- stronger valid cuts

Outcome:
- smaller and tighter exact model

### Phase B: Exact-search control

Focus:
- richer parameter surface
- better warm-start policy
- gap-based stopping options

Outcome:
- more controllable deep solves

### Phase C: Observability and benchmarking

Focus:
- best bound / gap reporting
- broader backend status schema
- reproducible seeds
- benchmark harness and standard cases

Outcome:
- trustworthy measurement of CP-SAT improvements

### Phase D: Multi-run strategies

Focus:
- single-machine portfolio search
- later, only if justified, distributed search

Outcome:
- stronger global-search coverage without changing the exact model itself

## Guardrails

- Do not optimize this roadmap around short-run user experience; that already belongs to the broader solver roadmap.
- Do not treat warm starts as equivalent to local search; CP-SAT is still solving the global model unless variables are explicitly fixed.
- Do not re-enable unsafe hint-repair behavior in the local OR-Tools runtime without validating it first.
- Prefer formulation improvements before orchestration complexity.
