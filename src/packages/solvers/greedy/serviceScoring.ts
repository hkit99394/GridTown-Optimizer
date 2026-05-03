import type { Grid, GreedyProfileCounters, ServiceCandidate, SolverParams } from "../../core/index.js";
import { buildServiceEffectZoneSet, getResidentialBaseMax, isBoostedByService, overlaps } from "../../core/index.js";
import { buildFootprintCandidateIndexFromKeys } from "./candidatePools.js";
import { getCandidateTypeIndex, serviceCandidateKey } from "./candidates.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import { rectanglesOverlap } from "./placementUtils.js";
import type {
  GreedyPrecomputedIndexes,
  MaybeStop,
  ResidentialCandidateStat,
  ResidentialScoringGroup
} from "./types.js";

function marginalPopulationGain(base: number, max: number, currentBoost: number, extraBoost: number): number {
  const currentPopulation = Math.min(base + currentBoost, max);
  const boostedPopulation = Math.min(base + currentBoost + extraBoost, max);
  return Math.max(0, boostedPopulation - currentPopulation);
}

function residentialScoringGroupKey(residential: Pick<ResidentialCandidateStat, "r" | "c" | "rows" | "cols">): string {
  return [residential.r, residential.c, residential.rows, residential.cols].join(",");
}

export function buildResidentialScoringGroups(
  residentialCandidateStats: ResidentialCandidateStat[],
  profileCounters?: GreedyProfileCounters,
  maybeStop?: MaybeStop
): ResidentialScoringGroup[] {
  const groupsByKey = new Map<string, ResidentialScoringGroup>();
  for (const residential of residentialCandidateStats) {
    maybeStop?.();
    const key = residentialScoringGroupKey(residential);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        variants: []
      };
      groupsByKey.set(key, group);
    }
    group.variants.push({
      base: residential.base,
      max: residential.max,
      typeIndex: residential.typeIndex
    });
  }

  const groups = [...groupsByKey.values()];
  for (const group of groups) {
    group.variants.sort((a, b) => b.max - a.max || b.base - a.base || a.typeIndex - b.typeIndex);
  }
  if (profileCounters) {
    profileCounters.precompute.residentialScoringGroups += groups.length;
    profileCounters.precompute.residentialScoringVariantsCollapsed += Math.max(
      0,
      residentialCandidateStats.length - groups.length
    );
  }
  return groups;
}

export function buildServiceCoverageIndex(
  serviceCandidates: ServiceCandidate[],
  residentialScoringGroups: ResidentialScoringGroup[],
  profileCounters?: GreedyProfileCounters,
  maybeStop?: MaybeStop
): Map<string, number[]> {
  const coverageByKey = new Map<string, number[]>();
  for (const service of serviceCandidates) {
    maybeStop?.();
    const key = serviceCandidateKey(service);
    const effectBounds = {
      r: service.r - service.range,
      c: service.c - service.range,
      rows: service.rows + 2 * service.range,
      cols: service.cols + 2 * service.range
    };
    const footprint = { r: service.r, c: service.c, rows: service.rows, cols: service.cols };
    const coveredGroupIndices: number[] = [];
    for (let index = 0; index < residentialScoringGroups.length; index++) {
      maybeStop?.();
      const residential = residentialScoringGroups[index];
      if (rectanglesOverlap(footprint, residential)) continue;
      if (!rectanglesOverlap(effectBounds, residential)) continue;
      coveredGroupIndices.push(index);
      if (profileCounters) {
        profileCounters.precompute.serviceCoveragePairs += residential.variants.length;
      }
    }
    coverageByKey.set(key, coveredGroupIndices);
    if (profileCounters) {
      profileCounters.precompute.serviceCoverageGroups += coveredGroupIndices.length;
    }
  }
  return coverageByKey;
}

