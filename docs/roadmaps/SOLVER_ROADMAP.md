# Solver Roadmap

## Goal

Maximize feasible city population under fixed wall-clock and CPU budgets, while preserving exact validation for every reported final layout.

The current strategy is intentionally conservative:

- Keep `auto` as the default quality path.
- Use Greedy for fast incumbents and diagnostics.
- Use LNS as the main improvement engine.
- Use CP-SAT for exact repair, polish, proof, bounds, labels, and semantic checks.
- Promote learned guidance, portfolio, GPU, distributed solving, or external solvers only after protected equal-budget evidence says they help.

Primary metrics are time to first feasible, population at 1s/5s/30s/120s, time to best, improvement per CPU-second, CP-SAT status/gap, repeatability across fixed seeds and planner workflows, and exact validation.

## Runtime Posture

The default solver path is incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof.
4. `auto` orchestrates the budget and keeps the best incumbent.

| Mode             | Role                           | Default Use                                                     |
| ---------------- | ------------------------------ | --------------------------------------------------------------- |
| `auto`           | Main quality path              | Recommended solver mode                                         |
| `greedy`         | Fast incumbent and diagnostics | Seed generation, baseline, counterfactual traces                |
| `LNS`            | Main improvement engine        | Adaptive repair around incumbent layouts                        |
| `CP-SAT`         | Exact backend                  | Small proofs, local repairs, bounded polishing, semantic checks |
| CP-SAT portfolio | Explicit research mode         | Only after CPU-normalized wins over single CP-SAT               |
| Learned guidance | Future feature-flag path       | Only after offline and online holdout gates pass                |

## Current Baseline

Completed details live in [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md). The short version:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- Planner workflows now cover solve, inspect, edit, validate, reuse, explainability maps, saved layouts, and expansion comparison.
- CP-SAT road semantics are aligned with the formal per-component anchor rule, and the 2026-04-30 road-semantics scorecard reached `OPTIMAL` on the six-case single-worker suite.
- LNS has adaptive semantic operators, replay labels, budget controls, and telemetry.
- Auto uses trace-tuned LNS budget defaults while preserving the measured `0.2` CP-SAT reserve default and explicit caller overrides.
- Cross-mode scorecards, product-corpus artifacts, telemetry manifests, workflow replay artifacts, and experiment-registry draft paths exist for promotion evidence.
- The promotion-grade product corpus keeps Auto as the right default posture: 116/120 budget-policy signals keep Auto, while the remaining misses are short-budget evidence targets rather than default-policy regressions.
- Low-risk learned-ranking labels and a CPU-first Greedy offline ranker exist for diagnostics only. No learned runtime scorer has been promoted.
- CP-SAT portfolio, exact small-window DP repair, and service-master decomposition remain guarded or opt-in; they are not default Auto behavior.

## Active Priorities

The current active priority is an evidence-only tranche: strengthen LNS replay labels and deterministic opportunity features so the next learned or budget-policy gate can be evaluated fairly.

This priority does not change solver defaults, does not promote learned guidance, and does not widen CP-SAT portfolio use. It exists to collect the missing promotion evidence around the only current short-budget gaps.

### 1. Strict LNS replay labels and feature payloads

Impact: highest near-term enabling value

Why:

- LNS is the main improvement engine after Greedy, and the strongest current seam for guided search is choosing which repair window to try next.
- Existing replay labels are schema-valid but not promotion-ready; holdout signal is still too neutral for learned window ranking.
- CP-SAT is already the exact repair, proof, gap, and label backend, so it should be used to generate trustworthy counterfactual replay evidence before any scorer is introduced.

Delivered so far:

