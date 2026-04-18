/**
 * Validation helpers for client-supplied solver params that need clearer
 * request-level errors than generic backend failures.
 */

import { validateSolution } from "./evaluator.js";
import { NO_TYPE_INDEX } from "./rules.js";

import type { CpSatWarmStartHint, Grid, Solution, SolverParams } from "./types.js";

export const SOLVER_INPUT_ERROR_PREFIX = "Invalid solver input:";

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
  if (params?.optimizer === "cp-sat" || params?.optimizer === "lns") return params.optimizer;
  return "greedy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function describeMinimum(minimum: number): string {
  return `an integer >= ${minimum}`;
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

export function assertValidSolveInputs(G: Grid, params: SolverParams): void {
  if (resolveOptimizerName(params) !== "lns") return;
  materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
}
