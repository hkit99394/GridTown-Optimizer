# CP-SAT NoOverlap2D Candidate Closeout

Date: 2026-05-30

Candidate: `cp-sat-no-overlap2d-preflight`

Status: diagnostics-only; blocked from promotion

Runtime default changed: no

## Scope

This closeout covers the first M9 opt-in CP-SAT geometry candidate from [M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md).

Implemented opt-in surfaces:

- CP-SAT option: `cpSat.useNoOverlap2d`.
- Product scorecard CLI flag: `--cp-sat-no-overlap2d`.
- Candidate evaluator-validity CLI flag: `--cp-sat-no-overlap2d`.

The option replaces the current per-cell occupancy encoding with OR-Tools `NoOverlap2D` optional rectangles for roads, services, and residential candidates. Defaults remain unchanged.

## Evidence Run

Focused M9 slice:

- Cases: `road-semantics-service-pressure`, `manual-layout-replay-warm-start`, `typed-footprint-pressure`, `road-semantics-gate-choke`, `multi-anchor-road-components`, `expansion-comparison-replay`, `fresh-multi-anchor-service-island`, `fresh-typed-footprint-scarcity`.
- Splits: 3 development rows and 5 holdout/fresh rows.
- Mode: `cp-sat`.
- Budgets: `1,5`.
- Seeds: `7,19,37`.

Controls:

- Baseline scorecard: current CP-SAT encoding.
- Baseline repeat: current CP-SAT encoding, same slice.
- Candidate scorecard: same slice with `--cp-sat-no-overlap2d`.
- Evaluator-validity: same slice with `--cp-sat-no-overlap2d`.
- Focused rerun: `expansion-comparison-replay`, budget `1`, seed `37`, with `--cp-sat-no-overlap2d`.

Raw scorecard bundles were kept temporary and are intentionally not durable roadmap artifacts. This closeout records the small summary needed for the decision.

Commands used:

```bash
npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir=artifacts/tmp-cp-sat-no-overlap2d-baseline \
  --product-run-id=cp-sat-no-overlap2d-baseline \
  --product-decision=baseline-control \
  '--product-summary=CP-SAT baseline focused M9 slice for NoOverlap2D comparison.' \
  --force-artifact-dir \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  road-semantics-service-pressure \
  manual-layout-replay-warm-start \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity

npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir=artifacts/tmp-cp-sat-no-overlap2d-baseline-repeat \
  --product-run-id=cp-sat-no-overlap2d-baseline-repeat \
  --product-decision=baseline-repeat-control \
  '--product-summary=CP-SAT baseline repeat focused M9 slice for NoOverlap2D comparison.' \
  --force-artifact-dir \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  road-semantics-service-pressure \
  manual-layout-replay-warm-start \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity

npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir=artifacts/tmp-cp-sat-no-overlap2d-candidate \
  --product-run-id=cp-sat-no-overlap2d-candidate \
  --product-decision=candidate-diagnostics \
  '--product-summary=CP-SAT NoOverlap2D opt-in focused M9 slice; no solver default changed.' \
  --force-artifact-dir \
  --cp-sat-no-overlap2d \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  road-semantics-service-pressure \
  manual-layout-replay-warm-start \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity

npm run evidence:candidate-evaluator-validity -- \
  --artifact-dir=artifacts/tmp-cp-sat-no-overlap2d-validity \
  --candidate-id=cp-sat-no-overlap2d-preflight \
  --run-id=candidate-evaluator-validity-cp-sat-no-overlap2d-preflight \
  --decision=candidate-evaluator-validity \
  '--summary=CP-SAT NoOverlap2D preflight final-layout evaluator-validity run; no solver default changed.' \
  '--fresh-holdout-note=Uses L0 fresh holdout cases fresh-multi-anchor-service-island and fresh-typed-footprint-scarcity before promotion claims.' \
  --cp-sat-no-overlap2d \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --cases=road-semantics-service-pressure,manual-layout-replay-warm-start,typed-footprint-pressure,road-semantics-gate-choke,multi-anchor-road-components,expansion-comparison-replay,fresh-multi-anchor-service-island,fresh-typed-footprint-scarcity \
  --force-artifact-dir

npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir=artifacts/tmp-cp-sat-no-overlap2d-focused-regression \
  --product-run-id=cp-sat-no-overlap2d-focused-regression \
  --product-decision=focused-regression-rerun \
  '--product-summary=Focused candidate rerun for expansion-comparison-replay budget 1 seed 37 regression check.' \
  --force-artifact-dir \
  --cp-sat-no-overlap2d \
  --modes=cp-sat \
  --budgets=1 \
  --seeds=37 \
  expansion-comparison-replay
```

## Results

Evaluator-validity passed:

- Rows: 48.
- Valid rows: 48.
- Invalid rows: 0.
- Population mismatches: 0.

Baseline-repeat was stable for population:

- Rows: 48.
- Baseline-repeat population deltas: 48 ties.

Candidate population versus baseline:

- Ties: 44 rows.
- Improvements: 3 rows (`+15`, `+20`, `+35`).
- Regressions: 1 row (`-70`).

Repeated blocker row:

| Case                          | Split   | Budget | Seed | Baseline | Baseline repeat | Candidate | Focused candidate rerun |
| ----------------------------- | ------- | ------ | ---- | -------- | --------------- | --------- | ----------------------- |
| `expansion-comparison-replay` | holdout | 1      | 37   | 780      | 780             | 710       | 710                     |

The blocker row also moved from exact gap `0` on both baseline controls to exact gap `70` on the candidate and focused candidate rerun.

Status movement:

- Baseline and baseline repeat: 29 `OPTIMAL`, 19 `FEASIBLE`.
- Candidate: 30 `OPTIMAL`, 18 `FEASIBLE`.
- Positive status movement exists, but it does not offset the protected holdout population regression.

Timing and model-size movement versus baseline repeat:

- Median wall-clock delta: `+2.9%`.
- Mean wall-clock delta: `+3.5%`.
- Median time-to-best delta: `+26.9%`.
- Mean time-to-best delta: `+56.7%`.
- Median constraint-count delta: `+359`.
- Mean constraint-count delta: `+251.4`.

## Decision

Do not promote `cpSat.useNoOverlap2d` to Auto, default CP-SAT, LNS repair, or portfolio paths.

Rationale:

- Final layouts are valid, so the encoding is usable as an opt-in diagnostic.
- The candidate has a repeatable protected holdout population regression.
- Time-to-best is worse in aggregate.
- Model size increases materially because optional interval constraints replace the compact per-cell occupancy encoding.

Keep the option available only for future diagnostics. Any renewed CP-SAT geometry candidate should require a different hypothesis, such as a hybrid or selectively applied encoding, and must start from the same baseline-repeat and evaluator-validity gates.

## Next Action

Move on from this candidate. The next long-run candidate should be selected from the roadmap gated priorities only if its trigger is satisfied and it has a fresh intake with development, protected holdout, fresh holdout, evaluator-validity, CPU/time-to-best, and artifact-policy coverage before implementation.
