import { serializeDecisionTraceJsonl } from "../core/index.js";
import {
  benchmarkRatio,
  benchmarkGeneratedAt,
  countBenchmarkMatches,
  formatNullableBenchmarkNumber as formatPopulationGap,
  formatNullableBenchmarkSeconds as formatSeconds,
  formatNullableBenchmarkSignedNumber as formatScoreDeltaVsAuto,
  groupBenchmarkValuesBy,
  meanBenchmarkValue,
  meanNullableBenchmarkValue,
  percentileBenchmarkValue,
  selectBenchmarkCasesByName,
  sumBenchmarkBy
} from "./benchmarkOptions.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";
import {
  collectCrossModeBenchmarkDecisionTraceEvents,
  DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
  DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  formatCrossModeBenchmarkSuite,
  runCrossModeBenchmarkSuite
} from "./crossMode.js";
import {
  buildCrossModeBudgetAblationAutoReplayDiagnostics,
  formatCrossModeBudgetAblationAutoReplayDiagnostic
} from "./crossModeBudgetAblationDiagnostics.js";

import type {
  CrossModeBenchmarkBudgetAblationPolicy,
  CrossModeBenchmarkBudgetPolicySignal,
  CrossModeBenchmarkCase,
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkModeResult,
  CrossModeBenchmarkRunOptions,
  CrossModeBenchmarkSuiteResult,
  CrossModeProblemSizeBand,
  CrossModeBudgetPolicyRecommendation
} from "./crossMode.js";
import type { CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic } from "./crossModeBudgetAblationDiagnostics.js";
import type { SolverDecisionTraceEvent } from "../core/index.js";

export interface CrossModeBenchmarkBudgetAblationRunOptions extends CrossModeBenchmarkRunOptions {
  policies?: readonly CrossModeBenchmarkBudgetAblationPolicy[];
  policyNames?: readonly string[];
  baselinePolicyName?: string;
}

export interface CrossModeBenchmarkBudgetAblationBudgetSummary {
  budgetSeconds: number;
  caseCount: number;
  meanBestPopulation: number;
  meanAutoPopulation: number | null;
  meanLnsPopulation: number | null;
  meanAutoDeltaToBest: number | null;
  deltaVsBaselineMeanBestPopulation: number | null;
  deltaVsBaselineMeanAutoPopulation: number | null;
  deltaVsBaselineMeanLnsPopulation: number | null;
  autoSafetySummary: CrossModeBenchmarkBudgetAblationAutoSafetySummary;
  recommendationCounts: Record<CrossModeBudgetPolicyRecommendation, number>;
}

export interface CrossModeBenchmarkBudgetAblationAutoSafetySummary {
  comparisonCount: number;
  improvedAutoCount: number;
  regressedAutoCount: number;
  unchangedAutoCount: number;
  regressionRate: number;
  meanAutoPopulationDeltaVsBaseline: number | null;
  medianAutoPopulationDeltaVsBaseline: number | null;
  worstDecileAutoPopulationDeltaVsBaseline: number | null;
  worstAutoPopulationDeltaVsBaseline: number | null;
  bestAutoPopulationDeltaVsBaseline: number | null;
  worstAutoPopulationDeltaCaseName: string | null;
  worstAutoPopulationDeltaSeed: number | null;
  worstAutoPopulationDeltaBudgetSeconds: number | null;
  bestAutoPopulationDeltaCaseName: string | null;
  bestAutoPopulationDeltaSeed: number | null;
  bestAutoPopulationDeltaBudgetSeconds: number | null;
  meanAutoWallClockSeconds: number | null;
  baselineMeanAutoWallClockSeconds: number | null;
  meanAutoWallClockDeltaVsBaselineSeconds: number | null;
  meanAutoPopulationPerCpuBudgetSecond: number | null;
  baselineMeanAutoPopulationPerCpuBudgetSecond: number | null;
  autoCpuBudgetEfficiencyRatioVsBaseline: number | null;
}

export interface CrossModeBenchmarkBudgetAblationPolicyResult {
  policyName: string;
  description: string;
  suite: CrossModeBenchmarkSuiteResult;
  meanBestPopulation: number;
  meanAutoPopulation: number | null;
  meanLnsPopulation: number | null;
  meanAutoDeltaToBest: number | null;
  meanAutoLnsStageElapsedSeconds: number | null;
  meanAutoCpSatStageElapsedSeconds: number | null;
  deltaVsBaselineMeanBestPopulation: number | null;
  deltaVsBaselineMeanAutoPopulation: number | null;
  deltaVsBaselineMeanLnsPopulation: number | null;
  autoSafetySummary: CrossModeBenchmarkBudgetAblationAutoSafetySummary;
  autoReplayDiagnostics: CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic[];
  budgetSummaries: CrossModeBenchmarkBudgetAblationBudgetSummary[];
  recommendationCounts: Record<CrossModeBudgetPolicyRecommendation, number>;
}

