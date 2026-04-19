import type { IncomingMessage, ServerResponse } from "node:http";

import { isSolverInputError, isSolverInputErrorMessage } from "../../core/solverInputValidation.js";

const MAX_BODY_SIZE_BYTES = 2 * 1024 * 1024;

export interface ClientDisconnectMonitor {
  dispose: () => void;
  isDisconnected: () => boolean;
}

export type JsonPayloadValidator<T> = (payload: unknown) => payload is T;

export function sendJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
  headOnly = false
): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

export function sendText(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType: string,
  headOnly = false
): void {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

export function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown server error.";
}

export function getErrorStatusCode(error: unknown): number {
  if (isSolverInputError(error)) return 400;
  const message = getErrorMessage(error);
  if (
    message === "Invalid JSON request body."
    || message.includes("Invalid solve payload")
    || message.includes("Invalid layout-evaluate payload")
    || message.includes("Invalid cancel payload")
    || isSolverInputErrorMessage(message)
  ) {
    return 400;
  }
  if (message.includes("Request body is too large")) return 413;
  if (message.includes("was stopped")) return 409;
  if (
    message.includes("backend failed")
    || message.includes("Failed to launch")
    || message.includes("exceeded")
  ) {
    return 500;
  }
  return 500;
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > MAX_BODY_SIZE_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse(await readBody(req)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Invalid JSON request body.");
    }
    throw error;
  }
}

export async function readValidatedJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  validate: JsonPayloadValidator<T>,
  invalidError: string
): Promise<T | null> {
  const payload = await readJsonBody(req);
  if (!validate(payload)) {
    sendJson(res, 400, {
      ok: false,
      error: invalidError,
    });
    return null;
  }
  return payload;
}

export function monitorClientDisconnect(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  onDisconnect: () => void
): ClientDisconnectMonitor {
  let disconnected = false;

  const handleDisconnect = () => {
    if (disconnected || res.writableEnded) return;
    disconnected = true;
    onDisconnect();
  };

  req.once("aborted", handleDisconnect);
  res.once("close", handleDisconnect);

  return {
    dispose: () => {
      req.removeListener("aborted", handleDisconnect);
      res.removeListener("close", handleDisconnect);
    },
    isDisconnected: () => disconnected || res.writableEnded,
  };
}
