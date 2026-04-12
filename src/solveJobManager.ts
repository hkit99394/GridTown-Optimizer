import { getOptimizerAdapter } from "./optimizerRegistry.js";
import type { BackgroundSolveHandle, Grid, OptimizerName, Solution, SolverParams } from "./types.js";

export type SolveJobStatus = "running" | "completed" | "stopped" | "failed";

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

  start(grid: Grid, params: SolverParams, requestId: string): SolveJob {
    const optimizerAdapter = getOptimizerAdapter(params);
    const optimizer = optimizerAdapter.name;
    const handle = optimizerAdapter.startBackgroundSolve(grid, params);
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
      createdAt: Date.now(),
    };

    this.jobs.set(requestId, job);

    void handle.promise
      .then((solution) => {
        job.solution = solution;
        job.status = solution.stoppedByUser || job.cancelRequested ? "stopped" : "completed";
        job.message = null;
        job.error = null;
      })
      .catch((error) => {
        const recoveredSolution = job.handle?.getLatestSnapshot() ?? null;
        if (recoveredSolution) {
          job.solution = {
            ...recoveredSolution,
            stoppedByUser: job.cancelRequested ? true : Boolean(recoveredSolution.stoppedByUser),
          };
          job.status = job.cancelRequested ? "stopped" : "completed";
          job.message = job.cancelRequested ? null : buildRecoveredSolveMessage(job, error);
          job.error = null;
          return;
        }

        job.solution = null;
        job.status = job.cancelRequested ? "stopped" : "failed";
        job.message = null;
        job.error = error instanceof Error ? error.message : "Unknown CP-SAT error.";
      })
      .finally(() => {
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
}
