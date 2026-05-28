import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isOptimizerName, renderSolutionMap } from "../../core/index.js";
import { buildEmptySolverProgressSummary, buildSolverProgressSummary } from "../../core/index.js";
import type {
  Grid,
  OptimizerName,
  SerializedSolution,
  Solution,
  SolveProgressLogEntry,
  SolverParams
} from "../../core/index.js";

export type PersistedSolveStatus = "running" | "completed" | "stopped" | "failed";

export interface SolveProgressLogDocument {
  version: 2;
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

export interface SolveProgressLogReadResult {
  filePath: string;
  document: SolveProgressLogDocument;
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
const PERSISTED_SOLVE_STATUSES = new Set<PersistedSolveStatus>(["running", "completed", "stopped", "failed"]);

function sanitizeFileNameSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function formatTimestampForFileName(createdAtMs: number): string {
  return new Date(createdAtMs).toISOString().replace(/[-:]/g, "").replace(".", "");
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function buildProgressLogFilePath(rootDirectory: string, baseFileName: string, attempt: number): string {
  const suffix = attempt === 0 ? "" : `-${attempt}`;
  return join(rootDirectory, `${baseFileName}${suffix}.json`);
}

function serializeProgressLogDocument(document: SolveProgressLogDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function createInitialProgressLogFile(
  rootDirectory: string,
  baseFileName: string,
  document: SolveProgressLogDocument
): string {
  const serializedDocument = serializeProgressLogDocument(document);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const filePath = buildProgressLogFilePath(rootDirectory, baseFileName, attempt);
    try {
      writeFileSync(filePath, serializedDocument, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileAlreadyExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error(`Unable to allocate a unique solve progress log file for ${baseFileName}.`);
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

export function progressLogPayloadsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function progressLogSolutionSampleChanged(lastEntry: SolveProgressLogEntry | null, solution: Solution): boolean {
  if (!lastEntry || !lastEntry.hasFeasibleSolution) return true;

  const bestPopulationUpperBound = solution.cpSatTelemetry?.bestPopulationUpperBound ?? null;
  const populationGapUpperBound = solution.cpSatTelemetry?.populationGapUpperBound ?? null;
  const latestLnsOutcome = getLastLnsOutcome(solution);

  return (
    lastEntry.totalPopulation !== solution.totalPopulation ||
    (lastEntry.activeOptimizer ?? null) !== (solution.activeOptimizer ?? null) ||
    lastEntry.cpSatStatus !== (solution.cpSatStatus ?? null) ||
    lastEntry.bestPopulationUpperBound !== bestPopulationUpperBound ||
    lastEntry.populationGapUpperBound !== populationGapUpperBound ||
    (lastEntry.lnsStopReason ?? null) !== (solution.lnsTelemetry?.stopReason ?? null) ||
    (lastEntry.lnsNeighborhoodStatus ?? null) !== (latestLnsOutcome?.status ?? null) ||
    (lastEntry.lnsNeighborhoodImprovement ?? null) !== (latestLnsOutcome?.improvement ?? null) ||
    (lastEntry.lnsNeighborhoodsCompleted ?? null) !== (solution.lnsTelemetry?.iterationsCompleted ?? null) ||
    !progressLogPayloadsEqual(lastEntry.autoStage, solution.autoStage)
  );
}

function cloneProgressLogInput<T>(value: T): T {
  return structuredClone(value);
}

function resolveCapturedAt(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? value : new Date().toISOString();
}

function isPersistedSolveStatus(value: unknown): value is PersistedSolveStatus {
  return typeof value === "string" && PERSISTED_SOLVE_STATUSES.has(value as PersistedSolveStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeFiniteNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isProgressLogDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isProgressLogGridSummary(value: unknown): value is SolveProgressLogDocument["grid"] {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.rows) &&
    Number(value.rows) >= 0 &&
    Number.isInteger(value.cols) &&
    Number(value.cols) >= 0 &&
    Number.isInteger(value.allowedCells) &&
    Number(value.allowedCells) >= 0
  );
}

function isProgressLogInput(value: unknown): value is SolveProgressLogDocument["input"] {
  if (!isRecord(value)) return false;
  return "grid" in value && "params" in value;
}

function isProgressLogEntry(value: unknown): value is SolveProgressLogEntry {
  if (!isRecord(value)) return false;
  if (!isProgressLogDateString(value.capturedAt)) return false;
  if (!isNonNegativeFiniteNumber(value.elapsedMs)) return false;
  if ("lastCapturedAt" in value && value.lastCapturedAt !== undefined) {
    if (!isProgressLogDateString(value.lastCapturedAt)) return false;
  }
  if ("lastElapsedMs" in value && value.lastElapsedMs !== undefined) {
    if (!isNonNegativeFiniteNumber(value.lastElapsedMs) || Number(value.lastElapsedMs) < Number(value.elapsedMs)) {
      return false;
    }
  }
  if (value.source !== "live-snapshot" && value.source !== "final-result") return false;
  if (value.optimizer !== null && !isOptimizerName(value.optimizer)) return false;
  if ("activeOptimizer" in value && value.activeOptimizer !== null && !isOptimizerName(value.activeOptimizer)) {
    return false;
  }
  if ("autoStage" in value && value.autoStage !== null && !isRecord(value.autoStage)) return false;
  if (typeof value.hasFeasibleSolution !== "boolean") return false;
  if (!isNullableNonNegativeFiniteNumber(value.totalPopulation)) return false;
  if (!isNullableString(value.cpSatStatus)) return false;
  if ("lnsStopReason" in value && !isNullableString(value.lnsStopReason)) return false;
  if ("lnsNeighborhoodStatus" in value && !isNullableString(value.lnsNeighborhoodStatus)) return false;
  if ("lnsNeighborhoodImprovement" in value && !isNullableNonNegativeFiniteNumber(value.lnsNeighborhoodImprovement)) {
    return false;
  }
  if ("lnsNeighborhoodsCompleted" in value && !isNullableNonNegativeFiniteNumber(value.lnsNeighborhoodsCompleted)) {
    return false;
  }
  if ("progressSummary" in value && value.progressSummary !== undefined && !isRecord(value.progressSummary)) {
    return false;
  }
  if (!isNullableNonNegativeFiniteNumber(value.bestPopulationUpperBound)) return false;
  if (!isNullableNonNegativeFiniteNumber(value.populationGapUpperBound)) return false;
  if (!isNullableNonNegativeFiniteNumber(value.solveWallTimeSeconds)) return false;
  if (!isNullableNonNegativeFiniteNumber(value.lastImprovementAtSeconds)) return false;
  if (!isNullableNonNegativeFiniteNumber(value.secondsSinceLastImprovement)) return false;
  if ("note" in value && !isNullableString(value.note)) return false;
  return true;
}

function isProgressLogFinalResult(value: unknown): value is NonNullable<SolveProgressLogDocument["finalResult"]> {
  if (!isRecord(value)) return false;
  return (
    isNullableNonNegativeFiniteNumber(value.totalPopulation) &&
    isNullableString(value.cpSatStatus) &&
    typeof value.stoppedByUser === "boolean" &&
    isRecord(value.solution) &&
    isStringArray(value.mapRows) &&
    typeof value.mapText === "string" &&
    value.mapText === value.mapRows.join("\n")
  );
}

function parseSolveProgressLogDocument(value: unknown): SolveProgressLogDocument | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  if (typeof value.requestId !== "string" || !value.requestId.trim()) return null;
  if (!isOptimizerName(value.optimizer)) return null;
  if (!isProgressLogDateString(value.createdAt) || !isProgressLogDateString(value.updatedAt)) return null;
  if (value.finishedAt !== null && !isProgressLogDateString(value.finishedAt)) return null;
  if (!isPersistedSolveStatus(value.status)) return null;
  if (!isProgressLogGridSummary(value.grid)) return null;
  if (!isProgressLogInput(value.input)) return null;
  if (!Array.isArray(value.entries) || !value.entries.every(isProgressLogEntry)) return null;
  if (!isNullableString(value.message) || !isNullableString(value.error)) return null;

  if (value.status === "running") {
    if (value.finishedAt !== null || value.finalResult !== null) return null;
    if (value.entries.some((entry) => entry.source === "final-result")) return null;
  }
  if (value.status === "failed" && value.finalResult !== null) return null;

  if (value.finalResult !== null) {
    if (
      (value.status as PersistedSolveStatus) !== "completed" &&
      (value.status as PersistedSolveStatus) !== "stopped"
    ) {
      return null;
    }
    if (!isProgressLogFinalResult(value.finalResult)) return null;
    const finalEntry = value.entries[value.entries.length - 1] ?? null;
    if (!finalEntry || finalEntry.source !== "final-result" || !finalEntry.hasFeasibleSolution) return null;
  }

  return value as unknown as SolveProgressLogDocument;
}

export function readLatestSolveProgressLogByRequestId(
  rootDirectory: string | undefined,
  requestId: string
): SolveProgressLogReadResult | null {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) return null;

  const resolvedRoot = resolve(rootDirectory ?? DEFAULT_PROGRESS_LOG_ROOT);
  let fileNames: string[];
  try {
    fileNames = readdirSync(resolvedRoot);
  } catch {
    return null;
  }

  let latestResult: SolveProgressLogReadResult | null = null;
  let latestUpdatedAtMs = -1;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = join(resolvedRoot, fileName);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const document = parseSolveProgressLogDocument(parsed);
    if (!document || document.requestId !== normalizedRequestId) continue;

    const updatedAtMs = Date.parse(document.updatedAt) || Date.parse(document.createdAt) || 0;
    if (updatedAtMs <= latestUpdatedAtMs) continue;
    latestUpdatedAtMs = updatedAtMs;
    latestResult = {
      filePath,
      document
    };
  }

  return latestResult;
}

function solveStartedAtElapsedMsFromTelemetry(solution: Solution, elapsedMs: number): number | null {
  const telemetrySolveWallTimeSeconds =
    typeof solution.cpSatTelemetry?.solveWallTimeSeconds === "number" &&
    Number.isFinite(solution.cpSatTelemetry.solveWallTimeSeconds)
      ? solution.cpSatTelemetry.solveWallTimeSeconds
      : null;
  return telemetrySolveWallTimeSeconds === null
    ? null
    : Math.max(0, elapsedMs - Math.round(telemetrySolveWallTimeSeconds * 1000));
}

function mergeSolveStartedAtElapsedMs(current: number | null, observed: number | null): number | null {
  if (current === null) return observed;
  if (observed === null) return current;
  return Math.min(current, observed);
}

function getLastLnsOutcome(solution: Solution): NonNullable<Solution["lnsTelemetry"]>["outcomes"][number] | null {
  const outcomes = solution.lnsTelemetry?.outcomes;
  if (!outcomes?.length) return null;
  return outcomes[outcomes.length - 1];
}

function buildLnsProgressNote(solution: Solution): string | null {
  const telemetry = solution.lnsTelemetry;
  if (!telemetry) return null;
  const latestOutcome = getLastLnsOutcome(solution);
  if (!latestOutcome) {
    return telemetry.stopReason === "running"
      ? `LNS seeded from ${telemetry.seedSource}.`
      : `LNS stopped: ${telemetry.stopReason}.`;
  }
  const improvement = latestOutcome.improvement > 0 ? ` +${latestOutcome.improvement}` : "";
  return `LNS ${latestOutcome.status}${improvement} in ${latestOutcome.phase} neighborhood ${latestOutcome.iteration + 1}. Stop: ${telemetry.stopReason}.`;
}

function serializeSolutionForLog(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads)
  };
}

function syncSerializedSolutionToFinalEntry(
  solution: SerializedSolution,
  finalEntry: SolveProgressLogEntry | null
): SerializedSolution {
  if (!finalEntry?.hasFeasibleSolution) return solution;

  let syncedSolution: SerializedSolution = solution;

  if (solution.autoStage || solution.activeOptimizer || finalEntry.autoStage || finalEntry.activeOptimizer) {
    const activeOptimizer =
      solution.activeOptimizer ?? finalEntry.activeOptimizer ?? finalEntry.autoStage?.activeStage ?? undefined;
    const resolvedActiveStage =
      solution.autoStage?.activeStage ?? activeOptimizer ?? finalEntry.autoStage?.activeStage ?? null;
    const autoStage =
      solution.autoStage || finalEntry.autoStage
        ? {
            ...(finalEntry.autoStage ?? {}),
            ...(solution.autoStage ?? {}),
            requestedOptimizer:
              solution.autoStage?.requestedOptimizer ?? finalEntry.autoStage?.requestedOptimizer ?? "auto",
            activeStage: resolvedActiveStage,
            stageIndex: solution.autoStage?.stageIndex ?? finalEntry.autoStage?.stageIndex ?? 0,
            cycleIndex: solution.autoStage?.cycleIndex ?? finalEntry.autoStage?.cycleIndex ?? 0,
            consecutiveWeakCycles:
              solution.autoStage?.consecutiveWeakCycles ?? finalEntry.autoStage?.consecutiveWeakCycles ?? 0,
            lastCycleImprovementRatio:
              solution.autoStage?.lastCycleImprovementRatio ?? finalEntry.autoStage?.lastCycleImprovementRatio ?? null,
            generatedSeeds: solution.autoStage?.generatedSeeds ?? finalEntry.autoStage?.generatedSeeds ?? [],
            ...(solution.autoStage?.stopReason == null && finalEntry.autoStage?.stopReason != null
              ? { stopReason: finalEntry.autoStage.stopReason }
              : {})
          }
        : undefined;
    syncedSolution = {
      ...syncedSolution,
      ...(activeOptimizer ? { activeOptimizer } : {}),
      ...(autoStage ? { autoStage } : {})
    };
  }

  if (!solution.cpSatTelemetry) return syncedSolution;

  const currentTelemetry = solution.cpSatTelemetry;
  const currentSolveWallTimeSeconds =
    typeof currentTelemetry.solveWallTimeSeconds === "number" && Number.isFinite(currentTelemetry.solveWallTimeSeconds)
      ? currentTelemetry.solveWallTimeSeconds
      : null;
  const finalSolveWallTimeSeconds =
    typeof finalEntry.solveWallTimeSeconds === "number" ? finalEntry.solveWallTimeSeconds : null;
  const userTimeSeconds =
    finalSolveWallTimeSeconds === null
      ? currentTelemetry.userTimeSeconds
      : currentSolveWallTimeSeconds === null
        ? finalSolveWallTimeSeconds
        : (roundTelemetrySeconds(
            currentTelemetry.userTimeSeconds + Math.max(0, finalSolveWallTimeSeconds - currentSolveWallTimeSeconds)
          ) ?? currentTelemetry.userTimeSeconds);

  return {
    ...syncedSolution,
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
      secondsSinceLastImprovement:
        finalEntry.secondsSinceLastImprovement ?? currentTelemetry.secondsSinceLastImprovement
    }
  };
}

function buildProgressEntry(
  solution: Solution,
  optimizer: OptimizerName,
  options: AppendProgressLogEntryOptions,
  state: {
    solveStartedAtElapsedMs: number | null;
    params: SolverParams;
  }
): SolveProgressLogEntry {
  const telemetry = solution.cpSatTelemetry;
  const lastLnsOutcome = getLastLnsOutcome(solution);
  const lnsProgressFields = solution.lnsTelemetry
    ? {
        lnsStopReason: solution.lnsTelemetry.stopReason,
        lnsNeighborhoodStatus: lastLnsOutcome?.status ?? null,
        lnsNeighborhoodImprovement: typeof lastLnsOutcome?.improvement === "number" ? lastLnsOutcome.improvement : null,
        lnsNeighborhoodsCompleted: solution.lnsTelemetry.iterationsCompleted
      }
    : {};
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
    solveWallTimeSeconds =
      snapshotSolveWallTimeSeconds === null
        ? derivedSolveWallTimeSeconds
        : Math.max(snapshotSolveWallTimeSeconds, derivedSolveWallTimeSeconds);
  }

