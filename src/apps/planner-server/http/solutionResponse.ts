import { normalizeServicePlacement } from "../../../packages/core/index.js";
import { isAllowed } from "../../../packages/core/index.js";
import { validateSolutionMap, type SolutionMapValidationResult } from "../../../packages/core/index.js";
import { renderSolutionMap, validateLayoutConstraints } from "../../../packages/core/index.js";
import { buildPlannerExplainabilityMap } from "../../../packages/core/index.js";
import { buildSolverProgressSummary } from "../../../packages/core/index.js";
import { pruneRedundantRoads } from "../../../packages/core/index.js";
import { serializeSolution } from "../../../packages/core/index.js";
import { cellFromKey, cellKey } from "../../../packages/core/index.js";

import type { SolutionValidationOptions } from "../../../packages/core/index.js";
import type { BuildingPlacementForRoadMaterialization } from "../../../packages/core/index.js";
import type {
  Grid,
  Solution,
  SolveResponseStats,
  SolveResponseValidation,
  SolverParams
} from "../../../packages/core/index.js";

interface PlannerSolutionResponseOptions {
  includeExplainability?: boolean;
}

interface CompactSolveResponseOptions {
  validationMode?: "full" | "lightweight";
}

interface ResponsePopulationValidation {
  mode: "full-recompute" | "reported-invariants";
  populationSource: "layout-recomputed" | "solver-reported";
  totalPopulationSource: "layout-recomputed" | "reported-population-sum";
  reportedTotalPopulation: number | null;
  reportedPopulationSum: number | null;
}

function readReportedTotalPopulation(solution: Solution): number | null {
  return typeof solution.totalPopulation === "number" && Number.isFinite(solution.totalPopulation)
    ? solution.totalPopulation
    : null;
}

function sumReportedPopulations(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let sum = 0;
  for (const population of value) {
    if (typeof population !== "number" || !Number.isFinite(population)) return null;
    sum += population;
  }
  return sum;
}

function buildPopulationValidation(
  solution: Solution,
  mode: ResponsePopulationValidation["mode"]
): ResponsePopulationValidation {
  return mode === "reported-invariants"
    ? {
        mode,
        populationSource: "solver-reported",
        totalPopulationSource: "reported-population-sum",
        reportedTotalPopulation: readReportedTotalPopulation(solution),
        reportedPopulationSum: sumReportedPopulations(solution.populations)
      }
    : {
        mode,
        populationSource: "layout-recomputed",
        totalPopulationSource: "layout-recomputed",
        reportedTotalPopulation: readReportedTotalPopulation(solution),
        reportedPopulationSum: sumReportedPopulations(solution.populations)
      };
}

export function buildSolveResponsePayload(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  options: SolutionValidationOptions = {}
): SolutionMapValidationResult {
  return validateSolutionMap(
    {
      grid,
      solution,
      params
    },
    options
  );
}

function buildResponseValidation(
  validation: SolutionMapValidationResult,
  populationValidation: ResponsePopulationValidation
): SolveResponseValidation & { populationValidation: ResponsePopulationValidation } {
  return {
    valid: validation.valid,
    errors: validation.errors,
    recomputedPopulations: validation.recomputedPopulations,
    recomputedTotalPopulation: validation.recomputedTotalPopulation,
    mapRows: validation.mapRows,
    mapText: validation.mapText,
    populationValidation
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
    residentialCount: solution.residentials.length
  };
}

function buildPlannerSolutionResponse(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  validation: SolutionMapValidationResult,
  options: PlannerSolutionResponseOptions & { populationValidation?: ResponsePopulationValidation } = {}
) {
  const response = {
    solution: serializeSolution(solution),
    validation: buildResponseValidation(
      validation,
      options.populationValidation ?? buildPopulationValidation(solution, "full-recompute")
    ),
    stats: buildResponseStats(solution, params)
  };
  if (options.includeExplainability === false) return response;
  return {
    ...response,
    explainability: buildPlannerExplainabilityMap(grid, params, solution)
  };
}

export function buildSolveResponse(grid: Grid, params: SolverParams, solution: Solution) {
  return buildPlannerSolutionResponse(grid, params, solution, buildSolveResponsePayload(grid, params, solution));
}

