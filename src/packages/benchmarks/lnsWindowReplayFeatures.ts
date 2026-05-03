import {
  cellKey,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  getResidentialBaseMax,
  height,
  isAllowed,
  normalizeServicePlacement,
  orthogonalNeighbors,
  residentialFootprint,
  serviceFootprint,
  width
} from "../core/index.js";
import { LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION } from "./lnsWindowReplayTypes.js";

import type { CpSatNeighborhoodWindow, Grid, Solution, SolverParams } from "../core/index.js";
import type { LnsAdaptiveNeighborhoodCandidate } from "../solvers/index.js";
import type { LnsWindowReplayCandidateLossFeatures, LnsWindowReplayFeatures } from "./lnsWindowReplayTypes.js";

function rectangleIntersectsWindow(
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  return (
    r < window.top + window.rows && r + rows > window.top && c < window.left + window.cols && c + cols > window.left
  );
}

function roadInsideWindow(window: CpSatNeighborhoodWindow, key: string): boolean {
  const [rRaw, cRaw] = key.split(",");
  const r = Number(rRaw);
  const c = Number(cRaw);
  return (
    Number.isInteger(r) &&
    Number.isInteger(c) &&
    r >= window.top &&
    r < window.top + window.rows &&
    c >= window.left &&
    c < window.left + window.cols
  );
}

function cellKeyInsideWindow(window: CpSatNeighborhoodWindow, key: string): boolean {
  return roadInsideWindow(window, key);
}

function placementFootprintKeys(placement: { r: number; c: number; rows: number; cols: number }): string[] {
  return residentialFootprint(placement.r, placement.c, placement.rows, placement.cols);
}

function incumbentBuildingFootprintKeys(incumbent: Solution): Set<string> {
  const occupied = new Set<string>();
  for (const service of incumbent.services) {
    for (const key of serviceFootprint(normalizeServicePlacement(service))) {
      occupied.add(key);
    }
  }
  for (const residential of incumbent.residentials) {
    for (const key of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      occupied.add(key);
    }
  }
  return occupied;
}

function clearWindowFootprintKeys(
  occupied: Set<string>,
  window: CpSatNeighborhoodWindow
): { occupied: Set<string>; clearedBuildingFootprintCells: number } {
  const next = new Set(occupied);
  let clearedBuildingFootprintCells = 0;
  for (const key of occupied) {
    if (!cellKeyInsideWindow(window, key)) continue;
    next.delete(key);
    clearedBuildingFootprintCells += 1;
  }
  return {
    occupied: next,
    clearedBuildingFootprintCells
  };
}

function isAllowedEmptyCell(G: Grid, occupied: Set<string>, r: number, c: number): boolean {
  return isAllowed(G, r, c) && !occupied.has(cellKey(r, c));
}

function countAllowedWindowCells(G: Grid, occupied: Set<string>, window: CpSatNeighborhoodWindow): number {
  let count = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (isAllowedEmptyCell(G, occupied, r, c)) count += 1;
    }
  }
  return count;
}

function countNarrowGateCells(G: Grid, occupied: Set<string>, window: CpSatNeighborhoodWindow): number {
  let count = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (!isAllowedEmptyCell(G, occupied, r, c)) continue;
      const degree = orthogonalNeighbors(G, r, c).filter(([rr, cc]) => isAllowedEmptyCell(G, occupied, rr, cc)).length;
      if (degree > 0 && degree <= 2) count += 1;
    }
  }
  return count;
}

interface EmptyGraphSummary {
  emptyCellCount: number;
  reachableKeys: Set<string>;
  reachableCount: number;
  disconnectedCount: number;
  componentCount: number;
}

