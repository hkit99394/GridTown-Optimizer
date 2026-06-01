# Solver Roadmap

## Purpose

Maximize feasible city population under fixed wall-clock and CPU budgets, while preserving exact validation for every reported final layout.

The current strategy is intentionally conservative:

- Keep `auto` as the default quality path.
- Use Greedy for fast incumbents and diagnostics.
- Use LNS as the main improvement engine after Greedy.
- Use CP-SAT for exact repair, bounded polish, proof, bounds, labels, and semantic checks.
- Promote learned guidance, portfolio, GPU, distributed solving, or external solver work only after protected equal-budget evidence says it helps.

Primary metrics are time to first feasible, population at relevant budgets, time to best, improvement per CPU-second, CP-SAT status/gap, repeatability across fixed seeds and planner workflows, and exact validation.

## Current Runtime Posture

The default solver path is incumbent-first:

1. `greedy` builds a fast feasible incumbent.
2. `LNS` improves the incumbent through bounded repair.
3. `CP-SAT` performs exact repair, bounded polish, or proof when budget allows.
4. `auto` orchestrates the budget and keeps the best incumbent.

| Mode             | Role                           | Default Use                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `auto`           | Main quality path              | Recommended solver mode.                                                                        |
| `greedy`         | Fast incumbent and diagnostics | Seed generation, baseline, and counterfactual traces.                                           |
| `LNS`            | Main improvement engine        | Adaptive repair around incumbent layouts.                                                       |
| `CP-SAT`         | Exact backend                  | Small proofs, local repairs, bounded polishing, semantic checks, and replay labels.             |
| CP-SAT portfolio | Explicit research mode         | Promote only after wall-clock and CPU-normalized wins over single CP-SAT.                       |
| Learned guidance | Future feature-flag path       | Greedy needs online equal-budget wins; learned LNS needs protected/fresh online value coverage. |

## Current Baseline

Completed baseline details live in [SOLVER_ROADMAP_DELIVERED.md](SOLVER_ROADMAP_DELIVERED.md). The long May 2026 evidence narrative is archived in [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).

Short version:

- `greedy`, `LNS`, `CP-SAT`, and `auto` are available through backend, planner, and CLI flows.
- Planner workflows cover solve, inspect, edit, validate, reuse, explainability maps, saved layouts, and expansion comparison.
- CP-SAT road semantics match the formal per-component anchor rule.
- Auto uses trace-tuned LNS budget defaults while preserving the measured `0.2` CP-SAT reserve default and explicit caller overrides.
- Cross-mode scorecards, product-corpus artifacts, telemetry manifests, workflow replay artifacts, and experiment-registry draft paths exist for promotion evidence.
- Capacity-normalized benchmark metrics now report optimistic population bounds, capacity utilization, gap-to-capacity, and gap-closed-per-second. These metrics are context only, not proof of attainable population. A separate hard population cap applies only when it is derived from the available residential inventory and each type's max population; if an exactly validated layout reaches that hard cap, no higher-population solution exists for the current objective.

## Current Solver Posture

There is no ungated default-path solver change active after the May 2026 evidence tranche. Default `auto` remains the recommended quality path.

Current decisions:

- **Auto policy:** unchanged. Short-budget and repair-allocation evidence did not justify changing Greedy seed time, LNS repair time, or CP-SAT reserve defaults.
- **CP-SAT NoOverlap2D geometry encoding:** diagnostics-only. The opt-in `cpSat.useNoOverlap2d` path is evaluator-valid but blocked from promotion by a repeatable protected holdout population regression and worse aggregate time-to-best.
- **Service-master shortlist:** diagnostics-only. The opt-in Greedy shortlist is useful and evaluator-valid, but Auto/default ties baseline and the measurable lift is concentrated in standalone Greedy holdout rows.
- **Learned LNS ranking:** diagnostics-only. Offline and product-axis signals are real, but protected/fresh online value remains blocked by neutral overrides, all-fallback behavior, or safety/selectivity tradeoffs.
- **Greedy learned ranking:** diagnostics-only until online equal-budget wins include inference overhead.
- **CP-SAT portfolio, exact small-window DP repair, external solvers, GPU, and distributed solving:** gated research tracks, not default behavior.

## Active Evidence Tracks

No default-path promotion candidate is currently active.

Recent opt-in diagnostics candidates:

