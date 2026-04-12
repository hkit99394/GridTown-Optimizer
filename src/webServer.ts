/**
 * Lightweight local web server bootstrap for the planning UI.
 */

import { createServer } from "node:http";
import { resolve } from "node:path";

import { createPlannerRequestHandler } from "./webServerRequestHandler.js";

const PORT = Number(process.env.PORT ?? 4173);
const WEB_ROOT = resolve(__dirname, "../web");

const server = createServer(createPlannerRequestHandler({
  webRoot: WEB_ROOT,
}));

server.listen(PORT, () => {
  console.log(`City Builder web planner running at http://localhost:${PORT}`);
});
