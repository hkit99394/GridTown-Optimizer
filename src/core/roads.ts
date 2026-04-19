/**
 * Road network: connected roads with at least one cell in row 0 (see SPEC)
 */

import type { Grid } from "./types.js";
import { cellKey } from "./types.js";
import { height, width, isAllowed, orthogonalNeighbors } from "./grid.js";
import { rectangleBorderCells } from "./grid.js";
import { rectangleCells } from "./grid.js";

/** Road seed: exactly one allowed cell in row 0 (first found). Satisfies "at least one road in row 0". */
export function roadSeedRow0(G: Grid): Set<string> {
  return new Set(roadSeedRow0Candidates(G)[0] ?? []);
}

/** Candidate row-0 road seeds, one per allowed anchor cell in row 0. */
export function roadSeedRow0Candidates(G: Grid): Set<string>[] {
  const seeds: Set<string>[] = [];
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    seeds.push(new Set([cellKey(0, c)]));
  }
  return seeds;
}

/** @deprecated Row-0 anchor correctness requires evaluating every allowed row-0 seed. */
export function roadSeedRow0RepresentativeCandidates(G: Grid, limit: number): Set<string>[] {
  void limit;
  return roadSeedRow0Candidates(G);
}

function availableRow0RoadTargets(G: Grid, blocked: Set<string>): Set<string> {
  const targets = new Set<string>();
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    const key = cellKey(0, c);
    if (blocked.has(key)) continue;
    targets.add(key);
  }
  return targets;
}

export function findAvailableRow0RoadCell(G: Grid, blocked: Set<string>): string | null {
  return availableRow0RoadTargets(G, blocked).values().next().value ?? null;
}

export function hasAvailableRow0RoadCell(G: Grid, blocked: Set<string>): boolean {
  return findAvailableRow0RoadCell(G, blocked) !== null;
}

/** BFS from start cells to any cell in targets; only allowed cells. Exclude cells in blockSet (e.g. building footprint). Returns path from start to first target, or null. */
function bfsPathToTargets(
  G: Grid,
  startCells: [number, number][],
  targets: Set<string>,
  blockSet: Set<string>
): [number, number][] | null {
  const H = height(G);
  const W = width(G);
  const visited = new Set<string>();
  const parent = new Map<string, [number, number]>();
  const queue: [number, number][] = [...startCells];

  for (const [r, c] of startCells) {
    const k = cellKey(r, c);
    visited.add(k);
    parent.set(k, [-1, -1]);
  }

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    const k = cellKey(r, c);
    if (targets.has(k)) {
      const path: [number, number][] = [];
      let cr = r,
        cc = c;
      while (cr >= 0 && cc >= 0) {
        path.push([cr, cc]);
        const pk = cellKey(cr, cc);
        const p = parent.get(pk);
        if (!p || p[0] < 0) break;
        [cr, cc] = p;
      }
      path.reverse();
      return path;
    }
    for (const [r2, c2] of orthogonalNeighbors(G, r, c)) {
      if (!isAllowed(G, r2, c2)) continue;
      const k2 = cellKey(r2, c2);
      if (blockSet.has(k2) || visited.has(k2)) continue;
      visited.add(k2);
      parent.set(k2, [r, c]);
      queue.push([r2, c2]);
    }
  }
  return null;
}

function buildingTouchesRoadAnchorRow(r: number): boolean {
  return r === 0;
}

export interface Row0ReachableEmptyFrontier {
  reachable: Set<string>;
  distanceByKey: Map<string, number>;
}

export interface DeferredRoadFrontierProbe {
  distance: number;
}

export interface RoadConnectionProbe {
  path: [number, number][] | null;
}

function buildRoadConnectionProbe(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): RoadConnectionProbe | null {
  if (buildingTouchesRoadAnchorRow(r)) {
    return { path: null };
  }

  const border = rectangleBorderCells(r, c, rows, cols);
  for (const [br, bc] of border) {
    if (roads.has(cellKey(br, bc))) {
      return { path: null };
    }
  }

  const blockSet = new Set<string>();
  for (const k of occupied) if (!roads.has(k)) blockSet.add(k);
  for (const k of rectangleCells(r, c, rows, cols)) blockSet.add(k);
  const targets = roads.size > 0 ? roads : availableRow0RoadTargets(G, blockSet);
  if (targets.size === 0) return null;

  const path = bfsPathToTargets(
    G,
    border.filter(([br, bc]) => isAllowed(G, br, bc) && !blockSet.has(cellKey(br, bc))),
    targets,
    blockSet
  );
  if (!path) return null;
  return { path };
}

export function computeRow0ReachableEmptyFrontier(
  G: Grid,
  blocked: Set<string>
): Row0ReachableEmptyFrontier {
  const reachable = new Set<string>();
  const distanceByKey = new Map<string, number>();
  const queue: [number, number][] = [];
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    const key = cellKey(0, c);
    if (blocked.has(key)) continue;
    reachable.add(key);
    distanceByKey.set(key, 0);
    queue.push([0, c]);
  }

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    const currentDistance = distanceByKey.get(cellKey(r, c)) ?? 0;
    for (const [r2, c2] of orthogonalNeighbors(G, r, c)) {
      if (!isAllowed(G, r2, c2)) continue;
      const nextKey = cellKey(r2, c2);
      if (blocked.has(nextKey) || reachable.has(nextKey)) continue;
      reachable.add(nextKey);
      distanceByKey.set(nextKey, currentDistance + 1);
      queue.push([r2, c2]);
    }
  }

  return { reachable, distanceByKey };
}

