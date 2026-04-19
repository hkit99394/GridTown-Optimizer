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

Thin backend composition layer.

Owns:
- constructing the planner route pipeline
- binding `SolveJobManager` into route handlers
- delegating API requests vs static asset requests
- top-level error translation for the local web server

### `src/webServerApiRoutes.ts`

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

### `src/webServerTransport.ts`

HTTP transport helpers shared by planner routes.

Owns:
- request-body parsing limits
- JSON parsing and validation helpers
- JSON/text response helpers
- error-to-status translation
- client disconnect monitoring

### `src/webServerStatic.ts`

Planner static asset serving.

Owns:
- static asset path map
- content-type lookup
- static file reads for the local planner

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

### `src/lnsNeighborhoods.ts`

LNS neighborhood planning.

Owns:
- anchor ranking for weak services, upgrade headroom, and frontier congestion
- repair-window generation
- neighborhood escalation after stagnant iterations
- neighborhood-window selection policy

### `src/solutionSerialization.ts`

Shared solution persistence helpers.

Owns:
- serializing `Solution` objects for HTTP and worker boundaries
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
- If it changes planner API behavior, update `webServerApiRoutes.ts`.
- If it changes body parsing, response writing, or disconnect handling, update `webServerTransport.ts`.
- If it changes static asset wiring, update `webServerStatic.ts`.
- If it changes LNS anchor ranking or repair-window escalation, update `lnsNeighborhoods.ts`.
- If it changes how solutions cross process or file boundaries, update `solutionSerialization.ts`.
- Keep `webServer.ts` and `webServerRequestHandler.ts` thin.

## Current Follow-Up

`web/app.js` is now mainly bootstrap and controller wiring.
The next cleanup, if needed later, would be finer-grained separation of the largest solver and result-editing hotspot files:
- `src/solver.ts`
- `src/lnsSolver.ts`
- `web/plannerResults.js`
