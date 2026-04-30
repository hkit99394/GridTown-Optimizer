import {
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  selectBenchmarkCasesByName,
} from "./benchmarkOptions.js";
import { DEFAULT_CP_SAT_BENCHMARK_CORPUS } from "./cpSat.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossMode.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";
import { materializeValidLnsSeedSolution } from "../core/solverInputValidation.js";
import { buildManualLayoutResponse } from "../server/http/solutionResponse.js";

import type {
  CpSatWarmStartHint,
  Solution,
} from "../core/types.js";
import type {
  CrossModeBenchmarkCaseScorecard,
  CrossModeBenchmarkCase,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSplit,
  CrossModeBenchmarkSuiteResult,
  CrossModeProblemSizeBand,
  CrossModeWorkflowTag,
} from "./crossMode.js";

export interface CrossModeProductWorkflowRegistryEntryDraftOptions {
  runId?: string;
  commands: readonly string[];
  artifactPaths: readonly string[];
  decision?: string;
  summary?: string;
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

export interface CrossModeProductWorkflowReplayMetricOptions {
  corpus?: readonly CrossModeBenchmarkCase[];
  result?: CrossModeBenchmarkSuiteResult;
}

interface ProductWorkflowCaseSpec {
  corpus: readonly CrossModeBenchmarkCase[];
  name: string;
  split: CrossModeBenchmarkSplit;
  workflowTags: readonly CrossModeWorkflowTag[];
}

const PRODUCT_WORKFLOW_CASE_SPECS = Object.freeze([
  {
    corpus: DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
    name: "typed-housing-single",
    split: "development",
    workflowTags: ["solver-smoke"],
  },
  {
    corpus: DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
    name: "row0-corridor-repair-pressure",
    split: "holdout",
    workflowTags: ["corridor"],
  },
  {
    corpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    name: "typed-footprint-pressure",
    split: "development",
    workflowTags: ["footprint-pressure"],
  },
  {
    corpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    name: "service-local-neighborhood",
    split: "holdout",
    workflowTags: ["service-pressure"],
  },
  {
    corpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    name: "seeded-service-anchor-pressure",
    split: "development",
    workflowTags: ["anchor-service"],
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "road-semantics-gate-choke",
    split: "holdout",
    workflowTags: ["gate"],
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "road-semantics-service-pressure",
    split: "development",
    workflowTags: ["service-pressure"],
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "multi-anchor-road-components",
    split: "holdout",
    workflowTags: ["multi-anchor"],
  },
] satisfies ProductWorkflowCaseSpec[]);

const MANUAL_LAYOUT_REPLAY_HINT = {
  sourceName: "manual-layout-replay",
  roads: ["0,0", "0,1", "1,1", "2,1", "3,1"],
  solution: {
    roads: ["0,0", "0,1", "1,1", "2,1", "3,1"],
    services: [{ r: 1, c: 0, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 40 }],
    residentials: [
      { r: 1, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 },
      { r: 3, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 },
    ],
    populations: [80, 80],
    totalPopulation: 160,
  },
  objectiveLowerBound: 160,
};

const EXPANSION_COMPARISON_REPLAY_HINT = {
  sourceName: "expansion-comparison-replay",
  roads: ["0,0", "0,1", "0,2", "1,2", "2,2"],
  solution: {
    roads: ["0,0", "0,1", "0,2", "1,2", "2,2"],
    services: [{ r: 1, c: 3, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 35 }],
    residentials: [{ r: 2, c: 3, rows: 2, cols: 2, typeIndex: 0, population: 115 }],
    populations: [115],
    totalPopulation: 115,
  },
  objectiveLowerBound: 115,
};

const PRODUCT_WORKFLOW_REPLAY_CASES: readonly CrossModeBenchmarkCase[] = Object.freeze([
  {
    name: "manual-layout-replay-warm-start",
    description: "Planner manual-layout replay with reusable LNS seed and CP-SAT warm-start hints.",
    problemSizeBand: "small",
    split: "development",
    workflowTags: ["manual-layout-replay"],
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [{ rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 80, max: 140, avail: 2 }],
      availableBuildings: { services: 1, residentials: 2 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 2,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 0.5,
        seedHint: MANUAL_LAYOUT_REPLAY_HINT,
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1,
        warmStartHint: MANUAL_LAYOUT_REPLAY_HINT,
      },
      greedy: {
        localSearch: true,
        randomSeed: 71,
        restarts: 1,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 6,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64,
      },
    },
  },
  {
    name: "expansion-comparison-replay",
    description: "Planner expansion-comparison replay with a saved pre-expansion layout as the incumbent.",
    problemSizeBand: "small",
    split: "holdout",
    workflowTags: ["expansion-comparison"],
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 1 },
        { rows: 2, cols: 1, bonus: 65, range: 2, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 180, avail: 3 },
        { w: 2, h: 3, min: 140, max: 280, avail: 1 },
      ],
      availableBuildings: { services: 2, residentials: 4 },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 0.5,
        seedHint: EXPANSION_COMPARISON_REPLAY_HINT,
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1,
        warmStartHint: EXPANSION_COMPARISON_REPLAY_HINT,
      },
      greedy: {
        localSearch: true,
        randomSeed: 79,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 128,
      },
    },
  },
]);