- **Selective CP-SAT NoOverlap2D:** [M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_SELECTIVE_NO_OVERLAP2D.md) now has a clean focused slice and a full CP-SAT `1,5` product-corpus expansion: no evaluator invalidity, no protected/fresh population regression, and expansion/corridor guard rows stayed baseline-equivalent. It remains diagnostics-only because the signal is CP-SAT-standalone, guarded time-to-best is worse, and workflow-tag gating is not a runtime problem-feature guard.
- **CP-SAT runtime geometry-pressure guard:** [M9_CANDIDATE_INTAKE_CP_SAT_GEOMETRY_PRESSURE_GUARD.md](M9_CANDIDATE_INTAKE_CP_SAT_GEOMETRY_PRESSURE_GUARD.md) replaces workflow-tag selection with a runtime grid/catalog guard and passed full CP-SAT `1,5` evaluator validity. It remains diagnostics-only because guard-enabled time-to-best is still worse and value is concentrated in short-budget standalone CP-SAT rows.
- **Auto/LNS expansion-corridor policy:** [M9_CANDIDATE_INTAKE_AUTO_LNS_EXPANSION_CORRIDOR.md](M9_CANDIDATE_INTAKE_AUTO_LNS_EXPANSION_CORRIDOR.md) closed diagnostics-only in [M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md](M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md). Its first repair policy and stronger seed/repair policy were safe but population-neutral on focused 5s baseline-repeat controls, so no broad sweep or default-path work is justified.
- **Auto 1s miss triage:** [M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md](M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md) closed diagnostics-only. The 2026-05-31 14-case smoke misses reproduced for seed `7` but did not reproduce across seeds `19` and `37`, so no new Auto budget policy is justified.

Allowed near-term work is maintenance, diagnostics, or explicitly gated experimentation:

- Keep service-master decomposition opt-in while preserving its telemetry and evaluator-valid evidence.
- Use learned LNS artifacts for diagnosis, not runtime defaults, unless a new branch produces protected/fresh final-population value without regressions or final-neutral override blockers.
- Use capacity-normalized metrics to explain scorecards, not to tune defaults without separate protected equal-budget evidence.
- Reopen Auto policy only with a fresh reproducible outside-envelope failure or a candidate that first clears same-slice baseline-repeat controls.

## Planning Horizon

Ultimate goal: make `auto` the consistently best default solver path for planner users: fast first feasible layouts, stronger final population under fixed budgets, exact evaluator-valid results, and reliable long-running solve workflows.

Short run: effectively complete for the current checkpoint. The 0-4 week slice established the Auto-first planner flow, Advanced-mode solver tuning, sample problem presets, CP-SAT readiness messaging, split quality-gate scripts, and tighter artifact policy. Remaining short-run work is maintenance follow-up, not a blocker for middle-run evidence work.

Middle run: framework complete, evidence ongoing. Product-corpus, protected holdout, fresh holdout, evaluator-validity, CPU-cost, and time-to-best workflows are now in place. The first CP-SAT intake exercised the framework and closed diagnostics-only; future candidates must reuse the same gates rather than inventing a new evidence path.

Long run: no active promotion candidate. Promote only candidates that beat the current `auto` posture on protected/fresh equal-budget evidence. CP-SAT geometry, service-master, learned guidance, portfolio, external solver, GPU, and distributed-worker work should stay opt-in or diagnostics-only until they clear the promotion gates below.

## 2026-06-01 Stage Review And Forward Plan

Review result: the stage split is still healthy. Short run is complete, middle-run framework work is complete, and long-run/default-path promotion remains intentionally gated. The current 2026-05-31 plus 2026-06-01 split-lane baseline covers the 15-case corpus and is enough for normal candidate comparison; a single combined promotion-matrix artifact is unnecessary unless a release process explicitly requires it.

Findings from this review:

1. **P1 evidence hygiene:** fixed on 2026-06-01 by [ARTIFACT_HYGIENE_RECOVERY_PLAN.md](ARTIFACT_HYGIENE_RECOVERY_PLAN.md). The repo externalized and untracked 234 unindexed raw artifacts, uploaded durable raw packages to the `solver-evidence-2026-06-01` GitHub Release, and recovered the evidence gate. The baseline-lock follow-up appended the June 1 manual-resume bundles to `artifacts/experiments/index.jsonl`; `npm run artifact-hygiene:inventory` now reports 1501 tracked artifact files, 0 unindexed raw candidates, and a clear soft-margin watch under the 1600 hard cap.
2. **P2 stale CPU baseline wording:** fixed in [MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md](MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md). The review now uses the current 15-case split baseline instead of the legacy 2026-04-30 10-case bundle or the interim 14-case smoke.
3. **P3 L0 status drift:** fixed in [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md). L0 is now described as the active pre-long-run handoff, including the manual-resume fresh row, not only as the first CP-SAT preflight.

Forward sequence:

