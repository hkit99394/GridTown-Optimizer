/**
 * CP-SAT solver bridge. The optimization model lives in python/cp_sat_solver.py
 * because Google OR-Tools exposes CP-SAT officially in Python rather than Node.js.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type {
  CpSatAsyncOptions,
  CpSatWarmStartHint,
  EvaluatedServicePlacement,
  Grid,
  SolverParams,
  Solution
} from "../../core/index.js";
import {
  assertValidLayout,
  assertValidSolveInputs,
  hasExplicitEmptyRoadAnchors,
  validateSolution
} from "../../core/index.js";
import { parseCpSatRawSolution, parseCpSatStreamEvent, type CpSatRawSolution } from "./protocol.js";

export { parseCpSatRawSolution };
export type { CpSatRawSolution };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildNoRoadAnchorCpSatSolution(): Solution {
  return {
    optimizer: "cp-sat",
    roads: new Set<string>(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };
}

export function defaultPythonExecutable(): string {
  const venvPython = resolve(__dirname, "../../../../.venv-cp-sat/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

export interface CpSatReadiness {
  ready: boolean;
  pythonExecutable: string;
  message: string;
  ortoolsVersion: string | null;
  setupCommand: string;
  detail?: string;
}

function cpSatSetupHint(): string {
  return "Run npm run setup:cp-sat, or set CITY_BUILDER_CP_SAT_PYTHON to a Python executable with OR-Tools installed.";
}

export function resolveCpSatBackendTimeout(
  params: SolverParams
): { milliseconds: number; seconds: number } | undefined {
  const seconds = params.cpSat?.backendTimeoutSeconds;
  if (seconds === undefined) return undefined;
  return {
    milliseconds: Math.max(1, Math.ceil(seconds * 1000)),
    seconds
  };
}

function formatTimeoutSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? `${seconds}` : `${Number(seconds.toFixed(3))}`;
}

export function cpSatBackendTimeoutMessage(timeout: { seconds: number }): string {
  return `CP-SAT backend timed out after ${formatTimeoutSeconds(timeout.seconds)}s.`;
}

function isSpawnTimeoutError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
}

export function checkCpSatReadiness(
  pythonExecutable = process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable()
): CpSatReadiness {
  const setupCommand = "npm run setup:cp-sat";
  const result = spawnSync(
    pythonExecutable,
    ["-c", "import ortools; print(getattr(ortools, '__version__', 'unknown'))"],
    {
      encoding: "utf8",
      timeout: 5000
    }
  );

  if (result.error) {
    return {
      ready: false,
      pythonExecutable,
      setupCommand,
      ortoolsVersion: null,
      message: `CP-SAT is not ready: could not launch ${pythonExecutable}. ${cpSatSetupHint()}`,
      detail: result.error.message
    };
  }

  if (result.status !== 0) {
    const detail = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join(" ");
    return {
      ready: false,
      pythonExecutable,
      setupCommand,
      ortoolsVersion: null,
      message: `CP-SAT is not ready: ${pythonExecutable} cannot import OR-Tools. ${cpSatSetupHint()}`,
      ...(detail ? { detail } : {})
    };
  }

  const ortoolsVersion = result.stdout.trim() || "unknown";
  return {
    ready: true,
    pythonExecutable,
    setupCommand,
    ortoolsVersion,
    message: `CP-SAT is ready with OR-Tools ${ortoolsVersion}.`
  };
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
        bonus: value.servicePopulationIncreases[index]
      })),
      residentials: value.residentials.map((residential, index) => ({
        ...residential,
        typeIndex: value.residentialTypeIndices[index],
        population: value.populations[index]
      })),
      totalPopulation: value.totalPopulation
    };
  }

  const solution = value.solution;
  return {
    ...value,
    roads: [...(value.roads ?? solution?.roads ?? value.roadKeys ?? [])],
    services: (value.services ?? solution?.services ?? []).map((service) => ({ ...service })),
    residentials: (value.residentials ?? solution?.residentials ?? []).map((residential) => ({ ...residential })),
    totalPopulation: value.totalPopulation ?? solution?.totalPopulation
  };
}

function buildCpSatBackendParams(params: SolverParams, asyncOptions?: CpSatAsyncOptions): SolverParams {
  const normalizedWarmStartHint = params.cpSat?.warmStartHint
    ? normalizeWarmStartHint(params.cpSat.warmStartHint)
    : undefined;
  const { backendTimeoutSeconds: _backendTimeoutSeconds, ...pythonCpSatOptions } = params.cpSat ?? {};
  const streamProgress = Boolean(
    asyncOptions &&
    (params.cpSat?.streamProgress || asyncOptions.onProgress || asyncOptions.progressIntervalSeconds !== undefined)
  );
  const progressIntervalSeconds = asyncOptions?.progressIntervalSeconds ?? params.cpSat?.progressIntervalSeconds;
  const objectiveLowerBound =
    params.cpSat?.objectiveLowerBound ??
    (isRecord(normalizedWarmStartHint) && typeof normalizedWarmStartHint.objectiveLowerBound === "number"
      ? normalizedWarmStartHint.objectiveLowerBound
      : undefined);

  if (!params.cpSat && !streamProgress) {
    return params;
  }

  return {
    ...params,
    cpSat: {
      ...pythonCpSatOptions,
      ...(normalizedWarmStartHint
        ? { warmStartHint: normalizedWarmStartHint as NonNullable<SolverParams["cpSat"]>["warmStartHint"] }
        : {}),
      ...(objectiveLowerBound !== undefined ? { objectiveLowerBound } : {}),
      ...(streamProgress ? { streamProgress: true } : {}),
      ...(progressIntervalSeconds !== undefined ? { progressIntervalSeconds } : {})
    }
  };
}

export function buildCpSatRequest(G: Grid, params: SolverParams, asyncOptions?: CpSatAsyncOptions) {
  return {
    grid: G,
    params: buildCpSatBackendParams(params, asyncOptions)
  };
}

function buildCpSatBackendInvocation(G: Grid, params: SolverParams, asyncOptions?: CpSatAsyncOptions) {
  const pythonExecutable =
    params.cpSat?.pythonExecutable ?? process.env.CITY_BUILDER_CP_SAT_PYTHON ?? defaultPythonExecutable();
  const scriptPath = params.cpSat?.scriptPath ?? resolve(__dirname, "../../../../python/cp_sat_solver.py");
  const requestPayload = buildCpSatRequest(G, params, asyncOptions);
  return {
    pythonExecutable,
    scriptPath,
    request: JSON.stringify(requestPayload),
    streamProgress: Boolean(requestPayload.params.cpSat?.streamProgress)
  };
}

function runCpSatBackend(G: Grid, params: SolverParams) {
  const { pythonExecutable, scriptPath, request } = buildCpSatBackendInvocation(G, params);
  const backendTimeout = resolveCpSatBackendTimeout(params);
  const result = spawnSync(pythonExecutable, [scriptPath], {
    input: request,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...(backendTimeout ? { timeout: backendTimeout.milliseconds, killSignal: "SIGKILL" as const } : {})
  });

  if (result.error) {
    if (backendTimeout && isSpawnTimeoutError(result.error)) {
      throw new Error(`${cpSatBackendTimeoutMessage(backendTimeout)} ${cpSatSetupHint()}`);
    }
    throw new Error(
      `Failed to launch CP-SAT backend with ${pythonExecutable}: ${result.error.message}. ${cpSatSetupHint()}`
    );
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const exitDetail = result.status === null ? `signal ${result.signal ?? "unknown"}` : `exit code ${result.status}`;
    throw new Error(
      `CP-SAT backend failed with ${exitDetail}.${stderr ? ` stderr: ${stderr}` : ""}${stdout ? ` stdout: ${stdout}` : ""} ${cpSatSetupHint()}`
    );
  }

  return result.stdout;
}

async function runCpSatBackendAsync(
  G: Grid,
  params: SolverParams,
  asyncOptions?: CpSatAsyncOptions
): Promise<CpSatRawSolution> {
  const { pythonExecutable, scriptPath, request, streamProgress } = buildCpSatBackendInvocation(
    G,
    params,
    asyncOptions
  );
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let sawStreamEvent = false;
    let finalPayload: CpSatRawSolution | null = null;
    let backendTimeoutFired = false;
    const backendTimeout = resolveCpSatBackendTimeout(params);
    const backendTimeoutId = backendTimeout
      ? setTimeout(() => {
          backendTimeoutFired = true;
          child.kill("SIGKILL");
          rejectPromise(new Error(`${cpSatBackendTimeoutMessage(backendTimeout)} ${cpSatSetupHint()}`));
        }, backendTimeout.milliseconds)
      : undefined;
    backendTimeoutId?.unref?.();
    const clearBackendTimeout = () => {
      if (backendTimeoutId) {
        clearTimeout(backendTimeoutId);
      }
    };

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
                worker: event.worker
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
      clearBackendTimeout();
      if (backendTimeoutFired) return;
      rejectPromise(
        new Error(`Failed to launch CP-SAT backend with ${pythonExecutable}: ${error.message}. ${cpSatSetupHint()}`)
      );
    });
    child.on("close", (code, signal) => {
      clearBackendTimeout();
      if (backendTimeoutFired) return;
      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const trimmedStdout = stdout.trim();
        const exitDetail = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
        rejectPromise(
          new Error(
            `CP-SAT backend failed with ${exitDetail}.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${
              trimmedStdout ? ` stdout: ${trimmedStdout}` : ""
            } ${cpSatSetupHint()}`
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
                worker: event.worker
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

function decodeCpSatLayout(raw: CpSatRawSolution) {
  const roads = new Set(raw.roads);
  const services: EvaluatedServicePlacement[] = raw.services.map((service) => ({
    r: service.r,
    c: service.c,
    rows: service.rows,
    cols: service.cols,
    range: service.range,
    bonus: service.bonus
  }));
  const residentials = raw.residentials.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols
  }));
  return { roads, services, residentials };
}

function validateCpSatLayout(
  G: Grid,
  params: SolverParams,
  raw: CpSatRawSolution
): ReturnType<typeof decodeCpSatLayout> {
  const layout = decodeCpSatLayout(raw);
  assertValidLayout(
    {
      grid: G,
      roads: layout.roads,
      services: layout.services,
      residentials: layout.residentials,
      params
    },
    "CP-SAT backend produced an invalid layout"
  );
  return layout;
}

export function materializeCpSatSolution(G: Grid, params: SolverParams, raw: CpSatRawSolution): Solution {
  const layout = validateCpSatLayout(G, params, raw);
  const solution: Solution = {
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
    totalPopulation: raw.totalPopulation
  };
  const validation = validateSolution({ grid: G, solution, params }, { ignoreReportedPopulation: true });
  if (!validation.valid) {
    throw new Error(`CP-SAT backend produced an invalid solution payload: ${validation.errors.join(" ")}`);
  }
  const populationErrors: string[] = [];
  for (let i = 0; i < validation.recomputedPopulations.length; i++) {
    if (raw.populations[i] < 0 || raw.populations[i] > validation.recomputedPopulations[i]) {
      populationErrors.push(
        `Residential ${i} reports population ${raw.populations[i]}, expected ${validation.recomputedPopulations[i]}.`
      );
    }
  }
  if (raw.totalPopulation < 0 || raw.totalPopulation > validation.recomputedTotalPopulation) {
    populationErrors.push(
      `Solution reports total population ${raw.totalPopulation}, expected ${validation.recomputedTotalPopulation}.`
    );
  }
  if (populationErrors.length > 0) {
    throw new Error(`CP-SAT backend produced an invalid solution payload: ${populationErrors.join(" ")}`);
  }
  return {
    ...solution,
    populations: validation.recomputedPopulations,
    totalPopulation: validation.recomputedTotalPopulation
  };
}

export async function solveCpSatAsync(
  G: Grid,
  params: SolverParams,
  asyncOptions?: CpSatAsyncOptions
): Promise<Solution> {
  assertValidSolveInputs(G, params);
  if (hasExplicitEmptyRoadAnchors(params)) {
    return buildNoRoadAnchorCpSatSolution();
  }
  const raw = await runCpSatBackendAsync(G, params, asyncOptions);
  return materializeCpSatSolution(G, params, raw);
}

export function solveCpSat(G: Grid, params: SolverParams): Solution {
  assertValidSolveInputs(G, params);
  if (hasExplicitEmptyRoadAnchors(params)) {
    return buildNoRoadAnchorCpSatSolution();
  }
  const raw = parseCpSatRawSolution(runCpSatBackend(G, params));
  return materializeCpSatSolution(G, params, raw);
}
