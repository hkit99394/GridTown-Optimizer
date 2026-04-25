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
import {
  buildBlockedPrefixSum,
  height,
  width,
  isAllowed,
  rectangleBlockedCount,
  rectangleCells,
  rectangleCountCells,
  rectangleSomeCell,
} from "./grid.js";
import { normalizeSize } from "./rules.js";

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

function serviceTypePriority(type: ServiceTypeSetting): number {
  const [rows, cols] = normalizeSize(type.rows, type.cols);
  const footprintArea = rows * cols;
  const effectArea = (rows + 2 * type.range) * (cols + 2 * type.range);
  return (type.bonus * effectArea) / Math.max(1, footprintArea);
}

function residentialTypePriority(type: ResidentialTypeSetting): number {
  const area = Math.max(1, type.w * type.h);
  return type.max / area + type.min / area / 10;
}

function sortedServiceTypeIndices(types: ServiceTypeSetting[]): number[] {
  return types
    .map((type, index) => ({ type, index }))
    .sort((a, b) =>
      serviceTypePriority(b.type) - serviceTypePriority(a.type)
      || b.type.bonus - a.type.bonus
      || b.type.range - a.type.range
      || a.type.rows * a.type.cols - b.type.rows * b.type.cols
      || b.type.avail - a.type.avail
      || a.index - b.index
    )
    .map((entry) => entry.index);
}

function sortedResidentialTypeIndices(types: ResidentialTypeSetting[]): number[] {
  return types
    .map((type, index) => ({ type, index }))
    .sort((a, b) =>
      residentialTypePriority(b.type) - residentialTypePriority(a.type)
      || b.type.max - a.type.max
      || b.type.min - a.type.min
      || a.type.w * a.type.h - b.type.w * b.type.h
      || b.type.avail - a.type.avail
      || a.index - b.index
    )
    .map((entry) => entry.index);
}

type PlacementPrototype = { r: number; c: number; rows: number; cols: number };
type FootprintGeometrySource = { r: number; c: number; rows: number; cols: number };
type StopCheck = () => void;

export interface FootprintGeometryCache {
  footprintKeysByIndex: readonly (readonly string[])[];
}

export interface ServiceGeometryCache extends FootprintGeometryCache {
  effectZoneKeysByIndex: readonly (readonly string[])[];
}

const rectangleCellKeyCache = new Map<string, readonly string[]>();
const serviceEffectZoneKeyCacheByGrid = new WeakMap<Grid, Map<string, readonly string[]>>();

function rectangleKey(r: number, c: number, rows: number, cols: number): string {
  return `${r},${c},${rows},${cols}`;
}

function getOrBuildRectangleCellKeys(
  r: number,
  c: number,
  rows: number,
  cols: number
): readonly string[] {
  const key = rectangleKey(r, c, rows, cols);
  const cached = rectangleCellKeyCache.get(key);
  if (cached) return cached;
  const cells = Object.freeze(rectangleCells(r, c, rows, cols));
  rectangleCellKeyCache.set(key, cells);
  return cells;
}

function serviceEffectZoneKey(service: Required<ServicePlacement>): string {
  return `${service.r},${service.c},${service.rows},${service.cols},${service.range}`;
}

function getServiceEffectZoneCache(G: Grid): Map<string, readonly string[]> {
  let cache = serviceEffectZoneKeyCacheByGrid.get(G);
  if (!cache) {
    cache = new Map();
    serviceEffectZoneKeyCacheByGrid.set(G, cache);
  }
  return cache;
}

