import { cloneBenchmarkGrid, cloneBenchmarkSolverParams } from "./benchmarkOptions.js";
import {
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS,
  PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT,
  PRODUCT_WORKFLOW_PROMOTION_MODES,
  PRODUCT_WORKFLOW_PROMOTION_SEEDS
} from "./crossModeProductWorkflowCorpus.js";
import { compareModeResults } from "./crossModeResultOrder.js";
import { materializeValidLnsSeedSolution } from "../core/index.js";
import { buildManualLayoutResponse } from "../../apps/planner-server/http/solutionResponse.js";

import type { CpSatWarmStartHint, Solution } from "../core/index.js";
import type {
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkCase,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSplit,
  CrossModeBenchmarkSuiteResult,
  CrossModeWorkflowTag
} from "./crossMode.js";

export {
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS,
  PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT,
  PRODUCT_WORKFLOW_PROMOTION_MODES,
  PRODUCT_WORKFLOW_PROMOTION_SEEDS
} from "./crossModeProductWorkflowCorpus.js";

export interface CrossModeProductWorkflowRegistryEntryDraftOptions {
  runId?: string;
  commands: readonly string[];
  artifactPaths: readonly string[];
  decision?: string;
  summary?: string;
}

export interface CrossModeProductWorkflowReplayTelemetryManifestOptions {
  command: string;
  git?: {
    commit: string;
    branch: string;
  };
  hardware?: Record<string, unknown>;
  corpus?: readonly CrossModeBenchmarkCase[];
}

export interface CrossModeProductWorkflowCaseMetric {
  caseName: string;
  split: CrossModeBenchmarkSplit;
  workflowTags: CrossModeWorkflowTag[];
  budgetSeconds: number;
  seed: number;
  bestScore: number | null;
  bestMode: string | null;
  autoScore: number | null;
  autoDeltaToBest: number | null;
  timeToFirstFeasibleSeconds: number | null;
  timeToBestSeconds: number | null;
  reuseSources: string[];
  cpSatStatuses: string[];
  minimumExactGap: number | null;
  manualReplayCoverage: "not-applicable" | "scorecard-replay-case";
  expansionComparisonLift: number | null;
}

export type CrossModeProductWorkflowReplayApiRoute = "/api/layout/evaluate";
export type CrossModeProductWorkflowReplayTag = "manual-layout-replay" | "expansion-comparison";

export interface CrossModeProductWorkflowReplayMetric {
  caseName: string;
  split: CrossModeBenchmarkSplit;
  workflowTag: CrossModeProductWorkflowReplayTag;
  apiRoute: CrossModeProductWorkflowReplayApiRoute;
  sourceName: string;
  scorecardCount: number;
  budgetsSeconds: number[];
  seeds: number[];
  modes: CrossModeBenchmarkMode[];
  valid: boolean;
  validationErrorCount: number;
  reportedPopulation: number;
  evaluatedPopulation: number;
  populationDeltaFromReported: number;
  reportedRoadCount: number;
  evaluatedRoadCount: number;
  removedRoadCount: number;
  bestScore: number | null;
  bestScoreSource: CrossModeProductWorkflowReplayScoreSource | null;
  bestScoreDeltaFromEvaluated: number | null;
  autoScore: number | null;
  autoScoreSource: CrossModeProductWorkflowReplayScoreSource | null;
  autoScoreDeltaFromEvaluated: number | null;
  expansionComparisonLift: number | null;
}

export interface CrossModeProductWorkflowReplayScoreSource {
  budgetSeconds: number;
  seed: number;
  mode: CrossModeBenchmarkMode;
}

export interface CrossModeProductWorkflowMissingScorecard {
  caseName: string;
  budgetSeconds: number;
  seed: number;
}

export interface CrossModeProductWorkflowScorecardModeGap {
  caseName: string;
  budgetSeconds: number;
  seed: number;
  missingModes: CrossModeBenchmarkMode[];
}

export interface CrossModeProductWorkflowSplitMismatch {
  caseName: string;
  expectedSplit: CrossModeBenchmarkSplit;
  actualSplit: CrossModeBenchmarkSplit;
}

