/**
 * Shared solver input validation helpers and reusable payload validators.
 */

import { validateSolution } from "./evaluator.js";
import { computeCpSatRequestFingerprint } from "./cpSatContinuation.js";
import { NO_TYPE_INDEX } from "./rules.js";
import { isOptimizerName, OMITTED_SOLVER_OPTIMIZER } from "./types.js";

import type { CpSatWarmStartHint, Grid, OptimizerName, SerializedSolution, Solution, SolverParams } from "./types.js";

export const SOLVER_INPUT_ERROR_PREFIX = "Invalid solver input:";

const CP_SAT_HINT_ONLY_REUSABLE_KEYS = [
  "roadKeys",
  "roads",
  "serviceCandidateKeys",
  "residentialCandidateKeys",
  "services",
  "residentials",
  "neighborhoodWindow",
  "fixOutsideNeighborhoodToHintedValue"
] as const;

export class SolverInputError extends Error {
  constructor(detail: string) {
    super(`${SOLVER_INPUT_ERROR_PREFIX} ${detail}`);
    this.name = "SolverInputError";
  }
}

export function isSolverInputError(error: unknown): error is SolverInputError {
  return error instanceof SolverInputError;
}

export function isSolverInputErrorMessage(message: string): boolean {
  return message.includes(SOLVER_INPUT_ERROR_PREFIX);
}

export function resolveOptimizerName(params: Pick<SolverParams, "optimizer"> | null | undefined): OptimizerName {
  return isOptimizerName(params?.optimizer) ? params.optimizer : OMITTED_SOLVER_OPTIMIZER;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

export function isFiniteNumber(value: unknown, minimum: number, allowMinimum: boolean): value is number {
  return typeof value === "number" && Number.isFinite(value) && (allowMinimum ? value >= minimum : value > minimum);
}

export function describeMinimum(minimum: number): string {
  return `an integer >= ${minimum}`;
}

export function describeIntegerRange(minimum: number, maximum: number): string {
  return `an integer between ${minimum} and ${maximum}`;
}

export function describeNumberMinimum(minimum: number, allowMinimum: boolean): string {
  return `a finite number ${allowMinimum ? ">=" : ">"} ${minimum}`;
}

export function describeNumberRange(minimum: number, allowMinimum: boolean, maximum: number): string {
  return `a finite number ${allowMinimum ? ">=" : ">"} ${minimum} and <= ${maximum}`;
}

export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SolverInputError(`LNS seed hint ${path} must be an object.`);
  }
  return value;
}

export function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SolverInputError(`LNS seed hint ${path} must be an array.`);
  }
  return value;
}

export function requireInteger(value: unknown, path: string, minimum = 0): number {
  if (!isInteger(value, minimum)) {
    throw new SolverInputError(`LNS seed hint ${path} must be ${describeMinimum(minimum)}.`);
  }
  return value;
}

export function requireValidationRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new SolverInputError(`${path} must be an object.`);
  }
  return value;
}

export function requireOptionalBoolean(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new SolverInputError(`${path} must be a boolean.`);
  }
}

export function requireOptionalString(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value !== undefined && typeof value !== "string") {
    throw new SolverInputError(`${path} must be a string.`);
  }
}

export function requireOptionalStringInSet(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly string[]
): void {
  const value = parent[key];
  if (value === undefined) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SolverInputError(`${path} must be one of: ${allowed.join(", ")}.`);
  }
}

export function requireOptionalFiniteNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  allowMinimum = false
): void {
  const value = parent[key];
  if (value !== undefined && !isFiniteNumber(value, minimum, allowMinimum)) {
    throw new SolverInputError(`${path} must be ${describeNumberMinimum(minimum, allowMinimum)}.`);
  }
}

export function requireOptionalFiniteNumberInRange(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
  allowMinimum = false
): void {
  const value = parent[key];
  if (value !== undefined && (!isFiniteNumber(value, minimum, allowMinimum) || value > maximum)) {
    throw new SolverInputError(`${path} must be ${describeNumberRange(minimum, allowMinimum, maximum)}.`);
  }
}

