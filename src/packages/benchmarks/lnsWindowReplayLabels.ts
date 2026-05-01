import { performance } from "node:perf_hooks";

import {
  applyDeterministicDominanceUpgrades,
  getResidentialBaseMax,
  height,
  normalizeServicePlacement,
  width,
  materializeValidLnsSeedSolution,
  validateSolution,
} from "../core/index.js";
import {
  buildLnsWarmStartHint,
  buildAdaptiveNeighborhoodCandidates,
  selectAdaptiveNeighborhoodOperator,
  solveCpSat,
  solveGreedy,
} from "../solvers/index.js";
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
  LnsAdaptiveOperatorName,
  LnsOptions,
  Solution,
  SolverParams,
} from "../core/index.js";
import type { LnsAdaptiveNeighborhoodCandidate } from "../solvers/index.js";
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
  area: number;
  touchesRoadAnchorBoundary: boolean;
  roadCountInside: number;
  serviceCountInside: number;
  residentialCountInside: number;
  residentialHeadroomInside: number;
  serviceBonusInside: number;
  selectedByBaseline: boolean;
}

export interface LnsWindowReplayLabel {
  caseName: string;
  pressureFamily: LnsReplayPressureFamilyLabel;
  seed: number | null;
  windowIndex: number;
  operator: LnsAdaptiveOperatorName;
  operatorScore: number;
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
  baselineSelectedOperator: LnsAdaptiveOperatorName | null;
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

function rectangleIntersectsWindow(
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  return r < window.top + window.rows
    && r + rows > window.top
    && c < window.left + window.cols
    && c + cols > window.left;
}

function roadInsideWindow(window: CpSatNeighborhoodWindow, key: string): boolean {
  const [rRaw, cRaw] = key.split(",");
  const r = Number(rRaw);
  const c = Number(cRaw);
  return Number.isInteger(r)
    && Number.isInteger(c)
    && r >= window.top
    && r < window.top + window.rows
    && c >= window.left
    && c < window.left + window.cols;
}

function sameWindow(left: CpSatNeighborhoodWindow | null, right: CpSatNeighborhoodWindow): boolean {
  return left !== null
    && left.top === right.top
    && left.left === right.left
    && left.rows === right.rows
    && left.cols === right.cols;
}

function sameCandidate(
  left: LnsAdaptiveNeighborhoodCandidate | null,
  right: LnsAdaptiveNeighborhoodCandidate
): boolean {
  return left !== null
    && left.operator === right.operator
    && sameWindow(left.window, right.window);
}

function buildWindowFeatures(
  window: CpSatNeighborhoodWindow,
  params: SolverParams,
  incumbent: Solution,
  selectedByBaseline: boolean
): LnsWindowReplayFeatures {
  let serviceCountInside = 0;
  let serviceBonusInside = 0;
  for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
    const service = normalizeServicePlacement(incumbent.services[serviceIndex]);
    if (!rectangleIntersectsWindow(window, service.r, service.c, service.rows, service.cols)) continue;
    serviceCountInside += 1;
    serviceBonusInside += incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
  }

  let residentialCountInside = 0;
  let residentialHeadroomInside = 0;
  for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
    const residential = incumbent.residentials[residentialIndex];
    if (!rectangleIntersectsWindow(window, residential.r, residential.c, residential.rows, residential.cols)) continue;
    residentialCountInside += 1;
    const typeIndex = incumbent.residentialTypeIndices[residentialIndex];
    const { max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    residentialHeadroomInside += Math.max(0, max - (incumbent.populations[residentialIndex] ?? 0));
  }

