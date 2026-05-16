import { performance } from "node:perf_hooks";

import { buildSolverProgressSummary } from "../core/index.js";
import { solveGreedy } from "../solvers/index.js";
import {
  applyBenchmarkOptionDefaults,
  applyNormalizedGreedyBenchmarkParams,
  assertBenchmarkCasesSelected,
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkOptions,
  cloneBenchmarkSolverParams,
  inheritGreedyBenchmarkOptions,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName
} from "./benchmarkOptions.js";

import type {
  GreedyOptions,
  GreedyProfile,
  GreedyProfilePhaseSummary,
  Grid,
  SolverParams,
  SolverProgressSummary
} from "../core/index.js";

export interface GreedyServiceLookaheadBenchmarkOptions {
  serviceLookaheadCandidates?: number;
}

export type GreedyBenchmarkOptions = GreedyOptions & GreedyServiceLookaheadBenchmarkOptions;

export interface GreedyBenchmarkCase {
  name: string;
  description: string;
  grid: Grid;
  params: SolverParams;
}

export interface GreedyBenchmarkRunOptions {
  names?: string[];
  greedy?: Partial<GreedyBenchmarkOptions>;
}

export interface GreedyBenchmarkCaseResult {
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  greedyOptions: GreedyBenchmarkOptions;
  greedyProfile: GreedyProfile | null;
  progressSummary: SolverProgressSummary;
  wallClockSeconds: number;
}

export interface GreedyBenchmarkSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  results: GreedyBenchmarkCaseResult[];
}

type GreedyBenchmarkSnapshotProfile = Omit<GreedyProfile, "phases"> & {
  phases: Array<Omit<GreedyProfilePhaseSummary, "elapsedMs">>;
};

export interface GreedyBenchmarkSnapshotCaseResult extends Omit<
  GreedyBenchmarkCaseResult,
  "wallClockSeconds" | "greedyProfile"
> {
  greedyProfile: GreedyBenchmarkSnapshotProfile | null;
}

export interface GreedyBenchmarkSnapshot {
  caseCount: number;
  selectedCaseNames: string[];
  results: GreedyBenchmarkSnapshotCaseResult[];
}

export const DEFAULT_GREEDY_BENCHMARK_OPTIONS = Object.freeze({
  localSearch: true,
  localSearchServiceMoves: true,
  localSearchServiceCandidateLimit: 6,
  deferRoadCommitment: false,
  profile: true,
  randomSeed: 7,
  restarts: 2,
  serviceRefineIterations: 1,
  serviceRefineCandidateLimit: 12,
  exhaustiveServiceSearch: false,
  serviceExactPoolLimit: 8,
  serviceExactMaxCombinations: 256
} satisfies Required<
  Pick<
    GreedyOptions,
    | "localSearch"
    | "localSearchServiceMoves"
    | "localSearchServiceCandidateLimit"
    | "deferRoadCommitment"
    | "profile"
    | "randomSeed"
    | "restarts"
    | "serviceRefineIterations"
    | "serviceRefineCandidateLimit"
    | "exhaustiveServiceSearch"
    | "serviceExactPoolLimit"
    | "serviceExactMaxCombinations"
  >
>);

export function normalizeGreedyBenchmarkOptions(
  greedy: GreedyBenchmarkOptions | undefined,
  overrides: Partial<GreedyBenchmarkOptions> | undefined
): GreedyBenchmarkOptions {
  return applyBenchmarkOptionDefaults(greedy, overrides, DEFAULT_GREEDY_BENCHMARK_OPTIONS);
}

function buildBenchmarkParams(
  benchmarkCase: GreedyBenchmarkCase,
  overrides?: Partial<GreedyBenchmarkOptions>
): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const normalizedGreedy = normalizeGreedyBenchmarkOptions(
    inheritGreedyBenchmarkOptions<GreedyBenchmarkOptions>(params),
    overrides
  );
  return applyNormalizedGreedyBenchmarkParams(params, normalizedGreedy, "greedy");
}

function selectBenchmarkCases(
  corpus: readonly GreedyBenchmarkCase[],
  names: readonly string[] | undefined
): GreedyBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "greedy benchmark",
    corpusLabel: "Greedy benchmark"
  });
}

export function listGreedyBenchmarkCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_BENCHMARK_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "greedy benchmark",
    corpusLabel: "Greedy benchmark"
  });
}

