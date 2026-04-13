/**
 * CP-SAT solver bridge. The optimization model lives in python/cp_sat_solver.py
 * because Google OR-Tools exposes CP-SAT officially in Python rather than Node.js.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type {
  BackgroundSolveHandle,
  CpSatAsyncOptions,
  CpSatObjectivePolicy,
  CpSatProgressKind,
  CpSatProgressUpdate,
  CpSatPortfolioSummary,
  CpSatPortfolioWorkerSummary,
  CpSatTelemetry,
  CpSatWarmStartHint,
  EvaluatedServicePlacement,
  Grid,
  SolverParams,
  Solution,
} from "./types.js";
import { startJsonBackgroundSolve } from "./backgroundSolverRunner.js";
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

export type CpSatSolveHandle = BackgroundSolveHandle;

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
    summary: expectString(value.summary, "objectivePolicy.summary"),
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
      value.incumbentPopulation === null ? null : expectInteger(value.incumbentPopulation, "telemetry.incumbentPopulation"),
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

function parseCpSatPortfolioWorkerSummary(value: unknown, index: number): CpSatPortfolioWorkerSummary {
  if (!isRecord(value)) {
    throw new Error(`CP-SAT backend returned invalid JSON: portfolio.workers[${index}] must be an object.`);
  }
  return {
    workerIndex: expectInteger(value.workerIndex, `portfolio.workers[${index}].workerIndex`),
    randomSeed: value.randomSeed === null ? null : expectInteger(value.randomSeed, `portfolio.workers[${index}].randomSeed`),
    randomizeSearch: expectBoolean(value.randomizeSearch, `portfolio.workers[${index}].randomizeSearch`),
    numWorkers: expectInteger(value.numWorkers, `portfolio.workers[${index}].numWorkers`),
    status: expectString(value.status, `portfolio.workers[${index}].status`),
    feasible: expectBoolean(value.feasible, `portfolio.workers[${index}].feasible`),
    totalPopulation:
      value.totalPopulation === null
        ? null
        : expectInteger(value.totalPopulation, `portfolio.workers[${index}].totalPopulation`),
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
    value.selectedWorkerIndex === null ? null : expectInteger(value.selectedWorkerIndex, "portfolio.selectedWorkerIndex");
  const workers = value.workers.map((entry, index) => parseCpSatPortfolioWorkerSummary(entry, index));
  if (workers.length !== workerCount) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.workerCount must match workers length.");
  }
  if (new Set(workers.map((worker) => worker.workerIndex)).size !== workers.length) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.workers must have unique workerIndex values.");
  }
  if (selectedWorkerIndex !== null && !workers.some((worker) => worker.workerIndex === selectedWorkerIndex)) {
    throw new Error("CP-SAT backend returned invalid JSON: portfolio.selectedWorkerIndex must reference a listed worker.");
  }
  return {
    workerCount,
    selectedWorkerIndex,
    workers,
  };
}

function expectCpSatProgressKind(value: unknown, label: string): CpSatProgressKind {
  if (value === "incumbent" || value === "bound" || value === "portfolio-worker-complete") {
    return value;
  }
  throw new Error(`CP-SAT backend returned invalid JSON: ${label} must be a known progress kind.`);
}

function parseCpSatProgressUpdate(value: unknown): CpSatProgressUpdate {
  if (!isRecord(value)) {
    throw new Error("CP-SAT backend returned invalid JSON: progress event must be an object.");
  }
  return {
    kind: expectCpSatProgressKind(value.kind, "progress.kind"),
    telemetry: value.telemetry === undefined ? undefined : parseCpSatTelemetry(value.telemetry),
    worker: value.worker === undefined ? undefined : parseCpSatPortfolioWorkerSummary(value.worker, 0),
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
  const portfolio = value.portfolio === undefined ? undefined : parseCpSatPortfolioSummary(value.portfolio);
  const stoppedByUser = value.stoppedByUser === undefined ? undefined : expectBoolean(value.stoppedByUser, "stoppedByUser");

  if (populations.length !== residentials.length) {
    throw new Error("CP-SAT backend returned invalid JSON: populations length must match residentials length.");
  }
  if (totalPopulation !== populations.reduce((sum, population) => sum + population, 0)) {
    throw new Error("CP-SAT backend returned invalid JSON: totalPopulation must equal the population sum.");
  }

  return { roads, services, residentials, populations, totalPopulation, status, objectivePolicy, telemetry, portfolio, stoppedByUser };
}

function defaultPythonExecutable(): string {
  const venvPython = resolve(__dirname, "../.venv-cp-sat/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function isSolutionWarmStartHint(value: CpSatWarmStartHint | Solution): value is Solution {
  return value.roads instanceof Set;
}

function normalizeWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;

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

  const solution = value.solution;
  return {
    ...value,
    roads: [...(value.roads ?? solution?.roads ?? value.roadKeys ?? [])],
    services: (value.services ?? solution?.services ?? []).map((service) => ({ ...service })),
    residentials: (value.residentials ?? solution?.residentials ?? []).map((residential) => ({ ...residential })),
    totalPopulation: value.totalPopulation ?? solution?.totalPopulation,
  };
}

function buildCpSatBackendParams(params: SolverParams, asyncOptions?: CpSatAsyncOptions): SolverParams {
  const normalizedWarmStartHint = params.cpSat?.warmStartHint ? normalizeWarmStartHint(params.cpSat.warmStartHint) : undefined;
  const streamProgress = Boolean(
    asyncOptions && (params.cpSat?.streamProgress || asyncOptions.onProgress || asyncOptions.progressIntervalSeconds !== undefined)
  );
  const progressIntervalSeconds = asyncOptions?.progressIntervalSeconds ?? params.cpSat?.progressIntervalSeconds;
  const objectiveLowerBound =
    params.cpSat?.objectiveLowerBound
    ?? (isRecord(normalizedWarmStartHint) && typeof normalizedWarmStartHint.objectiveLowerBound === "number"
      ? normalizedWarmStartHint.objectiveLowerBound
      : undefined);

  if (!params.cpSat && !streamProgress) {
    return params;
  }

  return {
    ...params,
    cpSat: {
      ...params.cpSat,
      ...(normalizedWarmStartHint
        ? { warmStartHint: normalizedWarmStartHint as NonNullable<SolverParams["cpSat"]>["warmStartHint"] }
        : {}),
      ...(objectiveLowerBound !== undefined ? { objectiveLowerBound } : {}),
      ...(streamProgress ? { streamProgress: true } : {}),
      ...(progressIntervalSeconds !== undefined ? { progressIntervalSeconds } : {}),
    },
  };
}

function buildCpSatRequest(G: Grid, params: SolverParams, asyncOptions?: CpSatAsyncOptions) {
  return {
    grid: G,
    params: buildCpSatBackendParams(params, asyncOptions),
  };
}

function buildCpSatBackendInvocation(G: Grid, params: SolverParams, asyncOptions?: CpSatAsyncOptions) {
  const pythonExecutable =
    params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  const requestPayload = buildCpSatRequest(G, params, asyncOptions);
  return {
    pythonExecutable,
    scriptPath,
    request: JSON.stringify(requestPayload),
    streamProgress: Boolean(requestPayload.params.cpSat?.streamProgress),
  };
}

function runCpSatBackend(G: Grid, params: SolverParams) {
  const { pythonExecutable, scriptPath, request } = buildCpSatBackendInvocation(G, params);
  const result = spawnSync(pythonExecutable, [scriptPath], {
    input: request,
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

function parseCpSatStreamEvent(line: string): CpSatRawProgressEvent | CpSatRawResultEvent {
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
      worker: update.worker,
    };
  }
  if (event === "result") {
    return {
      event,
      payload: normalizeCpSatRawSolution(value.payload),
    };
  }
  throw new Error("CP-SAT backend returned invalid JSON: unknown stream event type.");
}

async function runCpSatBackendAsync(
  G: Grid,
  params: SolverParams,
  asyncOptions?: CpSatAsyncOptions
): Promise<CpSatRawSolution> {
  const { pythonExecutable, scriptPath, request, streamProgress } = buildCpSatBackendInvocation(G, params, asyncOptions);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let sawStreamEvent = false;
    let finalPayload: CpSatRawSolution | null = null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!streamProgress) {
        return;
      }
      lineBuffer += chunk;
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line) {
          try {
            const event = parseCpSatStreamEvent(line);
            sawStreamEvent = true;
            if (event.event === "progress") {
              asyncOptions?.onProgress?.({
                kind: event.kind,
                telemetry: event.telemetry,
                worker: event.worker,
              });
            } else {
              finalPayload = event.payload;
            }
          } catch (error) {
            rejectPromise(error as Error);
            child.kill();
            return;
          }
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to launch CP-SAT backend with ${pythonExecutable}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const trimmedStdout = stdout.trim();
        const exitDetail = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
        rejectPromise(
          new Error(
            `CP-SAT backend failed with ${exitDetail}.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${
              trimmedStdout ? ` stdout: ${trimmedStdout}` : ""
            }`
          )
        );
        return;
      }
      try {
        if (streamProgress) {
          const trailing = lineBuffer.trim();
          if (trailing) {
            const event = parseCpSatStreamEvent(trailing);
            sawStreamEvent = true;
            if (event.event === "progress") {
              asyncOptions?.onProgress?.({
                kind: event.kind,
                telemetry: event.telemetry,
                worker: event.worker,
              });
            } else {
              finalPayload = event.payload;
            }
          }
          if (finalPayload) {
            resolvePromise(finalPayload);
            return;
          }
          if (sawStreamEvent) {
            rejectPromise(new Error("CP-SAT backend returned streamed progress without a final result payload."));
            return;
          }
        }
        resolvePromise(parseCpSatRawSolution(stdout));
      } catch (error) {
        rejectPromise(error as Error);
      }
    });
    child.stdin.end(request, "utf8");
  });
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

function materializeCpSatSolution(G: Grid, params: SolverParams, raw: CpSatRawSolution): Solution {
  const layout = validateCpSatLayout(G, params, raw);
  return {
    optimizer: "cp-sat",
    cpSatStatus: raw.status,
    cpSatObjectivePolicy: raw.objectivePolicy,
    cpSatTelemetry: raw.telemetry,
    cpSatPortfolio: raw.portfolio,
    stoppedByUser: Boolean(raw.stoppedByUser),
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

export function startCpSatSolve(G: Grid, params: SolverParams): CpSatSolveHandle {
  const pythonExecutable =
    params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../python/cp_sat_solver.py");
  return startJsonBackgroundSolve({
    solverLabel: "CP-SAT",
    stopDirectoryPrefix: "city-builder-cp-sat-stop-",
    command: pythonExecutable,
    args: [scriptPath],
    launchContext: `with ${pythonExecutable}`,
    buildRequest: ({ stopFilePath, snapshotFilePath }) =>
      buildCpSatRequest(G, {
        ...params,
        cpSat: {
          ...(params.cpSat ?? {}),
          stopFilePath,
          snapshotFilePath,
        },
      }),
    parseRaw: parseCpSatRawSolution,
    materializeSolution: (raw, stoppedByUser) =>
      materializeCpSatSolution(G, params, {
        ...raw,
        stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
      }),
    getSnapshotState: (raw) => ({
      hasFeasibleSolution: Boolean(raw),
      totalPopulation: raw?.totalPopulation ?? null,
      cpSatStatus: raw?.status ?? null,
    }),
    readStoppedByUser: (raw) => Boolean(raw.stoppedByUser),
    stoppedBeforeFeasibleMessage: "CP-SAT solve was stopped before finding a feasible solution.",
    noSolutionMessage: "CP-SAT backend exited without returning a solution.",
  });
}

export async function solveCpSatAsync(
  G: Grid,
  params: SolverParams,
  asyncOptions?: CpSatAsyncOptions
): Promise<Solution> {
  const raw = await runCpSatBackendAsync(G, params, asyncOptions);
  return materializeCpSatSolution(G, params, raw);
}

export function solveCpSat(G: Grid, params: SolverParams): Solution {
  const raw = parseCpSatRawSolution(runCpSatBackend(G, params));
  return materializeCpSatSolution(G, params, raw);
}
