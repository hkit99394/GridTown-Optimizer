import type { Grid, Solution } from "../core/types.js";
import {
  stableResidentialPlacementKey,
  stableServicePlacementKey,
} from "./candidates.js";

export function isBetterSearchSolution(candidate: Solution | null, incumbent: Solution | null): boolean {
  if (!candidate) return false;
  if (!incumbent) return true;
  if (candidate.totalPopulation !== incumbent.totalPopulation) {
    return candidate.totalPopulation > incumbent.totalPopulation;
  }
  if (candidate.roads.size !== incumbent.roads.size) {
    return candidate.roads.size < incumbent.roads.size;
  }
  const candidateServiceKey = candidate.services.map(stableServicePlacementKey).join("|");
  const incumbentServiceKey = incumbent.services.map(stableServicePlacementKey).join("|");
  if (candidateServiceKey !== incumbentServiceKey) {
    return candidateServiceKey < incumbentServiceKey;
  }
  const candidateResidentialKey = candidate.residentials.map(stableResidentialPlacementKey).join("|");
  const incumbentResidentialKey = incumbent.residentials.map(stableResidentialPlacementKey).join("|");
  if (candidateResidentialKey !== incumbentResidentialKey) {
    return candidateResidentialKey < incumbentResidentialKey;
  }
  return [...candidate.roads].sort().join("|") < [...incumbent.roads].sort().join("|");
}

export function computePlacementDensityScore(
  grid: Grid,
  placement: { r: number; c: number; rows: number; cols: number },
  populationWeight: number
): number {
  if (populationWeight <= 0 || grid.length === 0 || (grid[0]?.length ?? 0) === 0) return 0;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const centerR = (rows - 1) / 2;
  const centerC = (cols - 1) / 2;
  const placementCenterR = placement.r + (placement.rows - 1) / 2;
  const placementCenterC = placement.c + (placement.cols - 1) / 2;
  const distanceSquared =
    (placementCenterR - centerR) * (placementCenterR - centerR)
    + (placementCenterC - centerC) * (placementCenterC - centerC);
  const maxDistanceSquared =
    centerR * centerR
    + centerC * centerC;
  if (maxDistanceSquared <= 0) return populationWeight;
  const centrality = 1 - Math.min(1, distanceSquared / maxDistanceSquared);
  return populationWeight * centrality;
}

function computeSolutionDensityScore(grid: Grid, solution: Solution): number {
  return solution.residentials.reduce((sum, residential, index) => {
    return sum + computePlacementDensityScore(grid, residential, solution.populations[index] ?? 0);
  }, 0);
}

export function isBetterDensityAwareSearchSolution(
  grid: Grid,
  candidate: Solution | null,
  incumbent: Solution | null
): boolean {
  if (!candidate) return false;
  if (!incumbent) return true;
  if (candidate.totalPopulation !== incumbent.totalPopulation) {
    return candidate.totalPopulation > incumbent.totalPopulation;
  }
  const candidateDensity = computeSolutionDensityScore(grid, candidate);
  const incumbentDensity = computeSolutionDensityScore(grid, incumbent);
  if (Math.abs(candidateDensity - incumbentDensity) > 1e-9) {
    return candidateDensity > incumbentDensity;
  }
  return isBetterSearchSolution(candidate, incumbent);
}

export function compareDensityAwareScore(
  candidateScore: number,
  candidateDensityScore: number,
  incumbentScore: number,
  incumbentDensityScore: number,
  toleranceRatio: number
): number {
  const scale = Math.max(1, Math.abs(candidateScore), Math.abs(incumbentScore));
  if (Math.abs(candidateScore - incumbentScore) <= scale * toleranceRatio) {
    const densityDelta = candidateDensityScore - incumbentDensityScore;
    if (Math.abs(densityDelta) > 1e-9) return densityDelta > 0 ? 1 : -1;
  }
  if (candidateScore !== incumbentScore) return candidateScore > incumbentScore ? 1 : -1;
  return 0;
}
