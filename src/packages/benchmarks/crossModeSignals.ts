import {
  countBenchmarkMatches,
  formatNullableBenchmarkSeconds as formatSeconds,
  meanBenchmarkValue,
  roundBenchmarkMetric,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import { MODE_LABELS } from "./crossModeLabels.js";
import { compareModeResults } from "./crossModeResultOrder.js";

import type {
  CrossModeBenchmarkBudgetPolicySignal,
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkModeResult,
  CrossModeBenchmarkModeSummary,
  CrossModeBenchmarkProblemSizeSummary,
  CrossModeBudgetAllocationSignal,
  CrossModeBudgetAllocationSignalKind,
  CrossModeBudgetPolicyRecommendation,
  CrossModePortfolioEfficiencyRecommendation,
  CrossModePortfolioEfficiencySignal,
} from "./crossMode.js";

function roundSignalValue(value: number): number {
  return roundBenchmarkMetric(value);
}

function millisecondsToSignalSeconds(value: number | null): number | null {
  return value === null ? null : roundSignalValue(value / 1000);
}

export function buildCrossModeBudgetAllocationSignal(
  benchmark: Pick<
    CrossModeBenchmarkModeResult,
    "budgetSeconds" | "wallClockSeconds" | "decisionTrace" | "timeToQuality"
  >,
  options: {
    scoreDeltaVsAuto: number | null;
    autoBestScoreAtMs: number | null;
  }
): CrossModeBudgetAllocationSignal {
  const budgetSeconds = Math.max(benchmark.budgetSeconds, 0.001);
  const finalElapsedSeconds = millisecondsToSignalSeconds(benchmark.timeToQuality.finalElapsedMs)
    ?? roundSignalValue(benchmark.wallClockSeconds);
  const firstImprovementSeconds = millisecondsToSignalSeconds(benchmark.timeToQuality.firstImprovementAtMs);
  const bestScoreSeconds = millisecondsToSignalSeconds(benchmark.timeToQuality.bestScoreAtMs);
  const autoBestScoreSeconds = millisecondsToSignalSeconds(options.autoBestScoreAtMs);
  const budgetRemainingSeconds = roundSignalValue(Math.max(0, benchmark.budgetSeconds - benchmark.wallClockSeconds));
  const budgetOverrunSeconds = roundSignalValue(Math.max(0, benchmark.wallClockSeconds - benchmark.budgetSeconds));
  const budgetUtilizationRatio = roundSignalValue(benchmark.wallClockSeconds / budgetSeconds);
  const secondsAfterBest = bestScoreSeconds === null
    ? null
    : roundSignalValue(Math.max(0, finalElapsedSeconds - bestScoreSeconds));
  const improvementsPerSecond = finalElapsedSeconds > 0
    ? roundSignalValue(benchmark.timeToQuality.improvementCount / finalElapsedSeconds)
    : null;
  const autoBestScoreSecondsDelta = bestScoreSeconds === null || autoBestScoreSeconds === null
    ? null
    : roundSignalValue(bestScoreSeconds - autoBestScoreSeconds);

  let signal: CrossModeBudgetAllocationSignalKind = "steady";
  let reason = "Trace shows no obvious budget-allocation pressure.";
  if (benchmark.decisionTrace.length === 0 || benchmark.timeToQuality.bestScore === null) {
    signal = "insufficient-trace";
    reason = "No scored trace events were available.";
  } else if (budgetOverrunSeconds > Math.max(0.1, budgetSeconds * 0.05)) {
    signal = "over-budget";
    reason = "Observed wall time exceeded the configured benchmark budget.";
  } else if (budgetRemainingSeconds > Math.max(0.5, budgetSeconds * 0.25)) {
    signal = "under-used-budget";
    reason = "Observed wall time used only a small share of the configured benchmark budget.";
  } else if (
    secondsAfterBest !== null
    && secondsAfterBest >= Math.max(1, budgetSeconds * 0.5)
    && (options.scoreDeltaVsAuto ?? 0) <= 0
  ) {
    signal = "early-plateau";
    reason = "Best score arrived early, then the run spent a large budget tail without beating Auto.";
  } else if (
    bestScoreSeconds !== null
    && bestScoreSeconds >= budgetSeconds * 0.75
    && benchmark.timeToQuality.improvementCount > 0
    && (options.scoreDeltaVsAuto ?? 0) >= 0
  ) {
    signal = "late-improvement";
    reason = "Best score arrived late in the budget while matching or beating Auto.";
  }

  return {
    signal,
    budgetUtilizationRatio,
    budgetRemainingSeconds,
    budgetOverrunSeconds,
    firstImprovementSeconds,
    bestScoreSeconds,
    secondsAfterBest,
    improvementsPerSecond,
    scoreDeltaVsAuto: options.scoreDeltaVsAuto,
    autoBestScoreSecondsDelta,
    reason,
  };
}

function standardDeviation(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const average = meanBenchmarkValue(values);
  return Math.sqrt(meanBenchmarkValue(values.map((value) => (value - average) ** 2)));
}

function summarizeMode(mode: CrossModeBenchmarkMode, results: readonly CrossModeBenchmarkModeResult[]): CrossModeBenchmarkModeSummary {
  const populations = results.map((result) => result.totalPopulation);
  const comparable = results.filter((result) => result.winVsAuto !== "baseline" && result.winVsAuto !== "no-auto");
  const wins = countBenchmarkMatches(comparable, (result) => result.winVsAuto === "win");
  const ties = countBenchmarkMatches(comparable, (result) => result.winVsAuto === "tie");
  const deltas = results
    .map((result) => result.scoreDeltaVsAuto)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    mode,
    label: MODE_LABELS[mode],
    runs: results.length,
    meanPopulation: meanBenchmarkValue(populations),
    bestPopulation: populations.length ? Math.max(...populations) : 0,
    worstPopulation: populations.length ? Math.min(...populations) : 0,
    populationStdDev: standardDeviation(populations),
    meanWallClockSeconds: meanBenchmarkValue(results.map((result) => result.wallClockSeconds)),
    winRateVsAuto: comparable.length ? (wins + ties * 0.5) / comparable.length : null,
    meanScoreDeltaVsAuto: deltas.length ? meanBenchmarkValue(deltas) : null,
  };
}

