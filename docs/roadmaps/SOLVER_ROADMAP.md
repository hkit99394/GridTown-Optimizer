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
- LNS replay labels now support opt-in roll-forward final-score payloads via `--roll-forward-iterations` and `--roll-forward-repair-time`. When enabled, valid replay repairs are warm-started into a bounded LNS continuation, then each label records final population deltas from the incumbent, from the repaired seed, and versus the deterministic baseline-selected replay label. Learned-ranking label snapshots, telemetry manifests, registry drafts, and text summaries carry the roll-forward budget and label counts.
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
- Online A/B summaries, telemetry manifests, and registry drafts now include override outcome diagnostics. The registered diagnostic scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-protected-holdout-diagnostics-min-score-delta-0-1` confirms the neutral holdout pattern: 24 overrides cleared the `0.1` score-delta threshold, but only 6 override repairs improved an intermediate LNS step and 18 were neutral; final population still tied baseline on all 15 comparisons. The mean override score delta was about `0.168`, so the current model is confidently selecting many windows that do not create final-score lift on protected holdout.
- LNS window-ranker training now has an opt-in baseline tie-break mode (`--baseline-tie-break` / `training.baselineTieBreak`) that uses the deterministic baseline-selected label as the sole positive when it ties the best replay improvement. This is diagnostics-only and leaves existing model/runtime defaults unchanged.
- The registered tie-break ranker `lns-window-ranker-2026-05-04-strict-replay-seed-v2-baseline-tie-break` is generated under `artifacts/lns-window-ranker/2026-05-04/strict-replay-seed-v2-baseline-tie-break-cpu-ranker/` with model fingerprint `fnv1a:3dc354f1`. It improves offline protected holdout capture to `0.9350` versus the fragmentation baseline `0.7765` and the prior learned model `0.8780`; hit@1 rises to `0.7692`, hit@k to `0.9231`, and trained pair count drops from 5,270 to 2,660.
- The registered tie-break replay-pressure scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-baseline-tie-break-min-score-delta-0-1` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-baseline-tie-break-min-score-delta-0.1/`. At `minScoreDelta=0.1`, it improves mean population by `+34.667`, improves 10/30 comparisons, regresses 0/30, leaves 20/30 unchanged, and records 19 overrides plus 38 fallback decisions. Override diagnostics are sharper than the prior calibrated scorecard: 13 override repairs improved and 6 were neutral.
- The registered tie-break protected scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-baseline-tie-break-protected-holdout-min-score-delta-0-1` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-baseline-tie-break-protected-holdout-min-score-delta-0.1/`. It remains safe but neutral on independent protected holdout: mean population delta `0`, 0/15 improved, 0/15 regressed, 15/15 unchanged, 21 overrides, 9 fallbacks, 6 improved override repairs, and 15 neutral override repairs. This reduces ambiguous protected overrides but still blocks promotion because no final-score lift appears.
- Online LNS window-ranker artifacts now carry an explicit final-outcome payload that joins ranker override/fallback activity to final population status. The registered replay-pressure final-outcome scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-baseline-tie-break-final-outcome-min-score-delta-0-1` confirms durable calibration lift: override-bearing comparisons finished 10 improved, 3 neutral, 0 regressed, with mean final population delta `+80` among override-bearing comparisons. The registered protected final-outcome scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-baseline-tie-break-final-outcome-protected-holdout-min-score-delta-0-1` confirms the holdout gap: override-bearing comparisons finished 0 improved, 12 neutral, 0 regressed, with mean final delta `0`.
- The strict roll-forward label bundle `strict-lns-replay-labels-2026-05-04-replay-seed-v2-roll-forward-1x0-1` is generated under `artifacts/learned-ranking-labels/2026-05-04/strict-lns-replay-labels-replay-seed-v2-roll-forward-1x0.1/` with 4,677 Greedy labels, 1,545 LNS replay labels, one-iteration roll-forward coverage on all LNS replay labels, label fingerprint `fnv1a:5bc48690`, and dry-run registry validation only. Final-lift labels are mixed versus the deterministic baseline-selected replay label: development has 87 improved, 659 neutral, and 64 regressed labels; holdout has 168 improved, 480 neutral, and 87 regressed labels.
- LNS window-ranker training and baseline sweeps now support the opt-in target `roll-forward-final-lift` via `--final-lift-target` or `--target=roll-forward-final-lift`. The default target remains immediate replay improvement, so existing diagnostic behavior is unchanged unless a final-lift target is requested.
- The tuned final-lift ranker `lns-window-ranker-2026-05-04-strict-replay-seed-v2-roll-forward-1x0-1-final-lift-lr0-02-cap100` is generated under `artifacts/lns-window-ranker/2026-05-04/strict-replay-seed-v2-roll-forward-1x0.1-final-lift-cpu-ranker-lr0.02-cap100/` with model fingerprint `fnv1a:51fb7b72`, dataset fingerprint `fnv1a:23524ccc`, label fingerprint `fnv1a:5bc48690`, and dry-run registry validation only. It beats the final-lift fragmentation baseline offline: holdout capture `0.8339` versus `0.6310`, delta `+0.2029`, hit@1 `0.9091`, and hit@k `1.0`; no solver default changed.
- The protected online scorecard `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-roll-forward-1x0-1-final-lift-protected-holdout-min-score-delta-0-1` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-roll-forward-1x0.1-final-lift-protected-holdout-min-score-delta-0.1/` with dry-run registry validation only. It is safe but still neutral: mean population delta `0`, worst delta `0`, 0/15 improved, 0/15 regressed, 15/15 unchanged, 30 overrides, 0 fallbacks, and override-bearing final outcomes at 0 improved, 15 neutral, and 0 regressed. The offline final-lift improvement therefore does not yet clear the promotion blocker.
- Online ranker selection telemetry now carries baseline and selected candidate indexes, operators, and windows. Online A/B summaries, telemetry manifests, registry drafts, and text output aggregate override/fallback operator-transition counts plus changed-window counts, so protected scorecards can distinguish score-only confidence from actual geometry/operator changes.
- Protected threshold sweep artifact support now exists for the online ranker CLI, including scorecard JSON/text, telemetry manifest, registry draft, and registry dry-run validation. The regenerated protected sweep `lns-window-ranker-online-2026-05-04-strict-replay-seed-v2-roll-forward-1x0-1-final-lift-protected-holdout-threshold-sweep` is generated under `artifacts/lns-window-ranker-online/2026-05-04/strict-replay-seed-v2-roll-forward-1x0.1-final-lift-protected-holdout-threshold-sweep/` with model fingerprint `fnv1a:51fb7b72`, thresholds `0.1,0.25,0.5,0.75,1,1.5`, 5 protected cases, 3 seeds, 90 threshold comparisons, 180 total runs, and dry-run registry validation only. The top mean and top no-regression threshold are now both `1.5`, with mean delta `+3`, worst delta `0`, 1/15 improved, 0/15 regressed, and 14/15 unchanged. Because `1.5` has 0 overrides and 30 fallbacks, this is fallback-only safety/noise evidence rather than learned-ranker lift; the override-active thresholds `0.1`, `0.25`, and `0.5` still finish neutral on protected holdout.
- Online transition diagnostics now aggregate final-outcome status and protected pressure-family counts for every override/fallback transition in scorecard JSON/text, telemetry manifests, and registry drafts. The protected threshold artifact confirms the current offline-to-online gap is not just score calibration: at `0.1` and `0.25`, all 30 ranker decisions overrode the baseline and changed windows, with every override transition final-neutral. The neutral transitions were `weak-service->residential-headroom` across corridor, gate, and service-pressure families; `weak-service->frontier-congestion` across footprint-pressure and anchor-service families; and same-operator `random-exploration->random-exploration` swaps across all five protected families. At `0.5`, overrides dropped to 15/30 and fallbacks rose to 15/30, but both override and fallback transition finals remained neutral. The lone regenerated `+45` best case at `1.5` appears only on all-fallback baseline-following transitions for `lns-holdout-service-ridge-pressure` seed `19`, so it does not clear the learned override promotion blocker.
- LNS replay labels now carry explicit seed-hint diagnostics (`none`, `curated`, or `weak-replay`) plus source names, and LNS ranker/baseline tooling can aggregate seed-hint breakdowns or run with `--exclude-weak-replay-seed-labels` / `--no-weak-replay-seed-labels`. The backward-compatible ranker path can infer weak replay seeds for the existing strict label artifact from the default replay-label corpus, so old artifacts remain diagnosable.
- The weak-seed exclusion diagnostic `lns-window-ranker-2026-05-04-strict-replay-seed-v2-roll-forward-1x0-1-final-lift-no-weak-seeds-lr0-02-cap100` is generated under `artifacts/lns-window-ranker/2026-05-04/strict-replay-seed-v2-roll-forward-1x0.1-final-lift-no-weak-seeds-cpu-ranker-lr0.02-cap100/` with model fingerprint `fnv1a:2e36b926`, label fingerprint `fnv1a:5bc48690`, target `roll-forward-final-lift`, and dry-run registry validation only. It fails the offline gate by design: excluding weak replay-seed labels leaves 162 usable labels, 9 development decisions, 0 holdout decisions, 0 opportunities, and 0 trained pairs. This confirms the current offline final-lift signal is dominated by intentionally weak replay seeds; curated/real-seed replay states do not yet provide protected holdout final-lift opportunity.
- LNS window-ranker runtime telemetry now records the normalized baseline and selected feature payloads plus per-feature deltas for every online selection. Online A/B and threshold artifacts aggregate overall and transition-level mean feature deltas for override and fallback selections in JSON/text, telemetry manifests, and registry drafts, so future protected scorecards can explain which model features made each neutral operator transition look attractive without changing solver defaults.
- LNS replay-label collection now has a natural-seed corpus path for non-weak diagnostics. `lnsBenchmarkCli --window-replay-labels --natural-replay-seeds` and `learnedRankingLabelCli --natural-lns-replay-seeds` use the same replay-label case names without injecting synthetic weak replay seeds into unseeded benchmark cases, while preserving explicitly curated seed hints. Default strict replay-label behavior remains unchanged.
- The strict natural-seed roll-forward bundle `strict-lns-replay-labels-2026-05-04-natural-seeds-roll-forward-1x0-1` is generated under `artifacts/learned-ranking-labels/2026-05-04/strict-lns-replay-labels-natural-seeds-roll-forward-1x0.1/` with 4,677 Greedy labels, 1,146 LNS replay labels, label fingerprint `fnv1a:641c6c72`, and dry-run registry validation only. It is diagnostics-only and does not pass LNS scale readiness: development has 648 usable labels with 69 immediate non-neutral labels but all 648 roll-forward labels final-neutral; holdout has 498 usable labels, 0 immediate non-neutral labels, and all 498 roll-forward labels final-neutral. This confirms that simply removing synthetic weak replay seeds does not rebuild protected final-lift opportunity.

Concrete work:

- Rebuild non-weak protected final-lift opportunity with stronger curated incumbents, new protected replay cases, or longer/chunked roll-forward budgets before any learned online promotion.
- Investigate the offline-to-online gap before any feature flag: the final-lift labels and tuned ranker improve offline holdout only when weak replay-seed labels are included, while protected override-active online thresholds remain neutral and fallback-only runs can drift with timing. Next evidence should isolate why `weak-service->residential-headroom`, `weak-service->frontier-congestion`, and same-operator `random-exploration` window swaps look good offline but stay neutral online, then test richer final-state features or longer/chunked roll-forward budgets on non-weak replay states.
- Keep planner-facing feature-delta explainability parked until a learned LNS ranker is exposed outside diagnostics-only benchmark flows.

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
