# Middle-Run Evaluator-Validity Replay Check

Reviewed on 2026-06-01.

Use this check before treating product workflow evidence as promotion-grade. It clarifies which evidence proves replay compatibility, which evidence proves final-layout evaluator validity, and which claims still need a candidate-specific validation rerun.

This is an evidence posture check only. It does not promote solver behavior or change runtime defaults.

## Evidence Sources

- `artifacts/product-corpus/2026-05-31/baseline-development-fast-1s-5s-seeds7-19-37-20260531T190759Z/evidence-summary.json`
- `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-fast-1s-5s-seeds7-19-37-20260531T191419Z/evidence-summary.json`
- `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-fast-1s-5s-seeds7-19-37-20260601T150511Z/evidence-summary.json`
- `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-long-30s-120s-seeds7-19-37-20260601T151447Z/evidence-summary.json`
- `artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37/evidence-summary.json`
- `artifacts/service-master-shortlist/2026-05-27/service-master-evaluator-validity-5s-30s/service-master-evaluator-validity.json`
- `src/packages/benchmarks/crossModeProductWorkflows.ts`
- `src/tools/cli/crossModeBenchmarkArtifacts.ts`
- `scripts/generate-service-master-evaluator-validity.mjs`
- `tests/product-corpus-registry.test.cjs`

## Product Replay Compatibility

The current split-lane baseline covers 15 workflow cases across `auto`, `greedy`, `lns`, and `cp-sat`, budgets `1,5,30,120`, and seeds `7,19,37`. It includes 6 development cases and 9 holdout cases, of which 4 are L0 fresh product holdouts. The 2026-04-30 promotion artifact remains legacy 10-case context only.

Current product artifacts record replay metrics in `evidence-summary.json` and write standalone `workflow-replay.json` and `workflow-replay-telemetry-manifest.json` files through the product artifact writer. The replay harness materializes the reusable LNS seed hint, sends it through the manual layout evaluator path, and records validity, validation error count, reported population, evaluated population, road cleanup, and replay-vs-scorecard deltas.

| Replay Case                        | Split       | Workflow Tag           | API Route              | Scorecards | Valid | Population Delta | Road Cleanup | Current Signal                                                                                                |
| ---------------------------------- | ----------- | ---------------------- | ---------------------- | ---------- | ----- | ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `manual-layout-replay-warm-start`  | development | `manual-layout-replay` | `/api/layout/evaluate` | 12         | yes   | 0                | 1 road       | Replay is evaluator-compatible; evaluated population remains `160`.                                           |
| `expansion-comparison-replay`      | holdout     | `expansion-comparison` | `/api/layout/evaluate` | 12         | yes   | 0                | 2 roads      | Replay is evaluator-compatible; evaluated population remains `115`.                                           |
| `fresh-manual-resume-neighborhood` | holdout     | `manual-layout-replay` | `/api/layout/evaluate` | 12         | yes   | 0                | 4 roads      | Replay is evaluator-compatible; evaluated population remains `400`; Auto reaches hard cap `790` after resume. |

Current split-baseline replay metric signal:

- `replayCount`: 3 replay families, with `fresh-manual-resume-neighborhood` covered in fast and long lanes
- `validReplayCount`: all replay entries valid
- `invalidReplayCount`: 0
- `populationDeltaFromReported`: 0 for every replay entry
- `apiRoutes`: `/api/layout/evaluate`
- `budgetsSeconds`: `1,5,30,120`
- `seeds`: `7,19,37`
- `modes`: `auto`, `cp-sat`, `greedy`, `lns`

## Final-Layout Validity Coverage

The key distinction: product workflow replay metrics prove replay compatibility for replay workflow cases, but the general cross-mode scorecard rows are not a blanket final-layout validation certificate for every mode and row. Promotion reviews must not infer exact evaluator validity from score, road semantics, solver status, or CP-SAT status alone.

