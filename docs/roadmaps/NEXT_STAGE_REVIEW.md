# Next Stage Solver Review

Date: 2026-05-01

## Executive Summary

The next stage should move away from a GPU/learned-ranking-first plan and toward a tighter solver-improvement loop:

1. Make adaptive LNS the main improvement engine.
2. Expand benchmarks around planner workflows and hard pressure cases.
3. Deepen solver telemetry and registry evidence before changing defaults.
4. Keep CP-SAT focused on exact repair, proof, labels, and failure-mode confidence.

The current solver stack is already strong enough to improve incrementally: Greedy creates fast incumbents, LNS repairs neighborhoods, CP-SAT supplies exact repair/proof, and Auto preserves the best incumbent. The fastest route to better answers is not another mode. It is better model alignment, better neighborhoods, better measurement, and smaller evidence-backed changes.

The default posture remains unchanged: keep `auto` as the recommended quality path. Learned guidance, CP-SAT portfolio, GPU acceleration, distributed solving, and external solvers remain gated research tracks.

## Current Status

### Shipped Runtime

- `auto` is the recommended quality path. It runs a Greedy seed, then bounded LNS / CP-SAT cycles while improvement remains useful.
- `greedy` is a fast incumbent and diagnostics engine with restarts, local search, service ranking, final road cleanup, connectivity-shadow traces, and road-opportunity counterfactuals.
- `LNS` is the main improvement engine. It starts from a validated seed, generates repair windows, fixes outside a selected window, and calls CP-SAT for exact repair.
- `CP-SAT` is the exact backend. It supplies proof when status is `OPTIMAL`; bounded runs may return `FEASIBLE` with an incumbent and gap.
- The local planner supports saved layouts, manual editing, layout validation, continuation hints, solved-map inspection, explainability maps, and expansion comparison.
- Cross-mode benchmarks, deterministic ablations, learned-label artifacts, CP-SAT portfolio measurement, and an experiment registry already exist.
- Cross-mode benchmarks now have an initial product-shaped corpus selector: `--product-corpus` lists 10 dev/holdout cases tagged for solver smoke, manual-layout replay, expansion comparison, corridor, gate, footprint-pressure, service-pressure, anchor-service, and multi-anchor coverage.

### Evidence Already Closed

- Deterministic ablations are closed as an evidence gate. No deterministic variant is ready for default promotion.
- Connectivity-shadow scoring is a learning target, not a default. It produced isolated wins with no population regressions in the gate, but with positive wall-clock cost.
- LNS anchor/window variants are learning targets because they move windows without population regressions, but the replay label volume is too small for model training.
- Low-risk learned-ranking labels exist:
  - 4,593 Greedy labels.
  - 888 Greedy connectivity-shadow labels.
  - 3,705 Greedy road-opportunity near-miss labels.
  - 84 usable LNS replay labels.
  - Protected development/holdout splits.
- CPU portfolio is closed as a measurement/safety gate. The latest tiny paired run tied population while using more configured worker CPU budget, so portfolio stays explicit-only.
- CP-SAT road-semantics alignment and scorecard closeout are delivered as of 2026-04-30. CP-SAT now uses one road-connectivity formulation: per-component anchored roads, and the six-case scorecard reached `OPTIMAL` under a 5s single-worker budget.
- CP-SAT async and portfolio failure-mode coverage is delivered as of 2026-05-01. Regression coverage now includes malformed progress, no-final-result streamed-progress close, child diagnostics, process-pool fallback, worker future failure after sibling progress, cancellation process groups, and cancellation snapshot propagation.
- The service-master decomposition experiment is delivered as of 2026-05-01. Greedy now has an opt-in master/subproblem pass that enumerates bounded service layouts and realizes each through the existing fixed-service residential/road subproblem; the focused service-pressure benchmark improves from 465 to 555 population with exact validation.
- LNS replay label scale-up is delivered as of 2026-05-01. Replay labels now carry adaptive-operator names/scores, the default learned-label replay settings collect broader top-k plus tail-exploration candidates, and development/holdout LNS splits have disjoint five-family pressure coverage. No learned ranker was trained or promoted.

## Key Finding: CP-SAT Road Semantics

The highest-leverage next investigation was CP-SAT road semantics. The core mismatch is now confirmed, fixed, and scorecarded.

The formal spec permits multiple road components as long as every road component touches the road-anchor boundary. The TypeScript validation path follows that interpretation by accepting every road cell reachable from any row-0-or-column-0 road anchor.

