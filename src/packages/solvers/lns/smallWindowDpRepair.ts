/**
 * Bounded exact repair for tiny LNS windows.
 *
 * This is intentionally not a global solver. It enumerates road masks inside a
 * small mutable window, enumerates service choices, then uses memoized set
 * packing for residential placements under the fixed service choice.
 */

import {
  cellFromKey,
  cellKey,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  getBuildingLimits,
  getResidentialBaseMax,
  height,
  isAdjacentToRoads,
  isAllowed,
  normalizeServicePlacement,
  residentialFootprint,
  roadsConnectedToRoadAnchor,
  serviceEffectZone,
  serviceFootprint,
  validateSolution,
  width,
} from "../../core/index.js";

import type {
  CpSatNeighborhoodWindow,
  Grid,
  LnsSmallWindowDpStatus,
  ResidentialCandidate,
  ResidentialPlacement,
  ServiceCandidate,
  ServicePlacement,
  SmallWindowDpRepairTelemetry,
  Solution,
  SolverParams,
} from "../../core/index.js";

interface SmallWindowDpRepairOptions {
  maxMutableCells: number;
  maxCandidates: number;
  maxStates: number;
}

interface DpServicePlacement extends Required<ServicePlacement> {
  typeIndex: number;
  bonus: number;
}

interface DpResidentialPlacement extends ResidentialPlacement {
  typeIndex: number;
}

interface DpCandidate<T> {
  placement: T;
  footprintKeys: readonly string[];
  mask: bigint;
}

interface DpServiceSelection {
  indices: number[];
  occupiedMask: bigint;
}

interface ResidentialDpResult {
  population: number;
  indices: number[];
}

interface SearchScore {
  solution: Solution;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
}

const MAX_EXHAUSTIVE_ROAD_CELLS = 16;

export interface SmallWindowDpRepairResult {
  status: LnsSmallWindowDpStatus;
  solution: Solution | null;
  telemetry: SmallWindowDpRepairTelemetry;
}

class SmallWindowDpStateLimitError extends Error {
  constructor() {
    super("Small-window DP repair exceeded the configured state limit.");
  }
}

