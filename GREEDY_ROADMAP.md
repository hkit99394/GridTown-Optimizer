# Greedy Roadmap

## Goal

Strengthen `greedy` as the fastest reliable incumbent builder in the solver stack.

This roadmap is intentionally not about turning `greedy` into a full exact solver. The focus is:
- stronger incumbents per second
- lower runtime variance on larger grids
- cleaner reuse as the seed phase for `auto` and `LNS`
- safer measurement and iteration on heuristic changes

## Current Status

The current greedy path is no longer a simple construction heuristic. The shipped bounded slices in this roadmap have already turned it into a measured, staged heuristic with stronger post-construction improvement and better runtime instrumentation.

What exists today in [src/greedy/solver.ts](./src/greedy/solver.ts):
- full candidate enumeration for service and residential placements
- grouped typed-residential service scoring plus dynamic marginal service rescoring
- residential fill after service placement
- adaptive cap search when no explicit service cap is provided
- restart support via shuffled service order and deterministic random seeds
- row-0 anchor refinement reruns
- residential local search plus bounded service neighborhoods
- direct service-relocation neighborhoods on top of that local-search pass
- bounded service-add lookahead in the main explicit greedy service loop
- optional deferred-road construction as an experiment
- service refinement and optional bounded exhaustive top-pool search
- stop-file handling and best-so-far snapshot persistence

This makes `greedy` a strong standalone baseline and a much better seed builder for `auto` and `LNS`, but it also means the implementation still pays for some expensive fallback paths and hot-loop helper overhead.

## Review Update

After the shipped Steps 1-15 bounded slices, the greedy path is much stronger and better instrumented than the original roadmap baseline. The current implementation now has:
- measured phase-level behavior through the fixed benchmark corpus
- grouped typed-residential service scoring
- adaptive cap search
- deferred-road construction as an opt-in experiment
- bounded fixed-service seed/order completeness
- direct service-relocation neighborhoods on top of residential local search
- lower-allocation geometry and road-probe helpers behind the current public APIs
- bounded service-add lookahead in the main explicit greedy service loop
- an explicit product posture where `auto` is the recommended quality path with a capped fast Greedy seed stage, while standalone `greedy` is the heavy heuristic / advanced inspection mode

The biggest remaining practical gaps are now narrower and more specific:
- `localSearchImprove()` still allocates fresh occupancy snapshots for residential move scans, which is now one of the more obvious remaining hot allocations in the greedy path
- explicit-road probing still rebuilds block-state views per probe and still pays the cost of string-key `Set` semantics internally, even after the Step 11 helper refactor
- Step 14 lookahead is intentionally narrow: it only reranks the top-N explicit non-`fixedServices` candidates, and it still does not widen greedy into a fuller multi-step search policy
- the roadmap should now focus less on generic “speed up greedy somehow” work and more on replacing the remaining expensive fallback mechanisms with narrower scratch-state helpers and on making `auto` / `LNS` follow-on improvement do the deeper search work

All 15 roadmap steps below are now shipped as bounded slices. The sections below are retained as a delivery record. New work should come from the focused follow-up backlog, not by treating the historical steps as still open.

## Focused Follow-Up Backlog

These are the only greedy-specific items that currently look worth considering before handing deeper improvement budget to `auto` and `LNS`:

1. Replace residual `localSearchImprove()` occupancy snapshot allocation with rollback-safe scratch state.
2. Reduce explicit-road probe overhead further by reusing block-state views and moving more internal hot loops away from string-key `Set` semantics.
3. Use phase profile data to decide whether `auto` should spend more or less of its budget on the fast Greedy seed stage.
4. Keep `greedy.serviceLookaheadCandidates` and `greedy.deferRoadCommitment` opt-in until the fixed corpus shows broad, repeatable gains.
5. Extract only stable profiler or scratch-helper modules after benchmark evidence shows the boundary is worth preserving.

## Residual Bottlenecks

The biggest remaining issue is not candidate generation itself. The main cost comes from repeated inner-loop work:

