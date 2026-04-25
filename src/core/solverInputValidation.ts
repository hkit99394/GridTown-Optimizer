/**
 * Validation helpers for client-supplied solver params that need clearer
 * request-level errors than generic backend failures.
 */

import { validateSolution } from "./evaluator.js";
import { NO_TYPE_INDEX } from "./rules.js";

import type { CpSatWarmStartHint, Grid, Solution, SolverParams } from "./types.js";

export const SOLVER_INPUT_ERROR_PREFIX = "Invalid solver input:";

const GREEDY_RANDOM_SEED_MAX = 0x7fffffff;
const GREEDY_MAX_RESTARTS = 100;
const GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS = 100;
const GREEDY_MAX_SERVICE_CANDIDATE_LIMIT = 2_000;
const GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT = 64;
const GREEDY_MAX_SERVICE_EXACT_COMBINATIONS = 100_000;
const GREEDY_MAX_TIME_LIMIT_SECONDS = 24 * 60 * 60;

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

function resolveOptimizerName(params: Pick<SolverParams, "optimizer"> | null | undefined): SolverParams["optimizer"] | "greedy" {
  if (params?.optimizer === "auto" || params?.optimizer === "cp-sat" || params?.optimizer === "lns") return params.optimizer;
  return "greedy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isFiniteNumber(value: unknown, minimum: number, allowMinimum: boolean): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && (allowMinimum ? value >= minimum : value > minimum);
}

function describeMinimum(minimum: number): string {
  return `an integer >= ${minimum}`;
}

function describeIntegerRange(minimum: number, maximum: number): string {
  return `an integer between ${minimum} and ${maximum}`;
}

function describeNumberMinimum(minimum: number, allowMinimum: boolean): string {
  return `a finite number ${allowMinimum ? ">=" : ">"} ${minimum}`;
}

