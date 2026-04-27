import type {
  ResidentialCandidate,
  ResidentialPlacement,
  ServiceCandidate,
  ServicePlacement,
  Solution,
  SolverParams,
} from "../core/types.js";
import { normalizeServicePlacement } from "../core/buildings.js";
import { getResidentialBaseMax, NO_TYPE_INDEX } from "../core/rules.js";
import type { ConnectivityProbe, RoadConnectionProbe } from "./attemptState.js";

export type ResidentialCandidateLike = ResidentialPlacement | ResidentialCandidate;
export type ResidentialCandidatesList = ResidentialCandidateLike[];
export type TieBreakProbe = ConnectivityProbe | RoadConnectionProbe;

function isTypedResidentialCandidate(candidate: ResidentialCandidateLike): candidate is ResidentialCandidate {
  return "typeIndex" in candidate;
}

export function getCandidateTypeIndex(candidate: ResidentialCandidateLike): number {
  return isTypedResidentialCandidate(candidate) ? candidate.typeIndex : NO_TYPE_INDEX;
}

export function serviceCandidateKey(candidate: ServiceCandidate): string {
  return [candidate.r, candidate.c, candidate.rows, candidate.cols, candidate.range, candidate.typeIndex, candidate.bonus].join(
    ","
  );
}

export function sameServicePlacement(a: ServicePlacement, b: ServicePlacement): boolean {
  const sa = normalizeServicePlacement(a);
  const sb = normalizeServicePlacement(b);
  return sa.r === sb.r && sa.c === sb.c && sa.rows === sb.rows && sa.cols === sb.cols && sa.range === sb.range;
}

export function materializeServicePlacement(candidate: ServiceCandidate): Required<ServicePlacement> {
  return {
    r: candidate.r,
    c: candidate.c,
    rows: candidate.rows,
    cols: candidate.cols,
    range: candidate.range,
  };
}

export function materializeChosenServiceCandidate(solution: Solution, index: number): ServiceCandidate {
  const placement = normalizeServicePlacement(solution.services[index]);
  return {
    ...placement,
    typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
    bonus: solution.servicePopulationIncreases[index] ?? 0,
  };
}

export function stableServicePlacementKey(candidate: ServicePlacement | ServiceCandidate): string {
  const placement = normalizeServicePlacement(candidate);
  return [
    placement.r,
    placement.c,
    placement.rows,
    placement.cols,
    placement.range,
    "typeIndex" in candidate ? candidate.typeIndex : NO_TYPE_INDEX,
    "bonus" in candidate ? candidate.bonus : 0,
  ].join(",");
}

export function stableResidentialPlacementKey(candidate: ResidentialCandidateLike): string {
  return [
    candidate.r,
    candidate.c,
    candidate.rows,
    candidate.cols,
    getCandidateTypeIndex(candidate),
  ].join(",");
}

export function roadCostFromTieBreakProbe(probe: TieBreakProbe): number {
  return "roadCost" in probe ? probe.roadCost : (probe.path?.length ?? 0);
}

function countRow0FootprintCells(placement: { r: number; c: number; rows: number; cols: number }): number {
  return placement.r === 0 ? placement.cols : 0;
}

function footprintArea(placement: { rows: number; cols: number }): number {
  return placement.rows * placement.cols;
}

function footprintPerimeter(placement: { rows: number; cols: number }): number {
  return 2 * (placement.rows + placement.cols);
}

export function compareServiceTieBreaks(
  a: ServiceCandidate,
  aProbe: TieBreakProbe,
  b: ServiceCandidate,
  bProbe: TieBreakProbe
): number {
  const aRow0Cells = countRow0FootprintCells(a);
  const bRow0Cells = countRow0FootprintCells(b);
  if (aRow0Cells !== bRow0Cells) return aRow0Cells - bRow0Cells;

  const aRoadCost = roadCostFromTieBreakProbe(aProbe);
  const bRoadCost = roadCostFromTieBreakProbe(bProbe);
  if (aRoadCost !== bRoadCost) return aRoadCost - bRoadCost;

  const aArea = footprintArea(a);
  const bArea = footprintArea(b);
  if (aArea !== bArea) return aArea - bArea;

  const aPerimeter = footprintPerimeter(a);
  const bPerimeter = footprintPerimeter(b);
  if (aPerimeter !== bPerimeter) return aPerimeter - bPerimeter;

  if (a.r !== b.r) return a.r - b.r;
  if (a.c !== b.c) return a.c - b.c;
  if (a.rows !== b.rows) return a.rows - b.rows;
  if (a.cols !== b.cols) return a.cols - b.cols;
  if (a.range !== b.range) return b.range - a.range;
  if (a.bonus !== b.bonus) return b.bonus - a.bonus;

  return serviceCandidateKey(a).localeCompare(serviceCandidateKey(b));
}

function residentialCandidateKey(candidate: ResidentialCandidateLike): string {
  return [getCandidateTypeIndex(candidate), candidate.r, candidate.c, candidate.rows, candidate.cols].join(",");
}

export function compareResidentialTieBreaks(
  params: SolverParams,
  a: ResidentialCandidateLike,
  aProbe: TieBreakProbe,
  b: ResidentialCandidateLike,
  bProbe: TieBreakProbe
): number {
  const aRoadCost = roadCostFromTieBreakProbe(aProbe);
  const bRoadCost = roadCostFromTieBreakProbe(bProbe);
  if (aRoadCost !== bRoadCost) return aRoadCost - bRoadCost;

  const aArea = footprintArea(a);
  const bArea = footprintArea(b);
  if (aArea !== bArea) return aArea - bArea;

  const aPerimeter = footprintPerimeter(a);
  const bPerimeter = footprintPerimeter(b);
  if (aPerimeter !== bPerimeter) return aPerimeter - bPerimeter;

  if (a.r !== b.r) return a.r - b.r;
  if (a.c !== b.c) return a.c - b.c;
  const aTypeIndex = getCandidateTypeIndex(a);
  const bTypeIndex = getCandidateTypeIndex(b);
  const aStats = getResidentialBaseMax(params, a.rows, a.cols, aTypeIndex);
  const bStats = getResidentialBaseMax(params, b.rows, b.cols, bTypeIndex);
  if (aStats.max !== bStats.max) return bStats.max - aStats.max;
  if (aStats.base !== bStats.base) return bStats.base - aStats.base;

  return residentialCandidateKey(a).localeCompare(residentialCandidateKey(b));
}
