import type { Grid, GreedyProfileCounters, ServiceCandidate, SolverParams } from "../../core/index.js";
import { applyRoadConnectionProbe, createRoadProbeScratch, overlaps, roadAnchorsFromParams } from "../../core/index.js";
import { collectNewlyOccupiedKeysForPlacement, probeExplicitRoadConnection } from "./attemptState.js";
import type { ConnectivityProbe, RoadConnectionProbe } from "./attemptState.js";
import {
  compareResidentialTieBreaks,
  compareServiceTieBreaks,
  getCandidateTypeIndex,
  materializeServicePlacement
} from "./candidates.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import { overlapsCachedFootprint } from "./placementUtils.js";
import { placementLeavesRoadAnchorCellAvailable } from "./roadAnchors.js";
import {
  computeResidentialPopulation,
  getCachedServiceEffectZoneSet,
  getCachedServiceFootprintKeys
} from "./serviceScoring.js";
import type { GreedyPrecomputedIndexes, MaybeStop } from "./types.js";

const SERVICE_LOOKAHEAD = {
  residentialDepth: 2
};

export type ServiceLookaheadCandidate = {
  service: ServiceCandidate;
  candidateIndex: number;
  score: number;
  probe: ConnectivityProbe;
};

export type ServiceLookaheadEvaluation = {
  totalScore: number;
  refillScore: number;
};

export type ServiceLookaheadEvaluator = (entry: ServiceLookaheadCandidate) => ServiceLookaheadEvaluation;

export interface ServiceLookaheadEvaluatorState {
  grid: Grid;
  params: SolverParams;
  roads: Set<string>;
  occupied: Set<string>;
  roadAnchors: ReturnType<typeof roadAnchorsFromParams>;
  effectZones: Set<string>[];
  serviceBonuses: number[];
  maxResidentials: number | undefined;
  useTypes: boolean;
  remainingAvail: number[] | null;
  anyResidentialCandidates: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  profileCounters?: GreedyProfileCounters;
  maybeStop?: MaybeStop;
}

function compareServiceLookaheadCandidates(left: ServiceLookaheadCandidate, right: ServiceLookaheadCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  return compareServiceTieBreaks(left.service, left.probe, right.service, right.probe);
}

export function pushBoundedServiceLookaheadCandidate(
  shortlist: ServiceLookaheadCandidate[],
  limit: number,
  entry: ServiceLookaheadCandidate
): void {
  if (limit <= 0 || entry.score <= 0) return;
  shortlist.push(entry);
  shortlist.sort(compareServiceLookaheadCandidates);
  if (shortlist.length > limit) shortlist.length = limit;
}

export function compareServiceLookaheadEvaluations(
  leftEntry: ServiceLookaheadCandidate,
  left: ServiceLookaheadEvaluation,
  rightEntry: ServiceLookaheadCandidate,
  right: ServiceLookaheadEvaluation
): number {
  if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
  if (left.refillScore !== right.refillScore) return right.refillScore - left.refillScore;
  if (leftEntry.score !== rightEntry.score) return rightEntry.score - leftEntry.score;
  return compareServiceTieBreaks(leftEntry.service, leftEntry.probe, rightEntry.service, rightEntry.probe);
}

