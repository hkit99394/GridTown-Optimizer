import { performance } from "node:perf_hooks";

import { buildSolverProgressSummary, formatSolverProgressSummary } from "../core/progress.js";
import { solveLns } from "../lns/solver.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";

import type {
  CpSatOptions,
  CpSatTelemetry,
  GreedyOptions,
  GreedyProfile,
  GreedyProfilePhaseSummary,
  Grid,
  LnsOptions,
  LnsTelemetry,
  SolverParams,
  SolverProgressSummary,
} from "../core/types.js";

export interface LnsBenchmarkCase {
  name: string;
  description: string;
  grid: Grid;
  params: SolverParams;
}

export interface LnsBenchmarkRunOptions {
  names?: string[];
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
}

export interface LnsBenchmarkCaseResult {
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  stoppedByUser: boolean;
  lnsOptions: LnsOptions;
  cpSatOptions: CpSatOptions;
  greedyOptions: GreedyOptions;
  cpSatStatus: string | null;
  cpSatTelemetry: CpSatTelemetry | null;
  greedyProfile: GreedyProfile | null;
  lnsTelemetry: LnsTelemetry | null;
  progressSummary: SolverProgressSummary;
  wallClockSeconds: number;
}

export interface LnsBenchmarkSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  results: LnsBenchmarkCaseResult[];
}

export interface LnsBenchmarkSnapshotCaseResult extends Omit<LnsBenchmarkCaseResult, "wallClockSeconds"> {}

export interface LnsBenchmarkSnapshot {
  caseCount: number;
  selectedCaseNames: string[];
  results: LnsBenchmarkSnapshotCaseResult[];
}

export const DEFAULT_LNS_BENCHMARK_OPTIONS: Readonly<Required<
  Pick<
    LnsOptions,
    "iterations" | "maxNoImprovementIterations" | "neighborhoodRows" | "neighborhoodCols" | "repairTimeLimitSeconds"
  >
>> = Object.freeze({
  iterations: 2,
  maxNoImprovementIterations: 2,
  neighborhoodRows: 3,
  neighborhoodCols: 3,
  repairTimeLimitSeconds: 1,
});

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

function cloneLnsOptions(options: LnsOptions): LnsOptions {
  return structuredClone(options);
}

function cloneCpSatOptions(options: CpSatOptions): CpSatOptions {
  return structuredClone(options);
}

function cloneGreedyOptions(options: GreedyOptions): GreedyOptions {
  return structuredClone(options);
}

