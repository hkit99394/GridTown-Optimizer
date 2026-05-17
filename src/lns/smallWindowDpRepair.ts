import { performance } from "node:perf_hooks";

import {
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  residentialFootprint,
  serviceEffectZone,
  serviceFootprint,
} from "../core/buildings.js";
import { cellFromKey, cellKey } from "../core/types.js";
import { height, isAllowed, width } from "../core/grid.js";
import { getBuildingLimits, getResidentialBaseMax, NO_TYPE_INDEX } from "../core/rules.js";
import { isAdjacentToRoads, roadsConnectedToRoadAnchor } from "../core/roads.js";
import { validateSolution } from "../core/evaluator.js";

import type {
  CpSatNeighborhoodWindow,
  Grid,
  ResidentialCandidate,
  ResidentialPlacement,
  ServicePlacement,
  Solution,
  SolverParams,
} from "../core/types.js";

export interface SmallWindowDpRepairOptions {
  maxWindowCells: number;
  maxCandidates: number;
  maxStates: number;
}

export interface SmallWindowDpRepairTelemetry {
  eligible: boolean;
  reason: string | null;
  windowCells: number;
  usableWindowCells: number;
  serviceCandidateCount: number;
  residentialCandidateCount: number;
  roadMaskCount: number;
  serviceSubsetCount: number;
  residentialStateCount: number;
  elapsedSeconds: number;
  bestPopulation: number | null;
}

export interface SmallWindowDpRepairResult {
  solution: Solution | null;
  telemetry: SmallWindowDpRepairTelemetry;
}

interface FixedServiceEntry {
  placement: ServicePlacement;
  typeIndex: number;
  bonus: number;
}

interface FixedResidentialEntry {
  placement: ResidentialPlacement;
  typeIndex: number;
}

interface DpServiceCandidate extends FixedServiceEntry {
  mask: number;
  effectZone: Set<string>;
}

interface DpResidentialCandidate extends FixedResidentialEntry {
  mask: number;
}

interface ServiceSearchState {
  selected: DpServiceCandidate[];
  occupiedMask: number;
  remainingTypeCounts: number[];
  remainingTotal: number;
}

interface ResidentialSearchResult {
  population: number;
  selectedIndices: number[];
}

interface BestDpRepair {
  solution: Solution;
  roadCount: number;
  serviceCount: number;
}

class SmallWindowDpStateLimitError extends Error {
  constructor() {
    super("small-window-dp-state-limit");
  }
}

function makeTelemetry(
  startedAtMs: number,
  window: CpSatNeighborhoodWindow,
  usableWindowCells: number,
  overrides: Partial<SmallWindowDpRepairTelemetry>
): SmallWindowDpRepairTelemetry {
  return {
    eligible: false,
    reason: null,
    windowCells: Math.max(0, window.rows * window.cols),
    usableWindowCells,
    serviceCandidateCount: 0,
    residentialCandidateCount: 0,
    roadMaskCount: 0,
    serviceSubsetCount: 0,
    residentialStateCount: 0,
    elapsedSeconds: (performance.now() - startedAtMs) / 1000,
    bestPopulation: null,
    ...overrides,
  };
}

function finishIneligible(
  startedAtMs: number,
  window: CpSatNeighborhoodWindow,
  usableWindowCells: number,
  reason: string,
  overrides: Partial<SmallWindowDpRepairTelemetry> = {}
): SmallWindowDpRepairResult {
  return {
    solution: null,
    telemetry: makeTelemetry(startedAtMs, window, usableWindowCells, {
      ...overrides,
      eligible: false,
      reason,
    }),
  };
}

function rectangleIntersectsWindow(
  window: CpSatNeighborhoodWindow,
  rect: { r: number; c: number; rows: number; cols: number }
): boolean {
  return rect.r < window.top + window.rows
    && rect.r + rect.rows > window.top
    && rect.c < window.left + window.cols
    && rect.c + rect.cols > window.left;
}

