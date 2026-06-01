# PR Review Response Runbook

Created on 2026-06-01 for review fixes after the next-stage baseline.

Use this runbook when a PR review comment arrives. Its purpose is to keep each response scoped, easy to verify, and separated from unrelated solver, planner, evidence, or artifact work.

## Triage Steps

1. Assign the comment to one primary bucket before editing.
2. If the comment spans buckets, split it into the smallest independent fixes and answer each part separately.
3. Check whether the fix changes behavior, evidence contracts, artifact storage, or docs only.
4. Run the bucket-specific checks below, then include the checks in the PR response.
5. Do not open new solver candidate work from a review comment unless the trigger ledger admits a current trigger.

## Buckets

| Bucket            | Use For                                                                                     | Typical Paths                                                                                                        | Validation Floor                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Docs-only         | Typos, wording clarity, roadmap links, reviewer guide edits, status wording, README clarity | `README.md`, `docs/START_HERE.md`, `docs/roadmaps/*.md`, `docs/requirements/*.md`, `docs/design/*.md`                | `npm run quality:governance`, `npm run format:check`, `git diff --check`                                         |
| Governance-script | Trigger scaffold, candidate-intake checker, package quality gate wiring, governance tests   | `scripts/check-candidate-intakes.mjs`, `scripts/scaffold-candidate-trigger.mjs`, `tests/*candidate*`, `package.json` | `npm run quality:governance`, `npm run quality:evidence`, `npm run lint`, `git diff --check`                     |
| Planner           | Guided planner UI, saved layout flow, status polling, routes, planner API, browser behavior | `apps/planner-web/`, `src/apps/planner-server/`, planner smoke tests, route tests                                    | `npm run quality:fast`; add browser or route smoke when the changed flow is UI-visible                           |
| Solver            | Greedy, LNS, CP-SAT, Auto runtime, validation, scoring, stop rules, default-path behavior   | `src/packages/solvers/`, `src/packages/core/`, `python/`, optimizer tests                                            | `npm run quality:solver`; add focused optimizer or benchmark commands when behavior changes                      |
| Evidence          | Product corpus, benchmark scripts, evaluator-validity, registry contracts, candidate gates  | `src/packages/benchmarks/`, `src/tools/cli/`, `scripts/`, `tests/optimizers/`, evidence docs                         | `npm run quality:evidence`; add the exact focused script or registry check named by the comment                  |
| Artifact          | Artifact hygiene, raw evidence externalization, registry paths, manifests, storage policy   | `artifacts/`, `.gitignore`, `docs/ARTIFACT_POLICY.md`, artifact hygiene scripts/tests                                | `npm run artifact-hygiene:status`, `npm run quality:evidence`, and registry checks when indexed artifacts change |

## Scope Rules

- Keep docs-only responses docs-only unless the reviewer identified a stale behavior contract.
- Keep governance-script responses focused on process safety; do not use them to change solver behavior.
- Planner fixes should preserve saved-layout compatibility, cancel/poll behavior, and the happy-path workflow.
- Solver fixes should name the affected mode, objective impact, validation invariant, and whether defaults change.
- Evidence fixes should preserve same-slice baseline-repeat, fixed seeds, evaluator-validity, CPU/time-to-best interpretation, and registry metadata.
- Artifact fixes should follow [ARTIFACT_POLICY.md](../ARTIFACT_POLICY.md). Under soft-warning, broad artifact-producing work needs a reviewed externalization plan first.

## Response Shape

Use this shape when replying to a review thread:

```text
Bucket: <docs-only | governance-script | planner | solver | evidence | artifact>
Change: <one or two lines naming the fix>
Validation: <commands run>
Residual risk: <none, or the specific remaining risk>
Follow-up: <only if a separate trigger/backlog item is required>
```

## Split Rules

Split a review response into a separate commit or follow-up when:

- the requested fix crosses from docs into behavior;
- the fix would require broad evidence generation;
- the fix would move raw artifacts or registry entries;
- the fix would change default solver behavior;
- the fix depends on a new M9 candidate trigger.

If a comment asks for future solver investigation, respond with the trigger-ledger path and keep the implementation parked until [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md) admits it.

## Closeout

A review response is complete when the code or docs are patched, bucket-specific validation passes, any residual risk is named, and the PR thread has enough detail for the reviewer to verify without reading unrelated files.
