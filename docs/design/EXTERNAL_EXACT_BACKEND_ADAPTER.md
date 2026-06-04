# External Exact Backend Adapter

Reviewed on 2026-06-01 as the R8 long-run plan from
[DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md](../roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md).

Status: trigger plan delivered. Runtime implementation remains gated until exact
bounds or incumbents remain blocked after an admitted CP-SAT tuning track has
run through the normal trigger workflow.

## Entry Guard

This plan becomes implementation work only when all of these are true:

- The trigger ledger admits a current exactness problem that CP-SAT tuning did
  not resolve.
- The problem names affected cases, budgets, seeds, workflow tags, and whether
  the objective is better incumbents, stronger bounds, proof, time-to-best, or
  label/replay reliability.
- Candidate intake records same-slice CP-SAT controls, evaluator-validity gates,
  CPU/time-to-best interpretation, and artifact storage expectations.
- The external backend can run opt-in without changing `auto` defaults or
  requiring provider dependencies for default local development.

Until then, keep the current CP-SAT bridge as the only exact backend. Do not use
this plan to add provider-specific options, license requirements, default solver
changes, external solver binaries, CP-SAT portfolio promotion, or broad evidence
runs.

## Architecture Review

Current exact execution is CP-SAT specific and intentionally narrow:

| Boundary             | Current Owner                                                                                                                               | Evidence                                                                               | R8 Read                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Optimizer routing    | `OptimizerAdapter` exposes `auto`, `greedy`, `lns`, and `cp-sat`; CP-SAT is the only exact optimizer adapter.                               | [optimizerRegistry.ts](../../src/packages/runtime/dispatch/optimizerRegistry.ts)       | External providers should not become new default optimizer names before an admitted trigger.       |
| Exact backend bridge | `solveCpSat` and `solveCpSatAsync` spawn `python/cp_sat_solver.py`, parse the raw payload, then materialize through validation.             | [solver.ts](../../src/packages/solvers/cp-sat/solver.ts)                               | This is the safest seam for a future backend-neutral exact-result contract.                        |
| Backend protocol     | `protocol.ts` validates raw placements, telemetry, portfolio summaries, and streamed progress events.                                       | [protocol.ts](../../src/packages/solvers/cp-sat/protocol.ts)                           | External output must be normalized before it touches planner or benchmark code.                    |
| Input options        | `CpSatOptions` carries runtime limits, warm-start hints, objective lower bounds, progress, stop, and snapshot channels.                     | [cpSatTypes.ts](../../src/packages/core/types/cpSatTypes.ts)                           | A future provider surface should preserve these common semantics and fence provider-only settings. |
| Input validation     | `assertValidCpSatOptions` bounds CP-SAT runtime, portfolio, warm-start, progress, and local process options.                                | [solverInputValidationCpSat.ts](../../src/packages/core/solverInputValidationCpSat.ts) | External provider options need equally strict validation and must stay opt-in.                     |
| Python model         | `cp_sat_model_builder.py` builds candidates, objective, feasibility constraints, warm starts, and model-size telemetry.                     | [cp_sat_model_builder.py](../../python/cp_sat_model_builder.py)                        | Backend-independent model semantics must be reviewed before any MILP/SCIP/Gurobi/cuOpt mapping.    |
| Formal feasibility   | The spec defines allowed cells, disjoint buildings, per-component road-anchor connectivity, building-road access, and population objective. | [SPEC.md](../requirements/SPEC.md)                                                     | External backends must not reinterpret feasibility or objective semantics.                         |

Current guarantees:

- CP-SAT final layouts are checked by `assertValidLayout` and
  `validateSolution` before becoming `Solution` objects.
- CP-SAT raw payloads cannot skip JSON shape validation.
- Incumbent population, best objective bound, population upper bound, and exact
  gap telemetry already have stable fields.
- Warm-start hints and objective lower bounds are available for continuation and
  repair workflows.
- CP-SAT readiness failure is local and optional; default development can skip
  OR-Tools runtime coverage when unavailable.

Current non-guarantees:

- No backend-neutral exact model contract exists.
- CP-SAT objective bounds are not automatically comparable to a different
  provider's objective unless the model mapping is audited.
- Provider dependencies, licenses, deterministic behavior, CPU accounting, and
  cancellation semantics are not represented in the current options.
- External exact solvers cannot be evaluated through a first-class adapter
  without touching CP-SAT-specific code.

## Risk Register

