import { performance } from "node:perf_hooks";

import { buildSolverProgressSummary, formatSolverProgressSummary } from "../core/progress.js";
import { solveGreedy } from "../greedy/solver.js";

import type {
  GreedyOptions,
  GreedyProfile,
  GreedyProfilePhaseSummary,
  GreedyRoadOpportunityCounterfactualTrace,
  GreedyRoadOpportunityTrace,
  Grid,
  SolverParams,
  SolverProgressSummary,
} from "../core/types.js";

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

export interface GreedyBenchmarkSnapshotCaseResult
  extends Omit<GreedyBenchmarkCaseResult, "wallClockSeconds" | "greedyProfile"> {
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
  serviceExactMaxCombinations: 256,
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

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cloneSolverParams(params: SolverParams): SolverParams {
  return structuredClone(params);
}

function cloneGreedyOptions(options: GreedyBenchmarkOptions): GreedyBenchmarkOptions {
  return structuredClone(options);
}

function inheritGreedyBenchmarkOptions(params: SolverParams): GreedyBenchmarkOptions {
  const benchmarkGreedy = (params.greedy ?? {}) as GreedyBenchmarkOptions;
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

function applyNormalizedGreedyBenchmarkParams(
  params: SolverParams,
  greedy: GreedyBenchmarkOptions
): SolverParams {
  return {
    ...params,
    optimizer: "greedy",
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

export function normalizeGreedyBenchmarkOptions(
  greedy: GreedyBenchmarkOptions | undefined,
  overrides: Partial<GreedyBenchmarkOptions> | undefined
): GreedyBenchmarkOptions {
  const merged = { ...(greedy ?? {}), ...(overrides ?? {}) };
  return {
    ...merged,
    localSearch: merged.localSearch ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.localSearch,
    localSearchServiceMoves:
      merged.localSearchServiceMoves ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.localSearchServiceMoves,
    localSearchServiceCandidateLimit:
      merged.localSearchServiceCandidateLimit ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.localSearchServiceCandidateLimit,
    deferRoadCommitment: merged.deferRoadCommitment ?? DEFAULT_GREEDY_BENCHMARK_OPTIONS.deferRoadCommitment,
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

function buildBenchmarkParams(
  benchmarkCase: GreedyBenchmarkCase,
  overrides?: Partial<GreedyBenchmarkOptions>
): SolverParams {
  const params = cloneSolverParams(benchmarkCase.params);
  const normalizedGreedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions(params), overrides);
  return applyNormalizedGreedyBenchmarkParams(params, normalizedGreedy);
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
    greedyOptions: cloneGreedyOptions(params.greedy ?? {}),
    greedyProfile: solution.greedyProfile ?? null,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "greedy",
      params,
    }),
    wallClockSeconds,
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
    results: result.results.map(({ wallClockSeconds: _wallClockSeconds, greedyProfile, progressSummary, ...benchmark }) => ({
      ...benchmark,
      progressSummary: {
        ...progressSummary,
        elapsedTimeSeconds: null,
      },
      greedyProfile: greedyProfile
        ? {
            counters: structuredClone(greedyProfile.counters),
            phases: greedyProfile.phases.map(({ elapsedMs: _elapsedMs, ...phase }) => ({ ...phase })),
            connectivityShadowDecisions: structuredClone(greedyProfile.connectivityShadowDecisions ?? []),
            connectivityShadowDecisionTraceLimit: greedyProfile.connectivityShadowDecisionTraceLimit,
            roadOpportunityTraces: structuredClone(greedyProfile.roadOpportunityTraces ?? []),
            roadOpportunityTraceLimit: greedyProfile.roadOpportunityTraceLimit,
          }
        : null,
    })),
  };
}

function formatProfilePhaseSummary(phase: GreedyProfilePhaseSummary): string {
  return `${phase.name}:${phase.runs}x/${phase.elapsedMs.toFixed(3)}ms/best+${phase.bestPopulationDelta}/candidate+${phase.candidatePopulationDelta}`;
}

function formatPlacementTrace(placement: {
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
}): string {
  const extras = [
    placement.typeIndex === undefined ? null : `type:${placement.typeIndex}`,
    placement.bonus === undefined ? null : `bonus:${placement.bonus}`,
    placement.range === undefined ? null : `range:${placement.range}`,
  ].filter((entry): entry is string => entry !== null);
  return `r${placement.r}c${placement.c} ${placement.rows}x${placement.cols} road:${placement.roadCost}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function formatRoadOpportunityTrace(trace: GreedyRoadOpportunityTrace): string {
  const extras = [
    trace.score === undefined ? null : `score:${trace.score}`,
    trace.typeIndex === undefined ? null : `type:${trace.typeIndex}`,
    trace.bonus === undefined ? null : `bonus:${trace.bonus}`,
    trace.range === undefined ? null : `range:${trace.range}`,
    trace.moveKind === undefined ? null : `move:${trace.moveKind}`,
    `counterfactuals:${trace.counterfactuals?.length ?? 0}`,
  ].filter((entry): entry is string => entry !== null);
  return `${trace.phase} r${trace.r}c${trace.c} ${trace.rows}x${trace.cols} road:${trace.roadCost} reachable:${trace.reachableBefore}->${trace.reachableAfter} lost:${trace.lostCells} footprint:${trace.footprintCells} disconnected:${trace.disconnectedCells}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function formatRoadOpportunityCounterfactual(counterfactual: GreedyRoadOpportunityCounterfactualTrace): string {
  const extras = [
    counterfactual.typeIndex === undefined ? null : `type:${counterfactual.typeIndex}`,
    counterfactual.bonus === undefined ? null : `bonus:${counterfactual.bonus}`,
    counterfactual.range === undefined ? null : `range:${counterfactual.range}`,
    counterfactual.moveKind === undefined ? null : `move:${counterfactual.moveKind}`,
    counterfactual.tieBreakComparison === undefined ? null : `tie:${counterfactual.tieBreakComparison}`,
  ].filter((entry): entry is string => entry !== null);
  return `reason:${counterfactual.reason} rejected:r${counterfactual.r}c${counterfactual.c} ${counterfactual.rows}x${counterfactual.cols} road:${counterfactual.roadCost} score:${counterfactual.score} score-delta:${formatSignedNumber(counterfactual.scoreDelta)} road-delta:${formatSignedNumber(counterfactual.roadCostDelta)} reachable:${counterfactual.reachableBefore}->${counterfactual.reachableAfter} lost:${counterfactual.lostCells} footprint:${counterfactual.footprintCells} disconnected:${counterfactual.disconnectedCells}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function selectRoadOpportunityTraceSamples(
  traces: readonly GreedyRoadOpportunityTrace[],
  limit: number
): GreedyRoadOpportunityTrace[] {
  const localSearchTraces = traces.filter((trace) =>
    trace.phase === "service-neighborhood" || trace.phase === "residential-local-search"
  );
  const constructiveTraces = traces.filter((trace) =>
    trace.phase !== "service-neighborhood" && trace.phase !== "residential-local-search"
  );
  return [...localSearchTraces, ...constructiveTraces].slice(0, limit);
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
      `  population=${benchmark.totalPopulation} wall=${benchmark.wallClockSeconds.toFixed(3)}s roads=${benchmark.roadCount} services=${benchmark.serviceCount} residentials=${benchmark.residentialCount}`
    );
    lines.push(`  progress=${formatSolverProgressSummary(benchmark.progressSummary)}`);
    if (counters) {
      const roadOpportunityCounterfactualCount =
        benchmark.greedyProfile?.roadOpportunityTraces?.reduce(
          (sum, trace) => sum + (trace.counterfactuals?.length ?? 0),
          0
        ) ?? 0;
      lines.push(
        `  scans=svc:${counters.servicePhase.candidateScans} res:${counters.residentialPhase.candidateScans} local:${counters.localSearch.candidateScans} roads(connect=${counters.roads.canConnectChecks}, ensure=${counters.roads.ensureConnectedCalls}, probes=${counters.roads.probeCalls}, reuse=${counters.roads.probeReuses}, scratch=${counters.roads.scratchProbeCalls})`
      );
      lines.push(
        `  grouped-score=groups:${counters.precompute.residentialScoringGroups} collapsed:${counters.precompute.residentialScoringVariantsCollapsed} coverage:${counters.precompute.serviceCoverageGroups} static-evals:${counters.precompute.serviceStaticScoreGroupEvaluations} phase-lookups:${counters.servicePhase.groupedScoreLookups} discounted:${counters.precompute.serviceStaticAvailabilityDiscountedGroups + counters.servicePhase.availabilityDiscountedGroups}`
      );
      lines.push(
        `  pop-cache=entries:${counters.precompute.residentialPopulationCacheEntries} res-lookups:${counters.residentialPhase.populationCacheLookups} local-lookups:${counters.localSearch.populationCacheLookups}`
      );
      lines.push(
        `  local-service=remove:${counters.localSearch.serviceRemoveChecks} add:${counters.localSearch.serviceAddChecks} swap:${counters.localSearch.serviceSwapChecks} improvements:${counters.localSearch.serviceNeighborhoodImprovements}`
      );
      lines.push(
        `  attempts=caps:${counters.attempts.serviceCaps} restarts:${counters.attempts.restarts} refine:${counters.attempts.serviceRefineTrials} exhaustive:${counters.attempts.exhaustiveTrials} fixed-set:${counters.attempts.fixedServiceRealizationTrials}`
      );
      lines.push(
        `  phases=${benchmark.greedyProfile?.phases.map(formatProfilePhaseSummary).join(", ") ?? "n/a"}`
      );
      lines.push(
        `  cap-search=evaluated:${counters.attempts.serviceCaps} coarse:${counters.attempts.coarseCaps} refine:${counters.attempts.refineCaps} skipped:${counters.attempts.capsSkipped} restart-caps:${counters.attempts.restartCaps}`
      );
      lines.push(
        `  invalidation=svc-invalid:${counters.servicePhase.candidateInvalidations} svc-type:${counters.servicePhase.typeInvalidations} svc-dirty:${counters.servicePhase.scoreDirtyMarks} svc-rescore:${counters.servicePhase.scoreRecomputes} res-invalid:${counters.residentialPhase.candidateInvalidations} res-type:${counters.residentialPhase.typeInvalidations}`
      );
      lines.push(
        `  deferred-roads=frontier:${counters.roads.deferredFrontierRecomputes} rebuild-steps:${counters.roads.deferredReconstructionSteps} rebuild-failures:${counters.roads.deferredReconstructionFailures}`
      );
      lines.push(
        `  connectivity-shadow=checks:${counters.roads.connectivityShadowChecks} lost:${counters.roads.connectivityShadowLostCells} footprint:${counters.roads.connectivityShadowFootprintCells} disconnected:${counters.roads.connectivityShadowDisconnectedCells} max-lost:${counters.roads.connectivityShadowMaxLostCells} max-disconnected:${counters.roads.connectivityShadowMaxDisconnectedCells}`
      );
      lines.push(
        `  connectivity-shadow-scoring=ties:${counters.roads.connectivityShadowScoreTies} wins:${counters.roads.connectivityShadowScoreWins} losses:${counters.roads.connectivityShadowScoreLosses} neutral:${counters.roads.connectivityShadowScoreNeutral} trace:${benchmark.greedyProfile?.connectivityShadowDecisions?.length ?? 0}/${benchmark.greedyProfile?.connectivityShadowDecisionTraceLimit ?? 0}`
      );
      for (const decision of benchmark.greedyProfile?.connectivityShadowDecisions?.slice(0, 5) ?? []) {
        lines.push(
          `  shadow-decision=${decision.phase} score:${decision.score} chosen:[${formatPlacementTrace(decision.chosen)}] rejected:[${formatPlacementTrace(decision.rejected)}] penalties:cand=${decision.candidateShadowPenalty} inc=${decision.incumbentShadowPenalty}`
        );
      }
      lines.push(
        `  road-opportunity=checks:${counters.roads.roadOpportunityChecks} lost:${counters.roads.roadOpportunityLostCells} footprint:${counters.roads.roadOpportunityFootprintCells} disconnected:${counters.roads.roadOpportunityDisconnectedCells} max-lost:${counters.roads.roadOpportunityMaxLostCells} max-disconnected:${counters.roads.roadOpportunityMaxDisconnectedCells} trace:${benchmark.greedyProfile?.roadOpportunityTraces?.length ?? 0}/${benchmark.greedyProfile?.roadOpportunityTraceLimit ?? 0} counterfactuals:${roadOpportunityCounterfactualCount}`
      );
      for (const trace of selectRoadOpportunityTraceSamples(benchmark.greedyProfile?.roadOpportunityTraces ?? [], 5)) {
        lines.push(`  road-opportunity-placement=${formatRoadOpportunityTrace(trace)}`);
        for (const counterfactual of trace.counterfactuals?.slice(0, 3) ?? []) {
          lines.push(`  road-opportunity-counterfactual=${formatRoadOpportunityCounterfactual(counterfactual)}`);
        }
      }
      lines.push(
        `  step13=geometry:${counters.precompute.geometryCacheEntries} occupancy-scratch:${counters.localSearch.occupancyScratchReuses} road-scratch:${counters.roads.scratchProbeCalls}`
      );
      lines.push(
        `  step14=lookahead:${counters.servicePhase.lookaheadEvaluations} res-scans:${counters.servicePhase.lookaheadResidentialScans} wins:${counters.servicePhase.lookaheadWins}`
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
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 40, range: 1, avail: 3 },
        { rows: 2, cols: 2, bonus: 70, range: 2, avail: 2 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 70, max: 130, avail: 7 },
        { w: 2, h: 3, min: 110, max: 200, avail: 4 },
      ],
      greedy: {
        localSearch: true,
        randomSeed: 71,
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
    name: "typed-footprint-pressure",
    description: "Typed 2x2 variants share footprints, and a second service keeps the dynamic grouped scorer hot.",
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
        { rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 1, bonus: 40, range: 2, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 35, max: 150, avail: 1 },
        { w: 2, h: 2, min: 35, max: 95, avail: 4 },
        { w: 2, h: 3, min: 80, max: 150, avail: 2 },
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
        serviceExactMaxCombinations: 64,
      },
    },
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
      [1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 65, range: 2, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 45, max: 180, avail: 1 },
        { w: 2, h: 2, min: 45, max: 110, avail: 6 },
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
        serviceExactMaxCombinations: 64,
      },
    },
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
      [1, 1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 32, range: 1, avail: 5 },
        { rows: 2, cols: 2, bonus: 58, range: 1, avail: 3 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 8 },
        { w: 2, h: 3, min: 95, max: 175, avail: 4 },
      ],
      greedy: {
        localSearch: true,
        randomSeed: 47,
        restarts: 3,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 12,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 10,
        serviceExactMaxCombinations: 96,
      },
    },
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
      [1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 36, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 62, range: 1, avail: 2 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 70, max: 130, avail: 5 },
        { w: 2, h: 3, min: 105, max: 185, avail: 3 },
      ],
      greedy: {
        localSearch: true,
        randomSeed: 59,
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
    name: "deferred-road-packing-gain",
    description: "Packing-heavy case where deferred road commitment finds a stronger valid explicit-road realization.",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 0, 1, 0, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 55, range: 1, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 4 },
        { w: 2, h: 3, min: 90, max: 170, avail: 2 },
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
        serviceExactMaxCombinations: 32,
      },
    },
  },
  {
    name: "fixed-service-realization-complete",
    description: "Refinement/exhaustive reruns should evaluate a forced service set across bounded orders and row-0 seeds.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 },
      ],
      greedy: {
        localSearch: false,
        randomSeed: 13,
        restarts: 1,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: true,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64,
      },
    },
  },
  {
    name: "service-local-neighborhood",
    description: "Bounded service local search should improve the incumbent even when coarse service refinement is disabled.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 },
      ],
      greedy: {
        localSearch: true,
        randomSeed: 13,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 6,
        serviceExactMaxCombinations: 64,
      },
    },
  },
  {
    name: "step14-service-lookahead-reranker",
    description: "Isolated Step 14 case where service lookahead should improve the greedy incumbent without service local search, refinement, or exhaustive reruns.",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
        { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 5 },
        { w: 2, h: 3, min: 90, max: 170, avail: 3 },
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
        serviceLookaheadCandidates: 4,
      } as GreedyBenchmarkOptions,
    },
  },
  {
    name: "step14-deterministic-lookahead-ties",
    description: "Symmetric Step 14 tie case where lookahead should stay deterministic while picking a tied service/residential refill layout.",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
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
        serviceLookaheadCandidates: 4,
      } as GreedyBenchmarkOptions,
    },
  },
  {
    name: "step14-row0-path-null-reservation",
    description: "Step 14 row-0 edge case where lookahead should keep a path:null top-row service and reserve exactly one anchor road cell for the refill.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 2 },
        { w: 2, h: 3, min: 90, max: 170, avail: 1 },
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
        serviceLookaheadCandidates: 4,
      } as GreedyBenchmarkOptions,
    },
  },
  {
    name: "step14-scarce-type-sequential-refill",
    description: "Step 14 scarce-type case where lookahead should spend one premium typed refill before falling back to the cheaper sequential refill.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 }],
      residentialTypes: [
        { w: 2, h: 2, min: 60, max: 120, avail: 1 },
        { w: 2, h: 2, min: 60, max: 90, avail: 3 },
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
        serviceLookaheadCandidates: 4,
      } as GreedyBenchmarkOptions,
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
