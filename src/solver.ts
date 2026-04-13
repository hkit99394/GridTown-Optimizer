/**
 * Greedy solver + optional local search (see ALGORITHM.md)
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";

import type { Grid } from "./types.js";
import type {
  GreedyOptions,
  ServicePlacement,
  ServiceCandidate,
  ResidentialPlacement,
  ResidentialCandidate,
  SolverParams,
  Solution,
} from "./types.js";
import {
  roadSeedRow0,
  ensureBuildingConnectedToRoads,
  canConnectToRoads,
  roadsConnectedToRow0,
  isAdjacentToRoads,
} from "./roads.js";
import {
  enumerateServiceCandidates,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  serviceEffectZone,
  serviceFootprint,
  residentialFootprint,
  overlaps,
  isBoostedByService,
  normalizeServicePlacement,
} from "./buildings.js";
import { getBuildingLimits, getResidentialBaseMax, NO_TYPE_INDEX } from "./rules.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };
type ResidentialCandidateStat = {
  r: number;
  c: number;
  rows: number;
  cols: number;
  base: number;
  max: number;
};

class GreedyStopError extends Error {
  constructor(readonly bestSolution: Solution | null) {
    super(bestSolution ? "Greedy solve was stopped." : "Greedy solve was stopped before finding a feasible solution.");
  }
}

type RandomSource = () => number;
type NormalizedGreedyOptions = Omit<Required<GreedyOptions>, "randomSeed"> & {
  randomSeed?: number;
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

function deriveSeed(baseSeed: number, capIndex: number, restartIndex: number): number {
  let mixed = (baseSeed ^ Math.imul(capIndex + 1, 0x9e3779b1)) >>> 0;
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

function isTypedResidentialCandidate(
  candidate: ResidentialPlacement | ResidentialCandidate
): candidate is ResidentialCandidate {
  return "typeIndex" in candidate;
}

function getCandidateTypeIndex(candidate: ResidentialPlacement | ResidentialCandidate): number {
  return isTypedResidentialCandidate(candidate) ? candidate.typeIndex : NO_TYPE_INDEX;
}

type ResidentialCandidatesList = (ResidentialPlacement | ResidentialCandidate)[];

function getGreedyOptions(params: SolverParams): NormalizedGreedyOptions {
  const greedy = params.greedy ?? {};
  const randomSeed = typeof greedy.randomSeed === "number" && Number.isInteger(greedy.randomSeed)
    ? greedy.randomSeed
    : undefined;
  return {
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    ...(randomSeed !== undefined ? { randomSeed } : {}),
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

function serializeSolution(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

function writeSolutionSnapshot(snapshotFilePath: string, solution: Solution): void {
  const tempPath = `${snapshotFilePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(serializeSolution(solution)));
  renameSync(tempPath, snapshotFilePath);
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

function buildServiceCoverageIndex(
  serviceCandidates: ServiceCandidate[],
  residentialCandidateStats: ResidentialCandidateStat[]
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
    const coveredIndices: number[] = [];
    for (let index = 0; index < residentialCandidateStats.length; index++) {
      const residential = residentialCandidateStats[index];
      if (rectanglesOverlap(footprint, residential)) continue;
      if (!rectanglesOverlap(effectBounds, residential)) continue;
      coveredIndices.push(index);
    }
    coverageByKey.set(key, coveredIndices);
  }
  return coverageByKey;
}

function computeServiceStaticScore(
  service: ServiceCandidate,
  residentialCandidateStats: ResidentialCandidateStat[],
  serviceCoverageByKey: Map<string, number[]>
): number {
  const coveredIndices = serviceCoverageByKey.get(serviceCandidateKey(service)) ?? [];
  let score = 0;
  for (const index of coveredIndices) {
    const residential = residentialCandidateStats[index];
    score += marginalPopulationGain(residential.base, residential.max, 0, service.bonus);
  }
  return score;
}

function computeServiceMarginalScore(
  service: ServiceCandidate,
  occupied: Set<string>,
  currentResidentialBoosts: number[],
  residentialCandidateStats: ResidentialCandidateStat[],
  serviceCoverageByKey: Map<string, number[]>
): number {
  const coveredIndices = serviceCoverageByKey.get(serviceCandidateKey(service)) ?? [];
  let score = 0;
  for (const index of coveredIndices) {
    const residential = residentialCandidateStats[index];
    if (overlaps(occupied, residential.r, residential.c, residential.rows, residential.cols)) continue;
    score += marginalPopulationGain(
      residential.base,
      residential.max,
      currentResidentialBoosts[index] ?? 0,
      service.bonus
    );
  }
  return score;
}

function solveOne(
  G: Grid,
  params: SolverParams,
  serviceOrder: ServiceCandidate[],
  residentialCandidateStats: ResidentialCandidateStat[],
  serviceCoverageByKey: Map<string, number[]>,
  anyResidentialCandidates: ResidentialCandidatesList,
  residentialCandidatesForLocal: ResidentialCandidatesList,
  maxServices: number | undefined,
  maxResidentials: number | undefined,
  useServiceTypes: boolean,
  useTypes: boolean,
  localSearch: boolean,
  fixedServices?: ServiceCandidate[],
  maybeStop?: () => void
): Solution | null {
  const roads = roadSeedRow0(G);
  if (roads.size === 0) return null;
  const occupied = new Set<string>();
  for (const k of roads) occupied.add(k);
  const remainingServiceAvail = useServiceTypes ? params.serviceTypes!.map((t) => t.avail) : null;
  const remainingAvail = useTypes ? params.residentialTypes!.map((t) => t.avail) : null;

  const services: ServicePlacement[] = [];
  const serviceTypeIndices: number[] = [];
  const serviceBonuses: number[] = [];
  const effectZones: Set<string>[] = [];
  const currentResidentialBoosts = Array.from({ length: residentialCandidateStats.length }, () => 0);
  const serviceSource = fixedServices ?? serviceOrder;
  if (fixedServices) {
    for (const s of serviceSource) {
      maybeStop?.();
      if (maxServices !== undefined && services.length >= maxServices) break;
      const placement = materializeServicePlacement(s);
      if (useServiceTypes && remainingServiceAvail) {
        if (remainingServiceAvail[s.typeIndex] <= 0) {
          return null;
        }
      }
      if (overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return null;
      }
      if (!ensureBuildingConnectedToRoads(G, roads, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return null;
      }
      for (const k of roads) occupied.add(k);
      for (const k of serviceFootprint(placement)) occupied.add(k);
      services.push(placement);
      serviceTypeIndices.push(s.typeIndex);
      serviceBonuses.push(s.bonus);
      effectZones.push(new Set(serviceEffectZone(G, placement)));
      const coveredIndices = serviceCoverageByKey.get(serviceCandidateKey(s)) ?? [];
      for (const index of coveredIndices) {
        currentResidentialBoosts[index] += s.bonus;
      }
      if (useServiceTypes && remainingServiceAvail) remainingServiceAvail[s.typeIndex]--;
    }
  } else {
    const serviceOrderIndex = new Map<string, number>();
    for (let index = 0; index < serviceSource.length; index++) {
      serviceOrderIndex.set(serviceCandidateKey(serviceSource[index]), index);
    }

    for (;;) {
      maybeStop?.();
      if (maxServices !== undefined && services.length >= maxServices) break;

      let bestCandidate: ServiceCandidate | null = null;
      let bestScore = 0;
      let bestOrderIndex = Infinity;
      for (const service of serviceSource) {
        maybeStop?.();
        const key = serviceCandidateKey(service);
        const placement = materializeServicePlacement(service);
        if (useServiceTypes && remainingServiceAvail && remainingServiceAvail[service.typeIndex] <= 0) continue;
        if (overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols)) continue;
        if (!canConnectToRoads(G, roads, occupied, placement.r, placement.c, placement.rows, placement.cols)) continue;
        const score = computeServiceMarginalScore(
          service,
          occupied,
          currentResidentialBoosts,
          residentialCandidateStats,
          serviceCoverageByKey
        );
        const orderIndex = serviceOrderIndex.get(key) ?? Infinity;
        if (score > bestScore || (score === bestScore && score > 0 && orderIndex < bestOrderIndex)) {
          bestCandidate = service;
          bestScore = score;
          bestOrderIndex = orderIndex;
        }
      }

      if (!bestCandidate || bestScore <= 0) break;

      const placement = materializeServicePlacement(bestCandidate);
      if (!ensureBuildingConnectedToRoads(G, roads, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        break;
      }
      for (const k of roads) occupied.add(k);
      for (const k of serviceFootprint(placement)) occupied.add(k);
      services.push(placement);
      serviceTypeIndices.push(bestCandidate.typeIndex);
      serviceBonuses.push(bestCandidate.bonus);
      effectZones.push(new Set(serviceEffectZone(G, placement)));
      const coveredIndices = serviceCoverageByKey.get(serviceCandidateKey(bestCandidate)) ?? [];
      for (const index of coveredIndices) {
        currentResidentialBoosts[index] += bestCandidate.bonus;
      }
      if (useServiceTypes && remainingServiceAvail) remainingServiceAvail[bestCandidate.typeIndex]--;
    }
  }
  if (fixedServices && services.length !== fixedServices.length) return null;

  function effectivePop(
    res: ResidentialPlacement,
    effectZoneSets: Set<string>[],
    bonuses: number[],
    typeIndex: number
  ): number {
    const { base, max } = getResidentialBaseMax(params, res.rows, res.cols, typeIndex);
    let sum = base;
    for (let i = 0; i < effectZoneSets.length; i++) {
      if (isBoostedByService(effectZoneSets[i], res.r, res.c, res.rows, res.cols)) sum += bonuses[i] ?? 0;
    }
    return Math.min(Math.max(sum, base), max);
  }

  const residentials: ResidentialPlacement[] = [];
  const residentialTypeIndices: number[] = [];
  for (;;) {
    if (maxResidentials !== undefined && residentials.length >= maxResidentials) break;
    let best: ResidentialCandidatesList[0] | null = null;
    let bestPop = -1;
    for (const cand of anyResidentialCandidates) {
      maybeStop?.();
      if (useTypes && remainingAvail) {
        const ti = getCandidateTypeIndex(cand);
        if (remainingAvail[ti] <= 0) continue;
      }
      if (overlaps(occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      if (!canConnectToRoads(G, roads, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      const pop = effectivePop(cand, effectZones, serviceBonuses, getCandidateTypeIndex(cand));
      if (pop > bestPop) {
        bestPop = pop;
        best = cand;
      }
    }
    if (best == null || bestPop < 0) break;
    ensureBuildingConnectedToRoads(G, roads, occupied, best.r, best.c, best.rows, best.cols);
    for (const k of roads) occupied.add(k);
    for (const k of residentialFootprint(best.r, best.c, best.rows, best.cols)) occupied.add(k);
    residentials.push({ r: best.r, c: best.c, rows: best.rows, cols: best.cols });
    const bestTypeIndex = getCandidateTypeIndex(best);
    residentialTypeIndices.push(bestTypeIndex);
    if (useTypes && remainingAvail && bestTypeIndex >= 0) remainingAvail[bestTypeIndex]--;
  }

  const populations = residentials.map((res, i) =>
    effectivePop(res, effectZones, serviceBonuses, residentialTypeIndices[i] ?? NO_TYPE_INDEX)
  );
  let totalPopulation = populations.reduce((a, b) => a + b, 0);

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
      params,
      useTypes ? remainingAvail : null,
      maxResidentials,
      maybeStop
    );
  }

  // Keep only roads connected to row 0, then re-ensure each placed building
  // is connected to that network (robust against any stray/disconnected roads).
  const roadsValid = roadsConnectedToRow0(G, roads);
  if (roadsValid.size === 0) {
    throw new Error("Invalid solution: road network does not touch row 0.");
  }
  const occupiedBuildings = new Set<string>();
  for (const s of services) {
    for (const k of serviceFootprint(s)) occupiedBuildings.add(k);
  }
  for (const r of residentials) {
    for (const k of residentialFootprint(r.r, r.c, r.rows, r.cols)) occupiedBuildings.add(k);
  }
  for (const s of services) {
    const normalized = normalizeServicePlacement(s);
    ensureBuildingConnectedToRoads(G, roadsValid, occupiedBuildings, normalized.r, normalized.c, normalized.rows, normalized.cols);
  }
  for (const r of residentials) {
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
    randomSeed,
    restarts,
    serviceRefineIterations,
    serviceRefineCandidateLimit,
    exhaustiveServiceSearch,
    serviceExactPoolLimit,
    serviceExactMaxCombinations,
    stopFilePath,
    snapshotFilePath,
  } = getGreedyOptions(params);
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

  const serviceCandidates = enumerateServiceCandidates(G, params);
  const residentialCandidateStats = anyResidentialCandidates.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
    ...getResidentialBaseMax(params, residential.rows, residential.cols, getCandidateTypeIndex(residential)),
  }));
  const serviceCoverageByKey = buildServiceCoverageIndex(serviceCandidates, residentialCandidateStats);
  const serviceScores = new Map<string, number>();
  for (const s of serviceCandidates) {
    maybeStop();
    serviceScores.set(serviceCandidateKey(s), computeServiceStaticScore(s, residentialCandidateStats, serviceCoverageByKey));
  }
  const serviceOrderSorted = [...serviceCandidates].sort(
    (a, b) => (serviceScores.get(serviceCandidateKey(b)) ?? 0) - (serviceScores.get(serviceCandidateKey(a)) ?? 0)
  );

  // If user does not cap services, sweep service count and keep best.
  // This avoids over-placing services (which can block residentials and reduce population).
  const explicitServiceCap = maxServices;
  const positiveBonuses = (params.serviceTypes ?? []).reduce(
    (sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0),
    0
  );
  const totalServiceAvail = (params.serviceTypes ?? []).reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  const inferredUpper = explicitServiceCap ?? (positiveBonuses > 0 ? Math.min(totalServiceAvail, positiveBonuses) : totalServiceAvail);
  const serviceCaps = explicitServiceCap !== undefined ? [explicitServiceCap] : Array.from({ length: inferredUpper + 1 }, (_, i) => i);

  try {
    for (let capIndex = 0; capIndex < serviceCaps.length; capIndex++) {
      const cap = serviceCaps[capIndex];
      maybeStop();
      let bestForCap = solveOne(
        G,
        params,
        serviceOrderSorted,
        residentialCandidateStats,
        serviceCoverageByKey,
        anyResidentialCandidates,
        residentialCandidatesForLocal,
        cap,
        maxResidentials,
        useServiceTypes,
        useTypes,
        localSearch,
        undefined,
        maybeStop
      );
      updateBest(bestForCap);
      for (let r = 1; r < restarts; r++) {
        maybeStop();
        const order = shuffle(
          serviceOrderSorted,
          randomSeed === undefined ? Math.random : createSeededRandom(deriveSeed(randomSeed, capIndex, r))
        );
        const sol = solveOne(
          G,
          params,
          order,
          residentialCandidateStats,
          serviceCoverageByKey,
          anyResidentialCandidates,
          residentialCandidatesForLocal,
          cap,
          maxResidentials,
          useServiceTypes,
          useTypes,
          localSearch,
          undefined,
          maybeStop
        );
        if (sol && (!bestForCap || sol.totalPopulation > bestForCap.totalPopulation)) {
          bestForCap = sol;
          updateBest(bestForCap);
        }
      }
      updateBest(bestForCap);
    }
    if (!best) throw new Error("No feasible solution found.");

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
          const trial = solveOne(
            G,
            params,
            serviceOrderSorted,
            residentialCandidateStats,
            serviceCoverageByKey,
            anyResidentialCandidates,
            residentialCandidatesForLocal,
            best.services.length,
            maxResidentials,
            useServiceTypes,
            useTypes,
            localSearch,
            forced,
            maybeStop
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
        const forced = idxs.map((i) => pool[i]);
        const trial = solveOne(
          G,
          params,
          serviceOrderSorted,
          residentialCandidateStats,
          serviceCoverageByKey,
          anyResidentialCandidates,
          residentialCandidatesForLocal,
          best.services.length,
          maxResidentials,
          useServiceTypes,
          useTypes,
          localSearch,
          forced,
          maybeStop
        );
        if (trial && trial.totalPopulation > best.totalPopulation) {
          best = trial;
          updateBest(best);
        }
      }
    }
  } catch (error) {
    if (error instanceof GreedyStopError) {
      if (error.bestSolution) return error.bestSolution;
      throw error;
    }
    throw error;
  }

  return best;
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
  params: SolverParams,
  remainingAvail: number[] | null,
  maxResidentials: number | undefined,
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

  function popFor(cand: ResidentialPlacement | ResidentialCandidate): number {
    const { base, max } = getResidentialBaseMax(params, cand.rows, cand.cols, getCandidateTypeIndex(cand));
    let sum = base;
    for (let j = 0; j < effectZones.length; j++) {
      if (isBoostedByService(effectZones[j], cand.r, cand.c, cand.rows, cand.cols)) sum += serviceBonuses[j] ?? 0;
    }
    return Math.min(Math.max(sum, base), max);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    maybeStop?.();
    let bestMove: MoveChoice | null = null;
    let bestMoveDelta = 0;
    let bestAdd: AddChoice | null = null;
    let bestAddDelta = 0;

    for (let i = 0; i < residentials.length; i++) {
      maybeStop?.();
      const res = residentials[i];
      const currentPop = populations[i];
      const resType = residentialTypeIndices[i] ?? NO_TYPE_INDEX;
      const othersOccupied = new Set(occupied);
      for (const k of residentialFootprint(res.r, res.c, res.rows, res.cols)) othersOccupied.delete(k);
      for (const cand of residentialCandidates) {
        maybeStop?.();
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
        if (overlaps(othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (!canConnectToRoads(G, roads, othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        const newPop = popFor(cand);
        const delta = newPop - currentPop;
        if (delta > bestMoveDelta) {
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
        }
      }
    }

    if (maxResidentials === undefined || residentials.length < maxResidentials) {
      for (const cand of residentialCandidates) {
        maybeStop?.();
        const candidateTypeIndex = getCandidateTypeIndex(cand);
        if (useTypes && remainingAvail) {
          if (remainingAvail[candidateTypeIndex] <= 0) continue;
        }
        if (overlaps(occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (!canConnectToRoads(G, roads, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        const addPop = popFor(cand);
        if (addPop > bestAddDelta) {
          bestAdd = {
            kind: "add",
            candidate: cand,
            candidateTypeIndex,
            addPop,
          };
          bestAddDelta = addPop;
        }
      }
    }

    if (bestMoveDelta <= 0 && bestAddDelta <= 0) break;

    if (bestAddDelta > bestMoveDelta && bestAdd) {
      const { candidate, candidateTypeIndex, addPop } = bestAdd;
      totalPopulation += addPop;
      ensureBuildingConnectedToRoads(G, roads, occupied, candidate.r, candidate.c, candidate.rows, candidate.cols);
      for (const k of roads) occupied.add(k);
      for (const k of residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols)) occupied.add(k);
      residentials.push({ r: candidate.r, c: candidate.c, rows: candidate.rows, cols: candidate.cols });
      residentialTypeIndices.push(candidateTypeIndex);
      populations.push(addPop);
      if (useTypes && remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
      continue;
    }

    if (bestMove) {
      const currentResidential = residentials[bestMove.residentialIndex];
      for (const k of residentialFootprint(
        currentResidential.r,
        currentResidential.c,
        currentResidential.rows,
        currentResidential.cols
      )) occupied.delete(k);
      if (useTypes && remainingAvail && bestMove.currentTypeIndex >= 0) remainingAvail[bestMove.currentTypeIndex]++;
      ensureBuildingConnectedToRoads(
        G,
        roads,
        occupied,
        bestMove.candidate.r,
        bestMove.candidate.c,
        bestMove.candidate.rows,
        bestMove.candidate.cols
      );
      for (const k of roads) occupied.add(k);
      for (const k of residentialFootprint(
        bestMove.candidate.r,
        bestMove.candidate.c,
        bestMove.candidate.rows,
        bestMove.candidate.cols
      )) occupied.add(k);
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
      continue;
    }
  }
  return totalPopulation;
}
