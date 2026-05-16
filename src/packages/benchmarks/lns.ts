import { performance } from "node:perf_hooks";

import { hashString, stableStringify } from "../core/cpSatContinuation.js";
import { buildSolverProgressSummary, formatSolverProgressSummary } from "../core/index.js";
import { solveLns } from "../solvers/index.js";
import {
  applyBenchmarkOptionDefaults,
  applyNormalizedGreedyBenchmarkParams,
  assertBenchmarkCasesSelected,
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkOptions,
  cloneBenchmarkSolverParams,
  formatNullableBenchmarkSeconds as formatSeconds,
  inheritGreedyBenchmarkOptions,
  listBenchmarkCaseNames,
  selectBenchmarkCasesByName,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { GENERATED_LNS_PRESSURE_CASES } from "./lnsPressureCases.js";

import type {
  CpSatOptions,
  CpSatTelemetry,
  GreedyOptions,
  GreedyProfile,
  GreedyProfilePhaseSummary,
  Grid,
  LnsOptions,
  LnsTelemetry,
  Solution,
  SolverParams,
  SolverProgressSummary
} from "../core/index.js";

export interface LnsBenchmarkCase {
  name: string;
  description: string;
  grid: Grid;
  params: SolverParams;
  pressureFamily?: LnsReplayPressureFamily;
}

export type LnsReplayPressureFamily =
  | "baseline"
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-pressure"
  | "anchor-service"
  | "product-expansion"
  | "product-footprint"
  | "product-service"
  | "product-warm-start";

export const UNCATEGORIZED_LNS_REPLAY_PRESSURE_FAMILY = "uncategorized" as const;

export type LnsReplayPressureFamilyLabel = LnsReplayPressureFamily | typeof UNCATEGORIZED_LNS_REPLAY_PRESSURE_FAMILY;

export function getLnsReplayPressureFamily(
  benchmarkCase: Pick<LnsBenchmarkCase, "pressureFamily">
): LnsReplayPressureFamilyLabel {
  return benchmarkCase.pressureFamily ?? UNCATEGORIZED_LNS_REPLAY_PRESSURE_FAMILY;
}

export interface LnsBenchmarkRunOptions {
  names?: string[];
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
}

export interface LnsBenchmarkLayoutSnapshot {
  fingerprint: string;
  roadKeys: string[];
  serviceKeys: string[];
  residentialKeys: string[];
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
  layout: LnsBenchmarkLayoutSnapshot;
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

export const DEFAULT_LNS_BENCHMARK_OPTIONS: Readonly<
  Required<
    Pick<
      LnsOptions,
      "iterations" | "maxNoImprovementIterations" | "neighborhoodRows" | "neighborhoodCols" | "repairTimeLimitSeconds"
    >
  >
> = Object.freeze({
  iterations: 2,
  maxNoImprovementIterations: 2,
  neighborhoodRows: 3,
  neighborhoodCols: 3,
  repairTimeLimitSeconds: 1
});

function formatProfilePhaseSummary(phase: GreedyProfilePhaseSummary): string {
  return `${phase.name}:${phase.runs}x/${phase.elapsedMs.toFixed(3)}ms/best+${phase.bestPopulationDelta}/candidate+${phase.candidatePopulationDelta}`;
}

export function normalizeLnsBenchmarkOptions(
  lns: LnsOptions | undefined,
  overrides: Partial<LnsOptions> | undefined
): LnsOptions {
  return applyBenchmarkOptionDefaults(lns, overrides, DEFAULT_LNS_BENCHMARK_OPTIONS);
}

function buildBenchmarkParams(benchmarkCase: LnsBenchmarkCase, options?: LnsBenchmarkRunOptions): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const greedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions<GreedyOptions>(params), options?.greedy);
  return {
    ...applyNormalizedGreedyBenchmarkParams(params, greedy),
    optimizer: "lns",
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, options?.cpSat),
    lns: normalizeLnsBenchmarkOptions(params.lns, options?.lns)
  };
}

