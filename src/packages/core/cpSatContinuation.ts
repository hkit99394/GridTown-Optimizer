import type { CpSatContinuationModelInput, Grid, SolverParams } from "./types.js";

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    entries.sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildCpSatContinuationModelInput(request: {
  grid: Grid;
  params: SolverParams;
}): CpSatContinuationModelInput {
  const params = request.params ?? {};
  const modelParams: CpSatContinuationModelInput["params"] = {
    optimizer: "cp-sat",
    ...(Array.isArray(params.serviceTypes) ? { serviceTypes: cloneJson(params.serviceTypes) } : {}),
    ...(Array.isArray(params.residentialTypes) ? { residentialTypes: cloneJson(params.residentialTypes) } : {}),
    ...(params.residentialSettings ? { residentialSettings: cloneJson(params.residentialSettings) } : {}),
    ...(params.basePop != null ? { basePop: params.basePop } : {}),
    ...(params.maxPop != null ? { maxPop: params.maxPop } : {}),
    ...(params.availableBuildings ? { availableBuildings: cloneJson(params.availableBuildings) } : {}),
    ...(params.maxServices != null ? { maxServices: params.maxServices } : {}),
    ...(params.maxResidentials != null ? { maxResidentials: params.maxResidentials } : {}),
  };

  return {
    grid: cloneGrid(request.grid),
    params: modelParams,
  };
}

export function computeCpSatModelFingerprint(modelInput: CpSatContinuationModelInput): string {
  return `fnv1a:${hashString(stableStringify(modelInput))}`;
}

export function computeCpSatRequestFingerprint(grid: Grid, params: SolverParams): string {
  return computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
}
