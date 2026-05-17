import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { assertValidSolveInputs } from "../core/solverInputValidation.js";
import { solveAsync } from "../runtime/solve.js";
import { assertHttpPlannerInputLimits } from "../server/http/contracts.js";
import { buildManualLayoutResponse, buildSolveResponse } from "../server/http/solutionResponse.js";
import {
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  listBenchmarkCaseNames,
  roundBenchmarkMetric,
  selectBenchmarkCasesByName,
} from "./benchmarkOptions.js";

import type {
  Grid,
  ResidentialPlacement,
  ResidentialTypeSetting,
  ServicePlacement,
  ServiceTypeSetting,
  Solution,
  SolverParams,
} from "../core/types.js";

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
  totalPopulation: number;
  valid: boolean;
  errors: string[];
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  wallClockSeconds: number;
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

export const DEFAULT_PRODUCT_WORKFLOW_BUDGETS_SECONDS = Object.freeze([1, 5] as const);
export const DEFAULT_PRODUCT_WORKFLOW_SEEDS = Object.freeze([7] as const);

function materializeWorkflowSolution(solution: ProductWorkflowSerializedSolution): Solution {
  return {
    roads: new Set(solution.roads),
    services: solution.services.map((service) => ({ ...service })),
    serviceTypeIndices: [...solution.serviceTypeIndices],
    servicePopulationIncreases: [...solution.servicePopulationIncreases],
    residentials: solution.residentials.map((residential) => ({ ...residential })),
    residentialTypeIndices: [...solution.residentialTypeIndices],
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation,
  };
}

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
  const normalized = [...new Set(source.filter((value) => Number.isFinite(value) && value > 0))]
    .map((value) => roundBenchmarkMetric(value))
    .sort((left, right) => left - right);
  if (normalized.length === 0) {
    throw new Error("Product workflow benchmark requires at least one positive budget.");
  }
  return normalized;
}

function normalizeSeeds(values: readonly number[] | undefined): number[] {
  const source = values?.length ? values : DEFAULT_PRODUCT_WORKFLOW_SEEDS;
  const normalized = [...new Set(source.filter((value) => Number.isInteger(value) && value >= 0))]
    .sort((left, right) => left - right);
  if (normalized.length === 0) {
    throw new Error("Product workflow benchmark requires at least one non-negative integer seed.");
  }
  return normalized;
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

function replayManualLayout(benchmarkCase: ProductWorkflowBenchmarkCase): ProductWorkflowManualReplayResult {
  const response = buildManualLayoutResponse(
    benchmarkCase.grid,
    benchmarkCase.params,
    materializeWorkflowSolution(benchmarkCase.manualLayout)
  );
  return {
    valid: response.validation.valid,
    totalPopulation: response.stats.totalPopulation,
    roadCount: response.stats.roadCount,
    serviceCount: response.stats.serviceCount,
    residentialCount: response.stats.residentialCount,
    errors: response.validation.errors,
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
  return {
    budgetSeconds,
    seed,
    totalPopulation: response.stats.totalPopulation,
    valid: response.validation.valid,
    errors: response.validation.errors,
    roadCount: response.stats.roadCount,
    serviceCount: response.stats.serviceCount,
    residentialCount: response.stats.residentialCount,
    wallClockSeconds,
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

function buildRegistryHints(
  result: Omit<ProductWorkflowBenchmarkSuiteResult, "registryHints">,
  artifactPaths: string[] = []
): ProductWorkflowBenchmarkRegistryHints {
  const failedCaseCount = result.results.filter((caseResult) => !caseResult.passed).length;
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
    },
    artifactPaths,
    decision: result.passed ? "product-workflow-corpus-ready-for-scorecards" : "product-workflow-corpus-blocked",
    summary: result.passed
      ? "Product-shaped planner payload, manual-layout, and expansion-comparison replays passed."
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

function formatSigned(value: number | null): string {
  if (value === null) return "n/a";
  if (value > 0) return `+${value}`;
  return `${value}`;
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
      `  manual=pop:${caseResult.manualReplay.totalPopulation} roads:${caseResult.manualReplay.roadCount} buildings:${
        caseResult.manualReplay.serviceCount + caseResult.manualReplay.residentialCount
      } ${caseResult.manualReplay.valid ? "valid" : `invalid:${caseResult.manualReplay.errors.join(" ")}`}`
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
      greedy: { restarts: 2, localSearch: true },
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
]);
