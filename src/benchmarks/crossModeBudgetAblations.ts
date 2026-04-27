import { serializeDecisionTraceJsonl } from "../core/decisionTrace.js";
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
  CrossModeBudgetPolicyRecommendation,
} from "./crossMode.js";
import type { SolverDecisionTraceEvent } from "../core/types.js";

export interface CrossModeBenchmarkBudgetAblationRunOptions extends CrossModeBenchmarkRunOptions {
  policies?: readonly CrossModeBenchmarkBudgetAblationPolicy[];
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
  meanAutoLnsStageElapsedSeconds: number | null;
  meanAutoCpSatStageElapsedSeconds: number | null;
  deltaVsBaselineMeanBestPopulation: number | null;
  budgetSummaries: CrossModeBenchmarkBudgetAblationBudgetSummary[];
  recommendationCounts: Record<CrossModeBudgetPolicyRecommendation, number>;
}

export interface CrossModeBenchmarkBudgetAblationSuiteResult {
  generatedAt: string;
  budgetSeconds: number;
  budgetsSeconds: number[];
  seeds: number[];
  caseCount: number;
  selectedCaseNames: string[];
  modes: CrossModeBenchmarkMode[];
  baselinePolicyName: string | null;
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
    name: "cp-sat-reserve-heavy",
    description: "Reserve a larger Auto slice for CP-SAT and keep LNS repairs compact.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15,
    autoCpSatStageReserveRatio: 0.35,
  },
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

const MODE_LABELS: Record<CrossModeBenchmarkMode, string> = {
  auto: "Auto",
  greedy: "Greedy",
  lns: "LNS",
  "cp-sat": "CP-SAT",
  "cp-sat-portfolio": "CP-SAT portfolio",
};

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanOrNull(values: ReadonlyArray<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length ? mean(finiteValues) : null;
}

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
    byBudget.set(budgetSeconds, meanOrNull(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0);
  }
  return byBudget;
}

function summarizeBudget(
  budgetSeconds: number,
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  signals: readonly CrossModeBenchmarkBudgetPolicySignal[],
  baselineMeanBestPopulation: number | null
): CrossModeBenchmarkBudgetAblationBudgetSummary {
  const autoResults = modeResultsInScorecards(scorecards, "auto");
  const lnsResults = modeResultsInScorecards(scorecards, "lns");
  const meanBestPopulation = meanOrNull(scorecards.map((scorecard) => scorecard.bestScore)) ?? 0;
  return {
    budgetSeconds,
    caseCount: scorecards.length,
    meanBestPopulation,
    meanAutoPopulation: meanOrNull(autoResults.map((result) => result.totalPopulation)),
    meanLnsPopulation: meanOrNull(lnsResults.map((result) => result.totalPopulation)),
    meanAutoDeltaToBest: meanOrNull(signals.map((signal) => signal.autoDeltaToBest)),
    deltaVsBaselineMeanBestPopulation: baselineMeanBestPopulation === null
      ? null
      : meanBestPopulation - baselineMeanBestPopulation,
    recommendationCounts: countRecommendations(signals),
  };
}

function scorecardsByBudget(suite: CrossModeBenchmarkSuiteResult): Map<number, CrossModeBenchmarkCaseScorecard[]> {
  const byBudget = new Map<number, CrossModeBenchmarkCaseScorecard[]>();
  for (const scorecard of suite.cases) {
    const scorecards = byBudget.get(scorecard.budgetSeconds) ?? [];
    scorecards.push(scorecard);
    byBudget.set(scorecard.budgetSeconds, scorecards);
  }
  return byBudget;
}

function signalsByBudget(suite: CrossModeBenchmarkSuiteResult): Map<number, CrossModeBenchmarkBudgetPolicySignal[]> {
  const byBudget = new Map<number, CrossModeBenchmarkBudgetPolicySignal[]>();
  for (const signal of suite.budgetPolicySignals) {
    const signals = byBudget.get(signal.budgetSeconds) ?? [];
    signals.push(signal);
    byBudget.set(signal.budgetSeconds, signals);
  }
  return byBudget;
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
  baselineMeanBestPopulationByBudget: ReadonlyMap<number, number>
): CrossModeBenchmarkBudgetAblationBudgetSummary[] {
  const scorecardBuckets = scorecardsByBudget(suite);
  const signalBuckets = signalsByBudget(suite);
  return suite.budgetsSeconds.map((budgetSeconds) =>
    summarizeBudget(
      budgetSeconds,
      scorecardBuckets.get(budgetSeconds) ?? [],
      signalBuckets.get(budgetSeconds) ?? [],
      baselineMeanBestPopulationByBudget.get(budgetSeconds) ?? null
    )
  );
}

