/**
 * Shared runner for background solver processes that exchange JSON requests and
 * best-so-far snapshots through local temp files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BackgroundSolveHandle, BackgroundSolveSnapshotState, Solution } from "../../core/types.js";

const DEFAULT_BUFFER_LIMIT = 16 * 1024 * 1024;

interface SolverFilePaths {
  stopFilePath: string;
  snapshotFilePath: string;
}

export interface JsonBackgroundSolverConfig<TRaw> {
  solverLabel: string;
  stopDirectoryPrefix: string;
  command: string;
  args: string[];
  buildRequest: (paths: SolverFilePaths) => unknown;
  parseRaw: (text: string) => TRaw;
  materializeSolution: (raw: TRaw, stoppedByUser: boolean) => Solution;
  getSnapshotState: (raw: TRaw | null) => BackgroundSolveSnapshotState;
  stoppedBeforeFeasibleMessage: string;
  noSolutionMessage: string;
  bufferLimitBytes?: number;
  launchContext?: string;
  readStoppedByUser?: (raw: TRaw) => boolean;
}

function appendBufferedOutput(
  current: string,
  chunk: Buffer | string,
  streamLabel: string,
  solverLabel: string,
  bufferLimitBytes: number
): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") > bufferLimitBytes) {
    throw new Error(`${solverLabel} backend ${streamLabel} exceeded ${bufferLimitBytes} bytes.`);
  }
  return next;
}

export function startJsonBackgroundSolve<TRaw>(config: JsonBackgroundSolverConfig<TRaw>): BackgroundSolveHandle {
  const tempStopDirectory = mkdtempSync(join(tmpdir(), config.stopDirectoryPrefix));
  const stopFilePath = join(tempStopDirectory, "stop");
  const snapshotFilePath = join(tempStopDirectory, "snapshot.json");
  const request = config.buildRequest({ stopFilePath, snapshotFilePath });
  const child = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const bufferLimitBytes = config.bufferLimitBytes ?? DEFAULT_BUFFER_LIMIT;

  let stdout = "";
  let stderr = "";
  let stopRequested = false;
  let forcedTerminationTimer: NodeJS.Timeout | undefined;
  let streamError: Error | null = null;
  let cleanedUp = false;
  let latestSnapshotRaw: TRaw | null = null;

  const cleanupTempDirectory = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempStopDirectory, { recursive: true, force: true });
  };

  const readLatestSnapshotRaw = (): TRaw | null => {
    if (!existsSync(snapshotFilePath)) return latestSnapshotRaw;
    try {
      latestSnapshotRaw = config.parseRaw(readFileSync(snapshotFilePath, "utf8"));
    } catch {
      return latestSnapshotRaw;
    }
    return latestSnapshotRaw;
  };

  const materializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    const raw = readLatestSnapshotRaw();
    if (!raw) return null;
    return config.materializeSolution(raw, stoppedByUser);
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
      cleanupTempDirectory();
      rejectPromise(
        new Error(
          `Failed to launch ${config.solverLabel} backend${
            config.launchContext ? ` ${config.launchContext}` : ""
          }: ${error.message}`
        )
      );
    });

    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBufferedOutput(stdout, chunk, "stdout", config.solverLabel, bufferLimitBytes);
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBufferedOutput(stderr, chunk, "stderr", config.solverLabel, bufferLimitBytes);
      } catch (error) {
        streamError = error as Error;
        cancel();
      }
    });

    child.once("close", (code, signal) => {
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      const snapshotRaw = readLatestSnapshotRaw();
      cleanupTempDirectory();

      if (streamError) {
        rejectPromise(streamError);
        return;
      }

      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const trimmedStdout = stdout.trim();
        if (stopRequested && snapshotRaw) {
          try {
            resolvePromise(config.materializeSolution(snapshotRaw, true));
            return;
          } catch (error) {
            rejectPromise(error as Error);
            return;
          }
        }
        if (stopRequested) {
          rejectPromise(new Error(trimmedStderr || config.stoppedBeforeFeasibleMessage));
          return;
        }
        rejectPromise(
          new Error(
            `${config.solverLabel} backend failed with exit code ${code ?? "unknown"}${
              signal ? ` (signal ${signal})` : ""
            }.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${trimmedStdout ? ` stdout: ${trimmedStdout}` : ""}`
          )
        );
        return;
      }

      try {
        const trimmedStdout = stdout.trim();
        const raw = trimmedStdout ? config.parseRaw(trimmedStdout) : snapshotRaw;
        if (!raw) {
          throw new Error(config.noSolutionMessage);
        }
        resolvePromise(config.materializeSolution(raw, stopRequested || Boolean(config.readStoppedByUser?.(raw))));
      } catch (error) {
        if (stopRequested && snapshotRaw) {
          try {
            resolvePromise(config.materializeSolution(snapshotRaw, true));
            return;
          } catch {
            // Fall through to the original parse/materialization error below.
          }
        }
        rejectPromise(error as Error);
      }
    });

    try {
      child.stdin.end(JSON.stringify(request));
    } catch (error) {
      cancel();
      rejectPromise(new Error(`Failed to send request to ${config.solverLabel} backend: ${(error as Error).message}`));
    }
  });

  return {
    promise,
    cancel,
    getLatestSnapshot: () => materializeSnapshot(stopRequested),
    getLatestSnapshotState: () => config.getSnapshotState(readLatestSnapshotRaw()),
  };
}
