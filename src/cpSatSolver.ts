/**
 * CP-SAT solver bridge. The optimization model lives in python/cp_sat_solver.py
 * because Google OR-Tools exposes CP-SAT officially in Python rather than Node.js.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type {
  CpSatObjectivePolicy,
  CpSatTelemetry,
  CpSatWarmStartHint,
  EvaluatedServicePlacement,
  Grid,
  SolverParams,
  Solution,
} from "./types.js";
import { evaluateLayout } from "./evaluator.js";
import { roadsConnectedToRow0 } from "./roads.js";

interface CpSatResidentialPlacement {
  r: number;
  c: number;
  rows: number;
  cols: number;
  typeIndex: number;
  population: number;
}

interface CpSatServicePlacement {
  r: number;
  rows: number;
  cols: number;
  range: number;
  c: number;
  bonus: number;
  typeIndex: number;
}

interface CpSatRawSolution {
  roads: string[];
  services: CpSatServicePlacement[];
  residentials: CpSatResidentialPlacement[];
  populations: number[];
  totalPopulation: number;
  status: string;
  objectivePolicy?: CpSatObjectivePolicy;
  telemetry?: CpSatTelemetry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be an integer.`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be a string.`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be an array.`);
  }
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`));
}

function parseCpSatObjectivePolicy(value: unknown): CpSatObjectivePolicy {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: objectivePolicy must be an object.");
  }
  return {
    populationWeight: expectInteger(value.populationWeight, "objectivePolicy.populationWeight"),
    maxTieBreakPenalty: expectInteger(value.maxTieBreakPenalty, "objectivePolicy.maxTieBreakPenalty"),
    summary: expectString(value.summary, "objectivePolicy.summary"),
  };
}

function expectNullableNumber(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be a finite number or null.`);
  }
  return value;
}

function parseCpSatTelemetry(value: unknown): CpSatTelemetry {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: telemetry must be an object.");
  }
  return {
    solveWallTimeSeconds: expectNullableNumber(value.solveWallTimeSeconds, "telemetry.solveWallTimeSeconds") ?? 0,
    userTimeSeconds: expectNullableNumber(value.userTimeSeconds, "telemetry.userTimeSeconds") ?? 0,
    solutionCount: expectInteger(value.solutionCount, "telemetry.solutionCount"),
    incumbentObjectiveValue: expectNullableNumber(value.incumbentObjectiveValue, "telemetry.incumbentObjectiveValue"),
    bestObjectiveBound: expectNullableNumber(value.bestObjectiveBound, "telemetry.bestObjectiveBound"),
    objectiveGap: expectNullableNumber(value.objectiveGap, "telemetry.objectiveGap"),
    incumbentPopulation: value.incumbentPopulation === null ? null : expectInteger(value.incumbentPopulation, "telemetry.incumbentPopulation"),
    bestPopulationUpperBound:
      value.bestPopulationUpperBound === null
        ? null
        : expectInteger(value.bestPopulationUpperBound, "telemetry.bestPopulationUpperBound"),
    populationGapUpperBound:
      value.populationGapUpperBound === null
        ? null
        : expectInteger(value.populationGapUpperBound, "telemetry.populationGapUpperBound"),
    lastImprovementAtSeconds: expectNullableNumber(value.lastImprovementAtSeconds, "telemetry.lastImprovementAtSeconds"),
    secondsSinceLastImprovement: expectNullableNumber(
      value.secondsSinceLastImprovement,
      "telemetry.secondsSinceLastImprovement"
    ),
    numBranches: expectInteger(value.numBranches, "telemetry.numBranches"),
    numConflicts: expectInteger(value.numConflicts, "telemetry.numConflicts"),
  };
}

function parseCpSatServicePlacement(value: unknown, index: number): CpSatServicePlacement {
  if (!isRecord(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: services[${index}] must be an object.`);
  }
  return {
    r: expectInteger(value.r, `services[${index}].r`),
    c: expectInteger(value.c, `services[${index}].c`),
    rows: expectInteger(value.rows, `services[${index}].rows`),
    cols: expectInteger(value.cols, `services[${index}].cols`),
    range: expectInteger(value.range, `services[${index}].range`),
    bonus: expectInteger(value.bonus, `services[${index}].bonus`),
    typeIndex: expectInteger(value.typeIndex, `services[${index}].typeIndex`),
  };
}

function parseCpSatResidentialPlacement(value: unknown, index: number): CpSatResidentialPlacement {
  if (!isRecord(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: residentials[${index}] must be an object.`);
  }
  return {
    r: expectInteger(value.r, `residentials[${index}].r`),
    c: expectInteger(value.c, `residentials[${index}].c`),
    rows: expectInteger(value.rows, `residentials[${index}].rows`),
    cols: expectInteger(value.cols, `residentials[${index}].cols`),
    typeIndex: expectInteger(value.typeIndex, `residentials[${index}].typeIndex`),
    population: expectInteger(value.population, `residentials[${index}].population`),
  };
}

function normalizeCpSatRawSolution(value: unknown): CpSatRawSolution {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: top-level payload must be an object.");
  }

  const roads = expectStringArray(value.roads, "roads");
  const services = Array.isArray(value.services)
    ? value.services.map((entry, index) => parseCpSatServicePlacement(entry, index))
    : (() => {
        throw new Error("CP-SAT backend returned invalid JSON: services must be an array.");
      })();
  const residentials = Array.isArray(value.residentials)
    ? value.residentials.map((entry, index) => parseCpSatResidentialPlacement(entry, index))
    : (() => {
        throw new Error("CP-SAT backend returned invalid JSON: residentials must be an array.");
      })();
  const populations = Array.isArray(value.populations)
    ? value.populations.map((entry, index) => expectInteger(entry, `populations[${index}]`))
    : (() => {
        throw new Error("CP-SAT backend returned invalid JSON: populations must be an array.");
      })();
  const totalPopulation = expectInteger(value.totalPopulation, "totalPopulation");
  const status = expectString(value.status, "status");
  const objectivePolicy = value.objectivePolicy === undefined ? undefined : parseCpSatObjectivePolicy(value.objectivePolicy);
  const telemetry = value.telemetry === undefined ? undefined : parseCpSatTelemetry(value.telemetry);

  if (populations.length !== residentials.length) {
    throw new Error("CP-SAT backend returned invalid JSON: populations length must match residentials length.");
  }
  if (totalPopulation !== populations.reduce((sum, population) => sum + population, 0)) {
    throw new Error("CP-SAT backend returned invalid JSON: totalPopulation must equal the population sum.");
  }

  return { roads, services, residentials, populations, totalPopulation, status, objectivePolicy, telemetry };
}

function defaultPythonExecutable(): string {
  const venvPython = resolve(__dirname, "../.venv-cp-sat/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function isSolutionWarmStartHint(value: CpSatWarmStartHint | Solution): value is Solution {
  return value.roads instanceof Set;
}

function normalizeWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): CpSatWarmStartHint | undefined {
  if (!value) {
    return undefined;
  }

  if (isSolutionWarmStartHint(value)) {
    return {
      roads: [...value.roads],
      services: value.services.map((service, index) => ({
        ...service,
        typeIndex: value.serviceTypeIndices[index],
        bonus: value.servicePopulationIncreases[index],
      })),
      residentials: value.residentials.map((residential, index) => ({
        ...residential,
        typeIndex: value.residentialTypeIndices[index],
        population: value.populations[index],
      })),
      totalPopulation: value.totalPopulation,
    };
  }

  return {
    roads: [...value.roads],
    services: value.services.map((service) => ({ ...service })),
    residentials: value.residentials.map((residential) => ({ ...residential })),
    totalPopulation: value.totalPopulation,
  };
}

function buildCpSatBackendParams(params: SolverParams): SolverParams {
  if (!params.cpSat?.warmStartHint) {
    return params;
  }

  return {
    ...params,
    cpSat: {
      ...params.cpSat,
      warmStartHint: normalizeWarmStartHint(params.cpSat.warmStartHint),
    },
  };
}

function runCpSatBackend(G: Grid, params: SolverParams) {
  const pythonExecutable =
    params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  const backendParams = buildCpSatBackendParams(params);
  const request = {
    grid: G,
    params: backendParams,
  };

  const result = spawnSync(pythonExecutable, [scriptPath], {
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to launch CP-SAT backend with ${pythonExecutable}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const exitDetail = result.status === null ? `signal ${result.signal ?? "unknown"}` : `exit code ${result.status}`;
    throw new Error(
      `CP-SAT backend failed with ${exitDetail}.${stderr ? ` stderr: ${stderr}` : ""}${stdout ? ` stdout: ${stdout}` : ""}`
    );
  }

  return result.stdout;
}

function parseCpSatRawSolution(stdout: string): CpSatRawSolution {
  try {
    return normalizeCpSatRawSolution(JSON.parse(stdout) as unknown);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("CP-SAT backend returned invalid JSON:")) {
      throw error as Error;
    }
    throw new Error(`CP-SAT backend returned invalid JSON: ${message}`);
  }
}

function decodeCpSatLayout(raw: CpSatRawSolution) {
  const roads = new Set(raw.roads);
  const services: EvaluatedServicePlacement[] = raw.services.map((service) => ({
    r: service.r,
    c: service.c,
    rows: service.rows,
    cols: service.cols,
    range: service.range,
    bonus: service.bonus,
  }));
  const residentials = raw.residentials.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
  }));
  return { roads, services, residentials };
}

function validateCpSatLayout(G: Grid, params: SolverParams, raw: CpSatRawSolution): ReturnType<typeof decodeCpSatLayout> {
  const layout = decodeCpSatLayout(raw);
  const connectedRoads = roadsConnectedToRow0(G, layout.roads);
  if (connectedRoads.size === 0) {
    throw new Error("CP-SAT backend produced an invalid layout: road network does not touch row 0.");
  }
  if (connectedRoads.size !== layout.roads.size) {
    throw new Error("CP-SAT backend produced an invalid layout: some road cells are not connected to row 0.");
  }

  const evaluation = evaluateLayout({
    grid: G,
    roads: layout.roads,
    services: layout.services,
    residentials: layout.residentials,
    params,
  });
  if (!evaluation.valid) {
    throw new Error(`CP-SAT backend produced an invalid layout: ${evaluation.errors.join(" ")}`);
  }
  return layout;
}

export function solveCpSat(G: Grid, params: SolverParams): Solution {
  const raw = parseCpSatRawSolution(runCpSatBackend(G, params));
  const layout = validateCpSatLayout(G, params, raw);
  return {
    optimizer: "cp-sat",
    cpSatStatus: raw.status,
    cpSatObjectivePolicy: raw.objectivePolicy,
    cpSatTelemetry: raw.telemetry,
    roads: layout.roads,
    services: raw.services.map(({ r, c, rows, cols, range }) => ({ r, c, rows, cols, range })),
    serviceTypeIndices: raw.services.map((service) => service.typeIndex),
    servicePopulationIncreases: raw.services.map((service) => service.bonus),
    residentials: layout.residentials,
    residentialTypeIndices: raw.residentials.map((residential) => residential.typeIndex),
    populations: raw.populations,
    totalPopulation: raw.totalPopulation,
  };
}
