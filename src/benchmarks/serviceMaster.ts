import { performance } from "node:perf_hooks";

import {
  buildServiceEffectZoneSet,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  residentialFootprint,
  serviceFootprint,
} from "../core/buildings.js";
import { validateSolution } from "../core/evaluator.js";
import { getBuildingLimits, getResidentialBaseMax, NO_TYPE_INDEX } from "../core/rules.js";
import { solveAsync } from "../runtime/solve.js";
import {
  assertBenchmarkCasesSelected,
  benchmarkGeneratedAt,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  countBenchmarkMatches,
  formatBenchmarkRate,
  formatNullableBenchmarkSeconds,
  formatNullableBenchmarkSignedNumber,
  listBenchmarkCaseNames,
  meanBenchmarkValue,
  meanNullableBenchmarkValue,
  roundBenchmarkMetric,
  selectBenchmarkCasesByName,
  uniqueBenchmarkValues,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  buildCrossModeBenchmarkParams,
} from "./crossMode.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";
import { DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS } from "./productWorkflow.js";

import type {
  CpSatOptions,
  Grid,
  PersistedServiceCandidateKey,
  ResidentialCandidate,
  ServiceCandidate,
  Solution,
  SolverParams,
} from "../core/types.js";
import type { CrossModeBenchmarkCase } from "./crossMode.js";
import type { LnsBenchmarkCase } from "./lns.js";
import type { ProductWorkflowBenchmarkCase } from "./productWorkflow.js";

export type ServiceMasterBenchmarkSplit = "holdout" | "generated-pressure" | "development";

export interface ServiceMasterBenchmarkCase extends CrossModeBenchmarkCase {
  family: string;
  split: ServiceMasterBenchmarkSplit;
}

export interface ServiceMasterLayout {
  serviceCandidateKeys: PersistedServiceCandidateKey[];
  services: ServiceCandidate[];
  heuristicScore: number;
  residentialPackingUpperBound: number;
  serviceCoverageScore: number;
}

export interface ServiceMasterLayoutRun {
  layoutIndex: number;
  serviceCandidateKeys: PersistedServiceCandidateKey[];
  heuristicScore: number;
  residentialPackingUpperBound: number;
  wallClockSeconds: number;
  totalPopulation: number | null;
  cpSatStatus: string | null;
  valid: boolean;
  validationErrors: string[];
  error: string | null;
}

export interface ServiceMasterTelemetry {
  candidateCount: number;
  prunedCandidateCount: number;
  candidatePoolSize: number;
  layoutCount: number;
  layoutsSolved: number;
  layoutsFailed: number;
  noGoodCutsApplied: number;
  serviceSwapNeighborhoods: number;
  bestLayoutKeys: PersistedServiceCandidateKey[];
  bestLayoutIndex: number | null;
  elapsedSeconds: number;
  layoutRuns: ServiceMasterLayoutRun[];
}

export interface ServiceMasterDecompositionResult {
  solution: Solution;
  telemetry: ServiceMasterTelemetry;
}

export type ServiceMasterSubproblemSolve = (
  grid: Grid,
  params: SolverParams,
  context: {
    layout: ServiceMasterLayout;
    layoutIndex: number;
    seed: number;
  }
) => Solution | Promise<Solution>;

export interface ServiceMasterDecompositionOptions {
  seed?: number;
  maxServiceLayouts?: number;
  serviceCandidatePoolSize?: number;
  maxLayoutServiceCount?: number;
  cpSat?: Partial<CpSatOptions>;
  solveSubproblem?: ServiceMasterSubproblemSolve;
}

export interface ServiceMasterBenchmarkRunOptions extends ServiceMasterDecompositionOptions {
  names?: string[];
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  solveAuto?: (
    grid: Grid,
    params: SolverParams,
    context: { benchmarkCase: ServiceMasterBenchmarkCase; budgetSeconds: number; seed: number }
  ) => Solution | Promise<Solution>;
}

export interface ServiceMasterBenchmarkModeSummary {
  totalPopulation: number;
  wallClockSeconds: number;
  valid: boolean;
  validationErrors: string[];
  cpSatStatus: string | null;
}

