# Solver Roadmap

## Goal

Maximize solution quality per minute while keeping the solver workflow reliable, observable, and easy to use from the planner.

The target runtime strategy is:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement or proof pass
4. Wrap that staged flow in a planner-visible `auto` controller that can hand a stalled exact run back to `LNS` and then return to `CP-SAT`
5. Make that incumbent-first flow the planner default, not just an expert workflow

## Current Status

### Done

#### 1. The three-stage solver stack is shipped

Status: Completed

What exists today:
- `greedy`, `LNS`, and `CP-SAT` are all available in the backend, CLI, and planner.
- `LNS` can start from either a greedy incumbent or a displayed saved-layout seed.
- `LNS` keeps the best known incumbent, supports stop / snapshot recovery, and treats recoverable repair misses as `no improvement` instead of a full run failure.
- `CP-SAT` supports bounded exact runs, continuation hints, lower bounds, no-improvement cutoffs, and the async solve path used by the runtime-facing integrations.

#### 2. Incumbent-first planner workflow scaffolding is in place

Status: Completed

What exists today:
- planner runtime presets for `Fast Greedy`, `LNS Improve`, and `Bounded CP-SAT`
- automatic reuse of displayed layouts as the default `LNS` seed or `CP-SAT` hint when fingerprints match
- background solve jobs with live snapshots, stop support, and persisted progress logs

This means the intended `greedy -> LNS -> bounded CP-SAT` flow is already supported in the product, even though it is not yet enforced as the main default runtime policy.

#### 3. Reproducibility and exact-run visibility are shipped

Status: Completed

What exists today:
- `greedy.randomSeed` support in the solver, CLI, and planner
- streamed `CP-SAT` telemetry for incumbent, best bound, gap, wall time, and time since last improvement
- planner and CLI progress surfaces for long exact runs
- a fixed `CP-SAT` benchmark corpus plus async benchmark harness for reproducible comparisons

This removes a lot of the earlier guesswork around runtime tuning.

#### 4. LNS neighborhood selection is much stronger than the original baseline

Status: Completed

What exists today:
- focused anchors for weak services, high-headroom residentials, and frontier congestion
- adaptive escalation from local windows to larger repair bands and final broad repair passes
- row-0-aware repair windows so anchor connectivity can still be repaired
- deterministic same-cell service and residential upgrade passes around repair

What is still not done:
- time-based LNS stopping
- explicit budget partitioning between seed construction, focused repair, and escalated repair

#### 5. Solver input hardening for reusable LNS seeds is now in place

Status: Completed in the current branch

What exists today:
- shared `solverInputValidation` helpers now materialize and validate client-supplied `LNS` seed hints in one place
- malformed seed payloads fail with typed `Invalid solver input:` errors
- invalid-but-well-formed seeds are rejected before solve execution
- web solve routes preserve those failures as clean `400` responses instead of generic internal errors

This is important because saved layouts are now a real runtime input, not just a UI convenience.

## Next Priorities

### 1. Ship an `auto` solver and make it the default runtime policy

Expected impact: Highest near-term

Why:
- the solver stack now has all the pieces needed for staged incumbent-first solving, but users still have to drive the handoff manually
- long `CP-SAT` runs can still get trapped in a stale incumbent basin where a fresh `LNS` pass is a better next move than more exact time
- the best product experience is one solve button that owns the sequence instead of asking the user to choose the next stage

Target v1 policy:
- start with `greedy -> LNS -> CP-SAT`
- after that, keep alternating `LNS -> CP-SAT` while either stage produces a meaningful improvement
- evaluate improvement at the cycle level, not per-stage, so `LNS` plus `CP-SAT` can count together
- stop after two consecutive weak `LNS -> CP-SAT` cycles whose combined improvement is less than `0.5%`
- also stop on `OPTIMAL`, user cancel, or a global wall-clock safety cap
- generate a fresh random seed for every stochastic stage run and persist those generated seeds in the progress log

Concrete work:
- add optimizer `auto` to the shared type system, registry, planner, and CLI
- implement a background-first stage orchestrator instead of trying to splice `LNS` into one `CP-SAT` process
- reuse `LNS` seed hints plus `CP-SAT` warm starts / lower bounds between stages
- add stage-aware progress surfaces, runtime messages, and persisted solve-log metadata
- make `auto` the main planner path and keep raw `CP-SAT` as an advanced exact mode

### 2. Finish LNS stopping and budget policy

Expected impact: High

Why:
- neighborhood ranking and escalation are already much better, but run control is still mostly iteration-count based
- quality-per-minute depends on spending repair time where it is still productive

Concrete work:
- add `stop after no improvement for T seconds` to `LNS`
- split budget intentionally between greedy seeding, focused windows, and escalated windows
- expose clearer per-iteration outcome summaries in runtime status surfaces
- compare LNS budget policies on the benchmark corpus instead of tuning by anecdote

### 3. Expose shipped single-machine CP-SAT portfolio search in the planner

Expected impact: Medium-high

Why:
- single-machine portfolio search already exists in the exact solver, async APIs, CLI, and benchmark harness
- the planner still presents only the single-run `CP-SAT` workflow cleanly

Concrete work:
- planner controls for worker count, explicit seeds, and per-worker budget
- aggregated worker progress and selected-worker summaries in the result UI
- coordinator-side stop rules for lagging workers

### 4. Extend typed validation to the rest of the reusable solver inputs

Expected impact: Medium-high

Why:
- reusable planner state now includes manual layouts, `CP-SAT` hints, saved solutions, and increasingly rich runtime options
- the new `LNS` seed validation path is the right pattern, but it only covers one class of reusable inputs so far

Concrete work:
- validate `CP-SAT` warm-start / continuation payloads with the same typed error model
- validate more reusable saved-layout and manual-layout payloads at the API boundary
- keep planner-side reuse flows aligned with backend validation rules so failures stay explainable

### 5. Split the greedy solver into cleaner reusable phases

Expected impact: Medium

Why:
- reproducibility is in place, but the greedy flow still owns a lot of policy in one implementation
- future metaheuristics and learned-guidance work want clearer reuse seams

Desired seams:
- candidate enumeration
- constructive placement
- local improvement
- snapshot / finalization
- phase-level measurement hooks

## Later Priorities

### 6. Keep distributed CP-SAT behind single-machine portfolio and workflow improvements

Expected impact: Low near-term, high implementation cost

Why:
- the likely better near-term return is still better runtime policy, stronger `LNS`, and planner-visible portfolio search
- distributed exact solving adds the most operational complexity for the least immediate product leverage

### 7. Keep learned guidance separate from the core runtime roadmap

Expected impact: Strategic, not near-term

Why:
- the solver stack is finally measurable enough to support learned guidance work
- that work should stay tracked in [LEARNED_GUIDANCE_ROADMAP.md](./LEARNED_GUIDANCE_ROADMAP.md), not mixed into the runtime-execution roadmap

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

Status: Next

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
- The current local OR-Tools runtime still has a known crash path around `repair_hint` plus multi-worker repair, so roadmap work should preserve the safer current `LNS` repair behavior unless that runtime issue is proven fixed.
- After `auto` is shipped, the next exact-solver UX step is planner-visible single-machine portfolio search, not distributed solving.
- Input validation now matters as much as solver quality because the planner reuses more serialized solver state across runs.
