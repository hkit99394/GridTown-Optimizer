# City Builder

Optimize a city layout on a 2D grid by placing roads, service buildings, and residential buildings to maximize total population.

This project now includes:

- an `auto` staged solver that runs `greedy -> LNS -> bounded CP-SAT`
- a `greedy` heuristic solver with restarts and local search
- an `LNS` solver that improves a seed layout with neighborhood CP-SAT repair
- a `CP-SAT` solver backed by Google OR-Tools
- strict validators and exact layout scoring
- a local web planner with saved layouts, map inspection, planner explainability maps, and manual editing

Core reference docs:

- [SPEC.md](./docs/requirements/SPEC.md): formal problem statement
- [Requirement.md](./docs/requirements/Requirement.md): product-level summary
- [ALGORITHM.md](./docs/design/ALGORITHM.md): heuristic design notes
- [LEARNED_GUIDANCE_ROADMAP.md](./docs/roadmaps/LEARNED_GUIDANCE_ROADMAP.md): roadmap for ML / RL-style learned guidance over the current solver stack
- [PLANNER_ARCHITECTURE.md](./docs/design/PLANNER_ARCHITECTURE.md): current planner app/backend module boundaries
- [SOLVER_ROADMAP.md](./docs/roadmaps/SOLVER_ROADMAP.md): overall solver roadmap
- [SOLVER_ABLATION_DECISIONS.md](./docs/decisions/SOLVER_ABLATION_DECISIONS.md): deterministic ablation gate decisions before model training
- [CP_SAT_ROADMAP.md](./docs/roadmaps/CP_SAT_ROADMAP.md): CP-SAT-specific roadmap

## Problem Summary

The input is a grid of `0` and `1` values:

- `1` means the cell is allowed
- `0` means the cell is blocked

The solver must place:

- roads on allowed cells
- service buildings on allowed rectangular footprints
- residential buildings on allowed rectangular footprints

Subject to these core rules:

- every road component must touch row `0` or column `0`
- every building must connect to a row-0-or-column-0-connected road component
- buildings touching row `0` or column `0` are treated as road-connected automatically
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

The example CP-SAT command is bounded for local use: by default it runs with a 30 second wall-clock cap, a 15 second no-improvement stop, and 8 CP-SAT workers. Override with `-- --cp-sat-time-limit=60`, `-- --cp-sat-no-improvement-timeout=20`, or `-- --cp-sat-workers=4`.

### 5. Run tests

```bash
npm test
```

## Quality Gates

The default test gate includes the TypeScript build, Prettier formatting check, ESLint for browser/test JavaScript, code-hygiene checks, file-size budget checks, route/API tests, and optimizer regression suites:

```bash
npm test
```

For the broader release-quality gate, run:

```bash
npm run quality
```

That adds the experiment registry check and a high-severity npm dependency audit. The audit contacts the npm registry.

## CLI Commands

Available scripts from [package.json](./package.json):

