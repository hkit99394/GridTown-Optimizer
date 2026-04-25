# Solver Roadmap

## Goal

Maximize solution quality per minute while keeping the solver workflow reliable, observable, and easy to use from the planner.

The working runtime strategy is:

1. Get a strong incumbent fast with `greedy`
2. Improve that incumbent cheaply with `LNS`
3. Use `CP-SAT` as a bounded deep-improvement or proof pass
4. Let planner-visible `auto` orchestrate that staged incumbent-first flow
5. Keep raw `greedy`, `LNS`, and `CP-SAT` available as manual and advanced modes

User-facing solver mode policy:

| Mode | Best for | Expected posture | Uses displayed layout by default | When not to use |
| --- | --- | --- | --- | --- |
| `auto` | default quality path | time-boxed best effort that keeps the best incumbent and explains why it stopped | yes, as `LNS` seed / `CP-SAT` hint when compatible | when you specifically need a raw heuristic or exact-only diagnostic run |
| `greedy` | fast legal layouts and seed-quality inspection | quickest standalone heuristic baseline | no | when overall answer quality matters more than speed |
| `LNS` | improving the current displayed or greedy-seeded layout | bounded neighborhood repair around an incumbent | yes | when there is no useful incumbent or when exact proof/bounds matter most |
| `CP-SAT` | bounded exact improvement, proof, and diagnostics | single exact run with optional warm start and progress bounds | yes, as a hint when compatible | when a fast first incumbent is more important than deeper exact search |
| `CP-SAT portfolio` | advanced exact search inside one machine budget | multiple exact-search paths competing within explicit guardrails | yes, as hints per worker when compatible | before worker caps, stop propagation, and CPU budget rules are enforced |

## Current Status

### Done

#### 1. The full solver stack is shipped

Status: Completed

What exists today:
- `greedy`, `LNS`, `CP-SAT`, and `auto` are all available in the backend, CLI, and planner.
- `auto` runs staged `greedy -> LNS -> CP-SAT` cycles with weak-cycle stopping, wall-clock caps, stage metadata, and generated per-stage random seeds.
- `LNS` can start from either a greedy incumbent or a displayed saved-layout seed.
- `LNS` keeps the best known incumbent, supports stop / snapshot recovery, and treats recoverable repair misses as `no improvement` instead of a full run failure.
- `CP-SAT` supports bounded exact runs, continuation hints, lower bounds, no-improvement cutoffs, and the async solve path used by runtime-facing integrations.

#### 2. The incumbent-first workflow is the default quality path

Status: Completed

What exists today:
- omitted-optimizer runtime/API calls resolve to `auto`
- the planner defaults to `auto`
- the example CLI defaults to `auto`
- the planner presents `auto` as the recommended quality path
- planner runtime presets keep `Heavy Greedy`, `LNS Improve`, and `Bounded CP-SAT` one click away
- stage-aware runtime messages, live snapshots, stop support, and persisted progress logs are in place
- displayed layouts are reused as the default `LNS` seed or `CP-SAT` hint when fingerprints match
- saved layouts can persist reusable `CP-SAT` continuation checkpoints
- unsupported `LNS` repair-worker controls and planner-only reuse toggles have been removed from backend solve requests
- direct `greedy` runs must request `optimizer: "greedy"` explicitly

#### 3. Reproducibility, exact-run visibility, and benchmark support are shipped

Status: Completed

What exists today:
- `greedy.randomSeed` support in the solver, CLI, and planner
- streamed `CP-SAT` telemetry for incumbent, best bound, gap, wall time, and time since last improvement
- planner and CLI progress surfaces for long exact runs
- a fixed `CP-SAT` benchmark corpus plus async benchmark harness for reproducible comparisons
- single-machine `CP-SAT` portfolio support in the backend, Python runtime, and result model

This removes a lot of the earlier guesswork around runtime tuning.

#### 4. LNS neighborhood selection is much stronger than the original baseline

Status: Completed for the current neighborhood strategy

What exists today:
- focused anchors for weak services, high-headroom residentials, and frontier congestion
- adaptive escalation from local windows to larger repair bands and final broad repair passes
- row-0-aware repair windows so anchor connectivity can still be repaired
- deterministic same-cell service and residential upgrade passes around repair

