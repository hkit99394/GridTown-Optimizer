# Solver Roadmap

## Goal

Maximize solution quality per minute while keeping the solver workflow reliable, observable, and easy to use from the planner.

The working runtime strategy is:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement or proof pass
4. Let planner-visible `auto` orchestrate that staged incumbent-first flow
5. Keep raw `greedy`, `LNS`, and `CP-SAT` available as manual and advanced modes

User-facing solver mode policy:

| Mode | Best for | Expected posture | Uses displayed layout by default | When not to use |
| --- | --- | --- | --- | --- |
| `auto` | default quality path | time-boxed best effort that keeps the best incumbent and explains why it stopped | yes, as `LNS` seed / `CP-SAT` hint when compatible | when you specifically need a raw heuristic or exact-only diagnostic run |
| `greedy` | fast legal layouts and seed-quality inspection | quickest standalone heuristic baseline | no | when overall answer quality matters more than speed |
| `LNS` | improving the current displayed or greedy-seeded layout | bounded neighborhood repair around an incumbent | yes | when there is no useful incumbent or when exact proof/bounds matter most |
| `CP-SAT` | bounded exact improvement, proof, and diagnostics | single exact run with optional warm start and progress bounds | yes, as a hint when compatible | when a fast first incumbent is more important than deeper exact search |
| `CP-SAT portfolio` | advanced exact search inside one machine budget | multiple exact-search paths competing within explicit guardrails | yes, as hints per worker when compatible | when the staged `auto` flow or a single exact run is easier to reason about |

## Current Status

### Done

#### 1. The full solver stack is shipped

Status: Completed

What exists today:
- `greedy`, `LNS`, `CP-SAT`, and `auto` are all available in the backend, CLI, and planner.
- `auto` runs staged `greedy -> LNS -> CP-SAT` cycles with weak-cycle stopping, wall-clock caps, stage metadata, and generated per-stage random seeds.
- `LNS` can start from either a greedy incumbent or a displayed saved-layout seed.
- `LNS` keeps the best known incumbent, supports stop / snapshot recovery, and treats recoverable repair misses as `no improvement` instead of a full run failure.
- `CP-SAT` supports bounded exact runs, continuation hints, lower bounds, no-improvement cutoffs, and the async solve path used by runtime-facing integrations.

#### 2. The incumbent-first workflow is the default quality path

Status: Completed

What exists today:
- omitted-optimizer runtime/API calls resolve to `auto`
- the planner defaults to `auto`
- the example CLI defaults to `auto`
- the planner presents `auto` as the recommended quality path
- planner runtime presets keep `Heavy Greedy`, `LNS Improve`, and `Bounded CP-SAT` one click away
- stage-aware runtime messages, live snapshots, stop support, and persisted progress logs are in place
- displayed layouts are reused as the default `LNS` seed or `CP-SAT` hint when fingerprints match
- saved layouts can persist reusable `CP-SAT` continuation checkpoints
- unsupported `LNS` repair-worker controls and planner-only reuse toggles have been removed from backend solve requests
- direct `greedy` runs must request `optimizer: "greedy"` explicitly

#### 3. Reproducibility, exact-run visibility, and benchmark support are shipped

Status: Completed

What exists today:
- `greedy.randomSeed` support in the solver, CLI, and planner
- streamed `CP-SAT` telemetry for incumbent, best bound, gap, wall time, and time since last improvement
- planner and CLI progress surfaces for long exact runs
- a fixed `CP-SAT` benchmark corpus plus async benchmark harness for reproducible comparisons
- single-machine `CP-SAT` portfolio support in the backend, Python runtime, and result model

This removes a lot of the earlier guesswork around runtime tuning.

#### 4. LNS neighborhood selection is much stronger than the original baseline

Status: Completed for the current neighborhood strategy

What exists today:
- focused anchors for weak services, high-headroom residentials, and frontier congestion
- adaptive escalation from local windows to larger repair bands and final broad repair passes
- row-0-aware repair windows so anchor connectivity can still be repaired
- deterministic same-cell service and residential upgrade passes around repair

#### 5. Reusable solver-state hardening is shipped

Status: Completed for the current reusable-input contract