export function buildSummaries(cases: readonly CrossModeBenchmarkCaseScorecard[]): {
  modeSummaries: CrossModeBenchmarkModeSummary[];
  problemSizeSummaries: CrossModeBenchmarkProblemSizeSummary[];
} {
  const results = cases.flatMap((scorecard) => scorecard.results);
  const modes = uniqueBenchmarkValuesBy(results, (result) => result.mode);
  const modeSummaries = modes.map((mode) => summarizeMode(mode, results.filter((result) => result.mode === mode)));
  const problemSizeBands = uniqueBenchmarkValuesBy(results, (result) => result.problemSizeBand);
  const problemSizeSummaries = problemSizeBands.flatMap((problemSizeBand) =>
    modes.map((mode) => ({
      problemSizeBand,
      ...summarizeMode(
        mode,
        results.filter((result) => result.mode === mode && result.problemSizeBand === problemSizeBand)
      ),
    })).filter((summary) => summary.runs > 0)
  );
  return { modeSummaries, problemSizeSummaries };
}

function recommendationForBestMode(
  bestMode: CrossModeBenchmarkMode | null,
  autoDeltaToBest: number | null
): CrossModeBudgetPolicyRecommendation {
  if (bestMode === null) return "investigate-auto-loss";
  if (autoDeltaToBest === null) return "add-auto-baseline";
  if (autoDeltaToBest <= 0) return "keep-auto";
  if (bestMode === "greedy") return "shift-auto-budget-to-greedy";
  if (bestMode === "lns") return "shift-auto-budget-to-lns";
  if (bestMode === "cp-sat") return "shift-auto-budget-to-cp-sat";
  if (bestMode === "cp-sat-portfolio") return "keep-portfolio-experimental";
  return "investigate-auto-loss";
}

