import type { AutoSolveStopReason } from "../../core/index.js";

export interface PopulationCapacityGraceState {
  populationCapacityReachedAtMs: number | null;
  populationCapacityDeadlineAtMs: number | null;
}

function earlierDeadline(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

export function currentAutoDeadlineAtMs(
  globalDeadlineAtMs: number | null,
  state: PopulationCapacityGraceState
): number | null {
  return earlierDeadline(globalDeadlineAtMs, state.populationCapacityDeadlineAtMs);
}

export function currentAutoDeadlineStopReason(
  globalDeadlineAtMs: number | null,
  state: PopulationCapacityGraceState
): AutoSolveStopReason | null {
  if (
    globalDeadlineAtMs !== null &&
    Date.now() >= globalDeadlineAtMs &&
    (state.populationCapacityDeadlineAtMs === null || globalDeadlineAtMs <= state.populationCapacityDeadlineAtMs)
  ) {
    return "wall-clock-cap";
  }
  return state.populationCapacityDeadlineAtMs !== null && Date.now() >= state.populationCapacityDeadlineAtMs
    ? "population-cap-reached"
    : null;
}

export function notePopulationCapacityReached(
  state: PopulationCapacityGraceState,
  continueAfterPopulationCapSeconds: number
): void {
  if (state.populationCapacityReachedAtMs !== null) return;
  const reachedAtMs = Date.now();
  state.populationCapacityReachedAtMs = reachedAtMs;
  state.populationCapacityDeadlineAtMs =
    continueAfterPopulationCapSeconds > 0 ? reachedAtMs + continueAfterPopulationCapSeconds * 1000 : reachedAtMs;
}

export function populationCapacityGraceActive(state: PopulationCapacityGraceState): boolean {
  return state.populationCapacityDeadlineAtMs !== null && Date.now() < state.populationCapacityDeadlineAtMs;
}
