# Greedy Roadmap

## Goal

Strengthen `greedy` as the fastest reliable incumbent builder in the solver stack.

This roadmap is intentionally not about turning `greedy` into a full exact solver. The focus is:
- stronger incumbents per second
- lower runtime variance on larger grids
- cleaner reuse as the seed phase for `auto` and `LNS`
- safer measurement and iteration on heuristic changes

## Current Status

The current greedy path already does more than a single-pass construction heuristic.

What exists today in [src/solver.ts](./src/solver.ts):
- full candidate enumeration for service and residential placements
- static service scoring plus dynamic marginal service rescoring
- residential fill after service placement
- service-cap sweep when no explicit service cap is provided
- restart support via shuffled service order and deterministic random seeds
- row-0 anchor refinement reruns
- residential-only local search
- service refinement and optional exhaustive top-pool search
- stop-file handling and best-so-far snapshot persistence

This makes `greedy` a strong baseline, but it also means the implementation now pays for repeated rescans and repeated road-connectivity work inside the hottest loops.

## Main Bottlenecks

The biggest near-term issue is not candidate generation itself. The main cost comes from repeated inner-loop work:

- repeated `canConnectToRoads` checks while scanning service and residential candidates
- repeated `ensureBuildingConnectedToRoads` work after a winner is selected
- repeated population scoring for residential candidates after the service set is fixed
- repeated full rescans of candidate lists after each placement
- expensive runtime multiplication from service-cap sweep, restarts, anchor refinement, service refinement, and optional exhaustive service search

The main quality limitation is that service choice still uses a shallow proxy for future value. It estimates residential upside, but it does not reason much about:
- road length
- packing fragmentation
- row-0 anchor quality
- downstream placement opportunity cost

There are also two specific quality gaps in the current implementation:
- the typed-residential service scoring proxy can over-count mutually exclusive same-footprint variants and scarce-type upside
- the `fixedServices` refinement and exhaustive paths do not fully explore row-0 seed or service-permutation effects when evaluating a forced service set

## Roadmap By Impact

### 1. Add measurement before changing heuristic policy

Expected impact: Highest confidence, enables all follow-on work

Why:
- the greedy path now has enough phases that changes can easily move runtime without improving quality
- we need phase-level evidence before changing cap sweep, restarts, or search neighborhoods

Concrete work:
- add lightweight counters around candidate enumeration, connectivity checks, service scans, residential scans, and local-search passes
- add a fixed greedy benchmark corpus and a small summary format for incumbent quality and wall-clock cost
- keep the current optimizer regression suite as the correctness safety net

### 2. Cache connectivity and path reuse inside greedy iterations

Expected impact: Highest near-term runtime gain

Why:
- road connectivity work is repeated inside the hottest candidate loops
- the current path repeatedly asks whether a candidate can connect, then reruns similar work when it actually places the winner

Concrete work:
- build one reachability or path cache per greedy iteration
- reuse that cache during service candidate scans
- reuse that cache during residential candidate scans
- avoid recomputing equivalent BFS work between `canConnectToRoads` and `ensureBuildingConnectedToRoads`

Guardrail:
- preserve the current row-0 connectivity guarantees and post-solve validation behavior

### 3. Cache residential population once the service layout is fixed

Expected impact: High runtime gain, low algorithmic risk

Why:
- after service placement is fixed, residential scoring becomes mostly stable
- the current code repeatedly rescans service effect zones for the same residential candidates

Concrete work:
- precompute final population for each residential candidate after the service phase
- reuse that cache during the main residential fill
- reuse the same cached scoring in residential local search
- invalidate or recompute only when a move actually changes the relevant service exposure model

Guardrail:
- typed residential availability and population caps must stay exact

### 4. Improve tie-breakers and add deterministic same-footprint upgrades

Expected impact: Medium quality improvement with low runtime cost

Why:
- many choices currently fall back to candidate order when scores tie
- same-footprint stronger-type upgrades already exist in `LNS` and can improve greedy output cheaply

Concrete work:
- add service tie-breakers for lower road cost, stronger row-0 anchor preservation, and lower layout fragmentation
- add residential tie-breakers for better packing efficiency and lower future blocking cost
- port deterministic same-footprint service and residential type upgrades from [src/lnsSolver.ts](./src/lnsSolver.ts)

Guardrail:
- keep tie-breaks deterministic when seeds and inputs are fixed

### 5. Make service scoring footprint-aware and availability-aware for typed residential candidates

Expected impact: Medium-high quality improvement

Why:
- the current service proxy scores covered residential candidates independently
- typed residential enumeration creates same-footprint variants per type, but only one of those variants can actually be realized at a given placement
- scarce residential type availability can make the current service score materially over-optimistic

Concrete work:
- collapse mutually exclusive same-footprint typed residential variants into one realizability-aware scoring group
- discount or cap proxy upside when multiple covered typed candidates compete for the same footprint
- incorporate residential availability pressure into service scoring so rare high-value types are not counted as if they were unlimited
- add benchmark cases that specifically exercise same-footprint multi-type and low-availability ranking behavior

Guardrail:
- keep the service scoring proxy cheap enough to preserve greedy as a fast seed builder
- do not accidentally turn the scoring path into a full lookahead solve

### 6. Rework service-cap sweep and restart policy

Expected impact: High runtime gain, moderate heuristic risk

Why:
- solving every cap from `0..inferredUpper` multiplies runtime quickly
- each cap can also trigger restarts and anchor refinement

