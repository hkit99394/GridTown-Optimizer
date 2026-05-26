import type { GreedyProfileCounters, ServiceCandidate, Solution } from "../../core/index.js";
import { serviceCandidateKey } from "./candidates.js";
import { computeServiceStaticScore } from "./serviceScoring.js";
import { isBetterSearchSolution } from "./solutionRanking.js";
import type { ResidentialScoringGroup } from "./types.js";

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

const SERVICE_MASTER_SHORTLIST_RANKED_FRACTION = 0.5;
const SERVICE_MASTER_SHORTLIST_SCAN_MULTIPLIER = 4;
const SERVICE_MASTER_SHORTLIST_EXTRA_SCAN = 8;
const SERVICE_MASTER_DIVERSIFIED_LAYOUT_FRACTION = 0.25;

type ServiceMasterShortlistEntry = {
  candidate: ServiceCandidate;
  rank: number;
  key: string;
  typeBucket: string;
  footprintBucket: string;
  regionBucket: string;
  payoffBucket: string;
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

function serviceMasterShortlistScanLimit(candidateCount: number, poolLimit: number): number {
  if (poolLimit <= 0) return 0;
  if (candidateCount <= poolLimit) return candidateCount;
  return Math.min(
    candidateCount,
    Math.max(
      poolLimit,
      poolLimit * SERVICE_MASTER_SHORTLIST_SCAN_MULTIPLIER,
      poolLimit + SERVICE_MASTER_SHORTLIST_EXTRA_SCAN
    )
  );
}

function serviceMasterRegionBucket(service: ServiceCandidate, gridRows: number, gridCols: number): string {
  const rows = Math.max(1, gridRows);
  const cols = Math.max(1, gridCols);
  const centerR = service.r + service.rows / 2;
  const centerC = service.c + service.cols / 2;
  const rowBand = Math.min(2, Math.max(0, Math.floor((centerR * 3) / rows)));
  const colBand = Math.min(2, Math.max(0, Math.floor((centerC * 3) / cols)));
  return `${rowBand}:${colBand}`;
}

function estimateServiceMasterResidentialPayoff(
  service: ServiceCandidate,
  residentialScoringGroups: readonly ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>,
  residentialTypeAvailability: readonly number[] | null
): number {
  return computeServiceStaticScore(
    service,
    Array.from({ length: residentialScoringGroups.length }, () => 0),
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    residentialTypeAvailability
  );
}

function serviceMasterPayoffBucket(payoff: number, bestPayoff: number): string {
  if (payoff <= 0 || bestPayoff <= 0) return "zero";
  const ratio = payoff / bestPayoff;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.4) return "medium";
  return "low";
}

function pushShortlistEntry(
  shortlist: ServiceMasterShortlistEntry[],
  selectedKeys: Set<string>,
  entry: ServiceMasterShortlistEntry,
  poolLimit: number
): void {
  if (shortlist.length >= poolLimit || selectedKeys.has(entry.key)) return;
  selectedKeys.add(entry.key);
  shortlist.push(entry);
}

function createSeenBuckets(
  shortlist: ServiceMasterShortlistEntry[],
  bucket: (entry: ServiceMasterShortlistEntry) => string
): Set<string> {
  return new Set(shortlist.map(bucket));
}

function pushNextShortlistBucketEntry(
  shortlist: ServiceMasterShortlistEntry[],
  selectedKeys: Set<string>,
  seenBuckets: Set<string>,
  entries: readonly ServiceMasterShortlistEntry[],
  poolLimit: number,
  bucket: (entry: ServiceMasterShortlistEntry) => string
): void {
  if (shortlist.length >= poolLimit) return;
  for (const entry of entries) {
    if (shortlist.length >= poolLimit) return;
    const bucketKey = bucket(entry);
    if (seenBuckets.has(bucketKey)) continue;
    pushShortlistEntry(shortlist, selectedKeys, entry, poolLimit);
    seenBuckets.add(bucketKey);
    return;
  }
}

