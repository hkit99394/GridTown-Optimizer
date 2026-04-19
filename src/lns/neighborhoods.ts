/**
 * LNS neighborhood ranking, escalation, and repair-window planning.
 */

import {
  normalizeServicePlacement,
  residentialFootprint,
  serviceEffectZone,
  serviceFootprint,
  height,
  isAllowed,
  orthogonalNeighbors,
  width,
  getResidentialBaseMax,
  NO_TYPE_INDEX,
} from "../core/index.js";
import type { CpSatNeighborhoodWindow, Grid, Solution, SolverParams } from "../core/index.js";
import { cellFromKey, cellKey } from "../core/index.js";

export interface NeighborhoodAnchor {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

interface RankedNeighborhoodAnchor extends NeighborhoodAnchor {
  score: number;
}

export interface LnsNeighborhoodOptions {
  maxNoImprovementIterations: number;
  neighborhoodRows: number;
  neighborhoodCols: number;
}

function getLargeNeighborhoodTrigger(options: Pick<LnsNeighborhoodOptions, "maxNoImprovementIterations">): number {
  return Math.max(1, Math.ceil(options.maxNoImprovementIterations / 2));
}

function clampNeighborhoodWindow(
  G: Grid,
  anchor: NeighborhoodAnchor,
  neighborhoodRows: number,
  neighborhoodCols: number
): CpSatNeighborhoodWindow | null {
  const H = height(G);
  const W = width(G);
  if (H === 0 || W === 0) return null;

  const repairRowStart = H > 1 ? 1 : 0;
  const repairableRows = H - repairRowStart;
  if (repairableRows <= 0) return null;

  const rows = Math.max(1, Math.min(neighborhoodRows, repairableRows));
  const cols = Math.max(1, Math.min(neighborhoodCols, W));
  const anchorCenterRow = anchor.r + Math.floor(anchor.rows / 2);
  const anchorCenterCol = anchor.c + Math.floor(anchor.cols / 2);

  let top = anchorCenterRow - Math.floor(rows / 2);
  top = Math.max(repairRowStart, Math.min(top, H - rows));

  let left = anchorCenterCol - Math.floor(cols / 2);
  left = Math.max(0, Math.min(left, W - cols));

  return { top, left, rows, cols };
}

function addWindow(
  dedupe: Map<string, CpSatNeighborhoodWindow>,
  window: CpSatNeighborhoodWindow | null
): void {
  if (!window) return;
  dedupe.set(`${window.top}:${window.left}:${window.rows}:${window.cols}`, window);
}

function addRowZeroRepairWindows(
  windows: Map<string, CpSatNeighborhoodWindow>,
  G: Grid,
  rows: number,
  cols: number
): void {
  const H = height(G);
  const W = width(G);
  if (H <= 0 || W <= 0) return;

  const topBandRows = Math.max(1, Math.min(H, rows));
  const topBandCols = Math.max(1, Math.min(W, cols));
  const colStride = Math.max(1, Math.floor(topBandCols / 2));
  for (let left = 0; left <= W - topBandCols; left += colStride) {
    addWindow(windows, { top: 0, left, rows: topBandRows, cols: topBandCols });
  }
  addWindow(windows, { top: 0, left: Math.max(0, W - topBandCols), rows: topBandRows, cols: topBandCols });
}

function addClampedWindowsForAnchors<T extends NeighborhoodAnchor>(
  windows: Map<string, CpSatNeighborhoodWindow>,
  G: Grid,
  anchors: readonly T[],
  windowSizes: readonly { rows: number; cols: number }[]
): void {
  for (const { rows, cols } of windowSizes) {
    for (const anchor of anchors) {
      addWindow(windows, clampNeighborhoodWindow(G, anchor, rows, cols));
    }
  }
}

function addSlidingNeighborhoodWindows(
  windows: Map<string, CpSatNeighborhoodWindow>,
  G: Grid,
  neighborhoodRows: number,
  neighborhoodCols: number
): void {
  const H = height(G);
  const W = width(G);
  const rows = Math.max(1, Math.min(neighborhoodRows, H > 1 ? H - 1 : H));
  const cols = Math.max(1, Math.min(neighborhoodCols, W));
  const rowStart = H > 1 ? 1 : 0;
  const rowStride = Math.max(1, Math.floor(rows / 2));
  const colStride = Math.max(1, Math.floor(cols / 2));

  for (let top = rowStart; top <= H - rows; top += rowStride) {
    for (let left = 0; left <= W - cols; left += colStride) {
      addWindow(windows, { top, left, rows, cols });
    }
    addWindow(windows, { top: Math.max(rowStart, H - rows), left: 0, rows, cols });
  }
  for (let left = 0; left <= W - cols; left += colStride) {
    addWindow(windows, { top: Math.max(rowStart, H - rows), left, rows, cols });
  }

  addRowZeroRepairWindows(windows, G, rows + rowStart, cols);
}

function interleaveAnchors(anchorGroups: NeighborhoodAnchor[][]): NeighborhoodAnchor[] {
  const interleaved: NeighborhoodAnchor[] = [];
  const maxLength = anchorGroups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index++) {
    for (const group of anchorGroups) {
      if (index < group.length) interleaved.push(group[index]);
    }
  }
  return interleaved;
}

