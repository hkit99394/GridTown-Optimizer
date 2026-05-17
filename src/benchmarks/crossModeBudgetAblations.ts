import { serializeDecisionTraceJsonl } from "../core/decisionTrace.js";
import {
  benchmarkGeneratedAt,
  formatNullableBenchmarkNumber as formatPopulationGap,
  formatNullableBenchmarkSeconds as formatSeconds,
  formatNullableBenchmarkSignedNumber as formatScoreDeltaVsAuto,
  groupBenchmarkValuesBy,
  meanNullableBenchmarkValue,
  selectBenchmarkCasesByName,
  sumBenchmarkBy,
} from "./benchmarkOptions.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";
import { DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS } from "./productWorkflow.js";
import {
  collectCrossModeBenchmarkDecisionTraceEvents,
  DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
  DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  formatCrossModeBenchmarkSuite,
  runCrossModeBenchmarkSuite,
} from "./crossMode.js";

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
  CrossModeBudgetPolicyRecommendation,
} from "./crossMode.js";
import type { SolverDecisionTraceEvent } from "../core/types.js";

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
  meanAutoGreedySeedElapsedSeconds: number | null;
  meanAutoBestScoreSeconds: number | null;
  meanAutoWallClockSeconds: number | null;
  meanAutoWorkerCpuBudgetSeconds: number | null;
  meanAutoPopulationPerWorkerCpuBudgetSecond: number | null;
  deltaVsBaselineMeanBestPopulation: number | null;
  deltaVsBaselineMeanAutoPopulation: number | null;
  deltaVsBaselineMeanLnsPopulation: number | null;
  deltaVsBaselineMeanAutoBestScoreSeconds: number | null;
  deltaVsBaselineMeanAutoWallClockSeconds: number | null;
  deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds: number | null;
  deltaVsBaselineMeanAutoPopulationPerWorkerCpuBudgetSecond: number | null;
  recommendationCounts: Record<CrossModeBudgetPolicyRecommendation, number>;
}

export interface CrossModeBenchmarkBudgetAblationPolicyResult {
  policyName: string;
  description: string;
  suite: CrossModeBenchmarkSuiteResult;
  meanBestPopulation: number;
  meanAutoPopulation: number | null;
  meanLnsPopulation: number | null;
  meanAutoDeltaToBest: number | null;
  meanAutoGreedySeedElapsedSeconds: number | null;
  meanAutoLnsStageElapsedSeconds: number | null;
  meanAutoCpSatStageElapsedSeconds: number | null;
  meanAutoBestScoreSeconds: number | null;
  meanAutoWallClockSeconds: number | null;
  meanAutoWorkerCpuBudgetSeconds: number | null;
  meanAutoPopulationPerWorkerCpuBudgetSecond: number | null;
  deltaVsBaselineMeanBestPopulation: number | null;
  deltaVsBaselineMeanAutoPopulation: number | null;
  deltaVsBaselineMeanLnsPopulation: number | null;
  deltaVsBaselineMeanAutoBestScoreSeconds: number | null;
  deltaVsBaselineMeanAutoWallClockSeconds: number | null;
  deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds: number | null;
  deltaVsBaselineMeanAutoPopulationPerWorkerCpuBudgetSecond: number | null;
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
  "cp-sat",
] satisfies CrossModeBenchmarkMode[]);

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES = Object.freeze([
  {
    name: "baseline",
    description: "Current Auto/LNS budget policy.",
  },
  {
    name: "seed-light",
    description: "Spend a smaller fixed share on LNS seeding and keep repair passes short.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15,
  },
  {
    name: "repair-heavy",
    description: "Spend less on seeding and more on LNS repair before exact follow-up.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1,
  },
  {
    name: "phase5-retuned",
    description: "Selected Phase 5 policy: cap Auto seed time, shift budget to LNS repair, and keep CP-SAT reserve lean.",
    autoGreedySeedBudgetRatio: 0.15,
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1,
  },
  {
    name: "phase5-fast-exact",
    description: "Phase 5 candidate: run a short LNS improvement pass, then reserve most of the Auto window for CP-SAT polish.",
    autoGreedySeedBudgetRatio: 0.15,
    lnsSeedBudgetRatio: 0.02,
    lnsRepairBudgetRatio: 0.05,
    lnsEscalatedRepairBudgetRatio: 0.08,
    lnsNoImprovementTimeoutRatio: 0.12,
    autoCpSatStageReserveRatio: 0.8,
    autoCpSatStageTimeLimitRatio: 0.8,
    autoCpSatStageNoImprovementTimeoutRatio: 0.8,
  },
  {
    name: "cp-sat-reserve-heavy",
    description: "Reserve a larger Auto slice for CP-SAT and keep LNS repairs compact.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15,
    autoCpSatStageReserveRatio: 0.35,
  },
  {
    name: "phase5-stale-polish",
    description: "Cap Auto seed time, keep adaptive LNS repairs short-stale, and reserve bounded CP-SAT polish.",
    autoGreedySeedBudgetRatio: 0.15,
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.15,
    lnsEscalatedRepairBudgetRatio: 0.2,
    lnsNoImprovementTimeoutRatio: 0.4,
    autoCpSatStageReserveRatio: 0.25,
    autoCpSatStageTimeLimitRatio: 0.25,
    autoCpSatStageNoImprovementTimeoutRatio: 0.12,
  },
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

const GREEDY_COVERAGE_CASE_NAMES = Object.freeze([
  "typed-footprint-pressure",
  "deferred-road-packing-gain",
  "service-local-neighborhood",
] satisfies string[]);

const LNS_COVERAGE_CASE_NAMES = Object.freeze([
  "row0-anchor-repair",
] satisfies string[]);

const PRODUCT_WORKFLOW_HOLDOUT_CASE_NAMES = Object.freeze([
  "planner-service-overlap",
  "planner-anchor-service",
  "planner-multi-anchor-islands",
  "planner-gate-service-tradeoff",
] satisfies string[]);

const MODE_LABELS: Record<CrossModeBenchmarkMode, string> = {
  auto: "Auto",
  greedy: "Greedy",
  lns: "LNS",
  "cp-sat": "CP-SAT",
  "cp-sat-portfolio": "CP-SAT portfolio",
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
    corpusLabel: "Cross-mode budget ablation coverage",
  }).map((benchmarkCase) => {
    return {
      ...benchmarkCase,
      problemSizeBand: benchmarkCase.problemSizeBand ?? inferCoverageProblemSizeBand(benchmarkCase),
    };
  });
}

