/**
 * Greedy solver + optional local search (see docs/design/ALGORITHM.md)
 */

import type { Grid } from "../../core/index.js";
import type {
  GreedyProfileCounters,
  ServicePlacement,
  ResidentialPlacement,
  SolverParams,
  Solution
} from "../../core/index.js";
import { createGreedyProfileCounters, createGreedyProfilePhaseSummaries } from "./profile.js";
import { GreedyAttemptState } from "./attemptState.js";
import { createConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import { createRoadOpportunityRecorder } from "./roadOpportunity.js";
import {
  createRoadProbeScratch,
  ensureBuildingConnectedToRoads,
  roadsConnectedToRoadAnchor,
  findAvailableRoadAnchorCell,
  pruneRedundantRoads
} from "../../core/index.js";
import { assertValidLayoutConstraints } from "../../core/index.js";
import { applyDeterministicDominanceUpgrades } from "../../core/index.js";
import { normalizeServicePlacement } from "../../core/index.js";
import { getBuildingLimits } from "../../core/index.js";
import { GreedyStopError, getGreedyOptions } from "./runtime.js";
import type { GreedySolveAttempt, GreedySolveContext, SolveOneOptions } from "./types.js";
import { addPlacementCellsToSet } from "./placementUtils.js";
import { constructGreedyServicePhase } from "./serviceConstruction.js";
import { constructGreedyResidentialPhase } from "./residentialConstruction.js";
import { runResidentialLocalSearchPhase } from "./residentialLocalSearch.js";
import { createGreedyRunLifecycle } from "./runLifecycle.js";
import { prepareGreedyInputs } from "./precompute.js";
import { createGreedyForcedServiceEvaluator } from "./serviceSearchPhases.js";
import { runGreedySearchPipeline } from "./searchPipeline.js";

function finalizeGreedyConstructiveLayout(options: {
  G: Grid;
  params: SolverParams;
  roads: Set<string>;
  services: ServicePlacement[];
  serviceTypeIndices: number[];
  serviceBonuses: number[];
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  totalPopulation: number;
  profileCounters?: GreedyProfileCounters;
  explicitRoadProbeScratch?: ReturnType<typeof createRoadProbeScratch>;
}): Solution | null {
  const {
    G,
    params,
    roads,
    services,
    serviceTypeIndices,
    serviceBonuses,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation,
    profileCounters,
    explicitRoadProbeScratch
  } = options;
  const occupiedBuildings = new Set<string>();
  for (const s of services) addPlacementCellsToSet(occupiedBuildings, s);
  for (const r of residentials) addPlacementCellsToSet(occupiedBuildings, r);
  const normalizedServices = services.map((service) => normalizeServicePlacement(service));
  const roadConnectedBuildings = [...normalizedServices, ...residentials];

  let roadsValid = roadsConnectedToRoadAnchor(G, roads);
  if (roadsValid.size === 0) {
    const fallbackRoad = findAvailableRoadAnchorCell(G, occupiedBuildings);
    if (!fallbackRoad) return null;
    if (profileCounters) profileCounters.roads.fallbackRoads++;
    roadsValid.add(fallbackRoad);
  }

  for (const normalized of normalizedServices) {
    if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
    ensureBuildingConnectedToRoads(
      G,
      roadsValid,
      occupiedBuildings,
      normalized.r,
      normalized.c,
      normalized.rows,
      normalized.cols,
      explicitRoadProbeScratch
    );
  }
  for (const r of residentials) {
    if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
    ensureBuildingConnectedToRoads(
      G,
      roadsValid,
      occupiedBuildings,
      r.r,
      r.c,
      r.rows,
      r.cols,
      explicitRoadProbeScratch
    );
  }

  roadsValid = pruneRedundantRoads(G, roadsValid, roadConnectedBuildings);

  assertValidLayoutConstraints(
    {
      grid: G,
      roads: roadsValid,
      services: services.map((service, index) => ({
        ...service,
        bonus: serviceBonuses[index] ?? 0
      })),
      residentials,
      params
    },
    "Invalid greedy layout"
  );

  return {
    optimizer: "greedy",
    roads: roadsValid,
    services,
    serviceTypeIndices,
    servicePopulationIncreases: serviceBonuses,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation
  };
}

function solveOne(context: GreedySolveContext, options: SolveOneOptions): Solution | null {
  const {
    grid: G,
    params,
    serviceOrder,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    anyResidentialCandidates,
    residentialCandidatesForLocal,
    precomputedIndexes,
    maxResidentials,
    useServiceTypes,
    useTypes,
    localSearch,
    serviceLookaheadCandidates,
    recordProfilePhase,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop
  } = context;
  const { maxServices, initialRoadSeed, fixedServices, profileCounters } = options;
  const attemptState = new GreedyAttemptState(
    G,
    initialRoadSeed,
    (params.greedy?.deferRoadCommitment ?? false) && !fixedServices,
    profileCounters
  );
  const { roads, occupied, useDeferredRoadCommitment } = attemptState;
  const { explicitRoadProbeScratch } = attemptState;
  const remainingServiceAvail = useServiceTypes ? params.serviceTypes!.map((t) => t.avail) : null;
  const remainingAvail = useTypes ? params.residentialTypes!.map((t) => t.avail) : null;
  const densityTieBreaker = Boolean(params.greedy?.densityTieBreaker);
  const densityTieBreakerToleranceRatio =
    densityTieBreaker && typeof params.greedy?.densityTieBreakerTolerancePercent === "number"
      ? Math.max(0, params.greedy.densityTieBreakerTolerancePercent) / 100
      : densityTieBreaker
        ? 0.02
        : 0;
  const connectivityShadowScoring = Boolean(params.greedy?.connectivityShadowScoring);

  const servicePhase = constructGreedyServicePhase({
    G,
    params,
    attemptState,
    roads,
    occupied,
    useDeferredRoadCommitment,
    serviceOrder,
    fixedServices,
    maxServices,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    anyResidentialCandidates,
    precomputedIndexes,
    maxResidentials,
    useServiceTypes,
    useTypes,
    remainingServiceAvail,
    remainingAvail,
    densityTieBreaker,
    densityTieBreakerToleranceRatio,
    connectivityShadowScoring,
    serviceLookaheadCandidates,
    profileCounters,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop
  });
  if (!servicePhase) return null;
  const { services, serviceTypeIndices, serviceBonuses, effectZones } = servicePhase;

  const residentialPhase = constructGreedyResidentialPhase({
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
  });
  const { residentials, residentialTypeIndices, populations, residentialPopulationCacheForLocal } = residentialPhase;

  if (useDeferredRoadCommitment && !attemptState.materializeDeferredRoads(services, residentials)) {
    return null;
  }

  const totalPopulation = runResidentialLocalSearchPhase({
    enabled: localSearch,
    G,
    roads,
    occupied,
    services,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation: populations.reduce((a, b) => a + b, 0),
    residentialCandidatesForLocal,
    residentialPopulationCacheForLocal,
    params,
    remainingAvail: useTypes ? remainingAvail : null,
    maxResidentials,
    profileCounters,
    recordRoadOpportunity,
    maybeStop,
    explicitRoadProbeScratch,
    recordProfilePhase
  });

  return finalizeGreedyConstructiveLayout({
    G,
    params,
    roads,
    services,
    serviceTypeIndices,
    serviceBonuses,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation,
    profileCounters,
    explicitRoadProbeScratch
  });
}

function createGreedySolveAttempt(
  G: Grid,
  params: SolverParams,
  baseSolveContext: Omit<GreedySolveContext, "serviceOrder">,
  profileCounters: GreedyProfileCounters | undefined
): GreedySolveAttempt {
  return (serviceOrder, options) => {
    const candidate = solveOne({ ...baseSolveContext, serviceOrder }, { ...options, profileCounters });
    return candidate ? applyDeterministicDominanceUpgrades(G, params, candidate) : null;
  };
}

export function solveGreedy(G: Grid, params: SolverParams): Solution {
  const {
    localSearch,
    localSearchServiceMoves,
    localSearchServiceCandidateLimit,
    serviceLookaheadCandidates,
    deferRoadCommitment,
    densityTieBreaker,
    connectivityShadowScoring,
    randomSeed,
    profile,
    diagnostics,
    timeLimitSeconds,
    restarts,
    serviceRefineIterations,
    serviceRefineCandidateLimit,
    exhaustiveServiceSearch,
    serviceExactPoolLimit,
    serviceExactMaxCombinations,
    serviceMasterDecomposition,
    serviceMasterPoolLimit,
    serviceMasterMaxLayouts,
    stopFilePath,
    snapshotFilePath
  } = getGreedyOptions(params);
  const profileCounters = profile ? createGreedyProfileCounters() : undefined;
  const profilePhases = profile ? createGreedyProfilePhaseSummaries() : undefined;
  const { decisions: connectivityShadowDecisions, recordDecision: recordConnectivityShadowDecision } =
    createConnectivityShadowDecisionRecorder(profile);
  const { traces: roadOpportunityTraces, recordRoadOpportunity } = createRoadOpportunityRecorder(profile);
  const { maxServices, maxResidentials } = getBuildingLimits(params);
  const useServiceTypes = (params.serviceTypes?.length ?? 0) > 0;
  const useTypes = (params.residentialTypes?.length ?? 0) > 0;
  let best: Solution | null = null;
  const lifecycle = createGreedyRunLifecycle({
    G,
    params,
    diagnostics,
    timeLimitSeconds,
    stopFilePath,
    snapshotFilePath,
    densityTieBreaker,
    connectivityShadowScoring,
    profileCounters,
    profilePhases,
    connectivityShadowDecisions,
    roadOpportunityTraces,
    getBest: () => best,
    setBest: (solution) => {
      best = solution;
    },
    baselineSolver: solveGreedy
  });
  const { maybeStop, updateBest, getBestPopulation, recordProfilePhase, runProfiledPhase, finalizeWithBaselineGuard } =
    lifecycle;

  const preparedInputs = runProfiledPhase("precompute", () =>
    prepareGreedyInputs(G, params, {
      maxResidentials,
      useServiceTypes,
      useTypes,
      localSearch,
      serviceLookaheadCandidates,
      profileCounters,
      recordProfilePhase,
      recordConnectivityShadowDecision,
      recordRoadOpportunity,
      maybeStop
    })
  );
  const { serviceOrderSorted, baseSolveContext } = preparedInputs;
  const { residentialScoringGroups, serviceCoverageGroupsByKey, precomputedIndexes } = baseSolveContext;
  const solveWithOrder = createGreedySolveAttempt(G, params, baseSolveContext, profileCounters);

  const evaluateForcedServiceSet = createGreedyForcedServiceEvaluator({
    G,
    serviceOrderSorted,
    solveWithOrder,
    updateBest,
    profileCounters,
    recordProfilePhase,
    getBestPopulation,
    maybeStop
  });

  try {
    best = runGreedySearchPipeline({
      G,
      params,
      serviceOrderSorted,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      precomputedIndexes,
      solveWithOrder,
      evaluateForcedServiceSet,
      maxServices,
      useTypes,
      localSearch,
      localSearchServiceMoves,
      localSearchServiceCandidateLimit,
      deferRoadCommitment,
      randomSeed,
      restarts,
      serviceRefineIterations,
      serviceRefineCandidateLimit,
      exhaustiveServiceSearch,
      serviceExactPoolLimit,
      serviceExactMaxCombinations,
      serviceMasterDecomposition,
      serviceMasterPoolLimit,
      serviceMasterMaxLayouts,
      profileCounters,
      recordRoadOpportunity,
      lifecycle
    });
  } catch (error) {
    if (error instanceof GreedyStopError) {
      if (error.bestSolution) {
        return finalizeWithBaselineGuard(error.bestSolution, preparedInputs, maxServices, maxResidentials);
      }
      throw error;
    }
    throw error;
  }

  return finalizeWithBaselineGuard(best as Solution, preparedInputs, maxServices, maxResidentials);
}
