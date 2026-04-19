# Learned Guidance Roadmap

## Goal

Improve solution quality per minute by adding learned guidance on top of the existing solver stack.

This roadmap is intentionally about `hybrid search`, not replacing the current solvers. The target shape is:

1. deterministic candidate generation and legality checks
2. learned ranking / value guidance over those candidates
3. `LNS` and `CP-SAT` as the hard-improvement engines
4. exact final validation and scoring

## Non-Goals

This roadmap is not about:
- replacing [src/core/evaluator.ts](./src/core/evaluator.ts) as the source of truth for legality and population
- replacing [src/cp-sat/solver.ts](./src/cp-sat/solver.ts) as the exact repair / global solve path
- learning road connectivity or shortest-path logic that is already solved cleanly with graph algorithms
- training a raw cell-by-cell end-to-end RL agent as the first milestone

## Principles

- Keep exact legality and final scoring deterministic.
- Instrument first, train second.
- Prefer supervised ranking or bandit-style guidance before full RL.
- Use AlphaGo / AlphaZero as search-guidance inspiration, not as a self-play template.
- Only pursue full RL after cheaper learned baselines already win.
- Keep learned logic behind feature flags and preserve deterministic fallback behavior.
- Compare approaches under equal wall-clock and equal solver-budget constraints.

## Current Status

### What already exists

- `greedy`, `LNS`, `CP-SAT`, and `auto` are all shipped.
- `LNS` already has a strong hybrid shape: seed, neighborhood selection, exact repair, incumbent acceptance.
- `CP-SAT` already supports warm starts and bounded continuation.
- exact layout validation and population scoring are already centralized.

Relevant docs:
- [README.md](./README.md)
- [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md)
- [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md)
- [ALGORITHM.md](./ALGORITHM.md)

### What is missing

- a generic benchmark and event layer for `greedy`, `LNS`, and `CP-SAT`
- equal-budget measurement for incumbent-quality-over-time across all optimizers
- trace logging that is rich enough to support offline learning
- a shipped `LNS` benchmark / export path that matches the existing `greedy` and `CP-SAT` suites
- ablation data showing where the current heuristic lift actually comes from

## AlphaGo / AlphaZero Feasibility

Current conclusion:
- This repo is a good fit for learned guidance in the narrow AlphaGo sense: learned policies or values should steer strong deterministic search, not replace it.
- The strongest current seam is `LNS` control, especially neighborhood re-ranking under a fixed repair budget.
- Full end-to-end RL is not a current implementation priority. It belongs on a gated research track after cheaper learned baselines win.

What transfers well:
- policy / value guidance around exact legality, validation, and search
- ranking which candidate, neighborhood, or seed to try next
- learning the control layer while keeping `CP-SAT` and exact scoring deterministic

What does not transfer well:
- adversarial self-play assumptions
- cheap rollout assumptions, because one useful `LNS` label may cost a bounded `CP-SAT` repair run
- raw cell-by-cell generation or attempts to replace `CP-SAT`

Gates before any RL work:
- finish deterministic `LNS` stopping and budget policy in [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md)
- add shared traces and a reusable `LNS` benchmark / export path
- close reusable `CP-SAT` input validation gaps
- beat deterministic baselines with supervised reranking or bandits under equal wall-clock on holdout cases

## Roadmap

### Ordering By Priority

The current recommended order inside the learned-guidance track is:

1. measurement foundation and shared cross-optimizer traces
2. baseline ablations
3. learned greedy service re-ranking
4. learned `LNS` window re-ranking
5. counterfactual `LNS` replay data
6. value-guided seed experiments, only if seed quality becomes a measured bottleneck
7. contextual bandits for `LNS` control, only if re-ranking already wins
8. full RL, research-only and only if all earlier gates are cleared

Why this order:
- phases 0 through 4 reduce uncertainty and create reusable data at the lowest experimentation cost
- phases 5 through 8 depend on a more stable solver policy, better reusable-input validation, and more expensive labels

### Phase 0: Measurement Foundation

Status: First

Why:
- the repo already has `greedy` and `CP-SAT` benchmark support, but it still lacks a shared cross-optimizer trace layer and a shipped `LNS` benchmark path
- `greedy` and `LNS` do not yet expose enough common progress events to support fair learning experiments
- success metrics like `time-to-first-improvement` and `time-to-best-incumbent` are not consistently measurable yet

Concrete work:
- add shared optimizer run events to [src/core/types.ts](./src/core/types.ts)
- add a generic benchmark / trace runner for `greedy`, `LNS`, and `CP-SAT`
- emit JSONL traces for solver milestones:
  - seed built
  - restart completed
  - local-search improvement
  - neighborhood window chosen
  - repair completed
  - incumbent improved
  - solver finished
