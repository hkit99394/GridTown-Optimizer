import { getOptimizerAdapter } from "./optimizerRegistry.js";
import { SolveProgressLogWriter } from "./solveProgressLog.js";
import type { BackgroundSolveHandle, Grid, OptimizerName, Solution, SolverParams } from "./types.js";

export type SolveJobStatus = "running" | "completed" | "stopped" | "failed";

const DEFAULT_PROGRESS_LOG_INTERVAL_MS = 60 * 1000;
const DEFAULT_PROGRESS_LOG_POLL_INTERVAL_MS = 5 * 1000;
const DEFAULT_COMPLETED_JOB_RETENTION_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RETAINED_COMPLETED_JOBS = 64;

export interface SolveJobManagerOptions {
  progressLogRoot?: string;
  progressLogIntervalMs?: number;
  progressLogPollIntervalMs?: number;
  completedJobRetentionMs?: number;
  maxRetainedCompletedJobs?: number;
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
  private readonly completedJobRetentionMs: number;
  private readonly maxRetainedCompletedJobs: number;

  constructor(options: SolveJobManagerOptions = {}) {
    this.progressLogRoot = options.progressLogRoot;
    this.progressLogIntervalMs = options.progressLogIntervalMs ?? DEFAULT_PROGRESS_LOG_INTERVAL_MS;
    this.progressLogPollIntervalMs = options.progressLogPollIntervalMs ?? DEFAULT_PROGRESS_LOG_POLL_INTERVAL_MS;
    this.completedJobRetentionMs = Math.max(0, options.completedJobRetentionMs ?? DEFAULT_COMPLETED_JOB_RETENTION_MS);
    this.maxRetainedCompletedJobs = Math.max(1, options.maxRetainedCompletedJobs ?? DEFAULT_MAX_RETAINED_COMPLETED_JOBS);
  }

  start(grid: Grid, params: SolverParams, requestId: string): SolveJob {
    this.pruneJobs();
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
        const status = solution.stoppedByUser || job.cancelRequested ? "stopped" : "completed";
        const message = status === "stopped"
          ? "Solve was stopped by user. Showing the best feasible result found so far."
          : null;
        this.finalizeJobWithSolution(job, solution, status, message);
      })
      .catch((error) => {
        const recoveredSolution = job.handle?.getLatestSnapshot() ?? null;
        if (recoveredSolution) {
          const solution = {
            ...recoveredSolution,
            stoppedByUser: job.cancelRequested ? true : Boolean(recoveredSolution.stoppedByUser),
          };
          const status = job.cancelRequested ? "stopped" : "completed";
          const message = job.cancelRequested
            ? "Solve was stopped by user. Showing the best feasible result found so far."
            : buildRecoveredSolveMessage(job, error);
          this.finalizeJobWithSolution(job, solution, status, message);
          return;
        }

        this.finalizeJobWithoutSolution(
          job,
          job.cancelRequested ? "stopped" : "failed",
          job.cancelRequested ? "Solve was stopped before a feasible solution was found." : null,
          error instanceof Error ? error.message : "Unknown CP-SAT error."
        );
      })
      .finally(() => {
        this.releaseJobResources(job);
      });

    return job;
  }

  get(requestId: string): SolveJob | null {
    this.pruneJobs();
    return this.jobs.get(requestId) ?? null;
  }

  replaceIfIdle(requestId: string): SolveJob | null {
    this.pruneJobs();
    const existingJob = this.jobs.get(requestId) ?? null;
    if (existingJob && existingJob.status !== "running") {
      this.jobs.delete(requestId);
    }
    return existingJob;
  }

  getStatus(requestId: string, includeSnapshot: boolean): SolveJobStatusView | null {
    this.pruneJobs();
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
    this.pruneJobs();
    const job = this.jobs.get(requestId) ?? null;
    if (!job || job.status !== "running" || !job.handle) {
      return job;
    }

    job.cancelRequested = true;
    job.handle.cancel();
    return job;
  }

  private pruneJobs(now = Date.now()): void {
    const retainedCompletedJobs: SolveJob[] = [];

    for (const [requestId, job] of this.jobs) {
      if (job.status === "running") continue;

      const finishedAt = job.finishedAt ?? job.createdAt;
      if (now - finishedAt > this.completedJobRetentionMs) {
        this.jobs.delete(requestId);
        continue;
      }
      retainedCompletedJobs.push(job);
    }

    if (retainedCompletedJobs.length <= this.maxRetainedCompletedJobs) return;

    retainedCompletedJobs.sort((left, right) => (left.finishedAt ?? left.createdAt) - (right.finishedAt ?? right.createdAt));
    for (const job of retainedCompletedJobs.slice(0, retainedCompletedJobs.length - this.maxRetainedCompletedJobs)) {
      this.jobs.delete(job.requestId);
    }
  }

  private finalizeJobWithSolution(
    job: SolveJob,
    solution: Solution,
    status: Exclude<SolveJobStatus, "running" | "failed"> | "completed",
    message: string | null
  ): void {
    const finishedAtMs = Date.now();
    job.solution = solution;
    job.status = status;
    job.message = message;
    job.error = null;
    job.progressLogWriter.appendSolutionSample(solution, {
      elapsedMs: finishedAtMs - job.createdAt,
      source: "final-result",
    });
    job.progressLogWriter.finish(status, {
      finishedAtMs,
      solution,
      message,
      error: null,
    });
  }

  private finalizeJobWithoutSolution(
    job: SolveJob,
    status: Exclude<SolveJobStatus, "running" | "completed">,
    message: string | null,
    error: string
  ): void {
    const finishedAtMs = Date.now();
    job.solution = null;
    job.status = status;
    job.message = message;
    job.error = error;
    job.progressLogWriter.finish(status, {
      finishedAtMs,
      solution: null,
      message,
      error,
    });
  }

  private releaseJobResources(job: SolveJob): void {
    if (job.progressLogIntervalHandle) {
      clearInterval(job.progressLogIntervalHandle);
      job.progressLogIntervalHandle = null;
    }
    job.handle = null;
    job.finishedAt = Date.now();
    this.pruneJobs(job.finishedAt);
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