1. **Commit artifact-cap recovery:** done in `1b75973 Recover artifact hygiene and externalize raw evidence`.
2. **Planner completed-status smoke:** done on 2026-06-01. Completed and recovered status responses use lightweight reported-invariant validation, the web-solve smoke asserts terminal status polling stays quick, and the UI runtime smoke proves a delayed terminal `completed` payload is not converted into a failed solve.
3. **Fresh manual-resume holdout and timing triage:** done on 2026-06-01. `fresh-manual-resume-neighborhood` is now in the product corpus with a replay hint, LNS seed hint, CP-SAT warm-start hint, and the `manual-resume-neighborhood` workflow tag. Its focused `1s/5s/30s/120s` split-lane refresh is population-clean, with Auto reaching the hard cap on every row. The `1s` Auto timing watch is triaged in [MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md](MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md): post-cap CP-SAT search is shortened, residual overrun is CP-SAT bridge/model-build overhead, and strict subsecond adherence is a separate runtime project only if a product SLA requires it.
4. **Evidence baseline lock:** done on 2026-06-01. The June 1 manual-resume fast, long, and timing bundles are registered in `artifacts/experiments/index.jsonl`; M7/M8/M11/M12 wording is aligned to the 15-case baseline; artifact hygiene now has an explicit 1501-file soft-margin watch and 1600-file hard gate.
5. **Artifact soft-cap automation:** done on 2026-06-01. `npm run artifact-hygiene:check` and `quality:evidence` now warn when tracked artifacts exceed the 1500 soft target while still failing only at the 1600 hard cap; `npm run artifact-hygiene:inventory` reports structured soft/hard cap status and remaining hard-cap headroom; `npm run artifact-hygiene:status` gives reviewers a concise pass/warning/fail preflight.
6. **Candidate intake only on trigger:** do not open another broad solver candidate just to keep momentum. Reopen Auto/LNS only for a reproducible outside-envelope failure, CP-SAT geometry only for a different runtime-bottleneck hypothesis, learned guidance only for protected/fresh online value coverage, and service-master only for repeatable equal-budget wins.
7. **Long-run promotion:** once a triggered candidate exists, use M9 intake, same-slice baseline repeat, candidate-specific evaluator validity, CPU/time-to-best review, artifact storage handoff, and decision closeout before changing defaults.

## Middle-Run Evidence Checklist

Use this checklist before treating any solver branch as a default-path candidate.

Initial audit on 2026-05-29: the evidence framework is ready for middle-run work. The product workflow corpus has explicit development and holdout coverage, `quality:evidence` covers registry/artifact/product-corpus contracts, and the artifact policy separates durable summaries/manifests from large raw evidence bundles. No default-path promotion candidate is active.

Corpus coverage audit updated on 2026-06-01: [MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md](MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md) records the product-workflow split, mode, budget, seed, replay, and workflow-family coverage. The split-lane baseline now covers the current 15 product-corpus cases, all four modes, budgets `1,5,30,120`, and seeds `7,19,37`: 180 scorecards and 720 mode runs. Candidate-specific evaluator-validity evidence is still required before promotion claims.

Baseline-repeat runbook on 2026-05-30: [MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md](MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md) gives copy-paste same-slice controls for smoke, full product-corpus, candidate, and focused-row runs. Candidate deltas must be interpreted against the baseline-repeat envelope before broad scorecard claims.

Baseline scorecard refresh plan updated on 2026-06-01: [MIDDLE_RUN_BASELINE_SCORECARD_REFRESH_PLAN.md](MIDDLE_RUN_BASELINE_SCORECARD_REFRESH_PLAN.md) names smoke, development, protected holdout, fresh holdout, and full promotion-matrix refresh commands plus storage conventions. The fresh product holdout set, the expansion/corridor development analog, and the manual-resume fresh row are now implemented; the split-lane artifacts are the durable current 15-case baseline.

Previous 14-case product-corpus smoke on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-current-14-case-smoke-20260531T183922Z` covered all 14 cases and all four modes at `1s`, seed `7`, with no missing cases, split mismatches, or missing modes for the smoke slice. Auto tied best on 11 of 14 rows and was behind best on three short-budget rows; treat these as evidence targets, not default-change proof.

Development fast-lane baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-development-fast-1s-5s-seeds7-19-37-20260531T190759Z` covered the six development cases across `auto`, `greedy`, `lns`, and `cp-sat` at `1s` and `5s`, seeds `7,19,37`. Auto tied best on 34 of 36 rows; the only gaps were `typed-footprint-pressure` by `5` at `1s` seed `19` and by `20` at `5s` seed `7`.

Development `30s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-development-30s-seeds7-19-37-20260531T192916Z` covered the six development cases across all four modes at `30s`, seeds `7,19,37`. Auto tied best on all 18 rows, so the short-budget development gaps disappear by `30s`.

Development `120s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-development-120s-seeds7-19-37-20260531T195607Z` covered the six development cases across all four modes at `120s`, seeds `7,19,37`. Auto tied best on all 18 rows, with no Auto budget overruns; the slowest Auto row was `107.284s`.

Protected holdout fast-lane baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-fast-1s-5s-seeds7-19-37-20260531T191419Z` covered the five protected holdout cases across all four modes at `1s` and `5s`, seeds `7,19,37`. Auto tied best on 28 of 30 rows; the only gaps were `service-local-neighborhood` by `15` and `expansion-comparison-replay` by `35`, both at `1s` seed `7`. This matches the focused Auto 1s miss triage and does not justify a default-path policy change.

Protected holdout `30s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-30s-seeds7-19-37-20260531T193849Z` covered the five protected holdout cases across all four modes at `30s`, seeds `7,19,37`. Auto tied best on all 15 rows, so the protected short-budget gaps disappear by `30s`.

Protected holdout `120s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-protected-holdout-120s-seeds7-19-37-20260531T201243Z` covered the five protected holdout cases across all four modes at `120s`, seeds `7,19,37`. Auto tied best on all 15 rows, with no Auto budget overruns; the slowest Auto row was `28.283s`.

Fresh holdout fast-lane baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-fast-1s-5s-seeds7-19-37-20260531T191827Z` covered the three fresh holdout cases across all four modes at `1s` and `5s`, seeds `7,19,37`. Auto tied best on 17 of 18 rows; the only gap was `fresh-multi-anchor-service-island` by `25` at `1s` seed `7`. Across all current split fast-lane refreshes, including the 2026-06-01 manual-resume lane, Auto ties best on 85 of 90 rows.

