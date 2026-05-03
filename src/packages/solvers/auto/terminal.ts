import type {
  AutoSolveStageMetadata,
  AutoSolveStopReason,
  AutoStageOptimizerName,
  BackgroundSolveSnapshotState,
  SolveProgressLogEntry,
  Solution
} from "../../core/index.js";

export interface AutoTerminalSolutionContext {
  cancelRequested: boolean;
  snapshotState?: BackgroundSolveSnapshotState | null;
  lastProgressEntry?: SolveProgressLogEntry | null;
}

export function describeAutoStopReason(stopReason: AutoSolveStopReason | null | undefined): string | null {
  if (stopReason === "optimal") {
    return "Auto stopped after CP-SAT proved the incumbent optimal.";
  }
  if (stopReason === "weak-cycle-limit") {
    return "Auto stopped after two consecutive weak LNS -> CP-SAT cycles.";
  }
  if (stopReason === "wall-clock-cap") {
    return "Auto stopped at the global wall-clock safety cap and kept the best incumbent found so far.";
  }
  if (stopReason === "stage-error") {
    return "Auto kept the best available incumbent after a later stage ended without a usable result.";
  }
  if (stopReason === "cancelled") {
    return "Auto solve was stopped by user. Showing the best incumbent found so far.";
  }
  if (stopReason === "completed-plan") {
    return "Auto completed its staged incumbent-first plan.";
  }
  return null;
}

function latestGeneratedAutoStage(
  autoStage: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined
): AutoStageOptimizerName | null {
  const stage = autoStage?.generatedSeeds?.[autoStage.generatedSeeds.length - 1]?.stage ?? null;
  return stage === "greedy" || stage === "lns" || stage === "cp-sat" ? stage : null;
}

function autoStageCompletenessScore(
  autoStage: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined
): number {
  if (!autoStage) return -1;
  return (autoStage.activeStage ? 4 : 0) + (autoStage.stopReason ? 2 : 0) + (autoStage.generatedSeeds?.length ?? 0);
}

function compareAutoStageRecency(
  left: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined,
  right: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined
): number {
  const leftStageIndex = left?.stageIndex ?? -1;
  const rightStageIndex = right?.stageIndex ?? -1;
  if (leftStageIndex !== rightStageIndex) return leftStageIndex - rightStageIndex;

  const leftCycleIndex = left?.cycleIndex ?? -1;
  const rightCycleIndex = right?.cycleIndex ?? -1;
  if (leftCycleIndex !== rightCycleIndex) return leftCycleIndex - rightCycleIndex;

  const leftSeedCount = left?.generatedSeeds?.length ?? -1;
  const rightSeedCount = right?.generatedSeeds?.length ?? -1;
  if (leftSeedCount !== rightSeedCount) return leftSeedCount - rightSeedCount;

  return autoStageCompletenessScore(left) - autoStageCompletenessScore(right);
}

function pickPreferredAutoStage(
  left: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined,
  right: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined
): AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return compareAutoStageRecency(left, right) >= 0 ? left : right;
}

function pickFallbackAutoStage(
  preferredAutoStage: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null,
  ...candidates: Array<AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null | undefined>
): AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null {
  let fallback: AutoSolveStageMetadata | SolveProgressLogEntry["autoStage"] | null = null;
  for (const candidate of candidates) {
    if (!candidate || candidate === preferredAutoStage) continue;
    fallback = pickPreferredAutoStage(fallback, candidate);
  }
  return fallback;
}

function resolveRecoveredAutoActiveStage(
  solution: Solution,
  snapshotState: BackgroundSolveSnapshotState | null,
  lastEntry: SolveProgressLogEntry | null
): AutoStageOptimizerName | null {
  const preferredAutoStage = pickPreferredAutoStage(
    pickPreferredAutoStage(solution.autoStage ?? null, snapshotState?.autoStage ?? null),
    lastEntry?.autoStage ?? null
  );
  return (
    preferredAutoStage?.activeStage ??
    latestGeneratedAutoStage(preferredAutoStage) ??
    (solution.cpSatStatus ? "cp-sat" : null) ??
    (snapshotState?.cpSatStatus ? "cp-sat" : null) ??
    (lastEntry?.cpSatStatus ? "cp-sat" : null) ??
    snapshotState?.activeOptimizer ??
    lastEntry?.activeOptimizer ??
    solution.activeOptimizer ??
    lastEntry?.autoStage?.activeStage ??
    null
  );
}

