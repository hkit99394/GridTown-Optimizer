/**
 * Lightweight local web server bootstrap for the planning UI.
 */

import { createServer } from "node:http";
import { resolve } from "node:path";

import { SolveJobManager } from "../../packages/runtime/index.js";
import { createPlannerRequestHandler } from "./index.js";
import { DEFAULT_MAX_RUNNING_SOLVES, parseLocalServerPort, parsePositiveIntegerConfig } from "./serverConfig.js";

const PORT = parseLocalServerPort(process.env.PORT);
const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PROJECT_ROOT = resolve(__dirname, "../../..");
const WEB_ROOT = resolve(PROJECT_ROOT, "apps", "planner-web");
const PROGRESS_LOG_ROOT = resolve(PROJECT_ROOT, "artifacts", "solve-progress");
const MAX_RUNNING_SOLVES = parsePositiveIntegerConfig(process.env.MAX_RUNNING_SOLVES, DEFAULT_MAX_RUNNING_SOLVES);

const server = createServer(
  createPlannerRequestHandler({
    webRoot: WEB_ROOT,
    solveJobManager: new SolveJobManager({
      progressLogRoot: PROGRESS_LOG_ROOT,
      maxRunningSolves: MAX_RUNNING_SOLVES
    })
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
  console.log(`Solve concurrency cap is ${MAX_RUNNING_SOLVES}`);
});
