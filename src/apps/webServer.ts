/**
 * Lightweight local web server bootstrap for the planning UI.
 */

import { createServer } from "node:http";
import { resolve } from "node:path";

import { createPlannerRequestHandler } from "../server/index.js";
import { SolveJobManager } from "../runtime/jobs/solveJobManager.js";

const PORT = Number(process.env.PORT ?? 4173);
const PROJECT_ROOT = resolve(__dirname, "../..");
const WEB_ROOT = resolve(PROJECT_ROOT, "web");
const PROGRESS_LOG_ROOT = resolve(PROJECT_ROOT, "artifacts", "solve-progress");
const REQUESTED_MAX_RUNNING_SOLVES = Number(process.env.MAX_RUNNING_SOLVES ?? 1);
const MAX_RUNNING_SOLVES = Number.isFinite(REQUESTED_MAX_RUNNING_SOLVES)
  ? Math.max(1, Math.floor(REQUESTED_MAX_RUNNING_SOLVES))
  : 1;

const server = createServer(createPlannerRequestHandler({
  webRoot: WEB_ROOT,
  solveJobManager: new SolveJobManager({
    progressLogRoot: PROGRESS_LOG_ROOT,
    maxRunningSolves: MAX_RUNNING_SOLVES,
  }),
}));

server.listen(PORT, () => {
  console.log(`City Builder web planner running at http://localhost:${PORT}`);
  console.log(`Solve progress logs will be written to ${PROGRESS_LOG_ROOT}`);
  console.log(`Solve concurrency cap is ${MAX_RUNNING_SOLVES}`);
});