export type CrossModeBenchmarkBudgetAblationRankingBasis =
  | "mean-auto-population"
  | "mean-lns-population"
  | "mean-best-population";

export interface CrossModeBenchmarkBudgetAblationSuiteResult {
  generatedAt: string;
  budgetSeconds: number;
  budgetsSeconds: number[];
  seeds: number[];
  caseCount: number;
  selectedCaseNames: string[];
  modes: CrossModeBenchmarkMode[];
  baselinePolicyName: string | null;
  topPolicyName: string | null;
  topPolicyRankingBasis: CrossModeBenchmarkBudgetAblationRankingBasis;
  topPolicyTiedPolicyNames: string[];
  budgetedModeSeconds: number;
  /** Backward-compatible alias for topPolicyName. Prefer topPolicyName plus topPolicyTiedPolicyNames for new code. */
  bestPolicyName: string | null;
  policies: CrossModeBenchmarkBudgetAblationPolicyResult[];
}

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_MODES = Object.freeze([
  "auto",
  "greedy",
  "lns",
  "cp-sat"
] satisfies CrossModeBenchmarkMode[]);

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES = Object.freeze([
  {
    name: "baseline",
    description: "Current Auto/LNS budget policy."
  },
  {
    name: "seed-light",
    description: "Spend a smaller fixed share on LNS seeding and keep repair passes short.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15
  },
  {
    name: "repair-heavy",
    description: "Spend less on seeding and more on LNS repair before exact follow-up.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "cp-sat-reserve-heavy",
    description: "Reserve a larger Auto slice for CP-SAT and keep LNS repairs compact.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15,
    autoCpSatStageReserveRatio: 0.35
  }
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

export const OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES = Object.freeze([
  {
    name: "baseline-repeat",
    description:
      "Repeat the current Auto/LNS budget policy as a named control for short-budget run-to-run variance checks."
  },
  {
    name: "repair-heavy-5s-guarded",
    description:
      "Preserve the baseline short-budget seed posture, then apply repair-heavy LNS allocation only at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1
  }
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

const GREEDY_COVERAGE_CASE_NAMES = Object.freeze([
  "typed-footprint-pressure",
  "deferred-road-packing-gain",
  "service-local-neighborhood"
] satisfies string[]);

const LNS_COVERAGE_CASE_NAMES = Object.freeze(["row0-anchor-repair"] satisfies string[]);

const MODE_LABELS: Record<CrossModeBenchmarkMode, string> = {
  auto: "Auto",
  greedy: "Greedy",
  lns: "LNS",
  "cp-sat": "CP-SAT",
  "cp-sat-portfolio": "CP-SAT portfolio"
};

function inferCoverageProblemSizeBand(benchmarkCase: CrossModeBenchmarkCase): CrossModeProblemSizeBand {
  const cells = benchmarkCase.grid.length * (benchmarkCase.grid[0]?.length ?? 0);
  if (cells <= 16) return "tiny";
  if (cells <= 36) return "small";
  return "medium";
}

function selectCoverageCases(
  corpus: readonly CrossModeBenchmarkCase[],
  names: readonly string[]
): CrossModeBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "cross-mode budget ablation coverage",
    corpusLabel: "Cross-mode budget ablation coverage"
  }).map((benchmarkCase) => {
    return {
      ...benchmarkCase,
      problemSizeBand: benchmarkCase.problemSizeBand ?? inferCoverageProblemSizeBand(benchmarkCase)
    };
  });
}

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  ...DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  ...selectCoverageCases(DEFAULT_GREEDY_BENCHMARK_CORPUS, GREEDY_COVERAGE_CASE_NAMES),
  ...selectCoverageCases(DEFAULT_LNS_BENCHMARK_CORPUS, LNS_COVERAGE_CASE_NAMES)
]);

function normalizeBudgetAblationPolicies(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicy[] | undefined,
  includeOptionalPolicies = false
): CrossModeBenchmarkBudgetAblationPolicy[] {
  const requested = policies?.length
    ? [...policies]
    : [
        ...DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES,
        ...(includeOptionalPolicies ? OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES : [])
      ];
  const seen = new Set<string>();
  const normalized: CrossModeBenchmarkBudgetAblationPolicy[] = [];
  for (const policy of requested) {
    const name = policy.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({ ...policy, name });
  }
  if (normalized.length === 0) {
    throw new Error("Cross-mode budget ablations must include at least one named policy.");
  }
  return normalized;
}

