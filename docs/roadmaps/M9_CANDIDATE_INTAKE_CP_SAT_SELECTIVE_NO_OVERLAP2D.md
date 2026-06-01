# Solver Candidate Intake: cp-sat-selective-no-overlap2d

Date: 2026-05-31

Owner: Solver roadmap

Status: full-cp-sat-evidence-complete; diagnostics-only

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- [SOLVER_ROADMAP.md](SOLVER_ROADMAP.md) gated priority: new CP-SAT geometry candidate after the full `NoOverlap2D` closeout.
- [M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md](M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md): full `cpSat.useNoOverlap2d` was evaluator-valid but blocked by a repeatable protected holdout population regression and worse aggregate time-to-best.
- [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md): fresh holdout and candidate-specific evaluator-validity gates.

Observed problem:

- Case(s): exact-pressure rows may benefit from `NoOverlap2D`, but expansion/corridor rows must not inherit the prior full-encoding regression.
- Split(s): development, protected holdout, and fresh product holdout.
- Budget(s): first slice `1,5`; promotion-grade slice `1,5,30,120` only if focused evidence is clean.
- Seed(s): `7,19,37`.
- Mode(s): `cp-sat` first; `auto` only after standalone CP-SAT evidence shows default-path relevance.
- Current behavior: the full `NoOverlap2D` opt-in exists, but it applies broadly and regressed `expansion-comparison-replay`.
- Artifact path(s): focused artifacts under `artifacts/product-corpus/<date>/cp-sat-selective-no-overlap2d-*` and `artifacts/candidate-evaluator-validity/<date>/cp-sat-selective-no-overlap2d-*`.
- Command(s): see Evidence Plan.

Why this is worth investigating now:

- The first geometry candidate proved the encoding can be evaluator-valid.
- The blocker was scope, not basic validity: one protected expansion row regressed, and aggregate time-to-best worsened.
- A selective guard lets us ask whether exact-geometry rows improve while known expansion/corridor guard rows remain baseline-equivalent.

## Hypothesis

Candidate hypothesis:

- If `NoOverlap2D` is enabled only for product workflow tags `gate`, `multi-anchor`, and `footprint-pressure`,
- Then CP-SAT may keep the useful exact-geometry signal on dense placement rows,
- Because expansion/corridor rows that previously regressed stay on the baseline CP-SAT encoding.

Primary objective:

- Equal or better population with no protected/fresh regression.

Secondary objectives:

- First feasible: no broad delay on small cases.
- Time to best: improve or tie current CP-SAT on guarded exact-pressure rows.
- Wall-clock: stay inside focused budgets.
- CPU budget: no CPU-normalized regression without population or exactness benefit.
- Replay compatibility: `expansion-comparison-replay` remains a baseline-equivalent guard row.
- Evaluator validity: every final layout passes the final-layout evaluator with zero population mismatch.

Non-goals:

- No default Auto change in this intake.
- No CP-SAT portfolio change in this intake.
- No runtime guard promotion from workflow tags; workflow-tag gating is evidence-only until a real problem-feature guard exists.

## Scope

Affected modes:

- `auto`: not changed in the first diagnostics slice.
- `greedy`: none.
- `lns`: none.
- `cp-sat`: primary affected mode.
- `cp-sat-portfolio`: out of scope.

Affected code or policy surfaces:

- Solver params: evidence harness can set `cpSat.useNoOverlap2d` by workflow tag.
- Budget policy: unchanged.
- Seed policy: unchanged.
- Repair policy: unchanged.
- Exact solver settings: candidate surface.
- Learned/runtime model: none.
- Planner/API surface: none.

Feature flag or opt-in guard:

- Evidence-only CLI guard: `--cp-sat-no-overlap2d-tags=gate,multi-anchor,footprint-pressure`.
- Runtime defaults remain unchanged.

Runtime-default risk:

- Low for diagnostics.
- Medium only if later converted into an Auto/CP-SAT runtime feature guard.

## Evidence Plan

Development cases:

- `road-semantics-service-pressure`
- `typed-footprint-pressure`

Protected holdout cases:

- `road-semantics-gate-choke`
- `multi-anchor-road-components`
- `expansion-comparison-replay`

Fresh holdout plan:

- Fresh cases exist now: yes.
- Fresh cases: `fresh-multi-anchor-service-island`, `fresh-typed-footprint-scarcity`, `fresh-expansion-corridor-service`.
- Tuning leakage guard: do not tune guard tags from protected or fresh rows; use this first slice only to decide whether the candidate is worth a broader implementation.

Workflow tags covered:

