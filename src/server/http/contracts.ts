import {
  materializeSerializedSolution,
  serializeSolution,
} from "../../core/solutionSerialization.js";
import { normalizeServicePlacement } from "../../core/buildings.js";
import { isAllowed } from "../../core/grid.js";
import { validateSolutionMap } from "../../core/map.js";
import { buildPlannerExplainabilityMap } from "../../core/plannerExplainability.js";
import { buildSolverProgressSummary } from "../../core/progress.js";
import { pruneRedundantRoads } from "../../core/roads.js";
import { assertValidSerializedSolutionPayload } from "../../core/solverInputValidation.js";
import { cellFromKey, cellKey } from "../../core/types.js";
import type { Grid, SerializedSolution, Solution, SolverParams } from "../../core/types.js";
import type { SolutionValidationOptions } from "../../core/evaluator.js";
import type { BuildingPlacementForRoadMaterialization } from "../../core/roads.js";

export interface SolveRequest {
  grid: Grid;
  params: SolverParams;
  requestId?: string;
}

export interface LayoutEvaluateRequest {
  grid: Grid;
  params: SolverParams;
  solution: unknown;
}

export interface CancelSolveRequest {
  requestId: string;
}

const LOCAL_RUNTIME_CP_SAT_KEYS = new Set([
  "pythonExecutable",
  "scriptPath",
  "stopFilePath",
  "snapshotFilePath",
]);
const LOCAL_RUNTIME_SOLVER_KEYS = new Set([
  "stopFilePath",
  "snapshotFilePath",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isRoadKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(",");
  if (parts.length !== 2) return false;
  const [row, col] = parts.map(Number);
  return Number.isInteger(row) && row >= 0 && Number.isInteger(col) && col >= 0;
}

function isSerializedServicePlacement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isInteger(value.r)
    && isInteger(value.c)
    && isInteger(value.rows, 1)
    && isInteger(value.cols, 1)
    && isInteger(value.range);
}

function isSerializedResidentialPlacement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isInteger(value.r)
    && isInteger(value.c)
    && isInteger(value.rows, 1)
    && isInteger(value.cols, 1);
}

export function isGrid(value: unknown): value is Grid {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((row) => Array.isArray(row) && row.length > 0)) return false;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (width === 0) return false;
  return value.every(
    (row) => Array.isArray(row) && row.length === width && row.every((cell) => cell === 0 || cell === 1)
  );
}

export function isSolveRequest(value: unknown): value is SolveRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SolveRequest>;
  return isGrid(candidate.grid) && typeof candidate.params === "object" && candidate.params !== null;
}

export function isCancelSolveRequest(value: unknown): value is CancelSolveRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CancelSolveRequest>;
  return typeof candidate.requestId === "string" && candidate.requestId.trim().length > 0;
}

export function isSerializedSolution(value: unknown): value is SerializedSolution {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SerializedSolution>;
  return Array.isArray(candidate.roads)
    && candidate.roads.every((road) => isRoadKey(road))
    && Array.isArray(candidate.services)
    && candidate.services.every((service) => isSerializedServicePlacement(service))
    && Array.isArray(candidate.serviceTypeIndices)
    && candidate.serviceTypeIndices.length === candidate.services.length
    && candidate.serviceTypeIndices.every((typeIndex) => isInteger(typeIndex, -1))
    && Array.isArray(candidate.servicePopulationIncreases)
    && candidate.servicePopulationIncreases.length === candidate.services.length
    && candidate.servicePopulationIncreases.every((bonus) => isInteger(bonus))
    && Array.isArray(candidate.residentials)
    && candidate.residentials.every((residential) => isSerializedResidentialPlacement(residential))
    && Array.isArray(candidate.residentialTypeIndices)
    && candidate.residentialTypeIndices.length === candidate.residentials.length
    && candidate.residentialTypeIndices.every((typeIndex) => isInteger(typeIndex, -1))
    && Array.isArray(candidate.populations)
    && candidate.populations.length === candidate.residentials.length
    && candidate.populations.every((population) => isInteger(population))
    && isInteger(candidate.totalPopulation);
}

