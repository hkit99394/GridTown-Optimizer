/**
 * Central optimizer registry for synchronous and background execution.
 *
 * Keeping this dispatch in one place makes new optimizers cheaper to add:
 * the web host, CLI-facing dispatcher, and future metaheuristics can all
 * resolve the same adapter instead of branching independently.
 */

import {
  describeAutoCompletedSolution,
  describeAutoRecoveredSolution,
  normalizeAutoTerminalSolution,
  solveAuto,
  startAutoSolve,
} from "../../auto/solver.js";
import { solveCpSat, solveCpSatAsync, startCpSatSolve } from "../../cp-sat/solver.js";
import { startGreedySolve } from "../../greedy/bridge.js";
import { startLnsSolve } from "../../lns/bridge.js";
import { solveLns } from "../../lns/solver.js";
import { solveGreedy } from "../../greedy/solver.js";
import { isOptimizerName, OMITTED_SOLVER_OPTIMIZER } from "../../packages/core/index.js";

import type {
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  CpSatAsyncOptions,
  Grid,
  OptimizerName,
  Solution,
  SolveProgressLogEntry,
  SolverParams,
} from "../../packages/core/index.js";

export interface OptimizerFinalizationContext {
  cancelRequested: boolean;
  snapshotState: BackgroundSolveSnapshotState | null;
  lastProgressEntry: SolveProgressLogEntry | null;
}

export interface OptimizerAdapter {
  name: OptimizerName;
  solve: (grid: Grid, params: SolverParams) => Solution;
  solveAsync?: (grid: Grid, params: SolverParams, cpSatAsyncOptions?: CpSatAsyncOptions) => Promise<Solution>;
  startBackgroundSolve: (grid: Grid, params: SolverParams) => BackgroundSolveHandle;
  normalizeTerminalSolution?: (solution: Solution, context: OptimizerFinalizationContext) => Solution;
  describeCompletedSolution?: (solution: Solution) => string | null;
  describeRecoveredSolution?: (solution: Solution, error: unknown) => string;
}

function describeDefaultRecoveredSolution(): string {
  return "Showing the best available solution captured before the solver stopped progressing.";
}

function describeLnsRecoveredSolution(_solution: Solution, error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Unknown solver error.";
  if (/No feasible solution found with CP-SAT\. Status: UNKNOWN\./.test(rawMessage)) {
    return "LNS kept the best available seed because the latest neighborhood repair found no improvement.";
  }
  return "LNS kept the best available solution after a repair step ended early.";
}

const optimizerAdapters: Record<OptimizerName, OptimizerAdapter> = {
  auto: {
    name: "auto",
    solve: solveAuto,
    solveAsync: (grid, params) => startAutoSolve(grid, params).promise,
    startBackgroundSolve: startAutoSolve,
    normalizeTerminalSolution: normalizeAutoTerminalSolution,
    describeCompletedSolution: describeAutoCompletedSolution,
    describeRecoveredSolution: describeAutoRecoveredSolution,
  },
  greedy: {
    name: "greedy",
    solve: solveGreedy,
    startBackgroundSolve: startGreedySolve,
    describeRecoveredSolution: describeDefaultRecoveredSolution,
  },
  "cp-sat": {
    name: "cp-sat",
    solve: solveCpSat,
    solveAsync: (grid, params, cpSatAsyncOptions) => solveCpSatAsync(grid, params, cpSatAsyncOptions),
    startBackgroundSolve: startCpSatSolve,
    describeRecoveredSolution: describeDefaultRecoveredSolution,
  },
  lns: {
    name: "lns",
    solve: solveLns,
    startBackgroundSolve: startLnsSolve,
    describeRecoveredSolution: describeLnsRecoveredSolution,
  },
};

export function resolveOptimizerName(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerName {
  const candidate = typeof value === "string" ? value : value?.optimizer;
  return isOptimizerName(candidate) ? candidate : OMITTED_SOLVER_OPTIMIZER;
}

export function getOptimizerAdapter(
  value: Pick<SolverParams, "optimizer"> | OptimizerName | null | undefined
): OptimizerAdapter {
  return optimizerAdapters[resolveOptimizerName(value)];
}

export function listOptimizerAdapters(): OptimizerAdapter[] {
  return Object.values(optimizerAdapters);
}
