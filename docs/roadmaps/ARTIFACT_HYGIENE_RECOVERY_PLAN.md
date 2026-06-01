# Artifact Hygiene Recovery Plan

Date: 2026-06-01

Status: First-pass recovery complete; follow-up baseline hygiene active.

## Purpose

Recover the evidence gate by bringing tracked artifact files back under the repository hygiene ceilings while preserving decision-grade evidence.

This is an artifact migration plan only. It does not change solver behavior, does not promote a candidate, and does not require a single combined promotion-matrix artifact. The 2026-05-31 split-lane product-corpus artifacts remain the durable baseline.

## Original Failure

`node tests/artifact-repository-hygiene.test.cjs` failed because tracked artifacts exceeded the file-count cap:

| Metric                 | Current           | Cap                 | Status                         |
| ---------------------- | ----------------- | ------------------- | ------------------------------ |
| Tracked artifact files | 1716              | 1600                | Failing by 116 files           |
| Tracked artifact bytes | 817,052,193 bytes | 817,889,280 bytes   | Passing, but under 1 MiB spare |
| Largest tracked file   | Under 14 MiB      | 14 MiB per artifact | Passing                        |

Minimum recovery was 117 fewer tracked files. The execution target was stronger: tracked artifacts at or below 1500 files and comfortably below the byte ceiling.

## Recovery Result

The first-pass unindexed raw migration is complete.

| Metric                                      | Result                | Status                         |
| ------------------------------------------- | --------------------- | ------------------------------ |
| Tracked artifact files after untracking     | 1482                  | Passing, below 1500 target     |
| Tracked artifact bytes after untracking     | 201,045,597 bytes     | Passing with broad byte margin |
| Unindexed raw candidate files remaining     | 0                     | Passing                        |
| External package location                   | GitHub Release assets | Durable                        |
| Combined promotion-matrix artifact required | No                    | Split baseline remains durable |

The compact tracked external manifest is `artifacts/external-artifacts/2026-06-01/artifact-hygiene-unindexed-raw-manifest.json`. Once that manifest is staged with the migration commit, the tracked artifact count is expected to be 1483, still below the 1500 recovery target and 1600 gate cap.

## Recovery Principle

Keep in git:

- `artifacts/experiments/index.jsonl`
- `registry-entry-draft.json`
- `manifest.json`
- `telemetry-manifest.json`
- `evidence-summary.json`
- `scorecard.txt`
- `budget-ablation.txt`
- other compact text summaries and decision notes

Move out of git:

- raw online ablation matrices
- replay label bundles
- raw budget ablation JSON
- decision trace JSONL
- large raw scorecards
- raw feature-gate discovery matrices

Do not replace every raw file with one manifest beside it. That would fix bytes but not file count. Use aggregate external manifests for migration batches.

## First-Pass Candidate Set

The safest first pass is to externalize and untrack raw-like artifact files that are not referenced by the committed experiment registry index. This avoids rewriting `artifacts/experiments/index.jsonl` during the first recovery.

| Class                                           | Unindexed Files | Size           | Notes                                                                                       |
| ----------------------------------------------- | --------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `lns-window-ranker-online-ablation.json`        | 161             | 407.92 MiB     | Biggest win; online learned-LNS diagnostic matrices already have text/manifests.            |
| `labels.json` / `lns-window-replay-labels.json` | 36              | 106.67 MiB     | Raw replay/learned-label bundles; summaries stay in git.                                    |
| `budget-ablation.json` / `decision-trace.jsonl` | 6               | 10.29 MiB      | Unindexed diagnostics only; keep `budget-ablation.txt`.                                     |
| `scorecard.json`                                | 18              | 27.01 MiB      | Raw scorecards; keep summaries/manifests.                                                   |
| `online-selected-feature-gate-discovery.json`   | 13              | 35.56 MiB      | Raw discovery matrices; keep text summaries/manifests.                                      |
| **Total**                                       | **234**         | **587.45 MiB** | Post-removal estimate: 1482 tracked files and 191.75 MiB before adding aggregate manifests. |

This first pass leaves indexed raw files tracked. That is deliberate: the registry index stays valid without a migration.

## Execution Steps

1. Recreate the inventory.

   ```bash
   npm run artifact-hygiene:inventory
   ```

   - Generate a local ignored file list for unindexed raw candidates.
   - Confirm expected candidate count is close to 234.
   - Confirm none of the candidate paths appear in `artifacts/experiments/index.jsonl`.

2. Package the raw files before untracking.

   ```bash
   npm run artifact-hygiene:stage-unindexed
   ```

   - Stage under `release-assets/artifact-hygiene/2026-06-01/unindexed-raw/`.
   - Create one or a few tarballs grouped by family, not one tarball per run.
   - Write SHA-256 checksums for each tarball.
   - Upload to the approved durable location before committing the untracking change.

