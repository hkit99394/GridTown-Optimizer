/**
 * Road network: connected roads with at least one cell in row 0 (see SPEC)
 */

import type { Grid } from "./types.js";
import { cellFromKey, cellKey } from "./types.js";
import {
  forEachOrthogonalNeighbor,
  forEachRectangleBorderCell,
  forEachRectangleCell,
  rectangleBorderCells,
  height,
  width,
  isAllowed,
} from "./grid.js";

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

export function findAvailableRow0RoadCell(G: Grid, blocked: Set<string>): string | null {
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    const key = cellKey(0, c);
    if (!blocked.has(key)) return key;
  }
  return null;
}

export function hasAvailableRow0RoadCell(G: Grid, blocked: Set<string>): boolean {
  return findAvailableRow0RoadCell(G, blocked) !== null;
}

export interface RoadProbeScratch {
  height: number;
  width: number;
  cellKeys: string[];
  blockedStamp: Int32Array;
  visitedStamp: Int32Array;
  parentIndex: Int32Array;
  queue: Int32Array;
  blockedGeneration: number;
  visitedGeneration: number;
}

function nextScratchGeneration(stamps: Int32Array, current: number): number {
  const next = current + 1;
  if (next >= 0x7fffffff) {
    stamps.fill(0);
    return 1;
  }
  return next;
}

function scratchCellIndex(scratch: RoadProbeScratch, r: number, c: number): number {
  return r * scratch.width + c;
}

function roadProbeScratchMatchesGrid(G: Grid, scratch: RoadProbeScratch): boolean {
  return scratch.height === height(G) && scratch.width === width(G);
}

function hasAvailableRow0RoadCellWithScratch(
  G: Grid,
  scratch: RoadProbeScratch,
  blockedGeneration: number
): boolean {
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    if (scratch.blockedStamp[scratchCellIndex(scratch, 0, c)] !== blockedGeneration) return true;
  }
  return false;
}

export function createRoadProbeScratch(G: Grid): RoadProbeScratch {
  const H = height(G);
  const W = width(G);
  return {
    height: H,
    width: W,
    cellKeys: Array.from({ length: H * W }, (_, index) => {
      const r = Math.floor(index / W);
      const c = index % W;
      return cellKey(r, c);
    }),
    blockedStamp: new Int32Array(H * W),
    visitedStamp: new Int32Array(H * W),
    parentIndex: new Int32Array(H * W),
    queue: new Int32Array(H * W),
    blockedGeneration: 0,
    visitedGeneration: 0,
  };
}

