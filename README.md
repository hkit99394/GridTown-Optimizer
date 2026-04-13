# City Builder

Optimize a city layout on a 2D grid by placing roads, service buildings, and residential buildings to maximize total population.

This project includes:

- a greedy heuristic solver with local search
- a CP-SAT solver backed by Google OR-Tools
- strict validators for layouts and solver output
- an ASCII map renderer for quick inspection

The formal problem statement lives in [SPEC.md](./SPEC.md). A shorter product-level summary lives in [Requirement.md](./Requirement.md). The current heuristic design is described in [ALGORITHM.md](./ALGORITHM.md).

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

Service buildings are rectangular and type-driven.

Each service type defines:

- `rows`
- `cols`
- `bonus`
- `range`
- `avail`
- optional `allowRotation`

Examples:

- `2x2`
- `2x3`
- `2x4`
- `3x3`
- more generally any rectangular `n x m` footprint that fits on allowed cells

### Residential buildings

Residential buildings are rectangular and type-driven.

Examples:

- `2x2`
- `2x3`
- `3x3`
- `3x4`
- more generally any rectangular `n x m` footprint that fits on allowed cells

You can configure them in two ways:

- preferred: `residentialTypes`
- compatibility fallback: `residentialSettings` plus optional `basePop` / `maxPop`

## Solvers

### `greedy`

The greedy solver is the default backend.

It uses:

- service candidate ranking
- constructive placement
- optional restarts
- local improvement
- optional bounded exhaustive search over top service layouts

Use this when you want fast iteration and good practical solutions.

### `cp-sat`

The CP-SAT solver is an exact optimization backend using OR-Tools.

In practice it may return either:

- `OPTIMAL`: best solution found and proven optimal
- `FEASIBLE`: good solution found within the time limit, but not proven optimal

Use this when you want a stronger search or proof of optimality on smaller instances.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run the example

Greedy:

```bash
npm run solve:greedy
```

CP-SAT:

```bash
npm run setup:cp-sat
npm run solve:cp-sat
```

### 4. Run tests

```bash
npm test
```

## CLI Commands

Available scripts from [package.json](./package.json):

- `npm run build`
- `npm run solve`
- `npm run solve:greedy`
- `npm run solve:cp-sat`
- `npm run setup:cp-sat`
- `npm test`

`npm run solve` currently runs the built-in example with the default greedy backend.

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

### Run CP-SAT explicitly

```ts
import { solveAsync } from "./dist/index.js";

const solution = await solveAsync(grid, {
  ...params,
  optimizer: "cp-sat",
  cpSat: {
    timeLimitSeconds: 120,
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

Top-level greedy tuning fields still exist for backward compatibility, but the nested `greedy` form is the cleaner API.

## Output Shape

A `Solution` contains:

- `optimizer`
- `cpSatStatus`
- `cpSatObjectivePolicy`
- `cpSatTelemetry`
- `cpSatPortfolio`
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
- [src/cli.ts](./src/cli.ts): example runner
- [src/solver.ts](./src/solver.ts): greedy solver
- [src/cpSatSolver.ts](./src/cpSatSolver.ts): TypeScript bridge for CP-SAT
- [python/cp_sat_solver.py](./python/cp_sat_solver.py): OR-Tools CP-SAT model
- [src/evaluator.ts](./src/evaluator.ts): validation and exact scoring
- [src/map.ts](./src/map.ts): ASCII rendering and map-aware validation
- [tests/](./tests): regression and optimizer tests

## Notes

- The greedy solver can outperform a time-limited CP-SAT run if CP-SAT returns only `FEASIBLE` rather than `OPTIMAL`.
- CP-SAT requires a working Python runtime plus OR-Tools.
- The example CLI prints a validation result and an ASCII map so you can quickly inspect solver output.