What exists today:
- shared `solverInputValidation` helpers materialize and validate client-supplied `LNS` seed hints in one place
- malformed seed payloads fail with typed `Invalid solver input:` errors
- invalid-but-well-formed seeds are rejected before solve execution
- `CP-SAT` warm-start hints, hint-only reusable payloads, portfolio worker counts, seed lists, time limits, deterministic-time knobs, and no-improvement cutoffs are validated before backend launch
- hint-only `CP-SAT` reusable payloads must carry a matching model fingerprint instead of relying only on shape checks
- reusable `CP-SAT` solution hints are semantically validated against the current grid and building settings before launch
- web solve routes preserve those failures as clean `400` responses instead of generic internal errors
- `CP-SAT` solutions returned from Python are revalidated before they are surfaced back to the app
- planner continuation flows skip legacy, invalid, or stale displayed/saved checkpoints before attaching hints or seeds
- expansion comparison solves recompute the fingerprint against the modified comparison request, so stale displayed hints are omitted instead of causing backend `400`s

Maintenance watchpoints:
- keep planner-side checkpoint compatibility checks aligned with backend validation whenever new reusable payload fields are added
- preserve typed `400` behavior for direct API callers, not only planner-generated requests
- decide whether `cpSat.pythonExecutable` / `cpSat.scriptPath` should remain accepted over HTTP if the planner server is ever exposed beyond a trusted local machine

#### 6. Greedy runtime guardrails are shipped

Status: Completed

What exists today:
- raw `greedy` options are validated at the API boundary, including restarts, local-search limits, service refinement limits, exhaustive-search caps, random seed, stop paths, and snapshot paths
- `greedy.timeLimitSeconds` gives raw greedy solves a public wall-clock budget instead of relying only on external cancellation
- greedy stop checks run through expensive precompute phases so cancelled runs observe stop requests before spending all their time in enumeration/cache setup
- route tests cover invalid greedy controls before solver launch

#### 7. Solve admission and route safety are shipped

Status: Completed

What exists today:
- `SolveJobManager` owns a configurable running-solve cap, defaulting to one active solve for the local planner
- immediate `/api/solve` requests and background `/api/solve/start` jobs share the same admission policy
- capacity rejections return a clean `429` before launching another optimizer/backend process
- the local web server exposes the cap through `MAX_RUNNING_SOLVES`
- route tests cover both cross-route directions: background jobs block immediate solves, and immediate solves block background job starts

#### 8. Planner/runtime `auto` contract cleanup is shipped

Status: Completed

What exists today:
- `auto` is the resolved default for omitted optimizer requests across runtime dispatch, HTTP routes, CLI-facing solve paths, and planner payloads
- invalid `auto` option payloads fail with typed `Invalid solver input:` errors before backend launch
- direct `solveAuto(...)` calls defensively fall back to runtime defaults for malformed option values instead of letting `NaN` stage budgets through
- Auto owns per-stage random seeds and records them in `autoStage.generatedSeeds`
- planner Auto mode omits standalone `greedy.randomSeed` and `cpSat.randomSeed`, disables those visible seed fields, and labels them as Auto-generated
- planner Auto mode shows the Greedy seed-stage caps that the runtime applies
- result summaries use generated Auto stage seeds instead of stale standalone CP-SAT seed settings
- README documents the default optimizer contract, Auto options, generated stage seeds, and Auto result metadata

#### 9. LNS stopping, budget policy, and benchmark support are shipped

Status: Completed for the current deterministic LNS runtime policy

