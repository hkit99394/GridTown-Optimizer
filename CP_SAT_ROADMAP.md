# CP-SAT Roadmap

## Goal

Strengthen `CP-SAT` as the exact/global solver for City Builder.

This roadmap is intentionally not about quality-per-minute. The focus is:
- tighter exact modeling
- stronger propagation and bounds
- more stable long runs
- clearer exact-solver observability

## Current Status

Tasks `1-8` are delivered.

Delivered summary:
- exact-safe candidate reduction
- stronger road-connectivity formulation
- explicit audited objective
- stronger valid cuts and implied bounds
- richer runtime controls
- exact-run telemetry
- warm-start / continuation support
- single-machine portfolio CP-SAT

Detailed delivered notes are in [CP_SAT_ROADMAP_DELIVERED.md](./CP_SAT_ROADMAP_DELIVERED.md).

## Remaining Work By Impact

### 1. Add live CP-SAT progress streaming

Why it is first:
- final telemetry already exists, but long exact runs still look opaque while they are in progress
- live incumbent / bound / gap reporting has the biggest immediate usability impact for exact solving
- it builds directly on the telemetry and async groundwork already in place

Scope:
- stream incumbent updates
- stream best-bound updates
- show gap and time since last improvement during the run
- make the progress contract reusable by CLI, server, and UI layers

### 2. Migrate more callers to `solveAsync(...)`

Why it is second:
- the async CP-SAT bridge already exists
- wider adoption removes avoidable Node-side blocking in real integrations
- this is the fastest way to turn the new execution path into real operational value

Scope:
- move higher-level callers away from the sync CP-SAT path where practical
- keep sync only as a compatibility surface
- align server/UI entrypoints on the async path first

### 3. Add a benchmark corpus and reproducible exact-run harness

Why it is third:
- future CP-SAT work needs trustworthy before/after comparisons
- distributed execution is hard to judge without a stable benchmark set
- this is the main guard against “more infrastructure, unclear gain”

Scope:
- fixed benchmark grids and parameter sets
- reproducible seeds and runtime settings
- recorded incumbent / bound / wall-time comparisons
- portfolio and async execution benchmarks

### 4. Distributed CP-SAT

Why it is fourth:
- this has the highest long-term compute ceiling, but not the biggest immediate impact
- it is only worth doing after single-machine exact solving, async execution, and measurement are all solid
- it is the highest-complexity remaining task

Core requirements:
- coordinator for multi-worker / multi-machine exact runs
- shared incumbent and bound reporting
- worker lifecycle, cancellation, and fault handling
- stable result selection and final exact-run summary

### 5. Deepen async and portfolio failure-mode coverage

Why it is fifth:
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