function selectProductWorkflowHoldoutCases(names: readonly string[]): CrossModeBenchmarkCase[] {
  const productWorkflowCases = DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS
    .filter((benchmarkCase) => benchmarkCase.split === "holdout")
    .map((benchmarkCase): CrossModeBenchmarkCase => ({
      name: benchmarkCase.name,
      description: benchmarkCase.description,
      problemSizeBand: inferCoverageProblemSizeBand(benchmarkCase),
      grid: benchmarkCase.grid,
      params: benchmarkCase.params,
    }));
  return selectCoverageCases(productWorkflowCases, names);
}

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  ...DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  ...selectCoverageCases(DEFAULT_GREEDY_BENCHMARK_CORPUS, GREEDY_COVERAGE_CASE_NAMES),
  ...selectCoverageCases(DEFAULT_LNS_BENCHMARK_CORPUS, LNS_COVERAGE_CASE_NAMES),
  ...selectProductWorkflowHoldoutCases(PRODUCT_WORKFLOW_HOLDOUT_CASE_NAMES),
]);

function normalizeBudgetAblationPolicies(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicy[] | undefined
): CrossModeBenchmarkBudgetAblationPolicy[] {
  const requested = policies?.length ? [...policies] : [...DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES];
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
  const normalized = normalizeBudgetAblationPolicies(policies);
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
    "investigate-auto-loss": 0,
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
    byBudget.set(
      budgetSeconds,
      meanNullableBenchmarkValue(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0
    );
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
      meanNullableBenchmarkValue(
        modeResultsInScorecards(scorecards, mode).map((result) => result.totalPopulation)
      )
    );
  }
  return byBudget;
}

function timeToBestScoreSeconds(result: CrossModeBenchmarkModeResult): number | null {
  return result.timeToQuality.bestScoreAtMs === null
    ? null
    : result.timeToQuality.bestScoreAtMs / 1000;
}