function sortedKeys(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function snapshotLnsBenchmarkLayout(solution: Solution): LnsBenchmarkLayoutSnapshot {
  const roadKeys = sortedKeys(solution.roads);
  const serviceKeys = sortedKeys(
    solution.services.map((service, index) => {
      const typeIndex = solution.serviceTypeIndices[index] ?? -1;
      const populationIncrease = solution.servicePopulationIncreases[index] ?? 0;
      return `${service.r},${service.c},${service.rows}x${service.cols},range=${service.range},type=${typeIndex},pop=${populationIncrease}`;
    })
  );
  const residentialKeys = sortedKeys(
    solution.residentials.map((residential, index) => {
      const typeIndex = solution.residentialTypeIndices[index] ?? -1;
      const population = solution.populations[index] ?? 0;
      return `${residential.r},${residential.c},${residential.rows}x${residential.cols},type=${typeIndex},pop=${population}`;
    })
  );
  return {
    fingerprint: `fnv1a:${hashString(stableStringify({ roadKeys, serviceKeys, residentialKeys }))}`,
    roadKeys,
    serviceKeys,
    residentialKeys
  };
}

function selectBenchmarkCases(
  corpus: readonly LnsBenchmarkCase[],
  names: readonly string[] | undefined
): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "LNS benchmark",
    corpusLabel: "LNS benchmark"
  });
}

export function listLnsBenchmarkCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_BENCHMARK_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "LNS benchmark",
    corpusLabel: "LNS benchmark"
  });
}

function runLnsBenchmarkCase(
  benchmarkCase: LnsBenchmarkCase,
  options?: LnsBenchmarkRunOptions
): LnsBenchmarkCaseResult {
  const params = buildBenchmarkParams(benchmarkCase, options);
  const startedAt = performance.now();
  const solution = solveLns(cloneBenchmarkGrid(benchmarkCase.grid), params);
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
    layout: snapshotLnsBenchmarkLayout(solution),
    stoppedByUser: solution.stoppedByUser ?? false,
    lnsOptions: cloneBenchmarkOptions(params.lns ?? {}),
    cpSatOptions: cloneBenchmarkOptions(params.cpSat ?? {}),
    greedyOptions: cloneBenchmarkOptions(params.greedy ?? {}),
    cpSatStatus: solution.cpSatStatus ?? null,
    cpSatTelemetry: solution.cpSatTelemetry ?? null,
    greedyProfile: solution.greedyProfile ?? null,
    lnsTelemetry: solution.lnsTelemetry ?? null,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "lns",
      params
    }),
    wallClockSeconds
  };
}

export function runLnsBenchmarkSuite(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_BENCHMARK_CORPUS,
  options?: LnsBenchmarkRunOptions
): LnsBenchmarkSuiteResult {
  const selected = selectBenchmarkCases(corpus, options?.names);
  assertBenchmarkCasesSelected(selected, "No LNS benchmark cases matched the requested names.");

  const results = selected.map((benchmarkCase) => runLnsBenchmarkCase(benchmarkCase, options));
  return {
    ...buildBenchmarkSuiteMetadata(results.map((result) => result.name)),
    results
  };
}

export function createLnsBenchmarkSnapshot(result: LnsBenchmarkSuiteResult): LnsBenchmarkSnapshot {
  return {
    caseCount: result.caseCount,
    selectedCaseNames: [...result.selectedCaseNames],
    results: result.results.map(({ wallClockSeconds: _wallClockSeconds, ...benchmark }) => benchmark)
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
    pressureFamily: "baseline",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 }
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
        serviceExactMaxCombinations: 16
      }
    }
  },
  {
    name: "compact-service-repair",
    description: "Small mixed case for measuring service-aware neighborhood repair overhead.",
    pressureFamily: "service-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      optimizer: "lns",
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 180, avail: 2 },
        { w: 2, h: 3, min: 130, max: 260, avail: 1 }
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
        serviceExactMaxCombinations: 64
      }
    }
  },
  {
    name: "seeded-service-anchor-pressure",
    description: "Seeded LNS case where ranked service anchors find a service move that sliding windows miss.",
    pressureFamily: "anchor-service",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
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
            totalPopulation: 100
          }
        }
      },
      cpSat: {
        timeLimitSeconds: 0.5
      },
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
  },
  {
    name: "row0-anchor-repair",
    description: "Sparse road-anchor access case that exercises LNS repair around road anchors.",
    pressureFamily: "corridor",
    grid: [
      [1, 0, 1, 0],
      [0, 0, 1, 1],
      [0, 0, 1, 1]
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
        serviceExactMaxCombinations: 16
      }
    }
  },
  ...GENERATED_LNS_PRESSURE_CASES
]);

