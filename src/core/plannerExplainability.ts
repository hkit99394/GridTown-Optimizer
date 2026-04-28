import {
  residentialFootprint,
  serviceEffectZone,
  serviceFootprint,
} from "./buildings.js";
import {
  height,
  isAllowed,
  width,
} from "./grid.js";
import {
  computeRoadAnchorReachableEmptyFrontier,
  measureBuildingConnectivityShadowFromFrontier,
} from "./roads.js";
import { getResidentialBaseMax } from "./rules.js";
import { cellKey } from "./types.js";

import type {
  Grid,
  PlannerExplainabilityCell,
  PlannerExplainabilityMap,
  ServiceTypeSetting,
  Solution,
  SolverParams,
} from "./types.js";

type OccupiedKind = PlannerExplainabilityCell["occupiedKind"];
type Orientation = { rows: number; cols: number };

interface RemainingServiceType {
  type: ServiceTypeSetting;
  orientations: Orientation[];
}

interface RemainingResidentialType {
  typeIndex: number;
  orientations: Orientation[];
}

function incrementCount(counts: Map<number, number>, typeIndex: number): void {
  if (!Number.isInteger(typeIndex) || typeIndex < 0) return;
  counts.set(typeIndex, (counts.get(typeIndex) ?? 0) + 1);
}

function buildRemainingCounts<T extends { avail?: number }>(
  types: readonly T[] | undefined,
  usedTypeIndices: readonly number[] | undefined
): number[] {
  if (!types?.length) return [];
  const used = new Map<number, number>();
  for (const typeIndex of usedTypeIndices ?? []) {
    incrementCount(used, typeIndex);
  }
  return types.map((type, index) =>
    Math.max(0, Math.floor(Number(type.avail ?? 0)) - (used.get(index) ?? 0))
  );
}

function serviceOrientations(type: ServiceTypeSetting): Orientation[] {
  const orientations = [{ rows: type.rows, cols: type.cols }];
  if ((type.allowRotation ?? true) && type.rows !== type.cols) {
    orientations.push({ rows: type.cols, cols: type.rows });
  }
  return orientations;
}

function residentialOrientations(type: { w: number; h: number }): Orientation[] {
  const orientations = [{ rows: type.h, cols: type.w }];
  if (type.h !== type.w) {
    orientations.push({ rows: type.w, cols: type.h });
  }
  return orientations;
}

function buildRemainingServiceTypes(params: SolverParams, solution: Solution): RemainingServiceType[] {
  const serviceTypes = params.serviceTypes ?? [];
  const remaining = buildRemainingCounts(serviceTypes, solution.serviceTypeIndices);
  return serviceTypes.flatMap((type, index) => {
    const count = remaining[index] ?? 0;
    if (count <= 0) return [];
    return [{
      type,
      orientations: serviceOrientations(type),
    }];
  });
}

function buildRemainingResidentialTypes(params: SolverParams, solution: Solution): RemainingResidentialType[] {
  const residentialTypes = params.residentialTypes ?? [];
  const remaining = buildRemainingCounts(residentialTypes, solution.residentialTypeIndices);
  return residentialTypes.flatMap((type, typeIndex) => {
    const count = remaining[typeIndex] ?? 0;
    if (count <= 0) return [];
    return [{
      typeIndex,
      orientations: residentialOrientations(type),
    }];
  });
}

function placementFitsTopLeft(
  grid: Grid,
  occupiedBuildings: Set<string>,
  row: number,
  col: number,
  rows: number,
  cols: number
): boolean {
  if (row < 0 || col < 0 || row + rows > height(grid) || col + cols > width(grid)) return false;
  for (let r = row; r < row + rows; r += 1) {
    for (let c = col; c < col + cols; c += 1) {
      if (!isAllowed(grid, r, c) || occupiedBuildings.has(cellKey(r, c))) return false;
    }
  }
  return true;
}

function buildOccupiedKindMap(solution: Solution): Map<string, OccupiedKind> {
  const occupied = new Map<string, OccupiedKind>();
  for (const service of solution.services ?? []) {
    for (const key of serviceFootprint(service)) {
      occupied.set(key, "service");
    }
  }
  for (const residential of solution.residentials ?? []) {
    for (const key of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      occupied.set(key, "residential");
    }
  }
  for (const roadKey of solution.roads ?? []) {
    if (!occupied.has(roadKey)) {
      occupied.set(roadKey, "road");
    }
  }
  return occupied;
}

function buildBuildingOccupancy(solution: Solution): Set<string> {
  const occupied = new Set<string>();
  for (const service of solution.services ?? []) {
    for (const key of serviceFootprint(service)) {
      occupied.add(key);
    }
  }
  for (const residential of solution.residentials ?? []) {
    for (const key of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      occupied.add(key);
    }
  }
  return occupied;
}

function buildServiceValueByCell(grid: Grid, solution: Solution): Map<string, number> {
  const values = new Map<string, number>();
  for (let index = 0; index < (solution.services?.length ?? 0); index += 1) {
    const service = solution.services[index]!;
    const bonus = Number(solution.servicePopulationIncreases?.[index] ?? 0);
    if (!(bonus > 0)) continue;
    for (const key of serviceEffectZone(grid, service)) {
      values.set(key, (values.get(key) ?? 0) + bonus);
    }
  }
  return values;
}