function meanModeMetricByBudget(
  suite: CrossModeBenchmarkSuiteResult,
  mode: CrossModeBenchmarkMode,
  metric: (result: CrossModeBenchmarkModeResult) => number | null
): Map<number, number | null> {
  const byBudget = new Map<number, number | null>();
  const scorecardBuckets = scorecardsByBudget(suite);
  for (const budgetSeconds of suite.budgetsSeconds) {
    const scorecards = scorecardBuckets.get(budgetSeconds) ?? [];
    byBudget.set(
      budgetSeconds,
      meanNullableBenchmarkValue(modeResultsInScorecards(scorecards, mode).map(metric))
    );
  }
  return byBudget;
}

function deltaFromBaseline(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

function summarizeBudget(
  budgetSeconds: number,
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  signals: readonly CrossModeBenchmarkBudgetPolicySignal[],
  baselineMeanBestPopulation: number | null,
  baselineMeanAutoPopulation: number | null,
  baselineMeanLnsPopulation: number | null,
  baselineMeanAutoBestScoreSeconds: number | null,
  baselineMeanAutoWallClockSeconds: number | null,
  baselineMeanAutoWorkerCpuBudgetSeconds: number | null,
  baselineMeanAutoPopulationPerWorkerCpuBudgetSecond: number | null
): CrossModeBenchmarkBudgetAblationBudgetSummary {
  const autoResults = modeResultsInScorecards(scorecards, "auto");
  const lnsResults = modeResultsInScorecards(scorecards, "lns");
  const meanBestPopulation =
    meanNullableBenchmarkValue(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0;
  const meanAutoPopulation = meanNullableBenchmarkValue(autoResults.map((result) => result.totalPopulation));
  const meanLnsPopulation = meanNullableBenchmarkValue(lnsResults.map((result) => result.totalPopulation));
  const meanAutoBestScoreSeconds = meanNullableBenchmarkValue(autoResults.map(timeToBestScoreSeconds));
  const meanAutoWallClockSeconds = meanNullableBenchmarkValue(autoResults.map((result) => result.wallClockSeconds));
  const meanAutoWorkerCpuBudgetSeconds = meanNullableBenchmarkValue(
    autoResults.map((result) => result.workerCpuBudgetSeconds)
  );
  const meanAutoPopulationPerWorkerCpuBudgetSecond = meanNullableBenchmarkValue(
    autoResults.map((result) => result.populationPerWorkerCpuBudgetSecond)
  );
  return {
    budgetSeconds,
    caseCount: scorecards.length,
    meanBestPopulation,
    meanAutoPopulation,
    meanLnsPopulation,
    meanAutoDeltaToBest: meanNullableBenchmarkValue(signals.map((signal) => signal.autoDeltaToBest)),
    meanAutoGreedySeedElapsedSeconds: meanNullableBenchmarkValue(
      signals.map((signal) => signal.autoGreedySeedElapsedSeconds)
    ),
    meanAutoBestScoreSeconds,
    meanAutoWallClockSeconds,
    meanAutoWorkerCpuBudgetSeconds,
    meanAutoPopulationPerWorkerCpuBudgetSecond,
    deltaVsBaselineMeanBestPopulation: baselineMeanBestPopulation === null
      ? null
      : meanBestPopulation - baselineMeanBestPopulation,
    deltaVsBaselineMeanAutoPopulation: deltaFromBaseline(meanAutoPopulation, baselineMeanAutoPopulation),
    deltaVsBaselineMeanLnsPopulation: deltaFromBaseline(meanLnsPopulation, baselineMeanLnsPopulation),
    deltaVsBaselineMeanAutoBestScoreSeconds: deltaFromBaseline(
      meanAutoBestScoreSeconds,
      baselineMeanAutoBestScoreSeconds
    ),
    deltaVsBaselineMeanAutoWallClockSeconds: deltaFromBaseline(
      meanAutoWallClockSeconds,
      baselineMeanAutoWallClockSeconds
    ),
    deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds: deltaFromBaseline(
      meanAutoWorkerCpuBudgetSeconds,
      baselineMeanAutoWorkerCpuBudgetSeconds
    ),
    deltaVsBaselineMeanAutoPopulationPerWorkerCpuBudgetSecond: deltaFromBaseline(
      meanAutoPopulationPerWorkerCpuBudgetSecond,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecond
    ),
    recommendationCounts: countRecommendations(signals),
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
  baselineMeanAutoBestScoreSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoWallClockSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoWorkerCpuBudgetSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget: ReadonlyMap<number, number | null>
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
      baselineMeanAutoBestScoreSecondsByBudget.get(budgetSeconds) ?? null,
      baselineMeanAutoWallClockSecondsByBudget.get(budgetSeconds) ?? null,
      baselineMeanAutoWorkerCpuBudgetSecondsByBudget.get(budgetSeconds) ?? null,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget.get(budgetSeconds) ?? null
    )
  );
}

function summarizeBudgetAblationPolicy(
  policy: CrossModeBenchmarkBudgetAblationPolicy,
  suite: CrossModeBenchmarkSuiteResult,
  baselineMeanBestPopulation: number | null,
  baselineMeanAutoPopulation: number | null,
  baselineMeanLnsPopulation: number | null,
  baselineMeanAutoBestScoreSeconds: number | null,
  baselineMeanAutoWallClockSeconds: number | null,
  baselineMeanAutoWorkerCpuBudgetSeconds: number | null,
  baselineMeanAutoPopulationPerWorkerCpuBudgetSecond: number | null,
  baselineMeanBestPopulationByBudget: ReadonlyMap<number, number>,
  baselineMeanAutoPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineMeanLnsPopulationByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoBestScoreSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoWallClockSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoWorkerCpuBudgetSecondsByBudget: ReadonlyMap<number, number | null>,
  baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget: ReadonlyMap<number, number | null>
): CrossModeBenchmarkBudgetAblationPolicyResult {
  const autoResults = modeResults(suite, "auto");
  const lnsResults = modeResults(suite, "lns");
  const meanBestPopulation =
    meanNullableBenchmarkValue(suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0;
  const meanAutoPopulation = meanNullableBenchmarkValue(autoResults.map((result) => result.totalPopulation));
  const meanLnsPopulation = meanNullableBenchmarkValue(lnsResults.map((result) => result.totalPopulation));
  const meanAutoBestScoreSeconds = meanNullableBenchmarkValue(autoResults.map(timeToBestScoreSeconds));
  const meanAutoWallClockSeconds = meanNullableBenchmarkValue(autoResults.map((result) => result.wallClockSeconds));
  const meanAutoWorkerCpuBudgetSeconds = meanNullableBenchmarkValue(
    autoResults.map((result) => result.workerCpuBudgetSeconds)
  );
  const meanAutoPopulationPerWorkerCpuBudgetSecond = meanNullableBenchmarkValue(
    autoResults.map((result) => result.populationPerWorkerCpuBudgetSecond)
  );
  return {
    policyName: policy.name,
    description: policy.description,
    suite,
    meanBestPopulation,
    meanAutoPopulation,
    meanLnsPopulation,
    meanAutoDeltaToBest: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoDeltaToBest)
    ),
    meanAutoGreedySeedElapsedSeconds: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoGreedySeedElapsedSeconds)
    ),
    meanAutoLnsStageElapsedSeconds: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoLnsStageElapsedSeconds)
    ),
    meanAutoCpSatStageElapsedSeconds: meanNullableBenchmarkValue(
      suite.budgetPolicySignals.map((signal) => signal.autoCpSatStageElapsedSeconds)
    ),
    meanAutoBestScoreSeconds,
    meanAutoWallClockSeconds,
    meanAutoWorkerCpuBudgetSeconds,
    meanAutoPopulationPerWorkerCpuBudgetSecond,
    deltaVsBaselineMeanBestPopulation: baselineMeanBestPopulation === null
      ? null
      : meanBestPopulation - baselineMeanBestPopulation,
    deltaVsBaselineMeanAutoPopulation: deltaFromBaseline(meanAutoPopulation, baselineMeanAutoPopulation),
    deltaVsBaselineMeanLnsPopulation: deltaFromBaseline(meanLnsPopulation, baselineMeanLnsPopulation),
    deltaVsBaselineMeanAutoBestScoreSeconds: deltaFromBaseline(
      meanAutoBestScoreSeconds,
      baselineMeanAutoBestScoreSeconds
    ),
    deltaVsBaselineMeanAutoWallClockSeconds: deltaFromBaseline(
      meanAutoWallClockSeconds,
      baselineMeanAutoWallClockSeconds
    ),
    deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds: deltaFromBaseline(
      meanAutoWorkerCpuBudgetSeconds,
      baselineMeanAutoWorkerCpuBudgetSeconds
    ),
    deltaVsBaselineMeanAutoPopulationPerWorkerCpuBudgetSecond: deltaFromBaseline(
      meanAutoPopulationPerWorkerCpuBudgetSecond,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecond
    ),
    budgetSummaries: summarizeBudgets(
      suite,
      baselineMeanBestPopulationByBudget,
      baselineMeanAutoPopulationByBudget,
      baselineMeanLnsPopulationByBudget,
      baselineMeanAutoBestScoreSecondsByBudget,
      baselineMeanAutoWallClockSecondsByBudget,
      baselineMeanAutoWorkerCpuBudgetSecondsByBudget,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget
    ),
    recommendationCounts: countRecommendations(suite.budgetPolicySignals),
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
  return sumBenchmarkBy(
    suite.cases,
    (scorecard) => sumBenchmarkBy(scorecard.results, (modeResult) => modeResult.budgetSeconds)
  );
}

