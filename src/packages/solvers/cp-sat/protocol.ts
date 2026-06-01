import type {
  CpSatModelSizeTelemetry,
  CpSatObjectivePolicy,
  CpSatPortfolioSummary,
  CpSatPortfolioWorkerSummary,
  CpSatProgressKind,
  CpSatTelemetry
} from "../../core/index.js";

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

export interface CpSatRawSolution {
  roads: string[];
  services: CpSatServicePlacement[];
  residentials: CpSatResidentialPlacement[];
  populations: number[];
  totalPopulation: number;
  status: string;
  objectivePolicy?: CpSatObjectivePolicy;
  telemetry?: CpSatTelemetry;
  portfolio?: CpSatPortfolioSummary;
  stoppedByUser?: boolean;
}

interface CpSatRawProgressEvent {
  event: "progress";
  kind: CpSatProgressKind;
  telemetry?: CpSatTelemetry;
  worker?: CpSatPortfolioWorkerSummary;
}

interface CpSatRawResultEvent {
  event: "result";
  payload: CpSatRawSolution;
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

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be a boolean.`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be an array.`);
  }
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`));
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

function parseCpSatObjectivePolicy(value: unknown): CpSatObjectivePolicy {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: objectivePolicy must be an object.");
  }
  return {
    populationWeight: expectInteger(value.populationWeight, "objectivePolicy.populationWeight"),
    maxTieBreakPenalty: expectInteger(value.maxTieBreakPenalty, "objectivePolicy.maxTieBreakPenalty"),
    summary: expectString(value.summary, "objectivePolicy.summary")
  };
}

function parseCpSatModelSizeTelemetry(value: unknown): CpSatModelSizeTelemetry {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: telemetry.modelSize must be an object.");
  }
  return {
    variableCount: expectInteger(value.variableCount, "telemetry.modelSize.variableCount"),
    booleanVariableCount: expectInteger(value.booleanVariableCount, "telemetry.modelSize.booleanVariableCount"),
    constraintCount: expectInteger(value.constraintCount, "telemetry.modelSize.constraintCount"),
    allowedCellCount: expectInteger(value.allowedCellCount, "telemetry.modelSize.allowedCellCount"),
    roadEligibleCellCount: expectInteger(value.roadEligibleCellCount, "telemetry.modelSize.roadEligibleCellCount"),
    roadVariableCount: expectInteger(value.roadVariableCount, "telemetry.modelSize.roadVariableCount"),
    rootVariableCount: expectInteger(value.rootVariableCount, "telemetry.modelSize.rootVariableCount"),
    directedEdgeCount: expectInteger(value.directedEdgeCount, "telemetry.modelSize.directedEdgeCount"),
    serviceCandidateCount: expectInteger(value.serviceCandidateCount, "telemetry.modelSize.serviceCandidateCount"),
    residentialCandidateCount: expectInteger(
      value.residentialCandidateCount,
      "telemetry.modelSize.residentialCandidateCount"
    ),
    populationVariableCount: expectInteger(value.populationVariableCount, "telemetry.modelSize.populationVariableCount")
  };
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
    incumbentPopulation:
      value.incumbentPopulation === null
        ? null
        : expectInteger(value.incumbentPopulation, "telemetry.incumbentPopulation"),
    bestPopulationUpperBound:
      value.bestPopulationUpperBound === null
        ? null
        : expectInteger(value.bestPopulationUpperBound, "telemetry.bestPopulationUpperBound"),
    populationGapUpperBound:
      value.populationGapUpperBound === null
        ? null
        : expectInteger(value.populationGapUpperBound, "telemetry.populationGapUpperBound"),
    lastImprovementAtSeconds: expectNullableNumber(
      value.lastImprovementAtSeconds,
      "telemetry.lastImprovementAtSeconds"
    ),
    secondsSinceLastImprovement: expectNullableNumber(
      value.secondsSinceLastImprovement,
      "telemetry.secondsSinceLastImprovement"
    ),
    numBranches: expectInteger(value.numBranches, "telemetry.numBranches"),
    numConflicts: expectInteger(value.numConflicts, "telemetry.numConflicts"),
    modelSize:
      value.modelSize === undefined || value.modelSize === null ? null : parseCpSatModelSizeTelemetry(value.modelSize)
  };
}

function parseCpSatPortfolioWorkerSummary(value: unknown, index: number): CpSatPortfolioWorkerSummary {
  if (!isRecord(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: portfolio.workers[${index}] must be an object.`);
  }
  return {
    workerIndex: expectInteger(value.workerIndex, `portfolio.workers[${index}].workerIndex`),
    randomSeed:
      value.randomSeed === null ? null : expectInteger(value.randomSeed, `portfolio.workers[${index}].randomSeed`),
    randomizeSearch: expectBoolean(value.randomizeSearch, `portfolio.workers[${index}].randomizeSearch`),
    numWorkers: expectInteger(value.numWorkers, `portfolio.workers[${index}].numWorkers`),
    status: expectString(value.status, `portfolio.workers[${index}].status`),
    feasible: expectBoolean(value.feasible, `portfolio.workers[${index}].feasible`),
    totalPopulation:
      value.totalPopulation === null
        ? null
        : expectInteger(value.totalPopulation, `portfolio.workers[${index}].totalPopulation`),
    telemetry: value.telemetry === undefined || value.telemetry === null ? null : parseCpSatTelemetry(value.telemetry)
  };
}