export const DEFAULT_LNS_REPLAY_LABEL_CASE_NAMES = Object.freeze([
  "compact-service-repair",
  "seeded-service-anchor-pressure",
  "row0-anchor-repair",
  "lns-corridor-squeeze-pressure",
  "lns-gate-choke-pressure",
  "lns-footprint-mix-pressure",
  "lns-service-overlap-pressure",
  "lns-anchor-service-corner-pressure",
  "lns-gate-side-channel-pressure",
  "lns-footprint-bottleneck-pressure"
] satisfies string[]);

function selectReplayLabelCases(corpus: readonly LnsBenchmarkCase[]): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, DEFAULT_LNS_REPLAY_LABEL_CASE_NAMES, {
    caseLabel: "LNS replay label",
    corpusLabel: "LNS replay label"
  });
}

function firstAnchorRoadKey(G: Grid): string {
  for (let c = 0; c < (G[0]?.length ?? 0); c++) {
    if (G[0][c] === 1) return `0,${c}`;
  }
  for (let r = 1; r < G.length; r++) {
    if (G[r]?.[0] === 1) return `${r},0`;
  }
  throw new Error("LNS replay label weak seed requires a road-eligible row-0 or column-0 anchor cell.");
}

function buildWeakReplaySeedHint(
  benchmarkCase: Pick<LnsBenchmarkCase, "name" | "grid">
): NonNullable<LnsOptions["seedHint"]> {
  return {
    sourceName: `${benchmarkCase.name}-weak-replay-seed`,
    solution: {
      roads: [firstAnchorRoadKey(benchmarkCase.grid)],
      services: [],
      residentials: [],
      populations: [],
      totalPopulation: 0
    }
  };
}

function withReplayLabelSeedHint(benchmarkCase: LnsBenchmarkCase): LnsBenchmarkCase {
  if (benchmarkCase.params.lns?.seedHint) return benchmarkCase;
  return {
    ...benchmarkCase,
    params: {
      ...benchmarkCase.params,
      lns: {
        ...(benchmarkCase.params.lns ?? {}),
        seedHint: buildWeakReplaySeedHint(benchmarkCase)
      }
    }
  };
}