| Evidence Surface                  | Current Coverage                                                                                                              | Promotion Meaning                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Product cross-mode scorecards     | 15 cases, 4 modes, 4 budgets, 3 seeds, development plus protected and fresh holdout.                                          | Good score, cost, split, and workflow evidence; not enough by itself to prove every final layout passed the exact evaluator.  |
| Product workflow replay metrics   | 3 replay families through `/api/layout/evaluate`; all valid, 0 validation errors, 0 population delta.                         | Enough to block replay-incompatible claims for manual layout, manual resume, and expansion replay workflows.                  |
| Service-master evaluator validity | 120 Greedy rows over product workflow development/holdout, policies `baseline` and `service-master-shortlist`, budgets 5/30s. | Covers that diagnostics-only branch: 120/120 valid, 0 invalid rows, 0 population mismatches, max absolute population delta 0. |
| Future solver candidate           | Candidate-specific final-layout coverage must be added or rerun for affected modes, policies, cases, budgets, and seeds.      | Required before any default-path promotion claim, especially for Auto, LNS, CP-SAT, portfolio, or learned guidance changes.   |

The service-master evaluator-validity artifact summary is:

- `rowCount`: 120
- `validCount`: 120
- `invalidCount`: 0
- `populationMismatchCount`: 0
- `maxAbsPopulationDeltaFromEvaluator`: 0
- `totalPopulation`: 45810
- `recomputedTotalPopulation`: 45810

## Block Rules

Block product workflow promotion claims when any of these are true:

1. A replay workflow claim lacks replay metrics. Fresh product runs should have `workflow-replay.json` and `workflow-replay-telemetry-manifest.json`; legacy bundles must have equivalent replay metrics in `evidence-summary.json` plus registry metadata.
2. `validReplayCount` is less than `replayCount`, `invalidReplayCount` is greater than 0, any replay `validationErrorCount` is greater than 0, or any replay `populationDeltaFromReported` is nonzero.
3. A candidate changes final layouts but has no evaluator-validity rerun or scorecard extension that validates the affected final layouts through the core evaluator.
4. Any evaluator-validity row is invalid, has a population mismatch, or has nonzero max absolute population delta from the evaluator.
5. The claim relies only on scorecard population, road semantics, solver status, CP-SAT status, or optimistic capacity gaps as proof of final-layout validity.
6. The artifact bundle is missing command, commit, hardware, split, case, budget, seed, mode, and decision metadata.

## Rerun Shape

Build first:

```bash
npm run build
```

Replay compatibility smoke:

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
ARTIFACT_DIR="artifacts/product-corpus/${RUN_DATE}/replay-validity-smoke-${RUN_STAMP}"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --product-artifact-dir="${ARTIFACT_DIR}" \
  --product-run-id="product-corpus-replay-validity-smoke-${RUN_STAMP}" \
  --product-decision=benchmark-refresh-replay-validity-smoke \
  '--product-summary=Replay-validity smoke over product workflow replay and manual-resume cases; no solver default changed.' \
  --modes=auto,greedy,lns,cp-sat \
  --budgets=1 \
  --seeds=7 \
  --json \
  manual-layout-replay-warm-start \
  expansion-comparison-replay \
  fresh-manual-resume-neighborhood
```

Service-master evaluator-validity rerun:

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
ARTIFACT_DIR="artifacts/service-master-shortlist/${RUN_DATE}/service-master-evaluator-validity-5s-30s-${RUN_STAMP}"

node scripts/generate-service-master-evaluator-validity.mjs \
  --artifact-dir="${ARTIFACT_DIR}" \
  --budgets=5,30 \
  --seeds=7,19,37 \
  --run-id="service-master-evaluator-validity-${RUN_STAMP}" \
  --decision=diagnostics-only-no-default-promotion \
  '--summary=Service-master evaluator-validity rerun over product workflow development and protected holdout cases; no solver default changed.'
```

For any candidate outside the service-master Greedy branch, use an equivalent evaluator-validity harness or extend the product scorecard artifact so every affected final layout records exact evaluator validity, validation error count, reported population, recomputed population, and population delta.

## Decision

M7 is satisfied as a middle-run evidence check. Current 15-case product artifacts report replay compatibility clearly enough to block invalid replay claims, and the service-master diagnostics branch has explicit evaluator-validity evidence. Future default-path solver candidates still require candidate-specific final-layout evaluator validity before promotion.