export function requireOptionalIntegerForValidation(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  minimum = 0
): void {
  const value = parent[key];
  if (value !== undefined && !isInteger(value, minimum)) {
    throw new SolverInputError(`${path} must be ${describeMinimum(minimum)}.`);
  }
}

export function requireOptionalIntegerInRange(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number
): void {
  const value = parent[key];
  if (value !== undefined && (!isInteger(value, minimum) || value > maximum)) {
    throw new SolverInputError(`${path} must be ${describeIntegerRange(minimum, maximum)}.`);
  }
}

export function requireValidationInteger(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  minimum = 0
): void {
  const value = parent[key];
  if (!isInteger(value, minimum)) {
    throw new SolverInputError(`${path} must be ${describeMinimum(minimum)}.`);
  }
}

export function requireValidationIntegerValue(value: unknown, path: string, minimum = 0): number {
  if (!isInteger(value, minimum)) {
    throw new SolverInputError(`${path} must be ${describeMinimum(minimum)}.`);
  }
  return value;
}

export function requireValidationArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SolverInputError(`${path} must be an array.`);
  }
  return value;
}

export function requireValidationRoadKeys(value: unknown, path: string): string[] {
  return requireValidationArray(value, path).map((entry, index) => {
    if (!isRoadKey(entry)) {
      throw new SolverInputError(`${path}[${index}] must be a road key like "r,c".`);
    }
    return entry;
  });
}

export function requireOptionalRoadKeys(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  requireValidationRoadKeys(value, path);
}

export function requireCandidateKeys(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  kind: "service" | "residential"
): void {
  const value = parent[key];
  if (value === undefined) return;
  const keyPattern = new RegExp(`^${kind}:-?\\d+:\\d+:\\d+:[1-9]\\d*:[1-9]\\d*$`);
  requireValidationArray(value, path).forEach((entry, index) => {
    if (typeof entry !== "string" || !keyPattern.test(entry)) {
      throw new SolverInputError(`${path}[${index}] must be a ${kind} candidate key.`);
    }
  });
}

export function assertValidCpSatWarmStartService(value: unknown, path: string, requireTypedMetadata: boolean): void {
  const service = requireValidationRecord(value, path);
  requireValidationInteger(service, "r", `${path}.r`);
  requireValidationInteger(service, "c", `${path}.c`);
  requireValidationInteger(service, "rows", `${path}.rows`, 1);
  requireValidationInteger(service, "cols", `${path}.cols`, 1);
  requireValidationInteger(service, "range", `${path}.range`);
  if (requireTypedMetadata) {
    requireValidationInteger(service, "typeIndex", `${path}.typeIndex`, NO_TYPE_INDEX);
    requireValidationInteger(service, "bonus", `${path}.bonus`);
  } else {
    requireOptionalIntegerForValidation(service, "typeIndex", `${path}.typeIndex`, NO_TYPE_INDEX);
    requireOptionalIntegerForValidation(service, "bonus", `${path}.bonus`);
  }
}

export function assertValidCpSatWarmStartResidential(value: unknown, path: string, requirePopulation: boolean): void {
  const residential = requireValidationRecord(value, path);
  requireValidationInteger(residential, "r", `${path}.r`);
  requireValidationInteger(residential, "c", `${path}.c`);
  requireValidationInteger(residential, "rows", `${path}.rows`, 1);
  requireValidationInteger(residential, "cols", `${path}.cols`, 1);
  requireValidationInteger(residential, "typeIndex", `${path}.typeIndex`, NO_TYPE_INDEX);
  if (requirePopulation) {
    requireValidationInteger(residential, "population", `${path}.population`);
  } else {
    requireOptionalIntegerForValidation(residential, "population", `${path}.population`);
  }
}