function rectangleInsideWindow(
  window: CpSatNeighborhoodWindow,
  rect: { r: number; c: number; rows: number; cols: number }
): boolean {
  return rect.r >= window.top
    && rect.c >= window.left
    && rect.r + rect.rows <= window.top + window.rows
    && rect.c + rect.cols <= window.left + window.cols;
}

function keyInsideWindow(window: CpSatNeighborhoodWindow, key: string): boolean {
  const { r, c } = cellFromKey(key);
  return r >= window.top
    && r < window.top + window.rows
    && c >= window.left
    && c < window.left + window.cols;
}

function buildWindowCellIndex(
  G: Grid,
  window: CpSatNeighborhoodWindow
): { cellIndexByKey: Map<string, number>; allowedBits: number[]; allowedKeysByBit: Map<number, string> } {
  const cellIndexByKey = new Map<string, number>();
  const allowedBits: number[] = [];
  const allowedKeysByBit = new Map<number, string>();
  let index = 0;
  const H = height(G);
  const W = width(G);
  const bottom = Math.min(H, window.top + window.rows);
  const right = Math.min(W, window.left + window.cols);
  for (let r = Math.max(0, window.top); r < bottom; r++) {
    for (let c = Math.max(0, window.left); c < right; c++) {
      const key = cellKey(r, c);
      const bit = 1 << index;
      cellIndexByKey.set(key, index);
      if (isAllowed(G, r, c)) {
        allowedBits.push(bit);
        allowedKeysByBit.set(bit, key);
      }
      index += 1;
    }
  }
  return { cellIndexByKey, allowedBits, allowedKeysByBit };
}

function footprintMask(footprint: readonly string[], cellIndexByKey: ReadonlyMap<string, number>): number | null {
  let mask = 0;
  for (const key of footprint) {
    const index = cellIndexByKey.get(key);
    if (index === undefined) return null;
    mask |= 1 << index;
  }
  return mask;
}

function serviceEntryFromIncumbent(solution: Solution, index: number): FixedServiceEntry {
  const service = solution.services[index]!;
  return {
    placement: service,
    typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
    bonus: solution.servicePopulationIncreases[index] ?? 0,
  };
}

function residentialEntryFromIncumbent(solution: Solution, index: number): FixedResidentialEntry {
  const residential = solution.residentials[index]!;
  return {
    placement: residential,
    typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
  };
}

function buildRoadSet(
  fixedRoads: ReadonlySet<string>,
  roadMask: number,
  allowedKeysByBit: ReadonlyMap<number, string>
): Set<string> {
  const roads = new Set(fixedRoads);
  for (const [bit, key] of allowedKeysByBit) {
    if ((roadMask & bit) !== 0) roads.add(key);
  }
  return roads;
}

function countByType(entries: readonly { typeIndex: number }[], typeCount: number): number[] {
  const counts = new Array<number>(typeCount).fill(0);
  for (const entry of entries) {
    if (entry.typeIndex >= 0 && entry.typeIndex < counts.length) counts[entry.typeIndex] += 1;
  }
  return counts;
}

function remainingTypeCounts(
  typeSettings: readonly { avail: number }[] | undefined,
  fixedEntries: readonly { typeIndex: number }[]
): number[] {
  const types = typeSettings ?? [];
  const fixedCounts = countByType(fixedEntries, types.length);
  return types.map((type, index) => Math.max(0, type.avail - fixedCounts[index]!));
}

function hasNegativeTypeCapacity(
  typeSettings: readonly { avail: number }[] | undefined,
  fixedEntries: readonly { typeIndex: number }[]
): boolean {
  const types = typeSettings ?? [];
  const fixedCounts = countByType(fixedEntries, types.length);
  return fixedCounts.some((count, index) => count > (types[index]?.avail ?? 0));
}

function getRemainingTotal(limit: number | undefined, fixedCount: number): number {
  return limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, limit - fixedCount);
}