| Risk                        | Severity | Likelihood After Trigger | Evidence                                                                                            | Mitigation Direction                                                                                  |
| --------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Objective drift             | High     | High                     | CP-SAT owns the audited objective policy and tie-breaks today.                                      | Require an objective-policy fingerprint and cross-backend small-oracle checks before evidence.        |
| Feasibility drift           | High     | Medium                   | External models must reproduce road-anchor and building-access semantics exactly.                   | Keep evaluator validation mandatory and add infeasible/edge-case contract tests per provider.         |
| Bound misinterpretation     | High     | Medium                   | Bound fields are CP-SAT telemetry, not a provider-neutral proof format.                             | Normalize provider bounds into population upper-bound semantics only when mathematically justified.   |
| Provider dependency leakage | High     | Medium                   | CP-SAT readiness is optional today; external providers may require binaries, services, or licenses. | Keep providers opt-in, readiness-checked, and excluded from default install/test flows.               |
| Non-reproducible runs       | Medium   | High                     | External parallel search may vary by hardware, thread count, and license tier.                      | Record provider version, hardware, seed policy, threads, deterministic controls, and CPU budget.      |
| CPU-cost masking            | High     | Medium                   | Roadmap gates require CPU budget beside wall-clock for parallel exact work.                         | Treat wall-clock wins as diagnostics unless CPU-normalized scorecards pass.                           |
| Progress/cancel mismatch    | Medium   | Medium                   | Current async bridge and local stop channels are CP-SAT-specific.                                   | Define common progress and cancellation semantics before integrating providers.                       |
| Artifact explosion          | Medium   | High                     | Artifact hygiene is already in soft-warning posture.                                                | Require externalization plans before broad provider evidence.                                         |
| Auto/default coupling       | High     | Medium                   | `auto` composes CP-SAT for exact polish today.                                                      | Keep external providers out of `auto` until a separate default-path candidate is admitted and closed. |

## Target Adapter Contract

The adapter boundary should be exact-backend neutral, but it should start behind
the existing CP-SAT surface so public behavior stays stable.

Common request fields:

| Field             | Purpose                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `grid`            | The formal 0/1 allowed-cell grid.                                                                |
| `params`          | Sanitized solver parameters, catalogs, inventory limits, and exact runtime knobs.                |
| `objectivePolicy` | Audited population objective and tie-break interpretation.                                       |
| `warmStartHint`   | Optional incumbent layout, typed candidates, lower bound, repair hint, and neighborhood window.  |
| `limits`          | Wall-clock, deterministic time, thread count, CPU budget, gap limits, and no-improvement policy. |
| `progress`        | Optional callback contract for incumbents, bounds, and terminal result.                          |
| `cancellation`    | Stop channel or pollable cancel intent.                                                          |
| `snapshot`        | Optional best-feasible snapshot persistence hook for long-running planner solves.                |

Common response fields:

| Field                                                                 | Purpose                                                                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                              | Provider status normalized to exact-backend status vocabulary.                                                                                                                |
| `roads`, `services`, `residentials`, `populations`, `totalPopulation` | Candidate final layout before evaluator materialization.                                                                                                                      |
| `objectivePolicy`                                                     | Echoed policy proving the adapter solved the intended objective.                                                                                                              |
| `telemetry`                                                           | Wall time, user/CPU time, incumbent objective, best objective bound, population upper bound, gaps, branches/conflicts or provider equivalents, and model size when available. |
| `provider`                                                            | Provider id, version, capability summary, deterministic settings, threads, license/readiness status, and model fingerprint.                                                   |
| `stoppedByUser`                                                       | Whether cancellation shaped the terminal result.                                                                                                                              |

Required adapter capabilities:

| Capability             | Requirement                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `buildModel`           | Convert the shared exact model into provider-specific variables and constraints without changing semantics.         |
| `solve`                | Produce one terminal response or a typed failure.                                                                   |
| `solveAsync`           | Emit progress and terminal result through the common progress contract when supported.                              |
| `validateReadiness`    | Report missing binaries, Python packages, services, license keys, or unsupported provider versions.                 |
| `normalizeResult`      | Convert provider payloads into the common response before materialization.                                          |
| `describeCapabilities` | Declare support for warm starts, proof bounds, deterministic controls, cancellation, snapshots, and CPU accounting. |

Core invariants:

1. Every external final layout passes the existing evaluator before it can count
   as a result.
2. Provider bounds are exposed as population upper bounds only when the adapter
   proves the objective mapping is equivalent.
3. Provider-specific options are opt-in and validated; unknown provider options
   fail closed.
4. External providers do not change `auto`, `greedy`, `lns`, or default CP-SAT
   behavior.
5. CPU budget, wall-clock budget, provider version, hardware, and command line
   are recorded for any decision-grade artifact.
6. A provider readiness failure degrades to a clear opt-in error, not a local
   planner startup failure.
7. Existing `city-builder`, `city-builder/solver`, and `city-builder/benchmarks`
   entrypoints keep their current behavior until a later public API review.

