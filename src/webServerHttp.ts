import { validateSolutionMap } from "./index.js";
import type { Grid, SerializedSolution, Solution, SolverParams } from "./types.js";

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
    && Array.isArray(candidate.services)
    && Array.isArray(candidate.serviceTypeIndices)
    && Array.isArray(candidate.servicePopulationIncreases)
    && Array.isArray(candidate.residentials)
    && Array.isArray(candidate.residentialTypeIndices)
    && Array.isArray(candidate.populations)
    && typeof candidate.totalPopulation === "number";
}

export function isLayoutEvaluateRequest(value: unknown): value is LayoutEvaluateRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LayoutEvaluateRequest>;
  return isGrid(candidate.grid) && typeof candidate.params === "object" && candidate.params !== null && isSerializedSolution(candidate.solution);
}

export function materializeSerializedSolution(solution: SerializedSolution): Solution {
  return {
    ...solution,
    roads: new Set(solution.roads),
  };
}

function serializeSolution(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

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
    cpSatStatus: undefined,
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
      cpSatStatus: normalizedSolution.cpSatStatus ?? null,
      stoppedByUser: Boolean(normalizedSolution.stoppedByUser),
      totalPopulation: normalizedSolution.totalPopulation,
      roadCount: normalizedSolution.roads.size,
      serviceCount: normalizedSolution.services.length,
      residentialCount: normalizedSolution.residentials.length,
    },
  };
}
