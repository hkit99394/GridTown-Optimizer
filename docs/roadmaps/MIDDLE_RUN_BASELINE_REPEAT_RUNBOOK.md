# Middle-Run Baseline-Repeat Runbook

Reviewed on 2026-05-30.

Use this runbook before interpreting a solver-policy candidate against the product workflow corpus. The purpose is to measure same-slice run-to-run variance by running the current policy twice in one command:

- `baseline`: current Auto/LNS budget policy.
- `baseline-repeat`: the same current policy, named as a paired variance control.
- candidate policy: the proposed policy under review, added after `baseline-repeat`.

Baseline-repeat controls are diagnostic evidence. They do not promote solver behavior by themselves.

## Invariants

- Keep the case list, modes, budgets, seeds, hardware, and command shape identical between `baseline`, `baseline-repeat`, and the candidate.
- Put `baseline` first and `baseline-repeat` second in `--ablation-policies`.
- Use `--product-corpus` for product workflow decisions.
- Use `--artifact-dir`, not `--product-artifact-dir`, because budget ablations write ablation bundles.
- Use a fresh artifact directory and run id for every run. Do not overwrite old evidence unless the run is explicitly scratch-only.
- For Auto budget-policy candidates, start with `--modes=auto`.
- For candidates that can change standalone Greedy and Auto behavior, use `--modes=auto,greedy`.
- Keep large `budget-ablation.json` and `decision-trace.jsonl` bundles out of long-term git storage when they become too large; keep summaries, manifests, registry drafts, and registry entries as the durable index.

## Smoke Control

Run this first to confirm the local build, CP-SAT bridge, artifact writer, and policy names are usable.

```bash
npm run build
```

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
RUN_ID="cross-mode-budget-ablation-${RUN_STAMP}-baseline-repeat-smoke"
ARTIFACT_DIR="artifacts/cross-mode-budget-ablations/${RUN_DATE}/baseline-repeat-smoke-${RUN_STAMP}"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --budget-ablation \
  --ablation-policies=baseline,baseline-repeat \
  --modes=auto \
  --budgets=1 \
  --seeds=7 \
  --artifact-dir="${ARTIFACT_DIR}" \
  --ablation-run-id="${RUN_ID}" \
  --ablation-decision=diagnostics-only-baseline-repeat-smoke \
  '--ablation-summary=Baseline-repeat smoke on the tiny product workflow case; no solver default changed.' \
  --json \
  typed-housing-single
```

Expected shape:

- `policyCount` is `2`.
- `baselinePolicyName` is `baseline`.
- `seeds` is `[7]`.
- `cases.development` includes `typed-housing-single`.
- `registry-entry-draft.json`, `telemetry-manifest.json`, `budget-ablation.txt`, `budget-ablation.json`, and `decision-trace.jsonl` are written.

## Full Product Baseline-Repeat Control

Use this when refreshing the variance envelope for the current product workflow promotion matrix.

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
RUN_ID="cross-mode-budget-ablation-${RUN_STAMP}-product-corpus-baseline-repeat-auto-1s-5s-30s-120s-seeds7-19-37"
ARTIFACT_DIR="artifacts/cross-mode-budget-ablations/${RUN_DATE}/product-corpus-baseline-repeat-auto-1s-5s-30s-120s-seeds7-19-37-${RUN_STAMP}"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --budget-ablation \
  --ablation-policies=baseline,baseline-repeat \
  --modes=auto \
  --budgets=1,5,30,120 \
  --seeds=7,19,37 \
  --artifact-dir="${ARTIFACT_DIR}" \
  --ablation-run-id="${RUN_ID}" \
  --ablation-decision=diagnostics-only-baseline-repeat-control \
  '--ablation-summary=Same-slice baseline-repeat control over the full product workflow corpus, Auto mode, budgets 1s/5s/30s/120s, and seeds 7/19/37; no solver default changed.' \
  --json
```

Coverage:

- 12 product workflow cases.
- 2 policies.
- 1 mode.
- 4 budgets.
- 3 seeds.
- 288 total Auto runs.

## Candidate Same-Slice Control

Use this before interpreting broad candidate results. Replace `CANDIDATE_POLICY` with one of the supported budget-ablation policies, for example `service-pressure-cp-sat-reserve-5s-guarded`, `service-present-lns-seed-reserve-5s-guarded`, `lns-seed-reserve-5s-guarded`, or `service-master-shortlist`.

