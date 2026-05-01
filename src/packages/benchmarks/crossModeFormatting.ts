import { formatTimeToQualityScorecard, formatSolverProgressSummary } from "../core/index.js";
import {
  formatBenchmarkRate as formatRatio,
  formatNullableBenchmarkNumber as formatPopulationGap,
  formatNullableBenchmarkSeconds as formatSeconds,
  formatNullableBenchmarkSignedNumber as formatScoreDeltaVsAuto,
} from "./benchmarkOptions.js";
import { MODE_LABELS } from "./crossModeLabels.js";
import { compareModeResults } from "./crossModeResultOrder.js";

import type {
  CrossModeBenchmarkBudgetPolicySignal,
  CrossModeBenchmarkModeResult,
  CrossModeBenchmarkSuiteResult,
  CrossModeBudgetAllocationSignal,
  CrossModePortfolioEfficiencySignal,
  CrossModeRoadSemanticsSummary,
} from "./crossMode.js";

function formatScoreDelta(value: number | null): string {
  if (value === null) return "n/a";
  return value === 0 ? "best" : `-${Number(value).toLocaleString()}`;
}

function formatBudgetAllocationSignal(signal: CrossModeBudgetAllocationSignal): string {
  return [
    signal.signal,
    `use=${formatRatio(signal.budgetUtilizationRatio)}`,
    `unused=${formatSeconds(signal.budgetRemainingSeconds)}`,
    `overrun=${formatSeconds(signal.budgetOverrunSeconds)}`,
    `first-improve=${formatSeconds(signal.firstImprovementSeconds)}`,
    `best=${formatSeconds(signal.bestScoreSeconds)}`,
    `after-best=${formatSeconds(signal.secondsAfterBest)}`,
    `improvements/s=${signal.improvementsPerSecond === null ? "n/a" : signal.improvementsPerSecond.toFixed(3)}`,
    `auto-best-delta=${formatSeconds(signal.autoBestScoreSecondsDelta)}`,
  ].join(" ");
}

function formatBudgetPolicySignal(signal: CrossModeBenchmarkBudgetPolicySignal): string {
  const best = signal.bestMode === null ? "n/a" : `${MODE_LABELS[signal.bestMode]}:${signal.bestScore ?? "n/a"}`;
  return [
    `${signal.caseName}`,
    `budget=${signal.budgetSeconds}s`,
    `seed=${signal.seed}`,
    `recommendation=${signal.recommendation}`,
    `auto=${signal.autoScore ?? "n/a"}`,
    `best=${best}`,
    `auto-gap=${formatPopulationGap(signal.autoDeltaToBest)}`,
    `lns-vs-auto=${formatScoreDeltaVsAuto(signal.lnsScoreDeltaVsAuto)}`,
    `auto-lns=${formatSeconds(signal.autoLnsStageElapsedSeconds)}/+${formatPopulationGap(signal.autoLnsStageImprovement)}`,
    `auto-cp-sat=${formatSeconds(signal.autoCpSatStageElapsedSeconds)}/+${formatPopulationGap(signal.autoCpSatStageImprovement)}`,
    `reason=${signal.reason}`,
  ].join(" ");
}

function formatPortfolioEfficiencySignal(signal: CrossModePortfolioEfficiencySignal): string {
  return [
    `${signal.caseName}`,
    `budget=${signal.budgetSeconds}s`,
    `seed=${signal.seed}`,
    `recommendation=${signal.recommendation}`,
    `single=${signal.singleScore}`,
    `portfolio=${signal.portfolioScore}`,
    `delta=${formatScoreDeltaVsAuto(signal.scoreDelta)}`,
    `wall-delta=${formatSeconds(signal.wallClockDeltaSeconds)}`,
    `cpu-budget-delta=${formatSeconds(signal.cpuBudgetDeltaSeconds)}`,
    `single-pop/cpu=${signal.singlePopulationPerCpuBudgetSecond === null ? "n/a" : signal.singlePopulationPerCpuBudgetSecond.toFixed(3)}`,
    `portfolio-pop/cpu=${signal.portfolioPopulationPerCpuBudgetSecond === null ? "n/a" : signal.portfolioPopulationPerCpuBudgetSecond.toFixed(3)}`,
    `cpu-eff-ratio=${signal.cpuBudgetEfficiencyRatio === null ? "n/a" : signal.cpuBudgetEfficiencyRatio.toFixed(3)}`,
    `reason=${signal.reason}`,
  ].join(" ");
}

function formatSeedPolicyEvidence(benchmark: CrossModeBenchmarkModeResult): string | null {
  const details: string[] = [];
  if (benchmark.lnsSeedTimeLimitSeconds !== null || benchmark.lnsSeedWallClockSeconds !== null) {
    details.push(
      `lns-seed-limit:${formatSeconds(benchmark.lnsSeedTimeLimitSeconds)} lns-seed-wall:${formatSeconds(benchmark.lnsSeedWallClockSeconds)} lns-seed-phases:${benchmark.lnsSeedProfilePhaseCount}`
    );
  }
  if (benchmark.autoGreedySeedTimeLimitSeconds !== null || benchmark.autoGreedySeedElapsedSeconds !== null) {
    details.push(
      `auto-greedy-seed-limit:${formatSeconds(benchmark.autoGreedySeedTimeLimitSeconds)} auto-greedy-seed-wall:${formatSeconds(benchmark.autoGreedySeedElapsedSeconds)} auto-greedy-seed-phases:${benchmark.autoGreedySeedProfilePhaseCount}`
    );
  }
  return details.length > 0 ? details.join(" ") : null;
}