- `npm run build`
- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run quality`
- `npm run security:audit`
- `npm run web`
- `npm run web:awake`
- `npm run solve`
- `npm run solve:auto`
- `npm run solve:greedy`
- `npm run solve:lns`
- `npm run solve:cp-sat`
- `npm run benchmark:greedy`
- `npm run benchmark:lns`
- `npm run benchmark:cp-sat`
- `npm run benchmark:labels`
- `npm run benchmark:greedy-ranker`
- `npm run benchmark:lns-ranker`
- `npm run benchmark:lns-window-ranker`
- `npm run benchmark:scorecard`
- `npm run experiment-registry`
- `npm run experiment-registry:check`
- `npm run setup:cp-sat`
- `npm run test:acceptance`
- `npm test`

`npm run solve` currently runs the built-in example with the default `auto` backend in the example CLI.

## Web Planner

Start the planner with:

```bash
npm run web
```

Then open [http://localhost:4173](http://localhost:4173).

For long solver runs on macOS, prefer:

```bash
npm run web:awake
```

That runs the same local server under `caffeinate` so the backend solver and progress log keep running while the screen is locked. The browser UI may stop polling while locked, but the server-side solve continues and writes progress under `artifacts/solve-progress/`.

The planner now includes:

- an interactive grid editor
- service and residential catalog editing
- collapsible catalog import
- solver-specific control panels for `auto`, `greedy`, `LNS`, and `CP-SAT`
- standalone Greedy diagnostics with a collapsible "why not placed?" result report
- saved input setups
- saved solved layouts
- automatic `LNS` seeding and `CP-SAT` hinting from the displayed output when the displayed layout is validated and model-compatible
- result review with validation, placements, remaining availability, solved map overlays, and planner explainability maps for service value, placement opportunity, and connectivity risk
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
- background solve progress is polled every 2 seconds by default and compacted into unchanged 10 second segments in the persisted log
- tune progress logging with `PROGRESS_LOG_POLL_INTERVAL_SECONDS` and `PROGRESS_LOG_INTERVAL_SECONDS`, for example `PROGRESS_LOG_POLL_INTERVAL_SECONDS=1 PROGRESS_LOG_INTERVAL_SECONDS=5 npm run web:awake`
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
  [1, 1, 1, 1, 1, 1]
];

const params = {
  optimizer: "greedy",
  serviceTypes: [{ rows: 2, cols: 3, bonus: 50, range: 1, avail: 1 }],
  residentialTypes: [
    { w: 2, h: 2, min: 100, max: 200, avail: 2 },
    { w: 2, h: 3, min: 140, max: 260, avail: 2 }
  ],
  availableBuildings: {
    services: 1,
    residentials: 2
  },
  greedy: {
    localSearch: true,
    restarts: 10
  }
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
    repairTimeLimitSeconds: 5
  }
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
    logSearchProgress: false
  }
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
      numWorkers: 1
    }
  },
  {
    onProgress(update) {
      if (update.telemetry) {
        console.log(update.kind, update.telemetry.incumbentPopulation, update.telemetry.bestPopulationUpperBound);
      }
    },
    progressIntervalSeconds: 0.5
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
    objectiveLowerBound: seed.totalPopulation
  }
});
```

For single-machine portfolio search, CP-SAT also supports:

- `portfolio.workerCount`
- `portfolio.randomSeeds`
- `portfolio.perWorkerTimeLimitSeconds`
- `portfolio.perWorkerMaxDeterministicTime`
- `portfolio.perWorkerNumWorkers`
- `portfolio.randomizeSearch`

Portfolio search is explicit-only. Each worker now reports its own CP-SAT telemetry, and portfolio worker search logging is suppressed internally so a requested `logSearchProgress` run still returns parseable JSON. Keep portfolio experiments behind CPU-normalized scorecards; do not treat a wall-clock tie as a win when it spends extra worker CPU budget.

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
      perWorkerNumWorkers: 1
    }
  }
});
```

### Run the benchmark corpus

The repository includes fixed benchmark corpora for `greedy`, `LNS`, and `CP-SAT`, plus a cross-mode scorecard for equal-budget comparisons. Scorecard rows include seed-policy evidence for `LNS` seed budget/wall time and Auto Greedy seed-stage budget/wall time when those stages run. CP-SAT portfolio rows also report worker CPU budget and observed worker CPU time so portfolio gains can be judged against CPU cost.

Run the greedy suite:

```bash
npm run benchmark:greedy
```

Run one named greedy case and emit JSON:

```bash
npm run benchmark:greedy -- --json cap-sweep-mixed
```

Compare the default-off connectivity-shadow tie-breaker with profiling disabled for cleaner wall-clock readings, or enable profiling on a focused diagnostic slice:

```bash
npm run benchmark:greedy -- --connectivity-shadow-ablation --no-profile
npm run benchmark:greedy -- --connectivity-shadow-ablation --profile service-local-neighborhood geometry-occupancy-hot-path
```

Run the deterministic Greedy ordering/phase ablation matrix before trying learned ranking:

```bash
npm run benchmark:greedy -- --deterministic-ablation --no-profile
npm run benchmark:greedy -- --ordering-ablation --ablation-variants=baseline,no-service-neighborhood,connectivity-shadow-scoring service-local-neighborhood
npm run benchmark:greedy -- --deterministic-ablation --seeds=7,19 --ablation-variants=baseline,no-local-search service-local-neighborhood
npm run benchmark:greedy -- --deterministic-ablation --gate-report --json --ablation-variants=baseline,no-local-search service-local-neighborhood
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

