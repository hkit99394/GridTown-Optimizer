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

## R2 Delivered Slice

| Area                    | Change                                                                                                                                                                          | Review Value                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CP-SAT backend protocol | Extracted raw solution typing, JSON normalization, streamed progress parsing, telemetry parsing, and portfolio consistency guards from `src/packages/solvers/cp-sat/solver.ts`. | Keeps the process bridge focused on launch, request building, async handling, and materialize. |
| Public compatibility    | Kept `parseCpSatRawSolution` and `CpSatRawSolution` re-exported from `src/packages/solvers/cp-sat/solver.ts`.                                                                   | Existing runtime/background-solver callers and optimizer tests keep the same import path.      |
| Solver behavior         | No CP-SAT model option, request payload, validation rule, progress event, portfolio rule, or default policy changed.                                                            | Keeps R2 in maintenance/refactor scope rather than candidate scope.                            |

## R3 Delivered Slice

| Area                    | Change                                                                                                                                                    | Review Value                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Planner status response | Extracted active-solve, in-memory status, live snapshot, terminal job, and recovered progress-log payload projection into `solveStatusResponse.ts`.       | Keeps `/api/solve/status` route code focused on request parsing, status lookup, and response send.  |
| Public compatibility    | Kept `/api/solve/status`, `/api/solve/active`, capacity-full active-solve payloads, recovered progress logs, and lightweight validation response shapes.  | Existing route, progress-log, completed-status, and planner smoke tests keep the same API contract. |
| Runtime behavior        | No solve lifecycle, progress-log schema, snapshot polling, terminal recovery, cancellation, route path, status code, or validation-mode behavior changed. | Keeps R3 in maintenance/refactor scope rather than planner behavior scope.                          |

## R4 Delivered Slice

| Area                 | Change                                                                                                                                                                              | Review Value                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| CP-SAT model builder | Extracted cell indexing, candidate bundle construction, building-selection variables, layout constraints, population variables, and objective setup into `cp_sat_model_builder.py`. | Keeps `cp_sat_solver.py` focused on request handling, solver runtime, stop/snapshot behavior, and portfolio orchestration. |
| Helper compatibility | Kept `build_model` and `population_from_objective_value` available from `cp_sat_solver.py` through imports from the new builder module.                                             | Existing Python helper-introspection tests and runtime call sites keep their current module path.                          |
| Solver behavior      | No CP-SAT formulation, objective, candidate pruning, warm-start handling, stop policy, portfolio behavior, or result payload changed.                                               | Keeps R4 in maintenance/refactor scope rather than solver-candidate scope.                                                 |

## R5 Delivered Slice

| Area                  | Change                                                                                                                                                                                             | Review Value                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Lifecycle terminology | Added `solverLifecycleTypes.ts` with shared terms for start, progress, snapshot, cancel, recovered solution, terminal status, run statuses, and progress sample sources.                           | Gives Auto, LNS, CP-SAT, planner status, and progress-log code one named contract for lifecycle review.             |
| Runtime compatibility | Reused the shared run-status and sample-source constants in solve job settlement, progress-log parsing/writing, and planner status projection.                                                     | Keeps persisted `running`/`completed`/`stopped`/`failed` and `live-snapshot`/`final-result` payload strings stable. |
| Regression guard      | Added planner progress-log coverage that verifies the exported lifecycle glossary, validators, terminal statuses, and sample source names.                                                         | Catches future terminology drift before it reaches status recovery or cancellation flows.                           |
| Solver behavior       | No Auto stage policy, LNS repair policy, CP-SAT launch/model behavior, cancellation semantics, progress-log schema version, route status code, or recovered-solution materialization rule changed. | Keeps R5 in maintenance/refactor scope rather than solver-candidate scope.                                          |

## R6 Delivered Slice

| Area                      | Change                                                                                                                                                                            | Review Value                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Stable artifact metadata  | Added `artifactMetadata.ts` for shared artifact date slugs, default run ids, path cloning, and record cloning across benchmark/model artifact helpers.                            | Keeps run-id and metadata cloning rules consistent without coupling benchmark result formats together.     |
| CLI artifact run metadata | Added `buildCliArtifactRunMetadata` for replay command, git metadata, and hardware metadata capture in CLI artifact writers.                                                      | Removes repeated command/git/hardware plumbing from Cross-mode, Greedy, LNS replay, and LNS model writers. |
| Writer compatibility      | Reused the helpers in cross-mode scorecard/product/budget artifacts, Greedy deterministic ablation artifacts, LNS window replay artifacts, and LNS window-ranker model artifacts. | Keeps file names, registry-entry shape, product-corpus behavior, and model-experiment payload semantics.   |
| Regression guard          | Added helper coverage for date/run-id/clone metadata and filtered CLI replay-command metadata.                                                                                    | Catches future metadata drift before evidence artifacts or registry drafts diverge.                        |

## R7 Trigger Plan Delivered

