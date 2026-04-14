/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";

import { normalizeServicePlacement, residentialFootprint, serviceEffectZone, serviceFootprint } from "./buildings.js";
import { solveCpSat } from "./cpSatSolver.js";
import { height, isAllowed, orthogonalNeighbors, width } from "./grid.js";
import { compatibleResidentialTypeIndices, getResidentialBaseMax, NO_TYPE_INDEX } from "./rules.js";
import { solveGreedy } from "./solver.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  Grid,
  LnsOptions,
  ServiceTypeSetting,
  Solution,
  SolverParams,
} from "./types.js";
import { cellFromKey, cellKey } from "./types.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

interface NeighborhoodAnchor {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

interface RankedNeighborhoodAnchor extends NeighborhoodAnchor {
  score: number;
}

type NormalizedLnsOptions = Omit<Required<LnsOptions>, "seedHint"> & {
  seedHint?: CpSatWarmStartHint;
};

function getLnsOptions(G: Grid, params: SolverParams): NormalizedLnsOptions {
  const H = height(G);
  const W = width(G);
  const lns = params.lns ?? {};
  const repairableRows = H > 1 ? H - 1 : H;
  return {
    iterations: Math.max(1, lns.iterations ?? 12),
    maxNoImprovementIterations: Math.max(1, lns.maxNoImprovementIterations ?? 4),
    neighborhoodRows: Math.max(1, Math.min(repairableRows || 1, lns.neighborhoodRows ?? Math.max(4, Math.ceil(H / 2)))),
    neighborhoodCols: Math.max(1, Math.min(W || 1, lns.neighborhoodCols ?? Math.max(4, Math.ceil(W / 2)))),
    repairTimeLimitSeconds: Math.max(1, lns.repairTimeLimitSeconds ?? params.cpSat?.timeLimitSeconds ?? 5),
    seedHint: lns.seedHint,
    stopFilePath: lns.stopFilePath ?? "",
    snapshotFilePath: lns.snapshotFilePath ?? "",
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

function serviceCandidateKey(solution: Solution, index: number): string {
  const service = normalizeServicePlacement(solution.services[index]);
  const typeIndex = solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX;
  return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
}

function residentialCandidateKey(solution: Solution, index: number): string {
  const residential = solution.residentials[index];
  const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
  return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
}

function buildWarmStartHint(solution: Solution, neighborhoodWindow: CpSatNeighborhoodWindow): CpSatWarmStartHint {
  const roadKeys = Array.from(solution.roads);
  return {
    sourceName: "lns-incumbent",
    roadKeys,
    serviceCandidateKeys: solution.services.map((_, index) => serviceCandidateKey(solution, index)),
    residentialCandidateKeys: solution.residentials.map((_, index) => residentialCandidateKey(solution, index)),
    solution: {
      roads: roadKeys,
      services: solution.services.map((service, index) => {
        const normalized = normalizeServicePlacement(service);
        return {
          r: normalized.r,
          c: normalized.c,
          rows: normalized.rows,
          cols: normalized.cols,
          range: normalized.range,
          typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
          bonus: solution.servicePopulationIncreases[index] ?? 0,
        };
      }),
      residentials: solution.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: solution.populations[index] ?? 0,
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation,
    },
    // Keep the incumbent as a regular warm start, but avoid OR-Tools' repair_hint
    // path here because it has been crashing inside MinimizeL1DistanceWithHint().
    neighborhoodWindow,
    fixOutsideNeighborhoodToHintedValue: true,
  };
}

function clampNeighborhoodWindow(
  G: Grid,
  anchor: NeighborhoodAnchor,
  neighborhoodRows: number,
  neighborhoodCols: number
): CpSatNeighborhoodWindow | null {
  const H = height(G);
  const W = width(G);
  if (H === 0 || W === 0) return null;

  const repairRowStart = H > 1 ? 1 : 0;
  const repairableRows = H - repairRowStart;
  if (repairableRows <= 0) return null;

  const rows = Math.max(1, Math.min(neighborhoodRows, repairableRows));
  const cols = Math.max(1, Math.min(neighborhoodCols, W));
  const anchorCenterRow = anchor.r + Math.floor(anchor.rows / 2);
  const anchorCenterCol = anchor.c + Math.floor(anchor.cols / 2);

  let top = anchorCenterRow - Math.floor(rows / 2);
  top = Math.max(repairRowStart, Math.min(top, H - rows));

  let left = anchorCenterCol - Math.floor(cols / 2);
  left = Math.max(0, Math.min(left, W - cols));

  return { top, left, rows, cols };
}

function addWindow(
  dedupe: Map<string, CpSatNeighborhoodWindow>,
  window: CpSatNeighborhoodWindow | null
): void {
  if (!window) return;
  dedupe.set(`${window.top}:${window.left}:${window.rows}:${window.cols}`, window);
}

function interleaveAnchors(anchorGroups: NeighborhoodAnchor[][]): NeighborhoodAnchor[] {
  const interleaved: NeighborhoodAnchor[] = [];
  const maxLength = anchorGroups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index++) {
    for (const group of anchorGroups) {
      if (index < group.length) interleaved.push(group[index]);
    }
  }
  return interleaved;
}

function buildOccupiedCellSet(solution: Solution): Set<string> {
  const occupied = new Set<string>();
  for (const service of solution.services) {
    for (const cell of serviceFootprint(service)) occupied.add(cell);
  }
  for (const residential of solution.residentials) {
    for (const cell of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) occupied.add(cell);
  }
  return occupied;
}

function buildWeakServiceAnchors(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (!incumbent.services.length || limit <= 0) return [];

  const boosts = computeResidentialBoostsForSolution(G, incumbent);
  const residentialFootprints = incumbent.residentials.map((residential) =>
    residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)
  );
  const serviceEffectZones = incumbent.services.map((service) => new Set(serviceEffectZone(G, service)));

  return incumbent.services
    .map((service, serviceIndex) => {
      const serviceBonus = incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
      const effectZone = serviceEffectZones[serviceIndex];
      let marginalGain = 0;
      let coveredResidentials = 0;

      for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
        if (!residentialFootprints[residentialIndex].some((cell) => effectZone.has(cell))) continue;
        coveredResidentials += 1;

        const residential = incumbent.residentials[residentialIndex];
        const typeIndex = incumbent.residentialTypeIndices[residentialIndex] ?? NO_TYPE_INDEX;
        const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
        const populationWithoutService = Math.min(Math.max(base + boosts[residentialIndex] - serviceBonus, base), max);
        const populationWithService = incumbent.populations[residentialIndex] ?? Math.min(Math.max(base + boosts[residentialIndex], base), max);
        marginalGain += populationWithService - populationWithoutService;
      }

      return {
        ...normalizeServicePlacement(service),
        score: marginalGain * 1000 + coveredResidentials,
        marginalGain,
        coveredResidentials,
        serviceBonus,
      };
    })
    .sort((a, b) =>
      a.score - b.score
      || a.marginalGain - b.marginalGain
      || a.coveredResidentials - b.coveredResidentials
      || a.serviceBonus - b.serviceBonus
      || a.r - b.r
      || a.c - b.c
    )
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildResidentialOpportunityAnchors(
  params: SolverParams,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (!incumbent.residentials.length || limit <= 0) return [];

  return incumbent.residentials
    .map((residential, index) => {
      const typeIndex = incumbent.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
      const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
      const population = incumbent.populations[index] ?? base;
      const headroom = Math.max(0, max - population);
      const totalBoostCapacity = Math.max(1, max - base);
      return {
        ...residential,
        score: headroom * 1000 + Math.round((headroom / totalBoostCapacity) * 100),
        headroom,
        population,
      };
    })
    .filter((entry) => entry.headroom > 0)
    .sort((a, b) =>
      b.score - a.score
      || b.headroom - a.headroom
      || a.population - b.population
      || a.r - b.r
      || a.c - b.c
    )
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildFrontierCongestionAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (limit <= 0) return [];

  const occupied = buildOccupiedCellSet(incumbent);
  const candidates = new Map<string, RankedNeighborhoodAnchor>();

  for (const roadKey of incumbent.roads) {
    const { r, c } = cellFromKey(roadKey);
    if (!isAllowed(G, r, c)) continue;
    const neighbors = orthogonalNeighbors(G, r, c);
    let occupiedNeighbors = 0;
    let frontierNeighbors = 0;
    for (const [nr, nc] of neighbors) {
      const neighborKey = cellKey(nr, nc);
      if (!isAllowed(G, nr, nc)) continue;
      if (occupied.has(neighborKey)) {
        occupiedNeighbors += 1;
      } else if (!incumbent.roads.has(neighborKey)) {
        frontierNeighbors += 1;
      }
    }
    const score = occupiedNeighbors * 4 + frontierNeighbors;
    if (score <= 0) continue;
    candidates.set(`road:${roadKey}`, { r, c, rows: 1, cols: 1, score });
  }

  const H = height(G);
  const W = width(G);
  for (let r = 1; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isAllowed(G, r, c)) continue;
      const key = cellKey(r, c);
      if (occupied.has(key) || incumbent.roads.has(key)) continue;
      const neighbors = orthogonalNeighbors(G, r, c);
      let roadNeighbors = 0;
      let occupiedNeighbors = 0;
      for (const [nr, nc] of neighbors) {
        const neighborKey = cellKey(nr, nc);
        if (incumbent.roads.has(neighborKey)) roadNeighbors += 1;
        if (occupied.has(neighborKey)) occupiedNeighbors += 1;
      }
      if (roadNeighbors === 0 || occupiedNeighbors === 0) continue;
      candidates.set(`frontier:${key}`, {
        r,
        c,
        rows: 1,
        cols: 1,
        score: occupiedNeighbors * 3 + roadNeighbors * 2,
      });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

export function buildNeighborhoodWindows(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: NormalizedLnsOptions
): CpSatNeighborhoodWindow[] {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  const focusedAnchorLimit = Math.max(3, options.maxNoImprovementIterations * 2);

  const weakResidentials = incumbent.residentials
    .map((residential, index) => ({
      ...residential,
      population: incumbent.populations[index] ?? 0,
    }))
    .sort((a, b) => a.population - b.population);

  const focusedAnchors = interleaveAnchors([
    buildWeakServiceAnchors(G, params, incumbent, focusedAnchorLimit),
    buildResidentialOpportunityAnchors(params, incumbent, focusedAnchorLimit),
    buildFrontierCongestionAnchors(G, incumbent, focusedAnchorLimit),
  ]);

  for (const anchor of focusedAnchors) {
    addWindow(windows, clampNeighborhoodWindow(G, anchor, options.neighborhoodRows, options.neighborhoodCols));
  }
  for (const service of incumbent.services) {
    addWindow(windows, clampNeighborhoodWindow(G, normalizeServicePlacement(service), options.neighborhoodRows, options.neighborhoodCols));
  }
  for (const residential of weakResidentials) {
    addWindow(windows, clampNeighborhoodWindow(G, residential, options.neighborhoodRows, options.neighborhoodCols));
  }

  const H = height(G);
  const W = width(G);
  const rows = Math.max(1, Math.min(options.neighborhoodRows, H > 1 ? H - 1 : H));
  const cols = Math.max(1, Math.min(options.neighborhoodCols, W));
  const rowStart = H > 1 ? 1 : 0;
  const rowStride = Math.max(1, Math.floor(rows / 2));
  const colStride = Math.max(1, Math.floor(cols / 2));

  for (let top = rowStart; top <= H - rows; top += rowStride) {
    for (let left = 0; left <= W - cols; left += colStride) {
      addWindow(windows, { top, left, rows, cols });
    }
    addWindow(windows, { top: Math.max(rowStart, H - rows), left: 0, rows, cols });
  }
  for (let left = 0; left <= W - cols; left += colStride) {
    addWindow(windows, { top: Math.max(rowStart, H - rows), left, rows, cols });
  }

  return [...windows.values()];
}

function shouldStop(stopFilePath: string): boolean {
  return Boolean(stopFilePath) && existsSync(stopFilePath);
}

function isRecoverableRepairFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /No feasible solution found with CP-SAT\./.test(error.message);
}

function toInteger(value: unknown, fallback = 0, min = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.round(number));
}

