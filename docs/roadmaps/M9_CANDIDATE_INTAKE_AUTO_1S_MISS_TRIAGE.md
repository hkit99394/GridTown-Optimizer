# Solver Candidate Intake: auto-1s-miss-triage

Date: 2026-05-31

Owner: Solver roadmap

Status: closed diagnostics-only

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- Current 14-case product-corpus smoke: `artifacts/product-corpus/2026-05-31/baseline-current-14-case-smoke-20260531T183922Z`.

Observed problem:

- Case(s): `service-local-neighborhood`, `fresh-multi-anchor-service-island`, `expansion-comparison-replay`.
- Split(s): protected holdout and fresh holdout.
- Budget(s): first slice `1`.
- Seed(s): smoke row used `7`; first repeat slice expands to `7,19,37`.
- Mode(s): `auto,lns`.
- Current behavior: Auto tied best on 11 of 14 smoke rows, but was behind LNS on these three rows.
- Artifact path(s): `artifacts/product-corpus/2026-05-31/baseline-current-14-case-smoke-20260531T183922Z`.

Smoke miss rows:

| Case                                | Split   | Tags                                       | Best Mode | Best | Auto | Delta |
| ----------------------------------- | ------- | ------------------------------------------ | --------- | ---- | ---- | ----- |
| `service-local-neighborhood`        | holdout | `service-pressure`                         | `lns`     | 470  | 455  | 15    |
| `fresh-multi-anchor-service-island` | holdout | `multi-anchor`, `service-pressure`, `gate` | `lns`     | 1015 | 990  | 25    |
| `expansion-comparison-replay`       | holdout | `expansion-comparison`                     | `lns`     | 780  | 745  | 35    |

Why this is worth investigating now:

- These are the only current-corpus smoke rows where Auto is behind best-of-mode.
- All three misses occur at the `1s` budget, where small policy shifts can be highly seed-sensitive.
- Two rows are protected holdout and one is fresh holdout, so tuning directly against them would be risky without a same-slice repeat envelope.

## Hypothesis

Candidate hypothesis:

- If the Auto misses reproduce across seeds and stay outside baseline-repeat variance,
- Then a later candidate may need a short-budget Auto mechanism that lets LNS wins survive Auto orchestration,
- Because the smoke rows show LNS beating Auto on final population under the same 1s mode budget.

Primary objective:

- Establish whether the 1s Auto misses are repeat-stable population gaps.

Secondary objectives:

- Preserve exact evaluator-valid final layouts.
- Keep runtime defaults unchanged.
- Avoid budget-ratio policy work until the baseline-repeat envelope is known.

Non-goals:

- No new policy in the first slice.
- No broad matrix from a single smoke observation.
- No default-path change.

## Scope

Affected modes:

- `auto`: observe whether it stays behind best-of-mode.
- `lns`: compare the standalone winner from the smoke rows.
- `greedy`: out of scope for the first repeat slice.
- `cp-sat`: out of scope for the first repeat slice unless final-layout validity or exact-gap questions require it.

Affected code or policy surfaces:

- Solver params: none yet.
- Budget policy: none yet.
- Seed policy: none yet.
- Repair policy: none yet.
- Planner/API surface: none.

Feature flag or opt-in guard:

- None for the first slice.

Runtime-default risk:

- none.
- This is a diagnostics-only baseline-repeat target.

## Evidence Plan

Focused rows:

- Protected holdout: `service-local-neighborhood`, `expansion-comparison-replay`.
- Fresh holdout: `fresh-multi-anchor-service-island`.

Workflow tags covered:

- `service-pressure`
- `multi-anchor`
- `gate`
- `expansion-comparison`

Modes to run:

- `auto`
- `lns`

Budgets:

- Focused budget: `1`.
- Exception rationale: the trigger is a 1s smoke miss; broader budgets should wait until reproducibility is known.

Seeds:

- `7,19,37`.
- Exception rationale: use the standard promotion seed set for repeat stability while keeping the case/budget slice narrow.

Baseline controls:

```bash
npm run benchmark:scorecard -- \
  --product-corpus \
  --budget-ablation \
  --ablation-policies=baseline,baseline-repeat \
  --modes=auto,lns \
  --budgets=1 \
  --seeds=7,19,37 \
  --artifact-dir=artifacts/cross-mode-budget-ablations/2026-05-31/auto-1s-miss-triage-baseline-repeat-20260531T185216Z \
  --ablation-run-id=auto-1s-miss-triage-baseline-repeat-20260531T185216Z \
  --ablation-decision=diagnostics-only-auto-1s-miss-triage-baseline-repeat \
  "--ablation-summary=Focused same-slice baseline-repeat control for current 14-case 1s Auto misses; no solver default changed." \
  --json \
  service-local-neighborhood \
  fresh-multi-anchor-service-island \
  expansion-comparison-replay
```