What exists today:
- `LNS` accepts a total wall-clock stage budget through `lns.wallClockLimitSeconds` or the `lns.timeLimitSeconds` alias
- `LNS` supports `lns.noImprovementTimeoutSeconds` for stale-time stopping in addition to stale-iteration stopping
- greedy seed construction can be capped with `lns.seedTimeLimitSeconds`
- focused and escalated repair attempts can use separate budgets via `lns.focusedRepairTimeLimitSeconds` and `lns.escalatedRepairTimeLimitSeconds`
- malformed `lns` option payloads fail with typed `Invalid solver input:` errors before backend launch, and direct `solveLns(...)` calls share the same scalar validation
- `auto` passes a total remaining stage budget into LNS instead of only capping each repair attempt
- `solution.lnsTelemetry` reports stop reason, seed source, elapsed time, focused/escalated budgets, stale state, and per-neighborhood outcomes
- background snapshots and progress logs include LNS repair status so the planner can distinguish improving, neutral, skipped, stopped, and stale-ended repairs
- terminal LNS snapshots carry the final stop reason, including cancellation, stale-time, stale-iteration, wall-clock, and no-neighborhood exits
- LNS repair outcome and snapshot bookkeeping is centralized so future policy changes do not need to duplicate per-branch telemetry logic
- `benchmark:lns` runs a fixed LNS benchmark corpus and reports quality, wall-clock cost, stop reason, budget settings, and outcome counts

#### 10. Guarded CP-SAT portfolio initiation is shipped

Status: Completed for the current local single-machine portfolio contract

What exists today:
- direct API/runtime requests validate `cpSat.portfolio` before backend launch
- portfolio is accepted only for explicit `optimizer: "cp-sat"` requests, not `auto` or `LNS`
- API/runtime guardrails cap portfolio workers/seeds at 8, reject duplicate or out-of-range seeds, require a per-worker or outer time budget, cap aggregate CP-SAT worker lanes at 8, and cap total worker CPU budget at 28,800 seconds
- Python portfolio helper validation mirrors the public guardrails and now rejects invalid values instead of silently trimming or clamping them
- planner initiation exposes a bounded Portfolio CP-SAT preset and controls for worker count, explicit seeds, per-worker time, per-worker CP-SAT workers, and randomized search
- planner-generated portfolio payloads are standalone-CP-SAT-only, include the total CPU budget, cap planner-visible paths at 4, and keep internal worker lanes at 8 or fewer
- background CP-SAT cancellation escalates to the Python process group, so portfolio child workers are included in forced termination
- the background runner has an OS-level regression that verifies forced process-group cancellation stops child worker processes, guarding portfolio orphan cleanup
- live portfolio snapshots preserve the full worker summary shape, including completed workers, pending workers, selected worker, and stopped state
- result summaries identify the selected portfolio worker, seed, feasible-worker count, and population spread when portfolio metadata is available

Maintenance watchpoints:
- keep the OS-level orphan-process cancellation regression green before increasing any portfolio fan-out limits
- keep planner and backend portfolio constants aligned whenever the safe local machine budget changes
- richer live-worker UX can still be improved, but full planner initiation no longer depends on it

#### 11. Cross-mode benchmark scorecards and unified progress language are shipped

Status: Completed for the current local benchmark and planner-progress contract

What exists today:
- `benchmark:scorecard` runs a cross-mode scorecard over `auto`, `greedy`, `LNS`, single-run `CP-SAT`, and portfolio `CP-SAT`
- scorecards use equal wall-clock budgets, default checkpoints of 5s, 30s, and 120s, and repeated seeds for variance tracking
- scorecards report win / loss / tie against `auto`, score deltas, mode summaries, problem-size-band summaries, and portfolio worker CPU budget
- `auto.randomSeed` gives scorecards reproducible generated stage seeds while keeping random Auto stage seeds as the default interactive behavior
- shared `progressSummary` language now covers current score, best score, active stage, reuse source, elapsed time, time since improvement, stop reason, exact gap, and portfolio worker summary
- planner status/progress rows, persisted progress logs, HTTP solve stats, and benchmark summaries all surface the same vocabulary
- per-mode benchmark outputs for `greedy`, `LNS`, and `CP-SAT` include the shared progress summary without dropping their existing optimizer-specific telemetry

Maintenance watchpoints:
- scorecards are local wall-clock measurements, so portfolio CPU budget must stay visible beside wall time when comparing modes
- future solver modes should plug into `buildSolverProgressSummary(...)` and the cross-mode benchmark runner instead of adding one-off progress prose
- default scorecard cases are enough for mode-selection regression and workflow evidence, not broad statistical claims about all maps

#### 12. Greedy solver phase boundaries are cleaner

Status: Completed for the current internal structural split