function inferProductProblemSizeBand(benchmarkCase: CrossModeBenchmarkCase): CrossModeProblemSizeBand {
  const cells = benchmarkCase.grid.length * (benchmarkCase.grid[0]?.length ?? 0);
  if (cells <= 16) return "tiny";
  if (cells <= 36) return "small";
  return "medium";
}

function uniqueWorkflowTags(tags: readonly CrossModeWorkflowTag[]): CrossModeWorkflowTag[] {
  return [...new Set(tags)];
}

function withProductWorkflowMetadata(
  benchmarkCase: CrossModeBenchmarkCase,
  spec: Pick<ProductWorkflowCaseSpec, "split" | "workflowTags">
): CrossModeBenchmarkCase {
  return {
    ...benchmarkCase,
    problemSizeBand: benchmarkCase.problemSizeBand ?? inferProductProblemSizeBand(benchmarkCase),
    split: spec.split,
    workflowTags: uniqueWorkflowTags([...(benchmarkCase.workflowTags ?? []), ...spec.workflowTags]),
  };
}

function selectProductWorkflowCase(spec: ProductWorkflowCaseSpec): CrossModeBenchmarkCase {
  const [benchmarkCase] = selectBenchmarkCasesByName(spec.corpus, [spec.name], {
    caseLabel: "cross-mode product workflow benchmark",
    corpusLabel: "Cross-mode product workflow benchmark",
  });
  return withProductWorkflowMetadata(benchmarkCase, spec);
}

export const DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  ...PRODUCT_WORKFLOW_CASE_SPECS.map(selectProductWorkflowCase),
  ...PRODUCT_WORKFLOW_REPLAY_CASES,
]);

export const PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS = Object.freeze([1, 5, 30, 120]);
export const PRODUCT_WORKFLOW_PROMOTION_SEEDS = Object.freeze([7, 19, 37]);
export const PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT = 3;
export const PRODUCT_WORKFLOW_PROMOTION_MODES = Object.freeze([
  "auto",
  "greedy",
  "lns",
  "cp-sat",
] satisfies CrossModeBenchmarkMode[]);

function dateSlug(value: string): string {
  return value.slice(0, 10);
}

function caseNamesBySplit(result: Pick<CrossModeBenchmarkSuiteResult, "cases">): Record<CrossModeBenchmarkSplit, string[]> {
  const splitCases: Record<CrossModeBenchmarkSplit, Set<string>> = {
    development: new Set(),
    holdout: new Set(),
  };
  for (const scorecard of result.cases) {
    splitCases[scorecard.split].add(scorecard.name);
  }
  return {
    development: [...splitCases.development],
    holdout: [...splitCases.holdout],
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
  const requiredSplitByCaseName = new Map(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.map((benchmarkCase) => [
    benchmarkCase.name,
    benchmarkCase.split ?? "development",
  ]));
  const selectedCaseNames = uniqueSorted(result.cases.map((scorecard) => scorecard.name));
  const missingCaseNames = includesAllStrings(selectedCaseNames, requiredCaseNames);
  const splitMismatchesByCaseName = new Map<string, CrossModeProductWorkflowSplitMismatch>();
  for (const scorecard of result.cases) {
    const expectedSplit = requiredSplitByCaseName.get(scorecard.name);
    if (expectedSplit === undefined || expectedSplit === scorecard.split) continue;
    splitMismatchesByCaseName.set(scorecard.name, {
      caseName: scorecard.name,
      expectedSplit,
      actualSplit: scorecard.split,
    });
  }
  const splitMismatches = [...splitMismatchesByCaseName.values()]
    .sort((left, right) => left.caseName.localeCompare(right.caseName));
  const missingModes = includesAllStrings(result.modes, PRODUCT_WORKFLOW_PROMOTION_MODES);
  const missingBudgetsSeconds = includesAllNumbers(result.budgetsSeconds, PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS);
  const seedCount = new Set(result.seeds).size;
  const scorecardsByKey = new Map(result.cases.map((scorecard) => [
    scorecardKey(scorecard.name, scorecard.budgetSeconds, scorecard.seed),
    scorecard,
  ]));
  const expectedScorecardCount =
    requiredCaseNames.length * PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS.length * result.seeds.length;
  const missingScorecards: CrossModeProductWorkflowMissingScorecard[] = [];
  const scorecardsMissingModes: CrossModeProductWorkflowScorecardModeGap[] = [];

  for (const caseName of requiredCaseNames) {
    for (const budgetSeconds of PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS) {
      for (const seed of result.seeds) {
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
  const requiredSeedCoverage = seedCount >= PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT;
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
    protectedHoldout: fullCorpus
      && requiredSplitCoverage
      && requiredModeCoverage
      && requiredBudgetCoverage
      && requiredSeedCoverage
      && requiredScorecardCoverage
      && requiredScorecardModeCoverage,
  };
}

function isSolutionWarmStartHint(value: unknown): value is Solution {
  return typeof value === "object"
    && value !== null
    && "roads" in value
    && value.roads instanceof Set;
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
  return benchmarkCase.params.lns?.seedHint
    ?? asReusableHint(benchmarkCase.params.cpSat?.warmStartHint)
    ?? null;
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
    mode,
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
        source: replayScoreSource(scorecard, "auto"),
      };
    }
  }
  return best;
}

