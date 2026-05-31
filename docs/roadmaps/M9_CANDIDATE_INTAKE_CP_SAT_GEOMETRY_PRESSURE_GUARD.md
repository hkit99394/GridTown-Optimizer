# Solver Candidate Intake: cp-sat-geometry-pressure-no-overlap2d

Date: 2026-05-31

Owner: Solver roadmap

Status: full-cp-sat-evidence-complete; diagnostics-only

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- [M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md): workflow-tag selective `NoOverlap2D` was safe across the full CP-SAT `1,5` product-corpus slice, but cannot promote because workflow tags are not runtime problem features.

Observed problem:

- Case(s): exact geometry pressure can benefit from `NoOverlap2D`; expansion/corridor and continuation rows should not inherit broad encoding risk.
- Split(s): development and protected/fresh holdout.
- Budget(s): `1,5` diagnostics.
- Seed(s): `7,19,37`.
- Mode(s): `cp-sat`.
- Current behavior: `cpSat.useNoOverlap2d` exists as a broad opt-in and a workflow-tag evidence selector.
- Artifact path(s): `artifacts/product-corpus/2026-05-31/cp-sat-geometry-pressure-no-overlap2d-full-cp-sat-candidate-20260531T173841Z` and `artifacts/candidate-evaluator-validity/2026-05-31/cp-sat-geometry-pressure-no-overlap2d-full-cp-sat-20260531T173841Z`.

Why this is worth investigating now:

- It replaces workflow-tag evidence gating with a runtime grid/catalog guard.
- It preserves the prior safety lesson: continuation/replay rows and fragmented corridor masks are excluded.

## Hypothesis

Candidate hypothesis:

- If `NoOverlap2D` is enabled only when runtime placement geometry is dense and the case is not a continuation/corridor-fragmentation row,
- Then CP-SAT can keep the short-budget footprint-pressure lift,
- Because dense placement candidates are the rows most likely to benefit from global rectangle propagation.

Primary objective:

- Equal or better population with no protected/fresh regression.

Secondary objectives:

- Time to best: no broad regression; any regression must be justified by population or exactness.
- Replay compatibility: continuation and expansion replay rows remain on baseline encoding.
- Evaluator validity: every final layout passes with zero population mismatch.

Non-goals:

- No Auto/default promotion.
- No CP-SAT portfolio change.
- No learned/runtime model.

## Runtime Guard

Opt-in flag:

- `--cp-sat-no-overlap2d-geometry-pressure`

Guard implementation:

- Enabled when all are true:
  - allowed cells `>= 24`
  - placement candidate density `>= 3.75` candidates per allowed cell
  - blocked-cell ratio `<= 0.25`
  - max configured building footprint area `>= 4`
  - no CP-SAT warm-start or LNS seed continuation hint
- Disabled reasons include `continuation-hint`, `fragmented-corridor-mask`, `low-placement-candidate-density`, `too-few-allowed-cells`, and `low-footprint-geometry-pressure`.

Rows enabled in the first full CP-SAT evidence run:

- `typed-footprint-pressure`
- `road-semantics-service-pressure`
- `fresh-multi-anchor-service-island`
- `fresh-typed-footprint-scarcity`

Rows explicitly disabled:

- `expansion-comparison-replay`: `continuation-hint`
- `fresh-expansion-corridor-service`: `fragmented-corridor-mask`

## Evidence Result

Run date: 2026-05-31

Baseline controls reused:

- Baseline: `artifacts/product-corpus/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-baseline-20260531T171405Z`
- Baseline repeat: `artifacts/product-corpus/2026-05-31/cp-sat-selective-no-overlap2d-full-cp-sat-baseline-repeat-20260531T171405Z`

Candidate artifacts:

- Candidate: `artifacts/product-corpus/2026-05-31/cp-sat-geometry-pressure-no-overlap2d-full-cp-sat-candidate-20260531T173841Z`
- Candidate evaluator validity: `artifacts/candidate-evaluator-validity/2026-05-31/cp-sat-geometry-pressure-no-overlap2d-full-cp-sat-20260531T173841Z`

Expanded slice:

- Cases: then-current full 13-case product corpus.
- Mode: `cp-sat`.
- Budgets: `1,5`.
- Seeds: `7,19,37`.
- Candidate scorecard rows: 78.
- Guard-enabled rows: 24.
- Guard-disabled rows: 54.
- Evaluator validity: 78 valid, 0 invalid, 0 population mismatches.

Population movement:

- Candidate versus baseline repeat: 3 improvements, 0 regressions.
- Candidate versus baseline: 2 improvements, 0 regressions.
- Enabled rows: 2 improvements versus repeat, 0 regressions.
- Disabled rows: 0 movement versus baseline.

Rows with movement:

| Case                               | Budget | Seed | Guard enabled | Baseline | Repeat | Candidate | Delta vs repeat | Interpretation                            |
| ---------------------------------- | -----: | ---: | ------------- | -------: | -----: | --------: | --------------: | ----------------------------------------- |
| `fresh-expansion-corridor-service` |      1 |   19 | no            |      990 |    895 |       990 |             +95 | Repeat variance; candidate tied baseline. |
| `typed-footprint-pressure`         |      1 |    7 | yes           |      505 |    505 |       520 |             +15 | Guarded population improvement.           |
| `typed-footprint-pressure`         |      1 |   37 | yes           |      505 |    505 |       525 |             +20 | Guarded population improvement.           |

Timing interpretation:

- Median candidate wall-clock ratio versus repeat across all rows: `1.025`.
- Median candidate time-to-best ratio versus repeat across all rows: `1.010`.
- Guard-enabled rows remained slower on time-to-best: median wall-clock ratio `1.077`, median time-to-best ratio `1.310`.
- Guard-disabled rows stayed baseline-like on population with median time-to-best ratio `1.000`.

Decision:

- Safety passed for the CP-SAT `1,5` diagnostics slice.
- Do not promote. The runtime guard is better than workflow tags, but the value is still standalone CP-SAT short-budget movement and guard-enabled time-to-best is worse.
- Next eligible step is a focused design for reducing guard-enabled time-to-best cost or a narrower feature threshold, not Auto/default wiring.

## Review Checklist

- Trigger is real and current: yes.
- Hypothesis is testable: yes.
- Case list covers development, protected holdout, and fresh holdout: yes.
- Baseline-repeat control is same-slice: yes.
- Evaluator-validity gate passed: yes.
- CPU/time-to-best risk recorded: yes.
- Runtime default remains unchanged: yes.
