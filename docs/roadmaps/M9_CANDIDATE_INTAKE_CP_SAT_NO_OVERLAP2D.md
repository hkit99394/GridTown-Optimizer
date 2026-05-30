# Solver Candidate Intake: cp-sat-no-overlap2d-preflight

Date: 2026-05-30

Owner: Solver roadmap

Status: ready-to-implement

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md) gated priority: geometry-native CP-SAT / `NoOverlap2D` experiment.
- [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md) pre-long-run checkpoint.

Observed problem:

- Case(s): exact-pressure and road-semantics product workflow cases need a clearer CP-SAT geometry baseline before any long-run exact-search work.
- Split(s): development, protected holdout, and L0 fresh holdout nominations.
- Budget(s): first slice `1,5`; promotion-grade slice `1,5,30,120`.
- Seed(s): `7,19,37`.
- Mode(s): `cp-sat` first; `auto` only if CP-SAT movement could affect the default path.
- Current behavior: CP-SAT is available as an exact backend, but geometry-native placement is not yet proven better than the current encoding on product workflow cases.
- Artifact path(s): pending under `artifacts/candidate-evaluator-validity/<date>/cp-sat-no-overlap2d-*` and `artifacts/product-corpus/<date>/`.
- Command(s): see Evidence Plan.

Why this is worth investigating now:

- It is the first long-run gated priority, but it should start as diagnostics-only until L0 fresh holdout and evaluator-validity requirements are concrete.
- L0 is now satisfied for the first CP-SAT preflight: both fresh cases are implemented and passed a CP-SAT evaluator-validity smoke with zero population mismatches.

## Hypothesis

Candidate hypothesis:

- If CP-SAT uses a geometry-native `NoOverlap2D` placement formulation or equivalent exact-geometry propagation,
- Then exact-search feasibility, time-to-best, or bound quality may improve on pressure cases,
- Because the solver may prune overlapping placement combinations earlier than the current formulation.

Primary objective:

- Equal or better population with faster time-to-best or stronger exact-search status/gap behavior.

Secondary objectives:

- First feasible: no regression on small product cases.
- Time to best: improve or tie current CP-SAT on exact-pressure rows.
- Wall-clock: stay within the same budget matrix.
- CPU budget: no CPU-normalized regression without population or exactness benefit.
- Replay compatibility: replay workflow rows must remain valid.
- Evaluator validity: every final layout must pass the final-layout evaluator with zero population mismatch.

Non-goals:

- No default Auto change in this intake.
- No portfolio change in this intake.
- No learned guidance dependency.

## Scope

Affected modes:

- `auto`: downstream risk only; not changed in the first diagnostics slice.
- `greedy`: none.
- `lns`: none unless used as a comparison baseline.
- `cp-sat`: primary affected mode.
- `cp-sat-portfolio`: out of scope until single CP-SAT evidence is clear.

Affected code or policy surfaces:

- Solver params: possible CP-SAT geometry encoding option.
- Budget policy: unchanged.
- Seed policy: unchanged.
- Repair policy: unchanged.
- Exact solver settings: candidate surface.
- Learned/runtime model: none.
- Planner/API surface: none expected.

Feature flag or opt-in guard:

- Required before implementation. Candidate must be opt-in until evidence closes.

Runtime-default risk:

- low for diagnostics, medium if later wired into Auto.
- Explanation: the first slice should not alter runtime defaults; any Auto inheritance requires a separate decision closeout.

## Evidence Plan

Development cases:

- `road-semantics-service-pressure`
- `manual-layout-replay-warm-start`
- `typed-footprint-pressure`

Protected holdout cases:

- `road-semantics-gate-choke`
- `multi-anchor-road-components`
- `expansion-comparison-replay`

Fresh holdout plan:

- Fresh cases exist now: yes.
- Implemented fresh cases: `fresh-multi-anchor-service-island`, `fresh-typed-footprint-scarcity`.
- Tuning leakage guard: do not tune geometry parameters from protected holdout or fresh holdout cases; use development cases only for implementation debugging.

Workflow tags covered:

- solver-smoke: not primary.
- service-pressure: `road-semantics-service-pressure`.
- typed-footprint: `typed-footprint-pressure`, `fresh-typed-footprint-scarcity`.
- road-semantics: `road-semantics-gate-choke`, `multi-anchor-road-components`, `fresh-multi-anchor-service-island`.
- manual-layout-replay: `manual-layout-replay-warm-start`.
- expansion-comparison: `expansion-comparison-replay`.
- multi-anchor: `multi-anchor-road-components`.

Modes to run:

- `cp-sat`
- `auto` only after CP-SAT standalone evidence suggests default-path relevance.

Budgets:

- Default promotion matrix: `1,5,30,120`
- Candidate-specific focused budgets: `1,5`
- Exception rationale: the first slice is diagnostics-only and should stop early if CP-SAT readiness, validity, or time-to-best regresses.

Seeds:

- Default promotion seeds: `7,19,37`
- Focused or additional seeds: none yet.
- Exception rationale: none.

Baseline controls:

- Baseline freshness command:

```bash
npm run benchmark:scorecard -- \
  --product-corpus \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --json \
  road-semantics-service-pressure \
  manual-layout-replay-warm-start \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity
```