Run the deterministic LNS neighborhood-anchor/window ablation matrix:

```bash
npm run benchmark:lns -- --neighborhood-ablation
npm run benchmark:lns -- --neighborhood-ablation --ablation-variants=baseline,sliding-only,small-2x2 compact-service-repair
npm run benchmark:lns -- --neighborhood-ablation --ablation-variants=baseline,sliding-only,weak-service-first seeded-service-anchor-pressure
npm run benchmark:lns -- --neighborhood-ablation --seeds=7,19 --ablation-variants=baseline,sliding-only compact-service-repair
npm run benchmark:lns -- --neighborhood-ablation --gate-report --json --ablation-variants=baseline,sliding-only,weak-service-first seeded-service-anchor-pressure
```

When `--seeds` is provided, each Greedy or LNS ablation case is repeated once per seed; baseline and variants within a case/seed comparison receive the same unique integer seed in the solver-supported `0..2147483647` range.
Repeated-seed ablation summaries include stability-gate fields: win/regression/unchanged rates, best/worst population-delta case and seed labels, and for LNS the number/rate of variants whose first repair window, full window sequence, or anchor-coordinate sequence moved from the matched baseline.
Ablation `--json` output uses snapshot-friendly artifacts that omit generated timestamps and volatile wall-clock fields.
`--gate-report` turns the matrix into a stable promote/keep-baseline/learning-target/blocked-regression report and defaults to seeds `7,19,37` when no `--seeds` list is provided.
LNS repeated-seed ablations rotate variant execution order by default to reduce wall-time order bias; use `--no-rotate-variant-run-order` for fixed execution order.

Collect bounded counterfactual LNS window replay labels before learned window re-ranking:

```bash
npm run benchmark:lns -- --window-replay-labels --json --seeds=7 --max-windows=4 --repair-time=0.25 seeded-service-anchor-pressure
```

Window replay labels evaluate multiple candidate repair windows from the same incumbent with an equal CP-SAT repair budget and emit stable JSON snapshots with per-window signed population deltas, usability flags, validation results, and deterministic features.

Build the low-risk learned-ranking label bundle with protected development/holdout splits before any model training:

```bash
npm run benchmark:labels
npm run benchmark:labels -- --json --seeds=7,19,37 --max-windows=8 --repair-time=1
npm run benchmark:labels -- --artifact-dir=artifacts/learned-ranking-labels/2026-05-01/bundle --label-run-id=learned-ranking-labels-2026-05-01 --label-register-dry-run --seeds=7,19,37 --max-windows=8 --repair-time=1 --json
```

The combined label bundle includes Greedy connectivity-shadow ordering labels, Greedy road-opportunity near-miss labels, split-aware LNS replay labels, schema/audit metadata, and leakage checks. `--artifact-dir` writes `labels.json`, `labels.txt`, `telemetry-manifest.json`, and `registry-entry-draft.json`; artifact bundle directories must be under `artifacts/` and non-empty directories require explicit `--force-artifact-dir`. `--label-register-dry-run` completes and validates strict label-bundle registry metadata without appending. It does not train a model or change solver defaults.

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

When `cp-sat` and `cp-sat-portfolio` are both present, the scorecard includes portfolio efficiency signals. A portfolio run is only a promotion candidate when it improves population per wall-clock without losing CPU-budget efficiency versus single CP-SAT.

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

