# Solver Roadmap

## Goal

Maximize feasible city population under a fixed wall-clock and CPU budget.

The solver roadmap is now centered on the fastest path to better solutions:

1. Keep `auto` as the default quality path.
2. Keep CP-SAT aligned with the formal problem semantics and close every alignment change with registered evidence.
3. Make LNS adaptive and evidence-driven.
4. Expand benchmark coverage around planner workflows and pressure cases.
5. Promote learned guidance, portfolio, GPU, distributed solving, or alternative solvers only after protected equal-budget evidence says they help.

Primary metrics:

- Time to first feasible incumbent.
- Population at fixed checkpoints: 1s, 5s, 30s, 120s.
- Time to best solution.
- Improvement per extra CPU-second.
- CP-SAT status, upper bound, and population gap when available.
- Repeatability across fixed seeds, map families, and planner workflows.
- Exact validation of every reported final layout.

## Runtime Posture

The default path stays incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof.
4. `auto` orchestrates the budget and keeps the best incumbent.
5. Standalone `greedy`, `LNS`, `CP-SAT`, and explicit portfolio modes remain experiment tools.

| Mode | Role | Default Use |
| --- | --- | --- |
| `auto` | Main quality path | Best feasible population per wall-clock budget |
| `greedy` | Fast incumbent and diagnostics | Seed generation, baseline, counterfactual traces |
| `LNS` | Main improvement engine | Adaptive repair around incumbent layouts |
| `CP-SAT` | Exact backend | Small proofs, local repairs, bounded polishing, model-alignment checks |
| CP-SAT portfolio | Explicit research mode | Only after CPU-normalized scorecards beat single CP-SAT |
| Learned guidance | Future feature-flag path | Only after offline and online holdout gates pass |

## Delivered Baseline

Completed solver work has moved to [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md).

Current reviewed baseline:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- `auto` follows the incumbent-first `greedy -> LNS -> CP-SAT` workflow and preserves bounded CP-SAT reserve time.
- Cross-mode progress, decision traces, JSONL export, time-to-quality scorecards, and budget-policy signals are available for reproducible comparison.
- LNS has deterministic/probabilistic neighborhoods, improvement guards, replay labels, and budget controls.
- Greedy has phase guardrails, profile counters, final road cleanup, connectivity-shadow traces, guarded opt-in connectivity-shadow scoring, and road-opportunity counterfactuals.
- Experiment registry hardening exists through validation/check tooling, append helpers, and strict metadata gates.
- Planner explainability, saved layouts, manual validation, continuation hints, and expansion comparison create a real product loop around the solver.
- The 2026-04-28 health check passed `npm test`; Auto matched the best population on the four 5s seed-7 default scorecard cases.
- CP-SAT road semantics now use per-component anchor connectivity: every explicit road component must touch row `0` or column `0`, and roadless boundary-only layouts are valid.
- CP-SAT portfolio measurement tied single CP-SAT on the tiny paired run while spending more configured worker CPU, so portfolio remains explicit-only.
- Low-risk learned-ranking labels, CPU-first Greedy and LNS offline rankers, and a feature-flagged Greedy online A/B harness exist; no learned runtime path has been promoted.

## Strategic Shift

The next stage is not "train first" or "add more modes." The next stage is:

1. Use the registered CP-SAT road-semantics baseline as the proof oracle for local repair and promotion scorecards.
2. Use adaptive LNS as the main time-to-good-solution engine.
3. Turn the benchmark and experiment registry into the promotion gate for every solver change.
4. Measure the planner's actual workflow: solve, inspect, edit, validate, reuse, compare next addition.

Reasoning:

- The problem is a hybrid of rectangle packing, set packing, service/facility coverage, and road-network design.
- CP-SAT is the right exact backend, but it must be semantically faithful before it becomes the source of truth for local repair and proof.
- LNS already matches the research shape for this kind of problem; adaptive destroy/repair operators are likely higher leverage than another global solver mode.
- Greedy offline ranking has a protected-holdout diagnostic win and a feature-flagged runtime hook, but its first equal-budget online A/B did not earn promotion; LNS offline ranking now beats weak baselines but has not beaten the deterministic window proxy.
- Tiny saturated cases are useful smoke tests but weak promotion evidence.

