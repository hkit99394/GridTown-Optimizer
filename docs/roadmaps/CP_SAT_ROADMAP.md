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
- explicit audited objective
- richer runtime parameters
- warm-start and continuation support
- telemetry and streamed progress plumbing
- async-first caller path
- benchmark corpus and reproducible harness
- single-machine portfolio CP-SAT

Detailed delivered notes live in [CP_SAT_ROADMAP_DELIVERED.md](./CP_SAT_ROADMAP_DELIVERED.md).

## Remaining Work By Product Priority

### 1. Deepen async and portfolio failure-mode coverage

Impact on target: high confidence / medium direct quality

Why it matters:
- async and portfolio paths are shipped, but more edge-case coverage will make them safer to evolve
- this is the main confidence gap before increasing single-machine fan-out or starting distributed orchestration
- it protects the exact-solver contract that `auto`, planner reuse, and portfolio summaries now depend on

Scope:
- keep the OS-level orphan-process cancellation regression for portfolio worker trees green
- interruption and cancellation cases
- broken worker and degraded pool execution
- malformed streamed progress payloads
- async child-process failure paths

### 2. Use CP-SAT as a label and replay engine

Impact on target: high enabling value

Why it matters:
- learned ranking and better `LNS` control need trustworthy labels for "what would have happened if we repaired this different window?"
- CP-SAT already owns exact repair, warm starts, objective lower bounds, and progress telemetry
- replay workloads can use CPU parallelism while still reporting total CPU budget beside wall-clock time

Scope:
- counterfactual `LNS` window replay under equal repair budgets
- seed-quality comparisons for warm starts and objective lower bounds
- exact upper-bound and gap export into shared traces
- benchmark-safe replay harness that keeps final validation through the existing evaluator

Guardrails:
- do not let label generation leak holdout cases into model selection
- always record wall-clock and CPU budget for parallel replay
- keep `CP-SAT` labels tied to the exact model fingerprint and validated solution shape

### 3. Distributed CP-SAT

Priority note:
- this has the highest remaining exact-search compute ceiling, but not the highest near-term product leverage
- [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md) keeps distributed solving behind shared traces, deterministic feature work, single-machine portfolio hardening, workflow improvements, and cancellation confidence
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
- Do not raise portfolio fan-out limits or begin distributed orchestration before cancellation and degraded-worker behavior have dedicated coverage.
- Do not use CP-SAT parallelism as a headline win unless the scorecard reports CPU budget as well as wall-clock.
- Treat building connectivity-shadow scoring as a heuristic/planner feature first; CP-SAT already models exact feasibility and should mainly provide labels, proofs, and validation for it.
