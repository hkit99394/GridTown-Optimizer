# CP-SAT Roadmap

## Goal

Strengthen `CP-SAT` as the exact/global solver for City Builder.

This roadmap is intentionally not about quality-per-minute. The focus is:
- tighter exact modeling
- stronger propagation and bounds
- more stable long runs
- clearer exact-solver observability

## Current Status

The main single-machine CP-SAT foundation is delivered.

Delivered summary:
- exact-safe candidate reduction
- stronger road-connectivity formulation
- explicit audited objective
- stronger valid cuts and implied bounds
- richer runtime controls
- exact-run telemetry
- live progress streaming
- async caller migration
- benchmark corpus and reproducible exact-run harness
- warm-start / continuation support
- single-machine portfolio CP-SAT

Detailed delivered notes are in [CP_SAT_ROADMAP_DELIVERED.md](./CP_SAT_ROADMAP_DELIVERED.md).

## Remaining Work By Impact

### 1. Distributed CP-SAT

Why it is first:
- this has the highest long-term compute ceiling, but not the biggest immediate impact
- it is only worth doing after single-machine exact solving, async execution, and measurement are all solid
- it is the highest-complexity remaining task

Core requirements:
- coordinator for multi-worker / multi-machine exact runs
- shared incumbent and bound reporting
- worker lifecycle, cancellation, and fault handling
- stable result selection and final exact-run summary

### 2. Deepen async and portfolio failure-mode coverage

Why it is second:
- the important validation and fallback tests now exist
- more edge-case coverage is still worthwhile, but it is a confidence multiplier rather than a primary capability gain

Scope:
- interruption and cancellation cases
- broken worker / degraded pool execution
- malformed streamed progress payloads
- async child-process failure paths

## Guardrails

- Keep this roadmap exact-solver focused; heuristic workflow belongs elsewhere.
- Prefer formulation improvements before orchestration complexity.
- Treat residential candidate pruning conservatively unless dominance is proven.
- Do not change the exact objective implicitly while tuning the model.
- Keep the sync CP-SAT entrypoint only as a compatibility surface; prefer async for new integration work.
- Treat distributed CP-SAT as a measured infrastructure step, not an automatic next move.
