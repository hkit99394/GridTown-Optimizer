# Planner Architecture

## Goal

Keep the planner easy to extend by separating:

- browser state + bootstrap wiring
- planner UI modules by responsibility
- HTTP request handling from server startup
- solver job orchestration from solver implementations

## Web Modules

### `apps/planner-web/app.js`

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

### `apps/planner-web/plannerShell.js`

Shared planner shell and UI-state coordination.

Owns:

- optimizer display labels
- solve-status text updates
- cross-module action/button availability
- shared enable/disable rules that depend on solve, comparison, and editor state

### `apps/planner-web/plannerShared.js`

Shared browser helpers and stable utility logic.

Owns:

- JSON/grid cloning
- checkpoint and fingerprint helpers
- catalog import parsing
- formatting helpers

### `apps/planner-web/plannerRequestBuilder.js`

Planner payload and hint/seed preparation.

Owns:

- displayed-layout checkpoint lookup
- CP-SAT hint status
- LNS seed status
- `/api/solve` request construction
- payload preview rendering

### `apps/planner-web/plannerWorkbench.js`

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

### `apps/planner-web/plannerPersistence.js`

Local storage for saved inputs and saved layouts.

Owns:

- save/load/delete input setups
- save/load/delete solved layouts
- restoring saved planner state

### `apps/planner-web/plannerSolveRuntime.js`

Long-running solve lifecycle.

Owns:

- solve timer
- start/poll/stop flow
- progress messages
- live snapshot handling

### `apps/planner-web/plannerExpansion.js`

Decision and expansion comparison workflow.

Owns:

- parsing typed service/residential candidates
- building comparison scenarios
- running background comparison solves
- rendering expansion advice

### `apps/planner-web/plannerResults.js`

Solved output rendering and manual layout editing.

Owns:

- result badges and validation display
- placement and remaining-availability rendering
- solved-map rendering and overlays
- inspector rendering
- manual road/building edits
- `/api/layout/evaluate` round-trip

## Backend Modules

### `src/webServer.ts` and `src/apps/planner-server/webServer.ts`

Local server entrypoints.

Owns:

- compatibility entry from the historical `dist/webServer.js` path
- creating the HTTP server in `src/apps/planner-server/webServer.ts`
- binding `createPlannerRequestHandler`
- wiring the progress-log root and solve-concurrency cap

### `src/apps/planner-server/http/requestHandler.ts`

Thin backend composition layer.

Owns:

- constructing the planner route pipeline
- binding `SolveJobManager` into route handlers
- delegating API requests vs static asset requests
- top-level error translation for the local web server

### `src/apps/planner-server/http/routes.ts`

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

### `src/apps/planner-server/http/contracts.ts`

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

### `src/apps/planner-server/http/solutionResponse.ts`

Planner response assembly.

Owns:

- solve/manual-layout response shaping
- validation projection for the browser contract
- stats projection for solver and manual-layout outputs
- manual-layout road cleanup before evaluation
- explainability-map attachment

### `src/apps/planner-server/http/transport.ts`

HTTP transport helpers shared by planner routes.

Owns:

- request-body parsing limits
- JSON parsing and validation helpers
- JSON/text response helpers
- error-to-status translation
- client disconnect monitoring

### `src/apps/planner-server/http/static.ts`

Planner static asset serving.

Owns:

- static asset path map
- content-type lookup
- static file reads for the local planner

### `src/packages/runtime/jobs/solveJobManager.ts`

Background solve job orchestration.

Owns:

- job lifecycle
- cancellation state
- snapshot recovery
- status projections for the web API

### `src/packages/runtime/jobs/solveProgressLog.ts`

Persistent solve-progress log writer.

Owns:

- progress-log document schema
- pending, live-snapshot, and final-result samples
- final solution serialization for long-running solve recovery/review
- CP-SAT/LNS/Auto progress field normalization for persisted logs

### `src/packages/runtime/dispatch/optimizerRegistry.ts`

Single optimizer dispatch boundary.

Owns:

- optimizer lookup
- sync/background solver adapter selection

Legacy `src/runtime/*` deep-import wrappers have been removed. The runtime
package still keeps a few package-root re-export shims such as
`src/packages/runtime/optimizerRegistry.ts`, `src/packages/runtime/solveJobManager.ts`,
and `src/packages/runtime/solveProgressLog.ts` so internal callers can use the
package boundary without knowing the `dispatch` or `jobs` subfolder. The other
remaining compatibility wrappers are the top-level script entrypoints that
preserve existing `dist/*.js` command paths.

### `src/packages/solvers/auto/solver.ts`

Auto stage orchestration.