- repeated `canConnectToRoads` checks while scanning service and residential candidates
- repeated `ensureBuildingConnectedToRoads` work after a winner is selected
- residual residential move/add rescans inside `localSearchImprove()`
- runtime and memory inflation from same-footprint typed residential expansion, which still enlarges candidate lists and residential/local-search rescans even though service scoring is now grouped
- remaining runtime multiplication from bounded cap search, refinement, service neighborhoods, and optional exhaustive or fixed-service reevaluation passes

The main quality limitation is that service choice still uses a bounded proxy for future value. It now has grouped service scoring plus a bounded lookahead reranker, but it still does not reason much about:
- road length
- packing fragmentation
- row-0 anchor quality
- downstream placement opportunity cost
- premature road commitment that can occupy corridor cells needed by better later buildings

There are also two specific residual limitations in the current implementation:
- the Step 14 lookahead path is intentionally bounded and explicit-road-only, so deferred-road mode and `fixedServices` reruns still fall back to the simpler service-selection policy
- fixed-service completeness is now bounded rather than exhaustive, so refinement and exhaustive evaluation still trade completeness for measured runtime caps

Decision rule:
- make new greedy work prove either better seed quality per second for `auto` / `LNS`, or a meaningful standalone `greedy` runtime reduction on the fixed corpus
- keep broader service-search policy changes behind flags until equal-budget scorecards show they help downstream modes, not only isolated greedy cases

## Shipped Steps By Impact

These sections are kept as the implementation record for the shipped bounded slices. They are still ordered by impact/topic, not as a list of remaining open tasks.

Within each step:
- `Expected impact`, `Why`, `Concrete work`, and `Guardrail` preserve the original design rationale.
- `Shipped bounded slice` records what actually landed.

### 1. Add measurement before changing heuristic policy

Expected impact: Highest confidence, enables all follow-on work

Why:
- the greedy path now has enough phases that changes can easily move runtime without improving quality
- we need phase-level evidence before changing cap sweep, restarts, or search neighborhoods

Concrete work:
- add lightweight counters around candidate enumeration, connectivity checks, service scans, residential scans, and local-search passes
- add a fixed greedy benchmark corpus and a small summary format for incumbent quality and wall-clock cost
- keep the current optimizer regression suite as the correctness safety net

Shipped measurement surface:
- `greedy.profile` emits counter groups for `precompute`, `attempts`, `servicePhase`, `residentialPhase`, `localSearch`, and `roads`
- `npm run benchmark:greedy` runs a fixed greedy corpus and supports `--list` plus a stable `--json` snapshot that omits timestamps and wall-clock noise

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

Shipped bounded slice:
- `src/core/roads.ts` now uses one shared connection probe for both `canConnectToRoads` and `ensureBuildingConnectedToRoads`
- `src/greedy/solver.ts` now reuses the winning probe inside service, residential, and local-search scans so selected placements do not rerun the same connectivity search
- `benchmark:greedy` now includes `bridge-connectivity-heavy` to keep probe reuse measurable in a deterministic corridor-style case

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

Shipped bounded slice:
- `src/greedy/solver.ts` now builds a per-`solveOne` residential population cache immediately after the service phase settles
- the cache is reused during both residential fill and `localSearchImprove`, while availability and overlap checks remain live
- `benchmark:greedy` now reports `pop-cache` counters so cache entries and lookup volume stay visible on fixed benchmark cases

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
- port deterministic same-footprint service and residential type upgrades from [src/lns/solver.ts](./src/lns/solver.ts)

Guardrail:
- keep tie-breaks deterministic when seeds and inputs are fixed

Shipped bounded slice:
- `src/greedy/solver.ts` now keeps primary service score and residential population ordering unchanged, then resolves equal-score ties with deterministic probe-cost and footprint-aware comparators while preserving row-0 preference only on the service side
- `src/core/dominanceUpgrades.ts` now holds the shared same-footprint typed-upgrade post-pass used by both greedy and LNS
- `benchmark:greedy` now includes `deterministic-tie-breaks` so Step 4 behavior stays visible in the fixed corpus

