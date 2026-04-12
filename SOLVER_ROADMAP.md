# Solver Roadmap

## Goal

Maximize solution quality per minute, not just eventual optimality.

The target runtime strategy is still:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement pass

## Current Status

### Done

#### 1. LNS is shipped

Status: Completed

What exists today:
- `LNS` is available in the backend and the planner UI.
- It can start from a greedy incumbent or from the displayed output as a seed.
- It fixes everything outside the active neighborhood and repairs the window with CP-SAT.
- It keeps the best known incumbent and supports stop / snapshot flow.

Important implementation notes:
- LNS repair currently forces CP-SAT to a single worker because the local OR-Tools runtime was crashing in the multi-worker hint-repair path.
- LNS also includes deterministic same-cell upgrade passes for dominant service and residential replacements before and after repair.
- Repair misses are treated as `no improvement`, not a full LNS failure, when a recoverable incumbent is available.

#### 2. Solver architecture foundation is in place

Status: Completed

What exists today:
- optimizer registry / dispatch boundary
- shared background solve runner pattern
- web job management with snapshot recovery
- planner UI support for `greedy`, `LNS`, and `CP-SAT`

This is enough to keep extending the solver stack without reopening the earlier integration problems.

## Next Priorities

### 1. Change the default runtime policy

Expected impact: Highest near-term

Why:
- long CP-SAT runs without incumbent improvement are poor quality-per-minute
- the planner should bias toward fast useful answers, not long silent searches

Target policy:
- `greedy` first
- `LNS` second
- `CP-SAT` only with a short budget or no-improvement cutoff

Concrete work:
- add recommended presets in the planner
- add a no-improvement timeout for CP-SAT runs
- make the default path favor incumbent-first solving

### 2. Make greedy reproducible with a seed

Expected impact: High for measurement quality

Why:
- greedy restarts still use unseeded randomness
- without reproducibility, it is hard to compare runtime policies, LNS changes, or CP-SAT tuning fairly

Concrete work:
- add `randomSeed` support for greedy restart shuffling
- expose it in CLI and planner state
- use it in solver benchmarks and regression comparisons

### 3. Expose CP-SAT progress signals

Expected impact: High

Why:
- a long CP-SAT run can look stalled even when it is improving bounds
- we need to distinguish `no new incumbent` from `no progress at all`

Metrics to expose:
- best bound
- incumbent value
- gap
- time since last incumbent improvement

Concrete work:
- extend CP-SAT status reporting
- thread those metrics through the job API
- show them in the planner while a run is active

### 4. Improve LNS neighborhoods and stopping rules

Expected impact: High

Why:
- LNS is working, but current neighborhoods are still fairly simple
- current stopping is iteration-based and can miss better quality-per-minute policies

Targets:
- prioritize weak residential clusters with the largest `max - current` gap
- prioritize service-heavy low-payoff districts
- prioritize road-dense low-population regions
- add adaptive windows after each improvement
- stop after no improvement for `T` seconds, not only after `N` stale neighborhoods
- split budget more intentionally between seeding and repair

### 5. Expose richer CP-SAT search parameters

Expected impact: Medium-high

Why:
- before building portfolio or distributed orchestration, we should use more of the official CP-SAT search surface

Candidates:
- relative / absolute gap limits
- worker allocation controls
- shared-tree style settings where stable
- safer LNS-related CP-SAT settings that do not reintroduce the local crash path

## Later Priorities

### 6. Add single-machine CP-SAT portfolio search

Expected impact: Medium-high

Why:
- several short CP-SAT jobs with different seeds / parameter mixes may beat one long run
- this is still much cheaper than true distributed solving

Important prerequisite:
- this needs a portfolio coordinator, not just more workers
- today one request maps to one background solve handle, so `shared best incumbent` and aggregated progress are not available yet

Planned shape:
- 2-4 parallel workers
- shared best incumbent at the coordinator layer
- stop laggards on timeout or no-improvement
- expose aggregated best result and worker progress in the API

### 7. Split the greedy solver into reusable phases

Expected impact: Medium

Why:
- LNS and future metaheuristics should be able to reuse construction, scoring, and repair logic more directly
- today the solver still carries a lot of flow in one large implementation

Desired seams:
- candidate enumeration
- greedy construction
- local improvement
- snapshot / finalization

### 8. Consider multi-machine distributed CP-SAT last

Expected impact: Low near-term, high implementation cost

Why:
- it is the most complex path
- the likely better near-term return is still `LNS + better runtime policy + portfolio CP-SAT`

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

Status: Next

Targets:
- weak residential clusters
- service-heavy low-payoff districts
- road-dense low-population regions
- adaptive windows after each improvement

### Phase C: Better stopping and budgeting

Status: Next

Targets:
- stop after `N` non-improving neighborhoods
- stop after no improvement for `T` seconds
- budget split between seed and repair phases

### Phase D: Better run visibility

Status: Next

Targets:
- incumbent improvement history during the run
- better LNS progress messaging
- clearer explanation of whether the run started from greedy or a displayed seed

## Notes

- CP-SAT warm starts are useful, but they are still global solves unless we explicitly fix the outside-of-neighborhood assignment.
- The current local OR-Tools runtime has a known crash path around `repair_hint` / multi-worker repair, so roadmap work should preserve the current safer LNS repair behavior unless that runtime issue is proven fixed.
- Distributed solving should stay a later optimization layer, not the first answer to quality-per-minute.
