import { assertValidSolveInputs } from "../../../packages/core/index.js";
import {
  type SolveJob,
  type SolveJobStatusView,
  type SolveProgressLogReadResult
} from "../../../packages/runtime/index.js";
import { assertValidSerializedSolutionPayload, materializeSerializedSolution } from "./contracts.js";
import { buildCompactSolveResponse } from "./solutionResponse.js";

import type { Solution } from "../../../packages/core/index.js";

interface SolveStatusProjection {
  statusCode: number;
  payload: Record<string, unknown>;
}

function buildSolveJobResponseBase(job: {
  requestId: string;
  clientRole?: string;
  optimizer: string;
  status: string;
  cancelRequested: boolean;
  progressLogFilePath: string;
  createdAt?: number;
  finishedAt?: number;
}) {
  const elapsedMs =
    job.createdAt === undefined ? undefined : Math.max(0, (job.finishedAt ?? Date.now()) - job.createdAt);
  return {
    ok: true,
    requestId: job.requestId,
    clientRole: job.clientRole,
    optimizer: job.optimizer,
    jobStatus: job.status,
    cancelRequested: job.cancelRequested,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    progressLogFilePath: job.progressLogFilePath
  };
}

function buildSolveJobInput(job: Pick<SolveJob, "grid" | "params">) {
  return {
    grid: job.grid,
    params: job.params
  };
}

export function buildActiveSolveResponse(job: SolveJob) {
  const progressEntry = job.progressLogWriter.getLastEntry();
  const snapshotState = job.handle?.getLatestSnapshotState() ?? {
    hasFeasibleSolution: false,
    totalPopulation: null
  };

  return {
    ...buildSolveJobResponseBase(job),
    active: true,
    input: buildSolveJobInput(job),
    hasFeasibleSolution: snapshotState.hasFeasibleSolution,
    bestTotalPopulation: snapshotState.totalPopulation,
    activeOptimizer: snapshotState.activeOptimizer ?? null,
    autoStage: snapshotState.autoStage ?? null,
    ...(progressEntry ? { progressEntry } : {}),
    ...(job.message ? { message: job.message } : {})
  };
}

function buildLiveProgressEntry(job: SolveJob, solution: Solution) {
  return job.progressLogWriter.buildSolutionSample(solution, {
    elapsedMs: Date.now() - job.createdAt,
    source: "live-snapshot"
  });
}

function buildProgressLogStatusResponseBase(progressLog: SolveProgressLogReadResult) {
  const { document, filePath } = progressLog;
  return {
    ok: true,
    requestId: document.requestId,
    optimizer: document.optimizer,
    jobStatus: document.status,
    cancelRequested: document.status === "stopped" || Boolean(document.finalResult?.stoppedByUser),
    progressLogFilePath: filePath
  };
}

function buildOrphanedRunningProgressLogMessage(): string {
  return "Solver status was lost because the local server is no longer tracking this run. The progress log still shows it as running, so the server was likely stopped or restarted before the solve finished.";
}

function buildTerminalProgressLogError(progressLog: SolveProgressLogReadResult): string {
  const { status, error } = progressLog.document;
  return (
    error ??
    (status === "stopped"
      ? "Solve was stopped."
      : status === "failed"
        ? "Solve failed."
        : "Solve completed without a persisted final result.")
  );
}

function getRecoveredProgressLogValidationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown validation error.";
  return `Recovered solve progress log is invalid and cannot be materialized: ${detail}`;
}

function buildRecoveredProgressLogTerminalErrorResponse(
  progressLog: SolveProgressLogReadResult,
  progressEntry: SolveProgressLogReadResult["document"]["entries"][number] | null,
  error: string
) {
  const { document } = progressLog;
  return {
    ...buildProgressLogStatusResponseBase(progressLog),
    ...(document.message ? { message: document.message } : {}),
    ...(progressEntry ? { progressEntry } : {}),
    error
  };
}

