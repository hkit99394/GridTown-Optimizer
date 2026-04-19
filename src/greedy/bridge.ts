/**
 * Greedy solver bridge for background web solves.
 */

import { resolve } from "node:path";

import type { BackgroundSolveHandle, Grid, Solution, SolverParams } from "../core/index.js";
import { startJsonBackgroundSolve } from "../runtime/index.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

export type GreedySolveHandle = BackgroundSolveHandle;

function buildGreedyRequest(G: Grid, params: SolverParams) {
  return {
    grid: G,
    params,
  };
}

function parseSerializedSolution(stdout: string): SerializedSolution {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Greedy backend returned invalid JSON: ${(error as Error).message}`);
  }
}

function materializeSolution(raw: SerializedSolution): Solution {
  return {
    ...raw,
    roads: new Set(raw.roads),
  };
}

export function startGreedySolve(G: Grid, params: SolverParams): GreedySolveHandle {
  const scriptPath = resolve(__dirname, "./worker.js");
  return startJsonBackgroundSolve({
    solverLabel: "Greedy",
    stopDirectoryPrefix: "city-builder-greedy-stop-",
    command: process.execPath,
    args: [scriptPath],
    buildRequest: ({ stopFilePath, snapshotFilePath }) =>
      buildGreedyRequest(G, {
        ...params,
        greedy: {
          ...(params.greedy ?? {}),
          stopFilePath,
          snapshotFilePath,
        },
      }),
    parseRaw: parseSerializedSolution,
    materializeSolution: (raw, stoppedByUser) =>
      materializeSolution({
        ...raw,
        stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
      }),
    getSnapshotState: (raw) => ({
      hasFeasibleSolution: Boolean(raw),
      totalPopulation: raw?.totalPopulation ?? null,
    }),
    readStoppedByUser: (raw) => Boolean(raw.stoppedByUser),
    stoppedBeforeFeasibleMessage: "Greedy solve was stopped before finding a feasible solution.",
    noSolutionMessage: "Greedy backend exited without returning a solution.",
  });
}
