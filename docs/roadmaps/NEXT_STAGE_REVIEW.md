# Next Stage Solver Review

Date: 2026-04-28

## Executive Summary

The solver stack is in a healthy measurement-first state. The project already has the important production pieces: Greedy, LNS, CP-SAT, Auto orchestration, exact validation, planner explainability, benchmark scorecards, deterministic ablation evidence, low-risk learned-ranking labels, and guarded CP-SAT portfolio execution.

The next stage should not promote GPU, portfolio, or learned ranking into the default path yet. The strongest next move is to build a long-running improvement loop that repeatedly gathers solver traces, produces counterfactual labels, trains small ranking policies offline, and only promotes a change when it beats the deterministic baseline on protected holdout cases under equal wall-clock and CPU-budget accounting.

GPU should be treated as an accelerator for the research and replay workflow first, not as a direct replacement for the current OR-Tools CP-SAT path. Near-term GPU value is most plausible in batched feature extraction, offline model training, and possibly experimental MILP/LP-style solver comparisons. It is less plausible as a drop-in speedup for LNS repair, because the current LNS repair path intentionally uses single-worker CP-SAT for stability.

## Current Status

### Shipped Runtime

- `auto` is the recommended quality path. It runs a Greedy seed, then repeated bounded LNS / CP-SAT cycles while improvement is still useful. CP-SAT portfolio options are stripped from Auto stage parameters, so portfolio remains an explicit `cp-sat` experiment path rather than part of Auto.
- `greedy` is a fast incumbent and diagnostics engine with restarts, local search, service ranking, final road cleanup, connectivity-shadow traces, and road-opportunity counterfactuals.
- `LNS` is the main improvement engine. It starts from a validated seed, generates deterministic repair windows, fixes outside the window, and calls CP-SAT for exact repair.
- `CP-SAT` is the exact model/backend. It provides proof when the result is `OPTIMAL`; bounded runs may return `FEASIBLE` without proof. It also supplies gap, upper-bound, warm-start, continuation, telemetry, async, and explicit portfolio support.
- The local web planner exposes saved layouts, manual editing, solved-map inspection, and explainability maps.

### Evidence Already Closed

- Deterministic ablations are closed as an evidence gate. No deterministic variant is ready for default promotion.
- Connectivity-shadow scoring is a learning target, not a default. It produced isolated wins with no population regressions in the gate, but it has a positive wall-clock cost.
- LNS anchor and window variants are learning targets because they move windows without population regressions, but they still require more counterfactual labels.
- Low-risk learned-ranking labels exist:
  - 4,593 Greedy labels.
  - 888 Greedy connectivity-shadow labels.
  - 3,705 Greedy road-opportunity near-miss labels.
  - 84 usable LNS replay labels.
  - Protected development/holdout splits.
- CPU portfolio is closed as a measurement/safety gate. The latest tiny paired run tied population while using more configured worker CPU budget, so portfolio should stay explicit-only and should not be routed through Auto without CPU-normalized wins.

### Fresh Health Check

Commands run during this review:

```bash
npm test
node dist/crossModeBenchmarkCli.js --modes=auto,greedy,lns,cp-sat --budgets=5 --seeds=7
```

Result:

- Test suite passed.
- The 5s, seed-7, four-case scorecard kept the current `auto` posture:
  - Auto matched the best score on all four default cases.
  - Greedy lost only on `row0-corridor-repair-pressure`, scoring 260 versus the best 275.
  - LNS and CP-SAT matched Auto on the default four-case sample.
  - Auto's useful improvement happened on the corridor pressure case, where LNS added +15 accepted population.

Artifact:

- [health-check summary](../../artifacts/health-checks/2026-04-28/SUMMARY.md)

Interpretation:

- The current default is safe and competitive on the default corpus.
- The best next-stage leverage is not a broad default change.
- The useful pressure case remains sparse anchor/corridor access, where Greedy can miss a repair that LNS/CP-SAT find.

## Architecture Review

### Strengths