### 5. Make service scoring footprint-aware and availability-aware for typed residential candidates

Expected impact: Medium-high quality improvement

Why:
- the current service proxy scores covered residential candidates independently
- typed residential enumeration creates same-footprint variants per type, but only one of those variants can actually be realized at a given placement
- scarce residential type availability can make the current service score materially over-optimistic
- the same expansion also increases candidate, indexing, and rescan cost before it causes ranking mistakes

Concrete work:
- collapse mutually exclusive same-footprint typed residential variants into one realizability-aware scoring group
- discount or cap proxy upside when multiple covered typed candidates compete for the same footprint
- incorporate residential availability pressure into service scoring so rare high-value types are not counted as if they were unlimited
- let footprint-level grouping feed runtime improvements too, so service coverage and residential rescans operate on grouped realizations instead of all same-footprint variants
- add benchmark cases that specifically exercise same-footprint multi-type and low-availability ranking behavior

Guardrail:
- keep the service scoring proxy cheap enough for Auto's capped fast Greedy seed stage
- do not accidentally turn the scoring path into a full lookahead solve

Shipped bounded slice:
- `src/greedy/solver.ts` now groups typed residential variants by exact footprint for service scoring, so same-footprint alternatives contribute through one realizable scoring group instead of being summed independently
- grouped service scoring now applies a local per-type availability-pressure multiplier when a service covers more premium typed groups than the configured `avail` can realize
- grouped footprints now also drive the service-coverage index used by greedy scoring, reducing duplicate same-footprint work in the service-ranking path
- `greedy.profile` now exposes grouped-scoring counters for collapsed variants, grouped coverage, grouped score evaluations, and availability-discounted groups
- `benchmark:greedy` now includes `typed-footprint-pressure` and `typed-availability-pressure` so Step 5 stays visible in the fixed corpus

### 6. Rework service-cap sweep and restart policy

Expected impact: High runtime gain, moderate heuristic risk

Why:
- solving every cap from `0..inferredUpper` multiplies runtime quickly
- each cap can also trigger restarts and anchor refinement
- many restart attempts currently explore only shallow diversity because they mostly perturb service ordering, and that ordering often changes outcomes only on score ties

Concrete work:
- replace exhaustive cap sweep with adaptive exploration around promising service counts
- start with a coarse cap sample instead of `0..upper` full sweep, using endpoints plus interior probes such as `0`, `upper`, `upper/4`, `upper/2`, and `3*upper/4`
- refine locally around the best sampled cap or best small band instead of assuming one directional move is enough
- avoid treating cap search like binary search; population vs service cap is not monotonic and may not even be unimodal because extra services can both increase coverage and damage packing
- add early stopping after a configurable no-improvement band across caps
- reduce or rebalance restart count when the sorted baseline is already stable, and add stronger diversification than simple service-order shuffles
- make restart effort proportional to grid size and available service pool complexity

Guardrail:
- do not regress the current useful behavior of avoiding obvious service over-placement when no explicit cap is given

Shipped bounded slice:
- `src/greedy/solver.ts` now keeps explicit `maxServices` behavior unchanged, while no-cap solves switch to deterministic coarse-to-fine cap search once `inferredUpper > 6`
- the adaptive path probes coarse caps at the endpoints and quarter splits first, then refines around the best two coarse caps instead of sweeping every value in `0..upper`
- small `inferredUpper` cases still keep the old full sweep as a guardrail, so tiny service pools do not lose coverage from the bounded search
- shuffled restarts and row-0 anchor refinement now run only on refine caps; coarse probes are baseline-only so low-diversification restart spend no longer multiplies across the whole cap range
- `greedy.profile` now exposes `coarseCaps`, `refineCaps`, `capsSkipped`, and `restartCaps`, and `benchmark:greedy` includes `adaptive-cap-search-wide` plus a `cap-search=` summary line in the fixed corpus output

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

