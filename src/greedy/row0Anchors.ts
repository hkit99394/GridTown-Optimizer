/**
 * Row-0 feasibility and refinement helpers for the greedy solver.
 */

import {
  hasAvailableRow0RoadCell,
  normalizeServicePlacement,
  residentialFootprint,
} from "../core/index.js";
import type { Grid, Solution } from "../core/index.js";

export function placementLeavesRow0RoadCellAvailable(
  G: Grid,
  occupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  if (r !== 0) return true;
  const blocked = new Set<string>(occupied);
  for (const key of residentialFootprint(r, c, rows, cols)) blocked.add(key);
  return hasAvailableRow0RoadCell(G, blocked);
}

export function collectRow0AnchorRefinementSeeds(solution: Solution): Set<string>[] {
  const columns = new Set<number>();
  for (const key of solution.roads) {
    const [rowText, colText] = key.split(",");
    if (Number(rowText) === 0) columns.add(Number(colText));
  }
  for (const service of solution.services) {
    const normalized = normalizeServicePlacement(service);
    if (normalized.r !== 0) continue;
    for (let c = normalized.c; c < normalized.c + normalized.cols; c++) columns.add(c);
  }
  for (const residential of solution.residentials) {
    if (residential.r !== 0) continue;
    for (let c = residential.c; c < residential.c + residential.cols; c++) columns.add(c);
  }
  return [...columns].sort((left, right) => left - right).map((column) => new Set([`0,${column}`]));
}