function selectBudgetAblationPolicies(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicy[] | undefined,
  policyNames: readonly string[] | undefined
): CrossModeBenchmarkBudgetAblationPolicy[] {
  const normalized = normalizeBudgetAblationPolicies(
    policies,
    !policies?.length && policyNames !== undefined && policyNames.length > 0
  );
  if (!policyNames?.length) return normalized;

  const byName = new Map(normalized.map((policy) => [policy.name, policy]));
  const missing = policyNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown cross-mode budget ablation policy(s): ${missing.join(", ")}. Available policies: ${normalized.map((policy) => policy.name).join(", ")}.`
    );
  }
  return policyNames.map((name) => byName.get(name) as CrossModeBenchmarkBudgetAblationPolicy);
}

function countRecommendations(
  signals: readonly CrossModeBenchmarkBudgetPolicySignal[]
): Record<CrossModeBudgetPolicyRecommendation, number> {
  const counts: Record<CrossModeBudgetPolicyRecommendation, number> = {
    "keep-auto": 0,
    "add-auto-baseline": 0,
    "shift-auto-budget-to-greedy": 0,
    "shift-auto-budget-to-lns": 0,
    "shift-auto-budget-to-cp-sat": 0,
    "keep-portfolio-experimental": 0,
    "investigate-auto-loss": 0
  };
  for (const signal of signals) {
    counts[signal.recommendation] += 1;
  }
  return counts;
}

function modeResults(
  suite: CrossModeBenchmarkSuiteResult,
  mode: CrossModeBenchmarkMode
): CrossModeBenchmarkModeResult[] {
  return suite.cases
    .map((scorecard) => scorecard.results.find((result) => result.mode === mode) ?? null)
    .filter((result): result is CrossModeBenchmarkModeResult => result !== null);
}

function meanBestPopulationByBudget(suite: CrossModeBenchmarkSuiteResult): Map<number, number> {
  const byBudget = new Map<number, number>();
  const scorecardBuckets = scorecardsByBudget(suite);
  for (const budgetSeconds of suite.budgetsSeconds) {
    const scorecards = scorecardBuckets.get(budgetSeconds) ?? [];
    byBudget.set(budgetSeconds, meanNullableBenchmarkValue(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0);
  }
  return byBudget;
}

function meanModePopulationByBudget(
  suite: CrossModeBenchmarkSuiteResult,
  mode: CrossModeBenchmarkMode
): Map<number, number | null> {
  const byBudget = new Map<number, number | null>();
  const scorecardBuckets = scorecardsByBudget(suite);
  for (const budgetSeconds of suite.budgetsSeconds) {
    const scorecards = scorecardBuckets.get(budgetSeconds) ?? [];
    byBudget.set(
      budgetSeconds,
      meanNullableBenchmarkValue(modeResultsInScorecards(scorecards, mode).map((result) => result.totalPopulation))
    );
  }
  return byBudget;
}

function deltaFromBaseline(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

function autoComparisonKey(scorecard: CrossModeBenchmarkCaseScorecard): string {
  return `${scorecard.name}\u0000${scorecard.budgetSeconds}\u0000${scorecard.seed}`;
}

function autoResult(scorecard: CrossModeBenchmarkCaseScorecard): CrossModeBenchmarkModeResult | null {
  return scorecard.results.find((result) => result.mode === "auto") ?? null;
}

function autoResultsByScorecardKey(
  scorecards: readonly CrossModeBenchmarkCaseScorecard[]
): Map<string, CrossModeBenchmarkModeResult> {
  const byKey = new Map<string, CrossModeBenchmarkModeResult>();
  for (const scorecard of scorecards) {
    const result = autoResult(scorecard);
    if (result !== null) byKey.set(autoComparisonKey(scorecard), result);
  }
  return byKey;
}

function ratioFromMeans(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null || baseline <= 0 ? null : value / baseline;
}

function emptyAutoSafetySummary(): CrossModeBenchmarkBudgetAblationAutoSafetySummary {
  return {
    comparisonCount: 0,
    improvedAutoCount: 0,
    regressedAutoCount: 0,
    unchangedAutoCount: 0,
    regressionRate: 0,
    meanAutoPopulationDeltaVsBaseline: null,
    medianAutoPopulationDeltaVsBaseline: null,
    worstDecileAutoPopulationDeltaVsBaseline: null,
    worstAutoPopulationDeltaVsBaseline: null,
    bestAutoPopulationDeltaVsBaseline: null,
    worstAutoPopulationDeltaCaseName: null,
    worstAutoPopulationDeltaSeed: null,
    worstAutoPopulationDeltaBudgetSeconds: null,
    bestAutoPopulationDeltaCaseName: null,
    bestAutoPopulationDeltaSeed: null,
    bestAutoPopulationDeltaBudgetSeconds: null,
    meanAutoWallClockSeconds: null,
    baselineMeanAutoWallClockSeconds: null,
    meanAutoWallClockDeltaVsBaselineSeconds: null,
    meanAutoPopulationPerCpuBudgetSecond: null,
    baselineMeanAutoPopulationPerCpuBudgetSecond: null,
    autoCpuBudgetEfficiencyRatioVsBaseline: null
  };
}

function summarizeAutoSafety(
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>
): CrossModeBenchmarkBudgetAblationAutoSafetySummary {
  const comparisons = scorecards
    .map((scorecard) => {
      const candidate = autoResult(scorecard);
      const baseline = baselineAutoByKey.get(autoComparisonKey(scorecard)) ?? null;
      return candidate === null || baseline === null ? null : { scorecard, candidate, baseline };
    })
    .filter(
      (
        comparison
      ): comparison is {
        scorecard: CrossModeBenchmarkCaseScorecard;
        candidate: CrossModeBenchmarkModeResult;
        baseline: CrossModeBenchmarkModeResult;
      } => comparison !== null
    );
  if (comparisons.length === 0) return emptyAutoSafetySummary();

  const populationDeltas = comparisons.map(
    ({ candidate, baseline }) => candidate.totalPopulation - baseline.totalPopulation
  );
  const improvedAutoCount = countBenchmarkMatches(populationDeltas, (delta) => delta > 0);
  const regressedAutoCount = countBenchmarkMatches(populationDeltas, (delta) => delta < 0);
  const unchangedAutoCount = countBenchmarkMatches(populationDeltas, (delta) => delta === 0);
  const worst = comparisons.reduce<(typeof comparisons)[number] | null>((currentWorst, comparison) => {
    if (currentWorst === null) return comparison;
    const currentDelta = comparison.candidate.totalPopulation - comparison.baseline.totalPopulation;
    const worstDelta = currentWorst.candidate.totalPopulation - currentWorst.baseline.totalPopulation;
    return currentDelta < worstDelta ? comparison : currentWorst;
  }, null);
  const best = comparisons.reduce<(typeof comparisons)[number] | null>((currentBest, comparison) => {
    if (currentBest === null) return comparison;
    const currentDelta = comparison.candidate.totalPopulation - comparison.baseline.totalPopulation;
    const bestDelta = currentBest.candidate.totalPopulation - currentBest.baseline.totalPopulation;
    return currentDelta > bestDelta ? comparison : currentBest;
  }, null);
  const meanAutoPopulationPerCpuBudgetSecond = meanNullableBenchmarkValue(
    comparisons.map(({ candidate }) => candidate.populationPerWorkerCpuBudgetSecond)
  );
  const baselineMeanAutoPopulationPerCpuBudgetSecond = meanNullableBenchmarkValue(
    comparisons.map(({ baseline }) => baseline.populationPerWorkerCpuBudgetSecond)
  );

  return {
    comparisonCount: comparisons.length,
    improvedAutoCount,
    regressedAutoCount,
    unchangedAutoCount,
    regressionRate: benchmarkRatio(regressedAutoCount, comparisons.length),
    meanAutoPopulationDeltaVsBaseline: meanBenchmarkValue(populationDeltas),
    medianAutoPopulationDeltaVsBaseline: percentileBenchmarkValue(populationDeltas, 0.5),
    worstDecileAutoPopulationDeltaVsBaseline: percentileBenchmarkValue(populationDeltas, 0.1),
    worstAutoPopulationDeltaVsBaseline: Math.min(...populationDeltas),
    bestAutoPopulationDeltaVsBaseline: Math.max(...populationDeltas),
    worstAutoPopulationDeltaCaseName: worst?.scorecard.name ?? null,
    worstAutoPopulationDeltaSeed: worst?.scorecard.seed ?? null,
    worstAutoPopulationDeltaBudgetSeconds: worst?.scorecard.budgetSeconds ?? null,
    bestAutoPopulationDeltaCaseName: best?.scorecard.name ?? null,
    bestAutoPopulationDeltaSeed: best?.scorecard.seed ?? null,
    bestAutoPopulationDeltaBudgetSeconds: best?.scorecard.budgetSeconds ?? null,
    meanAutoWallClockSeconds: meanBenchmarkValue(comparisons.map(({ candidate }) => candidate.wallClockSeconds)),
    baselineMeanAutoWallClockSeconds: meanBenchmarkValue(comparisons.map(({ baseline }) => baseline.wallClockSeconds)),
    meanAutoWallClockDeltaVsBaselineSeconds: meanBenchmarkValue(
      comparisons.map(({ candidate, baseline }) => candidate.wallClockSeconds - baseline.wallClockSeconds)
    ),
    meanAutoPopulationPerCpuBudgetSecond,
    baselineMeanAutoPopulationPerCpuBudgetSecond,
    autoCpuBudgetEfficiencyRatioVsBaseline: ratioFromMeans(
      meanAutoPopulationPerCpuBudgetSecond,
      baselineMeanAutoPopulationPerCpuBudgetSecond
    )
  };
}

function summarizeBudget(
  budgetSeconds: number,
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  signals: readonly CrossModeBenchmarkBudgetPolicySignal[],
  baselineMeanBestPopulation: number | null,
  baselineMeanAutoPopulation: number | null,
  baselineMeanLnsPopulation: number | null,
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>
): CrossModeBenchmarkBudgetAblationBudgetSummary {
  const autoResults = modeResultsInScorecards(scorecards, "auto");
  const lnsResults = modeResultsInScorecards(scorecards, "lns");
  const meanBestPopulation = meanNullableBenchmarkValue(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0;
  const meanAutoPopulation = meanNullableBenchmarkValue(autoResults.map((result) => result.totalPopulation));
  const meanLnsPopulation = meanNullableBenchmarkValue(lnsResults.map((result) => result.totalPopulation));
  return {
    budgetSeconds,
    caseCount: scorecards.length,
    meanBestPopulation,
    meanAutoPopulation,
    meanLnsPopulation,
    meanAutoDeltaToBest: meanNullableBenchmarkValue(signals.map((signal) => signal.autoDeltaToBest)),
    deltaVsBaselineMeanBestPopulation:
      baselineMeanBestPopulation === null ? null : meanBestPopulation - baselineMeanBestPopulation,
    deltaVsBaselineMeanAutoPopulation: deltaFromBaseline(meanAutoPopulation, baselineMeanAutoPopulation),
    deltaVsBaselineMeanLnsPopulation: deltaFromBaseline(meanLnsPopulation, baselineMeanLnsPopulation),
    autoSafetySummary: summarizeAutoSafety(scorecards, baselineAutoByKey),
    recommendationCounts: countRecommendations(signals)
  };
}

function scorecardsByBudget(suite: CrossModeBenchmarkSuiteResult): Map<number, CrossModeBenchmarkCaseScorecard[]> {
  return groupBenchmarkValuesBy(suite.cases, (scorecard) => scorecard.budgetSeconds);
}

function signalsByBudget(suite: CrossModeBenchmarkSuiteResult): Map<number, CrossModeBenchmarkBudgetPolicySignal[]> {
  return groupBenchmarkValuesBy(suite.budgetPolicySignals, (signal) => signal.budgetSeconds);
}

function modeResultsInScorecards(
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  mode: CrossModeBenchmarkMode
): CrossModeBenchmarkModeResult[] {
  return scorecards
    .map((scorecard) => scorecard.results.find((result) => result.mode === mode) ?? null)
    .filter((result): result is CrossModeBenchmarkModeResult => result !== null);
}

function summarizeBudgets(
  suite: CrossModeBenchmarkSuiteResult,
  baselineMeanBestPopulationByBudget: ReadonlyMap<number, number>,
  baselineMeanAutoPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineMeanLnsPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>
): CrossModeBenchmarkBudgetAblationBudgetSummary[] {
  const scorecardBuckets = scorecardsByBudget(suite);
  const signalBuckets = signalsByBudget(suite);
  return suite.budgetsSeconds.map((budgetSeconds) =>
    summarizeBudget(
      budgetSeconds,
      scorecardBuckets.get(budgetSeconds) ?? [],
      signalBuckets.get(budgetSeconds) ?? [],
      baselineMeanBestPopulationByBudget.get(budgetSeconds) ?? null,
      baselineMeanAutoPopulationByBudget.get(budgetSeconds) ?? null,
      baselineMeanLnsPopulationByBudget.get(budgetSeconds) ?? null,
      baselineAutoByKey
    )
  );
}

function summarizeBudgetAblationPolicy(
  policy: CrossModeBenchmarkBudgetAblationPolicy,
  suite: CrossModeBenchmarkSuiteResult,
  baselineMeanBestPopulation: number | null,
  baselineMeanAutoPopulation: number | null,
  baselineMeanLnsPopulation: number | null,
  baselineMeanBestPopulationByBudget: ReadonlyMap<number, number>,
  baselineMeanAutoPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineMeanLnsPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>,
  baselinePolicyName: string | null
): CrossModeBenchmarkBudgetAblationPolicyResult {
  const autoResults = modeResults(suite, "auto");
  const lnsResults = modeResults(suite, "lns");
  const meanBestPopulation = meanNullableBenchmarkValue(suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0;
  const meanAutoPopulation = meanNullableBenchmarkValue(autoResults.map((result) => result.totalPopulation));
  const meanLnsPopulation = meanNullableBenchmarkValue(lnsResults.map((result) => result.totalPopulation));
  return {
    policyName: policy.name,
    description: policy.description,
    suite,
    meanBestPopulation,
    meanAutoPopulation,
    meanLnsPopulation,
    meanAutoDeltaToBest: meanNullableBenchmarkValue(suite.budgetPolicySignals.map((signal) => signal.autoDeltaToBest)),
    meanAutoLnsStageElapsedSeconds: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoLnsStageElapsedSeconds)
    ),
    meanAutoCpSatStageElapsedSeconds: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoCpSatStageElapsedSeconds)
    ),
    deltaVsBaselineMeanBestPopulation:
      baselineMeanBestPopulation === null ? null : meanBestPopulation - baselineMeanBestPopulation,
    deltaVsBaselineMeanAutoPopulation: deltaFromBaseline(meanAutoPopulation, baselineMeanAutoPopulation),
    deltaVsBaselineMeanLnsPopulation: deltaFromBaseline(meanLnsPopulation, baselineMeanLnsPopulation),
    autoSafetySummary: summarizeAutoSafety(suite.cases, baselineAutoByKey),
    autoReplayDiagnostics: buildCrossModeBudgetAblationAutoReplayDiagnostics(
      policy.name,
      baselineAutoByKey.size > 0 ? baselinePolicyName : null,
      suite.cases,
      baselineAutoByKey
    ),
    budgetSummaries: summarizeBudgets(
      suite,
      baselineMeanBestPopulationByBudget,
      baselineMeanAutoPopulationByBudget,
      baselineMeanLnsPopulationByBudget,
      baselineAutoByKey
    ),
    recommendationCounts: countRecommendations(suite.budgetPolicySignals)
  };
}

function budgetAblationRankingBasis(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicyResult[]
): CrossModeBenchmarkBudgetAblationRankingBasis {
  if (policies.some((policy) => policy.meanAutoPopulation !== null)) return "mean-auto-population";
  if (policies.some((policy) => policy.meanLnsPopulation !== null)) return "mean-lns-population";
  return "mean-best-population";
}

function budgetAblationRankingScore(
  policy: CrossModeBenchmarkBudgetAblationPolicyResult,
  basis: CrossModeBenchmarkBudgetAblationRankingBasis
): number {
  if (basis === "mean-auto-population") return policy.meanAutoPopulation ?? Number.NEGATIVE_INFINITY;
  if (basis === "mean-lns-population") return policy.meanLnsPopulation ?? Number.NEGATIVE_INFINITY;
  return policy.meanBestPopulation;
}

function compareBudgetAblationPolicyResults(
  left: CrossModeBenchmarkBudgetAblationPolicyResult,
  right: CrossModeBenchmarkBudgetAblationPolicyResult,
  basis: CrossModeBenchmarkBudgetAblationRankingBasis,
  baselinePolicyName: string | null
): number {
  const scoreDelta = budgetAblationRankingScore(right, basis) - budgetAblationRankingScore(left, basis);
  if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
  if (left.policyName === baselinePolicyName && right.policyName !== baselinePolicyName) return -1;
  if (right.policyName === baselinePolicyName && left.policyName !== baselinePolicyName) return 1;
  return left.policyName.localeCompare(right.policyName);
}

function topPolicyTiedNames(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicyResult[],
  basis: CrossModeBenchmarkBudgetAblationRankingBasis,
  topPolicy: CrossModeBenchmarkBudgetAblationPolicyResult | null
): string[] {
  if (!topPolicy) return [];
  const topScore = budgetAblationRankingScore(topPolicy, basis);
  return policies
    .filter((policy) => Math.abs(budgetAblationRankingScore(policy, basis) - topScore) <= 1e-9)
    .map((policy) => policy.policyName);
}

function countBudgetedModeSecondsInSuite(suite: CrossModeBenchmarkSuiteResult): number {
  return sumBenchmarkBy(suite.cases, (scorecard) =>
    sumBenchmarkBy(scorecard.results, (modeResult) => modeResult.budgetSeconds)
  );
}

function countBudgetedModeSecondsInPolicies(policies: readonly CrossModeBenchmarkBudgetAblationPolicyResult[]): number {
  return sumBenchmarkBy(policies, (policy) => countBudgetedModeSecondsInSuite(policy.suite));
}

function resolveBaselinePolicyName(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicy[],
  requestedBaselinePolicyName: string | undefined
): string | null {
  if (policies.length === 0) return null;
  const normalizedRequestedName = requestedBaselinePolicyName?.trim();
  if (normalizedRequestedName) {
    if (!policies.some((policy) => policy.name === normalizedRequestedName)) {
      throw new Error(`Cross-mode budget ablation baseline policy not found: ${normalizedRequestedName}.`);
    }
    return normalizedRequestedName;
  }
  return policies.some((policy) => policy.name === "baseline") ? "baseline" : policies[0].name;
}

export async function runCrossModeBenchmarkBudgetAblations(
  corpus: readonly CrossModeBenchmarkCase[] = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  options: CrossModeBenchmarkBudgetAblationRunOptions = {}
): Promise<CrossModeBenchmarkBudgetAblationSuiteResult> {
  const policies = selectBudgetAblationPolicies(options.policies, options.policyNames);
  const {
    policies: _policies,
    policyNames: _policyNames,
    budgetAblationPolicy: _budgetAblationPolicy,
    baselinePolicyName,
    ...suiteOptions
  } = options;
  const modes = suiteOptions.modes ?? [...DEFAULT_CROSS_MODE_BUDGET_ABLATION_MODES];
  const resolvedBaselinePolicyName = resolveBaselinePolicyName(policies, baselinePolicyName);
  const policySuites: Array<{ policy: CrossModeBenchmarkBudgetAblationPolicy; suite: CrossModeBenchmarkSuiteResult }> =
    [];

  for (const policy of policies) {
    const suite = await runCrossModeBenchmarkSuite(corpus, {
      ...suiteOptions,
      modes,
      budgetAblationPolicy: policy
    });
    policySuites.push({ policy, suite });
  }

  const baseline = policySuites.find((entry) => entry.policy.name === resolvedBaselinePolicyName) ?? null;
  const baselineMeanBestPopulation = baseline
    ? (meanNullableBenchmarkValue(baseline.suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0)
    : null;
  const baselineMeanAutoPopulation = baseline
    ? meanNullableBenchmarkValue(modeResults(baseline.suite, "auto").map((result) => result.totalPopulation))
    : null;
  const baselineMeanLnsPopulation = baseline
    ? meanNullableBenchmarkValue(modeResults(baseline.suite, "lns").map((result) => result.totalPopulation))
    : null;
  const baselineMeanBestPopulationByBudget = baseline
    ? meanBestPopulationByBudget(baseline.suite)
    : new Map<number, number>();
  const baselineMeanAutoPopulationByBudget = baseline
    ? meanModePopulationByBudget(baseline.suite, "auto")
    : new Map<number, number | null>();
  const baselineMeanLnsPopulationByBudget = baseline
    ? meanModePopulationByBudget(baseline.suite, "lns")
    : new Map<number, number | null>();
  const baselineAutoByKey = baseline ? autoResultsByScorecardKey(baseline.suite.cases) : new Map();
  const policyResults = policySuites.map(({ policy, suite }) =>
    summarizeBudgetAblationPolicy(
      policy,
      suite,
      baselineMeanBestPopulation,
      baselineMeanAutoPopulation,
      baselineMeanLnsPopulation,
      baselineMeanBestPopulationByBudget,
      baselineMeanAutoPopulationByBudget,
      baselineMeanLnsPopulationByBudget,
      baselineAutoByKey,
      baseline?.policy.name ?? null
    )
  );

  const firstSuite = policyResults[0]?.suite;
  const topPolicyRankingBasis = budgetAblationRankingBasis(policyResults);
  const topPolicy =
    [...policyResults].sort((left, right) =>
      compareBudgetAblationPolicyResults(left, right, topPolicyRankingBasis, baseline?.policy.name ?? null)
    )[0] ?? null;
  const topPolicyName = topPolicy?.policyName ?? null;
  return {
    generatedAt: benchmarkGeneratedAt(),
    budgetSeconds: firstSuite?.budgetSeconds ?? DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
    budgetsSeconds: firstSuite?.budgetsSeconds ?? [],
    seeds: firstSuite?.seeds ?? [],
    caseCount: firstSuite?.caseCount ?? 0,
    selectedCaseNames: firstSuite?.selectedCaseNames ?? [],
    modes,
    baselinePolicyName: baseline?.policy.name ?? null,
    topPolicyName,
    topPolicyRankingBasis,
    topPolicyTiedPolicyNames: topPolicyTiedNames(policyResults, topPolicyRankingBasis, topPolicy),
    budgetedModeSeconds: countBudgetedModeSecondsInPolicies(policyResults),
    bestPolicyName: topPolicyName,
    policies: policyResults
  };
}

export function collectCrossModeBenchmarkBudgetAblationDecisionTraceEvents(
  result: CrossModeBenchmarkBudgetAblationSuiteResult
): SolverDecisionTraceEvent[] {
  return result.policies.flatMap((policy) => collectCrossModeBenchmarkDecisionTraceEvents(policy.suite));
}

export function formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(
  result: CrossModeBenchmarkBudgetAblationSuiteResult
): string {
  return serializeDecisionTraceJsonl(collectCrossModeBenchmarkBudgetAblationDecisionTraceEvents(result));
}

function formatRecommendationCounts(counts: Record<CrossModeBudgetPolicyRecommendation, number>): string {
  const populated = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([recommendation, count]) => `${recommendation}:${count}`);
  return populated.length ? populated.join(",") : "none";
}

function countScorecards(result: CrossModeBenchmarkBudgetAblationSuiteResult): number {
  return sumBenchmarkBy(result.policies, (policy) => policy.suite.cases.length);
}

function countModeRuns(result: CrossModeBenchmarkBudgetAblationSuiteResult): number {
  return sumBenchmarkBy(result.policies, (policy) =>
    sumBenchmarkBy(policy.suite.cases, (scorecard) => scorecard.results.length)
  );
}

function formatRankingBasis(basis: CrossModeBenchmarkBudgetAblationRankingBasis): string {
  if (basis === "mean-auto-population") return "Auto mean population";
  if (basis === "mean-lns-population") return "LNS mean population";
  return "best mean population";
}

function formatRate(value: number): string {
  return value.toFixed(3);
}

function formatNullableRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function formatSignedSeconds(value: number | null): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}s`;
}

