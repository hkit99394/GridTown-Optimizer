import { selectBenchmarkCasesByName } from "./benchmarkOptions.js";
import { DEFAULT_CP_SAT_BENCHMARK_CORPUS } from "./cpSat.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossMode.js";
import {
  PRODUCT_WORKFLOW_DEVELOPMENT_EXTENSION_CASES,
  PRODUCT_WORKFLOW_FRESH_HOLDOUT_CASES
} from "./crossModeProductWorkflowCases.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";

import type {
  CrossModeBenchmarkCase,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSplit,
  CrossModeProblemSizeBand,
  CrossModeWorkflowTag
} from "./crossMode.js";

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
    workflowTags: ["solver-smoke"]
  },
  {
    corpus: DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
    name: "row0-corridor-repair-pressure",
    split: "holdout",
    workflowTags: ["corridor"]
  },
  {
    corpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    name: "typed-footprint-pressure",
    split: "development",
    workflowTags: ["footprint-pressure"]
  },
  {
    corpus: DEFAULT_GREEDY_BENCHMARK_CORPUS,
    name: "service-local-neighborhood",
    split: "holdout",
    workflowTags: ["service-pressure"]
  },
  {
    corpus: DEFAULT_LNS_BENCHMARK_CORPUS,
    name: "seeded-service-anchor-pressure",
    split: "development",
    workflowTags: ["anchor-service"]
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "road-semantics-gate-choke",
    split: "holdout",
    workflowTags: ["gate"]
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "road-semantics-service-pressure",
    split: "development",
    workflowTags: ["service-pressure"]
  },
  {
    corpus: DEFAULT_CP_SAT_BENCHMARK_CORPUS,
    name: "multi-anchor-road-components",
    split: "holdout",
    workflowTags: ["multi-anchor"]
  }
] satisfies ProductWorkflowCaseSpec[]);

const MANUAL_LAYOUT_REPLAY_HINT = {
  sourceName: "manual-layout-replay",
  roads: ["0,0", "0,1", "1,1", "2,1", "3,1"],
  solution: {
    roads: ["0,0", "0,1", "1,1", "2,1", "3,1"],
    services: [{ r: 1, c: 0, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 40 }],
    residentials: [
      { r: 1, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 },
      { r: 3, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 }
    ],
    populations: [80, 80],
    totalPopulation: 160
  },
  objectiveLowerBound: 160
};

const EXPANSION_COMPARISON_REPLAY_HINT = {
  sourceName: "expansion-comparison-replay",
  roads: ["0,0", "0,1", "0,2", "1,2", "2,2"],
  solution: {
    roads: ["0,0", "0,1", "0,2", "1,2", "2,2"],
    services: [{ r: 1, c: 3, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 35 }],
    residentials: [{ r: 2, c: 3, rows: 2, cols: 2, typeIndex: 0, population: 115 }],
    populations: [115],
    totalPopulation: 115
  },
  objectiveLowerBound: 115
};

const FRESH_MANUAL_RESUME_NEIGHBORHOOD_HINT = {
  sourceName: "fresh-manual-resume-neighborhood",
  roads: ["0,0", "0,1", "0,2", "0,3", "1,3", "1,4", "2,4", "3,4", "4,4"],
  solution: {
    roads: ["0,0", "0,1", "0,2", "0,3", "1,3", "1,4", "2,4", "3,4", "4,4"],
    services: [
      { r: 1, c: 0, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 45 },
      { r: 3, c: 2, rows: 1, cols: 2, range: 2, typeIndex: 1, bonus: 90 }
    ],
    residentials: [
      { r: 1, c: 1, rows: 2, cols: 2, typeIndex: 0, population: 220 },
      { r: 3, c: 5, rows: 2, cols: 2, typeIndex: 0, population: 180 }
    ],
    populations: [220, 180],
    totalPopulation: 400
  },
  objectiveLowerBound: 400,
  preferStrictImprove: true,
  repairHint: true,
  fixVariablesToHintedValue: false,
  neighborhoodWindow: { top: 2, left: 2, rows: 3, cols: 4 },
  fixOutsideNeighborhoodToHintedValue: true
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
      [1, 1, 1, 1, 1]
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
        seedHint: MANUAL_LAYOUT_REPLAY_HINT
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1,
        warmStartHint: MANUAL_LAYOUT_REPLAY_HINT
      },
      greedy: {
        localSearch: true,
        randomSeed: 71,
        restarts: 1,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 6,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "fresh-manual-resume-neighborhood",
    description:
      "Fresh product holdout for saved-layout resume where a valid incumbent seeds neighborhood repair and CP-SAT continuation.",
    problemSizeBand: "small",
    split: "holdout",
    workflowTags: ["manual-layout-replay", "manual-resume-neighborhood"],
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 45, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 90, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 90, max: 220, avail: 3 },
        { w: 1, h: 2, min: 60, max: 130, avail: 2 }
      ],
      availableBuildings: { services: 2, residentials: 4 },
      lns: {
        iterations: 3,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 3,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 0.75,
        seedHint: FRESH_MANUAL_RESUME_NEIGHBORHOOD_HINT
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1,
        warmStartHint: FRESH_MANUAL_RESUME_NEIGHBORHOOD_HINT
      },
      greedy: {
        localSearch: true,
        randomSeed: 103,
        restarts: 3,
        serviceRefineIterations: 2,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 10,
        serviceExactMaxCombinations: 256
      }
    }
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
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 1 },
        { rows: 2, cols: 1, bonus: 65, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 180, avail: 3 },
        { w: 2, h: 3, min: 140, max: 280, avail: 1 }
      ],
      availableBuildings: { services: 2, residentials: 4 },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 0.5,
        seedHint: EXPANSION_COMPARISON_REPLAY_HINT
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1,
        warmStartHint: EXPANSION_COMPARISON_REPLAY_HINT
      },
      greedy: {
        localSearch: true,
        randomSeed: 79,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 128
      }
    }
  }
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
    workflowTags: uniqueWorkflowTags([...(benchmarkCase.workflowTags ?? []), ...spec.workflowTags])
  };
}

function selectProductWorkflowCase(spec: ProductWorkflowCaseSpec): CrossModeBenchmarkCase {
  const [benchmarkCase] = selectBenchmarkCasesByName(spec.corpus, [spec.name], {
    caseLabel: "cross-mode product workflow benchmark",
    corpusLabel: "Cross-mode product workflow benchmark"
  });
  return withProductWorkflowMetadata(benchmarkCase, spec);
}

export const DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  ...PRODUCT_WORKFLOW_CASE_SPECS.map(selectProductWorkflowCase),
  ...PRODUCT_WORKFLOW_DEVELOPMENT_EXTENSION_CASES,
  ...PRODUCT_WORKFLOW_FRESH_HOLDOUT_CASES,
  ...PRODUCT_WORKFLOW_REPLAY_CASES
]);

export const PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS = Object.freeze([1, 5, 30, 120]);
export const PRODUCT_WORKFLOW_PROMOTION_SEEDS = Object.freeze([7, 19, 37]);
export const PRODUCT_WORKFLOW_PROMOTION_MINIMUM_SEED_COUNT = 3;
export const PRODUCT_WORKFLOW_PROMOTION_MODES = Object.freeze([
  "auto",
  "greedy",
  "lns",
  "cp-sat"
] satisfies CrossModeBenchmarkMode[]);
