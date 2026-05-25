import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildDecisionTraceFromSolution,
  buildTimeToQualityScorecard,
  summarizeDecisionTraceReason,
} from "../core/decisionTrace.js";
import { buildSolverProgressSummary } from "../core/progress.js";
import {
  assertValidLayoutEvaluateInputs,
  assertValidSolveInputs,
} from "../core/solverInputValidation.js";
import { solveAsync } from "../runtime/solve.js";
import {
  assertHttpPlannerInputLimits,
  assertValidSerializedSolutionPayload,
  isLayoutEvaluateRequest,
  materializeSerializedSolution,
  sanitizeSolveRequest,
} from "../server/http/contracts.js";
import { buildManualLayoutResponse, buildSolveResponse } from "../server/http/solutionResponse.js";
import {
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  listBenchmarkCaseNames,
  roundBenchmarkMetric,
  selectBenchmarkCasesByName,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  buildSolverTelemetryManifest,
  buildSolverTelemetryRunManifest,
  writeSolverTelemetryManifest,
} from "./telemetryManifest.js";

import type {
  Grid,
  ResidentialPlacement,
  ResidentialTypeSetting,
  ServicePlacement,
  ServiceTypeSetting,
  SolverDecisionTraceEvent,
  SolverParams,
  SolverProgressSummary,
  SolverTimeToQualityScorecard,
} from "../core/types.js";
import type { SolverTelemetryManifest } from "./telemetryManifest.js";

export type ProductWorkflowPressureFamily =
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-overlap"
  | "anchor-service"
  | "multi-anchor";

export type ProductWorkflowSplit = "development" | "holdout";

export interface ProductWorkflowSerializedSolution {
  roads: string[];
  services: ServicePlacement[];
  serviceTypeIndices: number[];
  servicePopulationIncreases: number[];
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  totalPopulation: number;
}

export interface ProductWorkflowExpansionCandidateSet {
  service?: ServiceTypeSetting;
  residential?: ResidentialTypeSetting;
}

export interface ProductWorkflowBenchmarkCase {
  name: string;
  description: string;
  family: ProductWorkflowPressureFamily;
  split: ProductWorkflowSplit;
  grid: Grid;
  params: SolverParams;
  manualLayout: ProductWorkflowSerializedSolution;
  expansion: ProductWorkflowExpansionCandidateSet;
}

export interface ProductWorkflowBenchmarkRunOptions {
  names?: string[];
  budgetsSeconds?: number[];
  seeds?: number[];
}

export interface ProductWorkflowPayloadValidation {
  valid: boolean;
  errors: string[];
}

export interface ProductWorkflowManualReplayResult {
  endpoint: typeof PRODUCT_WORKFLOW_LAYOUT_EVALUATE_ENDPOINT;
  valid: boolean;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  errors: string[];
}

export interface ProductWorkflowBudgetResult {
  budgetSeconds: number;
  seed: number;
  solverParams: SolverParams;
  totalPopulation: number;
  valid: boolean;
  errors: string[];
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  wallClockSeconds: number;
  progressSummary: SolverProgressSummary;
  decisionTrace: SolverDecisionTraceEvent[];
  timeToQuality: SolverTimeToQualityScorecard;
  checkpointReason: string;
}

export interface ProductWorkflowBudgetQualitySummary {
  bestBudgetSeconds: number | null;
  bestSeed: number | null;
  bestPopulation: number | null;
  deltaFromManual: number | null;
  coverageRatio: number | null;
  matchedOrBeatManual: boolean;
}

export interface ProductWorkflowExpansionResult {
  baselinePopulation: number;
  serviceCandidateName: string | null;
  servicePopulation: number | null;
  serviceDelta: number | null;
  residentialCandidateName: string | null;
  residentialPopulation: number | null;
  residentialDelta: number | null;
  winner: string;
  valid: boolean;
  errors: string[];
}

export interface ProductWorkflowBenchmarkCaseResult {
  name: string;
  description: string;
  family: ProductWorkflowPressureFamily;
  split: ProductWorkflowSplit;
  gridRows: number;
  gridCols: number;
  payloadValidation: ProductWorkflowPayloadValidation;
  manualReplay: ProductWorkflowManualReplayResult;
  budgetResults: ProductWorkflowBudgetResult[];
  budgetQuality: ProductWorkflowBudgetQualitySummary;
  expansion: ProductWorkflowExpansionResult;
  passed: boolean;
}

