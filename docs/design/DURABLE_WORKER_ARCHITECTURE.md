# Durable Worker Architecture

Reviewed on 2026-06-01 as the R7 long-run plan from
[DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md](../roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md).

Status: trigger plan delivered. Runtime implementation remains gated until
hosted, multi-user, or restart-survivable execution is an explicit product
requirement.

## Entry Guard

This plan becomes implementation work only when one of these is true:

- A hosted planner must keep long-running solves alive across HTTP server
  restarts or deploys.
- More than one server instance can receive status or cancel requests for the
  same solve.
- A user-facing workflow requires restart-survivable solve status, cancellation,
  snapshots, and progress logs.

Until then, keep the current local planner model. Do not use this plan to change
`auto` defaults, solver budgets, CP-SAT promotion posture, external solver
adapters, GPU work, CP-SAT portfolio work, or distributed solving.

## Architecture Review

Current solve execution is intentionally local and in-process:

| Boundary                   | Current Owner                                                                                                                | Evidence                                                                   | R7 Read                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| HTTP route composition     | `createPlannerRequestHandler` constructs one `SolveJobManager` per local server process.                                     | [requestHandler.ts](../../src/apps/planner-server/http/requestHandler.ts)  | Status and cancel ownership is process-local.                                             |
| Start/status/cancel routes | `/api/solve/start`, `/api/solve/status`, `/api/solve/active`, and `/api/solve/cancel` delegate to the manager.               | [routes.ts](../../src/apps/planner-server/http/routes.ts)                  | Any server instance without the same manager cannot own a live job.                       |
| Job lifecycle              | `SolveJobManager` stores running jobs in a `Map`, tracks cancel state, owns the background handle, and prunes terminal jobs. | [solveJobManager.ts](../../src/packages/runtime/jobs/solveJobManager.ts)   | A restart loses live handles, cancel ability, and in-memory concurrency accounting.       |
| Progress recovery          | `SolveProgressLogWriter` writes local JSON documents with pending, live-snapshot, and final-result samples.                  | [solveProgressLog.ts](../../src/packages/runtime/jobs/solveProgressLog.ts) | Terminal logs can be recovered; an orphaned `running` log returns a lost-status response. |
| Solver process control     | Background solvers use local temp stop files, local snapshot files, and child process handles.                               | [runner.ts](../../src/packages/runtime/background/runner.ts)               | Stop and snapshot channels are tied to the owning process and filesystem.                 |
| Shutdown behavior          | The local web server cancels running solves and finalizes best available snapshots before exit.                              | [webServer.ts](../../src/apps/planner-server/webServer.ts)                 | This is good local hygiene, not durable multi-instance ownership.                         |

Current guarantees:

- Same-process status polling and cancellation work.
- Completed, stopped, or failed progress logs can be recovered by request id.
- Best feasible snapshots are persisted into terminal progress logs when the
  manager can finalize the job.
- A running progress log found after restart is treated as orphaned because no
  live owner can be proven.

Current non-guarantees:

- A running solve does not survive loss of the owning process as a controllable
  job.
- A second server instance cannot cancel or reliably poll another instance's
  live solve.
- The concurrency cap is local to one process.
- Snapshot files and stop files are process-local implementation details.

## Risk Register

| Risk                                  | Severity | Likelihood After Trigger | Evidence                                                                                | Mitigation Direction                                                                                   |
| ------------------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Lost live-job ownership after restart | High     | High                     | Running jobs live in an in-memory `Map`; recovered `running` logs are reported as lost. | Move ownership to a durable job record with leases, heartbeat, and terminal recovery.                  |
| Non-durable cancellation              | High     | High                     | Cancellation calls `handle.cancel()` on the local background handle.                    | Store cancel intent durably; workers poll it and translate it to the local stop channel.               |
| Split-brain concurrency admission     | High     | Medium                   | `maxRunningSolves` is enforced by one manager instance.                                 | Use transactional admission with an active lease count or queue depth limit.                           |
| Snapshot path locality                | Medium   | High                     | Solver snapshots are written to temp files owned by the process.                        | Treat temp snapshots as worker-local cache and persist canonical snapshots to durable storage.         |
| Progress-log storage locality         | Medium   | Medium                   | Progress logs are local JSON files under `artifacts/solve-progress`.                    | Keep local logs for development; use object storage or a shared durable artifact store in hosted mode. |
| Terminal-result double write          | Medium   | Medium                   | Finalization currently happens inside one promise settlement path.                      | Make terminal writes idempotent with generation or compare-and-set checks.                             |
| Rollout blast radius                  | High     | Medium                   | Status, cancel, progress, and solver process control cross several modules.             | Introduce the store behind adapters and run dual-read or shadow-write phases before hosted routing.    |