function bestRemainingServiceBonusAt(
  grid: Grid,
  remainingServiceTypes: readonly RemainingServiceType[],
  occupiedBuildings: Set<string>,
  row: number,
  col: number
): number {
  let best = 0;
  for (const { type, orientations } of remainingServiceTypes) {
    for (const orientation of orientations) {
      if (!placementFitsTopLeft(grid, occupiedBuildings, row, col, orientation.rows, orientation.cols)) continue;
      best = Math.max(best, Number(type.bonus ?? 0));
    }
  }
  return best;
}

function bestRemainingResidentialOpportunityAt(
  grid: Grid,
  params: SolverParams,
  remainingResidentialTypes: readonly RemainingResidentialType[],
  occupiedBuildings: Set<string>,
  row: number,
  col: number
): { maxPopulation: number; headroom: number } {
  let maxPopulation = 0;
  let headroom = 0;
  for (const { typeIndex, orientations } of remainingResidentialTypes) {
    for (const orientation of orientations) {
      if (!placementFitsTopLeft(grid, occupiedBuildings, row, col, orientation.rows, orientation.cols)) continue;
      const baseMax = getResidentialBaseMax(params, orientation.rows, orientation.cols, typeIndex);
      maxPopulation = Math.max(maxPopulation, baseMax.max);
      headroom = Math.max(headroom, Math.max(0, baseMax.max - baseMax.base));
    }
  }
  return { maxPopulation, headroom };
}

export function buildPlannerExplainabilityMap(
  grid: Grid,
  params: SolverParams,
  solution: Solution
): PlannerExplainabilityMap {
  const rows = height(grid);
  const cols = width(grid);
  const occupiedKind = buildOccupiedKindMap(solution);
  const occupiedBuildings = buildBuildingOccupancy(solution);
  const frontier = computeRoadAnchorReachableEmptyFrontier(grid, occupiedBuildings);
  const serviceValueByCell = buildServiceValueByCell(grid, solution);
  const remainingServiceTypes = buildRemainingServiceTypes(params, solution);
  const remainingResidentialTypes = buildRemainingResidentialTypes(params, solution);
  let maxServiceValue = 0;
  let maxBestServiceBonus = 0;
  let maxResidentialOpportunity = 0;
  let maxResidentialHeadroom = 0;
  let maxConnectivityLostCells = 0;
  let maxConnectivityDisconnectedCells = 0;

  const cells: PlannerExplainabilityCell[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: PlannerExplainabilityCell[] = [];
    for (let c = 0; c < cols; c += 1) {
      const key = cellKey(r, c);
      const allowed = isAllowed(grid, r, c);
      const occupied = occupiedKind.get(key) ?? null;
      const anchorReachable = frontier.reachable.has(key);
      const serviceValue = allowed ? (serviceValueByCell.get(key) ?? 0) : 0;
      const bestServiceBonus = allowed
        ? bestRemainingServiceBonusAt(grid, remainingServiceTypes, occupiedBuildings, r, c)
        : 0;
      const residential = allowed
        ? bestRemainingResidentialOpportunityAt(grid, params, remainingResidentialTypes, occupiedBuildings, r, c)
        : { maxPopulation: 0, headroom: 0 };
      const shadow = allowed && occupied !== "service" && occupied !== "residential"
        ? measureBuildingConnectivityShadowFromFrontier(
            grid,
            occupiedBuildings,
            frontier,
            { r, c, rows: 1, cols: 1 },
            [key]
          )
        : {
            reachableBefore: frontier.reachable.size,
            reachableAfter: frontier.reachable.size,
            lostCells: 0,
            footprintCells: 0,
            disconnectedCells: 0,
          };

      maxServiceValue = Math.max(maxServiceValue, serviceValue);
      maxBestServiceBonus = Math.max(maxBestServiceBonus, bestServiceBonus);
      maxResidentialOpportunity = Math.max(maxResidentialOpportunity, residential.maxPopulation);
      maxResidentialHeadroom = Math.max(maxResidentialHeadroom, residential.headroom);
      maxConnectivityLostCells = Math.max(maxConnectivityLostCells, shadow.lostCells);
      maxConnectivityDisconnectedCells = Math.max(maxConnectivityDisconnectedCells, shadow.disconnectedCells);

      row.push({
        r,
        c,
        allowed,
        occupiedKind: occupied,
        roadAnchorReachable: anchorReachable,
        roadAnchorDistance: anchorReachable ? (frontier.distanceByKey.get(key) ?? 0) : null,
        serviceValue,
        bestServiceBonus,
        residentialOpportunity: residential.maxPopulation,
        residentialHeadroom: residential.headroom,
        connectivityLostCells: shadow.lostCells,
        connectivityDisconnectedCells: shadow.disconnectedCells,
        connectivityFootprintCells: shadow.footprintCells,
      });
    }
    cells.push(row);
  }

  return {
    schemaVersion: 1,
    rows,
    cols,
    maxServiceValue,
    maxBestServiceBonus,
    maxResidentialOpportunity,
    maxResidentialHeadroom,
    maxConnectivityLostCells,
    maxConnectivityDisconnectedCells,
    roadAnchorReachableCellCount: frontier.reachable.size,
    cells,
  };
}