function summarizeEmptyGraph(G: Grid, occupied: Set<string>): EmptyGraphSummary {
  const H = height(G);
  const W = width(G);
  const emptyKeys = new Set<string>();
  const roots: string[] = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isAllowedEmptyCell(G, occupied, r, c)) continue;
      const key = cellKey(r, c);
      emptyKeys.add(key);
      if (r === 0 || c === 0) roots.push(key);
    }
  }

  const reachableKeys = new Set<string>();
  const queue = [...roots];
  for (const key of roots) reachableKeys.add(key);
  for (let index = 0; index < queue.length; index++) {
    const [rRaw, cRaw] = queue[index]!.split(",");
    const r = Number(rRaw);
    const c = Number(cRaw);
    for (const [rr, cc] of orthogonalNeighbors(G, r, c)) {
      const neighborKey = cellKey(rr, cc);
      if (!emptyKeys.has(neighborKey) || reachableKeys.has(neighborKey)) continue;
      reachableKeys.add(neighborKey);
      queue.push(neighborKey);
    }
  }

  const seen = new Set<string>();
  let componentCount = 0;
  for (const key of emptyKeys) {
    if (seen.has(key)) continue;
    componentCount += 1;
    seen.add(key);
    const componentQueue = [key];
    for (let index = 0; index < componentQueue.length; index++) {
      const [rRaw, cRaw] = componentQueue[index]!.split(",");
      const r = Number(rRaw);
      const c = Number(cRaw);
      for (const [rr, cc] of orthogonalNeighbors(G, r, c)) {
        const neighborKey = cellKey(rr, cc);
        if (!emptyKeys.has(neighborKey) || seen.has(neighborKey)) continue;
        seen.add(neighborKey);
        componentQueue.push(neighborKey);
      }
    }
  }

  return {
    emptyCellCount: emptyKeys.size,
    reachableKeys,
    reachableCount: reachableKeys.size,
    disconnectedCount: emptyKeys.size - reachableKeys.size,
    componentCount
  };
}

function countReachableWindowCells(window: CpSatNeighborhoodWindow, reachableKeys: Set<string>): number {
  let count = 0;
  for (const key of reachableKeys) {
    if (cellKeyInsideWindow(window, key)) count += 1;
  }
  return count;
}