3. Add aggregate external manifest coverage.
   - Add a compact tracked manifest such as `artifacts/external-artifacts/2026-06-01/artifact-hygiene-unindexed-raw-manifest.json`.
   - Record package name, checksum, storage URI, raw file count, byte count, and role groups.
   - Do not list hundreds of paths in separate tracked files unless required; keep the manifest compact enough to preserve file-count margin.

4. Stop tracking the raw candidates.
   - Use `git rm --cached --pathspec-from-file=<ignored-local-candidate-list>` so local copies remain available.
   - Add `.gitignore` patterns for future raw artifact classes after confirming they do not hide summaries or registry files.
   - Do not untrack summaries, manifests, registry drafts, or the registry index.

5. Verify the first pass.
   - `git ls-files -- artifacts` should be at or below 1500 files.
   - `node tests/artifact-repository-hygiene.test.cjs` should pass.
   - `node tests/product-corpus-registry.test.cjs` should pass.
   - `npm run experiment-registry:check` should pass.
   - `npm run quality:evidence` should pass before declaring the gate recovered.

## Execution Result

Local staging was prepared under `release-assets/artifact-hygiene/2026-06-01/unindexed-raw/`.

This directory is ignored by git and is not durable storage. The durable copy was uploaded to the GitHub Release `solver-evidence-2026-06-01`.

Release URL: <https://github.com/hkit99394/GridTown-Optimizer/releases/tag/solver-evidence-2026-06-01>

| Package                                                        | Raw Files | Archive Bytes | SHA-256 Status |
| -------------------------------------------------------------- | --------- | ------------- | -------------- |
| `artifact-hygiene-unindexed-raw-online-ablation.tar.gz`        | 161       | 24,590,037    | Verified       |
| `artifact-hygiene-unindexed-raw-labels.tar.gz`                 | 36        | 2,593,777     | Verified       |
| `artifact-hygiene-unindexed-raw-budget-trace.tar.gz`           | 6         | 719,510       | Verified       |
| `artifact-hygiene-unindexed-raw-scorecards.tar.gz`             | 18        | 1,670,964     | Verified       |
| `artifact-hygiene-unindexed-raw-feature-gate-discovery.tar.gz` | 13        | 825,940       | Verified       |

Generated local metadata:

- `candidate-paths.txt`
- per-class path lists
- `candidate-summary.txt`
- `candidate-summary.json`
- `package-manifest.local-staging.json`
- one `.sha256` file per archive

Executed untracking command:

```bash
git rm --cached --pathspec-from-file=release-assets/artifact-hygiene/2026-06-01/unindexed-raw/candidate-paths.txt
```

This kept local raw files available for audit while removing 234 unindexed raw files from the git index.

Verification completed:

- `npm run artifact-hygiene:inventory`
- `node tests/artifact-repository-hygiene.test.cjs`
- `node tests/product-corpus-registry.test.cjs`
- `npm run experiment-registry:check`
- `npm run quality:evidence`
- `git diff --check`
- `npm run format:check`
- `npm run lint`

## Indexed Raw Follow-Up

The committed registry index currently references some raw-like files. Leave these alone in the first pass.

Indexed raw-like paths found in the review:

| Class                                           | Indexed Files |
| ----------------------------------------------- | ------------- |
| `lns-window-ranker-online-ablation.json`        | 7             |
| `labels.json` / `lns-window-replay-labels.json` | 3             |
| `budget-ablation.json` / `decision-trace.jsonl` | 48            |
| `scorecard.json`                                | 5             |

If more margin is needed later, do a separate registry migration:

1. Package the indexed raw files into durable external storage.
2. Add aggregate external manifests.
3. Update affected registry entries in one reviewed migration commit, preserving run ids, decisions, commands, summaries, and artifact recovery metadata.
4. Run `npm run experiment-registry:check` before untracking indexed raw files.

Do not mix indexed registry migration with the first-pass unindexed cleanup.

## Acceptance Criteria

Artifact hygiene recovery is complete when:

- Tracked artifact count is at or below 1500.
- Tracked artifact bytes have at least 100 MiB of headroom under the current cap.
- `node tests/artifact-repository-hygiene.test.cjs` passes.
- `node tests/product-corpus-registry.test.cjs` passes.
- `npm run experiment-registry:check` passes.
- `npm run quality:evidence` passes.
- The external raw package and checksum are durable, not only local `release-assets/`.
- The 2026-05-31 split-lane baseline remains documented as the durable baseline.

## Non-Goals

- Do not generate a combined full promotion-matrix artifact.
- Do not change solver defaults.
- Do not prune summaries or manifests to chase file count.
- Do not rewrite historical decision narratives.
- Do not remove local raw files before the external package and checksum are verified.

## Recommended Next Move

The first-pass migration was committed as `1b75973 Recover artifact hygiene and externalize raw evidence`, planner completed-status resilience followed on 2026-06-01, and `fresh-manual-resume-neighborhood` is now implemented as the next fresh holdout row. The next maintenance move is a focused evaluator-validity and baseline-refresh slice for that row before any candidate touches saved-layout reuse, warm-start behavior, or planner resume flows.
