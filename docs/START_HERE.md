# Start Here

This is the shortest path through the planner when you want a validated layout, a saved result, and one next-expansion comparison.

## Planner Happy Path

1. Start the planner:

   ```bash
   npm run web
   ```

2. Open the local planner URL printed by the server.
3. Pick a sample problem preset or edit the grid and catalogs directly.
4. Keep the optimizer on `Auto` for the recommended quality path.
5. Run the planner, then inspect the validation notice and solved layout map.
6. Save or export the result from the output layout controls.
7. Add the next service and/or residential candidate, then run the expansion comparison.

## CP-SAT Readiness

The planner checks whether the configured Python runtime can import OR-Tools. If the readiness status says CP-SAT is not ready, run:

```bash
npm run setup:cp-sat
```

To use a custom Python environment instead, set:

```bash
export CITY_BUILDER_CP_SAT_PYTHON=/path/to/python
```

`Auto`, `LNS`, and direct `CP-SAT` runs can use the CP-SAT backend when it is available. Greedy-only runs do not require OR-Tools.

## Local Quality Gates

PR hygiene gate:

```bash
npm run quality:pr
```

Fast component gate:

```bash
npm run quality:fast
```

Solver gate:

```bash
npm run quality:solver
```

Governance gate:

```bash
npm run quality:governance
```

Governance workflow before opening or implementing a new solver candidate:

```bash
npm run quality:governance
npm run candidate-trigger:scaffold -- --trigger-id=<trigger-id> --candidate-id=<candidate-id> --source=<current artifact, issue, or product requirement>
npm run candidate-intake:check
```

`quality:governance` is the cheap no-build preflight for docs formatting, artifact status, candidate intake checks, and trigger-scaffold contracts. Use `candidate-trigger:scaffold` to print a trigger-ledger record and M9 intake draft, then use `candidate-intake:check` before implementation or broad evidence work.

Evidence gate:

```bash
npm run quality:evidence
```

Full local gate without security audit:

```bash
npm test
```

Release-quality gate:

```bash
npm run quality
```
