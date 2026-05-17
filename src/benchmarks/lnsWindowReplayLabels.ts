import { performance } from "node:perf_hooks";

import {
  applyDeterministicDominanceUpgrades,
  getResidentialBaseMax,
  height,
  isAllowed,
  cellKey,
  normalizeServicePlacement,
  width,
  materializeValidLnsSeedSolution,
  validateSolution,
} from "../core/index.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { solveGreedy } from "../greedy/solver.js";
import {
  buildLnsWarmStartHint,
  buildNeighborhoodCandidates,
  buildNeighborhoodWindows,
} from "../lns/solver.js";
import { selectNeighborhoodWindow } from "../lns/neighborhoods.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { buildBenchmarkSeedRunPlan } from "./benchmarkSeeds.js";
import {
  applyNormalizedGreedyBenchmarkParams,
  benchmarkGeneratedAt,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  formatBenchmarkSignedNumber as formatSigned,
  inheritGreedyBenchmarkOptions,
  listBenchmarkCaseNames,
  nonNegativeIntegerOrDefault,
  positiveFiniteNumberOrDefault,
  positiveIntegerOrDefault,
  selectBenchmarkCasesByName,
  sumBenchmarkBy,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import {
  DEFAULT_LNS_REPLAY_LABEL_CORPUS,
  getLnsReplayPressureFamily,
  normalizeLnsBenchmarkOptions,
} from "./lns.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatOptions,
  GreedyOptions,
  Grid,
  LnsOptions,
  LnsRepairOperatorName,
  Solution,
  SolverParams,
} from "../core/types.js";
import type {
  LnsBenchmarkCase,
  LnsReplayPressureFamilyLabel,
} from "./lns.js";

export interface LnsWindowReplayLabelRunOptions {
  names?: readonly string[];
  seeds?: readonly number[];
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
}

export interface LnsWindowReplayFeatures {
  operatorName: LnsRepairOperatorName;
  operatorScore: number;
  operatorExploration: boolean;
  candidateWindowCount: number;
  candidateRankRatio: number;
  area: number;
  windowAreaRatio: number;
  touchesRoadAnchorBoundary: boolean;
  touchesTopBoundary: boolean;
  touchesLeftBoundary: boolean;
  minAnchorDistance: number;
  anchorBoundaryCellCount: number;
  anchorBoundaryCoverageRatio: number;
  allowedCellCountInside: number;
  blockedCellCountInside: number;
  roadCountInside: number;
  serviceCountInside: number;
  serviceFootprintCellsInside: number;
  residentialCountInside: number;
  residentialFootprintCellsInside: number;
  occupiedBuildingCellCountInside: number;
  emptyAllowedCellCountInside: number;
  roadDensityInside: number;
  buildingDensityInside: number;
  emptyAllowedRatioInside: number;
  residentialHeadroomInside: number;
  residentialHeadroomDensityInside: number;
  serviceBonusInside: number;
  serviceBonusDensityInside: number;
  selectedByBaseline: boolean;
}

export interface LnsWindowReplayLabel {
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  windowIndex: number;
  selectionSource: "baseline-top-k" | "exploration-tail";
  window: CpSatNeighborhoodWindow;
  selectedByBaseline: boolean;
  incumbentPopulation: number;
  totalPopulation: number;
  populationDelta: number;
  improvement: number;
  status: "improved" | "neutral" | "regressed" | "invalid" | "recoverable-failure";
  usable: boolean;
  cpSatStatus: string | null;
  repairTimeLimitSeconds: number;
  wallClockSeconds: number;
  validation: {
    valid: boolean;
    recomputedTotalPopulation: number;
  };
  features: LnsWindowReplayFeatures;
}

type ReplayValidationSummary = LnsWindowReplayLabel["validation"];

export interface LnsWindowReplayCaseResult {
  name: string;
  description: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  gridRows: number;
  gridCols: number;
  incumbentPopulation: number;
  candidateWindowCount: number;
  replayedWindowCount: number;
  baselineSelectedWindow: CpSatNeighborhoodWindow | null;
  labels: LnsWindowReplayLabel[];
}