Owns:

- `greedy -> LNS -> CP-SAT` stage order
- incumbent acceptance and weak-cycle stopping
- shared sync/background Auto plan execution
- Auto stage metadata assembly

### `src/packages/solvers/auto/stagePolicy.ts`

Auto budget and option policy.

Owns:

- Auto option normalization
- Greedy seed-stage clamps
- LNS stage budget slicing
- CP-SAT reserve preservation for Auto cycles

### `src/packages/solvers/auto/terminal.ts`

Auto terminal result recovery.

Owns:

- terminal stop-reason descriptions
- recovered active-stage selection
- final Auto metadata normalization from snapshots and progress logs

### `src/packages/solvers/lns/neighborhoods.ts`

LNS neighborhood planning.

Owns:

- anchor ranking for weak services, upgrade headroom, and frontier congestion
- repair-window generation
- neighborhood escalation after stagnant iterations
- neighborhood-window selection policy

### `src/packages/core/solutionSerialization.ts`

Shared solution persistence helpers.

Owns:

- serializing `Solution` objects for HTTP, logs, and worker boundaries
- materializing serialized solutions back into `Set`-backed runtime objects
- snapshot file writes for long-running solver flows

## Tool Modules

### `src/tools/cli/*BenchmarkCli.ts`, `src/tools/cli/learnedRankingLabelCli.ts`, and `src/tools/cli/experimentRegistryCli.ts`

Benchmark, label, and experiment-registry command implementations.

Owns:

- benchmark-specific argument parsing and command routing
- benchmark scorecard, label, and registry command output formatting
- importing benchmark functionality through `src/benchmarkApi.ts`

Compatibility wrappers remain at the historical top-level CLI entrypoints such
as `src/greedyBenchmarkCli.ts`, `src/crossModeBenchmarkCli.ts`, and
`src/experimentRegistryCli.ts`. These wrappers should stay thin and only import
the matching implementation under `src/tools/cli`.

## Test Modules

### `tests/optimizers/optimizerHarness.cjs`

Grouped optimizer correctness and regression runner.

Owns:

- test group orchestration for core, Greedy, CP-SAT, Auto, LNS, and benchmark coverage
- high-level solver behavior assertions that compose several package modules
- compatibility coverage for public solver and benchmark entrypoints

Does not own:

- CP-SAT Python helper-introspection boilerplate

### `tests/optimizers/cpSatPythonHelperAssertions.cjs`

Focused CP-SAT Python helper assertions.

Owns:

- locating and loading `python/cp_sat_solver.py` inside throwaway Python snippets
- shared `spawnSync`/JSON assertion plumbing for Python helper inspections
- population-bound, service-pruning, border-capacity, gate, candidate-reduction,
  reachability, and road-connectivity helper assertions

### `tests/helpers/plannerBrowserModules.cjs`

Planner browser-module test loader.

Owns:

- fake DOM element construction for browser-module regression tests
- VM loading for `apps/planner-web` modules
- composing planner shared, request-builder, workbench, persistence, results,
  solve-runtime, shell, and expansion test modules

## Placement Rules

When adding a new behavior:

- If it changes shared button availability or solver status messaging across modules, put it in `plannerShell.js`.
- If it changes how planner payloads are built, put it in `plannerRequestBuilder.js`.
- If it changes grid/catalog editing or summary behavior, put it in `plannerWorkbench.js`.
- If it changes saved input/layout handling, put it in `plannerPersistence.js`.
- If it changes solve lifecycle or polling, put it in `plannerSolveRuntime.js`.
- If it changes compare-addition behavior, put it in `plannerExpansion.js`.
- If it changes result display, map interaction, or manual editing, put it in `plannerResults.js`.
- If it changes planner API routing behavior, update `src/apps/planner-server/http/routes.ts`.
- If it changes request shape validation or browser runtime-parameter stripping, update `src/apps/planner-server/http/contracts.ts`.
- If it changes solver/manual-layout response shape, stats, validation projection, or explainability attachment, update `src/apps/planner-server/http/solutionResponse.ts`.
- If it changes body parsing, response writing, or disconnect handling, update `src/apps/planner-server/http/transport.ts`.
- If it changes static asset wiring, update `src/apps/planner-server/http/static.ts`.
- If it changes background job lifecycle, status recovery, or concurrency admission, update `src/packages/runtime/jobs/solveJobManager.ts`.
- If it changes persisted progress-log schema or sample projection, update `src/packages/runtime/jobs/solveProgressLog.ts`.
- If it changes optimizer dispatch, update `src/packages/runtime/dispatch/optimizerRegistry.ts`.
- If it changes Auto stage order or incumbent acceptance, update `src/packages/solvers/auto/solver.ts`.
- If it changes Auto option defaults, Greedy seed clamps, LNS budget slicing, or CP-SAT reserve policy, update `src/packages/solvers/auto/stagePolicy.ts`.
- If it changes stopped/recovered Auto solution metadata, update `src/packages/solvers/auto/terminal.ts`.
- If it changes LNS anchor ranking or repair-window escalation, update `src/packages/solvers/lns/neighborhoods.ts`.
- If it changes how solutions cross process, log, or file boundaries, update `src/packages/core/solutionSerialization.ts`.
- If it changes benchmark CLI behavior, update the matching implementation in `src/tools/cli`.
- If it changes CP-SAT Python helper-introspection assertions, update `tests/optimizers/cpSatPythonHelperAssertions.cjs`.
- If it changes browser-module fixture loading, update `tests/helpers/plannerBrowserModules.cjs`.
- Keep `src/webServer.ts`, `src/apps/planner-server/webServer.ts`, and `src/apps/planner-server/http/requestHandler.ts` thin.