## Current Milestone: Promotion-Grade Solver Alignment And Evidence Gate

Goal: turn the road-semantics fix into a trusted baseline and create the evidence loop that future solver changes must pass.

This milestone is complete only when the implementation, docs, benchmarks, and experiment registry all agree on the same story: CP-SAT, TypeScript validation, and the formal spec use per-component road-anchor semantics; solver improvements are judged on planner-shaped cases; and every default-changing proposal has reproducible artifacts.

### Phase 0: Stabilize The Current Semantic And Safety Pass

Dependencies:

- Per-component road-anchor semantics in CP-SAT, TypeScript validation, road cleanup, and road materialization.
- HTTP planner complexity caps for local web/API usage.

Acceptance gates:

- `npm test` passes.
- Python CP-SAT files compile.
- Multi-anchor and roadless-boundary regressions are present in the optimizer/review-finding test suites.
- Road-semantics docs no longer describe the CP-SAT mismatch as an open implementation question.
- HTTP planner limits are documented as safety defaults and covered by route tests.

### Phase 1: Road-Semantics Scorecard

Dependencies:

- Phase 0 is green.

Acceptance gates:

- `npm run benchmark:road-semantics` produces a passing road-semantics scorecard artifact.
- Adversarial cases cover row-0 anchors, column-0 anchors, multiple independent anchored road components, disconnected non-anchor components, and boundary-only roadless layouts.
- CP-SAT and the exact TypeScript evaluator agree on feasibility for every adversarial case.
- Cross-mode scorecards show no worst-family regression after the aligned CP-SAT formulation.
- Results are captured as registry-ready artifacts with command, commit, branch, seed, budget, hardware, and summary metrics.

Completion evidence, 2026-05-17:

- `npm run benchmark:road-semantics -- --output=artifacts/road-semantics-scorecard/2026-05-17/road-semantics-scorecard.json` produced a passing 5-case road-semantics scorecard artifact.
- The scorecard covers row-0 anchors, column-0 anchors, multiple independent anchored road components, disconnected non-anchor road rejection, and boundary-only roadless layouts.
- CP-SAT and the TypeScript evaluator agree across all 5 adversarial cases; the disconnected non-anchor fixture is rejected by the evaluator while CP-SAT finds the valid no-road boundary alternative.
- The artifact records exact command, branch, `artifactGitCommit`, fixed seed `1`, CP-SAT budget, captured hardware metadata, summary metrics, and normalized artifact path.
- `npm run benchmark:scorecard -- --modes=greedy,cp-sat --budget=5 --seeds=7` passed the default 4-case cross-mode scorecard; CP-SAT matched or beat Greedy on every default case.
- Registry entry `road-semantics-scorecard-2026-05-17-v2` records the strict Phase 1 evidence. The earlier `road-semantics-scorecard-2026-05-17` entry is superseded by the `-v2` entry after CP-SAT coverage was added to all adversarial cases.

### Phase 2: Product-Shaped Benchmark Corpus

Dependencies:

- Road-semantics scorecard is stable enough to use as a baseline.

Acceptance gates:

- `npm run benchmark:product-workflows` produces a passing workflow artifact.
- Add 6-10 saved planner payloads that represent the real web workflow.
- Add manual-layout replay through `/api/layout/evaluate`.
- Add expansion-comparison replay.
- Include corridor, gate, footprint-pressure, service-overlap, anchor-service, and multi-anchor case families.
- Maintain fixed seeds plus development and protected holdout splits.
- Report population at 1s, 5s, 30s, and 120s where the budget is applicable.

Completion evidence, 2026-05-17:

- `npm run benchmark:product-workflows -- --output=artifacts/product-workflows/2026-05-17/product-workflow-benchmark.json` produced a passing 8-case workflow artifact.
- Corpus cases are split into 4 development and 4 protected holdout payloads:
  `planner-corridor-reuse`, `planner-gate-choke`, `planner-footprint-pressure`, `planner-rotated-rowhouse`,
  `planner-service-overlap`, `planner-anchor-service`, `planner-multi-anchor-islands`, and `planner-gate-service-tradeoff`.