- Baseline-repeat command: same command with a new artifact directory and `baseline-repeat` run id before interpreting deltas.
- Candidate same-slice command: same cases, budgets, and seeds with the opt-in CP-SAT geometry candidate enabled.
- Focused row rerun command: narrow to the first row with an outside-envelope movement.

Evaluator and replay gates:

- Final-layout evaluator-validity plan:

```bash
npm run evidence:candidate-evaluator-validity -- \
  --artifact-dir="artifacts/candidate-evaluator-validity/${RUN_DATE}/cp-sat-no-overlap2d-${RUN_STAMP}" \
  --candidate-id=cp-sat-no-overlap2d-preflight \
  --run-id="candidate-evaluator-validity-${RUN_STAMP}-cp-sat-no-overlap2d-preflight" \
  --decision=candidate-evaluator-validity \
  '--summary=CP-SAT NoOverlap2D preflight final-layout evaluator-validity run; no solver default changed.' \
  '--fresh-holdout-note=Uses L0 fresh holdout cases fresh-multi-anchor-service-island and fresh-typed-footprint-scarcity before promotion claims.' \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --cases=road-semantics-service-pressure,manual-layout-replay-warm-start,typed-footprint-pressure,road-semantics-gate-choke,multi-anchor-road-components,expansion-comparison-replay,fresh-multi-anchor-service-island,fresh-typed-footprint-scarcity
```

- Replay workflow plan: `manual-layout-replay-warm-start` and `expansion-comparison-replay` must keep zero validation errors and zero evaluator population delta.
- CP-SAT readiness or setup dependency: run `npm run setup:cp-sat` or confirm `/api/cp-sat/readiness` before broad sweeps.

CPU and timing gates:

- Wall-clock fields to compare: scorecard `wallClockSeconds`.
- Time-to-first-feasible fields to compare: scorecard time-to-quality first feasible fields where available.
- Time-to-best fields to compare: scorecard time-to-quality best-score fields.
- CPU-budget fields to compare: CP-SAT worker CPU budget and observed CPU fields.
- Observed-CPU coverage expectation: every CP-SAT row should include CPU-budget interpretation before promotion.

## Expected Signal

Promotion target:

- Median population delta: `>= 0`.
- Worst-decile population delta: `>= 0`.
- Worst-row population delta: `>= 0` unless a reviewed exception is documented.
- Regression rate: `<= 5%`.
- Equal-population time-to-best improvement: at least `10%` on rows where population ties.
- CPU-budget efficiency floor: no worse than `10%` below baseline unless population or exactness gain justifies it.
- First-feasible behavior: no broad delay on small cases.
- Replay/evaluator-validity result: zero invalid rows and zero population mismatches.

Minimum signal to continue after smoke:

- CP-SAT readiness is clean, all final layouts are evaluator-valid, and no obvious timeouts exceed the focused budget shape.
- Status on 2026-05-30: passed for `fresh-multi-anchor-service-island` and `fresh-typed-footprint-scarcity` at `cp-sat`, budget `1`, seed `7`; 2 valid rows, 0 invalid rows, 0 population mismatches.

Minimum signal to continue after development split:

- At least one exact-pressure development row shows outside-envelope time-to-best, bound, or population value with no validity regression.

Minimum signal to continue after protected holdout:

- Protected rows have no population regressions, no evaluator invalidity, and timing/CPU movement that justifies fresh holdout work.

What result closes this as diagnostics-only:

- No outside-envelope value on development, or value appears only in CP-SAT standalone without likely Auto/default relevance.

What result blocks the candidate:

- Any final-layout evaluator invalidity, repeated CP-SAT setup instability, protected/fresh population regression, or CPU cost blowup without exactness value.

## Artifact Policy

Artifact root:

- `artifacts/candidate-evaluator-validity/<date>/cp-sat-no-overlap2d-*`
- `artifacts/product-corpus/<date>/cp-sat-no-overlap2d-*`

Expected files to keep in git when small:

- Summary text: yes.
- Evidence summary: yes.
- Telemetry manifest: yes.
- Workflow replay files: yes when small.
- Registry entry draft: yes.

Expected files to move to release/external storage if large:

- Raw scorecard JSON: yes.
- Budget ablation JSON: yes.
- Decision trace JSONL: yes.
- Replay labels: yes.
- Solve logs: yes.

Registry plan:

- Registry entry required: yes for any decision-grade run.
- Registry command: `npm run experiment-registry -- check`, then append only after artifacts are checkpointed.
- Decision metadata to include: candidate id, opt-in guard, exact command, split metadata, fresh holdout note, evaluator-validity summary, CPU/time-to-best interpretation, and runtime-default status.

## Review Checklist

- Trigger is real and current: yes.
- Hypothesis is testable: yes.
- Case list covers development and protected holdout: yes.
- Fresh holdout is present or explicitly planned: present through L0 for the first CP-SAT intake.
- L0 smoke has passed for the first fresh pair.
- Baseline-repeat control is same-slice: required before deltas.
- Budgets and seeds match the promotion matrix or exceptions are justified: focused diagnostics exception written.
- Expected signal is measurable and has stop conditions: yes.
- Evaluator-validity and replay gates are named: yes.
- CPU and time-to-best interpretation follows the M8 review: yes.
- Artifact policy is clear before large bundles are produced: yes.
- Runtime default remains unchanged until promotion gates are met: yes.