- service-pressure: `road-semantics-service-pressure`
- typed-footprint: `typed-footprint-pressure`, `fresh-typed-footprint-scarcity`
- road-semantics/gate: `road-semantics-gate-choke`, `fresh-multi-anchor-service-island`
- expansion-comparison: `expansion-comparison-replay`, `fresh-expansion-corridor-service`
- corridor: `fresh-expansion-corridor-service`
- multi-anchor: `multi-anchor-road-components`, `fresh-multi-anchor-service-island`

Modes to run:

- `cp-sat`

Budgets:

- Default promotion matrix: `1,5,30,120`
- Candidate-specific focused budgets: `1,5`
- Exception rationale: this is diagnostics-only and must stop early on any protected/fresh regression.

Seeds:

- Default promotion seeds: `7,19,37`
- Focused or additional seeds: none yet.
- Exception rationale: none.

Baseline controls:

- Baseline freshness command:

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"

npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir="artifacts/product-corpus/${RUN_DATE}/cp-sat-selective-no-overlap2d-baseline-${RUN_STAMP}" \
  --product-run-id="product-corpus-scorecard-${RUN_STAMP}-cp-sat-selective-no-overlap2d-baseline" \
  --product-decision=benchmark-evidence-only \
  '--product-summary=Baseline focused slice for selective CP-SAT NoOverlap2D comparison; no solver default changed.' \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --json \
  road-semantics-service-pressure \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity \
  fresh-expansion-corridor-service
```

- Baseline-repeat command: same command with `baseline-repeat` in the artifact directory, run id, and summary.
- Candidate same-slice command:

```bash
npm run benchmark:scorecard -- \
  --product-corpus \
  --product-artifact-dir="artifacts/product-corpus/${RUN_DATE}/cp-sat-selective-no-overlap2d-candidate-${RUN_STAMP}" \
  --product-run-id="product-corpus-scorecard-${RUN_STAMP}-cp-sat-selective-no-overlap2d-candidate" \
  --product-decision=benchmark-evidence-only \
  '--product-summary=Selective CP-SAT NoOverlap2D focused slice using workflow-tag guard gate,multi-anchor,footprint-pressure; no solver default changed.' \
  --cp-sat-no-overlap2d-tags=gate,multi-anchor,footprint-pressure \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --json \
  road-semantics-service-pressure \
  typed-footprint-pressure \
  road-semantics-gate-choke \
  multi-anchor-road-components \
  expansion-comparison-replay \
  fresh-multi-anchor-service-island \
  fresh-typed-footprint-scarcity \
  fresh-expansion-corridor-service
```

- Focused row rerun command: narrow to the first row with outside-envelope movement.

Evaluator and replay gates:

```bash
npm run evidence:candidate-evaluator-validity -- \
  --artifact-dir="artifacts/candidate-evaluator-validity/${RUN_DATE}/cp-sat-selective-no-overlap2d-${RUN_STAMP}" \
  --candidate-id=cp-sat-selective-no-overlap2d \
  --run-id="candidate-evaluator-validity-${RUN_STAMP}-cp-sat-selective-no-overlap2d" \
  --decision=candidate-evaluator-validity \
  '--summary=Selective CP-SAT NoOverlap2D final-layout evaluator-validity run; no solver default changed.' \
  '--fresh-holdout-note=Uses L0 fresh holdout cases fresh-multi-anchor-service-island, fresh-typed-footprint-scarcity, and fresh-expansion-corridor-service before promotion claims.' \
  --cp-sat-no-overlap2d-tags=gate,multi-anchor,footprint-pressure \
  --modes=cp-sat \
  --budgets=1,5 \
  --seeds=7,19,37 \
  --cases=road-semantics-service-pressure,typed-footprint-pressure,road-semantics-gate-choke,multi-anchor-road-components,expansion-comparison-replay,fresh-multi-anchor-service-island,fresh-typed-footprint-scarcity,fresh-expansion-corridor-service