Concrete work:
- replace exhaustive cap sweep with adaptive exploration around promising service counts
- start with a coarse cap sample instead of `0..upper` full sweep, using endpoints plus interior probes such as `0`, `upper`, `upper/4`, `upper/2`, and `3*upper/4`
- refine locally around the best sampled cap or best small band instead of assuming one directional move is enough
- avoid treating cap search like binary search; population vs service cap is not monotonic and may not even be unimodal because extra services can both increase coverage and damage packing
- add early stopping after a configurable no-improvement band across caps
- reduce or rebalance restart count when the sorted baseline is already stable
- make restart effort proportional to grid size and available service pool complexity

Guardrail:
- do not regress the current useful behavior of avoiding obvious service over-placement when no explicit cap is given

### 7. Replace full rescans with incremental candidate invalidation

Expected impact: Very high runtime gain, medium implementation complexity

Why:
- both service placement and residential placement currently rescan whole candidate lists after each placement
- only a subset of candidates actually changes after each step

Concrete work:
- maintain reverse indexes from occupied cells to affected candidates
- maintain reverse indexes from service placements to covered residential candidates
- only re-evaluate candidates whose feasibility or score changed
- keep a simple initial implementation for correctness before optimizing data layout further

Guardrail:
- phase-level profiling should prove this is worth the added complexity before landing a broad refactor

### 8. Make fixed-service refinement and exhaustive evaluation seed/order-complete

Expected impact: Medium quality improvement, medium implementation cost

Why:
- the current `fixedServices` path evaluates a forced service set in the provided order
- refinement and exhaustive service-layout evaluation do not intentionally vary row-0 seed choice or service permutation
- a service set can therefore be rejected or under-scored even though a different legal seed or ordering would produce a better layout

Concrete work:
- define the intended evaluation contract for `fixedServices`: “evaluate one exact forced layout policy” versus “evaluate the best legal realization of this forced service set”
- if the goal is best legal realization, vary row-0 seed and service permutation during refinement and exhaustive evaluation
- reuse the existing row-0 anchor enumeration ideas already used by the main greedy pass
- add focused regression tests for forced-service evaluation so better realizations are not missed silently

Guardrail:
- control combinatorial growth carefully; this path should stay bounded and measurable
- prefer coarse completeness first, then deeper search only if benchmarks justify it

### 9. Strengthen local search beyond residential-only moves

Expected impact: High solution-quality gain

Why:
- the current `localSearchImprove` phase only moves or adds residentials
- service refinement exists, but it is relatively coarse and expensive because it reruns the full solve for each swap trial

Concrete work:
- add bounded 1-swap and remove-add service neighborhoods
- add delta scoring for service replacement instead of full resolve where possible
- combine service and residential neighborhoods under one improvement budget
- keep stop responsiveness and snapshot safety intact during longer local-improvement phases

Guardrail:
- preserve the role of greedy as a fast seed builder; do not let local search dominate total runtime by default

## Later Priorities

### 10. Reduce allocation pressure in hot geometry and occupancy helpers

Expected impact: Medium runtime gain, broader refactor footprint

Why:
- string cell keys and repeated rectangle materialization add avoidable overhead
- the current implementation allocates aggressively in hot paths

Concrete work:
- move toward integer cell ids or bitset-backed occupancy behind existing helper APIs
- reduce temporary `Set` creation in repeated helper calls
- collapse repeated rectangle normalization in hot loops

### 11. Explore a stronger greedy search policy

Expected impact: Potentially very high quality gain, higher heuristic risk

Options:
- small beam search over partial service layouts
- limited lookahead where candidate service additions trigger a cheap residential refill estimate
- interleaved service and residential construction instead of strict services-first then residentials

Why this is later:
- these changes are higher risk and should come after measurement plus the lower-risk runtime wins

### 12. Decide whether greedy should stay standalone or become more explicitly hybrid

Expected impact: Strategic

Why:
- the product path increasingly values best answer within time budget, not purity of a single heuristic
- `LNS` already treats greedy as a seed generator

Decision point:
- either keep investing in greedy as a stronger standalone heuristic
- or intentionally keep greedy lightweight and shift deeper improvement effort into short neighborhood-improvement phases

## Recommended Implementation Order

1. Add profiling counters and a fixed benchmark slice.
2. Implement connectivity caching and path reuse.
3. Cache residential population after the service phase.
4. Make service scoring footprint-aware and availability-aware for typed residential candidates.
5. Add better tie-breakers and deterministic same-footprint upgrades.
6. Rework cap sweep and restart policy.
7. Introduce incremental candidate invalidation.
8. Make fixed-service refinement and exhaustive evaluation seed/order-complete.
9. Extend local search to include service neighborhoods.
10. Revisit deeper redesigns only after the above is measured.

## Success Metrics

Measure changes against the current greedy baseline using the same corpus and seeds.

Primary metrics:
- best incumbent population
- median and p95 solve wall time
- population per second on medium and large grids
- improvement retained when used as the seed for `LNS` or `auto`

Secondary metrics:
- stop responsiveness
- snapshot freshness under long runs
- seeded reproducibility
- code complexity added per unit of runtime or quality gain

## Guardrails

- Keep greedy seed quality and greedy wall-clock cost both visible in benchmarks.
- Do not silently weaken row-0 connectivity guarantees or final layout validation.
- Prefer deterministic tie-break behavior when a seed is provided.
- Avoid broad structural refactors until profiling proves they matter.
- Treat greedy as part of the staged solver workflow, not as an isolated algorithm.
