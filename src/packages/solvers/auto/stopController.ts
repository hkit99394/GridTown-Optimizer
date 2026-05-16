import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AutoSolveStopReason, SolverParams } from "../../core/index.js";

export interface SyncAutoStopController {
  stopFilePath: string;
  currentStopReason: () => AutoSolveStopReason | null;
  cleanup: () => void;
}

const SYNC_AUTO_STOP_WATCHER_SCRIPT = `
const fs = require("node:fs");

const stopFilePath = process.argv[1];
const delayMsArg = process.argv[2];
const upstreamPaths = JSON.parse(process.argv[3] || "[]");
let stopped = false;

const triggerStop = () => {
  if (stopped) return;
  stopped = true;
  try {
    fs.writeFileSync(stopFilePath, "stop\\n");
  } catch {}
  clearTimeout(timer);
  if (poll !== null) clearInterval(poll);
};

const poll = upstreamPaths.length
  ? setInterval(() => {
      for (const filePath of upstreamPaths) {
        try {
          if (fs.existsSync(filePath)) {
            triggerStop();
            return;
          }
        } catch {}
      }
    }, 50)
  : null;

const timer = delayMsArg === "null"
  ? null
  : setTimeout(triggerStop, Math.max(0, Number(delayMsArg) || 0));
`;

export function createSyncAutoStopController(
  deadlineAtMs: number | null,
  params: SolverParams
): SyncAutoStopController {
  const upstreamStopFilePaths = [
    params.greedy?.stopFilePath,
    params.lns?.stopFilePath,
    params.cpSat?.stopFilePath
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (deadlineAtMs === null && upstreamStopFilePaths.length === 0) {
    return {
      stopFilePath: "",
      currentStopReason: () => null,
      cleanup: () => {}
    };
  }
  const tempDirectory = mkdtempSync(join(tmpdir(), "city-builder-auto-stop-"));
  const stopFilePath = join(tempDirectory, "stop");
  const delayMs = deadlineAtMs === null ? "null" : String(Math.max(0, deadlineAtMs - Date.now()));
  const timerProcess = spawn(
    process.execPath,
    ["-e", SYNC_AUTO_STOP_WATCHER_SCRIPT, stopFilePath, delayMs, JSON.stringify(upstreamStopFilePaths)],
    { stdio: "ignore" }
  );
  timerProcess.unref();

  return {
    stopFilePath,
    currentStopReason: () => {
      if (upstreamStopFilePaths.some((filePath) => existsSync(filePath))) {
        return "cancelled";
      }
      if (!existsSync(stopFilePath)) return null;
      return "wall-clock-cap";
    },
    cleanup: () => {
      try {
        timerProcess.kill();
      } catch {}
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}