Shipped bounded slice:
- `src/greedy/solver.ts` now maintains active candidate pools for the main service placement loop and the main residential placement loop, so overlap-invalidated candidates drop out of future scans instead of being rechecked every iteration
- reverse indexes from occupied cells to service candidates, residential candidates, and residential scoring groups are now precomputed once per greedy solve and reused by every `solveOne()` attempt
- service rescoring is now lazy in the main service loop: scores stay cached until a newly blocked residential group or a newly boosted covered group marks the affected service candidates dirty
- service and residential type exhaustion now proactively invalidate candidates of exhausted types in the main construction loops
- the `fixedServices` service-placement path and `localSearchImprove()` remain unchanged in this first slice, but any `solveOne()` call now reuses the new residential active-pool invalidation loop, including refinement and exhaustive reruns
- connectivity probing stays fresh for active candidates on every scan; failed road probes are not cached across iterations in this first invalidation slice
- `greedy.profile` now exposes service/residential invalidation counts plus dirty/rescore counters, and `benchmark:greedy` includes `crowded-invalidation-heavy` with an `invalidation=` summary line so Step 7 stays visible in the fixed corpus

### 8. Prototype deferred road commitment using row-0-reachable empty space

Expected impact: Medium-high quality improvement, medium heuristic risk

Why:
- the current greedy path materializes the selected connection path immediately after each accepted placement
- those committed road cells then become occupied cells that can block later service or residential placements
- on corridor or choke-point maps, a locally cheap early road path can shrink the later packing frontier more than the current scoring or tie-breakers account for
- row-0 buildings already have a simpler rule and should keep it: if a building footprint touches row `0`, it passes connectivity immediately without any extra empty-cell or BFS check

Concrete work:
- introduce a temporary row-0-reachable empty-space frontier for greedy construction, distinct from the final explicit road set
- during service and residential candidate scans, treat a non-row-0 building as connectable when at least one adjacent empty allowed cell can reach row `0` through empty allowed cells
- do not immediately occupy the winning connection path during the main construction loop; only occupy the building footprint while the deferred-connectivity model remains consistent
- keep row-0 buildings as automatic pass-through candidates in both construction and validation planning
- add a bounded post-pass that materializes an explicit connected road set for the chosen buildings, preferably sharing paths across buildings instead of replaying one shortest path per building independently
- validate the reconstructed roads with the existing evaluator and reject or repair any deferred layout that cannot be realized as a legal explicit road network
- add focused benchmarks for narrow corridors, single-gate regions, and packing-heavy maps where early road occupation currently blocks later buildings

First bounded slice:
- gate the experiment behind a greedy option so the current explicit-road construction path remains the default while the deferred policy is measured
- start with full recomputation of the row-0-reachable empty frontier after each accepted placement before attempting more incremental maintenance
- reconstruct roads only once after the main construction pass, then compare incumbent population, road count, and wall time against the current explicit-road baseline

Guardrail:
- every returned greedy solution must still include an explicit road set that satisfies the spec and the strict evaluator
- do not weaken the current row-0 shortcut: buildings whose footprint touches row `0` should continue to pass connectivity immediately
- if deferred connectivity picks a building set that cannot be realized by an explicit connected road network, fail that realization deterministically instead of silently returning an implicit-road layout

Shipped bounded slice:
- `src/greedy/solver.ts` now supports `greedy.deferRoadCommitment` as an opt-in experiment; the default path still commits explicit road paths during construction
- in deferred mode, the main service and residential construction loops recompute row-0-reachable empty space after each accepted placement and treat non-row-0 candidates as connectable when one of their border cells stays inside that frontier
- deferred mode only applies to the main construction pass in this first slice; `fixedServices` reruns still evaluate under the explicit-road path, and row-0 anchor refinement is skipped while deferred mode is enabled because the construction frontier is no longer tied to a single committed row-0 seed
- before `localSearchImprove()` and final validation, the chosen building set is converted back into an explicit connected road network; if that reconstruction fails, the trial is rejected deterministically instead of returning an implicit-road layout
- `greedy.profile` now exposes deferred frontier recomputation and reconstruction counters, and `benchmark:greedy` includes `deferred-road-packing-gain` plus a `deferred-roads=` summary line so the experiment stays visible in the fixed corpus

