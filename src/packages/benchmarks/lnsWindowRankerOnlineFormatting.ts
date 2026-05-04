import { formatBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  formatBenchmarkDecimal as formatDecimal,
  formatBenchmarkRate as formatRate,
  formatBenchmarkSeconds as formatSeconds,
  formatBenchmarkSeedCase as formatSeedCase,
  formatBenchmarkSignedNumber as formatSigned
} from "./benchmarkOptions.js";
import {
  formatLnsWindowRankerOnlineTransitionCounts as formatTransitionCounts,
  formatLnsWindowRankerOnlineTransitionFinalOutcomeCounts as formatTransitionFinalOutcomeCounts,
  formatLnsWindowRankerOnlineTransitionPressureFamilyCounts as formatTransitionPressureFamilyCounts
} from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

import type {
  LnsWindowRankerOnlineAblationSuiteResult,
  LnsWindowRankerOnlineAblationVariantResult,
  LnsWindowRankerOnlineCalibrationSuiteResult
} from "./lnsWindowRankerOnlineAblations.js";
import type { LnsWindowRankerOnlineTransitionStatusCounts } from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

interface LnsWindowRankerOnlineTransitionSummary {
  overrideTransitionCounts: Record<string, number>;
  fallbackTransitionCounts: Record<string, number>;
  overrideTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  fallbackTransitionFinalOutcomeCounts: Record<string, LnsWindowRankerOnlineTransitionStatusCounts>;
  overrideTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
  fallbackTransitionPressureFamilyCounts: Record<string, Record<string, number>>;
}

function formatNullableThreshold(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatNullableDecimal(value: number | null): string {
  return value === null ? "n/a" : formatDecimal(value);
}

function formatRankerSummary(variant: LnsWindowRankerOnlineAblationVariantResult): string {
  const ranker = variant.windowRanker;
  if (!ranker) return "ranker=disabled";
  return `ranker=decisions:${ranker.decisions} overrides:${ranker.overrides} fallback:${ranker.fallbackDecisions} override-rate:${formatRate(ranker.overrideRate)} override-improved:${variant.overrideImprovedOutcomeCount} override-neutral:${variant.overrideNeutralOutcomeCount} final:${variant.finalOutcome.status}/${formatSigned(variant.finalOutcome.populationDeltaVsBaseline)} override-score-delta-mean:${formatNullableDecimal(variant.meanOverrideScoreDelta)} override-window-changes:${variant.selectionDiagnostics?.overrideChangedWindowCount ?? 0} fallback-window-changes:${variant.selectionDiagnostics?.fallbackChangedWindowCount ?? 0} override-transitions:${formatTransitionCounts(variant.selectionDiagnostics?.overrideTransitionCounts ?? {})} fallback-transitions:${formatTransitionCounts(variant.selectionDiagnostics?.fallbackTransitionCounts ?? {})} fingerprint:${ranker.modelFingerprint ?? "n/a"}`;
}

function formatTransitionSummary(summary: LnsWindowRankerOnlineTransitionSummary): string {
  return `override-transitions=${formatTransitionCounts(summary.overrideTransitionCounts)} fallback-transitions=${formatTransitionCounts(summary.fallbackTransitionCounts)} override-transition-finals=${formatTransitionFinalOutcomeCounts(summary.overrideTransitionFinalOutcomeCounts)} fallback-transition-finals=${formatTransitionFinalOutcomeCounts(summary.fallbackTransitionFinalOutcomeCounts)} override-transition-families=${formatTransitionPressureFamilyCounts(summary.overrideTransitionPressureFamilyCounts)} fallback-transition-families=${formatTransitionPressureFamilyCounts(summary.fallbackTransitionPressureFamilyCounts)}`;
}

export function formatLnsWindowRankerOnlineCalibration(result: LnsWindowRankerOnlineCalibrationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Ranker Threshold Sweep ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Model fingerprint: ${result.modelFingerprint ?? "n/a"}`);
  lines.push(`Thresholds: ${result.minScoreDeltas.join(", ")}`);
  lines.push(`Top mean-delta threshold: ${formatNullableThreshold(result.topMeanPopulationDeltaMinScoreDelta)}`);
  lines.push(`Top no-regression threshold: ${formatNullableThreshold(result.topSafeMinScoreDelta)}`);
  lines.push("Summary:");
  for (const summary of result.thresholdSummaries) {
    lines.push(
      `- min-score-delta=${summary.minScoreDelta}: delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} decisions=${summary.rankerDecisionCount} overrides=${summary.rankerOverrideCount} fallbacks=${summary.rankerFallbackDecisionCount} override-rate=${formatRate(summary.rankerOverrideRate)} fallback-rate=${formatRate(summary.rankerFallbackRate)} override-window-changes=${summary.overrideChangedWindowCount} fallback-window-changes=${summary.fallbackChangedWindowCount} ${formatTransitionSummary(summary)} safety=${summary.safetyGatePassed ? "pass" : "fail"} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  return lines.join("\n");
}

