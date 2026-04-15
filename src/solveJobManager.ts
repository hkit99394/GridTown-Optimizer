import { getOptimizerAdapter } from "./optimizerRegistry.js";
import { SolveProgressLogWriter } from "./solveProgressLog.js";
import type { BackgroundSolveHandle, Grid, OptimizerName, Solution, SolverParams } from "./types.js";

export type SolveJobStatus = "running" | "completed" | "stopped" | "failed";

const DEFAULT_PROGRESS_LOG_INTERVAL_MS = 60 * 1000;
const DEFAULT_PROGRESS_LOG_POLL_INTERVAL_MS = 5 * 1000;

export interface SolveJobManagerOptions {
  progressLogRoot?: string;
  progressLogIntervalMs?: number;
  progressLogPollIntervalMs?: number;
}

export interface SolveJob {
  requestId: string;
  optimizer: OptimizerName;
  grid: Grid;
  params: SolverParams;
  status: SolveJobStatus;
  cancelRequested: boolean;
  handle: BackgroundSolveHandle | null;
  solution: Solution | null;
  message: string | null;
  error: string | null;
  createdAt: number;
  finishedAt?: number;
  progressLogFilePath: string;
  progressLogWriter: SolveProgressLogWriter;
  progressLogIntervalHandle: NodeJS.Timeout | null;
}

export interface SolveJobSnapshotState {
  hasFeasibleSolution: boolean;
  totalPopulation: number | null;
}

export interface SolveJobStatusView {
  job: SolveJob;
  snapshotState: SolveJobSnapshotState;
  liveSnapshot: Solution | null;
}

function buildRecoveredSolveMessage(job: SolveJob, error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Unknown solver error.";
  if (
    job.optimizer === "lns"
    && /No feasible solution found with CP-SAT\. Status: UNKNOWN\./.test(rawMessage)
  ) {
    return "LNS kept the best available seed because the latest neighborhood repair found no improvement.";
  }
  if (job.optimizer === "lns") {
    return "LNS kept the best available solution after a repair step ended early.";
  }
  return "Showing the best available solution captured before the solver stopped progressing.";
}

export class SolveJobManager {
  private readonly jobs = new Map<string, SolveJob>();
  private readonly progressLogRoot?: string;
  private readonly progressLogIntervalMs: number;
  private readonly progressLogPollIntervalMs: number;

  constructor(options: SolveJobManagerOptions = {}) {
    this.progressLogRoot = options.progressLogRoot;
    this.progressLogIntervalMs = options.progressLogIntervalMs ?? DEFAULT_PROGRESS_LOG_INTERVAL_MS;
    this.progressLogPollIntervalMs = options.progressLogPollIntervalMs ?? DEFAULT_PROGRESS_LOG_POLL_INTERVAL_MS;
  }

  start(grid: Grid, params: SolverParams, requestId: string): SolveJob {
    const optimizerAdapter = getOptimizerAdapter(params);
    const optimizer = optimizerAdapter.name;
    const handle = optimizerAdapter.startBackgroundSolve(grid, params);
    const createdAt = Date.now();
    const progressLogWriter = new SolveProgressLogWriter({
      rootDirectory: this.progressLogRoot,
      requestId,
      optimizer,
      grid,
      params,
      createdAtMs: createdAt,
    });
    const job: SolveJob = {
      requestId,
      optimizer,
      grid,
      params,
      status: "running",
      cancelRequested: false,
      handle,
      solution: null,
      message: null,
      error: null,
      createdAt,
      progressLogFilePath: progressLogWriter.filePath,
      progressLogWriter,
      progressLogIntervalHandle: null,
    };

    this.jobs.set(requestId, job);
    job.progressLogWriter.appendPendingSample({
      elapsedMs: 0,
    });
    job.progressLogIntervalHandle = this.startProgressLogTicker(job);

    void handle.promise
      .then((solution) => {
        job.solution = solution;
        job.status = solution.stoppedByUser || job.cancelRequested ? "stopped" : "completed";
        job.message = job.status === "stopped"
          ? "Solve was stopped by user. Showing the best feasible result found so far."
          : null;
        job.error = null;
        job.progressLogWriter.appendSolutionSample(solution, {
          elapsedMs: Date.now() - job.createdAt,
          source: "final-result",
        });
        job.progressLogWriter.finish(job.status, {
          finishedAtMs: Date.now(),
          solution,
          message: job.message,
          error: null,
        });
      })
      .catch((error) => {
        const recoveredSolution = job.handle?.getLatestSnapshot() ?? null;
        if (recoveredSolution) {
          job.solution = {
            ...recoveredSolution,
            stoppedByUser: job.cancelRequested ? true : Boolean(recoveredSolution.stoppedByUser),
          };
          job.status = job.cancelRequested ? "stopped" : "completed";
          job.message = job.cancelRequested
            ? "Solve was stopped by user. Showing the best feasible result found so far."
            : buildRecoveredSolveMessage(job, error);
          job.error = null;
          job.progressLogWriter.appendSolutionSample(job.solution, {
            elapsedMs: Date.now() - job.createdAt,
            source: "final-result",
          });
          job.progressLogWriter.finish(job.status, {
            finishedAtMs: Date.now(),
            solution: job.solution,
            message: job.message,
            error: null,
          });
          return;
        }

        job.solution = null;
        job.status = job.cancelRequested ? "stopped" : "failed";
        job.message = job.cancelRequested ? "Solve was stopped before a feasible solution was found." : null;
        job.error = error instanceof Error ? error.message : "Unknown CP-SAT error.";
        job.progressLogWriter.finish(job.status, {
          finishedAtMs: Date.now(),
          solution: null,
          message: job.message,
          error: job.error,
        });
      })
      .finally(() => {
        if (job.progressLogIntervalHandle) {
          clearInterval(job.progressLogIntervalHandle);
          job.progressLogIntervalHandle = null;
        }
        job.handle = null;
        job.finishedAt = Date.now();
      });

    return job;
  }