Evaluator and replay gates:

- Final-layout evaluator-validity is not required before the baseline-repeat slice because no candidate changes are applied.
- If a candidate changes final layouts after this intake, run candidate-specific evaluator validity for the affected rows, modes, budget, and seeds.
- `expansion-comparison-replay` must keep workflow replay validity before promotion-grade claims.

CPU and timing gates:

- Read population first.
- Then compare wall-clock, first-feasible, time-to-best, CPU-budget efficiency, and over-budget rows.
- Equal-population timing claims are diagnostics unless a later candidate names timing as the primary product target.

## Expected Signal

Minimum signal to continue:

- At least one row where Auto is behind LNS across more than one seed.
- Baseline-repeat Auto population movement does not explain the miss.
- No outside-negative repeat-envelope behavior.

What result closes this as diagnostics-only:

- Misses collapse to seed-specific noise.
- Auto ties best across the repeat slice.
- LNS wins are isolated to rows that are already closed by existing diagnostics.

What result blocks the candidate:

- Baseline-repeat variance is wide enough that the smoke misses cannot be interpreted.
- Final layouts become evaluator-invalid in a later candidate.

## Evidence Result

Focused run date: 2026-05-31

Artifact:

- `artifacts/cross-mode-budget-ablations/2026-05-31/auto-1s-miss-triage-baseline-repeat-20260531T185216Z`

Focused slice:

- Cases: `service-local-neighborhood`, `fresh-multi-anchor-service-island`, `expansion-comparison-replay`.
- Policies: `baseline`, `baseline-repeat`.
- Modes: `auto,lns`.
- Budgets: `1`.
- Seeds: `7,19,37`.

Result summary:

- Top policy: `baseline`, tied with `baseline-repeat`.
- Mean best population: `751.111`.
- Mean Auto population: `742.778`.
- Mean LNS population: `749.444`.
- Mean Auto gap to best: `8.333`.
- Baseline-repeat Auto movement: `0`.
- Rows inside baseline-repeat envelope: 9 of 9.
- Recommendation counts: `keep-auto=6`, `shift-auto-budget-to-lns=3`.

Per-row outcome:

| Case                                | Seed | Auto | LNS  | Best Winner | Auto Gap |
| ----------------------------------- | ---- | ---- | ---- | ----------- | -------- |
| `service-local-neighborhood`        | 7    | 455  | 470  | `lns`       | 15       |
| `service-local-neighborhood`        | 19   | 470  | 470  | `auto,lns`  | 0        |
| `service-local-neighborhood`        | 37   | 470  | 455  | `auto`      | 0        |
| `fresh-multi-anchor-service-island` | 7    | 990  | 1015 | `lns`       | 25       |
| `fresh-multi-anchor-service-island` | 19   | 1015 | 1015 | `auto,lns`  | 0        |
| `fresh-multi-anchor-service-island` | 37   | 1015 | 1015 | `auto,lns`  | 0        |
| `expansion-comparison-replay`       | 7    | 745  | 780  | `lns`       | 35       |
| `expansion-comparison-replay`       | 19   | 745  | 745  | `auto,lns`  | 0        |
| `expansion-comparison-replay`       | 37   | 780  | 780  | `auto,lns`  | 0        |

Decision:

- Close this intake diagnostics-only.
- The seed `7` misses are real and repeat-stable, but they do not reproduce across seeds `19` and `37`.
- Do not create a new Auto budget policy from this evidence.
- Treat this as a seed-sensitivity note for future short-budget work.
- Reopen only if another current baseline shows the same rows or workflow families behind best-of-mode across more than one seed, or if a candidate can improve seed `7` without any seed `19/37` regression.

## Artifact Policy

Artifact root:

- `artifacts/cross-mode-budget-ablations/2026-05-31/auto-1s-miss-triage-baseline-repeat-20260531T185216Z`

Expected files to keep in git when small:

- `budget-ablation.txt`
- `telemetry-manifest.json`
- `registry-entry-draft.json`

Expected files to move to release/external storage if large:

- `budget-ablation.json`
- `decision-trace.jsonl`

Registry plan:

- Registry entry required: no for the first diagnostics slice.
- Registry draft should still be written for review.

## Review Checklist

- Trigger is real and current: yes.
- Hypothesis is testable: yes.
- Same-slice baseline-repeat control is named: yes.
- Runtime default remains unchanged: yes.