export function assertValidCpSatNeighborhoodWindow(value: unknown, path: string): void {
  const window = requireValidationRecord(value, path);
  requireValidationInteger(window, "top", `${path}.top`);
  requireValidationInteger(window, "left", `${path}.left`);
  requireValidationInteger(window, "rows", `${path}.rows`, 1);
  requireValidationInteger(window, "cols", `${path}.cols`, 1);
}

export function assertValidCpSatWarmStartSolution(value: unknown, path: string): void {
  const solution = requireValidationRecord(value, path);
  requireOptionalRoadKeys(solution, "roads", `${path}.roads`);
  const services =
    solution.services === undefined ? undefined : requireValidationArray(solution.services, `${path}.services`);
  services?.forEach((service, index) => {
    assertValidCpSatWarmStartService(service, `${path}.services[${index}]`, true);
  });
  const residentials =
    solution.residentials === undefined
      ? undefined
      : requireValidationArray(solution.residentials, `${path}.residentials`);
  residentials?.forEach((residential, index) => {
    assertValidCpSatWarmStartResidential(residential, `${path}.residentials[${index}]`, true);
  });
  const populations =
    solution.populations === undefined
      ? undefined
      : requireValidationArray(solution.populations, `${path}.populations`);
  populations?.forEach((population, index) => {
    if (!isInteger(population)) {
      throw new SolverInputError(`${path}.populations[${index}] must be ${describeMinimum(0)}.`);
    }
  });
  if (populations !== undefined && residentials !== undefined && populations.length !== residentials.length) {
    throw new SolverInputError(`${path}.populations must match ${path}.residentials length.`);
  }
  requireOptionalIntegerForValidation(solution, "totalPopulation", `${path}.totalPopulation`);
}

export function assertValidCpSatWarmStartHint(value: unknown, path: string): void {
  if (isRecord(value) && value.roads instanceof Set) return;

  const hint = requireValidationRecord(value, path);
  requireOptionalString(hint, "sourceName", `${path}.sourceName`);
  requireOptionalString(hint, "modelFingerprint", `${path}.modelFingerprint`);
  requireOptionalRoadKeys(hint, "roadKeys", `${path}.roadKeys`);
  requireOptionalRoadKeys(hint, "roads", `${path}.roads`);
  requireCandidateKeys(hint, "serviceCandidateKeys", `${path}.serviceCandidateKeys`, "service");
  requireCandidateKeys(hint, "residentialCandidateKeys", `${path}.residentialCandidateKeys`, "residential");
  requireOptionalIntegerForValidation(hint, "totalPopulation", `${path}.totalPopulation`);
  requireOptionalIntegerForValidation(hint, "objectiveLowerBound", `${path}.objectiveLowerBound`);
  requireOptionalBoolean(hint, "preferStrictImprove", `${path}.preferStrictImprove`);
  requireOptionalBoolean(hint, "repairHint", `${path}.repairHint`);
  requireOptionalBoolean(hint, "fixVariablesToHintedValue", `${path}.fixVariablesToHintedValue`);
  requireOptionalIntegerForValidation(hint, "hintConflictLimit", `${path}.hintConflictLimit`);
  requireOptionalBoolean(hint, "fixOutsideNeighborhoodToHintedValue", `${path}.fixOutsideNeighborhoodToHintedValue`);

  if (hint.neighborhoodWindow !== undefined) {
    assertValidCpSatNeighborhoodWindow(hint.neighborhoodWindow, `${path}.neighborhoodWindow`);
  }
  if (hint.solution !== undefined) {
    assertValidCpSatWarmStartSolution(hint.solution, `${path}.solution`);
  }

  const services = hint.services === undefined ? undefined : requireValidationArray(hint.services, `${path}.services`);
  services?.forEach((service, index) => {
    assertValidCpSatWarmStartService(service, `${path}.services[${index}]`, false);
  });
  const residentials =
    hint.residentials === undefined ? undefined : requireValidationArray(hint.residentials, `${path}.residentials`);
  residentials?.forEach((residential, index) => {
    assertValidCpSatWarmStartResidential(residential, `${path}.residentials[${index}]`, false);
  });
}