  get(requestId: string): SolveJob | null {
    return this.jobs.get(requestId) ?? null;
  }

  replaceIfIdle(requestId: string): SolveJob | null {
    const existingJob = this.jobs.get(requestId) ?? null;
    if (existingJob && existingJob.status !== "running") {
      this.jobs.delete(requestId);
    }
    return existingJob;
  }

  getStatus(requestId: string, includeSnapshot: boolean): SolveJobStatusView | null {
    const job = this.jobs.get(requestId) ?? null;
    if (!job) return null;

    const snapshotState = job.handle?.getLatestSnapshotState() ?? {
      hasFeasibleSolution: false,
      totalPopulation: null,
    };

    return {
      job,
      snapshotState,
      liveSnapshot: includeSnapshot ? (job.handle?.getLatestSnapshot() ?? null) : null,
    };
  }

  cancel(requestId: string): SolveJob | null {
    const job = this.jobs.get(requestId) ?? null;
    if (!job || job.status !== "running" || !job.handle) {
      return job;
    }

    job.cancelRequested = true;
    job.handle.cancel();
    return job;
  }

  private startProgressLogTicker(job: SolveJob): NodeJS.Timeout {
    const tick = () => {
      const elapsedMs = Date.now() - job.createdAt;
      const lastEntry = job.progressLogWriter.getLastEntry();
      const snapshot = job.handle?.getLatestSnapshot() ?? null;
      if (!snapshot) {
        if (!lastEntry || lastEntry.hasFeasibleSolution) return;
        if (elapsedMs - lastEntry.elapsedMs < this.progressLogIntervalMs) return;
        job.progressLogWriter.appendPendingSample({
          elapsedMs,
          note: "Still searching for the first feasible solution.",
        });
        return;
      }

      const bestPopulationUpperBound = snapshot.cpSatTelemetry?.bestPopulationUpperBound ?? null;
      const populationGapUpperBound = snapshot.cpSatTelemetry?.populationGapUpperBound ?? null;
      const shouldAppendImmediately = !lastEntry
        || !lastEntry.hasFeasibleSolution
        || lastEntry.totalPopulation !== snapshot.totalPopulation
        || lastEntry.cpSatStatus !== (snapshot.cpSatStatus ?? null)
        || lastEntry.bestPopulationUpperBound !== bestPopulationUpperBound
        || lastEntry.populationGapUpperBound !== populationGapUpperBound;

      const shouldAppendHeartbeat = !shouldAppendImmediately
        && (!lastEntry || elapsedMs - lastEntry.elapsedMs >= this.progressLogIntervalMs);

      if (!shouldAppendImmediately && !shouldAppendHeartbeat) return;

      job.progressLogWriter.appendSolutionSample(snapshot, {
        elapsedMs,
        source: "live-snapshot",
      });
    };

    const handle = setInterval(tick, this.progressLogPollIntervalMs);
    handle.unref?.();
    return handle;
  }
}