export interface ProductWorkflowBenchmarkRegistryHints {
  artifactType: "benchmark";
  cases: string[];
  caseFamilies: ProductWorkflowPressureFamily[];
  seeds: number[];
  splitStatus: Record<ProductWorkflowSplit, string[]>;
  budget: {
    budgetsSeconds: number[];
    optimizer: "greedy";
  };
  summaryMetrics: {
    caseCount: number;
    passedCaseCount: number;
    failedCaseCount: number;
    manualReplayCount: number;
    expansionReplayCount: number;
    budgetRunCount: number;
    manualOutperformingBudgetCaseCount: number;
    worstBestBudgetDeltaFromManual: number | null;
    averageBestBudgetDeltaFromManual: number | null;
  };
  artifactPaths: string[];
  decision: string;
  summary: string;
}

export interface ProductWorkflowBenchmarkSuiteResult {
  generatedAt: string;
  caseCount: number;
  selectedCaseNames: string[];
  passed: boolean;
  budgetsSeconds: number[];
  seeds: number[];
  results: ProductWorkflowBenchmarkCaseResult[];
  registryHints: ProductWorkflowBenchmarkRegistryHints;
}

export interface ProductWorkflowTelemetryManifestOptions extends ProductWorkflowBenchmarkRunOptions {
  manifestId?: string;
  commands?: readonly string[];
  artifactPaths?: readonly string[];
}

export const DEFAULT_PRODUCT_WORKFLOW_BUDGETS_SECONDS = Object.freeze([1, 5, 30, 120] as const);
export const DEFAULT_PRODUCT_WORKFLOW_SEEDS = Object.freeze([7] as const);
export const PRODUCT_WORKFLOW_LAYOUT_EVALUATE_ENDPOINT = "/api/layout/evaluate" as const;

function workflowSolution(
  roads: string[],
  residentials: ResidentialPlacement[],
  populations: number[],
  options: {
    residentialTypeIndices?: number[];
    services?: ServicePlacement[];
    serviceTypeIndices?: number[];
    servicePopulationIncreases?: number[];
  } = {}
): ProductWorkflowSerializedSolution {
  return {
    roads,
    services: options.services ?? [],
    serviceTypeIndices: options.serviceTypeIndices ?? [],
    servicePopulationIncreases: options.servicePopulationIncreases ?? [],
    residentials,
    residentialTypeIndices: options.residentialTypeIndices ?? residentials.map(() => 0),
    populations,
    totalPopulation: populations.reduce((sum, population) => sum + population, 0),
  };
}

function normalizePositiveNumbers(values: readonly number[] | undefined, fallback: readonly number[]): number[] {
  const source = values?.length ? values : fallback;
  for (const value of source) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error("Product workflow benchmark budgets must contain only finite numbers greater than 0.");
    }
  }
  const normalized = [...new Set(source)]
    .map((value) => roundBenchmarkMetric(value))
    .sort((left, right) => left - right);
  if (normalized.length === 0) {
    throw new Error("Product workflow benchmark requires at least one positive budget.");
  }
  return normalized;
}

function normalizeSeeds(values: readonly number[] | undefined): number[] {
  return normalizeBenchmarkSeeds(values, "Product workflow benchmark seeds")
    ?? [...DEFAULT_PRODUCT_WORKFLOW_SEEDS];
}

function buildBudgetedGreedyParams(params: SolverParams, budgetSeconds: number, seed: number): SolverParams {
  return {
    ...cloneBenchmarkSolverParams(params),
    optimizer: "greedy",
    greedy: {
      ...(params.greedy ?? {}),
      timeLimitSeconds: budgetSeconds,
      randomSeed: seed,
      localSearch: params.greedy?.localSearch ?? true,
    },
  };
}