export function materializeCpSatWarmStartReusableSolution(value: unknown, path: string): Solution | null {
  if (isRecord(value) && value.roads instanceof Set) {
    return value as unknown as Solution;
  }
  if (!isRecord(value) || value.solution === undefined) return null;

  const hint = value;
  const solution = requireValidationRecord(hint.solution, `${path}.solution`);
  const rawServices =
    solution.services === undefined ? [] : requireValidationArray(solution.services, `${path}.solution.services`);
  const rawResidentials =
    solution.residentials === undefined
      ? []
      : requireValidationArray(solution.residentials, `${path}.solution.residentials`);
  const serviceTypeIndices: number[] = [];
  const servicePopulationIncreases: number[] = [];
  const residentialTypeIndices: number[] = [];
  const residentialPopulations: number[] = [];

  const services = rawServices.map((entry, index) => {
    const service = requireValidationRecord(entry, `${path}.solution.services[${index}]`);
    serviceTypeIndices.push(
      requireValidationIntegerValue(service.typeIndex, `${path}.solution.services[${index}].typeIndex`, NO_TYPE_INDEX)
    );
    servicePopulationIncreases.push(
      requireValidationIntegerValue(service.bonus, `${path}.solution.services[${index}].bonus`)
    );
    return {
      r: requireValidationIntegerValue(service.r, `${path}.solution.services[${index}].r`),
      c: requireValidationIntegerValue(service.c, `${path}.solution.services[${index}].c`),
      rows: requireValidationIntegerValue(service.rows, `${path}.solution.services[${index}].rows`, 1),
      cols: requireValidationIntegerValue(service.cols, `${path}.solution.services[${index}].cols`, 1),
      range: requireValidationIntegerValue(service.range, `${path}.solution.services[${index}].range`)
    };
  });
  const residentials = rawResidentials.map((entry, index) => {
    const residential = requireValidationRecord(entry, `${path}.solution.residentials[${index}]`);
    residentialTypeIndices.push(
      requireValidationIntegerValue(
        residential.typeIndex,
        `${path}.solution.residentials[${index}].typeIndex`,
        NO_TYPE_INDEX
      )
    );
    residentialPopulations.push(
      requireValidationIntegerValue(residential.population, `${path}.solution.residentials[${index}].population`)
    );
    return {
      r: requireValidationIntegerValue(residential.r, `${path}.solution.residentials[${index}].r`),
      c: requireValidationIntegerValue(residential.c, `${path}.solution.residentials[${index}].c`),
      rows: requireValidationIntegerValue(residential.rows, `${path}.solution.residentials[${index}].rows`, 1),
      cols: requireValidationIntegerValue(residential.cols, `${path}.solution.residentials[${index}].cols`, 1)
    };
  });
  const roadsSource = solution.roads ?? hint.roadKeys ?? hint.roads ?? [];
  const roadsPath =
    solution.roads === undefined
      ? hint.roadKeys === undefined
        ? hint.roads === undefined
          ? `${path}.solution.roads`
          : `${path}.roads`
        : `${path}.roadKeys`
      : `${path}.solution.roads`;
  const populations =
    solution.populations === undefined
      ? residentialPopulations
      : requireValidationArray(solution.populations, `${path}.solution.populations`).map((population, index) =>
          requireValidationIntegerValue(population, `${path}.solution.populations[${index}]`)
        );
  if (populations.length !== residentials.length) {
    throw new SolverInputError(`${path}.solution.populations must match ${path}.solution.residentials length.`);
  }
  const totalPopulation =
    solution.totalPopulation === undefined
      ? populations.reduce((sum, population) => sum + population, 0)
      : requireValidationIntegerValue(solution.totalPopulation, `${path}.solution.totalPopulation`);

  return {
    optimizer: "cp-sat",
    roads: new Set(requireValidationRoadKeys(roadsSource, roadsPath)),
    services,
    serviceTypeIndices,
    servicePopulationIncreases,
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation
  };
}

