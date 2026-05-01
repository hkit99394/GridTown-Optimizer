/**
 * Shared runner for background solver processes that exchange JSON requests and
 * best-so-far snapshots through local temp files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BackgroundSolveHandle, BackgroundSolveSnapshotState, Solution } from "../../core/index.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const DEFAULT_BUFFER_LIMIT = 16 * 1024 * 1024;

interface SolverFilePaths {
  stopFilePath: string;
  snapshotFilePath: string;
}

interface SolverTempFiles extends SolverFilePaths {
  directoryPath: string;
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
  forcedTerminationDelayMs?: number;
}

interface ClosedSolverState<TRaw> {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stopRequested: boolean;
  streamError: Error | null;
  snapshotRaw: TRaw | null;
}

function createSolverTempFiles(stopDirectoryPrefix: string): SolverTempFiles {
  const directoryPath = mkdtempSync(join(tmpdir(), stopDirectoryPrefix));
  return {
    directoryPath,
    stopFilePath: join(directoryPath, "stop"),
    snapshotFilePath: join(directoryPath, "snapshot.json"),
  };
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

function spawnBackgroundSolverProcess(command: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function processStillRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode == null && child.signalCode == null;
}

function buildLaunchErrorMessage(solverLabel: string, launchContext: string | undefined, error: Error): string {
  return `Failed to launch ${solverLabel} backend${launchContext ? ` ${launchContext}` : ""}: ${error.message}`;
}

function buildSolverFailureMessage<TRaw>(
  config: JsonBackgroundSolverConfig<TRaw>,
  state: ClosedSolverState<TRaw>
): string {
  const trimmedStderr = state.stderr.trim();
  const trimmedStdout = state.stdout.trim();
  return `${config.solverLabel} backend failed with exit code ${state.code ?? "unknown"}${
    state.signal ? ` (signal ${state.signal})` : ""
  }.${trimmedStderr ? ` stderr: ${trimmedStderr}` : ""}${trimmedStdout ? ` stdout: ${trimmedStdout}` : ""}`;
}

function resolveClosedSolverSolution<TRaw>(
  config: JsonBackgroundSolverConfig<TRaw>,
  state: ClosedSolverState<TRaw>
): Solution {
  if (state.streamError) {
    throw state.streamError;
  }

  if (state.code !== 0) {
    if (state.stopRequested && state.snapshotRaw) {
      return config.materializeSolution(state.snapshotRaw, true);
    }
    if (state.stopRequested) {
      throw new Error(state.stderr.trim() || config.stoppedBeforeFeasibleMessage);
    }
    throw new Error(buildSolverFailureMessage(config, state));
  }

  try {
    const trimmedStdout = state.stdout.trim();
    const raw = trimmedStdout ? config.parseRaw(trimmedStdout) : state.snapshotRaw;
    if (!raw) {
      throw new Error(config.noSolutionMessage);
    }
    return config.materializeSolution(
      raw,
      state.stopRequested || Boolean(config.readStoppedByUser?.(raw))
    );
  } catch (error) {
    if (state.stopRequested && state.snapshotRaw) {
      try {
        return config.materializeSolution(state.snapshotRaw, true);
      } catch {
        // Fall through to the original parse/materialization error below.
      }
    }
    throw error;
  }
}

function readSnapshotFileIfPresent<TRaw>(
  snapshotFilePath: string,
  parseRaw: (text: string) => TRaw,
  fallback: TRaw | null
): TRaw | null {
  if (!existsSync(snapshotFilePath)) return fallback;
  try {
    return parseRaw(readFileSync(snapshotFilePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function startJsonBackgroundSolve<TRaw>(config: JsonBackgroundSolverConfig<TRaw>): BackgroundSolveHandle {
  const tempFiles = createSolverTempFiles(config.stopDirectoryPrefix);
  const bufferLimitBytes = config.bufferLimitBytes ?? DEFAULT_BUFFER_LIMIT;
  const forcedTerminationDelayMs = Math.max(0, config.forcedTerminationDelayMs ?? 5000);

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
    rmSync(tempFiles.directoryPath, { recursive: true, force: true });
  };

  let request: unknown;
  try {
    request = config.buildRequest({
      stopFilePath: tempFiles.stopFilePath,
      snapshotFilePath: tempFiles.snapshotFilePath,
    });
  } catch (error) {
    cleanupTempDirectory();
    throw error;
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnBackgroundSolverProcess(config.command, config.args);
  } catch (error) {
    cleanupTempDirectory();
    throw new Error(buildLaunchErrorMessage(config.solverLabel, config.launchContext, error as Error));
  }

  const readLatestSnapshotRaw = (): TRaw | null => {
    latestSnapshotRaw = readSnapshotFileIfPresent(
      tempFiles.snapshotFilePath,
      config.parseRaw,
      latestSnapshotRaw
    );
    return latestSnapshotRaw;
  };

  const materializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    const raw = readLatestSnapshotRaw();
    if (!raw) return null;
    return config.materializeSolution(raw, stoppedByUser);
  };

  const killChildProcessGroup = (signal: NodeJS.Signals): void => {
    if (!processStillRunning(child)) return;
    try {
      if (process.platform !== "win32" && typeof child.pid === "number") {
        process.kill(-child.pid, signal);
        return;
      }
    } catch {
      // Fall back to killing the direct child below.
    }
    child.kill(signal);
  };

  const scheduleForcedTermination = (): void => {
    if (forcedTerminationTimer) return;
    forcedTerminationTimer = setTimeout(() => {
      killChildProcessGroup("SIGKILL");
    }, forcedTerminationDelayMs);
    forcedTerminationTimer.unref?.();
  };

  const cancel = (): void => {
    stopRequested = true;
    if (!processStillRunning(child)) return;
    try {
      writeFileSync(tempFiles.stopFilePath, "stop\n");
    } catch {
      killChildProcessGroup("SIGTERM");
    }
    scheduleForcedTermination();
  };

  const promise = new Promise<Solution>((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      cleanupTempDirectory();
      rejectPromise(new Error(buildLaunchErrorMessage(config.solverLabel, config.launchContext, error)));
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

      try {
        resolvePromise(resolveClosedSolverSolution(config, {
          code,
          signal,
          stdout,
          stderr,
          stopRequested,
          streamError,
          snapshotRaw,
        }));
      } catch (error) {
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
