# Solver Roadmap

## Goal

Maximize solution quality per minute, not just eventual optimality.

The current discussions and experiments point to a staged solver strategy:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement pass

## Prioritized Improvements

### 1. Add `LNS` between greedy and CP-SAT

**Expected impact:** Highest

Why:
- Greedy already gives a decent solution quickly.
- CP-SAT can spend a long time searching globally without producing a better incumbent.
- LNS is the best middle ground: keep most of the incumbent, reopen one neighborhood, and repair it.

Planned shape:
- Seed from the current greedy solution
- Choose a neighborhood window
- Fix everything outside that window to the incumbent
- Repair the open region with CP-SAT
- Accept only improving solutions

### 2. Change the default runtime policy

**Expected impact:** Very high

Why:
- Long CP-SAT runs without incumbent improvement are poor quality-per-minute.
- The default policy should favor fast incumbents and short bounded improvement passes.

Recommended policy:
- `greedy` first
- `LNS` second
- `CP-SAT` only with a short budget or no-improvement cutoff

### 3. Expose CP-SAT progress signals

**Expected impact:** High

Why:
- Right now a long CP-SAT run can look stalled even when it is improving bounds.
- We need to distinguish "no new incumbent" from "no progress at all."

Metrics to expose:
- best bound
- incumbent value
- gap
- time since last incumbent improvement

### 4. Add single-machine CP-SAT portfolio search

**Expected impact:** High

Why:
- Running several short CP-SAT jobs with different seeds and parameter mixes is likely to beat one long run.
- This is cheaper and lower risk than true distributed solving.

Planned shape:
- 2-4 parallel workers
- shared best incumbent
- stop laggards on timeout or no-improvement

### 5. Expose richer CP-SAT search parameters

**Expected impact:** Medium-high

Why:
- Before building distributed orchestration, we should use more of the official CP-SAT search surface.

Candidates:
- shared tree search
- LNS-only modes
- relative/absolute gap limits
- worker allocation controls

### 6. Split the greedy solver into reusable phases

**Expected impact:** Medium

Why:
- LNS and future metaheuristics should be able to reuse construction, scoring, and repair logic cleanly.

Desired seams:
- candidate enumeration
- greedy construction
- local improvement
- snapshot/finalization

### 7. Make greedy reproducible with a seed

**Expected impact:** Medium-low

Why:
- This will not directly improve quality, but it is important for benchmarking and fair solver comparisons.

### 8. Consider multi-machine distributed CP-SAT last

**Expected impact:** Low near-term, high implementation cost

Why:
- It is the most complex path.
- The likely better near-term return is `LNS + portfolio CP-SAT`.

## LNS Delivery Plan

### Phase 1: First working LNS slice

Scope:
- backend-only first
- greedy incumbent
- deterministic neighborhood windows
- CP-SAT repair with outside-of-window variables fixed
- accept only improving repairs

Success criteria:
- `solveLns()` returns a valid solution
- result is never worse than the greedy seed
- background execution supports stop and snapshot flow

### Phase 2: Better neighborhoods

Targets:
- weak residential clusters
- service-heavy low-payoff districts
- road-dense low-population regions
- adaptive windows after each improvement

### Phase 3: Better stopping rules

Targets:
- stop after N non-improving neighborhoods
- stop after no improvement for T seconds
- budget split between seed and repair phases

### Phase 4: UI exposure

Targets:
- add `LNS` as a planner-visible optimizer
- expose the main neighborhood and budget controls
- show incumbent-improvement history during the run

## Notes

- CP-SAT warm starts are useful, but they are still global solves unless we explicitly fix the outside-of-neighborhood assignment.
- Distributed solving should be treated as a later optimization layer, not the first answer to quality-per-minute.