Fresh holdout `30s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-30s-seeds7-19-37-20260531T194631Z` covered the first three fresh holdout cases across all four modes at `30s`, seeds `7,19,37`. Auto tied best on all 9 rows, so the 2026-05-31 `30s` baseline across development, protected holdout, and the first fresh holdout set is covered: 42 scorecards and 168 mode runs, with Auto tied best on every row.

Fresh holdout `120s` baseline refresh on 2026-05-31: `artifacts/product-corpus/2026-05-31/baseline-fresh-holdout-120s-seeds7-19-37-20260531T221202Z` covered the three fresh holdout cases across all four modes at `120s`, seeds `7,19,37`. Auto tied best on all 9 rows, with no Auto budget overruns; the slowest Auto row was `16.456s`.

Fresh manual-resume fast-lane baseline refresh on 2026-06-01: `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-fast-1s-5s-seeds7-19-37-20260601T150511Z` covered the new manual-resume holdout across all four modes at `1s` and `5s`, seeds `7,19,37`. Auto reached the hard population cap `790` on all 6 rows, replay validity had 0 validation errors and 0 population mismatches, and every final layout was anchor-connected. Timing watch: Auto reached cap while overrunning the `1s` wall-clock budget on all three `1s` rows.

Fresh manual-resume `1s` timing triage on 2026-06-01: [MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md](MIDDLE_RUN_AUTO_1S_MANUAL_RESUME_TIMING_TRIAGE.md) added CP-SAT model-upper-bound stop behavior and a deterministic-dominance cap short-circuit. Focused artifact `artifacts/product-corpus/2026-06-01/timing-fresh-manual-resume-auto-1s-cap-stop-seeds7-19-37-20260601T160520Z` kept Auto at the hard cap `790` on all 3 rows, with CP-SAT internal solve wall time `0.354s` to `0.538s`. Auto wall time still exceeds strict `1s` because Python bridge/model-build overhead is outside the OR-Tools solve limit; treat that as a separate runtime project only if a hard product SLA requires it.

Fresh manual-resume long-lane baseline refresh on 2026-06-01: `artifacts/product-corpus/2026-06-01/baseline-fresh-manual-resume-long-30s-120s-seeds7-19-37-20260601T151447Z` covered the new manual-resume holdout across all four modes at `30s` and `120s`, seeds `7,19,37`. Auto reached the hard population cap `790` on all 6 rows, replay validity had 0 validation errors and 0 population mismatches, every final layout was anchor-connected, and Auto stayed under both long budgets.

Full split-baseline coverage on 2026-06-01: split-lane artifacts cover the current 15 product-corpus cases, all four modes, budgets `1,5,30,120`, and seeds `7,19,37`: 180 scorecards and 720 mode runs. Auto ties best on 175 of 180 rows; the five Auto gaps are short-budget rows only, and Auto ties best on all `30s` and `120s` rows. Decision: keep the split artifacts as the durable baseline. Create one combined promotion-matrix artifact only if a release process explicitly requires it.

Focused Auto 1s miss triage on 2026-05-31: [M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md](M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md) ran a same-slice baseline-repeat check over the three smoke misses at `1s`, seeds `7,19,37`. The misses were seed `7` only, with no baseline-repeat Auto movement, so the intake closed diagnostics-only.

Evaluator-validity replay check updated on 2026-06-01: [MIDDLE_RUN_EVALUATOR_VALIDITY_REPLAY_CHECK.md](MIDDLE_RUN_EVALUATOR_VALIDITY_REPLAY_CHECK.md) records the current product workflow replay and final-layout validity boundary. Replay workflow metrics cover manual-layout, manual-resume, and expansion replays through `/api/layout/evaluate`; the service-master diagnostics branch has 120/120 evaluator-valid Greedy rows; broad future candidates still need candidate-specific final-layout evaluator validity before promotion.

CPU and time-to-best review updated on 2026-06-01: [MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md](MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md) summarizes scorecard fields for wall-clock, CPU budget, observed CPU, first feasible, time to best, and budget-allocation signals. It now uses the current 15-case split baseline as the comparison baseline; reviewers can compare population gains against timing and CPU cost without starting from raw JSON bundles.

Promotion readiness checkpoint on 2026-05-30: [MIDDLE_RUN_PROMOTION_READINESS_CHECKPOINT.md](MIDDLE_RUN_PROMOTION_READINESS_CHECKPOINT.md) keeps the current status precise. M1-M11 make the middle-run evidence framework usable and fresh product holdout coverage now exists, but long-run promotion remains blocked until candidate-specific final-layout evaluator-validity evidence is runnable for the actual candidate being reviewed.

