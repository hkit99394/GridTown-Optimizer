# City Builder

City Builder is a TypeScript solver and local web planner for maximizing feasible population on a 2D city grid. It places roads, service buildings, and residential buildings while preserving exact validation of every reported layout.

The default path is `auto`: a staged solver that builds a fast Greedy incumbent, improves it with LNS, and uses bounded CP-SAT passes for repair, polish, proof, and semantic checks when the backend is available.

## Features

- Local web planner for grid/catalog input, sample presets, validated solve results, saved layouts, manual layout edits, explainability maps, and expansion comparison.
- Four solver modes: `auto`, `greedy`, `lns`, and `cp-sat`.
- Exact solution validation for allowed cells, road-anchor connectivity, building access, overlap, availability, service effects, and total population.
- Background solve status, progress snapshots, cancellation, and best-incumbent recovery.
- Benchmark, evidence, artifact-registry, and product-corpus tooling for gated solver changes.

## Problem Model

The input grid is a `number[][]`:

- `1` means the cell is allowed.
- `0` means the cell is blocked.

A feasible solution places roads, services, and residential buildings so that:

- every road component touches a road anchor;
- when `fixedRoads` is omitted, row `0` and column `0` are the legacy road anchors;
- when `fixedRoads` is provided, those cells are the only road anchors, and `fixedRoads: []` means no starting anchor so the optimizer returns a zero-population/no-building solution;
- every building is adjacent to an anchored road component, or touches the legacy road-anchor boundary when `fixedRoads` is omitted;
- buildings and roads occupy only allowed cells;
- buildings do not overlap each other or roads;
- service effects increase residential population up to each residential type's max.

The objective is to maximize total residential population. See the formal model in [docs/requirements/SPEC.md](./docs/requirements/SPEC.md).

## Requirements

- Node.js and npm.
- Python with Google OR-Tools for `cp-sat`, `lns`, and full `auto` CP-SAT support.

Install the optional CP-SAT Python environment with:

```bash
npm run setup:cp-sat
```

To use a custom Python executable:

```bash
export CITY_BUILDER_CP_SAT_PYTHON=/path/to/python
```

## Quick Start

```bash
npm install
npm run build
npm run web
```

