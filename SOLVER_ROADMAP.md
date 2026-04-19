# Solver Roadmap

## Goal

Maximize solution quality per minute while keeping the solver workflow reliable, observable, and easy to use from the planner.

The working runtime strategy is:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement or proof pass
4. Let planner-visible `auto` orchestrate that staged incumbent-first flow
5. Keep raw `greedy`, `LNS`, and `CP-SAT` available as manual and advanced modes

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

#### 2. The incumbent-first workflow is the planner and CLI default quality path

Status: Completed with one backend-default caveat

What exists today:
- the planner defaults to `auto`
- the planner presents `auto` as the recommended quality path
- planner runtime presets keep `Fast Greedy`, `LNS Improve`, and `Bounded CP-SAT` one click away
- stage-aware runtime messages, live snapshots, stop support, and persisted progress logs are in place
- displayed layouts are reused as the default `LNS` seed or `CP-SAT` hint when fingerprints match
- saved layouts can persist reusable `CP-SAT` continuation checkpoints

Caveat:
- raw omitted-optimizer backend calls still resolve to `greedy`, so `auto` is not yet the universal default at every entry point

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

What is still not done:
- time-based LNS stopping
- explicit budget partitioning between seed construction, focused repair, and escalated repair
- clearer per-neighborhood runtime summaries

#### 5. Reusable solver-state hardening is partially shipped

Status: Partially completed

What exists today:
- shared `solverInputValidation` helpers materialize and validate client-supplied `LNS` seed hints in one place
- malformed seed payloads fail with typed `Invalid solver input:` errors
- invalid-but-well-formed seeds are rejected before solve execution
- web solve routes preserve those failures as clean `400` responses instead of generic internal errors
- `CP-SAT` solutions returned from Python are revalidated before they are surfaced back to the app

What is still not done:
- typed validation for `CP-SAT` warm-start / continuation payloads
- broader validation for reusable saved-layout and manual-layout payloads
- tighter planner / backend alignment for reusable checkpoint semantics

## Remaining Priorities

Impact factor scale:
- `5.0 / 5`: direct quality-per-minute gains on the common planner path
- `4.0 / 5`: strong user-facing leverage or failure-risk reduction
- `3.0 / 5`: medium leverage or enabling work for later improvements
- below `3.0 / 5`: strategic or high-cost work with lower near-term return

### 1. Finish LNS stopping and budget policy

Priority: 1
Impact factor: `5.0 / 5`

Why this is first:
- `auto` is already shipped, so the fastest remaining win is improving the quality-per-minute of the stage it calls most often
- LNS still stops mostly on iteration counts rather than on time-aware productivity signals
- better LNS budgeting improves both manual `LNS` runs and every `auto` cycle that depends on LNS repair quality

Concrete work:
- add `stop after no improvement for T seconds` to `LNS`
- split budget intentionally between greedy seeding, focused windows, and escalated windows
- expose clearer per-neighborhood outcome summaries in runtime status surfaces
- compare LNS budget policies on the benchmark corpus instead of tuning by anecdote

### 2. Expose shipped single-machine CP-SAT portfolio search in the planner

Priority: 2
Impact factor: `4.5 / 5`

Why this is second:
- single-machine portfolio search already exists in the backend, Python runtime, and result model
- the planner gap is now mostly UX and orchestration, not core solver implementation
- this is the next best exact-solver improvement after `auto` and stronger `LNS`

Concrete work:
- planner controls for worker count, explicit seeds, and per-worker budget
- aggregated worker progress and selected-worker summaries in the result UI
- coordinator-side stop rules for lagging workers
- clarify the difference between single-run `CP-SAT` and portfolio `CP-SAT` in planner messaging

Note:
- the planner already shows some post-run portfolio result details, but it does not yet provide full portfolio initiation or live worker UX

### 3. Extend typed validation and checkpoint hardening across reusable inputs

Priority: 3
Impact factor: `4.0 / 5`

Why this is third:
- planner reuse is no longer a niche path; saved layouts, `LNS` seeds, and `CP-SAT` hints are now core runtime inputs
- validation problems are user-facing reliability problems, not just backend cleanliness issues
- solver-output validation is already shipped, so the biggest remaining gap is broader reusable-input coverage

Concrete work:
- validate `CP-SAT` warm-start / continuation payloads with the same typed error model
- validate more reusable saved-layout and manual-layout payloads at the API boundary
- keep planner reuse flows aligned with backend validation rules so failures stay explainable
- make checkpoint compatibility rules more explicit in planner messaging

### 4. Resolve planner/runtime mismatches and remaining `auto` cleanup

Priority: 4
Impact factor: `3.5 / 5`

Why this is fourth:
- `auto` itself is no longer greenfield work, but there are still UX and semantics gaps around it
- the planner currently exposes controls that the runtime does not fully honor
- this is high-signal cleanup that reduces confusion without pretending it has the same leverage as better LNS or portfolio search

