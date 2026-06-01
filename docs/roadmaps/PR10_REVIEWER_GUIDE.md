# PR #10 Reviewer Guide

Created on 2026-06-01 from branch `features/post-baseline-trigger-governance`.

PR #10 is the broad next-stage baseline PR from `features/next-stage` into `main`. It has 29 commits and 700 changed files. The large file count is expected: 557 paths are under `artifacts/`, and most of the line-count swing comes from artifact-hygiene removal of raw evidence bundles while preserving summaries, manifests, registry drafts, and registry index entries.

## Ready-Or-Split Decision

Decision: keep PR #10 as one draft baseline PR for review, with lane-based review guidance. Do not split it before first review.

Reason:

- The commits are already staged as one coherent checkpoint: planner short-run completion, middle-run evidence framework, artifact recovery, and governance gates.
- Splitting now would force reviewers to reconstruct shared contracts across planner UI, solver evidence scripts, artifact policy, and roadmap docs.
- The riskiest part of the diff is not one implementation file; it is cross-document and artifact consistency. A single baseline PR makes that consistency easier to verify.
- The artifact diff is large but mostly policy-driven externalization. Splitting only artifact removals into a separate PR would reduce visual noise but would also separate registry and roadmap context from the recovery.

Split fallback:

- Split only if reviewers cannot review the baseline as a draft after using this guide.
- Preferred split order would be: planner UI/runtime smoke, solver/evidence framework, artifact hygiene/externalization, governance automation/docs.
- Do not split a default-path solver behavior change because PR #10 does not intentionally promote one.

## Review Lanes

| Lane               | Focus                                                                            | Key Paths                                                                                                                 | Suggested Review Question                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner UX/runtime | Guided planner, saved-layout status, happy-path flows, v2.1 UI default           | `apps/planner-web/`, `src/apps/planner-server/http/`, planner smoke tests                                                 | Does the planner still guide users through input, solve, inspect, validate, save/export, and expansion comparison without breaking status/cancel/recovered solve flows? |
| Solver runtime     | Population cap stop, CP-SAT geometry diagnostics, LNS/Auto timing behavior       | `src/packages/solvers/`, `src/packages/core/`, `python/`                                                                  | Are runtime changes conservative, opt-in where required, and consistent with exact validation and current `auto` defaults?                                              |
| Evidence framework | Product corpus, baseline-repeat, evaluator-validity, candidate intake/closeout   | `src/packages/benchmarks/`, `src/tools/cli/`, `scripts/`, `tests/optimizers/`, `tests/*candidate*`                        | Can a future candidate be evaluated with same-slice controls, fixed seeds, evaluator-validity, CPU/time-to-best, and registry metadata before promotion?                |
| Artifact hygiene   | Externalized raw bundles, soft/hard caps, registry/index durability              | `artifacts/`, `.gitignore`, `scripts/prepare-artifact-hygiene-recovery.mjs`, `tests/artifact-repository-hygiene.test.cjs` | Do tracked artifacts keep durable summaries/manifests while raw evidence leaves git safely, with soft warning at 1500 and hard cap at 1600?                             |
| Governance/docs    | Roadmap restructure, trigger ledger, candidate checker/scaffold, cheap preflight | `docs/`, `README.md`, `package.json`, `scripts/check-candidate-intakes.mjs`, `scripts/scaffold-candidate-trigger.mjs`     | Is the project now clear that no solver candidate opens without a real admitted trigger and that `quality:governance` is not a replacement for evidence gates?          |

## Known Risk Areas

1. **Artifact externalization correctness.** The raw evidence removals must stay paired with external manifests and registry draft updates. Review `ARTIFACT_HYGIENE_RECOVERY_PLAN.md`, `MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md`, `.gitignore`, and the affected `registry-entry-draft.json` files together.
2. **Planner status compatibility.** The completed-status resilience changes touch polling and terminal solve handling. Review `plannerSolveRuntime`, status routes, and the completed-status smoke together.
3. **No accidental default solver promotion.** CP-SAT `NoOverlap2D`, service-master, learned guidance, and Auto/LNS policies should remain diagnostics-only or opt-in. Review `SOLVER_ROADMAP.md`, M9 closeouts, and solver option plumbing for default changes.
4. **Population cap semantics.** The cap stop rule is correct only for true residential-inventory hard caps with validated layouts. Review `capGrace`, Auto/LNS stop behavior, and roadmap wording together.
5. **Governance drift.** `candidate-intake:check`, `candidate-trigger:scaffold`, and `quality:governance` should help future work without becoming a substitute for `quality:evidence`.

## Suggested Review Order

1. Read `README.md`, `docs/START_HERE.md`, and `docs/roadmaps/SOLVER_ROADMAP.md` for the intended state.
2. Review planner UI/runtime changes and smoke tests.
3. Review solver runtime changes and optimizer assertions.
4. Review evidence framework scripts/tests and M9/M10/M11/M12 docs.
5. Review artifact hygiene migration and registry/index consistency.
6. Review governance automation and trigger-admission docs.

## Validation To Trust

Local checks already run before PR creation:

```bash
npm run quality:governance
node tests/governance-scripts.test.cjs
npm run format:check
npm run lint
git diff --check
npm run quality:evidence
```

Recommended reviewer rerun:

```bash
npm run quality:governance
npm run quality:evidence
```

Use `npm run quality:fast` if planner/runtime code changes are questioned, and `npm run quality:solver` if solver implementation changes need a full optimizer pass.

## G1 Closeout

G1 is complete when this guide is available to reviewers and PR #10 has an explicit review posture. Current recommendation: keep PR #10 as one draft baseline PR, review by lanes, and split only if lane-based review proves unworkable.