### 9. Make fixed-service refinement and exhaustive evaluation seed/order-complete

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

Shipped bounded slice:
- `src/greedy/solver.ts` now treats `fixedServices` refinement and exhaustive reruns as “best legal realization of this forced service set,” not just “evaluate the provided order once”
- forced-service evaluation now runs through one bounded helper that tries a deduped order set first, then replays the strongest successful orders across a bounded row-0 seed set derived from the existing anchor helpers plus representative row-0 seeds
- refinement uses a richer forced-set budget than exhaustive search so service-swap trials can explore more legal realizations without letting exhaustive combination search explode combinatorially
- `greedy.profile` now exposes `fixedServiceRealizationTrials`, and the fixed corpus includes `fixed-service-realization-complete` plus focused regressions for a seed-sensitive single-service case and a multi-service refine case

### 10. Strengthen local search beyond residential-only moves

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
- preserve Auto's capped fast Greedy seed role; keep standalone Greedy's heavier local search bounded and measurable

Shipped bounded slice:
- `src/greedy/solver.ts` now keeps the existing residential move/add loop inside `localSearchImprove()`, then adds one bounded top-level service neighborhood pass under the same `greedy.localSearch` flag
- the first slice evaluates deterministic `remove`, `add`, and `swap` service neighbors against the incumbent using the existing bounded forced-service evaluator, instead of widening local search into a second full cap/restart solve
- the service-neighborhood budget is intentionally small and fixed so Step 10 improves incumbent quality without letting local search dominate default greedy runtime
- `greedy.profile` now exposes `localSearch` service-neighborhood counters, and `benchmark:greedy` includes `service-local-neighborhood` plus a `local-service=` summary line so the new slice stays visible in the fixed corpus

## Additional Shipped Steps

### 11. Reduce allocation pressure in hot geometry and occupancy helpers

Expected impact: Medium runtime gain, broader refactor footprint

Why:
- string cell keys and repeated rectangle materialization add avoidable overhead
- the current implementation allocates aggressively in hot paths

Concrete work:
- move toward integer cell ids or bitset-backed occupancy behind existing helper APIs
- reduce temporary `Set` creation in repeated helper calls
- collapse repeated rectangle normalization in hot loops

Shipped bounded slice:
- `src/core/grid.ts` now exposes visitor-style rectangle and neighbor helpers so hot callers can iterate footprint and border cells without allocating temporary arrays first
- `src/core/buildings.ts` now uses those helpers for `overlaps`, service-boost checks, and `buildServiceEffectZoneSet()`, while keeping the existing array-returning compatibility APIs in place
- `src/core/roads.ts`, `src/greedy/solver.ts`, and `src/greedy/row0Anchors.ts` now use the lower-allocation helpers in the explicit-road probe path and the hottest occupancy update loops, while preserving `Set<string>` road/building semantics and the existing public solution shape
- this slice intentionally does not change cell-key representation, deferred-road semantics, or local-search snapshot handling; it is a semantics-preserving runtime refactor behind the current helper APIs
- `tests/optimizers.test.cjs` now includes helper-level parity checks for rectangle iteration, effect-zone construction, and representative edge-border road probes, while the fixed greedy benchmark corpus continues to guard solution outputs

Guardrail:
- keep the public helper surface stable for now; land lower-allocation internals before considering a wider occupancy representation change

### 12. Replace forced-set service neighborhoods with direct relocation scoring

Expected impact: Medium-high quality/runtime gain

Why:
- the current Step 10 service-neighborhood slice works by sending `remove`/`add`/`swap` candidates back through the bounded forced-set evaluator
- that is a good first correctness slice, but it still pays near-refinement costs per accepted or rejected service-neighborhood trial
- it also does not reuse the already available residential population cache or current placed-residential state directly