function runGreedyBenchmarkCase(
  benchmarkCase: GreedyBenchmarkCase,
  options?: GreedyBenchmarkRunOptions
): GreedyBenchmarkCaseResult {
  const params = buildBenchmarkParams(benchmarkCase, options?.greedy);
  const startedAt = performance.now();
  const solution = solveGreedy(cloneBenchmarkGrid(benchmarkCase.grid), params);
  const finishedAt = performance.now();
  const wallClockSeconds = (finishedAt - startedAt) / 1000;

  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    gridRows: benchmarkCase.grid.length,
    gridCols: benchmarkCase.grid[0]?.length ?? 0,
    totalPopulation: solution.totalPopulation,
    roadCount: solution.roads.size,
    serviceCount: solution.services.length,
    residentialCount: solution.residentials.length,
    greedyOptions: cloneBenchmarkOptions(params.greedy ?? {}),
    greedyProfile: solution.greedyProfile ?? null,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "greedy",
      params
    }),
    wallClockSeconds
  };
}

export function runGreedyBenchmarkSuite(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_BENCHMARK_CORPUS,
  options?: GreedyBenchmarkRunOptions
): GreedyBenchmarkSuiteResult {
  const selected = selectBenchmarkCases(corpus, options?.names);
  assertBenchmarkCasesSelected(selected, "No greedy benchmark cases matched the requested names.");

  const results = selected.map((benchmarkCase) => runGreedyBenchmarkCase(benchmarkCase, options));
  return {
    ...buildBenchmarkSuiteMetadata(results.map((result) => result.name)),
    results
  };
}

export function createGreedyBenchmarkSnapshot(result: GreedyBenchmarkSuiteResult): GreedyBenchmarkSnapshot {
  return {
    caseCount: result.caseCount,
    selectedCaseNames: [...result.selectedCaseNames],
    results: result.results.map(
      ({ wallClockSeconds: _wallClockSeconds, greedyProfile, progressSummary, ...benchmark }) => ({
        ...benchmark,
        progressSummary: {
          ...progressSummary,
          elapsedTimeSeconds: null
        },
        greedyProfile: greedyProfile
          ? {
              counters: structuredClone(greedyProfile.counters),
              phases: greedyProfile.phases.map(({ elapsedMs: _elapsedMs, ...phase }) => ({ ...phase })),
              connectivityShadowDecisions: structuredClone(greedyProfile.connectivityShadowDecisions ?? []),
              connectivityShadowDecisionTraceLimit: greedyProfile.connectivityShadowDecisionTraceLimit,
              roadOpportunityTraces: structuredClone(greedyProfile.roadOpportunityTraces ?? []),
              roadOpportunityTraceLimit: greedyProfile.roadOpportunityTraceLimit
            }
          : null
      })
    )
  };
}

export { formatGreedyBenchmarkSuite } from "./greedyFormatting.js";

