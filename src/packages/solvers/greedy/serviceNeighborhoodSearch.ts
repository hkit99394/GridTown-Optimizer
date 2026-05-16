import type { Grid, GreedyProfileCounters, ServiceCandidate, Solution, SolverParams } from "../../core/index.js";
import { createRoadProbeScratch, NO_TYPE_INDEX, overlaps, serviceFootprint } from "../../core/index.js";
import { probeExplicitRoadConnection } from "./attemptState.js";
import {
  recordRoadOpportunityPlacementFromOccupiedBuildings,
  roadOpportunityHasTraceCapacity
} from "./roadOpportunity.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import {
  compareServiceTieBreaks,
  materializeChosenServiceCandidate,
  materializeServicePlacement,
  serviceCandidateKey,
  stableServicePlacementKey
} from "./candidates.js";
import { isBetterSearchSolution } from "./solutionRanking.js";
import {
  addCachedPlacementCellsToSet,
  addPlacementCellsToSet,
  createOccupancyScratch,
  deleteKeysFromOccupancyScratch,
  overlapsCachedFootprint,
  rectanglesOverlap,
  resetOccupancyScratch,
  toExplicitConnectivityProbe
} from "./placementUtils.js";
import {
  createRoadOpportunityCandidatePools,
  pushRoadOpportunityCandidate,
  selectRoadOpportunityCounterfactuals
} from "./roadOpportunityCandidates.js";
import type { RoadOpportunityCandidatePoolEntry } from "./roadOpportunityCandidates.js";
import {
  computeResidentialPopulation,
  computeServiceMarginalScore,
  getCachedServiceEffectZoneSet,
  getCachedServiceFootprintKeys
} from "./serviceScoring.js";
import type {
  GreedyBestUpdater,
  GreedyPrecomputedIndexes,
  GreedySolveAttempt,
  MaybeStop,
  ResidentialScoringGroup,
  ResidualServiceBundleTrial,
  ServiceRelocationMove
} from "./types.js";

const LOCAL_SEARCH_SERVICE_NEIGHBORHOOD = {
  maxIterations: 2,
  candidateLimit: 6,
  maxRemoveTrialsPerIteration: 4,
  maxAddTrialsPerIteration: 8,
  maxSwapTrialsPerIteration: 12,
  maxRealizationAttemptsPerIteration: 3
};

interface ServiceNeighborhoodMoveServices {
  roadProbeScratch: ReturnType<typeof createRoadProbeScratch>;
  materializeCurrentServiceSet: (solution: Solution) => ServiceCandidate[];
  realizeAcceptedServiceNeighborhoodMove: (
    incumbent: Solution,
    candidateServices: ServiceCandidate[]
  ) => Solution | null;
  compareServiceRelocationMoves: (left: ServiceRelocationMove, right: ServiceRelocationMove) => number;
  scoreDirectServiceRelocationMove: (
    incumbent: Solution,
    forcedServices: ServiceCandidate[]
  ) => {
    estimatedTotalPopulation: number;
    orderedServiceKey: string;
  } | null;
}

