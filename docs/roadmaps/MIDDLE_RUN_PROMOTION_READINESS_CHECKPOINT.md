# Middle-Run Promotion Readiness Checkpoint

Date: 2026-05-30

Last reviewed: 2026-06-01

Status: 15-case baseline split evidence complete; candidate-specific promotion evidence still required

## Purpose

M1-M11 make the middle-run evidence framework usable. They do not, by themselves, prove that the project is ready to promote a long-run or default-path solver candidate.

This checkpoint blocks that handoff for any long-run/default-path candidate until the candidate can show two concrete things:

1. Fresh product holdout coverage exists for the product workflow being claimed.
2. Candidate-specific final-layout evaluator-validity evidence is runnable for the affected modes, cases, budgets, and seeds.

L0 now carries the operational checklist, first fresh holdout nominations, and evaluator-validity automation command shape. `fresh-multi-anchor-service-island` and `fresh-typed-footprint-scarcity` are implemented and passed a CP-SAT evaluator-validity smoke for the first M9 intake: [M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md). `fresh-expansion-corridor-service` is implemented for the selective CP-SAT intake, passed the 2026-05-31 full CP-SAT evaluator-validity expansion, and has now been paired with `development-expansion-corridor-service` for focused Auto/LNS expansion-corridor diagnostics. `fresh-manual-resume-neighborhood` is implemented for saved-layout resume and warm-start behavior, has focused evaluator-validity smoke coverage, and is included in the durable 15-case split baseline.

The first M9 candidate has now closed diagnostics-only: [M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md](M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md). It passed final-layout evaluator validity but is blocked from promotion by a repeatable protected holdout population regression.

## Promotion Boundary

Framework-complete means the repo has checklists, runbooks, templates, storage rules, and current baseline context.

Promotion-evidence-complete means a specific candidate has current evidence on the exact comparison slice it wants to claim, including development cases, protected holdout cases, fresh product holdout cases, baseline-repeat controls, candidate-specific final-layout evaluator validity, CPU/time-to-best interpretation, and artifact registry coverage.

Middle-run framework readiness is now satisfied for candidate intake. Do not mark any candidate promotion-evidence-complete until its intake or closeout links fresh holdout evidence, candidate-specific evaluator validity, and any reviewed exception.

## Required Before Long-Run Candidate Work

1. **Fresh product holdout nomination:** add or nominate cases that were not tuned against during learned-LNS or service-master diagnostics. Each case should name workflow family, split, mode relevance, budget relevance, and why it is product-realistic.
2. **Baseline refresh shape:** define or run the baseline commands for development, protected holdout, and fresh product holdout slices using the current telemetry-manifest artifact writer. The 2026-05-31 plus 2026-06-01 split artifacts now satisfy the current 15-case baseline requirement for the standard product-corpus matrix.
3. **Candidate evaluator-validity shape:** define a runnable command or harness that validates each candidate final layout through the final-layout evaluator for the affected modes, cases, budgets, and seeds.
4. **Artifact plan:** name where summary manifests, registry drafts, raw scorecards, replay labels, and trace bundles will live before the candidate run starts.
5. **Decision linkage:** require the candidate intake and closeout to link this checkpoint, the fresh holdout evidence, and the evaluator-validity evidence.

## Block Rules

- If fresh product holdout cases are still only a planned command shape, long-run promotion is blocked.
- If evaluator-validity evidence covers only old diagnostics branches or replay workflows, long-run promotion is blocked for new broad candidates.
- If a candidate improves benchmark population but lacks final-layout evaluator validity, it cannot change runtime defaults.
- If artifact storage is unclear, run only diagnostics until summaries, manifests, and registry index entries have durable homes.
- If artifact hygiene exceeds the tracked-file cap again, do not use `npm run quality:evidence` as a release or promotion green light until artifact-cap recovery is complete.

## Done When

- Fresh product holdout cases are present or explicitly nominated in the product corpus workflow.
- A candidate-specific final-layout evaluator-validity command or harness is checked in or linked from the candidate intake.
- Baseline refresh commands or artifacts cover development, protected holdout, and fresh product holdout slices.
- A long-run candidate intake can cite this checkpoint with no open block rules.

## Current Position

The project is in a good middle-run position: evidence gates, baseline repeatability, evaluator-validity boundaries, CPU/time-to-best review, candidate intake, decision closeout, and artifact storage policy are documented.

The 2026-05-31 plus 2026-06-01 split artifacts are the durable baseline for the current 15-case product-corpus matrix: all four modes, budgets `1,5,30,120`, and seeds `7,19,37`. A single combined promotion-matrix artifact is unnecessary unless a release process explicitly requires one.

The 2026-06-01 stage review found one evidence-hygiene blocker: tracked artifacts were above the current repository cap. [ARTIFACT_HYGIENE_RECOVERY_PLAN.md](ARTIFACT_HYGIENE_RECOVERY_PLAN.md) records the first-pass recovery and the follow-up 15-case baseline lock. It does not change solver posture, but it restores the evidence gate, registers the June 1 manual-resume evidence, and keeps the artifact-storage convention current for future release or promotion closeouts.

The project is ready to intake the next opt-in long-run diagnostics candidate when its trigger is satisfied. It is not promotion-evidence-complete for long-run/default-path solver changes; promotion still requires candidate implementation, same-slice baseline-repeat controls, fresh/development/protected evidence, evaluator validity across the claimed matrix, CPU/time-to-best review, artifact registry coverage, and decision closeout.
