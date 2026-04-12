/**
 * Greedy solver + optional local search (see ALGORITHM.md)
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";

import type { Grid } from "./types.js";
import type {
  GreedyOptions,
  OptimizerName,
  ServicePlacement,
  ServiceCandidate,
  ResidentialPlacement,
  ResidentialCandidate,
  SolverParams,
  Solution,
} from "./types.js";
import { solveCpSat } from "./cpSatSolver.js";
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

class GreedyStopError extends Error {
  constructor(readonly bestSolution: Solution | null) {
    super(bestSolution ? "Greedy solve was stopped." : "Greedy solve was stopped before finding a feasible solution.");
  }
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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

function getGreedyOptions(params: SolverParams): Required<GreedyOptions> {
  const greedy = params.greedy ?? {};
  return {
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
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

function solveOne(
  G: Grid,
  params: SolverParams,
  serviceOrder: ServiceCandidate[],
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
  const serviceSource = fixedServices ?? serviceOrder;
  for (const s of serviceSource) {
    maybeStop?.();
    if (maxServices !== undefined && services.length >= maxServices) break;
    const placement = materializeServicePlacement(s);
    if (useServiceTypes && remainingServiceAvail) {
      if (remainingServiceAvail[s.typeIndex] <= 0) {
        if (fixedServices) return null;
        continue;
      }
    }
    if (overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols)) {
      if (fixedServices) return null;
      continue;
    }
    if (!ensureBuildingConnectedToRoads(G, roads, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
      if (fixedServices) return null;
      continue;
    }
    for (const k of roads) occupied.add(k);
    for (const k of serviceFootprint(placement)) occupied.add(k);
    services.push(placement);
    serviceTypeIndices.push(s.typeIndex);
    serviceBonuses.push(s.bonus);
    effectZones.push(new Set(serviceEffectZone(G, placement)));
    if (useServiceTypes && remainingServiceAvail) remainingServiceAvail[s.typeIndex]--;
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
  const serviceScores = new Map<string, number>();
  for (const s of serviceCandidates) {
    maybeStop();
    const effectBounds = {
      r: s.r - s.range,
      c: s.c - s.range,
      rows: s.rows + 2 * s.range,
      cols: s.cols + 2 * s.range,
    };
    const footprint = { r: s.r, c: s.c, rows: s.rows, cols: s.cols };
    let score = 0;
    for (const res of residentialCandidateStats) {
      maybeStop();
      if (rectanglesOverlap(footprint, res)) continue;
      if (!rectanglesOverlap(effectBounds, res)) continue;
      score += Math.min(res.base + s.bonus, res.max);
    }
    serviceScores.set(serviceCandidateKey(s), score);
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
    for (const cap of serviceCaps) {
      maybeStop();
      let bestForCap = solveOne(
        G,
        params,
        serviceOrderSorted,
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
        const order = shuffle([...serviceOrderSorted]);
        const sol = solveOne(
          G,
          params,
          order,
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

export function solve(G: Grid, params: SolverParams): Solution {
  const optimizerName: OptimizerName = params.optimizer === "cp-sat" ? "cp-sat" : "greedy";
  const optimizerSolvers: Record<OptimizerName, (grid: Grid, solverParams: SolverParams) => Solution> = {
    greedy: solveGreedy,
    "cp-sat": solveCpSat,
  };

  return optimizerSolvers[optimizerName](G, params);
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
    let improved = false;

    for (let i = 0; i < residentials.length; i++) {
      maybeStop?.();
      const res = residentials[i];
      const currentPop = populations[i];
      const resType = residentialTypeIndices[i] ?? NO_TYPE_INDEX;
      const othersOccupied = new Set(occupied);
      for (const k of residentialFootprint(res.r, res.c, res.rows, res.cols)) othersOccupied.delete(k);
      for (const cand of residentialCandidates) {
        maybeStop?.();
        if (cand.r === res.r && cand.c === res.c && cand.rows === res.rows && cand.cols === res.cols) continue;
        const candidateTypeIndex = getCandidateTypeIndex(cand);
        if (useTypes && remainingAvail) {
          if (candidateTypeIndex !== resType && remainingAvail[candidateTypeIndex] <= 0) continue;
        }
        if (overlaps(othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        if (!canConnectToRoads(G, roads, othersOccupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
        const newPop = popFor(cand);
        if (newPop > currentPop) {
          for (const k of residentialFootprint(res.r, res.c, res.rows, res.cols)) occupied.delete(k);
          if (useTypes && remainingAvail && resType >= 0) remainingAvail[resType]++;
          ensureBuildingConnectedToRoads(G, roads, occupied, cand.r, cand.c, cand.rows, cand.cols);
          for (const k of roads) occupied.add(k);
          for (const k of residentialFootprint(cand.r, cand.c, cand.rows, cand.cols)) occupied.add(k);
          if (useTypes && remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
          residentials[i] = { r: cand.r, c: cand.c, rows: cand.rows, cols: cand.cols };
          residentialTypeIndices[i] = candidateTypeIndex;
          populations[i] = newPop;
          totalPopulation = totalPopulation - currentPop + newPop;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }

    if (improved) continue;

    if (maxResidentials !== undefined && residentials.length >= maxResidentials) break;
    for (const cand of residentialCandidates) {
      maybeStop?.();
      const candidateTypeIndex = getCandidateTypeIndex(cand);
      if (useTypes && remainingAvail) {
        if (remainingAvail[candidateTypeIndex] <= 0) continue;
      }
      if (overlaps(occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      if (!canConnectToRoads(G, roads, occupied, cand.r, cand.c, cand.rows, cand.cols)) continue;
      const addPop = popFor(cand);
      totalPopulation += addPop;
      ensureBuildingConnectedToRoads(G, roads, occupied, cand.r, cand.c, cand.rows, cand.cols);
      for (const k of roads) occupied.add(k);
      for (const k of residentialFootprint(cand.r, cand.c, cand.rows, cand.cols)) occupied.add(k);
      residentials.push({ r: cand.r, c: cand.c, rows: cand.rows, cols: cand.cols });
      residentialTypeIndices.push(candidateTypeIndex);
      populations.push(addPop);
      if (useTypes && remainingAvail && candidateTypeIndex >= 0) remainingAvail[candidateTypeIndex]--;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return totalPopulation;
}