function summarizeBudgetAblationPolicy(
  policy: CrossModeBenchmarkBudgetAblationPolicy,
  suite: CrossModeBenchmarkSuiteResult,
  baselineMeanBestPopulation: number | null,
  baselineMeanBestPopulationByBudget: ReadonlyMap<number, number>
): CrossModeBenchmarkBudgetAblationPolicyResult {
  const autoResults = modeResults(suite, "auto");
  const lnsResults = modeResults(suite, "lns");
  const meanBestPopulation = meanOrNull(suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0;
  return {
    policyName: policy.name,
    description: policy.description,
    suite,
    meanBestPopulation,
    meanAutoPopulation: meanOrNull(autoResults.map((result) => result.totalPopulation)),
    meanLnsPopulation: meanOrNull(lnsResults.map((result) => result.totalPopulation)),
    meanAutoDeltaToBest: meanOrNull(suite.budgetPolicySignals.map((signal) => signal.autoDeltaToBest)),
    meanAutoLnsStageElapsedSeconds: meanOrNull(suite.budgetPolicySignals.map((signal) => signal.autoLnsStageElapsedSeconds)),
    meanAutoCpSatStageElapsedSeconds: meanOrNull(suite.budgetPolicySignals.map((signal) => signal.autoCpSatStageElapsedSeconds)),
    deltaVsBaselineMeanBestPopulation: baselineMeanBestPopulation === null
      ? null
      : meanBestPopulation - baselineMeanBestPopulation,
    budgetSummaries: summarizeBudgets(suite, baselineMeanBestPopulationByBudget),
    recommendationCounts: countRecommendations(suite.budgetPolicySignals),
  };
}

function budgetAblationRankingScore(policy: CrossModeBenchmarkBudgetAblationPolicyResult): number {
  return policy.meanAutoPopulation ?? policy.meanBestPopulation;
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
  const policies = normalizeBudgetAblationPolicies(options.policies);
  const {
    policies: _policies,
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
    ? meanOrNull(baseline.suite.cases.map((scorecard) => scorecard.bestScore)) ?? 0
    : null;
  const baselineMeanBestPopulationByBudget = baseline
    ? meanBestPopulationByBudget(baseline.suite)
    : new Map<number, number>();
  const policyResults = policySuites.map(({ policy, suite }) =>
    summarizeBudgetAblationPolicy(policy, suite, baselineMeanBestPopulation, baselineMeanBestPopulationByBudget)
  );

  const firstSuite = policyResults[0]?.suite;
  const bestPolicy = [...policyResults].sort((left, right) =>
    budgetAblationRankingScore(right) - budgetAblationRankingScore(left) || left.policyName.localeCompare(right.policyName)
  )[0] ?? null;
  return {
    generatedAt: new Date().toISOString(),
    budgetSeconds: firstSuite?.budgetSeconds ?? DEFAULT_CROSS_MODE_BENCHMARK_BUDGET_SECONDS,
    budgetsSeconds: firstSuite?.budgetsSeconds ?? [],
    seeds: firstSuite?.seeds ?? [],
    caseCount: firstSuite?.caseCount ?? 0,
    selectedCaseNames: firstSuite?.selectedCaseNames ?? [],
    modes,
    baselinePolicyName: baseline?.policy.name ?? null,
    bestPolicyName: bestPolicy?.policyName ?? null,
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

function formatScoreDeltaVsAuto(value: number | null): string {
  if (value === null) return "n/a";
  if (value > 0) return `+${Number(value).toLocaleString()}`;
  return Number(value).toLocaleString();
}

function formatPopulationGap(value: number | null): string {
  return value === null ? "n/a" : Number(value).toLocaleString();
}

function formatSeconds(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(3)}s` : "n/a";
}

function formatRecommendationCounts(counts: Record<CrossModeBudgetPolicyRecommendation, number>): string {
  const populated = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([recommendation, count]) => `${recommendation}:${count}`);
  return populated.length ? populated.join(",") : "none";
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
  lines.push(`Baseline policy: ${result.baselinePolicyName ?? "n/a"}`);
  lines.push(`Best policy by Auto mean population when present: ${result.bestPolicyName ?? "n/a"}`);
  lines.push("");

  for (const policy of result.policies) {
    lines.push(`- ${policy.policyName}: ${policy.description}`);
    lines.push(
      `  mean-best=${policy.meanBestPopulation.toFixed(1)} delta-vs-baseline=${formatScoreDeltaVsAuto(policy.deltaVsBaselineMeanBestPopulation)} mean-auto=${policy.meanAutoPopulation === null ? "n/a" : policy.meanAutoPopulation.toFixed(1)} mean-lns=${policy.meanLnsPopulation === null ? "n/a" : policy.meanLnsPopulation.toFixed(1)} mean-auto-gap=${formatPopulationGap(policy.meanAutoDeltaToBest)}`
    );
    lines.push(
      `  auto-stage-mean=lns:${formatSeconds(policy.meanAutoLnsStageElapsedSeconds)} cp-sat:${formatSeconds(policy.meanAutoCpSatStageElapsedSeconds)} recommendations=${formatRecommendationCounts(policy.recommendationCounts)}`
    );
    for (const budget of policy.budgetSummaries) {
      lines.push(
        `  budget=${budget.budgetSeconds}s cases=${budget.caseCount} mean-best=${budget.meanBestPopulation.toFixed(1)} delta-vs-baseline=${formatScoreDeltaVsAuto(budget.deltaVsBaselineMeanBestPopulation)} mean-auto=${budget.meanAutoPopulation === null ? "n/a" : budget.meanAutoPopulation.toFixed(1)} mean-lns=${budget.meanLnsPopulation === null ? "n/a" : budget.meanLnsPopulation.toFixed(1)} mean-auto-gap=${formatPopulationGap(budget.meanAutoDeltaToBest)} recommendations=${formatRecommendationCounts(budget.recommendationCounts)}`
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
