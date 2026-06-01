# Middle-Run Decision Closeout Template

Reviewed on 2026-05-30.

Use this template when closing a solver candidate, scorecard refresh, diagnostics branch, or blocked investigation. Its job is to turn evidence into an auditable decision with exact commands, commit, hardware, split metadata, summary metrics, artifact index, blockers, and runtime-default status.

This is a decision-record gate. It does not promote solver behavior by itself.

## Decision Types

| Decision Type      | Meaning                                                                 | Runtime Default Status                                                                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `promote`          | Candidate cleared promotion gates and is approved for default behavior. | Must name the exact runtime default change, feature flag state, and implementation commit. |
| `keep-baseline`    | Baseline remains preferred after evidence review.                       | Must state runtime defaults remain unchanged.                                              |
| `diagnostics-only` | Evidence is useful for learning, labels, traces, or future hypotheses.  | Must state there is no runtime hook or default change.                                     |
| `blocked`          | Candidate cannot continue without fixing a blocker.                     | Must name the blocker, affected rows, and reopen trigger.                                  |

Use a more specific `decision` string in registry entries when helpful, for example `diagnostics-only-no-default-promotion`, `keep-baseline-no-population-lift`, `blocked-regression`, or `promote-default-auto-policy`.

## Required Before Closeout

- Candidate intake or refresh plan is linked.
- Exact command list is recorded without ellipses.
- Git commit, branch, and working-tree status are recorded.
- Hardware metadata is captured or the missing metadata is justified.
- Cases, split metadata, workflow tags, budgets, seeds, and modes are recorded.
- Summary metrics cover population, regressions, CPU budget, wall-clock, first feasible, and time to best when relevant.
- Evaluator-validity and replay gates are recorded when final layouts or replay workflows are involved.
- Artifact paths are indexed through a registry entry or `registry-entry-draft.json`.
- Large raw bundles have a durable external or release storage plan.
- Runtime-default status is explicit.

## Closeout Record

````markdown
# Solver Decision Closeout: <candidate-or-run-id>

Date:
Owner:
Decision type: promote | keep-baseline | diagnostics-only | blocked
Decision string for registry:
Runtime default status: unchanged | changed behind flag | changed default | not applicable
Candidate intake:
Related roadmap item:

## Executive Decision

Decision:

One-paragraph summary:

Runtime default impact:

- Default changed: yes | no
- Feature flag or preset:
- User-facing behavior:
- Rollback plan:

## Evidence Identity

Run id(s):

Artifact type(s):

- benchmark | ablation-gate | label-bundle | model-experiment | diagnostic

Git:

- Artifact commit:
- Indexed commit:
- Branch:
- Working tree status:

Hardware:

- Captured: yes | no
- CPU:
- Logical CPU count:
- Memory:
- GPU used/model:
- Notes:

Commands:

```bash
<exact command 1>
<exact command 2>
```

## Coverage

Cases:

- Development:
- Protected holdout:
- Fresh holdout:
- Focused rows:

Workflow tags:

- solver-smoke:
- service-pressure:
- typed-footprint:
- road-semantics:
- manual-layout-replay:
- expansion-comparison:
- multi-anchor:

Modes:

- `auto`:
- `greedy`:
- `lns`:
- `cp-sat`:
- `cp-sat-portfolio`:

Budgets:

Seeds:

Split metadata:

- Split field:
- Protected holdout: yes | no
- Leakage status:
- Tuning leakage guard:

Promotion-matrix exceptions:

## Artifact Index

Registry:

- Entry appended: yes | no
- Registry path:
- Registry run id:
- Registry check command:
- Registry check result:

Artifact paths kept in git:

- Summary text:
- Evidence summary:
- Telemetry manifest:
- Workflow replay files:
- Registry entry draft:

External or release storage:

- Raw scorecard JSON:
- Budget ablation JSON:
- Decision trace JSONL:
- Replay labels:
- Solve logs:
- Storage URI or release reference:

## Summary Metrics

Population:

- Mean population delta:
- Median population delta:
- Worst-decile population delta:
- Worst-row population delta:
- Best-row population delta:
- Regression count/rate:
- Auto delta to best:

Baseline-repeat envelope:

- Baseline-repeat run id:
- Inside-repeat-envelope count:
- Outside-positive count:
- Outside-negative count:
- Mean absolute beyond-envelope delta:
- Focused rerun result:

Timing and CPU:

- Mean wall-clock delta:
- First-feasible delta:
- Time-to-best delta:
- Equal-population time-to-best improvement:
- Mean CPU-budget efficiency ratio:
- Observed CPU coverage:
- Over-budget row count:

Evaluator and replay:

- Evaluator-valid rows:
- Invalid rows:
- Population mismatch count:
- Max absolute evaluator population delta:
- Replay count:
- Valid replay count:
- Invalid replay count:
- Replay population deltas:

Exact solver context:

- CP-SAT statuses:
- Minimum exact gap:
- Capacity bound or hard cap signal:

Policy application:

- Applied row count:
- Inactive row count:
- Applied nonzero delta count:
- Inactive nonzero delta count:

## Gate Results

| Gate                   | Result        | Evidence |
| ---------------------- | ------------- | -------- |
| Baseline freshness     | pass/fail/n/a |          |
| Corpus coverage        | pass/fail/n/a |          |
| Same-slice controls    | pass/fail/n/a |          |
| Promotion matrix       | pass/fail/n/a |          |
| Protected holdout      | pass/fail/n/a |          |
| Fresh holdout          | pass/fail/n/a |          |
| Evaluator validity     | pass/fail/n/a |          |
| Replay compatibility   | pass/fail/n/a |          |
| CPU and time-to-best   | pass/fail/n/a |          |
| Artifact policy        | pass/fail/n/a |          |
| Runtime-default safety | pass/fail/n/a |          |

## Blockers And Follow-Up

Blockers:

- Population:
- Regression:
- Repeatability:
- Evaluator validity:
- Replay:
- CPU or timing:
- Fresh holdout:
- Artifact storage:
- Runtime-default risk:

Reopen trigger:

Follow-up backlog items:

## Final Statement

Final decision:

Reason:

Runtime default remains:

Next allowed action:
````

## Decision-Specific Minimums

| Decision Type      | Required Extra Detail                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `promote`          | Exact default change, implementation commit, rollback plan, full promotion-gate pass, and registry entry appended. |
| `keep-baseline`    | Baseline advantage or no-lift reason, unchanged runtime defaults, and evidence path for future reopen.             |
| `diagnostics-only` | What was learned, why it is not runtime behavior, and which future hypothesis it may inform.                       |
| `blocked`          | Blocking rows, blocker category, failed gate, and a concrete reopen condition.                                     |

## Registry Checklist

Decision-grade artifacts need a registry entry or draft with:

- `schemaVersion`
- `runId`
- `artifactType`
- `generatedAt`
- exact `commands`
- `artifactPaths`
- `cases`
- `caseFamilies`
- `seeds`
- `splitStatus`
- `budget`
- `hardware`
- `model`
- `decision`
- `summary`
- `summaryMetrics` when available

Run registry checks before closeout:

```bash
npm run experiment-registry -- check
```

Append decision-grade entries only after the artifact bundle is checkpointed:

```bash
npm run experiment-registry -- append --entry="<artifact-dir>/registry-entry-draft.json"
npm run experiment-registry -- check
```

## Decision Boundary

A closeout can approve follow-up work, record diagnostics, keep the baseline, or block a candidate. It should not quietly change runtime defaults.

Runtime defaults can change only when the closeout says `promote`, the promotion gates in `SOLVER_ROADMAP.md` pass, the implementation is reviewed, and the artifact registry points to decision-grade evidence.

## Decision

M10 is satisfied as a middle-run decision-closeout gate. Solver decisions now have a standard record shape for promote, keep-baseline, diagnostics-only, and blocked outcomes, including command, commit, hardware, split metadata, summary metrics, artifact index, blockers, and runtime-default status.