export function formatLnsWindowRankerOnlineAblation(result: LnsWindowRankerOnlineAblationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Ranker Online A/B ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  lines.push(
    `Coverage: cases=${result.coverage.caseCount} seeds=${result.coverage.seedCount} comparisons=${result.coverage.comparisonCount} runs=${result.coverage.runCount} variants=${result.coverage.variantCount} grid-cells=${result.coverage.gridCellCount}`
  );
  lines.push("Summary:");
  for (const summary of result.variantSummaries) {
    lines.push(
      `- ${summary.variantName}: mean=${formatDecimal(summary.meanPopulation)} median=${formatDecimal(summary.medianPopulation)} worst-decile=${formatDecimal(summary.worstDecilePopulation)} best=${formatDecimal(summary.bestPopulation)} delta-mean=${formatSigned(summary.meanPopulationDeltaVsBaseline)} delta-median=${formatSigned(summary.medianPopulationDeltaVsBaseline)} delta-worst-decile=${formatSigned(summary.worstDecilePopulationDeltaVsBaseline)} delta-best=${formatSigned(summary.bestPopulationDeltaVsBaseline)} delta-worst=${formatSigned(summary.worstPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(summary.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} improved=${summary.improvedCaseCount} regressed=${summary.regressedCaseCount} unchanged=${summary.unchangedCaseCount} win-rate=${formatRate(summary.winRate)} regression-rate=${formatRate(summary.regressionRate)} decisions=${summary.rankerDecisionCount} overrides=${summary.rankerOverrideCount} fallbacks=${summary.rankerFallbackDecisionCount} override-rate=${formatRate(summary.rankerOverrideRate)} fallback-rate=${formatRate(summary.rankerFallbackRate)} override-improved=${summary.overrideImprovedOutcomeCount} override-neutral=${summary.overrideNeutralOutcomeCount} override-final=${summary.overrideFinalImprovedCaseCount}/${summary.overrideFinalNeutralCaseCount}/${summary.overrideFinalRegressedCaseCount} override-final-delta-mean=${formatNullableDecimal(summary.meanOverrideFinalPopulationDelta)} override-score-delta-mean=${formatNullableDecimal(summary.meanOverrideScoreDelta)} override-window-changes=${summary.overrideChangedWindowCount} fallback-window-changes=${summary.fallbackChangedWindowCount} ${formatTransitionSummary(summary)} best-case=${formatSeedCase(summary.bestPopulationDeltaCaseName, summary.bestPopulationDeltaSeed)} worst-case=${formatSeedCase(summary.worstPopulationDeltaCaseName, summary.worstPopulationDeltaSeed)}`
    );
  }
  lines.push("");

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(`- ${benchmarkCase.name} seed=${seedLabel}: ${benchmarkCase.description}`);
    for (const variant of benchmarkCase.variants) {
      lines.push(
        `  ${variant.variantName}=population:${variant.totalPopulation} delta:${formatSigned(variant.populationDeltaVsBaseline)} wall:${formatSeconds(variant.wallClockSeconds)} wall-delta:${formatSeconds(variant.wallClockDeltaVsBaselineSeconds)} roads:${variant.roadCount} road-delta:${formatSigned(variant.roadDeltaVsBaseline)} services:${variant.serviceCount} residentials:${variant.residentialCount} stop:${variant.stopReason ?? "n/a"} improved:${variant.improvingIterations ?? "n/a"} neutral:${variant.neutralIterations ?? "n/a"} ${formatRankerSummary(variant)}`
      );
    }
  }

  return lines.join("\n");
}