function incrementTypeCount(counts: Record<string, number>, typeIndex: number | undefined): void {
  const key = typeIndex === undefined ? "legacy" : String(typeIndex);
  counts[key] = (counts[key] ?? 0) + 1;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function candidateFootprintIsBlocked(footprintKeys: readonly string[], occupied: Set<string>): boolean {
  return footprintKeys.some((key) => occupied.has(key));
}

function buildCandidateLossFeatures(
  G: Grid,
  params: SolverParams,
  window: CpSatNeighborhoodWindow,
  occupied: Set<string>
): LnsWindowReplayCandidateLossFeatures {
  const serviceTypeCounts: Record<string, number> = {};
  const residentialTypeCounts: Record<string, number> = {};
  let serviceCandidatesIntersectingWindow = 0;
  let residentialCandidatesIntersectingWindow = 0;
  let serviceCandidatesBlockedByIncumbent = 0;
  let residentialCandidatesBlockedByIncumbent = 0;
  let serviceCandidateBonusInside = 0;
  let maxServiceCandidateBonusInside = 0;
  let residentialCandidateHeadroomInside = 0;

  for (const candidate of enumerateServiceCandidates(G, params)) {
    if (!rectangleIntersectsWindow(window, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
    serviceCandidatesIntersectingWindow += 1;
    incrementTypeCount(serviceTypeCounts, candidate.typeIndex);
    serviceCandidateBonusInside += candidate.bonus;
    maxServiceCandidateBonusInside = Math.max(maxServiceCandidateBonusInside, candidate.bonus);
    if (candidateFootprintIsBlocked(placementFootprintKeys(candidate), occupied)) {
      serviceCandidatesBlockedByIncumbent += 1;
    }
  }

  const residentialCandidates = params.residentialTypes?.length
    ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes)
    : enumerateResidentialCandidates(G);
  for (const candidate of residentialCandidates) {
    if (!rectangleIntersectsWindow(window, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
    residentialCandidatesIntersectingWindow += 1;
    const rawTypeIndex = (candidate as { typeIndex?: unknown }).typeIndex;
    const typeIndex = typeof rawTypeIndex === "number" ? rawTypeIndex : undefined;
    incrementTypeCount(residentialTypeCounts, typeIndex);
    const { base, max } = getResidentialBaseMax(params, candidate.rows, candidate.cols, typeIndex);
    residentialCandidateHeadroomInside += finiteNonNegative(max - base);
    if (candidateFootprintIsBlocked(placementFootprintKeys(candidate), occupied)) {
      residentialCandidatesBlockedByIncumbent += 1;
    }
  }

  return {
    serviceCandidatesIntersectingWindow,
    residentialCandidatesIntersectingWindow,
    serviceCandidatesBlockedByIncumbent,
    residentialCandidatesBlockedByIncumbent,
    serviceCandidateBonusInside,
    maxServiceCandidateBonusInside,
    residentialCandidateHeadroomInside,
    serviceTypeCounts,
    residentialTypeCounts
  };
}

function sameWindow(left: CpSatNeighborhoodWindow | null, right: CpSatNeighborhoodWindow): boolean {
  return (
    left !== null &&
    left.top === right.top &&
    left.left === right.left &&
    left.rows === right.rows &&
    left.cols === right.cols
  );
}

export function sameCandidate(
  left: LnsAdaptiveNeighborhoodCandidate | null,
  right: LnsAdaptiveNeighborhoodCandidate
): boolean {
  return left !== null && left.operator === right.operator && sameWindow(left.window, right.window);
}

export function buildWindowFeatures(
  G: Grid,
  window: CpSatNeighborhoodWindow,
  params: SolverParams,
  incumbent: Solution,
  selectedByBaseline: boolean
): LnsWindowReplayFeatures {
  let serviceCountInside = 0;
  let serviceBonusInside = 0;
  for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
    const service = normalizeServicePlacement(incumbent.services[serviceIndex]);
    if (!rectangleIntersectsWindow(window, service.r, service.c, service.rows, service.cols)) continue;
    serviceCountInside += 1;
    serviceBonusInside += incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
  }

  let residentialCountInside = 0;
  let residentialHeadroomInside = 0;
  for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
    const residential = incumbent.residentials[residentialIndex];
    if (!rectangleIntersectsWindow(window, residential.r, residential.c, residential.rows, residential.cols)) continue;
    residentialCountInside += 1;
    const typeIndex = incumbent.residentialTypeIndices[residentialIndex];
    const { max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    residentialHeadroomInside += finiteNonNegative(max - (incumbent.populations[residentialIndex] ?? 0));
  }

  const occupied = incumbentBuildingFootprintKeys(incumbent);
  const beforeGraph = summarizeEmptyGraph(G, occupied);
  const cleared = clearWindowFootprintKeys(occupied, window);
  const afterGraph = summarizeEmptyGraph(G, cleared.occupied);
  const candidateLoss = buildCandidateLossFeatures(G, params, window, occupied);

  return {
    schemaVersion: LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
    area: window.rows * window.cols,
    touchesRoadAnchorBoundary: window.top === 0 || window.left === 0,
    roadCountInside: [...incumbent.roads].filter((key) => roadInsideWindow(window, key)).length,
    serviceCountInside,
    residentialCountInside,
    residentialHeadroomInside,
    serviceBonusInside,
    selectedByBaseline,
    connectivityShadow: {
      reachableEmptyCellsBefore: beforeGraph.reachableCount,
      reachableEmptyCellsAfterClearingWindow: afterGraph.reachableCount,
      newlyReachableEmptyCellsIfCleared: Math.max(0, afterGraph.reachableCount - beforeGraph.reachableCount),
      disconnectedEmptyCellsBefore: beforeGraph.disconnectedCount,
      disconnectedEmptyCellsAfterClearingWindow: afterGraph.disconnectedCount,
      clearedBuildingFootprintCells: cleared.clearedBuildingFootprintCells
    },
    fragmentation: {
      emptyComponentCountBefore: beforeGraph.componentCount,
      emptyComponentCountAfterClearingWindow: afterGraph.componentCount,
      componentDeltaAfterClearingWindow: afterGraph.componentCount - beforeGraph.componentCount,
      allowedWindowCellCount: countAllowedWindowCells(G, cleared.occupied, window),
      anchorReachableWindowCellCount: countReachableWindowCells(window, afterGraph.reachableKeys),
      narrowGateCellCount: countNarrowGateCells(G, cleared.occupied, window)
    },
    candidateLoss
  };
}