- make benchmark runs reproducible with explicit seeds where supported
- record final validation using [src/core/evaluator.ts](./src/core/evaluator.ts)

Deliverables:
- a reusable benchmark CLI for all optimizers
- a stable trace schema
- a benchmark corpus split for development vs holdout evaluation

Exit criteria:
- we can compare all optimizers under equal time budgets
- we can plot incumbent quality over time for `greedy`, `LNS`, and `CP-SAT`
- every reported result is validated by the exact evaluator

### Phase 1: Baseline Ablation

Status: First

Why:
- before adding learning, we need to isolate which existing pieces already provide the most lift
- `LNS` currently mixes seed generation, deterministic upgrades, and exact repair
- without ablations, learned lift will be easy to overclaim

Concrete work:
- benchmark `greedy` with and without:
  - restarts
  - local search
  - service refinement
  - exhaustive service search
- benchmark `LNS` with and without:
  - deterministic dominance upgrades
  - current neighborhood ordering
  - CP-SAT repair
- measure the marginal value of `warmStartHint` and `objectiveLowerBound` on `CP-SAT`

Deliverables:
- an ablation matrix with median, worst-decile, and best-case outcomes
- a short write-up on where current solver quality-per-minute is coming from

Exit criteria:
- we know which components are worth learning around
- we know which components should remain deterministic

### Phase 2: Learned Greedy Service Re-Ranking

Status: First ML milestone

Why:
- this is cheaper than `LNS`-guided learning
- it creates many labeled decisions per run
- it is easier to benchmark than CP-SAT-backed neighborhood repair

Target:
- learn to re-rank service candidates in the greedy construction path

Concrete work:
- log greedy construction states and service candidate features
- train a lightweight offline model in a separate research path, for example under `python/ml/`
- start with supervised ranking, not RL
- integrate the scorer behind a feature flag such as `greedy.learnedServiceRanking`

Deliverables:
- a baseline learned service scorer
- offline ranking metrics
- online A/B benchmarks against the current hand-written ordering

Exit criteria:
- at fixed wall-clock, the learned scorer beats the current greedy service ordering on median benchmark quality
- worst-decile performance does not regress materially
- final solutions still validate exactly

### Phase 3: Learned LNS Window Re-Ranking

Status: Second ML milestone

Why:
- `LNS` is already the closest analogue to policy-guided search
- the code already separates window generation from repair
- re-ranking is much lower risk than replacing neighborhood construction outright

Important constraint:
- keep the current `buildNeighborhoodWindows(...)` control path deterministic
- do not move learned logic into the baseline window builder
- add a separate re-ranking step after window generation and before selection

Target:
- reorder candidate windows based on predicted improvement under a fixed repair budget

Concrete work:
- log incumbent state, candidate windows, chosen window, repair budget, and outcome
- add a feature-flagged `rerankNeighborhoodWindows(...)` stage
- compare baseline ordering vs learned ordering under the same CP-SAT budget

Deliverables:
- feature-flagged LNS window re-ranker
- replay harness for ranked-window evaluation
- benchmark report with repeated seeded runs

Exit criteria:
- learned re-ranking improves `best population at fixed repair budget`
- learned re-ranking improves `time-to-strong-incumbent`
- deterministic fallback remains unchanged and existing baseline tests remain valid

### Phase 4: Counterfactual Label Collection For LNS

Status: Required before stronger LNS learning

Why:
- logging only the chosen window produces selection-biased data
- we need some counterfactual evidence for windows the baseline did not pick

Concrete work:
- sample incumbent states from benchmark runs
- replay multiple candidate windows from the same state
- keep CP-SAT repair budgets equal across replayed windows
- store actual downstream improvement for each replayed window

Deliverables:
- a small but trustworthy labeled replay dataset
- train / validation / holdout splits that prevent benchmark leakage

Exit criteria:
- offline ranking quality is stable on held-out states
- the dataset is large enough to support window re-ranking experiments without obvious label collapse

### Phase 5: Value Model And CP-SAT Warm Starts

Status: Later, and only if seed quality becomes a measured bottleneck

Why:
- this is the closest analogue to AlphaGo-style value guidance
- `CP-SAT` already supports warm starts, so stronger seeds can compound with exact search
- the current runtime usually carries one incumbent forward, so this is not yet the first demonstrated production bottleneck

Targets:
- predict which partial layouts or incumbents are most promising
- rank candidate seeds before exact solve
- build stronger `warmStartHint` payloads