L0 pre-long-run checkpoint on 2026-05-30: [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md) starts the handoff from middle-run framework readiness into candidate intake. It records the first fresh holdout nominations, implements the first two CP-SAT-relevant fresh cases, adds the candidate-specific evaluator-validity automation command shape, and links the first M9 intake: [M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md](M9_CANDIDATE_INTAKE_CP_SAT_NO_OVERLAP2D.md). The L0 CP-SAT smoke passed on both fresh cases with zero population mismatches, the first CP-SAT candidate has since closed diagnostics-only, and the expansion/corridor fresh row has now been exercised in focused Auto/LNS diagnostics.

Candidate intake template on 2026-05-30: [MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md](MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md) defines the required pre-work request shape for solver candidates. New candidates must name trigger, hypothesis, affected modes, cases, budgets, seeds, expected signal, blockers, evaluator/replay gates, CPU/time-to-best interpretation, and artifact policy before implementation.

Decision closeout template on 2026-05-30: [MIDDLE_RUN_DECISION_CLOSEOUT_TEMPLATE.md](MIDDLE_RUN_DECISION_CLOSEOUT_TEMPLATE.md) defines the required end-of-work decision record for promote, keep-baseline, diagnostics-only, and blocked outcomes. Closeouts must record exact commands, commits, hardware, split metadata, summary metrics, artifact index, blockers, and runtime-default status.

Artifact storage handoff on 2026-05-30: [MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md](MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md) defines the durable release/external storage convention for large raw scorecards, replay labels, trace dumps, solve logs, and raw matrices. Git remains the home for summaries, manifests, registry drafts, external-artifact manifests, and the append-only registry index.

1. **Baseline freshness:** run `npm run quality:evidence` and a current product-corpus scorecard smoke before interpreting candidate results.
2. **Corpus coverage:** confirm development, protected holdout, fresh product holdout, workflow tags, evaluator-validity replay, CPU cost, and time-to-best fields are present for the candidate's comparison family.
3. **Same-slice controls:** run baseline-repeat controls on the same cases, budgets, seeds, hardware, and command shape before broad scorecard interpretation.
4. **Promotion matrix:** for real candidates, report `auto`, `greedy`, `lns`, and `cp-sat` at 1s, 5s, 30s, and 120s with seeds `7,19,37`; include portfolio only when CPU-normalized efficiency is part of the claim.
5. **Promotion-readiness checkpoint:** before any long-run/default-path candidate starts, confirm fresh product holdout cases are nominated or added and the candidate-specific final-layout evaluator-validity run shape exists.
6. **Artifact policy:** keep summaries, telemetry manifests, registry drafts, and the registry index in git; move large raw JSON bundles, replay labels, trace dumps, and temporary solve logs to external or release storage.
7. **Decision closeout:** record the exact command, commit, hardware, split metadata, artifact location, result summary, blockers, and default-path decision before changing runtime defaults.

## Middle-Run Backlog

These items make the evidence system current enough that solver candidates can be judged without rebuilding the framework. They are not default-path solver changes.

| ID  | Status | Work Item                         | Deliverable                                                                                                                                                  | Done When                                                                                                                                                                                        |
| --- | ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Done   | Evidence readiness audit          | Confirmed evidence gate, registry, product-corpus split checks, and artifact policy posture                                                                  | `npm run quality:evidence` passes, registry checks pass, and product-corpus scorecard smoke runs without creating promotion claims.                                                              |
| M2  | Done   | Middle-run operating checklist    | Checklist above                                                                                                                                              | Baseline freshness, corpus coverage, same-slice controls, promotion matrix, artifact policy, and decision closeout are written in the active plan.                                               |
| M3  | Done   | Product-corpus freshness smoke    | Small current scorecard smoke over product workflow cases                                                                                                    | Current corpus list is checked and at least one development workflow smoke runs across `auto`, `greedy`, `lns`, and `cp-sat`.                                                                    |
| M4  | Done   | Corpus coverage audit             | [MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md](MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md)                                                                                   | Every promotion-relevant workflow family has an owner status: covered, weak coverage, missing, or not applicable.                                                                                |
| M5  | Done   | Baseline-repeat control runbook   | [MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md](MIDDLE_RUN_BASELINE_REPEAT_RUNBOOK.md)                                                                               | Candidate reviewers can run baseline-repeat on the same cases, budgets, seeds, hardware, and command shape before broad scorecard interpretation.                                                |
| M6  | Done   | Baseline scorecard refresh plan   | [MIDDLE_RUN_BASELINE_SCORECARD_REFRESH_PLAN.md](MIDDLE_RUN_BASELINE_SCORECARD_REFRESH_PLAN.md)                                                               | The plan records split artifacts as the durable baseline and keeps the full promotion-matrix command only for release processes that explicitly require one combined artifact.                   |
| M7  | Done   | Evaluator-validity replay check   | [MIDDLE_RUN_EVALUATOR_VALIDITY_REPLAY_CHECK.md](MIDDLE_RUN_EVALUATOR_VALIDITY_REPLAY_CHECK.md)                                                               | Product workflow replay metrics and evaluator-validity boundaries are clear enough to block invalid or overbroad promotion claims.                                                               |
| M8  | Done   | CPU and time-to-best review       | [MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md](MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md)                                                                               | Promotion reviewers can compare population gains against CPU cost and time-to-best without inspecting raw JSON bundles.                                                                          |
| M9  | Done   | Candidate intake template         | [MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md](MIDDLE_RUN_CANDIDATE_INTAKE_TEMPLATE.md)                                                                           | New candidates must name trigger, hypothesis, modes, cases, budgets, seeds, expected signal, blockers, and artifact policy before implementation.                                                |
| M10 | Done   | Decision closeout template        | [MIDDLE_RUN_DECISION_CLOSEOUT_TEMPLATE.md](MIDDLE_RUN_DECISION_CLOSEOUT_TEMPLATE.md)                                                                         | Each decision records command, commit, hardware, split metadata, summary metrics, artifact index, blockers, and runtime-default status.                                                          |
| M11 | Done   | Artifact storage handoff          | [MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md](MIDDLE_RUN_ARTIFACT_STORAGE_HANDOFF.md)                                                                             | Large scorecards, replay labels, trace dumps, and solve logs have a durable location while registry entries remain the git-tracked index.                                                        |
| M12 | Done   | Pre-long-run promotion checkpoint | [MIDDLE_RUN_PROMOTION_READINESS_CHECKPOINT.md](MIDDLE_RUN_PROMOTION_READINESS_CHECKPOINT.md), [L0_PRE_LONG_RUN_CHECKPOINT.md](L0_PRE_LONG_RUN_CHECKPOINT.md) | Fresh product holdout cases and candidate-specific evaluator-validity automation are implemented for the first CP-SAT intake; the L0 smoke passed, and the first candidate closeout is recorded. |
| M13 | Done   | Evidence baseline lock            | Registry append plus M7/M8/M11/M12 doc refresh                                                                                                               | June 1 manual-resume evidence is registered, the current baseline is consistently described as 15 cases, and artifact hygiene has an explicit 1501-file soft-margin watch under the 1600 cap.    |
| M14 | Done   | Artifact soft-cap automation      | `artifact-hygiene:check`, `artifact-hygiene:status`, inventory soft/hard cap fields, and evidence-gate warning                                               | Evidence checks warn above the 1500 soft target, fail only above the 1600 hard cap, and inventory/status output shows soft overage plus hard-cap headroom.                                       |

