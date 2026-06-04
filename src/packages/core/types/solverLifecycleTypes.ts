import type { AutoSolveStageMetadata } from "./autoTypes.js";
import type { AutoStageOptimizerName } from "./baseTypes.js";

export const SOLVER_LIFECYCLE_TERMS = Object.freeze([
  "start",
  "progress",
  "snapshot",
  "cancel",
  "recovered-solution",
  "terminal-status"
] as const);

export type SolverLifecycleTerm = (typeof SOLVER_LIFECYCLE_TERMS)[number];

export interface SolverLifecycleContractEntry {
  term: SolverLifecycleTerm;
  summary: string;
}

export const SOLVER_LIFECYCLE_CONTRACT: Readonly<Record<SolverLifecycleTerm, SolverLifecycleContractEntry>> =
  Object.freeze({
    start: {
      term: "start",
      summary: "A solve has been admitted, a background handle exists, and progress logging can record pending work."
    },
    progress: {
      term: "progress",
      summary: "A time-ordered sample of solver state, either pending first feasibility or carrying a feasible layout."
    },
    snapshot: {
      term: "snapshot",
      summary: "The latest best-so-far feasible solution plus lightweight metadata available while a solve is running."
    },
    cancel: {
      term: "cancel",
      summary: "A user or host request to stop work while preserving the best feasible snapshot when one exists."
    },
    "recovered-solution": {
      term: "recovered-solution",
      summary:
        "A terminal response materialized from the latest feasible snapshot after cancellation or backend failure."
    },
    "terminal-status": {
      term: "terminal-status",
      summary: "The final persisted solve state: completed, stopped, or failed."
    }
  });

export const SOLVE_RUN_STATUS_RUNNING = "running";
export const SOLVE_RUN_STATUS_COMPLETED = "completed";
export const SOLVE_RUN_STATUS_STOPPED = "stopped";
export const SOLVE_RUN_STATUS_FAILED = "failed";

export const SOLVE_RUN_STATUSES = Object.freeze([
  SOLVE_RUN_STATUS_RUNNING,
  SOLVE_RUN_STATUS_COMPLETED,
  SOLVE_RUN_STATUS_STOPPED,
  SOLVE_RUN_STATUS_FAILED
] as const);

export type SolveRunStatus = (typeof SOLVE_RUN_STATUSES)[number];

export const SOLVE_TERMINAL_STATUSES = Object.freeze([
  SOLVE_RUN_STATUS_COMPLETED,
  SOLVE_RUN_STATUS_STOPPED,
  SOLVE_RUN_STATUS_FAILED
] as const);

export type SolveTerminalStatus = (typeof SOLVE_TERMINAL_STATUSES)[number];

export const SOLVE_PROGRESS_SAMPLE_SOURCE_LIVE_SNAPSHOT = "live-snapshot";
export const SOLVE_PROGRESS_SAMPLE_SOURCE_FINAL_RESULT = "final-result";

export const SOLVE_PROGRESS_SAMPLE_SOURCES = Object.freeze([
  SOLVE_PROGRESS_SAMPLE_SOURCE_LIVE_SNAPSHOT,
  SOLVE_PROGRESS_SAMPLE_SOURCE_FINAL_RESULT
] as const);

export type SolveProgressSampleSource = (typeof SOLVE_PROGRESS_SAMPLE_SOURCES)[number];

const SOLVE_RUN_STATUS_VALUES = new Set<string>(SOLVE_RUN_STATUSES);
const SOLVE_TERMINAL_STATUS_VALUES = new Set<string>(SOLVE_TERMINAL_STATUSES);
const SOLVE_PROGRESS_SAMPLE_SOURCE_VALUES = new Set<string>(SOLVE_PROGRESS_SAMPLE_SOURCES);

export interface SolverLifecycleSnapshotState {
  hasFeasibleSolution: boolean;
  totalPopulation: number | null;
  activeOptimizer?: AutoStageOptimizerName | null;
  autoStage?: AutoSolveStageMetadata | null;
  cpSatStatus?: string | null;
  bestPopulationUpperBound?: number | null;
  populationGapUpperBound?: number | null;
  solveWallTimeSeconds?: number | null;
  lastImprovementAtSeconds?: number | null;
  secondsSinceLastImprovement?: number | null;
}

export function isSolveRunStatus(value: unknown): value is SolveRunStatus {
  return typeof value === "string" && SOLVE_RUN_STATUS_VALUES.has(value);
}

export function isSolveTerminalStatus(value: unknown): value is SolveTerminalStatus {
  return typeof value === "string" && SOLVE_TERMINAL_STATUS_VALUES.has(value);
}

export function isSolveProgressSampleSource(value: unknown): value is SolveProgressSampleSource {
  return typeof value === "string" && SOLVE_PROGRESS_SAMPLE_SOURCE_VALUES.has(value);
}
