/**
 * Lightweight local web server bootstrap for the planning UI.
 */

import { createServer } from "node:http";
import { resolve } from "node:path";

import { SolveJobManager } from "../../packages/runtime/index.js";
import { createPlannerRequestHandler } from "./index.js";
import {
  DEFAULT_MAX_RUNNING_SOLVES,
  DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS,
  DEFAULT_PROGRESS_LOG_POLL_INTERVAL_SECONDS,
  parseLocalServerPort,
  parsePositiveIntegerConfig,
  parsePositiveMillisecondsFromSecondsConfig
} from "./serverConfig.js";

const PORT = parseLocalServerPort(process.env.PORT);
const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PROJECT_ROOT = resolve(__dirname, "../../..");
const WEB_ROOT = resolve(PROJECT_ROOT, "apps", "planner-web");
const PROGRESS_LOG_ROOT = resolve(PROJECT_ROOT, "artifacts", "solve-progress");
const MAX_RUNNING_SOLVES = parsePositiveIntegerConfig(process.env.MAX_RUNNING_SOLVES, DEFAULT_MAX_RUNNING_SOLVES);
const PROGRESS_LOG_INTERVAL_MS = parsePositiveMillisecondsFromSecondsConfig(
  process.env.PROGRESS_LOG_INTERVAL_SECONDS,
  DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS
);
const PROGRESS_LOG_POLL_INTERVAL_MS = parsePositiveMillisecondsFromSecondsConfig(
  process.env.PROGRESS_LOG_POLL_INTERVAL_SECONDS,
  DEFAULT_PROGRESS_LOG_POLL_INTERVAL_SECONDS
);
const solveJobManager = new SolveJobManager({
  progressLogRoot: PROGRESS_LOG_ROOT,
  progressLogIntervalMs: PROGRESS_LOG_INTERVAL_MS,
  progressLogPollIntervalMs: PROGRESS_LOG_POLL_INTERVAL_MS,
  maxRunningSolves: MAX_RUNNING_SOLVES
});

const server = createServer(
  createPlannerRequestHandler({
    webRoot: WEB_ROOT,
    solveJobManager
  })
);

function formatHostForUrl(host: string): string {
  if (host === "::") return "[::]";
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

server.listen(PORT, HOST, () => {
  const displayHost = formatHostForUrl(HOST);
  console.log(`City Builder web planner running at http://${displayHost}:${PORT}`);
  console.log(`Solve progress logs will be written to ${PROGRESS_LOG_ROOT}`);
  console.log(
    `Solve progress logging polls every ${PROGRESS_LOG_POLL_INTERVAL_MS / 1000}s and compacts unchanged samples every ${PROGRESS_LOG_INTERVAL_MS / 1000}s`
  );
  console.log(`Solve concurrency cap is ${MAX_RUNNING_SOLVES}`);
});

let shutdownStarted = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  solveJobManager.shutdownRunningSolves(`Local web server stopped by ${signal}; solve abandoned before completion.`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(0);
  }, 1000).unref?.();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
