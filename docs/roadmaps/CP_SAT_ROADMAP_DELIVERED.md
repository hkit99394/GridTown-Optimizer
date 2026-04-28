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

## Notes

- The library now also exposes an async CP-SAT path through `solveAsync(...)` and `solveCpSatAsync(...)`.
- Remaining benchmark, distributed-execution, and deeper failure-mode work stays in [CP_SAT_ROADMAP.md](./CP_SAT_ROADMAP.md).