  if (lastImprovementAtSeconds !== null && solveWallTimeSeconds !== null) {
    secondsSinceLastImprovement = Math.max(0, solveWallTimeSeconds - lastImprovementAtSeconds);
  } else if (snapshotSecondsSinceLastImprovement !== null && solveWallTimeSeconds !== null) {
    secondsSinceLastImprovement = Math.max(
      0,
      snapshotSecondsSinceLastImprovement +
        Math.max(0, solveWallTimeSeconds - (snapshotSolveWallTimeSeconds ?? solveWallTimeSeconds))
    );
  }

  const roundedSolveWallTimeSeconds = roundTelemetrySeconds(solveWallTimeSeconds);
  const roundedLastImprovementAtSeconds = roundTelemetrySeconds(lastImprovementAtSeconds);
  const roundedSecondsSinceLastImprovement = roundTelemetrySeconds(secondsSinceLastImprovement);
  const progressSolution: Solution = telemetry
    ? {
        ...solution,
        cpSatTelemetry: {
          ...telemetry,
          solveWallTimeSeconds: roundedSolveWallTimeSeconds ?? telemetry.solveWallTimeSeconds,
          secondsSinceLastImprovement: roundedSecondsSinceLastImprovement ?? telemetry.secondsSinceLastImprovement
        }
      }
    : solution;

