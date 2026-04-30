import { selectBenchmarkCasesByName } from "./benchmarkOptions.js";
import { DEFAULT_CP_SAT_BENCHMARK_CORPUS } from "./cpSat.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossMode.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";

import type {
  CrossModeBenchmarkCase,
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

export interface CrossModeProductWorkflowEvidenceSummary {
  caseCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
  splitCaseCounts: Record<CrossModeBenchmarkSplit, number>;
  workflowTagCounts: Partial<Record<CrossModeWorkflowTag, number>>;
  caseMetrics: CrossModeProductWorkflowCaseMetric[];
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
  const protectedHoldout = splitCases.development.length > 0 && splitCases.holdout.length > 0;
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
      leakage: protectedHoldout ? "none" : "not-evaluated",
      notes: protectedHoldout
        ? "Product workflow corpus scorecard with case-level development/holdout split metadata."
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
    },
  };
}