What is still not done:
- time-based LNS stopping
- explicit budget partitioning between seed construction, focused repair, and escalated repair
- clearer per-neighborhood runtime summaries

#### 5. Reusable solver-state hardening is shipped

Status: Completed for the current reusable-input contract

What exists today:
- shared `solverInputValidation` helpers materialize and validate client-supplied `LNS` seed hints in one place
- malformed seed payloads fail with typed `Invalid solver input:` errors
- invalid-but-well-formed seeds are rejected before solve execution
- `CP-SAT` warm-start hints, hint-only reusable payloads, portfolio worker counts, seed lists, time limits, deterministic-time knobs, and no-improvement cutoffs are validated before backend launch
- hint-only `CP-SAT` reusable payloads must carry a matching model fingerprint instead of relying only on shape checks
- reusable `CP-SAT` solution hints are semantically validated against the current grid and building settings before launch
- web solve routes preserve those failures as clean `400` responses instead of generic internal errors
- `CP-SAT` solutions returned from Python are revalidated before they are surfaced back to the app
- planner continuation flows skip legacy, invalid, or stale displayed/saved checkpoints before attaching hints or seeds
- expansion comparison solves recompute the fingerprint against the modified comparison request, so stale displayed hints are omitted instead of causing backend `400`s

Maintenance watchpoints:
- keep planner-side checkpoint compatibility checks aligned with backend validation whenever new reusable payload fields are added
- preserve typed `400` behavior for direct API callers, not only planner-generated requests

#### 6. Greedy runtime guardrails are shipped

Status: Completed

What exists today:
- raw `greedy` options are validated at the API boundary, including restarts, local-search limits, service refinement limits, exhaustive-search caps, random seed, stop paths, and snapshot paths
- `greedy.timeLimitSeconds` gives raw greedy solves a public wall-clock budget instead of relying only on external cancellation
- greedy stop checks run through expensive precompute phases so cancelled runs observe stop requests before spending all their time in enumeration/cache setup
- route tests cover invalid greedy controls before solver launch

#### 7. Solve admission and route safety are shipped

Status: Completed

What exists today:
- `SolveJobManager` owns a configurable running-solve cap, defaulting to one active solve for the local planner
- immediate `/api/solve` requests and background `/api/solve/start` jobs share the same admission policy
- capacity rejections return a clean `429` before launching another optimizer/backend process
- the local web server exposes the cap through `MAX_RUNNING_SOLVES`
- route tests cover both cross-route directions: background jobs block immediate solves, and immediate solves block background job starts

#### 8. Planner/runtime `auto` contract cleanup is shipped

Status: Completed

What exists today:
- `auto` is the resolved default for omitted optimizer requests across runtime dispatch, HTTP routes, CLI-facing solve paths, and planner payloads
- invalid `auto` option payloads fail with typed `Invalid solver input:` errors before backend launch
- direct `solveAuto(...)` calls defensively fall back to runtime defaults for malformed option values instead of letting `NaN` stage budgets through
- Auto owns per-stage random seeds and records them in `autoStage.generatedSeeds`
- planner Auto mode omits standalone `greedy.randomSeed` and `cpSat.randomSeed`, disables those visible seed fields, and labels them as Auto-generated
- planner Auto mode shows the Greedy seed-stage caps that the runtime applies
- result summaries use generated Auto stage seeds instead of stale standalone CP-SAT seed settings
- README documents the default optimizer contract, Auto options, generated stage seeds, and Auto result metadata

## Remaining Priorities

Impact factor scale:
- `5.0 / 5`: direct common-path reliability or quality-per-minute gains
- `4.0 / 5`: strong user-facing leverage or failure-risk reduction
- `3.0 / 5`: medium leverage or enabling work for later improvements
- below `3.0 / 5`: strategic or high-cost work with lower near-term return

### 1. Finish LNS stopping, budget policy, and benchmark support

Priority: 1
Impact factor: `4.5 / 5`

Why this is first:
- `auto` is already shipped, so the strongest algorithmic win is improving the quality-per-minute of the stage it calls most often
- LNS still stops mostly on iteration counts rather than on time-aware productivity signals
- better LNS budgeting improves both manual `LNS` runs and every `auto` cycle that depends on LNS repair quality
- LNS policy tuning needs an explicit benchmark harness before more knobs are added

