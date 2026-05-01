import type {
  Grid,
  GreedyProfileCounters,
  ServiceCandidate,
  Solution,
} from "../../core/index.js";
import { roadAnchorRepresentativeSeedCandidates } from "../../core/index.js";
import { startGreedyProfilePhase } from "./profile.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import { collectRoadAnchorRefinementSeeds } from "./roadAnchors.js";
import {
  compareServiceTieBreaks,
  materializeChosenServiceCandidate,
  sameServicePlacement,
  serviceCandidateKey,
} from "./candidates.js";
import { isBetterSearchSolution } from "./solutionRanking.js";
import type {
  GreedyBestUpdater,
  GreedyForcedServiceEvaluator,
  GreedySolveAttempt,
  MaybeStop,
} from "./types.js";

const SERVICE_REFINE_FIXED_SERVICE_EVALUATION = {
  maxOrders: 6,
  maxSeededOrders: 2,
  maxSeeds: 4,
};

const EXHAUSTIVE_FIXED_SERVICE_EVALUATION = {
  maxOrders: 4,
  maxSeededOrders: 1,
  maxSeeds: 3,
};

function combinationsOfK(n: number, k: number, maxCount: number): number[][] {
  const out: number[][] = [];
  const chosen: number[] = [];
  function dfs(start: number): void {
    if (out.length >= maxCount) return;
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    const need = k - chosen.length;
    for (let i = start; i <= n - need; i++) {
      chosen.push(i);
      dfs(i + 1);
      chosen.pop();
      if (out.length >= maxCount) return;
    }
  }
  if (k === 0) return [[]];
  if (k < 0 || k > n) return [];
  dfs(0);
  return out;
}

function permutationsOfItems<T>(items: T[], maxCount: number): T[][] {
  const out: T[][] = [];
  const working = [...items];
  function dfs(start: number): void {
    if (out.length >= maxCount) return;
    if (start >= working.length) {
      out.push([...working]);
      return;
    }
    for (let index = start; index < working.length; index++) {
      [working[start], working[index]] = [working[index], working[start]];
      dfs(start + 1);
      [working[start], working[index]] = [working[index], working[start]];
      if (out.length >= maxCount) return;
    }
  }
  dfs(0);
  return out;
}

