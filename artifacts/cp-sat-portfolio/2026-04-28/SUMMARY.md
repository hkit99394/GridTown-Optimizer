# CP-SAT Portfolio Measurement Gate

Date: 2026-04-28

This closes the CPU parallelism and portfolio roadmap item as a measurement/safety gate. No solver default was changed.

## Evidence

- Scorecard: `tiny-portfolio-scorecard.txt`
- JSON: `tiny-portfolio-scorecard.json`
- Command: `node dist/crossModeBenchmarkCli.js --modes=cp-sat,cp-sat-portfolio --budgets=5 --seeds=7 typed-housing-single`

## Result

- Single CP-SAT and CP-SAT portfolio tied at population `110`.
- Portfolio used a larger configured worker CPU budget.
- The scorecard recommendation remained `single-cp-sat`.

## Decision

Keep portfolio explicit-only. Reconsider CPU portfolio or replay parallelism only when paired scorecards show population improvement per wall-clock without worse CPU-budget efficiency.
