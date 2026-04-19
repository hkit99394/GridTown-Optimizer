/**
 * Grid helpers: bounds, allowed cells, neighbors
 */

import type { Grid } from "./types.js";
import { cellKey } from "./types.js";

export function height(G: Grid): number {
  return G.length;
}

export function width(G: Grid): number {
  return G[0]?.length ?? 0;
}

export function isInBounds(G: Grid, r: number, c: number): boolean {
  return r >= 0 && r < height(G) && c >= 0 && c < width(G);
}

export function isAllowed(G: Grid, r: number, c: number): boolean {
  return isInBounds(G, r, c) && G[r][c] === 1;
}

/** Prefix sum of blocked cells for O(1) rectangle feasibility checks. */
export function buildBlockedPrefixSum(G: Grid): number[][] {
  const H = height(G);
  const W = width(G);
  const prefix = Array.from({ length: H + 1 }, () => Array(W + 1).fill(0));
  for (let r = 0; r < H; r++) {
    let rowBlocked = 0;
    for (let c = 0; c < W; c++) {
      if (G[r][c] !== 1) rowBlocked++;
      prefix[r + 1][c + 1] = prefix[r][c + 1] + rowBlocked;
    }
  }
  return prefix;
}

/** Count blocked cells inside rectangle [r, r+rows) × [c, c+cols). */
export function rectangleBlockedCount(
  blockedPrefixSum: number[][],
  r: number,
  c: number,
  rows: number,
  cols: number
): number {
  const r2 = r + rows;
  const c2 = c + cols;
  return (
    blockedPrefixSum[r2][c2]
    - blockedPrefixSum[r][c2]
    - blockedPrefixSum[r2][c]
    + blockedPrefixSum[r][c]
  );
}

const ORTH: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function forEachOrthogonalNeighbor(
  G: Grid,
  r: number,
  c: number,
  visit: (r: number, c: number) => void
): void {
  const H = height(G);
  const W = width(G);
  for (const [dr, dc] of ORTH) {
    const r2 = r + dr;
    const c2 = c + dc;
    if (r2 >= 0 && r2 < H && c2 >= 0 && c2 < W) {
      visit(r2, c2);
    }
  }
}

/** Orthogonal neighbors (r, c) in bounds */
export function orthogonalNeighbors(G: Grid, r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  forEachOrthogonalNeighbor(G, r, c, (r2, c2) => out.push([r2, c2]));
  return out;
}

export function forEachRectangleCell(
  r: number,
  c: number,
  rows: number,
  cols: number,
  visit: (r: number, c: number) => void
): void {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      visit(r + i, c + j);
    }
  }
}

export function rectangleSomeCell(
  r: number,
  c: number,
  rows: number,
  cols: number,
  predicate: (r: number, c: number) => boolean
): boolean {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (predicate(r + i, c + j)) return true;
    }
  }
  return false;
}

export function rectangleCountCells(
  r: number,
  c: number,
  rows: number,
  cols: number,
  predicate: (r: number, c: number) => boolean
): number {
  let count = 0;
  forEachRectangleCell(r, c, rows, cols, (rr, cc) => {
    if (predicate(rr, cc)) count++;
  });
  return count;
}

/** All cells in rectangle [r, r+rows) × [c, c+cols) */
export function rectangleCells(r: number, c: number, rows: number, cols: number): string[] {
  const keys = Array<string>(Math.max(0, rows * cols));
  let index = 0;
  forEachRectangleCell(r, c, rows, cols, (rr, cc) => {
    keys[index++] = cellKey(rr, cc);
  });
  return keys;
}

export function forEachRectangleBorderCell(
  r: number,
  c: number,
  rows: number,
  cols: number,
  visit: (r: number, c: number) => void
): void {
  const top = r - 1;
  const bottom = r + rows;
  const left = c - 1;
  const right = c + cols;
  for (let cc = c; cc < c + cols; cc++) {
    visit(top, cc);
    visit(bottom, cc);
  }
  for (let rr = r; rr < r + rows; rr++) {
    visit(rr, left);
    visit(rr, right);
  }
}

/** Cells that are orthogonally adjacent to the rectangle (outside it) */
export function rectangleBorderCells(
  r: number,
  c: number,
  rows: number,
  cols: number
): [number, number][] {
  const out: [number, number][] = [];
  forEachRectangleBorderCell(r, c, rows, cols, (rr, cc) => out.push([rr, cc]));
  return out;
}