function formatSeconds(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(3)}s` : "n/a";
}

function formatProfilePhaseSummary(phase: GreedyProfilePhaseSummary): string {
  return `${phase.name}:${phase.runs}x/${phase.elapsedMs.toFixed(3)}ms/best+${phase.bestPopulationDelta}/candidate+${phase.candidatePopulationDelta}`;
}

function inheritGreedyBenchmarkOptions(params: SolverParams): GreedyOptions {
  const benchmarkGreedy = params.greedy ?? {};
  return {
    ...benchmarkGreedy,
    localSearch: benchmarkGreedy.localSearch ?? params.localSearch,
    restarts: benchmarkGreedy.restarts ?? params.restarts,
    serviceRefineIterations: benchmarkGreedy.serviceRefineIterations ?? params.serviceRefineIterations,
    serviceRefineCandidateLimit: benchmarkGreedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit,
    exhaustiveServiceSearch: benchmarkGreedy.exhaustiveServiceSearch ?? params.exhaustiveServiceSearch,
    serviceExactPoolLimit: benchmarkGreedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit,
    serviceExactMaxCombinations: benchmarkGreedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations,
  };
}

function applyNormalizedGreedyBenchmarkParams(params: SolverParams, greedy: GreedyOptions): SolverParams {
  return {
    ...params,
    greedy,
    localSearch: greedy.localSearch,
    restarts: greedy.restarts,
    serviceRefineIterations: greedy.serviceRefineIterations,
    serviceRefineCandidateLimit: greedy.serviceRefineCandidateLimit,
    exhaustiveServiceSearch: greedy.exhaustiveServiceSearch,
    serviceExactPoolLimit: greedy.serviceExactPoolLimit,
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations,
  };
}

export function normalizeLnsBenchmarkOptions(
  lns: LnsOptions | undefined,
  overrides: Partial<LnsOptions> | undefined
): LnsOptions {
  const merged = { ...(lns ?? {}), ...(overrides ?? {}) };
  return {
    ...merged,
    iterations: merged.iterations ?? DEFAULT_LNS_BENCHMARK_OPTIONS.iterations,
    maxNoImprovementIterations:
      merged.maxNoImprovementIterations ?? DEFAULT_LNS_BENCHMARK_OPTIONS.maxNoImprovementIterations,
    neighborhoodRows: merged.neighborhoodRows ?? DEFAULT_LNS_BENCHMARK_OPTIONS.neighborhoodRows,
    neighborhoodCols: merged.neighborhoodCols ?? DEFAULT_LNS_BENCHMARK_OPTIONS.neighborhoodCols,
    repairTimeLimitSeconds: merged.repairTimeLimitSeconds ?? DEFAULT_LNS_BENCHMARK_OPTIONS.repairTimeLimitSeconds,
  };
}

function buildBenchmarkParams(benchmarkCase: LnsBenchmarkCase, options?: LnsBenchmarkRunOptions): SolverParams {
  const params = cloneSolverParams(benchmarkCase.params);
  const greedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions(params), options?.greedy);
  return {
    ...applyNormalizedGreedyBenchmarkParams(params, greedy),
    optimizer: "lns",
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, options?.cpSat),
    lns: normalizeLnsBenchmarkOptions(params.lns, options?.lns),
  };
}

function validateBenchmarkCorpus(corpus: readonly LnsBenchmarkCase[]): void {
  const names = corpus.map((benchmarkCase) => benchmarkCase.name);
  if (new Set(names).size !== names.length) {
    throw new Error("LNS benchmark corpus must use unique case names.");
  }
}

function selectBenchmarkCases(
  corpus: readonly LnsBenchmarkCase[],
  names: readonly string[] | undefined
): LnsBenchmarkCase[] {
  validateBenchmarkCorpus(corpus);
  if (!names || names.length === 0) {
    return [...corpus];
  }

  const byName = new Map(corpus.map((benchmarkCase) => [benchmarkCase.name, benchmarkCase]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown LNS benchmark case(s): ${missing.join(", ")}. Available cases: ${corpus
        .map((benchmarkCase) => benchmarkCase.name)
        .join(", ")}.`
    );
  }

  return names.map((name) => byName.get(name) as LnsBenchmarkCase);
}

export function listLnsBenchmarkCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_BENCHMARK_CORPUS
): string[] {
  validateBenchmarkCorpus(corpus);
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

function runLnsBenchmarkCase(benchmarkCase: LnsBenchmarkCase, options?: LnsBenchmarkRunOptions): LnsBenchmarkCaseResult {
  const params = buildBenchmarkParams(benchmarkCase, options);
  const startedAt = performance.now();
  const solution = solveLns(cloneGrid(benchmarkCase.grid), params);
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
    stoppedByUser: solution.stoppedByUser ?? false,
    lnsOptions: cloneLnsOptions(params.lns ?? {}),
    cpSatOptions: cloneCpSatOptions(params.cpSat ?? {}),
    greedyOptions: cloneGreedyOptions(params.greedy ?? {}),
    cpSatStatus: solution.cpSatStatus ?? null,
    cpSatTelemetry: solution.cpSatTelemetry ?? null,
    greedyProfile: solution.greedyProfile ?? null,
    lnsTelemetry: solution.lnsTelemetry ?? null,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "lns",
      params,
    }),
    wallClockSeconds,
  };
}

export function runLnsBenchmarkSuite(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_BENCHMARK_CORPUS,
  options?: LnsBenchmarkRunOptions
): LnsBenchmarkSuiteResult {
  const selected = selectBenchmarkCases(corpus, options?.names);
  if (selected.length === 0) {
    throw new Error("No LNS benchmark cases matched the requested names.");
  }

  const results = selected.map((benchmarkCase) => runLnsBenchmarkCase(benchmarkCase, options));
  return {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    selectedCaseNames: results.map((result) => result.name),
    results,
  };
}