The Python CP-SAT model used one root and one connected flow network for all selected road cells. That was stricter than the spec when multiple independent anchored road components are legal. This was not just a performance tweak. It was a correctness and search-quality issue:

- It can reject layouts that the spec and evaluator accept.
- It can force extra connector roads.
- It can reduce feasible building space.
- It can make CP-SAT repairs less useful inside LNS.
- It can skew benchmark decisions when CP-SAT is treated as the exact backend.

Delivered action:

1. Replaced the single-root CP-SAT formulation with the per-component anchored-road formulation.
2. Removed the legacy `single-root` mode switch.
3. Added focused forced-road, warm-start, local-neighborhood, and optimization regression coverage.
4. Added `multi-anchor-road-components` to the CP-SAT benchmark corpus.

Delivered scorecard action:

1. Added CP-SAT benchmark coverage for tiny, corridor, gate, service-pressure, multi-anchor, and dense saturated road-semantics families.
2. Added model-size telemetry alongside branch/conflict and wall-clock telemetry.
3. Registered the evidence under `artifacts/cp-sat-road-semantics/2026-04-30/`.

Success signal:

- CP-SAT, the formal spec, and the TypeScript evaluator agree on feasibility for adversarial multi-anchor cases.
- CP-SAT scores 200 on `multi-anchor-road-components`.
- Wider scorecards show no worst-family regression. The 2026-04-30 single-worker scorecard reached `OPTIMAL` on all six road-semantics cases.

## Science And Engineering Assessment

### Problem Shape

The solver is tackling a hybrid combinatorial optimization problem:

- rectangle packing for service and residential footprints
- weighted set packing for non-overlap and availability
- maximum coverage / facility-location style service bonuses
- connected or anchor-connected road-network design
- bounded-time anytime search for interactive use

This shape supports the current hybrid architecture. Greedy, LNS, and CP-SAT are not competing philosophies; they are complementary parts of one portfolio.

### Algorithm Direction

Best next algorithmic sequence:

1. CP-SAT model alignment and strengthening.
2. Adaptive LNS over semantic neighborhoods.
3. Auto budget retuning from telemetry.
4. Service-master decomposition experiments. Initial opt-in pass delivered; promotion remains gated on wider scorecards.
5. Geometry-native CP-SAT or external exact solvers only as controlled research branches.

Do not start runtime learned ranking yet. It should follow strict label artifacts, offline holdout wins, and equal-budget online evidence.

### Research Anchors