Concrete work:
- replace the current forced-set-based service local search with a direct same-type relocation neighborhood scored against the current placed residential set
- rebuild explicit roads and refresh service exposure/population caches only after an accepted relocation instead of per rejected neighborhood trial
- keep the existing candidate caps and deterministic tie-breakers, but make the service-neighborhood budget adaptive to incumbent size
- compare `localSearchServiceMoves: false` versus the direct relocation path on the fixed corpus before widening neighborhoods further

Guardrail:
- preserve exact service type accounting, explicit road validity, and deterministic seeded behavior

Shipped bounded slice:
- `src/greedy/solver.ts` now evaluates Step 12 service neighborhoods as direct same-type relocations instead of running `remove`/`add`/`swap` through the Step 9 fixed-service evaluator for every trial
- relocation candidates are scored against the incumbent occupancy and grouped residential upside with the current service removed from the boost state, then only the top-ranked few are exact-realized through the existing fixed-service solve path
- the direct path now samples candidates per service type instead of from the global top-N pool, which avoids starving lower-ranked incumbent types during relocation search
- `tests/optimizers.test.cjs` keeps `service-local-neighborhood` as the main guardrail and now asserts the Step 12 path improves the `240` baseline to `295`, keeps `fixedServiceRealizationTrials === 0`, and exercises remove/add/swap service neighborhoods
- the broader fixed corpus currently lands `adaptive-cap-search-wide` at `848` and `geometry-occupancy-hot-path` at `1030` under the shipped Step 12 slice

### 13. Introduce candidate geometry caches and tested scratch workspaces

Expected impact: Medium runtime gain, moderate refactor risk

Concrete work:
- cache candidate footprint/effect-zone cell keys or ids behind the current helper boundaries so repeated greedy passes stop recomputing the same geometry
- add reusable scratch occupancy / BFS workspaces with explicit rollback tests for local-search scans and road probes
- keep public `Set<string>` and serialization surfaces unchanged while moving only the internal hot loops onto scratch-state helpers

Original rationale for sequencing:
- these changes touch correctness-sensitive mutation paths, so they need stronger helper-level aliasing and rollback tests first

Shipped bounded slice:
- `src/core/buildings.ts` now caches rectangle footprint keys and service effect-zone keys behind the existing helper APIs, so repeated footprint/effect-zone reads stop rebuilding the same geometry while the public `string[]` / `Set<string>` surface stays intact
- `src/core/roads.ts` now supports a reusable `RoadProbeScratch` workspace for explicit-road BFS probes, threaded through `probeBuildingConnectedToRoads`, `canConnectToRoads`, `ensureBuildingConnectedToRoads`, and deferred-road materialization without changing caller-visible behavior
- `src/greedy/solver.ts` now reuses one explicit-road scratch workspace across service scans, residential scans, Step 12 service relocations, deferred-road reconstruction, local search, and final road validation; it also reuses cached candidate/group footprint keys plus a rollback-safe occupancy scratch in the bounded service neighborhood
- `greedy.profile` now exposes `geometryCacheEntries`, `occupancyScratchReuses`, and `scratchProbeCalls`, and `benchmark:greedy` prints a `step13=` summary line so the runtime-only refactor stays visible in the fixed corpus
- `tests/optimizers.test.cjs` now keeps helper-level parity guards for geometry caches and reusable road-probe scratch repeatability, while the fixed corpus now holds `geometry-occupancy-hot-path` at `1030`

### 14. Explore a stronger greedy search policy

Expected impact: Potentially very high quality gain, higher heuristic risk

Options:
- small beam search over partial service layouts
- limited lookahead where candidate service additions trigger a cheap residential refill estimate
- interleaved service and residential construction instead of strict services-first then residentials

Original rationale for sequencing:
- these changes are higher risk and should come after measurement plus the lower-risk runtime wins