- LNS replay labels now carry feature schema `2`, CP-SAT model fingerprints, model encoding/candidate-key metadata, model-size telemetry when available, wall-clock timing, observed CP-SAT user time, and configured worker CPU budget.
- Replay feature payloads now include connectivity-shadow, empty-graph fragmentation, and service/residential candidate-loss summaries alongside the existing window occupancy/headroom features.
- Learned-ranking label telemetry and registry drafts now preserve the LNS feature schema, CP-SAT worker count, CP-SAT model fingerprints, and an input fingerprint for replay-label evidence.
- Replay state policies are now explicit. Default label generation still uses `initial-incumbent`, while strict runs can request `initial-incumbent`, `post-first-improvement`, and `post-stagnation` with bounded state-collection iterations and a separate CP-SAT repair budget.
- `lnsBenchmarkCli` and `learnedRankingLabelCli` expose the state-policy and state-collection knobs, and label telemetry/snapshots carry requested and captured state policies.
- Learned-ranking label generation now has a `strict-lns-replay` preset that records the preset in audit/registry metadata and applies the strict three-state replay policy with the standard three fixed seeds unless the caller explicitly overrides them.
- LNS replay-label readiness now reports required, captured, and missing replay state policies at both split and pressure-family level; the strict preset enables the three-state coverage gate so artifact readiness fails clearly if a requested state is absent.
- The strict artifact bundle `strict-lns-replay-labels-2026-05-04` is generated and registered under `artifacts/learned-ranking-labels/2026-05-04/strict-lns-replay-labels/` with 4,677 Greedy labels, 1,146 LNS replay labels, protected holdout, feature schema `2`, CP-SAT worker count `1`, seeds `7`, `19`, and `37`, strict three-state replay policy, and label fingerprint `fnv1a:03ab1acf`.
- The first strict bundle is evidence-only and did not pass readiness: development missed the neutral-ratio gate at `0.894`, and holdout had 0 non-neutral labels with no captured `post-first-improvement` state in any LNS pressure family.
- Replay-label corpus cases without curated seed hints now use a minimal valid anchor-road seed for label collection only; the normal LNS benchmark corpus remains unchanged, but strict replay can collect post-improvement states from intentionally weak incumbents.
- The follow-up bundle `strict-lns-replay-labels-2026-05-04-replay-seed-v2` is generated and registered under `artifacts/learned-ranking-labels/2026-05-04/strict-lns-replay-labels-replay-seed-v2/` with 4,677 Greedy labels, 1,545 LNS replay labels, protected holdout, feature schema `2`, CP-SAT worker count `1`, seeds `7`, `19`, and `37`, all three requested replay states captured in every pressure family, label fingerprint `fnv1a:850a26f9`, and LNS scale readiness passing.
- The passing strict bundle clears the label-scale gate: development has 810 usable LNS labels, 333 non-neutral labels, and neutral ratio `0.589`; holdout has 735 usable LNS labels, 363 non-neutral labels, and neutral ratio `0.506`.
- Offline LNS window-ranking baseline tooling now evaluates recorded replay decisions without running CP-SAT, reports improvement capture, hit@1, hit@k, regret, split/family/state breakdowns, telemetry, and registry drafts via `benchmark:lns-ranker`.
- The registered baseline sweep `lns-window-ranker-baselines-2026-05-04-strict-replay-seed-v2` shows useful holdout ranking signal but sets a high non-learned bar: current operator score captures `0.6307` of available holdout improvement, stable random captures `0.6429`, candidate-loss captures `0.7084`, and the best simple baseline, fragmentation, captures `0.7765` with hit@1 `0.6154`.
- CPU-first LNS window-ranker tooling now trains a linear pairwise replay model from the strict label bundle without running CP-SAT, writes model/telemetry/registry artifacts via `benchmark:lns-window-ranker`, and remains diagnostics-only with no runtime hook or solver default change.
- The registered ranker artifact `lns-window-ranker-2026-05-04-strict-replay-seed-v2` is generated under `artifacts/lns-window-ranker/2026-05-04/strict-replay-seed-v2-cpu-ranker/` with model fingerprint `fnv1a:2d6b2b9f`, dataset fingerprint `fnv1a:1c1cb973`, and label fingerprint `fnv1a:850a26f9`. It beats the best fragmentation baseline on protected holdout: model capture `0.8780` versus `0.7765`, delta `+0.1015`, hit@1 `0.6154`, hit@k `0.7692`, and mean regret `29.62`.
- LNS now has an opt-in `lns.windowRanker` runtime hook for online experiments. It accepts the offline linear model shape, scores candidate repair windows after the existing adaptive baseline selector runs, records per-outcome selection telemetry, and falls back to the deterministic selector when disabled or when `minScoreDelta` is not cleared. Solver defaults remain unchanged.
- LNS window-ranker online A/B tooling now exists behind `lnsBenchmarkCli --window-ranker-online-ablation --window-ranker-model=<model.json>`. It runs the same selected replay-pressure cases, seeds, Greedy/CP-SAT options, and LNS repair budgets for the deterministic selector and the opt-in ranker, then reports population deltas, wall-clock deltas, win/regression rates, ranker decisions, overrides, fallbacks, and model fingerprints. The companion `--window-ranker-threshold-sweep` mode compares multiple `minScoreDelta` values and reports top mean-delta and no-regression thresholds.
- Preliminary online A/B runs over the default replay-pressure corpus with seeds `7`, `19`, and `37` produced useful but threshold-sensitive signal. With `minScoreDelta=0`, the ranker improved 12/30 comparisons, regressed 3/30, left 15/30 unchanged, raised mean population by `+42.5`, and had worst delta `-165` on `lns-gate-side-channel-pressure`. A targeted threshold sweep on that regression family found `0` and `0.05` unsafe, while `0.1`, `0.15`, and `0.2` all fell back safely.
- Online LNS window-ranker A/B artifacts and registry drafts now exist for calibrated scorecards. The registered scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-min-score-delta-0-1` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-min-score-delta-0.1/` with model fingerprint `fnv1a:2d6b2b9f`, seeds `7`, `19`, and `37`, `minScoreDelta=0.1`, 30 equal-budget comparisons, 60 total runs, and no solver default change. It improved mean population by `+17.667`, improved 4/30 comparisons, regressed 0/30, left 26/30 unchanged, had worst delta `0`, mean wall-clock delta `-0.014s`, and recorded 18 overrides plus 39 fallback decisions. This is calibrated replay-pressure evidence, not protected holdout promotion evidence.
- A five-case independent online holdout corpus now exists behind `lnsBenchmarkCli --window-ranker-protected-holdout`, covering corridor, gate, footprint, service, and anchor-service pressure families with fresh case names. The registered protected scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-protected-holdout-min-score-delta-0-1` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-protected-holdout-min-score-delta-0.1/` with model fingerprint `fnv1a:2d6b2b9f`, seeds `7`, `19`, and `37`, `minScoreDelta=0.1`, 15 equal-budget comparisons, 30 total runs, protected holdout metadata, and no solver default change. It was safe but neutral: mean population delta `0`, 0/15 improved, 0/15 regressed, 15/15 unchanged, worst delta `0`, mean wall-clock delta `+0.073s`, 24 overrides, and 6 fallback decisions. This blocks promotion until protected holdout quality lift appears.