export interface LnsWindowReplaySuiteResult {
  schemaVersion: 1;
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  pressureFamilies: LnsReplayPressureFamilyLabel[];
  maxWindows: number;
  explorationWindowCount: number;
  repairTimeLimitSeconds: number;
  labelCount: number;
  cases: LnsWindowReplayCaseResult[];
}

export interface LnsWindowReplaySnapshotLabel
  extends Omit<LnsWindowReplayLabel, "wallClockSeconds"> {}

export interface LnsWindowReplaySnapshotCaseResult
  extends Omit<LnsWindowReplayCaseResult, "labels"> {
  labels: LnsWindowReplaySnapshotLabel[];
}

export interface LnsWindowReplaySnapshot
  extends Omit<LnsWindowReplaySuiteResult, "generatedAt" | "cases"> {
  cases: LnsWindowReplaySnapshotCaseResult[];
}

function selectReplayCases(
  corpus: readonly LnsBenchmarkCase[],
  names: readonly string[] | undefined
): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "LNS window replay",
    corpusLabel: "LNS window replay",
  });
}

export function listLnsWindowReplayCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_REPLAY_LABEL_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "LNS window replay",
    corpusLabel: "LNS window replay",
  });
}

function buildReplayParams(
  benchmarkCase: LnsBenchmarkCase,
  seed: number | null,
  options: LnsWindowReplayLabelRunOptions
): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const greedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions<GreedyOptions>(params), {
    ...(options.greedy ?? {}),
    ...(seed !== null ? { randomSeed: seed } : {}),
  });
  return {
    ...applyNormalizedGreedyBenchmarkParams(params, greedy),
    optimizer: "lns",
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, {
      ...(options.cpSat ?? {}),
      ...(seed !== null ? { randomSeed: seed } : {}),
    }),
    lns: normalizeLnsBenchmarkOptions(params.lns, options.lns),
  };
}

function buildInitialIncumbent(G: Grid, params: SolverParams): Solution {
  const seededIncumbent = materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
  if (seededIncumbent) {
    return applyDeterministicDominanceUpgrades(G, params, seededIncumbent);
  }
  return applyDeterministicDominanceUpgrades(G, params, {
    ...solveGreedy(G, {
      ...params,
      optimizer: "greedy",
      greedy: {
        ...(params.greedy ?? {}),
        profile: false,
      },
    }),
    optimizer: "lns",
  });
}

function rectangleOverlapArea(
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): number {
  const rowStart = Math.max(window.top, r);
  const rowEnd = Math.min(window.top + window.rows, r + rows);
  const colStart = Math.max(window.left, c);
  const colEnd = Math.min(window.left + window.cols, c + cols);
  return Math.max(0, rowEnd - rowStart) * Math.max(0, colEnd - colStart);
}

function addRectangleOverlapCells(
  target: Set<string>,
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): void {
  const rowStart = Math.max(window.top, r);
  const rowEnd = Math.min(window.top + window.rows, r + rows);
  const colStart = Math.max(window.left, c);
  const colEnd = Math.min(window.left + window.cols, c + cols);
  for (let rr = rowStart; rr < rowEnd; rr++) {
    for (let cc = colStart; cc < colEnd; cc++) {
      target.add(cellKey(rr, cc));
    }
  }
}

function sameWindow(left: CpSatNeighborhoodWindow | null, right: CpSatNeighborhoodWindow): boolean {
  return left !== null
    && left.top === right.top
    && left.left === right.left
    && left.rows === right.rows
    && left.cols === right.cols;
}