export function isLayoutEvaluateRequest(value: unknown): value is LayoutEvaluateRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LayoutEvaluateRequest>;
  return isGrid(candidate.grid)
    && typeof candidate.params === "object"
    && candidate.params !== null
    && typeof candidate.solution === "object"
    && candidate.solution !== null;
}

function stripKeysFromRecord<T>(value: T, keysToStrip: Set<string>): T {
  if (!isRecord(value)) return value;

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (keysToStrip.has(key) && typeof entryValue === "string") {
      changed = true;
      continue;
    }
    next[key] = entryValue;
  }
  return changed ? (next as T) : value;
}

export function sanitizePlannerSolverParams(params: SolverParams): SolverParams {
  if (!isRecord(params)) return params;

  const cpSat = stripKeysFromRecord(params.cpSat, LOCAL_RUNTIME_CP_SAT_KEYS);
  const greedy = stripKeysFromRecord(params.greedy, LOCAL_RUNTIME_SOLVER_KEYS);
  const lns = stripKeysFromRecord(params.lns, LOCAL_RUNTIME_SOLVER_KEYS);
  if (cpSat === params.cpSat && greedy === params.greedy && lns === params.lns) {
    return params;
  }

  return {
    ...params,
    ...(cpSat === undefined ? {} : { cpSat }),
    ...(greedy === undefined ? {} : { greedy }),
    ...(lns === undefined ? {} : { lns }),
  } as SolverParams;
}

export function sanitizeSolveRequest<T extends SolveRequest | LayoutEvaluateRequest>(payload: T): T {
  return {
    ...payload,
    params: sanitizePlannerSolverParams(payload.params),
  };
}

export { assertValidSerializedSolutionPayload };
export { materializeSerializedSolution };

export function buildSolveResponsePayload(
  grid: Grid,
  params: SolverParams,
  solution: Solution,
  options: SolutionValidationOptions = {}
) {
  return validateSolutionMap({
    grid,
    solution,
    params,
  }, options);
}

export function buildSolveResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const validation = buildSolveResponsePayload(grid, params, solution);
  return {
    solution: serializeSolution(solution),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      recomputedPopulations: validation.recomputedPopulations,
      recomputedTotalPopulation: validation.recomputedTotalPopulation,
      mapRows: validation.mapRows,
      mapText: validation.mapText,
    },
    stats: {
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
    },
    explainability: buildPlannerExplainabilityMap(grid, params, solution),
  };
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

export function buildManualLayoutResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const cleanedSolution = cleanManualLayoutRoads(grid, solution);
  const validation = buildSolveResponsePayload(grid, params, cleanedSolution, {
    ignoreReportedPopulation: true,
  });
  const normalizedSolution: Solution = {
    ...cleanedSolution,
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

  return {
    solution: serializeSolution(normalizedSolution),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      recomputedPopulations: validation.recomputedPopulations,
      recomputedTotalPopulation: validation.recomputedTotalPopulation,
      mapRows: validation.mapRows,
      mapText: validation.mapText,
    },
    stats: {
      optimizer: normalizedSolution.optimizer,
      activeOptimizer: normalizedSolution.activeOptimizer,
      autoStage: normalizedSolution.autoStage,
      manualLayout: Boolean(normalizedSolution.manualLayout),
      cpSatStatus: normalizedSolution.cpSatStatus ?? null,
      lnsTelemetry: normalizedSolution.lnsTelemetry,
      progressSummary: buildSolverProgressSummary(normalizedSolution, { params }),
      stoppedByUser: Boolean(normalizedSolution.stoppedByUser),
      stoppedByTimeLimit: Boolean(normalizedSolution.stoppedByTimeLimit),
      totalPopulation: normalizedSolution.totalPopulation,
      roadCount: normalizedSolution.roads.size,
      serviceCount: normalizedSolution.services.length,
      residentialCount: normalizedSolution.residentials.length,
    },
    explainability: buildPlannerExplainabilityMap(grid, params, normalizedSolution),
  };
}