export interface ServiceMasterBenchmarkRun {
  name: string;
  description: string;
  family: string;
  split: ServiceMasterBenchmarkSplit;
  budgetSeconds: number;
  seed: number;
  auto: ServiceMasterBenchmarkModeSummary;
  serviceMaster: ServiceMasterBenchmarkModeSummary & {
    telemetry: ServiceMasterTelemetry;
  };
  scoreDeltaVsAuto: number;
  winVsAuto: "win" | "tie" | "loss";
}

export interface ServiceMasterBenchmarkSummary {
  runCount: number;
  winCount: number;
  tieCount: number;
  lossCount: number;
  invalidRunCount: number;
  meanAutoPopulation: number;
  meanServiceMasterPopulation: number;
  meanScoreDeltaVsAuto: number;
  meanServiceMasterWallClockSeconds: number;
  meanAutoWallClockSeconds: number;
  meanLayoutsSolved: number | null;
}

export interface ServiceMasterBenchmarkSuiteResult {
  generatedAt: string;
  budgetSeconds: number;
  budgetsSeconds: number[];
  seeds: number[];
  caseCount: number;
  selectedCaseNames: string[];
  runs: ServiceMasterBenchmarkRun[];
  summary: ServiceMasterBenchmarkSummary;
}

const DEFAULT_SERVICE_MASTER_BUDGET_SECONDS = 5;
const DEFAULT_SERVICE_MASTER_SEEDS = Object.freeze([7] satisfies number[]);
const DEFAULT_MAX_SERVICE_LAYOUTS = 12;
const DEFAULT_SERVICE_CANDIDATE_POOL_SIZE = 64;
const DEFAULT_MAX_LAYOUT_SERVICE_COUNT = 3;

function serviceCandidateBackendKey(candidate: ServiceCandidate): PersistedServiceCandidateKey {
  return `service:${candidate.typeIndex}:${candidate.r}:${candidate.c}:${candidate.rows}:${candidate.cols}`;
}

function serviceCandidateSignature(candidate: ServiceCandidate): string {
  return `${candidate.r},${candidate.c},${candidate.rows},${candidate.cols}`;
}

function serviceCandidateSortKey(candidate: ServiceCandidate): string {
  return [
    candidate.typeIndex,
    candidate.r,
    candidate.c,
    candidate.rows,
    candidate.cols,
    candidate.range,
    candidate.bonus,
  ].join(",");
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeBudgetSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Service-master benchmark budget seconds must be a finite number greater than 0.");
  }
  return roundBenchmarkMetric(value);
}

function normalizeBudgets(options: ServiceMasterBenchmarkRunOptions): number[] {
  const requested = options.budgetsSeconds?.length
    ? options.budgetsSeconds
    : options.budgetSeconds !== undefined
      ? [options.budgetSeconds]
      : [DEFAULT_SERVICE_MASTER_BUDGET_SECONDS];
  const budgets = requested.map((budget) => normalizeBudgetSeconds(budget));
  return uniqueBenchmarkValues(budgets);
}

function normalizeSeeds(seeds: readonly number[] | undefined): number[] {
  return normalizeBenchmarkSeeds(seeds, "Service-master benchmark seeds")
    ?? [...DEFAULT_SERVICE_MASTER_SEEDS];
}

function serviceSlotCap(params: SolverParams): number {
  const configured = getBuildingLimits(params).maxServices;
  const totalAvailable = (params.serviceTypes ?? []).reduce((total, service) => total + Math.max(0, service.avail), 0);
  return Math.max(0, Math.min(configured ?? totalAvailable, totalAvailable));
}

function residentialSlotCap(params: SolverParams): number {
  const configured = getBuildingLimits(params).maxResidentials;
  const totalAvailable = (params.residentialTypes ?? []).reduce(
    (total, residential) => total + Math.max(0, residential.avail),
    0
  );
  return Math.max(0, configured ?? totalAvailable);
}

function candidateEffectZoneIncludes(G: Grid, other: ServiceCandidate, candidate: ServiceCandidate): boolean {
  const otherZone = buildServiceEffectZoneSet(G, other);
  const candidateZone = buildServiceEffectZoneSet(G, candidate);
  for (const key of candidateZone) {
    if (!otherZone.has(key)) return false;
  }
  return true;
}