function buildBudgetPolicyReason(
  signal: Omit<CrossModeBenchmarkBudgetPolicySignal, "reason">
): string {
  const stageEvidence = [
    signal.autoLnsStageElapsedSeconds !== null
      ? `Auto LNS used ${formatSeconds(signal.autoLnsStageElapsedSeconds)} for +${signal.autoLnsStageImprovement ?? "n/a"} accepted population`
      : null,
    signal.autoCpSatStageElapsedSeconds !== null
      ? `Auto CP-SAT used ${formatSeconds(signal.autoCpSatStageElapsedSeconds)} for +${signal.autoCpSatStageImprovement ?? "n/a"} accepted population`
      : null,
  ].filter((entry): entry is string => entry !== null).join("; ");
  const stageSuffix = stageEvidence ? ` ${stageEvidence}.` : "";

  if (signal.autoScore === null) {
    return "No Auto run is present for this budget; add Auto before comparing budget policy.";
  }
  if (signal.autoDeltaToBest === null || signal.bestMode === null) {
    return "Insufficient score data to compare Auto against the best mode.";
  }
  if (signal.autoDeltaToBest <= 0) {
    return `Auto matched the best score ${signal.bestScore ?? "n/a"} at ${signal.budgetSeconds}s.${stageSuffix}`;
  }
  const label = MODE_LABELS[signal.bestMode];
  return `${label} beat Auto by ${signal.autoDeltaToBest} population at ${signal.budgetSeconds}s; inspect trace timing before changing policy.${stageSuffix}`;
}

type AutoStageEvidenceSummary = Pick<
  CrossModeBenchmarkBudgetPolicySignal,
  | "autoLnsStageElapsedSeconds"
  | "autoLnsStageImprovement"
  | "autoCpSatStageElapsedSeconds"
  | "autoCpSatStageImprovement"
>;

function addFiniteEvidence(total: number | null, value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? (total ?? 0) + value : total;
}

function roundEvidenceTotal(value: number | null): number | null {
  return value === null ? null : roundSignalValue(value);
}

function summarizeAutoStageEvidence(result: CrossModeBenchmarkModeResult | null): AutoStageEvidenceSummary {
  let lnsElapsedSeconds: number | null = null;
  let lnsImprovement: number | null = null;
  let cpSatElapsedSeconds: number | null = null;
  let cpSatImprovement: number | null = null;

  for (const entry of result?.decisionTrace ?? []) {
    if (entry.kind !== "auto-stage") continue;
    if (entry.activeStage === "lns") {
      lnsElapsedSeconds = addFiniteEvidence(lnsElapsedSeconds, entry.evidence?.elapsedSeconds);
      lnsImprovement = addFiniteEvidence(lnsImprovement, entry.evidence?.improvement);
    } else if (entry.activeStage === "cp-sat") {
      cpSatElapsedSeconds = addFiniteEvidence(cpSatElapsedSeconds, entry.evidence?.elapsedSeconds);
      cpSatImprovement = addFiniteEvidence(cpSatImprovement, entry.evidence?.improvement);
    }
  }

  return {
    autoLnsStageElapsedSeconds: roundEvidenceTotal(lnsElapsedSeconds),
    autoLnsStageImprovement: roundEvidenceTotal(lnsImprovement),
    autoCpSatStageElapsedSeconds: roundEvidenceTotal(cpSatElapsedSeconds),
    autoCpSatStageImprovement: roundEvidenceTotal(cpSatImprovement),
  };
}

export function buildBudgetPolicySignals(
  cases: readonly CrossModeBenchmarkCaseScorecard[]
): CrossModeBenchmarkBudgetPolicySignal[] {
  return cases.map((scorecard) => {
    const auto = scorecard.results.find((result) => result.mode === "auto") ?? null;
    const lns = scorecard.results.find((result) => result.mode === "lns") ?? null;
    const best = [...scorecard.results].sort(compareModeResults)[0] ?? null;
    const autoDeltaToBest = auto && best ? best.totalPopulation - auto.totalPopulation : null;
    const autoStageEvidence = summarizeAutoStageEvidence(auto);
    const partial = {
      caseName: scorecard.name,
      problemSizeBand: scorecard.problemSizeBand,
      budgetSeconds: scorecard.budgetSeconds,
      seed: scorecard.seed,
      bestMode: best?.mode ?? null,
      bestScore: best?.totalPopulation ?? null,
      autoScore: auto?.totalPopulation ?? null,
      autoDeltaToBest,
      recommendation: recommendationForBestMode(best?.mode ?? null, autoDeltaToBest),
      autoStopReason: auto?.autoStopReason ?? null,
      autoGreedySeedElapsedSeconds: auto?.autoGreedySeedElapsedSeconds ?? null,
      ...autoStageEvidence,
      lnsScoreDeltaVsAuto: auto && lns ? lns.totalPopulation - auto.totalPopulation : null,
      lnsSeedWallClockSeconds: lns?.lnsSeedWallClockSeconds ?? null,
    };
    return {
      ...partial,
      reason: buildBudgetPolicyReason(partial),
    };
  });
}