function buildCompactSolveResponsePayload(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  options: CompactSolveResponseOptions = {}
): SolutionMapValidationResult {
  if (options.validationMode !== "lightweight") {
    return buildSolveResponsePayload(grid, params, solution);
  }

  // Status polling must stay cheap; strict typed population assignment can be too expensive for large groups.
  const errors: string[] = [];
  const services = Array.isArray(solution.services) ? solution.services : [];
  const serviceTypeIndices = Array.isArray(solution.serviceTypeIndices) ? solution.serviceTypeIndices : [];
  const servicePopulationIncreases = Array.isArray(solution.servicePopulationIncreases)
    ? solution.servicePopulationIncreases
    : [];
  const residentials = Array.isArray(solution.residentials) ? solution.residentials : [];
  const residentialTypeIndices = Array.isArray(solution.residentialTypeIndices) ? solution.residentialTypeIndices : [];
  const populations = Array.isArray(solution.populations) ? solution.populations : [];

  if (!Array.isArray(solution.services)) errors.push("Solution services must be an array.");
  if (!Array.isArray(solution.serviceTypeIndices)) errors.push("Solution serviceTypeIndices must be an array.");
  if (!Array.isArray(solution.servicePopulationIncreases)) {
    errors.push("Solution servicePopulationIncreases must be an array.");
  }
  if (!Array.isArray(solution.residentials)) errors.push("Solution residentials must be an array.");
  if (!Array.isArray(solution.residentialTypeIndices)) errors.push("Solution residentialTypeIndices must be an array.");
  if (!Array.isArray(solution.populations)) errors.push("Solution populations must be an array.");

  if (serviceTypeIndices.length !== services.length) {
    errors.push(`Solution reports ${serviceTypeIndices.length} service type indices for ${services.length} services.`);
  }
  if (servicePopulationIncreases.length !== services.length) {
    errors.push(
      `Solution reports ${servicePopulationIncreases.length} service bonuses for ${services.length} services.`
    );
  }
  if (residentialTypeIndices.length !== residentials.length) {
    errors.push(
      `Solution reports ${residentialTypeIndices.length} residential type indices for ${residentials.length} residentials.`
    );
  }
  if (populations.length !== residentials.length) {
    errors.push(
      `Solution reports ${populations.length} residential populations for ${residentials.length} residentials.`
    );
  }

  const invalidPopulationIndex = populations.findIndex(
    (population) => typeof population !== "number" || !Number.isFinite(population)
  );
  if (invalidPopulationIndex !== -1) {
    errors.push(`Solution reports a non-numeric population for residential ${invalidPopulationIndex}.`);
  }
  const reportedPopulationSum = invalidPopulationIndex === -1 ? sumReportedPopulations(populations) : null;
  const reportedTotalPopulation = readReportedTotalPopulation(solution);
  if (reportedTotalPopulation === null) {
    errors.push("Solution reports a non-numeric total population.");
  } else if (reportedPopulationSum !== null && reportedTotalPopulation !== reportedPopulationSum) {
    errors.push(
      `Solution reports total population ${reportedTotalPopulation}, but reported residential populations sum to ${reportedPopulationSum}.`
    );
  }

  const servicesWithBonuses = services.map((service, index) => ({
    ...service,
    bonus: servicePopulationIncreases[index] ?? 0
  }));
  const constraintValidation = validateLayoutConstraints({
    grid,
    roads: solution.roads instanceof Set ? solution.roads : new Set<string>(),
    services: servicesWithBonuses,
    residentials,
    params
  });
  errors.push(...constraintValidation.errors);

  const mapRows = renderSolutionMap(grid, solution);
  const recomputedPopulations = [...populations];
  const recomputedTotalPopulation = reportedPopulationSum ?? 0;

  return {
    valid: errors.length === 0,
    errors,
    recomputedPopulations,
    recomputedTotalPopulation,
    layoutEvaluation: {
      valid: constraintValidation.valid,
      errors: constraintValidation.errors,
      populations: residentials.map((residential, index) => ({
        ...residential,
        population: populations[index] ?? 0
      })),
      totalPopulation: recomputedTotalPopulation,
      boosts: new Array(residentials.length).fill(0)
    },
    mapRows,
    mapText: mapRows.join("\n")
  };
}

export function buildCompactSolveResponse(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  options: CompactSolveResponseOptions = {}
) {
  const populationValidation = buildPopulationValidation(
    solution,
    options.validationMode === "lightweight" ? "reported-invariants" : "full-recompute"
  );
  return buildPlannerSolutionResponse(
    grid,
    params,
    solution,
    buildCompactSolveResponsePayload(grid, params, solution, options),
    {
      includeExplainability: false,
      populationValidation
    }
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

function collectRoadCleanupBuildings(grid: Grid, solution: Solution): BuildingPlacementForRoadMaterialization[] | null {
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
    roads: cleanedRoads
  };
}

function normalizeManualLayoutSolution(solution: Solution, validation: SolutionMapValidationResult): Solution {
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
    totalPopulation: validation.recomputedTotalPopulation
  };
}

export function buildManualLayoutResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const cleanedSolution = cleanManualLayoutRoads(grid, solution);
  const validation = buildSolveResponsePayload(grid, params, cleanedSolution, {
    ignoreReportedPopulation: true
  });
  return buildPlannerSolutionResponse(
    grid,
    params,
    normalizeManualLayoutSolution(cleanedSolution, validation),
    validation
  );
}