export function assertValidReusableSolution(
  G: Grid,
  params: SolverParams,
  solution: Solution,
  context: string,
  fallbackDetail = "the reusable layout is not valid for the current grid and building settings."
): void {
  const validation = validateSolution({
    grid: G,
    params,
    solution
  });
  if (!validation.valid) {
    const detail = validation.errors.length ? validation.errors.join(" ") : fallbackDetail;
    throw new SolverInputError(`${context} is invalid: ${detail}`);
  }
}

export function hasHintOnlyCpSatReusablePayload(hint: Record<string, unknown>): boolean {
  if (hint.solution !== undefined) return false;
  return CP_SAT_HINT_ONLY_REUSABLE_KEYS.some((key) => hint[key] !== undefined);
}

export function assertMatchingCpSatWarmStartFingerprint(
  G: Grid,
  params: SolverParams,
  hint: Record<string, unknown>,
  path: string
): void {
  if (typeof hint.modelFingerprint !== "string") {
    throw new SolverInputError(`${path}.modelFingerprint is required for hint-only reusable payloads.`);
  }
  const expectedFingerprint = computeCpSatRequestFingerprint(G, params);
  if (hint.modelFingerprint !== expectedFingerprint) {
    throw new SolverInputError(`${path} is stale for the current grid or building settings.`);
  }
}

export function assertValidCpSatReusableInputs(G: Grid, params: SolverParams): void {
  const cpSatValue = (params as Record<string, unknown>).cpSat;
  if (!isRecord(cpSatValue) || cpSatValue.warmStartHint === undefined) return;
  const hint = cpSatValue.warmStartHint;

  if (
    isRecord(hint) &&
    !(hint.roads instanceof Set) &&
    (typeof hint.modelFingerprint === "string" || hasHintOnlyCpSatReusablePayload(hint))
  ) {
    assertMatchingCpSatWarmStartFingerprint(G, params, hint, "CP-SAT warm-start hint cpSat.warmStartHint");
  }

  const solution = materializeCpSatWarmStartReusableSolution(hint, "CP-SAT warm-start hint cpSat.warmStartHint");
  if (!solution) return;
  assertValidReusableSolution(G, params, solution, "CP-SAT warm-start hint cpSat.warmStartHint.solution");
}

export function isRoadKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [row, col, ...rest] = value.split(",");
  return (
    rest.length === 0 &&
    Number.isInteger(Number(row)) &&
    Number(row) >= 0 &&
    Number.isInteger(Number(col)) &&
    Number(col) >= 0
  );
}

export function requireRoadKeys(value: unknown, path: string): string[] {
  const roads = requireArray(value, path);
  roads.forEach((road, index) => {
    if (!isRoadKey(road)) {
      throw new SolverInputError(`LNS seed hint ${path}[${index}] must be a road key like "r,c".`);
    }
  });
  return roads as string[];
}

export function materializeSeedService(
  value: unknown,
  index: number
): Solution["services"][number] & { typeIndex: number; bonus: number } {
  const service = requireRecord(value, `solution.services[${index}]`);
  return {
    r: requireInteger(service.r, `solution.services[${index}].r`),
    c: requireInteger(service.c, `solution.services[${index}].c`),
    rows: requireInteger(service.rows, `solution.services[${index}].rows`, 1),
    cols: requireInteger(service.cols, `solution.services[${index}].cols`, 1),
    range: requireInteger(service.range, `solution.services[${index}].range`),
    typeIndex: requireInteger(service.typeIndex, `solution.services[${index}].typeIndex`, NO_TYPE_INDEX),
    bonus: requireInteger(service.bonus, `solution.services[${index}].bonus`)
  };
}