Shipped bounded slice:
- `src/greedy/solver.ts` now supports an opt-in `greedy.serviceLookaheadCandidates` reranker in the main explicit non-`fixedServices` service loop
- the Step 14 path first keeps the existing marginal-score pass, then reranks only the top-N already-feasible service candidates with a bounded sequential residential refill simulation capped at two placements
- the refill simulation replays row-0 reservation checks, exact road-path blocking, overlap invalidation, and typed residential availability on scratch state; deferred-road mode and `fixedServices` still skip the reranker entirely
- equal lookahead totals still fall back to the current marginal score and `compareServiceTieBreaks(...)`, so enabling the flag does not introduce a new tie policy
- `benchmark:greedy` now carries the isolated `step14-service-lookahead-reranker` case plus a `step14=` profile line, and the current bounded slice improves that case from `240` to `275` with the feature enabled while keeping the flag-off baseline unchanged
- `tests/optimizers.test.cjs` now covers Step 14 corpus isolation, flag-off parity, enabled-case improvement, and benchmark option normalization for `serviceLookaheadCandidates`

### 15. Decide whether greedy should stay standalone or become more explicitly hybrid

Expected impact: Strategic

Why:
- the product path increasingly values best answer within time budget, not purity of a single heuristic
- `LNS` already treats greedy as a seed generator

Decision:
- keep `greedy` available as a standalone optimizer for deeper heuristic benchmarking and manual tuning
- make the product posture explicitly hybrid: `auto` is the recommended quality path with a capped fast Greedy seed stage, while standalone `greedy` is the heavy heuristic / advanced inspection mode
- prefer spending deeper improvement budget in `LNS`, bounded `CP-SAT`, and `auto` follow-on stages unless a greedy change clearly improves seed quality per second

User-facing framing:
- `Auto` is the recommended mode when overall answer quality matters more than keeping the run purely standalone or heuristic
- `Greedy` is the heavy standalone heuristic / advanced inspection mode for Greedy-only quality checks or manual tuning
- `LNS` is the manual improvement mode that starts from a greedy or displayed seed
- `CP-SAT` is the bounded polish pass, usually strongest after a seed already exists

Shipped bounded slice:
- roadmap and planner copy now describe `auto` as the recommended quality path with the fast Greedy seed stage, and standalone `greedy` as the heavy heuristic / advanced inspection mode
- this step intentionally does not change solver policy; it only makes the product decision explicit in docs and user-facing text

## Historical Implementation Order

This is the order the roadmap recommended while the work was still in flight. It is preserved here as historical guidance; it is not a list of remaining tasks.

1. Add profiling counters and a fixed benchmark slice.
2. Implement connectivity caching and path reuse.
3. Cache residential population after the service phase.
4. Rework cap sweep and restart policy.
5. Make service scoring footprint-aware and availability-aware for typed residential candidates.
6. Add better tie-breakers and deterministic same-footprint upgrades.
7. Introduce incremental candidate invalidation.
8. Prototype deferred road commitment with row-0-reachable empty-space checks plus explicit road reconstruction.
9. Make fixed-service refinement and exhaustive evaluation seed/order-complete.
10. Extend local search to include service neighborhoods.
11. Reduce allocation pressure in hot geometry and occupancy helpers.
12. Replace forced-set service neighborhoods with direct delta-scored service relocations.
13. Add candidate geometry caches and tested scratch workspaces.
14. Explore stronger greedy search policy changes only after the above is measured.
15. Lock the hybrid product posture after the above is measured and keep the fast seed framed as Auto's first stage, with standalone Greedy as the heavy heuristic / advanced inspection mode.

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
- If greedy experiments with deferred or implicit road candidates, always reconstruct and validate an explicit final road set before returning a solution.
- Prefer deterministic tie-break behavior when a seed is provided.
- Avoid broad structural refactors until profiling proves they matter.
- Treat Auto as the owner of the capped fast Greedy seed stage, and standalone Greedy as the heavy heuristic / advanced inspection mode rather than the primary quality path.