function candidateServicesFromWindow(
  G: Grid,
  params: SolverParams,
  window: CpSatNeighborhoodWindow,
  cellIndexByKey: ReadonlyMap<string, number>
): DpServiceCandidate[] {
  return enumerateServiceCandidates(G, params)
    .filter((candidate) => rectangleInsideWindow(window, candidate))
    .flatMap((candidate): DpServiceCandidate[] => {
      const mask = footprintMask(serviceFootprint(candidate), cellIndexByKey);
      if (mask === null) return [];
      const placement: ServicePlacement = {
        r: candidate.r,
        c: candidate.c,
        rows: candidate.rows,
        cols: candidate.cols,
        range: candidate.range,
      };
      return [{
        placement,
        typeIndex: candidate.typeIndex,
        bonus: candidate.bonus,
        mask,
        effectZone: new Set(serviceEffectZone(G, placement)),
      }];
    });
}

function enumerateTypedOrLegacyResidentialCandidates(G: Grid, params: SolverParams): ResidentialCandidate[] {
  const types = params.residentialTypes ?? [];
  if (types.length > 0) return enumerateResidentialCandidatesFromTypes(G, types);
  return enumerateResidentialCandidates(G).map((candidate) => ({
    ...candidate,
    typeIndex: NO_TYPE_INDEX,
  }));
}

function candidateResidentialsFromWindow(
  G: Grid,
  params: SolverParams,
  window: CpSatNeighborhoodWindow,
  cellIndexByKey: ReadonlyMap<string, number>
): DpResidentialCandidate[] {
  return enumerateTypedOrLegacyResidentialCandidates(G, params)
    .filter((candidate) => rectangleInsideWindow(window, candidate))
    .flatMap((candidate): DpResidentialCandidate[] => {
      const mask = footprintMask(residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols), cellIndexByKey);
      if (mask === null) return [];
      return [{
        placement: {
          r: candidate.r,
          c: candidate.c,
          rows: candidate.rows,
          cols: candidate.cols,
        },
        typeIndex: candidate.typeIndex,
        mask,
      }];
    });
}

function serviceEntryWithEffectZone(G: Grid, service: FixedServiceEntry): DpServiceCandidate {
  return {
    ...service,
    mask: 0,
    effectZone: new Set(serviceEffectZone(G, service.placement)),
  };
}

function residentialPopulation(
  params: SolverParams,
  residential: FixedResidentialEntry,
  services: readonly DpServiceCandidate[]
): number {
  let boost = 0;
  const footprint = residentialFootprint(
    residential.placement.r,
    residential.placement.c,
    residential.placement.rows,
    residential.placement.cols
  );
  for (const service of services) {
    if (footprint.some((key) => service.effectZone.has(key))) boost += service.bonus;
  }
  const { base, max } = getResidentialBaseMax(
    params,
    residential.placement.rows,
    residential.placement.cols,
    residential.typeIndex
  );
  return Math.min(Math.max(base + boost, base), max);
}

function isBuildingRoadCompatible(
  roads: ReadonlySet<string>,
  building: { r: number; c: number; rows: number; cols: number }
): boolean {
  return isAdjacentToRoads(new Set(roads), building.r, building.c, building.rows, building.cols);
}

function buildSolution(
  G: Grid,
  params: SolverParams,
  roads: Set<string>,
  fixedServices: readonly FixedServiceEntry[],
  selectedServices: readonly DpServiceCandidate[],
  fixedResidentials: readonly FixedResidentialEntry[],
  selectedResidentials: readonly DpResidentialCandidate[]
): Solution | null {
  const serviceEntries = [...fixedServices, ...selectedServices];
  const residentialEntries = [...fixedResidentials, ...selectedResidentials];
  const draft: Solution = {
    optimizer: "lns",
    roads,
    services: serviceEntries.map((entry) => ({ ...entry.placement })),
    serviceTypeIndices: serviceEntries.map((entry) => entry.typeIndex),
    servicePopulationIncreases: serviceEntries.map((entry) => entry.bonus),
    residentials: residentialEntries.map((entry) => ({ ...entry.placement })),
    residentialTypeIndices: residentialEntries.map((entry) => entry.typeIndex),
    populations: residentialEntries.map(() => 0),
    totalPopulation: 0,
  };
  const validation = validateSolution({ grid: G, params, solution: draft }, { ignoreReportedPopulation: true });
  if (!validation.valid) return null;
  const solution: Solution = {
    ...draft,
    populations: validation.recomputedPopulations,
    totalPopulation: validation.recomputedTotalPopulation,
  };
  return validateSolution({ grid: G, params, solution }).valid ? solution : null;
}