```bash
CANDIDATE_POLICY="service-pressure-cp-sat-reserve-5s-guarded"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
RUN_ID="cross-mode-budget-ablation-${RUN_STAMP}-product-corpus-${CANDIDATE_POLICY}-auto-baseline-repeat"
ARTIFACT_DIR="artifacts/cross-mode-budget-ablations/${RUN_DATE}/product-corpus-${CANDIDATE_POLICY}-auto-baseline-repeat-${RUN_STAMP}"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --budget-ablation \
  --ablation-policies="baseline,baseline-repeat,${CANDIDATE_POLICY}" \
  --modes=auto \
  --budgets=1,5,30,120 \
  --seeds=7,19,37 \
  --artifact-dir="${ARTIFACT_DIR}" \
  --ablation-run-id="${RUN_ID}" \
  --ablation-decision="diagnostics-only-${CANDIDATE_POLICY}-baseline-repeat-control" \
  "--ablation-summary=Same-slice baseline-repeat control for ${CANDIDATE_POLICY} over the full product workflow corpus; no solver default changed." \
  --json
```

For Greedy-affecting candidates, use this mode shape instead:

```bash
--modes=auto,greedy
```

## Focused Row Control

Use this when a candidate has one or more surprising rows. Keep the exact case, budget, seed, mode, and policy shape from the broad run, then append the focused case names.

```bash
CANDIDATE_POLICY="service-pressure-cp-sat-reserve-5s-guarded"
FOCUSED_CASE="typed-footprint-pressure"
FOCUSED_BUDGETS="5"
FOCUSED_SEEDS="37"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DATE="$(date -u +%F)"
RUN_ID="cross-mode-budget-ablation-${RUN_STAMP}-focused-${CANDIDATE_POLICY}-${FOCUSED_CASE}"
ARTIFACT_DIR="artifacts/cross-mode-budget-ablations/${RUN_DATE}/focused-${CANDIDATE_POLICY}-${FOCUSED_CASE}-${RUN_STAMP}"

node dist/crossModeBenchmarkCli.js \
  --product-corpus \
  --budget-ablation \
  --ablation-policies="baseline,baseline-repeat,${CANDIDATE_POLICY}" \
  --modes=auto \
  --budgets="${FOCUSED_BUDGETS}" \
  --seeds="${FOCUSED_SEEDS}" \
  --artifact-dir="${ARTIFACT_DIR}" \
  --ablation-run-id="${RUN_ID}" \
  --ablation-decision=diagnostics-only-focused-baseline-repeat-control \
  "--ablation-summary=Focused same-slice baseline-repeat rerun for ${CANDIDATE_POLICY} on ${FOCUSED_CASE}; no solver default changed." \
  --json \
  "${FOCUSED_CASE}"
```

Use multiple case names at the end when the same failure pattern appears on several rows.

## Interpretation Rules

Read `budget-ablation.txt` first, then inspect `registry-entry-draft.json` or `budget-ablation.json` only when details are needed.

For each candidate policy, check `autoVarianceSummary`:

- `outsideNegativeRepeatEnvelopeCount > 0`: block promotion interpretation and run focused row controls.
- `outsideRepeatEnvelopeCount == 0`: treat small population movement as inside repeat noise unless the candidate has a separate, reviewed reason to continue.
- `outsidePositiveRepeatEnvelopeCount > 0` and `outsideNegativeRepeatEnvelopeCount == 0`: candidate may continue to broader/fresh evidence, but this is not promotion by itself.
- Wide `repeatAutoPopulationDeltaMin..repeatAutoPopulationDeltaMax`: increase seeds or run a focused repeat before drawing conclusions.

Also check:

- `autoSafetySummary.regressionRate`.
- `autoSafetySummary.worstAutoPopulationDeltaVsBaseline`.
- `policyApplicationSummary.appliedAutoComparisonCount` for conditional policies.
- `meanAutoWallClockDeltaVsBaselineSeconds`.
- `autoCpuBudgetEfficiencyRatioVsBaseline`.

Do not attribute full-corpus movement to a conditional policy if most changed rows are outside `policyApplicationSummary.appliedAutoComparisonCount`.

## Closeout

Before a candidate can move past middle-run evidence review:

- Record the exact command, commit, hardware, artifact path, cases, budgets, seeds, and mode set.
- State whether candidate deltas were inside or outside the baseline-repeat envelope.
- State whether any regressions reproduced in focused row controls.
- Apply the artifact policy: keep summaries/manifests/registry drafts in git, move large raw bundles to durable external or release storage when needed.
- Keep the runtime default unchanged unless the promotion gates in `SOLVER_ROADMAP.md` are also satisfied.