export interface CrossModeProductWorkflowPromotionCoverage {
  requiredCaseNames: string[];
  missingCaseNames: string[];
  splitMismatches: CrossModeProductWorkflowSplitMismatch[];
  requiredModes: CrossModeBenchmarkMode[];
  missingModes: CrossModeBenchmarkMode[];
  requiredBudgetsSeconds: number[];
  missingBudgetsSeconds: number[];
  requiredSeeds: number[];
  missingSeeds: number[];
  unexpectedSeeds: number[];
  expectedScorecardCount: number;
  actualScorecardCount: number;
  missingScorecards: CrossModeProductWorkflowMissingScorecard[];
  scorecardsMissingModes: CrossModeProductWorkflowScorecardModeGap[];
  minimumSeedCount: number;
  seedCount: number;
  fullCorpus: boolean;
  requiredSplitCoverage: boolean;
  requiredModeCoverage: boolean;
  requiredBudgetCoverage: boolean;
  requiredSeedCoverage: boolean;
  requiredScorecardCoverage: boolean;
  requiredScorecardModeCoverage: boolean;
  protectedHoldout: boolean;
}

export interface CrossModeProductWorkflowEvidenceSummary {
  caseCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
  splitCaseCounts: Record<CrossModeBenchmarkSplit, number>;
  workflowTagCounts: Partial<Record<CrossModeWorkflowTag, number>>;
  promotionCoverage: CrossModeProductWorkflowPromotionCoverage;
  caseMetrics: CrossModeProductWorkflowCaseMetric[];
  replayMetrics: CrossModeProductWorkflowReplayMetric[];
}

export interface CrossModeProductWorkflowReplayTelemetryManifest {
  schemaVersion: 1;
  source: "product-workflow-replay";
  command: string;
  generatedAt: string;
  git: CrossModeProductWorkflowReplayTelemetryManifestOptions["git"] | null;
  hardware: Record<string, unknown>;
  suite: {
    caseCount: number;
    replayCount: number;
    validReplayCount: number;
    invalidReplayCount: number;
    apiRoutes: CrossModeProductWorkflowReplayApiRoute[];
    workflowTags: CrossModeProductWorkflowReplayTag[];
    budgetsSeconds: number[];
    seeds: number[];
    modes: CrossModeBenchmarkMode[];
  };
  replays: CrossModeProductWorkflowReplayMetric[];
}

export interface CrossModeProductWorkflowReplayMetricOptions {
  corpus?: readonly CrossModeBenchmarkCase[];
  result?: CrossModeBenchmarkSuiteResult;
}

function dateSlug(value: string): string {
  return value.slice(0, 10);
}