function isBetterRepair(candidate: Solution, best: BestDpRepair | null): boolean {
  if (!best) return true;
  if (candidate.totalPopulation !== best.solution.totalPopulation) {
    return candidate.totalPopulation > best.solution.totalPopulation;
  }
  const candidateTieBreak = candidate.roads.size + candidate.services.length;
  const bestTieBreak = best.roadCount + best.serviceCount;
  if (candidateTieBreak !== bestTieBreak) return candidateTieBreak < bestTieBreak;
  if (candidate.roads.size !== best.roadCount) return candidate.roads.size < best.roadCount;
  return candidate.services.length < best.serviceCount;
}

function solveResidentialDp(
  candidates: readonly DpResidentialCandidate[],
  values: readonly number[],
  occupiedMask: number,
  remainingTypeCounts: readonly number[],
  remainingTotal: number,
  incrementStateCount: () => void
): ResidentialSearchResult {
  const memo = new Map<string, ResidentialSearchResult>();

  function key(index: number, mask: number, typeCounts: readonly number[], total: number): string {
    return `${index}|${mask}|${total}|${typeCounts.join(",")}`;
  }

  function dfs(index: number, mask: number, typeCounts: number[], total: number): ResidentialSearchResult {
    incrementStateCount();
    if (index >= candidates.length || total <= 0) return { population: 0, selectedIndices: [] };

    const memoKey = key(index, mask, typeCounts, total);
    const cached = memo.get(memoKey);
    if (cached) return cached;

    const skipped = dfs(index + 1, mask, typeCounts, total);
    let best = skipped;
    const candidate = candidates[index]!;
    const typeIndex = candidate.typeIndex;
    const hasTypeCapacity = typeIndex === NO_TYPE_INDEX || (typeCounts[typeIndex] ?? 0) > 0;
    if (hasTypeCapacity && (candidate.mask & mask) === 0) {
      if (typeIndex !== NO_TYPE_INDEX) typeCounts[typeIndex]!--;
      const chosenRest = dfs(index + 1, mask | candidate.mask, typeCounts, total - 1);
      if (typeIndex !== NO_TYPE_INDEX) typeCounts[typeIndex]!++;
      const chosen: ResidentialSearchResult = {
        population: values[index]! + chosenRest.population,
        selectedIndices: [index, ...chosenRest.selectedIndices],
      };
      if (chosen.population > best.population) best = chosen;
    }

    memo.set(memoKey, best);
    return best;
  }

  return dfs(0, occupiedMask, [...remainingTypeCounts], remainingTotal);
}

function roadMaskFromSubsetIndex(subsetIndex: number, allowedBits: readonly number[]): number {
  let mask = 0;
  for (let index = 0; index < allowedBits.length; index++) {
    if ((subsetIndex & (1 << index)) !== 0) mask |= allowedBits[index]!;
  }
  return mask;
}

