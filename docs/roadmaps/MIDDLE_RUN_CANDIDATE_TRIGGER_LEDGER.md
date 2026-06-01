# Middle-Run Candidate Trigger Ledger

Created on 2026-06-01.

Use this ledger before opening a new solver candidate intake. Its job is to keep the project from starting broad solver work just because the evidence framework is ready. A candidate can move into [MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md](MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md) only after its trigger is current, reproducible, scoped, and paired with an artifact plan.

This ledger is not a promotion gate. It is a pre-intake parking lot and triage record.

## Current Decision

No new solver candidate should open by default. The 15-case split baseline is the durable baseline, artifact hygiene is in a soft-warning state at `1501/1600`, and broad evidence runs should wait for a named trigger plus an externalization plan when needed.

## Trigger Admission Rule

A trigger is intake-ready only when all of these are true:

1. It points to a current artifact, user workflow, benchmark row, issue, or product requirement.
2. It reproduces on the current 15-case baseline or has a documented reason that the current baseline cannot reproduce it.
3. It names affected mode(s), case(s), budget(s), seed(s), and workflow tag(s).
4. It identifies the primary objective: population, time-to-best at equal population, CPU efficiency, reliability, exactness, or planner workflow quality.
5. It has a same-slice baseline-repeat control shape.
6. It has candidate-specific evaluator-validity and replay gates when final layouts or saved-layout workflows are affected.
7. It has a storage plan that preserves artifact hygiene before broad evidence runs.

If any item is missing, keep the trigger parked and do not open an M9 candidate.

## Open Trigger Ledger

| Trigger ID | Status | Source                                          | Candidate Class | Required Before Intake                                           |
| ---------- | ------ | ----------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| none       | parked | No current reproducible outside-envelope signal | n/a             | Wait for a real current artifact, issue, or product requirement. |

## G7 Start Review

Reviewed on 2026-06-01 after the request to start G7.

Decision: no trigger is admitted. Keep the open trigger ledger at `none`, and do not create an M9 intake yet. The request starts the review workflow, but it does not itself name a candidate source with a reproducible signal, issue, or product requirement.

Reviewed sources:

- [MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md](MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md): current 15-case split artifacts cover `180` scorecards and `720` mode runs; Auto ties best on `175/180` rows, all remaining gaps are short-budget only, and Auto ties best on all `30s` and `120s` rows.
- [M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md](M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md): expansion-corridor policies were safe but population-neutral; broad rerun remains blocked unless a new protected or fresh row shows population movement outside the baseline-repeat envelope, or an equal-population time-to-best product target appears.
- [MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md](MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md): manual-resume Auto reaches the hard population cap with valid replay; strict `1s` wall-clock work needs a separate product SLA or missed-population artifact.
- [M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md): selective CP-SAT geometry evidence stayed safe but remains diagnostics-only; next geometry work needs a real runtime problem-feature guard trigger.

Admission result:

- Current artifact or issue: none admitted.
- Reproducible outside-envelope signal: none admitted.
- Product requirement: none specific enough to open a solver candidate.
- Artifact hygiene preflight: `soft-warning`, `1501/1600` tracked artifacts, `0` unindexed raw candidates; focused evidence may proceed, broad evidence needs an externalization plan.
- Scaffold or `--write-intake`: do not run for a real intake until a source satisfies the admission rule.

Next eligible trigger must name one of these:

- a protected or fresh row with repeatable population movement outside the baseline-repeat envelope;
- a product SLA that makes strict wall-clock or equal-population time-to-best a first-order target;
- a current issue or artifact showing evaluator invalidity, replay failure, or missed population;
- a new candidate mechanism with same-slice baseline-repeat, evaluator-validity, CPU/time-to-best, and artifact-policy coverage.

## Parked Watch Signals

| Watch Signal                             | Current Read                                                                                                           | Reopen Trigger                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto short-budget gaps                   | Current gaps are seed-specific or disappear by `30s`; Auto ties best on all `30s` and `120s` rows.                     | Same workflow family falls behind best-of-mode outside the baseline-repeat envelope across more than one standard seed.                         |
| Auto strict `1s` timing on manual resume | Population reaches the hard cap; residual overrun is CP-SAT bridge/model-build overhead.                               | A product SLA requires strict subsecond completion, or a current artifact shows missed population because bridge overhead blocks useful search. |
| CP-SAT geometry pressure                 | Selective and guarded `NoOverlap2D` paths are evaluator-valid but slower or not population-moving enough for defaults. | A different runtime-bottleneck hypothesis appears with same-slice CPU/time-to-best evidence and no protected/fresh regression.                  |
| Auto/LNS expansion-corridor policy       | Focused guarded repair policies were safe but population-neutral.                                                      | A protected/fresh expansion-corridor row shows population movement outside the baseline-repeat envelope.                                        |
| Learned LNS guidance                     | Offline signal exists, but protected/fresh online value remains blocked.                                               | A branch produces protected/fresh online final-population or time-to-best value without regressions or final-neutral override blockers.         |
| Service-master shortlist                 | Standalone Greedy value exists, but Auto/default does not move.                                                        | Repeatable equal-budget wins appear in Auto or Greedy seed paths across development and holdout pressure families.                              |
| CP-SAT portfolio                         | No current CPU-normalized promotion signal.                                                                            | Portfolio beats single CP-SAT on quality and CPU efficiency across protected/fresh rows.                                                        |

