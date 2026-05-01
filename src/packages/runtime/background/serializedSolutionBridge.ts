/**
 * Shared helpers for background solvers that return serialized Solution JSON.
 */

import { materializeSerializedSolution } from "../../core/index.js";
import { assertValidSerializedSolutionPayload } from "../../core/index.js";
import { startJsonBackgroundSolve } from "./runner.js";

import type {
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  Grid,
  SerializedSolution,
  Solution,
  SolverParams,
} from "../../core/index.js";
import type { JsonBackgroundSolverConfig } from "./runner.js";

type SerializedBackgroundSolverConfig = Omit<
  JsonBackgroundSolverConfig<SerializedSolution>,
  "parseRaw" | "materializeSolution" | "getSnapshotState" | "readStoppedByUser"
> & {
  materializeSolution?: (raw: SerializedSolution, stoppedByUser: boolean) => Solution;
};

type SerializedSolverOptionKey = "greedy" | "lns";

type SerializedSolverProcessConfig = Omit<
  SerializedBackgroundSolverConfig,
  "command" | "args" | "buildRequest"
> & {
  grid: Grid;
  params: SolverParams;
  solverOptionKey: SerializedSolverOptionKey;
  workerScriptPath: string;
};

export function parseSerializedBackgroundSolution(stdout: string, solverLabel: string): SerializedSolution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${solverLabel} backend returned invalid JSON: ${(error as Error).message}`);
  }
  try {
    assertValidSerializedSolutionPayload(parsed, `${solverLabel} solution`);
  } catch (error) {
    throw new Error(`${solverLabel} backend returned invalid solution payload: ${(error as Error).message}`);
  }
  return parsed;
}

export function materializeSerializedBackgroundSolution(
  raw: SerializedSolution,
  stoppedByUser: boolean
): Solution {
  return materializeSerializedSolution({
    ...raw,
    stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
  });
}

export function buildSerializedBackgroundSnapshotState(
  raw: SerializedSolution | null
): BackgroundSolveSnapshotState {
  return {
    hasFeasibleSolution: Boolean(raw),
    totalPopulation: raw?.totalPopulation ?? null,
  };
}

export function readSerializedBackgroundStoppedByUser(raw: SerializedSolution): boolean {
  return Boolean(raw.stoppedByUser);
}

export function startSerializedSolutionBackgroundSolve(
  config: SerializedBackgroundSolverConfig
): BackgroundSolveHandle {
  const { materializeSolution, ...backgroundConfig } = config;
  return startJsonBackgroundSolve<SerializedSolution>({
    ...backgroundConfig,
    parseRaw: (stdout) => parseSerializedBackgroundSolution(stdout, backgroundConfig.solverLabel),
    materializeSolution: materializeSolution ?? materializeSerializedBackgroundSolution,
    getSnapshotState: buildSerializedBackgroundSnapshotState,
    readStoppedByUser: readSerializedBackgroundStoppedByUser,
  });
}

function buildSerializedSolverRequest(
  grid: Grid,
  params: SolverParams,
  solverOptionKey: SerializedSolverOptionKey,
  paths: { stopFilePath: string; snapshotFilePath: string }
): { grid: Grid; params: SolverParams } {
  return {
    grid,
    params: {
      ...params,
      [solverOptionKey]: {
        ...(params[solverOptionKey] ?? {}),
        stopFilePath: paths.stopFilePath,
        snapshotFilePath: paths.snapshotFilePath,
      },
    },
  };
}

export function startSerializedSolutionSolverProcess(
  config: SerializedSolverProcessConfig
): BackgroundSolveHandle {
  const { grid, params, solverOptionKey, workerScriptPath, ...backgroundConfig } = config;
  return startSerializedSolutionBackgroundSolve({
    ...backgroundConfig,
    command: process.execPath,
    args: [workerScriptPath],
    buildRequest: (paths) =>
      buildSerializedSolverRequest(grid, params, solverOptionKey, paths),
  });
}
