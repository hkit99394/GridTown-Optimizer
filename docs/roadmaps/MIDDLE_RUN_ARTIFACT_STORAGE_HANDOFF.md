# Middle-Run Artifact Storage Handoff

Reviewed on 2026-06-01.

Use this handoff when an evidence run creates raw bundles that are useful for audit but too large or noisy for normal code review. The goal is simple: keep the registry and summaries in git, move large raw bundles to durable release or external storage, and preserve enough metadata to recover the raw evidence later.

This is a storage convention only. It does not promote solver behavior or change runtime defaults.

## Current Pressure

The repository already has decision artifacts near the tracked-artifact hygiene ceiling:

| Example Bundle                                                | Raw File                      | Approx Size | Handoff Signal                                             |
| ------------------------------------------------------------- | ----------------------------- | ----------- | ---------------------------------------------------------- |
| Product promotion matrix                                      | `scorecard.json`              | 7.4 MB      | Future refreshes should externalize raw scorecards.        |
| Service-master Auto/Greedy cost evidence                      | `budget-ablation.json`        | 9.9 MB      | Future broad ablation bundles should externalize raw JSON. |
| Service-master Auto/Greedy cost evidence                      | `decision-trace.jsonl`        | 1.9 MB      | Trace dumps belong in external storage after closeout.     |
| LNS replay labels and online learned-guidance diagnostic runs | `labels.json` / ablation JSON | 10-13 MB    | Label and online matrices are external-storage candidates. |

The 2026-06-01 stage review found the tracked artifact count at `1716`, above the hygiene cap of `1600`. The first-pass recovery in [ARTIFACT_HYGIENE_RECOVERY_PLAN.md](ARTIFACT_HYGIENE_RECOVERY_PLAN.md) externalized 234 unindexed raw artifacts and recovered the evidence gate while keeping summaries, manifests, registry drafts, and the registry index in git. The later 15-case baseline lock leaves the repository at `1501` tracked artifacts with `0` unindexed raw candidates, so `1500` is now a soft watch target and `1600` remains the hard evidence gate.

Automation status: `npm run artifact-hygiene:check` and `npm run quality:evidence` warn above the `1500` soft target and fail above the `1600` hard cap. `npm run artifact-hygiene:inventory` reports the soft overage, hard-cap headroom, and `artifactHygieneStatus` for evidence planning.

## Storage Tiers

| Tier                   | Location                                                     | Git Status         | Use                                                                                               |
| ---------------------- | ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| Registry index         | `artifacts/experiments/index.jsonl`                          | tracked            | Durable index for decision-grade runs.                                                            |
| Reviewable summaries   | `artifacts/<family>/<date>/<run-id>/`                        | tracked when small | Text summaries, evidence summaries, telemetry manifests, registry drafts, and external manifests. |
| Local release staging  | `release-assets/<family>/<date>/<run-id>/`                   | ignored            | Temporary packaging area before upload to release or object storage.                              |
| Raw recovery staging   | `artifacts/<family>/<date>/<run-id>/raw/` or `external-raw/` | ignored            | Temporary local unpack location when auditing raw evidence.                                       |
| Durable external store | GitHub Release assets or project-approved object storage     | outside git        | Large scorecards, replay labels, trace dumps, solve logs, and raw matrices.                       |

## Handoff Triggers

Move raw evidence out of git when any trigger is true:

1. A raw JSON, JSONL, label, scorecard, or ablation file is larger than 5 MB.
2. A file is a replay-label bundle, decision-trace dump, solve-progress log, or repeated online scorecard matrix.
3. A broad refresh would add many files or noisy churn to `artifacts/`.
4. A file approaches the repository hygiene ceiling of 14 MB per tracked artifact.
5. The evidence is useful for audit but not needed for routine review once summaries and manifests exist.

Keep small summaries in git even when the raw bundle moves out.

## What Stays In Git

Keep these files in the artifact directory when they are reviewable:

- `*.txt`, `SUMMARY.md`, and decision notes.
- `evidence-summary.json`.
- `telemetry-manifest.json`.
- `workflow-replay.json`.
- `workflow-replay-telemetry-manifest.json`.
- `manifest.json`.
- `external-artifacts-manifest.json`.
- `registry-entry-draft.json`.

The registry entry or draft should point to the git-tracked summaries and manifests. Do not put a GitHub release URL, object-store URL, or ignored local `release-assets/` path in `artifactPaths`; registry artifact paths are repository-relative and validated as repo files.

## What Moves Out Of Git

Move these to durable release or external storage by default:

- Large `scorecard.json` files.
- Large `budget-ablation.json` files.
- `decision-trace.jsonl` files.
- Replay-label bundles such as `labels.json` or `lns-window-replay-labels.json`.
- Raw online ablation matrices.
- Temporary solve-progress logs.
- Scratch snapshots and temporary solver outputs.

If a raw file is small enough to keep but likely to churn repeatedly, prefer external storage anyway and keep only the summary in git.

## Durable Location Convention

Use one of these durable targets:

| Target             | Convention                                                                                               | Use When                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| GitHub Release     | Release tag `solver-evidence-YYYY-MM-DD`; asset `<run-id>.raw.tar.gz` plus `<run-id>.raw.tar.gz.sha256`. | Preferred for shareable decision-grade evidence.     |
| Object storage     | `solver-evidence/<family>/<YYYY-MM-DD>/<run-id>/`                                                        | Use when the project has an approved durable bucket. |
| Local staging only | `release-assets/<family>/<YYYY-MM-DD>/<run-id>/`                                                         | Temporary only; not durable until uploaded.          |