export function materializeSeedResidential(
  value: unknown,
  index: number
): Solution["residentials"][number] & { typeIndex: number; population: number } {
  const residential = requireRecord(value, `solution.residentials[${index}]`);
  return {
    r: requireInteger(residential.r, `solution.residentials[${index}].r`),
    c: requireInteger(residential.c, `solution.residentials[${index}].c`),
    rows: requireInteger(residential.rows, `solution.residentials[${index}].rows`, 1),
    cols: requireInteger(residential.cols, `solution.residentials[${index}].cols`, 1),
    typeIndex: requireInteger(residential.typeIndex, `solution.residentials[${index}].typeIndex`, NO_TYPE_INDEX),
    population: requireInteger(residential.population, `solution.residentials[${index}].population`)
  };
}

export function materializeLnsSeedSolution(seedHint?: CpSatWarmStartHint): Solution | null {
  if (!seedHint) return null;
  if (seedHint.solution === undefined) {
    throw new SolverInputError("LNS seed hint is missing the saved solution payload.");
  }

  const seededSolution = requireRecord(seedHint.solution, "solution");
  const seededServices = requireArray(seededSolution.services, "solution.services").map(materializeSeedService);
  const seededResidentials = requireArray(seededSolution.residentials, "solution.residentials").map(
    materializeSeedResidential
  );
  const serviceTypeIndices = seededServices.map((service) => service.typeIndex);
  const servicePopulationIncreases = seededServices.map((service) => service.bonus);
  const residentialTypeIndices = seededResidentials.map((residential) => residential.typeIndex);
  const populations =
    seededSolution.populations === undefined
      ? seededResidentials.map((residential) => residential.population)
      : requireArray(seededSolution.populations, "solution.populations").map((population, index) =>
          requireInteger(population, `solution.populations[${index}]`)
        );
  if (populations.length !== seededResidentials.length) {
    throw new SolverInputError("LNS seed hint solution.populations must match solution.residentials length.");
  }
  const roadsSource = seededSolution.roads === undefined ? (seedHint.roadKeys ?? []) : seededSolution.roads;
  const roadsPath = seededSolution.roads === undefined ? "roadKeys" : "solution.roads";

  return {
    optimizer: "lns",
    roads: new Set(requireRoadKeys(roadsSource, roadsPath)),
    services: seededServices.map((service) => ({
      r: service.r,
      c: service.c,
      rows: service.rows,
      cols: service.cols,
      range: service.range
    })),
    serviceTypeIndices,
    servicePopulationIncreases,
    residentials: seededResidentials.map((residential) => ({
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols
    })),
    residentialTypeIndices,
    populations,
    totalPopulation:
      seededSolution.totalPopulation === undefined
        ? populations.reduce((sum, population) => sum + population, 0)
        : requireInteger(seededSolution.totalPopulation, "solution.totalPopulation")
  };
}

export function materializeValidLnsSeedSolution(
  G: Grid,
  params: SolverParams,
  seedHint?: CpSatWarmStartHint
): Solution | null {
  if (seedHint) {
    const seed = requireRecord(seedHint, "seedHint");
    if (seed.modelFingerprint !== undefined) {
      if (typeof seed.modelFingerprint !== "string") {
        throw new SolverInputError("LNS seed hint modelFingerprint must be a string.");
      }
      const expectedFingerprint = computeCpSatRequestFingerprint(G, params);
      if (seed.modelFingerprint !== expectedFingerprint) {
        throw new SolverInputError("LNS seed hint is stale for the current grid or building settings.");
      }
    }
  }

  const incumbent = materializeLnsSeedSolution(seedHint);
  if (!incumbent) return null;

  assertValidReusableSolution(G, params, incumbent, "LNS seed hint", "LNS seed hint does not describe a valid layout.");
  return incumbent;
}

export function assertValidSerializedServicePlacement(value: unknown, path: string): void {
  const service = requireValidationRecord(value, path);
  requireValidationInteger(service, "r", `${path}.r`);
  requireValidationInteger(service, "c", `${path}.c`);
  requireValidationInteger(service, "rows", `${path}.rows`, 1);
  requireValidationInteger(service, "cols", `${path}.cols`, 1);
  requireValidationInteger(service, "range", `${path}.range`);
}