- OR-Tools CP-SAT is appropriate for integer combinatorial optimization and reports `OPTIMAL`, `FEASIBLE`, and bounded-search status. Reference: [OR-Tools CP-SAT guide](https://developers.google.com/optimization/cp/cp_solver).
- Adaptive Large Neighborhood Search is a strong fit for this solver shape because it combines multiple destroy/repair heuristics and rewards operators that improve. Reference: Ropke and Pisinger, [Adaptive Large Neighborhood Search](https://pubsonline.informs.org/doi/10.1287/trsc.1050.0135).
- Learning for combinatorial optimization is useful only when trained and evaluated on representative distributions with protected holdout evidence. Reference: Bengio, Lodi, and Prouvost, [Machine learning for combinatorial optimization](https://www.sciencedirect.com/science/article/pii/S0377221720306895).

## Architecture Review

### Strengths

- The solver contract is correctly incumbent-first: fast feasible incumbent, bounded repair, exact polish/proof.
- Exact validation remains deterministic and separate from heuristic or learned guidance.
- Auto records stage summaries, random seeds, timing, accepted population, and improvement.
- LNS telemetry records seed source, repair budgets, repair outcomes, stale time, and improvement.
- Portfolio code already records worker counts, CPU budget, seeds, and CPU-normalized signals.
- The planner exposes the actual user loop: solve, inspect, edit, validate, reuse, compare.
- The benchmark and experiment registry are good foundations for promotion discipline.

### Gaps

- LNS has an initial adaptive operator set, but learned window ranking still needs strict artifact evidence and offline baselines before runtime use.
- The default benchmark corpus is too small and too easy to saturate for promotion decisions.
- Planner workflows are not yet first-class benchmark cases.
- Stage telemetry is useful but not yet complete enough to diagnose candidate counts, model size, first feasible time, and best-score time across every run.
- LNS replay label infrastructure has scale-oriented splits and adaptive-operator labels, but model promotion still needs a strict generated artifact with enough non-neutral holdout signal.
- There is no trained model path, model artifact, offline metric report, or feature-flagged scorer ready for runtime use.
- Job state remains local-process memory; that is acceptable for a local planner but not for hosted multi-user scale.

## Recommended Next-Stage Roadmap

### Stage 1: CP-SAT Road-Semantics Alignment

Goal: make exact repair/proof match the formal spec.

Status: delivered.

Deliverables:

- Multi-anchor adversarial benchmark cases. Delivered for a focused CP-SAT case.
- CP-SAT versus TypeScript evaluator feasibility comparison. Delivered in regression coverage.
- An aligned road formulation that matches the per-component anchor rule. Delivered.
- Scorecard for aligned CP-SAT formulation. Delivered: `artifacts/cp-sat-road-semantics/2026-04-30/`.

Success signal:

- Spec, evaluator, and CP-SAT agree on road feasibility.
- Any formulation change improves or ties quality on relevant pressure families without invalid layouts.

### Stage 2: Product-Shaped Benchmark Corpus

Goal: judge solver changes on the real planning loop, not only saturated smoke tests.

Status: delivered. The initial selectable corpus, scorecard metadata, evidence-summary projection, artifact writer, strict registry-entry draft path, strict registry dry-run support, a `--product-promotion-matrix` preset, and direct `/api/layout/evaluate` replay metrics are delivered. Promotion evidence is registered as `product-corpus-scorecard-2026-04-30-promotion-1s-5s-30s-120s-seeds7-19-37` under `artifacts/product-corpus/2026-04-30/promotion-1s-5s-30s-120s-seeds7-19-37/` with `protectedHoldout=true`, 120 scorecards, exact seed coverage, no missing split/mode/budget/scorecard coverage, and artifact commit `7ad89dc0a953b981300064c7eb393c2613847aff`.

Deliverables:

- Keep the current default cross-mode cases as smoke tests.
- Add 6-10 representative planner payloads. Initial 10-case `--product-corpus` selector delivered.
- Add manual-layout replay through `/api/layout/evaluate`. Initial reusable-hint replay case and replay metric projection delivered.
- Add expansion-comparison replay. Initial expansion replay case and replay metric projection delivered; broader expansion-choice lift evidence remains.
- Add corridor, gate, footprint-pressure, service-pressure, anchor-service, and multi-anchor cases. Initial tagged coverage delivered; service-overlap remains future pressure coverage.
- Preserve development and protected holdout splits. Delivered with case-level split metadata, strict registry draft/dry-run checks, the fixed `--product-promotion-matrix`, checkpointed artifact evidence, and an appended protected-holdout registry entry.

Metrics:

- Feasible population at 1s, 5s, 30s, and 120s.
- Time to first feasible.
- Time to 95% of best known score.
- Time to best.
- CP-SAT gap/status.
- Reuse success for LNS seed and CP-SAT warm start.
- Manual-edit validation success.
- Expansion comparison lift.
- CPU-normalized efficiency for any parallel or portfolio run.

Success signal:

- Every solver-default proposal is backed by registered dev and holdout scorecards.

### Stage 3: Telemetry Manifests

Goal: make every improvement or regression explainable.

Status: delivered. Cross-mode scorecard artifact bundles include `telemetry-manifest.json` with command, git, hardware, per-run solver parameter summaries, wall/CPU timing, first-feasible and best-score timing, status/gap fields, candidate counts where available, CP-SAT model size where available, and per-stage Auto/Greedy/LNS/CP-SAT records. Product-corpus bundles also include evidence summaries, workflow replay artifacts, workflow replay telemetry manifests, and registry drafts. Learned-ranking label bundles emit label fingerprints, label/source counts, split metadata, LNS label-scale readiness, telemetry manifests, and strict registry-entry drafts. Model-experiment manifest and registry-draft helpers are available for future training runs; no model is trained by current scripts.

Deliverables:

- Per-run manifest with git commit, branch, command, case, seed, budget, hardware, and solver params.
- Per-stage manifest for Auto, Greedy, LNS, and CP-SAT.
- Candidate counts for services, residentials, roads, windows, and operators.
- CP-SAT model-size metadata where available.
- First-feasible time, best-score time, final status, final gap, wall time, CPU budget, and observed CPU time.
- Registry draft path for benchmark, workflow, label, and model artifacts. Label-bundle and product workflow dry-run support is delivered; model experiments have a helper contract for future training paths.

Success signal:

- A failed solver experiment can be diagnosed from artifacts without rerunning locally.

### Stage 4: Adaptive LNS

Goal: make LNS the main time-to-good-solution engine.

Status: delivered as the initial adaptive operator set. LNS now builds named semantic repair candidates, records the selected operator on each repair outcome, keeps per-operator attempts/feasible/improvement/regression/elapsed summaries, and raises operator weight after useful improvement while penalizing recoverable failures or regressions.

Deliverables:

- Operator interface for semantic destroy/repair choices. Delivered through named adaptive neighborhood candidates.
- Initial operators:
  - weak-service repair. Delivered.
  - residential-headroom cluster repair. Delivered.
  - frontier-congestion repair. Delivered.
  - gate/choke repair. Delivered.
  - service-overlap repair. Delivered.
  - random exploration windows. Delivered.
- Operator telemetry: attempts, feasible repairs, improvements, elapsed time, regression count, and family-level performance. Delivered through `lnsTelemetry.operatorSummaries`.
- Simple adaptive weighting that rewards operators with useful recent improvement. Delivered.

Success signal:

- Equal-budget LNS or Auto scorecards improve fixed-budget population or time-to-best without worst-decile regression.

### Stage 5: Auto Budget Retuning

Goal: tune orchestration only after telemetry identifies the bottleneck.

Status: delivered for the runtime default policy. The registered product-corpus promotion artifact kept Auto as the best default in 116/120 scorecards, with the remaining losses concentrated in short-budget LNS/CP-SAT pressure cases. Runtime Auto now uses the same trace-tuned LNS seed, repair, focused, escalated, iteration, and no-improvement defaults that scorecards use, while explicit caller settings still win. The default CP-SAT reserve ratio remains `0.2`; a targeted `0.35` reserve smoke probe tied mean population on the pressure slice rather than improving it.

Deliverables:

- Budget ablations over product-shaped corpus. Delivered through the registered product-corpus promotion scorecard and targeted post-change pressure smoke.
- Greedy seed budget, LNS repair budget, CP-SAT reserve, and no-improvement timeout comparisons. Delivered; LNS defaults were retuned, Greedy caps stayed conservative, and CP-SAT reserve stayed unchanged.
- Evidence-backed policy changes in `src/packages/solvers/auto/stagePolicy.ts`. Delivered.
- Family-level policy recommendations. Delivered as a conservative recommendation: keep Auto as default, use trace-tuned LNS repair defaults, and leave CP-SAT reserve as a configurable knob.

Success signal:

- New Auto policy beats baseline on protected holdout or reaches equal population faster with no CPU-normalized regression.

### CP-SAT Async And Portfolio Failure-Mode Coverage

Goal: keep exact-backend lifecycle behavior safe before increasing orchestration complexity.

Status: delivered. The async bridge and portfolio helper coverage now cover malformed streamed progress, no-final-result streamed-progress close, child-process diagnostics, blocked process-pool fallback, `BrokenProcessPool` fallback, worker `future.result()` failure after sibling progress, process-group cancellation, and portfolio snapshot propagation through background cancellation.

Deliverables:

- OR-Tools-free async failure regressions. Delivered.
- Portfolio fallback and worker-result failure regressions. Delivered.
- Background cancellation snapshot propagation regression. Delivered.
- OS-level portfolio child-process cancellation regression kept green.

Success signal:

- CP-SAT portfolio remains explicit-only, but lifecycle behavior is covered well enough for future label/replay and orchestration experiments.

### Stage 6: Exact Small-Window DP Repair

Goal: add dynamic programming only where it is naturally strong: tiny repair windows, narrow corridors, and exact oracle checks.

Status: delivered as a guarded opt-in subroutine. LNS can route eligible tiny repair windows through `small-window-dp`, with CP-SAT fallback for ineligible windows or no-feasible DP outcomes. The path is capped by mutable-cell, candidate, and state limits and reports per-outcome DP telemetry. No solver default changed.

Delivered entry criteria:

- The initial path stays opt-in for tiny-window and oracle use instead of changing the default Auto/LNS route.

Deliverables:

- Bitmask or profile-DP repair prototype for bounded LNS windows. Delivered as road-mask enumeration plus memoized residential set packing.
- Eligibility rules based on usable cell count, profile width, and typed availability state size. Delivered through mutable-cell, candidate-count, and state-count caps.
- Exact evaluator comparison against CP-SAT repair on the same windows. Delivered in OR-Tools-enabled regression coverage for an eligible tiny repair.
- Routing experiment that sends only eligible tiny repairs to DP and larger repairs to CP-SAT. Delivered as opt-in LNS routing with CP-SAT fallback.
- Regression tests using DP as a small-case oracle for CP-SAT road-semantics alignment. Delivered through exact evaluator validation and CP-SAT comparison on the same local repair window.

Success signal:

- DP returns evaluator-valid layouts, avoids CP-SAT on eligible tiny opt-in repairs, and leaves default LNS/Auto behavior unchanged until promotion scorecards justify a default route.

### Stage 7: Service-Master Decomposition Experiment

Goal: attack the strongest service/residential coupling if adaptive LNS is not enough.

Status: delivered as a guarded Greedy experiment. The new opt-in `greedy.serviceMasterDecomposition` pass enumerates bounded, type-aware, non-overlapping service layouts, evaluates each through the existing fixed-service residential packing plus road-repair realization path, and records master-layout profile counters. No default changed.

Deliverables:

- Experimental service-layout master problem. Delivered in `src/packages/solvers/greedy/serviceMasterDecomposition.ts`.
- Residential packing plus road-repair subproblem. Delivered by reusing the fixed-service realization evaluator.
- No-good cuts or service-swap neighborhoods. Delivered as duplicate, overlap, type-cap, and failed-layout pruning plus the existing fixed-service order/seed realization variants.
- Scorecards focused on service-overlap and facility-coverage pressure cases. Delivered as the `service-master-decomposition-experiment` benchmark and Greedy profile output for master layouts.

Success signal:

- The focused opt-in pressure case improves from 465 to 555 population, records service-master profile counters, and passes exact validation. Wider equal-budget scorecards are still required before promotion into Auto or default Greedy seed policy.

## Gated Research Tracks

### Learned Guidance

Do not train or integrate runtime learned guidance until:

- telemetry shows repeated ranking mistakes
- labels cover enough non-neutral development and holdout cases
- offline ranking beats deterministic, random, and single-feature baselines
- online equal-budget A/B improves population or time-to-best without worst-decile regression

Near-term learned work should stay offline.

### GPU

GPU is a research accelerator, not a direct solver replacement.

Do not start GPU work until:

- a CPU-first baseline exists
- training, label generation, feature extraction, or inference is a measured bottleneck
- hardware/runtime metadata is captured in artifacts
- batch-size break-even is reported

Possible future uses:

- offline model training
- batched feature extraction
- batched inference after an online scorer win
- alternative solver research under exact evaluator validation

### CP-SAT Portfolio

Keep portfolio explicit-only until it improves wall-clock quality and CPU-normalized efficiency over single CP-SAT. The existing paired tiny run does not justify Auto integration.

### Distributed Workers

Do not split API and solver workers unless hosted or multi-user execution becomes a product target. If it does, move job state to a durable queue/status store before horizontal scaling.

### External Exact Or Relaxation Solvers

MILP, SCIP, Gurobi, cuOpt, or other exact/relaxation adapters may be useful science instruments. They should not become product dependencies unless they preserve exact semantics and beat CP-SAT/Auto under equal-budget validation.

### Dynamic Programming Beyond Small Windows

Do not make global DP a primary solver path. Full-grid DP would need to encode occupied cells, remaining typed availability, service coverage, road-anchor connectivity, and future packing space, which is too large for the target problem. Keep DP bounded to exact assignment, tiny-window repair, narrow-profile experiments, and correctness oracles.

## Promotion Gates

Any default-path solver change must satisfy:

- exact validation passes for all final layouts
- at least 3 fixed seeds
- 1s / 5s / 30s / 120s budget reporting for promotion candidates
- protected holdout scorecard
- median population delta greater than 0, or equal population with at least 10% faster time-to-best
- worst-decile population delta >= 0 unless an explicit reviewed exception is documented
- regression rate <= 5%
- CPU-budget efficiency no worse than 10% below baseline unless population improvement justifies it
- all benchmark, hardware, split, command, model, and decision metadata registered

## Priority Recommendation

Recommended order:

1. Explore service-master decomposition if pressure cases justify it.
2. Revisit learned rankers only after strict scale-up artifacts, offline holdout, and online equal-budget gates pass.
3. Revisit GPU, portfolio, distributed solving, and external solvers only after a measured bottleneck and promotion-grade evidence exists.

This keeps the project pointed at the real target: higher validated population per wall-clock minute, with fewer speculative detours.
