import type { Grid, GreedyProfileCounters, ResidentialPlacement, SolverParams } from "../../core/index.js";
import { GreedyAttemptState } from "./attemptState.js";
import type { ConnectivityProbe } from "./attemptState.js";
import {
  canUseConnectivityShadowTieBreak,
  compareConnectivityShadowPenalty,
  computeConnectivityShadowPenalty,
  recordConnectivityShadowTieDecision,
  residentialPlacementTrace
} from "./connectivityShadowScoring.js";
import type { ConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import { recordRoadOpportunityPlacement, roadOpportunityHasTraceCapacity } from "./roadOpportunity.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import {
  collectIndexedCandidatesForCells,
  createActiveCandidatePool,
  invalidateCandidatePoolEntries
} from "./candidatePools.js";
import { compareResidentialTieBreaks, getCandidateTypeIndex, stableResidentialPlacementKey } from "./candidates.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import { compareDensityAwareScore, computePlacementDensityScore } from "./solutionRanking.js";
import { placementLeavesRoadAnchorCellAvailable } from "./roadAnchors.js";
import {
  createRoadOpportunityCandidatePools,
  pushRoadOpportunityCandidate,
  selectRoadOpportunityCounterfactuals
} from "./roadOpportunityCandidates.js";
import type { RoadOpportunityCandidatePoolEntry } from "./roadOpportunityCandidates.js";
import { buildResidentialPopulationCache } from "./serviceScoring.js";
import type { GreedyPrecomputedIndexes, MaybeStop } from "./types.js";

export interface GreedyResidentialConstructionResult {
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  residentialPopulationCacheForLocal: number[];
}

