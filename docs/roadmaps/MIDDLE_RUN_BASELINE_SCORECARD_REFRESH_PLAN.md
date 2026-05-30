# Middle-Run Baseline Scorecard Refresh Plan

Reviewed on 2026-05-30.

Use this plan to refresh baseline product-workflow scorecards before interpreting solver candidates. It refreshes evidence only; it does not promote solver behavior.

The current product workflow corpus has development and protected holdout splits. L0 has added the first two fresh product holdout cases inside the holdout split: `fresh-multi-anchor-service-island` and `fresh-typed-footprint-scarcity`. Treat them as a separate fresh refresh slice for candidate evidence even though the TypeScript split field remains `holdout`.

## Shared Setup

Run from the repository root after dependencies are installed.

```bash
npm run build
```

Use these variables for the commands below:

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
PRODUCT_ROOT="artifacts/product-corpus/${RUN_DATE}"
MODES="auto,greedy,lns,cp-sat"
BUDGETS="1,5,30,120"
SEEDS="7,19,37"
```

## Artifact Storage

Default product refresh bundles go under:

```text
artifacts/product-corpus/${RUN_DATE}/
```

Use these subdirectory names:

| Refresh Slice             | Artifact Directory Pattern                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Smoke                     | `${PRODUCT_ROOT}/baseline-smoke-${RUN_STAMP}`                                              |
| Development split         | `${PRODUCT_ROOT}/baseline-development-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}`            |
| Protected holdout split   | `${PRODUCT_ROOT}/baseline-protected-holdout-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}`      |
| Fresh product holdout     | `${PRODUCT_ROOT}/baseline-fresh-holdout-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}`          |
| Full promotion matrix     | `${PRODUCT_ROOT}/baseline-promotion-matrix-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}`       |
| External raw bundle store | `release-assets/product-corpus/${RUN_DATE}/` or the project-approved durable object store. |

Keep `scorecard.txt`, `evidence-summary.json`, `workflow-replay.json`, `workflow-replay-telemetry-manifest.json`, `telemetry-manifest.json`, and `registry-entry-draft.json` reviewable when they are small enough. Move large raw `scorecard.json` bundles and trace-heavy evidence to release or external storage when they become too large for normal review. Keep the registry entry as the durable index.

## Smoke Refresh

Use this before longer refreshes to verify the local build, CP-SAT bridge, product artifact writer, and replay metadata.

```bash
ARTIFACT_DIR="${PRODUCT_ROOT}/baseline-smoke-${RUN_STAMP}"
RUN_ID="product-corpus-scorecard-${RUN_STAMP}-baseline-smoke"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="${RUN_ID}" \
  --product-decision=benchmark-refresh-smoke \
  '--product-summary=Baseline product-corpus smoke refresh over one development replay case and one protected holdout replay case; no solver default changed.' \
  --modes="${MODES}" \
  --budgets=1 \
  --seeds=7 \
  --json \
  manual-layout-replay-warm-start \
  expansion-comparison-replay
```

Expected shape:

- `caseCount` is `2`.
- `modeCount` is `4`.
- `budgetsSeconds` is `[1]`.
- `seeds` is `[7]`.
- `workflow-replay.json` contains both replay cases.

## Development Split Refresh

Use this to refresh the development half of the product workflow corpus.

```bash
ARTIFACT_DIR="${PRODUCT_ROOT}/baseline-development-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}"
RUN_ID="product-corpus-scorecard-${RUN_STAMP}-baseline-development-1s-5s-30s-120s-seeds7-19-37"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="${RUN_ID}" \
  --product-decision=benchmark-refresh-development \
  '--product-summary=Baseline development-split product-corpus refresh over Auto/Greedy/LNS/CP-SAT at 1s/5s/30s/120s and seeds 7/19/37; no solver default changed.' \
  --modes="${MODES}" \
  --budgets="${BUDGETS}" \
  --seeds="${SEEDS}" \
  --json \
  typed-housing-single \
  typed-footprint-pressure \
  seeded-service-anchor-pressure \
  road-semantics-service-pressure \
  manual-layout-replay-warm-start