- The solver contract is correctly incumbent-first. Greedy gives a fast feasible answer, LNS improves locally under bounded budgets, and CP-SAT supplies exact repair/proof.
- The exact evaluator remains the source of truth for validity and population. This is the right boundary for any learned guidance.
- Auto records stage summaries, random seeds, timing, candidate population, accepted population, and improvement, which gives enough structure to reason about budget allocation.
- LNS telemetry records seed source, seed timing, repair budgets, repair outcomes, stale time, and improvement, which is a good base for counterfactual learning.
- Portfolio code already accounts for worker counts, CPU budget, seeds, and total CPU-seconds. That is the right discipline before adding more parallelism.
- The roadmap already contains strong guardrails: equal-budget comparisons, exact validation, protected holdout, deterministic fallback, and CPU-budget reporting.

### Gaps

- The learned-guidance roadmap's early phases are now partially delivered, but the roadmap still reads as if measurement, trace export, ablations, and initial labels are future work. The next roadmap should distinguish `delivered`, `partial`, `needs scale`, and `not started`.
- LNS replay labels are too small for model promotion. The 84 usable labels are enough for schema and sanity checks, not robust generalization.
- The current LNS replay label bundle has no useful holdout improvement signal yet: the 36 holdout replay labels are usable but neutral. That blocks any claim that an LNS ranker can generalize.
- The default benchmark corpus is small and easy to saturate. It is useful for regression but not enough to decide GPU, learned ranking, portfolio, or long-running improvement policies.
- Auto spends time on LNS/CP-SAT even when the best score is already found early on saturated cases. This is acceptable for quality mode, but it suggests the improvement loop should learn case classes and saturation signals before retuning budgets.
- There is no durable experiment registry yet: artifacts exist, but there is no single catalog that links dataset fingerprint, solver commit, model version, benchmark suite, holdout status, and promotion decision.
- There is no trained model path yet. Labels exist, but there is no `python/ml/` experiment scaffold, offline metric report, or feature-flagged scorer interface.

## GPU Assessment

### What GPU Should Not Do First

- Do not try to make OR-Tools CP-SAT itself "use the GPU" as the next milestone. The current CP-SAT runtime is CPU/thread/worker-oriented, and local repair is explicitly single-worker for stability.
- Do not move legality, connectivity, scoring, or final validation to a model. Those should remain deterministic.
- Do not start with full RL or raw cell-by-cell generation. The current search stack is too valuable to bypass.

### Where GPU Can Help Soon

1. Offline training

   Train small ranking/value models over Greedy and LNS candidate features. GPU is useful once label volume grows, especially for neural rankers or large batched feature tensors. Start with simple models first so a CPU baseline exists.

2. Batched feature extraction

   Connectivity shadow and opportunity features are graph/grid-heavy. Most current cases are probably too small for GPU overhead to pay off, but a batched extractor can become worthwhile when generating thousands of replay states or larger pressure maps.

3. Parallel replay orchestration

   GPU does not directly accelerate CP-SAT repair, but the replay workflow can run CPU repair workers while GPU trains/ranks candidate windows. This keeps expensive exact labels and cheap model updates moving in parallel.

4. Experimental alternative exact/relaxation backend

   NVIDIA cuOpt is a GPU-accelerated optimization library for MILP, LP, QP, and VRP. It could be explored as an experimental backend for a linearized relaxation or MILP variant, but that is a research branch. It should not replace the current CP-SAT path until it preserves exact layout semantics and beats the baseline under the same validation and budget gates.

### Recommended GPU Track

Keep GPU as `research-accelerator`, with these gates:

- Phase G0: add hardware/runtime reporting to benchmark artifacts, including CPU model, logical cores, memory, GPU model, GPU memory, driver/runtime, and whether GPU was used.
- Phase G1: build a CPU-first offline ranking baseline from existing labels.
- Phase G2: add optional GPU training for the same feature schema and verify that model quality, not just training speed, improves enough to matter.
- Phase G3: add GPU-assisted batch inference only after the scorer has an online win. The inference budget must be counted in wall-clock.
- Phase G4: explore cuOpt or another GPU solver only as a separate adapter with a semantics-equivalent formulation, exact evaluator validation, CPU/GPU parity checks, and no default-path coupling.