function formatRoadSemanticsSummary(summary: CrossModeRoadSemanticsSummary): string {
  return [
    summary.status,
    `anchor-roads=${summary.anchorRoadCount}`,
    `anchor-connected=${summary.anchorConnectedRoadCount}`,
    `disconnected=${summary.disconnectedRoadCount}`,
    `connected-ratio=${summary.anchorConnectedRoadRatio === null ? "n/a" : summary.anchorConnectedRoadRatio.toFixed(3)}`,
    `adjacent-buildings=${summary.roadAdjacentBuildingCount}`,
    `unadjacent-buildings=${summary.roadUnadjacentBuildingCount}`,
  ].join(" ");
}

export function formatCrossModeBenchmarkSuite(result: CrossModeBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Cross-Mode Benchmark Scorecard ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Modes: ${result.modes.map((mode) => MODE_LABELS[mode]).join(", ")}`);
  lines.push(`Equal wall-clock budgets: ${result.budgetsSeconds.join(", ")}s per mode`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push("");

  for (const scorecard of result.cases) {
    lines.push(`- ${scorecard.name}: ${scorecard.description}`);
    const workflowTags = scorecard.workflowTags.length ? scorecard.workflowTags.join(",") : "none";
    lines.push(
      `  band=${scorecard.problemSizeBand} split=${scorecard.split} workflow=${workflowTags} budget=${scorecard.budgetSeconds}s seed=${scorecard.seed} best=${scorecard.bestScore ?? "n/a"} winner=${scorecard.winnerModes.map((mode) => MODE_LABELS[mode]).join(", ") || "n/a"} grid=${scorecard.gridRows}x${scorecard.gridCols}`
    );
    for (const benchmark of [...scorecard.results].sort(compareModeResults)) {
      lines.push(
        `  ${benchmark.label}: rank=${benchmark.rank} score=${benchmark.totalPopulation} delta=${formatScoreDelta(benchmark.scoreDeltaToBest)} win-vs-auto=${benchmark.winVsAuto} auto-delta=${formatScoreDeltaVsAuto(benchmark.scoreDeltaVsAuto)} wall=${benchmark.wallClockSeconds.toFixed(3)}s cpu-budget=${benchmark.workerCpuBudgetSeconds}s observed-cpu=${formatSeconds(benchmark.observedWorkerCpuSeconds)} pop/cpu-budget=${benchmark.populationPerWorkerCpuBudgetSecond === null ? "n/a" : benchmark.populationPerWorkerCpuBudgetSecond.toFixed(3)} roads=${benchmark.roadCount} services=${benchmark.serviceCount} residentials=${benchmark.residentialCount}`
      );
      lines.push(`    progress=${formatSolverProgressSummary(benchmark.progressSummary)}`);
      lines.push(
        `    quality=${formatTimeToQualityScorecard(benchmark.timeToQuality)} trace-events=${benchmark.decisionTrace.length}`
      );
      lines.push(`    road-semantics=${formatRoadSemanticsSummary(benchmark.roadSemantics)}`);
      lines.push(`    budget-signal=${formatBudgetAllocationSignal(benchmark.budgetAllocationSignal)}`);
      lines.push(`    reason=${benchmark.checkpointReason}`);
      const seedPolicyEvidence = formatSeedPolicyEvidence(benchmark);
      if (seedPolicyEvidence) {
        lines.push(`    seed-policy=${seedPolicyEvidence}`);
      }
    }
  }

  lines.push("");
  lines.push("Mode summaries:");
  for (const summary of result.modeSummaries) {
    lines.push(
      `- ${summary.label}: runs=${summary.runs} mean=${summary.meanPopulation.toFixed(1)} best=${summary.bestPopulation} worst=${summary.worstPopulation} seed-stddev=${summary.populationStdDev.toFixed(1)} win-rate-vs-auto=${summary.winRateVsAuto === null ? "n/a" : summary.winRateVsAuto.toFixed(3)}`
    );
  }

  lines.push("");
  lines.push("Budget policy signals:");
  for (const signal of result.budgetPolicySignals) {
    lines.push(`- ${formatBudgetPolicySignal(signal)}`);
  }

  lines.push("");
  lines.push("Portfolio efficiency signals:");
  if (result.portfolioEfficiencySignals.length === 0) {
    lines.push("- No paired CP-SAT / CP-SAT portfolio runs.");
  } else {
    for (const signal of result.portfolioEfficiencySignals) {
      lines.push(`- ${formatPortfolioEfficiencySignal(signal)}`);
    }
  }

  lines.push("");
  lines.push("Problem-size summaries:");
  for (const summary of result.problemSizeSummaries) {
    lines.push(
      `- ${summary.problemSizeBand} ${summary.label}: mean=${summary.meanPopulation.toFixed(1)} best=${summary.bestPopulation} win-rate-vs-auto=${summary.winRateVsAuto === null ? "n/a" : summary.winRateVsAuto.toFixed(3)}`
    );
  }

  return lines.join("\n");
}