export function createServiceLookaheadEvaluator(state: ServiceLookaheadEvaluatorState): ServiceLookaheadEvaluator {
  const lookaheadRoadProbeScratch = createRoadProbeScratch(state.grid);
  const roadAnchors = state.roadAnchors;
  return (entry) => {
    const {
      grid: G,
      params,
      roads,
      occupied,
      effectZones,
      serviceBonuses,
      maxResidentials,
      useTypes,
      remainingAvail,
      anyResidentialCandidates,
      precomputedIndexes,
      profileCounters,
      maybeStop
    } = state;
    if (entry.probe.kind !== "explicit") {
      return {
        totalScore: entry.score,
        refillScore: 0
      };
    }
    if (profileCounters) profileCounters.servicePhase.lookaheadEvaluations++;

    const roadsScratch = new Set(roads);
    const occupiedScratch = new Set(occupied);
    const placement = materializeServicePlacement(entry.service);
    const footprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, entry.service);
    const newlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
      occupiedScratch,
      entry.probe.roadProbe,
      placement,
      footprintKeys
    );
    applyRoadConnectionProbe(roadsScratch, entry.probe.roadProbe);
    for (const key of newlyOccupiedKeys) occupiedScratch.add(key);

    const futureEffectZones = [...effectZones, getCachedServiceEffectZoneSet(G, precomputedIndexes, entry.service)];
    const futureBonuses = [...serviceBonuses, entry.service.bonus];
    const remainingResidentialAvail = useTypes && remainingAvail ? [...remainingAvail] : null;
    const lookaheadDepth = Math.min(
      SERVICE_LOOKAHEAD.residentialDepth,
      maxResidentials ?? SERVICE_LOOKAHEAD.residentialDepth
    );

    let refillScore = 0;
    for (let depth = 0; depth < lookaheadDepth; depth++) {
      maybeStop?.();
      let bestResidential: ResidentialCandidatesList[0] | null = null;
      let bestResidentialIndex = -1;
      let bestResidentialProbe: RoadConnectionProbe | null = null;
      let bestResidentialPop = -1;

      for (let candidateIndex = 0; candidateIndex < anyResidentialCandidates.length; candidateIndex++) {
        maybeStop?.();
        const candidate = anyResidentialCandidates[candidateIndex];
        if (profileCounters) profileCounters.servicePhase.lookaheadResidentialScans++;
        const candidateTypeIndex = getCandidateTypeIndex(candidate);
        if (
          remainingResidentialAvail &&
          candidateTypeIndex >= 0 &&
          remainingResidentialAvail[candidateTypeIndex] <= 0
        ) {
          continue;
        }
        if (roadsScratch.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (
            !placementLeavesRoadAnchorCellAvailable(
              G,
              occupiedScratch,
              candidate.r,
              candidate.c,
              candidate.rows,
              candidate.cols,
              roadAnchors
            )
          ) {
            continue;
          }
        }
        const candidateFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
        if (
          candidateFootprintKeys
            ? overlapsCachedFootprint(occupiedScratch, candidateFootprintKeys)
            : overlaps(occupiedScratch, candidate.r, candidate.c, candidate.rows, candidate.cols)
        ) {
          continue;
        }
        const probe = probeExplicitRoadConnection(
          G,
          roadsScratch,
          occupiedScratch,
          candidate,
          lookaheadRoadProbeScratch,
          profileCounters,
          roadAnchors
        );
        if (!probe) continue;
        const pop = computeResidentialPopulation(
          params,
          candidate,
          futureEffectZones,
          futureBonuses,
          candidateTypeIndex
        );
        if (
          pop > bestResidentialPop ||
          (pop === bestResidentialPop &&
            pop >= 0 &&
            bestResidential !== null &&
            bestResidentialProbe !== null &&
            compareResidentialTieBreaks(params, candidate, probe, bestResidential, bestResidentialProbe) < 0)
        ) {
          bestResidential = candidate;
          bestResidentialIndex = candidateIndex;
          bestResidentialPop = pop;
          bestResidentialProbe = probe;
        }
      }

      if (!bestResidential || bestResidentialIndex < 0 || bestResidentialPop <= 0 || !bestResidentialProbe) break;

      const candidateFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[bestResidentialIndex];
      const residentialNewlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
        occupiedScratch,
        bestResidentialProbe,
        bestResidential,
        candidateFootprintKeys
      );
      applyRoadConnectionProbe(roadsScratch, bestResidentialProbe);
      for (const key of residentialNewlyOccupiedKeys) occupiedScratch.add(key);
      const candidateTypeIndex = getCandidateTypeIndex(bestResidential);
      if (remainingResidentialAvail && candidateTypeIndex >= 0) {
        remainingResidentialAvail[candidateTypeIndex] -= 1;
      }
      refillScore += bestResidentialPop;
    }

    return {
      totalScore: entry.score + refillScore,
      refillScore
    };
  };
}
