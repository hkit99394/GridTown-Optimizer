/**
 * Greedy solver + optional local search (see docs/design/ALGORITHM.md)
 */

import { existsSync } from "node:fs";

import { cellKey } from "../core/types.js";
import type { Grid } from "../core/types.js";
import type {
  GreedyDiagnostics,
  GreedyDiagnosticExample,
  GreedyDiagnosticKindReport,
  GreedyOptions,
  GreedyPlacementDiagnosticReason,
  GreedyProfileCounters,
  GreedyProfilePhaseName,
  GreedyRoadOpportunityCounterfactualReason,
  ServicePlacement,
  ServiceCandidate,
  ResidentialPlacement,
  ResidentialCandidate,
  SolverParams,
  Solution,
} from "../core/types.js";
import {
  createGreedyProfileCounters,
  createGreedyProfilePhaseRecorder,
  createGreedyProfilePhaseSummaries,
  runGreedyProfilePhase,
  startGreedyProfilePhase,
} from "./profile.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import {
  collectNewlyOccupiedKeysForPlacement,
  commitExplicitRoadConnectedPlacement,
  GreedyAttemptState,
  probeExplicitRoadConnection,
} from "./attemptState.js";
import type { ConnectivityProbe, PlacementRect, RoadConnectionProbe } from "./attemptState.js";
import {
  CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT,
  buildConnectivityShadowBaselineGuardParams,
  canUseConnectivityShadowTieBreak,
  chooseConnectivityShadowGuardedSolution,
  compareConnectivityShadowPenalty,
  computeConnectivityShadowPenalty,
  createConnectivityShadowDecisionRecorder,
  recordConnectivityShadowTieDecision,
  residentialPlacementTrace,
  servicePlacementTrace,
} from "./connectivityShadowScoring.js";
import type { ConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import {
  ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT,
  ROAD_OPPORTUNITY_TRACE_LIMIT,
  createRoadOpportunityRecorder,
  recordRoadOpportunityPlacement,
  recordRoadOpportunityPlacementFromOccupiedBuildings,
  roadOpportunityHasTraceCapacity,
} from "./roadOpportunity.js";
import type { RoadOpportunityCounterfactualCandidate, RoadOpportunityRecorder } from "./roadOpportunity.js";
import {
  applyRoadConnectionProbe,
  createRoadProbeScratch,
  ensureBuildingConnectedToRoads,
  roadAnchorRepresentativeSeedCandidates,
  roadsConnectedToRoadAnchor,
  findAvailableRoadAnchorCell,
  pruneRedundantRoads,
} from "../core/roads.js";
import { assertValidLayoutConstraints } from "../core/evaluator.js";
import {
  buildFootprintCandidateIndexFromKeys,
  buildTypedCandidateIndex,
  collectIndexedCandidatesForCells,
  createActiveCandidatePool,
  invalidateCandidatePoolEntries,
  mapGlobalCandidateIndicesToLocal,
  markServiceCandidatesDirty,
} from "./candidatePools.js";
import {
  compareResidentialTieBreaks,
  compareServiceTieBreaks,
  getCandidateTypeIndex,
  materializeChosenServiceCandidate,
  materializeServicePlacement,
  sameServicePlacement,
  serviceCandidateKey,
  stableResidentialPlacementKey,
  stableServicePlacementKey,
} from "./candidates.js";
import type { ResidentialCandidateLike, ResidentialCandidatesList } from "./candidates.js";
import {
  compareDensityAwareScore,
  computePlacementDensityScore,
  isBetterDensityAwareSearchSolution,
  isBetterSearchSolution,
} from "./solutionRanking.js";
import { applyDeterministicDominanceUpgrades } from "../core/dominanceUpgrades.js";
import {
  buildFootprintGeometryCache,
  buildServiceGeometryCache,
  enumerateServiceCandidates,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  buildServiceEffectZoneSet,
  overlaps,
  isBoostedByService,
  normalizeServicePlacement,
  serviceFootprint,
} from "../core/buildings.js";
import { collectRoadAnchorRefinementSeeds, placementLeavesRoadAnchorCellAvailable } from "./roadAnchors.js";
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
type MaybeStop = ((force?: boolean) => void) | undefined;
interface GreedyPrecomputedIndexes {
  serviceCandidateIndicesByKey: Map<string, number>;
  serviceCandidatesByOccupiedCell: Map<string, number[]>;
  serviceFootprintKeysByCandidate: readonly (readonly string[])[];
  serviceEffectZoneSetsByCandidate: readonly Set<string>[];
  residentialGroupsByOccupiedCell: Map<string, number[]>;
  serviceCandidateIndicesByResidentialGroup: number[][];
  serviceCandidateIndicesByType: number[][] | null;
  residentialCandidatesByOccupiedCell: Map<string, number[]>;
  residentialCandidateFootprintKeys: readonly (readonly string[])[];
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
  serviceLookaheadCandidates: number;
  profileCounters?: GreedyProfileCounters;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
  maybeStop?: MaybeStop;
  recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
  recordRoadOpportunity?: RoadOpportunityRecorder;
}
interface SolveOneOptions {
  maxServices: number | undefined;
  initialRoadSeed?: Set<string>;
  fixedServices?: ServiceCandidate[];
  profileCounters?: GreedyProfileCounters;
}
interface GreedyPreparedInputs {
  serviceCandidates: ServiceCandidate[];
  serviceOrderSorted: ServiceCandidate[];
  baseSolveContext: Omit<GreedySolveContext, "serviceOrder">;
}
type GreedySolveAttempt = (serviceOrder: ServiceCandidate[], options: SolveOneOptions) => Solution | null;
type GreedyBestUpdater = (candidate: Solution | null) => void;
type FixedServiceEvaluationBudget = {
  maxOrders: number;
  maxSeededOrders: number;
  maxSeeds: number;
};
type GreedyForcedServiceEvaluator = (
  forcedServices: ServiceCandidate[],
  maxForcedServices: number,
  budget: FixedServiceEvaluationBudget
) => Solution | null;
interface GreedyServiceCapPolicy {
  explicitServiceCap: number | undefined;
  inferredUpper: number;
  capPlan: ReturnType<typeof buildAdaptiveServiceCapPlan>;
}
type GreedyCapEvaluator = (
  cap: number,
  phase: CapSearchPhase,
  restartBudget: number,
  allowAnchorRefinement: boolean
) => Solution | null;
type GreedyExistingCapRefiner = (
  cap: number,
  phase: CapSearchPhase,
  bestForCap: Solution | null,
  restartBudget: number,
  allowAnchorRefinement: boolean
) => Solution | null;
type ServiceRelocationMove = {
  kind: "remove" | "add" | "swap";
  serviceIndex: number;
  candidate: ServiceCandidate;
  forcedServices: ServiceCandidate[];
  estimatedTotalPopulation: number;
  estimatedFutureScore: number;
  estimatedRoadCost: number;
  orderedServiceKey: string;
  traceKey?: string;
  traceProbe?: ConnectivityProbe;
  traceFootprintKeys?: readonly string[];
  traceOccupiedBuildings?: Set<string>;
};
type ResidualServiceBundleTrial = {
  candidate: ServiceCandidate;
  forcedServices: ServiceCandidate[];
  displacedResidentialCount: number;
  estimatedTotalPopulation: number;
  estimatedFutureScore: number;
  orderedServiceKey: string;
};

class GreedyStopError extends Error {
  constructor(
    readonly bestSolution: Solution | null,
    readonly reason: "cancelled" | "time-limit"
  ) {
    super(
      bestSolution
        ? (reason === "time-limit" ? "Greedy solve reached its time limit." : "Greedy solve was stopped.")
        : (
            reason === "time-limit"
              ? "Greedy solve reached its time limit before finding a feasible solution."
              : "Greedy solve was stopped before finding a feasible solution."
          )
    );
  }
}

type RandomSource = () => number;
type NormalizedGreedyOptions = Omit<Required<GreedyOptions>, "randomSeed" | "timeLimitSeconds"> & {
  randomSeed?: number;
  timeLimitSeconds?: number;
};

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

const SERVICE_LOOKAHEAD = {
  residentialDepth: 2,
};

const GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT = 2_000;
const GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON = 3;

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

function getGreedyOptions(params: SolverParams): NormalizedGreedyOptions {
  const greedy = params.greedy ?? {};
  const randomSeed = typeof greedy.randomSeed === "number" && Number.isInteger(greedy.randomSeed)
    ? greedy.randomSeed
    : undefined;
  const timeLimitSeconds =
    typeof greedy.timeLimitSeconds === "number" && Number.isFinite(greedy.timeLimitSeconds) && greedy.timeLimitSeconds > 0
      ? greedy.timeLimitSeconds
      : undefined;
  return {
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    localSearchServiceMoves: greedy.localSearchServiceMoves ?? true,
    localSearchServiceCandidateLimit: greedy.localSearchServiceCandidateLimit ?? 6,
    serviceLookaheadCandidates: greedy.serviceLookaheadCandidates ?? 0,
    deferRoadCommitment: greedy.deferRoadCommitment ?? false,
    densityTieBreaker: greedy.densityTieBreaker ?? false,
    densityTieBreakerTolerancePercent: greedy.densityTieBreakerTolerancePercent ?? 2,
    connectivityShadowScoring: greedy.connectivityShadowScoring ?? false,
    ...(randomSeed !== undefined ? { randomSeed } : {}),
    profile: greedy.profile ?? false,
    diagnostics: greedy.diagnostics ?? false,
    ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
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

function forEachPlacementCell(
  placement: { r: number; c: number; rows: number; cols: number },
  visit: (key: string) => void
): void {
  forEachRectangleCell(placement.r, placement.c, placement.rows, placement.cols, (r, c) => visit(cellKey(r, c)));
}

function forEachCachedPlacementCell(
  footprintKeys: readonly string[],
  visit: (key: string) => void
): void {
  for (const key of footprintKeys) visit(key);
}

function addPlacementCellsToSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.add(key));
}

function addCachedPlacementCellsToSet(target: Set<string>, footprintKeys: readonly string[]): void {
  forEachCachedPlacementCell(footprintKeys, (key) => target.add(key));
}

function deletePlacementCellsFromSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.delete(key));
}