Entry criteria for any GPU stage:

- a CPU-first baseline exists
- training, label generation, or inference cost is a measured bottleneck
- GPU runtime metadata can be captured in artifacts
- the batch-size break-even point is reported

## Recommended Long-Running Improvement Loop

The next stage should be an automated loop with a conservative promotion policy.

### 1. Capture

Run scheduled benchmark/replay jobs over fixed corpora and pressure-case generators.

Collect:

- solver commit and model fingerprint
- input fingerprint
- optimizer, mode, seed, budget, and runtime parameters
- hardware metadata, including CPU, memory, optional GPU, driver/runtime, and whether GPU was used
- Auto stage summaries
- LNS window candidates and chosen window
- Greedy candidate ordering traces
- CP-SAT status, bound, gap, and telemetry
- exact evaluator result
- wall-clock, CPU-budget, observed CPU time, and optional GPU usage

### 2. Label

Generate labels without contaminating holdout cases.

Greedy labels:

- selected versus near-miss candidate
- final downstream population delta where available
- connectivity-shadow and road-opportunity features

LNS labels:

- replay multiple candidate windows from the same incumbent
- keep repair budgets equal
- record population delta, validity, CP-SAT status, and model fingerprint
- keep invalid or timeout labels quarantined, not silently discarded
- include random/exploration windows beyond baseline top-k so the ranker is not trained only on the current policy's near choices
- include initial-incumbent, post-first-improvement, and post-stagnation states
- replay more than one repair budget when budget allocation is part of the target decision

### 3. Train

Start with small, interpretable rankers:

- logistic pairwise ranker
- gradient-boosted trees
- shallow neural ranker only after the above gives a useful baseline

Targets:

- Greedy service candidate re-ranking first
- LNS window re-ranking second, blocked until replay labels have positive and negative holdout signal
- value-guided seeds later only if seed quality becomes a measured bottleneck

### 4. Evaluate

Use two gates:

- Offline gate: held-out ranking quality must beat deterministic order, a random baseline, and a single-feature baseline, with metrics reported by case family.
- Online gate: feature-flagged solver must improve population at fixed wall-clock or reach the same population faster, with bounded worst-decile and family-level regressions.

Report:

- median delta
- worst-decile delta
- best-case delta
- regression rate
- wall-clock delta
- CPU-budget delta
- model inference overhead
- paired seeded confidence interval or bootstrap summary

Initial promotion thresholds:

- at least 3 seeds and the 5s / 30s / 120s budget set for promotion candidates
- median population delta greater than 0, or equal population with at least 10% faster time-to-best
- worst-decile population delta >= 0, unless an explicit reviewed exception is documented
- regression rate <= 5% and no invalid final layouts
- CPU-budget efficiency no worse than 10% below baseline unless population improvement justifies it
- model inference overhead <= 5% of the relevant wall-clock budget
- all reported final solutions pass exact validation

### 5. Promote Or Roll Back

Only promote when:

- exact validation passes
- protected holdout improves or ties safely
- deterministic fallback remains available
- artifacts include model version, feature schema, training data fingerprint, benchmark command, and decision

If a model fails:

- keep the labels
- mark the decision as `no-promotion`
- use the failure to create targeted pressure cases

## Next-Stage Roadmap

### Stage 1: Roadmap Reconciliation

Goal: make the docs reflect the real current state.

Deliverables:

- split learned-guidance items into delivered, partial, needs-scale, and not-started
- mark this review as an adopted next-stage infrastructure plan or keep it explicitly proposal-only
- add explicit promotion gates for GPU, learned rankers, and replay parallelism

Success signal:

- a new engineer can tell that traces, ablations, labels, and portfolio measurement exist, while model training and default promotion do not.

### Stage 2: Experiment Registry

Goal: make long-run improvement auditable.

Deliverables:

- `artifacts/experiments/index.jsonl`
- schema for run ID, git commit, branch, dataset fingerprint, case list, solver params, split status, label/model fingerprint, hardware, summary metrics, and decision
- helper to append benchmark and label-generation summaries
- seed the registry with the deterministic ablation, learned-label, CP-SAT portfolio, and health-check artifacts already in the repo

