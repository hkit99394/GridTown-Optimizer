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
