export const DEFAULT_PLANNER_PORT = 4173;
export const DEFAULT_MAX_RUNNING_SOLVES = 1;
export const DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS = 10;
export const DEFAULT_PROGRESS_LOG_POLL_INTERVAL_SECONDS = 2;

export function parseLocalServerPort(value: string | undefined, fallback = DEFAULT_PLANNER_PORT): number {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  const port = Number(normalized);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback;
}

export function parsePositiveIntegerConfig(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

export function parsePositiveMillisecondsFromSecondsConfig(value: string | undefined, fallbackSeconds: number): number {
  return parsePositiveIntegerConfig(value, fallbackSeconds) * 1000;
}
