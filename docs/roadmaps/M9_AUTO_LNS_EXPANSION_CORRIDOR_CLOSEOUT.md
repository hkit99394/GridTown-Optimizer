# M9 Auto/LNS Expansion-Corridor Closeout

Date: 2026-05-31

Decision: diagnostics-only; keep runtime defaults unchanged

Intake: [M9_CANDIDATE_INTAKE_AUTO_LNS_EXPANSION_CORRIDOR.md](M9_CANDIDATE_INTAKE_AUTO_LNS_EXPANSION_CORRIDOR.md)

## Scope

This closeout covers the Auto/LNS expansion-corridor diagnostics lane opened after the CP-SAT geometry guard deliberately excluded fragmented expansion/corridor rows.

Candidate policies:

- `expansion-corridor-lns-repair-5s-guarded`
- `expansion-corridor-lns-seed-repair-5s-guarded`

Affected modes:

- `auto`
- `lns`

Focused cases:

- `development-expansion-corridor-service`
- `row0-corridor-repair-pressure`
- `expansion-comparison-replay`
- `fresh-expansion-corridor-service`
- `fresh-multi-anchor-service-island`

## Evidence

Primary artifact:

- `artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z`

Command:

```bash
npm run benchmark:scorecard -- \
  --product-corpus \
  --budget-ablation \
  --ablation-policies=baseline,baseline-repeat,expansion-corridor-lns-repair-5s-guarded,expansion-corridor-lns-seed-repair-5s-guarded \
  --modes=auto,lns \
  --budgets=5 \
  --seeds=7,19,37 \
  --artifact-dir=artifacts/cross-mode-budget-ablations/2026-05-31/expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z \
  --ablation-run-id=expansion-corridor-lns-seed-repair-5s-focused-20260531T180649Z \
  --ablation-decision=diagnostics-only-expansion-corridor-lns-seed-repair-5s \
  "--ablation-summary=Focused same-slice Auto/LNS baseline-repeat control for stronger expansion-corridor LNS seed/repair policy with development, protected, and fresh rows; no solver default changed." \
  --json \
  development-expansion-corridor-service \
  row0-corridor-repair-pressure \
  expansion-comparison-replay \
  fresh-expansion-corridor-service \
  fresh-multi-anchor-service-island
```

Focused matrix:

- Cases: 5.
- Policies: 4.
- Modes: `auto,lns`.
- Budget: `5s`.
- Seeds: `7,19,37`.
- Mode runs: 120.

## Result Summary

Top policy by Auto mean population: `baseline`, tied with `baseline-repeat`, `expansion-corridor-lns-repair-5s-guarded`, and `expansion-corridor-lns-seed-repair-5s-guarded`.

Baseline:

- Mean Auto population: `783`.
- Mean LNS population: `748.333`.
- Auto movement versus itself: `0`.

Stronger seed/repair policy:

- Applied Auto comparisons: 9 of 15.
- Mean Auto population delta versus baseline: `0`.
- Mean LNS population delta versus baseline: `0`.
- Auto regressions: 0.
- Rows inside baseline-repeat envelope: 15 of 15.
- Mean Auto wall-clock delta versus baseline: `-0.635s`.
- Mean Auto LNS stage: `2.695s`.
- Mean Auto CP-SAT stage: `0.871s`.

## Timing Interpretation

The stronger policy is useful timing diagnostics, not promotion evidence.

Per-case mean Auto timing under the stronger policy:

| Case                                     | Applied | Auto Population | Mean Auto Wall | Mean Auto Time To Best |
| ---------------------------------------- | ------- | --------------- | -------------- | ---------------------- |
| `development-expansion-corridor-service` | 3/3     | 800             | 2.695s         | 0.172s                 |
| `row0-corridor-repair-pressure`          | 3/3     | 330             | 2.096s         | 1.612s                 |
| `expansion-comparison-replay`            | 0/3     | 780             | 5.511s         | 4.352s                 |
| `fresh-expansion-corridor-service`       | 3/3     | 990             | 3.016s         | 2.153s                 |
| `fresh-multi-anchor-service-island`      | 0/3     | 1015            | 5.536s         | 3.179s                 |

Why this does not promote:

- The primary objective is still population.
- Population did not improve on any applied row.
- The protected rows where LNS loses to Auto remained losses.
- The fresh and development rows already tie or keep Auto at baseline population.
- The wall-clock improvement is below the promotion bar without population lift or a reviewed equal-population time-to-best claim across a broader matrix.

## Decision

Keep both policies available as opt-in diagnostics.

Do not change:

- Auto default policy.
- LNS default seed allocation.
- LNS default repair allocation.
- CP-SAT reserve policy.

Do not run a broad matrix for this candidate unless a new reproducible row shows population movement outside the baseline-repeat envelope.

## Follow-Up Trigger

Reopen this lane only if one of these appears:

- A fresh or protected expansion/corridor row where baseline Auto is behind best-of-mode and the policy improves final population.
- A product requirement that makes equal-population time-to-best a first-order target for this exact family.
- A different candidate with a sharper mechanism than seed/repair reallocation, such as changing repair neighborhood selection rather than only changing budget ratios.