function createServiceNeighborhoodMoveServices(options: {
  G: Grid;
  params: SolverParams;
  serviceOrderSorted: ServiceCandidate[];
  precomputedIndexes: GreedyPrecomputedIndexes;
  solveWithOrder: GreedySolveAttempt;
}): ServiceNeighborhoodMoveServices {
  const { G, params, serviceOrderSorted, precomputedIndexes, solveWithOrder } = options;
  const materializeCurrentServiceSet = (solution: Solution): ServiceCandidate[] =>
    solution.services.map((_, index) => materializeChosenServiceCandidate(solution, index));

  const currentRoadSeedFromSolution = (solution: Solution): Set<string> | undefined => {
    const seed = new Set<string>();
    for (const key of solution.roads) {
      if (key.startsWith("0,")) seed.add(key);
    }
    return seed.size > 0 ? seed : undefined;
  };

  const realizeAcceptedServiceNeighborhoodMove = (
    incumbent: Solution,
    candidateServices: ServiceCandidate[]
  ): Solution | null => {
    return solveWithOrder(serviceOrderSorted, {
      maxServices: candidateServices.length,
      fixedServices: candidateServices,
      initialRoadSeed: currentRoadSeedFromSolution(incumbent)
    });
  };

  const relocationProbe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } } as const;
  const compareServiceRelocationMoves = (left: ServiceRelocationMove, right: ServiceRelocationMove): number =>
    right.estimatedTotalPopulation - left.estimatedTotalPopulation ||
    left.forcedServices.length - right.forcedServices.length ||
    right.estimatedFutureScore - left.estimatedFutureScore ||
    left.estimatedRoadCost - right.estimatedRoadCost ||
    (left.kind === right.kind
      ? 0
      : left.kind === "remove"
        ? -1
        : right.kind === "remove"
          ? 1
          : left.kind === "add"
            ? -1
            : 1) ||
    left.serviceIndex - right.serviceIndex ||
    compareServiceTieBreaks(left.candidate, relocationProbe, right.candidate, relocationProbe) ||
    left.orderedServiceKey.localeCompare(right.orderedServiceKey);

  const scoreDirectServiceRelocationMove = (
    incumbent: Solution,
    forcedServices: ServiceCandidate[]
  ): {
    estimatedTotalPopulation: number;
    orderedServiceKey: string;
  } | null => {
    const serviceTypeUsage = new Array((params.serviceTypes ?? []).length).fill(0);
    const occupiedBuildings = new Set<string>();
    const effectZones: Set<string>[] = [];
    const serviceBonuses: number[] = [];

    for (const residential of incumbent.residentials) {
      addPlacementCellsToSet(occupiedBuildings, residential);
    }

    for (const service of forcedServices) {
      const placement = materializeServicePlacement(service);
      const cachedFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, service);
      if (
        cachedFootprintKeys
          ? overlapsCachedFootprint(occupiedBuildings, cachedFootprintKeys)
          : overlaps(occupiedBuildings, placement.r, placement.c, placement.rows, placement.cols)
      ) {
        return null;
      }
      if (cachedFootprintKeys) {
        addCachedPlacementCellsToSet(occupiedBuildings, cachedFootprintKeys);
      } else {
        addPlacementCellsToSet(occupiedBuildings, placement);
      }
      effectZones.push(getCachedServiceEffectZoneSet(G, precomputedIndexes, service));
      serviceBonuses.push(service.bonus);
      if (service.typeIndex >= 0 && service.typeIndex < serviceTypeUsage.length) {
        serviceTypeUsage[service.typeIndex] += 1;
      }
    }

    const serviceTypes = params.serviceTypes ?? [];
    for (let typeIndex = 0; typeIndex < serviceTypeUsage.length; typeIndex++) {
      if (serviceTypeUsage[typeIndex] > (serviceTypes[typeIndex]?.avail ?? 0)) return null;
    }

    let estimatedTotalPopulation = 0;
    for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
      estimatedTotalPopulation += computeResidentialPopulation(
        params,
        incumbent.residentials[residentialIndex],
        effectZones,
        serviceBonuses,
        incumbent.residentialTypeIndices[residentialIndex] ?? NO_TYPE_INDEX
      );
    }

    return {
      estimatedTotalPopulation,
      orderedServiceKey: forcedServices.map((service) => stableServicePlacementKey(service)).join("|")
    };
  };

  return {
    roadProbeScratch: createRoadProbeScratch(G),
    materializeCurrentServiceSet,
    realizeAcceptedServiceNeighborhoodMove,
    compareServiceRelocationMoves,
    scoreDirectServiceRelocationMove
  };
}

