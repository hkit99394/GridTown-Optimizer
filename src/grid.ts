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

const ORTH: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Orthogonal neighbors (r, c) in bounds */
export function orthogonalNeighbors(G: Grid, r: number, c: number): [number, number][] {
  const H = height(G);
  const W = width(G);
  const out: [number, number][] = [];
  for (const [dr, dc] of ORTH) {
    const r2 = r + dr;
    const c2 = c + dc;
    if (r2 >= 0 && r2 < H && c2 >= 0 && c2 < W) out.push([r2, c2]);
  }
  return out;
}

/** All cells in rectangle [r, r+rows) × [c, c+cols) */
export function rectangleCells(r: number, c: number, rows: number, cols: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      keys.push(cellKey(r + i, c + j));
    }
  }
  return keys;
}

/** Cells that are orthogonally adjacent to the rectangle (outside it) */
export function rectangleBorderCells(
  r: number,
  c: number,
  rows: number,
  cols: number
): [number, number][] {
  const set = new Set<string>();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const r0 = r + i;
      const c0 = c + j;
      for (const [dr, dc] of ORTH) {
        const r1 = r0 + dr;
        const c1 = c0 + dc;
        if (r1 < r || r1 >= r + rows || c1 < c || c1 >= c + cols) {
          set.add(cellKey(r1, c1));
        }
      }
    }
  }
  return [...set].map((k) => {
    const [a, b] = k.split(",").map(Number);
    return [a, b] as [number, number];
  });
}