## Future Workspace Split

The current single TypeScript package is still the source of truth. If the
project grows enough that build/test time, public API size, or ownership
boundaries start slowing development, split it into a small workspace monorepo
rather than separate repositories or independently deployed services.

Target shape:

```text
apps/
  planner-server/      local HTTP API and job orchestration
  planner-web/         browser planner UI

packages/
  core/                grid, types, rules, validation, scoring, serialization
  solvers/             greedy, LNS, CP-SAT, auto orchestration
  runtime/             optimizer registry, background runner, solve jobs
  benchmarks/          benchmark suites, labels, experiment registry

tools/
  cli/                 solve CLI and benchmark CLIs
```

Keep dependency direction strict:

```text
core
  <- solvers
  <- runtime
  <- planner-server
  <- benchmarks/tools
```

`core` must not import solvers, runtime, server, web, or benchmarks. This keeps
the domain model reusable and makes the rest of the split mechanical instead of
semantic.

## Migration Plan

1. Stabilize the public API.

   Keep `src/index.ts` working as a compatibility facade while moving exports
   behind clearer internal module boundaries. Avoid making file moves and API
   changes in the same step.

2. Split benchmarks first.

   Move `src/benchmarks` and benchmark CLIs into a separate package or tool
   area before moving solver code. Benchmarks are large, noisy, and useful to
   isolate, but they are lower risk than the core solver path.

3. Extract `core`.

   Move `src/core` into `packages/core`. Solvers, runtime, server code, and
   tests should consume it through package exports rather than deep relative
   paths. This is the main architectural milestone.

4. Group solvers.

   Move `greedy`, `lns`, `cp-sat`, and `auto` into `packages/solvers`. Keep
   them together initially because `auto` and `lns` intentionally compose the
   other solvers.

5. Separate runtime from server.

   Move optimizer dispatch, background solving, solve jobs, and progress logs
   into `packages/runtime`. The planner server should depend on runtime instead
   of reaching directly into solver internals.

6. Move apps last.

   Move server entrypoints and HTTP modules into `apps/planner-server`, and move
   browser planner files into `apps/planner-web` once the shared package
   boundaries are stable.

7. Add boundary checks.

   Add lightweight tests or lint rules that reject imports against the intended
   dependency direction. The split should be enforced by tooling, not just by
   folder names.

Success criteria:

- `npm test` still covers solver correctness, HTTP routes, and benchmark
  registry behavior after each migration stage.
- Existing CLI and web entrypoints keep working through compatibility wrappers
  until consumers are moved to the new package paths.
- `core` remains free of runtime, server, browser, and benchmark imports.
- The main public API stops exporting benchmark and experiment concerns by
  default.

## Migration Progress

Started on 2026-04-30:

- Added `src/solverApi.ts` as the dedicated solver/domain public entry point.
- Added `src/benchmarkApi.ts` as the dedicated benchmark, label, and
  experiment-registry public entry point.
- Kept `src/index.ts` as an initial compatibility facade while consumers moved
  to dedicated solver and benchmark entrypoints.
- Added `tests/public-api.test.cjs` to verify the new entrypoints stay separate
  while the root facade preserves compatibility.
- Added package subpath exports for `city-builder`, `city-builder/solver`, and
  `city-builder/benchmarks`.
- Moved internal tests off the root compatibility facade where possible; solver
  tests import `city-builder/solver`, while benchmark and registry tests import
  `city-builder/benchmarks`.