What exists today:
- `solveGreedy(...)` now acts as a thinner orchestrator around named internal phases instead of carrying the full greedy policy inline
- candidate enumeration, geometry/index precompute, service-order scoring, and solve-context creation are isolated in `prepareGreedyInputs(...)`
- dominance-upgraded construction attempts are isolated behind `createGreedySolveAttempt(...)`
- forced-service realization, seeded forced-service retries, and forced-service ordering are isolated behind `createGreedyForcedServiceEvaluator(...)`
- service-cap planning and coarse/refine/restart cap search are isolated behind `buildGreedyServiceCapPolicy(...)` and `runGreedyServiceCapSearch(...)`
- post-construction improvement is split into `runGreedyServiceRefinement(...)`, `runGreedyExhaustiveServiceSearch(...)`, and `runGreedyServiceNeighborhoodSearch(...)`
- the public `solveGreedy(G, params)` API, stop/snapshot behavior, random-seed restart behavior, profile counter names, and solution semantics are unchanged
- `npm test` and `benchmark:greedy -- --json` pass after the split

Maintenance watchpoints:
- the current split is internal to [src/greedy/solver.ts](./src/greedy/solver.ts); moving stable helpers into separate `src/greedy/*` modules should wait until the phase boundaries settle
- future profile schema changes should keep existing counter groups compatible or explicitly document benchmark snapshot changes
- avoid mixing heuristic-policy tuning into future mechanical module extraction work

#### 13. Greedy phase timing / quality counters are shipped

Status: Completed for the current profiling contract

What exists today:
- `greedy.profile` now returns `greedyProfile.phases` alongside the existing `greedyProfile.counters`
- fixed phase summaries cover precompute, constructive cap search, forced-service realization, service refinement, exhaustive service search, residential local search, and service-neighborhood search
- each phase records run count, elapsed milliseconds, best incumbent before/after, best-population delta, candidate-population delta, and improvement count
- the constructive cap-search phase treats the first feasible incumbent as a quality gain, so seed-quality contribution is visible instead of appearing as zero delta
- greedy benchmark text output includes a compact phase summary line
- greedy benchmark JSON snapshots strip volatile per-phase `elapsedMs` while preserving stable phase quality counters

Module extraction decision:
- broad file-level extraction is intentionally deferred
- the current measured boundaries are useful, but the search phases still share private caches, tie-breakers, candidate indexes, road probes, and typed-building helpers inside [src/greedy/solver.ts](./src/greedy/solver.ts)
- extracting those helpers now would force unstable internal APIs and create mechanical churn before the phase measurements show which boundaries are worth stabilizing

Maintenance watchpoints:
- phase elapsed values are inclusive and some nested phase timings are intentionally not additive to total greedy wall time
- use the new phase counters to guide `LNS` seed-budget policy and `auto` seed-stage reporting before extracting larger modules
- if the profiler itself grows, a small `src/greedy/profile.ts` extraction is reasonable; search-policy extraction should wait for evidence from benchmarks

## Remaining Priorities

Impact factor scale:
- `5.0 / 5`: direct common-path reliability or quality-per-minute gains
- `4.0 / 5`: strong user-facing leverage or failure-risk reduction
- `3.0 / 5`: medium leverage or enabling work for later improvements
- below `3.0 / 5`: strategic or high-cost work with lower near-term return

No near-term deterministic runtime item is currently ranked above the later priorities below. The next work should use the shipped phase profile data to choose budget-policy or extraction follow-ups with evidence.

## Later Priorities

### 1. Keep distributed CP-SAT behind single-machine portfolio and workflow improvements

Priority: 1 among later items
Impact factor: `1.5 / 5`

Why:
- the better near-term return is still measurement, workflow polish, and single-machine portfolio hardening
- distributed exact solving adds the most operational complexity for the least immediate product leverage

### 2. Keep learned guidance separate from the core runtime roadmap

Priority: Separate gated track, after greedy phase profiling plus the portfolio cancellation regression
Impact factor: `2.0 / 5` near-term product leverage, higher long-term strategic upside