## Target Contract

The public API should keep the existing status vocabulary:

- `running`
- `completed`
- `stopped`
- `failed`

The durable layer may use internal queue and lease fields, but those fields
should not leak into planner responses unless a later API version explicitly
adds them.

Durable job records need these stable fields:

| Field                                  | Purpose                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `requestId`                            | Public id used by start, status, cancel, logs, and artifacts.                     |
| `clientRole`                           | Preserve primary versus expansion-comparison routing.                             |
| `optimizer`                            | Stable solver mode selected at admission.                                         |
| `input`                                | Serialized grid and sanitized solver params for replay, audit, and worker pickup. |
| `status`                               | Public terminal/running status.                                                   |
| `cancelRequested`                      | Durable cancel intent readable by any worker.                                     |
| `ownerId`                              | Current worker instance holding the lease.                                        |
| `leaseExpiresAt`                       | Fencing signal for stale workers and recovery.                                    |
| `attempt`                              | Monotonic worker attempt number for idempotent artifact writes.                   |
| `createdAt`, `updatedAt`, `finishedAt` | Status projection and retention.                                                  |
| `progressLogUri`                       | Durable progress-log document location.                                           |
| `latestSnapshotUri`                    | Durable best-feasible snapshot location when available.                           |
| `finalResultUri`                       | Durable final solution payload location for terminal status.                      |
| `message`, `error`                     | Planner-facing terminal annotations.                                              |

Required operations:

| Operation         | Requirement                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Admit solve       | Create or reject a job atomically with the global concurrency policy.                          |
| Acquire lease     | Assign one worker owner for one request id and attempt.                                        |
| Heartbeat         | Extend ownership and publish liveness without changing the public status.                      |
| Append progress   | Write pending, live-snapshot, and final-result samples idempotently.                           |
| Persist snapshot  | Store the latest feasible solution outside worker temp storage.                                |
| Request cancel    | Set durable cancel intent from any server instance.                                            |
| Finish job        | Compare-and-set from `running` to `completed`, `stopped`, or `failed`.                         |
| Recover stale job | Detect expired leases and either requeue, stop, or mark failed with the best durable snapshot. |
| Prune             | Retain terminal records and artifacts according to a reviewed retention policy.                |

Core invariants:

1. At most one non-expired lease owns a running job.
2. Cancel intent survives HTTP process restart.
3. Status projection never trusts a stale owner after lease expiry.
4. Terminal writes are idempotent and fenced by `attempt`.
5. Final solutions are materialized through the existing serialized solution
   validators before planner responses are built.
6. Progress-log schema compatibility is preserved for existing recovered
   terminal responses.
7. Solver behavior, solver choice, budgets, seeds, and default policy stay
   unchanged.

## Deployment Plan

### Phase 0 - Current Local Mode

Keep the current in-process manager for local planner use. The existing local
mode is still appropriate while R7 has no product trigger.

Success criteria:

- Current route and progress-log tests keep passing.
- Running logs after local restart continue to return the explicit orphaned
  response instead of pretending the job is still controllable.

### Phase 1 - Store Contract And Adapter

Introduce a `SolveJobStore` contract behind `SolveJobManager` without changing
route payloads. Use an in-memory or filesystem test adapter first; choose a
production store only after the trigger names the hosted environment.

Success criteria:

- Unit tests cover admission, lease acquisition, heartbeat, cancel intent,
  idempotent finish, and stale lease recovery.
- Existing planner route tests pass unchanged.
- No new external service is required for local development.

### Phase 2 - Single-Host Durable Execution

Persist job records, cancel intent, progress-log URI, latest snapshot URI, and
terminal result URI while still running one local worker owner.

Recommended production storage shape:

- Transactional row store for job records and leases, preferably PostgreSQL in a
  hosted multi-instance environment.
- Durable object storage or shared artifact storage for progress logs,
  snapshots, and final solution payloads.
