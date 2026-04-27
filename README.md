# City Builder

Optimize a city layout on a 2D grid by placing roads, service buildings, and residential buildings to maximize total population.

This project now includes:
- an `auto` staged solver that runs `greedy -> LNS -> bounded CP-SAT`
- a `greedy` heuristic solver with restarts and local search
- an `LNS` solver that improves a seed layout with neighborhood CP-SAT repair
- a `CP-SAT` solver backed by Google OR-Tools
- strict validators and exact layout scoring
- a local web planner with saved layouts, map inspection, and manual editing

Core reference docs:
- [SPEC.md](./SPEC.md): formal problem statement
- [Requirement.md](./Requirement.md): product-level summary
- [ALGORITHM.md](./ALGORITHM.md): heuristic design notes
- [LEARNED_GUIDANCE_ROADMAP.md](./LEARNED_GUIDANCE_ROADMAP.md): roadmap for ML / RL-style learned guidance over the current solver stack
- [PLANNER_ARCHITECTURE.md](./PLANNER_ARCHITECTURE.md): current web/backend module boundaries
- [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md): overall solver roadmap
- [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md): CP-SAT-specific roadmap

## Problem Summary

The input is a grid of `0` and `1` values:
- `1` means the cell is allowed
- `0` means the cell is blocked

The solver must place:
- roads on allowed cells
- service buildings on allowed rectangular footprints
- residential buildings on allowed rectangular footprints

Subject to these core rules:
- every road component must touch row `0`
- every building must connect to a row-0-connected road component
- buildings touching row `0` are treated as road-connected automatically
- buildings cannot overlap each other or roads
- service buildings have their own footprint, bonus, range, and availability
- residential buildings have typed min/max population and availability

The objective is to maximize total residential population.
For the CP-SAT solver, ties are broken explicitly in favor of fewer roads and fewer placed services.

## Supported Model

### Service buildings

Each service type defines:
- `rows`
- `cols`
- `bonus`
- `range`
- `avail`
- optional `allowRotation`

### Residential buildings

Each residential type defines:
- `w`
- `h`
- `min`
- `max`
- `avail`

Preferred configuration is typed `residentialTypes`. Legacy `residentialSettings` plus `basePop` / `maxPop` are still supported for compatibility.

## Solvers

### `auto`

`auto` is the recommended quality path and the default optimizer for omitted `params.optimizer` values in the public runtime, HTTP API, example CLI, and web planner.

In this project it:
- starts with a capped fast greedy incumbent
- improves it with `LNS`
- follows with bounded `CP-SAT` polishing
- keeps alternating bounded `LNS` and `CP-SAT` while meaningful improvement continues

Use this when overall answer quality matters more than keeping the run purely standalone or heuristic.

Auto owns orchestration details. It generates per-stage random seeds and reports them in `solution.autoStage.generatedSeeds`; standalone `greedy.randomSeed` and `cpSat.randomSeed` are only honored by direct Greedy/CP-SAT runs.

### `greedy`

The greedy solver is the heavy standalone heuristic / advanced inspection mode.

It uses:
- service candidate ranking
- constructive placement
- optional restarts
- local improvement
- optional bounded exhaustive search over top service layouts

Use standalone `greedy` when you want Greedy-only quality checks or heuristic tuning. Use `auto` when you want the fast seed stage plus follow-on improvement.

### `lns`

`LNS` means `Large Neighborhood Search`.

In this project it:
- starts from a greedy solution or a displayed saved layout seed
- fixes everything outside one neighborhood window
- repairs that window with CP-SAT
- keeps the best incumbent found so far

It also includes deterministic same-cell upgrade passes for obviously stronger service and residential replacements.

Use this when you want a better layout than greedy without doing a full global CP-SAT search from scratch.

### `cp-sat`

The CP-SAT solver is the exact optimization backend using OR-Tools.

In practice it may return:
- `OPTIMAL`: best solution found and proven optimal
- `FEASIBLE`: best known solution found within limits, not proven optimal

Use this when you want deeper global search or proof of optimality on instances the exact model can handle well.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Optional: set up CP-SAT

```bash
npm run setup:cp-sat
```

### 4. Run an example solve

Auto:

```bash
npm run solve:auto
```

Greedy:

```bash
npm run solve:greedy
```

LNS:

```bash
npm run solve:lns
```

CP-SAT:

```bash
npm run solve:cp-sat
```

### 5. Run tests

```bash
npm test
```

## CLI Commands

