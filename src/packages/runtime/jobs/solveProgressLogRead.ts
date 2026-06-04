import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  isOptimizerName,
  isSolveProgressSampleSource,
  isSolveRunStatus,
  SOLVE_PROGRESS_SAMPLE_SOURCE_FINAL_RESULT,
  SOLVE_RUN_STATUS_COMPLETED,
  SOLVE_RUN_STATUS_FAILED,
  SOLVE_RUN_STATUS_RUNNING,
  SOLVE_RUN_STATUS_STOPPED
} from "../../core/index.js";

import type { SolveProgressLogEntry } from "../../core/index.js";
import type { PersistedSolveStatus, SolveProgressLogDocument, SolveProgressLogReadResult } from "./solveProgressLog.js";

export const DEFAULT_PROGRESS_LOG_ROOT = resolve(process.cwd(), "artifacts", "solve-progress");

function isPersistedSolveStatus(value: unknown): value is PersistedSolveStatus {
  return isSolveRunStatus(value);
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
  if (!isSolveProgressSampleSource(value.source)) return false;
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

  if (value.status === SOLVE_RUN_STATUS_RUNNING) {
    if (value.finishedAt !== null || value.finalResult !== null) return null;
    if (value.entries.some((entry) => entry.source === SOLVE_PROGRESS_SAMPLE_SOURCE_FINAL_RESULT)) return null;
  }
  if (value.status === SOLVE_RUN_STATUS_FAILED && value.finalResult !== null) return null;

  if (value.finalResult !== null) {
    if (value.status !== SOLVE_RUN_STATUS_COMPLETED && value.status !== SOLVE_RUN_STATUS_STOPPED) {
      return null;
    }
    if (!isProgressLogFinalResult(value.finalResult)) return null;
    const finalEntry = value.entries[value.entries.length - 1] ?? null;
    if (
      !finalEntry ||
      finalEntry.source !== SOLVE_PROGRESS_SAMPLE_SOURCE_FINAL_RESULT ||
      !finalEntry.hasFeasibleSolution
    ) {
      return null;
    }
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