Why:
- learned guidance is a real fit for search control around `greedy`, `LNS`, and `CP-SAT`, especially for re-ranking and later `LNS` control
- full RL is not the next production lever; the relevant AlphaGo / AlphaZero lesson is policy / value guidance around exact search, not end-to-end self-play
- the deterministic solver still has higher-ROI measurement work, especially turning greedy phase data into budget evidence
- that work should stay tracked in [LEARNED_GUIDANCE_ROADMAP.md](./LEARNED_GUIDANCE_ROADMAP.md), not mixed into the runtime-execution roadmap

Ordering inside the learned-guidance track:
- first: shared traces and equal-budget benchmarks
- second: ablations of current heuristic lift
- third: greedy service re-ranking
- fourth: `LNS` window re-ranking
- fifth: counterfactual `LNS` replay data
- sixth: value-guided seeds only if seed quality becomes a measured bottleneck
- seventh: contextual bandits for `LNS` control only if re-ranking already wins
- eighth: full RL only after earlier learned stages beat deterministic baselines on holdout cases

## Cross-Track Ordering

If all remaining work is ranked in one combined near-term ordering, the recommended order is:

1. use greedy phase profile data to tune or justify `LNS` seed-budget and `auto` seed-stage policy changes
2. optionally extract only profiler or demonstrably stable greedy helpers after phase data proves the boundary
3. add the learned-guidance trace foundation on top of the shipped benchmark and equal-budget scorecard surfaces
4. run learned-guidance ablations
5. try low-risk learned guidance: greedy service re-ranking and `LNS` window re-ranking
6. only then consider value-guided seeds if seed quality becomes a measured bottleneck
7. treat contextual bandits and full RL as gated research after earlier learned stages already win

Why this order:
- items 1 and 2 turn the shipped greedy phase data into measured evidence before policy or extraction churn
- items 3 through 7 depend on the shipped scorecard discipline, a shared trace/export layer, a more stable deterministic baseline, and more expensive labels
- keep the portfolio orphan-process cancellation regression passing before any future fan-out increase
- full RL currently has the lowest near-term product leverage per unit complexity

## LNS Follow-Up Plan

### Phase A: Stabilized working slice

Status: Done

Delivered:
- backend solve path
- planner-visible optimizer
- displayed-layout seeding
- neighborhood fixing outside the active window
- snapshot and stop support
- deterministic dominant same-cell upgrade passes
- recoverable repair-failure handling

### Phase B: Better neighborhoods

Status: Done for the baseline target

Delivered:
- weak residential cluster targeting
- service-heavy low-payoff anchor targeting
- road / frontier congestion targeting
- adaptive neighborhood escalation after stagnation
- broad final repair passes within the configured stale budget

### Phase C: Better stopping and budgeting

Status: Completed for the current deterministic policy

Targets:
- stop after `N` non-improving neighborhoods
- stop after no improvement for `T` seconds
- intentional budget split between seed and repair phases

Note:
- the `N`-based stale-iteration stop already exists
- the time-based runtime policy is now layered on top through LNS wall-clock, stale-time, seed, focused-repair, and escalated-repair budgets

### Phase D: Better run visibility

Status: Completed for the current planner/progress-log surfaces

Delivered:
- clearer planner messaging about greedy seed vs displayed seed
- live best-so-far progress log updates
- exact-run bound / gap / improvement-lag visibility
- per-neighborhood `LNS` progress summaries through `solution.lnsTelemetry`
- planner and persisted progress-log language for skipped, neutral, improving, stopped, stale-ended, and budget-ended LNS repair attempts

## Notes

- `CP-SAT` warm starts are still global solves unless we explicitly fix the outside-of-neighborhood assignment.
- The current local OR-Tools runtime still has a known crash path around `repair_hint` plus multi-worker repair, so planner/runtime messaging should not imply user-controlled multi-worker `LNS` repair until that runtime issue is proven fixed.
- Guarded planner-visible single-machine portfolio search and equal-budget scorecards are shipped; distributed solving should stay behind single-machine workflow and cancellation hardening.
- Solver input/output validation is now a shipped safeguard; treat new solver-facing payload fields as validation work before exposing them in the planner.
- AlphaGo / AlphaZero-style ideas transfer here only in the narrow sense of policy / value guidance over the existing search stack; full RL remains a gated research path.
- Input validation now matters as much as solver quality because the planner reuses more serialized solver state across runs.
