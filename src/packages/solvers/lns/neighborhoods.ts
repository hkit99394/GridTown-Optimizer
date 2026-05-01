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
} from "../../core/index.js";
import type {
  CpSatNeighborhoodWindow,
  Grid,
  LnsAdaptiveOperatorName,
  LnsOperatorWeight,
  LnsNeighborhoodAnchorPolicy,
  Solution,
  SolverParams,
} from "../../core/index.js";
import { cellFromKey, cellKey } from "../../core/index.js";

export interface NeighborhoodAnchor {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

export interface LnsAdaptiveNeighborhoodCandidate {
  operator: LnsAdaptiveOperatorName;
  window: CpSatNeighborhoodWindow;
  score: number;
}

interface RankedNeighborhoodAnchor extends NeighborhoodAnchor {
  score: number;
}

interface OperatorNeighborhoodAnchor extends NeighborhoodAnchor {
  operator: LnsAdaptiveOperatorName;
}

export interface LnsNeighborhoodOptions {
  maxNoImprovementIterations: number;
  neighborhoodRows: number;
  neighborhoodCols: number;
  neighborhoodAnchorPolicy?: LnsNeighborhoodAnchorPolicy;
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
  dedupe.set(windowKey(window), window);
}

function windowKey(window: CpSatNeighborhoodWindow): string {
  return `${window.top}:${window.left}:${window.rows}:${window.cols}`;
}

function addCandidate(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  operator: LnsAdaptiveOperatorName,
  window: CpSatNeighborhoodWindow | null,
  score: number
): void {
  if (!window) return;
  candidates.set(`${operator}:${windowKey(window)}`, { operator, window, score });
}

function addCandidateWindowsFromMap(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  operator: LnsAdaptiveOperatorName,
  windows: Map<string, CpSatNeighborhoodWindow>,
  scoreBase: number
): void {
  let index = 0;
  for (const window of windows.values()) {
    addCandidate(candidates, operator, window, scoreBase - index);
    index += 1;
  }
}

function addRoadAnchorRepairWindows(
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

function addClampedCandidateWindowsForAnchors<T extends NeighborhoodAnchor>(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  operator: LnsAdaptiveOperatorName,
  G: Grid,
  anchors: readonly T[],
  windowSizes: readonly { rows: number; cols: number }[],
  scoreBase: number
): void {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  addClampedWindowsForAnchors(windows, G, anchors, windowSizes);
  addCandidateWindowsFromMap(candidates, operator, windows, scoreBase);
}

function addClampedCandidateWindowsForOperatorAnchors(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  G: Grid,
  anchors: readonly OperatorNeighborhoodAnchor[],
  windowSizes: readonly { rows: number; cols: number }[],
  scoreBase: number
): void {
  for (const { rows, cols } of windowSizes) {
    let score = scoreBase;
    for (const anchor of anchors) {
      addCandidate(candidates, anchor.operator, clampNeighborhoodWindow(G, anchor, rows, cols), score);
      score -= 1;
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

  addRoadAnchorRepairWindows(windows, G, rows + rowStart, cols);
}

function addSlidingNeighborhoodCandidates(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  G: Grid,
  neighborhoodRows: number,
  neighborhoodCols: number
): void {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  addSlidingNeighborhoodWindows(windows, G, neighborhoodRows, neighborhoodCols);
  addCandidateWindowsFromMap(candidates, "sliding", windows, 1000);
}

function interleaveAnchors<T extends NeighborhoodAnchor>(anchorGroups: readonly (readonly T[])[]): T[] {
  const interleaved: T[] = [];
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

function buildGateChokeAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (limit <= 0) return [];

  const occupied = buildOccupiedCellSet(incumbent);
  const candidates: RankedNeighborhoodAnchor[] = [];

  for (const roadKey of incumbent.roads) {
    const { r, c } = cellFromKey(roadKey);
    if (!isAllowed(G, r, c)) continue;
    const neighbors = orthogonalNeighbors(G, r, c);
    let roadNeighbors = 0;
    let occupiedNeighbors = 0;
    let frontierNeighbors = 0;

    for (const [nr, nc] of neighbors) {
      const neighborKey = cellKey(nr, nc);
      if (!isAllowed(G, nr, nc)) continue;
      if (incumbent.roads.has(neighborKey)) {
        roadNeighbors += 1;
      } else if (occupied.has(neighborKey)) {
        occupiedNeighbors += 1;
      } else {
        frontierNeighbors += 1;
      }
    }

    const isBoundaryGate = r === 0 || c === 0;
    const isNarrowRoad = roadNeighbors <= 2;
    if (!isBoundaryGate && (!isNarrowRoad || occupiedNeighbors + frontierNeighbors === 0)) continue;

    candidates.push({
      r,
      c,
      rows: 1,
      cols: 1,
      score: (isBoundaryGate ? 6 : 0) + (2 - Math.min(2, roadNeighbors)) * 4 + occupiedNeighbors * 3 + frontierNeighbors,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildServiceOverlapAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  if (incumbent.services.length < 2 || limit <= 0) return [];

  const serviceEffectZones = incumbent.services.map((service) => new Set(serviceEffectZone(G, service)));
  const residentialFootprints = incumbent.residentials.map((residential) =>
    residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)
  );

  return incumbent.services
    .map((service, serviceIndex) => {
      const effectZone = serviceEffectZones[serviceIndex];
      let sharedResidentials = 0;
      let serviceZoneOverlap = 0;

      for (const footprint of residentialFootprints) {
        if (!footprint.some((cell) => effectZone.has(cell))) continue;
        if (serviceEffectZones.some((otherZone, otherIndex) =>
          otherIndex !== serviceIndex && footprint.some((cell) => otherZone.has(cell))
        )) {
          sharedResidentials += 1;
        }
      }

      for (let otherIndex = 0; otherIndex < serviceEffectZones.length; otherIndex++) {
        if (otherIndex === serviceIndex) continue;
        let overlap = 0;
        for (const cell of effectZone) {
          if (serviceEffectZones[otherIndex].has(cell)) overlap += 1;
        }
        serviceZoneOverlap += overlap;
      }

      return {
        ...normalizeServicePlacement(service),
        score: sharedResidentials * 1000 + serviceZoneOverlap,
        sharedResidentials,
        serviceZoneOverlap,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score
      || b.sharedResidentials - a.sharedResidentials
      || b.serviceZoneOverlap - a.serviceZoneOverlap
      || a.r - b.r
      || a.c - b.c
    )
    .slice(0, limit)
    .map(({ r, c, rows, cols }) => ({ r, c, rows, cols }));
}

function buildRandomExplorationAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): NeighborhoodAnchor[] {
  const H = height(G);
  const W = width(G);
  const repairRowStart = H > 1 ? 1 : 0;
  const repairableRows = H - repairRowStart;
  if (limit <= 0 || repairableRows <= 0 || W <= 0) return [];

  let seed = (
    Math.imul(H + 1, 73856093)
    ^ Math.imul(W + 1, 19349663)
    ^ Math.imul((incumbent.totalPopulation ?? 0) + 1, 83492791)
    ^ Math.imul(incumbent.roads.size + 1, 265443576)
    ^ Math.imul(incumbent.services.length + incumbent.residentials.length + 1, 97531)
  ) >>> 0;

  const anchors: NeighborhoodAnchor[] = [];
  for (let index = 0; index < limit; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const r = repairRowStart + (seed % repairableRows);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const c = seed % W;
    anchors.push({ r, c, rows: 1, cols: 1 });
  }
  return anchors;
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
  addRoadAnchorRepairWindows(windows, G, topBandRows, verticalBandCols);

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

function addEscalatedNeighborhoodCandidates(
  candidates: Map<string, LnsAdaptiveNeighborhoodCandidate>,
  G: Grid,
  focusedAnchors: NeighborhoodAnchor[],
  weakResidentials: NeighborhoodAnchor[],
  options: LnsNeighborhoodOptions,
  stagnantIterations: number
): void {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  addEscalatedNeighborhoodWindows(windows, G, focusedAnchors, weakResidentials, options, stagnantIterations);
  addCandidateWindowsFromMap(candidates, "random-exploration", windows, 2000);
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

function getOperatorWeight(
  operatorWeights: readonly LnsOperatorWeight[] | undefined,
  operator: LnsAdaptiveOperatorName
): number {
  return operatorWeights?.find((entry) => entry.operator === operator)?.weight ?? 1;
}

export function selectAdaptiveNeighborhoodOperator(
  candidates: LnsAdaptiveNeighborhoodCandidate[],
  iteration: number,
  stagnantIterations: number,
  options: Pick<LnsNeighborhoodOptions, "maxNoImprovementIterations">,
  operatorWeights?: readonly LnsOperatorWeight[]
): LnsAdaptiveNeighborhoodCandidate {
  const repairAttempt = stagnantIterations + 1;
  if (repairAttempt >= options.maxNoImprovementIterations) {
    return candidates.reduce((best, candidate) => {
      const bestArea = best.window.rows * best.window.cols;
      const candidateArea = candidate.window.rows * candidate.window.cols;
      if (candidateArea !== bestArea) return candidateArea > bestArea ? candidate : best;
      if (candidate.window.rows !== best.window.rows) return candidate.window.rows > best.window.rows ? candidate : best;
      if (candidate.window.cols !== best.window.cols) return candidate.window.cols > best.window.cols ? candidate : best;
      if (candidate.window.top !== best.window.top) return candidate.window.top < best.window.top ? candidate : best;
      if (candidate.window.left !== best.window.left) return candidate.window.left < best.window.left ? candidate : best;
      return best;
    });
  }

  const rankedCandidates = candidates
    .map((candidate, index) => ({ candidate, index, weight: getOperatorWeight(operatorWeights, candidate.operator) }))
    .sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);

  const largeNeighborhoodTrigger = getLargeNeighborhoodTrigger(options);
  const neighborhoodIndex = repairAttempt >= largeNeighborhoodTrigger
    ? (repairAttempt - largeNeighborhoodTrigger) % rankedCandidates.length
    : iteration % rankedCandidates.length;
  return rankedCandidates[neighborhoodIndex];
}

function operatorAnchors(
  operator: LnsAdaptiveOperatorName,
  anchors: readonly NeighborhoodAnchor[]
): OperatorNeighborhoodAnchor[] {
  return anchors.map((anchor) => ({ ...anchor, operator }));
}

function dedupeWindows(candidates: readonly LnsAdaptiveNeighborhoodCandidate[]): CpSatNeighborhoodWindow[] {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  for (const candidate of candidates) {
    const key = windowKey(candidate.window);
    if (!windows.has(key)) windows.set(key, candidate.window);
  }
  return [...windows.values()];
}

export function buildAdaptiveNeighborhoodCandidates(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: LnsNeighborhoodOptions,
  stagnantIterations = 0
): LnsAdaptiveNeighborhoodCandidate[] {
  const candidates = new Map<string, LnsAdaptiveNeighborhoodCandidate>();
  const focusedAnchorLimit = Math.max(3, options.maxNoImprovementIterations * 2);
  const anchorPolicy = options.neighborhoodAnchorPolicy ?? "ranked";

  const weakResidentials = incumbent.residentials
    .map((residential, index) => ({
      ...residential,
      population: incumbent.populations[index] ?? 0,
    }))
    .sort((a, b) => a.population - b.population);

  const weakServiceAnchors = buildWeakServiceAnchors(G, params, incumbent, focusedAnchorLimit);
  const residentialOpportunityAnchors = buildResidentialOpportunityAnchors(params, incumbent, focusedAnchorLimit);
  const frontierCongestionAnchors = buildFrontierCongestionAnchors(G, incumbent, focusedAnchorLimit);
  const gateChokeAnchors = buildGateChokeAnchors(G, incumbent, focusedAnchorLimit);
  const serviceOverlapAnchors = buildServiceOverlapAnchors(G, incumbent, focusedAnchorLimit);
  const randomExplorationAnchors = buildRandomExplorationAnchors(G, incumbent, Math.max(2, focusedAnchorLimit));
  const focusedAnchors = anchorPolicy === "ranked"
    ? interleaveAnchors([
      weakServiceAnchors,
      residentialOpportunityAnchors,
      frontierCongestionAnchors,
      gateChokeAnchors,
      serviceOverlapAnchors,
    ])
    : anchorPolicy === "weak-service-first"
      ? weakServiceAnchors
      : anchorPolicy === "residential-opportunity-first"
        ? residentialOpportunityAnchors
        : anchorPolicy === "frontier-congestion-first"
          ? frontierCongestionAnchors
          : [];
  const focusedOperatorAnchors = anchorPolicy === "ranked"
    ? interleaveAnchors([
      operatorAnchors("weak-service", weakServiceAnchors),
      operatorAnchors("residential-headroom", residentialOpportunityAnchors),
      operatorAnchors("frontier-congestion", frontierCongestionAnchors),
      operatorAnchors("gate-choke", gateChokeAnchors),
      operatorAnchors("service-overlap", serviceOverlapAnchors),
    ])
    : anchorPolicy === "weak-service-first"
      ? operatorAnchors("weak-service", weakServiceAnchors)
      : anchorPolicy === "residential-opportunity-first"
        ? operatorAnchors("residential-headroom", residentialOpportunityAnchors)
        : anchorPolicy === "frontier-congestion-first"
          ? operatorAnchors("frontier-congestion", frontierCongestionAnchors)
          : [];

  addEscalatedNeighborhoodCandidates(candidates, G, focusedAnchors, weakResidentials, options, stagnantIterations);

  addClampedCandidateWindowsForOperatorAnchors(candidates, G, focusedOperatorAnchors, [
    { rows: options.neighborhoodRows, cols: options.neighborhoodCols },
  ], 1500);
  if (anchorPolicy === "ranked" || anchorPolicy === "placed-buildings-first") {
    addClampedCandidateWindowsForAnchors(
      candidates,
      "placed-buildings",
      G,
      incumbent.services.map((service) => normalizeServicePlacement(service)),
      [{ rows: options.neighborhoodRows, cols: options.neighborhoodCols }],
      900
    );
    addClampedCandidateWindowsForAnchors(candidates, "placed-buildings", G, weakResidentials, [
      { rows: options.neighborhoodRows, cols: options.neighborhoodCols },
    ], 850);
  }
  if (anchorPolicy === "ranked") {
    addClampedCandidateWindowsForAnchors(candidates, "random-exploration", G, randomExplorationAnchors, [
      { rows: options.neighborhoodRows, cols: options.neighborhoodCols },
    ], 750);
  }

  addSlidingNeighborhoodCandidates(candidates, G, options.neighborhoodRows, options.neighborhoodCols);

  return [...candidates.values()];
}

export function buildNeighborhoodWindows(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: LnsNeighborhoodOptions,
  stagnantIterations = 0
): CpSatNeighborhoodWindow[] {
  return dedupeWindows(buildAdaptiveNeighborhoodCandidates(G, params, incumbent, options, stagnantIterations));
}
