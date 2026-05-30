# Artifact Policy

Use artifacts to make solver decisions reproducible without turning the repository into raw evidence storage.

## Keep In Git

- Text summaries such as `*.txt`, `SUMMARY.md`, and decision notes.
- `telemetry-manifest.json`, `manifest.json`, and `registry-entry-draft.json`.
- Small, reviewable JSON summaries that are needed to understand or validate a decision.
- The append-only experiment registry index.

## Move Out Of Git

- Large raw JSON evidence bundles.
- Repeated trace dumps, replay labels, and scorecard matrices that are useful for audit but not for code review.
- Temporary solve progress logs and scratch artifact directories.

Use release assets, external object storage, or another durable artifact store for large raw bundles. Keep the registry entry as the durable index, with enough metadata to recover the external bundle when needed. The current handoff convention is in [MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md](roadmaps/MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md).

## Registry Rules

- Every decision-grade artifact needs a registry entry or draft with the exact command, commit, hardware, split metadata, and artifact paths.
- Corrected metadata should use a new `runId`; do not rewrite old registry entries.
- Direct product-corpus registry append should happen only after the artifact bundle is checkpointed.
