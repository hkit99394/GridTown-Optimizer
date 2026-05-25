# Next-Stage Review Health Check

Date: 2026-04-28

This artifact records the fresh local checks used by the consolidated [SOLVER_ROADMAP.md](../../../docs/roadmaps/SOLVER_ROADMAP.md).

## Repository

- Branch: `features/reusable-input-validation`
- Commit at review time: `20b481d9d77fd49c504faf3c64bb1847badd2fa8`

## Commands

```bash
npm test
node dist/crossModeBenchmarkCli.js --modes=auto,greedy,lns,cp-sat --budgets=5 --seeds=7
```

## Test Result

`npm test` passed:

- TypeScript build passed.
- Review finding regression tests passed.
- Web server route tests passed.
- Optimizer backend tests passed.

## Scorecard Result

The 5s, seed-7, default four-case scorecard kept the current `auto` posture.

| Case                            | Best Population | Winning Modes             | Greedy | LNS | CP-SAT | Auto | Note                                   |
| ------------------------------- | --------------: | ------------------------- | -----: | --: | -----: | ---: | -------------------------------------- |
| `typed-housing-single`          |             110 | Auto, Greedy, LNS, CP-SAT |    110 | 110 |    110 |  110 | Saturated tiny case.                   |
| `compact-service-single`        |              40 | Auto, Greedy, LNS, CP-SAT |     40 |  40 |     40 |   40 | Saturated small case.                  |
| `compact-service-repair`        |             570 | Auto, Greedy, LNS, CP-SAT |    570 | 570 |    570 |  570 | Saturated small repair case.           |
| `row0-corridor-repair-pressure` |             275 | Auto, LNS, CP-SAT         |    260 | 275 |    275 |  275 | LNS/CP-SAT repair beats Greedy by +15. |

## Decision

No solver default change is justified by this health check. It supports keeping Auto as the default quality path while using corridor/anchor pressure cases for future label and replay work.