Concrete work:
- train a value model on partial-layout snapshots
- compare current seed policies vs learned seed ranking
- benchmark `CP-SAT` continuation quality with and without learned seed guidance

Deliverables:
- a partial-layout value estimator
- a learned seed-ranking experiment for `CP-SAT`

Exit criteria:
- learned seeds improve incumbent quality or time-to-quality under equal `CP-SAT` budgets

### Phase 6: Contextual Bandits Or RL

Status: Research-only, only after earlier phases prove value

Why:
- RL adds training and evaluation complexity
- if supervised ranking and value guidance already work, RL should only be added when it clearly improves search control
- `LNS` labels are expensive because they require bounded `CP-SAT` repair, and current local repair still runs single-worker for stability

Good RL targets:
- choose which `LNS` window to repair next
- allocate limited repair budget across neighborhoods
- decide when to revisit a region vs diversify

Bad RL targets:
- exact legality checking
- graph connectivity routines
- raw cell-by-cell layout generation as the first learned system
- replacing `CP-SAT`

Deliverables:
- a controlled online learning sandbox
- strict legality masks over all learned decisions
- equal-budget comparisons against the best supervised baseline

Exit criteria:
- the RL or bandit policy consistently beats the best supervised guidance baseline
- the added complexity is justified by measured gains, not only by research interest

Additional gates:
- deterministic `LNS` stopping and budget policy has stabilized
- shared traces and a shipped `LNS` benchmark path exist
- reusable `CP-SAT` checkpoint and hint inputs are validated well enough for learned seed experiments

## File Placement Guidance

### Core runtime integration

- [src/core/types.ts](./src/core/types.ts): shared event, trace, and benchmark types
- [src/runtime/solve.ts](./src/runtime/solve.ts): common solver callback / instrumentation entry point
- [src/greedy/solver.ts](./src/greedy/solver.ts): greedy trace emission and optional learned service re-ranking hook
- [src/lns/solver.ts](./src/lns/solver.ts): `LNS` trace emission and optional learned window re-ranking hook
- [src/cp-sat/solver.ts](./src/cp-sat/solver.ts): benchmark-safe warm-start comparisons and seed-quality reporting

### Benchmarking and research support

- add a generic optimizer benchmark module next to [src/benchmarks/greedy.ts](./src/benchmarks/greedy.ts) and [src/benchmarks/cpSat.ts](./src/benchmarks/cpSat.ts)
- keep model-training code out of the main app path, for example under `python/ml/`
- keep persisted traces as plain JSONL to stay easy to inspect and replay

## Success Gates

Every milestone should clear all of the following before the next phase begins:

1. Equal-budget comparison:
   compare under matched wall-clock and matched `CP-SAT` repair budgets

2. Exact validation:
   every reported solution must pass [src/core/evaluator.ts](./src/core/evaluator.ts)

3. Repeated seeded runs:
   use repeated runs where randomness exists and report aggregate statistics

4. Robust summary:
   report median, worst-decile, and best-case outcomes, not only the mean

5. Holdout protection:
   keep a benchmark split that is never used for training or model selection

6. Deterministic fallback:
   preserve the current non-ML path and keep it easy to compare against the learned path

## Guardrails

- Do not replace exact scoring or legality with learned approximations.
- Do not push learned logic into baseline deterministic helpers when tests depend on their ordering.
- Do not call a scorer or budget allocator `RL` unless it actually uses an online reward-learning loop.
- Prefer small, interpretable models before large deep models.
- Treat trace quality and benchmark discipline as first-class engineering work, not “research overhead.”

## Risks

- `LNS` labels are expensive because they require `CP-SAT` repair, and local repair still runs single-worker for stability.
- Selection bias is a real risk for offline LNS data.
- The shipped benchmark corpora are enough for regression and ablation, not strong ML generalization claims by themselves.
- The strongest learned component may turn out to be ranking or budget allocation, not full RL.
- The deterministic solver policy is still moving, especially around `LNS` stopping and budgeting.
- Reusable `CP-SAT` input validation is not fully finished yet.

## Summary

The recommended sequence is:

1. measurement foundation and shared traces
2. ablations
3. learned greedy service re-ranking
4. learned `LNS` window re-ranking
5. counterfactual `LNS` replay data
6. value-guided warm starts only if seed quality becomes a measured bottleneck
7. contextual bandits only if re-ranking already wins
8. full RL only as gated research after earlier phases already win

This keeps the project grounded in the strengths of the current solver stack while still leaving room for Go-style learned guidance where it can actually help.
