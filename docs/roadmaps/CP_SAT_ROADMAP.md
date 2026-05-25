# CP-SAT Roadmap

## Goal

Strengthen `CP-SAT` as the exact/global solver.

This roadmap supports the product target, but it is not the first place to chase quality-per-minute. `CP-SAT` is most valuable when it supplies exact improvement, proof, upper bounds, warm-start polishing, and reliable labels for benchmark/replay work.

The focus is:

- stronger exact search
- clearer exact-run visibility
- stable long-running execution
- scalable search orchestration
- trustworthy bound/label generation for `auto`, `LNS`, and learned-guidance experiments

## Current Status

The single-machine CP-SAT foundation is delivered.

Delivered summary:

- exact-safe candidate reduction
- stronger connectivity and implied cuts
- aligned per-component road-anchor connectivity
- explicit audited objective
- richer runtime parameters
- warm-start and continuation support
- telemetry and streamed progress plumbing
- async-first caller path
- benchmark corpus and reproducible harness
- single-machine portfolio CP-SAT
- road-semantics scorecard closeout with model-size telemetry
- async and portfolio failure-mode closeout

Detailed delivered notes live in [CP_SAT_ROADMAP_DELIVERED.md](./CP_SAT_ROADMAP_DELIVERED.md).

## Product Priority Lanes

These are maintenance or gated extension lanes. The current solver roadmap remains the source of truth for default-path promotion decisions.

Ordering note: this CP-SAT-specific list follows the consolidated [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md). Road-semantics, telemetry, async/portfolio failure-mode closeouts, and the local exact backend needed by label/replay workflows are delivered. There is no current active CP-SAT default-path change; future CP-SAT work should start only from a solver-roadmap trigger, and distributed CP-SAT remains gated.

### 1. Support future solver-roadmap label/replay triggers

Status: delivered foundation, gated future use

Why it matters:

- learned ranking and better `LNS` control still need trustworthy labels for "what would have happened if we repaired this different window?" whenever [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md) reopens learned guidance
- CP-SAT already owns exact repair, warm starts, objective lower bounds, and progress telemetry
- replay workloads can use CPU parallelism while still reporting total CPU budget beside wall-clock time

Scope:

- preserve counterfactual `LNS` window replay under equal repair budgets
- preserve seed-quality comparison, warm-start, objective-bound, and exact-gap trace support
- keep benchmark-safe replay harnesses tied to evaluator-validated final layouts
- wait for a fresh solver-roadmap trigger before expanding label/replay machinery

Guardrails:

- do not let label generation leak holdout cases into model selection
- always record wall-clock and CPU budget for parallel replay
- keep `CP-SAT` labels tied to the exact model fingerprint and validated solution shape

### 2. Distributed CP-SAT

Priority note:

- this has the highest remaining exact-search compute ceiling, but not the highest near-term product leverage
- [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md) keeps distributed solving behind shared traces, deterministic feature work, single-machine portfolio scorecards, workflow improvements, and fresh lifecycle coverage for any new orchestration tier
- treat distributed CP-SAT as the next orchestration tier after local portfolio execution is demonstrably safe

Why it matters:

- it can materially expand exact-search coverage beyond one host
- the single-machine exact foundation, async execution, and measurement are already in place
- it gives exact search more ceiling once the local lifecycle risks are lower

Core requirements:

- coordinator for multi-worker or multi-machine exact runs
- shared incumbent and bound reporting
- worker lifecycle, cancellation, and degraded-mode handling
- stable final result selection and exact-run summary

## Guardrails

- Keep this roadmap exact-solver focused; heuristic workflow belongs elsewhere.
- Prefer model and search-quality work before orchestration complexity.
- Treat residential pruning conservatively unless dominance is proven.
- Do not change the exact objective implicitly while tuning the model.
- Prefer async CP-SAT integration for new work.
- Do not raise portfolio fan-out limits or begin distributed orchestration without fresh CPU-normalized scorecards and lifecycle coverage for the new orchestration tier.
- Do not use CP-SAT parallelism as a headline win unless the scorecard reports CPU budget as well as wall-clock.
- Treat building connectivity-shadow scoring as a heuristic/planner feature first; CP-SAT already models exact feasibility and should mainly provide labels, proofs, and validation for it.
- Treat CP-SAT semantic gates as OR-Tools-enabled checks; a default test run that skips CP-SAT runtime coverage is not enough evidence by itself.
