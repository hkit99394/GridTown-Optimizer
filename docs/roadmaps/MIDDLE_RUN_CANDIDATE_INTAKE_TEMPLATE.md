# Middle-Run Solver Candidate Intake Template

Reviewed on 2026-05-30.

Use this template before implementing or benchmarking a solver-policy candidate. Its job is to make the candidate's trigger, hypothesis, evidence slice, expected signal, blockers, and artifact policy explicit before tuning starts.

This is an intake gate only. It does not promote solver behavior or change runtime defaults.

## When To Use

Use the full template for any candidate that could change `auto`, `greedy`, `lns`, `cp-sat`, CP-SAT portfolio behavior, learned guidance, evaluator behavior, or planner-facing solver defaults.

Diagnostics-only probes can use the same template with a smaller evidence plan, but they must still name the trigger, hypothesis, scoped rows, expected signal, and artifact policy.

Do not start a default-path implementation until the **Required Before Work Starts** checklist is complete.

## Required Before Work Starts

- Candidate ID and owner are named.
- Trigger is tied to a concrete artifact, row, issue, or roadmap gate.
- Hypothesis states what will improve and why.
- Affected modes and runtime-default risk are explicit.
- Case list, split, workflow tags, budgets, and seeds are named.
- Baseline-repeat control shape is named for the same cases, budgets, seeds, hardware, and command shape.
- Expected promotion signal is measurable before the run starts.
- Known blockers and stop conditions are written.
- Evaluator-validity and replay requirements are written.
- Artifact storage plan follows the current artifact policy.

## Intake Record

```markdown
# Solver Candidate Intake: <candidate-id>

Date:
Owner:
Status: proposed | ready-to-implement | diagnostics-only | blocked | closed
Candidate type: default-path | opt-in preset | diagnostics | refactor-only
Runtime default change proposed now: yes | no

## Trigger

Trigger source:

- Roadmap item, issue, user workflow, benchmark artifact, regression, or focused row:

Observed problem:

- Case(s):
- Split(s):
- Budget(s):
- Seed(s):
- Mode(s):
- Current behavior:
- Artifact path(s):
- Command(s):

Why this is worth investigating now:

## Hypothesis

Candidate hypothesis:

- If we change:
- Then expected solver behavior:
- Because:

Primary objective:

- Population improvement | equal population with faster time-to-best | CPU efficiency | exactness | reliability

Secondary objectives:

- First feasible:
- Time to best:
- Wall-clock:
- CPU budget:
- Replay compatibility:
- Evaluator validity:

Non-goals:

## Scope

Affected modes:

- `auto`:
- `greedy`:
- `lns`:
- `cp-sat`:
- `cp-sat-portfolio`:

Affected code or policy surfaces:

- Solver params:
- Budget policy:
- Seed policy:
- Repair policy:
- Exact solver settings:
- Learned/runtime model:
- Planner/API surface:

Feature flag or opt-in guard:

Runtime-default risk:

- none | low | medium | high
- Explanation:

## Evidence Plan

Development cases:

Protected holdout cases:

Fresh holdout plan:

- Fresh cases exist now: yes | no
- If no, how fresh cases will be nominated:
- Tuning leakage guard:

Workflow tags covered:

- solver-smoke:
- service-pressure:
- typed-footprint:
- road-semantics:
- manual-layout-replay:
- expansion-comparison:
- multi-anchor:

Modes to run:

- `auto`
- `greedy`
- `lns`
- `cp-sat`
- `cp-sat-portfolio` only when CPU-normalized portfolio evidence is part of the claim.

Budgets:

- Default promotion matrix: `1,5,30,120`
- Candidate-specific focused budgets:
- Exception rationale:

Seeds:

- Default promotion seeds: `7,19,37`
- Focused or additional seeds:
- Exception rationale:

Baseline controls:

- Baseline freshness command:
- Baseline-repeat command:
- Candidate same-slice command:
- Focused row rerun command:

Evaluator and replay gates:

- Final-layout evaluator-validity plan:
- Replay workflow plan:
- CP-SAT readiness or setup dependency:

CPU and timing gates:

- Wall-clock fields to compare:
- Time-to-first-feasible fields to compare:
- Time-to-best fields to compare:
- CPU-budget fields to compare:
- Observed-CPU coverage expectation:

## Expected Signal

Promotion target:

- Median population delta:
- Worst-decile population delta:
- Worst-row population delta:
- Regression rate:
- Equal-population time-to-best improvement:
- CPU-budget efficiency floor:
- First-feasible behavior:
- Replay/evaluator-validity result:

Minimum signal to continue after smoke:

Minimum signal to continue after development split:

Minimum signal to continue after protected holdout:

What result closes this as diagnostics-only:

What result blocks the candidate:

## Artifact Policy

Artifact root:

Expected files to keep in git when small:

- Summary text:
- Evidence summary:
- Telemetry manifest:
- Workflow replay files:
- Registry entry draft:

Expected files to move to release/external storage if large:

- Raw scorecard JSON:
- Budget ablation JSON:
- Decision trace JSONL:
- Replay labels:
- Solve logs:

Registry plan:

- Registry entry required: yes | no
- Registry command:
- Decision metadata to include:

## Review Checklist

- Trigger is real and current.
- Hypothesis is testable.
- Case list covers development and protected holdout.
- Fresh holdout is present or explicitly planned.
- Baseline-repeat control is same-slice.
- Budgets and seeds match the promotion matrix or exceptions are justified.
- Expected signal is measurable and has stop conditions.
- Evaluator-validity and replay gates are named.
- CPU and time-to-best interpretation follows the M8 review.
- Artifact policy is clear before large bundles are produced.
- Runtime default remains unchanged until promotion gates are met.
```

