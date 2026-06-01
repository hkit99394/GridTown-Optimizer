# Middle-Run Baseline Scorecard Refresh Plan

Reviewed on 2026-06-01.

Use this plan to refresh baseline product-workflow scorecards before interpreting solver candidates. It refreshes evidence only; it does not promote solver behavior.

The current product workflow corpus has development and protected holdout splits. L0 has added four fresh product holdout cases inside the holdout split: `fresh-multi-anchor-service-island`, `fresh-typed-footprint-scarcity`, `fresh-expansion-corridor-service`, and `fresh-manual-resume-neighborhood`. The Auto/LNS expansion-corridor intake also added `development-expansion-corridor-service` as a development-side analog. Treat the fresh rows as a separate refresh slice for candidate evidence even though the TypeScript split field remains `holdout`.

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

Latest current-corpus smoke:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-current-14-case-smoke-20260531T183922Z`.
- Shape: 14 cases, 4 modes, budget `1`, seed `7`.
- Product coverage: no missing cases, no split mismatches, no missing modes for the smoke slice.
- Auto ties best on 11 of 14 rows.
- Auto is behind best on `service-local-neighborhood` by `15`, `fresh-multi-anchor-service-island` by `25`, and `expansion-comparison-replay` by `35`.
- Follow-up baseline-repeat triage: `artifacts/cross-mode-budget-ablations/2026-05-31/auto-1s-miss-triage-baseline-repeat-20260531T185216Z` showed all three misses are seed `7` only across seeds `7,19,37`.
- Split fast-lane refreshes now cover the current 15-case corpus at `1s/5s`, seeds `7,19,37`: development, protected holdout, the first three fresh holdout artifacts, and the 2026-06-01 manual-resume fast-lane artifact listed below. Across those 90 case/budget/seed rows, Auto ties best on 85 rows.
- This is a smoke refresh only. The split-lane baseline is complete for the current 15-case corpus through separate artifacts; create one combined promotion-matrix artifact only when a release process explicitly requires it.

## Development Split Refresh

Use this to refresh the development half of the product workflow corpus.

Run the `1s/5s` fast lane first when validating the refresh path locally. The
full `1s/5s/30s/120s` command is decision-grade but sequentially expensive; use
it after the fast lane is healthy or split the longer budgets into separate
artifact runs.

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
  development-expansion-corridor-service \
  manual-layout-replay-warm-start
```

Coverage:

- 6 development cases.
- 4 modes.
- 4 budgets.
- 3 seeds.
- 72 case/budget/seed scorecards.
- 288 mode runs.

Latest development fast-lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-development-fast-1s-5s-seeds7-19-37-20260531T190759Z`.
- Shape: 6 development cases, 4 modes, budgets `1,5`, seeds `7,19,37`.
- Coverage: 36 case/budget/seed scorecards and 144 mode runs.
- Auto ties best on 34 of 36 rows.
- Auto is behind best only on `typed-footprint-pressure`: by `5` at `1s` seed `19` and by `20` at `5s` seed `7`.

Latest development `30s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-development-30s-seeds7-19-37-20260531T192916Z`.
- Shape: 6 development cases, 4 modes, budget `30`, seeds `7,19,37`.
- Coverage: 18 case/budget/seed scorecards and 72 mode runs.
- Auto ties best on all 18 rows.
- Auto mean wall-clock was `11.610s`; no Auto row exceeded the `30s` budget by more than 10%.

Latest development `120s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-development-120s-seeds7-19-37-20260531T195607Z`.
- Shape: 6 development cases, 4 modes, budget `120`, seeds `7,19,37`.
- Coverage: 18 case/budget/seed scorecards and 72 mode runs.
- Auto ties best on all 18 rows.
- Auto mean wall-clock was `23.524s`; the slowest Auto row was `107.284s`.
- No Auto row exceeded the `120s` budget by more than 10%.
- Development split now has current `1s/5s/30s/120s` coverage. An initial all-budget attempt was stopped after about seven minutes because the sequential command entered long CP-SAT rows before producing row-level artifacts.

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

Latest protected holdout fast-lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-fast-1s-5s-seeds7-19-37-20260531T191419Z`.
- Shape: 5 protected holdout cases, 4 modes, budgets `1,5`, seeds `7,19,37`.
- Coverage: 30 case/budget/seed scorecards and 120 mode runs.
- Auto ties best on 28 of 30 rows.
- Auto is behind best only at `1s`, seed `7`: `service-local-neighborhood` by `15` and `expansion-comparison-replay` by `35`.

