# Deep Refactor Opportunity Backlog

Created on 2026-06-01 for branch `features/recover-quality-gate-and-status-doc`.

This backlog turns the current architecture review into gated maintenance work. It is not a solver candidate list, and it does not authorize `auto` default changes, CP-SAT promotion, learned guidance, portfolio work, GPU work, distributed solving, or external-solver adapters without the trigger workflow in [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md).

## Purpose

Keep the codebase easy to review while the product goal stays unchanged: make `auto` the consistently best default path for planner users.

The safe refactor pattern is:

1. Preserve behavior and public entrypoints.
2. Extract one boundary at a time.
3. Add or reuse focused tests before interpreting runtime or quality changes.
4. Use candidate gates for any change that can affect solver choice, population, timing claims, or artifact evidence.

## Current Constraints

- No default-path solver candidate is active.
- Artifact hygiene is in soft-warning posture at `1501/1600`; broad evidence runs still need an externalization plan.
- Refactors may proceed only when they are behavior-preserving or backed by the normal candidate trigger workflow.
- `src/packages/solvers/auto/solver.ts` and `python/cp_sat_solver.py` were both near the source-file budget before P2; future growth should be extracted before adding behavior.

## P2 Delivered Slice

| Area               | Change                                                                                                                                                                                                                      | Review Value                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Auto runtime state | Extracted Auto runtime bookkeeping, seed generation, stage-run summaries, terminal decoration helpers, and snapshot projection from `src/packages/solvers/auto/solver.ts` into `src/packages/solvers/auto/runtimeState.ts`. | Keeps Auto orchestration focused on stage flow and makes future terminal/progress review smaller. |
| Source budget      | Reduced `src/packages/solvers/auto/solver.ts` from `897` lines to about `625`; the new helper is about `292` lines.                                                                                                         | Restores headroom before the source-file gate becomes another P0 recovery item.                   |
| Solver behavior    | No default policy, budget, stage order, random-seed rule, or promotion posture changed.                                                                                                                                     | Keeps this branch in maintenance/refactor scope rather than candidate scope.                      |

## Opportunity Backlog

| ID  | Horizon | Area                                    | Status        | Entry Guard                                                                                                                       | Done When                                                                                                                                                          |
| --- | ------- | --------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Short   | Auto runtime-state extraction           | Done in P2    | Behavior-preserving extraction from `src/packages/solvers/auto/solver.ts`.                                                        | Auto state helpers live behind `runtimeState.ts`, build/test coverage passes, and Auto defaults remain unchanged.                                                  |
| R2  | Short   | CP-SAT TypeScript backend protocol      | Parked        | CP-SAT bridge code changes, malformed-progress regressions, or source-budget pressure in `src/packages/solvers/cp-sat/solver.ts`. | JSON validation, streamed progress parsing, and portfolio-result guards move behind a protocol helper with CP-SAT async tests still passing.                       |
| R3  | Short   | Planner solve-status projection         | Parked        | A route review or status bug touches `/api/solve/status`, recovered progress logs, or terminal payload compatibility.             | `src/apps/planner-server/http/routes.ts` delegates status response projection to a focused helper while route validation and compatibility tests pass.             |
| R4  | Middle  | CP-SAT Python model builder             | Parked        | A CP-SAT candidate or source-budget issue touches `python/cp_sat_solver.py`.                                                      | Request normalization, model construction, and result projection are separated enough that helper-introspection tests can target each layer.                       |
| R5  | Middle  | Solver lifecycle contract               | Parked        | Repeated drift appears between Auto, LNS, CP-SAT progress snapshots, cancellation, and terminal recovery.                         | Shared lifecycle terminology covers start, progress, snapshot, cancel, recovered solution, and terminal status without changing solver policy.                     |
| R6  | Middle  | Benchmark artifact writers              | Parked        | A focused evidence-script change touches multiple writer paths or registry metadata helpers.                                      | Cross-mode, Greedy, LNS, and model-experiment artifact writers share only stable metadata helpers; product-corpus behavior and registry validation stay unchanged. |
| R7  | Long    | Durable worker architecture             | Trigger gated | Hosted, multi-user, or restart-survivable execution becomes a product requirement.                                                | Solve status, cancellation, snapshots, and progress logs survive process restarts and multi-instance routing with a reviewed deployment plan.                      |
| R8  | Long    | External exact-backend adapter boundary | Trigger gated | Exact bounds or incumbents remain blocked after admitted CP-SAT tuning.                                                           | External solvers can be evaluated through an opt-in adapter without changing Auto defaults or bypassing evaluator validation.                                      |

## Refactor Gates

Use these gates by slice:

| Slice Type                                          | Minimum Gate                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Docs-only backlog/status update                     | `npm run quality:governance` and `git diff --check`                                                                |
| TypeScript behavior-preserving extraction           | `npm run build`, relevant focused tests, `npm run test:misc`, and `git diff --check`                               |
| Solver extraction touching Auto/LNS/CP-SAT behavior | `npm run quality:solver` plus focused optimizer assertions for the affected mode                                   |
| Planner route/status extraction                     | `npm run test:routes`, planner status smoke coverage, and `npm run quality:fast` when UI flow can change           |
| Evidence or artifact writer extraction              | `npm run quality:evidence` and registry/artifact contract tests                                                    |
| Trigger-gated candidate work                        | The full M9 intake, baseline-repeat, evaluator-validity, CPU/time-to-best, artifact-storage, and closeout sequence |

## Review Checklist

- Confirm the change is maintenance/refactor scope, not a hidden solver promotion.
- Confirm public package entrypoints still work: `city-builder`, `city-builder/solver`, and `city-builder/benchmarks`.
- Confirm source-file budgets have headroom after the extraction.
- Confirm docs still point reviewers to [STATUS.md](../STATUS.md), [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md), and this backlog.
- Confirm no broad artifacts are generated while the repository is above the soft artifact target.