function validatePayload(grid: Grid, params: SolverParams): ProductWorkflowPayloadValidation {
  const errors: string[] = [];
  try {
    assertValidSolveInputs(grid, params);
    assertHttpPlannerInputLimits(grid, params);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown payload validation error.");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

function cloneManualLayoutSolution(solution: ProductWorkflowSerializedSolution): ProductWorkflowSerializedSolution {
  return {
    roads: [...solution.roads],
    services: solution.services.map((service) => ({ ...service })),
    serviceTypeIndices: [...solution.serviceTypeIndices],
    servicePopulationIncreases: [...solution.servicePopulationIncreases],
    residentials: solution.residentials.map((residential) => ({ ...residential })),
    residentialTypeIndices: [...solution.residentialTypeIndices],
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation,
  };
}

function replayManualLayout(benchmarkCase: ProductWorkflowBenchmarkCase): ProductWorkflowManualReplayResult {
  const errors: string[] = [];
  const payload = {
    grid: cloneBenchmarkGrid(benchmarkCase.grid),
    params: cloneBenchmarkSolverParams(benchmarkCase.params),
    solution: cloneManualLayoutSolution(benchmarkCase.manualLayout),
  };
  try {
    if (!isLayoutEvaluateRequest(payload)) {
      throw new Error("Invalid layout-evaluate payload. Expected { grid, params, solution } with a rectangular 0/1 grid.");
    }
    const sanitized = sanitizeSolveRequest(payload);
    assertValidLayoutEvaluateInputs(sanitized.grid, sanitized.params);
    assertHttpPlannerInputLimits(sanitized.grid, sanitized.params);
    assertValidSerializedSolutionPayload(sanitized.solution, "Manual layout solution");
    const response = buildManualLayoutResponse(
      sanitized.grid,
      sanitized.params,
      materializeSerializedSolution(sanitized.solution)
    );
    return {
      endpoint: PRODUCT_WORKFLOW_LAYOUT_EVALUATE_ENDPOINT,
      valid: response.validation.valid,
      totalPopulation: response.stats.totalPopulation,
      roadCount: response.stats.roadCount,
      serviceCount: response.stats.serviceCount,
      residentialCount: response.stats.residentialCount,
      errors: response.validation.errors,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown layout-evaluate replay error.");
  }
  return {
    endpoint: PRODUCT_WORKFLOW_LAYOUT_EVALUATE_ENDPOINT,
    valid: false,
    totalPopulation: 0,
    roadCount: 0,
    serviceCount: 0,
    residentialCount: 0,
    errors,
  };
}

async function runBudgetSample(
  benchmarkCase: ProductWorkflowBenchmarkCase,
  budgetSeconds: number,
  seed: number
): Promise<ProductWorkflowBudgetResult> {
  const params = buildBudgetedGreedyParams(benchmarkCase.params, budgetSeconds, seed);
  const startedAt = performance.now();
  const solution = await solveAsync(cloneBenchmarkGrid(benchmarkCase.grid), params);
  const wallClockSeconds = roundBenchmarkMetric((performance.now() - startedAt) / 1000);
  const response = buildSolveResponse(benchmarkCase.grid, params, solution);
  const decisionTrace = buildDecisionTraceFromSolution(solution, {
    runId: `${benchmarkCase.name}:greedy:budget-${budgetSeconds}:seed-${seed}`,
    optimizer: "greedy",
    elapsedTimeSeconds: wallClockSeconds,
  });
  return {
    budgetSeconds,
    seed,
    solverParams: params,
    totalPopulation: response.stats.totalPopulation,
    valid: response.validation.valid,
    errors: response.validation.errors,
    roadCount: response.stats.roadCount,
    serviceCount: response.stats.serviceCount,
    residentialCount: response.stats.residentialCount,
    wallClockSeconds,
    progressSummary: buildSolverProgressSummary(solution, {
      elapsedTimeSeconds: wallClockSeconds,
      fallbackOptimizer: "greedy",
      params,
    }),
    decisionTrace,
    timeToQuality: buildTimeToQualityScorecard(decisionTrace, {
      finalElapsedMs: wallClockSeconds * 1000,
      finalScore: response.stats.totalPopulation,
    }),
    checkpointReason: summarizeDecisionTraceReason(decisionTrace),
  };
}

function compareBudgetResults(
  left: ProductWorkflowBudgetResult,
  right: ProductWorkflowBudgetResult
): ProductWorkflowBudgetResult {
  if (left.totalPopulation !== right.totalPopulation) {
    return left.totalPopulation > right.totalPopulation ? left : right;
  }
  if (left.budgetSeconds !== right.budgetSeconds) {
    return left.budgetSeconds < right.budgetSeconds ? left : right;
  }
  return left.seed <= right.seed ? left : right;
}

function summarizeBudgetQuality(
  manualReplay: ProductWorkflowManualReplayResult,
  budgetResults: readonly ProductWorkflowBudgetResult[]
): ProductWorkflowBudgetQualitySummary {
  const validBudgetResults = budgetResults.filter((budgetResult) => budgetResult.valid);
  if (validBudgetResults.length === 0) {
    return {
      bestBudgetSeconds: null,
      bestSeed: null,
      bestPopulation: null,
      deltaFromManual: null,
      coverageRatio: null,
      matchedOrBeatManual: false,
    };
  }

  const best = validBudgetResults.reduce(compareBudgetResults);
  const deltaFromManual = best.totalPopulation - manualReplay.totalPopulation;
  return {
    bestBudgetSeconds: best.budgetSeconds,
    bestSeed: best.seed,
    bestPopulation: best.totalPopulation,
    deltaFromManual,
    coverageRatio: manualReplay.totalPopulation > 0
      ? roundBenchmarkMetric(best.totalPopulation / manualReplay.totalPopulation)
      : null,
    matchedOrBeatManual: deltaFromManual >= 0,
  };
}

function expansionAvailableBuildings(
  benchmarkCase: ProductWorkflowBenchmarkCase,
  manualReplay: ProductWorkflowManualReplayResult,
  kind: "service" | "residential" | null
) {
  return {
    ...(benchmarkCase.params.availableBuildings ?? {}),
    services: manualReplay.serviceCount + (kind === "service" ? 1 : 0),
    residentials: manualReplay.residentialCount + (kind === "residential" ? 1 : 0),
  };
}

function buildExpansionParams(
  benchmarkCase: ProductWorkflowBenchmarkCase,
  manualReplay: ProductWorkflowManualReplayResult,
  kind: "service" | "residential",
  budgetSeconds: number,
  seed: number
): SolverParams {
  const params = buildBudgetedGreedyParams(benchmarkCase.params, budgetSeconds, seed);
  if (kind === "service" && benchmarkCase.expansion.service) {
    return {
      ...params,
      availableBuildings: expansionAvailableBuildings(benchmarkCase, manualReplay, kind),
      serviceTypes: [...(params.serviceTypes ?? []), benchmarkCase.expansion.service],
    };
  }
  if (kind === "residential" && benchmarkCase.expansion.residential) {
    return {
      ...params,
      availableBuildings: expansionAvailableBuildings(benchmarkCase, manualReplay, kind),
      residentialTypes: [...(params.residentialTypes ?? []), benchmarkCase.expansion.residential],
    };
  }
  return params;
}

async function runExpansionCandidate(
  benchmarkCase: ProductWorkflowBenchmarkCase,
  manualReplay: ProductWorkflowManualReplayResult,
  kind: "service" | "residential",
  budgetSeconds: number,
  seed: number
): Promise<{ population: number; valid: boolean; errors: string[] } | null> {
  if (kind === "service" && !benchmarkCase.expansion.service) return null;
  if (kind === "residential" && !benchmarkCase.expansion.residential) return null;
  const params = buildExpansionParams(benchmarkCase, manualReplay, kind, budgetSeconds, seed);
  const solution = await solveAsync(cloneBenchmarkGrid(benchmarkCase.grid), params);
  const response = buildSolveResponse(benchmarkCase.grid, params, solution);
  return {
    population: response.stats.totalPopulation,
    valid: response.validation.valid,
    errors: response.validation.errors,
  };
}

function expansionWinner(
  serviceName: string | null,
  serviceDelta: number | null,
  residentialName: string | null,
  residentialDelta: number | null
): string {
  const serviceScore = serviceDelta ?? 0;
  const residentialScore = residentialDelta ?? 0;
  if (serviceScore <= 0 && residentialScore <= 0) return "Remain current layout";
  if (serviceScore > residentialScore) return serviceName ? `Add ${serviceName}` : "Add service";
  if (residentialScore > serviceScore) return residentialName ? `Add ${residentialName}` : "Add residential";
  return "Tie";
}

async function replayExpansionComparison(
  benchmarkCase: ProductWorkflowBenchmarkCase,
  manualReplay: ProductWorkflowManualReplayResult,
  budgetSeconds: number,
  seed: number
): Promise<ProductWorkflowExpansionResult> {
  const serviceName = benchmarkCase.expansion.service?.name ?? null;
  const residentialName = benchmarkCase.expansion.residential?.name ?? null;
  const service = await runExpansionCandidate(benchmarkCase, manualReplay, "service", budgetSeconds, seed);
  const residential = await runExpansionCandidate(benchmarkCase, manualReplay, "residential", budgetSeconds, seed);
  const serviceDelta = service === null ? null : service.population - manualReplay.totalPopulation;
  const residentialDelta = residential === null ? null : residential.population - manualReplay.totalPopulation;
  const errors = [...(service?.errors ?? []), ...(residential?.errors ?? [])];
  return {
    baselinePopulation: manualReplay.totalPopulation,
    serviceCandidateName: serviceName,
    servicePopulation: service?.population ?? null,
    serviceDelta,
    residentialCandidateName: residentialName,
    residentialPopulation: residential?.population ?? null,
    residentialDelta,
    winner: expansionWinner(serviceName, serviceDelta, residentialName, residentialDelta),
    valid: (service?.valid ?? true) && (residential?.valid ?? true),
    errors,
  };
}

function selectProductWorkflowCases(
  corpus: readonly ProductWorkflowBenchmarkCase[],
  names: readonly string[] | undefined
): ProductWorkflowBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "product workflow benchmark",
    corpusLabel: "product workflow benchmark",
  });
}

