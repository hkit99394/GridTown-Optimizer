# Post-Baseline Trigger Governance Backlog

Created on 2026-06-01 for branch `features/post-baseline-trigger-governance`.

This backlog starts after draft PR #10 publishes the broad next-stage baseline. Its purpose is to keep the next branch focused on review readiness, governance polish, and trigger-admission hygiene. It should not open a new solver candidate unless a real trigger is nominated and admitted through [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md).

## Current Posture

- PR #10 is the baseline publication PR.
- `auto` remains the default quality path.
- No default-path solver candidate is active.
- Artifact hygiene is in soft-warning posture at `1501/1600` tracked artifacts with zero unindexed raw candidates.
- `npm run quality:governance` is the cheap preflight before trigger nomination or broad evidence planning.

## Backlog

| ID  | Status  | Task                                     | Goal                                                                                  | Done When                                                                                                                                 |
| --- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Planned | PR #10 scope review                      | Decide whether the broad baseline PR is reviewable as one draft or needs split notes. | PR #10 has a short reviewer guide, known risk areas, and an explicit ready-or-split decision.                                             |
| G2  | Planned | Governance command README pass           | Make governance commands discoverable without reading roadmap internals.              | `README.md` or `docs/START_HERE.md` names `quality:governance`, `candidate-trigger:scaffold`, and `candidate-intake:check` in one place.  |
| G3  | Planned | Trigger scaffold dry-run example         | Give future trigger nominations a copy-paste command shape.                           | The trigger ledger or companion doc includes one realistic dry-run command and explains when to use `--write-intake`.                     |
| G4  | Planned | Candidate-intake checker edge audit      | Confirm the M15/M16 checker fails useful cases and accepts intended legacy docs.      | Tests cover a ledger-linked active intake, a missing artifact preflight, a missing storage plan, and a pre-M15 closed diagnostics record. |
| G5  | Planned | Artifact soft-warning operating rule     | Make the `1501/1600` soft warning actionable for reviewers.                           | Docs state which workflows may proceed under soft warning and which require an externalization plan first.                                |
| G6  | Planned | PR review response runbook               | Keep future review fixes scoped and easy to verify.                                   | A short runbook records how to triage PR comments into docs-only, governance-script, planner, solver, evidence, or artifact buckets.      |
| G7  | Parked  | First real trigger nomination            | Use the scaffold only when a current artifact, issue, or product requirement appears. | A trigger-ledger record is admitted and the generated M9 intake passes `npm run candidate-intake:check`.                                  |
| G8  | Parked  | Long-run solver candidate implementation | Start implementation only after G7 and the M9 intake gate pass.                       | Same-slice baseline-repeat, evaluator-validity, artifact policy, CPU/time-to-best, and closeout plan are written before code changes.     |

## Recommended Sequence

1. **G1 PR #10 scope review.** This is the first move because it decides whether the baseline PR can become ready for review or needs split/guide work.
2. **G2-G3 governance documentation polish.** Make the new process discoverable and easy to use before adding more enforcement.
3. **G4 checker edge audit.** Add only targeted tests that protect real review mistakes.
4. **G5 artifact soft-warning operating rule.** Clarify what reviewers should do while the repo sits one file above the soft target.
5. **G6 PR review response runbook.** Prepare for review comments without mixing unrelated fixes.
6. **G7-G8 only on trigger.** Do not start solver implementation from this backlog unless the trigger ledger admits a current signal.

## Guardrails

- Do not generate broad evidence just to test the process.
- Do not open an M9 intake without a real trigger source.
- Do not treat `quality:governance` as a substitute for `quality:evidence` when evidence artifacts or registry entries change.
- Do not move past a hard artifact hygiene cap breach; recover artifact hygiene first.
- Keep PR #10 review fixes separate from new solver behavior.

## Suggested Validation

Use these checks for backlog-only changes:

```bash
npm run quality:governance
npm run format:check
npm run lint
git diff --check
```

Use `npm run quality:evidence` when a change touches evidence scripts, registry contracts, artifact policy, or candidate-intake automation.