function toExplicitConnectivityProbe(probe: RoadConnectionProbe): ConnectivityProbe {
  return { kind: "explicit", roadCost: probe.path?.length ?? 0, roadProbe: probe };
}

function buildLocalSearchBuildingOccupancy(
  services: readonly ServicePlacement[],
  residentials: readonly ResidentialPlacement[],
  excludedResidentialIndex = -1
): Set<string> {
  const occupiedBuildings = new Set<string>();
  for (const service of services) addPlacementCellsToSet(occupiedBuildings, service);
  for (let index = 0; index < residentials.length; index++) {
    if (index === excludedResidentialIndex) continue;
    addPlacementCellsToSet(occupiedBuildings, residentials[index]);
  }
  return occupiedBuildings;
}

function overlapsCachedFootprint(occupied: Set<string>, footprintKeys: readonly string[]): boolean {
  for (const key of footprintKeys) {
    if (occupied.has(key)) return true;
  }
  return false;
}

function createOccupancyScratch(base: Set<string>): OccupancyScratch {
  return {
    cells: new Set(base),
    addedKeys: new Set(),
    removedKeys: new Set(),
  };
}

function resetOccupancyScratch(scratch: OccupancyScratch): void {
  for (const key of scratch.addedKeys) {
    scratch.cells.delete(key);
  }
  for (const key of scratch.removedKeys) {
    scratch.cells.add(key);
  }
  scratch.addedKeys.clear();
  scratch.removedKeys.clear();
}

function deleteOccupancyScratchKey(scratch: OccupancyScratch, key: string): void {
  if (!scratch.cells.has(key)) return;
  scratch.cells.delete(key);
  if (scratch.addedKeys.has(key)) {
    scratch.addedKeys.delete(key);
  } else {
    scratch.removedKeys.add(key);
  }
}

function deleteKeysFromOccupancyScratch(scratch: OccupancyScratch, footprintKeys: readonly string[]): void {
  for (const key of footprintKeys) deleteOccupancyScratchKey(scratch, key);
}

function deletePlacementCellsFromOccupancyScratch(
  scratch: OccupancyScratch,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => deleteOccupancyScratchKey(scratch, key));
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
      cols: service.cols + 2 * service.range,
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

type ServiceLookaheadCandidate = {
  service: ServiceCandidate;
  candidateIndex: number;
  score: number;
  probe: ConnectivityProbe;
};

type ServiceLookaheadEvaluation = {
  totalScore: number;
  refillScore: number;
};

const ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT = ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT * 4;

type RoadOpportunityCandidatePoolEntry<TCandidate> = {
  key: string;
  candidate: TCandidate;
  candidateIndex: number;
  placement: PlacementRect;
  probe: ConnectivityProbe;
  footprintKeys?: readonly string[];
  occupiedBuildings?: Set<string>;
  score: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: RoadOpportunityCounterfactualCandidate["moveKind"];
};
type RoadOpportunityCandidatePools<TCandidate> = {
  score: RoadOpportunityCandidatePoolEntry<TCandidate>[];
  cheapRoad: RoadOpportunityCandidatePoolEntry<TCandidate>[];
};

function compareServiceLookaheadCandidates(
  left: ServiceLookaheadCandidate,
  right: ServiceLookaheadCandidate
): number {
  if (left.score !== right.score) return right.score - left.score;
  return compareServiceTieBreaks(left.service, left.probe, right.service, right.probe);
}

function pushBoundedServiceLookaheadCandidate(
  shortlist: ServiceLookaheadCandidate[],
  limit: number,
  entry: ServiceLookaheadCandidate
): void {
  if (limit <= 0 || entry.score <= 0) return;
  shortlist.push(entry);
  shortlist.sort(compareServiceLookaheadCandidates);
  if (shortlist.length > limit) shortlist.length = limit;
}

function compareServiceLookaheadEvaluations(
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

function compareRoadOpportunityScorePoolEntries<TCandidate>(
  left: RoadOpportunityCandidatePoolEntry<TCandidate>,
  right: RoadOpportunityCandidatePoolEntry<TCandidate>
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.probe.roadCost !== right.probe.roadCost) return left.probe.roadCost - right.probe.roadCost;
  return left.key.localeCompare(right.key);
}

function compareRoadOpportunityCheapPoolEntries<TCandidate>(
  left: RoadOpportunityCandidatePoolEntry<TCandidate>,
  right: RoadOpportunityCandidatePoolEntry<TCandidate>
): number {
  if (left.probe.roadCost !== right.probe.roadCost) return left.probe.roadCost - right.probe.roadCost;
  if (left.score !== right.score) return right.score - left.score;
  return left.key.localeCompare(right.key);
}

function pushBoundedRoadOpportunityCandidate<TCandidate>(
  pool: RoadOpportunityCandidatePoolEntry<TCandidate>[],
  entry: RoadOpportunityCandidatePoolEntry<TCandidate>,
  compare: (
    left: RoadOpportunityCandidatePoolEntry<TCandidate>,
    right: RoadOpportunityCandidatePoolEntry<TCandidate>
  ) => number
): void {
  const existingIndex = pool.findIndex((candidate) => candidate.key === entry.key);
  if (existingIndex >= 0) {
    pool[existingIndex] = entry;
  } else {
    pool.push(entry);
  }
  pool.sort(compare);
  if (pool.length > ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT) {
    pool.length = ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT;
  }
}

function createRoadOpportunityCandidatePools<TCandidate>(): RoadOpportunityCandidatePools<TCandidate> {
  return { score: [], cheapRoad: [] };
}

function pushRoadOpportunityCandidate<TCandidate>(
  pools: RoadOpportunityCandidatePools<TCandidate>,
  entry: RoadOpportunityCandidatePoolEntry<TCandidate>
): void {
  pushBoundedRoadOpportunityCandidate(pools.score, entry, compareRoadOpportunityScorePoolEntries);
  pushBoundedRoadOpportunityCandidate(pools.cheapRoad, entry, compareRoadOpportunityCheapPoolEntries);
}

function mergeRoadOpportunityCandidatePools<TCandidate>(
  pools: readonly RoadOpportunityCandidatePoolEntry<TCandidate>[][]
): RoadOpportunityCandidatePoolEntry<TCandidate>[] {
  const byKey = new Map<string, RoadOpportunityCandidatePoolEntry<TCandidate>>();
  for (const pool of pools) {
    for (const entry of pool) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    }
  }
  return [...byKey.values()];
}

function classifyRoadOpportunityCounterfactual(options: {
  candidateScore: number;
  chosenScore: number;
  candidateRoadCost: number;
  chosenRoadCost: number;
  lookaheadDisplaced: boolean;
}): GreedyRoadOpportunityCounterfactualReason | null {
  const { candidateScore, chosenScore, candidateRoadCost, chosenRoadCost, lookaheadDisplaced } = options;
  if (lookaheadDisplaced) return "lookahead-rejected";
  if (candidateScore > chosenScore) return "higher-score-rejected";
  if (candidateScore === chosenScore) return "same-score-tie";

  const scoreWindow = Math.max(1, Math.ceil(Math.max(1, Math.abs(chosenScore)) * 0.1));
  if (candidateScore >= chosenScore - scoreWindow) return "near-score";
  if (candidateRoadCost < chosenRoadCost && candidateScore >= 0) return "lower-road-cost";

  return null;
}

function compareSelectedRoadOpportunityCounterfactuals(
  left: RoadOpportunityCounterfactualCandidate & { key: string },
  right: RoadOpportunityCounterfactualCandidate & { key: string },
  chosenScore: number,
  chosenRoadCost: number
): number {
  const reasonRank: Record<GreedyRoadOpportunityCounterfactualReason, number> = {
    "lookahead-rejected": 0,
    "higher-score-rejected": 1,
    "same-score-tie": 2,
    "near-score": 3,
    "lower-road-cost": 4,
  };
  if (reasonRank[left.reason] !== reasonRank[right.reason]) {
    return reasonRank[left.reason] - reasonRank[right.reason];
  }

  const leftScoreDelta = Math.abs(left.score - chosenScore);
  const rightScoreDelta = Math.abs(right.score - chosenScore);
  if (leftScoreDelta !== rightScoreDelta) return leftScoreDelta - rightScoreDelta;

  const leftRoadDelta = Math.abs(left.probe.roadCost - chosenRoadCost);
  const rightRoadDelta = Math.abs(right.probe.roadCost - chosenRoadCost);
  if (leftRoadDelta !== rightRoadDelta) return leftRoadDelta - rightRoadDelta;

  return left.key.localeCompare(right.key);
}

function selectRoadOpportunityCounterfactuals<TCandidate>(options: {
  pools: RoadOpportunityCandidatePools<TCandidate>;
  chosenKey: string;
  chosenCandidate: TCandidate;
  chosenProbe: ConnectivityProbe;
  chosenScore: number;
  compareTieBreaks: (candidate: TCandidate, probe: ConnectivityProbe, chosen: TCandidate, chosenProbe: ConnectivityProbe) => number;
  isLookaheadDisplaced?: (entry: RoadOpportunityCandidatePoolEntry<TCandidate>) => boolean;
}): RoadOpportunityCounterfactualCandidate[] {
  const selected: Array<RoadOpportunityCounterfactualCandidate & { key: string }> = [];
  for (const entry of mergeRoadOpportunityCandidatePools([options.pools.score, options.pools.cheapRoad])) {
    if (entry.key === options.chosenKey) continue;
    const lookaheadDisplaced = options.isLookaheadDisplaced?.(entry) ?? false;
    const reason = classifyRoadOpportunityCounterfactual({
      candidateScore: entry.score,
      chosenScore: options.chosenScore,
      candidateRoadCost: entry.probe.roadCost,
      chosenRoadCost: options.chosenProbe.roadCost,
      lookaheadDisplaced,
    });
    if (!reason) continue;
    const tieBreakComparison = options.compareTieBreaks(
      entry.candidate,
      entry.probe,
      options.chosenCandidate,
      options.chosenProbe
    );
    selected.push({
      key: entry.key,
      reason,
      placement: entry.placement,
      probe: entry.probe,
      footprintKeys: entry.footprintKeys,
      occupiedBuildings: entry.occupiedBuildings,
      score: entry.score,
      tieBreakComparison,
      ...(entry.typeIndex === undefined ? {} : { typeIndex: entry.typeIndex }),
      ...(entry.bonus === undefined ? {} : { bonus: entry.bonus }),
      ...(entry.range === undefined ? {} : { range: entry.range }),
      ...(entry.moveKind === undefined ? {} : { moveKind: entry.moveKind }),
    });
  }

  selected.sort((left, right) =>
    compareSelectedRoadOpportunityCounterfactuals(left, right, options.chosenScore, options.chosenProbe.roadCost)
  );
  return selected.slice(0, ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT);
}