export function normalizeAutoTerminalSolution(solution: Solution, context: AutoTerminalSolutionContext): Solution {
  const lastEntry = context.lastProgressEntry ?? null;
  const snapshotState = context.snapshotState ?? null;
  const preferredAutoStage = pickPreferredAutoStage(
    pickPreferredAutoStage(solution.autoStage ?? null, snapshotState?.autoStage ?? null),
    lastEntry?.autoStage ?? null
  );
  const fallbackAutoStage = pickFallbackAutoStage(
    preferredAutoStage,
    solution.autoStage ?? null,
    snapshotState?.autoStage ?? null,
    lastEntry?.autoStage ?? null
  );
  const activeStage = resolveRecoveredAutoActiveStage(solution, snapshotState, lastEntry);
  const stopReason: AutoSolveStopReason =
    solution.autoStage?.stopReason ??
    preferredAutoStage?.stopReason ??
    fallbackAutoStage?.stopReason ??
    lastEntry?.autoStage?.stopReason ??
    snapshotState?.autoStage?.stopReason ??
    (context.cancelRequested || solution.stoppedByUser ? "cancelled" : null) ??
    (activeStage === "cp-sat" && solution.cpSatStatus === "OPTIMAL" ? "optimal" : null) ??
    (activeStage === "cp-sat" && snapshotState?.cpSatStatus === "OPTIMAL" ? "optimal" : null) ??
    (activeStage === "cp-sat" && lastEntry?.cpSatStatus === "OPTIMAL" ? "optimal" : null) ??
    "stage-error";
  const stageIndex =
    preferredAutoStage?.stageIndex ??
    fallbackAutoStage?.stageIndex ??
    snapshotState?.autoStage?.stageIndex ??
    solution.autoStage?.stageIndex ??
    lastEntry?.autoStage?.stageIndex ??
    0;
  const cycleIndex =
    preferredAutoStage?.cycleIndex ??
    fallbackAutoStage?.cycleIndex ??
    snapshotState?.autoStage?.cycleIndex ??
    solution.autoStage?.cycleIndex ??
    lastEntry?.autoStage?.cycleIndex ??
    0;
  const generatedSeeds =
    (preferredAutoStage?.generatedSeeds?.length ?? 0) > 0
      ? (preferredAutoStage?.generatedSeeds ?? [])
      : (fallbackAutoStage?.generatedSeeds?.length ?? 0) > 0
        ? (fallbackAutoStage?.generatedSeeds ?? [])
        : (snapshotState?.autoStage?.generatedSeeds ??
          solution.autoStage?.generatedSeeds ??
          lastEntry?.autoStage?.generatedSeeds ??
          []);

  return {
    ...solution,
    optimizer: "auto",
    ...(activeStage ? { activeOptimizer: activeStage } : {}),
    autoStage: {
      ...(lastEntry?.autoStage ?? {}),
      ...(solution.autoStage ?? {}),
      requestedOptimizer: solution.autoStage?.requestedOptimizer ?? lastEntry?.autoStage?.requestedOptimizer ?? "auto",
      activeStage,
      stageIndex,
      cycleIndex,
      consecutiveWeakCycles:
        preferredAutoStage?.consecutiveWeakCycles ??
        fallbackAutoStage?.consecutiveWeakCycles ??
        snapshotState?.autoStage?.consecutiveWeakCycles ??
        solution.autoStage?.consecutiveWeakCycles ??
        lastEntry?.autoStage?.consecutiveWeakCycles ??
        0,
      lastCycleImprovementRatio:
        preferredAutoStage?.lastCycleImprovementRatio ??
        fallbackAutoStage?.lastCycleImprovementRatio ??
        snapshotState?.autoStage?.lastCycleImprovementRatio ??
        solution.autoStage?.lastCycleImprovementRatio ??
        lastEntry?.autoStage?.lastCycleImprovementRatio ??
        null,
      generatedSeeds,
      stopReason
    },
    stoppedByUser: context.cancelRequested ? true : Boolean(solution.stoppedByUser)
  };
}

export function describeAutoCompletedSolution(solution: Solution): string | null {
  return describeAutoStopReason(solution.autoStage?.stopReason);
}

export function describeAutoRecoveredSolution(solution: Solution): string {
  return (
    describeAutoStopReason(solution.autoStage?.stopReason) ??
    "Auto kept the best available incumbent from the most recent completed stage."
  );
}
