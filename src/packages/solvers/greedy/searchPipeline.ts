import type { Grid, GreedyProfileCounters, ServiceCandidate, Solution, SolverParams } from "../../core/index.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import { createSeededRandom, deriveSeed, shuffle } from "./runtime.js";
import { collectRoadAnchorRefinementSeeds } from "./roadAnchors.js";
import { buildGreedyServiceCapPolicy, runGreedyServiceCapSearch } from "./serviceCapSearch.js";
import type { CapSearchPhase } from "./serviceCapSearch.js";
import { runGreedyServiceMasterDecomposition } from "./serviceMasterDecomposition.js";
import {
  runGreedyResidualServiceBundleRepair,
  runGreedyServiceNeighborhoodSearch
} from "./serviceNeighborhoodSearch.js";
import { runGreedyExhaustiveServiceSearch, runGreedyServiceRefinement } from "./serviceSearchPhases.js";
import { isBetterSearchSolution } from "./solutionRanking.js";
import type { GreedyRunLifecycle } from "./runLifecycle.js";
import type {
  GreedyForcedServiceEvaluator,
  GreedyPrecomputedIndexes,
  GreedySolveAttempt,
  ResidentialScoringGroup
} from "./types.js";

export function runGreedySearchPipeline(options: {
  G: Grid;
  params: SolverParams;
  serviceOrderSorted: ServiceCandidate[];
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  precomputedIndexes: GreedyPrecomputedIndexes;
  solveWithOrder: GreedySolveAttempt;
  evaluateForcedServiceSet: GreedyForcedServiceEvaluator;
  maxServices: number | undefined;
  useTypes: boolean;
  localSearch: boolean;
  localSearchServiceMoves: boolean;
  localSearchServiceCandidateLimit: number;
  deferRoadCommitment: boolean;
  randomSeed: number | undefined;
  restarts: number;
  serviceRefineIterations: number;
  serviceRefineCandidateLimit: number;
  exhaustiveServiceSearch: boolean;
  serviceExactPoolLimit: number;
  serviceExactMaxCombinations: number;
  serviceMasterDecomposition: boolean;
  serviceMasterPoolLimit: number;
  serviceMasterMaxLayouts: number;
  profileCounters?: GreedyProfileCounters;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  lifecycle: Pick<GreedyRunLifecycle, "maybeStop" | "updateBest" | "requireBest" | "runProfiledPhase">;
}): Solution {
  const {
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
  } = options;
  const { maybeStop, updateBest, requireBest, runProfiledPhase } = lifecycle;

  const runCapRestarts = (cap: number, bestForCap: Solution | null, restartBudget: number): Solution | null => {
    if (restartBudget <= 1) return bestForCap;
    if (profileCounters) profileCounters.attempts.restartCaps++;
    let nextBest = bestForCap;
    for (let restartIndex = 1; restartIndex < restartBudget; restartIndex++) {
      if (profileCounters) profileCounters.attempts.restarts++;
      maybeStop();
      const order = shuffle(
        serviceOrderSorted,
        randomSeed === undefined ? Math.random : createSeededRandom(deriveSeed(randomSeed, cap, restartIndex))
      );
      const trial = solveWithOrder(order, { maxServices: cap });
      if (isBetterSearchSolution(trial, nextBest)) {
        nextBest = trial;
        updateBest(nextBest);
      }
    }
    return nextBest;
  };

  const runCapAnchorRefinement = (cap: number, bestForCap: Solution | null): Solution | null => {
    if (!bestForCap) return bestForCap;
    let refined = bestForCap;
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (const roadSeed of collectRoadAnchorRefinementSeeds(refined)) {
        maybeStop();
        if (profileCounters) profileCounters.attempts.serviceRefineTrials++;
        const trial = solveWithOrder(serviceOrderSorted, {
          maxServices: cap,
          initialRoadSeed: roadSeed
        });
        if (trial && isBetterSearchSolution(trial, refined)) {
          refined = trial;
          improved = true;
          updateBest(refined);
        }
      }
      if (!improved) break;
    }
    return refined;
  };

  const evaluateNewCap = (
    cap: number,
    phase: CapSearchPhase,
    restartBudget: number,
    allowAnchorRefinement: boolean
  ): Solution | null => {
    if (profileCounters) {
      profileCounters.attempts.serviceCaps++;
      if (phase === "coarse") profileCounters.attempts.coarseCaps++;
      if (phase === "refine") profileCounters.attempts.refineCaps++;
    }
    maybeStop();
    let bestForCap = solveWithOrder(serviceOrderSorted, { maxServices: cap });
    updateBest(bestForCap);
    bestForCap = runCapRestarts(cap, bestForCap, restartBudget);
    if (allowAnchorRefinement && !deferRoadCommitment) {
      bestForCap = runCapAnchorRefinement(cap, bestForCap);
    }
    updateBest(bestForCap);
    return bestForCap;
  };

  const refineExistingCap = (
    cap: number,
    bestForCap: Solution | null,
    restartBudget: number,
    allowAnchorRefinement: boolean
  ): Solution | null => {
    let refined = runCapRestarts(cap, bestForCap, restartBudget);
    if (allowAnchorRefinement && !deferRoadCommitment) {
      refined = runCapAnchorRefinement(cap, refined);
    }
    updateBest(refined);
    return refined;
  };

  const { explicitServiceCap, inferredUpper, capPlan } = buildGreedyServiceCapPolicy(params, maxServices);
  runProfiledPhase("constructiveCapSearch", () =>
    runGreedyServiceCapSearch({
      policy: { explicitServiceCap, inferredUpper, capPlan },
      restarts,
      profileCounters,
      evaluateNewCap,
      refineExistingCap
    })
  );

  let incumbent = requireBest();
  let best = runProfiledPhase("serviceRefinement", () =>
    runGreedyServiceRefinement({
      initialBest: incumbent,
      serviceRefineIterations,
      serviceRefineCandidateLimit,
      serviceOrderSorted,
      evaluateForcedServiceSet,
      updateBest,
      maybeStop
    })
  );

  incumbent = best;
  best = runProfiledPhase("exhaustiveServiceSearch", () =>
    runGreedyExhaustiveServiceSearch({
      initialBest: incumbent,
      enabled: exhaustiveServiceSearch,
      serviceExactPoolLimit,
      serviceExactMaxCombinations,
      serviceOrderSorted,
      evaluateForcedServiceSet,
      updateBest,
      profileCounters,
      maybeStop
    })
  );

  incumbent = best;
  best = runProfiledPhase("serviceMasterDecomposition", () =>
    runGreedyServiceMasterDecomposition({
      initialBest: incumbent,
      enabled: serviceMasterDecomposition,
      serviceMasterPoolLimit,
      serviceMasterMaxLayouts,
      serviceOrderSorted,
      inferredUpper,
      serviceTypeAvailability: params.serviceTypes?.map((type) => Math.max(0, type.avail)) ?? null,
      evaluateForcedServiceSet,
      updateBest,
      profileCounters,
      maybeStop
    })
  );

  if (localSearch) {
    incumbent = best;
    const serviceLocalBest = runProfiledPhase("serviceNeighborhoodSearch", () => {
      const neighborhoodBest = runGreedyServiceNeighborhoodSearch({
        initialBest: incumbent,
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
      });
      return runGreedyResidualServiceBundleRepair({
        initialBest: neighborhoodBest,
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
      });
    });
    if (isBetterSearchSolution(serviceLocalBest, best)) {
      best = serviceLocalBest;
      updateBest(best);
    }
  }

  return best;
}