Concrete work:
- add `stop after no improvement for T seconds` to `LNS`
- split budget intentionally between greedy seeding, focused windows, and escalated repair
- add `benchmark:lns` or fold LNS cases into a shared optimizer benchmark harness
- compare LNS budget policies on fixed benchmark cases instead of tuning by anecdote
- expose per-neighborhood outcome summaries in runtime status surfaces

Acceptance criteria:
- LNS benchmark output reports quality, wall-clock cost, stale-stop reason, and per-neighborhood outcomes
- `auto` quality-per-minute improves or becomes more stable on the benchmark corpus
- planner progress can say why an LNS repair was skipped, neutral, improving, or stopped

### 2. Add CP-SAT portfolio guardrails, then expose full planner initiation

Priority: 2
Impact factor: `4.25 / 5`

Why this is second:
- single-machine portfolio search already exists in the backend, Python runtime, and result model
- the remaining product value is real, but it depends on operational guardrails first
- planner controls should expose portfolio only as a bounded exact-search strategy, not as raw process fan-out

Concrete work:
- define max workers/seeds, total CPU budget, per-worker budget, and oversubscription behavior
- ensure stop propagation cancels lagging workers and does not leave orphaned Python processes
- add coordinator-side stop rules for lagging workers
- planner controls for worker count, explicit seeds, and per-worker budget after portfolio guardrails are in place
- aggregated worker progress and selected-worker summaries in the result UI
- clarify single-run `CP-SAT` vs portfolio `CP-SAT` in user terms: one exact path vs multiple exact paths inside the same budget

Acceptance criteria:
- portfolio stop/cancel tests prove no orphaned worker processes remain
- planner initiation is capped by safe defaults and clear maximums
- result UI explains selected worker, worker spread, and whether portfolio was worth the extra CPU

Note:
- the planner already shows some post-run portfolio result details, but it does not yet provide full portfolio initiation or live worker UX

### 3. Add cross-mode benchmark scorecards and unified progress language

Priority: 3
Impact factor: `3.75 / 5`

Why this is third:
- users choosing between modes need equal-budget comparisons, not just individual optimizer telemetry
- benchmarks are already partly shipped, but planner-facing visibility is still thin
- shared progress language makes `auto`, `greedy`, `LNS`, and `CP-SAT` easier to compare during and after a run

Concrete work:
- add equal-budget scorecards for `auto`, `greedy`, `LNS`, single-run `CP-SAT`, and portfolio `CP-SAT`
- report quality after common budgets such as 5s, 30s, and 2m where applicable
- track win rate vs `auto`, variance by seed, and behavior by grid/problem-size band
- define one shared progress vocabulary: current score, best score, active stage, reuse source, elapsed time, time since improvement, stop reason, and exact gap where available
- surface the same vocabulary in planner status, persisted progress logs, and benchmark summaries

Acceptance criteria:
- a user can choose a mode from the roadmap/planner without knowing implementation internals
- benchmark output supports mode-selection decisions, not just solver debugging

### 4. Split the greedy solver into cleaner reusable phases

Priority: 4
Impact factor: `3.0 / 5`

Why this is fourth:
- reproducibility and instrumentation are already in place, but the greedy policy surface is still concentrated in one large implementation
- future metaheuristics and learned-guidance work want clearer reuse seams
- a full refactor is enabling work, but phase-level measurement hooks are needed earlier for LNS and `auto` budgeting

Desired seams:
- candidate enumeration
- constructive placement
- local improvement
- snapshot / finalization
- phase-level measurement hooks

Near-term slice:
- add phase-level timing and quality counters before attempting a broad greedy refactor
- use those counters to inform LNS seed budget partitioning

## Later Priorities

### 5. Keep distributed CP-SAT behind single-machine portfolio and workflow improvements

Priority: 5
Impact factor: `1.5 / 5`

Why:
- the better near-term return is still better runtime policy, stronger `LNS`, and planner-visible single-machine portfolio search
- distributed exact solving adds the most operational complexity for the least immediate product leverage

### 6. Keep learned guidance separate from the core runtime roadmap

Priority: Separate gated track, after priorities 1 through 4 for core product work
Impact factor: `2.0 / 5` near-term product leverage, higher long-term strategic upside