function parseCpSatPortfolioSummary(value: unknown): CpSatPortfolioSummary {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio must be an object.");
  }
  if (!Array.isArray(value.workers)) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.workers must be an array.");
  }
  const workerCount = expectInteger(value.workerCount, "portfolio.workerCount");
  const selectedWorkerIndex =
    value.selectedWorkerIndex === null
      ? null
      : expectInteger(value.selectedWorkerIndex, "portfolio.selectedWorkerIndex");
  const workers = value.workers.map((entry, index) => parseCpSatPortfolioWorkerSummary(entry, index));
  if (workers.length !== workerCount) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.workerCount must match workers length.");
  }
  if (new Set(workers.map((worker) => worker.workerIndex)).size !== workers.length) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.workers must have unique workerIndex values.");
  }
  if (selectedWorkerIndex !== null && !workers.some((worker) => worker.workerIndex === selectedWorkerIndex)) {
    throw new Error(
      "CP-SAT backend returned invalid JSON: portfolio.selectedWorkerIndex must reference a listed worker."
    );
  }
  return {
    workerCount,
    selectedWorkerIndex,
    workers
  };
}

function expectCpSatProgressKind(value: unknown, label: string): CpSatProgressKind {
  if (value === "incumbent" || value === "bound" || value === "portfolio-worker-complete") {
    return value;
  }
  throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be a known progress kind.`);
}

function parseCpSatProgressUpdate(value: unknown): Omit<CpSatRawProgressEvent, "event"> {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: progress event must be an object.");
  }
  return {
    kind: expectCpSatProgressKind(value.kind, "progress.kind"),
    telemetry: value.telemetry === undefined ? undefined : parseCpSatTelemetry(value.telemetry),
    worker: value.worker === undefined ? undefined : parseCpSatPortfolioWorkerSummary(value.worker, 0)
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
    typeIndex: expectInteger(value.typeIndex, `services[${index}].typeIndex`)
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
    population: expectInteger(value.population, `residentials[${index}].population`)
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
  const objectivePolicy =
    value.objectivePolicy === undefined ? undefined : parseCpSatObjectivePolicy(value.objectivePolicy);
  const telemetry = value.telemetry === undefined ? undefined : parseCpSatTelemetry(value.telemetry);
  const portfolio = value.portfolio === undefined ? undefined : parseCpSatPortfolioSummary(value.portfolio);
  const stoppedByUser =
    value.stoppedByUser === undefined ? undefined : expectBoolean(value.stoppedByUser, "stoppedByUser");

  if (populations.length !== residentials.length) {
    throw new Error("CP-SAT backend returned invalid JSON: populations length must match residentials length.");
  }
  if (totalPopulation !== populations.reduce((sum, population) => sum + population, 0)) {
    throw new Error("CP-SAT backend returned invalid JSON: totalPopulation must equal the population sum.");
  }

  return {
    roads,
    services,
    residentials,
    populations,
    totalPopulation,
    status,
    objectivePolicy,
    telemetry,
    portfolio,
    stoppedByUser
  };
}

export function parseCpSatStreamEvent(line: string): CpSatRawProgressEvent | CpSatRawResultEvent {
  const value = JSON.parse(line) as unknown;
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: stream event must be an object.");
  }
  const event = expectString(value.event, "stream.event");
  if (event === "progress") {
    const update = parseCpSatProgressUpdate(value);
    return {
      event,
      kind: update.kind,
      telemetry: update.telemetry,
      worker: update.worker
    };
  }
  if (event === "result") {
    return {
      event,
      payload: normalizeCpSatRawSolution(value.payload)
    };
  }
  throw new Error("CP-SAT backend returned invalid JSON: unknown stream event type.");
}

export function parseCpSatRawSolution(stdout: string): CpSatRawSolution {
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
