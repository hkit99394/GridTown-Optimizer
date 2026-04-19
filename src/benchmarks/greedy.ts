import { performance } from "node:perf_hooks";

import { solveGreedy } from "../greedy/solver.js";

import type { GreedyOptions, GreedyProfile, Grid, SolverParams } from "../core/types.js";

export interface GreedyBenchmarkCase {
  name: string;
  description: string;
  grid: Grid;
  params: SolverParams;
}

export interface GreedyBenchmarkRunOptions {
  names?: string[];
  greedy?: Partial<GreedyOptions>;
}

export interface GreedyBenchmarkCaseResult {
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  totalPopulation: number;
  serviceCount: number;
  residentialCount: number;
  greedyOptions: GreedyOptions;
  greedyProfile: GreedyProfile | null;
  wallClockSeconds: number;
}

export interface GreedyBenchmarkSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  results: GreedyBenchmarkCaseResult[];
}

export interface GreedyBenchmarkSnapshotCaseResult extends Omit<GreedyBenchmarkCaseResult, "wallClockSeconds"> {}

export interface GreedyBenchmarkSnapshot {
  caseCount: number;
  selectedCaseNames: string[];
  results: GreedyBenchmarkSnapshotCaseResult[];
}

export const DEFAULT_GREEDY_BENCHMARK_OPTIONS = Object.freeze({
  localSearch: true,
  profile: true,
  randomSeed: 7,
  restarts: 2,
  serviceRefineIterations: 1,
  serviceRefineCandidateLimit: 12,
  exhaustiveServiceSearch: false,
  serviceExactPoolLimit: 8,
  serviceExactMaxCombinations: 256,
} satisfies Required<
  Pick<
    GreedyOptions,
    | "localSearch"
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

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

function cloneGreedyOptions(options: GreedyOptions): GreedyOptions {
  return structuredClone(options);
}

export function normalizeGreedyBenchmarkOptions(
  greedy: GreedyOptions | undefined,
  overrides: Partial<GreedyOptions> | undefined
): GreedyOptions {
  const merged = { ...(greedy ?? {}), ...(overrides ?? {}) };
  return {
    ...merged,
    localSearch: merged.localSearch ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.localSearch,
    profile: merged.profile ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.profile,
    randomSeed: merged.randomSeed ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.randomSeed,
    restarts: merged.restarts ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.restarts,
    serviceRefineIterations:
      merged.serviceRefineIterations ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineIterations,
    serviceRefineCandidateLimit:
      merged.serviceRefineCandidateLimit ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineCandidateLimit,
    exhaustiveServiceSearch:
      merged.exhaustiveServiceSearch ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.exhaustiveServiceSearch,
    serviceExactPoolLimit: merged.serviceExactPoolLimit ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactPoolLimit,
    serviceExactMaxCombinations:
      merged.serviceExactMaxCombinations ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactMaxCombinations,
  };
}

function buildBenchmarkParams(benchmarkCase: GreedyBenchmarkCase, overrides?: Partial<GreedyOptions>): SolverParams {
  const params = cloneSolverParams(benchmarkCase.params);
  const normalizedGreedy = normalizeGreedyBenchmarkOptions(
    {
      localSearch: params.greedy?.localSearch ?? params.localSearch,
      profile: params.greedy?.profile,
      randomSeed: params.greedy?.randomSeed,
      restarts: params.greedy?.restarts ?? params.restarts,
      serviceRefineIterations: params.greedy?.serviceRefineIterations ?? params.serviceRefineIterations,
      serviceRefineCandidateLimit:
        params.greedy?.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit,
      exhaustiveServiceSearch: params.greedy?.exhaustiveServiceSearch ?? params.exhaustiveServiceSearch,
      serviceExactPoolLimit: params.greedy?.serviceExactPoolLimit ?? params.serviceExactPoolLimit,
      serviceExactMaxCombinations:
        params.greedy?.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations,
      stopFilePath: params.greedy?.stopFilePath,
      snapshotFilePath: params.greedy?.snapshotFilePath,
    },
    overrides
  );
  return {
    ...params,
    optimizer: "greedy",
    greedy: normalizedGreedy,
    localSearch: normalizedGreedy.localSearch,
    restarts: normalizedGreedy.restarts,
    serviceRefineIterations: normalizedGreedy.serviceRefineIterations,
    serviceRefineCandidateLimit: normalizedGreedy.serviceRefineCandidateLimit,
    exhaustiveServiceSearch: normalizedGreedy.exhaustiveServiceSearch,
    serviceExactPoolLimit: normalizedGreedy.serviceExactPoolLimit,
    serviceExactMaxCombinations: normalizedGreedy.serviceExactMaxCombinations,
  };
}

function validateBenchmarkCorpus(corpus: readonly GreedyBenchmarkCase[]): void {
  const names = corpus.map((benchmarkCase) => benchmarkCase.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Greedy benchmark corpus must use unique case names.");
  }
}

function selectBenchmarkCases(
  corpus: readonly GreedyBenchmarkCase[],
  names: readonly string[] | undefined
): GreedyBenchmarkCase[] {
  validateBenchmarkCorpus(corpus);
  if (!names || names.length === 0) {
    return [...corpus];
  }

  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown greedy benchmark case(s): ${missing.join(", ")}. Available cases: ${corpus
        .map((benchmarkCase) => benchmarkCase.name)
        .join(", ")}.`
    );
  }

  return names.map((name) => byName.get(name) as GreedyBenchmarkCase);
}

export function listGreedyBenchmarkCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_BENCHMARK_CORPUS
): string[] {
  validateBenchmarkCorpus(corpus);
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

function runGreedyBenchmarkCase(
  benchmarkCase: GreedyBenchmarkCase,
  options?: GreedyBenchmarkRunOptions
): GreedyBenchmarkCaseResult {
  const params = buildBenchmarkParams(benchmarkCase, options?.greedy);
  const startedAt = performance.now();
  const solution = solveGreedy(cloneGrid(benchmarkCase.grid), params);
  const finishedAt = performance.now();

  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    gridRows: benchmarkCase.grid.length,
    gridCols: benchmarkCase.grid[0]?.length ?? 0,
    totalPopulation: solution.totalPopulation,
    serviceCount: solution.services.length,
    residentialCount: solution.residentials.length,
    greedyOptions: cloneGreedyOptions(params.greedy ?? {}),
    greedyProfile: solution.greedyProfile ?? null,
    wallClockSeconds: (finishedAt - startedAt) / 1000,
  };
}

export function runGreedyBenchmarkSuite(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_BENCHMARK_CORPUS,
  options?: GreedyBenchmarkRunOptions
): GreedyBenchmarkSuiteResult {
  const selected = selectBenchmarkCases(corpus, options?.names);
  if (selected.length === 0) {
    throw new Error("No greedy benchmark cases matched the requested names.");
  }

  const results = selected.map((benchmarkCase) => runGreedyBenchmarkCase(benchmarkCase, options));
  return {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    selectedCaseNames: results.map((result) => result.name),
    results,
  };
}

export function createGreedyBenchmarkSnapshot(result: GreedyBenchmarkSuiteResult): GreedyBenchmarkSnapshot {
  return {
    caseCount: result.caseCount,
    selectedCaseNames: [...result.selectedCaseNames],
    results: result.results.map(({ wallClockSeconds: _wallClockSeconds, ...benchmark }) => benchmark),
  };
}

export function formatGreedyBenchmarkSuite(result: GreedyBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Greedy Benchmark Suite ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push("");

  for (const benchmark of result.results) {
    const counters = benchmark.greedyProfile?.counters;
    lines.push(`- ${benchmark.name}: ${benchmark.description}`);
    lines.push(
      `  population=${benchmark.totalPopulation} wall=${benchmark.wallClockSeconds.toFixed(3)}s services=${benchmark.serviceCount} residentials=${benchmark.residentialCount}`
    );
    if (counters) {
      lines.push(
        `  scans=svc:${counters.servicePhase.candidateScans} res:${counters.residentialPhase.candidateScans} local:${counters.localSearch.candidateScans} roads(connect=${counters.roads.canConnectChecks}, ensure=${counters.roads.ensureConnectedCalls}, probes=${counters.roads.probeCalls}, reuse=${counters.roads.probeReuses})`
      );
      lines.push(
        `  pop-cache=entries:${counters.precompute.residentialPopulationCacheEntries} res-lookups:${counters.residentialPhase.populationCacheLookups} local-lookups:${counters.localSearch.populationCacheLookups}`
      );
      lines.push(
        `  attempts=caps:${counters.attempts.serviceCaps} restarts:${counters.attempts.restarts} refine:${counters.attempts.serviceRefineTrials} exhaustive:${counters.attempts.exhaustiveTrials}`
      );
    } else {
      lines.push("  profile=disabled");
    }
  }

  return lines.join("\n");
}

export const DEFAULT_GREEDY_BENCHMARK_CORPUS: readonly GreedyBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-baseline",
    description: "Tiny typed-housing greedy baseline with no services.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
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
        serviceExactMaxCombinations: 16,
      },
    },
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
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 }],
      residentialSettings: {
        "2x2": { min: 100, max: 180 },
        "2x3": { min: 140, max: 240 },
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
        serviceExactMaxCombinations: 32,
      },
    },
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
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 70, range: 1, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 4 },
        { w: 2, h: 3, min: 90, max: 180, avail: 2 },
      ],
      greedy: {
        localSearch: true,
        randomSeed: 17,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64,
      },
    },
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
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 60, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 160, avail: 2 },
        { w: 2, h: 3, min: 120, max: 220, avail: 1 },
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
        serviceExactMaxCombinations: 64,
      },
    },
  },
  {
    name: "deterministic-tie-breaks",
    description: "Tie-heavy case that exercises deterministic residential tie resolution in the fixed benchmark corpus.",
    grid: [
      [1, 1, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
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
        serviceExactMaxCombinations: 16,
      },
    },
  },
]);
