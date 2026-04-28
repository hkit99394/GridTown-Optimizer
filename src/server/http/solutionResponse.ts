import { normalizeServicePlacement } from "../../core/buildings.js";
import { isAllowed } from "../../core/grid.js";
import { validateSolutionMap, type SolutionMapValidationResult } from "../../core/map.js";
import { buildPlannerExplainabilityMap } from "../../core/plannerExplainability.js";
import { buildSolverProgressSummary } from "../../core/progress.js";
import { pruneRedundantRoads } from "../../core/roads.js";
import { serializeSolution } from "../../core/solutionSerialization.js";
import { cellFromKey, cellKey } from "../../core/types.js";

import type { SolutionValidationOptions } from "../../core/evaluator.js";
import type { BuildingPlacementForRoadMaterialization } from "../../core/roads.js";
import type {
  Grid,
  Solution,
  SolveResponseStats,
  SolveResponseValidation,
  SolverParams,
} from "../../core/types.js";

export function buildSolveResponsePayload(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  options: SolutionValidationOptions = {}
): SolutionMapValidationResult {
  return validateSolutionMap({
    grid,
    solution,
    params,
  }, options);
}

function buildResponseValidation(validation: SolutionMapValidationResult): SolveResponseValidation {
  return {
    valid: validation.valid,
    errors: validation.errors,
    recomputedPopulations: validation.recomputedPopulations,
    recomputedTotalPopulation: validation.recomputedTotalPopulation,
    mapRows: validation.mapRows,
    mapText: validation.mapText,
  };
}

function buildResponseStats(solution: Solution, params: SolverParams): SolveResponseStats {
  return {
    optimizer: solution.optimizer,
    activeOptimizer: solution.activeOptimizer,
    autoStage: solution.autoStage,
    manualLayout: Boolean(solution.manualLayout),
    cpSatStatus: solution.cpSatStatus ?? null,
    lnsTelemetry: solution.lnsTelemetry,
    progressSummary: buildSolverProgressSummary(solution, { params }),
    stoppedByUser: Boolean(solution.stoppedByUser),
    stoppedByTimeLimit: Boolean(solution.stoppedByTimeLimit),
    totalPopulation: solution.totalPopulation,
    roadCount: solution.roads.size,
    serviceCount: solution.services.length,
    residentialCount: solution.residentials.length,
  };
}

function buildPlannerSolutionResponse(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  validation: SolutionMapValidationResult
) {
  return {
    solution: serializeSolution(solution),
    validation: buildResponseValidation(validation),
    stats: buildResponseStats(solution, params),
    explainability: buildPlannerExplainabilityMap(grid, params, solution),
  };
}

export function buildSolveResponse(grid: Grid, params: SolverParams, solution: Solution) {
  return buildPlannerSolutionResponse(
    grid,
    params,
    solution,
    buildSolveResponsePayload(grid, params, solution)
  );
}

function addPlacementCellsForCleanup(
  grid: Grid,
  occupiedCells: Set<string>,
  placement: BuildingPlacementForRoadMaterialization
): boolean {
  for (let rowOffset = 0; rowOffset < placement.rows; rowOffset += 1) {
    for (let colOffset = 0; colOffset < placement.cols; colOffset += 1) {
      const row = placement.r + rowOffset;
      const col = placement.c + colOffset;
      if (!isAllowed(grid, row, col)) return false;
      const key = cellKey(row, col);
      if (occupiedCells.has(key)) return false;
      occupiedCells.add(key);
    }
  }
  return true;
}

function collectRoadCleanupBuildings(
  grid: Grid,
  solution: Solution
): BuildingPlacementForRoadMaterialization[] | null {
  const buildingCells = new Set<string>();
  const buildings: BuildingPlacementForRoadMaterialization[] = [];

  for (const service of solution.services) {
    const placement = normalizeServicePlacement(service);
    if (!addPlacementCellsForCleanup(grid, buildingCells, placement)) return null;
    buildings.push(placement);
  }

  for (const residential of solution.residentials) {
    if (!addPlacementCellsForCleanup(grid, buildingCells, residential)) return null;
    buildings.push(residential);
  }

  for (const roadKey of solution.roads) {
    const { r, c } = cellFromKey(roadKey);
    if (!isAllowed(grid, r, c)) return null;
    if (buildingCells.has(roadKey)) return null;
  }

  return buildings;
}

function cleanManualLayoutRoads(grid: Grid, solution: Solution): Solution {
  const buildings = collectRoadCleanupBuildings(grid, solution);
  if (!buildings) return solution;

  const cleanedRoads = pruneRedundantRoads(grid, solution.roads, buildings);
  if (cleanedRoads.size === solution.roads.size && [...cleanedRoads].every((roadKey) => solution.roads.has(roadKey))) {
    return solution;
  }

  return {
    ...solution,
    roads: cleanedRoads,
  };
}

function normalizeManualLayoutSolution(
  solution: Solution,
  validation: SolutionMapValidationResult
): Solution {
  return {
    ...solution,
    optimizer: undefined,
    manualLayout: true,
    cpSatStatus: undefined,
    cpSatObjectivePolicy: undefined,
    cpSatTelemetry: undefined,
    cpSatPortfolio: undefined,
    lnsTelemetry: undefined,
    stoppedByUser: false,
    stoppedByTimeLimit: false,
    populations: [...validation.recomputedPopulations],
    totalPopulation: validation.recomputedTotalPopulation,
  };
}

export function buildManualLayoutResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const cleanedSolution = cleanManualLayoutRoads(grid, solution);
  const validation = buildSolveResponsePayload(grid, params, cleanedSolution, {
    ignoreReportedPopulation: true,
  });
  return buildPlannerSolutionResponse(
    grid,
    params,
    normalizeManualLayoutSolution(cleanedSolution, validation),
    validation
  );
}