function describeNumberRange(minimum: number, allowMinimum: boolean, maximum: number): string {
  return `a finite number ${allowMinimum ? ">=" : ">"} ${minimum} and <= ${maximum}`;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SolverInputError(`LNS seed hint ${path} must be an object.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SolverInputError(`LNS seed hint ${path} must be an array.`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum = 0): number {
  if (!isInteger(value, minimum)) {
    throw new SolverInputError(`LNS seed hint ${path} must be ${describeMinimum(minimum)}.`);
  }
  return value;
}

function requireValidationRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new SolverInputError(`${path} must be an object.`);
  }
  return value;
}

function requireOptionalBoolean(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new SolverInputError(`${path} must be a boolean.`);
  }
}

function requireOptionalString(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value !== undefined && typeof value !== "string") {
    throw new SolverInputError(`${path} must be a string.`);
  }
}

function requireOptionalFiniteNumber(
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

function requireOptionalFiniteNumberInRange(
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

function requireOptionalIntegerForValidation(
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

function requireOptionalIntegerInRange(
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

function requireValidationInteger(parent: Record<string, unknown>, key: string, path: string, minimum = 0): void {
  const value = parent[key];
  if (!isInteger(value, minimum)) {
    throw new SolverInputError(`${path} must be ${describeMinimum(minimum)}.`);
  }
}

function requireValidationArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SolverInputError(`${path} must be an array.`);
  }
  return value;
}

function requireOptionalRoadKeys(parent: Record<string, unknown>, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) return;
  requireValidationArray(value, path).forEach((entry, index) => {
    if (!isRoadKey(entry)) {
      throw new SolverInputError(`${path}[${index}] must be a road key like "r,c".`);
    }
  });
}

function requireCandidateKeys(
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

function assertValidCpSatWarmStartService(value: unknown, path: string, requireTypedMetadata: boolean): void {
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

function assertValidCpSatWarmStartResidential(value: unknown, path: string, requirePopulation: boolean): void {
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

function assertValidCpSatNeighborhoodWindow(value: unknown, path: string): void {
  const window = requireValidationRecord(value, path);
  requireValidationInteger(window, "top", `${path}.top`);
  requireValidationInteger(window, "left", `${path}.left`);
  requireValidationInteger(window, "rows", `${path}.rows`, 1);
  requireValidationInteger(window, "cols", `${path}.cols`, 1);
}

function assertValidCpSatWarmStartSolution(value: unknown, path: string): void {
  const solution = requireValidationRecord(value, path);
  requireOptionalRoadKeys(solution, "roads", `${path}.roads`);
  const services = solution.services === undefined
    ? undefined
    : requireValidationArray(solution.services, `${path}.services`);
  services?.forEach((service, index) => {
    assertValidCpSatWarmStartService(service, `${path}.services[${index}]`, true);
  });
  const residentials = solution.residentials === undefined
    ? undefined
    : requireValidationArray(solution.residentials, `${path}.residentials`);
  residentials?.forEach((residential, index) => {
    assertValidCpSatWarmStartResidential(residential, `${path}.residentials[${index}]`, true);
  });
  const populations = solution.populations === undefined
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

function assertValidCpSatWarmStartHint(value: unknown, path: string): void {
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
  const residentials = hint.residentials === undefined
    ? undefined
    : requireValidationArray(hint.residentials, `${path}.residentials`);
  residentials?.forEach((residential, index) => {
    assertValidCpSatWarmStartResidential(residential, `${path}.residentials[${index}]`, false);
  });
}

function isRoadKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [row, col, ...rest] = value.split(",");
  return rest.length === 0
    && Number.isInteger(Number(row))
    && Number(row) >= 0
    && Number.isInteger(Number(col))
    && Number(col) >= 0;
}

function requireRoadKeys(value: unknown, path: string): string[] {
  const roads = requireArray(value, path);
  roads.forEach((road, index) => {
    if (!isRoadKey(road)) {
      throw new SolverInputError(`LNS seed hint ${path}[${index}] must be a road key like "r,c".`);
    }
  });
  return roads as string[];
}

function materializeSeedService(
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
    bonus: requireInteger(service.bonus, `solution.services[${index}].bonus`),
  };
}

function materializeSeedResidential(
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
    population: requireInteger(residential.population, `solution.residentials[${index}].population`),
  };
}

function materializeLnsSeedSolution(seedHint?: CpSatWarmStartHint): Solution | null {
  if (!seedHint) return null;
  if (seedHint.solution === undefined) {
    throw new SolverInputError("LNS seed hint is missing the saved solution payload.");
  }

  const seededSolution = requireRecord(seedHint.solution, "solution");
  const seededServices = requireArray(seededSolution.services, "solution.services").map(materializeSeedService);
  const seededResidentials = requireArray(seededSolution.residentials, "solution.residentials").map(materializeSeedResidential);
  const serviceTypeIndices = seededServices.map((service) => service.typeIndex);
  const servicePopulationIncreases = seededServices.map((service) => service.bonus);
  const residentialTypeIndices = seededResidentials.map((residential) => residential.typeIndex);
  const populations = seededSolution.populations === undefined
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
      range: service.range,
    })),
    serviceTypeIndices,
    servicePopulationIncreases,
    residentials: seededResidentials.map((residential) => ({
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols,
    })),
    residentialTypeIndices,
    populations,
    totalPopulation: seededSolution.totalPopulation === undefined
      ? populations.reduce((sum, population) => sum + population, 0)
      : requireInteger(seededSolution.totalPopulation, "solution.totalPopulation"),
  };
}

export function materializeValidLnsSeedSolution(
  G: Grid,
  params: SolverParams,
  seedHint?: CpSatWarmStartHint
): Solution | null {
  const incumbent = materializeLnsSeedSolution(seedHint);
  if (!incumbent) return null;

  const seedValidation = validateSolution({
    grid: G,
    solution: incumbent,
    params,
  });
  if (!seedValidation.valid) {
    const detail = seedValidation.errors.length
      ? seedValidation.errors.join(" ")
      : "LNS seed hint does not describe a valid layout.";
    throw new SolverInputError(`LNS seed hint is invalid: ${detail}`);
  }
  return incumbent;
}

function assertValidCpSatPortfolioOptions(value: unknown, path: string): void {
  const portfolio = requireValidationRecord(value, path);
  requireOptionalIntegerForValidation(portfolio, "workerCount", `${path}.workerCount`, 1);
  if (portfolio.randomSeeds !== undefined) {
    requireValidationArray(portfolio.randomSeeds, `${path}.randomSeeds`).forEach((seed, index) => {
      if (!isInteger(seed)) {
        throw new SolverInputError(`${path}.randomSeeds[${index}] must be ${describeMinimum(0)}.`);
      }
    });
  }
  requireOptionalFiniteNumber(portfolio, "perWorkerTimeLimitSeconds", `${path}.perWorkerTimeLimitSeconds`, 0);
  requireOptionalFiniteNumber(portfolio, "perWorkerMaxDeterministicTime", `${path}.perWorkerMaxDeterministicTime`, 0);
  requireOptionalIntegerForValidation(portfolio, "perWorkerNumWorkers", `${path}.perWorkerNumWorkers`, 1);
  requireOptionalBoolean(portfolio, "randomizeSearch", `${path}.randomizeSearch`);
}

function assertValidCpSatOptions(params: SolverParams): void {
  const cpSatValue = (params as Record<string, unknown>).cpSat;
  if (cpSatValue === undefined) return;

  const cpSat = requireValidationRecord(cpSatValue, "CP-SAT options cpSat");
  requireOptionalString(cpSat, "pythonExecutable", "CP-SAT runtime option cpSat.pythonExecutable");
  requireOptionalString(cpSat, "scriptPath", "CP-SAT runtime option cpSat.scriptPath");
  requireOptionalFiniteNumber(cpSat, "timeLimitSeconds", "CP-SAT runtime option cpSat.timeLimitSeconds", 0);
  requireOptionalFiniteNumber(cpSat, "maxDeterministicTime", "CP-SAT runtime option cpSat.maxDeterministicTime", 0);
  requireOptionalIntegerForValidation(cpSat, "numWorkers", "CP-SAT runtime option cpSat.numWorkers", 1);
  requireOptionalIntegerForValidation(cpSat, "randomSeed", "CP-SAT runtime option cpSat.randomSeed");
  requireOptionalBoolean(cpSat, "randomizeSearch", "CP-SAT runtime option cpSat.randomizeSearch");
  requireOptionalFiniteNumber(cpSat, "relativeGapLimit", "CP-SAT runtime option cpSat.relativeGapLimit", 0, true);
  requireOptionalFiniteNumber(cpSat, "absoluteGapLimit", "CP-SAT runtime option cpSat.absoluteGapLimit", 0, true);
  requireOptionalFiniteNumber(
    cpSat,
    "noImprovementTimeoutSeconds",
    "CP-SAT runtime option cpSat.noImprovementTimeoutSeconds",
    0
  );
  requireOptionalIntegerForValidation(cpSat, "objectiveLowerBound", "CP-SAT runtime option cpSat.objectiveLowerBound");
  requireOptionalBoolean(cpSat, "streamProgress", "CP-SAT runtime option cpSat.streamProgress");
  requireOptionalFiniteNumber(cpSat, "progressIntervalSeconds", "CP-SAT runtime option cpSat.progressIntervalSeconds", 0, true);
  requireOptionalBoolean(cpSat, "logSearchProgress", "CP-SAT runtime option cpSat.logSearchProgress");
  requireOptionalString(cpSat, "stopFilePath", "CP-SAT runtime option cpSat.stopFilePath");
  requireOptionalString(cpSat, "snapshotFilePath", "CP-SAT runtime option cpSat.snapshotFilePath");

  if (cpSat.warmStartHint !== undefined) {
    assertValidCpSatWarmStartHint(cpSat.warmStartHint, "CP-SAT warm-start hint cpSat.warmStartHint");
  }
  if (cpSat.portfolio !== undefined) {
    assertValidCpSatPortfolioOptions(cpSat.portfolio, "CP-SAT portfolio option cpSat.portfolio");
  }
}

function assertValidGreedyOptions(params: SolverParams): void {
  const paramsRecord = params as Record<string, unknown>;
  const greedyValue = paramsRecord.greedy;
  const greedy = greedyValue === undefined
    ? undefined
    : requireValidationRecord(greedyValue, "Greedy options greedy");

  if (greedy) {
    requireOptionalBoolean(greedy, "localSearch", "Greedy option greedy.localSearch");
    requireOptionalBoolean(greedy, "localSearchServiceMoves", "Greedy option greedy.localSearchServiceMoves");
    requireOptionalIntegerInRange(
      greedy,
      "localSearchServiceCandidateLimit",
      "Greedy option greedy.localSearchServiceCandidateLimit",
      1,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceLookaheadCandidates",
      "Greedy option greedy.serviceLookaheadCandidates",
      0,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalBoolean(greedy, "deferRoadCommitment", "Greedy option greedy.deferRoadCommitment");
    requireOptionalIntegerInRange(
      greedy,
      "randomSeed",
      "Greedy option greedy.randomSeed",
      0,
      GREEDY_RANDOM_SEED_MAX
    );
    requireOptionalBoolean(greedy, "profile", "Greedy option greedy.profile");
    requireOptionalFiniteNumberInRange(
      greedy,
      "timeLimitSeconds",
      "Greedy option greedy.timeLimitSeconds",
      0,
      GREEDY_MAX_TIME_LIMIT_SECONDS
    );
    requireOptionalIntegerInRange(
      greedy,
      "restarts",
      "Greedy option greedy.restarts",
      1,
      GREEDY_MAX_RESTARTS
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceRefineIterations",
      "Greedy option greedy.serviceRefineIterations",
      0,
      GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceRefineCandidateLimit",
      "Greedy option greedy.serviceRefineCandidateLimit",
      1,
      GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
    );
    requireOptionalBoolean(greedy, "exhaustiveServiceSearch", "Greedy option greedy.exhaustiveServiceSearch");
    requireOptionalIntegerInRange(
      greedy,
      "serviceExactPoolLimit",
      "Greedy option greedy.serviceExactPoolLimit",
      1,
      GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT
    );
    requireOptionalIntegerInRange(
      greedy,
      "serviceExactMaxCombinations",
      "Greedy option greedy.serviceExactMaxCombinations",
      1,
      GREEDY_MAX_SERVICE_EXACT_COMBINATIONS
    );
    requireOptionalString(greedy, "stopFilePath", "Greedy option greedy.stopFilePath");
    requireOptionalString(greedy, "snapshotFilePath", "Greedy option greedy.snapshotFilePath");
  }

  requireOptionalBoolean(paramsRecord, "localSearch", "Legacy greedy option localSearch");
  requireOptionalIntegerInRange(
    paramsRecord,
    "restarts",
    "Legacy greedy option restarts",
    1,
    GREEDY_MAX_RESTARTS
  );
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceRefineIterations",
    "Legacy greedy option serviceRefineIterations",
    0,
    GREEDY_MAX_SERVICE_REFINEMENT_ITERATIONS
  );
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceRefineCandidateLimit",
    "Legacy greedy option serviceRefineCandidateLimit",
    1,
    GREEDY_MAX_SERVICE_CANDIDATE_LIMIT
  );
  requireOptionalBoolean(paramsRecord, "exhaustiveServiceSearch", "Legacy greedy option exhaustiveServiceSearch");
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceExactPoolLimit",
    "Legacy greedy option serviceExactPoolLimit",
    1,
    GREEDY_MAX_SERVICE_EXACT_POOL_LIMIT
  );
  requireOptionalIntegerInRange(
    paramsRecord,
    "serviceExactMaxCombinations",
    "Legacy greedy option serviceExactMaxCombinations",
    1,
    GREEDY_MAX_SERVICE_EXACT_COMBINATIONS
  );
}

export function assertValidSolveInputs(G: Grid, params: SolverParams): void {
  const optimizer = resolveOptimizerName(params);
  assertValidCpSatOptions(params);
  assertValidGreedyOptions(params);
  if (optimizer !== "lns" && optimizer !== "auto") return;
  materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
}
