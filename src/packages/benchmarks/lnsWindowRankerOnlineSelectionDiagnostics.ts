import type { LnsWindowRankerSelectionTelemetry } from "../core/index.js";
import type { LnsBenchmarkCaseResult } from "./lns.js";

export interface LnsWindowRankerOnlineSelectionDiagnostics {
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideChangedWindowCount: number;
  fallbackChangedWindowCount: number;
}

function emptyDiagnostics(): LnsWindowRankerOnlineSelectionDiagnostics {
  return {
    overrideTransitionCounts: {},
    fallbackTransitionCounts: {},
    overrideChangedWindowCount: 0,
    fallbackChangedWindowCount: 0
  };
}

function sameTelemetryWindow(
  left: { top: number; left: number; rows: number; cols: number },
  right: { top: number; left: number; rows: number; cols: number }
): boolean {
  return left.top === right.top && left.left === right.left && left.rows === right.rows && left.cols === right.cols;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function mergeCounts(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function transitionKey(selection: LnsWindowRankerSelectionTelemetry): string {
  return `${selection.baselineOperator}->${selection.selectedOperator}`;
}

export function buildLnsWindowRankerOnlineSelectionDiagnostics(
  result: LnsBenchmarkCaseResult
): LnsWindowRankerOnlineSelectionDiagnostics | null {
  let seen = false;
  const diagnostics = emptyDiagnostics();

  for (const outcome of result.lnsTelemetry?.outcomes ?? []) {
    const selection = outcome.windowRankerSelection;
    if (!selection) continue;
    seen = true;
    const changedWindow = !sameTelemetryWindow(selection.baselineWindow, selection.selectedWindow);
    if (selection.selectedByBaseline === false) {
      incrementCount(diagnostics.overrideTransitionCounts, transitionKey(selection));
      if (changedWindow) diagnostics.overrideChangedWindowCount += 1;
    }
    if (selection.fallbackReason) {
      incrementCount(diagnostics.fallbackTransitionCounts, transitionKey(selection));
      if (changedWindow) diagnostics.fallbackChangedWindowCount += 1;
    }
  }

  return seen ? diagnostics : null;
}

export function mergeLnsWindowRankerOnlineSelectionDiagnostics(
  diagnostics: readonly LnsWindowRankerOnlineSelectionDiagnostics[]
): LnsWindowRankerOnlineSelectionDiagnostics {
  return diagnostics.reduce<LnsWindowRankerOnlineSelectionDiagnostics>(
    (merged, entry) => ({
      overrideTransitionCounts: mergeCounts(merged.overrideTransitionCounts, entry.overrideTransitionCounts),
      fallbackTransitionCounts: mergeCounts(merged.fallbackTransitionCounts, entry.fallbackTransitionCounts),
      overrideChangedWindowCount: merged.overrideChangedWindowCount + entry.overrideChangedWindowCount,
      fallbackChangedWindowCount: merged.fallbackChangedWindowCount + entry.fallbackChangedWindowCount
    }),
    emptyDiagnostics()
  );
}

export function formatLnsWindowRankerOnlineTransitionCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${value}`).join(",");
}
