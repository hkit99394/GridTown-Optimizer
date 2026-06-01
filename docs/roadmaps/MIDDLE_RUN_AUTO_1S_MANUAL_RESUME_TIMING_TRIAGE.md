# Middle-Run Auto 1s Manual-Resume Timing Triage

Reviewed on 2026-06-01.

## Scope

This is a focused maintenance triage for the `fresh-manual-resume-neighborhood`
Auto `1s` timing watch. It is not a solver-default promotion candidate.

The question was narrow: when Auto reaches the hard population cap on the
manual-resume row, is it still doing avoidable work before returning?

## Finding

Auto stops semantically at the right terminal condition: the final stop reason is
`population-cap-reached`, the final population is the hard residential capacity
cap `790`, replay validity is clean, and the layout remains road-valid.

The wall-clock overrun comes from work inside the LNS repair stage after the
greedy seed:

- Greedy seed reaches `750` in roughly `0.25s`.
- LNS launches a CP-SAT repair that finds the cap-quality incumbent.
- The CP-SAT solver time limit measures internal OR-Tools solve time, not all
  Python process, model-build, JSON, and Node bridge overhead.
- Before this triage, CP-SAT could also keep searching after a model upper-bound
  incumbent had been observed.

## Changes

- `python/cp_sat_solver.py` now stops CP-SAT search from the solution callback
  when the incumbent reaches the built model's total population upper bound.
- `src/packages/core/dominanceUpgrades.ts` now short-circuits deterministic
  dominance upgrades after recomputing totals when the solution already reaches
  the hard configured population capacity bound.

These changes preserve population-first behavior while avoiding known post-cap
work.

## Evidence

Focused artifact:

`artifacts/product-corpus/2026-06-01/timing-fresh-manual-resume-auto-1s-cap-stop-seeds7-19-37-20260601T160520Z`

Shape:

- Case: `fresh-manual-resume-neighborhood`
- Mode: `auto`
- Budget: `1s`
- Seeds: `7,19,37`

Result:

- Auto reaches `790` on all 3 rows.
- Replay validity has 0 population mismatches.
- CP-SAT repair reports population gap `0` on all 3 rows.
- CP-SAT internal solve wall time is `0.354s` to `0.538s`.
- Auto wall time is still over `1s`: `1.256s` to `1.832s`.

Compared with the prior fast-lane baseline (`1.319s` to `2.035s` Auto wall
time), the worst row improved, but the run still exceeds a strict `1s` external
wall-clock envelope.

## Decision

Close the maintenance timing watch as triaged, not as a full strict-budget fix.

The current behavior is acceptable for the population-first roadmap because Auto
reaches the hard cap and stops on `population-cap-reached`. A strict subsecond
runtime guarantee for CP-SAT-backed LNS repairs would need a separate runtime
project that budgets Python bridge/model-build overhead directly, or avoids that
overhead with a persistent worker/service path. Do not open that project unless a
product SLA requires hard `1s` wall-clock adherence.

## Next Move

Keep the current 15-case split baseline as durable. Open the next candidate only
on a trigger from the gated priorities: reproducible outside-envelope Auto/LNS
failure, a new CP-SAT runtime-bottleneck hypothesis, protected/fresh learned
guidance value, or repeatable service-master equal-budget wins.
