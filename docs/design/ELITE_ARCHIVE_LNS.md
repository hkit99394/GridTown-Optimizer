# Elite-Archive LNS

## Purpose

Elite-archive LNS is an opt-in search strategy for cases where a single Greedy incumbent makes LNS too dependent on the first layout it sees.

The default LNS path is still:

1. Build one Greedy or seed-hint incumbent.
2. Pick adaptive repair windows around that incumbent.
3. Repair each window with CP-SAT or bounded small-window DP.
4. Keep only improvements to the incumbent.

The elite-archive path keeps the same repair machinery, but starts from a small set of distinct incumbents and may repair from a non-best archive member when the best incumbent is stalled.

## Status

This is not a new top-level optimizer mode and not a default `auto` policy.

It is exposed as an opt-in LNS strategy:

```ts
lns: {
  searchStrategy: "elite-archive",
  eliteArchiveSize: 4,
  multiStartSeeds: 4
}
```

Use it for focused experiments and diagnostics before considering any default-path promotion.

## Web Trigger

From the local planner web UI:

1. Start the planner with `npm run web`.
2. Open the shown local URL.
3. Enable **Advanced mode** in the solver panel.
4. Keep **Auto** selected to test Auto's LNS stage, or choose **LNS** for standalone LNS.
5. In the tuning panel, set **LNS search strategy** or **Search strategy** to **Elite archive**.
6. Tune **Archive size** and **Multistart seeds** if needed, then run the solver.

For high-quality interactive use, run Greedy first and keep **Use displayed output as default seed** enabled before starting LNS with **Elite archive**. The displayed Greedy result is sent as `lns.seedHint`, so Elite Archive starts from that strong incumbent and spends its time on repair. Starting standalone Elite Archive without a seed hint and without `lns.seedTimeLimitSeconds` preserves the same full Greedy bootstrap quality path, but it can spend a long time before the first feasible progress update.

The payload preview should include this when the strategy is active:

```json
{
  "params": {
    "optimizer": "auto",
    "lns": {
      "searchStrategy": "elite-archive",
      "eliteArchiveSize": 4,
      "multiStartSeeds": 4
    }
  }
}
```

For standalone LNS, the same `lns` fields are included alongside the normal LNS iteration, neighborhood, and repair-limit options.

## Algorithm

### 1. Seed Archive

When `searchStrategy` is `"elite-archive"`, LNS creates an archive before repair begins.

- If a `seedHint` is present, the hinted layout is added first.
- If no `lns.seedTimeLimitSeconds` or LNS wall-clock budget is supplied, LNS preserves the existing quality path by running one full standalone Greedy seed with the caller's Greedy options.
- API callers that explicitly set `lns.seedTimeLimitSeconds` and do not provide a seed hint run deterministic bounded Greedy starts using derived seeds and the same capped fast Greedy profile used by Auto's seed stage.
- `multiStartSeeds` controls how many bounded Greedy starts are attempted when a seed budget is set.
- `eliteArchiveSize` caps how many distinct layouts are retained.

The seed construction budget is still `lns.seedTimeLimitSeconds`. In elite-archive mode, that budget is divided across the bounded Greedy starts. Omitting the seed budget is a quality-first choice, not an interactive startup guarantee.

If all bounded Greedy seed slices expire before producing a feasible incumbent, LNS builds a minimal valid road/residential emergency seed so the run can continue into repair instead of failing before the first neighborhood.

### 2. Archive Ranking

Archive entries are ranked by:

1. Higher `totalPopulation`.
2. Fewer roads when population ties.
3. More placed services when roads tie.
4. More placed residentials when services tie.
5. Stable layout signature as the final tie-breaker.

The layout signature includes roads, service placements, service types/bonuses, residential placements, residential types, and residential populations. This lets equal-population but structurally different layouts coexist in the archive.

### 3. Repair Selection

When the solve is not stalled, LNS repairs from the best archive entry. When it is stalled and the archive has alternatives, it cycles through non-best archive entries.

The selected repair source is used for:

- adaptive neighborhood generation,
- optional learned window ranking,
- CP-SAT warm start hints,
- small-window DP repair.

### 4. Acceptance

Repairs are accepted into the archive when they improve the repair source.

The public incumbent is updated only when the repaired layout beats the best solution found so far. This means exploratory repairs can broaden the archive without making snapshots or final results worse.

Each CP-SAT repair call also passes an internal backend timeout equal to the repair solve budget plus a short grace window. That keeps large repair windows from blocking the web worker indefinitely when Python model construction or backend shutdown takes longer than OR-Tools' own solve limit. If a repair times out at the backend boundary, later repairs keep the same operator selection but shrink the actual repair window around the selected center. Once those degraded windows are small enough, LNS tries the in-process small-window DP repair path before paying Python CP-SAT startup/model cost again; after repeated backend timeouts it suppresses additional CP-SAT launches for the remaining stale attempts.

### 5. Final Result

The returned solution is always the best valid layout found by the run. Elite-archive mode does not expose a lower-quality exploratory state as the final answer.

## Telemetry

Elite-archive runs add these fields to `lnsTelemetry`:

| Field                   | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `searchStrategy`        | `"incumbent"` or `"elite-archive"`                               |
| `eliteArchiveSize`      | Configured archive cap                                           |
| `eliteArchiveFinalSize` | Number of distinct layouts retained at finish                    |
| `multiStartSeeds`       | Configured Greedy multistart count                               |
| `archiveSeedCount`      | Number of initial archive seed attempts that produced a solution |
| `archiveBestPopulation` | Best population in the final archive                             |

Existing outcome telemetry is unchanged. A repair can be recorded as improved when it improves its selected archive source, even if it does not beat the global best incumbent.

## Guardrails

- Default behavior is unchanged unless `lns.searchStrategy` is set to `"elite-archive"`.
- `auto` can pass a seed hint into LNS and still use elite-archive multistart; the hint becomes one archive entry.
- Final snapshots and returned solutions are best-only.
- Invalid strategy names, archive sizes, and multistart sizes are rejected by solver input validation.
- Standalone elite-archive seeding is unbounded when the request omits `seedTimeLimitSeconds` and `lns.wallClockLimitSeconds`; this preserves Greedy-quality baselines but can spend a long time before the first feasible progress snapshot.
- If bounded seed attempts produce no incumbent, the emergency seed is valid but intentionally low quality; treat it as a repair bootstrap, not a quality result.
- This strategy increases Greedy seed work, so compare it with equal wall-clock budgets before making quality claims.

## Evaluation

Use focused evidence before any promotion claim:

1. Same-slice baseline repeat on the target cases.
2. `auto`, `greedy`, `lns`, and `cp-sat` comparison where relevant.
3. Budgets `1s`, `5s`, `30s`, and `120s` for default-path claims.
4. Seeds `7`, `19`, and `37` or a reviewed equivalent.
5. Evaluator-valid final layouts.
6. CPU/time-to-best review.
7. Decision closeout if changing defaults.

Useful first diagnostics:

- Does `auto` beat Greedy more often?
- Does LNS reduce neutral repair rate?
- Does archive diversity improve short-budget misses?
- Does seed construction cost erase repair gains?
- Does performance hold on protected and fresh cases?

## Current Implementation

Primary code:

- `src/packages/solvers/lns/solver.ts`
- `src/packages/core/types/lnsTypes.ts`
- `src/packages/core/solverInputValidationLns.ts`

Focused tests:

- `tests/optimizers/optimizerLnsAssertions.cjs`