function materializeSeedSolution(seedHint?: CpSatWarmStartHint): Solution | null {
  if (!seedHint) return null;
  if (!seedHint.solution) {
    throw new Error("LNS seed hint is missing the saved solution payload.");
  }

  const seededSolution = seedHint.solution;
  const seededServices = Array.isArray(seededSolution.services) ? seededSolution.services : [];
  const seededResidentials = Array.isArray(seededSolution.residentials) ? seededSolution.residentials : [];
  const serviceTypeIndices = seededServices.map((service) => toInteger(service.typeIndex, NO_TYPE_INDEX, NO_TYPE_INDEX));
  const servicePopulationIncreases = seededServices.map((service) => toInteger(service.bonus, 0));
  const residentialTypeIndices = seededResidentials.map((residential) =>
    toInteger(residential.typeIndex, NO_TYPE_INDEX, NO_TYPE_INDEX)
  );
  const populations = Array.isArray(seededSolution.populations) && seededSolution.populations.length === seededResidentials.length
    ? seededSolution.populations.map((population) => toInteger(population, 0))
    : seededResidentials.map((residential) => toInteger(residential.population, 0));

  return {
    optimizer: "lns",
    roads: new Set(Array.isArray(seededSolution.roads) ? seededSolution.roads : (seedHint.roadKeys ?? [])),
    services: seededServices.map((service) => ({
      r: toInteger(service.r, 0),
      c: toInteger(service.c, 0),
      rows: toInteger(service.rows, 0),
      cols: toInteger(service.cols, 0),
      range: toInteger(service.range, 0),
    })),
    serviceTypeIndices,
    servicePopulationIncreases,
    residentials: seededResidentials.map((residential) => ({
      r: toInteger(residential.r, 0),
      c: toInteger(residential.c, 0),
      rows: toInteger(residential.rows, 0),
      cols: toInteger(residential.cols, 0),
    })),
    residentialTypeIndices,
    populations,
    totalPopulation: toInteger(
      seededSolution.totalPopulation,
      populations.reduce((sum, population) => sum + population, 0)
    ),
  };
}