type OccupancyScratch = {
  cells: Set<string>;
  addedKeys: Set<string>;
  removedKeys: Set<string>;
};

function buildResidentialGroupCellIndex(
  footprintKeysByGroup: readonly (readonly string[])[]
): Map<string, number[]> {
  return buildFootprintCandidateIndexFromKeys(footprintKeysByGroup);
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

function getServiceCandidatePrecomputedIndex(
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): number {
  return precomputedIndexes.serviceCandidateIndicesByKey.get(serviceCandidateKey(candidate)) ?? -1;
}

function getCachedServiceEffectZoneSet(
  G: Grid,
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): Set<string> {
  const precomputedIndex = getServiceCandidatePrecomputedIndex(precomputedIndexes, candidate);
  return precomputedIndex >= 0
    ? precomputedIndexes.serviceEffectZoneSetsByCandidate[precomputedIndex]!
    : buildServiceEffectZoneSet(G, candidate);
}

function getCachedServiceFootprintKeys(
  precomputedIndexes: GreedyPrecomputedIndexes,
  candidate: ServiceCandidate
): readonly string[] | undefined {
  const precomputedIndex = getServiceCandidatePrecomputedIndex(precomputedIndexes, candidate);
  return precomputedIndex >= 0 ? precomputedIndexes.serviceFootprintKeysByCandidate[precomputedIndex] : undefined;
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
    serviceLookaheadCandidates,
    recordProfilePhase,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop,
  } = context;
  const {
    maxServices,
    initialRoadSeed,
    fixedServices,
    profileCounters,
  } = options;
  const attemptState = new GreedyAttemptState(
    G,
    initialRoadSeed,
    (params.greedy?.deferRoadCommitment ?? false) && !fixedServices,
    profileCounters
  );
  const { roads, occupied, useDeferredRoadCommitment } = attemptState;
  const { explicitRoadProbeScratch } = attemptState;
  const lookaheadRoadProbeScratch = createRoadProbeScratch(G);
  const remainingServiceAvail = useServiceTypes ? params.serviceTypes!.map((t) => t.avail) : null;
  const remainingAvail = useTypes ? params.residentialTypes!.map((t) => t.avail) : null;
  const densityTieBreaker = Boolean(params.greedy?.densityTieBreaker);
  const densityTieBreakerToleranceRatio =
    densityTieBreaker && typeof params.greedy?.densityTieBreakerTolerancePercent === "number"
      ? Math.max(0, params.greedy.densityTieBreakerTolerancePercent) / 100
      : (densityTieBreaker ? 0.02 : 0);
  const connectivityShadowScoring = Boolean(params.greedy?.connectivityShadowScoring);

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
  ): ConnectivityProbe | null =>
    attemptState.probeRoadConnection(snapshotOccupied, { r, c, rows, cols });
  const evaluateServiceLookahead = (
    entry: ServiceLookaheadCandidate
  ): ServiceLookaheadEvaluation => {
    if (entry.probe.kind !== "explicit") {
      return {
        totalScore: entry.score,
        refillScore: 0,
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
        if (remainingResidentialAvail && candidateTypeIndex >= 0 && remainingResidentialAvail[candidateTypeIndex] <= 0) {
          continue;
        }
        if (roadsScratch.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (!placementLeavesRoadAnchorCellAvailable(G, occupiedScratch, candidate.r, candidate.c, candidate.rows, candidate.cols)) {
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
          profileCounters
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
          pop > bestResidentialPop
          || (pop === bestResidentialPop && pop >= 0 && bestResidential !== null && bestResidentialProbe !== null
            && compareResidentialTieBreaks(params, candidate, probe, bestResidential, bestResidentialProbe) < 0)
        ) {
          bestResidential = candidate;
          bestResidentialIndex = candidateIndex;
          bestResidentialPop = pop;
          bestResidentialProbe = probe;
        }
      }

      if (!bestResidential || bestResidentialIndex < 0 || bestResidentialPop <= 0 || !bestResidentialProbe) break;

      const candidateFootprintKeys =
        precomputedIndexes.residentialCandidateFootprintKeys[bestResidentialIndex];
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
      refillScore,
    };
  };
  const serviceOrderGlobalCandidateIndices = !fixedServices
    ? serviceSource.map((candidate) => precomputedIndexes.serviceCandidateIndicesByKey.get(serviceCandidateKey(candidate)) ?? -1)
    : null;
  const enableServiceLookahead =
    serviceLookaheadCandidates > 1
    && !useDeferredRoadCommitment
    && !fixedServices
    && (maxResidentials === undefined || maxResidentials > 0)
    && anyResidentialCandidates.length > 0
    && residentialScoringGroups.length > 0;
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
      const cachedFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, s);
      if (useServiceTypes && remainingServiceAvail) {
        if (remainingServiceAvail[s.typeIndex] <= 0) {
          return null;
        }
      }
      if (roads.size === 0 && !placementLeavesRoadAnchorCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
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
      if (probe.kind !== "explicit") {
        return null;
      }
      recordRoadOpportunityPlacement({
        attemptState,
        placement,
        probe,
        phase: "service",
        footprintKeys: cachedFootprintKeys,
        profileCounters,
        record: recordRoadOpportunity,
        typeIndex: s.typeIndex,
        bonus: s.bonus,
        range: s.range,
      });
      attemptState.commitExplicitPlacement({
        probe: probe.roadProbe,
        placement,
        footprintKeys: cachedFootprintKeys,
        countProbeReuse: false,
        recordConnectivityShadow: false,
      });
      services.push(placement);
      serviceTypeIndices.push(s.typeIndex);
      serviceBonuses.push(s.bonus);
      effectZones.push(getCachedServiceEffectZoneSet(G, precomputedIndexes, s));
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
      let bestDensityScore = Number.NEGATIVE_INFINITY;
      let bestConnectivityShadowPenalty: number | null = null;
      const lookaheadShortlist: ServiceLookaheadCandidate[] = [];
      const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "service");
      const serviceRoadOpportunityPools = createRoadOpportunityCandidatePools<ServiceCandidate>();
      for (const candidateIndex of serviceActivePool.activeIndices) {
        maybeStop?.();
        if (profileCounters) profileCounters.servicePhase.candidateScans++;
        const service = serviceSource[candidateIndex];
        const globalCandidateIndex = serviceOrderGlobalCandidateIndices[candidateIndex] ?? -1;
        if (globalCandidateIndex < 0) continue;
        const placement = materializeServicePlacement(service);
        if (useServiceTypes && remainingServiceAvail && remainingServiceAvail[service.typeIndex] <= 0) continue;
        if (roads.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (!placementLeavesRoadAnchorCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) continue;
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
        const densityScore = densityTieBreaker
          ? computePlacementDensityScore(G, service, score)
          : 0;
        const serviceFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[globalCandidateIndex];
        if (collectRoadOpportunityCounterfactuals && score > 0) {
          const roadOpportunityEntry: RoadOpportunityCandidatePoolEntry<ServiceCandidate> = {
            key: serviceCandidateKey(service),
            candidate: service,
            candidateIndex,
            placement,
            probe,
            footprintKeys: serviceFootprintKeys,
            score,
            typeIndex: service.typeIndex,
            bonus: service.bonus,
            range: service.range,
          };
          pushRoadOpportunityCandidate(serviceRoadOpportunityPools, roadOpportunityEntry);
        }
        if (enableServiceLookahead) {
          pushBoundedServiceLookaheadCandidate(
            lookaheadShortlist,
            serviceLookaheadCandidates,
            {
              service,
              candidateIndex,
              score,
              probe,
            }
          );
        }
        const scoreComparison = bestCandidate === null
          ? (score > 0 ? 1 : -1)
          : compareDensityAwareScore(
              score,
              densityScore,
              bestScore,
              bestDensityScore,
              densityTieBreakerToleranceRatio
            );
        let candidateConnectivityShadowPenalty: number | null = null;
        let connectivityShadowComparison = 0;
        if (
          scoreComparison === 0
          && score > 0
          && connectivityShadowScoring
          && bestCandidate !== null
          && bestProbe !== null
          && canUseConnectivityShadowTieBreak(probe, bestProbe)
        ) {
          const serviceFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[globalCandidateIndex];
          candidateConnectivityShadowPenalty = computeConnectivityShadowPenalty(
            attemptState,
            placement,
            serviceFootprintKeys
          );
          if (bestConnectivityShadowPenalty === null) {
            const bestGlobalCandidateIndex = serviceOrderGlobalCandidateIndices[bestCandidateIndex] ?? -1;
            const bestFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[bestGlobalCandidateIndex];
            bestConnectivityShadowPenalty = computeConnectivityShadowPenalty(
              attemptState,
              materializeServicePlacement(bestCandidate),
              bestFootprintKeys
            );
          }
          connectivityShadowComparison = compareConnectivityShadowPenalty(
            candidateConnectivityShadowPenalty,
            bestConnectivityShadowPenalty
          );
          recordConnectivityShadowTieDecision({
            record: recordConnectivityShadowDecision,
            profileCounters,
            phase: "service",
            score,
            candidate: servicePlacementTrace(service, probe),
            incumbent: servicePlacementTrace(bestCandidate, bestProbe),
            candidateShadowPenalty: candidateConnectivityShadowPenalty,
            incumbentShadowPenalty: bestConnectivityShadowPenalty,
            comparison: connectivityShadowComparison,
          });
        }
        if (
          scoreComparison > 0
          || connectivityShadowComparison > 0
          || (scoreComparison === 0 && connectivityShadowComparison === 0 && score > 0 && bestCandidate !== null
            && bestProbe !== null
            && compareServiceTieBreaks(service, probe, bestCandidate, bestProbe) < 0)
        ) {
          bestCandidate = service;
          bestCandidateIndex = candidateIndex;
          bestScore = score;
          bestDensityScore = densityScore;
          bestConnectivityShadowPenalty = connectivityShadowComparison !== 0
            ? candidateConnectivityShadowPenalty
            : null;
          bestProbe = probe;
        }
      }

      let lookaheadDisplacedCandidateIndex = -1;
      const preLookaheadBestCandidateIndex = bestCandidateIndex;
      if (
        enableServiceLookahead
        && lookaheadShortlist.length > 1
        && bestCandidate !== null
        && bestProbe !== null
      ) {
        let lookaheadBestEntry = lookaheadShortlist[0]!;
        let lookaheadBestEvaluation = evaluateServiceLookahead(lookaheadBestEntry);
        for (const entry of lookaheadShortlist.slice(1)) {
          const evaluation = evaluateServiceLookahead(entry);
          if (
            compareServiceLookaheadEvaluations(
              entry,
              evaluation,
              lookaheadBestEntry,
              lookaheadBestEvaluation
            ) < 0
          ) {
            lookaheadBestEntry = entry;
            lookaheadBestEvaluation = evaluation;
          }
        }
        if (lookaheadBestEntry.candidateIndex !== bestCandidateIndex) {
          bestCandidate = lookaheadBestEntry.service;
          bestCandidateIndex = lookaheadBestEntry.candidateIndex;
          bestProbe = lookaheadBestEntry.probe;
          bestScore = lookaheadBestEntry.score;
          lookaheadDisplacedCandidateIndex = preLookaheadBestCandidateIndex;
          if (profileCounters) profileCounters.servicePhase.lookaheadWins++;
        }
      }

      if (!bestCandidate || bestCandidateIndex < 0 || bestScore <= 0) break;

      const placement = materializeServicePlacement(bestCandidate);
      const cachedFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[serviceOrderGlobalCandidateIndices[bestCandidateIndex] ?? -1];
      if (!bestProbe) {
        break;
      }
      const newlyOccupiedKeys = attemptState.collectNewlyOccupiedKeys(
        useDeferredRoadCommitment ? null : bestProbe.kind === "explicit" ? bestProbe.roadProbe : null,
        placement,
        cachedFootprintKeys
      );
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: serviceRoadOpportunityPools,
            chosenKey: serviceCandidateKey(bestCandidate),
            chosenCandidate: bestCandidate,
            chosenProbe: bestProbe,
            chosenScore: bestScore,
            compareTieBreaks: compareServiceTieBreaks,
            isLookaheadDisplaced: (entry) => entry.candidateIndex === lookaheadDisplacedCandidateIndex,
          })
        : undefined;
      recordRoadOpportunityPlacement({
        attemptState,
        placement,
        probe: bestProbe,
        phase: "service",
        footprintKeys: cachedFootprintKeys,
        profileCounters,
        record: recordRoadOpportunity,
        score: bestScore,
        counterfactuals,
        typeIndex: bestCandidate.typeIndex,
        bonus: bestCandidate.bonus,
        range: bestCandidate.range,
      });
      const committedKeys = attemptState.commitPlacement(bestProbe, placement, {
        footprintKeys: cachedFootprintKeys,
        newlyOccupiedKeys,
        recordConnectivityShadow: false,
      });
      if (!committedKeys) {
        break;
      }
      services.push(placement);
      serviceTypeIndices.push(bestCandidate.typeIndex);
      serviceBonuses.push(bestCandidate.bonus);
      effectZones.push(getCachedServiceEffectZoneSet(G, precomputedIndexes, bestCandidate));
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
    let bestDensityScore = Number.NEGATIVE_INFINITY;
    let bestConnectivityShadowPenalty: number | null = null;
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "residential");
    const residentialRoadOpportunityPools = createRoadOpportunityCandidatePools<ResidentialCandidatesList[0]>();
    for (const candidateIndex of residentialActivePool.activeIndices) {
      const cand = anyResidentialCandidates[candidateIndex];
      maybeStop?.();
      if (profileCounters) profileCounters.residentialPhase.candidateScans++;
      if (roads.size === 0) {
        if (profileCounters) profileCounters.roads.roadAnchorChecks++;
        if (!placementLeavesRoadAnchorCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      }
      if (profileCounters) profileCounters.residentialPhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, cand.r, cand.c, cand.rows, cand.cols);
      if (!probe) continue;
      if (profileCounters) profileCounters.residentialPhase.populationCacheLookups++;
      const pop = residentialPopulationCache[candidateIndex] ?? -1;
      const densityScore = densityTieBreaker
        ? computePlacementDensityScore(G, cand, pop)
        : 0;
      const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
      if (collectRoadOpportunityCounterfactuals && pop >= 0) {
        const roadOpportunityEntry: RoadOpportunityCandidatePoolEntry<ResidentialCandidatesList[0]> = {
          key: stableResidentialPlacementKey(cand),
          candidate: cand,
          candidateIndex,
          placement: cand,
          probe,
          footprintKeys: residentialFootprintKeys,
          score: pop,
          typeIndex: getCandidateTypeIndex(cand),
        };
        pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
      }
      const scoreComparison = best === null
        ? 1
        : compareDensityAwareScore(
            pop,
            densityScore,
            bestPop,
            bestDensityScore,
            densityTieBreakerToleranceRatio
          );
      let candidateConnectivityShadowPenalty: number | null = null;
      let connectivityShadowComparison = 0;
      if (
        scoreComparison === 0
        && pop >= 0
        && connectivityShadowScoring
        && best !== null
        && bestProbe !== null
        && canUseConnectivityShadowTieBreak(probe, bestProbe)
      ) {
        const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
        candidateConnectivityShadowPenalty = computeConnectivityShadowPenalty(
          attemptState,
          cand,
          residentialFootprintKeys
        );
        if (bestConnectivityShadowPenalty === null) {
          const bestFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[bestCandidateIndex];
          bestConnectivityShadowPenalty = computeConnectivityShadowPenalty(attemptState, best, bestFootprintKeys);
        }
        connectivityShadowComparison = compareConnectivityShadowPenalty(
          candidateConnectivityShadowPenalty,
          bestConnectivityShadowPenalty
        );
        recordConnectivityShadowTieDecision({
          record: recordConnectivityShadowDecision,
          profileCounters,
          phase: "residential",
          score: pop,
          candidate: residentialPlacementTrace(cand, probe),
          incumbent: residentialPlacementTrace(best, bestProbe),
          candidateShadowPenalty: candidateConnectivityShadowPenalty,
          incumbentShadowPenalty: bestConnectivityShadowPenalty,
          comparison: connectivityShadowComparison,
        });
      }
      if (
        scoreComparison > 0
        || connectivityShadowComparison > 0
        || (scoreComparison === 0 && connectivityShadowComparison === 0 && pop >= 0 && best !== null && bestProbe !== null
          && compareResidentialTieBreaks(params, cand, probe, best, bestProbe) < 0)
      ) {
        bestPop = pop;
        bestDensityScore = densityScore;
        bestConnectivityShadowPenalty = connectivityShadowComparison !== 0
          ? candidateConnectivityShadowPenalty
          : null;
        best = cand;
        bestCandidateIndex = candidateIndex;
        bestProbe = probe;
      }
    }
    if (best == null || bestCandidateIndex < 0 || bestPop < 0) break;
    if (!bestProbe) break;
    const residentialFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[bestCandidateIndex];
    const newlyOccupiedKeys = attemptState.collectNewlyOccupiedKeys(
      useDeferredRoadCommitment ? null : bestProbe.kind === "explicit" ? bestProbe.roadProbe : null,
      best,
      residentialFootprintKeys
    );
    const bestTypeIndex = getCandidateTypeIndex(best);
    const counterfactuals = collectRoadOpportunityCounterfactuals
      ? selectRoadOpportunityCounterfactuals({
          pools: residentialRoadOpportunityPools,
          chosenKey: stableResidentialPlacementKey(best),
          chosenCandidate: best,
          chosenProbe: bestProbe,
          chosenScore: bestPop,
          compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
            compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe),
        })
      : undefined;
    recordRoadOpportunityPlacement({
      attemptState,
      placement: best,
      probe: bestProbe,
      phase: "residential",
      footprintKeys: residentialFootprintKeys,
      profileCounters,
      record: recordRoadOpportunity,
      score: bestPop,
      counterfactuals,
      typeIndex: bestTypeIndex,
    });
    const committedKeys = attemptState.commitPlacement(bestProbe, best, {
      footprintKeys: residentialFootprintKeys,
      newlyOccupiedKeys,
      recordConnectivityShadow: false,
    });
    if (!committedKeys) {
      break;
    }
    residentials.push({ r: best.r, c: best.c, rows: best.rows, cols: best.cols });
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

  if (useDeferredRoadCommitment && !attemptState.materializeDeferredRoads(services, residentials)) {
    return null;
  }

  if (localSearch) {
    const phaseStartedAtMs = startGreedyProfilePhase(recordProfilePhase);
    const populationBeforeLocalSearch = totalPopulation;
    try {
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
        recordRoadOpportunity,
        maybeStop,
        explicitRoadProbeScratch
      );
    } finally {
      if (recordProfilePhase) {
        recordProfilePhase("residentialLocalSearch", phaseStartedAtMs, {
          candidatePopulationBefore: populationBeforeLocalSearch,
          candidatePopulationAfter: totalPopulation,
        });
      }
    }
  }

  const occupiedBuildings = new Set<string>();
  for (const s of services) addPlacementCellsToSet(occupiedBuildings, s);
  for (const r of residentials) addPlacementCellsToSet(occupiedBuildings, r);
  const normalizedServices = services.map((service) => normalizeServicePlacement(service));
  const roadConnectedBuildings = [...normalizedServices, ...residentials];

  // Keep only roads connected to the anchor boundary, then re-ensure each placed building
  // is connected to that network (robust against any stray/disconnected roads).
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
    ensureBuildingConnectedToRoads(G, roadsValid, occupiedBuildings, r.r, r.c, r.rows, r.cols, explicitRoadProbeScratch);
  }

  roadsValid = pruneRedundantRoads(G, roadsValid, roadConnectedBuildings);

  assertValidLayoutConstraints({
    grid: G,
    roads: roadsValid,
    services: services.map((service, index) => ({
      ...service,
      bonus: serviceBonuses[index] ?? 0,
    })),
    residentials,
    params,
  }, "Invalid greedy layout");

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