function pruneServiceCandidatesForCpSatBackend(G: Grid, params: SolverParams, candidates: ServiceCandidate[]): ServiceCandidate[] {
  const serviceTypes = params.serviceTypes ?? [];
  const slotCap = serviceSlotCap(params);
  if (slotCap <= 0) return [];
  const alwaysAvailableTypes = new Set(
    serviceTypes
      .map((service, index) => ({ service, index }))
      .filter((entry) => Math.max(0, entry.service.avail) >= slotCap)
      .map((entry) => entry.index)
  );
  if (!alwaysAvailableTypes.size) return candidates;

  const bySignature = new Map<string, ServiceCandidate[]>();
  for (const candidate of candidates) {
    const signature = serviceCandidateSignature(candidate);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), candidate]);
  }

  return candidates.filter((candidate) => {
    const group = bySignature.get(serviceCandidateSignature(candidate)) ?? [];
    return !group.some((other) => {
      if (other === candidate) return false;
      if (!alwaysAvailableTypes.has(other.typeIndex)) return false;
      if (other.bonus < candidate.bonus) return false;
      if (!candidateEffectZoneIncludes(G, other, candidate)) return false;
      const sameEffect = other.range === candidate.range;
      return other.bonus > candidate.bonus || !sameEffect || other.typeIndex < candidate.typeIndex;
    });
  });
}

function enumerateResidentialMasterCandidates(G: Grid, params: SolverParams): ResidentialCandidate[] {
  if (params.residentialTypes?.length) {
    return enumerateResidentialCandidatesFromTypes(G, params.residentialTypes);
  }
  return enumerateResidentialCandidates(G).map((candidate) => ({
    ...candidate,
    typeIndex: NO_TYPE_INDEX,
  }));
}

function cellsOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function serviceFootprintSet(candidate: ServiceCandidate): Set<string> {
  return new Set(serviceFootprint(candidate));
}

function residentialFootprintSet(candidate: ResidentialCandidate): Set<string> {
  return new Set(residentialFootprint(candidate.r, candidate.c, candidate.rows, candidate.cols));
}