  return {
    capturedAt: resolveCapturedAt(options.capturedAt),
    elapsedMs,
    source: options.source,
    optimizer: solution.optimizer ?? optimizer,
    ...(solution.activeOptimizer ? { activeOptimizer: solution.activeOptimizer } : {}),
    ...(solution.autoStage ? { autoStage: solution.autoStage } : {}),
    hasFeasibleSolution: true,
    totalPopulation: typeof solution.totalPopulation === "number" ? solution.totalPopulation : null,
    cpSatStatus: solution.cpSatStatus ?? null,
    ...lnsProgressFields,
    progressSummary: buildSolverProgressSummary(progressSolution, {
      elapsedTimeSeconds: elapsedMs / 1000,
      fallbackOptimizer: optimizer,
      params: state.params
    }),
    bestPopulationUpperBound:
      typeof telemetry?.bestPopulationUpperBound === "number" ? telemetry.bestPopulationUpperBound : null,
    populationGapUpperBound:
      typeof telemetry?.populationGapUpperBound === "number" ? telemetry.populationGapUpperBound : null,
    solveWallTimeSeconds: roundedSolveWallTimeSeconds,
    lastImprovementAtSeconds: roundedLastImprovementAtSeconds,
    secondsSinceLastImprovement: roundedSecondsSinceLastImprovement,
    note: buildLnsProgressNote(solution)
  };
}