export const DEFAULT_GREEDY_BENCHMARK_CORPUS: readonly GreedyBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-baseline",
    description: "Tiny typed-housing greedy baseline with no services.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 }
      ],
      availableBuildings: { services: 0, residentials: 2 },
      greedy: {
        localSearch: false,
        randomSeed: 5,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16
      }
    }
  },
  {
    name: "compact-service-single",
    description: "Small mixed case for service placement and profiling baselines.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 }],
      residentialSettings: {
        "2x2": { min: 100, max: 180 },
        "2x3": { min: 140, max: 240 }
      },
      availableBuildings: { services: 1, residentials: 2 },
      greedy: {
        localSearch: false,
        randomSeed: 11,
        restarts: 1,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 32
      }
    }
  },
  {
    name: "cap-sweep-mixed",
    description: "Mixed typed case that exercises cap sweep, restarts, and residential local search.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 70, range: 1, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 4 },
        { w: 2, h: 3, min: 90, max: 180, avail: 2 }
      ],
      greedy: {
        localSearch: true,
        randomSeed: 17,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "bridge-connectivity-heavy",
    description: "Deterministic mixed case that keeps connectivity probes hot across a bridge corridor.",
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 0, 0, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 60, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 160, avail: 2 },
        { w: 2, h: 3, min: 120, max: 220, avail: 1 }
      ],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: {
        localSearch: true,
        randomSeed: 23,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "geometry-occupancy-hot-path",
    description: "Larger mixed case that keeps rectangle overlap, border, effect-zone, and road probes hot.",
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 0, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 40, range: 1, avail: 3 },
        { rows: 2, cols: 2, bonus: 70, range: 2, avail: 2 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 70, max: 130, avail: 7 },
        { w: 2, h: 3, min: 110, max: 200, avail: 4 }
      ],
      greedy: {
        localSearch: true,
        randomSeed: 71,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "typed-footprint-pressure",
    description: "Typed 2x2 variants share footprints, and a second service keeps the dynamic grouped scorer hot.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 1, bonus: 40, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 35, max: 150, avail: 1 },
        { w: 2, h: 2, min: 35, max: 95, avail: 4 },
        { w: 2, h: 3, min: 80, max: 150, avail: 2 }
      ],
      availableBuildings: { services: 2, residentials: 4 },
      greedy: {
        localSearch: true,
        randomSeed: 37,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "typed-availability-pressure",
    description: "Low-availability premium typed housing should stay discounted across repeated service rescoring.",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 65, range: 2, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 45, max: 180, avail: 1 },
        { w: 2, h: 2, min: 45, max: 110, avail: 6 }
      ],
      availableBuildings: { services: 2, residentials: 5 },
      greedy: {
        localSearch: true,
        randomSeed: 41,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "adaptive-cap-search-wide",
    description: "Wide service availability case that should use coarse-to-fine cap search instead of a full sweep.",
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 32, range: 1, avail: 5 },
        { rows: 2, cols: 2, bonus: 58, range: 1, avail: 3 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 8 },
        { w: 2, h: 3, min: 95, max: 175, avail: 4 }
      ],
      greedy: {
        localSearch: true,
        randomSeed: 47,
        restarts: 3,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 12,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 10,
        serviceExactMaxCombinations: 96
      }
    }
  },
  {
    name: "crowded-invalidation-heavy",
    description: "Dense mixed case that should invalidate overlapping service and residential candidates aggressively.",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 36, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 62, range: 1, avail: 2 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 70, max: 130, avail: 5 },
        { w: 2, h: 3, min: 105, max: 185, avail: 3 }
      ],
      greedy: {
        localSearch: true,
        randomSeed: 59,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "deferred-road-packing-gain",
    description: "Packing-heavy case that exercises deferred road materialization against the road-anchor boundary.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 0, 1, 0, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 55, range: 1, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 4 },
        { w: 2, h: 3, min: 90, max: 170, avail: 2 }
      ],
      greedy: {
        localSearch: false,
        deferRoadCommitment: true,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 6,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 32
      }
    }
  },
  {
    name: "fixed-service-realization-complete",
    description:
      "Refinement/exhaustive reruns should evaluate a forced service set across bounded orders and road-anchor seeds.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 }
      ],
      greedy: {
        localSearch: false,
        randomSeed: 13,
        restarts: 1,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: true,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "service-master-decomposition-experiment",
    description:
      "Experimental service-layout master pass should reroute a tempting facility pick through residential/road realization.",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 27, range: 1, avail: 2 },
        { rows: 1, cols: 2, bonus: 70, range: 1, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 58, max: 156, avail: 5 },
        { w: 2, h: 3, min: 117, max: 155, avail: 3 }
      ],
      availableBuildings: { services: 2, residentials: 6 },
      greedy: {
        localSearch: false,
        localSearchServiceMoves: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64,
        serviceMasterDecomposition: true,
        serviceMasterPoolLimit: 10,
        serviceMasterMaxLayouts: 256
      }
    }
  },
  {
    name: "service-local-neighborhood",
    description:
      "Bounded service local search should evaluate service add/remove/swap moves even when coarse service refinement is disabled.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 }
      ],
      greedy: {
        localSearch: true,
        randomSeed: 13,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "step14-service-lookahead-reranker",
    description:
      "Isolated Step 14 case where service lookahead should improve the greedy incumbent without service local search, refinement, or exhaustive reruns.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 }
      ],
      greedy: {
        localSearch: true,
        localSearchServiceMoves: false,
        randomSeed: 13,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64,
        serviceLookaheadCandidates: 4
      } as GreedyBenchmarkOptions
    }
  },
  {
    name: "step14-deterministic-lookahead-ties",
    description:
      "Symmetric Step 14 tie case where lookahead should stay deterministic while picking a tied service/residential refill layout.",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 60, max: 120, avail: 2 }],
      greedy: {
        localSearch: false,
        localSearchServiceMoves: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 32,
        serviceLookaheadCandidates: 4
      } as GreedyBenchmarkOptions
    }
  },
  {
    name: "step14-row0-path-null-reservation",
    description:
      "Step 14 road-anchor edge case where lookahead should keep a path:null boundary service and reserve exactly one anchor road cell for the refill.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 2 },
        { w: 2, h: 3, min: 90, max: 170, avail: 1 }
      ],
      greedy: {
        localSearch: false,
        localSearchServiceMoves: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 32,
        serviceLookaheadCandidates: 4
      } as GreedyBenchmarkOptions
    }
  },
  {
    name: "step14-scarce-type-sequential-refill",
    description:
      "Step 14 scarce-type case where lookahead should spend one premium typed refill before falling back to the cheaper sequential refill.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 1 },
        { w: 2, h: 2, min: 60, max: 90, avail: 3 }
      ],
      greedy: {
        localSearch: false,
        localSearchServiceMoves: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 32,
        serviceLookaheadCandidates: 4
      } as GreedyBenchmarkOptions
    }
  },
  {
    name: "deterministic-tie-breaks",
    description:
      "Tie-heavy case that exercises deterministic residential tie resolution in the fixed benchmark corpus.",
    grid: [
      [1, 1, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [{ w: 2, h: 2, min: 40, max: 40, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
      greedy: {
        localSearch: false,
        randomSeed: 31,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16
      }
    }
  }
]);