export function runGreedyServiceNeighborhoodSearch(options: {
  initialBest: Solution;
  G: Grid;
  params: SolverParams;
  localSearch: boolean;
  localSearchServiceMoves: boolean;
  localSearchServiceCandidateLimit: number;
  inferredUpper: number;
  useTypes: boolean;
  serviceOrderSorted: ServiceCandidate[];
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  precomputedIndexes: GreedyPrecomputedIndexes;
  solveWithOrder: GreedySolveAttempt;
  updateBest: GreedyBestUpdater;
  profileCounters?: GreedyProfileCounters;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  maybeStop: MaybeStop;
}): Solution {
  const {
    initialBest,
    G,
    params,
    localSearch,
    localSearchServiceMoves,
    localSearchServiceCandidateLimit,
    inferredUpper,
    useTypes,
    serviceOrderSorted,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    precomputedIndexes,
    solveWithOrder,
    updateBest,
    profileCounters,
    recordRoadOpportunity,
    maybeStop
  } = options;
  if (!localSearch || !localSearchServiceMoves) return initialBest;
  if (serviceOrderSorted.length === 0) return initialBest;

  const moveServices = createServiceNeighborhoodMoveServices({
    G,
    params,
    serviceOrderSorted,
    precomputedIndexes,
    solveWithOrder
  });
  const {
    roadProbeScratch: serviceNeighborhoodRoadProbeScratch,
    materializeCurrentServiceSet,
    realizeAcceptedServiceNeighborhoodMove,
    compareServiceRelocationMoves,
    scoreDirectServiceRelocationMove
  } = moveServices;

  let incumbent = initialBest;
  for (let iteration = 0; iteration < LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxIterations; iteration++) {
    maybeStop?.();
    const incumbentServices = materializeCurrentServiceSet(incumbent);
    const canAddService = incumbentServices.length < inferredUpper;
    if (incumbentServices.length === 0 && !canAddService) break;
    const perTypeNeighborhoodLimit = Math.min(
      serviceOrderSorted.length,
      Math.max(
        LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.candidateLimit,
        localSearchServiceCandidateLimit,
        incumbentServices.length + 1
      )
    );
    const maxSwapTrialsThisIteration = Math.min(
      incumbentServices.length * perTypeNeighborhoodLimit,
      Math.max(
        LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxSwapTrialsPerIteration,
        incumbentServices.length * Math.max(2, perTypeNeighborhoodLimit)
      )
    );
    const incumbentOccupiedBuildings = new Set<string>();
    for (const residential of incumbent.residentials) {
      addPlacementCellsToSet(incumbentOccupiedBuildings, residential);
    }
    for (const service of incumbent.services) {
      addPlacementCellsToSet(incumbentOccupiedBuildings, service);
    }
    const occupancyScratch = createOccupancyScratch(incumbentOccupiedBuildings);
    const incumbentServiceKeys = new Set(incumbentServices.map((candidate) => serviceCandidateKey(candidate)));
    const incumbentServiceTypeUsage = new Array((params.serviceTypes ?? []).length).fill(0);
    for (const service of incumbentServices) {
      if (service.typeIndex >= 0 && service.typeIndex < incumbentServiceTypeUsage.length) {
        incumbentServiceTypeUsage[service.typeIndex] += 1;
      }
    }
    const remainingAvailForIncumbent =
      useTypes && params.residentialTypes ? params.residentialTypes.map((type) => type.avail) : null;
    if (remainingAvailForIncumbent) {
      for (const typeIndex of incumbent.residentialTypeIndices) {
        if (typeIndex >= 0 && typeIndex < remainingAvailForIncumbent.length) {
          remainingAvailForIncumbent[typeIndex] = Math.max(0, remainingAvailForIncumbent[typeIndex] - 1);
        }
      }
    }
    const currentResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
    for (const service of incumbentServices) {
      const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? [];
      for (const groupIndex of coveredGroupIndices) {
        currentResidentialGroupBoosts[groupIndex] += service.bonus;
      }
    }
    let iterationBest = incumbent;
    let swapTrials = 0;
    const candidateMoves: ServiceRelocationMove[] = [];
    const removalMoves: ServiceRelocationMove[] = [];
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(
      recordRoadOpportunity,
      "service-neighborhood"
    );
    const serviceRoadOpportunityPools = createRoadOpportunityCandidatePools<ServiceCandidate>();

    for (let serviceIndex = 0; serviceIndex < incumbentServices.length; serviceIndex++) {
      maybeStop?.();
      if (profileCounters) profileCounters.localSearch.serviceRemoveChecks++;
      const removedService = incumbentServices[serviceIndex];
      const forcedServices = incumbentServices.filter((_, index) => index !== serviceIndex);
      const scoredMove = scoreDirectServiceRelocationMove(incumbent, forcedServices);
      if (!scoredMove) continue;
      removalMoves.push({
        kind: "remove",
        serviceIndex,
        candidate: removedService,
        forcedServices,
        estimatedTotalPopulation: scoredMove.estimatedTotalPopulation,
        estimatedFutureScore: 0,
        estimatedRoadCost: 0,
        orderedServiceKey: scoredMove.orderedServiceKey
      });
    }
    removalMoves.sort(compareServiceRelocationMoves);
    candidateMoves.push(...removalMoves.slice(0, LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRemoveTrialsPerIteration));

    if (canAddService) {
      let addTrials = 0;
      for (const candidate of serviceOrderSorted) {
        maybeStop?.();
        if (addTrials >= LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxAddTrialsPerIteration) break;
        if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
        if (
          candidate.typeIndex >= 0 &&
          candidate.typeIndex < incumbentServiceTypeUsage.length &&
          (incumbentServiceTypeUsage[candidate.typeIndex] ?? 0) >=
            (params.serviceTypes?.[candidate.typeIndex]?.avail ?? 0)
        ) {
          continue;
        }
        const candidateFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, candidate);
        if (
          candidateFootprintKeys
            ? overlapsCachedFootprint(incumbentOccupiedBuildings, candidateFootprintKeys)
            : overlaps(incumbentOccupiedBuildings, candidate.r, candidate.c, candidate.rows, candidate.cols)
        ) {
          continue;
        }
        if (profileCounters) profileCounters.localSearch.serviceAddChecks++;
        if (profileCounters) profileCounters.localSearch.canConnectChecks++;
        addTrials++;
        const probe = probeExplicitRoadConnection(
          G,
          incumbent.roads,
          incumbentOccupiedBuildings,
          candidate,
          serviceNeighborhoodRoadProbeScratch,
          profileCounters
        );
        if (!probe) continue;
        const forcedServices = [...incumbentServices, candidate];
        const scoredMove = scoreDirectServiceRelocationMove(incumbent, forcedServices);
        if (!scoredMove) continue;
        const estimatedFutureScore = computeServiceMarginalScore(
          candidate,
          incumbentOccupiedBuildings,
          currentResidentialGroupBoosts,
          residentialScoringGroups,
          serviceCoverageGroupsByKey,
          remainingAvailForIncumbent
        );
        const traceProbe = toExplicitConnectivityProbe(probe);
        const traceKey = `add:${serviceCandidateKey(candidate)}:${scoredMove.orderedServiceKey}`;
        const traceEntry: RoadOpportunityCandidatePoolEntry<ServiceCandidate> = {
          key: traceKey,
          candidate,
          candidateIndex: incumbentServices.length,
          placement: materializeServicePlacement(candidate),
          probe: traceProbe,
          footprintKeys: candidateFootprintKeys,
          occupiedBuildings: new Set(incumbentOccupiedBuildings),
          score: scoredMove.estimatedTotalPopulation,
          typeIndex: candidate.typeIndex,
          bonus: candidate.bonus,
          range: candidate.range,
          moveKind: "service-add"
        };
        if (collectRoadOpportunityCounterfactuals) {
          pushRoadOpportunityCandidate(serviceRoadOpportunityPools, traceEntry);
        }
        candidateMoves.push({
          kind: "add",
          serviceIndex: incumbentServices.length,
          candidate,
          forcedServices,
          estimatedTotalPopulation: scoredMove.estimatedTotalPopulation,
          estimatedFutureScore,
          estimatedRoadCost: probe.path?.length ?? 0,
          orderedServiceKey: scoredMove.orderedServiceKey,
          traceKey,
          traceProbe,
          traceFootprintKeys: candidateFootprintKeys,
          traceOccupiedBuildings: traceEntry.occupiedBuildings
        });
      }
    }

    for (let serviceIndex = 0; serviceIndex < incumbentServices.length; serviceIndex++) {
      maybeStop?.();
      const currentChoice = incumbentServices[serviceIndex];
      const candidatePasses = [
        serviceOrderSorted
          .filter((candidate) => candidate.typeIndex === currentChoice.typeIndex)
          .slice(0, perTypeNeighborhoodLimit),
        serviceOrderSorted
          .filter((candidate) => candidate.typeIndex !== currentChoice.typeIndex)
          .slice(0, Math.min(localSearchServiceCandidateLimit, serviceOrderSorted.length))
      ];
      resetOccupancyScratch(occupancyScratch);
      const currentChoiceFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, currentChoice);
      deleteKeysFromOccupancyScratch(occupancyScratch, currentChoiceFootprintKeys ?? serviceFootprint(currentChoice));
      const occupiedWithoutCurrent = occupancyScratch.cells;
      if (profileCounters) profileCounters.localSearch.occupancyScratchReuses++;
      const currentResidentialGroupBoostsWithoutCurrent = [...currentResidentialGroupBoosts];
      for (const groupIndex of serviceCoverageGroupsByKey.get(serviceCandidateKey(currentChoice)) ?? []) {
        currentResidentialGroupBoostsWithoutCurrent[groupIndex] -= currentChoice.bonus;
      }

      for (const candidatePool of candidatePasses) {
        for (const candidate of candidatePool) {
          maybeStop?.();
          if (swapTrials >= maxSwapTrialsThisIteration) break;
          if (serviceCandidateKey(candidate) === serviceCandidateKey(currentChoice)) continue;
          if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
          const candidateFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, candidate);
          if (
            candidateFootprintKeys
              ? overlapsCachedFootprint(occupiedWithoutCurrent, candidateFootprintKeys)
              : overlaps(occupiedWithoutCurrent, candidate.r, candidate.c, candidate.rows, candidate.cols)
          ) {
            continue;
          }
          if (profileCounters) profileCounters.localSearch.serviceSwapChecks++;
          if (profileCounters) profileCounters.localSearch.canConnectChecks++;
          swapTrials++;
          const probe = probeExplicitRoadConnection(
            G,
            incumbent.roads,
            occupiedWithoutCurrent,
            candidate,
            serviceNeighborhoodRoadProbeScratch,
            profileCounters
          );
          if (!probe) continue;
          const forcedServices = [...incumbentServices];
          forcedServices[serviceIndex] = candidate;
          const scoredMove = scoreDirectServiceRelocationMove(incumbent, forcedServices);
          if (!scoredMove) continue;
          const estimatedFutureScore = computeServiceMarginalScore(
            candidate,
            occupiedWithoutCurrent,
            currentResidentialGroupBoostsWithoutCurrent,
            residentialScoringGroups,
            serviceCoverageGroupsByKey,
            remainingAvailForIncumbent
          );
          const traceProbe = toExplicitConnectivityProbe(probe);
          const traceKey = `swap:${serviceIndex}:${serviceCandidateKey(candidate)}:${scoredMove.orderedServiceKey}`;
          const traceEntry: RoadOpportunityCandidatePoolEntry<ServiceCandidate> = {
            key: traceKey,
            candidate,
            candidateIndex: serviceIndex,
            placement: materializeServicePlacement(candidate),
            probe: traceProbe,
            footprintKeys: candidateFootprintKeys,
            occupiedBuildings: new Set(occupiedWithoutCurrent),
            score: scoredMove.estimatedTotalPopulation,
            typeIndex: candidate.typeIndex,
            bonus: candidate.bonus,
            range: candidate.range,
            moveKind: "service-swap"
          };
          if (collectRoadOpportunityCounterfactuals) {
            pushRoadOpportunityCandidate(serviceRoadOpportunityPools, traceEntry);
          }
          candidateMoves.push({
            kind: "swap",
            serviceIndex,
            candidate,
            forcedServices,
            estimatedTotalPopulation: scoredMove.estimatedTotalPopulation,
            estimatedFutureScore,
            estimatedRoadCost: probe.path?.length ?? 0,
            orderedServiceKey: scoredMove.orderedServiceKey,
            traceKey,
            traceProbe,
            traceFootprintKeys: candidateFootprintKeys,
            traceOccupiedBuildings: traceEntry.occupiedBuildings
          });
        }
        if (swapTrials >= maxSwapTrialsThisIteration) break;
      }

      if (swapTrials >= maxSwapTrialsThisIteration) break;
    }

    candidateMoves.sort(compareServiceRelocationMoves);
    const baseRealizationBudget = Math.min(
      candidateMoves.length,
      Math.max(LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRealizationAttemptsPerIteration, localSearchServiceCandidateLimit)
    );
    const realizationMoves = candidateMoves.slice(0, baseRealizationBudget);
    const selectedMoveKeys = new Set(
      realizationMoves.map((move) => `${move.kind}:${move.serviceIndex}:${move.orderedServiceKey}`)
    );
    const guaranteedRealizationBudget =
      baseRealizationBudget +
      LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRemoveTrialsPerIteration +
      LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxAddTrialsPerIteration;
    for (const move of candidateMoves) {
      if (move.kind === "swap") continue;
      if (realizationMoves.length >= guaranteedRealizationBudget) break;
      const key = `${move.kind}:${move.serviceIndex}:${move.orderedServiceKey}`;
      if (selectedMoveKeys.has(key)) continue;
      selectedMoveKeys.add(key);
      realizationMoves.push(move);
    }
    let iterationBestMove: ServiceRelocationMove | null = null;
    for (const move of realizationMoves) {
      maybeStop?.();
      const trial = realizeAcceptedServiceNeighborhoodMove(incumbent, move.forcedServices);
      if (isBetterSearchSolution(trial, iterationBest)) {
        iterationBest = trial as Solution;
        iterationBestMove = move;
      }
    }

    if (!isBetterSearchSolution(iterationBest, incumbent)) break;
    if (iterationBestMove?.traceProbe && iterationBestMove.traceKey && iterationBestMove.traceOccupiedBuildings) {
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: serviceRoadOpportunityPools,
            chosenKey: iterationBestMove.traceKey,
            chosenCandidate: iterationBestMove.candidate,
            chosenProbe: iterationBestMove.traceProbe,
            chosenScore: iterationBestMove.estimatedTotalPopulation,
            compareTieBreaks: compareServiceTieBreaks
          })
        : undefined;
      recordRoadOpportunityPlacementFromOccupiedBuildings({
        grid: G,
        occupiedBuildings: iterationBestMove.traceOccupiedBuildings,
        placement: materializeServicePlacement(iterationBestMove.candidate),
        probe: iterationBestMove.traceProbe,
        phase: "service-neighborhood",
        footprintKeys: iterationBestMove.traceFootprintKeys,
        profileCounters,
        record: recordRoadOpportunity,
        score: iterationBestMove.estimatedTotalPopulation,
        counterfactuals,
        typeIndex: iterationBestMove.candidate.typeIndex,
        bonus: iterationBestMove.candidate.bonus,
        range: iterationBestMove.candidate.range,
        moveKind: iterationBestMove.kind === "add" ? "service-add" : "service-swap"
      });
    }
    incumbent = iterationBest;
    updateBest(incumbent);
    if (profileCounters) profileCounters.localSearch.serviceNeighborhoodImprovements++;
  }

  return incumbent;
}

