import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

import { contentTypeFor, sendText } from "./webServerTransport.js";

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/plannerShell.js": "plannerShell.js",
  "/plannerShared.js": "plannerShared.js",
  "/plannerPersistence.js": "plannerPersistence.js",
  "/plannerSolveRuntime.js": "plannerSolveRuntime.js",
  "/plannerExpansion.js": "plannerExpansion.js",
  "/plannerResults.js": "plannerResults.js",
  "/plannerRequestBuilder.js": "plannerRequestBuilder.js",
  "/plannerWorkbench.js": "plannerWorkbench.js",
  "/app.js": "app.js",
};

export async function servePlannerStatic(
  webRoot: string,
  pathname: string,
  method: string,
  res: ServerResponse<IncomingMessage>
): Promise<void> {
  const relativePath = STATIC_FILES[pathname] ?? null;
  if (!relativePath) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8", method === "HEAD");
    return;
  }

  const filePath = resolve(webRoot, relativePath);
  const file = await readFile(filePath, "utf8");
  sendText(res, 200, file, contentTypeFor(relativePath), method === "HEAD");
}
