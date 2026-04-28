# Planner Architecture

## Goal

Keep the planner easy to extend by separating:
- browser state + bootstrap wiring
- planner UI modules by responsibility
- HTTP request handling from server startup
- solver job orchestration from solver implementations

## Web Modules

### `web/app.js`

Thin bootstrap and orchestration layer.

Owns:
- initial planner state
- DOM element lookup
- controller creation
- event wiring

Does not own:
- cross-module action availability rules
- result rendering details
- expansion comparison logic
- persistence implementation
- solve polling implementation
- grid/catalog rendering internals
- request payload construction internals

### `web/plannerShell.js`

Shared planner shell and UI-state coordination.

Owns:
- optimizer display labels
- solve-status text updates
- cross-module action/button availability
- shared enable/disable rules that depend on solve, comparison, and editor state

### `web/plannerShared.js`

Shared browser helpers and stable utility logic.

Owns:
- JSON/grid cloning
- checkpoint and fingerprint helpers
- catalog import parsing
- formatting helpers

### `web/plannerRequestBuilder.js`

Planner payload and hint/seed preparation.

Owns:
- displayed-layout checkpoint lookup
- CP-SAT hint status
- LNS seed status
- `/api/solve` request construction
- payload preview rendering

### `web/plannerWorkbench.js`

Grid, catalog, and summary workbench.

Owns:
- grid painting and resize
- preset application
- solver field synchronization
- service/residential catalog rendering
- catalog import
- summary rendering
- grid/result matrix sizing
- applying loaded planner input into browser state

### `web/plannerPersistence.js`

Local storage for saved inputs and saved layouts.

Owns:
- save/load/delete input setups
- save/load/delete solved layouts
- restoring saved planner state

### `web/plannerSolveRuntime.js`

Long-running solve lifecycle.

Owns:
- solve timer
- start/poll/stop flow
- progress messages
- live snapshot handling

### `web/plannerExpansion.js`

Decision and expansion comparison workflow.

Owns:
- parsing typed service/residential candidates
- building comparison scenarios
- running background comparison solves
- rendering expansion advice

### `web/plannerResults.js`

Solved output rendering and manual layout editing.

Owns:
- result badges and validation display
- placement and remaining-availability rendering
- solved-map rendering and overlays
- inspector rendering
- manual road/building edits
- `/api/layout/evaluate` round-trip

## Backend Modules

### `src/webServer.ts` and `src/apps/webServer.ts`

Local server entrypoints.

Owns:
- compatibility entry from the historical `dist/webServer.js` path
- creating the HTTP server in `src/apps/webServer.ts`
- binding `createPlannerRequestHandler`
- wiring the progress-log root and solve-concurrency cap

### `src/server/http/requestHandler.ts`

Thin backend composition layer.

Owns:
- constructing the planner route pipeline
- binding `SolveJobManager` into route handlers
- delegating API requests vs static asset requests
- top-level error translation for the local web server

### `src/server/http/routes.ts`

Planner API route handlers.

Owns:
- `/api/health`
- `/api/solve`
- `/api/layout/evaluate`
- `/api/solve/start`
- `/api/solve/status`
- `/api/solve/cancel`
- immediate solve disconnect handling
- solve-job response shaping for route-level metadata

### `src/server/http/contracts.ts`

Planner HTTP request contracts.

Owns:
- request payload interfaces
- route payload shape guards
- browser-supplied local runtime parameter sanitization
- serialized solution payload assertions/materialization re-exports

Does not own:
- solver/manual-layout response assembly
- route orchestration
- request body parsing

### `src/server/http/solutionResponse.ts`

Planner response assembly.

Owns:
- solve/manual-layout response shaping
- validation projection for the browser contract
- stats projection for solver and manual-layout outputs
- manual-layout road cleanup before evaluation
- explainability-map attachment

### `src/server/http/transport.ts`

HTTP transport helpers shared by planner routes.

Owns:
- request-body parsing limits
- JSON parsing and validation helpers
- JSON/text response helpers
- error-to-status translation
- client disconnect monitoring

### `src/server/http/static.ts`