function buildSplitStatus(results: readonly ProductWorkflowBenchmarkCaseResult[]): Record<ProductWorkflowSplit, string[]> {
  return {
    development: results.filter((result) => result.split === "development").map((result) => result.name),
    holdout: results.filter((result) => result.split === "holdout").map((result) => result.name),
  };
}

function uniqueFamilies(results: readonly ProductWorkflowBenchmarkCaseResult[]): ProductWorkflowPressureFamily[] {
  return [...new Set(results.map((result) => result.family))].sort();
}

function budgetQualityDeltas(results: readonly ProductWorkflowBenchmarkCaseResult[]): number[] {
  return results
    .map((result) => result.budgetQuality.deltaFromManual)
    .filter((delta): delta is number => delta !== null);
}

function buildRegistryHints(
  result: Omit<ProductWorkflowBenchmarkSuiteResult, "registryHints">,
  artifactPaths: string[] = []
): ProductWorkflowBenchmarkRegistryHints {
  const failedCaseCount = result.results.filter((caseResult) => !caseResult.passed).length;
  const qualityDeltas = budgetQualityDeltas(result.results);
  const manualOutperformingBudgetCaseCount = result.results.filter(
    (caseResult) => !caseResult.budgetQuality.matchedOrBeatManual
  ).length;
  return {
    artifactType: "benchmark",
    cases: result.selectedCaseNames,
    caseFamilies: uniqueFamilies(result.results),
    seeds: result.seeds,
    splitStatus: buildSplitStatus(result.results),
    budget: {
      budgetsSeconds: result.budgetsSeconds,
      optimizer: "greedy",
    },
    summaryMetrics: {
      caseCount: result.caseCount,
      passedCaseCount: result.caseCount - failedCaseCount,
      failedCaseCount,
      manualReplayCount: result.results.length,
      expansionReplayCount: result.results.filter((caseResult) => caseResult.expansion.servicePopulation !== null || caseResult.expansion.residentialPopulation !== null).length,
      budgetRunCount: result.results.reduce((sum, caseResult) => sum + caseResult.budgetResults.length, 0),
      manualOutperformingBudgetCaseCount,
      worstBestBudgetDeltaFromManual: qualityDeltas.length > 0
        ? Math.min(...qualityDeltas)
        : null,
      averageBestBudgetDeltaFromManual: qualityDeltas.length > 0
        ? roundBenchmarkMetric(qualityDeltas.reduce((sum, delta) => sum + delta, 0) / qualityDeltas.length)
        : null,
    },
    artifactPaths,
    decision: result.passed ? "product-workflow-corpus-ready-for-scorecards" : "product-workflow-corpus-blocked",
    summary: result.passed
      ? `Product-shaped planner payload, manual-layout, and expansion-comparison replays passed; ${manualOutperformingBudgetCaseCount} case(s) remain below manual replay quality.`
      : "Product-shaped workflow benchmark found invalid payloads or replay failures.",
  };
}

