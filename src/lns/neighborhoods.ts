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
import type {
  CpSatNeighborhoodWindow,
  Grid,
  LnsNeighborhoodAnchorPolicy,
  LnsOperatorSelectionPolicy,
  LnsRepairOperatorName,
  Solution,
  SolverParams,
} from "../core/index.js";
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

interface LnsNeighborhoodBuildContext {
  G: Grid;
  params: SolverParams;
  incumbent: Solution;
  options: LnsNeighborhoodOptions;
  focusedAnchorLimit: number;
  stagnantIterations: number;
}

export interface LnsNeighborhoodCandidate {
  window: CpSatNeighborhoodWindow;
  operatorName: LnsRepairOperatorName;
  score: number;
  exploration: boolean;
}

export interface LnsRepairOperator {
  name: LnsRepairOperatorName;
  description: string;
  exploration: boolean;
  buildAnchors: (context: LnsNeighborhoodBuildContext) => NeighborhoodAnchor[];
}

export interface LnsNeighborhoodOptions {
  maxNoImprovementIterations: number;
  neighborhoodRows: number;
  neighborhoodCols: number;
  neighborhoodAnchorPolicy?: LnsNeighborhoodAnchorPolicy;
  operatorSelectionPolicy?: LnsOperatorSelectionPolicy;
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

function windowKey(window: CpSatNeighborhoodWindow): string {
  return `${window.top}:${window.left}:${window.rows}:${window.cols}`;
}

function addCandidate(
  dedupe: Map<string, LnsNeighborhoodCandidate>,
  candidate: LnsNeighborhoodCandidate | null
): void {
  if (!candidate) return;
  const key = `${candidate.operatorName}:${windowKey(candidate.window)}`;
  const existing = dedupe.get(key);
  if (!existing || candidate.score > existing.score) {
    dedupe.set(key, candidate);
  }
}

function addCandidateForWindow(
  dedupe: Map<string, LnsNeighborhoodCandidate>,
  operatorName: LnsRepairOperatorName,
  window: CpSatNeighborhoodWindow | null,
  score: number,
  exploration = false
): void {
  if (!window) return;
  addCandidate(dedupe, {
    window,
    operatorName,
    score,
    exploration,
  });
}

function addCandidatesForAnchors<T extends NeighborhoodAnchor>(
  candidates: Map<string, LnsNeighborhoodCandidate>,
  G: Grid,
  operatorName: LnsRepairOperatorName,
  anchors: readonly T[],
  windowSizes: readonly { rows: number; cols: number }[],
  scoreBase: number,
  exploration = false
): void {
  for (const { rows, cols } of windowSizes) {
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index]!;
      addCandidateForWindow(
        candidates,
        operatorName,
        clampNeighborhoodWindow(G, anchor, rows, cols),
        scoreBase + Math.max(0, anchors.length - index),
        exploration
      );
    }
  }
}

function addWindowsAsCandidates(
  candidates: Map<string, LnsNeighborhoodCandidate>,
  operatorName: LnsRepairOperatorName,
  windows: Iterable<CpSatNeighborhoodWindow>,
  scoreBase: number,
  exploration = false
): void {
  let index = 0;
  for (const window of windows) {
    addCandidateForWindow(
      candidates,
      operatorName,
      window,
      scoreBase + Math.max(0, 1000 - index),
      exploration
    );
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
): RankedNeighborhoodAnchor[] {
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
    .map(({ r, c, rows, cols, score }) => ({ r, c, rows, cols, score }));
}

function buildResidentialHeadroomClusterAnchors(
  params: SolverParams,
  incumbent: Solution,
  limit: number
): RankedNeighborhoodAnchor[] {
  if (!incumbent.residentials.length || limit <= 0) return [];

  const ranked = incumbent.residentials
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
    .slice(0, limit);

  const individualLimit = Math.min(ranked.length, Math.max(1, Math.ceil(limit * 0.6)));
  const anchors: RankedNeighborhoodAnchor[] = ranked
    .slice(0, individualLimit)
    .map(({ r, c, rows, cols, score }) => ({ r, c, rows, cols, score }));
  for (let leftIndex = 0; leftIndex < ranked.length && anchors.length < limit; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < ranked.length && anchors.length < limit; rightIndex++) {
      const left = ranked[leftIndex]!;
      const right = ranked[rightIndex]!;
      const top = Math.min(left.r, right.r);
      const leftCol = Math.min(left.c, right.c);
      const bottom = Math.max(left.r + left.rows, right.r + right.rows);
      const rightCol = Math.max(left.c + left.cols, right.c + right.cols);
      const score = left.score + right.score + Math.max(0, left.headroom + right.headroom);
      anchors.push({ r: top, c: leftCol, rows: bottom - top, cols: rightCol - leftCol, score });
    }
  }
  for (let index = individualLimit; index < ranked.length && anchors.length < limit; index++) {
    const { r, c, rows, cols, score } = ranked[index]!;
    anchors.push({ r, c, rows, cols, score });
  }

  return anchors.slice(0, limit);
}

function buildFrontierCongestionAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): RankedNeighborhoodAnchor[] {
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
    .map(({ r, c, rows, cols, score }) => ({ r, c, rows, cols, score }));
}

function buildGateChokeAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): RankedNeighborhoodAnchor[] {
  if (limit <= 0) return [];

  const occupied = buildOccupiedCellSet(incumbent);
  const candidates = new Map<string, RankedNeighborhoodAnchor>();
  const H = height(G);
  const W = width(G);
  for (let r = 1; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isAllowed(G, r, c)) continue;
      const key = cellKey(r, c);
      const neighbors = orthogonalNeighbors(G, r, c);
      let allowedNeighbors = 0;
      let blockedNeighbors = 0;
      let roadNeighbors = 0;
      let occupiedNeighbors = 0;
      for (const [nr, nc] of neighbors) {
        const neighborAllowed = isAllowed(G, nr, nc);
        if (neighborAllowed) allowedNeighbors += 1;
        if (!neighborAllowed) blockedNeighbors += 1;
        const neighborKey = cellKey(nr, nc);
        if (incumbent.roads.has(neighborKey)) roadNeighbors += 1;
        if (occupied.has(neighborKey)) occupiedNeighbors += 1;
      }
      if (blockedNeighbors === 0) continue;
      if (allowedNeighbors > 2 && roadNeighbors === 0 && occupiedNeighbors === 0) continue;
      const score = blockedNeighbors * 12
        + Math.max(0, 3 - allowedNeighbors) * 8
        + roadNeighbors * 5
        + occupiedNeighbors * 3
        + (incumbent.roads.has(key) ? 2 : 0);
      candidates.set(key, { r, c, rows: 1, cols: 1, score });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
    .slice(0, limit);
}

