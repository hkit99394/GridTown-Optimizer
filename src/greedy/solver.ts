/**
 * Greedy solver + optional local search (see ALGORITHM.md)
 */

import { existsSync } from "node:fs";

import { cellKey } from "../core/types.js";
import type { Grid } from "../core/types.js";
import type {
  GreedyOptions,
  GreedyProfileCounters,
  ServicePlacement,
  ServiceCandidate,
  ResidentialPlacement,
  ResidentialCandidate,
  SolverParams,
  Solution,
} from "../core/types.js";
import {
  applyRoadConnectionProbe,
  computeRow0ReachableEmptyFrontier,
  ensureBuildingConnectedToRoads,
  materializeDeferredRoadNetwork,
  probeBuildingConnectedToRoads,
  probeBuildingConnectedToRow0ReachableEmptyFrontier,
  roadSeedRow0RepresentativeCandidates,
  roadsConnectedToRow0,
  isAdjacentToRoads,
  findAvailableRow0RoadCell,
} from "../core/roads.js";
import { applyDeterministicDominanceUpgrades } from "../core/dominanceUpgrades.js";
import {
  enumerateServiceCandidates,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  buildServiceEffectZoneSet,
  overlaps,
  isBoostedByService,
  normalizeServicePlacement,
} from "../core/buildings.js";
import { collectRow0AnchorRefinementSeeds, placementLeavesRow0RoadCellAvailable } from "./row0Anchors.js";
import { getBuildingLimits, getResidentialBaseMax, NO_TYPE_INDEX } from "../core/rules.js";
import { writeSolutionSnapshot } from "../core/solutionSerialization.js";
import { forEachRectangleCell } from "../core/grid.js";

type ResidentialCandidateStat = {
  r: number;
  c: number;
  rows: number;
  cols: number;
  base: number;
  max: number;
  typeIndex: number;
};
type ResidentialScoringVariant = {
  base: number;
  max: number;
  typeIndex: number;
};
type ResidentialScoringGroup = {
  r: number;
  c: number;
  rows: number;
  cols: number;
  variants: ResidentialScoringVariant[];
};
type CapSearchPhase = "full" | "coarse" | "refine";
type CapResult = {
  cap: number;
  phase: CapSearchPhase;
  solution: Solution | null;
  totalPopulation: number;
  serviceCount: number;
};
type MaybeStop = (() => void) | undefined;
interface GreedyPrecomputedIndexes {
  serviceCandidateIndicesByKey: Map<string, number>;
  serviceCandidatesByOccupiedCell: Map<string, number[]>;
  residentialGroupsByOccupiedCell: Map<string, number[]>;
  serviceCandidateIndicesByResidentialGroup: number[][];
  serviceCandidateIndicesByType: number[][] | null;
  residentialCandidatesByOccupiedCell: Map<string, number[]>;
  residentialCandidateIndicesByType: number[][] | null;
}
interface GreedySolveContext {
  grid: Grid;
  params: SolverParams;
  serviceOrder: ServiceCandidate[];
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  anyResidentialCandidates: ResidentialCandidatesList;
  residentialCandidatesForLocal: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  maxResidentials: number | undefined;
  useServiceTypes: boolean;
  useTypes: boolean;
  localSearch: boolean;
  profileCounters?: GreedyProfileCounters;
  maybeStop?: () => void;
}
interface SolveOneOptions {
  maxServices: number | undefined;
  initialRoadSeed?: Set<string>;
  fixedServices?: ServiceCandidate[];
  profileCounters?: GreedyProfileCounters;
}

class GreedyStopError extends Error {
  constructor(readonly bestSolution: Solution | null) {
    super(bestSolution ? "Greedy solve was stopped." : "Greedy solve was stopped before finding a feasible solution.");
  }
}

type RandomSource = () => number;
type NormalizedGreedyOptions = Omit<Required<GreedyOptions>, "randomSeed"> & {
  randomSeed?: number;
};

function createGreedyProfileCounters(): GreedyProfileCounters {
  return {
    precompute: {
      serviceCandidates: 0,
      residentialCandidates: 0,
      residentialScoringGroups: 0,
      residentialScoringVariantsCollapsed: 0,
      serviceCoveragePairs: 0,
      serviceCoverageGroups: 0,
      serviceStaticScores: 0,
      serviceStaticScoreGroupEvaluations: 0,
      serviceStaticAvailabilityDiscountedGroups: 0,
      residentialPopulationCacheEntries: 0,
    },
    attempts: {
      serviceCaps: 0,
      coarseCaps: 0,
      refineCaps: 0,
      capsSkipped: 0,
      restarts: 0,
      restartCaps: 0,
      serviceRefineTrials: 0,
      exhaustiveTrials: 0,
      fixedServiceRealizationTrials: 0,
      localSearchIterations: 0,
    },
    servicePhase: {
      candidateScans: 0,
      canConnectChecks: 0,
      candidateInvalidations: 0,
      typeInvalidations: 0,
      groupedScoreLookups: 0,
      groupedScoreGroupEvaluations: 0,
      availabilityDiscountedGroups: 0,
      scoreDirtyMarks: 0,
      scoreRecomputes: 0,
      placements: 0,
      fixedPlacements: 0,
    },
    residentialPhase: {
      candidateScans: 0,
      canConnectChecks: 0,
      candidateInvalidations: 0,
      typeInvalidations: 0,
      placements: 0,
      populationCacheLookups: 0,
    },
    localSearch: {
      candidateScans: 0,
      canConnectChecks: 0,
      placements: 0,
      moveChecks: 0,
      addChecks: 0,
      serviceRemoveChecks: 0,
      serviceAddChecks: 0,
      serviceSwapChecks: 0,
      serviceNeighborhoodImprovements: 0,
      populationCacheLookups: 0,
    },
    roads: {
      canConnectChecks: 0,
      ensureConnectedCalls: 0,
      probeCalls: 0,
      probeReuses: 0,
      row0Checks: 0,
      fallbackRoads: 0,
      deferredFrontierRecomputes: 0,
      deferredReconstructionSteps: 0,
      deferredReconstructionFailures: 0,
    },
  };
}

function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSeed(baseSeed: number, cap: number, restartIndex: number): number {
  let mixed = (baseSeed ^ Math.imul(cap + 1, 0x9e3779b1)) >>> 0;
  mixed = (mixed ^ Math.imul(restartIndex + 1, 0x85ebca6b)) >>> 0;
  return mixed >>> 0;
}

function shuffle<T>(a: T[], random: RandomSource = Math.random): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dedupeSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

const SERVICE_REFINE_FIXED_SERVICE_EVALUATION = {
  maxOrders: 6,
  maxSeededOrders: 2,
  maxSeeds: 4,
};

const LOCAL_SEARCH_SERVICE_NEIGHBORHOOD = {
  maxIterations: 2,
  candidateLimit: 6,
  maxRemoveTrialsPerIteration: 4,
  maxAddTrialsPerIteration: 8,
  maxSwapTrialsPerIteration: 12,
  maxRealizationAttemptsPerIteration: 3,
};

const EXHAUSTIVE_FIXED_SERVICE_EVALUATION = {
  maxOrders: 4,
  maxSeededOrders: 1,
  maxSeeds: 3,
};

function inclusiveCapBand(center: number, upper: number, radius: number): number[] {
  const out: number[] = [];
  for (let cap = Math.max(0, center - radius); cap <= Math.min(upper, center + radius); cap++) {
    out.push(cap);
  }
  return out;
}

function buildAdaptiveServiceCapPlan(inferredUpper: number): {
  coarseCaps: number[];
  refineCaps: number[];
  usesAdaptiveSearch: boolean;
} {
  if (inferredUpper <= 6) {
    return {
      coarseCaps: Array.from({ length: inferredUpper + 1 }, (_, index) => index),
      refineCaps: [],
      usesAdaptiveSearch: false,
    };
  }

  return {
    coarseCaps: dedupeSortedNumbers([
      0,
      inferredUpper,
      Math.floor(inferredUpper / 4),
      Math.floor(inferredUpper / 2),
      Math.ceil((3 * inferredUpper) / 4),
    ]),
    refineCaps: [],
    usesAdaptiveSearch: true,
  };
}

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

function isTypedResidentialCandidate(
  candidate: ResidentialPlacement | ResidentialCandidate
): candidate is ResidentialCandidate {
  return "typeIndex" in candidate;
}

function getCandidateTypeIndex(candidate: ResidentialPlacement | ResidentialCandidate): number {
  return isTypedResidentialCandidate(candidate) ? candidate.typeIndex : NO_TYPE_INDEX;
}

