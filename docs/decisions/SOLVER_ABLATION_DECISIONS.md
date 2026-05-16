# Solver Ablation Decisions

Date: 2026-04-27

This closes the deterministic ablation evidence pass before model training. The decision below comes from seeded gate reports over the default Greedy and LNS ablation corpora.

## Commands

```bash
npm run build
node --input-type=module -e '... runGreedyDeterministicAblation(... seeds 7,19,37) ...'
node --input-type=module -e '... runLnsNeighborhoodAblation(... seeds 7,19,37) ...'
```

## Summary

- No deterministic variant is ready for default promotion.
- No `safe-deterministic-candidate` was produced, so no promotion holdout rerun is required for this pass.
- Greedy learning evidence exists only for connectivity-shadow scoring: it has isolated wins, zero population regressions, and positive mean wall-clock cost.
- LNS learning evidence exists for anchor/window variants that move selected windows without population regressions.
- May 2026 posture update: learned label and held-out evaluation infrastructure now exists, but promotion gates are track-specific. Greedy ordering needs fixed-budget online wins against the current ordering with inference overhead accounted; learned-LNS promotion remains parked until protected/fresh value coverage appears or a materially different model class is proposed through the consolidated solver roadmap.

## Greedy Decisions

Coverage: 9 cases x 3 seeds = 27 comparisons.

| Variant                      | Decision           | Median Delta | Worst-Decile Delta | Best Delta | Regression Rate | Mean Wall Delta | Evidence                                                                                   |
| ---------------------------- | ------------------ | -----------: | -----------------: | ---------: | --------------: | --------------: | ------------------------------------------------------------------------------------------ |
| baseline                     | keep-baseline      |            0 |                  0 |          0 |            0.0% |         0.0000s | Reference behavior.                                                                        |
| no-restarts                  | keep-baseline      |            0 |                  0 |          0 |            0.0% |        -0.0053s | No population lift.                                                                        |
| no-local-search              | blocked-regression |            0 |                -55 |          0 |           33.3% |        -0.0116s | Worst: `service-local-neighborhood/7`.                                                     |
| no-service-neighborhood      | blocked-regression |            0 |                -55 |          0 |           33.3% |        -0.0056s | Worst: `service-local-neighborhood/7`.                                                     |
| no-service-refinement        | keep-baseline      |            0 |                  0 |          0 |            0.0% |        -0.0186s | No population lift.                                                                        |
| no-exhaustive-service-search | keep-baseline      |            0 |                  0 |          0 |            0.0% |        -0.0048s | No population lift.                                                                        |
| no-service-lookahead         | blocked-regression |            0 |                -35 |          0 |           11.1% |        -0.0048s | Worst: `step14-service-lookahead-reranker/7`.                                              |
| explicit-roads               | blocked-regression |            0 |                -80 |          0 |           11.1% |        -0.0040s | Worst: `deferred-road-packing-gain/7`.                                                     |
| deferred-roads               | blocked-regression |          -65 |               -310 |          0 |           77.8% |        -0.0446s | Worst: `geometry-occupancy-hot-path/7`.                                                    |
| connectivity-shadow-scoring  | learning-target    |            0 |                  0 |       +115 |            0.0% |        +0.0956s | Best: `cap-sweep-mixed/7`; needs ordering labels and fixed-budget checks before promotion. |

## LNS Decisions

Coverage: 4 cases x 3 seeds = 12 comparisons.

| Variant                       | Decision           | Median Delta | Worst-Decile Delta | Best Delta | Regression Rate | Mean Wall Delta | Window Movement | Evidence                                                                         |
| ----------------------------- | ------------------ | -----------: | -----------------: | ---------: | --------------: | --------------: | --------------: | -------------------------------------------------------------------------------- |
| baseline                      | keep-baseline      |            0 |                  0 |          0 |            0.0% |         0.0000s |            0.0% | Reference behavior.                                                              |
| sliding-only                  | blocked-regression |            0 |               -100 |          0 |           25.0% |        -0.0150s |          100.0% | Worst: `seeded-service-anchor-pressure/7`.                                       |
| weak-service-first            | learning-target    |            0 |                  0 |          0 |            0.0% |        +0.0462s |           50.0% | Moves windows without population regression; collect counterfactual labels.      |
| residential-opportunity-first | learning-target    |            0 |                  0 |          0 |            0.0% |        -0.0262s |          100.0% | Moves windows without population regression; collect counterfactual labels.      |
| frontier-congestion-first     | learning-target    |            0 |                  0 |          0 |            0.0% |        +0.0001s |           50.0% | Moves windows without population regression; collect counterfactual labels.      |
| placed-buildings-first        | keep-baseline      |            0 |                  0 |          0 |            0.0% |        +0.0303s |            0.0% | No population lift or window movement.                                           |
| small-2x2                     | learning-target    |            0 |                  0 |          0 |            0.0% |        -0.0536s |          100.0% | Changes window geometry; collect counterfactual labels before using for ranking. |
| wide-4x4                      | learning-target    |            0 |                  0 |          0 |            0.0% |        -0.0211s |          100.0% | Changes window geometry; collect counterfactual labels before using for ranking. |

## Closeout

The deterministic ablation priority is complete as an evidence gate:

- Components that regress are blocked from promotion.
- Components that tie baseline stay deterministic or default-off.
- Components with isolated wins or window movement become label-collection targets, not learned-model changes.

This April follow-up plan is superseded by the May 2026 consolidated posture:

1. Greedy ordering labels, LNS replay labels, and held-out evaluation plumbing now exist for diagnostics.
2. Do not promote learned guidance by default from those diagnostics alone.
3. Reopen Greedy ordering promotion only with fixed-budget online wins against the current ordering and accounted inference overhead.
4. Reopen learned-LNS promotion only with new protected/fresh value coverage or a materially different model class.
