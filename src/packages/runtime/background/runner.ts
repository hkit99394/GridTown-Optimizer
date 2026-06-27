/**
 * Shared runner for background solver processes that exchange JSON requests and
 * best-so-far snapshots through local temp files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  backendTimeoutMs?: number;
  backendTimeoutMessage?: string;
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

interface SnapshotCache<TRaw> {
  raw: TRaw | null;
  signature: string | null;
  materialized: Solution | null;
  materializedSignature: string | null;
  materializedStoppedByUser: boolean | null;
}

function createSolverTempFiles(stopDirectoryPrefix: string): SolverTempFiles {
  const directoryPath = mkdtempSync(join(tmpdir(), stopDirectoryPrefix));
  return {
    directoryPath,
    stopFilePath: join(directoryPath, "stop"),
    snapshotFilePath: join(directoryPath, "snapshot.json")
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
    detached: process.platform !== "win32"
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
    return config.materializeSolution(raw, state.stopRequested || Boolean(config.readStoppedByUser?.(raw)));
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

function readSnapshotSignature(snapshotFilePath: string): string | null {
  try {
    const stats = statSync(snapshotFilePath);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return null;
  }
}

function readSnapshotFileIfPresent<TRaw>(
  snapshotFilePath: string,
  parseRaw: (text: string) => TRaw,
  cache: SnapshotCache<TRaw>
): TRaw | null {
  if (!existsSync(snapshotFilePath)) return cache.raw;
  const signature = readSnapshotSignature(snapshotFilePath);
  if (signature && signature === cache.signature) return cache.raw;
  try {
    const raw = parseRaw(readFileSync(snapshotFilePath, "utf8"));
    cache.raw = raw;
    cache.signature = signature;
    cache.materialized = null;
    cache.materializedSignature = null;
    cache.materializedStoppedByUser = null;
    return raw;
  } catch {
    return cache.raw;
  }
}

export function startJsonBackgroundSolve<TRaw>(config: JsonBackgroundSolverConfig<TRaw>): BackgroundSolveHandle {
  const tempFiles = createSolverTempFiles(config.stopDirectoryPrefix);
  const bufferLimitBytes = config.bufferLimitBytes ?? DEFAULT_BUFFER_LIMIT;
  const forcedTerminationDelayMs = Math.max(0, config.forcedTerminationDelayMs ?? 5000);
  const backendTimeoutMs =
    config.backendTimeoutMs === undefined || !Number.isFinite(config.backendTimeoutMs)
      ? 0
      : Math.max(0, config.backendTimeoutMs);

  let stdout = "";
  let stderr = "";
  let stopRequested = false;
  let forcedTerminationTimer: NodeJS.Timeout | undefined;
  let backendTimeoutTimer: NodeJS.Timeout | undefined;
  let streamError: Error | null = null;
  let cleanedUp = false;
  const snapshotCache: SnapshotCache<TRaw> = {
    raw: null,
    signature: null,
    materialized: null,
    materializedSignature: null,
    materializedStoppedByUser: null
  };

  const cleanupTempDirectory = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempFiles.directoryPath, { recursive: true, force: true });
  };

  let request: unknown;
  try {
    request = config.buildRequest({
      stopFilePath: tempFiles.stopFilePath,
      snapshotFilePath: tempFiles.snapshotFilePath
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
    return readSnapshotFileIfPresent(tempFiles.snapshotFilePath, config.parseRaw, snapshotCache);
  };

  const materializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    const raw = readLatestSnapshotRaw();
    if (!raw) return null;
    if (
      snapshotCache.materialized &&
      snapshotCache.materializedSignature === snapshotCache.signature &&
      snapshotCache.materializedStoppedByUser === stoppedByUser
    ) {
      return snapshotCache.materialized;
    }
    const materialized = config.materializeSolution(raw, stoppedByUser);
    snapshotCache.materialized = materialized;
    snapshotCache.materializedSignature = snapshotCache.signature;
    snapshotCache.materializedStoppedByUser = stoppedByUser;
    return materialized;
  };

  const tryMaterializeSnapshot = (stoppedByUser: boolean): Solution | null => {
    try {
      return materializeSnapshot(stoppedByUser);
    } catch {
      return null;
    }
  };

  const readLatestSnapshotState = (): BackgroundSolveSnapshotState => {
    try {
      return config.getSnapshotState(readLatestSnapshotRaw());
    } catch {
      return {
        hasFeasibleSolution: false,
        totalPopulation: null
      };
    }
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

  const clearBackendTimeout = (): void => {
    if (!backendTimeoutTimer) return;
    clearTimeout(backendTimeoutTimer);
    backendTimeoutTimer = undefined;
  };

  const scheduleBackendTimeout = (): void => {
    if (backendTimeoutMs <= 0 || backendTimeoutTimer) return;
    backendTimeoutTimer = setTimeout(() => {
      if (stopRequested || !processStillRunning(child)) return;
      streamError = new Error(config.backendTimeoutMessage ?? `${config.solverLabel} backend timed out.`);
      killChildProcessGroup("SIGKILL");
    }, backendTimeoutMs);
    backendTimeoutTimer.unref?.();
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
    clearBackendTimeout();
    if (!processStillRunning(child)) return;
    try {
      writeFileSync(tempFiles.stopFilePath, "stop\n");
    } catch {
      killChildProcessGroup("SIGTERM");
    }
    scheduleForcedTermination();
  };

  const forceKill = (): void => {
    stopRequested = true;
    clearBackendTimeout();
    if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
    killChildProcessGroup("SIGKILL");
  };

  const promise = new Promise<Solution>((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      clearBackendTimeout();
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
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
      clearBackendTimeout();
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      const snapshotRaw = readLatestSnapshotRaw();
      cleanupTempDirectory();

      try {
        resolvePromise(
          resolveClosedSolverSolution(config, {
            code,
            signal,
            stdout,
            stderr,
            stopRequested,
            streamError,
            snapshotRaw
          })
        );
      } catch (error) {
        rejectPromise(error as Error);
      }
    });

    scheduleBackendTimeout();

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
    forceKill,
    getLatestSnapshot: () => tryMaterializeSnapshot(stopRequested),
    getLatestSnapshotState: readLatestSnapshotState
  };
}