function compareCellKeys(a: string, b: string): number {
  const cellA = cellFromKey(a);
  const cellB = cellFromKey(b);
  return cellA.r - cellB.r || cellA.c - cellB.c;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isInsideWindow(key: string, window: CpSatNeighborhoodWindow): boolean {
  const { r, c } = cellFromKey(key);
  return r >= window.top
    && r < window.top + window.rows
    && c >= window.left
    && c < window.left + window.cols;
}

function rectangleIntersectsWindow(
  placement: { r: number; c: number; rows: number; cols: number },
  window: CpSatNeighborhoodWindow
): boolean {
  return placement.r < window.top + window.rows
    && placement.r + placement.rows > window.top
    && placement.c < window.left + window.cols
    && placement.c + placement.cols > window.left;
}

function footprintOverlaps(footprintKeys: readonly string[], blocked: Set<string>): boolean {
  return footprintKeys.some((key) => blocked.has(key));
}

function buildMask(footprintKeys: readonly string[], cellIndexByKey: Map<string, number>): bigint {
  let mask = 0n;
  for (const key of footprintKeys) {
    const index = cellIndexByKey.get(key);
    if (index === undefined) continue;
    mask |= 1n << BigInt(index);
  }
  return mask;
}

function materializeWindowRoadMask(roadCellKeys: readonly string[], roadMask: number): string[] {
  const roads: string[] = [];
  for (let index = 0; index < roadCellKeys.length; index++) {
    if ((roadMask & (1 << index)) !== 0) roads.push(roadCellKeys[index]);
  }
  return roads;
}

function buildRoadMaskOccupancy(
  roadCellKeys: readonly string[],
  roadMask: number,
  cellIndexByKey: Map<string, number>
): bigint {
  let occupiedMask = 0n;
  for (let index = 0; index < roadCellKeys.length; index++) {
    if ((roadMask & (1 << index)) === 0) continue;
    const cellIndex = cellIndexByKey.get(roadCellKeys[index]);
    if (cellIndex !== undefined) occupiedMask |= 1n << BigInt(cellIndex);
  }
  return occupiedMask;
}

function countByType(typeCount: number, indices: readonly number[]): number[] {
  const counts = new Array<number>(typeCount).fill(0);
  for (const typeIndex of indices) {
    if (typeIndex >= 0 && typeIndex < counts.length) counts[typeIndex]++;
  }
  return counts;
}

function subtractCounts(capacities: readonly number[], used: readonly number[]): number[] {
  return capacities.map((capacity, index) => Math.max(0, capacity - (used[index] ?? 0)));
}

function finiteRemainingSlots(limit: number | undefined, fixedCount: number, typedRemaining: readonly number[], candidateCount: number): number {
  if (limit !== undefined) return Math.max(0, limit - fixedCount);
  if (typedRemaining.length > 0) return typedRemaining.reduce((sum, count) => sum + count, 0);
  return candidateCount;
}

function computeResidentialPopulation(
  G: Grid,
  params: SolverParams,
  services: readonly DpServicePlacement[],
  residential: DpResidentialPlacement
): number {
  const footprint = residentialFootprint(residential.r, residential.c, residential.rows, residential.cols);
  let boost = 0;
  for (const service of services) {
    const zone = new Set(serviceEffectZone(G, service));
    if (footprint.some((key) => zone.has(key))) boost += service.bonus;
  }
  const { base, max } = getResidentialBaseMax(
    params,
    residential.rows,
    residential.cols,
    residential.typeIndex
  );
  return clamp(base + boost, base, max);
}

function compareResidentialDpResult(a: ResidentialDpResult, b: ResidentialDpResult): ResidentialDpResult {
  if (a.population !== b.population) return a.population > b.population ? a : b;
  if (a.indices.length !== b.indices.length) return a.indices.length < b.indices.length ? a : b;
  return a;
}

function compareSearchScore(a: SearchScore | null, b: SearchScore): SearchScore {
  if (a === null) return b;
  if (a.totalPopulation !== b.totalPopulation) return b.totalPopulation > a.totalPopulation ? b : a;
  const aPenalty = a.roadCount + a.serviceCount;
  const bPenalty = b.roadCount + b.serviceCount;
  if (aPenalty !== bPenalty) return bPenalty < aPenalty ? b : a;
  if (a.residentialCount !== b.residentialCount) return b.residentialCount < a.residentialCount ? b : a;
  return a;
}

function makeTelemetry(
  status: LnsSmallWindowDpStatus,
  startedAtMs: number,
  mutableCellCount: number,
  roadCellCount: number,
  serviceCandidateCount: number,
  residentialCandidateCount: number,
  roadMaskCount: number,
  stateCount: number
): SmallWindowDpRepairTelemetry {
  return {
    status,
    elapsedSeconds: (performance.now() - startedAtMs) / 1000,
    mutableCellCount,
    roadCellCount,
    serviceCandidateCount,
    residentialCandidateCount,
    candidateCount: serviceCandidateCount + residentialCandidateCount,
    roadMaskCount,
    stateCount,
  };
}

function toDpServicePlacement(candidate: ServiceCandidate): DpServicePlacement {
  return {
    r: candidate.r,
    c: candidate.c,
    rows: candidate.rows,
    cols: candidate.cols,
    range: candidate.range,
    typeIndex: candidate.typeIndex,
    bonus: candidate.bonus,
  };
}

function toDpResidentialPlacement(candidate: ResidentialCandidate | ResidentialPlacement): DpResidentialPlacement {
  return {
    r: candidate.r,
    c: candidate.c,
    rows: candidate.rows,
    cols: candidate.cols,
    typeIndex: "typeIndex" in candidate ? candidate.typeIndex : -1,
  };
}

function compareServiceCandidates(a: ServiceCandidate, b: ServiceCandidate): number {
  return a.typeIndex - b.typeIndex
    || b.bonus - a.bonus
    || a.r - b.r
    || a.c - b.c
    || a.rows * a.cols - b.rows * b.cols;
}

function compareResidentialCandidates(a: DpResidentialPlacement, b: DpResidentialPlacement): number {
  return a.typeIndex - b.typeIndex
    || a.r - b.r
    || a.c - b.c
    || a.rows * a.cols - b.rows * b.cols;
}

export function repairSmallWindowWithDp(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  window: CpSatNeighborhoodWindow,
  options: SmallWindowDpRepairOptions
): SmallWindowDpRepairResult {
  const startedAtMs = performance.now();
  let stateCount = 0;

  const finish = (
    status: LnsSmallWindowDpStatus,
    solution: Solution | null,
    mutableCellCount: number,
    roadCellCount: number,
    serviceCandidateCount: number,
    residentialCandidateCount: number,
    roadMaskCount: number
  ): SmallWindowDpRepairResult => ({
    status,
    solution,
    telemetry: makeTelemetry(
      status,
      startedAtMs,
      mutableCellCount,
      roadCellCount,
      serviceCandidateCount,
      residentialCandidateCount,
      roadMaskCount,
      stateCount
    ),
  });

  if (window.rows <= 0 || window.cols <= 0 || window.rows * window.cols > options.maxMutableCells) {
    return finish("ineligible-window-size", null, 0, 0, 0, 0, 0);
  }

  const fixedRoads = new Set([...incumbent.roads].filter((key) => !isInsideWindow(key, window)));
  const fixedServices: DpServicePlacement[] = [];
  const fixedResidentials: DpResidentialPlacement[] = [];
  const fixedBlocked = new Set<string>(fixedRoads);

  incumbent.services.forEach((service, index) => {
    const normalized = normalizeServicePlacement(service);
    if (rectangleIntersectsWindow(normalized, window)) return;
    const typedService: DpServicePlacement = {
      ...normalized,
      typeIndex: incumbent.serviceTypeIndices[index] ?? -1,
      bonus: incumbent.servicePopulationIncreases[index] ?? 0,
    };
    fixedServices.push(typedService);
    for (const key of serviceFootprint(typedService)) fixedBlocked.add(key);
  });

  incumbent.residentials.forEach((residential, index) => {
    if (rectangleIntersectsWindow(residential, window)) return;
    const typedResidential: DpResidentialPlacement = {
      ...residential,
      typeIndex: incumbent.residentialTypeIndices[index] ?? -1,
    };
    fixedResidentials.push(typedResidential);
    for (const key of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      fixedBlocked.add(key);
    }
  });

  const roadCellKeys: string[] = [];
  const mutableCellKeys = new Set<string>();
  const H = height(G);
  const W = width(G);
  for (let r = window.top; r < Math.min(H, window.top + window.rows); r++) {
    for (let c = window.left; c < Math.min(W, window.left + window.cols); c++) {
      if (!isAllowed(G, r, c)) continue;
      const key = cellKey(r, c);
      roadCellKeys.push(key);
      mutableCellKeys.add(key);
    }
  }
  roadCellKeys.sort(compareCellKeys);
  if (roadCellKeys.length > MAX_EXHAUSTIVE_ROAD_CELLS) {
    return finish("ineligible-window-size", null, roadCellKeys.length, roadCellKeys.length, 0, 0, 0);
  }

  const serviceTypeCount = params.serviceTypes?.length ?? 0;
  const residentialTypeCount = params.residentialTypes?.length ?? 0;
  const fixedServiceTypeCounts = countByType(serviceTypeCount, fixedServices.map((service) => service.typeIndex));
  const fixedResidentialTypeCounts = countByType(
    residentialTypeCount,
    fixedResidentials.map((residential) => residential.typeIndex)
  );
  const serviceTypeRemaining = subtractCounts(
    (params.serviceTypes ?? []).map((type) => type.avail),
    fixedServiceTypeCounts
  );
  const residentialTypeRemaining = subtractCounts(
    (params.residentialTypes ?? []).map((type) => type.avail),
    fixedResidentialTypeCounts
  );

  const rawServiceCandidates = enumerateServiceCandidates(G, params)
    .filter((candidate) => {
      if (!rectangleIntersectsWindow(candidate, window)) return false;
      if ((serviceTypeRemaining[candidate.typeIndex] ?? 0) <= 0) return false;
      const footprint = serviceFootprint(candidate);
      return !footprintOverlaps(footprint, fixedBlocked);
    })
    .sort(compareServiceCandidates);

  const rawResidentialCandidates = (
    residentialTypeCount > 0
      ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes ?? [])
      : enumerateResidentialCandidates(G)
  )
    .map(toDpResidentialPlacement)
    .filter((candidate) => {
      if (!rectangleIntersectsWindow(candidate, window)) return false;
      if (residentialTypeCount > 0 && (residentialTypeRemaining[candidate.typeIndex] ?? 0) <= 0) return false;
      const footprint = residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols);
      return !footprintOverlaps(footprint, fixedBlocked);
    })
    .sort(compareResidentialCandidates);

  for (const candidate of rawServiceCandidates) {
    for (const key of serviceFootprint(candidate)) mutableCellKeys.add(key);
  }
  for (const candidate of rawResidentialCandidates) {
    for (const key of residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols)) {
      mutableCellKeys.add(key);
    }
  }

  const mutableCells = [...mutableCellKeys].sort(compareCellKeys);
  if (mutableCells.length > options.maxMutableCells) {
    return finish(
      "ineligible-mutable-cells",
      null,
      mutableCells.length,
      roadCellKeys.length,
      rawServiceCandidates.length,
      rawResidentialCandidates.length,
      0
    );
  }
  if (rawServiceCandidates.length + rawResidentialCandidates.length > options.maxCandidates) {
    return finish(
      "ineligible-candidates",
      null,
      mutableCells.length,
      roadCellKeys.length,
      rawServiceCandidates.length,
      rawResidentialCandidates.length,
      0
    );
  }

  const cellIndexByKey = new Map(mutableCells.map((key, index) => [key, index]));
  const serviceCandidates: DpCandidate<DpServicePlacement>[] = rawServiceCandidates.map((candidate) => {
    const footprintKeys = serviceFootprint(candidate);
    return {
      placement: toDpServicePlacement(candidate),
      footprintKeys,
      mask: buildMask(footprintKeys, cellIndexByKey),
    };
  });
  const residentialCandidates: DpCandidate<DpResidentialPlacement>[] = rawResidentialCandidates.map((candidate) => {
    const footprintKeys = residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols);
    return {
      placement: candidate,
      footprintKeys,
      mask: buildMask(footprintKeys, cellIndexByKey),
    };
  });

  const { maxServices, maxResidentials } = getBuildingLimits(params);
  const remainingServiceSlots = finiteRemainingSlots(
    maxServices,
    fixedServices.length,
    serviceTypeRemaining,
    serviceCandidates.length
  );
  const remainingResidentialSlots = finiteRemainingSlots(
    maxResidentials,
    fixedResidentials.length,
    residentialTypeRemaining,
    residentialCandidates.length
  );
  const roadMaskCount = 1 << roadCellKeys.length;
  let best: SearchScore | null = null;

  try {
    for (let roadMask = 0; roadMask < roadMaskCount; roadMask++) {
      const selectedRoadKeys = materializeWindowRoadMask(roadCellKeys, roadMask);
      const roads = new Set([...fixedRoads, ...selectedRoadKeys]);
      if (roads.size === 0 || roadsConnectedToRoadAnchor(G, roads).size !== roads.size) continue;

      const roadOccupancyMask = buildRoadMaskOccupancy(roadCellKeys, roadMask, cellIndexByKey);
      const serviceSelections: DpServiceSelection[] = [];

      const enumerateServices = (
        index: number,
        occupiedMask: bigint,
        remainingTypes: number[],
        remainingSlots: number,
        selectedIndices: number[]
      ): void => {
        stateCount += 1;
        if (stateCount > options.maxStates) throw new SmallWindowDpStateLimitError();
        if (index >= serviceCandidates.length) {
          serviceSelections.push({ indices: [...selectedIndices], occupiedMask });
          return;
        }

        enumerateServices(index + 1, occupiedMask, remainingTypes, remainingSlots, selectedIndices);

        const candidate = serviceCandidates[index];
        const typeIndex = candidate.placement.typeIndex;
        if (remainingSlots <= 0 || (remainingTypes[typeIndex] ?? 0) <= 0) return;
        if ((occupiedMask & candidate.mask) !== 0n) return;
        if (!isAdjacentToRoads(roads, candidate.placement.r, candidate.placement.c, candidate.placement.rows, candidate.placement.cols)) {
          return;
        }

        const nextRemainingTypes = [...remainingTypes];
        nextRemainingTypes[typeIndex] -= 1;
        selectedIndices.push(index);
        enumerateServices(
          index + 1,
          occupiedMask | candidate.mask,
          nextRemainingTypes,
          remainingSlots - 1,
          selectedIndices
        );
        selectedIndices.pop();
      };

      enumerateServices(0, roadOccupancyMask, [...serviceTypeRemaining], remainingServiceSlots, []);

      for (const serviceSelection of serviceSelections) {
        const selectedServices = serviceSelection.indices.map((index) => serviceCandidates[index].placement);
        const allServices = [...fixedServices, ...selectedServices];
        const fixedResidentialPopulation = fixedResidentials.reduce(
          (sum, residential) => sum + computeResidentialPopulation(G, params, allServices, residential),
          0
        );
        const residentialMemo = new Map<string, ResidentialDpResult>();

        const solveResidentials = (
          index: number,
          occupiedMask: bigint,
          remainingTypes: number[],
          remainingSlots: number
        ): ResidentialDpResult => {
          stateCount += 1;
          if (stateCount > options.maxStates) throw new SmallWindowDpStateLimitError();
          if (index >= residentialCandidates.length || remainingSlots <= 0) {
            return { population: 0, indices: [] };
          }

          const key = `${index}|${occupiedMask.toString(16)}|${remainingSlots}|${remainingTypes.join(",")}`;
          const cached = residentialMemo.get(key);
          if (cached) return cached;

          let bestResidential = solveResidentials(index + 1, occupiedMask, remainingTypes, remainingSlots);
          const candidate = residentialCandidates[index];
          const typeIndex = candidate.placement.typeIndex;
          const hasTypeCapacity = residentialTypeCount === 0 || (remainingTypes[typeIndex] ?? 0) > 0;

          if (hasTypeCapacity
            && (occupiedMask & candidate.mask) === 0n
            && isAdjacentToRoads(roads, candidate.placement.r, candidate.placement.c, candidate.placement.rows, candidate.placement.cols)
          ) {
            const nextRemainingTypes = [...remainingTypes];
            if (residentialTypeCount > 0) nextRemainingTypes[typeIndex] -= 1;
            const child = solveResidentials(
              index + 1,
              occupiedMask | candidate.mask,
              nextRemainingTypes,
              remainingSlots - 1
            );
            const population = computeResidentialPopulation(G, params, allServices, candidate.placement);
            const taken = {
              population: population + child.population,
              indices: [index, ...child.indices],
            };
            bestResidential = compareResidentialDpResult(bestResidential, taken);
          }

          residentialMemo.set(key, bestResidential);
          return bestResidential;
        };

        const residentialSelection = solveResidentials(
          0,
          serviceSelection.occupiedMask,
          [...residentialTypeRemaining],
          remainingResidentialSlots
        );
        const selectedResidentials = residentialSelection.indices.map((index) => residentialCandidates[index].placement);
        const allResidentials = [...fixedResidentials, ...selectedResidentials];
        const populations = allResidentials.map((residential) =>
          computeResidentialPopulation(G, params, allServices, residential)
        );
        const solution: Solution = {
          ...incumbent,
          optimizer: "lns",
          roads,
          services: allServices.map(({ typeIndex, bonus, ...service }) => service),
          serviceTypeIndices: allServices.map((service) => service.typeIndex),
          servicePopulationIncreases: allServices.map((service) => service.bonus),
          residentials: allResidentials.map(({ typeIndex, ...residential }) => residential),
          residentialTypeIndices: allResidentials.map((residential) => residential.typeIndex),
          populations,
          totalPopulation: fixedResidentialPopulation + residentialSelection.population,
        };
        const validation = validateSolution({ grid: G, solution, params });
        if (!validation.valid) continue;

        best = compareSearchScore(best, {
          solution,
          totalPopulation: solution.totalPopulation,
          roadCount: solution.roads.size,
          serviceCount: solution.services.length,
          residentialCount: solution.residentials.length,
        });
      }
    }
  } catch (error) {
    if (error instanceof SmallWindowDpStateLimitError) {
      return finish(
        "ineligible-state-limit",
        null,
        mutableCells.length,
        roadCellKeys.length,
        serviceCandidates.length,
        residentialCandidates.length,
        roadMaskCount
      );
    }
    throw error;
  }

  return finish(
    best ? "optimal" : "no-feasible-solution",
    best?.solution ?? null,
    mutableCells.length,
    roadCellKeys.length,
    serviceCandidates.length,
    residentialCandidates.length,
    roadMaskCount
  );
}
