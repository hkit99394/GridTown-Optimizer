import { formatSolverProgressSummary } from "../core/index.js";

import type {
  GreedyProfilePhaseSummary,
  GreedyRoadOpportunityCounterfactualTrace,
  GreedyRoadOpportunityTrace
} from "../core/index.js";
import type { GreedyBenchmarkSuiteResult } from "./greedy.js";

function formatProfilePhaseSummary(phase: GreedyProfilePhaseSummary): string {
  return `${phase.name}:${phase.runs}x/${phase.elapsedMs.toFixed(3)}ms/best+${phase.bestPopulationDelta}/candidate+${phase.candidatePopulationDelta}`;
}

function formatPlacementTrace(placement: {
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
}): string {
  const extras = [
    placement.typeIndex === undefined ? null : `type:${placement.typeIndex}`,
    placement.bonus === undefined ? null : `bonus:${placement.bonus}`,
    placement.range === undefined ? null : `range:${placement.range}`
  ].filter((entry): entry is string => entry !== null);
  return `r${placement.r}c${placement.c} ${placement.rows}x${placement.cols} road:${placement.roadCost}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function formatRoadOpportunityTrace(trace: GreedyRoadOpportunityTrace): string {
  const extras = [
    trace.score === undefined ? null : `score:${trace.score}`,
    trace.typeIndex === undefined ? null : `type:${trace.typeIndex}`,
    trace.bonus === undefined ? null : `bonus:${trace.bonus}`,
    trace.range === undefined ? null : `range:${trace.range}`,
    trace.moveKind === undefined ? null : `move:${trace.moveKind}`,
    `counterfactuals:${trace.counterfactuals?.length ?? 0}`
  ].filter((entry): entry is string => entry !== null);
  return `${trace.phase} r${trace.r}c${trace.c} ${trace.rows}x${trace.cols} road:${trace.roadCost} reachable:${trace.reachableBefore}->${trace.reachableAfter} lost:${trace.lostCells} footprint:${trace.footprintCells} disconnected:${trace.disconnectedCells}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function formatRoadOpportunityCounterfactual(counterfactual: GreedyRoadOpportunityCounterfactualTrace): string {
  const extras = [
    counterfactual.typeIndex === undefined ? null : `type:${counterfactual.typeIndex}`,
    counterfactual.bonus === undefined ? null : `bonus:${counterfactual.bonus}`,
    counterfactual.range === undefined ? null : `range:${counterfactual.range}`,
    counterfactual.moveKind === undefined ? null : `move:${counterfactual.moveKind}`,
    counterfactual.tieBreakComparison === undefined ? null : `tie:${counterfactual.tieBreakComparison}`
  ].filter((entry): entry is string => entry !== null);
  return `reason:${counterfactual.reason} rejected:r${counterfactual.r}c${counterfactual.c} ${counterfactual.rows}x${counterfactual.cols} road:${counterfactual.roadCost} score:${counterfactual.score} score-delta:${formatSignedNumber(counterfactual.scoreDelta)} road-delta:${formatSignedNumber(counterfactual.roadCostDelta)} reachable:${counterfactual.reachableBefore}->${counterfactual.reachableAfter} lost:${counterfactual.lostCells} footprint:${counterfactual.footprintCells} disconnected:${counterfactual.disconnectedCells}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function selectRoadOpportunityTraceSamples(
  traces: readonly GreedyRoadOpportunityTrace[],
  limit: number
): GreedyRoadOpportunityTrace[] {
  const localSearchTraces = traces.filter(
    (trace) => trace.phase === "service-neighborhood" || trace.phase === "residential-local-search"
  );
  const constructiveTraces = traces.filter(
    (trace) => trace.phase !== "service-neighborhood" && trace.phase !== "residential-local-search"
  );
  return [...localSearchTraces, ...constructiveTraces].slice(0, limit);
}

export function formatGreedyBenchmarkSuite(result: GreedyBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Greedy Benchmark Suite ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push("");

  for (const benchmark of result.results) {
    const counters = benchmark.greedyProfile?.counters;
    lines.push(`- ${benchmark.name}: ${benchmark.description}`);
    lines.push(
      `  population=${benchmark.totalPopulation} wall=${benchmark.wallClockSeconds.toFixed(3)}s roads=${benchmark.roadCount} services=${benchmark.serviceCount} residentials=${benchmark.residentialCount}`
    );
    lines.push(`  progress=${formatSolverProgressSummary(benchmark.progressSummary)}`);
    if (counters) {
      const roadOpportunityCounterfactualCount =
        benchmark.greedyProfile?.roadOpportunityTraces?.reduce(
          (sum, trace) => sum + (trace.counterfactuals?.length ?? 0),
          0
        ) ?? 0;
      lines.push(
        `  scans=svc:${counters.servicePhase.candidateScans} res:${counters.residentialPhase.candidateScans} local:${counters.localSearch.candidateScans} roads(connect=${counters.roads.canConnectChecks}, ensure=${counters.roads.ensureConnectedCalls}, probes=${counters.roads.probeCalls}, reuse=${counters.roads.probeReuses}, scratch=${counters.roads.scratchProbeCalls})`
      );
      lines.push(
        `  grouped-score=groups:${counters.precompute.residentialScoringGroups} collapsed:${counters.precompute.residentialScoringVariantsCollapsed} coverage:${counters.precompute.serviceCoverageGroups} static-evals:${counters.precompute.serviceStaticScoreGroupEvaluations} phase-lookups:${counters.servicePhase.groupedScoreLookups} discounted:${counters.precompute.serviceStaticAvailabilityDiscountedGroups + counters.servicePhase.availabilityDiscountedGroups}`
      );
      lines.push(
        `  pop-cache=entries:${counters.precompute.residentialPopulationCacheEntries} res-lookups:${counters.residentialPhase.populationCacheLookups} local-lookups:${counters.localSearch.populationCacheLookups}`
      );
      lines.push(
        `  local-service=remove:${counters.localSearch.serviceRemoveChecks} add:${counters.localSearch.serviceAddChecks} swap:${counters.localSearch.serviceSwapChecks} improvements:${counters.localSearch.serviceNeighborhoodImprovements}`
      );
      lines.push(
        `  attempts=caps:${counters.attempts.serviceCaps} restarts:${counters.attempts.restarts} refine:${counters.attempts.serviceRefineTrials} exhaustive:${counters.attempts.exhaustiveTrials} fixed-set:${counters.attempts.fixedServiceRealizationTrials}`
      );
      lines.push(
        `  service-master=candidates:${counters.attempts.serviceMasterCandidatesShortlisted}/${counters.attempts.serviceMasterCandidatesConsidered} layouts:${counters.attempts.serviceMasterLayouts} feasible:${counters.attempts.serviceMasterFeasibleLayouts} improvements:${counters.attempts.serviceMasterImprovingLayouts} no-good:${counters.attempts.serviceMasterNoGoodSkips}`
      );
      lines.push(`  phases=${benchmark.greedyProfile?.phases.map(formatProfilePhaseSummary).join(", ") ?? "n/a"}`);
      lines.push(
        `  cap-search=evaluated:${counters.attempts.serviceCaps} coarse:${counters.attempts.coarseCaps} refine:${counters.attempts.refineCaps} skipped:${counters.attempts.capsSkipped} restart-caps:${counters.attempts.restartCaps}`
      );
      lines.push(
        `  invalidation=svc-invalid:${counters.servicePhase.candidateInvalidations} svc-type:${counters.servicePhase.typeInvalidations} svc-dirty:${counters.servicePhase.scoreDirtyMarks} svc-rescore:${counters.servicePhase.scoreRecomputes} res-invalid:${counters.residentialPhase.candidateInvalidations} res-type:${counters.residentialPhase.typeInvalidations}`
      );
      lines.push(
        `  deferred-roads=frontier:${counters.roads.deferredFrontierRecomputes} rebuild-steps:${counters.roads.deferredReconstructionSteps} rebuild-failures:${counters.roads.deferredReconstructionFailures}`
      );
      lines.push(
        `  connectivity-shadow=checks:${counters.roads.connectivityShadowChecks} lost:${counters.roads.connectivityShadowLostCells} footprint:${counters.roads.connectivityShadowFootprintCells} disconnected:${counters.roads.connectivityShadowDisconnectedCells} max-lost:${counters.roads.connectivityShadowMaxLostCells} max-disconnected:${counters.roads.connectivityShadowMaxDisconnectedCells}`
      );
      lines.push(
        `  connectivity-shadow-scoring=ties:${counters.roads.connectivityShadowScoreTies} wins:${counters.roads.connectivityShadowScoreWins} losses:${counters.roads.connectivityShadowScoreLosses} neutral:${counters.roads.connectivityShadowScoreNeutral} trace:${benchmark.greedyProfile?.connectivityShadowDecisions?.length ?? 0}/${benchmark.greedyProfile?.connectivityShadowDecisionTraceLimit ?? 0}`
      );
      for (const decision of benchmark.greedyProfile?.connectivityShadowDecisions?.slice(0, 5) ?? []) {
        lines.push(
          `  shadow-decision=${decision.phase} score:${decision.score} chosen:[${formatPlacementTrace(decision.chosen)}] rejected:[${formatPlacementTrace(decision.rejected)}] penalties:cand=${decision.candidateShadowPenalty} inc=${decision.incumbentShadowPenalty}`
        );
      }
      lines.push(
        `  road-opportunity=checks:${counters.roads.roadOpportunityChecks} lost:${counters.roads.roadOpportunityLostCells} footprint:${counters.roads.roadOpportunityFootprintCells} disconnected:${counters.roads.roadOpportunityDisconnectedCells} max-lost:${counters.roads.roadOpportunityMaxLostCells} max-disconnected:${counters.roads.roadOpportunityMaxDisconnectedCells} trace:${benchmark.greedyProfile?.roadOpportunityTraces?.length ?? 0}/${benchmark.greedyProfile?.roadOpportunityTraceLimit ?? 0} counterfactuals:${roadOpportunityCounterfactualCount}`
      );
      for (const trace of selectRoadOpportunityTraceSamples(benchmark.greedyProfile?.roadOpportunityTraces ?? [], 5)) {
        lines.push(`  road-opportunity-placement=${formatRoadOpportunityTrace(trace)}`);
        for (const counterfactual of trace.counterfactuals?.slice(0, 3) ?? []) {
          lines.push(`  road-opportunity-counterfactual=${formatRoadOpportunityCounterfactual(counterfactual)}`);
        }
      }
      lines.push(
        `  step13=geometry:${counters.precompute.geometryCacheEntries} occupancy-scratch:${counters.localSearch.occupancyScratchReuses} road-scratch:${counters.roads.scratchProbeCalls}`
      );
      lines.push(
        `  step14=lookahead:${counters.servicePhase.lookaheadEvaluations} res-scans:${counters.servicePhase.lookaheadResidentialScans} wins:${counters.servicePhase.lookaheadWins}`
      );
    } else {
      lines.push("  profile=disabled");
    }
  }

  return lines.join("\n");
}