export function listProductWorkflowBenchmarkCaseNames(
  corpus: readonly ProductWorkflowBenchmarkCase[] = DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "product workflow benchmark",
    corpusLabel: "product workflow benchmark",
  });
}

export function evaluateProductWorkflowManualReplays(
  corpus: readonly ProductWorkflowBenchmarkCase[] = DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS
): ProductWorkflowManualReplayResult[] {
  return corpus.map(replayManualLayout);
}

export async function runProductWorkflowBenchmarkSuite(
  corpus: readonly ProductWorkflowBenchmarkCase[] = DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS,
  options: ProductWorkflowBenchmarkRunOptions = {}
): Promise<ProductWorkflowBenchmarkSuiteResult> {
  const selected = selectProductWorkflowCases(corpus, options.names);
  const budgetsSeconds = normalizePositiveNumbers(options.budgetsSeconds, DEFAULT_PRODUCT_WORKFLOW_BUDGETS_SECONDS);
  const seeds = normalizeSeeds(options.seeds);
  const results: ProductWorkflowBenchmarkCaseResult[] = [];

  for (const benchmarkCase of selected) {
    const payloadValidation = validatePayload(benchmarkCase.grid, benchmarkCase.params);
    const manualReplay = replayManualLayout(benchmarkCase);
    const budgetResults: ProductWorkflowBudgetResult[] = [];
    for (const budgetSeconds of budgetsSeconds) {
      for (const seed of seeds) {
        budgetResults.push(await runBudgetSample(benchmarkCase, budgetSeconds, seed));
      }
    }
    const budgetQuality = summarizeBudgetQuality(manualReplay, budgetResults);
    const expansion = await replayExpansionComparison(benchmarkCase, manualReplay, budgetsSeconds[0]!, seeds[0]!);
    const passed =
      payloadValidation.valid
      && manualReplay.valid
      && budgetResults.every((budgetResult) => budgetResult.valid)
      && expansion.valid;
    results.push({
      name: benchmarkCase.name,
      description: benchmarkCase.description,
      family: benchmarkCase.family,
      split: benchmarkCase.split,
      gridRows: benchmarkCase.grid.length,
      gridCols: benchmarkCase.grid[0]?.length ?? 0,
      payloadValidation,
      manualReplay,
      budgetResults,
      budgetQuality,
      expansion,
      passed,
    });
  }

  const metadata = buildBenchmarkSuiteMetadata(results.map((result) => result.name));
  const partialResult = {
    ...metadata,
    passed: results.every((result) => result.passed),
    budgetsSeconds,
    seeds,
    results,
  };
  return {
    ...partialResult,
    registryHints: buildRegistryHints(partialResult),
  };
}