Why:
- learned guidance is a real fit for search control around `greedy`, `LNS`, and `CP-SAT`, especially for re-ranking and later `LNS` control
- full RL is not the next production lever; the relevant AlphaGo / AlphaZero lesson is policy / value guidance around exact search, not end-to-end self-play
- the deterministic solver still has higher-ROI unfinished work, especially `LNS` stopping / budgeting and guarded portfolio exposure
- that work should stay tracked in [LEARNED_GUIDANCE_ROADMAP.md](./LEARNED_GUIDANCE_ROADMAP.md), not mixed into the runtime-execution roadmap

Ordering inside the learned-guidance track:
- first: shared traces, equal-budget benchmarks, and `LNS` benchmark support
- second: ablations of current heuristic lift
- third: greedy service re-ranking
- fourth: `LNS` window re-ranking
- fifth: counterfactual `LNS` replay data
- sixth: value-guided seeds only if seed quality becomes a measured bottleneck
- seventh: contextual bandits for `LNS` control only if re-ranking already wins
- eighth: full RL only after earlier learned stages beat deterministic baselines on holdout cases

## Cross-Track Ordering

If all remaining work is ranked in one combined near-term ordering, the recommended order is:

1. finish deterministic `LNS` stopping, budget policy, and benchmark support
2. add `CP-SAT` portfolio guardrails, then expose full planner initiation
3. add cross-mode benchmark scorecards and unified progress language
4. add greedy phase-level measurement hooks, then split the greedy solver into cleaner reusable phases
5. build the learned-guidance foundation: shared traces, equal-budget benchmarks, and `LNS` benchmark support
6. run learned-guidance ablations
7. try low-risk learned guidance: greedy service re-ranking and `LNS` window re-ranking
8. only then consider value-guided seeds if seed quality becomes a measured bottleneck
9. treat contextual bandits and full RL as gated research after earlier learned stages already win

Why this order:
- item 1 is now the highest direct algorithmic quality-per-minute work
- item 2 has strong exact-solver upside, but only after guardrails make portfolio search safe to expose
- item 3 turns shipped telemetry and benchmarks into user-facing mode-selection evidence
- item 4 creates cleaner seams for both deterministic and learned follow-on work
- items 5 through 9 depend on a more stable deterministic baseline, better measurement discipline, and more expensive labels
- full RL currently has the lowest near-term product leverage per unit complexity

## LNS Follow-Up Plan

### Phase A: Stabilized working slice

Status: Done

Delivered:
- backend solve path
- planner-visible optimizer
- displayed-layout seeding
- neighborhood fixing outside the active window
- snapshot and stop support
- deterministic dominant same-cell upgrade passes
- recoverable repair-failure handling

### Phase B: Better neighborhoods

Status: Done for the baseline target

Delivered:
- weak residential cluster targeting
- service-heavy low-payoff anchor targeting
- road / frontier congestion targeting
- adaptive neighborhood escalation after stagnation
- broad final repair passes within the configured stale budget

### Phase C: Better stopping and budgeting

Status: Current highest algorithmic priority

Targets:
- stop after `N` non-improving neighborhoods
- stop after no improvement for `T` seconds
- intentional budget split between seed and repair phases

Note:
- the `N`-based stale-iteration stop already exists
- the missing piece is a stronger time-based runtime policy layered on top

### Phase D: Better run visibility

Status: Partially done

Delivered:
- clearer planner messaging about greedy seed vs displayed seed
- live best-so-far progress log updates
- exact-run bound / gap / improvement-lag visibility

Remaining:
- clearer per-neighborhood `LNS` progress summaries
- better explanation of why a repair step was skipped, neutral, or improving

## Notes

- `CP-SAT` warm starts are still global solves unless we explicitly fix the outside-of-neighborhood assignment.
- The current local OR-Tools runtime still has a known crash path around `repair_hint` plus multi-worker repair, so planner/runtime messaging should not imply user-controlled multi-worker `LNS` repair until that runtime issue is proven fixed.
- With `auto` shipped, the next exact-solver UX step is guarded planner-visible single-machine portfolio search, not distributed solving.
- Solver input/output validation is now a shipped safeguard; treat new solver-facing payload fields as validation work before exposing them in the planner.
- AlphaGo / AlphaZero-style ideas transfer here only in the narrow sense of policy / value guidance over the existing search stack; full RL remains a gated research path.
- Input validation now matters as much as solver quality because the planner reuses more serialized solver state across runs.