function progressSummaryStablePayload(summary: unknown): unknown {
  if (!isRecord(summary)) return summary ?? null;
  const {
    elapsedTimeSeconds: _elapsedTimeSeconds,
    timeSinceImprovementSeconds: _timeSinceImprovementSeconds,
    ...rest
  } = summary;
  return rest;
}

function entriesMatch(left: SolveProgressLogEntry | undefined, right: SolveProgressLogEntry): boolean {
  if (!left) return false;
  return (
    left.elapsedMs === right.elapsedMs &&
    (left.lastElapsedMs ?? null) === (right.lastElapsedMs ?? null) &&
    (left.lastCapturedAt ?? null) === (right.lastCapturedAt ?? null) &&
    left.source === right.source &&
    left.optimizer === right.optimizer &&
    (left.activeOptimizer ?? null) === (right.activeOptimizer ?? null) &&
    left.hasFeasibleSolution === right.hasFeasibleSolution &&
    left.totalPopulation === right.totalPopulation &&
    left.cpSatStatus === right.cpSatStatus &&
    (left.lnsStopReason ?? null) === (right.lnsStopReason ?? null) &&
    (left.lnsNeighborhoodStatus ?? null) === (right.lnsNeighborhoodStatus ?? null) &&
    (left.lnsNeighborhoodImprovement ?? null) === (right.lnsNeighborhoodImprovement ?? null) &&
    (left.lnsNeighborhoodsCompleted ?? null) === (right.lnsNeighborhoodsCompleted ?? null) &&
    progressLogPayloadsEqual(left.progressSummary, right.progressSummary) &&
    left.bestPopulationUpperBound === right.bestPopulationUpperBound &&
    left.populationGapUpperBound === right.populationGapUpperBound &&
    left.solveWallTimeSeconds === right.solveWallTimeSeconds &&
    left.lastImprovementAtSeconds === right.lastImprovementAtSeconds &&
    left.secondsSinceLastImprovement === right.secondsSinceLastImprovement &&
    progressLogPayloadsEqual(left.autoStage, right.autoStage) &&
    (left.note ?? null) === (right.note ?? null)
  );
}