- The corpus covers corridor, gate, footprint-pressure, service-overlap, anchor-service, and multi-anchor families.
- Manual replays are tagged with `/api/layout/evaluate`, expansion comparisons run for every case, and fixed seed `7` is reported at 1s, 5s, 30s, and 120s.
- Artifact metrics: 8/8 cases passed, 32 budget runs, `manualOutperformingBudgetCaseCount=0`, and `worstBestBudgetDeltaFromManual=0`.

### Phase 3: Telemetry Manifests

Dependencies:

- Product-shaped corpus has stable case names, seeds, and split ownership.

Acceptance gates:

- Every benchmark/workflow run emits a manifest with command, git SHA, branch, dirty-state marker, case, seed, budget, hardware, solver params, and artifact paths.
- Auto, Greedy, LNS, and CP-SAT runs expose stage timings, first-feasible time, best-score time, final status, and final validation result.
- CP-SAT runs include status, upper bound, population gap, and model/candidate-size metadata where available.
- LNS runs include operator/window attempts, feasible repairs, improvements, neutral repairs, recoverable failures, elapsed time, and selected-window context.
- Experiment registry append/check flows can validate these manifests without rerunning the solver.

Completion evidence, 2026-05-17:

- `npm run benchmark:scorecard -- --modes=auto,greedy,lns,cp-sat --budget=5 --seeds=7 --manifest-output=artifacts/telemetry-manifests/2026-05-17/solver-telemetry-manifest.json` produced a 16-run solver telemetry manifest.
- The solver manifest records exact command, git SHA, branch, dirty-state marker, captured hardware, artifact path, case, seed, budget, solver params, stage timings, first-feasible time, best-score time, final status, and final validation result.
- The solver manifest covers 4 Auto, 4 Greedy, 4 LNS, and 4 CP-SAT runs. CP-SAT-backed runs include status, upper bound, population gap, branch/conflict telemetry where available, and model/candidate-size metadata.
- LNS runs record attempts, feasible repairs, improvements, neutral repairs, recoverable failures, elapsed time, and selected-window context.
- `npm run benchmark:product-workflows -- --output=artifacts/product-workflows/2026-05-17/product-workflow-benchmark.json --manifest-output=artifacts/telemetry-manifests/2026-05-17/product-workflow-telemetry-manifest.json` produced a 32-run product workflow telemetry manifest for the 8-case corpus at 1s, 5s, 30s, and 120s.
- Registry entry `solver-telemetry-manifests-2026-05-17` records the Phase 3 evidence, and `npm run experiment-registry:check` validates telemetry manifest artifacts from registry `artifactPaths` without rerunning the solver.

### Phase 4: Adaptive LNS Operator Set

Dependencies:

- Telemetry can explain operator outcomes by case family and budget.

Acceptance gates:

- Add an operator interface for semantic destroy/repair choices.
- Initial operators cover weak service repair, residential-headroom cluster repair, frontier-congestion repair, gate/choke repair, service-overlap repair, and random exploration.
- Operator scoring rewards recent useful improvement while preserving exploration.
- Equal-budget LNS/Auto scorecards improve population or time-to-best without worst-decile regression on protected holdout cases.

Completion evidence, 2026-05-17:

- LNS repair windows are now emitted as named operator candidates with adaptive selection telemetry: `weak-service-repair`, `residential-headroom-repair`, `frontier-congestion-repair`, `gate-choke-repair`, `service-overlap-repair`, `random-exploration`, and `sliding-window`.
- Operator telemetry records selection policy, per-operator attempts, improvements, neutral repairs, recoverable failures, reward, decayed score, selected window, score before/after, and exploration status.
- `npm run benchmark:lns -- --neighborhood-ablation --fixed-rectangle-baseline --seeds=7,19,37 --output=artifacts/adaptive-lns/2026-05-17/adaptive-lns-fixed-rectangle-scorecard.json --json` produced a 48-run, 8-case equal-budget scorecard.
- Adaptive operators improved mean population by `+12.5` versus fixed-rectangle sliding windows, with best delta `+100`, `3/24` wins, zero regressions, and no worst-decile regression across the protected generated-pressure holdout.
- `npm run benchmark:lns -- --neighborhood-ablation --ablation-variants=baseline,adaptive-operators --seeds=7,19,37 --output=artifacts/adaptive-lns/2026-05-17/adaptive-lns-operator-scorecard.json --json` confirmed legacy-ranked LNS and adaptive operators tie on fixed-budget population while preserving operator telemetry.
- Registry entry `adaptive-lns-operators-2026-05-17` records the scorecards and gate report for Phase 4 promotion evidence.

