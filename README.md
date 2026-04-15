# City Builder

Optimize a city layout on a 2D grid by placing roads, service buildings, and residential buildings to maximize total population.

This project now includes:
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
- roads must form one connected network
- the road network must touch row `0`
- every building must connect to the road network
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

### `greedy`

The greedy solver is the default heuristic backend.

It uses:
- service candidate ranking
- constructive placement
- optional restarts
- local improvement
- optional bounded exhaustive search over top service layouts

Use this when you want fast iteration and a strong incumbent quickly.

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
- `npm run solve:greedy`
- `npm run solve:lns`
- `npm run solve:cp-sat`
- `npm run setup:cp-sat`
- `npm test`

`npm run solve` currently runs the built-in example with the default greedy backend.

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
- solver-specific control panels for `greedy`, `LNS`, and `CP-SAT`
- saved input setups
- saved solved layouts
- automatic `LNS` seeding and `CP-SAT` hinting from the displayed output
- result review with validation, placements, remaining availability, and solved map overlays
- manual layout editing on the solved map:
  - add remaining buildings
  - move buildings
  - remove buildings
  - add or remove roads
- expansion comparison tooling for proposed next service or residential additions

Notes:
- `LNS` and `CP-SAT` need the Python OR-Tools backend
- stopping a background solve preserves the best feasible result when one exists
- the displayed output can be reused as the default seed or hint when the current model fingerprint still matches

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

The repository now includes a fixed CP-SAT benchmark corpus plus an async benchmark harness for reproducible exact-run comparisons.

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

From code:

```ts
import { runCpSatBenchmarkSuite } from "./dist/index.js";

const result = await runCpSatBenchmarkSuite(undefined, {
  names: ["typed-housing-single", "typed-housing-portfolio"],
  cpSat: {
    pythonExecutable: ".venv-cp-sat/bin/python",
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
- `solveGreedy`
- `solveCpSatAsync`
- `solveLns`
- `solveCpSat`
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

Prefer the nested `greedy` object for new code:

```ts
greedy: {
  localSearch: true,
  restarts: 20,
  serviceRefineIterations: 4,
  serviceRefineCandidateLimit: 60,
  exhaustiveServiceSearch: true,
  serviceExactPoolLimit: 22,
  serviceExactMaxCombinations: 12000,
}
```

### LNS options

```ts
lns: {
  iterations: 12,
  maxNoImprovementIterations: 4,
  neighborhoodRows: 6,
  neighborhoodCols: 8,
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
- `cpSatStatus`
- `cpSatObjectivePolicy`
- `cpSatTelemetry`
- `cpSatPortfolio`
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
- [src/solve.ts](./src/solve.ts): top-level solver dispatch
- [src/optimizerRegistry.ts](./src/optimizerRegistry.ts): optimizer registry
- [src/solver.ts](./src/solver.ts): greedy solver
- [src/lnsSolver.ts](./src/lnsSolver.ts): LNS solver
- [src/cpSatSolver.ts](./src/cpSatSolver.ts): TypeScript bridge for CP-SAT
- [python/cp_sat_solver.py](./python/cp_sat_solver.py): OR-Tools CP-SAT model
- [src/solveJobManager.ts](./src/solveJobManager.ts): background solve job lifecycle
- [src/webServerRequestHandler.ts](./src/webServerRequestHandler.ts): web planner request handling
- [web/](./web): planner UI modules
- [src/evaluator.ts](./src/evaluator.ts): validation and exact scoring
- [src/map.ts](./src/map.ts): ASCII rendering and map-aware validation
- [tests/](./tests): regression, route, and optimizer tests

## Notes

- `CP-SAT` requires a working Python runtime plus OR-Tools.
- If you omit `cpSat.timeLimitSeconds`, the CP-SAT backend runs until it finishes or is stopped.
- In the web planner, stopping `CP-SAT` or `LNS` early preserves the best feasible result found so far when one exists.
- `LNS` currently uses CP-SAT as the neighborhood repair engine.
- The example CLI prints validation output and an ASCII map for quick inspection.