Concrete work:

- Check whether weak-seed replay labels need weighting, stratification, or a separate diagnostic flag before any online scorer consumes them.
- Improve protected online signal before any feature flag: inspect why 24 protected holdout overrides were population-neutral, then update labels/features/model or candidate coverage before rerunning protected holdout.
- Expose the same feature payload shape in broader traces, benchmark summaries, and planner explainability surfaces where useful.

Exit criteria:

- At least 5 pressure families in both development and holdout coverage.
- At least 200 usable labels and 50 non-neutral usable labels in each split.
- No pressure family with fewer than 20 usable labels.
- Neutral-label ratio below 85% in both development and holdout.
- Exact evaluator validation for every reported repaired layout.
- Registered artifact metadata includes command, git commit, hardware, split, budget, CP-SAT formulation/model fingerprint, and decision status.

### 2. Short-budget Auto gap triage

Impact: medium, evidence-only

Why:

- The promotion corpus shows Auto is broadly healthy, but a few 1s/5s rows still lose to standalone LNS or CP-SAT.
- These misses should be diagnosed before changing Auto stage budgets or default policies.

Concrete work:

- Re-run focused budget-ablation slices on the known short-budget miss families.
- Compare baseline, LNS-heavy, and CP-SAT-reserve-heavy policies under equal wall-clock budgets and fixed seeds.
- Treat outcomes as evidence for future policy work only; do not change Auto defaults without clearing the promotion gates below.

