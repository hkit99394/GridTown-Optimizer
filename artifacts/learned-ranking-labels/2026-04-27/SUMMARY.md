# Low-Risk Learned Ranking Labels

Date: 2026-04-27

This artifact closes the label-collection gate before any learned ranking work. No model was trained and no solver defaults were changed.

## Label Counts

- Greedy labels: 4593
- Greedy connectivity-shadow labels: 888
- Greedy road-opportunity near-miss labels: 3705
- LNS replay labels: 84
- LNS usable labels: 84

## Splits

- Development Greedy cases: cap-sweep-mixed, service-local-neighborhood, step14-service-lookahead-reranker, row0-corridor-repair-pressure
- Holdout Greedy cases: fixed-service-realization-complete, geometry-occupancy-hot-path, typed-footprint-pressure, typed-availability-pressure
- Development LNS cases: compact-service-repair, seeded-service-anchor-pressure
- Holdout LNS cases: typed-housing-single, row0-anchor-repair
- Protected holdout: true

## Audit

- Schema version: 1
- Seeds: 7, 19, 37
- Learned model: none
- Greedy profile: enabled
- Greedy connectivity-shadow scoring: enabled only for label collection
- LNS replay state policy: initial-incumbent
- LNS candidate window policy: baseline-ranked-top-k
- LNS CP-SAT workers: 1

## Next Gate

Use these labels for offline ranking diagnostics only. Learned Greedy or LNS ranking remains gated on held-out offline metrics and equal-budget online benchmarks.