## Default Evidence Shapes

Use these defaults unless the candidate explicitly justifies a narrower diagnostic slice.

| Candidate Class           | Minimum First Slice                                                                  | Promotion-Grade Slice                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Auto budget policy        | Product-corpus smoke plus same-slice `baseline,baseline-repeat,candidate` on `auto`. | Full product workflow corpus, `auto`, budgets `1,5,30,120`, seeds `7,19,37`, development plus protected holdout, fresh holdout plan.      |
| Greedy seed or ranking    | Development split over `greedy` and `auto` when Auto can inherit the change.         | Development and protected holdout over `auto,greedy`, full promotion budgets and seeds, evaluator-validity rerun if final layouts change. |
| LNS repair or seed policy | Focused rows with stage traces and baseline-repeat controls.                         | Full product workflow corpus over `auto,lns`, full promotion budgets and seeds, replay checks for replay workflow rows.                   |
| CP-SAT tuning             | CP-SAT readiness check plus focused exact-pressure rows.                             | Product workflow development and protected holdout over `auto,cp-sat`, full promotion budgets and seeds, exact status/gap summary.        |
| CP-SAT portfolio          | Single CP-SAT versus portfolio focused rows with CPU-budget metrics.                 | Portfolio efficiency signals showing wall-clock and CPU-normalized wins over single CP-SAT; no default change without CPU proof.          |
| Learned guidance          | Offline or opt-in online diagnostic with leakage guard.                              | Protected and fresh online value coverage with inference overhead counted and no final-neutral override blockers.                         |

## Stop Conditions

Stop before broad sweeps when any of these is true:

1. The trigger cannot be reproduced on a current baseline.
2. Candidate movement is inside the baseline-repeat envelope and has no separate reason to continue.
3. A focused row shows an outside-negative repeat-envelope regression.
4. The candidate changes final layouts but has no evaluator-validity plan.
5. Replay workflow rows fail replay validity, have validation errors, or have population deltas from the evaluator.
6. The expected signal is only an optimistic capacity gap without proof, hard-cap hit context, or stronger feasibility bounds.
7. Artifact storage would create large raw bundles without a registry and external-storage plan.

## Decision Boundary

A completed intake makes a candidate ready to implement or benchmark. It does not make the candidate safe to promote.

Promotion still requires the gates in `SOLVER_ROADMAP.md`: exact validation for final layouts, fixed seeds, promotion-matrix budgets, protected development and holdout scorecards, population or time-to-best lift, bounded regressions, CPU-budget efficiency, registered metadata, and an explicit decision closeout.

## Decision

M9 is satisfied as a middle-run intake gate. New solver candidates now have a standard request shape that names trigger, hypothesis, modes, cases, budgets, seeds, expected signal, blockers, and artifact policy before implementation.
