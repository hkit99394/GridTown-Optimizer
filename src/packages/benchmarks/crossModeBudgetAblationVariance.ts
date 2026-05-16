import {
  countBenchmarkMatches,
  formatNullableBenchmarkSignedNumber as formatSigned,
  meanBenchmarkValue,
  roundBenchmarkMetric
} from "./benchmarkOptions.js";

import type { CrossModeBenchmarkCaseScorecard, CrossModeBenchmarkModeResult } from "./crossMode.js";

interface VarianceComparison {
  candidateDelta: number;
  repeatDelta: number;
  deltaBeyondEnvelope: number;
}

export interface CrossModeBenchmarkBudgetAblationAutoVarianceSummary {
  baselineRepeatPolicyName: string;
  comparisonCount: number;
  insideRepeatEnvelopeCount: number;
  outsideRepeatEnvelopeCount: number;
  outsideNegativeRepeatEnvelopeCount: number;
  outsidePositiveRepeatEnvelopeCount: number;
  repeatAutoPopulationDeltaMin: number | null;
  repeatAutoPopulationDeltaMax: number | null;
  repeatMeanAbsoluteAutoPopulationDelta: number | null;
  candidateAutoPopulationDeltaMin: number | null;
  candidateAutoPopulationDeltaMax: number | null;
  candidateMeanAutoPopulationDelta: number | null;
  meanAbsoluteCandidateDeltaBeyondRepeatEnvelope: number | null;
  worstCandidateDeltaBeyondRepeatEnvelope: number | null;
  bestCandidateDeltaBeyondRepeatEnvelope: number | null;
}

function autoComparisonKey(scorecard: CrossModeBenchmarkCaseScorecard): string {
  return `${scorecard.name}\u0000${scorecard.budgetSeconds}\u0000${scorecard.seed}`;
}

function autoResult(scorecard: CrossModeBenchmarkCaseScorecard): CrossModeBenchmarkModeResult | null {
  return scorecard.results.find((result) => result.mode === "auto") ?? null;
}

function deltaBeyondRepeatEnvelope(candidateDelta: number, repeatDelta: number): number {
  const lower = Math.min(0, repeatDelta);
  const upper = Math.max(0, repeatDelta);
  if (candidateDelta < lower) return candidateDelta - lower;
  if (candidateDelta > upper) return candidateDelta - upper;
  return 0;
}

function nullableRoundedMean(values: readonly number[]): number | null {
  return values.length ? roundBenchmarkMetric(meanBenchmarkValue(values)) : null;
}

export function buildCrossModeBudgetAblationAutoVarianceSummary(
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>,
  baselineRepeatAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>,
  baselineRepeatPolicyName: string | null
): CrossModeBenchmarkBudgetAblationAutoVarianceSummary | null {
  if (baselineRepeatPolicyName === null || baselineRepeatAutoByKey.size === 0) return null;
  const comparisons = scorecards
    .map((scorecard): VarianceComparison | null => {
      const candidate = autoResult(scorecard);
      const baseline = baselineAutoByKey.get(autoComparisonKey(scorecard)) ?? null;
      const repeat = baselineRepeatAutoByKey.get(autoComparisonKey(scorecard)) ?? null;
      if (candidate === null || baseline === null || repeat === null) return null;
      const candidateDelta = candidate.totalPopulation - baseline.totalPopulation;
      const repeatDelta = repeat.totalPopulation - baseline.totalPopulation;
      return {
        candidateDelta,
        repeatDelta,
        deltaBeyondEnvelope: deltaBeyondRepeatEnvelope(candidateDelta, repeatDelta)
      };
    })
    .filter((comparison): comparison is VarianceComparison => comparison !== null);
  if (!comparisons.length) return null;

  const repeatDeltas = comparisons.map((comparison) => comparison.repeatDelta);
  const candidateDeltas = comparisons.map((comparison) => comparison.candidateDelta);
  const beyondEnvelopeDeltas = comparisons.map((comparison) => comparison.deltaBeyondEnvelope);
  const outsideRepeatEnvelopeCount = countBenchmarkMatches(beyondEnvelopeDeltas, (delta) => delta !== 0);
  return {
    baselineRepeatPolicyName,
    comparisonCount: comparisons.length,
    insideRepeatEnvelopeCount: comparisons.length - outsideRepeatEnvelopeCount,
    outsideRepeatEnvelopeCount,
    outsideNegativeRepeatEnvelopeCount: countBenchmarkMatches(beyondEnvelopeDeltas, (delta) => delta < 0),
    outsidePositiveRepeatEnvelopeCount: countBenchmarkMatches(beyondEnvelopeDeltas, (delta) => delta > 0),
    repeatAutoPopulationDeltaMin: Math.min(...repeatDeltas),
    repeatAutoPopulationDeltaMax: Math.max(...repeatDeltas),
    repeatMeanAbsoluteAutoPopulationDelta: nullableRoundedMean(repeatDeltas.map((delta) => Math.abs(delta))),
    candidateAutoPopulationDeltaMin: Math.min(...candidateDeltas),
    candidateAutoPopulationDeltaMax: Math.max(...candidateDeltas),
    candidateMeanAutoPopulationDelta: nullableRoundedMean(candidateDeltas),
    meanAbsoluteCandidateDeltaBeyondRepeatEnvelope: nullableRoundedMean(
      beyondEnvelopeDeltas.map((delta) => Math.abs(delta))
    ),
    worstCandidateDeltaBeyondRepeatEnvelope: Math.min(...beyondEnvelopeDeltas),
    bestCandidateDeltaBeyondRepeatEnvelope: Math.max(...beyondEnvelopeDeltas)
  };
}

export function formatCrossModeBudgetAblationAutoVarianceSummary(
  summary: CrossModeBenchmarkBudgetAblationAutoVarianceSummary
): string {
  return [
    `repeat=${summary.baselineRepeatPolicyName}`,
    `paired=${summary.comparisonCount}`,
    `inside=${summary.insideRepeatEnvelopeCount}`,
    `outside=${summary.outsideRepeatEnvelopeCount}`,
    `outside-neg=${summary.outsideNegativeRepeatEnvelopeCount}`,
    `outside-pos=${summary.outsidePositiveRepeatEnvelopeCount}`,
    `repeat-range=${formatSigned(summary.repeatAutoPopulationDeltaMin)}..${formatSigned(summary.repeatAutoPopulationDeltaMax)}`,
    `candidate-range=${formatSigned(summary.candidateAutoPopulationDeltaMin)}..${formatSigned(summary.candidateAutoPopulationDeltaMax)}`,
    `candidate-mean=${formatSigned(summary.candidateMeanAutoPopulationDelta)}`,
    `beyond-mean-abs=${summary.meanAbsoluteCandidateDeltaBeyondRepeatEnvelope ?? "n/a"}`,
    `beyond-worst=${formatSigned(summary.worstCandidateDeltaBeyondRepeatEnvelope)}`,
    `beyond-best=${formatSigned(summary.bestCandidateDeltaBeyondRepeatEnvelope)}`
  ].join(" ");
}