export function probeBuildingConnectedToRow0ReachableEmptyFrontier(
  G: Grid,
  frontier: Row0ReachableEmptyFrontier,
  r: number,
  c: number,
  rows: number,
  cols: number
): DeferredRoadFrontierProbe | null {
  if (buildingTouchesRoadAnchorRow(r)) {
    return { distance: 0 };
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [br, bc] of rectangleBorderCells(r, c, rows, cols)) {
    if (!isAllowed(G, br, bc)) continue;
    const key = cellKey(br, bc);
    if (!frontier.reachable.has(key)) continue;
    const distance = frontier.distanceByKey.get(key) ?? Number.POSITIVE_INFINITY;
    if (distance < bestDistance) bestDistance = distance;
  }
  if (!Number.isFinite(bestDistance)) return null;
  return { distance: bestDistance };
}

export function applyRoadConnectionProbe(roads: Set<string>, probe: RoadConnectionProbe): void {
  if (!probe.path) return;
  for (const [pr, pc] of probe.path) {
    roads.add(cellKey(pr, pc));
  }
}

/**
 * Check if the rectangle (r, c, rows, cols) is adjacent to road set R.
 * If not, try to find a path from the rectangle's border to R using allowed cells (excluding occupied).
 * If path exists, extend roads by that path and return true; else return false.
 */
export function ensureBuildingConnectedToRoads(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  const probe = buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols);
  if (!probe) return false;
  applyRoadConnectionProbe(roads, probe);
  return true;
}

/**
 * Keep only road cells that are connected to row 0 (at least one road cell with r=0).
 * Returns a new Set; does not modify the input.
 */
export function roadsConnectedToRow0(G: Grid, roads: Set<string>): Set<string> {
  const inRow0 = new Set<string>();
  for (const k of roads) {
    const [r] = k.split(",").map(Number);
    if (r === 0) inRow0.add(k);
  }
  if (inRow0.size === 0) return new Set();

  const reachable = new Set<string>(inRow0);
  const queue = [...inRow0].map((k) => k.split(",").map(Number) as [number, number]);
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    for (const [r2, c2] of orthogonalNeighbors(G, r, c)) {
      if (!isAllowed(G, r2, c2)) continue;
      const k2 = cellKey(r2, c2);
      if (!roads.has(k2) || reachable.has(k2)) continue;
      reachable.add(k2);
      queue.push([r2, c2]);
    }
  }
  return reachable;
}

/** @deprecated Use roadSeedRow0 instead. */
export const roadSeedColumn0 = roadSeedRow0;

/** @deprecated Use roadsConnectedToRow0 instead. */
export const roadsConnectedToColumn0 = roadsConnectedToRow0;

/** Check if building at (r,c,rows,cols) is already adjacent to roads (no extension needed for connectivity) */
export function isAdjacentToRoads(
  roads: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  if (buildingTouchesRoadAnchorRow(r)) return true;
  const border = rectangleBorderCells(r, c, rows, cols);
  for (const [br, bc] of border) {
    if (roads.has(cellKey(br, bc))) return true;
  }
  return false;
}

/** Check if we can connect this building to roads (either already adjacent or path exists on allowed cells). Does NOT modify roads. */
export function canConnectToRoads(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  return buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols) !== null;
}

/** Probe road connectivity for a building and return the connection path when one is needed. */
export function probeBuildingConnectedToRoads(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): RoadConnectionProbe | null {
  return buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols);
}

type BuildingPlacementForRoadMaterialization = {
  r: number;
  c: number;
  rows: number;
  cols: number;
};

export function materializeDeferredRoadNetwork(
  G: Grid,
  initialRoadSeed: Set<string> | undefined,
  occupiedBuildings: Set<string>,
  buildings: BuildingPlacementForRoadMaterialization[]
): Set<string> | null {
  const roads = roadsConnectedToRow0(G, new Set<string>(initialRoadSeed ?? []));
  if (roads.size === 0) {
    const fallbackRoad = findAvailableRow0RoadCell(G, occupiedBuildings);
    if (!fallbackRoad) return null;
    roads.add(fallbackRoad);
  }

  const pending = buildings.filter((building) => !buildingTouchesRoadAnchorRow(building.r));
  while (pending.length > 0) {
    let bestIndex = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestProbe: RoadConnectionProbe | null = null;
    let bestBuilding: BuildingPlacementForRoadMaterialization | null = null;
    for (let index = 0; index < pending.length; index++) {
      const building = pending[index];
      const probe = buildRoadConnectionProbe(
        G,
        roads,
        occupiedBuildings,
        building.r,
        building.c,
        building.rows,
        building.cols
      );
      if (!probe) continue;
      const cost = probe.path?.length ?? 0;
      if (
        cost < bestCost
        || (cost === bestCost && bestBuilding !== null && (
          building.r < bestBuilding.r
          || (building.r === bestBuilding.r && (
            building.c < bestBuilding.c
            || (building.c === bestBuilding.c && (
              building.rows < bestBuilding.rows
              || (building.rows === bestBuilding.rows && building.cols < bestBuilding.cols)
            ))
          ))
        ))
      ) {
        bestIndex = index;
        bestCost = cost;
        bestProbe = probe;
        bestBuilding = building;
      }
    }
    if (bestIndex < 0 || !bestProbe) return null;
    applyRoadConnectionProbe(roads, bestProbe);
    pending.splice(bestIndex, 1);
  }

  return roads;
}
