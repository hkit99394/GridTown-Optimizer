import type {
  Grid,
  GreedyProfileCounters,
  ResidentialCandidate,
  ResidentialPlacement,
  ServicePlacement,
  SolverParams
} from "../../core/index.js";
import { createRoadProbeScratch, NO_TYPE_INDEX, overlaps, roadAnchorsFromParams } from "../../core/index.js";
import { commitExplicitRoadConnectedPlacement, probeExplicitRoadConnection } from "./attemptState.js";
import type { RoadConnectionProbe } from "./attemptState.js";
import {
  recordRoadOpportunityPlacementFromOccupiedBuildings,
  roadOpportunityHasTraceCapacity
} from "./roadOpportunity.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import { compareResidentialTieBreaks, getCandidateTypeIndex, stableResidentialPlacementKey } from "./candidates.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import { placementLeavesRoadAnchorCellAvailable } from "./roadAnchors.js";
import {
  buildLocalSearchBuildingOccupancy,
  createOccupancyScratch,
  deletePlacementCellsFromOccupancyScratch,
  deletePlacementCellsFromSet,
  resetOccupancyScratch,
  toExplicitConnectivityProbe
} from "./placementUtils.js";
import {
  createRoadOpportunityCandidatePools,
  pushRoadOpportunityCandidate,
  selectRoadOpportunityCounterfactuals
} from "./roadOpportunityCandidates.js";
import type { RoadOpportunityCandidatePoolEntry } from "./roadOpportunityCandidates.js";
import { startGreedyProfilePhase } from "./profile.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import type { ResidentialAddChoice, ResidentialLocalSearchState, ResidentialMoveChoice } from "./types.js";

export function runResidentialLocalSearchPhase(options: {
  enabled: boolean;
  G: Grid;
  roads: Set<string>;
  occupied: Set<string>;
  services: ServicePlacement[];
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  totalPopulation: number;
  residentialCandidatesForLocal: ResidentialCandidatesList;
  residentialPopulationCacheForLocal: number[];
  params: SolverParams;
  remainingAvail: number[] | null;
  maxResidentials: number | undefined;
  profileCounters?: GreedyProfileCounters;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  maybeStop?: () => void;
  explicitRoadProbeScratch?: ReturnType<typeof createRoadProbeScratch>;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
}): number {
  const {
    enabled,
    G,
    roads,
    occupied,
    services,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation,
    residentialCandidatesForLocal,
    residentialPopulationCacheForLocal,
    params,
    remainingAvail,
    maxResidentials,
    profileCounters,
    recordRoadOpportunity,
    maybeStop,
    explicitRoadProbeScratch,
    recordProfilePhase
  } = options;
  if (!enabled) return totalPopulation;

  const phaseStartedAtMs = startGreedyProfilePhase(recordProfilePhase);
  const populationBeforeLocalSearch = totalPopulation;
  let phaseTotalPopulation = totalPopulation;
  try {
    phaseTotalPopulation = localSearchImprove({
      grid: G,
      roads,
      occupied,
      services,
      residentials,
      residentialTypeIndices,
      populations,
      totalPopulation,
      residentialCandidates: residentialCandidatesForLocal,
      residentialPopulationCache: residentialPopulationCacheForLocal,
      params,
      remainingAvail,
      maxResidentials,
      profileCounters,
      recordRoadOpportunity,
      maybeStop,
      explicitRoadProbeScratch
    });
    return phaseTotalPopulation;
  } finally {
    if (recordProfilePhase) {
      recordProfilePhase("residentialLocalSearch", phaseStartedAtMs, {
        candidatePopulationBefore: populationBeforeLocalSearch,
        candidatePopulationAfter: phaseTotalPopulation
      });
    }
  }
}

class ResidentialLayoutState {
  private currentTotalPopulation: number;

  constructor(private readonly state: ResidentialLocalSearchState) {
    this.currentTotalPopulation = state.totalPopulation;
  }

  get totalPopulation(): number {
    return this.currentTotalPopulation;
  }

