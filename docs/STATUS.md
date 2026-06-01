# Current Status

Last updated: 2026-06-01.

Use this page as the quick reviewer entrypoint. The detailed source of truth remains
[SOLVER_ROADMAP.md](roadmaps/SOLVER_ROADMAP.md), with supporting evidence in
[MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md](roadmaps/MIDDLE_RUN_CORPUS_COVERAGE_AUDIT.md),
[MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md](roadmaps/MIDDLE_RUN_CPU_TIME_TO_BEST_REVIEW.md),
[MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](roadmaps/MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md), and
[ARTIFACT_POLICY.md](ARTIFACT_POLICY.md). Refactor opportunities are tracked in
[DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md](roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md).

## Ultimate Goal

Make `auto` the consistently best default solver path for planner users: fast first feasible layouts, stronger final population under fixed budgets, exact evaluator-valid results, and reliable long-running solve workflows.

## Current Baseline

- Default solver posture: `auto` remains the recommended quality path.
- Runtime shape: `greedy` builds the fast incumbent, `LNS` improves it, and `CP-SAT` provides exact repair, bounded polish, proof, bounds, labels, and semantic checks when budget allows.
- Current durable baseline: 15 product-corpus cases, all four modes (`auto`, `greedy`, `lns`, `cp-sat`), budgets `1,5,30,120`, and seeds `7,19,37`.
- Baseline size: 180 scorecards and 720 mode runs.
- Current Auto result: Auto ties best on 175 of 180 rows. The five remaining gaps are short-budget rows only; Auto ties best on all `30s` and `120s` rows.
- Combined promotion matrix: not needed unless a release process explicitly asks for one combined artifact.

## Branch And PR

- Current workspace branch: `features/recover-quality-gate-and-status-doc`.
- Current branch purpose: restore the source-file budget gate, add this short status page, and land the first review-safe refactor slice.
- Solver defaults changed by this branch: no.
- Existing roadmap note: [POST_BASELINE_TRIGGER_GOVERNANCE_BACKLOG.md](roadmaps/POST_BASELINE_TRIGGER_GOVERNANCE_BACKLOG.md) records PR #10 as the baseline publication PR and keeps post-baseline governance work separate from new solver behavior.

## Candidate Posture

No default-path solver candidate is active.

The open trigger ledger is `none`: do not open a broad M9 candidate by default. A new solver candidate needs a current, reproducible, scoped trigger with baseline-repeat, evaluator-validity, CPU/time-to-best, and artifact-storage preflight.

Parked or diagnostics-only tracks:

- Auto short-budget gaps: watched, but current gaps are seed-specific or disappear by `30s`.
- CP-SAT geometry pressure: evaluator-valid diagnostics exist, but current guarded/NoOverlap2D variants are slower or not population-moving enough for defaults.
- Auto/LNS expansion-corridor policy: safe but population-neutral in focused controls.
- Learned LNS guidance: offline signal exists, but protected/fresh online value remains blocked.
- Service-master shortlist: useful standalone Greedy diagnostics, but Auto/default did not move.
- CP-SAT portfolio, GPU, distributed solving, and external solvers: gated research tracks.

## Artifact Posture

Artifact hygiene is in soft-warning, not hard failure:

- Tracked artifacts: `1501/1600`.
- Soft target: `1500`.
- Hard-cap headroom: `99`.
- Unindexed raw candidates: `0`.

Allowed under soft warning:

- Docs-only changes, PR review notes, backlog edits, focused code/test changes, local quality gates, and trigger-nomination dry runs.

Requires an externalization plan first:

- Broad scorecards, benchmark/replay/ablation runs, promotion matrices, or any candidate/release evidence expected to add large raw JSON/JSONL, labels, traces, or solve logs.

## Allowed Next Work

Proceed:

- Fix local quality-gate failures.
- Improve status/discoverability docs.
- Make scoped review-readiness or governance changes.
- Make behavior-preserving refactor extractions from [DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md](roadmaps/DEEP_REFACTOR_OPPORTUNITY_BACKLOG.md).
- Run focused tests and smoke checks that do not create tracked artifact bundles.

Do not proceed without a trigger:

- Change Auto/default solver policy.
- Promote CP-SAT geometry, service-master, learned guidance, portfolio, GPU, distributed, or external-solver tracks.
- Generate broad evidence just to keep momentum.

## Key Gates

Cheap governance preflight:

```bash
npm run quality:governance
```

PR hygiene gate:

```bash
npm run quality:pr
```

Full local gate without dependency audit:

```bash
npm test
```

Evidence and artifact-contract gate:

```bash
npm run quality:evidence
```

Solver gate:

```bash
npm run quality:solver
```

Before any real solver candidate:

```bash
npm run quality:governance
npm run candidate-trigger:scaffold -- --trigger-id=<trigger-id> --candidate-id=<candidate-id> --source=<current artifact, issue, or product requirement>
npm run candidate-intake:check
```

## Promotion Reminder

Any default-path solver change must include exact validation, candidate-specific evaluator-validity evidence, at least three fixed seeds, relevant `1s/5s/30s/120s` budget reporting, development/protected/fresh scorecards or a reviewed equivalent, population or equal-population time-to-best improvement, bounded regressions, CPU-efficiency review, registered metadata, and a decision closeout.