function fillShortlistByDiversityBuckets(
  shortlist: ServiceMasterShortlistEntry[],
  selectedKeys: Set<string>,
  entries: readonly ServiceMasterShortlistEntry[],
  poolLimit: number
): void {
  const bucketSelectors = [
    (entry: ServiceMasterShortlistEntry) => entry.typeBucket,
    (entry: ServiceMasterShortlistEntry) => entry.payoffBucket,
    (entry: ServiceMasterShortlistEntry) => entry.footprintBucket,
    (entry: ServiceMasterShortlistEntry) => entry.regionBucket
  ];
  const seenBucketsBySelector = bucketSelectors.map((bucket) => createSeenBuckets(shortlist, bucket));

  while (shortlist.length < poolLimit) {
    const before = shortlist.length;
    for (let index = 0; index < bucketSelectors.length && shortlist.length < poolLimit; index++) {
      pushNextShortlistBucketEntry(
        shortlist,
        selectedKeys,
        seenBucketsBySelector[index],
        entries,
        poolLimit,
        bucketSelectors[index]
      );
    }
    if (shortlist.length === before) return;
  }
}

function buildServiceMasterShortlist(options: {
  serviceOrderSorted: readonly ServiceCandidate[];
  poolLimit: number;
  gridRows: number;
  gridCols: number;
  residentialScoringGroups: readonly ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  residentialTypeAvailability: readonly number[] | null;
}): ServiceCandidate[] {
  const {
    serviceOrderSorted,
    poolLimit,
    gridRows,
    gridCols,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    residentialTypeAvailability
  } = options;
  if (poolLimit <= 0) return [];
  const scanLimit = serviceMasterShortlistScanLimit(serviceOrderSorted.length, poolLimit);
  const scanPool = serviceOrderSorted.slice(0, scanLimit);
  if (scanPool.length <= poolLimit) return scanPool;

  const scoredEntries = scanPool.map((candidate, rank) => ({
    candidate,
    rank,
    payoff: estimateServiceMasterResidentialPayoff(
      candidate,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      residentialTypeAvailability
    )
  }));
  const bestPayoff = Math.max(0, ...scoredEntries.map((entry) => entry.payoff));
  const entries: ServiceMasterShortlistEntry[] = scoredEntries.map(({ candidate, rank, payoff }) => ({
    candidate,
    rank,
    key: serviceCandidateKey(candidate),
    typeBucket: `type:${candidate.typeIndex}`,
    footprintBucket: `${candidate.rows}x${candidate.cols}:r${candidate.range}`,
    regionBucket: serviceMasterRegionBucket(candidate, gridRows, gridCols),
    payoffBucket: serviceMasterPayoffBucket(payoff, bestPayoff)
  }));
  const shortlist: ServiceMasterShortlistEntry[] = [];
  const selectedKeys = new Set<string>();
  const rankedSeedCount = Math.min(
    entries.length,
    Math.max(1, Math.ceil(poolLimit * SERVICE_MASTER_SHORTLIST_RANKED_FRACTION))
  );

  for (const entry of entries.slice(0, rankedSeedCount)) {
    pushShortlistEntry(shortlist, selectedKeys, entry, poolLimit);
  }

  fillShortlistByDiversityBuckets(shortlist, selectedKeys, entries, poolLimit);

  for (const entry of entries) {
    pushShortlistEntry(shortlist, selectedKeys, entry, poolLimit);
  }

  return shortlist.sort((a, b) => a.rank - b.rank).map((entry) => entry.candidate);
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

function pushUniqueServiceMasterLayouts(
  target: ServiceCandidate[][],
  seenLayoutKeys: Set<string>,
  layouts: readonly ServiceCandidate[][],
  maxLayouts: number,
  layoutLimit = maxLayouts
): number {
  let pushed = 0;
  for (const layout of layouts) {
    if (target.length >= maxLayouts || pushed >= layoutLimit) return pushed;
    const key = layoutKey(layout);
    if (seenLayoutKeys.has(key)) continue;
    seenLayoutKeys.add(key);
    target.push(layout);
    pushed++;
  }
  return pushed;
}

function serviceMasterHasShortlistOnlyCandidates(
  legacyPool: readonly ServiceCandidate[],
  shortlistPool: readonly ServiceCandidate[]
): boolean {
  const legacyKeys = new Set(legacyPool.map((candidate) => serviceCandidateKey(candidate)));
  return shortlistPool.some((candidate) => !legacyKeys.has(serviceCandidateKey(candidate)));
}

function layoutHasShortlistOnlyCandidate(
  layout: readonly ServiceCandidate[],
  legacyCandidateKeys: Set<string>
): boolean {
  return layout.some((candidate) => !legacyCandidateKeys.has(serviceCandidateKey(candidate)));
}

function enumerateLegacyFirstServiceMasterLayouts(options: {
  legacyPool: readonly ServiceCandidate[];
  shortlistPool: readonly ServiceCandidate[];
  maxServices: number;
  maxLayouts: number;
  serviceTypeAvailability: readonly number[] | null;
  profileCounters?: GreedyProfileCounters;
}): ServiceCandidate[][] {
  const { legacyPool, shortlistPool, maxServices, maxLayouts, serviceTypeAvailability, profileCounters } = options;
  const layouts: ServiceCandidate[][] = [];
  const seenLayoutKeys = new Set<string>();
  const legacyCandidateKeys = new Set(legacyPool.map((candidate) => serviceCandidateKey(candidate)));
  const hasShortlistOnlyCandidates = serviceMasterHasShortlistOnlyCandidates(legacyPool, shortlistPool);
  const diversifiedLayoutBudget = hasShortlistOnlyCandidates
    ? Math.max(1, Math.floor(maxLayouts * SERVICE_MASTER_DIVERSIFIED_LAYOUT_FRACTION))
    : 0;
  const totalLayoutBudget = maxLayouts + diversifiedLayoutBudget;
  const legacyLayouts = enumerateServiceMasterLayouts({
    pool: legacyPool,
    maxServices,
    maxLayouts,
    serviceTypeAvailability,
    profileCounters
  });
  if (!hasShortlistOnlyCandidates) {
    pushUniqueServiceMasterLayouts(layouts, seenLayoutKeys, legacyLayouts, maxLayouts);
    return layouts;
  }
  pushUniqueServiceMasterLayouts(layouts, seenLayoutKeys, legacyLayouts, maxLayouts);

  const shortlistLayouts = enumerateServiceMasterLayouts({
    pool: shortlistPool,
    maxServices,
    maxLayouts: Math.max(totalLayoutBudget, shortlistPool.length + 1),
    serviceTypeAvailability,
    profileCounters
  });
  pushUniqueServiceMasterLayouts(
    layouts,
    seenLayoutKeys,
    shortlistLayouts.filter((layout) => layoutHasShortlistOnlyCandidate(layout, legacyCandidateKeys)),
    totalLayoutBudget,
    diversifiedLayoutBudget
  );

  return layouts;
}

export function runGreedyServiceMasterDecomposition(options: {
  initialBest: Solution;
  enabled: boolean;
  serviceMasterPoolLimit: number;
  serviceMasterMaxLayouts: number;
  gridRows: number;
  gridCols: number;
  serviceOrderSorted: readonly ServiceCandidate[];
  residentialScoringGroups: readonly ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  residentialTypeAvailability: readonly number[] | null;
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
    gridRows,
    gridCols,
    serviceOrderSorted,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    residentialTypeAvailability,
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
  const legacyPool = serviceOrderSorted.slice(0, poolLimit);
  const shortlist = buildServiceMasterShortlist({
    serviceOrderSorted,
    poolLimit,
    gridRows,
    gridCols,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    residentialTypeAvailability
  });
  if (profileCounters) {
    profileCounters.attempts.serviceMasterCandidatesConsidered += serviceMasterShortlistScanLimit(
      serviceOrderSorted.length,
      poolLimit
    );
    profileCounters.attempts.serviceMasterCandidatesShortlisted += shortlist.length;
  }
  const layouts = enumerateLegacyFirstServiceMasterLayouts({
    legacyPool,
    shortlistPool: shortlist,
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
        if (profileCounters) profileCounters.attempts.serviceMasterImprovingLayouts++;
        updateBest(best);
      }
    } else if (profileCounters) {
      profileCounters.attempts.serviceMasterNoGoodSkips++;
    }
  }

  return best;
}
