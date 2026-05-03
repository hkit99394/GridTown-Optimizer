# CP-SAT Roadmap Delivered

This file keeps the completed CP-SAT roadmap work out of the main roadmap so [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md) stays short and current.

Target alignment:

- the delivered CP-SAT work is now treated as exact improvement, proof, and label-generation infrastructure for the broader target of maximizing population per wall-clock budget
- future priority ordering lives in [SOLVER_ROADMAP.md](./SOLVER_ROADMAP.md) and [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md), not in this delivery record
- portfolio and worker-count wins should always be reported with CPU budget beside wall-clock time

## Delivered Work

### 1. Exact-safe candidate reduction

- faster placement precomputation
- conservative dominated-service pruning
- shared typed placement-map generation
- disconnected non-anchor candidate-region reduction

### 2. Stronger road-connectivity formulation

- anchor-boundary reachability filtering
- road-eligibility trimming
- canonical root symmetry break
- tighter inflow / anti-bidirectional-flow rules
- gate and corridor access cuts

### 3. Explicit exact objective audit

- objective now documented and tested as:
  `maximize population, then minimize roads + services`
- scaling factor audited against maximum tie-break swing

### 4. Stronger valid inequalities and implied bounds

- tighter total-population upper bounds
- achievable service-coverage bounds
- access-capacity cuts
- gated-region packing bounds
- pruning for objectively useless services

### 5. Expanded CP-SAT runtime surface

- time limit
- deterministic time
- worker count
- random seed
- randomized search
- relative / absolute gap limits
- search logging

### 6. Exact-run telemetry

- final incumbent / bound / gap telemetry
- time since last improvement
- branches / conflicts
- public solution contract support

### 7. Live progress streaming

- streamed incumbent updates
- streamed best-bound updates
- reusable async progress contract for Node callers
- CLI-visible live CP-SAT progress output

### 8. Async caller migration

- async-first public examples
- CLI on `solveAsync(...)`
- top-level CP-SAT integration tests moved to async-first coverage
- sync entrypoints retained as compatibility surfaces

### 9. Benchmark corpus and reproducible exact-run harness

- fixed benchmark corpus for single and portfolio CP-SAT cases
- reproducible benchmark defaults for time, deterministic time, workers, and seeds
- async progress timeline capture and stable JSON/text benchmark summaries
- public benchmark runner and npm entrypoint

### 10. Warm start and continuation

- `warmStartHint`
- `objectiveLowerBound`
- direct hint payloads or prior `Solution`
- tested continuation flow

### 11. Single-machine portfolio CP-SAT

- seeded worker generation
- portfolio winner selection
- per-worker status summary
- fallback from blocked process pools to threads

### 12. Per-component road-anchor connectivity

- aligned the CP-SAT road formulation with the formal rule that multiple road components are valid when each component touches row `0` or column `0`
- removed the legacy single-root mode switch; CP-SAT now uses the aligned per-component anchor formulation
- updated warm-start and local-neighborhood fixing so hinted multi-component road layouts can select roots per hinted component
- added the `multi-anchor-road-components` CP-SAT benchmark case
- verified CP-SAT reaches 200 population on the multi-anchor case

### 13. Road-semantics scorecard closeout

- added CP-SAT scorecard coverage for tiny, corridor, gate, service-pressure, multi-anchor, and dense saturated road-semantics families
- added model-size telemetry to CP-SAT result payloads and benchmark text output
- registered the scorecard artifact at `artifacts/cp-sat-road-semantics/2026-04-30/`
- the 5s single-worker scorecard reached `OPTIMAL` on all six cases, including 200 population on `multi-anchor-road-components`
- no solver default changed; the next CP-SAT priority is label and replay engine work

### 14. Initial async and portfolio failure-mode regressions

- covered malformed streamed progress with an OR-Tools-free fake async backend
- covered malformed portfolio-worker progress, verified no progress callback is emitted, and verified the backend is stopped
- covered non-zero async child-process exits with stderr/stdout diagnostics
- covered blocked process-pool fallback to threads and `BrokenProcessPool` fallback to threads

### 15. Async and portfolio failure-mode closeout

- added OR-Tools-free async regression coverage for streamed progress that closes without a final result payload
- added background CP-SAT cancellation coverage that returns the latest portfolio snapshot as a stopped solution while preserving selected worker and running-worker summaries
- hardened `run_portfolio_workers(...)` so pending futures are cancelled if one worker future fails after another worker already reported progress
- extended portfolio fallback helper coverage for worker-future failure after sibling progress, while keeping blocked process-pool and `BrokenProcessPool` thread fallbacks covered
- kept the process-group cancellation regression for child worker trees green
- no fan-out limit changed and portfolio remains explicit-only

## Notes

- The library now also exposes an async CP-SAT path through `solveAsync(...)` and `solveCpSatAsync(...)`.
- Remaining benchmark, distributed-execution, and label/replay work stays in [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md).