### Phase 5: Auto Budget Retuning

Dependencies:

- Product corpus, telemetry manifests, and adaptive LNS operator data are available.

Acceptance gates:

- Budget ablations compare greedy seed time, LNS repair time, CP-SAT reserve time, and no-improvement timeout policies.
- New Auto policy beats baseline on protected holdout or reaches equal population faster.
- CPU-normalized cost is no worse than the baseline policy unless explicitly accepted as a product tradeoff.
- Defaults change only after the scorecard and registry entry are reviewed.

Completion evidence, 2026-05-17:

- Budget ablations now compare Auto greedy seed caps, LNS seed/repair/stale-time budgets, CP-SAT reserve/runtime, and CP-SAT no-improvement timeout policies.
- The default coverage corpus now includes the 4 protected product holdout payloads: `planner-service-overlap`, `planner-anchor-service`, `planner-multi-anchor-islands`, and `planner-gate-service-tradeoff`.
- `npm run benchmark:scorecard -- --budget-ablation --coverage-corpus --ablation-policies=baseline,phase5-fast-exact --modes=auto,greedy,lns,cp-sat --budget=5 --seeds=7 --output=artifacts/auto-budget-retuning/2026-05-17/auto-budget-retuning-fast-exact-scorecard.json` produced a 96-run, 12-case protected coverage scorecard.
- `phase5-fast-exact` tied baseline Auto mean population at `239.58`, preserved configured Auto worker CPU budget at `5.000s`, improved mean Auto time-to-best by `0.139s`, and improved mean Auto wall time by `0.811s`.
- The policy-family scorecard at `artifacts/auto-budget-retuning/2026-05-17/auto-budget-retuning-policy-family-scorecard.json` records the slower seed-light, CP-SAT-reserve-heavy, and stale-polish alternatives as non-promoted comparisons.
- Auto runtime defaults now use the promoted fast-exact budget slice: short LNS seed/repair/stale-time caps and a larger CP-SAT reserve for earlier exact polish.
- Registry entry `auto-budget-retuning-2026-05-17` records the Phase 5 artifacts and promotion decision.

### Phase 6: Exact Small-Window DP Repair

Dependencies:

- Road-semantics validation, product corpus, telemetry manifests, adaptive LNS operators, and Phase 5 Auto budget defaults are available.
- The trigger is constrained to tiny repair windows where CP-SAT startup/model overhead dominates the repair itself.

Acceptance gates:

- Add bitmask/profile-DP repair only as a bounded subroutine for tiny LNS windows.
- Eligibility must cap usable window cells, service/residential candidates, and DP/search states.
- Ineligible windows must fall back to CP-SAT without changing repair semantics.
- DP-produced layouts must be validated by the exact evaluator before acceptance.
- Scorecard evidence must show no population regression and materially faster eligible repair wall time.

Completion evidence, 2026-05-17:

- LNS now exposes `lns.smallWindowDpRepair` plus `smallWindowDpMaxCells`, `smallWindowDpMaxCandidates`, and `smallWindowDpMaxStates` guardrails.
- The DP repair path enumerates bounded road masks, service subsets, and residential placement states, rejects cross-boundary incumbent buildings, validates every accepted layout with the exact evaluator, and falls back to CP-SAT on ineligible or over-budget windows.
- LNS outcomes now record `repairBackend` and `smallWindowDp` telemetry: eligibility, reason, usable cell count, candidate counts, road-mask count, service-subset count, DP state count, elapsed time, and best population.
- `npm run benchmark:lns -- --neighborhood-ablation --ablation-variants=baseline,small-window-dp --seeds=7 --output=artifacts/small-window-dp/2026-05-17/small-window-dp-scorecard.json --json` produced a 16-run, 8-case scorecard.
- `small-window-dp` tied baseline mean population at `391.25`, had zero regressions across the development plus generated-pressure holdout split, and used DP directly on 4 eligible repairs at `0.0039s` mean repair wall time versus roughly `0.541s` CP-SAT repair wall time.
- Registry entry `small-window-dp-repair-2026-05-17` records the Phase 6 artifact and feature-gated shipping decision.

## Active Priorities

Impact scale: `5` is most significant for population per minute. Rank is the recommended execution order.

Status vocabulary:

- `delivered`: implemented and closed for its intended gate.
- `active`: next-stage work that can start now.
- `partial`: usable infrastructure exists, but coverage or metadata is incomplete.
- `needs-scale`: schema and path are proven, but evidence volume or holdout signal is too small.
- `not-started`: no implementation exists yet.
- `gated`: do not start until the trigger is satisfied.

| Rank | Priority | Status | Impact | Summary | Success Signal |
| --- | --- | --- | ---: | --- | --- |
| 1 | CP-SAT road-semantics verification closeout | delivered | 5.0 | Phase 1 now has a passing 5-case road-semantics artifact, CP-SAT coverage on every adversarial case, registry-style artifact metadata, a default greedy/CP-SAT cross-mode smoke check, and strict registry entry `road-semantics-scorecard-2026-05-17-v2`. | CP-SAT, TypeScript validation, and the formal spec agree on multi-anchor, roadless-boundary, row/column anchor, and disconnected-road feasibility semantics. |
| 2 | Product-shaped benchmark corpus | delivered | 4.5 | Phase 2 now has 8 planner-shaped payloads with manual-layout replay, expansion-comparison replay, fixed seed `7`, dev/holdout splits, and 1s/5s/30s/120s population reporting. | `artifacts/product-workflows/2026-05-17/product-workflow-benchmark.json` passes with 8/8 cases and no manual-over-budget misses. |
| 3 | Solver telemetry manifests | delivered | 4.0 | Phase 3 now has reusable solver telemetry manifests, CLI manifest writers for cross-mode and product workflow runs, registry-side manifest validation, and strict registry entry `solver-telemetry-manifests-2026-05-17`. | Every benchmark and workflow run can explain where time was spent and why a candidate change did or did not improve. |
| 4 | Adaptive LNS operator set | delivered | 4.5 | Phase 4 now has named semantic repair operators, adaptive operator scoring, exploration windows, operator-aware telemetry/manifests, pressure-case ablations, and strict registry entry `adaptive-lns-operators-2026-05-17`. | Fixed-rectangle LNS comparison improved mean population by `+12.5` across 24 paired comparisons with zero regressions and no protected-holdout worst-decile regression. |
| 5 | Auto budget policy retuning | delivered | 3.5 | Phase 5 now has fast-exact Auto budget defaults, protected product-holdout budget ablations, CPU-normalized scorecard metrics, and strict registry entry `auto-budget-retuning-2026-05-17`. | `phase5-fast-exact` tied baseline population with equal configured CPU budget while improving mean Auto time-to-best by `0.139s` and mean wall time by `0.811s`. |
| 6 | Exact small-window DP repair | delivered | 3.0 | Phase 6 now has a bounded LNS DP repair backend behind `smallWindowDpRepair`, evaluator validation, CP-SAT fallback, telemetry, scorecard artifact, and strict registry entry `small-window-dp-repair-2026-05-17`. | DP handled 4 eligible tiny repairs at `0.0039s` mean wall time, tied baseline population, and produced zero regressions across the 8-case scorecard. |
| 7 | Service-master decomposition experiment | delivered | 3.5 | Phase 7 now has a service-layout master, fixed-service CP-SAT subproblems, no-good layout dedupe, service-swap telemetry, a targeted service/coverage scorecard, and strict registry entry `service-master-decomposition-2026-05-17`. | The experimental scorecard produced one facility-coverage win (`+100`), four ties, zero losses, and zero invalid layouts; it remains explicit-only because mean wall time is higher than Auto. |
| 8 | LNS replay label scale-up | delivered | 3.0 | Phase 8 now has five-family split-protected LNS replay coverage, tail-exploration windows, replay-derived pairwise window-ranking labels, CLI artifact output, readiness gates, and strict registry entry `lns-replay-label-scale-2026-05-17`. | Pairwise label-scale gates pass before model training: development has `336` usable labels with `276` non-neutral, holdout has `224` usable labels with `144` non-neutral, and both splits cover five pressure families. |
| 9 | CPU-first Greedy offline ranker | delivered | 2.5 | Phase 9 now has a CPU-only pairwise linear Greedy ranker, CLI artifact output, split-protected development/holdout evaluation, deterministic/random/single-feature baselines, inference timing, targeted tests, and strict registry entry `greedy-offline-ranker-2026-05-17`. | Protected holdout accuracy is `90.1%`, beating deterministic proxy `76.7%`, random `50.0%`, and best single-feature `70.3%`; inference is `4.488us` per pair and no runtime scorer/default changed. |
| 10 | Feature-flagged Greedy learned online A/B | delivered / no-promotion | 2.0 | Phase 10 wires the Phase 9 scorer behind `greedy.learnedServiceRanking`, adds guarded candidate re-ranking counters, validates new Greedy options, adds an online A/B CLI, and records strict registry entry `greedy-learned-online-ab-2026-05-17`. | Guarded mode tied population on all `12` protected holdout comparisons with zero losses but was slower by `0.2552s` mean wall time; exploratory mode lost `3` holdout comparisons, so Greedy defaults stay unchanged. |
| 11 | CPU-first LNS offline window ranker | delivered / no-promotion | 2.5 | Phase 11 trains a CPU-only pairwise linear LNS window ranker from the Phase 8 replay labels, adds CLI artifact output, split-protected holdout evaluation, random/deterministic/single-feature baselines, inference timing, targeted tests, and strict registry entry `lns-offline-ranker-2026-05-17`. | Protected holdout accuracy is `97.9%`, beating random `50.7%` and best single-feature `87.5%`, but tying the deterministic window proxy at `97.9%`; no runtime scorer/default changed. |

