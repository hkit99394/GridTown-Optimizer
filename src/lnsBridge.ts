/**
 * LNS solver bridge for background web solves.
 */

import { resolve } from "node:path";

import { startJsonBackgroundSolve } from "./backgroundSolverRunner.js";

import type { BackgroundSolveHandle, Grid, Solution, SolverParams } from "./types.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

export type LnsSolveHandle = BackgroundSolveHandle;

function buildLnsRequest(G: Grid, params: SolverParams) {
  return {
    grid: G,
    params,
  };
}

function parseSerializedSolution(stdout: string): SerializedSolution {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`LNS backend returned invalid JSON: ${(error as Error).message}`);
  }
}

function materializeSolution(raw: SerializedSolution): Solution {
  return {
    ...raw,
    roads: new Set(raw.roads),
  };
}

export function startLnsSolve(G: Grid, params: SolverParams): LnsSolveHandle {
  const scriptPath = resolve(__dirname, "./lnsWorker.js");
  return startJsonBackgroundSolve({
    solverLabel: "LNS",
    stopDirectoryPrefix: "city-builder-lns-stop-",
    command: process.execPath,
    args: [scriptPath],
    buildRequest: ({ stopFilePath, snapshotFilePath }) =>
      buildLnsRequest(G, {
        ...params,
        lns: {
          ...(params.lns ?? {}),
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
    stoppedBeforeFeasibleMessage: "LNS solve was stopped before finding a feasible solution.",
    noSolutionMessage: "LNS backend exited without returning a solution.",
  });
}
