# Middle-Run CPU And Time-To-Best Review

Reviewed on 2026-06-01.

Use this review before interpreting product workflow scorecards as promotion evidence. It summarizes where CPU-cost, wall-clock, first-feasible, and time-to-best fields live, what the current baseline artifact says, and which timing claims still need a fresh same-slice refresh.

This is an evidence review only. It does not promote solver behavior or change runtime defaults.

## Evidence Sources

- `artifacts/product-corpus/2026-05-31/baseline-development-fast-1s-5s-seeds7-19-37-20260531T190759Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-development-30s-seeds7-19-37-20260531T192916Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-development-120s-seeds7-19-37-20260531T195607Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-fast-1s-5s-seeds7-19-37-20260531T191419Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-30s-seeds7-19-37-20260531T193849Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-120s-seeds7-19-37-20260531T201243Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-fast-1s-5s-seeds7-19-37-20260531T191827Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-30s-seeds7-19-37-20260531T194631Z/scorecard.json`
- `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-120s-seeds7-19-37-20260531T221202Z/scorecard.json`
- `src/packages/benchmarks/crossModeTypes.ts`
- `src/packages/benchmarks/crossModeTelemetry.ts`
- `src/packages/benchmarks/crossModeSignals.ts`
- `src/packages/benchmarks/crossModeFormatting.ts`
- `tests/optimizers/crossModeBenchmarkSuiteAssertions.cjs`
- `tests/product-corpus-registry.test.cjs`

## Field Inventory

Promotion reviewers should use these fields before opening raw trace bundles:

| Field                             | Location                                                                            | Meaning                                                                                                | Review Use                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Wall-clock time                   | `results[].wallClockSeconds`                                                        | Observed elapsed wall time for one mode/case/budget/seed run.                                          | Compare against fixed budgets and same-slice baseline-repeat controls.                                |
| Budget utilization                | `results[].budgetAllocationSignal`                                                  | Derived utilization, remaining budget, overrun, first improvement, best-score time, and budget signal. | Find over-budget, under-used, early-plateau, and late-improvement rows without reading traces.        |
| Worker CPU budget                 | `results[].workerCpuBudgetSeconds`                                                  | Budgeted worker CPU seconds. For current non-portfolio product runs this equals the wall-clock budget. | Use as the stable cross-mode CPU denominator.                                                         |
| Observed worker CPU               | `results[].observedWorkerCpuSeconds`                                                | Solver-reported user CPU when available, mainly CP-SAT and CP-SAT-backed stages.                       | Useful diagnostics, but partial; do not use as the only CPU comparison unless coverage is comparable. |
| Population per CPU budget         | `results[].populationPerWorkerCpuBudgetSecond`                                      | Final population divided by budgeted worker CPU seconds.                                               | Compare CPU-normalized quality at equal population or for portfolio claims.                           |
| Population per observed CPU       | `results[].populationPerObservedCpuSecond`                                          | Final population divided by observed worker CPU seconds when telemetry exists.                         | CP-SAT diagnostics only unless all compared rows have observed CPU.                                   |
| First feasible                    | `results[].timeToQuality.firstFeasibleAtMs` and telemetry `firstFeasibleSeconds`    | First scored feasible layout in the decision trace.                                                    | Blocks claims about fast planner feedback if missing or worse on protected rows.                      |
| Time to best                      | `results[].timeToQuality.bestScoreAtMs` and telemetry `bestScoreSeconds`            | First point where the run reached its final best score.                                                | Equal-population candidates need at least 10% faster time-to-best to matter.                          |
| First improvement and checkpoints | `results[].timeToQuality.firstImprovementAtMs`, `timeCheckpoints`, `qualityTargets` | Trace-derived quality progression.                                                                     | Diagnose whether the run improves late, plateaus early, or only reaches quality after the budget.     |
| Product case summary              | `evidence-summary.json` `caseMetrics[]`                                             | Best-of-mode first feasible, time-to-best, Auto score, best score, best mode, and exact-gap context.   | Start here for current product posture before reading per-mode rows.                                  |
| Fresh telemetry manifest          | Fresh product runs write `telemetry-manifest.json`                                  | Compact per-run timing, score, CPU, stage count, and stage telemetry.                                  | Required for new candidate evidence and present on the current 2026-05-31 split baseline artifacts.   |

## Current Product Baseline Summary

The current durable baseline is the 2026-05-31 split-lane product corpus. It covers all 14 workflow cases, all four modes, budgets `1,5,30,120`, and seeds `7,19,37`. Keep these split artifacts as the baseline unless a release process explicitly requires one combined promotion-matrix artifact.

- 14 workflow cases, split into 6 development cases and 8 holdout cases, including 3 fresh product holdout cases.
- 168 case/budget/seed scorecards.
- 672 mode runs across `auto`, `greedy`, `lns`, and `cp-sat`.
- Budgets `1,5,30,120` and seeds `7,19,37`.

The 2026-04-30 registered product promotion artifact remains legacy 10-case context. Do not use it as the current baseline for new candidate decisions.

Field completeness across the 2026-05-31 split-lane `scorecard.json` files:

| Field                                | Missing Rows | Notes                                                                                 |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------- |
| `wallClockSeconds`                   | 0/672        | Present for every mode run.                                                           |
| `workerCpuBudgetSeconds`             | 0/672        | Present for every mode run.                                                           |
| `timeToQuality.firstFeasibleAtMs`    | 0/672        | Present for every mode run.                                                           |
| `timeToQuality.bestScoreAtMs`        | 0/672        | Present for every mode run.                                                           |
| `observedWorkerCpuSeconds`           | 230/672      | Partial by design; Greedy has no observed CPU, CP-SAT has full observed CPU coverage. |
| Standalone `telemetry-manifest.json` | 0/9 bundles  | Present on each split-lane artifact bundle.                                           |

