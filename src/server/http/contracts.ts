import {
  materializeSerializedSolution,
  serializeSolution,
} from "../../core/solutionSerialization.js";
import { validateSolutionMap } from "../../core/map.js";
import type { Grid, SerializedSolution, Solution, SolverParams } from "../../core/types.js";

export interface SolveRequest {
  grid: Grid;
  params: SolverParams;
  requestId?: string;
}

export interface LayoutEvaluateRequest {
  grid: Grid;
  params: SolverParams;
  solution: SerializedSolution;
}

export interface CancelSolveRequest {
  requestId: string;
}

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
  return isGrid(candidate.grid) && typeof candidate.params === "object" && candidate.params !== null && isSerializedSolution(candidate.solution);
}

export { materializeSerializedSolution };

export function buildSolveResponsePayload(grid: Grid, params: SolverParams, solution: Solution) {
  return validateSolutionMap({
    grid,
    solution,
    params,
  });
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
      stoppedByUser: Boolean(solution.stoppedByUser),
      totalPopulation: solution.totalPopulation,
      roadCount: solution.roads.size,
      serviceCount: solution.services.length,
      residentialCount: solution.residentials.length,
    },
  };
}

export function buildManualLayoutResponse(grid: Grid, params: SolverParams, solution: Solution) {
  const initialValidation = buildSolveResponsePayload(grid, params, solution);
  const normalizedSolution: Solution = {
    ...solution,
    optimizer: undefined,
    manualLayout: true,
    cpSatStatus: undefined,
    cpSatObjectivePolicy: undefined,
    cpSatTelemetry: undefined,
    cpSatPortfolio: undefined,
    stoppedByUser: false,
    populations: [...initialValidation.recomputedPopulations],
    totalPopulation: initialValidation.recomputedTotalPopulation,
  };
  const validation = buildSolveResponsePayload(grid, params, normalizedSolution);

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
      stoppedByUser: Boolean(normalizedSolution.stoppedByUser),
      totalPopulation: normalizedSolution.totalPopulation,
      roadCount: normalizedSolution.roads.size,
      serviceCount: normalizedSolution.services.length,
      residentialCount: normalizedSolution.residentials.length,
    },
  };
}