## Implementation Plan

### Phase 0 - Current CP-SAT Only

Keep CP-SAT as the only exact backend. This is the active state while R8 has no
admitted trigger.

Success criteria:

- Current CP-SAT protocol, optimizer, route, and benchmark tests keep passing.
- External-provider docs do not add runtime dependencies or options.

### Phase 1 - Exact Contract Extraction

After trigger admission, extract backend-neutral exact request, response,
telemetry, progress, and capability types from the CP-SAT protocol without
adding an external provider.

Success criteria:

- CP-SAT remains the only implementation.
- CP-SAT raw parsing and materialization still validate through the current
  evaluator.
- Focused tests prove the extracted contract preserves incumbent, bound, gap,
  warm-start, and progress semantics.

### Phase 2 - CP-SAT Adapter Registry

Route CP-SAT through an exact-backend registry with one registered provider:
`cp-sat`. Keep public optimizer routing unchanged.

Success criteria:

- `optimizer: "cp-sat"` still resolves to the existing behavior.
- Unknown exact provider ids fail validation.
- Default local development and CI do not need a new provider.

### Phase 3 - Candidate Provider Stub

Add a contract-test-only provider or fixture adapter that exercises readiness,
invalid result rejection, bound normalization, timeout, cancellation, and
progress behavior without integrating a real external solver.

Success criteria:

- Contract tests can reject infeasible layouts, impossible bounds, malformed
  telemetry, and provider dependency failures.
- No product benchmark claims are made from the stub.

### Phase 4 - Opt-In External Provider

Integrate one real provider only through an admitted candidate intake. Candidate
examples include MILP/SCIP/Gurobi/cuOpt, but the selected provider must be named
by the trigger and supported by a dependency/readiness plan.

Success criteria:

- Provider execution is opt-in and readiness checked.
- Provider result materialization uses the existing evaluator.
- Small exact-oracle cases show objective and feasibility equivalence.
- Same-slice CP-SAT controls are recorded for the affected cases, budgets, and
  seeds.

### Phase 5 - Evidence And Closeout

Run only the candidate-specific evidence approved by intake.

Success criteria:

- Evaluator-validity and replay gates pass.
- CPU-normalized and wall-clock scorecards are interpreted separately.
- Artifact storage follows [ARTIFACT_POLICY.md](../ARTIFACT_POLICY.md).
- Closeout states whether the provider remains diagnostics-only, opt-in, or
  eligible for a later default-path candidate.

## Verification Plan

Minimum automated coverage before a real provider can count as evidence:

- Exact request/response contract tests.
- Provider readiness success and failure tests.
- Unknown provider and unknown option rejection tests.
- Malformed result and infeasible layout rejection tests.
- Bound normalization tests proving population upper bounds are sound.
- Warm-start and objective-lower-bound preservation tests.
- Timeout, cancellation, and no-final-result tests.
- Progress-stream parsing tests for incumbent and bound updates.
- Small oracle cases comparing CP-SAT and the external provider on objective,
  feasibility, and total population.

Minimum candidate evidence:

- Trigger-ledger admission and M9 intake.
- Same-slice CP-SAT baseline-repeat controls.
- Candidate-specific evaluator-validity and replay checks.
- At least three seeds when stochastic behavior or parallel scheduling can
  affect results.
- Wall-clock and CPU-budget reporting.
- Provider version, license/readiness mode, hardware, command, model
  fingerprint, and artifact metadata.
- Externalization plan before broad raw evidence.

## Public API Guidance

Do not add external provider names to `OptimizerName` by default. The first safe
surface is an opt-in exact-backend setting underneath the existing exact solver
track, reviewed after trigger admission. Public API changes should answer these
questions before implementation:

- Is this a benchmark-only research option or a planner-facing option?
- Does the provider require optional dependencies or license configuration?
- Are provider-specific options stable enough to expose, or should they stay in
  a candidate-only config object?
- Can a saved planner setup containing this option be opened on a machine
  without the provider?
- What compatibility behavior is expected if a provider disappears?

## Non-Goals

- No external solver implementation before trigger admission.
- No Auto/default solver change.
- No provider dependency in default install, build, or local planner startup.
- No evaluator bypass for provider-reported feasibility or population.
- No CP-SAT portfolio promotion.
- No distributed solving or multi-provider portfolio by default.
- No broad evidence generation while artifact hygiene is above the soft target
  without an externalization plan.

## Current Decision

R8 has a reviewed external exact-backend adapter boundary and rollout plan.
Implementation should stay parked until exact bounds or incumbents remain
blocked after admitted CP-SAT tuning, and the candidate intake names the provider,
storage plan, verification matrix, and opt-in surface.