type ResidentialCandidatesList = (ResidentialPlacement | ResidentialCandidate)[];
type RoadConnectionProbe = NonNullable<ReturnType<typeof probeBuildingConnectedToRoads>>;
type DeferredRoadFrontierProbe = NonNullable<ReturnType<typeof probeBuildingConnectedToRow0ReachableEmptyFrontier>>;
type ConnectivityProbe =
  | { kind: "explicit"; roadCost: number; roadProbe: RoadConnectionProbe }
  | { kind: "deferred"; roadCost: number; frontierProbe: DeferredRoadFrontierProbe };
type TieBreakProbe = ConnectivityProbe | RoadConnectionProbe;
type ResidentialCandidateLike = ResidentialPlacement | ResidentialCandidate;

function getGreedyOptions(params: SolverParams): NormalizedGreedyOptions {
  const greedy = params.greedy ?? {};
  const randomSeed = typeof greedy.randomSeed === "number" && Number.isInteger(greedy.randomSeed)
    ? greedy.randomSeed
    : undefined;
  return {
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    localSearchServiceMoves: greedy.localSearchServiceMoves ?? true,
    localSearchServiceCandidateLimit: greedy.localSearchServiceCandidateLimit ?? 6,
    deferRoadCommitment: greedy.deferRoadCommitment ?? false,
    ...(randomSeed !== undefined ? { randomSeed } : {}),
    profile: greedy.profile ?? false,
    restarts: greedy.restarts ?? params.restarts ?? 1,
    serviceRefineIterations: greedy.serviceRefineIterations ?? params.serviceRefineIterations ?? 2,
    serviceRefineCandidateLimit: greedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit ?? 40,
    exhaustiveServiceSearch: greedy.exhaustiveServiceSearch ?? params.exhaustiveServiceSearch ?? false,
    serviceExactPoolLimit: greedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit ?? 22,
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations ?? 12000,
    stopFilePath: greedy.stopFilePath ?? "",
    snapshotFilePath: greedy.snapshotFilePath ?? "",
  };
}

function serviceCandidateKey(candidate: ServiceCandidate): string {
  return [candidate.r, candidate.c, candidate.rows, candidate.cols, candidate.range, candidate.typeIndex, candidate.bonus].join(
    ","
  );
}

function sameServicePlacement(a: ServicePlacement, b: ServicePlacement): boolean {
  const sa = normalizeServicePlacement(a);
  const sb = normalizeServicePlacement(b);
  return sa.r === sb.r && sa.c === sb.c && sa.rows === sb.rows && sa.cols === sb.cols && sa.range === sb.range;
}

function materializeServicePlacement(candidate: ServiceCandidate): Required<ServicePlacement> {
  return {
    r: candidate.r,
    c: candidate.c,
    rows: candidate.rows,
    cols: candidate.cols,
    range: candidate.range,
  };
}

function materializeChosenServiceCandidate(solution: Solution, index: number): ServiceCandidate {
  const placement = normalizeServicePlacement(solution.services[index]);
  return {
    ...placement,
    typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
    bonus: solution.servicePopulationIncreases[index] ?? 0,
  };
}

function stableServicePlacementKey(candidate: ServicePlacement | ServiceCandidate): string {
  const placement = normalizeServicePlacement(candidate);
  return [
    placement.r,
    placement.c,
    placement.rows,
    placement.cols,
    placement.range,
    "typeIndex" in candidate ? candidate.typeIndex : NO_TYPE_INDEX,
    "bonus" in candidate ? candidate.bonus : 0,
  ].join(",");
}

function stableResidentialPlacementKey(
  candidate: ResidentialPlacement | ResidentialCandidate
): string {
  return [
    candidate.r,
    candidate.c,
    candidate.rows,
    candidate.cols,
    getCandidateTypeIndex(candidate),
  ].join(",");
}

function forEachPlacementCell(
  placement: { r: number; c: number; rows: number; cols: number },
  visit: (key: string) => void
): void {
  forEachRectangleCell(placement.r, placement.c, placement.rows, placement.cols, (r, c) => visit(cellKey(r, c)));
}

function addPlacementCellsToSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.add(key));
}

function deletePlacementCellsFromSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.delete(key));
}

function isBetterSearchSolution(candidate: Solution | null, incumbent: Solution | null): boolean {
  if (!candidate) return false;
  if (!incumbent) return true;
  if (candidate.totalPopulation !== incumbent.totalPopulation) {
    return candidate.totalPopulation > incumbent.totalPopulation;
  }
  if (candidate.roads.size !== incumbent.roads.size) {
    return candidate.roads.size < incumbent.roads.size;
  }
  const candidateServiceKey = candidate.services.map(stableServicePlacementKey).join("|");
  const incumbentServiceKey = incumbent.services.map(stableServicePlacementKey).join("|");
  if (candidateServiceKey !== incumbentServiceKey) {
    return candidateServiceKey < incumbentServiceKey;
  }
  const candidateResidentialKey = candidate.residentials.map(stableResidentialPlacementKey).join("|");
  const incumbentResidentialKey = incumbent.residentials.map(stableResidentialPlacementKey).join("|");
  if (candidateResidentialKey !== incumbentResidentialKey) {
    return candidateResidentialKey < incumbentResidentialKey;
  }
  return [...candidate.roads].sort().join("|") < [...incumbent.roads].sort().join("|");
}

function rectanglesOverlap(
  a: { r: number; c: number; rows: number; cols: number },
  b: { r: number; c: number; rows: number; cols: number }
): boolean {
  return a.r < b.r + b.rows && a.r + a.rows > b.r && a.c < b.c + b.cols && a.c + a.cols > b.c;
}

function marginalPopulationGain(base: number, max: number, currentBoost: number, extraBoost: number): number {
  const currentPopulation = Math.min(base + currentBoost, max);
  const boostedPopulation = Math.min(base + currentBoost + extraBoost, max);
  return Math.max(0, boostedPopulation - currentPopulation);
}

function residentialScoringGroupKey(
  residential: Pick<ResidentialCandidateStat, "r" | "c" | "rows" | "cols">
): string {
  return [residential.r, residential.c, residential.rows, residential.cols].join(",");
}