/** BFS from start cells to any cell in targets; only allowed cells. Exclude cells in blockSet (e.g. building footprint). Returns path from start to first target, or null. */
function bfsPathToTargets(
  G: Grid,
  startCells: [number, number][],
  blockSet: Set<string>,
  targetRoads: Set<string> | null
): [number, number][] | null {
  const visited = new Set<string>();
  const parent = new Map<string, [number, number]>();
  const queue: [number, number][] = [...startCells];
  let queueIndex = 0;
  const usesExplicitRoadTargets = targetRoads !== null;

  for (const [r, c] of startCells) {
    const k = cellKey(r, c);
    visited.add(k);
    parent.set(k, [-1, -1]);
  }

  while (queueIndex < queue.length) {
    const [r, c] = queue[queueIndex++]!;
    const k = cellKey(r, c);
    if ((usesExplicitRoadTargets && targetRoads.has(k)) || (!usesExplicitRoadTargets && r === 0)) {
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
    forEachOrthogonalNeighbor(G, r, c, (r2, c2) => {
      if (!isAllowed(G, r2, c2)) return;
      const k2 = cellKey(r2, c2);
      if (blockSet.has(k2) || visited.has(k2)) return;
      visited.add(k2);
      parent.set(k2, [r, c]);
      queue.push([r2, c2]);
    });
  }
  return null;
}

function bfsPathToTargetsWithScratch(
  G: Grid,
  startCells: [number, number][],
  scratch: RoadProbeScratch,
  blockedGeneration: number,
  targetRoads: Set<string> | null
): [number, number][] | null {
  const usesExplicitRoadTargets = targetRoads !== null;
  scratch.visitedGeneration = nextScratchGeneration(scratch.visitedStamp, scratch.visitedGeneration);
  const visitedGeneration = scratch.visitedGeneration;
  let queueLength = 0;
  let queueIndex = 0;

  for (const [r, c] of startCells) {
    const startIndex = scratchCellIndex(scratch, r, c);
    if (scratch.visitedStamp[startIndex] === visitedGeneration) continue;
    scratch.visitedStamp[startIndex] = visitedGeneration;
    scratch.parentIndex[startIndex] = -1;
    scratch.queue[queueLength++] = startIndex;
  }

  while (queueIndex < queueLength) {
    const currentIndex = scratch.queue[queueIndex++]!;
    const r = Math.floor(currentIndex / scratch.width);
    const c = currentIndex - r * scratch.width;
    const key = scratch.cellKeys[currentIndex];
    if ((usesExplicitRoadTargets && targetRoads.has(key)) || (!usesExplicitRoadTargets && r === 0)) {
      const path: [number, number][] = [];
      let pathIndex = currentIndex;
      while (pathIndex >= 0) {
        const pathRow = Math.floor(pathIndex / scratch.width);
        const pathCol = pathIndex - pathRow * scratch.width;
        path.push([pathRow, pathCol]);
        pathIndex = scratch.parentIndex[pathIndex] ?? -1;
      }
      path.reverse();
      return path;
    }
    forEachOrthogonalNeighbor(G, r, c, (r2, c2) => {
      if (!isAllowed(G, r2, c2)) return;
      const nextIndex = scratchCellIndex(scratch, r2, c2);
      if (scratch.blockedStamp[nextIndex] === blockedGeneration) return;
      if (scratch.visitedStamp[nextIndex] === visitedGeneration) return;
      scratch.visitedStamp[nextIndex] = visitedGeneration;
      scratch.parentIndex[nextIndex] = currentIndex;
      scratch.queue[queueLength++] = nextIndex;
    });
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
  cols: number,
  scratch?: RoadProbeScratch
): RoadConnectionProbe | null {
  if (buildingTouchesRoadAnchorRow(r)) {
    return { path: null };
  }

  const useScratch = scratch && roadProbeScratchMatchesGrid(G, scratch) ? scratch : null;
  const border = rectangleBorderCells(r, c, rows, cols);
  const blockSet = useScratch ? null : new Set<string>();
  let blockedGeneration = -1;
  if (useScratch) {
    useScratch.blockedGeneration = nextScratchGeneration(useScratch.blockedStamp, useScratch.blockedGeneration);
    blockedGeneration = useScratch.blockedGeneration;
    for (const key of occupied) {
      if (roads.has(key)) continue;
      const { r: occupiedRow, c: occupiedCol } = cellFromKey(key);
      useScratch.blockedStamp[scratchCellIndex(useScratch, occupiedRow, occupiedCol)] = blockedGeneration;
    }
    forEachRectangleCell(r, c, rows, cols, (rr, cc) => {
      useScratch.blockedStamp[scratchCellIndex(useScratch, rr, cc)] = blockedGeneration;
    });
  } else {
    for (const key of occupied) {
      if (!roads.has(key)) blockSet!.add(key);
    }
    forEachRectangleCell(r, c, rows, cols, (rr, cc) => blockSet!.add(cellKey(rr, cc)));
  }
  const startCells: [number, number][] = [];
  let touchesRoad = false;
  for (const [br, bc] of border) {
    if (!isAllowed(G, br, bc)) continue;
    const key = cellKey(br, bc);
    if (roads.has(key)) {
      touchesRoad = true;
      continue;
    }
    const blocked = useScratch
      ? useScratch.blockedStamp[scratchCellIndex(useScratch, br, bc)] === blockedGeneration
      : blockSet!.has(key);
    if (!blocked) {
      startCells.push([br, bc]);
    }
  }
  if (touchesRoad) {
    return { path: null };
  }
  if (
    roads.size === 0
    && !(useScratch
      ? hasAvailableRow0RoadCellWithScratch(G, useScratch, blockedGeneration)
      : hasAvailableRow0RoadCell(G, blockSet!))
  ) {
    return null;
  }

  const path = useScratch
    ? bfsPathToTargetsWithScratch(G, startCells, useScratch, blockedGeneration, roads.size > 0 ? roads : null)
    : bfsPathToTargets(G, startCells, blockSet!, roads.size > 0 ? roads : null);
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
  let queueIndex = 0;
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (!isAllowed(G, 0, c)) continue;
    const key = cellKey(0, c);
    if (blocked.has(key)) continue;
    reachable.add(key);
    distanceByKey.set(key, 0);
    queue.push([0, c]);
  }

  while (queueIndex < queue.length) {
    const [r, c] = queue[queueIndex++]!;
    const currentDistance = distanceByKey.get(cellKey(r, c)) ?? 0;
    forEachOrthogonalNeighbor(G, r, c, (r2, c2) => {
      if (!isAllowed(G, r2, c2)) return;
      const nextKey = cellKey(r2, c2);
      if (blocked.has(nextKey) || reachable.has(nextKey)) return;
      reachable.add(nextKey);
      distanceByKey.set(nextKey, currentDistance + 1);
      queue.push([r2, c2]);
    });
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
  forEachRectangleBorderCell(r, c, rows, cols, (br, bc) => {
    if (!isAllowed(G, br, bc)) return;
    const key = cellKey(br, bc);
    if (!frontier.reachable.has(key)) return;
    const distance = frontier.distanceByKey.get(key) ?? Number.POSITIVE_INFINITY;
    if (distance < bestDistance) bestDistance = distance;
  });
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
  cols: number,
  scratch?: RoadProbeScratch
): boolean {
  const probe = buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols, scratch);
  if (!probe) return false;
  applyRoadConnectionProbe(roads, probe);
  return true;
}

/**
 * Keep every road component that is anchored by at least one row-0 road cell.
 * Returns a new Set; does not modify the input.
 */
export function roadsConnectedToRow0(G: Grid, roads: Set<string>): Set<string> {
  const reachable = new Set<string>();
  const queue: [number, number][] = [];
  for (const k of roads) {
    const { r, c } = cellFromKey(k);
    if (r === 0) {
      reachable.add(k);
      queue.push([r, c]);
    }
  }
  if (queue.length === 0) return new Set();

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const [r, c] = queue[queueIndex++]!;
    forEachOrthogonalNeighbor(G, r, c, (r2, c2) => {
      if (!isAllowed(G, r2, c2)) return;
      const k2 = cellKey(r2, c2);
      if (!roads.has(k2) || reachable.has(k2)) return;
      reachable.add(k2);
      queue.push([r2, c2]);
    });
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
  let adjacent = false;
  forEachRectangleBorderCell(r, c, rows, cols, (br, bc) => {
    if (!adjacent && roads.has(cellKey(br, bc))) adjacent = true;
  });
  return adjacent;
}

/** Check if we can connect this building to roads (either already adjacent or path exists on allowed cells). Does NOT modify roads. */
export function canConnectToRoads(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number,
  scratch?: RoadProbeScratch
): boolean {
  return buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols, scratch) !== null;
}