## Status Snapshot

| Area | Status | Evidence | Default Impact |
| --- | --- | --- | --- |
| Cross-mode scorecards, traces, and budget-policy signals | delivered | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), items 11 and 14-17 | Supports promotion gates; no default change by itself. |
| Deterministic Greedy/LNS ablation gates | delivered | [SOLVER_ABLATION_DECISIONS.md](../decisions/SOLVER_ABLATION_DECISIONS.md), `artifacts/deterministic-ablations/2026-04-27/` | No deterministic variant promoted; regressions remain blocked. |
| Low-risk learned-ranking label bundle | delivered | `artifacts/learned-ranking-labels/2026-04-27/` | Offline diagnostics only; no model trained and no defaults changed. |
| LNS replay label coverage | delivered | `artifacts/lns-replay-label-scale/2026-05-17/lns-replay-label-scale.json`; registry run `lns-replay-label-scale-2026-05-17` | Pairwise window-ranking labels now pass the split-protected scale gate; no learned model has been trained yet. |
| Generated pressure-case coverage | partial | [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md), item 30 | Useful starting point, but promotion needs broader workflow and adversarial coverage. |
| CP-SAT portfolio telemetry and CPU-normalized scorecards | delivered | `artifacts/cp-sat-portfolio/2026-04-28/` | Portfolio remains explicit-only; Auto does not route through it. |
| Experiment registry hardening | delivered | `artifacts/experiments/index.jsonl`; `npm run experiment-registry:check` | Future artifacts can be checked and appended with strict metadata. |
| CP-SAT road-semantics alignment | delivered | `artifacts/road-semantics-scorecard/2026-05-17/road-semantics-scorecard.json`; registry run `road-semantics-scorecard-2026-05-17-v2`; targeted tests | Per-component road-anchor semantics are the trusted baseline for future repair and proof work. |
| Product workflow benchmark corpus | delivered | `artifacts/product-workflows/2026-05-17/product-workflow-benchmark.json`; `npm run benchmark:product-workflows` | Promotion and telemetry work now has stable planner-shaped dev/holdout case names. |
| Solver telemetry manifests | delivered | `artifacts/telemetry-manifests/2026-05-17/solver-telemetry-manifest.json`; `artifacts/telemetry-manifests/2026-05-17/product-workflow-telemetry-manifest.json`; registry run `solver-telemetry-manifests-2026-05-17` | Registry checks can validate manifest metadata and per-run telemetry without rerunning solvers. |
| Adaptive LNS | delivered | `artifacts/adaptive-lns/2026-05-17/adaptive-lns-fixed-rectangle-scorecard.json`; registry run `adaptive-lns-operators-2026-05-17` | Named semantic operators and adaptive scoring are available for Phase 5 Auto budget retuning and future label scale-up. |
| Auto budget retuning | delivered | `artifacts/auto-budget-retuning/2026-05-17/auto-budget-retuning-fast-exact-scorecard.json`; registry run `auto-budget-retuning-2026-05-17` | Auto now defaults to the promoted fast-exact budget slice after protected coverage evidence showed equal population, equal configured CPU budget, and faster time-to-best. |
| Exact small-window DP repair | delivered | `artifacts/small-window-dp/2026-05-17/small-window-dp-scorecard.json`; registry run `small-window-dp-repair-2026-05-17`; targeted LNS tests | Feature-gated tiny-window repairs can bypass CP-SAT overhead when eligible and fall back safely otherwise. |
| Service-master decomposition | delivered | `artifacts/service-master/2026-05-17/service-master-scorecard.json`; registry run `service-master-decomposition-2026-05-17`; targeted service-master tests | Experimental fixed-service subproblems can expose facility-coverage wins, but the mode stays explicit-only until wall time improves. |
| LNS replay label scale | delivered | `artifacts/lns-replay-label-scale/2026-05-17/lns-replay-label-scale.json`; registry run `lns-replay-label-scale-2026-05-17`; targeted label-scale tests | Five-family development and holdout pairwise labels are ready for offline LNS window-ranking research. |
| Greedy offline ranker diagnostics | delivered | `artifacts/greedy-offline-ranker/2026-05-17/greedy-offline-ranker.json`; registry run `greedy-offline-ranker-2026-05-17`; targeted offline-ranker tests | CPU-only Greedy ranker clears protected-holdout offline baselines, but remains diagnostics-only until feature-flagged online A/B passes. |
| Greedy learned online A/B | delivered / no-promotion | `artifacts/greedy-online-ab/2026-05-17/greedy-online-ab.json`; registry run `greedy-learned-online-ab-2026-05-17`; targeted online-A/B tests | `greedy.learnedServiceRanking` exists as an opt-in flag, but guarded mode is neutral/slower and exploratory mode regresses holdout, so no Greedy default changed. |
| LNS offline window ranker | delivered / no-promotion | `artifacts/lns-offline-ranker/2026-05-17/lns-offline-ranker.json`; registry run `lns-offline-ranker-2026-05-17`; targeted offline-ranker tests | CPU-only LNS ranker clears random and single-feature baselines, but ties the deterministic window proxy, so runtime integration remains gated. |
| Model training path | partial / gated | Phase 9 has an offline Greedy ranker metric report, Phase 10 has a feature-flagged Greedy scorer, and Phase 11 has an offline LNS ranker report; no `python/ml/` scaffold, runtime model loading path, or learned default is promoted | No learned default path. |
| GPU, distributed solving, alternative solvers | gated | No CPU-first bottleneck evidence requiring them | Research-only until equal-budget wins exist. |