function getOrBuildServiceEffectZoneKeys(
  G: Grid,
  service: Required<ServicePlacement>
): readonly string[] {
  const cache = getServiceEffectZoneCache(G);
  const key = serviceEffectZoneKey(service);
  const cached = cache.get(key);
  if (cached) return cached;

  const H = height(G);
  const W = width(G);
  const zone: string[] = [];
  const rMin = Math.max(0, service.r - service.range);
  const rMax = Math.min(H - 1, service.r + service.rows - 1 + service.range);
  const cMin = Math.max(0, service.c - service.range);
  const cMax = Math.min(W - 1, service.c + service.cols - 1 + service.range);
  for (let rr = rMin; rr <= rMax; rr++) {
    for (let cc = cMin; cc <= cMax; cc++) {
      const inFootprint = rr >= service.r
        && rr < service.r + service.rows
        && cc >= service.c
        && cc < service.c + service.cols;
      if (inFootprint) continue;
      if (isAllowed(G, rr, cc)) zone.push(cellKey(rr, cc));
    }
  }
  const frozenZone = Object.freeze(zone);
  cache.set(key, frozenZone);
  return frozenZone;
}

export function buildFootprintGeometryCache<T extends FootprintGeometrySource>(
  placements: readonly T[],
  maybeStop?: StopCheck
): FootprintGeometryCache {
  const footprintKeysByIndex: readonly string[][] = placements.map((placement) => {
    maybeStop?.();
    return [...getOrBuildRectangleCellKeys(placement.r, placement.c, placement.rows, placement.cols)];
  });
  return {
    footprintKeysByIndex: Object.freeze(footprintKeysByIndex),
  };
}

export function buildServiceGeometryCache<T extends ServicePlacement>(
  G: Grid,
  services: readonly T[],
  maybeStop?: StopCheck
): ServiceGeometryCache {
  const footprintKeysByIndex = Object.freeze(services.map((service) => {
    maybeStop?.();
    const placement = normalizeServicePlacement(service);
    return getOrBuildRectangleCellKeys(placement.r, placement.c, placement.rows, placement.cols);
  }));
  const effectZoneKeysByIndex = Object.freeze(services.map((service) => {
    maybeStop?.();
    return getOrBuildServiceEffectZoneKeys(G, normalizeServicePlacement(service));
  }));
  return {
    footprintKeysByIndex,
    effectZoneKeysByIndex,
  };
}