## Closed Evidence Tracks

These summaries preserve the decision boundary. Detailed artifacts and intermediate investigation notes are in [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).

### Service-Master Shortlist

Decision: closed on 2026-05-28 as diagnostics-only.

Evidence:

- Greedy product-corpus ablation: positive standalone Greedy lift, no population regressions.
- 1s, 5s, and 30s Auto/Greedy slices: Auto/default remained unchanged with no regressions.
- Evaluator-validity rerun: 120/120 Greedy rows valid, 0 population mismatches.

Reopen only if a later branch shows broader protected holdout value beyond the current narrow standalone Greedy wins with acceptable cost.

### Strict LNS Replay Labels And Feature Payloads

Decision: closed as learned-LNS diagnostics-only.

Evidence:

- Strict, curated, natural-seed, roll-forward, repeatability, final-lift, product, protected, default replay-pressure, and fresh holdout branches generated useful labels and telemetry.
- Several offline rankers beat simple baselines, and some product/default replay-pressure scorecards showed value.
- Promotion stayed blocked because protected/fresh online scorecards were neutral, unsafe, all-fallback, or carried final-neutral override behavior.

Reopen only with new protected/fresh value coverage or a materially different model class that improves final population or time-to-best online without regressions or neutral override blockers.

### Short-Budget Auto Gap Triage

Decision: closed with current Auto defaults unchanged.

Evidence:

- Focused 1s/5s misses were diagnosed with product-corpus preflights, baseline-repeat controls, and preserved LNS stage traces.
- Candidate seed/repair/reserve policies did not clear broad product-corpus safety and repeatability gates.
- The prior expansion repair-time swing did not reproduce under the later same-slice stage-trace repeat.

Reopen only with a fresh reproducible outside-envelope failure or a new policy candidate that clears baseline-repeat controls before broad interpretation.

### Auto/LNS Expansion-Corridor Policies

Decision: closed on 2026-05-31 as diagnostics-only.

Evidence:

- Added `development-expansion-corridor-service` so the expansion/corridor family has development, protected, and fresh rows.
- Focused 5s Auto/LNS baseline-repeat evidence covered development, protected, and fresh cases at seeds `7,19,37`.
- `expansion-corridor-lns-repair-5s-guarded` and `expansion-corridor-lns-seed-repair-5s-guarded` were both safe but population-neutral.
- The stronger policy improved mean Auto wall-clock by `0.635s` but did not improve population on any row.

Reopen only with a population-moving protected/fresh expansion-corridor row outside the baseline-repeat envelope, or with an explicit product target that makes equal-population time-to-best the primary claim.

### Auto 1s Miss Triage

Decision: closed on 2026-05-31 as diagnostics-only.

Evidence:

- The 2026-05-31 14-case smoke found Auto behind best-of-mode on `service-local-neighborhood`, `fresh-multi-anchor-service-island`, and `expansion-comparison-replay` at `1s`, seed `7`.
- Focused baseline-repeat evidence over the same rows at seeds `7,19,37` found `keep-auto=6` and `shift-auto-budget-to-lns=3`.
- All three shift-to-LNS recommendations were seed `7`; seeds `19` and `37` tied or favored Auto.
- Baseline-repeat Auto movement was `0`, so the seed `7` rows are deterministic but not cross-seed enough for policy work.