export function createLnsBenchmarkSnapshot(result: LnsBenchmarkSuiteResult): LnsBenchmarkSnapshot {
  return {
    caseCount: result.caseCount,
    selectedCaseNames: [...result.selectedCaseNames],
    results: result.results.map(({ wallClockSeconds: _wallClockSeconds, ...benchmark }) => benchmark),
  };
}

export function formatLnsBenchmarkSuite(result: LnsBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Benchmark Suite ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push("");

  for (const benchmark of result.results) {
    const telemetry = benchmark.cpSatTelemetry;
    lines.push(`- ${benchmark.name}: ${benchmark.description}`);
    lines.push(
      `  population=${benchmark.totalPopulation} wall=${benchmark.wallClockSeconds.toFixed(3)}s roads=${benchmark.roadCount} services=${benchmark.serviceCount} residentials=${benchmark.residentialCount} stopped=${benchmark.stoppedByUser}`
    );
    lines.push(`  progress=${formatSolverProgressSummary(benchmark.progressSummary)}`);
    lines.push(
      `  lns=iterations:${benchmark.lnsOptions.iterations} no-improve:${benchmark.lnsOptions.maxNoImprovementIterations} window:${benchmark.lnsOptions.neighborhoodRows}x${benchmark.lnsOptions.neighborhoodCols} repair:${benchmark.lnsOptions.repairTimeLimitSeconds}s seed-limit:${formatSeconds(benchmark.lnsTelemetry?.seedTimeLimitSeconds)}`
    );
    if (benchmark.cpSatStatus || telemetry) {
      lines.push(
        `  cp-sat=status:${benchmark.cpSatStatus ?? "unknown"} bound:${telemetry?.bestPopulationUpperBound ?? "n/a"} gap:${telemetry?.populationGapUpperBound ?? "n/a"} branches:${telemetry?.numBranches ?? "n/a"} conflicts:${telemetry?.numConflicts ?? "n/a"}`
      );
    }
    if (benchmark.lnsTelemetry) {
      lines.push(
        `  telemetry=stop:${benchmark.lnsTelemetry.stopReason} seed:${benchmark.lnsTelemetry.seedSource} seed-wall:${formatSeconds(benchmark.lnsTelemetry.seedWallClockSeconds)} outcomes:${benchmark.lnsTelemetry.outcomes.length} improved:${benchmark.lnsTelemetry.improvingIterations} neutral:${benchmark.lnsTelemetry.neutralIterations} recoverable:${benchmark.lnsTelemetry.recoverableFailures}`
      );
    }
    if (benchmark.greedyProfile?.phases.length) {
      lines.push(`  seed-phases=${benchmark.greedyProfile.phases.map(formatProfilePhaseSummary).join(", ")}`);
    }
  }

  return lines.join("\n");
}

export const DEFAULT_LNS_BENCHMARK_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-single",
    description: "Tiny LNS baseline seeded by greedy and repaired over compact residential windows.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 2, services: 0 },
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
    name: "compact-service-repair",
    description: "Small mixed case for measuring service-aware neighborhood repair overhead.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "lns",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 180, avail: 2 },
        { w: 2, h: 3, min: 130, max: 260, avail: 1 },
      ],
      availableBuildings: { services: 1, residentials: 3 },
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
    name: "seeded-service-anchor-pressure",
    description: "Seeded LNS case where ranked service anchors find a service move that sliding windows miss.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "lns",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 100, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 300, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 4,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 0.5,
        focusedRepairTimeLimitSeconds: 0.5,
        escalatedRepairTimeLimitSeconds: 0.5,
        seedHint: {
          sourceName: "seeded-service-anchor-pressure",
          solution: {
            roads: ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,3", "2,3", "3,3", "4,3", "5,3"],
            services: [{ r: 1, c: 4, rows: 2, cols: 2, range: 1, typeIndex: 0, bonus: 100 }],
            residentials: [{ r: 4, c: 4, rows: 2, cols: 2, typeIndex: 0, population: 100 }],
            populations: [100],
            totalPopulation: 100,
          },
        },
      },
      cpSat: {
        timeLimitSeconds: 0.5,
      },
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
  {
    name: "row0-anchor-repair",
    description: "Sparse row-zero access case that exercises LNS repair around road anchors.",
    grid: [
      [1, 0, 1, 0],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: {
        localSearch: false,
        randomSeed: 23,
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