function prepareGreedyInputs(
  G: Grid,
  params: SolverParams,
  options: {
    maxResidentials: number | undefined;
    useServiceTypes: boolean;
    useTypes: boolean;
    localSearch: boolean;
    serviceLookaheadCandidates: number;
    profileCounters?: GreedyProfileCounters;
    recordProfilePhase?: GreedyProfilePhaseRecorder;
    recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
    recordRoadOpportunity?: RoadOpportunityRecorder;
    maybeStop: MaybeStop;
  }
): GreedyPreparedInputs {
  const {
    maxResidentials,
    useServiceTypes,
    useTypes,
    localSearch,
    serviceLookaheadCandidates,
    profileCounters,
    recordProfilePhase,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop,
  } = options;

  maybeStop?.(true);
  const residentialCandidatesLegacy = useTypes ? [] : enumerateResidentialCandidates(G, maybeStop);
  maybeStop?.(true);
  const residentialCandidatesFromTypes = useTypes
    ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes!, maybeStop)
    : [];
  maybeStop?.(true);
  const anyResidentialCandidates = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  const residentialCandidatesForLocal = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  const serviceCandidates = enumerateServiceCandidates(G, params, maybeStop);
  maybeStop?.(true);
  if (profileCounters) profileCounters.precompute.serviceCandidates += serviceCandidates.length;
  const serviceGeometryCache = buildServiceGeometryCache(G, serviceCandidates, maybeStop);
  maybeStop?.(true);
  const serviceEffectZoneSetsByCandidate = serviceGeometryCache.effectZoneKeysByIndex.map((keys) => new Set(keys));
  maybeStop?.(true);
  const residentialCandidateStats = anyResidentialCandidates.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
    typeIndex: getCandidateTypeIndex(residential),
    ...getResidentialBaseMax(params, residential.rows, residential.cols, getCandidateTypeIndex(residential)),
  }));
  maybeStop?.(true);
  if (profileCounters) profileCounters.precompute.residentialCandidates += residentialCandidateStats.length;
  const residentialCandidateGeometryCache = buildFootprintGeometryCache(anyResidentialCandidates, maybeStop);
  maybeStop?.(true);
  const residentialScoringGroups = buildResidentialScoringGroups(residentialCandidateStats, profileCounters, maybeStop);
  maybeStop?.(true);
  const residentialGroupGeometryCache = buildFootprintGeometryCache(residentialScoringGroups, maybeStop);
  maybeStop?.(true);
  if (profileCounters) {
    profileCounters.precompute.geometryCacheEntries += serviceGeometryCache.footprintKeysByIndex.length;
    profileCounters.precompute.geometryCacheEntries += serviceEffectZoneSetsByCandidate.length;
    profileCounters.precompute.geometryCacheEntries += residentialCandidateGeometryCache.footprintKeysByIndex.length;
    profileCounters.precompute.geometryCacheEntries += residentialGroupGeometryCache.footprintKeysByIndex.length;
  }
  const serviceCoverageGroupsByKey = buildServiceCoverageIndex(
    serviceCandidates,
    residentialScoringGroups,
    profileCounters,
    maybeStop
  );
  maybeStop?.(true);
  const precomputedIndexes: GreedyPrecomputedIndexes = {
    serviceCandidateIndicesByKey: new Map(
      serviceCandidates.map((candidate, candidateIndex) => [serviceCandidateKey(candidate), candidateIndex])
    ),
    serviceCandidatesByOccupiedCell: buildFootprintCandidateIndexFromKeys(serviceGeometryCache.footprintKeysByIndex),
    serviceFootprintKeysByCandidate: serviceGeometryCache.footprintKeysByIndex,
    serviceEffectZoneSetsByCandidate: serviceEffectZoneSetsByCandidate,
    residentialGroupsByOccupiedCell: buildResidentialGroupCellIndex(residentialGroupGeometryCache.footprintKeysByIndex),
    serviceCandidateIndicesByResidentialGroup: buildServiceCoverageReverseIndex(
      serviceCandidates,
      serviceCoverageGroupsByKey,
      residentialScoringGroups.length
    ),
    serviceCandidateIndicesByType: useServiceTypes
      ? buildTypedCandidateIndex(
          serviceCandidates.length,
          (candidateIndex) => serviceCandidates[candidateIndex].typeIndex,
          params.serviceTypes!.length
        )
      : null,
    residentialCandidatesByOccupiedCell: buildFootprintCandidateIndexFromKeys(
      residentialCandidateGeometryCache.footprintKeysByIndex
    ),
    residentialCandidateFootprintKeys: residentialCandidateGeometryCache.footprintKeysByIndex,
    residentialCandidateIndicesByType: useTypes
      ? buildTypedCandidateIndex(
          anyResidentialCandidates.length,
          (candidateIndex) => getCandidateTypeIndex(anyResidentialCandidates[candidateIndex]),
          params.residentialTypes!.length
        )
      : null,
  };
  maybeStop?.(true);
  const initialResidentialAvail = useTypes ? params.residentialTypes!.map((type) => type.avail) : null;
  const initialResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  const serviceScores = new Map<string, number>();
  for (const s of serviceCandidates) {
    maybeStop?.();
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
  return {
    serviceCandidates,
    serviceOrderSorted,
    baseSolveContext: {
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
      serviceLookaheadCandidates,
      profileCounters,
      recordProfilePhase,
      recordConnectivityShadowDecision,
      recordRoadOpportunity,
      maybeStop,
    },
  };
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

type DiagnosticExampleSeed = Omit<GreedyDiagnosticExample, "reason">;

function createDiagnosticKindReport(options: {
  placedCount: number;
  overallLimit: number | null;
  availabilityByType: GreedyDiagnosticKindReport["availabilityByType"];
}): GreedyDiagnosticKindReport {
  const { placedCount, overallLimit, availabilityByType } = options;
  return {
    candidateLimit: GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT,
    candidatesScanned: 0,
    candidatesSkippedAsPlaced: 0,
    truncated: false,
    placedCount,
    overallAvailability: {
      limit: overallLimit,
      used: placedCount,
      remaining: overallLimit === null ? null : Math.max(0, overallLimit - placedCount),
    },
    availabilityByType,
    reasonCounts: {},
    examplesByReason: {},
  };
}

function countTypeUsage(typeIndices: readonly number[], typeCount: number): number[] {
  const usage = new Array<number>(typeCount).fill(0);
  for (const typeIndex of typeIndices) {
    if (typeIndex >= 0 && typeIndex < usage.length) usage[typeIndex]++;
  }
  return usage;
}

function buildTypedAvailabilityDiagnostics(
  types: readonly { name?: string; avail: number }[] | undefined,
  typeIndices: readonly number[]
): {
  byType: GreedyDiagnosticKindReport["availabilityByType"];
  usageByType: number[];
  totalAvailability: number | null;
} {
  if (!types?.length) {
    return {
      byType: [],
      usageByType: [],
      totalAvailability: null,
    };
  }
  const usageByType = countTypeUsage(typeIndices, types.length);
  return {
    usageByType,
    totalAvailability: types.reduce((sum, type) => sum + Math.max(0, type.avail), 0),
    byType: types.map((type, typeIndex) => {
      const used = usageByType[typeIndex] ?? 0;
      return {
        typeIndex,
        ...(type.name ? { name: type.name } : {}),
        available: type.avail,
        used,
        remaining: Math.max(0, type.avail - used),
      };
    }),
  };
}

function addDiagnosticReasons(
  report: GreedyDiagnosticKindReport,
  reasons: GreedyPlacementDiagnosticReason[],
  exampleSeed: DiagnosticExampleSeed
): void {
  for (const reason of reasons) {
    report.reasonCounts[reason] = (report.reasonCounts[reason] ?? 0) + 1;
    const examples = report.examplesByReason[reason] ?? [];
    if (examples.length < GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON) {
      examples.push({
        ...exampleSeed,
        reason,
      });
      report.examplesByReason[reason] = examples;
    }
  }
}

function pushDiagnosticReason(
  reasons: GreedyPlacementDiagnosticReason[],
  reason: GreedyPlacementDiagnosticReason
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function buildSolutionOccupiedSet(solution: Solution): Set<string> {
  const occupied = new Set<string>(solution.roads);
  for (const service of solution.services) addPlacementCellsToSet(occupied, normalizeServicePlacement(service));
  for (const residential of solution.residentials) addPlacementCellsToSet(occupied, residential);
  return occupied;
}

function buildPlacedServiceCandidateKeys(solution: Solution): Set<string> {
  return new Set(solution.services.map((_, index) => serviceCandidateKey(materializeChosenServiceCandidate(solution, index))));
}

function buildPlacedResidentialCandidateKeys(solution: Solution): Set<string> {
  return new Set(solution.residentials.map((residential, index) =>
    stableResidentialPlacementKey({
      ...residential,
      typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
    })
  ));
}

function buildCurrentResidentialGroupBoosts(
  solution: Solution,
  residentialScoringGroups: readonly ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>
): number[] {
  const boosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  for (let index = 0; index < solution.services.length; index++) {
    const service = materializeChosenServiceCandidate(solution, index);
    for (const groupIndex of serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? []) {
      boosts[groupIndex] += service.bonus;
    }
  }
  return boosts;
}

type GreedyDiagnosticBuildContext = {
  G: Grid;
  params: SolverParams;
  solution: Solution;
  occupied: Set<string>;
  roadProbeScratch: ReturnType<typeof createRoadProbeScratch>;
  precomputedIndexes: GreedyPrecomputedIndexes;
};

type GreedyTypedAvailabilityDiagnostics = ReturnType<typeof buildTypedAvailabilityDiagnostics>;

function resolveDiagnosticOverallLimit(
  configuredLimit: number | undefined,
  availability: GreedyTypedAvailabilityDiagnostics
): number | null {
  return configuredLimit ?? availability.totalAvailability;
}

function isAvailabilityCappedForCandidate(
  overallCapped: boolean,
  type: { avail: number } | undefined,
  usageByType: readonly number[],
  typeIndex: number
): boolean {
  return overallCapped || Boolean(type && (usageByType[typeIndex] ?? 0) >= type.avail);
}

function isDiagnosticFootprintBlocked(
  occupied: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number },
  footprintKeys?: readonly string[]
): boolean {
  return footprintKeys
    ? overlapsCachedFootprint(occupied, footprintKeys)
    : overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols);
}