Open the URL printed by the server, usually [http://localhost:4173](http://localhost:4173).

For long local planner runs on macOS:

```bash
npm run web:awake
```

## CLI Usage

Run the built-in examples:

```bash
npm run solve:auto
npm run solve:greedy
npm run solve:lns
npm run solve:cp-sat
```

`npm run solve` uses the default `auto` backend.

Useful benchmark entrypoints:

```bash
npm run benchmark:greedy
npm run benchmark:lns
npm run benchmark:cp-sat
npm run benchmark:scorecard
```

## Web Planner

The planner is the recommended product workflow. It supports:

- grid and catalog editing;
- sample problem presets;
- Auto-first solving with Advanced-mode Greedy, LNS, and CP-SAT controls;
- CP-SAT readiness messaging;
- validated layout inspection;
- solved-map overlays and explainability heatmaps;
- manual placement, move, erase, road edit, and validation flows;
- saved input setups and saved solved layouts;
- export/import of saved planner data;
- comparison of the next service or residential expansion.

The shortest workflow is documented in [docs/START_HERE.md](./docs/START_HERE.md).

## Library Usage

After building, import from the package entrypoint:

```ts
import { solve, validateSolution } from "city-builder";

const grid = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1]
];

const params = {
  optimizer: "auto",
  serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 2, avail: 1 }],
  residentialTypes: [{ w: 2, h: 2, min: 100, max: 160, avail: 2 }]
};

const solution = solve(grid, params);
const validation = validateSolution({ grid, params, solution });

console.log(solution.totalPopulation);
console.log(validation.valid);
```

Use `solveAsync(...)` for direct CP-SAT integrations and live progress subscriptions.

The main package exports runtime APIs from [src/index.ts](./src/index.ts). Benchmark and registry APIs are exposed through the `city-builder/benchmarks` subpath and [src/benchmarkApi.ts](./src/benchmarkApi.ts).

## Solver Modes

| Mode     | Role                           | Best For                                                                 |
| -------- | ------------------------------ | ------------------------------------------------------------------------ |
| `auto`   | Default staged quality path    | Planner and API users who want the best available incumbent-first result |
| `greedy` | Fast heuristic and diagnostics | Seed generation, quick checks, and placement diagnostics                 |
| `lns`    | Large Neighborhood Search      | Improving an incumbent through bounded CP-SAT repair windows             |
| `cp-sat` | Exact OR-Tools backend         | Bounded polish, exact repair, proof, bounds, and semantic checks         |

LNS also has an opt-in elite-archive strategy for hybrid multistart repair experiments. See [docs/design/ELITE_ARCHIVE_LNS.md](./docs/design/ELITE_ARCHIVE_LNS.md).

Current solver strategy, promotion gates, and research tracks live in [docs/roadmaps/SOLVER_ROADMAP.md](./docs/roadmaps/SOLVER_ROADMAP.md).

## Quality Gates

Use the PR hygiene gate before ordinary commits:

```bash
npm run quality:pr
```

Focused gates:

```bash
npm run quality:fast
npm run quality:solver
npm run quality:governance
npm run quality:evidence
```

Governance workflow before opening or implementing a new solver candidate:

```bash
npm run quality:governance
npm run candidate-trigger:scaffold -- --trigger-id=<trigger-id> --candidate-id=<candidate-id> --source=<current artifact, issue, or product requirement>
npm run candidate-intake:check
```

`quality:governance` is the cheap no-build preflight for docs formatting, artifact status, candidate intake checks, and trigger-scaffold contracts. Use `candidate-trigger:scaffold` to print a trigger-ledger record and M9 intake draft, then use `candidate-intake:check` before implementation or broad evidence work.

Full local test gate without the dependency audit:

```bash
npm test
```

Release-quality gate with high-severity dependency audit:

```bash
npm run quality
```

`npm run quality` contacts the npm registry through `npm audit`.

## Documentation

Start here:

- [docs/STATUS.md](./docs/STATUS.md) - current baseline, active posture, allowed next work, artifact posture, and gates.
- [docs/START_HERE.md](./docs/START_HERE.md) - planner happy path, CP-SAT readiness, and local quality gates.
- [docs/requirements/Requirement.md](./docs/requirements/Requirement.md) - product-level problem summary.
- [docs/requirements/SPEC.md](./docs/requirements/SPEC.md) - formal model, constraints, and objective.

Design and architecture:

- [docs/design/ALGORITHM.md](./docs/design/ALGORITHM.md) - algorithm design notes.
- [docs/design/PLANNER_ARCHITECTURE.md](./docs/design/PLANNER_ARCHITECTURE.md) - planner frontend/backend module boundaries.
- [docs/testing/BDD.md](./docs/testing/BDD.md) - acceptance scenario conventions.

Roadmaps and decisions:

- [docs/roadmaps/SOLVER_ROADMAP.md](./docs/roadmaps/SOLVER_ROADMAP.md) - active solver posture and promotion gates.
- [docs/roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md](./docs/roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md) - gated refactor opportunities and review-safe sequencing.
- [docs/roadmaps/SOLVER_ROADMAP_DELIVERED.md](./docs/roadmaps/SOLVER_ROADMAP_DELIVERED.md) - delivered solver baseline.
- [docs/roadmaps/SOLVER_ROADMAP_HISTORY_2026-05.md](./docs/roadmaps/SOLVER_ROADMAP_HISTORY_2026-05.md) - archived May 2026 evidence narrative.
- [docs/roadmaps/CP_SAT_ROADMAP.md](./docs/roadmaps/CP_SAT_ROADMAP.md) - CP-SAT-specific forward plan.
- [docs/roadmaps/CP_SAT_ROADMAP_DELIVERED.md](./docs/roadmaps/CP_SAT_ROADMAP_DELIVERED.md) - delivered CP-SAT work.
- [docs/roadmaps/GREEDY_ROADMAP.md](./docs/roadmaps/GREEDY_ROADMAP.md) - Greedy roadmap and shipped work.
- [docs/roadmaps/LEARNED_GUIDANCE_ROADMAP.md](./docs/roadmaps/LEARNED_GUIDANCE_ROADMAP.md) - learned-guidance gates and non-goals.
- [docs/decisions/SOLVER_ABLATION_DECISIONS.md](./docs/decisions/SOLVER_ABLATION_DECISIONS.md) - ablation decisions before learned guidance.

Evidence and artifacts:

- [docs/ARTIFACT_POLICY.md](./docs/ARTIFACT_POLICY.md) - what stays in git, what moves to external storage, and registry rules.

Feature files:

- [docs/requirements/features/city-builder-core.feature](./docs/requirements/features/city-builder-core.feature)
- [docs/requirements/features/planner-api.feature](./docs/requirements/features/planner-api.feature)

## Project Layout

```text
apps/planner-web/              Browser planner UI
docs/                          Requirements, design notes, roadmaps, and policies
python/                        OR-Tools CP-SAT backend
scripts/                       Setup, smoke, artifact, and helper scripts
src/                           TypeScript runtime, solvers, server, and benchmark APIs
tests/                         Acceptance, route, optimizer, planner, and hygiene tests
```

Important entrypoints:

- [src/index.ts](./src/index.ts) - public runtime API.
- [src/solverApi.ts](./src/solverApi.ts) - solver package subpath API.
- [src/benchmarkApi.ts](./src/benchmarkApi.ts) - benchmark and registry package subpath API.
- [src/packages/runtime/dispatch/solve.ts](./src/packages/runtime/dispatch/solve.ts) - top-level solver dispatch.
- [src/apps/planner-server/webServer.ts](./src/apps/planner-server/webServer.ts) - local planner server.
- [python/cp_sat_solver.py](./python/cp_sat_solver.py) - CP-SAT optimization model.

## Evidence Policy

Default solver behavior should change only after protected equal-budget evidence clears the roadmap promotion gates. Keep small summaries, manifests, registry drafts, and durable indexes in git. Move large raw JSON evidence bundles, replay labels, trace dumps, and temporary solve logs to external or release storage.

See [docs/ARTIFACT_POLICY.md](./docs/ARTIFACT_POLICY.md) and [docs/roadmaps/SOLVER_ROADMAP.md](./docs/roadmaps/SOLVER_ROADMAP.md).

## License

ISC