- Routed benchmark CLI entrypoints through `src/benchmarkApi.ts` instead of
  direct `src/benchmarks/*` imports, and added a source-boundary guard in
  `tests/public-api.test.cjs`.
- Moved benchmark, learned-label, and experiment-registry CLI implementations
  from `src/apps` to `src/tools/cli`, leaving top-level compatibility wrappers
  for existing `dist/*Cli.js` paths.
- Added a source-boundary guard so code outside the benchmark package imports
  benchmark internals only through `src/benchmarkApi.ts`.
- Added `src/packages/benchmarks/index.ts` as the canonical benchmark package
  boundary, with `src/benchmarkApi.ts` re-exporting from that package-shaped
  entrypoint.
- Moved benchmark internals to `src/packages/benchmarks` and removed the
  legacy `src/benchmarks` deep-import wrapper directory. The supported public
  benchmark surface is `city-builder/benchmarks`, backed by
  `src/benchmarkApi.ts`.
- Started the core extraction phase by adding
  `src/packages/core/index.ts` as the canonical core package boundary and
  routing `src/solverApi.ts` through it.
- Routed `src/packages/benchmarks` core dependencies through
  `src/packages/core/index.ts`, with a public API guard preventing direct
  benchmark-package imports from legacy `src/core/*` modules.
- Routed `src/apps` and `src/tools` core dependencies through
  `src/packages/core/index.ts`, with a public API guard preventing direct
  app/tool imports from legacy `src/core/*` modules.
- Routed runtime, planner-server, and solver implementation dependencies
  through `src/packages/core/index.ts`, with public API guards preventing direct
  imports from legacy `src/core/*` modules.
- Moved core implementation modules into `src/packages/core` and removed the
  legacy `src/core` deep-import wrapper directory.
- Added public API guards preventing the core package from importing upward
  into other package, app, runtime, server, benchmark, or tool layers.
- Moved solver implementation modules into `src/packages/solvers` and removed
  the legacy `src/auto`, `src/cp-sat`, `src/greedy`, and `src/lns` deep-import
  wrapper directories.
- Moved runtime implementation modules into `src/packages/runtime` and removed
  the legacy `src/runtime` deep-import wrapper directory.
- Moved planner server implementation modules into `src/apps/planner-server`
  and removed the legacy `src/server`, `src/server/http`, and
  `src/apps/webServer.ts` wrappers.
- Moved browser planner assets into `apps/planner-web` and pointed the local
  planner server at that static root.
- Added public API guards proving legacy deep-import wrapper directories stay
  removed, while top-level script entry wrappers and the planner web app remain
  at their supported paths.
- Completed the public API split: `city-builder` now exposes the solver/domain
  surface, while benchmark, label, and experiment-registry tooling lives behind
  `city-builder/benchmarks`.

## Current Follow-Up

Reviewed on 2026-05-02:

- The source-layout migration stages above are complete.
- Boundary guards now cover the benchmark split, supported script entry
  wrappers, removed legacy deep-import wrappers, package dependency direction,
  and the planner-web location.
- The optimizer test harness has more temporary-budget headroom after
  CP-SAT Python helper-introspection assertions moved to
  `tests/optimizers/cpSatPythonHelperAssertions.cjs`.
- The review-finding regression test has more temporary-budget headroom after
  browser VM loaders moved to `tests/helpers/plannerBrowserModules.cjs`.
- Temporary budgets were tightened to preserve that headroom:
  `tests/optimizers/optimizerHarness.cjs` is capped at 9,300 lines and
  `tests/review-findings.test.cjs` at 4,250 lines.
- A true npm workspace split remains optional future work if build/test time or
  package ownership needs it.

The remaining cleanup candidates should stay benchmark- or behavior-driven
rather than migration prerequisites:

- `src/packages/solvers/greedy/solver.ts`: split stable profiling, scratch-state, and local-search helpers only when benchmark evidence justifies the boundary.
- `apps/planner-web/plannerResults.js`: separate manual-edit command state from rendering/overlay projection.

Cleanup completed during this migration pass:

- `src/packages/solvers/auto/solver.ts`: stage policy and terminal metadata normalization now live in `src/packages/solvers/auto/stagePolicy.ts` and `src/packages/solvers/auto/terminal.ts`.
- `tests/optimizers/optimizerHarness.cjs`: CP-SAT Python helper inspections now
  live behind `tests/optimizers/cpSatPythonHelperAssertions.cjs`, keeping the
  harness focused on grouped test orchestration.
- `tests/review-findings.test.cjs`: planner browser-module loading now lives in
  `tests/helpers/plannerBrowserModules.cjs`, keeping the regression file focused
  on review scenarios and assertions.