export function runGreedyServiceRefinement(options: {
  initialBest: Solution;
  serviceRefineIterations: number;
  serviceRefineCandidateLimit: number;
  serviceOrderSorted: ServiceCandidate[];
  evaluateForcedServiceSet: GreedyForcedServiceEvaluator;
  updateBest: GreedyBestUpdater;
  maybeStop: MaybeStop;
}): Solution {
  const {
    initialBest,
    serviceRefineIterations,
    serviceRefineCandidateLimit,
    serviceOrderSorted,
    evaluateForcedServiceSet,
    updateBest,
    maybeStop,
  } = options;
  let best = initialBest;
  const refineLimit = Math.min(serviceRefineCandidateLimit, serviceOrderSorted.length);
  const refinePool = serviceOrderSorted.slice(0, refineLimit);
  for (let iter = 0; iter < serviceRefineIterations; iter++) {
    maybeStop?.();
    let improved = false;
    for (let i = 0; i < best.services.length; i++) {
      maybeStop?.();
      let localBest: Solution = best;
      for (const cand of refinePool) {
        maybeStop?.();
        const currentChoice = materializeChosenServiceCandidate(best, i);
        if (serviceCandidateKey(cand) === serviceCandidateKey(currentChoice)) continue;
        if (best.services.some((s, idx) => idx !== i && sameServicePlacement(s, cand))) continue;
        const forced = best.services.map((_, idx) => materializeChosenServiceCandidate(best, idx));
        forced[i] = cand;
        const trial = evaluateForcedServiceSet(
          forced,
          best.services.length,
          SERVICE_REFINE_FIXED_SERVICE_EVALUATION
        );
        if (trial && trial.totalPopulation > localBest.totalPopulation) {
          localBest = trial;
        }
      }
      if (localBest.totalPopulation > best.totalPopulation) {
        best = localBest;
        updateBest(best);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

export function runGreedyExhaustiveServiceSearch(options: {
  initialBest: Solution;
  enabled: boolean;
  serviceExactPoolLimit: number;
  serviceExactMaxCombinations: number;
  serviceOrderSorted: ServiceCandidate[];
  evaluateForcedServiceSet: GreedyForcedServiceEvaluator;
  updateBest: GreedyBestUpdater;
  profileCounters?: GreedyProfileCounters;
  maybeStop: MaybeStop;
}): Solution {
  const {
    initialBest,
    enabled,
    serviceExactPoolLimit,
    serviceExactMaxCombinations,
    serviceOrderSorted,
    evaluateForcedServiceSet,
    updateBest,
    profileCounters,
    maybeStop,
  } = options;
  let best = initialBest;
  if (!enabled) return best;

  const poolLimit = Math.max(0, Math.min(serviceExactPoolLimit, serviceOrderSorted.length));
  const comboCap = Math.max(1, serviceExactMaxCombinations);
  const pool = serviceOrderSorted.slice(0, poolLimit);
  const combos = combinationsOfK(pool.length, best.services.length, comboCap);
  for (const idxs of combos) {
    maybeStop?.();
    if (profileCounters) profileCounters.attempts.exhaustiveTrials++;
    const forced = idxs.map((i) => pool[i]);
    const trial = evaluateForcedServiceSet(
      forced,
      best.services.length,
      EXHAUSTIVE_FIXED_SERVICE_EVALUATION
    );
    if (trial && isBetterSearchSolution(trial, best)) {
      best = trial;
      updateBest(best);
    }
  }
  return best;
}
export function createGreedyForcedServiceEvaluator(options: {
  G: Grid;
  serviceOrderSorted: ServiceCandidate[];
  solveWithOrder: GreedySolveAttempt;
  updateBest: GreedyBestUpdater;
  profileCounters?: GreedyProfileCounters;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
  getBestPopulation?: () => number | null;
  maybeStop: MaybeStop;
}): GreedyForcedServiceEvaluator {
  const {
    G,
    serviceOrderSorted,
    solveWithOrder,
    updateBest,
    profileCounters,
    recordProfilePhase,
    getBestPopulation,
    maybeStop,
  } = options;
  const serviceOrderRankByKey = new Map(
    serviceOrderSorted.map((candidate, index) => [serviceCandidateKey(candidate), index])
  );

  const compareForcedServiceByRank = (left: ServiceCandidate, right: ServiceCandidate): number =>
    (serviceOrderRankByKey.get(serviceCandidateKey(left)) ?? Number.POSITIVE_INFINITY)
      - (serviceOrderRankByKey.get(serviceCandidateKey(right)) ?? Number.POSITIVE_INFINITY)
    || compareServiceTieBreaks(
      left,
      { kind: "explicit", roadCost: 0, roadProbe: { path: null } },
      right,
      { kind: "explicit", roadCost: 0, roadProbe: { path: null } }
    );

  const compareForcedServiceRowMajor = (left: ServiceCandidate, right: ServiceCandidate): number =>
    left.r - right.r
    || left.c - right.c
    || left.rows - right.rows
    || left.cols - right.cols
    || left.range - right.range
    || left.typeIndex - right.typeIndex
    || left.bonus - right.bonus
    || serviceCandidateKey(left).localeCompare(serviceCandidateKey(right));

  const buildForcedServiceOrders = (
    forcedServices: ServiceCandidate[],
    maxOrders: number
  ): ServiceCandidate[][] => {
    if (forcedServices.length === 0 || maxOrders <= 0) return [forcedServices];
    const orders: ServiceCandidate[][] = [];
    const seenKeys = new Set<string>();
    const addOrder = (order: ServiceCandidate[]): void => {
      if (orders.length >= maxOrders) return;
      const key = order.map((candidate) => serviceCandidateKey(candidate)).join("|");
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      orders.push([...order]);
    };

    const ranked = [...forcedServices].sort(compareForcedServiceByRank);
    const rowMajor = [...forcedServices].sort(compareForcedServiceRowMajor);

    addOrder(forcedServices);
    addOrder(ranked);
    addOrder([...ranked].reverse());
    addOrder(rowMajor);
    addOrder([...rowMajor].reverse());

    if (forcedServices.length <= 3) {
      for (const permutation of permutationsOfItems(ranked, maxOrders)) {
        addOrder(permutation);
      }
    }

    for (let shift = 1; shift < ranked.length && orders.length < maxOrders; shift++) {
      addOrder([...ranked.slice(shift), ...ranked.slice(0, shift)]);
    }

    return orders;
  };

  const collectForcedServiceSeeds = (
    successfulSolutions: Solution[],
    maxSeeds: number
  ): (Set<string> | undefined)[] => {
    const seeds: (Set<string> | undefined)[] = [undefined];
    if (maxSeeds <= 0) return seeds;
    const seenKeys = new Set<string>(["<none>"]);
    const addSeed = (seed: Set<string>): void => {
      if (seeds.length > maxSeeds) return;
      const key = [...seed].sort().join("|");
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      seeds.push(new Set(seed));
    };

    for (const solution of successfulSolutions) {
      for (const seed of collectRoadAnchorRefinementSeeds(solution)) {
        addSeed(seed);
        if (seeds.length > maxSeeds) return seeds;
      }
    }

    for (const fallbackSeed of roadAnchorRepresentativeSeedCandidates(G, maxSeeds)) {
      addSeed(fallbackSeed);
      if (seeds.length > maxSeeds) break;
    }

    return seeds;
  };

  return (forcedServices, maxForcedServices, budget) => {
    const phaseStartedAtMs = startGreedyProfilePhase(recordProfilePhase);
    const bestPopulationBefore = recordProfilePhase ? getBestPopulation?.() ?? null : null;
    const orders = buildForcedServiceOrders(forcedServices, budget.maxOrders);
    const baseResults: { order: ServiceCandidate[]; solution: Solution | null }[] = [];
    let bestForced: Solution | null = null;

    try {
      for (const order of orders) {
        maybeStop?.();
        if (profileCounters) profileCounters.attempts.fixedServiceRealizationTrials++;
        const trial = solveWithOrder(serviceOrderSorted, {
          maxServices: maxForcedServices,
          fixedServices: order,
        });
        baseResults.push({ order, solution: trial });
        if (isBetterSearchSolution(trial, bestForced)) {
          bestForced = trial;
          updateBest(bestForced);
        }
      }

      const successfulBaseResults = baseResults
        .filter((entry): entry is { order: ServiceCandidate[]; solution: Solution } => entry.solution !== null)
        .sort((left, right) => (
          isBetterSearchSolution(left.solution, right.solution)
            ? -1
            : isBetterSearchSolution(right.solution, left.solution)
              ? 1
              : 0
        ));
      if (successfulBaseResults.length === 0) return bestForced;

      const seeds = collectForcedServiceSeeds(
        successfulBaseResults.slice(0, budget.maxSeededOrders).map((entry) => entry.solution),
        budget.maxSeeds
      );

      for (const { order } of successfulBaseResults.slice(0, budget.maxSeededOrders)) {
        for (const seed of seeds) {
          if (!seed) continue;
          maybeStop?.();
          if (profileCounters) profileCounters.attempts.fixedServiceRealizationTrials++;
          const trial = solveWithOrder(serviceOrderSorted, {
            maxServices: maxForcedServices,
            fixedServices: order,
            initialRoadSeed: seed,
          });
          if (isBetterSearchSolution(trial, bestForced)) {
            bestForced = trial;
            updateBest(bestForced);
          }
        }
      }

      return bestForced;
    } finally {
      if (recordProfilePhase) {
        recordProfilePhase("forcedServiceRealization", phaseStartedAtMs, {
          bestPopulationBefore,
          bestPopulationAfter: getBestPopulation?.() ?? null,
        });
      }
    }
  };
}
