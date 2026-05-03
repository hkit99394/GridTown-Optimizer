# Experiment Registry

`index.jsonl` is a lightweight registry for solver evidence artifacts.

Each line is one JSON object with:

- `schemaVersion`: registry schema version
- `runId`: stable artifact identifier
- `artifactType`: benchmark, label bundle, ablation gate, health check, or model experiment
- `generatedAt`: artifact date or timestamp when known
- `indexedAt`: date this registry entry was added
- `indexedGitCommit`: git commit used when the registry entry was added
- `branch`: branch used when the registry entry was added
- `artifactGitCommit`: commit recorded by the artifact, or `null` if the artifact did not capture it
- `commands`: command list when known
- `artifactPaths`: paths to human-readable and machine-readable artifacts
- `cases` / `caseFamilies`: cases or families covered when known
- `seeds`: benchmark seeds when known
- `splitStatus`: development / holdout / leakage metadata
- `budget`: wall-clock and CPU-budget metadata when known
- `hardware`: CPU/GPU metadata when captured
- `model`: model metadata, or `null` when no model was trained
- `decision`: promotion or no-promotion decision
- `summary`: short human-readable result

The registry is intentionally append-only. If an artifact needs corrected metadata, add a new entry with a new `runId` suffix rather than mutating historical meaning.

## Tooling

Check the seeded registry:

```sh
npm run experiment-registry:check
```

Audit accepted historical metadata debt:

```sh
npm run experiment-registry:check -- --historical-warnings
```

Append a new entry:

```sh
npm run experiment-registry -- append --entry=artifacts/example/registry-entry.json --artifact-git-commit=HEAD
```

The entry JSON should include the artifact metadata itself:

```json
{
  "runId": "example-scorecard-2026-04-28",
  "artifactType": "benchmark",
  "generatedAt": "2026-04-28T12:00:00.000Z",
  "commands": ["node dist/crossModeBenchmarkCli.js --json --modes=auto,greedy --budgets=5 --seeds=7 typed-housing-single"],
  "artifactPaths": ["artifacts/example/scorecard.json"],
  "cases": ["typed-housing-single"],
  "caseFamilies": ["tiny"],
  "seeds": [7],
  "splitStatus": { "protectedHoldout": false, "notes": "Development benchmark slice." },
  "budget": { "wallClockBudgetsSeconds": [5], "cpuBudgetSeconds": 5, "observedCpuSeconds": 4.8 },
  "hardware": { "captured": true, "cpuModel": "Apple M-series", "logicalCores": 8, "memoryGb": 16, "gpuUsed": false },
  "model": null,
  "decision": "no-default-promotion",
  "summary": "Auto matched the incumbent baseline on this development slice."
}
```

`append` fills `indexedAt`, `indexedGitCommit`, `branch`, `artifactGitCommit`, and hardware metadata from the current checkout and runtime unless the entry or flags supply them explicitly. New appends are strict by default: they must include command, split, budget, hardware, model, and decision metadata, plus case coverage and seeds. Existing seeded entries that predate full hardware capture pass the default check without noisy historical warnings; use `--historical-warnings` to audit accepted historical debt, and use `--strict` when deciding whether an artifact is promotion-grade.