export function writeProductWorkflowBenchmarkArtifact(
  result: ProductWorkflowBenchmarkSuiteResult,
  outputPath: string
): ProductWorkflowBenchmarkSuiteResult {
  const normalizedOutputPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  const resultWithArtifactPath = {
    ...result,
    registryHints: buildRegistryHints(result, [normalizedOutputPath]),
  };
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(resultWithArtifactPath, null, 2)}\n`);
  return resultWithArtifactPath;
}

export function buildProductWorkflowTelemetryManifest(
  result: ProductWorkflowBenchmarkSuiteResult,
  options: ProductWorkflowTelemetryManifestOptions = {}
): SolverTelemetryManifest {
  const runs = result.results.flatMap((caseResult) =>
    caseResult.budgetResults.map((budgetResult) =>
      buildSolverTelemetryRunManifest({
        runId: `${caseResult.name}:greedy:budget-${budgetResult.budgetSeconds}:seed-${budgetResult.seed}`,
        benchmarkName: "product-workflow",
        caseName: caseResult.name,
        caseFamily: caseResult.family,
        optimizer: "greedy",
        mode: "greedy",
        seed: budgetResult.seed,
        budget: {
          wallClockSeconds: budgetResult.budgetSeconds,
          observedWallClockSeconds: budgetResult.wallClockSeconds,
        },
        grid: DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS.find((entry) => entry.name === caseResult.name)?.grid ?? [],
        solverParams: budgetResult.solverParams,
        artifactPaths: options.artifactPaths ?? [],
        wallClockSeconds: budgetResult.wallClockSeconds,
        totalPopulation: budgetResult.totalPopulation,
        finalStatus: budgetResult.valid ? "valid" : "invalid",
        validation: {
          valid: budgetResult.valid,
          errors: budgetResult.errors,
        },
        progressSummary: budgetResult.progressSummary,
        decisionTrace: budgetResult.decisionTrace,
        timeToQuality: budgetResult.timeToQuality,
      })
    )
  );

  return buildSolverTelemetryManifest({
    manifestId: options.manifestId ?? `product-workflow-${result.generatedAt.slice(0, 10)}`,
    benchmarkName: "product-workflow",
    generatedAt: result.generatedAt,
    commands: options.commands ?? [],
    artifactPaths: options.artifactPaths ?? [],
    runs,
  });
}

export function writeProductWorkflowTelemetryManifest(
  result: ProductWorkflowBenchmarkSuiteResult,
  outputPath: string,
  options: ProductWorkflowTelemetryManifestOptions = {}
): SolverTelemetryManifest {
  return writeSolverTelemetryManifest(
    buildProductWorkflowTelemetryManifest(result, {
      ...options,
      artifactPaths: [...(options.artifactPaths ?? []), outputPath],
    }),
    outputPath
  );
}

function formatSigned(value: number | null): string {
  if (value === null) return "n/a";
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatRatio(value: number | null): string {
  if (value === null) return "n/a";
  return value.toFixed(2);
}

export function formatProductWorkflowBenchmarkSuite(result: ProductWorkflowBenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Product Workflow Benchmark Suite ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Status: ${result.passed ? "PASS" : "FAIL"}`);
  lines.push(`Budgets: ${result.budgetsSeconds.join(", ")}s`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push("");

  for (const caseResult of result.results) {
    lines.push(`- ${caseResult.name} [${caseResult.family}/${caseResult.split}]: ${caseResult.description}`);
    lines.push(
      `  payload=${caseResult.payloadValidation.valid ? "valid" : `invalid:${caseResult.payloadValidation.errors.join(" ")}`}`
    );
    lines.push(
      `  manual=${caseResult.manualReplay.endpoint} pop:${caseResult.manualReplay.totalPopulation} roads:${caseResult.manualReplay.roadCount} buildings:${
        caseResult.manualReplay.serviceCount + caseResult.manualReplay.residentialCount
      } ${caseResult.manualReplay.valid ? "valid" : `invalid:${caseResult.manualReplay.errors.join(" ")}`}`
    );
    lines.push(
      `  quality=best-budget-pop:${caseResult.budgetQuality.bestPopulation ?? "n/a"} budget:${caseResult.budgetQuality.bestBudgetSeconds ?? "n/a"}s seed:${caseResult.budgetQuality.bestSeed ?? "n/a"} manual-delta:${formatSigned(caseResult.budgetQuality.deltaFromManual)} coverage:${formatRatio(caseResult.budgetQuality.coverageRatio)}`
    );
    lines.push(
      `  expansion=baseline:${caseResult.expansion.baselinePopulation} service:${caseResult.expansion.servicePopulation ?? "n/a"}(${
        formatSigned(caseResult.expansion.serviceDelta)
      }) residential:${caseResult.expansion.residentialPopulation ?? "n/a"}(${formatSigned(caseResult.expansion.residentialDelta)}) winner:${caseResult.expansion.winner}`
    );
    for (const budget of caseResult.budgetResults) {
      lines.push(
        `  budget=${budget.budgetSeconds}s seed=${budget.seed} pop=${budget.totalPopulation} roads=${budget.roadCount} services=${budget.serviceCount} residentials=${budget.residentialCount} wall=${budget.wallClockSeconds.toFixed(3)}s`
      );
    }
  }

  return lines.join("\n");
}

