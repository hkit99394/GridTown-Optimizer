import { performance } from "node:perf_hooks";

import type {
  GreedyProfileCounters,
  GreedyProfilePhaseName,
  GreedyProfilePhaseSummary,
} from "../core/types.js";

export type GreedyProfilePhaseMetrics = {
  bestPopulationBefore?: number | null;
  bestPopulationAfter?: number | null;
  candidatePopulationBefore?: number | null;
  candidatePopulationAfter?: number | null;
  candidatePopulationDelta?: number;
};

export type GreedyProfilePhaseRecorder = (
  phase: GreedyProfilePhaseName,
  startedAtMs: number,
  metrics?: GreedyProfilePhaseMetrics
) => void;

const GREEDY_PROFILE_PHASE_NAMES: readonly GreedyProfilePhaseName[] = Object.freeze([
  "precompute",
  "constructiveCapSearch",
  "forcedServiceRealization",
  "serviceRefinement",
  "exhaustiveServiceSearch",
  "residentialLocalSearch",
  "serviceNeighborhoodSearch",
]);

export function createGreedyProfileCounters(): GreedyProfileCounters {
  return {
    precompute: {
      serviceCandidates: 0,
      residentialCandidates: 0,
      geometryCacheEntries: 0,
      residentialScoringGroups: 0,
      residentialScoringVariantsCollapsed: 0,
      serviceCoveragePairs: 0,
      serviceCoverageGroups: 0,
      serviceStaticScores: 0,
      serviceStaticScoreGroupEvaluations: 0,
      serviceStaticAvailabilityDiscountedGroups: 0,
      residentialPopulationCacheEntries: 0,
    },
    attempts: {
      serviceCaps: 0,
      coarseCaps: 0,
      refineCaps: 0,
      capsSkipped: 0,
      restarts: 0,
      restartCaps: 0,
      serviceRefineTrials: 0,
      exhaustiveTrials: 0,
      fixedServiceRealizationTrials: 0,
      localSearchIterations: 0,
    },
    servicePhase: {
      candidateScans: 0,
      canConnectChecks: 0,
      lookaheadEvaluations: 0,
      lookaheadResidentialScans: 0,
      lookaheadWins: 0,
      candidateInvalidations: 0,
      typeInvalidations: 0,
      groupedScoreLookups: 0,
      groupedScoreGroupEvaluations: 0,
      availabilityDiscountedGroups: 0,
      scoreDirtyMarks: 0,
      scoreRecomputes: 0,
      placements: 0,
      fixedPlacements: 0,
    },
    residentialPhase: {
      candidateScans: 0,
      canConnectChecks: 0,
      candidateInvalidations: 0,
      typeInvalidations: 0,
      placements: 0,
      populationCacheLookups: 0,
    },
    localSearch: {
      candidateScans: 0,
      canConnectChecks: 0,
      placements: 0,
      occupancyScratchReuses: 0,
      moveChecks: 0,
      addChecks: 0,
      serviceRemoveChecks: 0,
      serviceAddChecks: 0,
      serviceSwapChecks: 0,
      serviceNeighborhoodImprovements: 0,
      populationCacheLookups: 0,
    },
    roads: {
      canConnectChecks: 0,
      ensureConnectedCalls: 0,
      probeCalls: 0,
      probeReuses: 0,
      scratchProbeCalls: 0,
      roadAnchorChecks: 0,
      fallbackRoads: 0,
      deferredFrontierRecomputes: 0,
      deferredReconstructionSteps: 0,
      deferredReconstructionFailures: 0,
      connectivityShadowChecks: 0,
      connectivityShadowLostCells: 0,
      connectivityShadowFootprintCells: 0,
      connectivityShadowDisconnectedCells: 0,
      connectivityShadowMaxLostCells: 0,
      connectivityShadowMaxDisconnectedCells: 0,
      connectivityShadowScoreTies: 0,
      connectivityShadowScoreWins: 0,
      connectivityShadowScoreLosses: 0,
      connectivityShadowScoreNeutral: 0,
      roadOpportunityChecks: 0,
      roadOpportunityLostCells: 0,
      roadOpportunityFootprintCells: 0,
      roadOpportunityDisconnectedCells: 0,
      roadOpportunityMaxLostCells: 0,
      roadOpportunityMaxDisconnectedCells: 0,
    },
  };
}

export function createGreedyProfilePhaseSummaries(): GreedyProfilePhaseSummary[] {
  return GREEDY_PROFILE_PHASE_NAMES.map((name) => ({
    name,
    runs: 0,
    elapsedMs: 0,
    bestPopulationBefore: null,
    bestPopulationAfter: null,
    bestPopulationDelta: 0,
    candidatePopulationDelta: 0,
    improvements: 0,
  }));
}

export function createGreedyProfilePhaseRecorder(
  phases: GreedyProfilePhaseSummary[] | undefined
): GreedyProfilePhaseRecorder | undefined {
  if (!phases) return undefined;
  const phasesByName = new Map(phases.map((phase) => [phase.name, phase]));
  return (phaseName, startedAtMs, metrics = {}) => {
    const phase = phasesByName.get(phaseName);
    if (!phase) return;

    phase.runs += 1;
    phase.elapsedMs += Math.max(0, performance.now() - startedAtMs);

    const bestBefore = metrics.bestPopulationBefore ?? null;
    const bestAfter = metrics.bestPopulationAfter ?? null;
    if (bestBefore !== null && phase.bestPopulationBefore === null) {
      phase.bestPopulationBefore = bestBefore;
    }
    if (bestAfter !== null) {
      phase.bestPopulationAfter = bestAfter;
    }

    const bestDelta = bestAfter !== null
      ? Math.max(0, bestAfter - (bestBefore ?? 0))
      : 0;
    const candidateDelta = metrics.candidatePopulationDelta ?? (
      metrics.candidatePopulationBefore !== undefined
      && metrics.candidatePopulationBefore !== null
      && metrics.candidatePopulationAfter !== undefined
      && metrics.candidatePopulationAfter !== null
        ? Math.max(0, metrics.candidatePopulationAfter - metrics.candidatePopulationBefore)
        : 0
    );

    phase.bestPopulationDelta += bestDelta;
    phase.candidatePopulationDelta += Math.max(0, candidateDelta);
    if (bestDelta > 0 || candidateDelta > 0) {
      phase.improvements += 1;
    }
  };
}

export function startGreedyProfilePhase(recordProfilePhase?: GreedyProfilePhaseRecorder): number {
  return recordProfilePhase ? performance.now() : 0;
}

export function runGreedyProfilePhase<T>(options: {
  phase: GreedyProfilePhaseName;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
  getBestPopulation: () => number | null;
  run: () => T;
}): T {
  const { phase, recordProfilePhase, getBestPopulation, run } = options;
  if (!recordProfilePhase) return run();

  const phaseStartedAtMs = performance.now();
  const bestPopulationBefore = getBestPopulation();
  try {
    return run();
  } finally {
    recordProfilePhase(phase, phaseStartedAtMs, {
      bestPopulationBefore,
      bestPopulationAfter: getBestPopulation(),
    });
  }
}