export function buildRecoveredProgressLogStatusResponse(
  progressLog: SolveProgressLogReadResult
): SolveStatusProjection {
  const { document, filePath } = progressLog;
  const progressEntry = document.entries[document.entries.length - 1] ?? null;
  if (document.status !== "running") {
    if (document.finalResult) {
      let compactResponse: ReturnType<typeof buildCompactSolveResponse>;
      try {
        assertValidSolveInputs(document.input.grid, document.input.params);
        assertValidSerializedSolutionPayload(
          document.finalResult.solution,
          "Recovered progress log finalResult.solution"
        );
        const solution = materializeSerializedSolution(document.finalResult.solution);
        compactResponse = buildCompactSolveResponse(document.input.grid, document.input.params, solution, {
          validationMode: "lightweight"
        });
      } catch (error) {
        return {
          statusCode: 200,
          payload: buildRecoveredProgressLogTerminalErrorResponse(
            progressLog,
            progressEntry,
            getRecoveredProgressLogValidationError(error)
          )
        };
      }

      return {
        statusCode: 200,
        payload: {
          ...buildProgressLogStatusResponseBase(progressLog),
          ...(document.message ? { message: document.message } : {}),
          ...(document.error ? { error: document.error } : {}),
          ...(progressEntry ? { progressEntry } : {}),
          ...compactResponse
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        ...buildProgressLogStatusResponseBase(progressLog),
        ...(document.message ? { message: document.message } : {}),
        ...(progressEntry ? { progressEntry } : {}),
        error: buildTerminalProgressLogError(progressLog)
      }
    };
  }

  return {
    statusCode: 410,
    payload: {
      ok: false,
      requestId: document.requestId,
      optimizer: document.optimizer,
      jobStatus: document.status === "running" ? "failed" : document.status,
      cancelRequested: false,
      progressLogFilePath: filePath,
      ...(progressEntry ? { progressEntry } : {}),
      error: buildOrphanedRunningProgressLogMessage()
    }
  };
}

export function buildSolveStatusResponse(jobStatus: SolveJobStatusView): SolveStatusProjection {
  const { job, snapshotState, liveSnapshot } = jobStatus;

  if (job.solution) {
    const progressEntry = job.progressLogWriter.getLastEntry();
    return {
      statusCode: 200,
      payload: {
        ...buildSolveJobResponseBase(job),
        ...(job.message ? { message: job.message } : {}),
        ...(progressEntry ? { progressEntry } : {}),
        ...buildCompactSolveResponse(job.grid, job.params, job.solution, { validationMode: "lightweight" })
      }
    };
  }

  if (job.status !== "running") {
    return {
      statusCode: 200,
      payload: {
        ...buildSolveJobResponseBase(job),
        error: job.error ?? (job.status === "stopped" ? "Solve was stopped." : "Solve failed.")
      }
    };
  }

  if (liveSnapshot) {
    const progressEntry = buildLiveProgressEntry(job, liveSnapshot);
    return {
      statusCode: 200,
      payload: {
        ...buildSolveJobResponseBase(job),
        hasFeasibleSolution: snapshotState.hasFeasibleSolution,
        bestTotalPopulation: snapshotState.totalPopulation,
        activeOptimizer: snapshotState.activeOptimizer ?? null,
        autoStage: snapshotState.autoStage ?? null,
        progressEntry,
        liveSnapshot: true,
        ...(job.message ? { message: job.message } : {}),
        ...buildCompactSolveResponse(job.grid, job.params, liveSnapshot, { validationMode: "lightweight" })
      }
    };
  }

  const progressEntry = job.progressLogWriter.getLastEntry();
  return {
    statusCode: 200,
    payload: {
      ...buildSolveJobResponseBase(job),
      hasFeasibleSolution: snapshotState.hasFeasibleSolution,
      bestTotalPopulation: snapshotState.totalPopulation,
      activeOptimizer: snapshotState.activeOptimizer ?? null,
      autoStage: snapshotState.autoStage ?? null,
      ...(progressEntry ? { progressEntry } : {})
    }
  };
}
