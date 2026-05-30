# Middle-Run CPU And Time-To-Best Review

Reviewed on 2026-05-30.

Use this review before interpreting product workflow scorecards as promotion evidence. It summarizes where CPU-cost, wall-clock, first-feasible, and time-to-best fields live, what the current baseline artifact says, and which timing claims still need a fresh same-slice refresh.

This is an evidence review only. It does not promote solver behavior or change runtime defaults.

## Evidence Sources

- `artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37/scorecard.json`
- `artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37/evidence-summary.json`
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
| Fresh telemetry manifest          | Fresh product runs write `telemetry-manifest.json`                                  | Compact per-run timing, score, CPU, stage count, and stage telemetry.                                  | Required for new candidate evidence; the older 2026-04-30 bundle predates this standalone manifest.   |

## Current Product Baseline Summary

The current product promotion artifact covers:

- 10 workflow cases, split into 5 development and 5 protected holdout cases.
- 120 case/budget/seed scorecards.
- 480 mode runs across `auto`, `greedy`, `lns`, and `cp-sat`.
- Budgets `1,5,30,120` and seeds `7,19,37`.

Field completeness in `scorecard.json`:

| Field                                | Missing Rows | Notes                                                                                 |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------- |
| `wallClockSeconds`                   | 0/480        | Present for every mode run.                                                           |
| `workerCpuBudgetSeconds`             | 0/480        | Present for every mode run.                                                           |
| `timeToQuality.firstFeasibleAtMs`    | 0/480        | Present for every mode run.                                                           |
| `timeToQuality.bestScoreAtMs`        | 0/480        | Present for every mode run.                                                           |
| `observedWorkerCpuSeconds`           | 158/480      | Partial by design; Greedy has no observed CPU, CP-SAT has full observed CPU coverage. |
| Standalone `telemetry-manifest.json` | legacy gap   | Fresh product refreshes write it; the 2026-04-30 artifact predates the file.          |

Best-of-mode product case metrics from `evidence-summary.json`:

| Metric                   | Value           |
| ------------------------ | --------------- |
| Rows                     | 120             |
| Mean first feasible      | 0.024s          |
| Median first feasible    | 0.007s          |
| Max first feasible       | 0.161s          |
| Mean time to best        | 0.041s          |
| Median time to best      | 0.009s          |
| Max time to best         | 0.245s          |
| Auto equal to best       | 116/120         |
| Auto behind best         | 4/120           |
| Mean Auto delta to best  | 0.75 population |
| Worst Auto delta to best | 35 population   |

Mode-level aggregates from `scorecard.json`:

| Mode     | Runs | Mean Population | Mean Wall | Median Wall | Mean First Feasible | Mean Time To Best | Mean CPU Budget | Observed CPU Coverage | Mean Pop/CPU Budget |
| -------- | ---- | --------------- | --------- | ----------- | ------------------- | ----------------- | --------------- | --------------------- | ------------------- |
| `auto`   | 120  | 412.250         | 11.426s   | 7.167s      | 0.080s              | 4.828s            | 39.000s         | 110/120               | 127.241             |
| `greedy` | 120  | 376.500         | 0.054s    | 0.029s      | 0.042s              | 0.048s            | 39.000s         | 0/120                 | 116.872             |
| `lns`    | 120  | 410.958         | 7.631s    | 6.772s      | 0.028s              | 0.364s            | 39.000s         | 92/120                | 127.346             |
| `cp-sat` | 120  | 411.242         | 3.095s    | 0.664s      | 1.265s              | 1.265s            | 39.000s         | 120/120               | 126.099             |

Budget-level aggregates across all modes:

| Budget | Runs | Mean Wall | Mean First Feasible | Mean Time To Best | Mean Pop/CPU Budget |
| ------ | ---- | --------- | ------------------- | ----------------- | ------------------- |
| 1s     | 120  | 0.924s    | 0.124s              | 0.266s            | 400.158             |
| 5s     | 120  | 2.314s    | 0.259s              | 0.761s            | 80.575              |
| 30s    | 120  | 7.130s    | 0.517s              | 2.226s            | 13.456              |
| 120s   | 120  | 11.839s   | 0.515s              | 3.252s            | 3.369               |

Budget-allocation signal counts across 480 mode runs:

| Signal              | Count | Review Meaning                                                                      |
| ------------------- | ----- | ----------------------------------------------------------------------------------- |
| `under-used-budget` | 351   | Many rows finish early relative to the configured budget.                           |
| `over-budget`       | 70    | Some runs exceed the configured budget threshold; largest observed overrun is < 1s. |
| `steady`            | 47    | No obvious budget pressure from trace timing.                                       |
| `early-plateau`     | 11    | Best score arrived early, then spent a long tail without beating Auto.              |
| `late-improvement`  | 1     | Best score arrived late while matching or beating Auto.                             |

Rows where Auto is behind best-of-mode:

| Case                          | Split       | Budget | Seed | Best Mode | Auto Delta | First Feasible | Time To Best |
| ----------------------------- | ----------- | ------ | ---- | --------- | ---------- | -------------- | ------------ |
| `typed-footprint-pressure`    | development | 1s     | 19   | `lns`     | 20         | 0.105s         | 0.105s       |
| `typed-footprint-pressure`    | development | 5s     | 7    | `cp-sat`  | 20         | 0.100s         | 0.100s       |
| `service-local-neighborhood`  | holdout     | 1s     | 7    | `lns`     | 15         | 0.046s         | 0.048s       |
| `expansion-comparison-replay` | holdout     | 1s     | 7    | `lns`     | 35         | 0.000s         | 0.146s       |

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

M8 is satisfied as a middle-run evidence check. Promotion reviewers can now compare population gains against CPU budget, wall-clock, first-feasible, and time-to-best fields without starting from raw JSON bundles. The main remaining caution is that the 2026-04-30 product artifact is a legacy baseline bundle; new candidate evidence should be refreshed with the current product artifact writer so telemetry manifests are present.