## Gated Priorities

These are not next actions. Move them into the active table only after the trigger is satisfied.

| Trigger | Priority | Impact | Summary | Success Signal |
| --- | --- | ---: | --- | --- |
| CP-SAT semantics scorecard and product corpus are stable | Geometry-native CP-SAT / `NoOverlap2D` experiment | 3.0 | Compare current cell-indexed set packing with optional-interval rectangle constraints. | Controlled scorecard shows propagation or time-to-best improvement without model-size blowup. |
| New LNS window features or ranker objective beat the Phase 11 deterministic-proxy tie | Learned LNS window ranking retry | 2.5 | Improve replay features, labels, or model objective before another offline LNS ranker run. | Offline holdout beats deterministic, random, and single-feature baselines; only then run online A/B for fixed-budget quality without worst-decile regression. |
| New Greedy ranker features or guard beat the Phase 10 no-promotion baseline | Learned Greedy promotion retry | 2.0 | Improve the scorer features, guard policy, or candidate shortlist before another equal-budget online A/B. | Online paired seeded benchmarks improve population or time-to-best with bounded inference overhead, zero protected-holdout losses, and no worst-decile regression. |
| Portfolio scorecards show CPU-normalized wins | CP-SAT portfolio in Auto | 2.0 | Let Auto route a controlled budget slice to portfolio only when CPU cost is justified. | Portfolio improves wall-clock quality and CPU-normalized efficiency versus single CP-SAT. |
| CPU-first workflow has a measured bottleneck | GPU acceleration | 2.0 | Use GPU for training, batched feature extraction, or inference only after CPU baseline is useful. | GPU reduces time-to-label, time-to-train, or inference overhead while preserving solver quality gates. |
| Hosted/multi-user execution becomes a product requirement | Durable worker architecture | 2.0 | Move jobs to a durable queue/status store before horizontal scale. | Status/cancel/snapshot behavior survives process restarts and multi-instance routing. |
| Exact-bound quality remains blocked after CP-SAT tuning | External MILP/SCIP/Gurobi/cuOpt research adapter | 1.5 | Use an external exact or relaxation backend as a science instrument, not a product dependency. | Produces better bounds or incumbents on selected families under exact evaluator validation. |