Reopen only if the same workflow family falls behind best-of-mode across more than one standard seed, or if a proposed candidate fixes seed `7` while preserving seeds `19` and `37`.

## Maintenance Backlog

These items are not solver-policy candidates. They track planner/runtime reliability follow-ups that protect long-running solve workflows.

Recently completed maintenance:

1. **Planner completed-status resilience:** completed 2026-06-01 after a completed background solve surfaced as failed in the UI because final status polling performed heavyweight response validation. Completed and recovered `/api/solve/status` terminal responses now use lightweight reported-invariant validation, the web-solve smoke asserts terminal completed polls stay quick, and `tests/planner-completed-status-smoke.test.cjs` checks that the UI accepts a delayed terminal `completed` payload without reporting a failed solve.
1. **Artifact-cap recovery:** completed 2026-06-01 after the review found `node tests/artifact-repository-hygiene.test.cjs` failing at 1716 tracked artifacts against the 1600 cap. [ARTIFACT_HYGIENE_RECOVERY_PLAN.md](ARTIFACT_HYGIENE_RECOVERY_PLAN.md) records the migration: 234 unindexed raw artifacts were packaged into durable GitHub Release assets, untracked from git, and replaced in affected registry drafts by the compact tracked external manifest. `npm run quality:evidence` is green again.
1. **Evidence baseline lock:** completed 2026-06-01 after the manual-resume split artifacts became the durable 15-case baseline. The three June 1 registry drafts are appended to `artifacts/experiments/index.jsonl`, support docs no longer describe the current baseline as 14-case or 10-case, and artifact hygiene explicitly tracks the 1501-file soft-margin watch below the 1600 hard cap.
1. **Artifact soft-cap automation:** completed 2026-06-01. `tests/artifact-repository-hygiene.test.cjs` now emits a non-failing warning above the 1500 soft target and still fails at the 1600 hard cap; `scripts/prepare-artifact-hygiene-recovery.mjs --inventory` reports structured soft/hard cap state; `npm run artifact-hygiene:check` exposes the check directly; `npm run artifact-hygiene:status` exposes a concise reviewer preflight.

- **Roadmap restructure:** completed 2026-05-29. The active roadmap was shortened to current posture, active tracks, closed decisions, gated priorities, promotion gates, guardrails, and maintenance backlog. The detailed May evidence narrative moved to [SOLVER_ROADMAP_HISTORY_2026-05.md](SOLVER_ROADMAP_HISTORY_2026-05.md).
- **First M9 CP-SAT candidate closeout:** completed 2026-05-30. The opt-in `NoOverlap2D` CP-SAT encoding passed evaluator validity but is blocked from promotion by a repeatable protected holdout population regression and worse aggregate time-to-best: [M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md](M9_CP_SAT_NO_OVERLAP2D_CLOSEOUT.md).
- **M9 Auto/LNS expansion-corridor closeout:** completed 2026-05-31. The opt-in repair and seed/repair policies were safe but population-neutral, with only a diagnostic wall-clock improvement: [M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md](M9_AUTO_LNS_EXPANSION_CORRIDOR_CLOSEOUT.md).
- **M9 Auto 1s miss triage:** completed 2026-05-31. The three current-corpus smoke misses were seed `7` only after baseline-repeat expansion to seeds `7,19,37`: [M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md](M9_CANDIDATE_INTAKE_AUTO_1S_MISS_TRIAGE.md).
- **Development fast-lane baseline refresh:** completed 2026-05-31. The current six-case development split passed the `1s/5s`, seeds `7,19,37` refresh with Auto tied best on 34 of 36 rows; the two remaining Auto gaps are both `typed-footprint-pressure` rows.
- **Development `30s` baseline refresh:** completed 2026-05-31. The current six-case development split passed the `30s`, seeds `7,19,37` refresh with Auto tied best on all 18 rows.
- **Development `120s` baseline refresh:** completed 2026-05-31. The current six-case development split passed the `120s`, seeds `7,19,37` refresh with Auto tied best on all 18 rows.
- **Protected holdout fast-lane baseline refresh:** completed 2026-05-31. The current five-case protected holdout split passed the `1s/5s`, seeds `7,19,37` refresh with Auto tied best on 28 of 30 rows; both gaps are `1s`, seed `7` rows already covered by Auto 1s miss triage.
- **Protected holdout `30s` baseline refresh:** completed 2026-05-31. The current five-case protected holdout split passed the `30s`, seeds `7,19,37` refresh with Auto tied best on all 15 rows.
- **Protected holdout `120s` baseline refresh:** completed 2026-05-31. The current five-case protected holdout split passed the `120s`, seeds `7,19,37` refresh with Auto tied best on all 15 rows.
- **Fresh holdout fast-lane baseline refresh:** completed 2026-05-31. The first three-case fresh holdout split passed the `1s/5s`, seeds `7,19,37` refresh with Auto tied best on 17 of 18 rows; the only gap is the `fresh-multi-anchor-service-island` `1s`, seed `7` row already covered by Auto 1s miss triage.
- **Fresh holdout `30s` baseline refresh:** completed 2026-05-31. The first three-case fresh holdout split passed the `30s`, seeds `7,19,37` refresh with Auto tied best on all 9 rows; the 2026-05-31 14-case `30s` baseline is complete.
- **Fresh holdout `120s` baseline refresh:** completed 2026-05-31. The first three-case fresh holdout split passed the `120s`, seeds `7,19,37` refresh with Auto tied best on all 9 rows; the 2026-05-31 split-lane baseline covered the previous 14 cases before the 2026-06-01 manual-resume addition completed the current 15-case baseline.
- **Fresh manual-resume holdout and timing triage:** completed 2026-06-01. `fresh-manual-resume-neighborhood` adds a fresh saved-layout resume and warm-start holdout row; its focused evaluator-validity and `1s/5s/30s/120s` baseline refresh are population-clean, and the `1s` Auto timing watch is closed as triaged with residual CP-SAT bridge overhead documented.