const oneByOne = { w: 1, h: 1, min: 10, max: 20, avail: 4 };
const compactTwoByTwo = { w: 2, h: 2, min: 40, max: 80, avail: 3 };
const slabTwoByThree = { w: 2, h: 3, min: 60, max: 120, avail: 2 };
const clinic = { rows: 1, cols: 1, bonus: 25, range: 2, avail: 1 };

export const DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS: readonly ProductWorkflowBenchmarkCase[] = Object.freeze([
  {
    name: "planner-corridor-reuse",
    description: "Saved corridor payload with manual road cleanup and expansion replay.",
    family: "corridor",
    split: "development",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 0, 1, 1],
      [0, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ name: "Clinic", ...clinic }],
      residentialTypes: [
        { name: "Courtyard", ...compactTwoByTwo },
        { name: "Studio Row", ...oneByOne },
      ],
      availableBuildings: { services: 1, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(["0,0", "1,0", "1,1", "2,1"], [{ r: 2, c: 2, rows: 2, cols: 2 }], [40]),
    expansion: {
      service: { name: "Kiosk", rows: 1, cols: 1, bonus: 15, range: 1, avail: 1 },
      residential: { name: "Infill Studio", w: 1, h: 1, min: 15, max: 25, avail: 1 },
    },
  },
  {
    name: "planner-gate-choke",
    description: "Gate-shaped map with an explicit central access check.",
    family: "gate",
    split: "development",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ name: "Gate Service", rows: 1, cols: 1, bonus: 20, range: 2, avail: 1 }],
      residentialTypes: [
        { name: "Gate Home", ...oneByOne },
        { name: "Gate Block", ...compactTwoByTwo },
      ],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(["0,2", "1,2"], [{ r: 2, c: 2, rows: 1, cols: 1 }], [10]),
    expansion: {
      service: { name: "Gate Plaza", rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 },
      residential: { name: "Gate Loft", w: 1, h: 1, min: 15, max: 30, avail: 1 },
    },
  },
  {
    name: "planner-footprint-pressure",
    description: "Dense footprint pressure payload with large residential slabs.",
    family: "footprint-pressure",
    split: "development",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ name: "Small Park", rows: 1, cols: 1, bonus: 10, range: 1, avail: 1 }],
      residentialTypes: [
        { name: "Slab", ...slabTwoByThree },
        { name: "Block", ...compactTwoByTwo },
      ],
      availableBuildings: { services: 1, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution([], [{ r: 0, c: 0, rows: 2, cols: 3 }], [60]),
    expansion: {
      service: { name: "Pocket Park", rows: 1, cols: 1, bonus: 15, range: 2, avail: 1 },
      residential: { name: "Narrow Slab", w: 1, h: 3, min: 25, max: 60, avail: 1 },
    },
  },
  {
    name: "planner-service-overlap",
    description: "Service-overlap case where expansion can trade another service against another home.",
    family: "service-overlap",
    split: "holdout",
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
        { name: "Clinic", rows: 1, cols: 1, bonus: 25, range: 2, avail: 1 },
        { name: "Library", rows: 1, cols: 1, bonus: 20, range: 2, avail: 1 },
      ],
      residentialTypes: [
        { name: "Courtyard", ...compactTwoByTwo },
        { name: "Studio", ...oneByOne },
      ],
      availableBuildings: { services: 1, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(
      ["0,1", "0,3"],
      [{ r: 1, c: 3, rows: 2, cols: 2 }],
      [65],
      {
        services: [{ r: 1, c: 1, rows: 1, cols: 1, range: 2 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [25],
      }
    ),
    expansion: {
      service: { name: "School", rows: 1, cols: 1, bonus: 35, range: 2, avail: 1 },
      residential: { name: "Studio Add", w: 1, h: 1, min: 15, max: 25, avail: 1 },
    },
  },
  {
    name: "planner-anchor-service",
    description: "Boundary-touching service and housing payload that should stay road-light.",
    family: "anchor-service",
    split: "holdout",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ name: "Anchor Clinic", rows: 1, cols: 1, bonus: 20, range: 1, avail: 1 }],
      residentialTypes: [
        { name: "Anchor Home", ...oneByOne },
        { name: "Block", ...compactTwoByTwo },
      ],
      availableBuildings: { services: 1, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(
      [],
      [{ r: 0, c: 1, rows: 1, cols: 1 }],
      [30],
      {
        services: [{ r: 0, c: 0, rows: 1, cols: 1, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [20],
      }
    ),
    expansion: {
      service: { name: "Anchor Shop", rows: 1, cols: 1, bonus: 15, range: 1, avail: 1 },
      residential: { name: "Anchor Studio", w: 1, h: 1, min: 15, max: 25, avail: 1 },
    },
  },
  {
    name: "planner-multi-anchor-islands",
    description: "Planner-shaped multi-anchor payload with two independent islands.",
    family: "multi-anchor",
    split: "holdout",
    grid: [
      [0, 1, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 1],
      [0, 1, 1, 0, 1, 1],
      [0, 1, 1, 0, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [
        { name: "Island Block", w: 2, h: 2, min: 40, max: 80, avail: 2 },
        { name: "Island Studio", w: 1, h: 1, min: 10, max: 20, avail: 2 },
      ],
      availableBuildings: { services: 0, residentials: 2 },
      greedy: { restarts: 2, localSearch: true, allowIndependentRoadAnchorComponents: true },
    },
    manualLayout: workflowSolution(
      ["0,1", "1,1", "0,5", "1,5"],
      [
        { r: 2, c: 1, rows: 2, cols: 2 },
        { r: 2, c: 4, rows: 2, cols: 2 },
      ],
      [40, 40],
      { residentialTypeIndices: [0, 0] }
    ),
    expansion: {
      residential: { name: "Island Pod", w: 1, h: 1, min: 15, max: 25, avail: 1 },
    },
  },
  {
    name: "planner-rotated-rowhouse",
    description: "Rotated rowhouse payload with a saved service-and-road reuse pattern.",
    family: "footprint-pressure",
    split: "development",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ name: "Linear Market", rows: 1, cols: 2, bonus: 25, range: 1, avail: 1 }],
      residentialTypes: [
        { name: "Rowhouse", w: 3, h: 1, min: 35, max: 65, avail: 2 },
        { name: "Pocket Courtyard", w: 2, h: 2, min: 55, max: 95, avail: 1 },
      ],
      availableBuildings: { services: 1, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(
      ["0,1", "1,1"],
      [
        { r: 2, c: 0, rows: 1, cols: 3 },
        { r: 0, c: 4, rows: 1, cols: 3 },
      ],
      [60, 60],
      {
        services: [{ r: 1, c: 2, rows: 1, cols: 2, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [25],
        residentialTypeIndices: [0, 0],
      }
    ),
    expansion: {
      service: { name: "Pop-up Market", rows: 1, cols: 1, bonus: 20, range: 1, avail: 1 },
      residential: { name: "Micro Rowhouse", w: 1, h: 2, min: 20, max: 45, avail: 1 },
    },
  },
  {
    name: "planner-gate-service-tradeoff",
    description: "Gate-shaped service tradeoff payload with two saved service anchors.",
    family: "gate",
    split: "holdout",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { name: "Gate Clinic", rows: 1, cols: 1, bonus: 20, range: 1, avail: 1 },
        { name: "Gate Depot", rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 },
      ],
      residentialTypes: [
        { name: "Gate Block", w: 2, h: 2, min: 50, max: 100, avail: 2 },
        { name: "Gate Studio", w: 1, h: 1, min: 15, max: 35, avail: 2 },
      ],
      availableBuildings: { services: 2, residentials: 2 },
      greedy: { restarts: 2, localSearch: true },
    },
    manualLayout: workflowSolution(
      ["0,2", "0,3", "0,4", "1,2", "1,4", "2,2", "2,4", "3,2", "3,4"],
      [
        { r: 4, c: 2, rows: 2, cols: 2 },
        { r: 4, c: 4, rows: 2, cols: 2 },
      ],
      [80, 80],
      {
        services: [
          { r: 1, c: 3, rows: 1, cols: 1, range: 1 },
          { r: 3, c: 3, rows: 1, cols: 1, range: 1 },
        ],
        serviceTypeIndices: [0, 1],
        servicePopulationIncreases: [20, 30],
        residentialTypeIndices: [0, 0],
      }
    ),
    expansion: {
      service: { name: "Gate School", rows: 1, cols: 1, bonus: 35, range: 2, avail: 1 },
      residential: { name: "Gate Studio Add", w: 1, h: 1, min: 20, max: 40, avail: 1 },
    },
  },
]);