function solutionRoadAnchorSeed(solution: Solution): Set<string> | undefined {
  const seed = new Set<string>();
  for (const key of solution.roads) {
    const [rowText, colText] = key.split(",");
    if (Number(rowText) === 0 || Number(colText) === 0) seed.add(key);
  }
  return seed.size > 0 ? seed : undefined;
}

function solutionServiceCandidates(solution: Solution): ServiceCandidate[] {
  return solution.services.map((_, index) => materializeChosenServiceCandidate(solution, index));
}

export function runGreedyResidualServiceBundleRepair(options: {
  initialBest: Solution;
  G: Grid;
  params: SolverParams;
  localSearch: boolean;
  localSearchServiceMoves: boolean;
  localSearchServiceCandidateLimit: number;
  inferredUpper: number;
  useTypes: boolean;
  serviceOrderSorted: ServiceCandidate[];
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  precomputedIndexes: GreedyPrecomputedIndexes;
  solveWithOrder: GreedySolveAttempt;
  updateBest: GreedyBestUpdater;
  profileCounters?: GreedyProfileCounters;
  maybeStop: MaybeStop;
}): Solution {
  const {
    initialBest,
    G,
    params,
    localSearch,
    localSearchServiceMoves,
    localSearchServiceCandidateLimit,
    inferredUpper,
    useTypes,
    serviceOrderSorted,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    precomputedIndexes,
    solveWithOrder,
    updateBest,
    profileCounters,
    maybeStop
  } = options;
  if (!localSearch || !localSearchServiceMoves) return initialBest;
  if (initialBest.services.length >= inferredUpper) return initialBest;
  if (initialBest.residentials.length === 0 || serviceOrderSorted.length === 0) return initialBest;

  const incumbentServices = solutionServiceCandidates(initialBest);
  const incumbentServiceKeys = new Set(incumbentServices.map((service) => serviceCandidateKey(service)));
  const incumbentServiceTypeUsage = new Array((params.serviceTypes ?? []).length).fill(0);
  for (const service of incumbentServices) {
    if (service.typeIndex >= 0 && service.typeIndex < incumbentServiceTypeUsage.length) {
      incumbentServiceTypeUsage[service.typeIndex] += 1;
    }
  }

  const occupiedServices = new Set<string>();
  for (const service of incumbentServices) {
    const footprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, service);
    if (footprintKeys) {
      addCachedPlacementCellsToSet(occupiedServices, footprintKeys);
    } else {
      addPlacementCellsToSet(occupiedServices, service);
    }
  }

  const currentResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  const incumbentEffectZones: Set<string>[] = [];
  const incumbentServiceBonuses: number[] = [];
  for (const service of incumbentServices) {
    incumbentEffectZones.push(getCachedServiceEffectZoneSet(G, precomputedIndexes, service));
    incumbentServiceBonuses.push(service.bonus);
    const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? [];
    for (const groupIndex of coveredGroupIndices) {
      currentResidentialGroupBoosts[groupIndex] += service.bonus;
    }
  }

  const remainingAvailForIncumbent =
    useTypes && params.residentialTypes ? params.residentialTypes.map((type) => type.avail) : null;
  if (remainingAvailForIncumbent) {
    for (const typeIndex of initialBest.residentialTypeIndices) {
      if (typeIndex >= 0 && typeIndex < remainingAvailForIncumbent.length) {
        remainingAvailForIncumbent[typeIndex] = Math.max(0, remainingAvailForIncumbent[typeIndex] - 1);
      }
    }
  }

  const trialLimit = Math.max(
    1,
    Math.min(
      serviceOrderSorted.length,
      Math.max(localSearchServiceCandidateLimit, LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxAddTrialsPerIteration)
    )
  );
  const scanLimit = Math.min(serviceOrderSorted.length, Math.max(trialLimit, localSearchServiceCandidateLimit * 4, 16));
  const trials: ResidualServiceBundleTrial[] = [];
  const repairProbe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } } as const;

  for (const candidate of serviceOrderSorted.slice(0, scanLimit)) {
    maybeStop?.();
    if (trials.length >= trialLimit) break;
    if (candidate.bonus <= 0) continue;
    if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
    if (
      candidate.typeIndex >= 0 &&
      candidate.typeIndex < incumbentServiceTypeUsage.length &&
      (incumbentServiceTypeUsage[candidate.typeIndex] ?? 0) >= (params.serviceTypes?.[candidate.typeIndex]?.avail ?? 0)
    ) {
      continue;
    }
    const candidateFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, candidate);
    if (
      candidateFootprintKeys
        ? overlapsCachedFootprint(occupiedServices, candidateFootprintKeys)
        : overlaps(occupiedServices, candidate.r, candidate.c, candidate.rows, candidate.cols)
    ) {
      continue;
    }

    const displacedResidentialIndices: number[] = [];
    for (let index = 0; index < initialBest.residentials.length; index++) {
      if (rectanglesOverlap(candidate, initialBest.residentials[index])) {
        displacedResidentialIndices.push(index);
      }
    }
    if (displacedResidentialIndices.length === 0) continue;

    if (profileCounters) profileCounters.localSearch.serviceAddChecks++;
    const displacedResidentialIndexSet = new Set(displacedResidentialIndices);
    const occupiedAfterDisplacement = new Set(occupiedServices);
    for (let index = 0; index < initialBest.residentials.length; index++) {
      if (displacedResidentialIndexSet.has(index)) continue;
      addPlacementCellsToSet(occupiedAfterDisplacement, initialBest.residentials[index]);
    }

    const futureEffectZones = [
      ...incumbentEffectZones,
      getCachedServiceEffectZoneSet(G, precomputedIndexes, candidate)
    ];
    const futureServiceBonuses = [...incumbentServiceBonuses, candidate.bonus];
    let estimatedKeptPopulation = 0;
    const remainingAvailAfterDisplacement = remainingAvailForIncumbent ? [...remainingAvailForIncumbent] : null;
    if (remainingAvailAfterDisplacement) {
      for (const index of displacedResidentialIndices) {
        const typeIndex = initialBest.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
        if (typeIndex >= 0 && typeIndex < remainingAvailAfterDisplacement.length) {
          remainingAvailAfterDisplacement[typeIndex] += 1;
        }
      }
    }
    for (let index = 0; index < initialBest.residentials.length; index++) {
      if (displacedResidentialIndexSet.has(index)) continue;
      estimatedKeptPopulation += computeResidentialPopulation(
        params,
        initialBest.residentials[index],
        futureEffectZones,
        futureServiceBonuses,
        initialBest.residentialTypeIndices[index] ?? NO_TYPE_INDEX
      );
    }
    const estimatedFutureScore = computeServiceMarginalScore(
      candidate,
      occupiedAfterDisplacement,
      currentResidentialGroupBoosts,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      remainingAvailAfterDisplacement
    );
    const forcedServices = [...incumbentServices, candidate];
    trials.push({
      candidate,
      forcedServices,
      displacedResidentialCount: displacedResidentialIndices.length,
      estimatedTotalPopulation: estimatedKeptPopulation + estimatedFutureScore,
      estimatedFutureScore,
      orderedServiceKey: forcedServices.map((service) => stableServicePlacementKey(service)).join("|")
    });
  }

  trials.sort(
    (left, right) =>
      right.estimatedTotalPopulation - left.estimatedTotalPopulation ||
      right.estimatedFutureScore - left.estimatedFutureScore ||
      left.displacedResidentialCount - right.displacedResidentialCount ||
      compareServiceTieBreaks(left.candidate, repairProbe, right.candidate, repairProbe) ||
      left.orderedServiceKey.localeCompare(right.orderedServiceKey)
  );

  let best = initialBest;
  const initialRoadSeed = solutionRoadAnchorSeed(initialBest);
  for (const trialEntry of trials) {
    maybeStop?.();
    const trial = solveWithOrder(serviceOrderSorted, {
      maxServices: trialEntry.forcedServices.length,
      fixedServices: trialEntry.forcedServices,
      initialRoadSeed
    });
    if (trial && trial.totalPopulation > best.totalPopulation) {
      best = trial;
      updateBest(best);
    }
  }
  if (best.totalPopulation > initialBest.totalPopulation && profileCounters) {
    profileCounters.localSearch.serviceNeighborhoodImprovements++;
  }
  return best;
}