function buildWindowFeatures(
  G: Grid,
  window: CpSatNeighborhoodWindow,
  plan: Pick<
    ReplayWindowPlan,
    "operatorName" | "operatorScore" | "operatorExploration" | "candidateWindowCount" | "candidateRankRatio"
  >,
  params: SolverParams,
  incumbent: Solution,
  selectedWindow: CpSatNeighborhoodWindow | null
): LnsWindowReplayFeatures {
  let serviceCountInside = 0;
  let serviceFootprintCellsInside = 0;
  let serviceBonusInside = 0;
  const occupiedBuildingCells = new Set<string>();
  for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
    const service = normalizeServicePlacement(incumbent.services[serviceIndex]);
    const overlapArea = rectangleOverlapArea(window, service.r, service.c, service.rows, service.cols);
    if (overlapArea <= 0) continue;
    serviceCountInside += 1;
    serviceFootprintCellsInside += overlapArea;
    serviceBonusInside += incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
    addRectangleOverlapCells(occupiedBuildingCells, window, service.r, service.c, service.rows, service.cols);
  }

  let residentialCountInside = 0;
  let residentialFootprintCellsInside = 0;
  let residentialHeadroomInside = 0;
  for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
    const residential = incumbent.residentials[residentialIndex];
    const overlapArea = rectangleOverlapArea(window, residential.r, residential.c, residential.rows, residential.cols);
    if (overlapArea <= 0) continue;
    residentialCountInside += 1;
    residentialFootprintCellsInside += overlapArea;
    const typeIndex = incumbent.residentialTypeIndices[residentialIndex];
    const { max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    residentialHeadroomInside += Math.max(0, max - (incumbent.populations[residentialIndex] ?? 0));
    addRectangleOverlapCells(occupiedBuildingCells, window, residential.r, residential.c, residential.rows, residential.cols);
  }

  let allowedCellCountInside = 0;
  let blockedCellCountInside = 0;
  let roadCountInside = 0;
  let emptyAllowedCellCountInside = 0;
  let anchorBoundaryCellCount = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (r === 0 || c === 0) anchorBoundaryCellCount += 1;
      const key = cellKey(r, c);
      if (!isAllowed(G, r, c)) {
        blockedCellCountInside += 1;
        continue;
      }
      allowedCellCountInside += 1;
      const hasRoad = incumbent.roads.has(key);
      if (hasRoad) roadCountInside += 1;
      if (!hasRoad && !occupiedBuildingCells.has(key)) emptyAllowedCellCountInside += 1;
    }
  }

  const area = window.rows * window.cols;
  const gridArea = Math.max(1, height(G) * width(G));
  const buildingCellCount = occupiedBuildingCells.size;
  return {
    operatorName: plan.operatorName,
    operatorScore: plan.operatorScore,
    operatorExploration: plan.operatorExploration,
    candidateWindowCount: plan.candidateWindowCount,
    candidateRankRatio: plan.candidateRankRatio,
    area,
    windowAreaRatio: area / gridArea,
    touchesRoadAnchorBoundary: window.top === 0 || window.left === 0,
    touchesTopBoundary: window.top === 0,
    touchesLeftBoundary: window.left === 0,
    minAnchorDistance: Math.min(window.top, window.left),
    anchorBoundaryCellCount,
    anchorBoundaryCoverageRatio: anchorBoundaryCellCount / Math.max(1, area),
    allowedCellCountInside,
    blockedCellCountInside,
    roadCountInside,
    serviceCountInside,
    serviceFootprintCellsInside,
    residentialCountInside,
    residentialFootprintCellsInside,
    occupiedBuildingCellCountInside: buildingCellCount,
    emptyAllowedCellCountInside,
    roadDensityInside: roadCountInside / Math.max(1, allowedCellCountInside),
    buildingDensityInside: buildingCellCount / Math.max(1, allowedCellCountInside),
    emptyAllowedRatioInside: emptyAllowedCellCountInside / Math.max(1, allowedCellCountInside),
    residentialHeadroomInside,
    residentialHeadroomDensityInside: residentialHeadroomInside / Math.max(1, area),
    serviceBonusInside,
    serviceBonusDensityInside: serviceBonusInside / Math.max(1, area),
    selectedByBaseline: sameWindow(selectedWindow, window),
  };
}