```

Replay workflow plan:

- `expansion-comparison-replay` must keep zero validation errors and zero evaluator population delta.
- `fresh-expansion-corridor-service` is a fresh holdout guard row, not a replay row.

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
- Worst-row population delta: `>= 0`.
- Regression rate: `0%` for this focused slice.
- Equal-population time-to-best improvement: at least `10%` on guarded rows where population ties.
- CPU-budget efficiency floor: no worse than `10%` below baseline unless population or exactness gain justifies it.
- First-feasible behavior: no broad delay on small cases.
- Replay/evaluator-validity result: zero invalid rows and zero population mismatches.

Minimum signal to continue after smoke:

- Focused baseline and baseline-repeat tie on population, or any movement is explained before candidate interpretation.
- Candidate evaluator-validity has zero invalid rows and zero population mismatches.

Minimum signal to continue after focused slice:

- No protected/fresh population regression.
- Guard rows show at least one population, exactness, or time-to-best value outside the baseline-repeat envelope.
- Unguarded expansion/corridor rows tie baseline on population.

What result closes this as diagnostics-only:

- No outside-envelope value on guarded rows.
- Value exists only in standalone CP-SAT with no likely Auto/default relevance.
- Timing and model-size movement repeats the full `NoOverlap2D` downside.

What result blocks the candidate:

- Any final-layout evaluator invalidity.
- Any protected/fresh population regression.
- Any regression on `expansion-comparison-replay` or `fresh-expansion-corridor-service`.
- CPU cost blowup without exactness or population value.

## Artifact Policy

Artifact root:

- `artifacts/product-corpus/<date>/cp-sat-selective-no-overlap2d-*`
- `artifacts/candidate-evaluator-validity/<date>/cp-sat-selective-no-overlap2d-*`

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

## Focused Evidence Result

Focused run date: 2026-05-30

Artifacts:

- Baseline: `artifacts/product-corpus/2026-05-30/cp-sat-selective-no-overlap2d-baseline-20260530T215332Z`
- Baseline repeat: `artifacts/product-corpus/2026-05-30/cp-sat-selective-no-overlap2d-baseline-repeat-20260530T215332Z`
- Candidate: `artifacts/product-corpus/2026-05-30/cp-sat-selective-no-overlap2d-candidate-20260530T215332Z`
- Candidate evaluator validity: `artifacts/candidate-evaluator-validity/2026-05-30/cp-sat-selective-no-overlap2d-20260530T215332Z`
- Focused typed-footprint rerun: `artifacts/product-corpus/2026-05-30/cp-sat-selective-no-overlap2d-focused-typed-footprint-20260530T215332Z`

Focused slice:

- Cases: `road-semantics-service-pressure`, `typed-footprint-pressure`, `road-semantics-gate-choke`, `multi-anchor-road-components`, `expansion-comparison-replay`, `fresh-multi-anchor-service-island`, `fresh-typed-footprint-scarcity`, `fresh-expansion-corridor-service`.
- Mode: `cp-sat`.
- Budgets: `1,5`.
- Seeds: `7,19,37`.
- Candidate guard: `--cp-sat-no-overlap2d-tags=gate,multi-anchor,footprint-pressure`.
- Candidate scorecard rows: 48.
- Evaluator validity: 48 valid, 0 invalid, 0 population mismatches.

Population movement:

- Baseline-repeat movement: 3 rows moved, all at 1s (`typed-footprint-pressure` seed 37 `+10`; `fresh-multi-anchor-service-island` seed 19 `+25`; `fresh-multi-anchor-service-island` seed 37 `-135`).
- Candidate versus baseline repeat: 3 improvements, 0 regressions.
- Candidate versus baseline: 3 improvements, 0 regressions.
- Guarded rows: 30 rows, 3 improvements versus repeat, 0 regressions.
- Unguarded rows: 18 rows, 0 population movement versus repeat, 0 regressions. `expansion-comparison-replay` and `fresh-expansion-corridor-service` stayed baseline-equivalent with `useNoOverlap2d=false`.

Rows with candidate movement:

| Case                                | Split       | Budget | Seed | Baseline | Repeat | Candidate | Delta vs repeat | Guarded |
| ----------------------------------- | ----------- | -----: | ---: | -------: | -----: | --------: | --------------: | ------- |
| `typed-footprint-pressure`          | development |      1 |    7 |      505 |    505 |       510 |              +5 | yes     |
| `typed-footprint-pressure`          | development |      1 |   37 |      495 |    505 |       525 |             +20 | yes     |
| `fresh-multi-anchor-service-island` | holdout     |      1 |   19 |      990 |   1015 |      1015 |               0 | yes     |
| `fresh-multi-anchor-service-island` | holdout     |      1 |   37 |     1015 |    880 |      1015 |            +135 | yes     |

Focused typed-footprint rerun:

- Seed 7: baseline `505`, repeat `505`, candidate `510`, focused rerun `520`.
- Seed 37: baseline `495`, repeat `505`, candidate `525`, focused rerun `525`.

Timing interpretation:

- Median candidate wall-clock ratio versus repeat across all rows: `0.998`.
- Median candidate time-to-best ratio versus repeat across all rows: `1.004`.
- Guarded rows were mixed: median wall-clock ratio `1.014`, median time-to-best ratio `1.375`.
- Unguarded rows were stable and slightly faster/noisier: median wall-clock ratio `0.982`, median time-to-best ratio `0.984`.

Decision:

- The focused evidence clears the first safety gate: no evaluator invalidity and no protected/fresh population regression.
- The selective guard fixed the prior expansion-scope failure for this focused slice.
- Do not promote or wire into runtime defaults. The evidence is still CP-SAT-standalone, 1s movement is repeat-sensitive on `fresh-multi-anchor-service-island`, and guarded time-to-best is mixed.
- The next diagnostics-only full CP-SAT product-corpus expansion completed on 2026-05-31. Do not move into Auto until CP-SAT evidence is repeatable and the guard is no longer workflow-tag-specific.

## Full CP-SAT Product-Corpus Expansion Result

Full CP-SAT run date: 2026-05-31

Artifacts:

- Baseline: `artifacts/product-corpus/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-baseline-20260531T171405Z`
- Baseline repeat: `artifacts/product-corpus/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-baseline-repeat-20260531T171405Z`
- Candidate: `artifacts/product-corpus/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-candidate-20260531T171405Z`
- Candidate evaluator validity: `artifacts/candidate-evaluator-validity/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-20260531T171405Z`

Expanded slice:

- Cases: then-current full 13-case product corpus.
- Mode: `cp-sat`.
- Budgets: `1,5`.
- Seeds: `7,19,37`.
- Candidate guard: `--cp-sat-no-overlap2d-tags=gate,multi-anchor,footprint-pressure`.
- Candidate scorecard rows: 78.
- Evaluator validity: 78 valid, 0 invalid, 0 population mismatches.

Population movement:

- Baseline-repeat movement: 1 row moved, `fresh-expansion-corridor-service` at 1s seed 19 dropped from `990` to `895`.
- Candidate versus baseline repeat: 3 improvements, 0 regressions.
- Candidate versus baseline: 2 improvements, 0 regressions.
- Guarded rows: 30 rows, 2 improvements versus repeat, 0 regressions; all guarded candidate rows used `useNoOverlap2d=true`.
- Unguarded rows: 48 rows, 0 movement versus baseline, 1 improvement versus repeat, 0 regressions; all unguarded candidate rows used `useNoOverlap2d=false`.

Rows with population movement:

| Case                               | Split       | Budget | Seed | Baseline | Repeat | Candidate | Delta vs repeat | Guarded | Interpretation                            |
| ---------------------------------- | ----------- | -----: | ---: | -------: | -----: | --------: | --------------: | ------- | ----------------------------------------- |
| `fresh-expansion-corridor-service` | holdout     |      1 |   19 |      990 |    895 |       990 |             +95 | no      | Repeat variance; candidate tied baseline. |
| `typed-footprint-pressure`         | development |      1 |    7 |      505 |    505 |       520 |             +15 | yes     | Guarded population improvement.           |
| `typed-footprint-pressure`         | development |      1 |   37 |      505 |    505 |       525 |             +20 | yes     | Guarded population improvement.           |

Timing interpretation:

- Median candidate wall-clock ratio versus repeat across all rows: `1.002`.
- Median candidate time-to-best ratio versus repeat across all rows: `1.000`.
- Guarded rows remained slower on time-to-best: median wall-clock ratio `1.061`, median time-to-best ratio `1.475`.
- Unguarded rows stayed baseline-like: median wall-clock ratio `0.982`, median time-to-best ratio `1.000`.

Full-expansion decision:

- The selective guard remains safe across the full CP-SAT `1,5` product corpus slice: no candidate population regressions, no evaluator invalidity, and no population mismatches.
- The previously risky expansion/corridor family stayed protected by the guard: `fresh-expansion-corridor-service` and `expansion-comparison-replay` both ran with `useNoOverlap2d=false`.
- Do not promote. The candidate still has value only in standalone CP-SAT short-budget rows, guarded time-to-best is worse, and the selector is a workflow-tag evidence harness rather than a runtime problem-feature guard.
- Next eligible work is either a real problem-feature guard design for CP-SAT geometry pressure or a separate Auto/LNS expansion-corridor candidate using `fresh-expansion-corridor-service`.

## Review Checklist

- Trigger is real and current: yes.
- Hypothesis is testable: yes.
- Case list covers development, protected holdout, and fresh holdout: yes.
- Fresh holdout is present for promotion-grade work or explicitly planned for diagnostics-only work: present.
- Baseline-repeat control is same-slice: yes.
- Budgets and seeds match the focused diagnostics exception: yes.
- Expected signal is measurable and has stop conditions: yes.
- Evaluator-validity and replay gates are named: yes.
- CPU and time-to-best interpretation follows the M8 review: yes.
- Artifact policy is clear before large bundles are produced: yes.
- Runtime default remains unchanged until promotion gates are met: yes.