  return {
    area: window.rows * window.cols,
    touchesRoadAnchorBoundary: window.top === 0 || window.left === 0,
    roadCountInside: [...incumbent.roads].filter((key) => roadInsideWindow(window, key)).length,
    serviceCountInside,
    residentialCountInside,
    residentialHeadroomInside,
    serviceBonusInside,
    selectedByBaseline,
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
  candidate: LnsAdaptiveNeighborhoodCandidate,
  windowIndex: number,
  selectionSource: LnsWindowReplayLabel["selectionSource"],
  selectedCandidate: LnsAdaptiveNeighborhoodCandidate | null,
  repairTimeLimitSeconds: number
): LnsWindowReplayLabel {
  const startedAtMs = performance.now();
  const { window } = candidate;
  const selectedByBaseline = sameCandidate(selectedCandidate, candidate);
  const features = buildWindowFeatures(window, params, incumbent, selectedByBaseline);
  try {
    const repairedSolution = solveCpSat(G, {
      ...params,
      optimizer: "cp-sat",
      cpSat: {
        ...(params.cpSat ?? {}),
        numWorkers: 1,
        timeLimitSeconds: repairTimeLimitSeconds,
        warmStartHint: buildLnsWarmStartHint(incumbent, window),
      },
    });
    const populationDelta = repairedSolution.totalPopulation - incumbent.totalPopulation;
    const validation = validateReplaySolution(G, params, repairedSolution);
    const status = validation.valid ? statusForPopulationDelta(populationDelta) : "invalid";
    return {
      caseName,
      pressureFamily,
      seed,
      windowIndex,
      operator: candidate.operator,
      operatorScore: candidate.score,
      selectionSource,
      window: { ...window },
      selectedByBaseline: features.selectedByBaseline,
      incumbentPopulation: incumbent.totalPopulation,
      totalPopulation: repairedSolution.totalPopulation,
      populationDelta,
      improvement: Math.max(0, populationDelta),
      status,
      usable: validation.valid,
      cpSatStatus: repairedSolution.cpSatStatus ?? null,
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
      windowIndex,
      operator: candidate.operator,
      operatorScore: candidate.score,
      selectionSource,
      window: { ...window },
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
  candidate: LnsAdaptiveNeighborhoodCandidate;
  windowIndex: number;
  selectionSource: LnsWindowReplayLabel["selectionSource"];
}

function replayCandidateKey(candidate: LnsAdaptiveNeighborhoodCandidate): string {
  const { window } = candidate;
  return `${candidate.operator}:${window.top}:${window.left}:${window.rows}:${window.cols}`;
}

function selectReplayWindowPlans(
  candidates: readonly LnsAdaptiveNeighborhoodCandidate[],
  maxWindows: number,
  explorationWindowCount: number
): ReplayWindowPlan[] {
  const selected = new Map<string, ReplayWindowPlan>();
  for (const [windowIndex, candidate] of candidates.slice(0, maxWindows).entries()) {
    selected.set(replayCandidateKey(candidate), {
      candidate,
      windowIndex,
      selectionSource: "baseline-top-k",
    });
  }

  if (explorationWindowCount <= 0 || candidates.length <= maxWindows) {
    return [...selected.values()];
  }

  const tail = candidates.slice(maxWindows);
  const stride = Math.max(1, Math.floor(tail.length / explorationWindowCount));
  let explorationAdded = 0;
  for (let index = tail.length - 1; index >= 0 && explorationAdded < explorationWindowCount; index -= stride) {
    const candidate = tail[index];
    const key = replayCandidateKey(candidate);
    if (selected.has(key)) continue;
    selected.set(key, {
      candidate,
      windowIndex: maxWindows + index,
      selectionSource: "exploration-tail",
    });
    explorationAdded++;
  }

  return [...selected.values()];
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
      const candidates = buildAdaptiveNeighborhoodCandidates(G, params, incumbent, neighborhoodOptions, 1);
      const selectedCandidate = candidates.length
        ? selectAdaptiveNeighborhoodOperator(candidates, 0, 0, neighborhoodOptions)
        : null;
      const replayWindows = selectReplayWindowPlans(candidates, maxWindows, explorationWindowCount);
      const pressureFamily = getLnsReplayPressureFamily(benchmarkCase);
      const labels = replayWindows.map(({ candidate, windowIndex, selectionSource }) =>
        replayWindow(
          G,
          params,
          benchmarkCase.name,
          pressureFamily,
          seed,
          incumbent,
          candidate,
          windowIndex,
          selectionSource,
          selectedCandidate,
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
        candidateWindowCount: candidates.length,
        replayedWindowCount: labels.length,
        baselineSelectedWindow: selectedCandidate ? { ...selectedCandidate.window } : null,
        baselineSelectedOperator: selectedCandidate?.operator ?? null,
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
      `- ${benchmarkCase.name} family=${benchmarkCase.pressureFamily} seed=${seedLabel}: incumbent=${benchmarkCase.incumbentPopulation} windows=${benchmarkCase.replayedWindowCount}/${benchmarkCase.candidateWindowCount} selected=${benchmarkCase.baselineSelectedOperator ?? "n/a"}:${formatWindow(benchmarkCase.baselineSelectedWindow)}`
    );
    for (const label of benchmarkCase.labels) {
      lines.push(
        `  window#${label.windowIndex} ${formatWindow(label.window)} operator=${label.operator} score=${label.operatorScore.toFixed(3)} source=${label.selectionSource} selected=${label.selectedByBaseline} status=${label.status} usable=${label.usable} population=${label.totalPopulation} delta=${formatSigned(label.populationDelta)} improvement=+${label.improvement} repair=${label.repairTimeLimitSeconds}s valid=${label.validation.valid} features=area:${label.features.area} roads:${label.features.roadCountInside} services:${label.features.serviceCountInside} residentials:${label.features.residentialCountInside} headroom:${label.features.residentialHeadroomInside} service-bonus:${label.features.serviceBonusInside}`
      );
    }
  }
  return lines.join("\n");
}