Use the product-shaped workflow corpus when collecting evidence for promotion or regression decisions. This corpus keeps development and holdout cases explicit and tags planner-shaped workflows such as manual-layout replay, expansion comparison, corridor/gate pressure, service pressure, anchor-service, and multi-anchor road components:

```bash
npm run benchmark:scorecard -- --product-corpus --list
npm run benchmark:scorecard -- --product-corpus --modes=auto,greedy,lns,cp-sat --budgets=1,5,30 --seeds=7,19 --json
```

Persist ordinary cross-mode scorecard artifacts, including a telemetry manifest, without product registry metadata:

```bash
npm run benchmark:scorecard -- --artifact-dir=artifacts/cross-mode/2026-05-01/smoke --modes=auto,greedy --budgets=1 --seeds=7 typed-housing-single
```

Use the promotion-matrix preset for the long product-corpus evidence run:

```bash
npm run benchmark:scorecard -- --product-corpus --product-promotion-matrix --product-artifact-dir=artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37 --product-run-id=product-corpus-scorecard-2026-04-30-promotion-1s-5s-30s-120s-seeds7-19-37 --product-register-dry-run --json
```

Write product-corpus artifacts and a registry-entry draft in one repeatable run:

```bash
npm run benchmark:scorecard -- --product-corpus --product-artifact-dir=artifacts/product-corpus/2026-04-30 --product-run-id=product-corpus-scorecard-2026-04-30 --modes=auto,greedy,lns,cp-sat --budgets=1,5 --seeds=7 --json
```

Validate the completed registry entry first without writing, then append it only after the artifact bundle is committed or otherwise checkpointed:

```bash
npm run benchmark:scorecard -- --product-corpus --product-artifact-dir=artifacts/product-corpus/2026-04-30 --product-run-id=product-corpus-scorecard-2026-04-30 --product-register-dry-run --modes=auto,greedy,lns,cp-sat --budgets=1,5 --seeds=7 --json
npm run experiment-registry -- append --entry=artifacts/product-corpus/2026-04-30/registry-entry-draft.json
```

`--artifact-dir` emits `scorecard.json`, `scorecard.txt`, and `telemetry-manifest.json` for ordinary scorecards. Artifact bundle directories must be under `artifacts/`; existing non-empty directories are refused unless the command includes `--force-artifact-dir`. The product artifact writer emits those files plus `evidence-summary.json`, `workflow-replay.json`, `workflow-replay-telemetry-manifest.json`, and `registry-entry-draft.json`. The telemetry manifests record the exact command, git commit/branch, captured hardware, per-run solver parameter summaries, wall/CPU timing, first-feasible and best-score timing, status/gap fields, candidate counts where available, CP-SAT model size where available, per-stage Auto/Greedy/LNS/CP-SAT records, and product workflow replay validity through `/api/layout/evaluate`. Model experiments should use the exported `buildModelExperimentTelemetryManifest` and `buildModelExperimentRegistryEntryDraft` helpers; current scripts do not train a model or change solver defaults. `--product-register-dry-run` completes that draft with git and hardware metadata and validates it with strict registry checks without appending; use `--product-registry=<path>` to target a temporary registry for validation. Direct `--product-register` append is blocked because generated artifacts cannot be honestly stamped with a commit until the artifact bundle has been checkpointed. `--product-promotion-matrix` expands to modes `auto,greedy,lns,cp-sat`, budgets `1,5,30,120`, and seeds `7,19,37`; it rejects explicit `--modes`, `--budget`, `--budgets`, or `--seeds` overrides. Register product-corpus artifacts with split-aware `cases` metadata, workflow-tag `caseFamilies`, per-case evidence metrics, replay metrics, and telemetry manifests so later checks can distinguish development tuning from protected holdout evidence. `protectedHoldout` is only true for the full promotion matrix: all 10 product-corpus cases with their expected development/holdout split, `auto`, `greedy`, `lns`, and `cp-sat`, budgets `1,5,30,120`, the exact seed set `7,19,37`, complete scorecard matrix coverage, and required modes inside every required scorecard.

