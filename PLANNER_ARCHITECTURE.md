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

### `src/webServer.ts`

Server bootstrap only.

Owns:
- creating the HTTP server
- binding the planner request handler

### `src/webServerRequestHandler.ts`

HTTP routing and request handling.

Owns:
- static asset serving
- request-body parsing limits
- `/api/health`
- `/api/solve`
- `/api/layout/evaluate`
- `/api/solve/start`
- `/api/solve/status`
- `/api/solve/cancel`

### `src/webServerHttp.ts`

Shared HTTP payload helpers.

Owns:
- request shape validation
- serialized solution materialization
- solve/manual-layout response shaping

### `src/solveJobManager.ts`

Background solve job orchestration.

Owns:
- job lifecycle
- cancellation state
- snapshot recovery
- status projections for the web API

### `src/optimizerRegistry.ts`

Single optimizer dispatch boundary.

Owns:
- optimizer lookup
- sync/background solver adapter selection

## Placement Rules

When adding a new behavior:
- If it changes shared button availability or solver status messaging across modules, put it in `plannerShell.js`.
- If it changes how planner payloads are built, put it in `plannerRequestBuilder.js`.
- If it changes grid/catalog editing or summary behavior, put it in `plannerWorkbench.js`.
- If it changes saved input/layout handling, put it in `plannerPersistence.js`.
- If it changes solve lifecycle or polling, put it in `plannerSolveRuntime.js`.
- If it changes compare-addition behavior, put it in `plannerExpansion.js`.
- If it changes result display, map interaction, or manual editing, put it in `plannerResults.js`.
- If it changes HTTP routes or request parsing, keep `webServer.ts` thin and update `webServerRequestHandler.ts` / `webServerHttp.ts`.

## Current Follow-Up

`web/app.js` is now mainly bootstrap and controller wiring.
The next cleanup, if needed later, would be finer-grained separation of any future shell-level coordination that grows beyond action availability and solve-status updates.