Concrete work:
- decide whether omitted-optimizer backend calls should also default to `auto` or continue to fall back to `greedy`
- either remove, disable, or clearly annotate the planner's `LNS` `Repair workers` control while repair remains single-worker
- expose additional `auto` policy knobs in the planner only if they are intentionally user-tunable
- keep roadmap and UI copy aligned with the fact that `auto` is shipped and planner-visible

### 5. Split the greedy solver into cleaner reusable phases

Priority: 5
Impact factor: `3.0 / 5`

Why this is fifth:
- reproducibility and instrumentation are already in place, but the greedy policy surface is still concentrated in one large implementation
- future metaheuristics and learned-guidance work want clearer reuse seams
- this is enabling work rather than the highest direct near-term quality-per-minute lever

Desired seams:
- candidate enumeration
- constructive placement
- local improvement
- snapshot / finalization
- phase-level measurement hooks

## Later Priorities

### 6. Keep distributed CP-SAT behind single-machine portfolio and workflow improvements

Priority: 6
Impact factor: `1.5 / 5`

Why:
- the better near-term return is still better runtime policy, stronger `LNS`, and planner-visible single-machine portfolio search
- distributed exact solving adds the most operational complexity for the least immediate product leverage

### 7. Keep learned guidance separate from the core runtime roadmap

Priority: Separate gated track, after priorities 1 through 5 for core product work
Impact factor: `2.0 / 5` near-term product leverage, higher long-term strategic upside

Why:
- learned guidance is a real fit for search control around `greedy`, `LNS`, and `CP-SAT`, especially for re-ranking and later `LNS` control
- full RL is not the next production lever; the relevant AlphaGo / AlphaZero lesson is policy / value guidance around exact search, not end-to-end self-play
- the deterministic solver still has higher-ROI unfinished work, especially `LNS` stopping / budgeting and reusable-input hardening
- that work should stay tracked in [LEARNED_GUIDANCE_ROADMAP.md](./LEARNED_GUIDANCE_ROADMAP.md), not mixed into the runtime-execution roadmap

Ordering inside the learned-guidance track:
- first: shared traces, equal-budget benchmarks, and `LNS` benchmark support
- second: ablations of current heuristic lift
- third: greedy service re-ranking
- fourth: `LNS` window re-ranking
- fifth: counterfactual `LNS` replay data
- sixth: value-guided seeds only if seed quality becomes a measured bottleneck
- seventh: contextual bandits for `LNS` control only if re-ranking already wins
- eighth: full RL only after earlier learned stages beat deterministic baselines on holdout cases

## Cross-Track Ordering

If all remaining work is ranked in one combined near-term ordering, the recommended order is:

1. finish deterministic `LNS` stopping and budget policy
2. expose planner-visible single-machine `CP-SAT` portfolio search
3. extend typed validation and checkpoint hardening across reusable inputs
4. resolve planner/runtime mismatches and remaining `auto` cleanup
5. split the greedy solver into cleaner reusable phases
6. build the learned-guidance foundation: shared traces, equal-budget benchmarks, and `LNS` benchmark support
7. run learned-guidance ablations
8. try low-risk learned guidance: greedy service re-ranking and `LNS` window re-ranking
9. only then consider value-guided seeds if seed quality becomes a measured bottleneck
10. treat contextual bandits and full RL as gated research after earlier learned stages already win

Why this order:
- items 1 through 4 directly improve the common planner path or reduce failure risk
- item 5 creates cleaner seams for both deterministic and learned follow-on work
- items 6 through 10 depend on a more stable deterministic baseline, better measurement discipline, and more expensive labels
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

Status: Current highest algorithmic priority

Targets:
- stop after `N` non-improving neighborhoods
- stop after no improvement for `T` seconds
- intentional budget split between seed and repair phases

Note:
- the `N`-based stale-iteration stop already exists
- the missing piece is a stronger time-based runtime policy layered on top

### Phase D: Better run visibility

Status: Partially done

Delivered:
- clearer planner messaging about greedy seed vs displayed seed
- live best-so-far progress log updates
- exact-run bound / gap / improvement-lag visibility

Remaining:
- clearer per-neighborhood `LNS` progress summaries
- better explanation of why a repair step was skipped, neutral, or improving

## Notes

- `CP-SAT` warm starts are still global solves unless we explicitly fix the outside-of-neighborhood assignment.
- The current local OR-Tools runtime still has a known crash path around `repair_hint` plus multi-worker repair, so planner/runtime messaging should not imply user-controlled multi-worker `LNS` repair until that runtime issue is proven fixed.
- With `auto` shipped, the next exact-solver UX step is planner-visible single-machine portfolio search, not distributed solving.
- Solver-output validation is already a shipped safeguard; the remaining validation work is broader reusable-input coverage.
- AlphaGo / AlphaZero-style ideas transfer here only in the narrow sense of policy / value guidance over the existing search stack; full RL remains a gated research path.
- Input validation now matters as much as solver quality because the planner reuses more serialized solver state across runs.