function buildResidentialScoringGroups(
  residentialCandidateStats: ResidentialCandidateStat[],
  profileCounters?: GreedyProfileCounters
): ResidentialScoringGroup[] {
  const groupsByKey = new Map<string, ResidentialScoringGroup>();
  for (const residential of residentialCandidateStats) {
    const key = residentialScoringGroupKey(residential);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        variants: [],
      };
      groupsByKey.set(key, group);
    }
    group.variants.push({
      base: residential.base,
      max: residential.max,
      typeIndex: residential.typeIndex,
    });
  }

  const groups = [...groupsByKey.values()];
  for (const group of groups) {
    group.variants.sort(
      (a, b) => b.max - a.max || b.base - a.base || a.typeIndex - b.typeIndex
    );
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

function buildServiceCoverageIndex(
  serviceCandidates: ServiceCandidate[],
  residentialScoringGroups: ResidentialScoringGroup[],
  profileCounters?: GreedyProfileCounters
): Map<string, number[]> {
  const coverageByKey = new Map<string, number[]>();
  for (const service of serviceCandidates) {
    const key = serviceCandidateKey(service);
    const effectBounds = {
      r: service.r - service.range,
      c: service.c - service.range,
      rows: service.rows + 2 * service.range,
      cols: service.cols + 2 * service.range,
    };
    const footprint = { r: service.r, c: service.c, rows: service.rows, cols: service.cols };
    const coveredGroupIndices: number[] = [];
    for (let index = 0; index < residentialScoringGroups.length; index++) {
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
        base: variant.base,
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
          weightedGain > chosenWeightedGain
          || (weightedGain === chosenWeightedGain && (
            option.gain > chosen.gain
            || (option.gain === chosen.gain && (
              option.max > chosen.max
              || (option.max === chosen.max && (
                option.base > chosen.base
                || (option.base === chosen.base && option.typeIndex < chosen.typeIndex)
              ))
            ))
          ))
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

function computeServiceStaticScore(
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

function computeServiceMarginalScore(
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

function countRow0FootprintCells(placement: { r: number; c: number; rows: number; cols: number }): number {
  return placement.r === 0 ? placement.cols : 0;
}

function footprintArea(placement: { rows: number; cols: number }): number {
  return placement.rows * placement.cols;
}

function footprintPerimeter(placement: { rows: number; cols: number }): number {
  return 2 * (placement.rows + placement.cols);
}

function compareServiceTieBreaks(
  a: ServiceCandidate,
  aProbe: TieBreakProbe,
  b: ServiceCandidate,
  bProbe: TieBreakProbe
): number {
  const aRow0Cells = countRow0FootprintCells(a);
  const bRow0Cells = countRow0FootprintCells(b);
  if (aRow0Cells !== bRow0Cells) return aRow0Cells - bRow0Cells;

  const aRoadCost = "roadCost" in aProbe ? aProbe.roadCost : (aProbe.path?.length ?? 0);
  const bRoadCost = "roadCost" in bProbe ? bProbe.roadCost : (bProbe.path?.length ?? 0);
  if (aRoadCost !== bRoadCost) return aRoadCost - bRoadCost;

  const aArea = footprintArea(a);
  const bArea = footprintArea(b);
  if (aArea !== bArea) return aArea - bArea;

  const aPerimeter = footprintPerimeter(a);
  const bPerimeter = footprintPerimeter(b);
  if (aPerimeter !== bPerimeter) return aPerimeter - bPerimeter;

  if (a.r !== b.r) return a.r - b.r;
  if (a.c !== b.c) return a.c - b.c;
  if (a.rows !== b.rows) return a.rows - b.rows;
  if (a.cols !== b.cols) return a.cols - b.cols;
  if (a.range !== b.range) return b.range - a.range;
  if (a.bonus !== b.bonus) return b.bonus - a.bonus;

  return serviceCandidateKey(a).localeCompare(serviceCandidateKey(b));
}

function residentialCandidateKey(candidate: ResidentialCandidateLike): string {
  return [getCandidateTypeIndex(candidate), candidate.r, candidate.c, candidate.rows, candidate.cols].join(",");
}

function compareResidentialTieBreaks(
  params: SolverParams,
  a: ResidentialCandidateLike,
  aProbe: TieBreakProbe,
  b: ResidentialCandidateLike,
  bProbe: TieBreakProbe
): number {
  const aRoadCost = "roadCost" in aProbe ? aProbe.roadCost : (aProbe.path?.length ?? 0);
  const bRoadCost = "roadCost" in bProbe ? bProbe.roadCost : (bProbe.path?.length ?? 0);
  if (aRoadCost !== bRoadCost) return aRoadCost - bRoadCost;

  const aArea = footprintArea(a);
  const bArea = footprintArea(b);
  if (aArea !== bArea) return aArea - bArea;

  const aPerimeter = footprintPerimeter(a);
  const bPerimeter = footprintPerimeter(b);
  if (aPerimeter !== bPerimeter) return aPerimeter - bPerimeter;

  if (a.r !== b.r) return a.r - b.r;
  if (a.c !== b.c) return a.c - b.c;
  const aTypeIndex = getCandidateTypeIndex(a);
  const bTypeIndex = getCandidateTypeIndex(b);
  const aStats = getResidentialBaseMax(params, a.rows, a.cols, aTypeIndex);
  const bStats = getResidentialBaseMax(params, b.rows, b.cols, bTypeIndex);
  if (aStats.max !== bStats.max) return bStats.max - aStats.max;
  if (aStats.base !== bStats.base) return bStats.base - aStats.base;

  return residentialCandidateKey(a).localeCompare(residentialCandidateKey(b));
}

function computeResidentialPopulation(
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

function buildResidentialPopulationCache(
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

type ActiveCandidatePool = {
  activeIndices: number[];
  positions: number[];
};

function createActiveCandidatePool(candidateCount: number): ActiveCandidatePool {
  return {
    activeIndices: Array.from({ length: candidateCount }, (_, index) => index),
    positions: Array.from({ length: candidateCount }, (_, index) => index),
  };
}

function isCandidateActive(pool: ActiveCandidatePool, candidateIndex: number): boolean {
  return (pool.positions[candidateIndex] ?? -1) >= 0;
}

function removeActiveCandidate(pool: ActiveCandidatePool, candidateIndex: number): boolean {
  const position = pool.positions[candidateIndex] ?? -1;
  if (position < 0) return false;
  const lastPosition = pool.activeIndices.length - 1;
  const lastCandidateIndex = pool.activeIndices[lastPosition];
  pool.activeIndices[position] = lastCandidateIndex;
  pool.positions[lastCandidateIndex] = position;
  pool.activeIndices.pop();
  pool.positions[candidateIndex] = -1;
  return true;
}

function buildFootprintCandidateIndex<T>(
  candidates: readonly T[],
  visitFootprintKeys: (candidate: T, visit: (cellKey: string) => void) => void
): Map<string, number[]> {
  const byCell = new Map<string, number[]>();
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    visitFootprintKeys(candidates[candidateIndex], (cellKey) => {
      const existing = byCell.get(cellKey);
      if (existing) {
        existing.push(candidateIndex);
      } else {
        byCell.set(cellKey, [candidateIndex]);
      }
    });
  }
  return byCell;
}

function buildResidentialGroupCellIndex(
  groups: ResidentialScoringGroup[]
): Map<string, number[]> {
  return buildFootprintCandidateIndex(groups, (group, visit) =>
    forEachRectangleCell(group.r, group.c, group.rows, group.cols, (r, c) => visit(cellKey(r, c)))
  );
}

function buildServiceCoverageReverseIndex(
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

function buildTypedCandidateIndex(
  candidateCount: number,
  getTypeIndex: (candidateIndex: number) => number,
  typeCount: number
): number[][] {
  const byType = Array.from({ length: typeCount }, () => [] as number[]);
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const typeIndex = getTypeIndex(candidateIndex);
    if (typeIndex >= 0 && typeIndex < typeCount) {
      byType[typeIndex].push(candidateIndex);
    }
  }
  return byType;
}

function collectIndexedCandidatesForCells(
  cellKeys: Iterable<string>,
  indexByCell: Map<string, number[]>
): number[] {
  const affected = new Set<number>();
  for (const cellKey of cellKeys) {
    for (const candidateIndex of indexByCell.get(cellKey) ?? []) {
      affected.add(candidateIndex);
    }
  }
  return [...affected];
}

function mapGlobalCandidateIndicesToLocal(
  candidateIndices: Iterable<number>,
  globalToLocalCandidateIndices: readonly number[]
): number[] {
  const mapped = new Set<number>();
  for (const candidateIndex of candidateIndices) {
    const localIndex = globalToLocalCandidateIndices[candidateIndex] ?? -1;
    if (localIndex >= 0) mapped.add(localIndex);
  }
  return [...mapped];
}

function invalidateCandidatePoolEntries(
  pool: ActiveCandidatePool,
  candidateIndices: Iterable<number>
): number {
  let invalidated = 0;
  for (const candidateIndex of candidateIndices) {
    if (removeActiveCandidate(pool, candidateIndex)) {
      invalidated += 1;
    }
  }
  return invalidated;
}

function markServiceCandidatesDirty(
  candidateIndices: Iterable<number>,
  dirtyScores: boolean[],
  activePool: ActiveCandidatePool
): number {
  let marked = 0;
  for (const candidateIndex of candidateIndices) {
    if (!isCandidateActive(activePool, candidateIndex) || dirtyScores[candidateIndex]) continue;
    dirtyScores[candidateIndex] = true;
    marked += 1;
  }
  return marked;
}

function collectServiceCandidatesForResidentialGroups(
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

function collectNewlyOccupiedKeysForPlacement(
  occupied: Set<string>,
  probe: RoadConnectionProbe | null,
  placement: { r: number; c: number; rows: number; cols: number }
): string[] {
  const newlyOccupied = new Set<string>();
  if (probe?.path) {
    for (const [r, c] of probe.path) {
      const key = cellKey(r, c);
      if (!occupied.has(key)) newlyOccupied.add(key);
    }
  }
  forEachPlacementCell(placement, (key) => {
    if (!occupied.has(key)) newlyOccupied.add(key);
  });
  return [...newlyOccupied];
}

function solveOne(
  context: GreedySolveContext,
  options: SolveOneOptions
): Solution | null {
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
    maybeStop,
  } = context;
  const {
    maxServices,
    initialRoadSeed,
    fixedServices,
    profileCounters,
  } = options;
  const useDeferredRoadCommitment = (params.greedy?.deferRoadCommitment ?? false) && !fixedServices;
  let roads = useDeferredRoadCommitment ? new Set<string>() : new Set<string>(initialRoadSeed ?? []);
  const occupied = new Set<string>();
  for (const k of roads) occupied.add(k);
  let deferredFrontier = useDeferredRoadCommitment
    ? computeRow0ReachableEmptyFrontier(G, occupied)
    : null;
  if (useDeferredRoadCommitment && profileCounters) {
    profileCounters.roads.deferredFrontierRecomputes++;
  }
  const remainingServiceAvail = useServiceTypes ? params.serviceTypes!.map((t) => t.avail) : null;
  const remainingAvail = useTypes ? params.residentialTypes!.map((t) => t.avail) : null;

  const services: ServicePlacement[] = [];
  const serviceTypeIndices: number[] = [];
  const serviceBonuses: number[] = [];
  const effectZones: Set<string>[] = [];
  const currentResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  const serviceSource = fixedServices ?? serviceOrder;
  const probeRoadConnection = (
    snapshotOccupied: Set<string>,
    r: number,
    c: number,
    rows: number,
    cols: number
  ): ConnectivityProbe | null => {
    if (profileCounters) profileCounters.roads.canConnectChecks++;
    if (profileCounters) profileCounters.roads.probeCalls++;
    if (useDeferredRoadCommitment) {
      const frontierProbe = deferredFrontier
        ? probeBuildingConnectedToRow0ReachableEmptyFrontier(G, deferredFrontier, r, c, rows, cols)
        : null;
      if (!frontierProbe) return null;
      return { kind: "deferred", roadCost: frontierProbe.distance, frontierProbe };
    }
    const roadProbe = probeBuildingConnectedToRoads(G, roads, snapshotOccupied, r, c, rows, cols);
    if (!roadProbe) return null;
    return { kind: "explicit", roadCost: roadProbe.path?.length ?? 0, roadProbe };
  };
  const serviceOrderGlobalCandidateIndices = !fixedServices
    ? serviceSource.map((candidate) => precomputedIndexes.serviceCandidateIndicesByKey.get(serviceCandidateKey(candidate)) ?? -1)
    : null;
  const serviceGlobalToLocalCandidateIndices = !fixedServices && serviceOrderGlobalCandidateIndices
    ? Array.from({ length: serviceOrder.length }, () => -1)
    : null;
  if (!fixedServices && serviceOrderGlobalCandidateIndices && serviceGlobalToLocalCandidateIndices) {
    for (let localIndex = 0; localIndex < serviceOrderGlobalCandidateIndices.length; localIndex++) {
      const globalIndex = serviceOrderGlobalCandidateIndices[localIndex];
      if (globalIndex >= 0) {
        serviceGlobalToLocalCandidateIndices[globalIndex] = localIndex;
      }
    }
  }
  const serviceActivePool = !fixedServices ? createActiveCandidatePool(serviceSource.length) : null;
  const serviceScoreCache = !fixedServices ? Array.from({ length: serviceSource.length }, () => 0) : null;
  const serviceScoreDirty = !fixedServices ? Array.from({ length: serviceSource.length }, () => true) : null;
  if (serviceActivePool && serviceGlobalToLocalCandidateIndices && occupied.size > 0) {
    const invalidated = invalidateCandidatePoolEntries(
      serviceActivePool,
      mapGlobalCandidateIndicesToLocal(
        collectIndexedCandidatesForCells(occupied, precomputedIndexes.serviceCandidatesByOccupiedCell),
        serviceGlobalToLocalCandidateIndices
      )
    );
    if (profileCounters) profileCounters.servicePhase.candidateInvalidations += invalidated;
  }
  if (serviceActivePool && serviceGlobalToLocalCandidateIndices && useServiceTypes && remainingServiceAvail && precomputedIndexes.serviceCandidateIndicesByType) {
    for (let typeIndex = 0; typeIndex < remainingServiceAvail.length; typeIndex++) {
      if (remainingServiceAvail[typeIndex] > 0) continue;
      const invalidated = invalidateCandidatePoolEntries(
        serviceActivePool,
        mapGlobalCandidateIndicesToLocal(
          precomputedIndexes.serviceCandidateIndicesByType[typeIndex] ?? [],
          serviceGlobalToLocalCandidateIndices
        )
      );
      if (profileCounters) {
        profileCounters.servicePhase.candidateInvalidations += invalidated;
        profileCounters.servicePhase.typeInvalidations += invalidated;
      }
    }
  }
  if (fixedServices) {
    for (const s of serviceSource) {
      maybeStop?.();
      if (maxServices !== undefined && services.length >= maxServices) break;
      if (profileCounters) profileCounters.servicePhase.fixedPlacements++;
      const placement = materializeServicePlacement(s);
      if (useServiceTypes && remainingServiceAvail) {
        if (remainingServiceAvail[s.typeIndex] <= 0) {
          return null;
        }
      }
      if (roads.size === 0 && !placementLeavesRow0RoadCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return null;
      }
      if (overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return null;
      }
      if (profileCounters) profileCounters.servicePhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, placement.r, placement.c, placement.rows, placement.cols);
      if (!probe) {
        return null;
      }
      if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
      if (probe.kind !== "explicit") {
        return null;
      }
      applyRoadConnectionProbe(roads, probe.roadProbe);
      for (const k of roads) occupied.add(k);
      addPlacementCellsToSet(occupied, placement);
      services.push(placement);
      serviceTypeIndices.push(s.typeIndex);
      serviceBonuses.push(s.bonus);
      effectZones.push(buildServiceEffectZoneSet(G, placement));
      const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(s)) ?? [];
      for (const groupIndex of coveredGroupIndices) {
        currentResidentialGroupBoosts[groupIndex] += s.bonus;
      }
      if (useServiceTypes && remainingServiceAvail) remainingServiceAvail[s.typeIndex]--;
      if (profileCounters) profileCounters.servicePhase.placements++;
    }
  } else {
    for (;;) {
      maybeStop?.();
      if (maxServices !== undefined && services.length >= maxServices) break;
      if (
        !serviceActivePool
        || !serviceScoreCache
        || !serviceScoreDirty
        || !serviceOrderGlobalCandidateIndices
        || !serviceGlobalToLocalCandidateIndices
      ) {
        break;
      }

      let bestCandidate: ServiceCandidate | null = null;
      let bestCandidateIndex = -1;
      let bestProbe: ConnectivityProbe | null = null;
      let bestScore = 0;
      for (const candidateIndex of serviceActivePool.activeIndices) {
        maybeStop?.();
        if (profileCounters) profileCounters.servicePhase.candidateScans++;
        const service = serviceSource[candidateIndex];
        const globalCandidateIndex = serviceOrderGlobalCandidateIndices[candidateIndex] ?? -1;
        if (globalCandidateIndex < 0) continue;
        const placement = materializeServicePlacement(service);
        if (useServiceTypes && remainingServiceAvail && remainingServiceAvail[service.typeIndex] <= 0) continue;
        if (roads.size === 0) {
          if (profileCounters) profileCounters.roads.row0Checks++;
          if (!placementLeavesRow0RoadCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) continue;
        }
        if (profileCounters) profileCounters.servicePhase.canConnectChecks++;
        const probe = probeRoadConnection(occupied, placement.r, placement.c, placement.rows, placement.cols);
        if (!probe) continue;
        if (serviceScoreDirty[candidateIndex]) {
          serviceScoreCache[candidateIndex] = computeServiceMarginalScore(
            service,
            occupied,
            currentResidentialGroupBoosts,
            residentialScoringGroups,
            serviceCoverageGroupsByKey,
            remainingAvail,
            profileCounters
          );
          serviceScoreDirty[candidateIndex] = false;
          if (profileCounters) profileCounters.servicePhase.scoreRecomputes++;
        }
        const score = serviceScoreCache[candidateIndex] ?? 0;
        if (
          score > bestScore
          || (score === bestScore && score > 0 && bestCandidate !== null
            && bestProbe !== null
            && compareServiceTieBreaks(service, probe, bestCandidate, bestProbe) < 0)
        ) {
          bestCandidate = service;
          bestCandidateIndex = candidateIndex;
          bestScore = score;
          bestProbe = probe;
        }
      }

      if (!bestCandidate || bestCandidateIndex < 0 || bestScore <= 0) break;

      const placement = materializeServicePlacement(bestCandidate);
      const newlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
        occupied,
        useDeferredRoadCommitment ? null : bestProbe?.kind === "explicit" ? bestProbe.roadProbe : null,
        placement
      );
      if (!bestProbe) {
        break;
      }
      if (!useDeferredRoadCommitment) {
        if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
        if (bestProbe.kind !== "explicit") {
          break;
        }
        if (profileCounters) profileCounters.roads.probeReuses++;
        applyRoadConnectionProbe(roads, bestProbe.roadProbe);
      }
      for (const k of newlyOccupiedKeys) occupied.add(k);
      if (useDeferredRoadCommitment) {
        deferredFrontier = computeRow0ReachableEmptyFrontier(G, occupied);
        if (profileCounters) profileCounters.roads.deferredFrontierRecomputes++;
      }
      services.push(placement);
      serviceTypeIndices.push(bestCandidate.typeIndex);
      serviceBonuses.push(bestCandidate.bonus);
      effectZones.push(buildServiceEffectZoneSet(G, placement));
      const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(bestCandidate)) ?? [];
      for (const groupIndex of coveredGroupIndices) {
        currentResidentialGroupBoosts[groupIndex] += bestCandidate.bonus;
      }
      if (serviceGlobalToLocalCandidateIndices) {
        const invalidated = invalidateCandidatePoolEntries(
          serviceActivePool,
          mapGlobalCandidateIndicesToLocal(
            collectIndexedCandidatesForCells(newlyOccupiedKeys, precomputedIndexes.serviceCandidatesByOccupiedCell),
            serviceGlobalToLocalCandidateIndices
          )
        );
        if (profileCounters) profileCounters.servicePhase.candidateInvalidations += invalidated;
      }
      if (serviceGlobalToLocalCandidateIndices && serviceScoreDirty) {
        const blockedGroupIndices = collectIndexedCandidatesForCells(
          newlyOccupiedKeys,
          precomputedIndexes.residentialGroupsByOccupiedCell
        );
        const affectedGroupIndices = new Set<number>(coveredGroupIndices);
        for (const groupIndex of blockedGroupIndices) affectedGroupIndices.add(groupIndex);
        const dirtyMarks = markServiceCandidatesDirty(
          mapGlobalCandidateIndicesToLocal(
            collectServiceCandidatesForResidentialGroups(
              affectedGroupIndices,
              precomputedIndexes.serviceCandidateIndicesByResidentialGroup
            ),
            serviceGlobalToLocalCandidateIndices
          ),
          serviceScoreDirty,
          serviceActivePool
        );
        if (profileCounters) profileCounters.servicePhase.scoreDirtyMarks += dirtyMarks;
      }
      if (useServiceTypes && remainingServiceAvail) {
        remainingServiceAvail[bestCandidate.typeIndex]--;
        if (remainingServiceAvail[bestCandidate.typeIndex] <= 0 && serviceGlobalToLocalCandidateIndices && precomputedIndexes.serviceCandidateIndicesByType) {
          const invalidated = invalidateCandidatePoolEntries(
            serviceActivePool,
            mapGlobalCandidateIndicesToLocal(
              precomputedIndexes.serviceCandidateIndicesByType[bestCandidate.typeIndex] ?? [],
              serviceGlobalToLocalCandidateIndices
            )
          );
          if (profileCounters) {
            profileCounters.servicePhase.candidateInvalidations += invalidated;
            profileCounters.servicePhase.typeInvalidations += invalidated;
          }
        }
      }
      if (profileCounters) profileCounters.servicePhase.placements++;
    }
  }
  if (fixedServices && services.length !== fixedServices.length) return null;

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
    for (const candidateIndex of residentialActivePool.activeIndices) {
      const cand = anyResidentialCandidates[candidateIndex];
      maybeStop?.();
      if (profileCounters) profileCounters.residentialPhase.candidateScans++;
      if (roads.size === 0) {
        if (profileCounters) profileCounters.roads.row0Checks++;
        if (!placementLeavesRow0RoadCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      }
      if (profileCounters) profileCounters.residentialPhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, cand.r, cand.c, cand.rows, cand.cols);
      if (!probe) continue;
      if (profileCounters) profileCounters.residentialPhase.populationCacheLookups++;
      const pop = residentialPopulationCache[candidateIndex] ?? -1;
      if (
        pop > bestPop
        || (pop === bestPop && pop >= 0 && best !== null && bestProbe !== null
          && compareResidentialTieBreaks(params, cand, probe, best, bestProbe) < 0)
      ) {
        bestPop = pop;
        best = cand;
        bestCandidateIndex = candidateIndex;
        bestProbe = probe;
      }
    }
    if (best == null || bestCandidateIndex < 0 || bestPop < 0) break;
    const newlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
      occupied,
      useDeferredRoadCommitment ? null : bestProbe?.kind === "explicit" ? bestProbe.roadProbe : null,
      best
    );
    if (!bestProbe) break;
    if (!useDeferredRoadCommitment) {
      if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
      if (bestProbe.kind !== "explicit") break;
      if (profileCounters) profileCounters.roads.probeReuses++;
      applyRoadConnectionProbe(roads, bestProbe.roadProbe);
    }
    for (const k of newlyOccupiedKeys) occupied.add(k);
    if (useDeferredRoadCommitment) {
      deferredFrontier = computeRow0ReachableEmptyFrontier(G, occupied);
      if (profileCounters) profileCounters.roads.deferredFrontierRecomputes++;
    }
    residentials.push({ r: best.r, c: best.c, rows: best.rows, cols: best.cols });
    const bestTypeIndex = getCandidateTypeIndex(best);
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

  let totalPopulation = populations.reduce((a, b) => a + b, 0);

  if (useDeferredRoadCommitment) {
    const occupiedBuildings = new Set<string>();
    for (const s of services) addPlacementCellsToSet(occupiedBuildings, s);
    for (const r of residentials) addPlacementCellsToSet(occupiedBuildings, r);
    const materializedRoads = materializeDeferredRoadNetwork(
      G,
      initialRoadSeed,
      occupiedBuildings,
      [
        ...services.map((service) => normalizeServicePlacement(service)),
        ...residentials,
      ]
    );
    if (!materializedRoads) {
      if (profileCounters) profileCounters.roads.deferredReconstructionFailures++;
      return null;
    }
    roads = materializedRoads;
    occupied.clear();
    for (const key of occupiedBuildings) occupied.add(key);
    for (const key of roads) occupied.add(key);
    if (profileCounters) {
      profileCounters.roads.deferredReconstructionSteps += services.length + residentials.length;
    }
  }

  if (localSearch) {
    totalPopulation = localSearchImprove(
      G,
      roads,
      occupied,
      services,
      effectZones,
      serviceBonuses,
      residentials,
      residentialTypeIndices,
      populations,
      totalPopulation,
      residentialCandidatesForLocal,
      residentialPopulationCacheForLocal,
      params,
      useTypes ? remainingAvail : null,
      maxResidentials,
      profileCounters,
      maybeStop
    );
  }

  const occupiedBuildings = new Set<string>();
  for (const s of services) addPlacementCellsToSet(occupiedBuildings, s);
  for (const r of residentials) addPlacementCellsToSet(occupiedBuildings, r);

  // Keep only roads connected to row 0, then re-ensure each placed building
  // is connected to that network (robust against any stray/disconnected roads).
  const roadsValid = roadsConnectedToRow0(G, roads);
  if (roadsValid.size === 0) {
    const fallbackRoad = findAvailableRow0RoadCell(G, occupiedBuildings);
    if (!fallbackRoad) return null;
    if (profileCounters) profileCounters.roads.fallbackRoads++;
    roadsValid.add(fallbackRoad);
  }

  for (const s of services) {
    const normalized = normalizeServicePlacement(s);
    if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
    ensureBuildingConnectedToRoads(G, roadsValid, occupiedBuildings, normalized.r, normalized.c, normalized.rows, normalized.cols);
  }
  for (const r of residentials) {
    if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
    ensureBuildingConnectedToRoads(G, roadsValid, occupiedBuildings, r.r, r.c, r.rows, r.cols);
  }

  // No road may overlap any building cell.
  for (const k of occupiedBuildings) {
    if (roadsValid.has(k)) {
      throw new Error(`Invalid solution: road overlaps building at cell ${k}.`);
    }
  }

  // Roads must be one connected component that is reachable from row 0.
  const roadsReachable = roadsConnectedToRow0(G, roadsValid);
  if (roadsReachable.size !== roadsValid.size) {
    throw new Error("Invalid solution: found road cells not connected to row 0.");
  }

  // Hard post-condition: every building must be adjacent to at least one road cell.
  for (const s of services) {
    const normalized = normalizeServicePlacement(s);
    if (!isAdjacentToRoads(roadsValid, normalized.r, normalized.c, normalized.rows, normalized.cols)) {
      throw new Error(`Invalid solution: service at (${s.r}, ${s.c}) is not connected to roads.`);
    }
  }
  for (const r of residentials) {
    if (!isAdjacentToRoads(roadsValid, r.r, r.c, r.rows, r.cols)) {
      throw new Error(
        `Invalid solution: residential at (${r.r}, ${r.c}) size ${r.rows}x${r.cols} is not connected to roads.`
      );
    }
  }
  return {
    optimizer: "greedy",
    roads: roadsValid,
    services,
    serviceTypeIndices,
    servicePopulationIncreases: serviceBonuses,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation,
  };
}

export function solveGreedy(G: Grid, params: SolverParams): Solution {
  const {
    localSearch,
    localSearchServiceMoves,
    localSearchServiceCandidateLimit,
    deferRoadCommitment,
    randomSeed,
    profile,
    restarts,
    serviceRefineIterations,
    serviceRefineCandidateLimit,
    exhaustiveServiceSearch,
    serviceExactPoolLimit,
    serviceExactMaxCombinations,
    stopFilePath,
    snapshotFilePath,
  } = getGreedyOptions(params);
  const profileCounters = profile ? createGreedyProfileCounters() : undefined;
  const { maxServices, maxResidentials } = getBuildingLimits(params);
  const useServiceTypes = (params.serviceTypes?.length ?? 0) > 0;
  const useTypes = (params.residentialTypes?.length ?? 0) > 0;
  const residentialCandidatesLegacy = useTypes ? [] : enumerateResidentialCandidates(G);
  const residentialCandidatesFromTypes = useTypes ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes!) : [];
  const anyResidentialCandidates = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  const residentialCandidatesForLocal = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  let best: Solution | null = null;
  let stopCounter = 0;

  const maybeStop = (): void => {
    if (!stopFilePath) return;
    stopCounter += 1;
    if (stopCounter % 128 !== 0) return;
    if (!existsSync(stopFilePath)) return;
    throw new GreedyStopError(best ? { ...best, stoppedByUser: true } : null);
  };

  const updateBest = (candidate: Solution | null): void => {
    if (!candidate) return;
    if (!best || candidate.totalPopulation > best.totalPopulation) {
      best = candidate;
      if (snapshotFilePath) writeSolutionSnapshot(snapshotFilePath, best);
    }
  };

  const finalizeProfile = (solution: Solution): Solution => {
    if (!profileCounters) return solution;
    return { ...solution, greedyProfile: { counters: structuredClone(profileCounters) } };
  };

  const finalizeDominanceCandidate = (candidate: Solution | null): Solution | null => {
    if (!candidate) return null;
    return applyDeterministicDominanceUpgrades(G, params, candidate);
  };

  const serviceCandidates = enumerateServiceCandidates(G, params);
  if (profileCounters) profileCounters.precompute.serviceCandidates += serviceCandidates.length;
  const residentialCandidateStats = anyResidentialCandidates.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
    typeIndex: getCandidateTypeIndex(residential),
    ...getResidentialBaseMax(params, residential.rows, residential.cols, getCandidateTypeIndex(residential)),
  }));
  if (profileCounters) profileCounters.precompute.residentialCandidates += residentialCandidateStats.length;
  const residentialScoringGroups = buildResidentialScoringGroups(residentialCandidateStats, profileCounters);
  const serviceCoverageGroupsByKey = buildServiceCoverageIndex(serviceCandidates, residentialScoringGroups, profileCounters);
  const precomputedIndexes: GreedyPrecomputedIndexes = {
    serviceCandidateIndicesByKey: new Map(
      serviceCandidates.map((candidate, candidateIndex) => [serviceCandidateKey(candidate), candidateIndex])
    ),
    serviceCandidatesByOccupiedCell: buildFootprintCandidateIndex(serviceCandidates, (candidate, visit) =>
      forEachPlacementCell(candidate, visit)
    ),
    residentialGroupsByOccupiedCell: buildResidentialGroupCellIndex(residentialScoringGroups),
    serviceCandidateIndicesByResidentialGroup: buildServiceCoverageReverseIndex(
      serviceCandidates,
      serviceCoverageGroupsByKey,
      residentialScoringGroups.length
    ),
    serviceCandidateIndicesByType: useServiceTypes
      ? buildTypedCandidateIndex(serviceCandidates.length, (candidateIndex) => serviceCandidates[candidateIndex].typeIndex, params.serviceTypes!.length)
      : null,
    residentialCandidatesByOccupiedCell: buildFootprintCandidateIndex(anyResidentialCandidates, (candidate, visit) =>
      forEachPlacementCell(candidate, visit)
    ),
    residentialCandidateIndicesByType: useTypes
      ? buildTypedCandidateIndex(
          anyResidentialCandidates.length,
          (candidateIndex) => getCandidateTypeIndex(anyResidentialCandidates[candidateIndex]),
          params.residentialTypes!.length
        )
      : null,
  };
  const initialResidentialAvail = useTypes ? params.residentialTypes!.map((type) => type.avail) : null;
  const initialResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  const serviceScores = new Map<string, number>();
  for (const s of serviceCandidates) {
    maybeStop();
    serviceScores.set(
      serviceCandidateKey(s),
      computeServiceStaticScore(
        s,
        initialResidentialGroupBoosts,
        residentialScoringGroups,
        serviceCoverageGroupsByKey,
        initialResidentialAvail,
        profileCounters
      )
    );
  }
  const serviceOrderSorted = [...serviceCandidates].sort(
    (a, b) =>
      (serviceScores.get(serviceCandidateKey(b)) ?? 0) - (serviceScores.get(serviceCandidateKey(a)) ?? 0)
      || serviceCandidateKey(a).localeCompare(serviceCandidateKey(b))
  );
  const baseSolveContext: Omit<GreedySolveContext, "serviceOrder"> = {
    grid: G,
    params,
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    anyResidentialCandidates,
    residentialCandidatesForLocal,
    precomputedIndexes,
    maxResidentials,
    useServiceTypes,
    useTypes,
    localSearch,
    profileCounters,
    maybeStop,
  };
  const solveWithOrder = (
    serviceOrder: ServiceCandidate[],
    options: SolveOneOptions
  ): Solution | null => finalizeDominanceCandidate(
    solveOne({ ...baseSolveContext, serviceOrder }, { ...options, profileCounters })
  );
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
      for (const seed of collectRow0AnchorRefinementSeeds(solution)) {
        addSeed(seed);
        if (seeds.length > maxSeeds) return seeds;
      }
    }

    for (const fallbackSeed of roadSeedRow0RepresentativeCandidates(G, maxSeeds)) {
      addSeed(fallbackSeed);
      if (seeds.length > maxSeeds) break;
    }

    return seeds;
  };

  type FixedServiceEvaluationBudget = {
    maxOrders: number;
    maxSeededOrders: number;
    maxSeeds: number;
  };

  const evaluateForcedServiceSet = (
    forcedServices: ServiceCandidate[],
    maxForcedServices: number,
    budget: FixedServiceEvaluationBudget
  ): Solution | null => {
    const orders = buildForcedServiceOrders(forcedServices, budget.maxOrders);
    const baseResults: { order: ServiceCandidate[]; solution: Solution | null }[] = [];
    let bestForced: Solution | null = null;

    for (const order of orders) {
      maybeStop();
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
        maybeStop();
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
  };

  const compareCapResults = (a: CapResult, b: CapResult): number =>
    b.totalPopulation - a.totalPopulation
    || a.serviceCount - b.serviceCount
    || a.cap - b.cap;

  const summarizeCapResult = (cap: number, phase: CapSearchPhase, solution: Solution | null): CapResult => ({
    cap,
    phase,
    solution,
    totalPopulation: solution?.totalPopulation ?? -1,
    serviceCount: solution?.services.length ?? Number.POSITIVE_INFINITY,
  });

  const runCapRestarts = (
    cap: number,
    phase: CapSearchPhase,
    bestForCap: Solution | null,
    restartBudget: number
  ): Solution | null => {
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
      if (trial && (!nextBest || trial.totalPopulation > nextBest.totalPopulation)) {
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
      for (const roadSeed of collectRow0AnchorRefinementSeeds(refined)) {
        maybeStop();
        if (profileCounters) profileCounters.attempts.serviceRefineTrials++;
        const trial = solveWithOrder(serviceOrderSorted, {
          maxServices: cap,
          initialRoadSeed: roadSeed,
        });
        if (trial && trial.totalPopulation > refined.totalPopulation) {
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
    bestForCap = runCapRestarts(cap, phase, bestForCap, restartBudget);
    if (allowAnchorRefinement && !deferRoadCommitment) {
      bestForCap = runCapAnchorRefinement(cap, bestForCap);
    }
    updateBest(bestForCap);
    return bestForCap;
  };

  const refineExistingCap = (
    cap: number,
    phase: CapSearchPhase,
    bestForCap: Solution | null,
    restartBudget: number,
    allowAnchorRefinement: boolean
  ): Solution | null => {
    let refined = runCapRestarts(cap, phase, bestForCap, restartBudget);
    if (allowAnchorRefinement && !deferRoadCommitment) {
      refined = runCapAnchorRefinement(cap, refined);
    }
    updateBest(refined);
    return refined;
  };

  // If user does not cap services, sweep service count and keep best.
  // This avoids over-placing services (which can block residentials and reduce population).
  const explicitServiceCap = maxServices;
  const positiveBonuses = (params.serviceTypes ?? []).reduce(
    (sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0),
    0
  );
  const totalServiceAvail = (params.serviceTypes ?? []).reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  const inferredUpper = explicitServiceCap ?? (positiveBonuses > 0 ? Math.min(totalServiceAvail, positiveBonuses) : totalServiceAvail);
  const capPlan = explicitServiceCap !== undefined
    ? { coarseCaps: [explicitServiceCap], refineCaps: [], usesAdaptiveSearch: false }
    : buildAdaptiveServiceCapPlan(inferredUpper);

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
      initialRoadSeed: currentRoadSeedFromSolution(incumbent),
    });
  };

  const relocationProbe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } } as const;

  type ServiceRelocationMove = {
    serviceIndex: number;
    candidate: ServiceCandidate;
    forcedServices: ServiceCandidate[];
    estimatedTotalPopulation: number;
    estimatedFutureScore: number;
    estimatedRoadCost: number;
    orderedServiceKey: string;
  };

  const compareServiceRelocationMoves = (
    left: ServiceRelocationMove,
    right: ServiceRelocationMove
  ): number =>
    right.estimatedTotalPopulation - left.estimatedTotalPopulation
    || left.forcedServices.length - right.forcedServices.length
    || right.estimatedFutureScore - left.estimatedFutureScore
    || left.estimatedRoadCost - right.estimatedRoadCost
    || left.serviceIndex - right.serviceIndex
    || compareServiceTieBreaks(left.candidate, relocationProbe, right.candidate, relocationProbe)
    || left.orderedServiceKey.localeCompare(right.orderedServiceKey);

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
      if (overlaps(occupiedBuildings, placement.r, placement.c, placement.rows, placement.cols)) return null;
      addPlacementCellsToSet(occupiedBuildings, placement);
      effectZones.push(buildServiceEffectZoneSet(G, placement));
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
      orderedServiceKey: forcedServices.map((service) => stableServicePlacementKey(service)).join("|"),
    };
  };

  const runBoundedServiceLocalSearch = (initialBest: Solution): Solution => {
    if (!localSearch || !localSearchServiceMoves) return initialBest;
    if (serviceOrderSorted.length === 0) return initialBest;
    let incumbent = initialBest;

    for (let iteration = 0; iteration < LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxIterations; iteration++) {
      maybeStop();
      const incumbentServices = materializeCurrentServiceSet(incumbent);
      if (incumbentServices.length === 0) break;
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
      const incumbentServiceKeys = new Set(incumbentServices.map((candidate) => serviceCandidateKey(candidate)));
      const remainingAvailForIncumbent = useTypes && params.residentialTypes
        ? params.residentialTypes.map((type) => type.avail)
        : null;
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

      for (let serviceIndex = 0; serviceIndex < incumbentServices.length; serviceIndex++) {
        maybeStop();
        const currentChoice = incumbentServices[serviceIndex];
        const candidatePasses = [
          serviceOrderSorted.filter((candidate) => candidate.typeIndex === currentChoice.typeIndex)
            .slice(0, perTypeNeighborhoodLimit),
          serviceOrderSorted.filter((candidate) => candidate.typeIndex !== currentChoice.typeIndex)
            .slice(0, Math.min(localSearchServiceCandidateLimit, serviceOrderSorted.length)),
        ];
        const occupiedWithoutCurrent = new Set(incumbentOccupiedBuildings);
        deletePlacementCellsFromSet(occupiedWithoutCurrent, incumbent.services[serviceIndex]);
        const currentResidentialGroupBoostsWithoutCurrent = [...currentResidentialGroupBoosts];
        for (const groupIndex of serviceCoverageGroupsByKey.get(serviceCandidateKey(currentChoice)) ?? []) {
          currentResidentialGroupBoostsWithoutCurrent[groupIndex] -= currentChoice.bonus;
        }

        for (const candidatePool of candidatePasses) {
          for (const candidate of candidatePool) {
            maybeStop();
            if (swapTrials >= maxSwapTrialsThisIteration) break;
            if (serviceCandidateKey(candidate) === serviceCandidateKey(currentChoice)) continue;
            if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
            if (overlaps(occupiedWithoutCurrent, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
            if (profileCounters) profileCounters.localSearch.serviceSwapChecks++;
            if (profileCounters) profileCounters.localSearch.canConnectChecks++;
            if (profileCounters) profileCounters.roads.canConnectChecks++;
            if (profileCounters) profileCounters.roads.probeCalls++;
            swapTrials++;
            const probe = probeBuildingConnectedToRoads(
              G,
              incumbent.roads,
              occupiedWithoutCurrent,
              candidate.r,
              candidate.c,
              candidate.rows,
              candidate.cols
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
            candidateMoves.push({
              serviceIndex,
              candidate,
              forcedServices,
              estimatedTotalPopulation: scoredMove.estimatedTotalPopulation,
              estimatedFutureScore,
              estimatedRoadCost: probe.path?.length ?? 0,
              orderedServiceKey: scoredMove.orderedServiceKey,
            });
          }
          if (swapTrials >= maxSwapTrialsThisIteration) break;
        }

        if (swapTrials >= maxSwapTrialsThisIteration) break;
      }

      candidateMoves.sort(compareServiceRelocationMoves);
      const realizationBudget = Math.min(
        candidateMoves.length,
        Math.max(
          LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRealizationAttemptsPerIteration,
          localSearchServiceCandidateLimit
        )
      );
      for (const move of candidateMoves.slice(0, realizationBudget)) {
        maybeStop();
        const trial = realizeAcceptedServiceNeighborhoodMove(incumbent, move.forcedServices);
        if (isBetterSearchSolution(trial, iterationBest)) {
          iterationBest = trial as Solution;
          break;
        }
      }

      if (!isBetterSearchSolution(iterationBest, incumbent)) break;
      incumbent = iterationBest;
      updateBest(incumbent);
      if (profileCounters) profileCounters.localSearch.serviceNeighborhoodImprovements++;
    }

    return incumbent;
  };

  try {
    const capResultsByCap = new Map<number, CapResult>();
    const evaluatedCaps = new Set<number>();

    if (explicitServiceCap !== undefined || !capPlan.usesAdaptiveSearch) {
      for (const cap of capPlan.coarseCaps) {
        const solution = evaluateNewCap(cap, "full", restarts, true);
        evaluatedCaps.add(cap);
        capResultsByCap.set(cap, summarizeCapResult(cap, "full", solution));
      }
    } else {
      for (const cap of capPlan.coarseCaps) {
        const solution = evaluateNewCap(cap, "coarse", 1, false);
        evaluatedCaps.add(cap);
        capResultsByCap.set(cap, summarizeCapResult(cap, "coarse", solution));
      }

      const coarseResults = [...capResultsByCap.values()]
        .filter((entry) => entry.phase === "coarse")
        .sort(compareCapResults);
      const focusCaps = new Set(coarseResults.slice(0, 2).map((entry) => entry.cap));
      const refineCaps = dedupeSortedNumbers(
        [...focusCaps].flatMap((cap) => inclusiveCapBand(cap, inferredUpper, 2))
      );
      const refineCapSet = new Set(refineCaps);

      for (const cap of refineCaps) {
        if (evaluatedCaps.has(cap)) {
          if (profileCounters) profileCounters.attempts.refineCaps++;
          const current = capResultsByCap.get(cap)?.solution ?? null;
          capResultsByCap.set(cap, summarizeCapResult(cap, "refine", current));
          continue;
        }
        const solution = evaluateNewCap(cap, "refine", 1, false);
        evaluatedCaps.add(cap);
        capResultsByCap.set(cap, summarizeCapResult(cap, "refine", solution));
      }

      const restartFocusCaps = dedupeSortedNumbers([
        ...[...capResultsByCap.values()]
          .filter((entry) => refineCapSet.has(entry.cap))
          .sort(compareCapResults)
          .slice(0, 2)
          .map((entry) => entry.cap),
        ...[...focusCaps].flatMap((cap) =>
          inclusiveCapBand(cap, inferredUpper, 1).filter((neighbor) => neighbor > 0)
        ),
      ]);

      for (const cap of restartFocusCaps) {
        const current = capResultsByCap.get(cap)?.solution ?? null;
        const refined = refineExistingCap(cap, "refine", current, restarts, true);
        capResultsByCap.set(cap, summarizeCapResult(cap, "refine", refined));
      }

      if (profileCounters) {
        profileCounters.attempts.capsSkipped += Math.max(0, inferredUpper + 1 - evaluatedCaps.size);
      }
    }
    if (!best) throw new Error("No feasible solution found.");

    if (localSearch) {
      best = runBoundedServiceLocalSearch(best);
    }

    const refineIters = serviceRefineIterations;
    const refineLimit = Math.min(serviceRefineCandidateLimit, serviceOrderSorted.length);
    const refinePool = serviceOrderSorted.slice(0, refineLimit);
    for (let iter = 0; iter < refineIters; iter++) {
      maybeStop();
      let improved = false;
      for (let i = 0; i < best.services.length; i++) {
        maybeStop();
        let localBest: Solution = best;
        for (const cand of refinePool) {
          maybeStop();
          const currentChoice = materializeChosenServiceCandidate(best, i);
          if (serviceCandidateKey(cand) === serviceCandidateKey(currentChoice)) continue;
          if (best.services.some((s, idx) => idx !== i && sameServicePlacement(s, cand))) continue;
          const forced = best.services.map((_, idx) => materializeChosenServiceCandidate(best!, idx));
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

    // Optional exhaustive search over service layouts from top-ranked pool.
    if (exhaustiveServiceSearch && best.services.length >= 0) {
      const poolLimit = Math.max(0, Math.min(serviceExactPoolLimit, serviceOrderSorted.length));
      const comboCap = Math.max(1, serviceExactMaxCombinations);
      const pool = serviceOrderSorted.slice(0, poolLimit);
      const combos = combinationsOfK(pool.length, best.services.length, comboCap);
      for (const idxs of combos) {
        maybeStop();
        if (profileCounters) profileCounters.attempts.exhaustiveTrials++;
        const forced = idxs.map((i) => pool[i]);
        const trial = evaluateForcedServiceSet(
          forced,
          best.services.length,
          EXHAUSTIVE_FIXED_SERVICE_EVALUATION
        );
        if (trial && trial.totalPopulation > best.totalPopulation) {
          best = trial;
          updateBest(best);
        }
      }
    }
  } catch (error) {
    if (error instanceof GreedyStopError) {
      if (error.bestSolution) return finalizeProfile(error.bestSolution);
      throw error;
    }
    throw error;
  }

  return finalizeProfile(best as Solution);
}

function localSearchImprove(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  services: ServicePlacement[],
  effectZones: Set<string>[],
  serviceBonuses: number[],
  residentials: ResidentialPlacement[],
  residentialTypeIndices: number[],
  populations: number[],
  totalPopulation: number,
  residentialCandidates: ResidentialPlacement[] | ResidentialCandidate[],
  residentialPopulationCache: number[],
  params: SolverParams,
  remainingAvail: number[] | null,
  maxResidentials: number | undefined,
  profileCounters?: GreedyProfileCounters,
  maybeStop?: () => void
): number {
  const useTypes = remainingAvail !== null && residentialCandidates.length > 0 && "typeIndex" in residentialCandidates[0];
  const maxIter = 20;
  type MoveChoice = {
    kind: "move";
    residentialIndex: number;
    candidate: ResidentialPlacement | ResidentialCandidate;
    candidateTypeIndex: number;
    currentTypeIndex: number;
    currentPop: number;
    newPop: number;
  };
  type AddChoice = {
    kind: "add";
    candidate: ResidentialPlacement | ResidentialCandidate;
    candidateTypeIndex: number;
    addPop: number;
  };

  const probeRoadConnection = (
    snapshotOccupied: Set<string>,
    r: number,
    c: number,
    rows: number,
    cols: number
  ): RoadConnectionProbe | null => {
    if (profileCounters) profileCounters.roads.canConnectChecks++;
    if (profileCounters) profileCounters.roads.probeCalls++;
    return probeBuildingConnectedToRoads(G, roads, snapshotOccupied, r, c, rows, cols);
  };

  for (let iter = 0; iter < maxIter; iter++) {
    maybeStop?.();
    if (profileCounters) profileCounters.attempts.localSearchIterations++;
    let bestMove: MoveChoice | null = null;
    let bestMoveDelta = 0;
    let bestMoveProbe: RoadConnectionProbe | null = null;
    let bestAdd: AddChoice | null = null;
    let bestAddDelta = 0;
    let bestAddProbe: RoadConnectionProbe | null = null;

    for (let i = 0; i < residentials.length; i++) {
      maybeStop?.();
      const res = residentials[i];
      const currentPop = populations[i];
      const resType = residentialTypeIndices[i] ?? NO_TYPE_INDEX;
      const othersOccupied = new Set(occupied);
      deletePlacementCellsFromSet(othersOccupied, res);
      for (let candidateIndex = 0; candidateIndex < residentialCandidates.length; candidateIndex++) {
        const cand = residentialCandidates[candidateIndex];
        maybeStop?.();
        if (profileCounters) profileCounters.localSearch.candidateScans++;
        const candidateTypeIndex = getCandidateTypeIndex(cand);
        const samePlacement =
          cand.r === res.r
          && cand.c === res.c
          && cand.rows === res.rows
          && cand.cols === res.cols;
        if (samePlacement && candidateTypeIndex === resType) continue;
        if (useTypes && remainingAvail) {
          if (candidateTypeIndex !== resType && remainingAvail[candidateTypeIndex] <= 0) continue;
        }
        if (roads.size === 0) {
          if (profileCounters) profileCounters.roads.row0Checks++;
          if (!placementLeavesRow0RoadCellAvailable(G, othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        }
        if (overlaps(othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (profileCounters) profileCounters.localSearch.moveChecks++;
        if (profileCounters) profileCounters.localSearch.canConnectChecks++;
        const probe = probeRoadConnection(othersOccupied, cand.r, cand.c, cand.rows, cand.cols);
        if (!probe) continue;
        if (profileCounters) profileCounters.localSearch.populationCacheLookups++;
        const newPop = residentialPopulationCache[candidateIndex] ?? -1;
        const delta = newPop - currentPop;
        if (
          delta > bestMoveDelta
          || (delta === bestMoveDelta && delta > 0 && bestMove !== null && bestMoveProbe !== null
            && compareResidentialTieBreaks(params, cand, probe, bestMove.candidate, bestMoveProbe) < 0)
        ) {
          bestMove = {
            kind: "move",
            residentialIndex: i,
            candidate: cand,
            candidateTypeIndex,
            currentTypeIndex: resType,
            currentPop,
            newPop,
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
          if (profileCounters) profileCounters.roads.row0Checks++;
          if (!placementLeavesRow0RoadCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        }
        if (overlaps(occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (profileCounters) profileCounters.localSearch.addChecks++;
        if (profileCounters) profileCounters.localSearch.canConnectChecks++;
        const probe = probeRoadConnection(occupied, cand.r, cand.c, cand.rows, cand.cols);
        if (!probe) continue;
        if (profileCounters) profileCounters.localSearch.populationCacheLookups++;
        const addPop = residentialPopulationCache[candidateIndex] ?? -1;
        if (
          addPop > bestAddDelta
          || (addPop === bestAddDelta && addPop > 0 && bestAdd !== null && bestAddProbe !== null
            && compareResidentialTieBreaks(params, cand, probe, bestAdd.candidate, bestAddProbe) < 0)
        ) {
          bestAdd = {
            kind: "add",
            candidate: cand,
            candidateTypeIndex,
            addPop,
          };
          bestAddDelta = addPop;
          bestAddProbe = probe;
        }
      }
    }

    if (bestMoveDelta <= 0 && bestAddDelta <= 0) break;

    if (bestAddDelta > bestMoveDelta && bestAdd) {
      const { candidate, candidateTypeIndex, addPop } = bestAdd;
      totalPopulation += addPop;
      if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
      if (!bestAddProbe) break;
      if (profileCounters) profileCounters.roads.probeReuses++;
      applyRoadConnectionProbe(roads, bestAddProbe);
      for (const k of roads) occupied.add(k);
      addPlacementCellsToSet(occupied, candidate);
      residentials.push({ r: candidate.r, c: candidate.c, rows: candidate.rows, cols: candidate.cols });
      residentialTypeIndices.push(candidateTypeIndex);
      populations.push(addPop);
      if (useTypes && remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
      if (profileCounters) profileCounters.localSearch.placements++;
      continue;
    }

    if (bestMove) {
      const currentResidential = residentials[bestMove.residentialIndex];
      deletePlacementCellsFromSet(occupied, currentResidential);
      if (useTypes && remainingAvail && bestMove.currentTypeIndex >= 0) remainingAvail[bestMove.currentTypeIndex]++;
      if (profileCounters) profileCounters.roads.ensureConnectedCalls++;
      if (!bestMoveProbe) break;
      if (profileCounters) profileCounters.roads.probeReuses++;
      applyRoadConnectionProbe(roads, bestMoveProbe);
      for (const k of roads) occupied.add(k);
      addPlacementCellsToSet(occupied, bestMove.candidate);
      if (useTypes && remainingAvail && bestMove.candidateTypeIndex >= 0) remainingAvail[bestMove.candidateTypeIndex]--;
      residentials[bestMove.residentialIndex] = {
        r: bestMove.candidate.r,
        c: bestMove.candidate.c,
        rows: bestMove.candidate.rows,
        cols: bestMove.candidate.cols,
      };
      residentialTypeIndices[bestMove.residentialIndex] = bestMove.candidateTypeIndex;
      populations[bestMove.residentialIndex] = bestMove.newPop;
      totalPopulation = totalPopulation - bestMove.currentPop + bestMove.newPop;
      if (profileCounters) profileCounters.localSearch.placements++;
      continue;
    }
  }
  return totalPopulation;
}