function entriesShareStableProgressSegment(
  left: SolveProgressLogEntry | undefined,
  right: SolveProgressLogEntry
): boolean {
  if (!left) return false;
  return (
    left.source === right.source &&
    left.optimizer === right.optimizer &&
    (left.activeOptimizer ?? null) === (right.activeOptimizer ?? null) &&
    left.hasFeasibleSolution === right.hasFeasibleSolution &&
    left.totalPopulation === right.totalPopulation &&
    left.cpSatStatus === right.cpSatStatus &&
    (left.lnsStopReason ?? null) === (right.lnsStopReason ?? null) &&
    (left.lnsNeighborhoodStatus ?? null) === (right.lnsNeighborhoodStatus ?? null) &&
    (left.lnsNeighborhoodImprovement ?? null) === (right.lnsNeighborhoodImprovement ?? null) &&
    (left.lnsNeighborhoodsCompleted ?? null) === (right.lnsNeighborhoodsCompleted ?? null) &&
    progressLogPayloadsEqual(
      progressSummaryStablePayload(left.progressSummary),
      progressSummaryStablePayload(right.progressSummary)
    ) &&
    left.bestPopulationUpperBound === right.bestPopulationUpperBound &&
    left.populationGapUpperBound === right.populationGapUpperBound &&
    left.lastImprovementAtSeconds === right.lastImprovementAtSeconds &&
    progressLogPayloadsEqual(left.autoStage, right.autoStage)
  );
}