function buildOccupiedCellSet(solution: Solution): Set<string> {
  const occupied = new Set<string>();
  for (const service of solution.services) {
    for (const cell of serviceFootprint(service)) occupied.add(cell);
  }
  for (const residential of solution.residentials) {
    for (const cell of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      occupied.add(cell);
    }
  }
  return occupied;
}

export function computeResidentialBoostsForSolution(G: Grid, solution: Solution): number[] {
  const effectZones = solution.services.map((service) => new Set(serviceEffectZone(G, service)));
  return solution.residentials.map((residential) => {
    const footprint = residentialFootprint(residential.r, residential.c, residential.rows, residential.cols);
    let boost = 0;
    for (let serviceIndex = 0; serviceIndex < effectZones.length; serviceIndex++) {
      if (footprint.some((cell) => effectZones[serviceIndex].has(cell))) {
        boost += solution.servicePopulationIncreases[serviceIndex] ?? 0;
      }
    }
    return boost;
  });
}

function buildWeakServiceAnchors(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (!incumbent.services.length || limit <= 0) return [];

  const boosts = computeResidentialBoostsForSolution(G, incumbent);
  const residentialFootprints = incumbent.residentials.map((residential) =>
    residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)
  );
  const serviceEffectZones = incumbent.services.map((service) => new Set(serviceEffectZone(G, service)));

  return incumbent.services
    .map((service, serviceIndex) => {
      const serviceBonus = incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
      const effectZone = serviceEffectZones[serviceIndex];
      let marginalGain = 0;
      let coveredResidentials = 0;

      for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
        if (!residentialFootprints[residentialIndex].some((cell) => effectZone.has(cell))) continue;
        coveredResidentials += 1;

        const residential = incumbent.residentials[residentialIndex];
        const typeIndex = incumbent.residentialTypeIndices[residentialIndex] ?? NO_TYPE_INDEX;
        const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
        const populationWithoutService = Math.min(Math.max(base + boosts[residentialIndex] - serviceBonus, base), max);
        const populationWithService = incumbent.populations[residentialIndex] ?? Math.min(Math.max(base + boosts[residentialIndex], base), max);
        marginalGain += populationWithService - populationWithoutService;
      }

      return {
        ...normalizeServicePlacement(service),
        score: marginalGain * 1000 + coveredResidentials,
        marginalGain,
        coveredResidentials,
        serviceBonus,
      };
    })
    .sort((a, b) =>
      a.score - b.score
      || a.marginalGain - b.marginalGain
      || a.coveredResidentials - b.coveredResidentials
      || a.serviceBonus - b.serviceBonus
      || a.r - b.r
      || a.c - b.c
    )
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildResidentialOpportunityAnchors(
  params: SolverParams,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (!incumbent.residentials.length || limit <= 0) return [];

  return incumbent.residentials
    .map((residential, index) => {
      const typeIndex = incumbent.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
      const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
      const population = incumbent.populations[index] ?? base;
      const headroom = Math.max(0, max - population);
      const totalBoostCapacity = Math.max(1, max - base);
      return {
        ...residential,
        score: headroom * 1000 + Math.round((headroom / totalBoostCapacity) * 100),
        headroom,
        population,
      };
    })
    .filter((entry) => entry.headroom > 0)
    .sort((a, b) =>
      b.score - a.score
      || b.headroom - a.headroom
      || a.population - b.population
      || a.r - b.r
      || a.c - b.c
    )
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildFrontierCongestionAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (limit <= 0) return [];

  const occupied = buildOccupiedCellSet(incumbent);
  const candidates = new Map<string, RankedNeighborhoodAnchor>();

  for (const roadKey of incumbent.roads) {
    const { r, c } = cellFromKey(roadKey);
    if (!isAllowed(G, r, c)) continue;
    const neighbors = orthogonalNeighbors(G, r, c);
    let occupiedNeighbors = 0;
    let frontierNeighbors = 0;
    for (const [nr, nc] of neighbors) {
      const neighborKey = cellKey(nr, nc);
      if (!isAllowed(G, nr, nc)) continue;
      if (occupied.has(neighborKey)) {
        occupiedNeighbors += 1;
      } else if (!incumbent.roads.has(neighborKey)) {
        frontierNeighbors += 1;
      }
    }
    const score = occupiedNeighbors * 4 + frontierNeighbors;
    if (score <= 0) continue;
    candidates.set(`road:${roadKey}`, { r, c, rows: 1, cols: 1, score });
  }

  const H = height(G);
  const W = width(G);
  for (let r = 1; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isAllowed(G, r, c)) continue;
      const key = cellKey(r, c);
      if (occupied.has(key) || incumbent.roads.has(key)) continue;
      const neighbors = orthogonalNeighbors(G, r, c);
      let roadNeighbors = 0;
      let occupiedNeighbors = 0;
      for (const [nr, nc] of neighbors) {
        const neighborKey = cellKey(nr, nc);
        if (incumbent.roads.has(neighborKey)) roadNeighbors += 1;
        if (occupied.has(neighborKey)) occupiedNeighbors += 1;
      }
      if (roadNeighbors === 0 || occupiedNeighbors === 0) continue;
      candidates.set(`frontier:${key}`, {
        r,
        c,
        rows: 1,
        cols: 1,
        score: occupiedNeighbors * 3 + roadNeighbors * 2,
      });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function growNeighborhoodDimension(base: number, max: number, stageIndex: number, stageCount: number): number {
  if (max <= base) return Math.max(1, max);
  return Math.max(base, Math.min(max, base + Math.ceil(((max - base) * stageIndex) / Math.max(1, stageCount))));
}

function addEscalatedNeighborhoodWindows(
  windows: Map<string, CpSatNeighborhoodWindow>,
  G: Grid,
  focusedAnchors: NeighborhoodAnchor[],
  weakResidentials: NeighborhoodAnchor[],
  options: LnsNeighborhoodOptions,
  stagnantIterations: number
): void {
  const H = height(G);
  const W = width(G);
  const repairRowStart = H > 1 ? 1 : 0;
  const repairableRows = H - repairRowStart;
  if (repairableRows <= 0 || W <= 0) return;

  const trigger = getLargeNeighborhoodTrigger(options);
  if (stagnantIterations < trigger) return;

  const stageCount = Math.max(1, options.maxNoImprovementIterations - trigger + 1);
  const stageIndex = Math.min(stageCount, stagnantIterations - trigger + 1);
  const expandedRows = growNeighborhoodDimension(options.neighborhoodRows, repairableRows, stageIndex, stageCount);
  const expandedCols = growNeighborhoodDimension(options.neighborhoodCols, W, stageIndex, stageCount);
  const verticalBandCols = Math.max(
    expandedCols,
    Math.min(W, Math.max(options.neighborhoodCols * 2, Math.ceil(W * 0.6)))
  );
  const horizontalBandRows = Math.max(
    expandedRows,
    Math.min(repairableRows, Math.max(options.neighborhoodRows * 2, Math.ceil(repairableRows * 0.6)))
  );
  const topBandRows = Math.min(H, horizontalBandRows + repairRowStart);

  const verticalStride = Math.max(1, Math.floor(verticalBandCols / 2));
  for (let left = 0; left <= W - verticalBandCols; left += verticalStride) {
    addWindow(windows, { top: repairRowStart, left, rows: repairableRows, cols: verticalBandCols });
  }
  addWindow(windows, {
    top: repairRowStart,
    left: Math.max(0, W - verticalBandCols),
    rows: repairableRows,
    cols: verticalBandCols,
  });
  addRowZeroRepairWindows(windows, G, topBandRows, verticalBandCols);

  const horizontalStride = Math.max(1, Math.floor(horizontalBandRows / 2));
  for (let top = repairRowStart; top <= H - horizontalBandRows; top += horizontalStride) {
    addWindow(windows, { top, left: 0, rows: horizontalBandRows, cols: W });
  }
  addWindow(windows, { top: Math.max(repairRowStart, H - horizontalBandRows), left: 0, rows: horizontalBandRows, cols: W });

  const escalatedAnchors = [...focusedAnchors, ...weakResidentials].slice(0, Math.max(4, stageIndex * 3));
  addClampedWindowsForAnchors(windows, G, escalatedAnchors, [
    { rows: expandedRows, cols: expandedCols },
    { rows: repairableRows, cols: verticalBandCols },
    { rows: horizontalBandRows, cols: W },
  ]);

  if (stageIndex >= stageCount) {
    addWindow(windows, { top: repairRowStart, left: 0, rows: repairableRows, cols: W });
    addWindow(windows, { top: 0, left: 0, rows: topBandRows, cols: W });
  }
}

export function selectNeighborhoodWindow(
  windows: CpSatNeighborhoodWindow[],
  iteration: number,
  stagnantIterations: number,
  options: Pick<LnsNeighborhoodOptions, "maxNoImprovementIterations">
): CpSatNeighborhoodWindow {
  const repairAttempt = stagnantIterations + 1;
  if (repairAttempt >= options.maxNoImprovementIterations) {
    return windows.reduce((best, candidate) => {
      const bestArea = best.rows * best.cols;
      const candidateArea = candidate.rows * candidate.cols;
      if (candidateArea !== bestArea) return candidateArea > bestArea ? candidate : best;
      if (candidate.rows !== best.rows) return candidate.rows > best.rows ? candidate : best;
      if (candidate.cols !== best.cols) return candidate.cols > best.cols ? candidate : best;
      if (candidate.top !== best.top) return candidate.top < best.top ? candidate : best;
      if (candidate.left !== best.left) return candidate.left < best.left ? candidate : best;
      return best;
    });
  }

  const largeNeighborhoodTrigger = getLargeNeighborhoodTrigger(options);
  const neighborhoodIndex = repairAttempt >= largeNeighborhoodTrigger
    ? (repairAttempt - largeNeighborhoodTrigger) % windows.length
    : iteration % windows.length;
  return windows[neighborhoodIndex];
}

export function buildNeighborhoodWindows(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: LnsNeighborhoodOptions,
  stagnantIterations = 0
): CpSatNeighborhoodWindow[] {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  const focusedAnchorLimit = Math.max(3, options.maxNoImprovementIterations * 2);

  const weakResidentials = incumbent.residentials
    .map((residential, index) => ({
      ...residential,
      population: incumbent.populations[index] ?? 0,
    }))
    .sort((a, b) => a.population - b.population);

  const focusedAnchors = interleaveAnchors([
    buildWeakServiceAnchors(G, params, incumbent, focusedAnchorLimit),
    buildResidentialOpportunityAnchors(params, incumbent, focusedAnchorLimit),
    buildFrontierCongestionAnchors(G, incumbent, focusedAnchorLimit),
  ]);

  addEscalatedNeighborhoodWindows(windows, G, focusedAnchors, weakResidentials, options, stagnantIterations);

  addClampedWindowsForAnchors(windows, G, focusedAnchors, [
    { rows: options.neighborhoodRows, cols: options.neighborhoodCols },
  ]);
  addClampedWindowsForAnchors(
    windows,
    G,
    incumbent.services.map((service) => normalizeServicePlacement(service)),
    [{ rows: options.neighborhoodRows, cols: options.neighborhoodCols }]
  );
  addClampedWindowsForAnchors(windows, G, weakResidentials, [
    { rows: options.neighborhoodRows, cols: options.neighborhoodCols },
  ]);

  addSlidingNeighborhoodWindows(windows, G, options.neighborhoodRows, options.neighborhoodCols);

  return [...windows.values()];
}