function buildServiceAvailabilityPressureByType(
  service: ServiceCandidate,
  coveredGroupIndices: number[],
  residentialScoringGroups: ResidentialScoringGroup[],
  currentResidentialGroupBoosts: number[],
  remainingAvail: number[] | null,
  occupied: Set<string> | null
): Map<number, number> | null {
  if (!remainingAvail || coveredGroupIndices.length === 0) return null;
  const groupOptions: {
    typeIndex: number;
    gain: number;
    max: number;
    base: number;
  }[][] = [];
  const activeTypeIndices = new Set<number>();
  for (const groupIndex of coveredGroupIndices) {
    const group = residentialScoringGroups[groupIndex];
    if (occupied && overlaps(occupied, group.r, group.c, group.rows, group.cols)) continue;
    const currentBoost = currentResidentialGroupBoosts[groupIndex] ?? 0;
    const demandOptions: {
      typeIndex: number;
      gain: number;
      max: number;
      base: number;
    }[] = [];
    for (const variant of group.variants) {
      const typeIndex = variant.typeIndex;
      if (typeIndex < 0 || typeIndex >= remainingAvail.length) continue;
      if ((remainingAvail[typeIndex] ?? 0) <= 0) continue;
      const gain = marginalPopulationGain(variant.base, variant.max, currentBoost, service.bonus);
      if (gain <= 0) continue;
      demandOptions.push({
        typeIndex,
        gain,
        max: variant.max,
        base: variant.base
      });
      activeTypeIndices.add(typeIndex);
    }
    if (demandOptions.length === 0) continue;
    groupOptions.push(demandOptions);
  }

  if (groupOptions.length === 0 || activeTypeIndices.size === 0) return null;
  const multipliers = new Map<number, number>();
  for (const typeIndex of activeTypeIndices) {
    multipliers.set(typeIndex, 1);
  }

  for (let iteration = 0; iteration < 3; iteration++) {
    const typeDemandCounts = new Map<number, number>();
    for (const options of groupOptions) {
      let chosen = options[0];
      let chosenWeightedGain = options[0].gain * (multipliers.get(options[0].typeIndex) ?? 1);
      for (let index = 1; index < options.length; index++) {
        const option = options[index];
        const weightedGain = option.gain * (multipliers.get(option.typeIndex) ?? 1);
        if (
          weightedGain > chosenWeightedGain ||
          (weightedGain === chosenWeightedGain &&
            (option.gain > chosen.gain ||
              (option.gain === chosen.gain &&
                (option.max > chosen.max ||
                  (option.max === chosen.max &&
                    (option.base > chosen.base ||
                      (option.base === chosen.base && option.typeIndex < chosen.typeIndex)))))))
        ) {
          chosen = option;
          chosenWeightedGain = weightedGain;
        }
      }
      typeDemandCounts.set(chosen.typeIndex, (typeDemandCounts.get(chosen.typeIndex) ?? 0) + 1);
    }
    let changed = false;
    for (const typeIndex of activeTypeIndices) {
      const demandCount = typeDemandCounts.get(typeIndex) ?? 0;
      const available = remainingAvail[typeIndex] ?? 0;
      const nextMultiplier = available <= 0 ? 0 : demandCount <= 0 ? 1 : Math.min(1, available / demandCount);
      if (Math.abs((multipliers.get(typeIndex) ?? 1) - nextMultiplier) > 1e-9) {
        changed = true;
      }
      multipliers.set(typeIndex, nextMultiplier);
    }
    if (!changed) break;
  }
  return multipliers;
}

function computeServiceGroupedScore(
  service: ServiceCandidate,
  occupied: Set<string> | null,
  currentResidentialGroupBoosts: number[],
  residentialScoringGroups: ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>,
  remainingAvail: number[] | null,
  profileCounters: GreedyProfileCounters | undefined,
  phase: "precompute" | "servicePhase"
): number {
  const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? [];
  if (profileCounters) {
    if (phase === "precompute") {
      profileCounters.precompute.serviceStaticScores++;
      profileCounters.precompute.serviceStaticScoreGroupEvaluations += coveredGroupIndices.length;
    } else {
      profileCounters.servicePhase.groupedScoreLookups++;
      profileCounters.servicePhase.groupedScoreGroupEvaluations += coveredGroupIndices.length;
    }
  }

  const availabilityPressureByType = buildServiceAvailabilityPressureByType(
    service,
    coveredGroupIndices,
    residentialScoringGroups,
    currentResidentialGroupBoosts,
    remainingAvail,
    occupied
  );

  let score = 0;
  for (const groupIndex of coveredGroupIndices) {
    const residential = residentialScoringGroups[groupIndex];
    if (occupied && overlaps(occupied, residential.r, residential.c, residential.rows, residential.cols)) continue;
    const currentBoost = currentResidentialGroupBoosts[groupIndex] ?? 0;
    let bestWeightedGain = 0;
    let bestWeightedGainDiscounted = false;
    for (const variant of residential.variants) {
      const rawGain = marginalPopulationGain(variant.base, variant.max, currentBoost, service.bonus);
      if (rawGain <= 0) continue;
      let availabilityMultiplier = 1;
      if (availabilityPressureByType && variant.typeIndex >= 0) {
        availabilityMultiplier = availabilityPressureByType.get(variant.typeIndex) ?? 1;
      }
      if (availabilityMultiplier <= 0) continue;
      const weightedGain = rawGain * availabilityMultiplier;
      if (weightedGain > bestWeightedGain) {
        bestWeightedGain = weightedGain;
        bestWeightedGainDiscounted = availabilityMultiplier < 1;
      }
    }
    if (bestWeightedGain > 0) {
      score += bestWeightedGain;
      if (bestWeightedGainDiscounted && profileCounters) {
        if (phase === "precompute") {
          profileCounters.precompute.serviceStaticAvailabilityDiscountedGroups++;
        } else {
          profileCounters.servicePhase.availabilityDiscountedGroups++;
        }
      }
    }
  }
  return score;
}