function serviceTypeSupportsPlacement(
  type: ServiceTypeSetting,
  placement: ReturnType<typeof normalizeServicePlacement>
): boolean {
  if (!type) return false;
  return (
    (placement.rows === type.rows && placement.cols === type.cols)
    || ((type.allowRotation ?? true) && placement.rows === type.cols && placement.cols === type.rows)
  );
}

function countServiceTypeUsage(solution: Solution, typeCount: number): number[] {
  const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
  for (const typeIndex of solution.serviceTypeIndices) {
    if (typeIndex >= 0 && typeIndex < counts.length) {
      counts[typeIndex] += 1;
    }
  }
  return counts;
}

function countResidentialTypeUsage(solution: Solution, typeCount: number): number[] {
  const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
  for (const typeIndex of solution.residentialTypeIndices) {
    if (typeIndex >= 0 && typeIndex < counts.length) {
      counts[typeIndex] += 1;
    }
  }
  return counts;
}

function computeResidentialBoostsForSolution(G: Grid, solution: Solution): number[] {
  const effectZones = solution.services.map((service) => new Set(serviceEffectZone(G, service)));
  return solution.residentials.map((residential) => {
    const footprint = residentialFootprint(residential.r, residential.c, residential.rows, residential.cols);
    let boost = 0;
    for (let serviceIndex = 0; serviceIndex < effectZones.length; serviceIndex++) {
      if (footprint.some((cell) => effectZones[serviceIndex].has(cell))) {
        boost += solution.servicePopulationIncreases[serviceIndex] ?? 0;
      }
    }
    return boost;
  });
}

