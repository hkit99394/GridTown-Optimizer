# CP-SAT Road-Semantics Scorecard - 2026-04-30

## Purpose

Post-alignment evidence for the CP-SAT per-component anchored-road formulation. The run covers tiny, corridor, gate, service-pressure, multi-anchor, and dense saturated families under a fixed single-worker budget.

## Command

```bash
node dist/cpSatBenchmarkCli.js --road-semantics-scorecard --time-limit=5 --deterministic-time=5 --workers=1 --seed=7 --progress-interval=0.25
```

## Artifacts

- Scorecard text: `road-semantics-scorecard.txt`
- Scorecard JSON: `road-semantics-scorecard.json`

## Results

| Case | Status | Population | Bound | Gap | Wall s | Branches | Conflicts | Vars | Constraints | Flow edges |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| typed-housing-single | OPTIMAL | 110 | 110 | 0 | 0.785 | 200 | 0 | 118 | 269 | 48 |
| road-semantics-corridor-pressure | OPTIMAL | 480 | 480 | 0 | 0.633 | 2544 | 124 | 261 | 561 | 100 |
| road-semantics-gate-choke | OPTIMAL | 540 | 540 | 0 | 0.581 | 1744 | 32 | 235 | 511 | 92 |
| road-semantics-service-pressure | OPTIMAL | 740 | 740 | 0 | 2.144 | 36335 | 2408 | 407 | 751 | 120 |
| multi-anchor-road-components | OPTIMAL | 200 | 200 | 0 | 0.544 | 89 | 0 | 42 | 126 | 20 |
| road-semantics-dense-saturated | OPTIMAL | 980 | 980 | 0 | 3.383 | 62362 | 3183 | 332 | 611 | 98 |

## Decision

No road-semantics regression was observed in this single-worker scorecard. All cases reached OPTIMAL, the multi-anchor case retained 200 population, and dense/service-pressure watchpoints now expose branches, conflicts, wall time, and model-size counts for future comparisons.

## Notes

- This is a CP-SAT semantic scorecard, not a portfolio promotion signal.
- CPU budget is reported as one CP-SAT worker for five wall-clock seconds per case.
- CI confidence still depends on an OR-Tools-enabled Python runtime; default tests skip CP-SAT runtime checks when that runtime is missing.