function isDiagnosticRoadPathMissing(
  context: GreedyDiagnosticBuildContext,
  placement: { r: number; c: number; rows: number; cols: number }
): boolean {
  return probeExplicitRoadConnection(
    context.G,
    context.solution.roads,
    context.occupied,
    placement,
    context.roadProbeScratch
  ) === null;
}

function markDiagnosticScanLimit(
  report: GreedyDiagnosticKindReport,
  totalCandidateCount: number,
  scannedCandidateCount: number
): void {
  report.truncated = totalCandidateCount > scannedCandidateCount;
}

function buildGreedyServiceDiagnostics(options: {
  context: GreedyDiagnosticBuildContext;
  serviceOrderSorted: readonly ServiceCandidate[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  residentialScoringGroups: ResidentialScoringGroup[];
  currentResidentialGroupBoosts: number[];
  serviceAvailability: GreedyTypedAvailabilityDiagnostics;
  serviceOverallLimit: number | null;
  remainingResidentialAvail: number[] | null;
}): GreedyDiagnosticKindReport {
  const {
    context,
    serviceOrderSorted,
    serviceCoverageGroupsByKey,
    residentialScoringGroups,
    currentResidentialGroupBoosts,
    serviceAvailability,
    serviceOverallLimit,
    remainingResidentialAvail,
  } = options;
  const { params, solution, occupied, precomputedIndexes } = context;
  const placedServiceKeys = buildPlacedServiceCandidateKeys(solution);
  const serviceReport = createDiagnosticKindReport({
    placedCount: solution.services.length,
    overallLimit: serviceOverallLimit,
    availabilityByType: serviceAvailability.byType,
  });
  const serviceOverallCapped =
    serviceOverallLimit !== null && solution.services.length >= serviceOverallLimit;
  const serviceCandidatesToScan = serviceOrderSorted.slice(0, GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT);
  markDiagnosticScanLimit(serviceReport, serviceOrderSorted.length, serviceCandidatesToScan.length);

  for (const service of serviceCandidatesToScan) {
    if (placedServiceKeys.has(serviceCandidateKey(service))) {
      serviceReport.candidatesSkippedAsPlaced++;
      continue;
    }
    serviceReport.candidatesScanned++;
    const reasons: GreedyPlacementDiagnosticReason[] = [];
    const serviceType = params.serviceTypes?.[service.typeIndex];
    if (isAvailabilityCappedForCandidate(
      serviceOverallCapped,
      serviceType,
      serviceAvailability.usageByType,
      service.typeIndex
    )) {
      pushDiagnosticReason(reasons, "availability-cap");
    }

    const footprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, service);
    const blocked = isDiagnosticFootprintBlocked(occupied, service, footprintKeys);
    if (blocked) {
      pushDiagnosticReason(reasons, "blocked-footprint");
    }

    let noRoadPath = false;
    if (!blocked) {
      noRoadPath = isDiagnosticRoadPathMissing(context, service);
      if (noRoadPath) pushDiagnosticReason(reasons, "no-road-path");
    }

    const score = computeServiceMarginalScore(
      service,
      occupied,
      currentResidentialGroupBoosts,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      remainingResidentialAvail
    );
    if (!blocked && !noRoadPath && score <= 0) {
      pushDiagnosticReason(reasons, "no-service-coverage");
    }
    if (!blocked && !noRoadPath && score > 0) {
      pushDiagnosticReason(reasons, "lower-score-no-improvement");
    }

    addDiagnosticReasons(serviceReport, reasons, {
      kind: "service",
      reasons,
      r: service.r,
      c: service.c,
      rows: service.rows,
      cols: service.cols,
      typeIndex: service.typeIndex,
      ...(serviceType?.name ? { typeName: serviceType.name } : {}),
      score,
    });
  }

  return serviceReport;
}