- Local filesystem adapter only for development and focused tests.

Success criteria:

- HTTP process restart can read a running job record and report its owner,
  heartbeat age, and latest durable progress.
- Cancel after HTTP restart sets durable intent and is observed by the worker.
- A worker crash finalizes or marks the job stale using the latest durable
  snapshot according to the recovery policy.

### Phase 3 - Worker Split

Run solve execution in a separate worker host. HTTP servers should admit jobs,
read status, and request cancellation through the store; workers should acquire
leases and translate durable state to local stop/snapshot files.

Success criteria:

- Restarting the HTTP host does not interrupt an owned worker solve.
- Restarting a worker either reacquires the job safely or marks it terminal with
  the best durable snapshot.
- Status and cancellation work from a different HTTP instance than the one that
  started the solve.

### Phase 4 - Multi-Instance Routing

Allow multiple HTTP instances and worker instances to share the same durable job
store.

Success criteria:

- Concurrent `/api/solve/start` requests cannot exceed the configured global
  running-solve cap.
- `/api/solve/status` and `/api/solve/cancel` work from any server instance.
- Lease expiry, worker crash, and deploy restart scenarios have automated tests.
- Metrics cover active jobs, stale leases, cancel latency, progress lag,
  snapshot write failures, and terminal-result write failures.

### Phase 5 - Rollout And Rollback

Ship durable mode behind configuration. Keep local mode available until hosted
mode has passed restart and multi-instance smoke tests.

Rollout checklist:

- Store schema migration and rollback path reviewed.
- Retention policy reviewed against [ARTIFACT_POLICY.md](../ARTIFACT_POLICY.md).
- Load and concurrency limits configured per environment.
- Health checks report store connectivity and worker lease health.
- Alerting covers stale jobs, stuck cancellation, and progress-log write errors.
- Runbook documents how to inspect a request id, force-stop a stale job, and
  recover a terminal result.

## Verification Plan

Minimum automated coverage before enabling durable mode:

- Store-contract tests for create, get, lease, heartbeat, cancel, finish, and
  recover.
- Route tests proving status and cancel work through the store adapter.
- Progress-log compatibility tests for existing version `2` terminal documents.
- Restart smoke: start solve, restart HTTP host, poll status, request cancel.
- Worker crash smoke: kill worker, verify stale lease handling and snapshot
  recovery.
- Multi-instance smoke: start on one HTTP instance, poll and cancel from another.
- Concurrency race test for the global running-solve cap.

Minimum manual review before rollout:

- Confirm hosted storage target and retention.
- Confirm product expectation for how long terminal jobs remain recoverable.
- Confirm whether running jobs should be requeued, stopped, or failed when the
  owning worker lease expires.
- Confirm no solver promotion or default-path behavior is bundled with R7.

## Implementation Boundaries

Expected source areas after the trigger is admitted:

- `src/packages/runtime/jobs/solveJobManager.ts` for store-backed lifecycle
  orchestration.
- `src/packages/runtime/jobs/solveProgressLog.ts` for durable progress-log URI
  and schema compatibility.
- `src/packages/runtime/background/runner.ts` and
  `src/packages/runtime/background/serializedSolutionBridge.ts` for translating
  durable cancel intent into local stop channels.
- `src/apps/planner-server/http/routes.ts` and
  `src/apps/planner-server/http/solveStatusResponse.ts` for status/cancel
  projection only if the public response needs new durability metadata.
- `src/apps/planner-server/webServer.ts` and deployment scripts for local versus
  hosted mode wiring.

Expected documentation areas:

- [PLANNER_ARCHITECTURE.md](PLANNER_ARCHITECTURE.md) for ownership boundaries.
- [SOLVER_ROADMAP.md](../roadmaps/SOLVER_ROADMAP.md) for trigger posture.
- [ARTIFACT_POLICY.md](../ARTIFACT_POLICY.md) if hosted progress logs or
  snapshots change artifact retention.

Non-goals:

- Distributed search across multiple solver workers for one request.
- Solver default, budget, or stage-policy changes.
- CP-SAT portfolio promotion.
- External exact-backend adapters.
- Broad benchmark evidence generation.

## Current Decision

R7 has a reviewed architecture and deployment plan. Implementation should stay
parked until the entry guard names a concrete hosted, multi-user, or
restart-survivable product requirement and a durable storage target.
