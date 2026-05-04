import type { LnsWindowRankerSelectionTelemetry } from "../core/index.js";
import type { LnsBenchmarkCaseResult } from "./lns.js";

export type LnsWindowRankerOnlineFinalTransitionStatus = "improved" | "neutral" | "regressed";

export interface LnsWindowRankerOnlineTransitionStatusCounts {
  improved: number;
  neutral: number;
  regressed: number;
}

export interface LnsWindowRankerOnlineSelectionDiagnostics {
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideChangedWindowCount: number;
  fallbackChangedWindowCount: number;
}

export interface LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
}

export interface LnsWindowRankerOnlineTransitionOutcomeInput {
  pressureFamily: string;
  finalOutcomeStatus: LnsWindowRankerOnlineFinalTransitionStatus;
  selectionDiagnostics: LnsWindowRankerOnlineSelectionDiagnostics | null;
}

function emptyDiagnostics(): LnsWindowRankerOnlineSelectionDiagnostics {
  return {
    overrideTransitionCounts: {},
    fallbackTransitionCounts: {},
    overrideChangedWindowCount: 0,
    fallbackChangedWindowCount: 0
  };
}

function emptyStatusCounts(): LnsWindowRankerOnlineTransitionStatusCounts {
  return { improved: 0, neutral: 0, regressed: 0 };
}

function emptyOutcomeDiagnostics(): LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  return {
    overrideTransitionFinalOutcomeCounts: {},
    fallbackTransitionFinalOutcomeCounts: {},
    overrideTransitionPressureFamilyCounts: {},
    fallbackTransitionPressureFamilyCounts: {}
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

function addStatusCount(
  counts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>,
  transition: string,
  status: LnsWindowRankerOnlineFinalTransitionStatus,
  count: number
): void {
  const statusCounts = counts[transition] ?? emptyStatusCounts();
  statusCounts[status] += count;
  counts[transition] = statusCounts;
}

function addFamilyCount(
  counts: Record<string, Record<string, number>>,
  transition: string,
  pressureFamily: string,
  count: number
): void {
  const familyCounts = counts[transition] ?? {};
  familyCounts[pressureFamily] = (familyCounts[pressureFamily] ?? 0) + count;
  counts[transition] = familyCounts;
}

function addTransitionOutcomeCounts(
  transitionCounts: Record<string, number>,
  finalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>,
  pressureFamilyCounts: Record<string, Record<string, number>>,
  input: LnsWindowRankerOnlineTransitionOutcomeInput
): void {
  for (const [transition, count] of Object.entries(transitionCounts)) {
    addStatusCount(finalOutcomeCounts, transition, input.finalOutcomeStatus, count);
    addFamilyCount(pressureFamilyCounts, transition, input.pressureFamily, count);
  }
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

export function buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics(
  inputs: readonly LnsWindowRankerOnlineTransitionOutcomeInput[]
): LnsWindowRankerOnlineTransitionOutcomeDiagnostics {
  const diagnostics = emptyOutcomeDiagnostics();
  for (const input of inputs) {
    if (!input.selectionDiagnostics) continue;
    addTransitionOutcomeCounts(
      input.selectionDiagnostics.overrideTransitionCounts,
      diagnostics.overrideTransitionFinalOutcomeCounts,
      diagnostics.overrideTransitionPressureFamilyCounts,
      input
    );
    addTransitionOutcomeCounts(
      input.selectionDiagnostics.fallbackTransitionCounts,
      diagnostics.fallbackTransitionFinalOutcomeCounts,
      diagnostics.fallbackTransitionPressureFamilyCounts,
      input
    );
  }
  return diagnostics;
}

export function formatLnsWindowRankerOnlineTransitionCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${value}`).join(",");
}

export function formatLnsWindowRankerOnlineTransitionFinalOutcomeCounts(
  counts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>
): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${value.improved}/${value.neutral}/${value.regressed}`).join(",");
}

export function formatLnsWindowRankerOnlineTransitionPressureFamilyCounts(
  counts: Record<string, Record<string, number>>
): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries
    .map(([key, familyCounts]) => {
      const formattedFamilies = Object.entries(familyCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([family, count]) => `${family}:${count}`)
        .join("|");
      return `${key}[${formattedFamilies}]`;
    })
    .join(",");
}