export function constructGreedyResidentialPhase(options: {
  G: Grid;
  params: SolverParams;
  attemptState: GreedyAttemptState;
  roads: Set<string>;
  occupied: Set<string>;
  useDeferredRoadCommitment: boolean;
  anyResidentialCandidates: ResidentialCandidatesList;
  residentialCandidatesForLocal: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  effectZones: Set<string>[];
  serviceBonuses: number[];
  maxResidentials: number | undefined;
  useTypes: boolean;
  remainingAvail: number[] | null;
  densityTieBreaker: boolean;
  densityTieBreakerToleranceRatio: number;
  connectivityShadowScoring: boolean;
  profileCounters?: GreedyProfileCounters;
  recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  maybeStop: MaybeStop;
}): GreedyResidentialConstructionResult {
  const {
    G,
    params,
    attemptState,
    roads,
    occupied,
    useDeferredRoadCommitment,
    anyResidentialCandidates,
    residentialCandidatesForLocal,
    precomputedIndexes,
    effectZones,
    serviceBonuses,
    maxResidentials,
    useTypes,
    remainingAvail,
    densityTieBreaker,
    densityTieBreakerToleranceRatio,
    connectivityShadowScoring,
    profileCounters,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop
  } = options;
  const probeRoadConnection = (
    snapshotOccupied: Set<string>,
    r: number,
    c: number,
    rows: number,
    cols: number
  ): ConnectivityProbe | null => attemptState.probeRoadConnection(snapshotOccupied, { r, c, rows, cols });
  const residentialPopulationCache = buildResidentialPopulationCache(
    params,
    anyResidentialCandidates,
    effectZones,
    serviceBonuses,
    profileCounters
  );
  const residentialPopulationCacheForLocal =
    residentialCandidatesForLocal === anyResidentialCandidates
      ? residentialPopulationCache
      : buildResidentialPopulationCache(
          params,
          residentialCandidatesForLocal,
          effectZones,
          serviceBonuses,
          profileCounters
        );

  const residentials: ResidentialPlacement[] = [];
  const residentialTypeIndices: number[] = [];
  const populations: number[] = [];
  const residentialActivePool = createActiveCandidatePool(anyResidentialCandidates.length);
  if (occupied.size > 0) {
    const invalidated = invalidateCandidatePoolEntries(
      residentialActivePool,
      collectIndexedCandidatesForCells(occupied, precomputedIndexes.residentialCandidatesByOccupiedCell)
    );
    if (profileCounters) profileCounters.residentialPhase.candidateInvalidations += invalidated;
  }
  if (useTypes && remainingAvail && precomputedIndexes.residentialCandidateIndicesByType) {
    for (let typeIndex = 0; typeIndex < remainingAvail.length; typeIndex++) {
      if (remainingAvail[typeIndex] > 0) continue;
      const invalidated = invalidateCandidatePoolEntries(
        residentialActivePool,
        precomputedIndexes.residentialCandidateIndicesByType[typeIndex] ?? []
      );
      if (profileCounters) {
        profileCounters.residentialPhase.candidateInvalidations += invalidated;
        profileCounters.residentialPhase.typeInvalidations += invalidated;
      }
    }
  }
  for (;;) {
    if (maxResidentials !== undefined && residentials.length >= maxResidentials) break;
    let best: ResidentialCandidatesList[0] | null = null;
    let bestCandidateIndex = -1;
    let bestProbe: ConnectivityProbe | null = null;
    let bestPop = -1;
    let bestDensityScore = Number.NEGATIVE_INFINITY;
    let bestConnectivityShadowPenalty: number | null = null;
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "residential");
    const residentialRoadOpportunityPools = createRoadOpportunityCandidatePools<ResidentialCandidatesList[0]>();
    for (const candidateIndex of residentialActivePool.activeIndices) {
      const cand = anyResidentialCandidates[candidateIndex];
      maybeStop?.();
      if (profileCounters) profileCounters.residentialPhase.candidateScans++;
      if (roads.size === 0) {
        if (profileCounters) profileCounters.roads.roadAnchorChecks++;
        if (!placementLeavesRoadAnchorCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      }
      if (profileCounters) profileCounters.residentialPhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, cand.r, cand.c, cand.rows, cand.cols);
      if (!probe) continue;
      if (profileCounters) profileCounters.residentialPhase.populationCacheLookups++;
      const pop = residentialPopulationCache[candidateIndex] ?? -1;
      const densityScore = densityTieBreaker ? computePlacementDensityScore(G, cand, pop) : 0;
      const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
      if (collectRoadOpportunityCounterfactuals && pop >= 0) {
        const roadOpportunityEntry: RoadOpportunityCandidatePoolEntry<ResidentialCandidatesList[0]> = {
          key: stableResidentialPlacementKey(cand),
          candidate: cand,
          candidateIndex,
          placement: cand,
          probe,
          footprintKeys: residentialFootprintKeys,
          score: pop,
          typeIndex: getCandidateTypeIndex(cand)
        };
        pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
      }
      const scoreComparison =
        best === null
          ? 1
          : compareDensityAwareScore(pop, densityScore, bestPop, bestDensityScore, densityTieBreakerToleranceRatio);
      let candidateConnectivityShadowPenalty: number | null = null;
      let connectivityShadowComparison = 0;
      if (
        scoreComparison === 0 &&
        pop >= 0 &&
        connectivityShadowScoring &&
        best !== null &&
        bestProbe !== null &&
        canUseConnectivityShadowTieBreak(probe, bestProbe)
      ) {
        const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
        candidateConnectivityShadowPenalty = computeConnectivityShadowPenalty(
          attemptState,
          cand,
          residentialFootprintKeys
        );
        if (bestConnectivityShadowPenalty === null) {
          const bestFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[bestCandidateIndex];
          bestConnectivityShadowPenalty = computeConnectivityShadowPenalty(attemptState, best, bestFootprintKeys);
        }
        connectivityShadowComparison = compareConnectivityShadowPenalty(
          candidateConnectivityShadowPenalty,
          bestConnectivityShadowPenalty
        );
        recordConnectivityShadowTieDecision({
          record: recordConnectivityShadowDecision,
          profileCounters,
          phase: "residential",
          score: pop,
          candidate: residentialPlacementTrace(cand, probe),
          incumbent: residentialPlacementTrace(best, bestProbe),
          candidateShadowPenalty: candidateConnectivityShadowPenalty,
          incumbentShadowPenalty: bestConnectivityShadowPenalty,
          comparison: connectivityShadowComparison
        });
      }
      if (
        scoreComparison > 0 ||
        connectivityShadowComparison > 0 ||
        (scoreComparison === 0 &&
          connectivityShadowComparison === 0 &&
          pop >= 0 &&
          best !== null &&
          bestProbe !== null &&
          compareResidentialTieBreaks(params, cand, probe, best, bestProbe) < 0)
      ) {
        bestPop = pop;
        bestDensityScore = densityScore;
        bestConnectivityShadowPenalty = connectivityShadowComparison !== 0 ? candidateConnectivityShadowPenalty : null;
        best = cand;
        bestCandidateIndex = candidateIndex;
        bestProbe = probe;
      }
    }
    if (best == null || bestCandidateIndex < 0 || bestPop < 0) break;
    if (!bestProbe) break;
    const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[bestCandidateIndex];
    const newlyOccupiedKeys = attemptState.collectNewlyOccupiedKeys(
      useDeferredRoadCommitment ? null : bestProbe.kind === "explicit" ? bestProbe.roadProbe : null,
      best,
      residentialFootprintKeys
    );
    const bestTypeIndex = getCandidateTypeIndex(best);
    const counterfactuals = collectRoadOpportunityCounterfactuals
      ? selectRoadOpportunityCounterfactuals({
          pools: residentialRoadOpportunityPools,
          chosenKey: stableResidentialPlacementKey(best),
          chosenCandidate: best,
          chosenProbe: bestProbe,
          chosenScore: bestPop,
          compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
            compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe)
        })
      : undefined;
    recordRoadOpportunityPlacement({
      attemptState,
      placement: best,
      probe: bestProbe,
      phase: "residential",
      footprintKeys: residentialFootprintKeys,
      profileCounters,
      record: recordRoadOpportunity,
      score: bestPop,
      counterfactuals,
      typeIndex: bestTypeIndex
    });
    const committedKeys = attemptState.commitPlacement(bestProbe, best, {
      footprintKeys: residentialFootprintKeys,
      newlyOccupiedKeys,
      recordConnectivityShadow: false
    });
    if (!committedKeys) {
      break;
    }
    residentials.push({ r: best.r, c: best.c, rows: best.rows, cols: best.cols });
    residentialTypeIndices.push(bestTypeIndex);
    populations.push(bestPop);
    {
      const invalidated = invalidateCandidatePoolEntries(
        residentialActivePool,
        collectIndexedCandidatesForCells(newlyOccupiedKeys, precomputedIndexes.residentialCandidatesByOccupiedCell)
      );
      if (profileCounters) profileCounters.residentialPhase.candidateInvalidations += invalidated;
    }
    if (useTypes && remainingAvail && bestTypeIndex >= 0) {
      remainingAvail[bestTypeIndex]--;
      if (remainingAvail[bestTypeIndex] <= 0 && precomputedIndexes.residentialCandidateIndicesByType) {
        const invalidated = invalidateCandidatePoolEntries(
          residentialActivePool,
          precomputedIndexes.residentialCandidateIndicesByType[bestTypeIndex] ?? []
        );
        if (profileCounters) {
          profileCounters.residentialPhase.candidateInvalidations += invalidated;
          profileCounters.residentialPhase.typeInvalidations += invalidated;
        }
      }
    }
    if (profileCounters) profileCounters.residentialPhase.placements++;
  }

  return {
    residentials,
    residentialTypeIndices,
    populations,
    residentialPopulationCacheForLocal
  };
}
