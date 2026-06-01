import { materializeSerializedSolution } from "../../../packages/core/index.js";
import { assertValidSerializedSolutionPayload } from "../../../packages/core/index.js";
import type { Grid, SerializedSolution, SolverParams } from "../../../packages/core/index.js";

export type SolveRequestClientRole = "primary" | "expansion-comparison";

export interface SolveRequest {
  grid: Grid;
  params: SolverParams;
  requestId?: string;
  clientRole?: SolveRequestClientRole;
}

export interface LayoutEvaluateRequest {
  grid: Grid;
  params: SolverParams;
  solution: unknown;
}

export interface CancelSolveRequest {
  requestId: string;
}

const LOCAL_RUNTIME_CP_SAT_KEYS = new Set(["pythonExecutable", "scriptPath", "stopFilePath", "snapshotFilePath"]);
const LOCAL_RUNTIME_SOLVER_KEYS = new Set(["stopFilePath", "snapshotFilePath"]);
const SOLVE_REQUEST_CLIENT_ROLES = new Set<SolveRequestClientRole>(["primary", "expansion-comparison"]);

const LOCAL_RUNTIME_PARAM_SECTIONS = [
  { key: "cpSat", keysToStrip: LOCAL_RUNTIME_CP_SAT_KEYS },
  { key: "greedy", keysToStrip: LOCAL_RUNTIME_SOLVER_KEYS },
  { key: "lns", keysToStrip: LOCAL_RUNTIME_SOLVER_KEYS }
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function resolveSolveRequestClientRole(value: SolveRequest): SolveRequestClientRole {
  return SOLVE_REQUEST_CLIENT_ROLES.has(value.clientRole as SolveRequestClientRole) ? value.clientRole! : "primary";
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
  return (
    isGrid(candidate.grid) &&
    typeof candidate.params === "object" &&
    candidate.params !== null &&
    typeof candidate.solution === "object" &&
    candidate.solution !== null
  );
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
    params: sanitizePlannerSolverParams(payload.params)
  };
}

export { assertValidSerializedSolutionPayload };
export { materializeSerializedSolution };
export { buildManualLayoutResponse, buildSolveResponse, buildSolveResponsePayload } from "./solutionResponse.js";
