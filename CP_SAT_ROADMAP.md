# CP-SAT Roadmap

## Goal

Strengthen `CP-SAT` as the exact/global solver.

This roadmap is intentionally not about quality-per-minute. The focus is:
- stronger exact search
- clearer exact-run visibility
- stable long-running execution
- scalable search orchestration

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

## Remaining Work By Impact

### 1. Distributed CP-SAT

Why it matters:
- this has the highest remaining compute ceiling
- it is now justified because single-machine exact solving, async execution, and measurement are already in place
- it is the only remaining item that can materially expand exact-search coverage beyond one host

Core requirements:
- coordinator for multi-worker or multi-machine exact runs
- shared incumbent and bound reporting
- worker lifecycle, cancellation, and degraded-mode handling
- stable final result selection and exact-run summary

### 2. Deepen async and portfolio failure-mode coverage

Why it matters:
- async and portfolio paths are shipped, but more edge-case coverage will make them safer to evolve
- this is the main confidence gap after distributed search

Scope:
- interruption and cancellation cases
- broken worker and degraded pool execution
- malformed streamed progress payloads
- async child-process failure paths

## Guardrails

- Keep this roadmap exact-solver focused; heuristic workflow belongs elsewhere.
- Prefer model and search-quality work before orchestration complexity.
- Treat residential pruning conservatively unless dominance is proven.
- Do not change the exact objective implicitly while tuning the model.
- Prefer async CP-SAT integration for new work.