function greedyResidentialPackingUpperBound(G: Grid, params: SolverParams, services: readonly ServiceCandidate[]): number {
  const residentials = enumerateResidentialMasterCandidates(G, params);
  const serviceFootprints = services.map(serviceFootprintSet);
  const serviceEffectZones = services.map((service) => buildServiceEffectZoneSet(G, service));
  const maxResidentials = residentialSlotCap(params);
  const typeCounts = new Map<number, number>();
  const occupied = new Set<string>();
  for (const footprint of serviceFootprints) {
    for (const key of footprint) occupied.add(key);
  }

  const scored = residentials
    .map((residential) => {
      const footprint = residentialFootprintSet(residential);
      if (cellsOverlap(footprint, occupied)) return null;
      const baseMax = getResidentialBaseMax(params, residential.rows, residential.cols, residential.typeIndex);
      const boost = serviceEffectZones.reduce(
        (total, zone, index) => total + ([...footprint].some((key) => zone.has(key)) ? services[index]!.bonus : 0),
        0
      );
      return {
        residential,
        footprint,
        population: Math.max(baseMax.base, Math.min(baseMax.max, baseMax.base + boost)),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) =>
      right.population - left.population
      || left.residential.r - right.residential.r
      || left.residential.c - right.residential.c
      || left.residential.typeIndex - right.residential.typeIndex
    );

  let total = 0;
  let placed = 0;
  for (const entry of scored) {
    if (placed >= maxResidentials) break;
    if (cellsOverlap(entry.footprint, occupied)) continue;
    const typeIndex = entry.residential.typeIndex;
    const typeLimit = params.residentialTypes?.[typeIndex]?.avail ?? Number.POSITIVE_INFINITY;
    const used = typeCounts.get(typeIndex) ?? 0;
    if (used >= typeLimit) continue;
    for (const key of entry.footprint) occupied.add(key);
    typeCounts.set(typeIndex, used + 1);
    total += entry.population;
    placed += 1;
  }
  return total;
}

function serviceCoverageScore(G: Grid, params: SolverParams, service: ServiceCandidate): number {
  const effectZone = buildServiceEffectZoneSet(G, service);
  const residentials = enumerateResidentialMasterCandidates(G, params);
  return residentials.reduce((total, residential) => {
    const footprint = residentialFootprint(residential.r, residential.c, residential.rows, residential.cols);
    if (!footprint.some((key) => effectZone.has(key))) return total;
    const baseMax = getResidentialBaseMax(params, residential.rows, residential.cols, residential.typeIndex);
    return total + Math.min(service.bonus, Math.max(0, baseMax.max - baseMax.base));
  }, 0);
}

function compareServiceCandidatesByMasterScore(
  G: Grid,
  params: SolverParams,
  left: ServiceCandidate,
  right: ServiceCandidate
): number {
  const leftScore = serviceCoverageScore(G, params, left);
  const rightScore = serviceCoverageScore(G, params, right);
  return rightScore - leftScore
    || right.bonus - left.bonus
    || right.range - left.range
    || left.rows * left.cols - right.rows * right.cols
    || serviceCandidateSortKey(left).localeCompare(serviceCandidateSortKey(right));
}

function layoutKey(services: readonly ServiceCandidate[]): string {
  return services.map(serviceCandidateBackendKey).sort().join("|");
}

function layoutTypeCountsWithinAvail(params: SolverParams, services: readonly ServiceCandidate[]): boolean {
  const counts = new Map<number, number>();
  for (const service of services) {
    const count = (counts.get(service.typeIndex) ?? 0) + 1;
    counts.set(service.typeIndex, count);
    const limit = params.serviceTypes?.[service.typeIndex]?.avail ?? 0;
    if (count > limit) return false;
  }
  return true;
}

function servicesDoNotOverlap(services: readonly ServiceCandidate[]): boolean {
  const occupied = new Set<string>();
  for (const service of services) {
    for (const key of serviceFootprint(service)) {
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return true;
}

function scoreLayout(G: Grid, params: SolverParams, services: readonly ServiceCandidate[]): ServiceMasterLayout {
  const residentialPackingUpperBound = greedyResidentialPackingUpperBound(G, params, services);
  const coverageScore = services.reduce((total, service) => total + serviceCoverageScore(G, params, service), 0);
  const servicePenalty = services.length * 0.01;
  return {
    serviceCandidateKeys: services.map(serviceCandidateBackendKey).sort(),
    services: [...services],
    heuristicScore: residentialPackingUpperBound + coverageScore / 1000 - servicePenalty,
    residentialPackingUpperBound,
    serviceCoverageScore: coverageScore,
  };
}

export function buildServiceMasterLayouts(
  G: Grid,
  params: SolverParams,
  options: ServiceMasterDecompositionOptions = {}
): ServiceMasterLayout[] {
  const rawCandidates = enumerateServiceCandidates(G, params);
  const candidates = pruneServiceCandidatesForCpSatBackend(G, params, rawCandidates)
    .sort((left, right) => compareServiceCandidatesByMasterScore(G, params, left, right));
  const poolSize = normalizePositiveInteger(options.serviceCandidatePoolSize, DEFAULT_SERVICE_CANDIDATE_POOL_SIZE);
  const candidatePool = candidates.slice(0, poolSize);
  const maxServices = Math.min(
    normalizePositiveInteger(options.maxLayoutServiceCount, DEFAULT_MAX_LAYOUT_SERVICE_COUNT),
    serviceSlotCap(params)
  );
  const seen = new Set<string>();
  const layouts: ServiceMasterLayout[] = [];

  function addLayout(services: readonly ServiceCandidate[]): void {
    if (!layoutTypeCountsWithinAvail(params, services) || !servicesDoNotOverlap(services)) return;
    const key = layoutKey(services);
    if (seen.has(key)) return;
    seen.add(key);
    layouts.push(scoreLayout(G, params, services));
  }

  addLayout([]);

  function visit(startIndex: number, selected: ServiceCandidate[]): void {
    if (selected.length > 0) addLayout(selected);
    if (selected.length >= maxServices) return;
    for (let index = startIndex; index < candidatePool.length; index += 1) {
      selected.push(candidatePool[index]!);
      if (layoutTypeCountsWithinAvail(params, selected) && servicesDoNotOverlap(selected)) {
        visit(index + 1, selected);
      }
      selected.pop();
    }
  }

  visit(0, []);

  const maxLayouts = normalizePositiveInteger(options.maxServiceLayouts, DEFAULT_MAX_SERVICE_LAYOUTS);
  return layouts
    .sort((left, right) =>
      right.heuristicScore - left.heuristicScore
      || right.residentialPackingUpperBound - left.residentialPackingUpperBound
      || left.serviceCandidateKeys.join("|").localeCompare(right.serviceCandidateKeys.join("|"))
    )
    .slice(0, maxLayouts);
}

function defaultSubproblemCpSatOptions(
  options: ServiceMasterDecompositionOptions,
  seed: number
): CpSatOptions {
  const timeLimitSeconds = normalizePositiveNumber(options.cpSat?.timeLimitSeconds, 1);
  return {
    ...(options.cpSat ?? {}),
    timeLimitSeconds,
    maxDeterministicTime: normalizePositiveNumber(options.cpSat?.maxDeterministicTime, timeLimitSeconds),
    numWorkers: options.cpSat?.numWorkers ?? 1,
    randomSeed: options.cpSat?.randomSeed ?? seed,
  };
}

function solutionBetterThan(left: Solution, right: Solution | null, leftWallSeconds: number, rightWallSeconds: number): boolean {
  if (!right) return true;
  if (left.totalPopulation !== right.totalPopulation) return left.totalPopulation > right.totalPopulation;
  return leftWallSeconds < rightWallSeconds;
}

async function defaultServiceMasterSubproblemSolve(G: Grid, params: SolverParams): Promise<Solution> {
  return solveAsync(G, params);
}

export async function solveServiceMasterDecomposition(
  G: Grid,
  params: SolverParams,
  options: ServiceMasterDecompositionOptions = {}
): Promise<ServiceMasterDecompositionResult> {
  const startedAt = performance.now();
  const seed = options.seed ?? DEFAULT_SERVICE_MASTER_SEEDS[0]!;
  const rawCandidateCount = enumerateServiceCandidates(G, params).length;
  const layouts = buildServiceMasterLayouts(G, params, options);
  const solveSubproblem = options.solveSubproblem ?? defaultServiceMasterSubproblemSolve;
  const cpSatBase = defaultSubproblemCpSatOptions(options, seed);
  const layoutRuns: ServiceMasterLayoutRun[] = [];
  let bestSolution: Solution | null = null;
  let bestLayoutIndex: number | null = null;
  let bestWallClockSeconds = Number.POSITIVE_INFINITY;

  for (const [layoutIndex, layout] of layouts.entries()) {
    const layoutStartedAt = performance.now();
    try {
      const subproblemParams: SolverParams = {
        ...cloneBenchmarkSolverParams(params),
        optimizer: "cp-sat",
        cpSat: {
          ...cpSatBase,
          fixedServiceCandidateKeys: layout.serviceCandidateKeys,
        },
      };
      const solution = await solveSubproblem(cloneBenchmarkGrid(G), subproblemParams, {
        layout,
        layoutIndex,
        seed,
      });
      const wallClockSeconds = (performance.now() - layoutStartedAt) / 1000;
      const validation = validateSolution({ grid: G, params: subproblemParams, solution });
      layoutRuns.push({
        layoutIndex,
        serviceCandidateKeys: [...layout.serviceCandidateKeys],
        heuristicScore: roundBenchmarkMetric(layout.heuristicScore),
        residentialPackingUpperBound: layout.residentialPackingUpperBound,
        wallClockSeconds: roundBenchmarkMetric(wallClockSeconds),
        totalPopulation: solution.totalPopulation,
        cpSatStatus: solution.cpSatStatus ?? null,
        valid: validation.valid,
        validationErrors: validation.errors,
        error: null,
      });
      if (validation.valid && solutionBetterThan(solution, bestSolution, wallClockSeconds, bestWallClockSeconds)) {
        bestSolution = solution;
        bestLayoutIndex = layoutIndex;
        bestWallClockSeconds = wallClockSeconds;
      }
    } catch (error) {
      const wallClockSeconds = (performance.now() - layoutStartedAt) / 1000;
      layoutRuns.push({
        layoutIndex,
        serviceCandidateKeys: [...layout.serviceCandidateKeys],
        heuristicScore: roundBenchmarkMetric(layout.heuristicScore),
        residentialPackingUpperBound: layout.residentialPackingUpperBound,
        wallClockSeconds: roundBenchmarkMetric(wallClockSeconds),
        totalPopulation: null,
        cpSatStatus: null,
        valid: false,
        validationErrors: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!bestSolution) {
    throw new Error("Service-master decomposition did not produce a valid subproblem solution.");
  }

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const prunedCandidateCount = pruneServiceCandidatesForCpSatBackend(G, params, enumerateServiceCandidates(G, params)).length;
  return {
    solution: bestSolution,
    telemetry: {
      candidateCount: rawCandidateCount,
      prunedCandidateCount,
      candidatePoolSize: Math.min(
        normalizePositiveInteger(options.serviceCandidatePoolSize, DEFAULT_SERVICE_CANDIDATE_POOL_SIZE),
        prunedCandidateCount
      ),
      layoutCount: layouts.length,
      layoutsSolved: countBenchmarkMatches(layoutRuns, (run) => run.error === null),
      layoutsFailed: countBenchmarkMatches(layoutRuns, (run) => run.error !== null || !run.valid),
      noGoodCutsApplied: layouts.length,
      serviceSwapNeighborhoods: Math.max(0, layouts.length - 1),
      bestLayoutKeys: bestLayoutIndex === null ? [] : [...layouts[bestLayoutIndex]!.serviceCandidateKeys],
      bestLayoutIndex,
      elapsedSeconds: roundBenchmarkMetric(elapsedSeconds),
      layoutRuns,
    },
  };
}

function productWorkflowToServiceMasterCase(benchmarkCase: ProductWorkflowBenchmarkCase): ServiceMasterBenchmarkCase {
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    family: benchmarkCase.family,
    split: benchmarkCase.split,
    problemSizeBand: "small",
    grid: benchmarkCase.grid,
    params: benchmarkCase.params,
  };
}

function lnsToServiceMasterCase(benchmarkCase: LnsBenchmarkCase): ServiceMasterBenchmarkCase {
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    family: benchmarkCase.pressureFamily ?? "uncategorized",
    split: benchmarkCase.name.startsWith("lns-") ? "generated-pressure" : "development",
    problemSizeBand: "small",
    grid: benchmarkCase.grid,
    params: benchmarkCase.params,
  };
}

function requiredCase<TCase extends { name: string }>(cases: readonly TCase[], name: string): TCase {
  const benchmarkCase = cases.find((entry) => entry.name === name);
  if (!benchmarkCase) throw new Error(`Missing service-master benchmark case ${name}.`);
  return benchmarkCase;
}

export const DEFAULT_SERVICE_MASTER_BENCHMARK_CORPUS: readonly ServiceMasterBenchmarkCase[] = Object.freeze([
  productWorkflowToServiceMasterCase(requiredCase(DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS, "planner-service-overlap")),
  productWorkflowToServiceMasterCase(requiredCase(DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS, "planner-anchor-service")),
  lnsToServiceMasterCase(requiredCase(DEFAULT_LNS_BENCHMARK_CORPUS, "lns-service-overlap-pressure")),
  lnsToServiceMasterCase(requiredCase(DEFAULT_LNS_BENCHMARK_CORPUS, "seeded-service-anchor-pressure")),
  {
    name: "service-master-facility-coverage-pressure",
    description: "Generated facility-coverage pressure case where fixing service anchors simplifies residential packing.",
    family: "facility-coverage-pressure",
    split: "generated-pressure",
    problemSizeBand: "medium",
    grid: Array.from({ length: 8 }, () => Array(8).fill(1)),
    params: {
      optimizer: "greedy",
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 60, range: 2, avail: 1 },
        { rows: 2, cols: 1, bonus: 110, range: 2, avail: 1 },
        { rows: 1, cols: 2, bonus: 100, range: 2, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 240, avail: 3 },
        { w: 2, h: 3, min: 160, max: 420, avail: 2 },
        { w: 3, h: 3, min: 240, max: 660, avail: 1 },
      ],
      availableBuildings: { services: 2, residentials: 5 },
      greedy: {
        localSearch: true,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64,
      },
    },
  },
]);

function selectServiceMasterBenchmarkCases(names: readonly string[] | undefined): ServiceMasterBenchmarkCase[] {
  return selectBenchmarkCasesByName(DEFAULT_SERVICE_MASTER_BENCHMARK_CORPUS, names, {
    caseLabel: "service-master benchmark",
    corpusLabel: "Service-master benchmark",
  });
}

export function listServiceMasterBenchmarkCaseNames(): string[] {
  return listBenchmarkCaseNames(DEFAULT_SERVICE_MASTER_BENCHMARK_CORPUS, {
    caseLabel: "service-master benchmark",
    corpusLabel: "Service-master benchmark",
  });
}

function summarizeModeSolution(
  benchmarkCase: ServiceMasterBenchmarkCase,
  params: SolverParams,
  solution: Solution,
  wallClockSeconds: number
): ServiceMasterBenchmarkModeSummary {
  const validation = validateSolution({ grid: benchmarkCase.grid, params, solution });
  return {
    totalPopulation: solution.totalPopulation,
    wallClockSeconds: roundBenchmarkMetric(wallClockSeconds),
    valid: validation.valid,
    validationErrors: validation.errors,
    cpSatStatus: solution.cpSatStatus ?? null,
  };
}

async function defaultAutoSolve(G: Grid, params: SolverParams): Promise<Solution> {
  return solveAsync(G, params);
}

async function runServiceMasterBenchmarkRun(
  benchmarkCase: ServiceMasterBenchmarkCase,
  budgetSeconds: number,
  seed: number,
  options: ServiceMasterBenchmarkRunOptions
): Promise<ServiceMasterBenchmarkRun> {
  const solveAuto = options.solveAuto ?? defaultAutoSolve;
  const autoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds,
    seeds: [seed],
  });
  const autoStartedAt = performance.now();
  const autoSolution = await solveAuto(cloneBenchmarkGrid(benchmarkCase.grid), autoParams, {
    benchmarkCase,
    budgetSeconds,
    seed,
  });
  const autoWallClockSeconds = (performance.now() - autoStartedAt) / 1000;
  const serviceMasterStartedAt = performance.now();
  const serviceMaster = await solveServiceMasterDecomposition(benchmarkCase.grid, benchmarkCase.params, {
    ...options,
    seed,
    cpSat: {
      ...(options.cpSat ?? {}),
      timeLimitSeconds: options.cpSat?.timeLimitSeconds ?? Math.max(1, budgetSeconds),
      maxDeterministicTime: options.cpSat?.maxDeterministicTime ?? Math.max(1, budgetSeconds),
      numWorkers: options.cpSat?.numWorkers ?? 1,
      randomSeed: options.cpSat?.randomSeed ?? seed,
    },
  });
  const serviceMasterWallClockSeconds = (performance.now() - serviceMasterStartedAt) / 1000;
  const serviceMasterParams: SolverParams = {
    ...cloneBenchmarkSolverParams(benchmarkCase.params),
    optimizer: "cp-sat",
  };
  const auto = summarizeModeSolution(benchmarkCase, autoParams, autoSolution, autoWallClockSeconds);
  const serviceMasterSummary = summarizeModeSolution(
    benchmarkCase,
    serviceMasterParams,
    serviceMaster.solution,
    serviceMasterWallClockSeconds
  );
  const scoreDeltaVsAuto = serviceMasterSummary.totalPopulation - auto.totalPopulation;
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    family: benchmarkCase.family,
    split: benchmarkCase.split,
    budgetSeconds,
    seed,
    auto,
    serviceMaster: {
      ...serviceMasterSummary,
      telemetry: serviceMaster.telemetry,
    },
    scoreDeltaVsAuto,
    winVsAuto: scoreDeltaVsAuto > 0 ? "win" : scoreDeltaVsAuto < 0 ? "loss" : "tie",
  };
}

