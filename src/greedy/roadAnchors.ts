/**
 * Road-anchor feasibility and refinement helpers for the greedy solver.
 */

import {
  cellFromKey,
  cellKey,
  forEachRoadAnchorCellInRectangle,
  isRoadAnchorCell,
  normalizeServicePlacement,
} from "../core/index.js";
import type { Solution } from "../core/index.js";

export function collectRoadAnchorRefinementSeeds(solution: Solution): Set<string>[] {
  const seedKeys = new Set<string>();
  for (const key of solution.roads) {
    const { r, c } = cellFromKey(key);
    if (isRoadAnchorCell(r, c)) seedKeys.add(key);
  }
  for (const service of solution.services) {
    const normalized = normalizeServicePlacement(service);
    forEachRoadAnchorCellInRectangle(normalized.r, normalized.c, normalized.rows, normalized.cols, (r, c) => {
      seedKeys.add(cellKey(r, c));
    });
  }
  for (const residential of solution.residentials) {
    forEachRoadAnchorCellInRectangle(residential.r, residential.c, residential.rows, residential.cols, (r, c) => {
      seedKeys.add(cellKey(r, c));
    });
  }
  return [...seedKeys]
    .sort((left, right) => {
      const [leftRow, leftCol] = left.split(",").map(Number);
      const [rightRow, rightCol] = right.split(",").map(Number);
      return leftRow - rightRow || leftCol - rightCol;
    })
    .map((key) => new Set([key]));
}