function buildGreedyResidentialDiagnostics(options: {
  context: GreedyDiagnosticBuildContext;
  residentialCandidates: readonly ResidentialCandidateLike[];
  residentialAvailability: GreedyTypedAvailabilityDiagnostics;
  residentialOverallLimit: number | null;
}): GreedyDiagnosticKindReport {
  const {
    context,
    residentialCandidates,
    residentialAvailability,
    residentialOverallLimit,
  } = options;
  const { G, params, solution, occupied, precomputedIndexes } = context;
  const placedResidentialKeys = buildPlacedResidentialCandidateKeys(solution);
  const residentialReport = createDiagnosticKindReport({
    placedCount: solution.residentials.length,
    overallLimit: residentialOverallLimit,
    availabilityByType: residentialAvailability.byType,
  });
  const residentialOverallCapped =
    residentialOverallLimit !== null && solution.residentials.length >= residentialOverallLimit;
  const residentialCandidatesToScan = residentialCandidates.slice(0, GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT);
  markDiagnosticScanLimit(
    residentialReport,
    residentialCandidates.length,
    residentialCandidatesToScan.length
  );
  const finalEffectZones = solution.services.map((_, index) =>
    getCachedServiceEffectZoneSet(G, precomputedIndexes, materializeChosenServiceCandidate(solution, index))
  );
  for (const residential of residentialCandidatesToScan) {
    if (placedResidentialKeys.has(stableResidentialPlacementKey(residential))) {
      residentialReport.candidatesSkippedAsPlaced++;
      continue;
    }
    residentialReport.candidatesScanned++;
    const reasons: GreedyPlacementDiagnosticReason[] = [];
    const typeIndex = getCandidateTypeIndex(residential);
    const residentialType = params.residentialTypes?.[typeIndex];
    if (isAvailabilityCappedForCandidate(
      residentialOverallCapped,
      residentialType,
      residentialAvailability.usageByType,
      typeIndex
    )) {
      pushDiagnosticReason(reasons, "availability-cap");
    }

    const blocked = isDiagnosticFootprintBlocked(occupied, residential);
    if (blocked) {
      pushDiagnosticReason(reasons, "blocked-footprint");
    }

    let noRoadPath = false;
    if (!blocked) {
      noRoadPath = isDiagnosticRoadPathMissing(context, residential);
      if (noRoadPath) pushDiagnosticReason(reasons, "no-road-path");
    }

    const serviceBonuses = solution.servicePopulationIncreases;
    const population = computeResidentialPopulation(params, residential, finalEffectZones, serviceBonuses, typeIndex);
    const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    if (!blocked && !noRoadPath && population <= base) {
      pushDiagnosticReason(reasons, "base-only");
    }
    if (
      !blocked
      && !noRoadPath
      && population > base
    ) {
      pushDiagnosticReason(reasons, "lower-score-no-improvement");
    }

    addDiagnosticReasons(residentialReport, reasons, {
      kind: "residential",
      reasons,
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols,
      typeIndex,
      ...(residentialType?.name ? { typeName: residentialType.name } : {}),
      population,
      basePopulation: base,
      ...(Number.isFinite(max) ? { maxPopulation: max } : {}),
    });
  }

  return residentialReport;
}

function buildGreedyDiagnostics(options: {
  G: Grid;
  params: SolverParams;
  solution: Solution;
  preparedInputs: GreedyPreparedInputs;
  maxServices: number | undefined;
  maxResidentials: number | undefined;
}): GreedyDiagnostics {
  const {
    G,
    params,
    solution,
    preparedInputs,
    maxServices,
    maxResidentials,
  } = options;
  const {
    serviceOrderSorted,
    baseSolveContext: {
      anyResidentialCandidates,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      precomputedIndexes,
    },
  } = preparedInputs;
  const context: GreedyDiagnosticBuildContext = {
    G,
    params,
    solution,
    occupied: buildSolutionOccupiedSet(solution),
    roadProbeScratch: createRoadProbeScratch(G),
    precomputedIndexes,
  };
  const serviceAvailability = buildTypedAvailabilityDiagnostics(params.serviceTypes, solution.serviceTypeIndices);
  const residentialAvailability = buildTypedAvailabilityDiagnostics(params.residentialTypes, solution.residentialTypeIndices);
  const remainingResidentialAvail = params.residentialTypes?.length
    ? params.residentialTypes.map((type, typeIndex) =>
        Math.max(0, type.avail - (residentialAvailability.usageByType[typeIndex] ?? 0))
      )
    : null;
  const currentResidentialGroupBoosts = buildCurrentResidentialGroupBoosts(
    solution,
    residentialScoringGroups,
    serviceCoverageGroupsByKey
  );

  return {
    version: 1,
    candidateLimit: GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT,
    examplesPerReason: GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON,
    services: buildGreedyServiceDiagnostics({
      context,
      serviceOrderSorted,
      serviceCoverageGroupsByKey,
      residentialScoringGroups,
      currentResidentialGroupBoosts,
      serviceAvailability,
      serviceOverallLimit: resolveDiagnosticOverallLimit(maxServices, serviceAvailability),
      remainingResidentialAvail,
    }),
    residentials: buildGreedyResidentialDiagnostics({
      context,
      residentialCandidates: anyResidentialCandidates,
      residentialAvailability,
      residentialOverallLimit: resolveDiagnosticOverallLimit(maxResidentials, residentialAvailability),
    }),
  };
}