export function assertValidSerializedResidentialPlacement(value: unknown, path: string): void {
  const residential = requireValidationRecord(value, path);
  requireValidationInteger(residential, "r", `${path}.r`);
  requireValidationInteger(residential, "c", `${path}.c`);
  requireValidationInteger(residential, "rows", `${path}.rows`, 1);
  requireValidationInteger(residential, "cols", `${path}.cols`, 1);
}

export function assertValidSerializedSolutionPayload(
  value: unknown,
  path = "Serialized solution"
): asserts value is SerializedSolution {
  const solution = requireValidationRecord(value, path);
  requireValidationRoadKeys(solution.roads, `${path}.roads`);
  const services = requireValidationArray(solution.services, `${path}.services`);
  services.forEach((service, index) => assertValidSerializedServicePlacement(service, `${path}.services[${index}]`));
  const serviceTypeIndices = requireValidationArray(solution.serviceTypeIndices, `${path}.serviceTypeIndices`);
  if (serviceTypeIndices.length !== services.length) {
    throw new SolverInputError(`${path}.serviceTypeIndices must match ${path}.services length.`);
  }
  serviceTypeIndices.forEach((typeIndex, index) => {
    if (!isInteger(typeIndex, NO_TYPE_INDEX)) {
      throw new SolverInputError(`${path}.serviceTypeIndices[${index}] must be ${describeMinimum(NO_TYPE_INDEX)}.`);
    }
  });
  const servicePopulationIncreases = requireValidationArray(
    solution.servicePopulationIncreases,
    `${path}.servicePopulationIncreases`
  );
  if (servicePopulationIncreases.length !== services.length) {
    throw new SolverInputError(`${path}.servicePopulationIncreases must match ${path}.services length.`);
  }
  servicePopulationIncreases.forEach((bonus, index) => {
    if (!isInteger(bonus)) {
      throw new SolverInputError(`${path}.servicePopulationIncreases[${index}] must be ${describeMinimum(0)}.`);
    }
  });
  const residentials = requireValidationArray(solution.residentials, `${path}.residentials`);
  residentials.forEach((residential, index) =>
    assertValidSerializedResidentialPlacement(residential, `${path}.residentials[${index}]`)
  );
  const residentialTypeIndices = requireValidationArray(
    solution.residentialTypeIndices,
    `${path}.residentialTypeIndices`
  );
  if (residentialTypeIndices.length !== residentials.length) {
    throw new SolverInputError(`${path}.residentialTypeIndices must match ${path}.residentials length.`);
  }
  residentialTypeIndices.forEach((typeIndex, index) => {
    if (!isInteger(typeIndex, NO_TYPE_INDEX)) {
      throw new SolverInputError(`${path}.residentialTypeIndices[${index}] must be ${describeMinimum(NO_TYPE_INDEX)}.`);
    }
  });
  const populations = requireValidationArray(solution.populations, `${path}.populations`);
  if (populations.length !== residentials.length) {
    throw new SolverInputError(`${path}.populations must match ${path}.residentials length.`);
  }
  populations.forEach((population, index) => {
    if (!isInteger(population)) {
      throw new SolverInputError(`${path}.populations[${index}] must be ${describeMinimum(0)}.`);
    }
  });
  requireValidationInteger(solution, "totalPopulation", `${path}.totalPopulation`);
}

export function assertValidProblemDefinitionServiceType(value: unknown, path: string): void {
  const service = requireValidationRecord(value, path);
  requireOptionalString(service, "name", `${path}.name`);
  requireValidationInteger(service, "rows", `${path}.rows`, 1);
  requireValidationInteger(service, "cols", `${path}.cols`, 1);
  requireValidationInteger(service, "bonus", `${path}.bonus`);
  requireValidationInteger(service, "range", `${path}.range`);
  requireValidationInteger(service, "avail", `${path}.avail`);
  requireOptionalBoolean(service, "allowRotation", `${path}.allowRotation`);
}