export function computeServiceStaticScore(
  service: ServiceCandidate,
  currentResidentialGroupBoosts: number[],
  residentialScoringGroups: ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>,
  remainingAvail: number[] | null,
  profileCounters?: GreedyProfileCounters
): number {
  return computeServiceGroupedScore(
    service,
    null,
    currentResidentialGroupBoosts,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    remainingAvail,
    profileCounters,
    "precompute"
  );
}

export function computeServiceMarginalScore(
  service: ServiceCandidate,
  occupied: Set<string>,
  currentResidentialGroupBoosts: number[],
  residentialScoringGroups: ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>,
  remainingAvail: number[] | null,
  profileCounters?: GreedyProfileCounters
): number {
  return computeServiceGroupedScore(
    service,
    occupied,
    currentResidentialGroupBoosts,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    remainingAvail,
    profileCounters,
    "servicePhase"
  );
}

export function computeResidentialPopulation(
  params: SolverParams,
  residential: { r: number; c: number; rows: number; cols: number },
  effectZoneSets: Set<string>[],
  bonuses: number[],
  typeIndex: number
): number {
  const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
  let sum = base;
  for (let i = 0; i < effectZoneSets.length; i++) {
    if (isBoostedByService(effectZoneSets[i], residential.r, residential.c, residential.rows, residential.cols)) {
      sum += bonuses[i] ?? 0;
    }
  }
  return Math.min(Math.max(sum, base), max);
}

export function buildResidentialPopulationCache(
  params: SolverParams,
  residentialCandidates: ResidentialCandidatesList,
  effectZoneSets: Set<string>[],
  bonuses: number[],
  profileCounters?: GreedyProfileCounters
): number[] {
  const cache = residentialCandidates.map((candidate) =>
    computeResidentialPopulation(params, candidate, effectZoneSets, bonuses, getCandidateTypeIndex(candidate))
  );
  if (profileCounters) {
    profileCounters.precompute.residentialPopulationCacheEntries += cache.length;
  }
  return cache;
}

export function buildResidentialGroupCellIndex(
  footprintKeysByGroup: readonly (readonly string[])[]
): Map<string, number[]> {
  return buildFootprintCandidateIndexFromKeys(footprintKeysByGroup);
}

export function buildServiceCoverageReverseIndex(
  serviceCandidates: readonly ServiceCandidate[],
  serviceCoverageGroupsByKey: Map<string, number[]>,
  groupCount: number
): number[][] {
  const byGroup = Array.from({ length: groupCount }, () => [] as number[]);
  for (let candidateIndex = 0; candidateIndex < serviceCandidates.length; candidateIndex++) {
    const groupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(serviceCandidates[candidateIndex])) ?? [];
    for (const groupIndex of groupIndices) {
      byGroup[groupIndex].push(candidateIndex);
    }
  }
  return byGroup;
}

export function collectServiceCandidatesForResidentialGroups(
  groupIndices: Iterable<number>,
  serviceCandidateIndicesByGroup: readonly number[][]
): number[] {
  const affected = new Set<number>();
  for (const groupIndex of groupIndices) {
    for (const candidateIndex of serviceCandidateIndicesByGroup[groupIndex] ?? []) {
      affected.add(candidateIndex);
    }
  }
  return [...affected];
}

function getServiceCandidatePrecomputedIndex(
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): number {
  return precomputedIndexes.serviceCandidateIndicesByKey.get(serviceCandidateKey(candidate)) ?? -1;
}

export function getCachedServiceEffectZoneSet(
  G: Grid,
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): Set<string> {
  const precomputedIndex = getServiceCandidatePrecomputedIndex(precomputedIndexes, candidate);
  return precomputedIndex >= 0
    ? precomputedIndexes.serviceEffectZoneSetsByCandidate[precomputedIndex]!
    : buildServiceEffectZoneSet(G, candidate);
}

export function getCachedServiceFootprintKeys(
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): readonly string[] | undefined {
  const precomputedIndex = getServiceCandidatePrecomputedIndex(precomputedIndexes, candidate);
  return precomputedIndex >= 0 ? precomputedIndexes.serviceFootprintKeysByCandidate[precomputedIndex] : undefined;
}
