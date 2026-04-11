/**
 * Greedy solver bridge for background web solves.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import type { Grid, Solution, SolverParams } from "./types.js";

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

export interface GreedySolveHandle {
  promise: Promise<Solution>;
  cancel: () => void;
  getLatestSnapshot: () => Solution | null;
  getLatestSnapshotState: () => {
    hasFeasibleSolution: boolean;
    totalPopulation: number | null;
  };
}

const GREEDY_BUFFER_LIMIT = 16 * 1024 * 1024;

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

function appendBufferedOutput(current: string, chunk: Buffer | string, label: string): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") > GREEDY_BUFFER_LIMIT) {
    throw new Error(`Greedy backend ${label} exceeded ${GREEDY_BUFFER_LIMIT} bytes.`);
  }
  return next;
}

export function startGreedySolve(G: Grid, params: SolverParams): GreedySolveHandle {
  const scriptPath = resolve(__dirname, "./greedyWorker.js");
  const tempStopDirectory = mkdtempSync(join(tmpdir(), "city-builder-greedy-stop-"));
  const stopFilePath = join(tempStopDirectory, "stop");
  const snapshotFilePath = join(tempStopDirectory, "snapshot.json");
  const request = buildGreedyRequest(G, {
    ...params,
    greedy: {
      ...(params.greedy ?? {}),
      stopFilePath,
      snapshotFilePath,
    },
  });
  const child = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stopRequested = false;
  let forcedTerminationTimer: NodeJS.Timeout | undefined;
  let streamError: Error | null = null;
  let cleanedUp = false;
  let latestSnapshotRaw: SerializedSolution | null = null;

  const cleanupStopToken = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempStopDirectory, { recursive: true, force: true });
  };

  const readLatestSnapshotRaw = (): SerializedSolution | null => {
    if (!existsSync(snapshotFilePath)) return latestSnapshotRaw;
    try {
      latestSnapshotRaw = parseSerializedSolution(readFileSync(snapshotFilePath, "utf8"));
    } catch {
      return latestSnapshotRaw;
    }
    return latestSnapshotRaw;
  };

  const materializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    const raw = readLatestSnapshotRaw();
    if (!raw) return null;
    return materializeSolution({
      ...raw,
      stoppedByUser: stoppedByUser || Boolean(raw.stoppedByUser),
    });
  };

  const scheduleForcedTermination = (): void => {
    if (forcedTerminationTimer) return;
    forcedTerminationTimer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }, 5000);
    forcedTerminationTimer.unref?.();
  };

  const cancel = (): void => {
    stopRequested = true;
    if (child.exitCode != null || child.signalCode != null) return;
    try {
      writeFileSync(stopFilePath, "stop\n");
    } catch {
      child.kill("SIGTERM");
    }
    scheduleForcedTermination();
  };

  const promise = new Promise<Solution>((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      cleanupStopToken();
      rejectPromise(new Error(`Failed to launch greedy backend: ${error.message}`));
    });

    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBufferedOutput(stdout, chunk, "stdout");
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBufferedOutput(stderr, chunk, "stderr");
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.once("close", (code, signal) => {
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      const snapshotRaw = readLatestSnapshotRaw();
      cleanupStopToken();

      if (streamError) {
        rejectPromise(streamError);
        return;
      }

      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const trimmedStdout = stdout.trim();
        if (stopRequested && snapshotRaw) {
          resolvePromise(materializeSolution({ ...snapshotRaw, stoppedByUser: true }));
          return;
        }
        if (stopRequested) {
          rejectPromise(new Error(trimmedStderr || "Greedy solve was stopped before finding a feasible solution."));
          return;
        }
        rejectPromise(
          new Error(
            `Greedy backend failed with exit code ${code ?? "unknown"}${
              signal ? ` (signal ${signal})` : ""
            }.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${trimmedStdout ? ` stdout: ${trimmedStdout}` : ""}`
          )
        );
        return;
      }

      try {
        const trimmedStdout = stdout.trim();
        const raw = trimmedStdout ? parseSerializedSolution(trimmedStdout) : snapshotRaw;
        if (!raw) {
          throw new Error("Greedy backend exited without returning a solution.");
        }
        resolvePromise(
          materializeSolution({
            ...raw,
            stoppedByUser: stopRequested || Boolean(raw.stoppedByUser),
          })
        );
      } catch (error) {
        if (stopRequested && snapshotRaw) {
          resolvePromise(materializeSolution({ ...snapshotRaw, stoppedByUser: true }));
          return;
        }
        rejectPromise(error as Error);
      }
    });

    try {
      child.stdin.end(JSON.stringify(request));
    } catch (error) {
      cancel();
      rejectPromise(new Error(`Failed to send request to greedy backend: ${(error as Error).message}`));
    }
  });

  return {
    promise,
    cancel,
    getLatestSnapshot: () => materializeSnapshot(stopRequested),
    getLatestSnapshotState: () => {
      const raw = readLatestSnapshotRaw();
      return {
        hasFeasibleSolution: Boolean(raw),
        totalPopulation: raw?.totalPopulation ?? null,
      };
    },
  };
}