function caseNamesBySplit(
  result: Pick<CrossModeBenchmarkSuiteResult, "cases">
): Record<CrossModeBenchmarkSplit, string[]> {
  const splitCases: Record<CrossModeBenchmarkSplit, Set<string>> = {
    development: new Set(),
    holdout: new Set()
  };
  for (const scorecard of result.cases) {
    splitCases[scorecard.split].add(scorecard.name);
  }
  return {
    development: [...splitCases.development],
    holdout: [...splitCases.holdout]
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function nullableMin(values: readonly (number | null)[]): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.min(...finiteValues);
}

function millisecondsToSeconds(value: number | null): number | null {
  return value === null ? null : Number((value / 1000).toFixed(3));
}

function productWorkflowCaseFamilies(result: Pick<CrossModeBenchmarkSuiteResult, "cases">): string[] {
  return uniqueSorted(result.cases.flatMap((scorecard) => scorecard.workflowTags));
}

function assertNonEmptyStringList(values: readonly string[], label: string): void {
  if (values.length === 0 || values.some((value) => value.trim().length === 0)) {
    throw new Error(`Product workflow registry ${label} must include at least one non-empty value.`);
  }
}

function includesAllNumbers(values: readonly number[], required: readonly number[]): number[] {
  const valueSet = new Set(values);
  return required.filter((value) => !valueSet.has(value));
}

function includesAllStrings<T extends string>(values: readonly T[], required: readonly T[]): T[] {
  const valueSet = new Set(values);
  return required.filter((value) => !valueSet.has(value));
}

function scorecardKey(caseName: string, budgetSeconds: number, seed: number): string {
  return `${caseName}\u0000${budgetSeconds}\u0000${seed}`;
}

function buildPromotionCoverage(result: CrossModeBenchmarkSuiteResult): CrossModeProductWorkflowPromotionCoverage {
  const requiredCaseNames = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.map((benchmarkCase) => benchmarkCase.name);
  const requiredSplitByCaseName = new Map(
    DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.map((benchmarkCase) => [
      benchmarkCase.name,
      benchmarkCase.split ?? "development"
    ])
  );
  const selectedCaseNames = uniqueSorted(result.cases.map((scorecard) => scorecard.name));
  const missingCaseNames = includesAllStrings(selectedCaseNames, requiredCaseNames);
  const splitMismatchesByCaseName = new Map<string, CrossModeProductWorkflowSplitMismatch>();
  for (const scorecard of result.cases) {
    const expectedSplit = requiredSplitByCaseName.get(scorecard.name);
    if (expectedSplit === undefined || expectedSplit === scorecard.split) continue;
    splitMismatchesByCaseName.set(scorecard.name, {
      caseName: scorecard.name,
      expectedSplit,
      actualSplit: scorecard.split
    });
  }
  const splitMismatches = [...splitMismatchesByCaseName.values()].sort((left, right) =>
    left.caseName.localeCompare(right.caseName)
  );
  const missingModes = includesAllStrings(result.modes, PRODUCT_WORKFLOW_PROMOTION_MODES);
  const missingBudgetsSeconds = includesAllNumbers(result.budgetsSeconds, PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS);
  const missingSeeds = includesAllNumbers(result.seeds, PRODUCT_WORKFLOW_PROMOTION_SEEDS);
  const unexpectedSeeds = includesAllNumbers(PRODUCT_WORKFLOW_PROMOTION_SEEDS, result.seeds);
  const seedCount = new Set(result.seeds).size;
  const scorecardsByKey = new Map(
    result.cases.map((scorecard) => [scorecardKey(scorecard.name, scorecard.budgetSeconds, scorecard.seed), scorecard])
  );
  const expectedScorecardCount =
    requiredCaseNames.length *
    PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS.length *
    PRODUCT_WORKFLOW_PROMOTION_SEEDS.length;
  const missingScorecards: CrossModeProductWorkflowMissingScorecard[] = [];
  const scorecardsMissingModes: CrossModeProductWorkflowScorecardModeGap[] = [];

  for (const caseName of requiredCaseNames) {
    for (const budgetSeconds of PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS) {
      for (const seed of PRODUCT_WORKFLOW_PROMOTION_SEEDS) {
        const scorecard = scorecardsByKey.get(scorecardKey(caseName, budgetSeconds, seed));
        if (scorecard === undefined) {
          missingScorecards.push({ caseName, budgetSeconds, seed });
          continue;
        }
        const resultModes = scorecard.results.map((entry) => entry.mode);
        const missingResultModes = includesAllStrings(resultModes, PRODUCT_WORKFLOW_PROMOTION_MODES);
        if (missingResultModes.length > 0) {
          scorecardsMissingModes.push({ caseName, budgetSeconds, seed, missingModes: missingResultModes });
        }
      }
    }
  }

  const fullCorpus = missingCaseNames.length === 0;
  const requiredModeCoverage = missingModes.length === 0;
  const requiredBudgetCoverage = missingBudgetsSeconds.length === 0;
  const requiredSeedCoverage = missingSeeds.length === 0 && unexpectedSeeds.length === 0;
  const requiredSplitCoverage = splitMismatches.length === 0;
  const requiredScorecardCoverage = missingScorecards.length === 0 && result.cases.length === expectedScorecardCount;
  const requiredScorecardModeCoverage = scorecardsMissingModes.length === 0;

  return {
    requiredCaseNames,
    missingCaseNames,
    splitMismatches,
    requiredModes: [...PRODUCT_WORKFLOW_PROMOTION_MODES],
    missingModes,
    requiredBudgetsSeconds: [...PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS],
    missingBudgetsSeconds,
    requiredSeeds: [...PRODUCT_WORKFLOW_PROMOTION_SEEDS],
    missingSeeds,
    unexpectedSeeds,
    expectedScorecardCount,
    actualScorecardCount: result.cases.length,
    missingScorecards,
    scorecardsMissingModes,
    minimumSeedCount: PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT,
    seedCount,
    fullCorpus,
    requiredSplitCoverage,
    requiredModeCoverage,
    requiredBudgetCoverage,
    requiredSeedCoverage,
    requiredScorecardCoverage,
    requiredScorecardModeCoverage,
    protectedHoldout:
      fullCorpus &&
      requiredSplitCoverage &&
      requiredModeCoverage &&
      requiredBudgetCoverage &&
      requiredSeedCoverage &&
      requiredScorecardCoverage &&
      requiredScorecardModeCoverage
  };
}

function isSolutionWarmStartHint(value: unknown): value is Solution {
  return typeof value === "object" && value !== null && "roads" in value && value.roads instanceof Set;
}

function asReusableHint(value: unknown): CpSatWarmStartHint | null {
  if (typeof value !== "object" || value === null || isSolutionWarmStartHint(value)) return null;
  return value as CpSatWarmStartHint;
}

function replayTagForCase(benchmarkCase: CrossModeBenchmarkCase): CrossModeProductWorkflowReplayTag | null {
  const tags = new Set(benchmarkCase.workflowTags ?? []);
  if (tags.has("manual-layout-replay")) return "manual-layout-replay";
  if (tags.has("expansion-comparison")) return "expansion-comparison";
  return null;
}

function replayHintForCase(benchmarkCase: CrossModeBenchmarkCase): CpSatWarmStartHint | null {
  return benchmarkCase.params.lns?.seedHint ?? asReusableHint(benchmarkCase.params.cpSat?.warmStartHint) ?? null;
}

function scorecardsByCase(
  result: CrossModeBenchmarkSuiteResult | undefined,
  caseName: string
): CrossModeBenchmarkCaseScorecard[] {
  return result?.cases.filter((scorecard) => scorecard.name === caseName) ?? [];
}

interface ReplayScoreSelection {
  score: number;
  source: CrossModeProductWorkflowReplayScoreSource;
}

function replayScoreSource(
  scorecard: CrossModeBenchmarkCaseScorecard,
  mode: CrossModeBenchmarkMode
): CrossModeProductWorkflowReplayScoreSource {
  return {
    budgetSeconds: scorecard.budgetSeconds,
    seed: scorecard.seed,
    mode
  };
}

function bestAutoScore(scorecards: readonly CrossModeBenchmarkCaseScorecard[]): ReplayScoreSelection | null {
  let best: ReplayScoreSelection | null = null;
  for (const scorecard of scorecards) {
    const autoResult = scorecard.results.find((entry) => entry.mode === "auto");
    if (autoResult === undefined) continue;
    if (best === null || autoResult.totalPopulation > best.score) {
      best = {
        score: autoResult.totalPopulation,
        source: replayScoreSource(scorecard, "auto")
      };
    }
  }
  return best;
}

function bestScore(scorecards: readonly CrossModeBenchmarkCaseScorecard[]): ReplayScoreSelection | null {
  let best: ReplayScoreSelection | null = null;
  for (const scorecard of scorecards) {
    if (scorecard.bestScore === null) continue;
    const bestResult =
      [...scorecard.results.filter((entry) => entry.rank === 1)].sort(compareModeResults)[0] ??
      [...scorecard.results.filter((entry) => entry.totalPopulation === scorecard.bestScore)].sort(
        compareModeResults
      )[0];
    if (bestResult === undefined) continue;
    if (best === null || scorecard.bestScore > best.score) {
      best = {
        score: scorecard.bestScore,
        source: replayScoreSource(scorecard, bestResult.mode)
      };
    }
  }
  return best;
}

function buildReplayMetric(
  benchmarkCase: CrossModeBenchmarkCase,
  replayTag: CrossModeProductWorkflowReplayTag,
  hint: CpSatWarmStartHint,
  scorecards: readonly CrossModeBenchmarkCaseScorecard[]
): CrossModeProductWorkflowReplayMetric {
  const grid = cloneBenchmarkGrid(benchmarkCase.grid);
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const solution = materializeValidLnsSeedSolution(grid, params, hint);
  if (!solution) {
    throw new Error(`Product workflow replay case '${benchmarkCase.name}' is missing a reusable solution hint.`);
  }

  const response = buildManualLayoutResponse(grid, params, solution);
  const replayBestScore = bestScore(scorecards);
  const replayAutoScore = bestAutoScore(scorecards);
  const evaluatedPopulation = response.stats.totalPopulation;
  const bestScoreDeltaFromEvaluated = replayBestScore === null ? null : replayBestScore.score - evaluatedPopulation;
  const autoScoreDeltaFromEvaluated = replayAutoScore === null ? null : replayAutoScore.score - evaluatedPopulation;

  return {
    caseName: benchmarkCase.name,
    split: benchmarkCase.split ?? "development",
    workflowTag: replayTag,
    apiRoute: "/api/layout/evaluate",
    sourceName: hint.sourceName ?? replayTag,
    scorecardCount: scorecards.length,
    budgetsSeconds: uniqueSortedNumbers(scorecards.map((scorecard) => scorecard.budgetSeconds)),
    seeds: uniqueSortedNumbers(scorecards.map((scorecard) => scorecard.seed)),
    modes: uniqueSorted(
      scorecards.flatMap((scorecard) => scorecard.results.map((entry) => entry.mode))
    ) as CrossModeBenchmarkMode[],
    valid: response.validation.valid,
    validationErrorCount: response.validation.errors.length,
    reportedPopulation: solution.totalPopulation,
    evaluatedPopulation,
    populationDeltaFromReported: evaluatedPopulation - solution.totalPopulation,
    reportedRoadCount: solution.roads.size,
    evaluatedRoadCount: response.solution.roads.length,
    removedRoadCount: Math.max(0, solution.roads.size - response.solution.roads.length),
    bestScore: replayBestScore?.score ?? null,
    bestScoreSource: replayBestScore?.source ?? null,
    bestScoreDeltaFromEvaluated,
    autoScore: replayAutoScore?.score ?? null,
    autoScoreSource: replayAutoScore?.source ?? null,
    autoScoreDeltaFromEvaluated,
    expansionComparisonLift:
      replayTag === "expansion-comparison" ? (autoScoreDeltaFromEvaluated ?? bestScoreDeltaFromEvaluated) : null
  };
}

export function buildCrossModeProductWorkflowReplayMetrics(
  options: CrossModeProductWorkflowReplayMetricOptions = {}
): CrossModeProductWorkflowReplayMetric[] {
  const corpus = options.corpus ?? DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS;
  const selectedNames = options.result ? new Set(options.result.selectedCaseNames) : null;
  const metrics: CrossModeProductWorkflowReplayMetric[] = [];

  for (const benchmarkCase of corpus) {
    if (selectedNames && !selectedNames.has(benchmarkCase.name)) continue;
    const replayTag = replayTagForCase(benchmarkCase);
    const hint = replayHintForCase(benchmarkCase);
    if (!replayTag || !hint) continue;
    metrics.push(
      buildReplayMetric(benchmarkCase, replayTag, hint, scorecardsByCase(options.result, benchmarkCase.name))
    );
  }

  return metrics;
}

export function buildCrossModeProductWorkflowReplayTelemetryManifest(
  result: CrossModeBenchmarkSuiteResult,
  options: CrossModeProductWorkflowReplayTelemetryManifestOptions
): CrossModeProductWorkflowReplayTelemetryManifest {
  const replays = buildCrossModeProductWorkflowReplayMetrics({
    result,
    corpus: options.corpus
  });
  return {
    schemaVersion: 1,
    source: "product-workflow-replay",
    command: options.command,
    generatedAt: result.generatedAt,
    git: options.git ?? null,
    hardware: options.hardware ?? { captured: false, gpuUsed: false },
    suite: {
      caseCount: result.caseCount,
      replayCount: replays.length,
      validReplayCount: replays.filter((metric) => metric.valid).length,
      invalidReplayCount: replays.filter((metric) => !metric.valid).length,
      apiRoutes: uniqueSorted(replays.map((metric) => metric.apiRoute)) as CrossModeProductWorkflowReplayApiRoute[],
      workflowTags: uniqueSorted(replays.map((metric) => metric.workflowTag)) as CrossModeProductWorkflowReplayTag[],
      budgetsSeconds: uniqueSortedNumbers(replays.flatMap((metric) => metric.budgetsSeconds)),
      seeds: uniqueSortedNumbers(replays.flatMap((metric) => metric.seeds)),
      modes: uniqueSorted(replays.flatMap((metric) => metric.modes)) as CrossModeBenchmarkMode[]
    },
    replays
  };
}

export function buildCrossModeProductWorkflowEvidenceSummary(
  result: CrossModeBenchmarkSuiteResult
): CrossModeProductWorkflowEvidenceSummary {
  const splitCases = caseNamesBySplit(result);
  const tagCounts = Object.fromEntries(
    productWorkflowCaseFamilies(result).map((tag) => [
      tag,
      result.cases.filter((scorecard) => scorecard.workflowTags.includes(tag as CrossModeWorkflowTag)).length
    ])
  ) as Partial<Record<CrossModeWorkflowTag, number>>;

  return {
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
    splitCaseCounts: {
      development: splitCases.development.length,
      holdout: splitCases.holdout.length
    },
    workflowTagCounts: tagCounts,
    promotionCoverage: buildPromotionCoverage(result),
    caseMetrics: result.cases.map((scorecard) => {
      const bestResult = [...scorecard.results.filter((entry) => entry.rank === 1)].sort(compareModeResults)[0] ?? null;
      const autoResult = scorecard.results.find((entry) => entry.mode === "auto") ?? null;
      const firstFeasibleMs = nullableMin(scorecard.results.map((entry) => entry.timeToQuality.firstFeasibleAtMs));
      const bestScoreMs = nullableMin(scorecard.results.map((entry) => entry.timeToQuality.bestScoreAtMs));
      const exactGap = nullableMin(scorecard.results.map((entry) => entry.progressSummary.exactGap));
      const autoDeltaToBest =
        scorecard.bestScore === null || autoResult === null ? null : scorecard.bestScore - autoResult.totalPopulation;
      return {
        caseName: scorecard.name,
        split: scorecard.split,
        workflowTags: [...scorecard.workflowTags],
        budgetSeconds: scorecard.budgetSeconds,
        seed: scorecard.seed,
        bestScore: scorecard.bestScore,
        bestMode: bestResult?.mode ?? null,
        autoScore: autoResult?.totalPopulation ?? null,
        autoDeltaToBest,
        timeToFirstFeasibleSeconds: millisecondsToSeconds(firstFeasibleMs),
        timeToBestSeconds: millisecondsToSeconds(bestScoreMs),
        reuseSources: uniqueSorted(
          scorecard.results
            .map((entry) => entry.progressSummary.reuseSource)
            .filter((entry): entry is string => entry !== null)
        ),
        cpSatStatuses: uniqueSorted(
          scorecard.results.map((entry) => entry.cpSatStatus).filter((entry): entry is string => entry !== null)
        ),
        minimumExactGap: exactGap,
        manualReplayCoverage: scorecard.workflowTags.includes("manual-layout-replay")
          ? "scorecard-replay-case"
          : "not-applicable",
        expansionComparisonLift: scorecard.workflowTags.includes("expansion-comparison") ? autoDeltaToBest : null
      };
    }),
    replayMetrics: buildCrossModeProductWorkflowReplayMetrics({ result })
  };
}

export function buildCrossModeProductWorkflowRegistryEntryDraft(
  result: CrossModeBenchmarkSuiteResult,
  options: CrossModeProductWorkflowRegistryEntryDraftOptions
): Record<string, unknown> {
  assertNonEmptyStringList([...options.commands], "commands");
  assertNonEmptyStringList([...options.artifactPaths], "artifact paths");

  const splitCases = caseNamesBySplit(result);
  const caseFamilies = productWorkflowCaseFamilies(result);
  const evidenceSummary = buildCrossModeProductWorkflowEvidenceSummary(result);
  const protectedHoldout = evidenceSummary.promotionCoverage.protectedHoldout;
  return {
    schemaVersion: 1,
    runId: options.runId ?? `product-workflow-corpus-${dateSlug(result.generatedAt)}`,
    artifactType: "benchmark",
    generatedAt: result.generatedAt,
    commands: [...options.commands],
    artifactPaths: [...options.artifactPaths],
    cases: splitCases,
    caseFamilies,
    seeds: [...result.seeds],
    splitStatus: {
      protectedHoldout,
      splitField: "CrossModeBenchmarkCase.split",
      developmentCaseCount: splitCases.development.length,
      holdoutCaseCount: splitCases.holdout.length,
      promotionCoverage: evidenceSummary.promotionCoverage,
      leakage: protectedHoldout ? "none" : "not-evaluated",
      notes: protectedHoldout
        ? "Product workflow corpus scorecard covers the full promotion matrix with explicit development/holdout split metadata."
        : "Partial product workflow corpus scorecard; not protected holdout promotion evidence."
    },
    budget: {
      wallClockBudgetsSeconds: [...result.budgetsSeconds],
      caseCount: result.caseCount,
      modeCount: result.modes.length,
      totalRuns: result.cases.reduce((sum, scorecard) => sum + scorecard.results.length, 0)
    },
    model: null,
    decision: options.decision ?? "no-default-promotion",
    summary:
      options.summary ??
      `Product workflow corpus scorecard over ${result.caseCount} cases, ${result.modes.length} modes, ${result.budgetsSeconds.length} budget(s), and ${result.seeds.length} seed(s).`,
    summaryMetrics: {
      splitCaseCounts: evidenceSummary.splitCaseCounts,
      workflowTagCounts: evidenceSummary.workflowTagCounts,
      modes: [...result.modes],
      caseMetricCount: evidenceSummary.caseMetrics.length,
      caseMetrics: evidenceSummary.caseMetrics,
      replayMetricCount: evidenceSummary.replayMetrics.length,
      replayMetrics: evidenceSummary.replayMetrics
    }
  };
}