Best-of-mode product case metrics across the split baseline:

| Metric                   | Value            |
| ------------------------ | ---------------- |
| Rows                     | 168              |
| Auto equal to best       | 163/168          |
| Auto behind best         | 5/168            |
| Mean Auto delta to best  | 0.595 population |
| Worst Auto delta to best | 35 population    |

Mode-level aggregates from `scorecard.json`:

| Mode     | Runs | Mean Population | Mean Wall | Median Wall | Mean First Feasible | Mean Time To Best | Mean CPU Budget | Observed CPU Coverage | Mean Pop/CPU Budget |
| -------- | ---- | --------------- | --------- | ----------- | ------------------- | ----------------- | --------------- | --------------------- | ------------------- |
| `auto`   | 168  | 554.792         | 8.560s    | 5.508s      | 0.087s              | 3.961s            | 39.000s         | 146/168               | 171.676             |
| `greedy` | 168  | 518.929         | 0.082s    | 0.087s      | 0.051s              | 0.073s            | 39.000s         | 0/168                 | 161.084             |
| `lns`    | 168  | 550.804         | 5.664s    | 4.150s      | 0.044s              | 0.317s            | 39.000s         | 128/168               | 171.276             |
| `cp-sat` | 168  | 553.274         | 2.437s    | 1.026s      | 1.032s              | 1.044s            | 39.000s         | 168/168               | 170.063             |

Budget-level aggregates across all modes:

| Budget | Runs | Mean Wall | Mean First Feasible | Mean Time To Best | Mean Pop/CPU Budget |
| ------ | ---- | --------- | ------------------- | ----------------- | ------------------- |
| 1s     | 168  | 0.806s    | 0.146s              | 0.268s            | 542.738             |
| 5s     | 168  | 1.958s    | 0.240s              | 0.664s            | 108.613             |
| 30s    | 168  | 5.569s    | 0.403s              | 1.842s            | 18.197              |
| 120s   | 168  | 8.411s    | 0.426s              | 2.621s            | 4.551               |

Budget-allocation signal counts across 672 mode runs:

| Signal              | Count | Review Meaning                                                                     |
| ------------------- | ----- | ---------------------------------------------------------------------------------- |
| `under-used-budget` | 537   | Many rows finish early relative to the configured budget.                          |
| `over-budget`       | 85    | Some runs exceed the configured budget threshold; compare only on same-slice runs. |
| `steady`            | 31    | No obvious budget pressure from trace timing.                                      |
| `early-plateau`     | 19    | Best score arrived early, then spent a long tail without beating Auto.             |

Rows where Auto is behind best-of-mode:

| Case                                | Split       | Budget | Seed | Best Mode       | Auto Delta | First Feasible | Time To Best |
| ----------------------------------- | ----------- | ------ | ---- | --------------- | ---------- | -------------- | ------------ |
| `typed-footprint-pressure`          | development | 1s     | 19   | `lns`           | 5          | 0.111s         | 0.706s       |
| `typed-footprint-pressure`          | development | 5s     | 7    | `cp-sat`        | 20         | 2.938s         | 2.938s       |
| `service-local-neighborhood`        | holdout     | 1s     | 7    | `lns`           | 15         | 0.043s         | 0.380s       |
| `expansion-comparison-replay`       | holdout     | 1s     | 7    | `lns`           | 35         | 0.000s         | 0.754s       |
| `fresh-multi-anchor-service-island` | holdout     | 1s     | 7    | `lns`, `cp-sat` | 25         | 0.136s         | 0.623s       |

## Interpretation Rules

1. Treat population as the primary objective. Equal-population candidates need at least 10% faster time-to-best before timing alone is a promotion signal.
2. Interpret timing deltas only after the same-slice baseline-repeat control from `MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md`.
3. Use `workerCpuBudgetSeconds` and `populationPerWorkerCpuBudgetSecond` as the default CPU-normalized comparison because observed CPU is partial.
4. Use `observedWorkerCpuSeconds` only when both baseline and candidate have comparable observed CPU coverage.
5. For CP-SAT portfolio claims, require `portfolioEfficiencySignals` and a CPU-normalized win over single CP-SAT, not just a wall-clock win.
6. Block time-to-best claims when decision traces or `timeToQuality` fields are missing.
7. Treat `over-budget`, `late-improvement`, and `early-plateau` rows as focused rerun targets, not automatic promotion blockers.
8. Use fresh product refresh artifacts for candidate decisions because fresh runs include the standalone telemetry manifest.

## Reviewer Flow

1. Read `evidence-summary.json` first for product case metrics, Auto-vs-best rows, split coverage, exact-gap context, and replay context.
2. Read `scorecard.txt` for human-readable per-row timing, CPU-budget, progress, quality, and budget-allocation signals.
3. Open `scorecard.json` only when a row needs exact numeric fields or trace-derived timing.
4. For candidate comparisons, record mean population, worst-row population delta, mean wall-clock delta, time-to-best ratio, CPU-budget efficiency ratio, observed CPU coverage, and over-budget row count.
5. If the candidate is equal-population but faster, verify the time-to-best improvement is at least 10%, repeat-stable, and not paired with worse first-feasible behavior on protected holdout rows.

## Decision

M8 is satisfied as a middle-run evidence check. Promotion reviewers can now compare population gains against CPU budget, wall-clock, first-feasible, and time-to-best fields without starting from raw JSON bundles. The current 2026-05-31 split-lane baseline is the comparison baseline for new candidates; candidate-specific scorecards still need same-slice baseline-repeat controls and evaluator-validity evidence before promotion claims.