```

Coverage:

- 5 development cases.
- 4 modes.
- 4 budgets.
- 3 seeds.
- 60 case/budget/seed scorecards.
- 240 mode runs.

## Protected Holdout Refresh

Use this to refresh the current protected holdout half of the product workflow corpus. Do not use this slice for candidate tuning.

```bash
ARTIFACT_DIR="${PRODUCT_ROOT}/baseline-protected-holdout-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}"
RUN_ID="product-corpus-scorecard-${RUN_STAMP}-baseline-protected-holdout-1s-5s-30s-120s-seeds7-19-37"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="${RUN_ID}" \
  --product-decision=benchmark-refresh-protected-holdout \
  '--product-summary=Baseline protected-holdout product-corpus refresh over Auto/Greedy/LNS/CP-SAT at 1s/5s/30s/120s and seeds 7/19/37; no solver default changed.' \
  --modes="${MODES}" \
  --budgets="${BUDGETS}" \
  --seeds="${SEEDS}" \
  --json \
  row0-corridor-repair-pressure \
  service-local-neighborhood \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay
```

Coverage:

- 5 protected holdout cases.
- 4 modes.
- 4 budgets.
- 3 seeds.
- 60 case/budget/seed scorecards.
- 240 mode runs.

## Fresh Product Holdout Refresh

Current status: runnable for the first L0 fresh product holdout pair. These cases are in the product workflow corpus as holdout cases, but they should be refreshed separately before candidate claims.

```bash
FRESH_CASES=(
  fresh-multi-anchor-service-island
  fresh-typed-footprint-scarcity
)

ARTIFACT_DIR="${PRODUCT_ROOT}/baseline-fresh-holdout-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}"
RUN_ID="product-corpus-scorecard-${RUN_STAMP}-baseline-fresh-holdout-1s-5s-30s-120s-seeds7-19-37"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="${RUN_ID}" \
  --product-decision=benchmark-refresh-fresh-holdout \
  '--product-summary=Baseline fresh product-holdout refresh over Auto/Greedy/LNS/CP-SAT at 1s/5s/30s/120s and seeds 7/19/37; no solver default changed.' \
  --modes="${MODES}" \
  --budgets="${BUDGETS}" \
  --seeds="${SEEDS}" \
  --json \
  "${FRESH_CASES[@]}"
```

Rules for fresh product holdout:

- The selected cases must not have been used for candidate tuning, model selection, or threshold search.
- The registry entry summary must say how the cases were selected and why they are fresh.
- If fresh cases are not yet part of `DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS`, add the corpus cases first or use a candidate-specific benchmark harness that writes equivalent registry metadata.
- Do not replace this with learned-LNS fresh-pressure evidence; that evidence is track-specific and does not cover the full product workflow promotion matrix.

## Full Promotion-Matrix Refresh

Use this after smoke, development, and protected holdout refreshes are healthy. This is the current baseline refresh shape for the product workflow promotion matrix.

```bash
ARTIFACT_DIR="${PRODUCT_ROOT}/baseline-promotion-matrix-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}"
RUN_ID="product-corpus-scorecard-${RUN_STAMP}-baseline-promotion-matrix-1s-5s-30s-120s-seeds7-19-37"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-promotion-matrix \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="${RUN_ID}" \
  --product-decision=benchmark-refresh-baseline-promotion-matrix \
  '--product-summary=Baseline full product workflow promotion-matrix refresh over Auto/Greedy/LNS/CP-SAT at 1s/5s/30s/120s and seeds 7/19/37; no solver default changed.' \
  --json
```

Coverage:

- 12 product workflow cases.
- 4 modes.
- 4 budgets.
- 3 seeds.
- 144 case/budget/seed scorecards.
- 576 mode runs.

## Registry Closeout

For review-only refreshes:

```bash
npm run experiment-registry -- check
```

For decision-grade refreshes after the artifact bundle is checkpointed:

```bash
npm run experiment-registry -- append --entry="${ARTIFACT_DIR}/registry-entry-draft.json"
npm run experiment-registry -- check
```

Do not append scratch smoke runs. Append only refreshes that are kept as durable evidence.

## Read Order

Review artifacts in this order:

1. `scorecard.txt`
2. `evidence-summary.json`
3. `workflow-replay.json`
4. `telemetry-manifest.json`
5. `registry-entry-draft.json`
6. `scorecard.json` only when row-level details are needed

Before interpreting candidate results, compare the refreshed baseline with the same-slice baseline-repeat envelope from [MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md](MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md).
