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
  solveAuto
} from "../../solvers/auto/solver.js";
import { solveCpSat, solveCpSatAsync } from "../../solvers/cp-sat/solver.js";
import { solveGreedy } from "../../solvers/greedy/solver.js";
import { solveLns } from "../../solvers/lns/solver.js";
import { isOptimizerName, OMITTED_SOLVER_OPTIMIZER } from "../../core/index.js";
import { startAutoSolve } from "./autoBackgroundSolver.js";
import { startCpSatSolve, startGreedySolve, startLnsSolve } from "./backgroundSolvers.js";
import {
  buildNoRoadAnchorSolution,
  shouldReturnNoRoadAnchorSolution,
  startNoRoadAnchorSolve
} from "./noRoadAnchorSolution.js";

import type {
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  CpSatAsyncOptions,
  Grid,
  OptimizerName,
  Solution,
  SolveProgressLogEntry,
  SolverParams
} from "../../core/index.js";

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

function solveWithRoadAnchorGuard(
  optimizer: OptimizerName,
  grid: Grid,
  params: SolverParams,
  solve: (grid: Grid, params: SolverParams) => Solution
): Solution {
  return shouldReturnNoRoadAnchorSolution(params) ? buildNoRoadAnchorSolution(optimizer) : solve(grid, params);
}

function startWithRoadAnchorGuard(
  optimizer: OptimizerName,
  grid: Grid,
  params: SolverParams,
  start: (grid: Grid, params: SolverParams) => BackgroundSolveHandle
): BackgroundSolveHandle {
  return shouldReturnNoRoadAnchorSolution(params) ? startNoRoadAnchorSolve(grid, optimizer) : start(grid, params);
}

const optimizerAdapters: Record<OptimizerName, OptimizerAdapter> = {
  auto: {
    name: "auto",
    solve: (grid, params) => solveWithRoadAnchorGuard("auto", grid, params, solveAuto),
    solveAsync: (grid, params) => startWithRoadAnchorGuard("auto", grid, params, startAutoSolve).promise,
    startBackgroundSolve: (grid, params) => startWithRoadAnchorGuard("auto", grid, params, startAutoSolve),
    normalizeTerminalSolution: normalizeAutoTerminalSolution,
    describeCompletedSolution: describeAutoCompletedSolution,
    describeRecoveredSolution: describeAutoRecoveredSolution
  },
  greedy: {
    name: "greedy",
    solve: (grid, params) => solveWithRoadAnchorGuard("greedy", grid, params, solveGreedy),
    startBackgroundSolve: (grid, params) => startWithRoadAnchorGuard("greedy", grid, params, startGreedySolve),
    describeRecoveredSolution: describeDefaultRecoveredSolution
  },
  "cp-sat": {
    name: "cp-sat",
    solve: (grid, params) => solveWithRoadAnchorGuard("cp-sat", grid, params, solveCpSat),
    solveAsync: (grid, params, cpSatAsyncOptions) =>
      shouldReturnNoRoadAnchorSolution(params)
        ? Promise.resolve(buildNoRoadAnchorSolution("cp-sat"))
        : solveCpSatAsync(grid, params, cpSatAsyncOptions),
    startBackgroundSolve: (grid, params) => startWithRoadAnchorGuard("cp-sat", grid, params, startCpSatSolve),
    describeRecoveredSolution: describeDefaultRecoveredSolution
  },
  lns: {
    name: "lns",
    solve: (grid, params) => solveWithRoadAnchorGuard("lns", grid, params, solveLns),
    startBackgroundSolve: (grid, params) => startWithRoadAnchorGuard("lns", grid, params, startLnsSolve),
    describeRecoveredSolution: describeLnsRecoveredSolution
  }
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
