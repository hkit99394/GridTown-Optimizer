import { materializeSerializedSolution } from "../../core/solutionSerialization.js";
import { assertValidSerializedSolutionPayload, SolverInputError } from "../../core/solverInputValidation.js";
import type { Grid, SerializedSolution, SolverParams } from "../../core/types.js";

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

const LOCAL_RUNTIME_PARAM_SECTIONS = [
  { key: "cpSat", keysToStrip: LOCAL_RUNTIME_CP_SAT_KEYS },
  { key: "greedy", keysToStrip: LOCAL_RUNTIME_SOLVER_KEYS },
  { key: "lns", keysToStrip: LOCAL_RUNTIME_SOLVER_KEYS },
] as const;

export const HTTP_SOLVER_INPUT_LIMITS = {
  maxGridCells: 10_000,
  maxCatalogEntries: 200,
  maxFootprintArea: 400,
  maxAvailability: 10_000,
  maxEstimatedCandidates: 250_000,
} as const;

type FootprintDimensions = readonly [rows: number, cols: number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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
  try {
    assertValidSerializedSolutionPayload(value);
    return true;
  } catch {
    return false;
  }
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

  let changed = false;
  const sanitizedParams: SolverParams = { ...params };
  for (const { key, keysToStrip } of LOCAL_RUNTIME_PARAM_SECTIONS) {
    const sanitized = stripKeysFromRecord(params[key], keysToStrip);
    if (sanitized === params[key]) {
      continue;
    }
    changed = true;
    (sanitizedParams as Record<string, unknown>)[key] = sanitized;
  }
  return changed ? sanitizedParams : params;
}

export function sanitizeSolveRequest<T extends SolveRequest | LayoutEvaluateRequest>(payload: T): T {
  return {
    ...payload,
    params: sanitizePlannerSolverParams(payload.params),
  };
}

function assertHttpPlannerLimit(
  actual: number,
  limit: number,
  message: (actual: number, limit: number) => string
): void {
  if (actual <= limit) return;
  throw new SolverInputError(message(actual, limit));
}

function estimatePlacements(gridRows: number, gridCols: number, [footprintRows, footprintCols]: FootprintDimensions): number {
  if (footprintRows > gridRows || footprintCols > gridCols) return 0;
  return (gridRows - footprintRows + 1) * (gridCols - footprintCols + 1);
}

function serviceOrientations(service: Record<string, unknown>): FootprintDimensions[] {
  const rows = positiveDimension(service.rows);
  const cols = positiveDimension(service.cols);
  if (rows === null || cols === null) return [];
  if (service.allowRotation !== false && rows !== cols) return [[rows, cols], [cols, rows]];
  return [[rows, cols]];
}

function residentialOrientations(residential: Record<string, unknown>): FootprintDimensions[] {
  const width = positiveDimension(residential.w);
  const height = positiveDimension(residential.h);
  if (width === null || height === null) return [];
  if (width !== height) return [[height, width], [width, height]];
  return [[height, width]];
}

function assertHttpCatalogEntryLimits(entry: unknown, path: string, dimensions: FootprintDimensions[]): void {
  if (!isRecord(entry)) return;
  const availability = entry.avail;
  if (availability !== undefined && isFiniteNonNegativeInteger(availability)) {
    assertHttpPlannerLimit(
      availability,
      HTTP_SOLVER_INPUT_LIMITS.maxAvailability,
      (_actual, limit) => `${path}.avail exceeds the HTTP planner limit of ${limit}.`
    );
  }
  for (const [rows, cols] of dimensions) {
    const footprintArea = rows * cols;
    assertHttpPlannerLimit(
      footprintArea,
      HTTP_SOLVER_INPUT_LIMITS.maxFootprintArea,
      (actual, limit) => `${path} footprint area ${actual} exceeds the HTTP planner limit of ${limit}.`
    );
  }
}

function entryContributesCandidates(entry: unknown): boolean {
  return !isRecord(entry) || entry.avail !== 0;
}

function estimateCatalogCandidates(
  gridRows: number,
  gridCols: number,
  entries: readonly unknown[],
  dimensionsForEntry: (entry: Record<string, unknown>) => FootprintDimensions[],
  pathForEntry: (index: number) => string
): number {
  let candidates = 0;
  entries.forEach((entry, index) => {
    const dimensions = isRecord(entry) ? dimensionsForEntry(entry) : [];
    assertHttpCatalogEntryLimits(entry, pathForEntry(index), dimensions);
    if (!entryContributesCandidates(entry)) return;
    for (const dimensionsEntry of dimensions) {
      candidates += estimatePlacements(gridRows, gridCols, dimensionsEntry);
    }
  });
  return candidates;
}

export function assertHttpPlannerInputLimits(grid: Grid, params: SolverParams): void {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const gridCells = rowCount * colCount;
  assertHttpPlannerLimit(
    gridCells,
    HTTP_SOLVER_INPUT_LIMITS.maxGridCells,
    (actual, limit) => `HTTP planner grid has ${actual} cells, exceeding the limit of ${limit}.`
  );

  const serviceTypes = Array.isArray(params.serviceTypes) ? params.serviceTypes : [];
  const residentialTypes = Array.isArray(params.residentialTypes) ? params.residentialTypes : [];
  const catalogEntries = serviceTypes.length + residentialTypes.length;
  assertHttpPlannerLimit(
    catalogEntries,
    HTTP_SOLVER_INPUT_LIMITS.maxCatalogEntries,
    (actual, limit) => `HTTP planner catalog has ${actual} entries, exceeding the limit of ${limit}.`
  );

  let estimatedCandidates = estimateCatalogCandidates(
    rowCount,
    colCount,
    serviceTypes,
    serviceOrientations,
    (index) => `HTTP planner serviceTypes[${index}]`
  );

  if (residentialTypes.length > 0) {
    estimatedCandidates += estimateCatalogCandidates(
      rowCount,
      colCount,
      residentialTypes,
      residentialOrientations,
      (index) => `HTTP planner residentialTypes[${index}]`
    );
  } else {
    estimatedCandidates += estimatePlacements(rowCount, colCount, [2, 2]);
    estimatedCandidates += estimatePlacements(rowCount, colCount, [2, 3]);
  }

  assertHttpPlannerLimit(
    estimatedCandidates,
    HTTP_SOLVER_INPUT_LIMITS.maxEstimatedCandidates,
    (actual, limit) => `HTTP planner estimated candidate count ${actual} exceeds the limit of ${limit}.`
  );
}

export { assertValidSerializedSolutionPayload };
export { materializeSerializedSolution };
export { buildManualLayoutResponse, buildSolveResponse, buildSolveResponsePayload } from "./solutionResponse.js";
