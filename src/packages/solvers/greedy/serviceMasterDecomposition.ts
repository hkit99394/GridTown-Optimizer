import type { GreedyProfileCounters, ServiceCandidate, Solution } from "../../core/index.js";
import { serviceCandidateKey } from "./candidates.js";
import { isBetterSearchSolution } from "./solutionRanking.js";

type FixedServiceEvaluationBudget = {
  maxOrders: number;
  maxSeededOrders: number;
  maxSeeds: number;
};

export type ServiceMasterForcedServiceEvaluator = (
  forcedServices: ServiceCandidate[],
  maxForcedServices: number,
  budget: FixedServiceEvaluationBudget
) => Solution | null;

export type ServiceMasterBestUpdater = (candidate: Solution | null) => void;
export type ServiceMasterMaybeStop = () => void;

const SERVICE_MASTER_FIXED_SERVICE_EVALUATION: FixedServiceEvaluationBudget = {
  maxOrders: 4,
  maxSeededOrders: 1,
  maxSeeds: 3
};

function servicesOverlap(left: ServiceCandidate, right: ServiceCandidate): boolean {
  return (
    left.r < right.r + right.rows &&
    left.r + left.rows > right.r &&
    left.c < right.c + right.cols &&
    left.c + left.cols > right.c
  );
}

function layoutKey(services: readonly ServiceCandidate[]): string {
  return services
    .map((service) => serviceCandidateKey(service))
    .sort()
    .join("|");
}

function canAddServiceToMasterLayout(options: {
  chosen: readonly ServiceCandidate[];
  candidate: ServiceCandidate;
  serviceTypeUsage: readonly number[];
  serviceTypeAvailability: readonly number[] | null;
}): boolean {
  const { chosen, candidate, serviceTypeUsage, serviceTypeAvailability } = options;

  if (chosen.some((service) => servicesOverlap(service, candidate))) return false;
  if (serviceTypeAvailability && candidate.typeIndex >= 0) {
    const available = serviceTypeAvailability[candidate.typeIndex] ?? 0;
    const used = serviceTypeUsage[candidate.typeIndex] ?? 0;
    if (used >= available) return false;
  }
  return true;
}

function enumerateServiceMasterLayouts(options: {
  pool: readonly ServiceCandidate[];
  maxServices: number;
  maxLayouts: number;
  serviceTypeAvailability: readonly number[] | null;
  profileCounters?: GreedyProfileCounters;
}): ServiceCandidate[][] {
  const { pool, maxServices, maxLayouts, serviceTypeAvailability, profileCounters } = options;
  const layouts: ServiceCandidate[][] = [];
  const chosen: ServiceCandidate[] = [];
  const seenLayoutKeys = new Set<string>();
  const serviceTypeUsage = Array.from({ length: serviceTypeAvailability?.length ?? 0 }, () => 0);

  const addLayout = (): void => {
    if (layouts.length >= maxLayouts) return;
    const key = layoutKey(chosen);
    if (seenLayoutKeys.has(key)) {
      if (profileCounters) profileCounters.attempts.serviceMasterNoGoodSkips++;
      return;
    }
    seenLayoutKeys.add(key);
    layouts.push([...chosen]);
  };

  const dfs = (start: number, targetSize: number): void => {
    if (layouts.length >= maxLayouts) return;
    if (chosen.length === targetSize) {
      addLayout();
      return;
    }

    const needed = targetSize - chosen.length;
    for (let index = start; index <= pool.length - needed; index++) {
      const candidate = pool[index];
      if (!candidate) continue;
      if (
        !canAddServiceToMasterLayout({
          chosen,
          candidate,
          serviceTypeUsage,
          serviceTypeAvailability
        })
      ) {
        if (profileCounters) profileCounters.attempts.serviceMasterNoGoodSkips++;
        continue;
      }

      chosen.push(candidate);
      if (serviceTypeAvailability && candidate.typeIndex >= 0) {
        serviceTypeUsage[candidate.typeIndex] = (serviceTypeUsage[candidate.typeIndex] ?? 0) + 1;
      }
      dfs(index + 1, targetSize);
      if (serviceTypeAvailability && candidate.typeIndex >= 0) {
        serviceTypeUsage[candidate.typeIndex] = Math.max(0, (serviceTypeUsage[candidate.typeIndex] ?? 0) - 1);
      }
      chosen.pop();
      if (layouts.length >= maxLayouts) return;
    }
  };

  addLayout();
  for (let targetSize = 1; targetSize <= maxServices && layouts.length < maxLayouts; targetSize++) {
    dfs(0, targetSize);
  }

  return layouts;
}

export function runGreedyServiceMasterDecomposition(options: {
  initialBest: Solution;
  enabled: boolean;
  serviceMasterPoolLimit: number;
  serviceMasterMaxLayouts: number;
  serviceOrderSorted: readonly ServiceCandidate[];
  inferredUpper: number;
  serviceTypeAvailability: readonly number[] | null;
  evaluateForcedServiceSet: ServiceMasterForcedServiceEvaluator;
  updateBest: ServiceMasterBestUpdater;
  profileCounters?: GreedyProfileCounters;
  maybeStop?: ServiceMasterMaybeStop;
}): Solution {
  const {
    initialBest,
    enabled,
    serviceMasterPoolLimit,
    serviceMasterMaxLayouts,
    serviceOrderSorted,
    inferredUpper,
    serviceTypeAvailability,
    evaluateForcedServiceSet,
    updateBest,
    profileCounters,
    maybeStop
  } = options;
  if (!enabled) return initialBest;

  const poolLimit = Math.max(0, Math.min(serviceMasterPoolLimit, serviceOrderSorted.length));
  const maxLayouts = Math.max(1, serviceMasterMaxLayouts);
  const maxServices = Math.max(0, Math.min(inferredUpper, poolLimit));
  const layouts = enumerateServiceMasterLayouts({
    pool: serviceOrderSorted.slice(0, poolLimit),
    maxServices,
    maxLayouts,
    serviceTypeAvailability,
    profileCounters
  });

  let best = initialBest;
  for (const layout of layouts) {
    maybeStop?.();
    if (profileCounters) profileCounters.attempts.serviceMasterLayouts++;
    const trial = evaluateForcedServiceSet(layout, layout.length, SERVICE_MASTER_FIXED_SERVICE_EVALUATION);
    if (trial) {
      if (profileCounters) profileCounters.attempts.serviceMasterFeasibleLayouts++;
      if (isBetterSearchSolution(trial, best)) {
        best = trial;
        updateBest(best);
      }
    } else if (profileCounters) {
      profileCounters.attempts.serviceMasterNoGoodSkips++;
    }
  }

  return best;
}