function compactProgressLogEntry(
  firstEntry: SolveProgressLogEntry,
  latestEntry: SolveProgressLogEntry
): SolveProgressLogEntry {
  return {
    ...latestEntry,
    capturedAt: firstEntry.capturedAt,
    elapsedMs: firstEntry.elapsedMs,
    lastCapturedAt: latestEntry.lastCapturedAt ?? latestEntry.capturedAt,
    lastElapsedMs: latestEntry.lastElapsedMs ?? latestEntry.elapsedMs
  };
}

export class SolveProgressLogWriter {
  readonly filePath: string;

  private readonly optimizer: OptimizerName;
  private readonly document: SolveProgressLogDocument;
  private flushSequence = 0;
  private solveStartedAtElapsedMs: number | null = null;

  constructor(options: SolveProgressLogWriterOptions) {
    const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_PROGRESS_LOG_ROOT);
    mkdirSync(rootDirectory, { recursive: true });

    const timestamp = formatTimestampForFileName(options.createdAtMs);
    const safeRequestId = sanitizeFileNameSegment(options.requestId, "solve");
    this.optimizer = options.optimizer;
    this.document = {
      version: 2,
      requestId: options.requestId,
      optimizer: options.optimizer,
      createdAt: new Date(options.createdAtMs).toISOString(),
      updatedAt: new Date(options.createdAtMs).toISOString(),
      finishedAt: null,
      status: "running",
      grid: {
        rows: options.grid.length,
        cols: options.grid[0]?.length ?? 0,
        allowedCells: countAllowedCells(options.grid)
      },
      input: {
        grid: cloneProgressLogInput(options.grid),
        params: cloneProgressLogInput(options.params)
      },
      entries: [],
      message: null,
      error: null,
      finalResult: null
    };
    this.filePath = createInitialProgressLogFile(rootDirectory, `${timestamp}-${safeRequestId}`, this.document);
  }

  private observeSolutionClock(solution: Solution, elapsedMs: number): void {
    this.solveStartedAtElapsedMs = mergeSolveStartedAtElapsedMs(
      this.solveStartedAtElapsedMs,
      solveStartedAtElapsedMsFromTelemetry(solution, elapsedMs)
    );
  }

  buildSolutionSample(solution: Solution, options: AppendProgressLogEntryOptions): SolveProgressLogEntry {
    const elapsedMs = normalizeElapsedMs(options.elapsedMs);
    const solveStartedAtElapsedMs = mergeSolveStartedAtElapsedMs(
      this.solveStartedAtElapsedMs,
      solveStartedAtElapsedMsFromTelemetry(solution, elapsedMs)
    );

    return buildProgressEntry(
      solution,
      this.optimizer,
      {
        ...options,
        elapsedMs
      },
      {
        solveStartedAtElapsedMs,
        params: this.document.input.params
      }
    );
  }

  appendSolutionSample(solution: Solution, options: AppendProgressLogEntryOptions): void {
    const elapsedMs = normalizeElapsedMs(options.elapsedMs);
    this.observeSolutionClock(solution, elapsedMs);

    this.appendEntry(
      buildProgressEntry(
        solution,
        this.optimizer,
        {
          ...options,
          elapsedMs
        },
        {
          solveStartedAtElapsedMs: this.solveStartedAtElapsedMs,
          params: this.document.input.params
        }
      )
    );
  }

  appendPendingSample(options: AppendPendingProgressLogEntryOptions): void {
    this.appendEntry({
      capturedAt: resolveCapturedAt(options.capturedAt),
      elapsedMs: normalizeElapsedMs(options.elapsedMs),
      source: "live-snapshot",
      optimizer: this.optimizer,
      hasFeasibleSolution: false,
      totalPopulation: null,
      cpSatStatus: null,
      progressSummary: buildEmptySolverProgressSummary(this.optimizer, normalizeElapsedMs(options.elapsedMs) / 1000),
      bestPopulationUpperBound: null,
      populationGapUpperBound: null,
      solveWallTimeSeconds: null,
      lastImprovementAtSeconds: null,
      secondsSinceLastImprovement: null,
      note: options.note ?? "Solve started. Waiting for the first feasible solution."
    });
  }

  private appendEntry(entry: SolveProgressLogEntry): void {
    this.recordEntry(entry);
    this.flush();
  }

  private recordEntry(entry: SolveProgressLogEntry): void {
    const lastEntry = this.document.entries[this.document.entries.length - 1];
    if (entriesMatch(lastEntry, entry)) {
      this.document.entries[this.document.entries.length - 1] = entry;
    } else if (entriesShareStableProgressSegment(lastEntry, entry)) {
      this.document.entries[this.document.entries.length - 1] = compactProgressLogEntry(lastEntry, entry);
    } else {
      this.document.entries.push(entry);
    }
    this.document.updatedAt = entry.lastCapturedAt ?? entry.capturedAt;
  }

  finishWithSolutionSample(
    status: PersistedSolveStatus,
    options: {
      finishedAtMs: number;
      elapsedMs: number;
      solution: Solution;
      capturedAt?: string;
      message?: string | null;
      error?: string | null;
    }
  ): void {
    const finishedAt = new Date(options.finishedAtMs).toISOString();
    const elapsedMs = normalizeElapsedMs(options.elapsedMs);
    this.observeSolutionClock(options.solution, elapsedMs);
    this.recordEntry(
      buildProgressEntry(
        options.solution,
        this.optimizer,
        {
          capturedAt: options.capturedAt ?? finishedAt,
          elapsedMs,
          source: "final-result"
        },
        {
          solveStartedAtElapsedMs: this.solveStartedAtElapsedMs,
          params: this.document.input.params
        }
      )
    );
    this.applyFinish(status, {
      finishedAtMs: options.finishedAtMs,
      solution: options.solution,
      message: options.message,
      error: options.error
    });
    this.flush();
  }

  finish(
    status: PersistedSolveStatus,
    options: {
      finishedAtMs: number;
      solution?: Solution | null;
      message?: string | null;
      error?: string | null;
    }
  ): void {
    this.applyFinish(status, options);
    this.flush();
  }

  private applyFinish(
    status: PersistedSolveStatus,
    options: {
      finishedAtMs: number;
      solution?: Solution | null;
      message?: string | null;
      error?: string | null;
    }
  ): void {
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
        mapText: mapRows.join("\n")
      };
    } else {
      this.document.finalResult = null;
    }
  }

  private flush(): void {
    const tempFilePath = `${this.filePath}.${process.pid}.${this.flushSequence++}.tmp`;
    try {
      writeFileSync(tempFilePath, serializeProgressLogDocument(this.document), "utf8");
      renameSync(tempFilePath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(tempFilePath);
      } catch {
        // Best effort cleanup. The reader ignores non-.json temp files if a process exits mid-flush.
      }
      throw error;
    }
  }

  getLastEntry(): SolveProgressLogEntry | null {
    return this.document.entries[this.document.entries.length - 1] ?? null;
  }
}

export const DEFAULT_SOLVE_PROGRESS_LOG_ROOT = DEFAULT_PROGRESS_LOG_ROOT;