## Trigger Record Template

```markdown
### <trigger-id>

Status: nominated | intake-ready | parked | closed
Date:
Owner:
Source:

Current artifact or issue:

- Artifact path:
- Issue or product requirement:
- Command:

Observed signal:

- Case(s):
- Split(s):
- Workflow tag(s):
- Mode(s):
- Budget(s):
- Seed(s):
- Baseline behavior:
- Why this is outside current noise or repeat envelope:

Candidate class:

- Auto budget policy | Greedy ranking | LNS repair policy | CP-SAT tuning | CP-SAT portfolio | learned guidance | planner/runtime reliability | other

Objective:

- Population:
- Time-to-best:
- CPU efficiency:
- Reliability:
- Exactness:
- Planner workflow quality:

Required before M9 intake:

- Same-slice baseline-repeat:
- Candidate-specific evaluator-validity:
- Replay or saved-layout gate:
- CPU/time-to-best interpretation:
- Artifact storage preflight:
- Fresh holdout coverage:

Decision:

- Open M9 intake:
- Keep parked:
- Close:
- Rationale:
```

## How To Open Intake

1. Generate a nomination packet with `npm run candidate-trigger:scaffold -- --trigger-id=<trigger-id> --candidate-id=<candidate-id> --source=<current artifact, issue, or product requirement>`.
2. Add or update the generated trigger record in this ledger.
3. Run `npm run artifact-hygiene:status` and record whether broad evidence needs an externalization plan.
4. Confirm the trigger satisfies the admission rule.
5. Create the M9 intake from the generated draft or from [MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md](MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md).
6. Link this ledger record from the intake's `Trigger` section.
7. Run `npm run candidate-intake:check` before implementation or broad evidence work.

## Automation

`npm run candidate-trigger:scaffold` creates a consistent trigger-ledger record and M9 intake draft. Use `--write-intake` to write the intake draft to `docs/roadmaps/M9_CANDIDATE_INTAKE_<ID>.md`; keep the generated ledger record reviewable before changing the open-trigger table.

Dry-run example:

```bash
npm run candidate-trigger:scaffold -- \
  --trigger-id=auto-lns-expansion-corridor-gap \
  --candidate-id=auto-lns-expansion-corridor-policy \
  "--source=artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z" \
  --artifact-path=artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z \
  "--candidate-class=Auto/LNS repair policy" \
  --cases=development-expansion-corridor-service,row0-corridor-repair-pressure,expansion-comparison-replay,fresh-expansion-corridor-service \
  "--splits=development,holdout,fresh holdout" \
  --modes=auto,lns \
  --budgets=5s \
  --seeds=7,19,37 \
  "--workflow-tags=expansion-comparison,corridor" \
  --objective=population
```

The command above is a dry run because it omits `--write-intake`: it prints the ledger record and intake draft for review, but does not change files. Add `--write-intake` only after the trigger source is current, admission-ready, and worth turning into a real M9 intake file; keep using the printed ledger record as a reviewed edit to this ledger.

`npm run candidate-intake:check` enforces the M15 gate for new or active M9 intake docs. It requires:

- A real trigger source and trigger-ledger link.
- `npm run artifact-hygiene:status` as the artifact hygiene preflight.
- Same-slice baseline-repeat controls.
- Candidate-specific evaluator-validity and replay gates.
- Artifact storage and registry plans.

`npm run quality:governance` is the cheap preflight for this workflow. It runs docs formatting, artifact hygiene status, the candidate intake check, and the candidate-intake plus trigger-scaffold contracts without building or running benchmark suites.

Pre-M15 closed diagnostics records are accepted as legacy evidence, but they do not authorize new candidate work without a fresh trigger-ledger record.

## Decision

This ledger adds the missing pre-intake checkpoint after M14. The project can keep moving on maintenance and diagnostics without opening broad solver candidates until a real trigger is nominated and admitted.