function summarizeServiceMasterBenchmarkRuns(runs: readonly ServiceMasterBenchmarkRun[]): ServiceMasterBenchmarkSummary {
  return {
    runCount: runs.length,
    winCount: countBenchmarkMatches(runs, (run) => run.winVsAuto === "win"),
    tieCount: countBenchmarkMatches(runs, (run) => run.winVsAuto === "tie"),
    lossCount: countBenchmarkMatches(runs, (run) => run.winVsAuto === "loss"),
    invalidRunCount: countBenchmarkMatches(runs, (run) => !run.auto.valid || !run.serviceMaster.valid),
    meanAutoPopulation: meanBenchmarkValue(runs.map((run) => run.auto.totalPopulation)),
    meanServiceMasterPopulation: meanBenchmarkValue(runs.map((run) => run.serviceMaster.totalPopulation)),
    meanScoreDeltaVsAuto: meanBenchmarkValue(runs.map((run) => run.scoreDeltaVsAuto)),
    meanServiceMasterWallClockSeconds: meanBenchmarkValue(runs.map((run) => run.serviceMaster.wallClockSeconds)),
    meanAutoWallClockSeconds: meanBenchmarkValue(runs.map((run) => run.auto.wallClockSeconds)),
    meanLayoutsSolved: meanNullableBenchmarkValue(runs.map((run) => run.serviceMaster.telemetry.layoutsSolved)),
  };
}