function recomputeSolutionPopulationTotals(G: Grid, params: SolverParams, solution: Solution): Solution {
  const boosts = computeResidentialBoostsForSolution(G, solution);
  const populations = solution.residentials.map((residential, index) => {
    const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
    const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    return Math.min(Math.max(base + boosts[index], base), max);
  });
  return {
    ...solution,
    populations,
    totalPopulation: populations.reduce((sum, population) => sum + population, 0),
  };
}

function applyDeterministicServiceUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  const serviceTypes = params.serviceTypes ?? [];
  if (!serviceTypes.length || solution.services.length === 0) return solution;

  let incumbent = solution;
  let improved = true;

  while (improved) {
    improved = false;
    const usage = countServiceTypeUsage(incumbent, serviceTypes.length);
    let bestCandidate: Solution | null = null;
    let bestPopulation = incumbent.totalPopulation;

    for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
      const placement = normalizeServicePlacement(incumbent.services[serviceIndex]);
      const currentTypeIndex = incumbent.serviceTypeIndices[serviceIndex] ?? NO_TYPE_INDEX;
      const currentBonus = incumbent.servicePopulationIncreases[serviceIndex] ?? 0;

      for (let candidateTypeIndex = 0; candidateTypeIndex < serviceTypes.length; candidateTypeIndex++) {
        if (candidateTypeIndex === currentTypeIndex) continue;
        const serviceType = serviceTypes[candidateTypeIndex];
        if (serviceType.avail <= 0) continue;
        if (!serviceTypeSupportsPlacement(serviceType, placement)) continue;
        if ((usage[candidateTypeIndex] ?? 0) >= serviceType.avail) continue;

        // Skip obviously weaker replacements at the same footprint.
        if (serviceType.bonus <= currentBonus && serviceType.range <= placement.range) continue;

        const nextServices = incumbent.services.map((service, index) =>
          index === serviceIndex ? { ...placement, range: serviceType.range } : { ...service }
        );
        const nextServiceTypeIndices = [...incumbent.serviceTypeIndices];
        nextServiceTypeIndices[serviceIndex] = candidateTypeIndex;
        const nextServiceBonuses = [...incumbent.servicePopulationIncreases];
        nextServiceBonuses[serviceIndex] = serviceType.bonus;
        const candidateSolution = recomputeSolutionPopulationTotals(G, params, {
          ...incumbent,
          services: nextServices,
          serviceTypeIndices: nextServiceTypeIndices,
          servicePopulationIncreases: nextServiceBonuses,
        });
        if (candidateSolution.totalPopulation <= bestPopulation) continue;

        bestPopulation = candidateSolution.totalPopulation;
        bestCandidate = candidateSolution;
      }
    }

    if (bestCandidate) {
      incumbent = bestCandidate;
      improved = true;
    }
  }

  return incumbent;
}

function applyDeterministicResidentialUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  const residentialTypes = params.residentialTypes ?? [];
  if (!residentialTypes.length || solution.residentials.length === 0) return solution;

  let incumbent = solution;
  let improved = true;

  while (improved) {
    improved = false;
    const usage = countResidentialTypeUsage(incumbent, residentialTypes.length);
    let bestCandidate: Solution | null = null;
    let bestPopulation = incumbent.totalPopulation;

    for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
      const placement = incumbent.residentials[residentialIndex];
      const currentTypeIndex = incumbent.residentialTypeIndices[residentialIndex] ?? NO_TYPE_INDEX;
      if (currentTypeIndex < 0 || currentTypeIndex >= residentialTypes.length) continue;
      const currentType = residentialTypes[currentTypeIndex];
      const compatibleTypeIndices = compatibleResidentialTypeIndices(params, placement.rows, placement.cols);

      for (const candidateTypeIndex of compatibleTypeIndices) {
        if (candidateTypeIndex === currentTypeIndex) continue;
        const candidateType = residentialTypes[candidateTypeIndex];
        if ((usage[candidateTypeIndex] ?? 0) >= candidateType.avail) continue;

        // Skip obviously weaker replacements for the same footprint.
        if (candidateType.min <= currentType.min && candidateType.max <= currentType.max) continue;

        const nextResidentialTypeIndices = [...incumbent.residentialTypeIndices];
        nextResidentialTypeIndices[residentialIndex] = candidateTypeIndex;
        const candidateSolution = recomputeSolutionPopulationTotals(G, params, {
          ...incumbent,
          residentialTypeIndices: nextResidentialTypeIndices,
        });

        if (candidateSolution.totalPopulation <= bestPopulation) continue;
        bestPopulation = candidateSolution.totalPopulation;
        bestCandidate = candidateSolution;
      }
    }

    if (bestCandidate) {
      incumbent = bestCandidate;
      improved = true;
    }
  }

  return incumbent;
}

function applyDeterministicDominanceUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  let incumbent = recomputeSolutionPopulationTotals(G, params, solution);

  while (true) {
    const afterServiceUpgrades = applyDeterministicServiceUpgrades(G, params, incumbent);
    const afterResidentialUpgrades = applyDeterministicResidentialUpgrades(G, params, afterServiceUpgrades);
    if (afterResidentialUpgrades.totalPopulation <= incumbent.totalPopulation) {
      return incumbent;
    }
    incumbent = afterResidentialUpgrades;
  }
}

export function solveLns(G: Grid, params: SolverParams): Solution {
  const options = getLnsOptions(G, params);

  let incumbent = materializeSeedSolution(params.lns?.seedHint);
  if (!incumbent) {
    incumbent = {
      ...solveGreedy(G, { ...params, optimizer: "greedy" }),
      optimizer: "lns",
    };
  }
  incumbent = applyDeterministicDominanceUpgrades(G, params, incumbent);

  if (options.snapshotFilePath) writeSolutionSnapshot(options.snapshotFilePath, incumbent);

  let stagnantIterations = 0;
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    if (shouldStop(options.stopFilePath)) {
      return {
        ...incumbent,
        optimizer: "lns",
        stoppedByUser: true,
      };
    }

    if (stagnantIterations >= options.maxNoImprovementIterations) break;

    const windows = buildNeighborhoodWindows(G, params, incumbent, options);
    if (windows.length === 0) break;

    const neighborhoodWindow = windows[iteration % windows.length];
    try {
      const candidate = solveCpSat(G, {
        ...params,
        optimizer: "cp-sat",
        cpSat: {
          ...(params.cpSat ?? {}),
          // LNS repair is safer with a single worker; multi-worker repair_hint-style
          // search has been crashing in the local OR-Tools runtime.
          numWorkers: 1,
          timeLimitSeconds: options.repairTimeLimitSeconds,
          stopFilePath: options.stopFilePath || undefined,
          warmStartHint: buildWarmStartHint(incumbent, neighborhoodWindow),
        },
      });

      if (candidate.totalPopulation > incumbent.totalPopulation) {
        incumbent = applyDeterministicDominanceUpgrades(G, params, {
          ...candidate,
          optimizer: "lns",
        });
        stagnantIterations = 0;
        if (options.snapshotFilePath) writeSolutionSnapshot(options.snapshotFilePath, incumbent);
        continue;
      }
      stagnantIterations += 1;
    } catch (error) {
      if (shouldStop(options.stopFilePath)) {
        return {
          ...incumbent,
          optimizer: "lns",
          stoppedByUser: true,
        };
      }
      if (isRecoverableRepairFailure(error)) {
        stagnantIterations += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    ...incumbent,
    optimizer: "lns",
  };
}