Planner static asset serving.

Owns:
- static asset path map
- content-type lookup
- static file reads for the local planner

### `src/runtime/jobs/solveJobManager.ts`

Background solve job orchestration.

Owns:
- job lifecycle
- cancellation state
- snapshot recovery
- status projections for the web API

### `src/runtime/jobs/solveProgressLog.ts`

Persistent solve-progress log writer.

Owns:
- progress-log document schema
- pending, live-snapshot, and final-result samples
- final solution serialization for long-running solve recovery/review
- CP-SAT/LNS/Auto progress field normalization for persisted logs

### `src/runtime/dispatch/optimizerRegistry.ts`

Single optimizer dispatch boundary.

Owns:
- optimizer lookup
- sync/background solver adapter selection

Compatibility wrappers remain at `src/runtime/optimizerRegistry.ts`, `src/runtime/solve.ts`, `src/runtime/solveJobManager.ts`, `src/runtime/solveProgressLog.ts`, and the old top-level CLI/server entrypoints. New code should prefer the canonical nested modules above unless it is preserving public import compatibility.

### `src/lns/neighborhoods.ts`

LNS neighborhood planning.

Owns:
- anchor ranking for weak services, upgrade headroom, and frontier congestion
- repair-window generation
- neighborhood escalation after stagnant iterations
- neighborhood-window selection policy

### `src/core/solutionSerialization.ts`

Shared solution persistence helpers.

Owns:
- serializing `Solution` objects for HTTP, logs, and worker boundaries
- materializing serialized solutions back into `Set`-backed runtime objects
- snapshot file writes for long-running solver flows

## Placement Rules

When adding a new behavior:
- If it changes shared button availability or solver status messaging across modules, put it in `plannerShell.js`.
- If it changes how planner payloads are built, put it in `plannerRequestBuilder.js`.
- If it changes grid/catalog editing or summary behavior, put it in `plannerWorkbench.js`.
- If it changes saved input/layout handling, put it in `plannerPersistence.js`.
- If it changes solve lifecycle or polling, put it in `plannerSolveRuntime.js`.
- If it changes compare-addition behavior, put it in `plannerExpansion.js`.
- If it changes result display, map interaction, or manual editing, put it in `plannerResults.js`.
- If it changes planner API routing behavior, update `src/server/http/routes.ts`.
- If it changes request shape validation or browser runtime-parameter stripping, update `src/server/http/contracts.ts`.
- If it changes solver/manual-layout response shape, stats, validation projection, or explainability attachment, update `src/server/http/solutionResponse.ts`.
- If it changes body parsing, response writing, or disconnect handling, update `src/server/http/transport.ts`.
- If it changes static asset wiring, update `src/server/http/static.ts`.
- If it changes background job lifecycle, status recovery, or concurrency admission, update `src/runtime/jobs/solveJobManager.ts`.
- If it changes persisted progress-log schema or sample projection, update `src/runtime/jobs/solveProgressLog.ts`.
- If it changes optimizer dispatch, update `src/runtime/dispatch/optimizerRegistry.ts`.
- If it changes LNS anchor ranking or repair-window escalation, update `src/lns/neighborhoods.ts`.
- If it changes how solutions cross process, log, or file boundaries, update `src/core/solutionSerialization.ts`.
- Keep `src/webServer.ts`, `src/apps/webServer.ts`, and `src/server/http/requestHandler.ts` thin.

## Current Follow-Up

Reviewed on 2026-04-28:
- Git status was clean before this pass.
- Baseline `npm test` passed before refactoring.
- Solver roadmap has no active default-changing priority; gated work should wait for new benchmark evidence.
- Backend route contracts are now split from solver/manual-layout response assembly.

The next cleanup candidates are the largest still-active hotspots:
- `src/greedy/solver.ts`: split stable profiling, scratch-state, and local-search helpers only when benchmark evidence justifies the boundary.
- `web/plannerResults.js`: separate manual-edit command state from rendering/overlay projection.
- `src/auto/solver.ts`: isolate stage-budget policy and terminal metadata normalization if the Auto path changes again.
