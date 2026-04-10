/**
 * Building footprints, effect zones, candidate enumeration
 */

import type { Grid } from "./types.js";
import { cellKey } from "./types.js";
import type {
  ServicePlacement,
  ServiceCandidate,
  ResidentialPlacement,
  ResidentialCandidate,
  ResidentialTypeSetting,
  ServiceTypeSetting,
  SolverParams,
} from "./types.js";
import { height, width, isAllowed } from "./grid.js";
import { rectangleCells, rectangleBorderCells } from "./grid.js";

export function normalizeServicePlacement(service: ServicePlacement): Required<ServicePlacement> {
  return {
    r: service.r,
    c: service.c,
    rows: service.rows,
    cols: service.cols,
    range: service.range,
  };
}

function serviceTypeOrientations(type: ServiceTypeSetting): [number, number][] {
  const orientations: [number, number][] = [[type.rows, type.cols]];
  if ((type.allowRotation ?? true) && type.rows !== type.cols) orientations.push([type.cols, type.rows]);
  return orientations;
}

/**
 * Effect zone for a service: all allowed cells within its configured outward range
 * around the footprint rectangle, excluding footprint cells.
 */
export function serviceEffectZone(G: Grid, service: ServicePlacement): string[] {
  const { r, c, rows, cols, range } = normalizeServicePlacement(service);
  const H = height(G);
  const W = width(G);
  const zone: string[] = [];
  const rMin = Math.max(0, r - range);
  const rMax = Math.min(H - 1, r + rows - 1 + range);
  const cMin = Math.max(0, c - range);
  const cMax = Math.min(W - 1, c + cols - 1 + range);
  for (let rr = rMin; rr <= rMax; rr++) {
    for (let cc = cMin; cc <= cMax; cc++) {
      const inFootprint = rr >= r && rr < r + rows && cc >= c && cc < c + cols;
      if (inFootprint) continue;
      if (isAllowed(G, rr, cc)) zone.push(cellKey(rr, cc));
    }
  }
  return zone;
}

export function serviceFootprint(service: ServicePlacement): string[] {
  const { r, c, rows, cols } = normalizeServicePlacement(service);
  return rectangleCells(r, c, rows, cols);
}

export function residentialFootprint(r: number, c: number, rows: number, cols: number): string[] {
  return rectangleCells(r, c, rows, cols);
}

/** All valid service placements from configured service types. */
export function enumerateServiceCandidates(G: Grid, params: SolverParams): ServiceCandidate[] {
  const H = height(G);
  const W = width(G);
  const out: ServiceCandidate[] = [];
  const types = params.serviceTypes ?? [];

  for (let typeIndex = 0; typeIndex < types.length; typeIndex++) {
    const type = types[typeIndex];
    if (type.avail <= 0) continue;
    for (const [rows, cols] of serviceTypeOrientations(type)) {
      if (rows > H || cols > W) continue;
      for (let r = 0; r <= H - rows; r++) {
        for (let c = 0; c <= W - cols; c++) {
          let ok = true;
          for (let i = 0; i < rows && ok; i++) {
            for (let j = 0; j < cols && ok; j++) {
              if (!isAllowed(G, r + i, c + j)) ok = false;
            }
          }
          if (ok) out.push({ r, c, rows, cols, range: type.range, typeIndex, bonus: type.bonus });
        }
      }
    }
  }
  return out;
}

/** All valid 2×2 and 2×3 residential placements (legacy, no types) */
export function enumerateResidentialCandidates(G: Grid): ResidentialPlacement[] {
  const H = height(G);
  const W = width(G);
  const out: ResidentialPlacement[] = [];
  for (const [rows, cols] of [
    [2, 2],
    [2, 3],
  ] as [number, number][]) {
    for (let r = 0; r <= H - rows; r++) {
      for (let c = 0; c <= W - cols; c++) {
        let ok = true;
        for (let i = 0; i < rows && ok; i++) {
          for (let j = 0; j < cols && ok; j++) {
            if (!isAllowed(G, r + i, c + j)) ok = false;
          }
        }
        if (ok) out.push({ r, c, rows, cols });
      }
    }
  }
  return out;
}

/** All valid residential placements from types; each type allows (w×h) and (h×w) when w ≠ h */
export function enumerateResidentialCandidatesFromTypes(
  G: Grid,
  types: ResidentialTypeSetting[]
): ResidentialCandidate[] {
  const H = height(G);
  const W = width(G);
  const out: ResidentialCandidate[] = [];
  for (let typeIndex = 0; typeIndex < types.length; typeIndex++) {
    const { w, h } = types[typeIndex];
    const orientations: [number, number][] = [[h, w]];
    if (w !== h) orientations.push([w, h]);
    for (const [rows, cols] of orientations) {
      if (rows > H || cols > W) continue;
      for (let r = 0; r <= H - rows; r++) {
        for (let c = 0; c <= W - cols; c++) {
          let ok = true;
          for (let i = 0; i < rows && ok; i++) {
            for (let j = 0; j < cols && ok; j++) {
              if (!isAllowed(G, r + i, c + j)) ok = false;
            }
          }
          if (ok) out.push({ r, c, rows, cols, typeIndex });
        }
      }
    }
  }
  return out;
}

/** Check if footprint of (r, c, rows, cols) overlaps with occupied set */
export function overlaps(occupied: Set<string>, r: number, c: number, rows: number, cols: number): boolean {
  const cells = rectangleCells(r, c, rows, cols);
  return cells.some((k) => occupied.has(k));
}

/** Count how many cells of the residential footprint fall inside the effect zone set */
export function countServiceBoost(
  effectZoneCells: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): number {
  const foot = residentialFootprint(r, c, rows, cols);
  return foot.filter((k) => effectZoneCells.has(k)).length;
}

/** Whether any cell of residential footprint is in effect zone (binary: boosted or not per service) */
export function isBoostedByService(
  effectZoneCells: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  const foot = residentialFootprint(r, c, rows, cols);
  return foot.some((k) => effectZoneCells.has(k));
}