function bestScore(scorecards: readonly CrossModeBenchmarkCaseScorecard[]): ReplayScoreSelection | null {
  let best: ReplayScoreSelection | null = null;
  for (const scorecard of scorecards) {
    if (scorecard.bestScore === null) continue;
    const bestResult = scorecard.results.find((entry) => entry.rank === 1)
      ?? scorecard.results.find((entry) => entry.totalPopulation === scorecard.bestScore);
    if (bestResult === undefined) continue;
    if (best === null || scorecard.bestScore > best.score) {
      best = {
        score: scorecard.bestScore,
        source: replayScoreSource(scorecard, bestResult.mode),
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
    modes: uniqueSorted(scorecards.flatMap((scorecard) =>
      scorecard.results.map((entry) => entry.mode)
    )) as CrossModeBenchmarkMode[],
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
    expansionComparisonLift: replayTag === "expansion-comparison"
      ? (autoScoreDeltaFromEvaluated ?? bestScoreDeltaFromEvaluated)
      : null,
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
    metrics.push(buildReplayMetric(
      benchmarkCase,
      replayTag,
      hint,
      scorecardsByCase(options.result, benchmarkCase.name)
    ));
  }

  return metrics;
}

export function buildCrossModeProductWorkflowEvidenceSummary(
  result: CrossModeBenchmarkSuiteResult
): CrossModeProductWorkflowEvidenceSummary {
  const splitCases = caseNamesBySplit(result);
  const tagCounts = Object.fromEntries(
    productWorkflowCaseFamilies(result).map((tag) => [
      tag,
      result.cases.filter((scorecard) => scorecard.workflowTags.includes(tag as CrossModeWorkflowTag)).length,
    ])
  ) as Partial<Record<CrossModeWorkflowTag, number>>;

  return {
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
    splitCaseCounts: {
      development: splitCases.development.length,
      holdout: splitCases.holdout.length,
    },
    workflowTagCounts: tagCounts,
    promotionCoverage: buildPromotionCoverage(result),
    caseMetrics: result.cases.map((scorecard) => {
      const bestResult = scorecard.results.find((entry) => entry.rank === 1) ?? null;
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
          scorecard.results
            .map((entry) => entry.cpSatStatus)
            .filter((entry): entry is string => entry !== null)
        ),
        minimumExactGap: exactGap,
        manualReplayCoverage: scorecard.workflowTags.includes("manual-layout-replay")
          ? "scorecard-replay-case"
          : "not-applicable",
        expansionComparisonLift: scorecard.workflowTags.includes("expansion-comparison") ? autoDeltaToBest : null,
      };
    }),
    replayMetrics: buildCrossModeProductWorkflowReplayMetrics({ result }),
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
        : "Partial product workflow corpus scorecard; not protected holdout promotion evidence.",
    },
    budget: {
      wallClockBudgetsSeconds: [...result.budgetsSeconds],
      caseCount: result.caseCount,
      modeCount: result.modes.length,
      totalRuns: result.cases.reduce((sum, scorecard) => sum + scorecard.results.length, 0),
    },
    model: null,
    decision: options.decision ?? "no-default-promotion",
    summary: options.summary
      ?? `Product workflow corpus scorecard over ${result.caseCount} cases, ${result.modes.length} modes, ${result.budgetsSeconds.length} budget(s), and ${result.seeds.length} seed(s).`,
    summaryMetrics: {
      splitCaseCounts: evidenceSummary.splitCaseCounts,
      workflowTagCounts: evidenceSummary.workflowTagCounts,
      modes: [...result.modes],
      caseMetricCount: evidenceSummary.caseMetrics.length,
      caseMetrics: evidenceSummary.caseMetrics,
      replayMetricCount: evidenceSummary.replayMetrics.length,
      replayMetrics: evidenceSummary.replayMetrics,
    },
  };
}