function formatAutoSafetySummary(summary: CrossModeBenchmarkBudgetAblationAutoSafetySummary): string {
  return [
    `paired=${summary.comparisonCount}`,
    `delta-mean=${formatScoreDeltaVsAuto(summary.meanAutoPopulationDeltaVsBaseline)}`,
    `delta-median=${formatScoreDeltaVsAuto(summary.medianAutoPopulationDeltaVsBaseline)}`,
    `delta-worst-decile=${formatScoreDeltaVsAuto(summary.worstDecileAutoPopulationDeltaVsBaseline)}`,
    `delta-worst=${formatScoreDeltaVsAuto(summary.worstAutoPopulationDeltaVsBaseline)}`,
    `regressed=${summary.regressedAutoCount}`,
    `regression-rate=${formatRate(summary.regressionRate)}`,
    `cpu-eff-ratio=${formatNullableRatio(summary.autoCpuBudgetEfficiencyRatioVsBaseline)}`,
    `wall-delta-mean=${formatSignedSeconds(summary.meanAutoWallClockDeltaVsBaselineSeconds)}`
  ].join(" ");
}

export function formatCrossModeBenchmarkBudgetAblations(result: CrossModeBenchmarkBudgetAblationSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Cross-Mode Budget Ablations ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Modes: ${result.modes.map((mode) => MODE_LABELS[mode]).join(", ")}`);
  lines.push(`Equal wall-clock budgets: ${result.budgetsSeconds.join(", ")}s per mode`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(
    `Coverage: policies=${result.policies.length} scorecards=${countScorecards(result)} mode-runs=${countModeRuns(result)} budgeted-mode-seconds=${result.budgetedModeSeconds}`
  );
  lines.push(`Baseline policy: ${result.baselinePolicyName ?? "n/a"}`);
  lines.push(
    `Top policy by ${formatRankingBasis(result.topPolicyRankingBasis)}: ${result.topPolicyName ?? "n/a"} tied=${result.topPolicyTiedPolicyNames.join(",") || "none"} (ties prefer baseline; inspect budget signals before promotion)`
  );
  lines.push("");

  for (const policy of result.policies) {
    lines.push(`- ${policy.policyName}: ${policy.description}`);
    lines.push(
      `  mean-best=${policy.meanBestPopulation.toFixed(1)} delta-vs-baseline=${formatScoreDeltaVsAuto(policy.deltaVsBaselineMeanBestPopulation)} mean-auto=${policy.meanAutoPopulation === null ? "n/a" : policy.meanAutoPopulation.toFixed(1)} auto-delta-vs-baseline=${formatScoreDeltaVsAuto(policy.deltaVsBaselineMeanAutoPopulation)} mean-lns=${policy.meanLnsPopulation === null ? "n/a" : policy.meanLnsPopulation.toFixed(1)} lns-delta-vs-baseline=${formatScoreDeltaVsAuto(policy.deltaVsBaselineMeanLnsPopulation)} mean-auto-gap=${formatPopulationGap(policy.meanAutoDeltaToBest)}`
    );
    lines.push(
      `  auto-stage-mean=lns:${formatSeconds(policy.meanAutoLnsStageElapsedSeconds)} cp-sat:${formatSeconds(policy.meanAutoCpSatStageElapsedSeconds)} recommendations=${formatRecommendationCounts(policy.recommendationCounts)}`
    );
    lines.push(`  auto-safety=${formatAutoSafetySummary(policy.autoSafetySummary)}`);
    if (policy.autoReplayDiagnostics.length > 0) {
      lines.push(`  auto-replay-diagnostics=${policy.autoReplayDiagnostics.length} nonzero paired Auto rows`);
      for (const diagnostic of policy.autoReplayDiagnostics) {
        lines.push(`    ${formatCrossModeBudgetAblationAutoReplayDiagnostic(diagnostic)}`);
      }
    }
    for (const budget of policy.budgetSummaries) {
      lines.push(
        `  budget=${budget.budgetSeconds}s cases=${budget.caseCount} mean-best=${budget.meanBestPopulation.toFixed(1)} delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanBestPopulation)} mean-auto=${budget.meanAutoPopulation === null ? "n/a" : budget.meanAutoPopulation.toFixed(1)} auto-delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanAutoPopulation)} mean-lns=${budget.meanLnsPopulation === null ? "n/a" : budget.meanLnsPopulation.toFixed(1)} lns-delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanLnsPopulation)} mean-auto-gap=${formatPopulationGap(budget.meanAutoDeltaToBest)} auto-safety=${formatAutoSafetySummary(budget.autoSafetySummary)} recommendations=${formatRecommendationCounts(budget.recommendationCounts)}`
      );
    }
  }

  lines.push("");
  lines.push("Policy scorecards:");
  for (const policy of result.policies) {
    lines.push(`\n## ${policy.policyName}`);
    lines.push(formatCrossModeBenchmarkSuite(policy.suite));
  }

  return lines.join("\n");
}