function formatWindow(window: CpSatNeighborhoodWindow | null): string {
  return window === null ? "n/a" : `${window.top}:${window.left}:${window.rows}x${window.cols}`;
}

function labelWithoutWallClock(label: LnsWindowReplayLabel): LnsWindowReplaySnapshotLabel {
  const { wallClockSeconds: _wallClockSeconds, ...snapshot } = label;
  return snapshot;
}

function validateReplaySolution(G: Grid, params: SolverParams, solution: Solution): ReplayValidationSummary {
  const validation = validateSolution({ grid: G, params, solution });
  return {
    valid: validation.valid,
    recomputedTotalPopulation: validation.recomputedTotalPopulation,
  };
}

function statusForPopulationDelta(populationDelta: number): LnsWindowReplayLabel["status"] {
  if (populationDelta > 0) return "improved";
  if (populationDelta < 0) return "regressed";
  return "neutral";
}

function replayWindow(
  G: Grid,
  params: SolverParams,
  caseName: string,
  pressureFamily: LnsReplayPressureFamilyLabel,
  seed: number | null,
  incumbent: Solution,
  plan: ReplayWindowPlan,
  selectedWindow: CpSatNeighborhoodWindow | null,
  repairTimeLimitSeconds: number
): LnsWindowReplayLabel {
  const startedAtMs = performance.now();
  const features = buildWindowFeatures(G, plan.window, plan, params, incumbent, selectedWindow);
  try {
    const candidate = solveCpSat(G, {
      ...params,
      optimizer: "cp-sat",
      cpSat: {
        ...(params.cpSat ?? {}),
        numWorkers: 1,
        timeLimitSeconds: repairTimeLimitSeconds,
        warmStartHint: buildLnsWarmStartHint(incumbent, plan.window),
      },
    });
    const populationDelta = candidate.totalPopulation - incumbent.totalPopulation;
    const validation = validateReplaySolution(G, params, candidate);
    const status = validation.valid ? statusForPopulationDelta(populationDelta) : "invalid";
    return {
      caseName,
      pressureFamily,
      seed,
      windowIndex: plan.windowIndex,
      selectionSource: plan.selectionSource,
      window: { ...plan.window },
      selectedByBaseline: features.selectedByBaseline,
      incumbentPopulation: incumbent.totalPopulation,
      totalPopulation: candidate.totalPopulation,
      populationDelta,
      improvement: Math.max(0, populationDelta),
      status,
      usable: validation.valid,
      cpSatStatus: candidate.cpSatStatus ?? null,
      repairTimeLimitSeconds,
      wallClockSeconds: (performance.now() - startedAtMs) / 1000,
      validation,
      features,
    };
  } catch (error) {
    if (!(error instanceof Error) || !/No feasible solution found with CP-SAT\./.test(error.message)) {
      throw error;
    }
    return {
      caseName,
      pressureFamily,
      seed,
      windowIndex: plan.windowIndex,
      selectionSource: plan.selectionSource,
      window: { ...plan.window },
      selectedByBaseline: features.selectedByBaseline,
      incumbentPopulation: incumbent.totalPopulation,
      totalPopulation: incumbent.totalPopulation,
      populationDelta: 0,
      improvement: 0,
      status: "recoverable-failure",
      usable: false,
      cpSatStatus: null,
      repairTimeLimitSeconds,
      wallClockSeconds: (performance.now() - startedAtMs) / 1000,
      validation: validateReplaySolution(G, params, incumbent),
      features,
    };
  }
}

interface ReplayWindowPlan {
  window: CpSatNeighborhoodWindow;
  windowIndex: number;
  selectionSource: LnsWindowReplayLabel["selectionSource"];
  operatorName: LnsRepairOperatorName;
  operatorScore: number;
  operatorExploration: boolean;
  candidateWindowCount: number;
  candidateRankRatio: number;
}

function replayWindowKey(window: CpSatNeighborhoodWindow): string {
  return `${window.top}:${window.left}:${window.rows}:${window.cols}`;
}

