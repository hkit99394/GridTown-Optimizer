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
  const R = new Set<string>();
  const W = width(G);
  for (let c = 0; c < W; c++) {
    if (isAllowed(G, 0, c)) {
      R.add(cellKey(0, c));
      return R;
    }
  }
  return R;
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
  if (buildingTouchesRoadAnchorRow(r)) return true;
  const border = rectangleBorderCells(r, c, rows, cols);
  for (const [br, bc] of border) {
    if (!isAllowed(G, br, bc)) continue;
    if (roads.has(cellKey(br, bc))) return true;
  }
  const blockSet = new Set<string>();
  for (const k of occupied) if (!roads.has(k)) blockSet.add(k);
  for (const k of rectangleCells(r, c, rows, cols)) blockSet.add(k);
  const path = bfsPathToTargets(
    G,
    border.filter(([br, bc]) => isAllowed(G, br, bc) && !blockSet.has(cellKey(br, bc))),
    roads,
    blockSet
  );
  if (!path) return false;
  for (const [pr, pc] of path) {
    roads.add(cellKey(pr, pc));
  }
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
  if (buildingTouchesRoadAnchorRow(r)) return true;
  const border = rectangleBorderCells(r, c, rows, cols);
  for (const [br, bc] of border) {
    if (roads.has(cellKey(br, bc))) return true;
  }
  const blockSet = new Set<string>();
  for (const k of occupied) if (!roads.has(k)) blockSet.add(k);
  for (const k of rectangleCells(r, c, rows, cols)) blockSet.add(k);
  const path = bfsPathToTargets(
    G,
    border.filter(([br, bc]) => isAllowed(G, br, bc) && !blockSet.has(cellKey(br, bc))),
    roads,
    blockSet
  );
  return path !== null;
}
