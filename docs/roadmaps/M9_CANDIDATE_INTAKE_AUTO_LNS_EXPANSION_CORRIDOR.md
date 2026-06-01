# Solver Candidate Intake: auto-lns-expansion-corridor

Date: 2026-05-31

Owner: Solver roadmap

Status: closed diagnostics-only

Candidate type: diagnostics

Runtime default change proposed now: no

Closeout: [M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md](M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md)

## Trigger

Trigger source:

- [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md): `fresh-expansion-corridor-service` was added as the fresh holdout for expansion/corridor policy work.
- [M9_CANDIDATE_INTAKE_CP_SAT_GEOMETRY_PRESSURE_GUARD.md](M9_CANDIDATE_INTAKE_CP_SAT_GEOMETRY_PRESSURE_GUARD.md): the CP-SAT geometry guard deliberately excludes fragmented expansion/corridor rows, leaving Auto/LNS expansion policy as a separate lane.

Observed problem:

- Case(s): corridor-constrained expansion rows may need better LNS repair allocation rather than exact-geometry encoding.
- Split(s): development, protected holdout, and fresh holdout.
- Budget(s): first slice `5`.
- Seed(s): `7,19,37`.
- Mode(s): `auto,lns`.
- Current behavior: default Auto is strong on `development-expansion-corridor-service` and `fresh-expansion-corridor-service`; LNS ties Auto there but loses on `row0-corridor-repair-pressure` and `expansion-comparison-replay`.

Why this is worth investigating now:

- The fresh holdout exists.
- The CP-SAT geometry lane should not absorb corridor/expansion behavior.
- A small opt-in policy can test whether LNS repair time matters before any broad Auto policy sweep.
- `development-expansion-corridor-service` now gives the corridor/expansion lane a development-side analog before broader claims.

## Hypothesis

Candidate hypothesis:

- If LNS gets a slightly larger repair window only on service-bearing fragmented corridor layouts at 5s,
- Then Auto/LNS may improve corridor expansion rows without touching unrelated cases,
- Because the fresh expansion row is already LNS-compatible and corridor fragmentation may need more repair time than seed time.

Primary objective:

- Population improvement outside the baseline-repeat envelope on applied corridor rows.

Secondary objectives:

- No protected/fresh regression.
- No movement on inactive guard rows.
- Auto stays default unless the candidate produces repeatable value.

Non-goals:

- No CP-SAT encoding change.
- No broad Auto budget policy change.
- No promotion without a protected/fresh population signal, evaluator validity, and reviewed decision closeout.

## Candidate Policies

First opt-in policy:

- `expansion-corridor-lns-repair-5s-guarded`

Runtime guard:

- active only at `5s`
- service types present
- grid size at least 36 cells
- blocked-cell ratio between `0.20` and `0.35`

Policy effect:

- `lnsRepairBudgetRatio=0.2`
- `lnsEscalatedRepairBudgetRatio=0.3`
- no CP-SAT reserve change

Second opt-in policy:

- `expansion-corridor-lns-seed-repair-5s-guarded`

Runtime guard:

- active only at `5s`
- service types present
- grid size at least 36 cells
- blocked-cell ratio between `0.20` and `0.35`

Policy effect:

- `lnsSeedBudgetRatio=0.05`
- `lnsRepairBudgetRatio=0.25`
- `lnsEscalatedRepairBudgetRatio=0.4`
- no CP-SAT reserve change

## Evidence Result: First Repair Policy

Focused run date: 2026-05-31

Artifact:

- `artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-repair-5s-focused-20260531T173841Z`

Focused slice:

- Cases: `row0-corridor-repair-pressure`, `expansion-comparison-replay`, `fresh-expansion-corridor-service`, `fresh-multi-anchor-service-island`.
- Policies: `baseline`, `baseline-repeat`, `expansion-corridor-lns-repair-5s-guarded`.
- Modes: `auto,lns`.
- Budgets: `5`.
- Seeds: `7,19,37`.
- Policy application: 6 of 12 Auto comparisons.

Result:

- Top policy: `baseline`.
- Baseline-repeat Auto movement: 0 rows.
- Candidate Auto movement: 0 rows.
- Candidate LNS mean population delta versus baseline: `0`.
- Candidate Auto regression count: 0.
- Candidate stayed fully inside the baseline-repeat envelope.

Decision:

- The candidate is opened but does not justify a broad sweep yet.
- Keep the policy opt-in as diagnostics.
- Next eligible work is either focused row analysis of why the policy is neutral, or a stronger candidate that first moves population outside the repeat envelope.

## Evidence Result: Development Case And Stronger Seed/Repair Policy

Focused run date: 2026-05-31

Artifact:

- `artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z`

Focused slice:

- Cases: `development-expansion-corridor-service`, `row0-corridor-repair-pressure`, `expansion-comparison-replay`, `fresh-expansion-corridor-service`, `fresh-multi-anchor-service-island`.
- Policies: `baseline`, `baseline-repeat`, `expansion-corridor-lns-repair-5s-guarded`, `expansion-corridor-lns-seed-repair-5s-guarded`.
- Modes: `auto,lns`.
- Budgets: `5`.
- Seeds: `7,19,37`.
- Stronger policy application: 9 of 15 Auto comparisons.

Result:

- Top policy: `baseline`, tied with `baseline-repeat`, `expansion-corridor-lns-repair-5s-guarded`, and `expansion-corridor-lns-seed-repair-5s-guarded`.
- Baseline-repeat Auto movement: 0 rows.
- Stronger candidate Auto movement: 0 rows.
- Stronger candidate LNS mean population delta versus baseline: `0`.
- Stronger candidate Auto regression count: 0.
- Stronger candidate stayed fully inside the baseline-repeat envelope.
- Mean Auto wall-clock delta versus baseline: `-0.635s`.
- Auto stage means under the stronger policy: `lns=2.695s`, `cp-sat=0.871s`.

Decision:

- Development-side coverage is now present for the expansion/corridor family.
- Both opt-in policies are safe but population-neutral on the focused slice.
- The wall-clock signal is useful diagnostics, but not enough for promotion because population is unchanged.
- Do not run a broad matrix or change defaults from this evidence.
- Next eligible work is focused timing analysis only, unless a new population-moving outside-envelope case appears.

Closeout decision:

- Closed diagnostics-only on 2026-05-31.
- Keep both policies opt-in.
- Reopen only with a population-moving outside-envelope row or an explicit equal-population time-to-best product target.

## Review Checklist

- Trigger is real and current: yes.
- Fresh holdout exists: yes.
- Baseline-repeat control is same-slice: yes.
- Development analog exists: yes.
- Initial candidate signal is measurable: yes.
- Population lift exists: no.
- Broad sweep justified now: no.
- Runtime default remains unchanged: yes.