function selectReplayWindowPlans(
  candidates: ReturnType<typeof buildNeighborhoodCandidates>,
  maxWindows: number,
  explorationWindowCount: number
): ReplayWindowPlan[] {
  const windows = uniqueWindowPlansFromCandidates(candidates);
  const selected = new Map<string, ReplayWindowPlan>();
  for (const plan of windows.slice(0, maxWindows)) {
    selected.set(replayWindowKey(plan.window), {
      ...plan,
      selectionSource: "baseline-top-k",
    });
  }

  if (explorationWindowCount <= 0 || windows.length <= maxWindows) {
    return [...selected.values()];
  }

  const tail = windows.slice(maxWindows);
  const stride = Math.max(1, Math.floor(tail.length / explorationWindowCount));
  let explorationAdded = 0;
  for (let index = tail.length - 1; index >= 0 && explorationAdded < explorationWindowCount; index -= stride) {
    const plan = tail[index]!;
    const key = replayWindowKey(plan.window);
    if (selected.has(key)) continue;
    selected.set(key, {
      ...plan,
      selectionSource: "exploration-tail",
    });
    explorationAdded++;
  }

  return [...selected.values()];
}

function uniqueWindowPlansFromCandidates(
  candidates: ReturnType<typeof buildNeighborhoodCandidates>
): ReplayWindowPlan[] {
  const selected = new Map<string, ReplayWindowPlan>();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const key = replayWindowKey(candidate.window);
    if (selected.has(key)) continue;
    selected.set(key, {
      window: candidate.window,
      windowIndex: candidateIndex,
      selectionSource: "baseline-top-k",
      operatorName: candidate.operatorName,
      operatorScore: candidate.score,
      operatorExploration: candidate.exploration,
      candidateWindowCount: 0,
      candidateRankRatio: 0,
    });
  }
  const values = [...selected.values()];
  const candidateWindowCount = values.length;
  return values.map((plan) => ({
    ...plan,
    candidateWindowCount,
    candidateRankRatio: candidateWindowCount <= 1
      ? 0
      : plan.windowIndex / (candidateWindowCount - 1),
  }));
}

export function runLnsWindowReplayLabels(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_REPLAY_LABEL_CORPUS,
  options: LnsWindowReplayLabelRunOptions = {}
): LnsWindowReplaySuiteResult {
  const selectedCases = selectReplayCases(corpus, options.names);
  const { seeds, seedRuns } = buildBenchmarkSeedRunPlan(options.seeds, "LNS window replay seeds");
  const maxWindows = positiveIntegerOrDefault(options.maxWindows, 8);
  const explorationWindowCount = nonNegativeIntegerOrDefault(options.explorationWindowCount, 0);
  const replayRepairTimeLimitSeconds = positiveFiniteNumberOrDefault(options.repairTimeLimitSeconds, 1);
  const cases = seedRuns.flatMap((seed) =>
    selectedCases.map((benchmarkCase): LnsWindowReplayCaseResult => {
      const G = cloneBenchmarkGrid(benchmarkCase.grid);
      const params = buildReplayParams(benchmarkCase, seed, options);
      const incumbent = buildInitialIncumbent(G, params);
      const lns = params.lns ?? {};
      const neighborhoodOptions = {
        maxNoImprovementIterations: lns.maxNoImprovementIterations ?? 4,
        neighborhoodRows: lns.neighborhoodRows ?? Math.max(1, Math.ceil(height(G) / 2)),
        neighborhoodCols: lns.neighborhoodCols ?? Math.max(1, Math.ceil(width(G) / 2)),
        neighborhoodAnchorPolicy: lns.neighborhoodAnchorPolicy,
      };
      const candidates = buildNeighborhoodCandidates(G, params, incumbent, neighborhoodOptions, 1);
      const windows = buildNeighborhoodWindows(G, params, incumbent, neighborhoodOptions, 1);
      const selectedWindow = windows.length
        ? selectNeighborhoodWindow(windows, 0, 0, neighborhoodOptions)
        : null;
      const replayWindows = selectReplayWindowPlans(candidates, maxWindows, explorationWindowCount);
      const pressureFamily = getLnsReplayPressureFamily(benchmarkCase);
      const labels = replayWindows.map((plan) =>
        replayWindow(
          G,
          params,
          benchmarkCase.name,
          pressureFamily,
          seed,
          incumbent,
          plan,
          selectedWindow,
          replayRepairTimeLimitSeconds
        )
      );
      return {
        name: benchmarkCase.name,
        description: benchmarkCase.description,
        pressureFamily,
        seed,
        gridRows: height(G),
        gridCols: width(G),
        incumbentPopulation: incumbent.totalPopulation,
        candidateWindowCount: windows.length,
        replayedWindowCount: labels.length,
        baselineSelectedWindow: selectedWindow ? { ...selectedWindow } : null,
        labels,
      };
    })
  );

  return {
    schemaVersion: 1,
    generatedAt: benchmarkGeneratedAt(),
    caseCount: selectedCases.length,
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    selectedCaseNames: selectedCases.map((benchmarkCase) => benchmarkCase.name),
    pressureFamilies: uniqueBenchmarkValuesBy(selectedCases, getLnsReplayPressureFamily),
    maxWindows,
    explorationWindowCount,
    repairTimeLimitSeconds: replayRepairTimeLimitSeconds,
    labelCount: sumBenchmarkBy(cases, (benchmarkCase) => benchmarkCase.labels.length),
    cases,
  };
}