## Combined Ordering

1. Use the registered road-semantics, product workflow, telemetry, and adaptive-LNS baselines as the stable benchmark base for promotion decisions.
2. Use the Phase 5 fast-exact Auto budget defaults as the new baseline for future solver promotion decisions.
3. Keep small-window DP repair feature-gated to eligible tiny windows and use its telemetry to decide whether Auto should enable it by default later.
4. Keep service-master decomposition explicit-only while using its fixed-service subproblem telemetry to decide whether a cheaper master shortlist is worth pursuing.
5. Keep the Phase 11 LNS offline ranker as diagnostics only; do not enable an LNS model until it beats the deterministic window proxy on protected holdout.
6. Keep the Phase 10 Greedy learned scorer feature-flagged and off by default; the first guarded online A/B was safe but slower, and the exploratory variant regressed holdout.
7. Revisit learned rankers only after offline holdout and equal-budget online gates pass with a real quality or time-to-best win.
8. Revisit portfolio, GPU, distributed workers, or alternative solvers only after they have a measured bottleneck and CPU-normalized win path.

## Discipline

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity. Solver backends and validators must agree on that rule.
- Buildings that touch row `0` or column `0` are connected by the anchor rule and should not keep unnecessary connector roads alive.
- Final road cleanup should remove support roads that do not affect anchor-boundary road connectivity or building access.
- Connectivity cost should estimate building-induced loss of feasible connected area, not road commitment alone.
- Auto LNS stages must preserve any reserved CP-SAT time by capping seed and repair sub-budgets.
- Learned guidance is not ready until traces show repeated, explainable ranking mistakes and enough counterfactual labels exist.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows, narrow profiles, and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism is useful only when measured against both wall-clock and CPU-second cost.
- CP-SAT warm starts are global unless non-neighborhood variables are explicitly fixed.
- OR-Tools `repair_hint` with multi-worker repair previously caused instability, so repair-heavy CP-SAT experiments must stay guarded.
- Distributed solving should wait until single-machine Auto/LNS policy is trace-tuned or hosting requires durable jobs.