function buildServiceOverlapAnchors(
  G: Grid,
  incumbent: Solution,
  limit: number
): RankedNeighborhoodAnchor[] {
  if (incumbent.services.length < 2 || limit <= 0) return [];

  const serviceZones = incumbent.services.map((service) => new Set(serviceEffectZone(G, service)));
  const candidates: RankedNeighborhoodAnchor[] = [];
  for (let leftIndex = 0; leftIndex < incumbent.services.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < incumbent.services.length; rightIndex++) {
      const leftZone = serviceZones[leftIndex]!;
      const rightZone = serviceZones[rightIndex]!;
      const overlapCells: Array<{ r: number; c: number }> = [];
      for (const key of leftZone) {
        if (rightZone.has(key)) overlapCells.push(cellFromKey(key));
      }
      if (overlapCells.length === 0) continue;

      const leftService = normalizeServicePlacement(incumbent.services[leftIndex]!);
      const rightService = normalizeServicePlacement(incumbent.services[rightIndex]!);
      const top = Math.min(leftService.r, rightService.r, ...overlapCells.map((cell) => cell.r));
      const left = Math.min(leftService.c, rightService.c, ...overlapCells.map((cell) => cell.c));
      const bottom = Math.max(
        leftService.r + leftService.rows,
        rightService.r + rightService.rows,
        ...overlapCells.map((cell) => cell.r + 1)
      );
      const right = Math.max(
        leftService.c + leftService.cols,
        rightService.c + rightService.cols,
        ...overlapCells.map((cell) => cell.c + 1)
      );
      const score = overlapCells.length * 100
        + (incumbent.servicePopulationIncreases[leftIndex] ?? 0)
        + (incumbent.servicePopulationIncreases[rightIndex] ?? 0);
      candidates.push({ r: top, c: left, rows: bottom - top, cols: right - left, score });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
    .slice(0, limit);
}

function nextDeterministicRandom(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function buildRandomExplorationWindows(
  G: Grid,
  options: LnsNeighborhoodOptions,
  stagnantIterations: number,
  limit: number
): CpSatNeighborhoodWindow[] {
  const H = height(G);
  const W = width(G);
  const repairRowStart = H > 1 ? 1 : 0;
  const repairableRows = H - repairRowStart;
  if (repairableRows <= 0 || W <= 0 || limit <= 0) return [];

  const rows = Math.max(1, Math.min(options.neighborhoodRows, repairableRows));
  const cols = Math.max(1, Math.min(options.neighborhoodCols, W));
  const maxTopOffset = Math.max(0, repairableRows - rows);
  const maxLeft = Math.max(0, W - cols);
  let seed = (
    Math.imul(H + 17, 73856093)
    ^ Math.imul(W + 31, 19349663)
    ^ Math.imul(rows + 43, 83492791)
    ^ Math.imul(cols + 59, 2654435761)
    ^ Math.imul(stagnantIterations + 71, 97531)
  ) >>> 0;

  const windows = new Map<string, CpSatNeighborhoodWindow>();
  for (let index = 0; index < limit * 4 && windows.size < limit; index++) {
    seed = nextDeterministicRandom(seed);
    const top = repairRowStart + (maxTopOffset === 0 ? 0 : seed % (maxTopOffset + 1));
    seed = nextDeterministicRandom(seed);
    const left = maxLeft === 0 ? 0 : seed % (maxLeft + 1);
    const window = { top, left, rows, cols };
    windows.set(windowKey(window), window);
  }

  return [...windows.values()];
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

export const LNS_REPAIR_OPERATORS: readonly LnsRepairOperator[] = Object.freeze([
  {
    name: "weak-service-repair",
    description: "Repair around incumbent services whose marginal residential boost is weakest.",
    exploration: false,
    buildAnchors: ({ G, params, incumbent, focusedAnchorLimit }) =>
      buildWeakServiceAnchors(G, params, incumbent, focusedAnchorLimit),
  },
  {
    name: "residential-headroom-repair",
    description: "Repair around high-headroom residential clusters that can still benefit from better service coverage.",
    exploration: false,
    buildAnchors: ({ params, incumbent, focusedAnchorLimit }) =>
      buildResidentialHeadroomClusterAnchors(params, incumbent, focusedAnchorLimit),
  },
  {
    name: "frontier-congestion-repair",
    description: "Repair crowded road frontiers where roads, empty buildable cells, and buildings meet.",
    exploration: false,
    buildAnchors: ({ G, incumbent, focusedAnchorLimit }) =>
      buildFrontierCongestionAnchors(G, incumbent, focusedAnchorLimit),
  },
  {
    name: "gate-choke-repair",
    description: "Repair narrow passable gates and obstacle chokes that can block road access.",
    exploration: false,
    buildAnchors: ({ G, incumbent, focusedAnchorLimit }) =>
      buildGateChokeAnchors(G, incumbent, focusedAnchorLimit),
  },
  {
    name: "service-overlap-repair",
    description: "Repair around overlapping service influence zones and their nearby buildings.",
    exploration: false,
    buildAnchors: ({ G, incumbent, focusedAnchorLimit }) =>
      buildServiceOverlapAnchors(G, incumbent, focusedAnchorLimit),
  },
]);

function selectOperatorsForPolicy(
  anchorPolicy: LnsNeighborhoodAnchorPolicy
): readonly LnsRepairOperator[] {
  if (anchorPolicy === "sliding-only" || anchorPolicy === "placed-buildings-first") return [];
  if (anchorPolicy === "weak-service-first") {
    return LNS_REPAIR_OPERATORS.filter((operator) => operator.name === "weak-service-repair");
  }
  if (anchorPolicy === "residential-opportunity-first") {
    return LNS_REPAIR_OPERATORS.filter((operator) => operator.name === "residential-headroom-repair");
  }
  if (anchorPolicy === "frontier-congestion-first") {
    return LNS_REPAIR_OPERATORS.filter((operator) => operator.name === "frontier-congestion-repair");
  }
  return LNS_REPAIR_OPERATORS;
}

export function buildNeighborhoodCandidates(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: LnsNeighborhoodOptions,
  stagnantIterations = 0
): LnsNeighborhoodCandidate[] {
  const candidates = new Map<string, LnsNeighborhoodCandidate>();
  const focusedAnchorLimit = Math.max(3, options.maxNoImprovementIterations * 2);
  const anchorPolicy = options.neighborhoodAnchorPolicy ?? "ranked";

  const weakResidentials = incumbent.residentials
    .map((residential, index) => ({
      ...residential,
      population: incumbent.populations[index] ?? 0,
    }))
    .sort((a, b) => a.population - b.population);

  const context: LnsNeighborhoodBuildContext = {
    G,
    params,
    incumbent,
    options,
    focusedAnchorLimit,
    stagnantIterations,
  };
  const operatorAnchorGroups = selectOperatorsForPolicy(anchorPolicy).map((operator) => ({
    operator,
    anchors: operator.buildAnchors(context),
  }));
  const hasSemanticAnchors = operatorAnchorGroups.some((entry) => entry.anchors.length > 0);
  const focusedAnchors = anchorPolicy === "ranked"
    ? interleaveAnchors(operatorAnchorGroups.map((entry) => [...entry.anchors]))
    : operatorAnchorGroups[0]?.anchors ?? [];

  const escalatedWindows = new Map<string, CpSatNeighborhoodWindow>();
  addEscalatedNeighborhoodWindows(escalatedWindows, G, focusedAnchors, weakResidentials, options, stagnantIterations);
  addWindowsAsCandidates(
    candidates,
    hasSemanticAnchors ? "gate-choke-repair" : "sliding-window",
    escalatedWindows.values(),
    900_000 + stagnantIterations * 1000
  );

  for (let operatorIndex = 0; operatorIndex < operatorAnchorGroups.length; operatorIndex++) {
    const { operator, anchors } = operatorAnchorGroups[operatorIndex]!;
    addCandidatesForAnchors(
      candidates,
      G,
      operator.name,
      anchors,
      [{ rows: options.neighborhoodRows, cols: options.neighborhoodCols }],
      800_000 - operatorIndex * 10_000
    );
  }

  if (anchorPolicy === "ranked" || anchorPolicy === "placed-buildings-first") {
    addCandidatesForAnchors(
      candidates,
      G,
      "sliding-window",
      incumbent.services.map((service) => normalizeServicePlacement(service)),
      [{ rows: options.neighborhoodRows, cols: options.neighborhoodCols }],
      150_000
    );
    addCandidatesForAnchors(
      candidates,
      G,
      "sliding-window",
      weakResidentials,
      [{ rows: options.neighborhoodRows, cols: options.neighborhoodCols }],
      125_000
    );
  }

  if (options.operatorSelectionPolicy === "adaptive" && hasSemanticAnchors) {
    const randomWindows = buildRandomExplorationWindows(
      G,
      options,
      stagnantIterations,
      Math.max(2, Math.min(12, options.maxNoImprovementIterations * 2))
    );
    addWindowsAsCandidates(candidates, "random-exploration", randomWindows, 50_000, true);
  }

  const slidingWindows = new Map<string, CpSatNeighborhoodWindow>();
  addSlidingNeighborhoodWindows(slidingWindows, G, options.neighborhoodRows, options.neighborhoodCols);
  addWindowsAsCandidates(candidates, "sliding-window", slidingWindows.values(), 25_000);

  return [...candidates.values()];
}

export function buildNeighborhoodWindows(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  options: LnsNeighborhoodOptions,
  stagnantIterations = 0
): CpSatNeighborhoodWindow[] {
  const windows = new Map<string, CpSatNeighborhoodWindow>();
  for (const candidate of buildNeighborhoodCandidates(G, params, incumbent, options, stagnantIterations)) {
    const key = windowKey(candidate.window);
    if (!windows.has(key)) windows.set(key, candidate.window);
  }
  return [...windows.values()];
}