Exit criteria:

- A registered artifact explains whether the misses are seed quality, LNS repair allocation, CP-SAT reserve, or case-specific saturation effects.
- Any proposed Auto policy change has protected development and holdout evidence, worst-decile safety, and CPU-budget efficiency reporting.

## Gated Priorities

These are not next actions by default. They become active only when their trigger is satisfied.

| Trigger                                                                                        | Candidate Work                                         | Success Signal                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-SAT semantics and product corpus stay stable, and exact search quality remains a bottleneck | Geometry-native CP-SAT / `NoOverlap2D` experiment      | Better propagation or time-to-best without model-size blowup.                                                                                        |
| Service-master scorecards show repeatable equal-budget wins                                    | Promote service-master into Auto or Greedy seed policy | Beats current Auto or Greedy seed path on development and holdout pressure families with evaluator-valid layouts.                                    |
| Strict LNS label artifacts pass readiness and offline baselines                                | Learned LNS window ranking                             | Offline holdout beats deterministic, random, and single-feature baselines; online A/B improves fixed-budget quality without worst-decile regression. |
| Greedy offline ranker evidence is paired with online equal-budget wins                         | Feature-flagged learned Greedy re-ranking              | Online seeded benchmarks improve population or time-to-best with bounded inference overhead.                                                         |
| Portfolio scorecards show wall-clock and CPU-normalized wins                                   | CP-SAT portfolio in Auto                               | Portfolio beats single CP-SAT on quality and CPU efficiency.                                                                                         |
| A CPU-first label, training, feature, or inference workflow becomes a measured bottleneck      | GPU acceleration                                       | GPU reduces the measured bottleneck while preserving solver quality gates.                                                                           |
| Hosted or multi-user execution becomes a product requirement                                   | Durable worker architecture                            | Status, cancellation, and snapshots survive process restarts and multi-instance routing.                                                             |
| Exact bounds or incumbents remain blocked after CP-SAT tuning                                  | External MILP/SCIP/Gurobi/cuOpt research adapter       | Better bounds or incumbents on selected families under exact evaluator validation.                                                                   |

## Promotion Gates

Any default-path solver change must include:

- Exact validation for all final layouts.
- At least 3 fixed seeds.
- 1s, 5s, 30s, and 120s budget reporting when relevant.
- Protected development and holdout scorecards.
- Median population improvement, or equal population with at least 10% faster time-to-best.
- Worst-decile population delta `>= 0` unless a reviewed exception is documented.
- Regression rate `<= 5%`.
- CPU-budget efficiency no worse than 10% below baseline unless population improvement justifies it.
- Registered benchmark, hardware, split, command, model, artifact, and decision metadata.

## Guardrails

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity; solver backends and validators must agree.
- Final road cleanup should remove only roads that do not affect building access or anchor-boundary road connectivity.
- Auto LNS stages must preserve reserved CP-SAT time unless a future trace-backed policy changes that.
- Learned guidance is not ready until traces show repeated ranking mistakes and enough counterfactual labels exist.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism must be measured against both wall-clock and CPU-second cost.
- Distributed solving should wait until hosting requires durable jobs or single-machine policy is no longer the bottleneck.
