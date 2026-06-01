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

Use release assets, external object storage, or another durable artifact store for large raw bundles. Keep the registry entry as the durable index, with enough metadata to recover the external bundle when needed. The current handoff convention is in [MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md](roadmaps/MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md), and the active recovery plan is [ARTIFACT_HYGIENE_RECOVERY_PLAN.md](roadmaps/ARTIFACT_HYGIENE_RECOVERY_PLAN.md).

## Soft-Warning Operating Rule

Run `npm run artifact-hygiene:status` before broad evidence work. The current soft-warning posture means tracked artifacts are above the `1500` soft target but below the `1600` hard cap, with no unindexed raw candidates. Treat this as a planning signal, not an automatic blocker.

| Workflow                                                                                          | Soft-Warning Rule                                                                |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Docs-only changes, roadmap updates, PR review notes, and backlog edits                            | May proceed.                                                                     |
| Code or test changes that do not create tracked artifact bundles                                  | May proceed.                                                                     |
| `quality:governance`, PR hygiene, solver tests, and focused smoke checks                          | May proceed.                                                                     |
| Trigger nominations, scaffold dry runs, and candidate intake drafts                               | May proceed after recording the hygiene status.                                  |
| Focused evidence that keeps only small summaries or manifests in git                              | May proceed when the expected tracked file count is small and reviewed.          |
| Broad scorecard, benchmark, replay, ablation, or promotion matrix runs                            | Require a reviewed externalization plan first.                                   |
| Candidate or release evidence expected to add large raw JSON/JSONL, labels, traces, or solve logs | Require a reviewed externalization plan first.                                   |
| Any run that would leave unindexed raw candidates or cross the `1600` hard cap                    | Blocked until artifact hygiene is recovered or a reviewed exception is approved. |

A reviewed externalization plan must name the expected artifact family and run id, which files stay in git, which raw files move to release or external storage, the durable storage target, the registry entry or draft that indexes the run, and the verification commands to run before closeout. Use the handoff workflow when the plan moves raw evidence out of git.

## Registry Rules

- Every decision-grade artifact needs a registry entry or draft with the exact command, commit, hardware, split metadata, and artifact paths.
- Corrected metadata should use a new `runId`; do not rewrite old registry entries.
- Direct product-corpus registry append should happen only after the artifact bundle is checkpointed.
