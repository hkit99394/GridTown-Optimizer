import type { IncomingMessage, ServerResponse } from "node:http";

import { SolveJobManager } from "../../runtime/jobs/solveJobManager.js";
import {
  handleCancelSolve,
  handleImmediateSolve,
  handleLayoutEvaluate,
  handlePlannerHealth,
  handleSolveStatus,
  handleStartSolve,
} from "./routes.js";
import { servePlannerStatic } from "./static.js";
import { getErrorMessage, getErrorStatusCode, sendJson } from "./transport.js";

export interface PlannerRequestHandlerOptions {
  solveJobManager?: SolveJobManager;
  webRoot: string;
}

type PlannerRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
) => boolean | Promise<boolean>;

export function createPlannerRequestHandler(options: PlannerRequestHandlerOptions) {
  const solveJobManager = options.solveJobManager ?? new SolveJobManager();
  const routeHandlers: PlannerRouteHandler[] = [
    handlePlannerHealth,
    (req, res) => handleImmediateSolve(req, res, solveJobManager),
    handleLayoutEvaluate,
    (req, res) => handleStartSolve(req, res, solveJobManager),
    (req, res) => handleSolveStatus(req, res, solveJobManager),
    (req, res) => handleCancelSolve(req, res, solveJobManager),
  ];

  return async (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
    try {
      for (const handler of routeHandlers) {
        if (await handler(req, res)) return;
      }

      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      if (method !== "GET" && method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: "Method not allowed." });
        return;
      }
      await servePlannerStatic(options.webRoot, url.pathname, method, res);
    } catch (error) {
      sendJson(res, getErrorStatusCode(error), { ok: false, error: getErrorMessage(error) });
    }
  };
}