function compareCapResults(a: CapResult, b: CapResult): number {
  return b.totalPopulation - a.totalPopulation
    || a.serviceCount - b.serviceCount
    || a.cap - b.cap;
}

function summarizeCapResult(cap: number, phase: CapSearchPhase, solution: Solution | null): CapResult {
  return {
    cap,
    phase,
    solution,
    totalPopulation: solution?.totalPopulation ?? -1,
    serviceCount: solution?.services.length ?? Number.POSITIVE_INFINITY,
  };
}

function buildGreedyServiceCapPolicy(params: SolverParams, maxServices: number | undefined): GreedyServiceCapPolicy {
  // Explicit service caps are maxima, so lower counts remain eligible when extra services block housing.
  const explicitServiceCap = maxServices;
  const positiveBonuses = (params.serviceTypes ?? []).reduce(
    (sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0),
    0
  );
  const totalServiceAvail = (params.serviceTypes ?? []).reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  const serviceAvailabilityUpper = positiveBonuses > 0 ? Math.min(totalServiceAvail, positiveBonuses) : totalServiceAvail;
  const inferredUpper = explicitServiceCap !== undefined
    ? Math.min(explicitServiceCap, serviceAvailabilityUpper)
    : serviceAvailabilityUpper;
  const capPlan = explicitServiceCap !== undefined
    ? {
        coarseCaps: Array.from({ length: inferredUpper + 1 }, (_, cap) => cap),
        refineCaps: [],
        usesAdaptiveSearch: false,
      }
    : buildAdaptiveServiceCapPlan(inferredUpper);
  return {
    explicitServiceCap,
    inferredUpper,
    capPlan,
  };
}