function enumerateValidPlacementsForDimensions(
  G: Grid,
  blockedPrefixSum: number[][],
  dimensions: [number, number][],
  maybeStop?: StopCheck
): Map<string, PlacementPrototype[]> {
  const H = height(G);
  const W = width(G);
  const placementMap = new Map<string, PlacementPrototype[]>();
  const seen = new Set<string>();

  for (const [rows, cols] of dimensions) {
    maybeStop?.();
    const key = `${rows}x${cols}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const placements: PlacementPrototype[] = [];
    if (rows > H || cols > W) {
      placementMap.set(key, placements);
      continue;
    }
    for (let r = 0; r <= H - rows; r++) {
      maybeStop?.();
      for (let c = 0; c <= W - cols; c++) {
        if (rectangleBlockedCount(blockedPrefixSum, r, c, rows, cols) !== 0) continue;
        placements.push({ r, c, rows, cols });
      }
    }
    placementMap.set(key, placements);
  }

  return placementMap;
}

/**
 * Effect zone for a service: all allowed cells within its configured outward range
 * around the footprint rectangle, excluding footprint cells.
 */
export function buildServiceEffectZoneSet(G: Grid, service: ServicePlacement): Set<string> {
  return new Set(getOrBuildServiceEffectZoneKeys(G, normalizeServicePlacement(service)));
}

export function serviceEffectZone(G: Grid, service: ServicePlacement): string[] {
  return [...getOrBuildServiceEffectZoneKeys(G, normalizeServicePlacement(service))];
}

export function serviceFootprint(service: ServicePlacement): string[] {
  const { r, c, rows, cols } = normalizeServicePlacement(service);
  return [...getOrBuildRectangleCellKeys(r, c, rows, cols)];
}

export function residentialFootprint(r: number, c: number, rows: number, cols: number): string[] {
  return [...getOrBuildRectangleCellKeys(r, c, rows, cols)];
}

/** All valid service placements from configured service types. */
export function enumerateServiceCandidates(G: Grid, params: SolverParams, maybeStop?: StopCheck): ServiceCandidate[] {
  const out: ServiceCandidate[] = [];
  const types = params.serviceTypes ?? [];
  const blockedPrefixSum = buildBlockedPrefixSum(G);
  const placementMap = enumerateValidPlacementsForDimensions(
    G,
    blockedPrefixSum,
    types.flatMap((type) => serviceTypeOrientations(type)),
    maybeStop
  );

  for (const typeIndex of sortedServiceTypeIndices(types)) {
    maybeStop?.();
    const type = types[typeIndex];
    if (type.avail <= 0) continue;
    for (const [rows, cols] of serviceTypeOrientations(type)) {
      for (const placement of placementMap.get(`${rows}x${cols}`) ?? []) {
        out.push({
          r: placement.r,
          c: placement.c,
          rows,
          cols,
          range: type.range,
          typeIndex,
          bonus: type.bonus,
        });
      }
    }
  }
  return out;
}

/** All valid 2×2 and 2×3 residential placements (legacy, no types) */
export function enumerateResidentialCandidates(G: Grid, maybeStop?: StopCheck): ResidentialPlacement[] {
  const out: ResidentialPlacement[] = [];
  const blockedPrefixSum = buildBlockedPrefixSum(G);
  const placementMap = enumerateValidPlacementsForDimensions(
    G,
    blockedPrefixSum,
    [
      [2, 2],
      [2, 3],
    ],
    maybeStop
  );
  for (const [rows, cols] of [
    [2, 2],
    [2, 3],
  ] as [number, number][]) {
    maybeStop?.();
    for (const placement of placementMap.get(`${rows}x${cols}`) ?? []) {
      out.push({ r: placement.r, c: placement.c, rows, cols });
    }
  }
  return out;
}

/** All valid residential placements from types; each type allows (w×h) and (h×w) when w ≠ h */
export function enumerateResidentialCandidatesFromTypes(
  G: Grid,
  types: ResidentialTypeSetting[],
  maybeStop?: StopCheck
): ResidentialCandidate[] {
  const out: ResidentialCandidate[] = [];
  const blockedPrefixSum = buildBlockedPrefixSum(G);
  const placementMap = enumerateValidPlacementsForDimensions(
    G,
    blockedPrefixSum,
    types.flatMap((type) => {
      const dimensions: [number, number][] = [[type.h, type.w]];
      if (type.w !== type.h) dimensions.push([type.w, type.h]);
      return dimensions;
    }),
    maybeStop
  );

  for (const typeIndex of sortedResidentialTypeIndices(types)) {
    maybeStop?.();
    const { w, h } = types[typeIndex];
    const orientations: [number, number][] = [[h, w]];
    if (w !== h) orientations.push([w, h]);
    for (const [rows, cols] of orientations) {
      for (const placement of placementMap.get(`${rows}x${cols}`) ?? []) {
        out.push({ r: placement.r, c: placement.c, rows, cols, typeIndex });
      }
    }
  }
  return out;
}

/** Check if footprint of (r, c, rows, cols) overlaps with occupied set */
export function overlaps(occupied: Set<string>, r: number, c: number, rows: number, cols: number): boolean {
  return rectangleSomeCell(r, c, rows, cols, (rr, cc) => occupied.has(cellKey(rr, cc)));
}

/** Count how many cells of the residential footprint fall inside the effect zone set */
export function countServiceBoost(
  effectZoneCells: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): number {
  return rectangleCountCells(r, c, rows, cols, (rr, cc) => effectZoneCells.has(cellKey(rr, cc)));
}

/** Whether any cell of residential footprint is in effect zone (binary: boosted or not per service) */
export function isBoostedByService(
  effectZoneCells: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  return rectangleSomeCell(r, c, rows, cols, (rr, cc) => effectZoneCells.has(cellKey(rr, cc)));
}
