import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderSolutionMap } from "./map.js";
import type { Grid, OptimizerName, SerializedSolution, Solution, SolveProgressLogEntry, SolverParams } from "./types.js";

type PersistedSolveStatus = "running" | "completed" | "stopped" | "failed";

interface SolveProgressLogDocument {
  version: 1;
  requestId: string;
  optimizer: OptimizerName;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  status: PersistedSolveStatus;
  grid: {
    rows: number;
    cols: number;
    allowedCells: number;
  };
  input: {
    grid: Grid;
    params: SolverParams;
  };
  entries: SolveProgressLogEntry[];
  message: string | null;
  error: string | null;
  finalResult: {
    totalPopulation: number | null;
    cpSatStatus: string | null;
    stoppedByUser: boolean;
    solution: SerializedSolution;
    mapRows: string[];
    mapText: string;
  } | null;
}

export interface SolveProgressLogWriterOptions {
  rootDirectory?: string;
  requestId: string;
  optimizer: OptimizerName;
  grid: Grid;
  params: SolverParams;
  createdAtMs: number;
}

export interface AppendProgressLogEntryOptions {
  source: SolveProgressLogEntry["source"];
  capturedAt?: string;
  elapsedMs: number;
}

export interface AppendPendingProgressLogEntryOptions {
  capturedAt?: string;
  elapsedMs: number;
  note?: string;
}

const DEFAULT_PROGRESS_LOG_ROOT = resolve(process.cwd(), "artifacts", "solve-progress");

function sanitizeFileNameSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function formatTimestampForFileName(createdAtMs: number): string {
  return new Date(createdAtMs)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function countAllowedCells(grid: Grid): number {
  return grid.reduce((sum, row) => sum + row.reduce((rowSum, cell) => rowSum + (cell === 1 ? 1 : 0), 0), 0);
}

function normalizeElapsedMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function roundTelemetrySeconds(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function serializeSolutionForLog(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

function syncSerializedSolutionToFinalEntry(
  solution: SerializedSolution,
  finalEntry: SolveProgressLogEntry | null
): SerializedSolution {
  if (!solution.cpSatTelemetry || !finalEntry?.hasFeasibleSolution) return solution;

  const currentTelemetry = solution.cpSatTelemetry;
  const currentSolveWallTimeSeconds =
    typeof currentTelemetry.solveWallTimeSeconds === "number" && Number.isFinite(currentTelemetry.solveWallTimeSeconds)
      ? currentTelemetry.solveWallTimeSeconds
      : null;
  const finalSolveWallTimeSeconds =
    typeof finalEntry.solveWallTimeSeconds === "number" ? finalEntry.solveWallTimeSeconds : null;
  const userTimeSeconds = finalSolveWallTimeSeconds === null
    ? currentTelemetry.userTimeSeconds
    : currentSolveWallTimeSeconds === null
      ? finalSolveWallTimeSeconds
      : roundTelemetrySeconds(currentTelemetry.userTimeSeconds + Math.max(0, finalSolveWallTimeSeconds - currentSolveWallTimeSeconds))
        ?? currentTelemetry.userTimeSeconds;

  return {
    ...solution,
    cpSatStatus: finalEntry.cpSatStatus ?? solution.cpSatStatus,
    cpSatTelemetry: {
      ...currentTelemetry,
      solveWallTimeSeconds: finalSolveWallTimeSeconds ?? currentTelemetry.solveWallTimeSeconds,
      userTimeSeconds,
      incumbentPopulation:
        typeof solution.totalPopulation === "number" ? solution.totalPopulation : currentTelemetry.incumbentPopulation,
      bestPopulationUpperBound: finalEntry.bestPopulationUpperBound ?? currentTelemetry.bestPopulationUpperBound,
      populationGapUpperBound: finalEntry.populationGapUpperBound ?? currentTelemetry.populationGapUpperBound,
      lastImprovementAtSeconds: finalEntry.lastImprovementAtSeconds ?? currentTelemetry.lastImprovementAtSeconds,
      secondsSinceLastImprovement: finalEntry.secondsSinceLastImprovement ?? currentTelemetry.secondsSinceLastImprovement,
    },
  };
}

function buildProgressEntry(
  solution: Solution,
  optimizer: OptimizerName,
  options: AppendProgressLogEntryOptions,
  state: {
    solveStartedAtElapsedMs: number | null;
  }
): SolveProgressLogEntry {
  const telemetry = solution.cpSatTelemetry;
  const elapsedMs = normalizeElapsedMs(options.elapsedMs);
  const lastImprovementAtSeconds =
    typeof telemetry?.lastImprovementAtSeconds === "number" ? telemetry.lastImprovementAtSeconds : null;
  const snapshotSolveWallTimeSeconds =
    typeof telemetry?.solveWallTimeSeconds === "number" ? telemetry.solveWallTimeSeconds : null;
  const snapshotSecondsSinceLastImprovement =
    typeof telemetry?.secondsSinceLastImprovement === "number" ? telemetry.secondsSinceLastImprovement : null;
  let solveWallTimeSeconds = snapshotSolveWallTimeSeconds;
  let secondsSinceLastImprovement = snapshotSecondsSinceLastImprovement;

  if (state.solveStartedAtElapsedMs !== null) {
    const derivedSolveWallTimeSeconds = Math.max(0, (elapsedMs - state.solveStartedAtElapsedMs) / 1000);
    solveWallTimeSeconds = snapshotSolveWallTimeSeconds === null
      ? derivedSolveWallTimeSeconds
      : Math.max(snapshotSolveWallTimeSeconds, derivedSolveWallTimeSeconds);
  }

  if (lastImprovementAtSeconds !== null && solveWallTimeSeconds !== null) {
    secondsSinceLastImprovement = Math.max(0, solveWallTimeSeconds - lastImprovementAtSeconds);
  } else if (snapshotSecondsSinceLastImprovement !== null && solveWallTimeSeconds !== null) {
    secondsSinceLastImprovement = Math.max(
      0,
      snapshotSecondsSinceLastImprovement
        + Math.max(0, solveWallTimeSeconds - (snapshotSolveWallTimeSeconds ?? solveWallTimeSeconds))
    );
  }

  return {
    capturedAt: typeof options.capturedAt === "string" && options.capturedAt.trim()
      ? options.capturedAt
      : new Date().toISOString(),
    elapsedMs,
    source: options.source,
    optimizer: solution.optimizer ?? optimizer,
    hasFeasibleSolution: true,
    totalPopulation: typeof solution.totalPopulation === "number" ? solution.totalPopulation : null,
    cpSatStatus: solution.cpSatStatus ?? null,
    bestPopulationUpperBound:
      typeof telemetry?.bestPopulationUpperBound === "number" ? telemetry.bestPopulationUpperBound : null,
    populationGapUpperBound:
      typeof telemetry?.populationGapUpperBound === "number" ? telemetry.populationGapUpperBound : null,
    solveWallTimeSeconds: roundTelemetrySeconds(solveWallTimeSeconds),
    lastImprovementAtSeconds: roundTelemetrySeconds(lastImprovementAtSeconds),
    secondsSinceLastImprovement: roundTelemetrySeconds(secondsSinceLastImprovement),
    note: null,
  };
}

function entriesMatch(left: SolveProgressLogEntry | undefined, right: SolveProgressLogEntry): boolean {
  if (!left) return false;
  return left.elapsedMs === right.elapsedMs
    && left.source === right.source
    && left.optimizer === right.optimizer
    && left.hasFeasibleSolution === right.hasFeasibleSolution
    && left.totalPopulation === right.totalPopulation
    && left.cpSatStatus === right.cpSatStatus
    && left.bestPopulationUpperBound === right.bestPopulationUpperBound
    && left.populationGapUpperBound === right.populationGapUpperBound
    && left.solveWallTimeSeconds === right.solveWallTimeSeconds
    && left.lastImprovementAtSeconds === right.lastImprovementAtSeconds
    && left.secondsSinceLastImprovement === right.secondsSinceLastImprovement
    && (left.note ?? null) === (right.note ?? null);
}

export class SolveProgressLogWriter {
  readonly filePath: string;

  private readonly optimizer: OptimizerName;
  private readonly document: SolveProgressLogDocument;
  private solveStartedAtElapsedMs: number | null = null;

  constructor(options: SolveProgressLogWriterOptions) {
    const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_PROGRESS_LOG_ROOT);
    mkdirSync(rootDirectory, { recursive: true });

    const timestamp = formatTimestampForFileName(options.createdAtMs);
    const safeRequestId = sanitizeFileNameSegment(options.requestId, "solve");
    this.filePath = join(rootDirectory, `${timestamp}-${safeRequestId}.json`);
    this.optimizer = options.optimizer;
    this.document = {
      version: 1,
      requestId: options.requestId,
      optimizer: options.optimizer,
      createdAt: new Date(options.createdAtMs).toISOString(),
      updatedAt: new Date(options.createdAtMs).toISOString(),
      finishedAt: null,
      status: "running",
      grid: {
        rows: options.grid.length,
        cols: options.grid[0]?.length ?? 0,
        allowedCells: countAllowedCells(options.grid),
      },
      input: {
        grid: JSON.parse(JSON.stringify(options.grid)),
        params: JSON.parse(JSON.stringify(options.params)),
      },
      entries: [],
      message: null,
      error: null,
      finalResult: null,
    };
    this.flush();
  }

  appendSolutionSample(solution: Solution, options: AppendProgressLogEntryOptions): void {
    const telemetrySolveWallTimeSeconds =
      typeof solution.cpSatTelemetry?.solveWallTimeSeconds === "number"
        && Number.isFinite(solution.cpSatTelemetry.solveWallTimeSeconds)
        ? solution.cpSatTelemetry.solveWallTimeSeconds
        : null;
    const elapsedMs = normalizeElapsedMs(options.elapsedMs);

    if (telemetrySolveWallTimeSeconds !== null) {
      const solveStartedAtElapsedMs = Math.max(0, elapsedMs - Math.round(telemetrySolveWallTimeSeconds * 1000));
      this.solveStartedAtElapsedMs = this.solveStartedAtElapsedMs === null
        ? solveStartedAtElapsedMs
        : Math.min(this.solveStartedAtElapsedMs, solveStartedAtElapsedMs);
    }

    const entry = buildProgressEntry(solution, this.optimizer, options, {
      solveStartedAtElapsedMs: this.solveStartedAtElapsedMs,
    });
    const lastEntry = this.document.entries[this.document.entries.length - 1];
    if (entriesMatch(lastEntry, entry)) {
      this.document.entries[this.document.entries.length - 1] = entry;
    } else {
      this.document.entries.push(entry);
    }
    this.document.updatedAt = entry.capturedAt;
    this.flush();
  }

  appendPendingSample(options: AppendPendingProgressLogEntryOptions): void {
    const entry: SolveProgressLogEntry = {
      capturedAt: typeof options.capturedAt === "string" && options.capturedAt.trim()
        ? options.capturedAt
        : new Date().toISOString(),
      elapsedMs: normalizeElapsedMs(options.elapsedMs),
      source: "live-snapshot",
      optimizer: this.optimizer,
      hasFeasibleSolution: false,
      totalPopulation: null,
      cpSatStatus: null,
      bestPopulationUpperBound: null,
      populationGapUpperBound: null,
      solveWallTimeSeconds: null,
      lastImprovementAtSeconds: null,
      secondsSinceLastImprovement: null,
      note: options.note ?? "Solve started. Waiting for the first feasible solution.",
    };
    const lastEntry = this.document.entries[this.document.entries.length - 1];
    if (entriesMatch(lastEntry, entry)) {
      this.document.entries[this.document.entries.length - 1] = entry;
    } else {
      this.document.entries.push(entry);
    }
    this.document.updatedAt = entry.capturedAt;
    this.flush();
  }

  finish(status: PersistedSolveStatus, options: {
    finishedAtMs: number;
    solution?: Solution | null;
    message?: string | null;
    error?: string | null;
  }): void {
    this.document.status = status;
    this.document.finishedAt = new Date(options.finishedAtMs).toISOString();
    this.document.updatedAt = this.document.finishedAt;
    this.document.message = options.message ?? null;
    this.document.error = options.error ?? null;
    if (options.solution) {
      const serializedSolution = syncSerializedSolutionToFinalEntry(
        serializeSolutionForLog(options.solution),
        this.getLastEntry()
      );
      const mapRows = renderSolutionMap(this.document.input.grid, options.solution);
      this.document.finalResult = {
        totalPopulation: typeof options.solution.totalPopulation === "number" ? options.solution.totalPopulation : null,
        cpSatStatus: serializedSolution.cpSatStatus ?? null,
        stoppedByUser: Boolean(options.solution.stoppedByUser),
        solution: serializedSolution,
        mapRows,
        mapText: mapRows.join("\n"),
      };
    } else {
      this.document.finalResult = null;
    }
    this.flush();
  }

  private flush(): void {
    writeFileSync(this.filePath, `${JSON.stringify(this.document, null, 2)}\n`, "utf8");
  }

  getLastEntry(): SolveProgressLogEntry | null {
    return this.document.entries[this.document.entries.length - 1] ?? null;
  }
}

export const DEFAULT_SOLVE_PROGRESS_LOG_ROOT = DEFAULT_PROGRESS_LOG_ROOT;
