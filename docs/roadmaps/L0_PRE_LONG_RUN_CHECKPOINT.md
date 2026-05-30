# L0 Pre-Long-Run Checkpoint

Date: 2026-05-30

Status: Satisfied for `cp-sat-no-overlap2d-preflight`; first candidate closed diagnostics-only

## Purpose

L0 is the small checkpoint between the middle-run evidence framework and the first long-run/default-path solver candidate. It turns the M12 blocker into two concrete preconditions:

1. Fresh product holdout cases are nominated before candidate tuning starts.
2. Candidate-specific final-layout evaluator validity has a runnable automation path.

L0 does not promote solver behavior. It only decides whether a candidate is ready to leave intake and start implementation or benchmarking. Candidate closeout still decides whether the candidate promotes, stays diagnostics-only, or is blocked.

## Fresh Holdout Nominations

These nominations are the first proposed fresh product holdout set for long-run candidates. `fresh-multi-anchor-service-island` and `fresh-typed-footprint-scarcity` are now implemented in `DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS` for the first CP-SAT intake and passed a CP-SAT evaluator-validity smoke on 2026-05-30. Other nominations still need a product-workflow case or candidate-specific equivalent harness before use.

| Nomination ID                       | Workflow family               | Product shape                                                                  | Leakage guard                                                                                   | Candidate relevance                                                           | Required before use                                                                               |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fresh-expansion-corridor-service`  | expansion plus corridor       | Compare next service/residential expansion on a corridor-constrained layout.   | Must not reuse the closed expansion repair-volatility rows or learned-LNS fresh-pressure cases. | Auto/LNS budget policy and planner expansion candidates.                      | Add a product-workflow case or candidate harness with development/protected/fresh split metadata. |
| `fresh-multi-anchor-service-island` | multi-anchor road semantics   | Multiple anchor components with service access competing against road budget.  | Must not tune from `multi-anchor-road-components` or `road-semantics-gate-choke`.               | CP-SAT road semantics, Auto exact-stage reserve, and road cleanup candidates. | Implemented; CP-SAT validity smoke passed with zero population mismatch.                          |
| `fresh-typed-footprint-scarcity`    | typed footprint pressure      | Scarce large residential footprint plus small service reach and mixed sizes.   | Must not tune from `typed-footprint-pressure` or service-master shortlist diagnostics.          | Greedy service ordering, CP-SAT geometry, and population-cap behavior.        | Implemented; CP-SAT validity smoke passed with zero population mismatch.                          |
| `fresh-manual-resume-neighborhood`  | manual replay plus warm start | Saved layout resume where a valid incumbent seeds LNS and CP-SAT continuation. | Must be generated from a new saved layout, not the current `manual-layout-replay-warm-start`.   | Planner happy path, LNS seed behavior, CP-SAT warm-start compatibility.       | Add a replay hint, final layout evaluator check, and replay population-delta check.               |

## Evaluator-Validity Automation

Use this command shape for candidate-specific final-layout evaluator validity:

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"

npm run evidence:candidate-evaluator-validity -- \
  --artifact-dir="artifacts/candidate-evaluator-validity/${RUN_DATE}/<candidate-id>-${RUN_STAMP}" \
  --candidate-id="<candidate-id>" \
  --run-id="candidate-evaluator-validity-${RUN_STAMP}-<candidate-id>" \
  --decision=candidate-evaluator-validity \
  '--summary=Candidate-specific final-layout evaluator-validity run; no solver default changed.' \
  '--fresh-holdout-note=Uses L0 nominated fresh holdout cases or candidate-specific equivalents before promotion claims.' \
  --modes=auto,greedy,lns,cp-sat \
  --budgets=1,5,30,120 \
  --seeds=7,19,37 \
  --cases=<comma-separated-cases>
```

The script writes:

- `candidate-evaluator-validity.json`
- `candidate-evaluator-validity.txt`
- `telemetry-manifest.json`
- `registry-entry-draft.json`
- `manifest.json`

The small L0 smoke shape is:

```bash
npm run evidence:candidate-evaluator-validity -- \
  --artifact-dir="artifacts/candidate-evaluator-validity/${RUN_DATE}/l0-smoke-${RUN_STAMP}" \
  --candidate-id=l0-smoke \
  --run-id="candidate-evaluator-validity-${RUN_STAMP}-l0-smoke" \
  --decision=l0-automation-smoke \
  '--summary=L0 evaluator-validity automation smoke over one development replay case and one protected holdout replay case; no solver default changed.' \
  '--fresh-holdout-note=L0 smoke validates automation shape only; implemented fresh cases still need candidate-specific validity before promotion claims.' \
  --modes=greedy \
  --budgets=1 \
  --seeds=7 \
  --cases=manual-layout-replay-warm-start,expansion-comparison-replay
```

## Exit Criteria

L0 can close for a candidate when:

- At least two relevant fresh holdout nominations are selected or implemented.
- The candidate intake links the selected fresh holdout cases and leakage guard.
- The candidate-specific evaluator-validity command is written with exact cases, modes, budgets, and seeds.
- A smoke run of `npm run evidence:candidate-evaluator-validity -- ...` succeeds for the candidate's command shape or a documented narrower preflight.
- Artifact storage and registry draft paths are named before large scorecards are generated.

## Current Decision

L0 is satisfied for `cp-sat-no-overlap2d-preflight`. The candidate did proceed to opt-in diagnostics and is now closed diagnostics-only in [M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md](M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md). Runtime defaults and promotion claims remain blocked for that candidate because the focused M9 slice found a repeatable protected holdout population regression.

L0 smoke result on 2026-05-30:

- Command shape: `npm run evidence:candidate-evaluator-validity -- --modes=cp-sat --budgets=1 --seeds=7 --cases=fresh-multi-anchor-service-island,fresh-typed-footprint-scarcity`
- Rows: 2
- Valid rows: 2
- Invalid rows: 0
- Population mismatches: 0