export function createLnsWindowReplaySnapshot(
  result: LnsWindowReplaySuiteResult
): LnsWindowReplaySnapshot {
  return {
    caseCount: result.caseCount,
    schemaVersion: result.schemaVersion,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    pressureFamilies: [...result.pressureFamilies],
    maxWindows: result.maxWindows,
    explorationWindowCount: result.explorationWindowCount,
    repairTimeLimitSeconds: result.repairTimeLimitSeconds,
    labelCount: result.labelCount,
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baselineSelectedWindow: benchmarkCase.baselineSelectedWindow
        ? { ...benchmarkCase.baselineSelectedWindow }
        : null,
      labels: benchmarkCase.labels.map(labelWithoutWallClock),
    })),
  };
}

export function formatLnsWindowReplayLabels(result: LnsWindowReplaySuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Replay Labels ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${result.seeds.length ? result.seeds.join(", ") : "case-default"}`);
  lines.push(`Labels: ${result.labelCount}`);
  lines.push(`Max windows: ${result.maxWindows}`);
  lines.push(`Exploration windows: ${result.explorationWindowCount}`);
  lines.push(`Pressure families: ${result.pressureFamilies.join(", ")}`);
  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(
      `- ${benchmarkCase.name} family=${benchmarkCase.pressureFamily} seed=${seedLabel}: incumbent=${benchmarkCase.incumbentPopulation} windows=${benchmarkCase.replayedWindowCount}/${benchmarkCase.candidateWindowCount} selected=${formatWindow(benchmarkCase.baselineSelectedWindow)}`
    );
    for (const label of benchmarkCase.labels) {
      lines.push(
        `  window#${label.windowIndex} ${formatWindow(label.window)} source=${label.selectionSource} operator=${label.features.operatorName} selected=${label.selectedByBaseline} status=${label.status} usable=${label.usable} population=${label.totalPopulation} delta=${formatSigned(label.populationDelta)} improvement=+${label.improvement} repair=${label.repairTimeLimitSeconds}s valid=${label.validation.valid} features=area:${label.features.area} allowed:${label.features.allowedCellCountInside} empty:${label.features.emptyAllowedCellCountInside} roads:${label.features.roadCountInside} services:${label.features.serviceCountInside} service-cells:${label.features.serviceFootprintCellsInside} residentials:${label.features.residentialCountInside} residential-cells:${label.features.residentialFootprintCellsInside} headroom:${label.features.residentialHeadroomInside} service-bonus:${label.features.serviceBonusInside}`
      );
    }
  }
  return lines.join("\n");
}
