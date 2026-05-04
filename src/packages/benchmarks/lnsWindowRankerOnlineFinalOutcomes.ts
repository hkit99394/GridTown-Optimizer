import { countBenchmarkMatches, meanBenchmarkValue } from "./benchmarkOptions.js";

export type LnsWindowRankerFinalOutcomeStatus = "improved" | "neutral" | "regressed";

export interface LnsWindowRankerOnlineFinalOutcome {
  status: LnsWindowRankerFinalOutcomeStatus;
  populationDeltaVsBaseline: number;
  hasOverride: boolean;
  hasFallback: boolean;
}

export interface LnsWindowRankerOnlineFinalOutcomeSummary {
  overrideFinalImprovedCaseCount: number;
  overrideFinalNeutralCaseCount: number;
  overrideFinalRegressedCaseCount: number;
  fallbackFinalImprovedCaseCount: number;
  fallbackFinalNeutralCaseCount: number;
  fallbackFinalRegressedCaseCount: number;
  meanOverrideFinalPopulationDelta: number | null;
}

interface FinalOutcomeInput {
  finalOutcome: LnsWindowRankerOnlineFinalOutcome;
}

export function lnsWindowRankerFinalOutcomeStatus(delta: number): LnsWindowRankerFinalOutcomeStatus {
  if (delta > 0) return "improved";
  if (delta < 0) return "regressed";
  return "neutral";
}

export function buildLnsWindowRankerFinalOutcome(
  populationDeltaVsBaseline: number,
  overrideOutcomeCount: number,
  fallbackOutcomeCount: number
): LnsWindowRankerOnlineFinalOutcome {
  return {
    status: lnsWindowRankerFinalOutcomeStatus(populationDeltaVsBaseline),
    populationDeltaVsBaseline,
    hasOverride: overrideOutcomeCount > 0,
    hasFallback: fallbackOutcomeCount > 0
  };
}

function countFinalStatus(
  outcomes: readonly FinalOutcomeInput[],
  key: "hasOverride" | "hasFallback",
  status: LnsWindowRankerFinalOutcomeStatus
): number {
  return countBenchmarkMatches(outcomes, (entry) => entry.finalOutcome[key] && entry.finalOutcome.status === status);
}

export function summarizeLnsWindowRankerFinalOutcomes(
  outcomes: readonly FinalOutcomeInput[]
): LnsWindowRankerOnlineFinalOutcomeSummary {
  const overrideOutcomes = outcomes.filter((entry) => entry.finalOutcome.hasOverride);
  return {
    overrideFinalImprovedCaseCount: countFinalStatus(outcomes, "hasOverride", "improved"),
    overrideFinalNeutralCaseCount: countFinalStatus(outcomes, "hasOverride", "neutral"),
    overrideFinalRegressedCaseCount: countFinalStatus(outcomes, "hasOverride", "regressed"),
    fallbackFinalImprovedCaseCount: countFinalStatus(outcomes, "hasFallback", "improved"),
    fallbackFinalNeutralCaseCount: countFinalStatus(outcomes, "hasFallback", "neutral"),
    fallbackFinalRegressedCaseCount: countFinalStatus(outcomes, "hasFallback", "regressed"),
    meanOverrideFinalPopulationDelta: overrideOutcomes.length
      ? meanBenchmarkValue(overrideOutcomes.map((entry) => entry.finalOutcome.populationDeltaVsBaseline))
      : null
  };
}