export function assertValidProblemDefinitionResidentialType(value: unknown, path: string): void {
  const residential = requireValidationRecord(value, path);
  requireOptionalString(residential, "name", `${path}.name`);
  requireValidationInteger(residential, "w", `${path}.w`, 1);
  requireValidationInteger(residential, "h", `${path}.h`, 1);
  requireValidationInteger(residential, "min", `${path}.min`);
  requireValidationInteger(residential, "max", `${path}.max`);
  requireValidationInteger(residential, "avail", `${path}.avail`);
  if (Number(residential.max) < Number(residential.min)) {
    throw new SolverInputError(`${path}.max must be >= ${path}.min.`);
  }
}

export function assertValidResidentialSetting(value: unknown, path: string): void {
  const setting = requireValidationRecord(value, path);
  requireValidationInteger(setting, "min", `${path}.min`);
  requireValidationInteger(setting, "max", `${path}.max`);
  if (Number(setting.max) < Number(setting.min)) {
    throw new SolverInputError(`${path}.max must be >= ${path}.min.`);
  }
}

export function assertValidProblemDefinition(params: SolverParams): void {
  const paramsRecord = requireValidationRecord(params, "Solver params");
  const optimizer = paramsRecord.optimizer;
  if (optimizer !== undefined && !isOptimizerName(optimizer)) {
    throw new SolverInputError("Solver params optimizer must be one of auto, greedy, cp-sat, or lns.");
  }

  if (paramsRecord.serviceTypes !== undefined) {
    requireValidationArray(paramsRecord.serviceTypes, "Problem definition serviceTypes").forEach((service, index) => {
      assertValidProblemDefinitionServiceType(service, `Problem definition serviceTypes[${index}]`);
    });
  }
  if (paramsRecord.residentialTypes !== undefined) {
    requireValidationArray(paramsRecord.residentialTypes, "Problem definition residentialTypes").forEach(
      (residential, index) => {
        assertValidProblemDefinitionResidentialType(residential, `Problem definition residentialTypes[${index}]`);
      }
    );
  }
  if (paramsRecord.availableBuildings !== undefined) {
    const availableBuildings = requireValidationRecord(
      paramsRecord.availableBuildings,
      "Problem definition availableBuildings"
    );
    requireOptionalIntegerForValidation(
      availableBuildings,
      "services",
      "Problem definition availableBuildings.services"
    );
    requireOptionalIntegerForValidation(
      availableBuildings,
      "residentials",
      "Problem definition availableBuildings.residentials"
    );
  }
  requireOptionalIntegerForValidation(paramsRecord, "maxServices", "Problem definition maxServices");
  requireOptionalIntegerForValidation(paramsRecord, "maxResidentials", "Problem definition maxResidentials");
  requireOptionalIntegerForValidation(paramsRecord, "basePop", "Problem definition basePop");
  requireOptionalIntegerForValidation(paramsRecord, "maxPop", "Problem definition maxPop");
  if (
    typeof paramsRecord.basePop === "number" &&
    typeof paramsRecord.maxPop === "number" &&
    paramsRecord.maxPop < paramsRecord.basePop
  ) {
    throw new SolverInputError("Problem definition maxPop must be >= basePop.");
  }
  if (paramsRecord.residentialSettings !== undefined) {
    const settings = requireValidationRecord(
      paramsRecord.residentialSettings,
      "Problem definition residentialSettings"
    );
    for (const [key, setting] of Object.entries(settings)) {
      if (!/^[1-9]\d*x[1-9]\d*$/.test(key)) {
        throw new SolverInputError(`Problem definition residentialSettings key "${key}" must be like "2x3".`);
      }
      assertValidResidentialSetting(setting, `Problem definition residentialSettings.${key}`);
    }
  }
}

export function getOptionalFinitePositiveNumber(parent: Record<string, unknown>, key: string): number | undefined {
  const value = parent[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function getOptionalIntegerInRange(
  parent: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number | undefined {
  const value = parent[key];
  return Number.isInteger(value) && typeof value === "number" && value >= minimum && value <= maximum
    ? value
    : undefined;
}
