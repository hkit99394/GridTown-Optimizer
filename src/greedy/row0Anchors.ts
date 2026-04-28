/**
 * Road-anchor feasibility and refinement helpers for the greedy solver.
 */

import {
  cellKey,
  forEachRectangleCell,
  hasAvailableRow0RoadCell,
  normalizeServicePlacement,
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
  if (r !== 0 && c !== 0) return true;
  const blocked = new Set<string>(occupied);
  forEachRectangleCell(r, c, rows, cols, (rr, cc) => blocked.add(cellKey(rr, cc)));
  return hasAvailableRow0RoadCell(G, blocked);
}

export function collectRow0AnchorRefinementSeeds(solution: Solution): Set<string>[] {
  const seedKeys = new Set<string>();
  for (const key of solution.roads) {
    const [rowText, colText] = key.split(",");
    const row = Number(rowText);
    const col = Number(colText);
    if (row === 0 || col === 0) seedKeys.add(key);
  }
  for (const service of solution.services) {
    const normalized = normalizeServicePlacement(service);
    if (normalized.r === 0) {
      for (let c = normalized.c; c < normalized.c + normalized.cols; c++) seedKeys.add(`0,${c}`);
    }
    if (normalized.c === 0) {
      for (let r = normalized.r; r < normalized.r + normalized.rows; r++) seedKeys.add(`${r},0`);
    }
  }
  for (const residential of solution.residentials) {
    if (residential.r === 0) {
      for (let c = residential.c; c < residential.c + residential.cols; c++) seedKeys.add(`0,${c}`);
    }
    if (residential.c === 0) {
      for (let r = residential.r; r < residential.r + residential.rows; r++) seedKeys.add(`${r},0`);
    }
  }
  return [...seedKeys]
    .sort((left, right) => {
      const [leftRow, leftCol] = left.split(",").map(Number);
      const [rightRow, rightCol] = right.split(",").map(Number);
      return leftRow - rightRow || leftCol - rightCol;
    })
    .map((key) => new Set([key]));
}