Latest protected holdout `30s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-30s-seeds7-19-37-20260531T193849Z`.
- Shape: 5 protected holdout cases, 4 modes, budget `30`, seeds `7,19,37`.
- Coverage: 15 case/budget/seed scorecards and 60 mode runs.
- Auto ties best on all 15 rows.
- Auto mean wall-clock was `11.178s`; no Auto row exceeded the `30s` budget by more than 10%.

Latest protected holdout `120s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-120s-seeds7-19-37-20260531T201243Z`.
- Shape: 5 protected holdout cases, 4 modes, budget `120`, seeds `7,19,37`.
- Coverage: 15 case/budget/seed scorecards and 60 mode runs.
- Auto ties best on all 15 rows.
- Auto mean wall-clock was `14.484s`; the slowest Auto row was `28.283s`.
- No Auto row exceeded the `120s` budget by more than 10%.
- Protected holdout split now has current `1s/5s/30s/120s` coverage.

## Fresh Product Holdout Refresh

Current status: complete for the L0 fresh product holdout set through split-lane artifacts. These cases are in the product workflow corpus as holdout cases, but they should be refreshed separately before candidate claims. The 2026-05-31 durable split baseline covers the first three fresh rows; `fresh-manual-resume-neighborhood` was added on 2026-06-01 and now has focused `1s/5s` and `30s/120s` refresh artifacts.

```bash
FRESH_CASES=(
  fresh-multi-anchor-service-island
  fresh-typed-footprint-scarcity
  fresh-expansion-corridor-service
  fresh-manual-resume-neighborhood
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

Latest fresh holdout fast-lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-fast-1s-5s-seeds7-19-37-20260531T191827Z`.
- Shape: 3 fresh holdout cases, 4 modes, budgets `1,5`, seeds `7,19,37`.
- Coverage: 18 case/budget/seed scorecards and 72 mode runs.
- Auto ties best on 17 of 18 rows.
- Auto is behind best only on `fresh-multi-anchor-service-island` by `25` at `1s`, seed `7`.

Latest fresh manual-resume fast-lane refresh:

- Date: 2026-06-01.
- Artifact: `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-fast-1s-5s-seeds7-19-37-20260601T150511Z`.
- Shape: 1 fresh manual-resume holdout case, 4 modes, budgets `1,5`, seeds `7,19,37`.
- Coverage: 6 case/budget/seed scorecards and 24 mode runs.
- Replay validity: valid through `/api/layout/evaluate`, 0 validation errors, 0 population delta from reported layout.
- Auto reaches the hard population cap `790` on all 6 rows and keeps Auto on every budget-policy signal.
- Standalone LNS ties Auto at `1s` but falls to `635` on the `5s` rows; standalone CP-SAT is stable at `660`; Greedy is stable at `750`.
- Timing watch: Auto reaches the cap at `1s` but overruns wall clock on all three `1s` rows (`1.319s` to `2.035s`). Auto stays under the `5s` budget (`1.811s` to `1.998s`).
- Timing triage: `artifacts/product-corpus/2026-06-01/timing-fresh-manual-resume-auto-1s-cap-stop-seeds7-19-37-20260601T160520Z` keeps Auto at cap on all three `1s` rows after CP-SAT now stops on model upper-bound incumbents. Residual wall-clock overrun (`1.256s` to `1.832s`) is CP-SAT bridge/model-build overhead and is tracked as a separate runtime-SLA concern, not a population-quality blocker.

Latest fresh manual-resume long-lane refresh:

- Date: 2026-06-01.
- Artifact: `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-long-30s-120s-seeds7-19-37-20260601T151447Z`.
- Shape: 1 fresh manual-resume holdout case, 4 modes, budgets `30,120`, seeds `7,19,37`.
- Coverage: 6 case/budget/seed scorecards and 24 mode runs.
- Replay validity: valid through `/api/layout/evaluate`, 0 validation errors, 0 population delta from reported layout.
- Auto reaches the hard population cap `790` on all 6 rows and keeps Auto on every budget-policy signal.
- Standalone LNS stays below Auto: `660` on all `30s` rows and `725` on all `120s` rows. Standalone CP-SAT stays at `660`; Greedy stays at `750`.
- Timing: Auto stays well under both long budgets (`4.471s` to `5.029s` at `30s`; `7.198s` to `7.445s` at `120s`).

Latest fresh holdout `30s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-30s-seeds7-19-37-20260531T194631Z`.
- Shape: 3 fresh holdout cases, 4 modes, budget `30`, seeds `7,19,37`.
- Coverage: 9 case/budget/seed scorecards and 36 mode runs.
- Auto ties best on all 9 rows.
- Auto mean wall-clock was `10.228s`; no Auto row exceeded the `30s` budget by more than 10%.

Latest fresh holdout `120s` lane refresh:

- Date: 2026-05-31.
- Artifact: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-120s-seeds7-19-37-20260531T221202Z`.
- Shape: 3 fresh holdout cases, 4 modes, budget `120`, seeds `7,19,37`.
- Coverage: 9 case/budget/seed scorecards and 36 mode runs.
- Auto ties best on all 9 rows.
- Auto mean wall-clock was `13.899s`; the slowest Auto row was `16.456s`.
- No Auto row exceeded the `120s` budget by more than 10%.
- Fresh holdout split now has `1s/5s/30s/120s` coverage for all four L0 fresh rows through split-lane artifacts.

Current `30s` baseline coverage:

- Development, protected holdout, and fresh holdout `30s` lane refreshes cover all 15 product-corpus cases at seeds `7,19,37`.
- Coverage: 45 case/budget/seed scorecards and 180 mode runs.
- Auto ties best on all 45 `30s` rows.

Current full split-baseline coverage:

- Development, protected holdout, and fresh holdout split-lane refreshes cover all 15 product-corpus cases, all four modes, budgets `1,5,30,120`, and seeds `7,19,37`.
- Coverage: 180 case/budget/seed scorecards and 720 mode runs.
- Auto ties best on 175 of 180 rows.
- The five Auto gaps are short-budget rows only: `typed-footprint-pressure` at `1s` seed `19` and `5s` seed `7`, `service-local-neighborhood` at `1s` seed `7`, `expansion-comparison-replay` at `1s` seed `7`, and `fresh-multi-anchor-service-island` at `1s` seed `7`.
- Auto ties best on all `30s` and `120s` rows.
- Decision: keep the split artifacts as the durable current 15-case baseline. Do not create a single combined promotion-matrix artifact unless a release process explicitly requires one.

## Full Promotion-Matrix Refresh

Use this only when a release process explicitly requires one combined promotion-matrix artifact. The current durable baseline is the split artifact set listed above.

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

- 15 product workflow cases.
- 4 modes.
- 4 budgets.
- 3 seeds.
- 180 case/budget/seed scorecards.
- 720 mode runs.

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

Current registry status:

- The 2026-06-01 manual-resume fast-lane, long-lane, and focused timing-triage bundles are appended to `artifacts/experiments/index.jsonl`.
- The 2026-05-31 split-lane bundles and the June 1 manual-resume bundles together form the durable 15-case baseline.
- The focused timing-triage bundle is decision-grade diagnostics evidence for the manual-resume `1s` timing watch, not a default-path promotion artifact.

## Read Order

Review artifacts in this order:

1. `scorecard.txt`
2. `evidence-summary.json`
3. `workflow-replay.json`
4. `telemetry-manifest.json`
5. `registry-entry-draft.json`
6. `scorecard.json` only when row-level details are needed

Before interpreting candidate results, compare the refreshed baseline with the same-slice baseline-repeat envelope from [MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md](MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md).