## Gated Priorities

These are not next actions by default. They become active only when their trigger is satisfied.

| Trigger                                                                                          | Candidate Work                                             | Success Signal                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-SAT semantics and product corpus stay stable, and exact search quality remains a bottleneck   | New CP-SAT geometry candidate after `NoOverlap2D` closeout | Better propagation or time-to-best without model-size blowup and no protected/fresh population regression.                                                        |
| Service-master shortlist preserves focused wins and scorecards show repeatable equal-budget wins | Promote service-master into Auto or Greedy seed policy     | Beats current Auto or Greedy seed path on development and holdout pressure families with evaluator-valid layouts, bounded CPU cost, and no worst-row regressions. |
| New protected/fresh LNS value coverage or a materially different model class appears             | Learned LNS window ranking                                 | Active protected/fresh overrides improve final population or time-to-best online without regressions, final-neutral override blockers, or product-axis loss.      |
| Greedy offline ranker evidence is paired with online equal-budget wins                           | Feature-flagged learned Greedy re-ranking                  | Online seeded benchmarks improve population or time-to-best with bounded inference overhead.                                                                      |
| Portfolio scorecards show wall-clock and CPU-normalized wins                                     | CP-SAT portfolio in Auto                                   | Portfolio beats single CP-SAT on quality and CPU efficiency.                                                                                                      |
| A CPU-first label, training, feature, or inference workflow becomes a measured bottleneck        | GPU acceleration                                           | GPU reduces the measured bottleneck while preserving solver quality gates.                                                                                        |
| Hosted or multi-user execution becomes a product requirement                                     | Durable worker architecture                                | Status, cancellation, and snapshots survive process restarts and multi-instance routing.                                                                          |
| Exact bounds or incumbents remain blocked after CP-SAT tuning                                    | External MILP/SCIP/Gurobi/cuOpt research adapter           | Better bounds or incumbents on selected families under exact evaluator validation.                                                                                |

## Promotion Gates

Any default-path solver change must include:

- Exact validation for all final layouts.
- Candidate-specific final-layout evaluator-validity evidence for the affected modes, cases, budgets, and seeds.
- At least 3 fixed seeds.
- 1s, 5s, 30s, and 120s budget reporting when relevant.
- Development, protected holdout, and fresh product holdout scorecards, or a documented candidate-specific equivalent when the candidate is narrower than the full product workflow matrix.
- Median population improvement, or equal population with at least 10% faster time-to-best.
- Worst-decile population delta `>= 0` unless a reviewed exception is documented.
- Regression rate `<= 5%`.
- CPU-budget efficiency no worse than 10% below baseline unless population improvement justifies it.
- Registered benchmark, hardware, split, command, model, artifact, and decision metadata.

## Guardrails

- Roads are support cells, not the primary objective.
- The formal road rule is per-component anchor connectivity; solver backends and validators must agree.
- Final road cleanup should remove only roads that do not affect building access or anchor-boundary road connectivity.
- Auto LNS stages must preserve reserved CP-SAT time unless a future trace-backed policy changes that.
- Learned label/runtime infrastructure exists, but promotion is track-specific: Greedy needs online equal-budget wins with inference overhead counted, while learned LNS needs protected/fresh online value coverage or a materially different model class.
- Tiny saturated cases are smoke tests, not promotion evidence.
- Dynamic programming is a bounded exact subroutine for tiny windows and oracles, not a replacement for Greedy/LNS/CP-SAT.
- CPU parallelism must be measured against both wall-clock and CPU-second cost.
- Hard population cap and optimistic capacity gap are different signals. If the cap is the true residential-inventory max and the final layout is validator-valid at that population, treat the current population objective as solved optimally and stop searching unless a secondary objective or explicit post-cap polish window is requested.
- Population upper bounds and capacity gaps from benchmark context are not proven optima; do not use unreachable gaps as promotion blockers without exact proof, a hard residential-inventory cap hit, or stronger feasibility bounds.
- Distributed solving should wait until hosting requires durable jobs or single-machine policy is no longer the bottleneck.