function buildPortfolioEfficiencyReason(signal: Omit<CrossModePortfolioEfficiencySignal, "reason">): string {
  if (signal.recommendation === "portfolio-cpu-win") {
    return `Portfolio beat single CP-SAT by ${signal.scoreDelta} population while matching wall-clock and CPU-budget efficiency.`;
  }
  if (signal.recommendation === "portfolio-wall-win-only") {
    return `Portfolio beat single CP-SAT by ${signal.scoreDelta} population, but used CPU budget less efficiently; keep experimental.`;
  }
  if (signal.scoreDelta > 0) {
    return `Portfolio improved population by ${signal.scoreDelta}, but did not meet the CPU-normalized wall-clock promotion gate.`;
  }
  if (signal.scoreDelta === 0) {
    return "Portfolio tied single CP-SAT on population, so extra CPU lanes are not justified by this run.";
  }
  return `Single CP-SAT beat portfolio by ${Math.abs(signal.scoreDelta)} population.`;
}

export function buildPortfolioEfficiencySignals(
  cases: readonly CrossModeBenchmarkCaseScorecard[]
): CrossModePortfolioEfficiencySignal[] {
  const signals: CrossModePortfolioEfficiencySignal[] = [];
  for (const scorecard of cases) {
    const single = scorecard.results.find((result) => result.mode === "cp-sat") ?? null;
    const portfolio = scorecard.results.find((result) => result.mode === "cp-sat-portfolio") ?? null;
    if (!single || !portfolio) continue;

    const scoreDelta = portfolio.totalPopulation - single.totalPopulation;
    const wallClockDeltaSeconds = roundSignalValue(portfolio.wallClockSeconds - single.wallClockSeconds);
    const cpuBudgetDeltaSeconds = roundSignalValue(portfolio.workerCpuBudgetSeconds - single.workerCpuBudgetSeconds);
    const cpuBudgetEfficiencyRatio =
      single.populationPerWorkerCpuBudgetSecond !== null
      && single.populationPerWorkerCpuBudgetSecond > 0
      && portfolio.populationPerWorkerCpuBudgetSecond !== null
        ? roundSignalValue(portfolio.populationPerWorkerCpuBudgetSecond / single.populationPerWorkerCpuBudgetSecond)
        : null;
    const recommendation: CrossModePortfolioEfficiencyRecommendation =
      scoreDelta > 0 && wallClockDeltaSeconds <= 0 && (cpuBudgetEfficiencyRatio ?? 0) >= 1
        ? "portfolio-cpu-win"
        : scoreDelta > 0 && wallClockDeltaSeconds <= 0
          ? "portfolio-wall-win-only"
          : "single-cp-sat";
    const partial = {
      caseName: scorecard.name,
      problemSizeBand: scorecard.problemSizeBand,
      budgetSeconds: scorecard.budgetSeconds,
      seed: scorecard.seed,
      singleScore: single.totalPopulation,
      portfolioScore: portfolio.totalPopulation,
      scoreDelta,
      singleWallClockSeconds: roundSignalValue(single.wallClockSeconds),
      portfolioWallClockSeconds: roundSignalValue(portfolio.wallClockSeconds),
      wallClockDeltaSeconds,
      singleWorkerCpuBudgetSeconds: roundSignalValue(single.workerCpuBudgetSeconds),
      portfolioWorkerCpuBudgetSeconds: roundSignalValue(portfolio.workerCpuBudgetSeconds),
      cpuBudgetDeltaSeconds,
      singleObservedWorkerCpuSeconds: single.observedWorkerCpuSeconds,
      portfolioObservedWorkerCpuSeconds: portfolio.observedWorkerCpuSeconds,
      singlePopulationPerCpuBudgetSecond: single.populationPerWorkerCpuBudgetSecond,
      portfolioPopulationPerCpuBudgetSecond: portfolio.populationPerWorkerCpuBudgetSecond,
      cpuBudgetEfficiencyRatio,
      recommendation,
    };
    signals.push({
      ...partial,
      reason: buildPortfolioEfficiencyReason(partial),
    });
  }
  return signals;
}