export function solveSmallWindowDpRepair(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  window: CpSatNeighborhoodWindow,
  options: SmallWindowDpRepairOptions
): SmallWindowDpRepairResult {
  const startedAtMs = performance.now();
  const { cellIndexByKey, allowedBits, allowedKeysByBit } = buildWindowCellIndex(G, window);
  const usableWindowCells = allowedBits.length;
  if (usableWindowCells > options.maxWindowCells) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "usable-window-cell-limit");
  }
  if (usableWindowCells > 20) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "bitmask-width-limit");
  }

  const fixedServices: FixedServiceEntry[] = [];
  for (let index = 0; index < incumbent.services.length; index++) {
    const service = incumbent.services[index]!;
    if (!rectangleIntersectsWindow(window, service)) {
      fixedServices.push(serviceEntryFromIncumbent(incumbent, index));
      continue;
    }
    if (!rectangleInsideWindow(window, service)) {
      return finishIneligible(startedAtMs, window, usableWindowCells, "intersecting-service-crosses-window-boundary");
    }
  }

  const fixedResidentials: FixedResidentialEntry[] = [];
  for (let index = 0; index < incumbent.residentials.length; index++) {
    const residential = incumbent.residentials[index]!;
    if (!rectangleIntersectsWindow(window, residential)) {
      fixedResidentials.push(residentialEntryFromIncumbent(incumbent, index));
      continue;
    }
    if (!rectangleInsideWindow(window, residential)) {
      return finishIneligible(startedAtMs, window, usableWindowCells, "intersecting-residential-crosses-window-boundary");
    }
  }

  const buildingLimits = getBuildingLimits(params);
  if (buildingLimits.maxServices !== undefined && fixedServices.length > buildingLimits.maxServices) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "fixed-service-limit-exceeded");
  }
  if (buildingLimits.maxResidentials !== undefined && fixedResidentials.length > buildingLimits.maxResidentials) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "fixed-residential-limit-exceeded");
  }
  if (hasNegativeTypeCapacity(params.serviceTypes, fixedServices)) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "fixed-service-type-limit-exceeded");
  }
  if (hasNegativeTypeCapacity(params.residentialTypes, fixedResidentials)) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "fixed-residential-type-limit-exceeded");
  }

  const serviceCandidates = candidateServicesFromWindow(G, params, window, cellIndexByKey);
  const residentialCandidates = candidateResidentialsFromWindow(G, params, window, cellIndexByKey);
  const candidateCount = serviceCandidates.length + residentialCandidates.length;
  if (candidateCount > options.maxCandidates) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "candidate-limit", {
      serviceCandidateCount: serviceCandidates.length,
      residentialCandidateCount: residentialCandidates.length,
    });
  }

  const roadMaskCount = 2 ** allowedBits.length;
  if (roadMaskCount > options.maxStates) {
    return finishIneligible(startedAtMs, window, usableWindowCells, "road-mask-state-limit", {
      serviceCandidateCount: serviceCandidates.length,
      residentialCandidateCount: residentialCandidates.length,
      roadMaskCount,
    });
  }

  const fixedRoads = new Set([...incumbent.roads].filter((key) => !keyInsideWindow(window, key)));
  const fixedServiceEntries = fixedServices.map((service) => serviceEntryWithEffectZone(G, service));
  const remainingServiceTypeCounts = remainingTypeCounts(params.serviceTypes, fixedServices);
  const remainingResidentialTypeCounts = remainingTypeCounts(params.residentialTypes, fixedResidentials);
  const remainingServices = getRemainingTotal(buildingLimits.maxServices, fixedServices.length);
  const remainingResidentials = getRemainingTotal(buildingLimits.maxResidentials, fixedResidentials.length);
  let best: BestDpRepair | null = null;
  let serviceSubsetCount = 0;
  let residentialStateCount = 0;

  const incrementStateCount = (): void => {
    residentialStateCount += 1;
    if (residentialStateCount > options.maxStates) throw new SmallWindowDpStateLimitError();
  };

  try {
    for (let subsetIndex = 0; subsetIndex < roadMaskCount; subsetIndex++) {
      const roadMask = roadMaskFromSubsetIndex(subsetIndex, allowedBits);
      const roads = buildRoadSet(fixedRoads, roadMask, allowedKeysByBit);
      if (roadsConnectedToRoadAnchor(G, roads).size !== roads.size) continue;

      const searchServices = (index: number, state: ServiceSearchState): void => {
        residentialStateCount += 1;
        if (residentialStateCount > options.maxStates) throw new SmallWindowDpStateLimitError();
        if (index >= serviceCandidates.length || state.remainingTotal <= 0) {
          serviceSubsetCount += 1;
          const selectedServices = [...state.selected];
          const allServices = [...fixedServiceEntries, ...selectedServices];
          const fixedPopulation = fixedResidentials.reduce(
            (sum, residential) => sum + residentialPopulation(params, residential, allServices),
            0
          );
          const compatibleResidentials = residentialCandidates.filter((candidate) =>
            (candidate.mask & (roadMask | state.occupiedMask)) === 0
            && isBuildingRoadCompatible(roads, candidate.placement)
          );
          const values = compatibleResidentials.map((candidate) => residentialPopulation(params, candidate, allServices));
          const residentialResult = solveResidentialDp(
            compatibleResidentials,
            values,
            roadMask | state.occupiedMask,
            remainingResidentialTypeCounts,
            remainingResidentials,
            incrementStateCount
          );
          const selectedResidentials = residentialResult.selectedIndices.map((candidateIndex) =>
            compatibleResidentials[candidateIndex]!
          );
          const solution = buildSolution(
            G,
            params,
            roads,
            fixedServices,
            selectedServices,
            fixedResidentials,
            selectedResidentials
          );
          if (!solution) return;
          if (solution.totalPopulation !== fixedPopulation + residentialResult.population) return;
          if (isBetterRepair(solution, best)) {
            best = {
              solution,
              roadCount: solution.roads.size,
              serviceCount: solution.services.length,
            };
          }
          return;
        }

        searchServices(index + 1, state);
        const candidate = serviceCandidates[index]!;
        const typeIndex = candidate.typeIndex;
        const hasTypeCapacity = typeIndex === NO_TYPE_INDEX || (state.remainingTypeCounts[typeIndex] ?? 0) > 0;
        if (
          state.remainingTotal > 0
          && hasTypeCapacity
          && (candidate.mask & (roadMask | state.occupiedMask)) === 0
          && isBuildingRoadCompatible(roads, candidate.placement)
        ) {
          if (typeIndex !== NO_TYPE_INDEX) state.remainingTypeCounts[typeIndex]!--;
          state.selected.push(candidate);
          searchServices(index + 1, {
            selected: state.selected,
            occupiedMask: state.occupiedMask | candidate.mask,
            remainingTypeCounts: state.remainingTypeCounts,
            remainingTotal: state.remainingTotal - 1,
          });
          state.selected.pop();
          if (typeIndex !== NO_TYPE_INDEX) state.remainingTypeCounts[typeIndex]!++;
        }
      };

      searchServices(0, {
        selected: [],
        occupiedMask: 0,
        remainingTypeCounts: [...remainingServiceTypeCounts],
        remainingTotal: remainingServices,
      });
    }
  } catch (error) {
    if (error instanceof SmallWindowDpStateLimitError) {
      return finishIneligible(startedAtMs, window, usableWindowCells, "state-limit", {
        serviceCandidateCount: serviceCandidates.length,
        residentialCandidateCount: residentialCandidates.length,
        roadMaskCount,
        serviceSubsetCount,
        residentialStateCount,
      });
    }
    throw error;
  }

  const bestRepair = best as BestDpRepair | null;
  return {
    solution: bestRepair ? bestRepair.solution : null,
    telemetry: makeTelemetry(startedAtMs, window, usableWindowCells, {
      eligible: true,
      reason: bestRepair ? null : "no-valid-layout",
      serviceCandidateCount: serviceCandidates.length,
      residentialCandidateCount: residentialCandidates.length,
      roadMaskCount,
      serviceSubsetCount,
      residentialStateCount,
      bestPopulation: bestRepair ? bestRepair.solution.totalPopulation : null,
    }),
  };
}