The release or object-store location must be recorded in `external-artifacts-manifest.json` and in the decision closeout. The registry remains the git-tracked index.

## External Manifest Shape

Create one small `external-artifacts-manifest.json` beside the tracked summaries:

```json
{
  "schemaVersion": 1,
  "runId": "product-corpus-scorecard-YYYYMMDDTHHMMSSZ-baseline-promotion-matrix",
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "storage": {
    "kind": "github-release",
    "uri": "https://github.com/<owner>/<repo>/releases/tag/solver-evidence-2026-05-30",
    "asset": "product-corpus-scorecard-YYYYMMDDTHHMMSSZ-baseline-promotion-matrix.raw.tar.gz"
  },
  "files": [
    {
      "path": "scorecard.json",
      "role": "raw-scorecard",
      "bytes": 7733248,
      "sha256": "<sha256>"
    }
  ],
  "retention": "decision-grade",
  "notes": "Raw bundle moved out of git; summaries, telemetry, and registry draft remain in the artifact directory."
}
```

Add `external-artifacts-manifest.json` to the registry draft's `artifactPaths`. When useful, also duplicate the external storage summary in `summaryMetrics.externalArtifacts` so reviewers can find it from the registry entry alone.

## Handoff Workflow

1. Generate the artifact bundle under `artifacts/<family>/<YYYY-MM-DD>/<run-id>/`.
2. Decide which files stay in git and which raw files move out.
3. Copy raw files to `release-assets/<family>/<YYYY-MM-DD>/<run-id>/`.
4. Package the raw files as `<run-id>.raw.tar.gz`.
5. Generate a SHA-256 checksum for the package.
6. Upload the package and checksum to the GitHub Release or object store.
7. Write `external-artifacts-manifest.json` in the original artifact directory.
8. Ensure `registry-entry-draft.json` includes the tracked summaries and external manifest, not ignored local staging paths.
9. Run registry validation.
10. Append the registry entry only after the durable upload and git checkpoint are complete.

Example command shape:

```bash
RUN_ID="product-corpus-scorecard-YYYYMMDDTHHMMSSZ-baseline-promotion-matrix"
RUN_DATE="$(date -u +%F)"
FAMILY="product-corpus"
ARTIFACT_DIR="artifacts/${FAMILY}/${RUN_DATE}/${RUN_ID}"
STAGING_DIR="release-assets/${FAMILY}/${RUN_DATE}/${RUN_ID}"

mkdir -p "${STAGING_DIR}"
cp "${ARTIFACT_DIR}/scorecard.json" "${STAGING_DIR}/scorecard.json"
tar -C "${STAGING_DIR}" -czf "${STAGING_DIR}/${RUN_ID}.raw.tar.gz" scorecard.json
shasum -a 256 "${STAGING_DIR}/${RUN_ID}.raw.tar.gz" > "${STAGING_DIR}/${RUN_ID}.raw.tar.gz.sha256"
```

After upload:

```bash
npm run experiment-registry -- validate-entry --entry="${ARTIFACT_DIR}/registry-entry-draft.json"
npm run experiment-registry -- check
```

Decision-grade append:

```bash
npm run experiment-registry -- append --entry="${ARTIFACT_DIR}/registry-entry-draft.json"
npm run experiment-registry -- check
```

## Recovery Workflow

To audit old raw evidence:

1. Find the `runId` in `artifacts/experiments/index.jsonl`.
2. Check out the indexed commit when exact code context matters.
3. Open the artifact directory and read `external-artifacts-manifest.json`.
4. Download the raw package and checksum from the recorded durable location.
5. Verify the checksum.
6. Unpack into `artifacts/<family>/<date>/<run-id>/raw/` or another ignored local directory.
7. Do not commit recovered raw files unless a new closeout explicitly says they are small and review-critical.

## Closeout Requirements

Before marking a decision closeout complete:

- `registry-entry-draft.json` or the appended registry entry points to the tracked summaries and external manifest.
- `external-artifacts-manifest.json` records durable URI, package name, file roles, byte sizes, and checksums.
- The raw package and checksum have been uploaded outside git.
- Large raw files are removed from staging unless intentionally kept for local audit.
- `npm run experiment-registry -- check` passes.
- Runtime-default status is recorded separately in the decision closeout.

## Block Rules

Block decision-grade closeout when any of these are true:

1. A large raw bundle exists only in ignored local staging.
2. The registry draft points to ignored `release-assets/` paths instead of tracked manifests.
3. A raw package has no checksum.
4. The external storage location is missing from the manifest and closeout.
5. The artifact bundle cannot be recovered from the registry entry plus tracked manifest.
6. The run would push tracked artifacts over the hygiene ceiling without a reviewed exception.

## Decision

M11 is satisfied as a middle-run artifact storage handoff. Large scorecards, replay labels, trace dumps, solve logs, and raw matrices now have a durable release/external storage convention while registry entries remain the git-tracked index.

Current follow-up: keep the 2026-05-31 plus 2026-06-01 split artifacts as the durable 15-case baseline; do not generate one combined promotion-matrix artifact just to solve artifact hygiene. Future broad artifact-producing runs should either preserve the current 1501-file soft-margin posture or include a reviewed externalization step before closeout. Treat a soft-cap warning as a planning signal, not a release blocker, unless the hard cap is also breached. Use `npm run artifact-hygiene:status` as the quick preflight before broad evidence work.