const CURATED_REPLAY_SEED_HINTS: Readonly<Partial<Record<string, NonNullable<LnsOptions["seedHint"]>>>> = Object.freeze(
  {
    "compact-service-repair": {
      sourceName: "compact-service-repair-curated-partial-service-seed",
      roadKeys: ["2,0"],
      solution: {
        roads: ["2,0"],
        services: [{ r: 0, c: 2, rows: 2, cols: 2, range: 2, typeIndex: 0, bonus: 80 }],
        residentials: [{ r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 180 }],
        populations: [180],
        totalPopulation: 180
      },
      totalPopulation: 180,
      objectiveLowerBound: 180
    },
    "lns-gate-choke-pressure": {
      sourceName: "lns-gate-choke-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0"],
      solution: {
        roads: ["0,0"],
        services: [],
        residentials: [
          { r: 1, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 90 },
          { r: 3, c: 0, rows: 2, cols: 3, typeIndex: 1, population: 150 }
        ],
        populations: [90, 150],
        totalPopulation: 240
      },
      totalPopulation: 240,
      objectiveLowerBound: 240
    },
    "lns-corridor-squeeze-pressure": {
      sourceName: "lns-corridor-squeeze-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0"],
      solution: {
        roads: ["0,0"],
        services: [{ r: 1, c: 0, rows: 2, cols: 1, range: 2, typeIndex: 0, bonus: 60 }],
        residentials: [
          { r: 3, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 140 },
          { r: 0, c: 2, rows: 2, cols: 3, typeIndex: 1, population: 200 }
        ],
        populations: [140, 200],
        totalPopulation: 340
      },
      totalPopulation: 340,
      objectiveLowerBound: 340
    },
    "lns-footprint-mix-pressure": {
      sourceName: "lns-footprint-mix-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0"],
      solution: {
        roads: ["0,0"],
        services: [{ r: 2, c: 0, rows: 1, cols: 2, range: 1, typeIndex: 0, bonus: 50 }],
        residentials: [
          { r: 0, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 130 },
          { r: 3, c: 0, rows: 3, cols: 2, typeIndex: 1, population: 220 }
        ],
        populations: [130, 220],
        totalPopulation: 350
      },
      totalPopulation: 350,
      objectiveLowerBound: 350
    },
    "row0-anchor-repair": {
      sourceName: "row0-anchor-repair-curated-first-improvement-seed",
      roadKeys: ["0,0"],
      solution: {
        roads: ["0,0"],
        services: [],
        residentials: [],
        populations: [],
        totalPopulation: 0
      },
      totalPopulation: 0,
      objectiveLowerBound: 0
    },
    "lns-service-overlap-pressure": {
      sourceName: "lns-service-overlap-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0", "2,0", "2,1"],
      solution: {
        roads: ["0,0", "2,0", "2,1"],
        services: [{ r: 0, c: 1, rows: 2, cols: 1, range: 2, typeIndex: 1, bonus: 90 }],
        residentials: [
          { r: 0, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 170 },
          { r: 3, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 170 },
          { r: 2, c: 2, rows: 2, cols: 3, typeIndex: 1, population: 250 }
        ],
        populations: [170, 170, 250],
        totalPopulation: 590
      },
      totalPopulation: 590,
      objectiveLowerBound: 590
    },
    "lns-anchor-service-corner-pressure": {
      sourceName: "lns-anchor-service-corner-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0", "3,0", "3,1"],
      solution: {
        roads: ["0,0", "3,0", "3,1"],
        services: [{ r: 1, c: 0, rows: 2, cols: 2, range: 1, typeIndex: 0, bonus: 105 }],
        residentials: [
          { r: 0, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 195 },
          { r: 3, c: 2, rows: 2, cols: 3, typeIndex: 1, population: 255 }
        ],
        populations: [195, 255],
        totalPopulation: 450
      },
      totalPopulation: 450,
      objectiveLowerBound: 450
    },
    "lns-gate-side-channel-pressure": {
      sourceName: "lns-gate-side-channel-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0"],
      solution: {
        roads: ["0,0"],
        services: [{ r: 3, c: 0, rows: 2, cols: 1, range: 2, typeIndex: 0, bonus: 75 }],
        residentials: [{ r: 1, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 165 }],
        populations: [165],
        totalPopulation: 165
      },
      totalPopulation: 165,
      objectiveLowerBound: 165
    },
    "lns-footprint-bottleneck-pressure": {
      sourceName: "lns-footprint-bottleneck-pressure-curated-first-improvement-seed",
      roadKeys: ["0,0", "2,0", "2,1"],
      solution: {
        roads: ["0,0", "2,0", "2,1"],
        services: [{ r: 1, c: 0, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 55 }],
        residentials: [
          { r: 0, c: 1, rows: 2, cols: 2, typeIndex: 0, population: 135 },
          { r: 2, c: 2, rows: 2, cols: 3, typeIndex: 1, population: 180 }
        ],
        populations: [135, 180],
        totalPopulation: 315
      },
      totalPopulation: 315,
      objectiveLowerBound: 315
    }
  }
);

function withCuratedReplaySeedHint(benchmarkCase: LnsBenchmarkCase): LnsBenchmarkCase {
  const seedHint = CURATED_REPLAY_SEED_HINTS[benchmarkCase.name];
  if (!seedHint) return benchmarkCase;
  return {
    ...benchmarkCase,
    params: {
      ...benchmarkCase.params,
      lns: {
        ...(benchmarkCase.params.lns ?? {}),
        seedHint: cloneBenchmarkOptions(seedHint)
      }
    }
  };
}

export const DEFAULT_LNS_REPLAY_LABEL_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze(
  selectReplayLabelCases(DEFAULT_LNS_BENCHMARK_CORPUS).map(withReplayLabelSeedHint)
);

export const DEFAULT_LNS_REPLAY_LABEL_NATURAL_SEED_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze(
  selectReplayLabelCases(DEFAULT_LNS_BENCHMARK_CORPUS)
);

export const DEFAULT_LNS_REPLAY_LABEL_CURATED_SEED_CORPUS: readonly LnsBenchmarkCase[] = Object.freeze(
  selectReplayLabelCases(DEFAULT_LNS_BENCHMARK_CORPUS).map(withCuratedReplaySeedHint)
);

export function listLnsReplayPressureFamilies(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_REPLAY_LABEL_CORPUS
): LnsReplayPressureFamilyLabel[] {
  return uniqueBenchmarkValuesBy(corpus, getLnsReplayPressureFamily);
}