  applyAdd(choice: ResidentialAddChoice, probe: RoadConnectionProbe): void {
    const { roads, occupied, residentials, residentialTypeIndices, populations, remainingAvail, profileCounters } =
      this.state;
    const { candidate, candidateTypeIndex, addPop } = choice;
    this.currentTotalPopulation += addPop;
    commitExplicitRoadConnectedPlacement({
      roads,
      occupied,
      probe,
      placement: candidate,
      profileCounters
    });
    residentials.push({ r: candidate.r, c: candidate.c, rows: candidate.rows, cols: candidate.cols });
    residentialTypeIndices.push(candidateTypeIndex);
    populations.push(addPop);
    if (remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
    if (profileCounters) profileCounters.localSearch.placements++;
  }

  applyMove(choice: ResidentialMoveChoice, probe: RoadConnectionProbe): void {
    const { roads, occupied, residentials, residentialTypeIndices, populations, remainingAvail, profileCounters } =
      this.state;
    const currentResidential = residentials[choice.residentialIndex];
    deletePlacementCellsFromSet(occupied, currentResidential);
    if (remainingAvail && choice.currentTypeIndex >= 0) remainingAvail[choice.currentTypeIndex]++;
    commitExplicitRoadConnectedPlacement({
      roads,
      occupied,
      probe,
      placement: choice.candidate,
      profileCounters
    });
    if (remainingAvail && choice.candidateTypeIndex >= 0) remainingAvail[choice.candidateTypeIndex]--;
    residentials[choice.residentialIndex] = {
      r: choice.candidate.r,
      c: choice.candidate.c,
      rows: choice.candidate.rows,
      cols: choice.candidate.cols
    };
    residentialTypeIndices[choice.residentialIndex] = choice.candidateTypeIndex;
    populations[choice.residentialIndex] = choice.newPop;
    this.currentTotalPopulation = this.currentTotalPopulation - choice.currentPop + choice.newPop;
    if (profileCounters) profileCounters.localSearch.placements++;
  }
}

function localSearchImprove(state: ResidentialLocalSearchState): number {
  const {
    grid: G,
    roads,
    occupied,
    services,
    residentials,
    residentialTypeIndices,
    populations,
    residentialCandidates,
    residentialPopulationCache,
    params,
    remainingAvail,
    maxResidentials,
    profileCounters,
    recordRoadOpportunity,
    maybeStop
  } = state;
  const layoutState = new ResidentialLayoutState(state);
  const explicitRoadProbeScratch = state.explicitRoadProbeScratch ?? createRoadProbeScratch(G);
  const roadAnchors = roadAnchorsFromParams(params);
  const useTypes =
    remainingAvail !== null && residentialCandidates.length > 0 && "typeIndex" in residentialCandidates[0];
  const maxIter = 20;

  const probeRoadConnection = (
    snapshotOccupied: Set<string>,
    r: number,
    c: number,
    rows: number,
    cols: number
  ): RoadConnectionProbe | null =>
    probeExplicitRoadConnection(
      G,
      roads,
      snapshotOccupied,
      { r, c, rows, cols },
      explicitRoadProbeScratch,
      profileCounters,
      roadAnchors
    );

  for (let iter = 0; iter < maxIter; iter++) {
    maybeStop?.();
    if (profileCounters) profileCounters.attempts.localSearchIterations++;
    const moveOccupancyScratch = residentials.length > 0 ? createOccupancyScratch(occupied) : null;
    let bestMove: ResidentialMoveChoice | null = null;
    let bestMoveDelta = 0;
    let bestMoveProbe: RoadConnectionProbe | null = null;
    let bestAdd: ResidentialAddChoice | null = null;
    let bestAddDelta = 0;
    let bestAddProbe: RoadConnectionProbe | null = null;
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(
      recordRoadOpportunity,
      "residential-local-search"
    );
    const residentialRoadOpportunityPools = createRoadOpportunityCandidatePools<
      ResidentialPlacement | ResidentialCandidate
    >();

    for (let i = 0; i < residentials.length; i++) {
      maybeStop?.();
      const res = residentials[i];
      const currentPop = populations[i];
      const resType = residentialTypeIndices[i] ?? NO_TYPE_INDEX;
      if (!moveOccupancyScratch) continue;
      resetOccupancyScratch(moveOccupancyScratch);
      deletePlacementCellsFromOccupancyScratch(moveOccupancyScratch, res);
      const othersOccupied = moveOccupancyScratch.cells;
      if (profileCounters) profileCounters.localSearch.occupancyScratchReuses++;
      for (let candidateIndex = 0; candidateIndex < residentialCandidates.length; candidateIndex++) {
        const cand = residentialCandidates[candidateIndex];
        maybeStop?.();
        if (profileCounters) profileCounters.localSearch.candidateScans++;
        const candidateTypeIndex = getCandidateTypeIndex(cand);
        const samePlacement = cand.r === res.r && cand.c === res.c && cand.rows === res.rows && cand.cols === res.cols;
        if (samePlacement && candidateTypeIndex === resType) continue;
        if (useTypes && remainingAvail) {
          if (candidateTypeIndex !== resType && remainingAvail[candidateTypeIndex] <= 0) continue;
        }
        if (roads.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (
            !placementLeavesRoadAnchorCellAvailable(
              G,
              othersOccupied,
              cand.r,
              cand.c,
              cand.rows,
              cand.cols,
              roadAnchors
            )
          )
            continue;
        }
        if (overlaps(othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (profileCounters) profileCounters.localSearch.moveChecks++;
        if (profileCounters) profileCounters.localSearch.canConnectChecks++;
        const probe = probeRoadConnection(othersOccupied, cand.r, cand.c, cand.rows, cand.cols);
        if (!probe) continue;
        if (profileCounters) profileCounters.localSearch.populationCacheLookups++;
        const newPop = residentialPopulationCache[candidateIndex] ?? -1;
        const delta = newPop - currentPop;
        const traceProbe = toExplicitConnectivityProbe(probe);
        const traceKey = `move:${i}:${candidateIndex}:${stableResidentialPlacementKey(cand)}:${candidateTypeIndex}`;
        const traceOccupiedBuildings =
          delta > 0 && (profileCounters || recordRoadOpportunity)
            ? buildLocalSearchBuildingOccupancy(services, residentials, i)
            : undefined;
        if (collectRoadOpportunityCounterfactuals && delta > 0 && traceOccupiedBuildings) {
          const roadOpportunityEntry: RoadOpportunityCandidatePoolEntry<ResidentialPlacement | ResidentialCandidate> = {
            key: traceKey,
            candidate: cand,
            candidateIndex,
            placement: cand,
            probe: traceProbe,
            occupiedBuildings: new Set(traceOccupiedBuildings),
            score: delta,
            typeIndex: candidateTypeIndex,
            moveKind: "residential-move"
          };
          pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
        }
        if (
          delta > bestMoveDelta ||
          (delta === bestMoveDelta &&
            delta > 0 &&
            bestMove !== null &&
            bestMoveProbe !== null &&
            compareResidentialTieBreaks(params, cand, probe, bestMove.candidate, bestMoveProbe) < 0)
        ) {
          bestMove = {
            kind: "move",
            residentialIndex: i,
            candidate: cand,
            candidateTypeIndex,
            currentTypeIndex: resType,
            currentPop,
            newPop,
            key: traceKey,
            probe: traceProbe,
            occupiedBuildings: traceOccupiedBuildings ?? buildLocalSearchBuildingOccupancy(services, residentials, i)
          };
          bestMoveDelta = delta;
          bestMoveProbe = probe;
        }
      }
    }

    if (maxResidentials === undefined || residentials.length < maxResidentials) {
      for (let candidateIndex = 0; candidateIndex < residentialCandidates.length; candidateIndex++) {
        const cand = residentialCandidates[candidateIndex];
        maybeStop?.();
        if (profileCounters) profileCounters.localSearch.candidateScans++;
        const candidateTypeIndex = getCandidateTypeIndex(cand);
        if (useTypes && remainingAvail) {
          if (remainingAvail[candidateTypeIndex] <= 0) continue;
        }
        if (roads.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (!placementLeavesRoadAnchorCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols, roadAnchors)) {
            continue;
          }
        }
        if (overlaps(occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (profileCounters) profileCounters.localSearch.addChecks++;
        if (profileCounters) profileCounters.localSearch.canConnectChecks++;
        const probe = probeRoadConnection(occupied, cand.r, cand.c, cand.rows, cand.cols);
        if (!probe) continue;
        if (profileCounters) profileCounters.localSearch.populationCacheLookups++;
        const addPop = residentialPopulationCache[candidateIndex] ?? -1;
        const traceProbe = toExplicitConnectivityProbe(probe);
        const traceKey = `add:${candidateIndex}:${stableResidentialPlacementKey(cand)}:${candidateTypeIndex}`;
        const traceOccupiedBuildings =
          addPop > 0 && (profileCounters || recordRoadOpportunity)
            ? buildLocalSearchBuildingOccupancy(services, residentials)
            : undefined;
        if (collectRoadOpportunityCounterfactuals && addPop > 0 && traceOccupiedBuildings) {
          const roadOpportunityEntry: RoadOpportunityCandidatePoolEntry<ResidentialPlacement | ResidentialCandidate> = {
            key: traceKey,
            candidate: cand,
            candidateIndex,
            placement: cand,
            probe: traceProbe,
            occupiedBuildings: new Set(traceOccupiedBuildings),
            score: addPop,
            typeIndex: candidateTypeIndex,
            moveKind: "residential-add"
          };
          pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
        }
        if (
          addPop > bestAddDelta ||
          (addPop === bestAddDelta &&
            addPop > 0 &&
            bestAdd !== null &&
            bestAddProbe !== null &&
            compareResidentialTieBreaks(params, cand, probe, bestAdd.candidate, bestAddProbe) < 0)
        ) {
          bestAdd = {
            kind: "add",
            candidate: cand,
            candidateTypeIndex,
            addPop,
            key: traceKey,
            probe: traceProbe,
            occupiedBuildings: traceOccupiedBuildings ?? buildLocalSearchBuildingOccupancy(services, residentials)
          };
          bestAddDelta = addPop;
          bestAddProbe = probe;
        }
      }
    }

    if (bestMoveDelta <= 0 && bestAddDelta <= 0) break;

    if (bestAddDelta > bestMoveDelta && bestAdd) {
      const { candidate, candidateTypeIndex } = bestAdd;
      if (!bestAddProbe) break;
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: residentialRoadOpportunityPools,
            chosenKey: bestAdd.key,
            chosenCandidate: bestAdd.candidate,
            chosenProbe: bestAdd.probe,
            chosenScore: bestAddDelta,
            compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
              compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe)
          })
        : undefined;
      recordRoadOpportunityPlacementFromOccupiedBuildings({
        grid: G,
        occupiedBuildings: bestAdd.occupiedBuildings,
        placement: candidate,
        probe: bestAdd.probe,
        phase: "residential-local-search",
        profileCounters,
        record: recordRoadOpportunity,
        score: bestAddDelta,
        counterfactuals,
        typeIndex: candidateTypeIndex,
        moveKind: "residential-add"
      });
      layoutState.applyAdd(bestAdd, bestAddProbe);
      continue;
    }

    if (bestMove) {
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: residentialRoadOpportunityPools,
            chosenKey: bestMove.key,
            chosenCandidate: bestMove.candidate,
            chosenProbe: bestMove.probe,
            chosenScore: bestMoveDelta,
            compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
              compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe)
          })
        : undefined;
      recordRoadOpportunityPlacementFromOccupiedBuildings({
        grid: G,
        occupiedBuildings: bestMove.occupiedBuildings,
        placement: bestMove.candidate,
        probe: bestMove.probe,
        phase: "residential-local-search",
        profileCounters,
        record: recordRoadOpportunity,
        score: bestMoveDelta,
        counterfactuals,
        typeIndex: bestMove.candidateTypeIndex,
        moveKind: "residential-move"
      });
      if (!bestMoveProbe) break;
      layoutState.applyMove(bestMove, bestMoveProbe);
      continue;
    }
  }
  return layoutState.totalPopulation;
}
