/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";

import { normalizeServicePlacement } from "./buildings.js";
import { solveCpSat } from "./cpSatSolver.js";
import { height, width } from "./grid.js";
import { NO_TYPE_INDEX } from "./rules.js";
import { solveGreedy } from "./solver.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  Grid,
  LnsOptions,
  Solution,
  SolverParams,
} from "./types.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

interface NeighborhoodAnchor {
  r: number;
  c: number;
  rows: number;
  cols: number;
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
    repairHint: true,
    fixVariablesToHintedValue: false,
    hintConflictLimit: 20,
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

function buildNeighborhoodWindows(
  G: Grid,
  incumbent: Solution,
  options: NormalizedLnsOptions
): CpSatNeighborhoodWindow[] {
  const windows = new Map<string, CpSatNeighborhoodWindow>();

  const weakResidentials = incumbent.residentials
    .map((residential, index) => ({
      ...residential,
      population: incumbent.populations[index] ?? 0,
    }))
    .sort((a, b) => a.population - b.population);

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

export function solveLns(G: Grid, params: SolverParams): Solution {
  const options = getLnsOptions(G, params);

  let incumbent = materializeSeedSolution(params.lns?.seedHint);
  if (!incumbent) {
    incumbent = {
      ...solveGreedy(G, { ...params, optimizer: "greedy" }),
      optimizer: "lns",
    };
  }

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

    const windows = buildNeighborhoodWindows(G, incumbent, options);
    if (windows.length === 0) break;

    const neighborhoodWindow = windows[iteration % windows.length];
    try {
      const candidate = solveCpSat(G, {
        ...params,
        optimizer: "cp-sat",
        cpSat: {
          ...(params.cpSat ?? {}),
          timeLimitSeconds: options.repairTimeLimitSeconds,
          stopFilePath: options.stopFilePath || undefined,
          warmStartHint: buildWarmStartHint(incumbent, neighborhoodWindow),
        },
      });

      if (candidate.totalPopulation > incumbent.totalPopulation) {
        incumbent = {
          ...candidate,
          optimizer: "lns",
        };
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