Success signal:

- every future "should we promote this?" question can be answered from indexed artifacts instead of hunting through folders, and the existing 2026-04-27 / 2026-04-28 artifacts are discoverable from the registry.

### Stage 3: Label Scale-Up

Goal: grow labels where evidence says learning can help.

Deliverables:

- larger LNS replay corpus across generated corridor, gate, footprint-pressure, and service-pressure cases
- split-protected replay states beyond initial incumbent only, such as post-first-improvement and post-stagnation states
- model-fingerprint field tied to CP-SAT formulation and solver params
- effective sample-size reporting by family and split

Success signal:

- LNS replay labels are large and diverse enough to train and evaluate a simple window ranker without label collapse:
  - at least 5 pressure families
  - at least 3 seeds per family
  - at least 200 usable labels in each of development and holdout
  - at least 50 non-neutral labels in each of development and holdout
  - no family with fewer than 20 usable labels
  - neutral-label ratio below 85% in both development and holdout

### Stage 4A: Greedy Offline Ranking Baseline

Goal: learn something small from the stronger Greedy label bundle before changing runtime behavior.

Deliverables:

- `python/ml/` training scaffold
- feature schema loader for learned-ranking label bundles
- pairwise Greedy ranker experiment
- offline report with development and holdout metrics
- deterministic-order, random, and single-feature baselines

Success signal:

- at least one small Greedy model beats deterministic ordering offline on holdout without relying on leaked case names.

### Stage 4B: LNS Offline Ranking Baseline

Goal: train an LNS ranker only after Stage 3 produces enough signal.

Entry criteria:

- Stage 3 label-scale gates are satisfied
- holdout labels include non-neutral improvement/regression signal
- replay data includes exploration windows beyond baseline top-k

Deliverables:

- LNS window ranker experiment
- metrics by pressure family and incumbent-state type
- top-1 regret, NDCG@K, and pairwise ranking metrics

Success signal:

- the LNS ranker beats deterministic ordering, random ordering, and simple hand-feature baselines on protected holdout.

### Stage 5: Feature-Flagged Online A/B

Goal: test learned guidance in the real solver loop.

Deliverables:

- `greedy.learnedServiceRanking` hook or equivalent scorer adapter
- `lns.learnedWindowRanking` hook after window generation and before selection
- deterministic fallback and model-load failure fallback
- equal-budget online benchmark report

Success signal:

- learned scorer improves fixed-budget population or time-to-best on holdout pressure cases, with acceptable worst-decile behavior.

### Stage 6: GPU Acceleration Track

Goal: use GPU where it helps the workflow, not where it is fashionable.

Entry criteria:

- a CPU-first ranker has an offline or online win
- training, label generation, or inference is a measured bottleneck
- hardware/runtime metadata is recorded in artifacts

Deliverables:

- hardware metadata in scorecards and label artifacts
- optional GPU training path for the offline rankers
- batched inference benchmark once a scorer has an online win
- optional experimental cuOpt adapter spike only if a MILP/relaxation formulation is explicitly chosen
- CPU/GPU parity and batch-size break-even reports

Success signal:

- GPU reduces time-to-label, time-to-train, or online inference overhead enough to accelerate the improvement loop, while solver quality gates remain unchanged.

## Priority Recommendation

Recommended order:

1. Reconcile docs and seed the experiment registry.
2. Scale LNS replay labels and generated pressure cases.
3. Train a CPU-first Greedy offline ranker as a diagnostic.
4. Train an LNS offline ranker only after the label-scale gates pass.
5. Add feature-flagged online Greedy/LNS rankers only after offline holdout wins.
6. Add GPU training/inference acceleration only after the CPU baseline is useful and bottlenecked.
7. Revisit portfolio/distributed/alternative GPU solvers only after the improvement loop can prove the bottleneck.

This keeps the project pointed at the real target: higher population per wall-clock minute, with exact validation and repeatable evidence.