| Area                | Change                                                                                                                                                                   | Review Value                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Architecture review | Added [DURABLE_WORKER_ARCHITECTURE.md](../design/DURABLE_WORKER_ARCHITECTURE.md) with the current local solve lifecycle map, risk register, and target durable contract. | Gives hosted/restart-survivable work one reviewable source of truth before changing runtime ownership.              |
| Deployment plan     | Defined phased gates for store contracts, single-host durability, worker split, multi-instance routing, rollout, rollback, observability, and verification.              | Keeps status, cancellation, snapshots, and progress-log survival requirements explicit and testable.                |
| Runtime boundaries  | Linked the durable-worker plan from [PLANNER_ARCHITECTURE.md](../design/PLANNER_ARCHITECTURE.md).                                                                        | Prevents future `SolveJobManager`, progress-log, or route changes from bypassing the R7 ownership review.           |
| Trigger posture     | Kept runtime behavior unchanged and left implementation gated on a concrete hosted, multi-user, or restart-survivable product requirement.                               | Avoids silently converting a local planner into a distributed runtime before the product and storage choices exist. |

## R8 Trigger Plan Delivered

| Area                 | Change                                                                                                                                                                      | Review Value                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Adapter boundary     | Added [EXTERNAL_EXACT_BACKEND_ADAPTER.md](../design/EXTERNAL_EXACT_BACKEND_ADAPTER.md) with the exact-provider entry guard, current CP-SAT boundary map, and risk register. | Gives MILP/SCIP/Gurobi/cuOpt-style work one reviewed boundary before provider code or dependencies are introduced. |
| Contract plan        | Defined common exact request, response, telemetry, progress, readiness, capability, validation, and provider metadata expectations.                                         | Keeps external bounds and incumbents comparable only when semantics are audited and evaluator validation passes.   |
| Rollout and evidence | Defined phases for contract extraction, CP-SAT-only registry, provider stubs, opt-in provider integration, and evidence closeout.                                           | Prevents external-provider work from bypassing candidate intake, CPU/time-to-best, replay, and artifact gates.     |
| Trigger posture      | Kept runtime behavior unchanged and left implementation gated on exact bounds or incumbents remaining blocked after admitted CP-SAT tuning.                                 | Avoids adding provider options, licenses, binaries, or default-solver coupling without a concrete trigger.         |

## Opportunity Backlog

| ID  | Horizon | Area                                    | Status         | Entry Guard                                                                                                                       | Done When                                                                                                                                                                                                                                  |
| --- | ------- | --------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Short   | Auto runtime-state extraction           | Done in P2     | Behavior-preserving extraction from `src/packages/solvers/auto/solver.ts`.                                                        | Auto state helpers live behind `runtimeState.ts`, build/test coverage passes, and Auto defaults remain unchanged.                                                                                                                          |
| R2  | Short   | CP-SAT TypeScript backend protocol      | Done in R2     | CP-SAT bridge code changes, malformed-progress regressions, or source-budget pressure in `src/packages/solvers/cp-sat/solver.ts`. | JSON validation, streamed progress parsing, and portfolio-result guards live behind `protocol.ts`, with CP-SAT async tests still passing.                                                                                                  |
| R3  | Short   | Planner solve-status projection         | Done in R3     | A route review or status bug touches `/api/solve/status`, recovered progress logs, or terminal payload compatibility.             | `src/apps/planner-server/http/routes.ts` delegates status response projection to `solveStatusResponse.ts` while route validation and compatibility tests pass.                                                                             |
| R4  | Middle  | CP-SAT Python model builder             | Done in R4     | A CP-SAT candidate or source-budget issue touches `python/cp_sat_solver.py`.                                                      | Model construction lives behind `cp_sat_model_builder.py`, legacy helper imports still work, and CP-SAT helper-introspection tests pass.                                                                                                   |
| R5  | Middle  | Solver lifecycle contract               | Done in R5     | Repeated drift appears between Auto, LNS, CP-SAT progress snapshots, cancellation, and terminal recovery.                         | Shared lifecycle terminology lives behind `solverLifecycleTypes.ts`, runtime status/sample-source users import it, and planner progress-log contract tests pass.                                                                           |
| R6  | Middle  | Benchmark artifact writers              | Done in R6     | A focused evidence-script change touches multiple writer paths or registry metadata helpers.                                      | Cross-mode, Greedy, LNS, and model-experiment artifact writers share stable metadata helpers; product-corpus behavior and registry validation stay unchanged.                                                                              |
| R7  | Long    | Durable worker architecture             | Plan delivered | Hosted, multi-user, or restart-survivable execution becomes a product requirement.                                                | Solve status, cancellation, snapshots, and progress logs survive process restarts and multi-instance routing with the reviewed deployment plan in [DURABLE_WORKER_ARCHITECTURE.md](../design/DURABLE_WORKER_ARCHITECTURE.md).              |
| R8  | Long    | External exact-backend adapter boundary | Plan delivered | Exact bounds or incumbents remain blocked after admitted CP-SAT tuning.                                                           | External solvers can be evaluated through an opt-in adapter without changing Auto defaults or bypassing evaluator validation, using the reviewed plan in [EXTERNAL_EXACT_BACKEND_ADAPTER.md](../design/EXTERNAL_EXACT_BACKEND_ADAPTER.md). |

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
