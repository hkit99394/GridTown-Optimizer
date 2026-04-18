/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync } from "node:fs";

import { normalizeServicePlacement } from "./buildings.js";
import { solveCpSat } from "./cpSatSolver.js";
import { validateSolution } from "./evaluator.js";
import { height, width } from "./grid.js";
import { buildNeighborhoodWindows, computeResidentialBoostsForSolution, selectNeighborhoodWindow } from "./lnsNeighborhoods.js";
import { compatibleResidentialTypeIndices, getResidentialBaseMax, NO_TYPE_INDEX } from "./rules.js";
import { writeSolutionSnapshot } from "./solutionSerialization.js";
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
export { buildNeighborhoodWindows } from "./lnsNeighborhoods.js";

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

function materializeValidSeedSolution(G: Grid, params: SolverParams, seedHint?: CpSatWarmStartHint): Solution | null {
  const incumbent = materializeSeedSolution(seedHint);
  if (!incumbent) return null;

  const seedValidation = validateSolution({
    grid: G,
    solution: incumbent,
    params,
  });
  return seedValidation.valid ? incumbent : null;
}

function buildInitialLnsIncumbent(G: Grid, params: SolverParams): Solution {
  const seededIncumbent = materializeValidSeedSolution(G, params, params.lns?.seedHint);
  const initialIncumbent = seededIncumbent ?? {
    ...solveGreedy(G, { ...params, optimizer: "greedy" }),
    optimizer: "lns" as const,
  };
  return applyDeterministicDominanceUpgrades(G, params, initialIncumbent);
}

function materializeStoppedLnsSolution(incumbent: Solution): Solution {
  return {
    ...incumbent,
    optimizer: "lns",
    stoppedByUser: true,
  };
}

function materializeCompletedLnsSolution(incumbent: Solution): Solution {
  return {
    ...incumbent,
    optimizer: "lns",
  };
}

export function solveLns(G: Grid, params: SolverParams): Solution {
  const options = getLnsOptions(G, params);

  let incumbent = buildInitialLnsIncumbent(G, params);

  if (options.snapshotFilePath) writeSolutionSnapshot(options.snapshotFilePath, incumbent);

  let stagnantIterations = 0;
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    if (shouldStop(options.stopFilePath)) {
      return materializeStoppedLnsSolution(incumbent);
    }

    if (stagnantIterations >= options.maxNoImprovementIterations) break;

    const windows = buildNeighborhoodWindows(G, params, incumbent, options, stagnantIterations + 1);
    if (windows.length === 0) break;

    const neighborhoodWindow = selectNeighborhoodWindow(windows, iteration, stagnantIterations, options);
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
        return materializeStoppedLnsSolution(incumbent);
      }
      if (isRecoverableRepairFailure(error)) {
        stagnantIterations += 1;
        continue;
      }
      throw error;
    }
  }

  return materializeCompletedLnsSolution(incumbent);
}
