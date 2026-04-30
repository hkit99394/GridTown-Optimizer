import type {
  AutoStageOptimizerName,
  CpSatPortfolioSummary,
  OptimizerName,
  Solution,
  SolverParams,
  SolverProgressPortfolioSummary,
  SolverProgressSummary,
} from "./types.js";

export interface BuildSolverProgressSummaryOptions {
  elapsedTimeSeconds?: number | null;
  fallbackOptimizer?: OptimizerName | null;
  params?: SolverParams;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundSeconds(value: unknown): number | null {
  const numericValue = finiteNumberOrNull(value);
  if (numericValue === null) return null;
  return Math.round(Math.max(0, numericValue) * 1000) / 1000;
}

function summarizePortfolio(portfolio: CpSatPortfolioSummary | undefined): SolverProgressPortfolioSummary | null {
  if (!portfolio) return null;
  const workers = Array.isArray(portfolio.workers) ? portfolio.workers : [];
  return {
    workerCount: portfolio.workerCount,
    completedWorkers: workers.length,
    feasibleWorkers: workers.filter((worker) => worker.feasible).length,
    selectedWorkerIndex: portfolio.selectedWorkerIndex ?? null,
  };
}

function isSolutionWarmStartHint(value: unknown): value is Solution {
  return Boolean(value) && value instanceof Object && "roads" in value && value.roads instanceof Set;
}

function getLatestLnsOutcome(solution: Solution): NonNullable<Solution["lnsTelemetry"]>["outcomes"][number] | null {
  const outcomes = solution.lnsTelemetry?.outcomes;
  if (!outcomes?.length) return null;
  return outcomes[outcomes.length - 1];
}

function inferActiveStage(solution: Solution, fallbackOptimizer: OptimizerName | null): OptimizerName | AutoStageOptimizerName | null {
  return solution.activeOptimizer ?? solution.autoStage?.activeStage ?? solution.optimizer ?? fallbackOptimizer ?? null;
}

function inferReuseSource(solution: Solution, params: SolverParams | undefined): string | null {
  const lnsSeedSource = solution.lnsTelemetry?.seedSource;
  if (lnsSeedSource === "hint") {
    return params?.lns?.seedHint?.sourceName ?? "hint";
  }
  if (lnsSeedSource === "greedy") {
    return "greedy-seed";
  }

  const warmStartHint = params?.cpSat?.warmStartHint;
  if (warmStartHint && !isSolutionWarmStartHint(warmStartHint)) {
    return warmStartHint.sourceName ?? "warm-start-hint";
  }
  if (warmStartHint) {
    return "solution-hint";
  }

  return null;
}

function inferStopReason(solution: Solution): string | null {
  if (solution.autoStage?.stopReason) return solution.autoStage.stopReason;
  if (solution.lnsTelemetry?.stopReason && solution.lnsTelemetry.stopReason !== "running") {
    return solution.lnsTelemetry.stopReason;
  }
  if (solution.stoppedByUser) return "cancelled";
  if (solution.stoppedByTimeLimit) return "wall-clock-limit";
  return null;
}

function inferCurrentScore(solution: Solution): number | null {
  const latestLnsOutcome = getLatestLnsOutcome(solution);
  if (latestLnsOutcome) return latestLnsOutcome.populationAfter;
  return finiteNumberOrNull(solution.cpSatTelemetry?.incumbentPopulation) ?? finiteNumberOrNull(solution.totalPopulation);
}

function inferBestScore(solution: Solution): number | null {
  return finiteNumberOrNull(solution.totalPopulation) ?? finiteNumberOrNull(solution.cpSatTelemetry?.incumbentPopulation);
}

export function buildSolverProgressSummary(
  solution: Solution,
  options: BuildSolverProgressSummaryOptions = {}
): SolverProgressSummary {
  const telemetry = solution.cpSatTelemetry;
  const elapsedTimeSeconds =
    roundSeconds(options.elapsedTimeSeconds)
    ?? roundSeconds(telemetry?.solveWallTimeSeconds)
    ?? roundSeconds(solution.lnsTelemetry?.elapsedSeconds);

  return {
    currentScore: inferCurrentScore(solution),
    bestScore: inferBestScore(solution),
    activeStage: inferActiveStage(solution, options.fallbackOptimizer ?? null),
    reuseSource: inferReuseSource(solution, options.params),
    elapsedTimeSeconds,
    timeSinceImprovementSeconds: roundSeconds(telemetry?.secondsSinceLastImprovement),
    stopReason: inferStopReason(solution),
    exactGap: finiteNumberOrNull(telemetry?.populationGapUpperBound),
    portfolioWorkerSummary: summarizePortfolio(solution.cpSatPortfolio),
  };
}

export function buildEmptySolverProgressSummary(
  fallbackOptimizer: OptimizerName | null = null,
  elapsedTimeSeconds: number | null = null
): SolverProgressSummary {
  return {
    currentScore: null,
    bestScore: null,
    activeStage: fallbackOptimizer,
    reuseSource: null,
    elapsedTimeSeconds: roundSeconds(elapsedTimeSeconds),
    timeSinceImprovementSeconds: null,
    stopReason: null,
    exactGap: null,
    portfolioWorkerSummary: null,
  };
}

function formatProgressNumber(value: number | null, suffix = ""): string {
  if (value === null) return "n/a";
  return `${Number(value).toLocaleString()}${suffix}`;
}

export function formatSolverProgressSummary(summary: SolverProgressSummary): string {
  const parts = [
    `current=${formatProgressNumber(summary.currentScore)}`,
    `best=${formatProgressNumber(summary.bestScore)}`,
    `stage=${summary.activeStage ?? "n/a"}`,
    `reuse=${summary.reuseSource ?? "none"}`,
    `elapsed=${formatProgressNumber(summary.elapsedTimeSeconds, "s")}`,
    `since-improve=${formatProgressNumber(summary.timeSinceImprovementSeconds, "s")}`,
    `stop=${summary.stopReason ?? "n/a"}`,
    `gap=${formatProgressNumber(summary.exactGap)}`,
  ];

  if (summary.portfolioWorkerSummary) {
    parts.push(
      `portfolio=${summary.portfolioWorkerSummary.feasibleWorkers}/${summary.portfolioWorkerSummary.workerCount} feasible, selected=${summary.portfolioWorkerSummary.selectedWorkerIndex ?? "n/a"}`
    );
  }

  return parts.join(" ");
}