```json
{
  "cases": {
    "development": ["manual-layout-replay-warm-start"],
    "holdout": ["expansion-comparison-replay"]
  },
  "caseFamilies": ["manual-layout-replay", "expansion-comparison"],
  "splitStatus": {
    "protectedHoldout": false,
    "notes": "Partial product workflow corpus scorecard; not protected holdout promotion evidence."
  }
}
```

Start with a narrow matrix before adding `120` second probes; corrected LNS budget policies can legitimately consume the requested budget. Ablation summaries report total coverage plus best-score, Auto, and LNS deltas versus the baseline policy so unrelated mode winners do not hide Auto/LNS movement.

Emit policy-scoped decision traces for the same ablation runner:

```bash
npm run benchmark:scorecard -- --budget-ablation --trace-jsonl --ablation-policies=baseline,seed-light --budgets=5 --seeds=7
```

From code:

```ts
import { runCpSatBenchmarkSuite } from "./dist/benchmarkApi.js";

process.env.CITY_BUILDER_CP_SAT_PYTHON ??= ".venv-cp-sat/bin/python";

const result = await runCpSatBenchmarkSuite(undefined, {
  names: ["typed-housing-single", "typed-housing-portfolio"],
  cpSat: {
    timeLimitSeconds: 10,
    maxDeterministicTime: 10,
    numWorkers: 1,
    randomSeed: 7,
    progressIntervalSeconds: 0.5
  }
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

## Selected Public Exports

The default public API is exposed from [src/index.ts](./src/index.ts). Benchmark,
label, and experiment-registry tooling is exposed separately from
[src/benchmarkApi.ts](./src/benchmarkApi.ts) through the `city-builder/benchmarks`
package subpath.
Benchmark-only functions and types such as `runCpSatBenchmarkSuite`,
`CpSatBenchmarkCase`, and `CpSatBenchmarkSuiteResult` are available from
`./dist/benchmarkApi.js` or `city-builder/benchmarks`.

- `solveAsync`
- `solve`
- `solveAuto`
- `startAutoSolve`
- `describeAutoStopReason`
- `solveGreedy`
- `solveCpSatAsync`
- `startCpSatSolve`
- `solveLns`
- `solveCpSat`
- `evaluateLayout`
- `validateLayoutConstraints`
- `assertValidLayout`
- `assertValidLayoutConstraints`
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

When `greedy.profile` is enabled, Greedy counters include `roads.connectivityShadow*` fields. These measure how many anchor-reachable empty cells each committed building footprint removes, separating cells consumed by the footprint from downstream cells disconnected by that placement. Profile output also includes bounded connectivity-shadow tie-break samples showing the candidate, incumbent, chosen placement, rejected placement, road cost, and shadow penalty. The benchmark formatter prints this as `connectivity-shadow=...` and `connectivity-shadow-scoring=...`.

The same profile includes `roads.roadOpportunity*` counters and bounded `roadOpportunityTraces` for accepted constructive service/residential placements plus accepted residential local-search and service-neighborhood moves. These traces pair the accepted placement's road cost with anchor-reachable frontier before/after counts, total lost cells, footprint cells, and downstream disconnected cells. Constructive and local-search traces can include bounded near-miss counterfactuals showing rejected candidates with their score, road-cost delta, move kind, and frontier loss. The benchmark formatter prints this as `road-opportunity=...` plus sample `road-opportunity-placement=...` and `road-opportunity-counterfactual=...` rows.

Set `greedy.connectivityShadowScoring: true` to use that signal as an opt-in placement tie-breaker: when normal Greedy scores tie inside a bounded cheap-road window, candidates that disconnect fewer future anchor-reachable cells are preferred. The option keeps the normal Greedy result when the shadow-scored result does not beat it on population and road count. The default is `false`, so profiling alone does not change placement choices.

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
Every explicit road component must contain at least one row-0-or-column-0 road cell.

## Project Layout

- [src/index.ts](./src/index.ts): public API
- [src/packages/runtime/dispatch/solve.ts](./src/packages/runtime/dispatch/solve.ts): top-level solver dispatch
- [src/packages/runtime/dispatch/optimizerRegistry.ts](./src/packages/runtime/dispatch/optimizerRegistry.ts): optimizer registry
- [src/packages/solvers/auto/solver.ts](./src/packages/solvers/auto/solver.ts): staged `auto` orchestration
- [src/packages/solvers/auto/stagePolicy.ts](./src/packages/solvers/auto/stagePolicy.ts): `auto` stage budgets and policy defaults
- [src/packages/solvers/auto/terminal.ts](./src/packages/solvers/auto/terminal.ts): `auto` terminal recovery metadata
- [src/packages/solvers/greedy/solver.ts](./src/packages/solvers/greedy/solver.ts): greedy solver
- [src/packages/solvers/lns/solver.ts](./src/packages/solvers/lns/solver.ts): LNS solver
- [src/packages/solvers/cp-sat/solver.ts](./src/packages/solvers/cp-sat/solver.ts): TypeScript bridge for CP-SAT
- [python/cp_sat_solver.py](./python/cp_sat_solver.py): OR-Tools CP-SAT model
- [src/packages/solvers/greedy/roadAnchors.ts](./src/packages/solvers/greedy/roadAnchors.ts): greedy road-anchor feasibility and refinement helpers
- [src/packages/runtime/jobs/solveJobManager.ts](./src/packages/runtime/jobs/solveJobManager.ts): background solve job lifecycle
- [src/apps/planner-server/http/requestHandler.ts](./src/apps/planner-server/http/requestHandler.ts): planner request composition
- [src/apps/planner-server/http/routes.ts](./src/apps/planner-server/http/routes.ts): planner API route handlers
- [src/apps/planner-server/http/contracts.ts](./src/apps/planner-server/http/contracts.ts): shared HTTP payload contracts
- [src/apps/planner-server/http/solutionResponse.ts](./src/apps/planner-server/http/solutionResponse.ts): solve and manual-layout HTTP response shaping
- [src/apps/planner-server/http/static.ts](./src/apps/planner-server/http/static.ts): local planner static asset serving
- [src/packages/benchmarks/greedy.ts](./src/packages/benchmarks/greedy.ts): fixed greedy benchmark corpus and harness
- [src/packages/benchmarks/cpSat.ts](./src/packages/benchmarks/cpSat.ts): fixed CP-SAT benchmark corpus and harness
- [apps/planner-web/](./apps/planner-web): planner UI modules
- [src/packages/core/evaluator.ts](./src/packages/core/evaluator.ts): validation and exact scoring
- [src/packages/core/map.ts](./src/packages/core/map.ts): ASCII rendering and map-aware validation
- [tests/](./tests): regression, route, and optimizer tests

## Notes

- `CP-SAT` requires a working Python runtime plus OR-Tools.
- If you omit `cpSat.timeLimitSeconds`, the CP-SAT backend runs until it finishes or is stopped.
- The `npm run solve:cp-sat` example supplies bounded CP-SAT defaults so local smoke runs return a feasible best-effort result instead of running indefinitely.
- If you omit `auto.wallClockLimitSeconds`, the outer `auto` policy has no global cap.
- If you omit `params.optimizer`, runtime dispatch resolves it to `auto`.
- `auto` generates per-stage seeds; use `solution.autoStage.generatedSeeds` to inspect the actual Greedy, LNS, and CP-SAT stage seeds.
- In the web planner, stopping `CP-SAT` or `LNS` early preserves the best feasible result found so far when one exists.
- In the web planner, stopping `auto` preserves the best incumbent found so far.
- For long web-planner runs on macOS, use `npm run web:awake` so macOS does not sleep the backend solver when the screen locks.
- `LNS` currently uses CP-SAT as the neighborhood repair engine.
- The example CLI prints validation output and an ASCII map for quick inspection.