/** Probe road connectivity for a building and return the connection path when one is needed. */
export function probeBuildingConnectedToRoads(
  G: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number,
  scratch?: RoadProbeScratch
): RoadConnectionProbe | null {
  return buildRoadConnectionProbe(G, roads, occupied, r, c, rows, cols, scratch);
}

export type BuildingPlacementForRoadMaterialization = {
  r: number;
  c: number;
  rows: number;
  cols: number;
};

function compareRoadPruneCandidates(leftKey: string, rightKey: string): number {
  const left = cellFromKey(leftKey);
  const right = cellFromKey(rightKey);
  const leftTouchesAnchor = left.r === 0;
  const rightTouchesAnchor = right.r === 0;
  if (leftTouchesAnchor !== rightTouchesAnchor) return leftTouchesAnchor ? 1 : -1;
  if (left.r !== right.r) return right.r - left.r;
  return left.c - right.c;
}

function roadSetHasSingleRow0ConnectedComponent(G: Grid, roads: Set<string>): boolean {
  const connectedRoads = roadsConnectedToRow0(G, roads);
  if (connectedRoads.size === 0 || connectedRoads.size !== roads.size) return false;
  return true;
}

function allBuildingsHaveRoadAccess(
  roads: Set<string>,
  buildings: readonly BuildingPlacementForRoadMaterialization[]
): boolean {
  return buildings.every((building) =>
    isAdjacentToRoads(roads, building.r, building.c, building.rows, building.cols)
  );
}

/** Remove final road cells that are not required for row-0 road connectivity or building access. */
export function pruneRedundantRoads(
  G: Grid,
  roads: Set<string>,
  buildings: readonly BuildingPlacementForRoadMaterialization[]
): Set<string> {
  let pruned = roadsConnectedToRow0(G, roads);
  let changed = true;
  while (changed) {
    changed = false;
    const candidates = [...pruned].sort(compareRoadPruneCandidates);
    for (const key of candidates) {
      const candidateRoads = new Set(pruned);
      candidateRoads.delete(key);
      if (!roadSetHasSingleRow0ConnectedComponent(G, candidateRoads)) continue;
      if (!allBuildingsHaveRoadAccess(candidateRoads, buildings)) continue;
      pruned = candidateRoads;
      changed = true;
      break;
    }
  }
  return pruned;
}

export function materializeDeferredRoadNetwork(
  G: Grid,
  initialRoadSeed: Set<string> | undefined,
  occupiedBuildings: Set<string>,
  buildings: BuildingPlacementForRoadMaterialization[],
  scratch?: RoadProbeScratch
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
        building.cols,
        scratch
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

  return pruneRedundantRoads(G, roads, buildings);
}