Available scripts from [package.json](./package.json):
- `npm run build`
- `npm run web`
- `npm run solve`
- `npm run solve:auto`
- `npm run solve:greedy`
- `npm run solve:lns`
- `npm run solve:cp-sat`
- `npm run benchmark:greedy`
- `npm run benchmark:lns`
- `npm run benchmark:cp-sat`
- `npm run benchmark:scorecard`
- `npm run setup:cp-sat`
- `npm test`

`npm run solve` currently runs the built-in example with the default `auto` backend in the example CLI.

## Web Planner

Start the planner with:

```bash
npm run web
```

Then open [http://localhost:4173](http://localhost:4173).

The planner now includes:
- an interactive grid editor
- service and residential catalog editing
- collapsible catalog import
- solver-specific control panels for `auto`, `greedy`, `LNS`, and `CP-SAT`
- standalone Greedy diagnostics with a collapsible "why not placed?" result report
- saved input setups
- saved solved layouts
- automatic `LNS` seeding and `CP-SAT` hinting from the displayed output when the displayed layout is validated and model-compatible
- result review with validation, placements, remaining availability, solved map overlays, and an optional service-value heatmap
- manual layout editing on the solved map:
  - add remaining buildings
  - move buildings
  - remove buildings
  - add or remove roads
  - rotate a pending placement by 90 degrees before placing it
  - defer validation until you click `Validate layout`
- expansion comparison tooling for proposed next service or residential additions

Notes:
- `LNS` and `CP-SAT` need the Python OR-Tools backend
- stopping a background solve preserves the best feasible result when one exists
- the displayed output can be reused as the default seed or hint only when the current model fingerprint still matches and the layout has been validated

## Library Usage

### Solve a layout

After `npm run build`, you can import from the compiled entrypoint in `dist/`:

```ts
import { solve } from "./dist/index.js";

const grid = [
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
];

const params = {
  optimizer: "greedy",
  serviceTypes: [
    { rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 },
  ],
  residentialTypes: [
    { w: 2, h: 2, min: 100, max: 200, avail: 2 },
    { w: 2, h: 3, min: 140, max: 260, avail: 2 },
  ],
  availableBuildings: {
    services: 1,
    residentials: 2,
  },
  greedy: {
    localSearch: true,
    restarts: 10,
  },
};

const solution = solve(grid, params);

console.log(solution.optimizer);
console.log(solution.totalPopulation);
console.log(solution.cpSatStatus); // only set for CP-SAT
console.log(solution.cpSatObjectivePolicy?.summary); // only set for CP-SAT
console.log(solution.cpSatTelemetry?.bestPopulationUpperBound); // only set for CP-SAT
```

### Run LNS explicitly

```ts
import { solve } from "./dist/index.js";

const solution = solve(grid, {
  ...params,
  optimizer: "lns",
  lns: {
    iterations: 12,
    maxNoImprovementIterations: 4,
    neighborhoodRows: 6,
    neighborhoodCols: 8,
    repairTimeLimitSeconds: 5,
  },
});
```

### Run CP-SAT explicitly

```ts
import { solveAsync } from "./dist/index.js";

const solution = await solveAsync(grid, {
  ...params,
  optimizer: "cp-sat",
  cpSat: {
    timeLimitSeconds: 120,
    noImprovementTimeoutSeconds: 15,
    maxDeterministicTime: 30,
    numWorkers: 8,
    randomSeed: 42,
    randomizeSearch: false,
    relativeGapLimit: 0.01,
    absoluteGapLimit: 10,
    logSearchProgress: false,
  },
});
```

For CP-SAT integrations, prefer `solveAsync(...)` or `solveCpSatAsync(...)`. The synchronous `solve(...)` and `solveCpSat(...)` entrypoints remain available as compatibility surfaces, but the async bridge is the recommended runtime path.

You can also subscribe to live CP-SAT progress while using the async path:

```ts
import { solveAsync } from "./dist/index.js";

const solution = await solveAsync(
  grid,
  {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      timeLimitSeconds: 120,
      numWorkers: 1,
    },
  },
  {
    onProgress(update) {
      if (update.telemetry) {
        console.log(update.kind, update.telemetry.incumbentPopulation, update.telemetry.bestPopulationUpperBound);
      }
    },
    progressIntervalSeconds: 0.5,
  }
);
```

Useful CP-SAT runtime controls include:

- `timeLimitSeconds`
- `maxDeterministicTime`
- `numWorkers`
- `randomSeed`
- `randomizeSearch`
- `relativeGapLimit`
- `absoluteGapLimit`
- `noImprovementTimeoutSeconds`
- `logSearchProgress`

For continuation runs, CP-SAT also supports:

- `warmStartHint`
- `objectiveLowerBound`

`warmStartHint` accepts either:

- a serializable hint object, or
- an existing `Solution`

Example:

```ts
const seed = solve(grid, params);

const continued = await solveAsync(grid, {
  ...params,
  optimizer: "cp-sat",
  cpSat: {
    timeLimitSeconds: 120,
    numWorkers: 1,
    warmStartHint: seed,
    objectiveLowerBound: seed.totalPopulation,
  },
});
```

For single-machine portfolio search, CP-SAT also supports:

- `portfolio.workerCount`
- `portfolio.randomSeeds`
- `portfolio.perWorkerTimeLimitSeconds`
- `portfolio.perWorkerMaxDeterministicTime`
- `portfolio.perWorkerNumWorkers`
- `portfolio.randomizeSearch`

Example:

```ts
const portfolio = await solveAsync(grid, {
  ...params,
  optimizer: "cp-sat",
  cpSat: {
    timeLimitSeconds: 60,
    portfolio: {
      randomSeeds: [3, 11, 17],
      perWorkerTimeLimitSeconds: 20,
      perWorkerNumWorkers: 1,
    },
  },
});
```

### Run the benchmark corpus

The repository includes fixed benchmark corpora for `greedy`, `LNS`, and `CP-SAT`, plus a cross-mode scorecard for equal-budget comparisons. Scorecard rows include seed-policy evidence for `LNS` seed budget/wall time and Auto Greedy seed-stage budget/wall time when those stages run.

Run the greedy suite:

```bash
npm run benchmark:greedy
```

Run one named greedy case and emit JSON:

```bash
npm run benchmark:greedy -- --json cap-sweep-mixed
```

List the available greedy case names:

```bash
npm run benchmark:greedy -- --list
```

Run the LNS suite:

```bash
npm run benchmark:lns
```

Run one named LNS case and emit JSON:

```bash
npm run benchmark:lns -- --json compact-service-repair
```

List the available LNS case names:

```bash
npm run benchmark:lns -- --list
```

The repository also includes a fixed CP-SAT benchmark corpus plus an async benchmark harness for reproducible exact-run comparisons.

Run the default suite:

```bash
npm run benchmark:cp-sat
```

Run one named case and emit JSON:

```bash
npm run benchmark:cp-sat -- --json compact-service-single
```

List the available case names:

```bash
npm run benchmark:cp-sat -- --list
```

Run the cross-mode scorecard:

```bash
npm run benchmark:scorecard
```

Run a named scorecard case with JSON output:

```bash
npm run benchmark:scorecard -- --json compact-service-repair
```

Run the Auto/LNS budget ablation sweep:

```bash
npm run benchmark:scorecard -- --budget-ablation --modes=auto,greedy,lns,cp-sat --budgets=5,30 --seeds=7,19
```

Use the harder ablation coverage corpus when the default cases saturate:

```bash
npm run benchmark:scorecard -- --budget-ablation --coverage-corpus --modes=auto,greedy,lns --budgets=5,30 --seeds=7,19
```

Start with a narrow matrix before adding `120` second probes; corrected LNS budget policies can legitimately consume the requested budget. Ablation summaries report total coverage plus best-score, Auto, and LNS deltas versus the baseline policy so unrelated mode winners do not hide Auto/LNS movement.

Emit policy-scoped decision traces for the same ablation runner:

```bash
npm run benchmark:scorecard -- --budget-ablation --trace-jsonl --ablation-policies=baseline,seed-light --budgets=5 --seeds=7
```

From code:

```ts
import { runCpSatBenchmarkSuite } from "./dist/index.js";

process.env.CITY_BUILDER_CP_SAT_PYTHON ??= ".venv-cp-sat/bin/python";

const result = await runCpSatBenchmarkSuite(undefined, {
  names: ["typed-housing-single", "typed-housing-portfolio"],
  cpSat: {
    timeLimitSeconds: 10,
    maxDeterministicTime: 10,
    numWorkers: 1,
    randomSeed: 7,
    progressIntervalSeconds: 0.5,
  },
});

console.log(result.results[0].cpSatTelemetry?.bestPopulationUpperBound);
console.log(result.results[0].progressTimeline.length);
```

### Validate a solver result

```ts
import { solve, validateSolution } from "./dist/index.js";

const solution = solve(grid, params);
const validation = validateSolution({ grid, solution, params });

console.log(validation.valid);
console.log(validation.errors);
console.log(validation.recomputedTotalPopulation);
```

### Validate and render the map

```ts
import { solve, validateSolutionMap } from "./dist/index.js";

const solution = solve(grid, params);
const validation = validateSolutionMap({ grid, solution, params });

console.log(validation.valid);
console.log(validation.mapText);
```

## Main Exports

The public API is exposed from [src/index.ts](./src/index.ts):

- `solveAsync`
- `solve`
- `solveAuto`
- `startAutoSolve`
- `describeAutoStopReason`
- `solveGreedy`
- `solveCpSatAsync`
- `solveLns`
- `solveCpSat`
- `runGreedyBenchmarkSuite`
- `listGreedyBenchmarkCaseNames`
- `normalizeGreedyBenchmarkOptions`
- `createGreedyBenchmarkSnapshot`
- `formatGreedyBenchmarkSuite`
- `DEFAULT_GREEDY_BENCHMARK_CORPUS`
- `DEFAULT_GREEDY_BENCHMARK_OPTIONS`
- `runCpSatBenchmarkSuite`
- `listCpSatBenchmarkCaseNames`
- `normalizeCpSatBenchmarkOptions`
- `DEFAULT_CP_SAT_BENCHMARK_CORPUS`
- `evaluateLayout`
- `validateSolution`
- `renderSolutionMap`
- `formatSolutionMap`
- `validateSolutionMap`
- `getOptimizerAdapter`
- `listOptimizerAdapters`
- `resolveOptimizerName`

Useful types include:
- `OptimizerName`
- `AutoOptions`
- `AutoSolveStageMetadata`
- `SolverParams`
- `Solution`
- `ServiceTypeSetting`
- `ResidentialTypeSetting`
- `CpSatOptions`
- `CpSatBenchmarkCase`
- `CpSatBenchmarkSuiteResult`
- `CpSatAsyncOptions`
- `CpSatProgressUpdate`
- `CpSatObjectivePolicy`
- `CpSatTelemetry`
- `CpSatPortfolioOptions`
- `CpSatPortfolioSummary`
- `CpSatWarmStartHint`
- `GreedyOptions`
- `LnsOptions`

## Input Notes

### Grid

`Grid` is `number[][]`, where:
- `1` = allowed
- `0` = blocked

### Service types

```ts
type ServiceTypeSetting = {
  rows: number;
  cols: number;
  bonus: number;
  range: number;
  avail: number;
  allowRotation?: boolean;
};
```

### Residential types

```ts
type ResidentialTypeSetting = {
  w: number;
  h: number;
  min: number;
  max: number;
  avail: number;
};
```

### Greedy options

Prefer the nested `greedy` object for new code. When users choose standalone Greedy, the web app and CLI use this heavier inspection profile; `auto` clamps the Greedy stage separately when it only needs a fast seed.

```ts
greedy: {
  localSearch: true,
  profile: false,
  diagnostics: false,
  timeLimitSeconds: 3900,
  densityTieBreaker: false,
  densityTieBreakerTolerancePercent: 2,
  connectivityShadowScoring: false,
  restarts: 20,
  serviceRefineIterations: 4,
  serviceRefineCandidateLimit: 60,
  exhaustiveServiceSearch: true,
  serviceExactPoolLimit: 22,
  serviceExactMaxCombinations: 12000,
}
```

Set `greedy.diagnostics: true` to include `solution.greedyDiagnostics`, a bounded post-solve report that scans final unplaced candidates and groups "why not placed?" examples by blocked footprint, missing road path, no service coverage / base-only residential population, availability caps, and lower-score/no-improvement outcomes.

When `greedy.profile` is enabled, Greedy counters include `roads.connectivityShadow*` fields. These measure how many row-0-reachable empty cells each committed building footprint removes, separating cells consumed by the footprint from downstream cells disconnected by that placement. The benchmark formatter prints this as `connectivity-shadow=...`.

Set `greedy.connectivityShadowScoring: true` to use that signal as an opt-in placement tie-breaker: when normal Greedy scores tie, candidates that disconnect fewer future row-0-reachable cells are preferred. The default is `false`, so profiling alone does not change placement choices.

Set `greedy.densityTieBreaker: true` to prefer more central high-value placements when Greedy scores are within `greedy.densityTieBreakerTolerancePercent` of each other. The web planner exposes this only for standalone Greedy; Auto keeps its fixed Greedy seed-stage ranking policy.

### Auto options

All `auto` fields are optional. Omit `auto` or pass `{}` to use runtime defaults.

```ts
auto: {
  wallClockLimitSeconds?: number;
  randomSeed?: number;
  weakCycleImprovementThreshold?: number;
  maxConsecutiveWeakCycles?: number;
  cpSatStageTimeLimitSeconds?: number;
  cpSatStageReserveRatio?: number;
  cpSatStageNoImprovementTimeoutSeconds?: number;
}
```

### LNS options

```ts
lns: {
  iterations: 12,
  maxNoImprovementIterations: 4,
  neighborhoodRows: 6,
  neighborhoodCols: 8,
  seedTimeLimitSeconds: 2,
  repairTimeLimitSeconds: 5,
}
```

### CP-SAT options

```ts
cpSat: {
  timeLimitSeconds?: number;
  numWorkers?: number;
  logSearchProgress?: boolean;
  randomSeed?: number;
  randomizeSearch?: boolean;
  warmStartHint?: CpSatWarmStartHint;
}
```

## Output Shape

A `Solution` contains:
- `optimizer`
- `activeOptimizer`
- `autoStage`
- `autoStage.greedySeedStage`, when `auto` has run its Greedy seed stage, reports the applied Greedy caps plus seed population, elapsed seconds, and phase timings when profiling is available
- `cpSatStatus`
- `cpSatObjectivePolicy`
- `cpSatTelemetry`
- `cpSatPortfolio`
- `greedyProfile`, when Greedy profiling was enabled directly or by a seed stage
- `greedyDiagnostics`, when `greedy.diagnostics` was enabled for a standalone Greedy run
- `lnsTelemetry`, including `seedTimeLimitSeconds` and `seedWallClockSeconds`
- `stoppedByUser`
- `roads: Set<string>`
- `services`
- `serviceTypeIndices`
- `servicePopulationIncreases`
- `residentials`
- `residentialTypeIndices`
- `populations`
- `totalPopulation`

Road cells are encoded as `"r,c"` strings inside the `Set`.

## Project Layout

- [src/index.ts](./src/index.ts): public API
- [src/runtime/solve.ts](./src/runtime/solve.ts): top-level solver dispatch
- [src/runtime/optimizerRegistry.ts](./src/runtime/optimizerRegistry.ts): optimizer registry
- [src/auto/solver.ts](./src/auto/solver.ts): staged `auto` orchestration
- [src/greedy/solver.ts](./src/greedy/solver.ts): greedy solver
- [src/lns/solver.ts](./src/lns/solver.ts): LNS solver
- [src/cp-sat/solver.ts](./src/cp-sat/solver.ts): TypeScript bridge for CP-SAT
- [python/cp_sat_solver.py](./python/cp_sat_solver.py): OR-Tools CP-SAT model
- [src/greedy/row0Anchors.ts](./src/greedy/row0Anchors.ts): greedy row-0 feasibility and anchor refinement helpers
- [src/runtime/jobs/solveJobManager.ts](./src/runtime/jobs/solveJobManager.ts): background solve job lifecycle
- [src/server/http/requestHandler.ts](./src/server/http/requestHandler.ts): planner request composition
- [src/server/http/routes.ts](./src/server/http/routes.ts): planner API route handlers
- [src/server/http/contracts.ts](./src/server/http/contracts.ts): shared HTTP payload contracts
- [src/server/http/static.ts](./src/server/http/static.ts): local planner static asset serving
- [src/benchmarks/greedy.ts](./src/benchmarks/greedy.ts): fixed greedy benchmark corpus and harness
- [src/benchmarks/cpSat.ts](./src/benchmarks/cpSat.ts): fixed CP-SAT benchmark corpus and harness
- [web/](./web): planner UI modules
- [src/core/evaluator.ts](./src/core/evaluator.ts): validation and exact scoring
- [src/core/map.ts](./src/core/map.ts): ASCII rendering and map-aware validation
- [tests/](./tests): regression, route, and optimizer tests

## Notes

- `CP-SAT` requires a working Python runtime plus OR-Tools.
- If you omit `cpSat.timeLimitSeconds`, the CP-SAT backend runs until it finishes or is stopped.
- If you omit `auto.wallClockLimitSeconds`, the outer `auto` policy has no global cap.
- If you omit `params.optimizer`, runtime dispatch resolves it to `auto`.
- `auto` generates per-stage seeds; use `solution.autoStage.generatedSeeds` to inspect the actual Greedy, LNS, and CP-SAT stage seeds.
- In the web planner, stopping `CP-SAT` or `LNS` early preserves the best feasible result found so far when one exists.
- In the web planner, stopping `auto` preserves the best incumbent found so far.
- `LNS` currently uses CP-SAT as the neighborhood repair engine.
- The example CLI prints validation output and an ASCII map for quick inspection.