export async function runServiceMasterBenchmarkSuite(
  options: ServiceMasterBenchmarkRunOptions = {}
): Promise<ServiceMasterBenchmarkSuiteResult> {
  const selected = selectServiceMasterBenchmarkCases(options.names);
  assertBenchmarkCasesSelected(selected, "No service-master benchmark cases matched the requested names.");
  const budgetsSeconds = normalizeBudgets(options);
  const seeds = normalizeSeeds(options.seeds);
  const runs: ServiceMasterBenchmarkRun[] = [];
  for (const benchmarkCase of selected) {
    for (const budgetSeconds of budgetsSeconds) {
      for (const seed of seeds) {
        runs.push(await runServiceMasterBenchmarkRun(benchmarkCase, budgetSeconds, seed, options));
      }
    }
  }

  return {
    generatedAt: benchmarkGeneratedAt(),
    budgetSeconds: budgetsSeconds[0] ?? DEFAULT_SERVICE_MASTER_BUDGET_SECONDS,
    budgetsSeconds,
    seeds,
    caseCount: selected.length,
    selectedCaseNames: selected.map((benchmarkCase) => benchmarkCase.name),
    runs,
    summary: summarizeServiceMasterBenchmarkRuns(runs),
  };
}

export function formatServiceMasterBenchmarkSuite(result: ServiceMasterBenchmarkSuiteResult): string {
  const lines = [
    `Service-master decomposition scorecard (${result.generatedAt})`,
    `Cases: ${result.caseCount} (${result.selectedCaseNames.join(", ")})`,
    `Budgets: ${result.budgetsSeconds.join(", ")}s; seeds: ${result.seeds.join(", ")}`,
    `Summary: wins=${result.summary.winCount} ties=${result.summary.tieCount} losses=${result.summary.lossCount} invalid=${result.summary.invalidRunCount} mean-delta=${formatNullableBenchmarkSignedNumber(result.summary.meanScoreDeltaVsAuto)}`,
    `Mean wall: service-master=${formatNullableBenchmarkSeconds(result.summary.meanServiceMasterWallClockSeconds)} auto=${formatNullableBenchmarkSeconds(result.summary.meanAutoWallClockSeconds)} layouts-solved=${result.summary.meanLayoutsSolved ?? "n/a"}`,
  ];

  for (const run of result.runs) {
    const winLabel = run.winVsAuto === "win" ? "WIN" : run.winVsAuto === "loss" ? "LOSS" : "TIE";
    const layoutText = `${run.serviceMaster.telemetry.layoutsSolved}/${run.serviceMaster.telemetry.layoutCount}`;
    lines.push(
      `- ${run.name} [${run.family}/${run.split}] budget=${run.budgetSeconds}s seed=${run.seed}: ${winLabel} delta=${formatNullableBenchmarkSignedNumber(run.scoreDeltaVsAuto)} service-master=${run.serviceMaster.totalPopulation} auto=${run.auto.totalPopulation} valid=${run.serviceMaster.valid && run.auto.valid} layouts=${layoutText}`
    );
  }

  const winRate = result.summary.runCount > 0 ? result.summary.winCount / result.summary.runCount : 0;
  lines.push(`Win rate vs Auto: ${formatBenchmarkRate(winRate)}`);
  return lines.join("\n");
}