function runGreedyServiceCapSearch(options: {
  policy: GreedyServiceCapPolicy;
  restarts: number;
  profileCounters?: GreedyProfileCounters;
  evaluateNewCap: GreedyCapEvaluator;
  refineExistingCap: GreedyExistingCapRefiner;
}): void {
  const {
    policy,
    restarts,
    profileCounters,
    evaluateNewCap,
    refineExistingCap,
  } = options;
  const { explicitServiceCap, inferredUpper, capPlan } = policy;
  const capResultsByCap = new Map<number, CapResult>();
  const evaluatedCaps = new Set<number>();

  if (explicitServiceCap !== undefined || !capPlan.usesAdaptiveSearch) {
    for (const cap of capPlan.coarseCaps) {
      const solution = evaluateNewCap(cap, "full", restarts, true);
      evaluatedCaps.add(cap);
      capResultsByCap.set(cap, summarizeCapResult(cap, "full", solution));
    }
    return;
  }

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

function runGreedyServiceRefinement(options: {
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

function runGreedyExhaustiveServiceSearch(options: {
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

function runGreedyServiceNeighborhoodSearch(options: {
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
    maybeStop,
  } = options;
  if (!localSearch || !localSearchServiceMoves) return initialBest;
  if (serviceOrderSorted.length === 0) return initialBest;

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
  const serviceNeighborhoodRoadProbeScratch = createRoadProbeScratch(G);

  const compareServiceRelocationMoves = (
    left: ServiceRelocationMove,
    right: ServiceRelocationMove
  ): number =>
    right.estimatedTotalPopulation - left.estimatedTotalPopulation
    || left.forcedServices.length - right.forcedServices.length
    || right.estimatedFutureScore - left.estimatedFutureScore
    || left.estimatedRoadCost - right.estimatedRoadCost
    || (left.kind === right.kind ? 0 : (
      left.kind === "remove" ? -1 : right.kind === "remove" ? 1 : left.kind === "add" ? -1 : 1
    ))
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
      orderedServiceKey: forcedServices.map((service) => stableServicePlacementKey(service)).join("|"),
    };
  };

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
    const removalMoves: ServiceRelocationMove[] = [];
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "service-neighborhood");
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
        orderedServiceKey: scoredMove.orderedServiceKey,
      });
    }
    removalMoves.sort(compareServiceRelocationMoves);
    candidateMoves.push(
      ...removalMoves.slice(0, LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRemoveTrialsPerIteration)
    );

    if (canAddService) {
      let addTrials = 0;
      for (const candidate of serviceOrderSorted) {
        maybeStop?.();
        if (addTrials >= LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxAddTrialsPerIteration) break;
        if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
        if (
          candidate.typeIndex >= 0
          && candidate.typeIndex < incumbentServiceTypeUsage.length
          && (incumbentServiceTypeUsage[candidate.typeIndex] ?? 0) >= (params.serviceTypes?.[candidate.typeIndex]?.avail ?? 0)
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
          moveKind: "service-add",
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
          traceOccupiedBuildings: traceEntry.occupiedBuildings,
        });
      }
    }

    for (let serviceIndex = 0; serviceIndex < incumbentServices.length; serviceIndex++) {
      maybeStop?.();
      const currentChoice = incumbentServices[serviceIndex];
      const candidatePasses = [
        serviceOrderSorted.filter((candidate) => candidate.typeIndex === currentChoice.typeIndex)
          .slice(0, perTypeNeighborhoodLimit),
        serviceOrderSorted.filter((candidate) => candidate.typeIndex !== currentChoice.typeIndex)
          .slice(0, Math.min(localSearchServiceCandidateLimit, serviceOrderSorted.length)),
      ];
      resetOccupancyScratch(occupancyScratch);
      const currentChoiceFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, currentChoice);
      deleteKeysFromOccupancyScratch(
        occupancyScratch,
        currentChoiceFootprintKeys ?? serviceFootprint(currentChoice)
      );
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
            moveKind: "service-swap",
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
            traceOccupiedBuildings: traceEntry.occupiedBuildings,
          });
        }
        if (swapTrials >= maxSwapTrialsThisIteration) break;
      }

      if (swapTrials >= maxSwapTrialsThisIteration) break;
    }

    candidateMoves.sort(compareServiceRelocationMoves);
    const baseRealizationBudget = Math.min(
      candidateMoves.length,
      Math.max(
        LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRealizationAttemptsPerIteration,
        localSearchServiceCandidateLimit
      )
    );
    const realizationMoves = candidateMoves.slice(0, baseRealizationBudget);
    const selectedMoveKeys = new Set(
      realizationMoves.map((move) => `${move.kind}:${move.serviceIndex}:${move.orderedServiceKey}`)
    );
    const guaranteedRealizationBudget = baseRealizationBudget
      + LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxRemoveTrialsPerIteration
      + LOCAL_SEARCH_SERVICE_NEIGHBORHOOD.maxAddTrialsPerIteration;
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
    if (
      iterationBestMove?.traceProbe
      && iterationBestMove.traceKey
      && iterationBestMove.traceOccupiedBuildings
    ) {
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: serviceRoadOpportunityPools,
            chosenKey: iterationBestMove.traceKey,
            chosenCandidate: iterationBestMove.candidate,
            chosenProbe: iterationBestMove.traceProbe,
            chosenScore: iterationBestMove.estimatedTotalPopulation,
            compareTieBreaks: compareServiceTieBreaks,
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
        moveKind: iterationBestMove.kind === "add" ? "service-add" : "service-swap",
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

function runGreedyResidualServiceBundleRepair(options: {
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
    maybeStop,
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

  const remainingAvailForIncumbent = useTypes && params.residentialTypes
    ? params.residentialTypes.map((type) => type.avail)
    : null;
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
  const scanLimit = Math.min(
    serviceOrderSorted.length,
    Math.max(trialLimit, localSearchServiceCandidateLimit * 4, 16)
  );
  const trials: ResidualServiceBundleTrial[] = [];
  const repairProbe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } } as const;

  for (const candidate of serviceOrderSorted.slice(0, scanLimit)) {
    maybeStop?.();
    if (trials.length >= trialLimit) break;
    if (candidate.bonus <= 0) continue;
    if (incumbentServiceKeys.has(serviceCandidateKey(candidate))) continue;
    if (
      candidate.typeIndex >= 0
      && candidate.typeIndex < incumbentServiceTypeUsage.length
      && (incumbentServiceTypeUsage[candidate.typeIndex] ?? 0) >= (params.serviceTypes?.[candidate.typeIndex]?.avail ?? 0)
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
      getCachedServiceEffectZoneSet(G, precomputedIndexes, candidate),
    ];
    const futureServiceBonuses = [...incumbentServiceBonuses, candidate.bonus];
    let estimatedKeptPopulation = 0;
    const remainingAvailAfterDisplacement = remainingAvailForIncumbent
      ? [...remainingAvailForIncumbent]
      : null;
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
      orderedServiceKey: forcedServices.map((service) => stableServicePlacementKey(service)).join("|"),
    });
  }

  trials.sort((left, right) =>
    right.estimatedTotalPopulation - left.estimatedTotalPopulation
    || right.estimatedFutureScore - left.estimatedFutureScore
    || left.displacedResidentialCount - right.displacedResidentialCount
    || compareServiceTieBreaks(left.candidate, repairProbe, right.candidate, repairProbe)
    || left.orderedServiceKey.localeCompare(right.orderedServiceKey)
  );

  let best = initialBest;
  const initialRoadSeed = solutionRoadAnchorSeed(initialBest);
  for (const trialEntry of trials) {
    maybeStop?.();
    const trial = solveWithOrder(serviceOrderSorted, {
      maxServices: trialEntry.forcedServices.length,
      fixedServices: trialEntry.forcedServices,
      initialRoadSeed,
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

function createGreedyForcedServiceEvaluator(options: {
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
    stopFilePath,
    snapshotFilePath,
  } = getGreedyOptions(params);
  const profileCounters = profile ? createGreedyProfileCounters() : undefined;
  const profilePhases = profile ? createGreedyProfilePhaseSummaries() : undefined;
  const {
    decisions: connectivityShadowDecisions,
    recordDecision: recordConnectivityShadowDecision,
  } = createConnectivityShadowDecisionRecorder(profile);
  const {
    traces: roadOpportunityTraces,
    recordRoadOpportunity,
  } = createRoadOpportunityRecorder(profile);
  const { maxServices, maxResidentials } = getBuildingLimits(params);
  const useServiceTypes = (params.serviceTypes?.length ?? 0) > 0;
  const useTypes = (params.residentialTypes?.length ?? 0) > 0;
  let best: Solution | null = null;
  let stopCounter = 0;
  const startedAtMs = Date.now();
  const deadlineAtMs = timeLimitSeconds === undefined ? null : startedAtMs + timeLimitSeconds * 1000;

  const maybeStop = (force = false): void => {
    if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
      throw new GreedyStopError(best ? { ...best, stoppedByTimeLimit: true } : null, "time-limit");
    }
    if (!stopFilePath) return;
    stopCounter += 1;
    if (!force && stopCounter % 128 !== 0) return;
    if (!existsSync(stopFilePath)) return;
    throw new GreedyStopError(best ? { ...best, stoppedByUser: true } : null, "cancelled");
  };

  const updateBest = (candidate: Solution | null): void => {
    if (!candidate) return;
    const isBetterCandidate = densityTieBreaker
      ? isBetterDensityAwareSearchSolution(G, candidate, best)
      : isBetterSearchSolution(candidate, best);
    if (isBetterCandidate) {
      best = candidate;
      if (snapshotFilePath) writeSolutionSnapshot(snapshotFilePath, best);
    }
  };

  const getBestPopulation = (): number | null => best?.totalPopulation ?? null;
  const recordProfilePhase = createGreedyProfilePhaseRecorder(profilePhases);
  const runProfiledPhase = <T>(phase: GreedyProfilePhaseName, run: () => T): T => {
    return runGreedyProfilePhase({
      phase,
      recordProfilePhase,
      getBestPopulation,
      run,
    });
  };

  const preparedInputs = runProfiledPhase("precompute", () => prepareGreedyInputs(G, params, {
    maxResidentials,
    useServiceTypes,
    useTypes,
    localSearch,
    serviceLookaheadCandidates,
    profileCounters,
    recordProfilePhase,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop,
  }));
  const { serviceOrderSorted, baseSolveContext } = preparedInputs;
  const {
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    precomputedIndexes,
  } = baseSolveContext;
  const solveWithOrder = createGreedySolveAttempt(G, params, baseSolveContext, profileCounters);

  const finalizeGreedySolution = (solution: Solution): Solution => {
    const withDiagnostics = diagnostics
      ? {
          ...solution,
          greedyDiagnostics: buildGreedyDiagnostics({
            G,
            params,
            solution,
            preparedInputs,
            maxServices,
            maxResidentials,
          }),
        }
      : solution;
    if (!profileCounters) return withDiagnostics;
    return {
      ...withDiagnostics,
      greedyProfile: {
        counters: structuredClone(profileCounters),
        phases: structuredClone(profilePhases ?? []),
        connectivityShadowDecisions: structuredClone(connectivityShadowDecisions ?? []),
        connectivityShadowDecisionTraceLimit: CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT,
        roadOpportunityTraces: structuredClone(roadOpportunityTraces ?? []),
        roadOpportunityTraceLimit: ROAD_OPPORTUNITY_TRACE_LIMIT,
      },
    };
  };
  const applyConnectivityShadowBaselineGuard = (solution: Solution): Solution => {
    if (!connectivityShadowScoring) return solution;
    const remainingSeconds =
      deadlineAtMs === null ? undefined : Math.max(0, (deadlineAtMs - Date.now()) / 1000);
    if (remainingSeconds !== undefined && remainingSeconds <= 0) {
      return solution;
    }
    let baseline: Solution;
    try {
      baseline = solveGreedy(
        G.map((row) => [...row]),
        buildConnectivityShadowBaselineGuardParams(params, remainingSeconds)
      );
    } catch (error) {
      if (error instanceof GreedyStopError) return solution;
      throw error;
    }
    const guarded = chooseConnectivityShadowGuardedSolution(solution, baseline);
    if (snapshotFilePath) writeSolutionSnapshot(snapshotFilePath, guarded);
    return guarded;
  };

  const evaluateForcedServiceSet = createGreedyForcedServiceEvaluator({
    G,
    serviceOrderSorted,
    solveWithOrder,
    updateBest,
    profileCounters,
    recordProfilePhase,
    getBestPopulation,
    maybeStop,
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
          initialRoadSeed: roadSeed,
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

  const { explicitServiceCap, inferredUpper, capPlan } = buildGreedyServiceCapPolicy(params, maxServices);
  const requireBest = (): Solution => {
    if (!best) throw new Error("No feasible solution found.");
    return best;
  };

  try {
    runProfiledPhase("constructiveCapSearch", () => runGreedyServiceCapSearch({
      policy: { explicitServiceCap, inferredUpper, capPlan },
      restarts,
      profileCounters,
      evaluateNewCap,
      refineExistingCap,
    }));

    let incumbent = requireBest();
    best = runProfiledPhase("serviceRefinement", () => runGreedyServiceRefinement({
      initialBest: incumbent,
      serviceRefineIterations,
      serviceRefineCandidateLimit,
      serviceOrderSorted,
      evaluateForcedServiceSet,
      updateBest,
      maybeStop,
    }));

    incumbent = best;
    best = runProfiledPhase("exhaustiveServiceSearch", () => runGreedyExhaustiveServiceSearch({
      initialBest: incumbent,
      enabled: exhaustiveServiceSearch,
      serviceExactPoolLimit,
      serviceExactMaxCombinations,
      serviceOrderSorted,
      evaluateForcedServiceSet,
      updateBest,
      profileCounters,
      maybeStop,
    }));

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
          maybeStop,
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
          maybeStop,
        });
      });
      if (isBetterSearchSolution(serviceLocalBest, best)) {
        best = serviceLocalBest;
        updateBest(best);
      }
    }
  } catch (error) {
    if (error instanceof GreedyStopError) {
      if (error.bestSolution) return applyConnectivityShadowBaselineGuard(finalizeGreedySolution(error.bestSolution));
      throw error;
    }
    throw error;
  }

  return applyConnectivityShadowBaselineGuard(finalizeGreedySolution(best as Solution));
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
  recordRoadOpportunity?: RoadOpportunityRecorder,
  maybeStop?: () => void,
  explicitRoadProbeScratch = createRoadProbeScratch(G)
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
    key: string;
    probe: ConnectivityProbe;
    occupiedBuildings: Set<string>;
  };
  type AddChoice = {
    kind: "add";
    candidate: ResidentialPlacement | ResidentialCandidate;
    candidateTypeIndex: number;
    addPop: number;
    key: string;
    probe: ConnectivityProbe;
    occupiedBuildings: Set<string>;
  };

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
      profileCounters
    );

  for (let iter = 0; iter < maxIter; iter++) {
    maybeStop?.();
    if (profileCounters) profileCounters.attempts.localSearchIterations++;
    const moveOccupancyScratch = residentials.length > 0 ? createOccupancyScratch(occupied) : null;
    let bestMove: MoveChoice | null = null;
    let bestMoveDelta = 0;
    let bestMoveProbe: RoadConnectionProbe | null = null;
    let bestAdd: AddChoice | null = null;
    let bestAddDelta = 0;
    let bestAddProbe: RoadConnectionProbe | null = null;
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "residential-local-search");
    const residentialRoadOpportunityPools =
      createRoadOpportunityCandidatePools<ResidentialPlacement | ResidentialCandidate>();

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
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (!placementLeavesRoadAnchorCellAvailable(G, othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
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
        const traceOccupiedBuildings = delta > 0 && (profileCounters || recordRoadOpportunity)
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
            moveKind: "residential-move",
          };
          pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
        }
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
            key: traceKey,
            probe: traceProbe,
            occupiedBuildings: traceOccupiedBuildings ?? buildLocalSearchBuildingOccupancy(services, residentials, i),
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
          if (!placementLeavesRoadAnchorCellAvailable(G, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
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
        const traceOccupiedBuildings = addPop > 0 && (profileCounters || recordRoadOpportunity)
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
            moveKind: "residential-add",
          };
          pushRoadOpportunityCandidate(residentialRoadOpportunityPools, roadOpportunityEntry);
        }
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
            key: traceKey,
            probe: traceProbe,
            occupiedBuildings: traceOccupiedBuildings ?? buildLocalSearchBuildingOccupancy(services, residentials),
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
      if (!bestAddProbe) break;
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: residentialRoadOpportunityPools,
            chosenKey: bestAdd.key,
            chosenCandidate: bestAdd.candidate,
            chosenProbe: bestAdd.probe,
            chosenScore: bestAddDelta,
            compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
              compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe),
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
        moveKind: "residential-add",
      });
      commitExplicitRoadConnectedPlacement({
        roads,
        occupied,
        probe: bestAddProbe,
        placement: candidate,
        profileCounters,
      });
      residentials.push({ r: candidate.r, c: candidate.c, rows: candidate.rows, cols: candidate.cols });
      residentialTypeIndices.push(candidateTypeIndex);
      populations.push(addPop);
      if (useTypes && remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
      if (profileCounters) profileCounters.localSearch.placements++;
      continue;
    }

    if (bestMove) {
      const currentResidential = residentials[bestMove.residentialIndex];
      const counterfactuals = collectRoadOpportunityCounterfactuals
        ? selectRoadOpportunityCounterfactuals({
            pools: residentialRoadOpportunityPools,
            chosenKey: bestMove.key,
            chosenCandidate: bestMove.candidate,
            chosenProbe: bestMove.probe,
            chosenScore: bestMoveDelta,
            compareTieBreaks: (candidate, probe, chosen, chosenProbe) =>
              compareResidentialTieBreaks(params, candidate, probe, chosen, chosenProbe),
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
        moveKind: "residential-move",
      });
      deletePlacementCellsFromSet(occupied, currentResidential);
      if (useTypes && remainingAvail && bestMove.currentTypeIndex >= 0) remainingAvail[bestMove.currentTypeIndex]++;
      if (!bestMoveProbe) break;
      commitExplicitRoadConnectedPlacement({
        roads,
        occupied,
        probe: bestMoveProbe,
        placement: bestMove.candidate,
        profileCounters,
      });
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