function countBudgetedModeSecondsInPolicies(
  policies: readonly CrossModeBenchmarkBudgetAblationPolicyResult[]
): number {
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
  const policySuites: Array<{ policy: CrossModeBenchmarkBudgetAblationPolicy; suite: CrossModeBenchmarkSuiteResult }> = [];

  for (const policy of policies) {
    const suite = await runCrossModeBenchmarkSuite(corpus, {
      ...suiteOptions,
      modes,
      budgetAblationPolicy: policy,
    });
    policySuites.push({ policy, suite });
  }

  const baseline = policySuites.find((entry) => entry.policy.name === resolvedBaselinePolicyName) ?? null;
  const baselineMeanBestPopulation = baseline
    ? meanNullableBenchmarkValue(baseline.suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0
    : null;
  const baselineMeanAutoPopulation = baseline
    ? meanNullableBenchmarkValue(modeResults(baseline.suite, "auto").map((result) => result.totalPopulation))
    : null;
  const baselineMeanLnsPopulation = baseline
    ? meanNullableBenchmarkValue(modeResults(baseline.suite, "lns").map((result) => result.totalPopulation))
    : null;
  const baselineAutoResults = baseline ? modeResults(baseline.suite, "auto") : [];
  const baselineMeanAutoBestScoreSeconds = baseline
    ? meanNullableBenchmarkValue(baselineAutoResults.map(timeToBestScoreSeconds))
    : null;
  const baselineMeanAutoWallClockSeconds = baseline
    ? meanNullableBenchmarkValue(baselineAutoResults.map((result) => result.wallClockSeconds))
    : null;
  const baselineMeanAutoWorkerCpuBudgetSeconds = baseline
    ? meanNullableBenchmarkValue(baselineAutoResults.map((result) => result.workerCpuBudgetSeconds))
    : null;
  const baselineMeanAutoPopulationPerWorkerCpuBudgetSecond = baseline
    ? meanNullableBenchmarkValue(
        baselineAutoResults.map((result) => result.populationPerWorkerCpuBudgetSecond)
      )
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
  const baselineMeanAutoBestScoreSecondsByBudget = baseline
    ? meanModeMetricByBudget(baseline.suite, "auto", timeToBestScoreSeconds)
    : new Map<number, number | null>();
  const baselineMeanAutoWallClockSecondsByBudget = baseline
    ? meanModeMetricByBudget(baseline.suite, "auto", (result) => result.wallClockSeconds)
    : new Map<number, number | null>();
  const baselineMeanAutoWorkerCpuBudgetSecondsByBudget = baseline
    ? meanModeMetricByBudget(baseline.suite, "auto", (result) => result.workerCpuBudgetSeconds)
    : new Map<number, number | null>();
  const baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget = baseline
    ? meanModeMetricByBudget(baseline.suite, "auto", (result) => result.populationPerWorkerCpuBudgetSecond)
    : new Map<number, number | null>();
  const policyResults = policySuites.map(({ policy, suite }) =>
    summarizeBudgetAblationPolicy(
      policy,
      suite,
      baselineMeanBestPopulation,
      baselineMeanAutoPopulation,
      baselineMeanLnsPopulation,
      baselineMeanAutoBestScoreSeconds,
      baselineMeanAutoWallClockSeconds,
      baselineMeanAutoWorkerCpuBudgetSeconds,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecond,
      baselineMeanBestPopulationByBudget,
      baselineMeanAutoPopulationByBudget,
      baselineMeanLnsPopulationByBudget,
      baselineMeanAutoBestScoreSecondsByBudget,
      baselineMeanAutoWallClockSecondsByBudget,
      baselineMeanAutoWorkerCpuBudgetSecondsByBudget,
      baselineMeanAutoPopulationPerWorkerCpuBudgetSecondByBudget
    )
  );

  const firstSuite = policyResults[0]?.suite;
  const topPolicyRankingBasis = budgetAblationRankingBasis(policyResults);
  const topPolicy = [...policyResults].sort((left, right) =>
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
    policies: policyResults,
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
  return sumBenchmarkBy(
    result.policies,
    (policy) => sumBenchmarkBy(policy.suite.cases, (scorecard) => scorecard.results.length)
  );
}

function formatRankingBasis(basis: CrossModeBenchmarkBudgetAblationRankingBasis): string {
  if (basis === "mean-auto-population") return "Auto mean population";
  if (basis === "mean-lns-population") return "LNS mean population";
  return "best mean population";
}

export function formatCrossModeBenchmarkBudgetAblations(
  result: CrossModeBenchmarkBudgetAblationSuiteResult
): string {
  const lines: string[] = [];
  lines.push("=== Cross-Mode Budget Ablations ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Modes: ${result.modes.map((mode) => MODE_LABELS[mode]).join(", ")}`);
  lines.push(`Equal wall-clock budgets: ${result.budgetsSeconds.join(", ")}s per mode`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Coverage: policies=${result.policies.length} scorecards=${countScorecards(result)} mode-runs=${countModeRuns(result)} budgeted-mode-seconds=${result.budgetedModeSeconds}`);
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
      `  auto-stage-mean=greedy-seed:${formatSeconds(policy.meanAutoGreedySeedElapsedSeconds)} lns:${formatSeconds(policy.meanAutoLnsStageElapsedSeconds)} cp-sat:${formatSeconds(policy.meanAutoCpSatStageElapsedSeconds)} best-at:${formatSeconds(policy.meanAutoBestScoreSeconds)} best-at-delta=${formatSeconds(policy.deltaVsBaselineMeanAutoBestScoreSeconds)} wall:${formatSeconds(policy.meanAutoWallClockSeconds)} wall-delta=${formatSeconds(policy.deltaVsBaselineMeanAutoWallClockSeconds)}`
    );
    lines.push(
      `  auto-cpu=budget:${formatSeconds(policy.meanAutoWorkerCpuBudgetSeconds)} budget-delta=${formatSeconds(policy.deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds)} pop/cpu-budget=${policy.meanAutoPopulationPerWorkerCpuBudgetSecond === null ? "n/a" : policy.meanAutoPopulationPerWorkerCpuBudgetSecond.toFixed(3)} pop/cpu-delta=${formatScoreDeltaVsAuto(policy.deltaVsBaselineMeanAutoPopulationPerWorkerCpuBudgetSecond)} recommendations=${formatRecommendationCounts(policy.recommendationCounts)}`
    );
    for (const budget of policy.budgetSummaries) {
      lines.push(
        `  budget=${budget.budgetSeconds}s cases=${budget.caseCount} mean-best=${budget.meanBestPopulation.toFixed(1)} delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanBestPopulation)} mean-auto=${budget.meanAutoPopulation === null ? "n/a" : budget.meanAutoPopulation.toFixed(1)} auto-delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanAutoPopulation)} mean-lns=${budget.meanLnsPopulation === null ? "n/a" : budget.meanLnsPopulation.toFixed(1)} lns-delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanLnsPopulation)} mean-auto-gap=${formatPopulationGap(budget.meanAutoDeltaToBest)} greedy-seed=${formatSeconds(budget.meanAutoGreedySeedElapsedSeconds)} auto-best-at=${formatSeconds(budget.meanAutoBestScoreSeconds)} best-at-delta=${formatSeconds(budget.deltaVsBaselineMeanAutoBestScoreSeconds)} wall=${formatSeconds(budget.meanAutoWallClockSeconds)} wall-delta=${formatSeconds(budget.deltaVsBaselineMeanAutoWallClockSeconds)} cpu-budget=${formatSeconds(budget.meanAutoWorkerCpuBudgetSeconds)} cpu-budget-delta=${formatSeconds(budget.deltaVsBaselineMeanAutoWorkerCpuBudgetSeconds)} pop/cpu-budget=${budget.meanAutoPopulationPerWorkerCpuBudgetSecond === null ? "n/a" : budget.meanAutoPopulationPerWorkerCpuBudgetSecond.toFixed(3)} recommendations=${formatRecommendationCounts(budget.recommendationCounts)}`
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
