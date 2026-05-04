import { performance } from "node:perf_hooks";

import {
  applyDeterministicDominanceUpgrades,
  height,
  materializeValidLnsSeedSolution,
  validateSolution,
  width
} from "../core/index.js";
import { computeCpSatRequestFingerprint } from "../core/cpSatContinuation.js";
import {
  buildLnsWarmStartHint,
  buildAdaptiveNeighborhoodCandidates,
  selectAdaptiveNeighborhoodOperator,
  solveCpSat,
  solveGreedy,
  solveLns
} from "../solvers/index.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { buildBenchmarkSeedRunPlan } from "./benchmarkSeeds.js";
import {
  applyNormalizedGreedyBenchmarkParams,
  benchmarkGeneratedAt,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  inheritGreedyBenchmarkOptions,
  listBenchmarkCaseNames,
  nonNegativeIntegerOrDefault,
  positiveFiniteNumberOrDefault,
  positiveIntegerOrDefault,
  selectBenchmarkCasesByName,
  sumBenchmarkBy,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, getLnsReplayPressureFamily, normalizeLnsBenchmarkOptions } from "./lns.js";
import { buildWindowFeatures, sameCandidate } from "./lnsWindowReplayFeatures.js";
import {
  DEFAULT_LNS_WINDOW_REPLAY_STATE_POLICIES,
  LNS_WINDOW_REPLAY_CP_SAT_CANDIDATE_KEY_VERSION,
  LNS_WINDOW_REPLAY_CP_SAT_MODEL_ENCODING_VERSION,
  LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
  LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
  LNS_WINDOW_REPLAY_STATE_POLICIES
} from "./lnsWindowReplayTypes.js";

import type { GreedyOptions, Grid, LnsOptions, Solution, SolverParams } from "../core/index.js";
import type { LnsAdaptiveNeighborhoodCandidate } from "../solvers/index.js";
import type { LnsBenchmarkCase, LnsReplayPressureFamilyLabel } from "./lns.js";
import type {
  LnsWindowReplayCaseResult,
  LnsWindowReplayCpSatMetadata,
  LnsWindowReplayLabel,
  LnsWindowReplayLabelRunOptions,
  LnsWindowReplayRollForwardOutcome,
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel,
  LnsWindowReplayStatePolicy,
  LnsWindowReplayStateSourceStatus,
  LnsWindowReplaySuiteResult,
  LnsWindowReplayTiming
} from "./lnsWindowReplayTypes.js";

export {
  DEFAULT_LNS_WINDOW_REPLAY_STATE_POLICIES,
  LNS_WINDOW_REPLAY_CP_SAT_CANDIDATE_KEY_VERSION,
  LNS_WINDOW_REPLAY_CP_SAT_MODEL_ENCODING_VERSION,
  LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
  LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
  LNS_WINDOW_REPLAY_STATE_POLICIES
} from "./lnsWindowReplayTypes.js";
export type {
  LnsWindowReplayCandidateLossFeatures,
  LnsWindowReplayCaseResult,
  LnsWindowReplayConnectivityShadowFeatures,
  LnsWindowReplayCpSatMetadata,
  LnsWindowReplayFeatures,
  LnsWindowReplayFragmentationFeatures,
  LnsWindowReplayLabel,
  LnsWindowReplayLabelRunOptions,
  LnsWindowReplayRollForwardOutcome,
  LnsWindowReplayRollForwardStatus,
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotCaseResult,
  LnsWindowReplaySnapshotLabel,
  LnsWindowReplaySnapshotTiming,
  LnsWindowReplayStatePolicy,
  LnsWindowReplayStateSourceStatus,
  LnsWindowReplaySuiteResult,
  LnsWindowReplayTiming
} from "./lnsWindowReplayTypes.js";
export { formatLnsWindowReplayLabels } from "./lnsWindowReplayFormatting.js";

type ReplayValidationSummary = LnsWindowReplayLabel["validation"];

function selectReplayCases(
  corpus: readonly LnsBenchmarkCase[],
  names: readonly string[] | undefined
): LnsBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "LNS window replay",
    corpusLabel: "LNS window replay"
  });
}

export function listLnsWindowReplayCaseNames(
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_REPLAY_LABEL_CORPUS
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "LNS window replay",
    corpusLabel: "LNS window replay"
  });
}

const LNS_WINDOW_REPLAY_STATE_POLICY_SET = new Set<string>(LNS_WINDOW_REPLAY_STATE_POLICIES);

function normalizeLnsWindowReplayStatePolicies(
  statePolicies: readonly LnsWindowReplayStatePolicy[] | undefined
): LnsWindowReplayStatePolicy[] {
  const rawPolicies = statePolicies?.length ? statePolicies : DEFAULT_LNS_WINDOW_REPLAY_STATE_POLICIES;
  const normalized: LnsWindowReplayStatePolicy[] = [];
  for (const policy of rawPolicies) {
    if (!LNS_WINDOW_REPLAY_STATE_POLICY_SET.has(policy)) {
      throw new Error(`Unknown LNS window replay state policy: ${String(policy)}.`);
    }
    if (!normalized.includes(policy)) normalized.push(policy);
  }
  return normalized;
}

function buildReplayParams(
  benchmarkCase: LnsBenchmarkCase,
  seed: number | null,
  options: LnsWindowReplayLabelRunOptions
): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const greedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions<GreedyOptions>(params), {
    ...(options.greedy ?? {}),
    ...(seed !== null ? { randomSeed: seed } : {})
  });
  return {
    ...applyNormalizedGreedyBenchmarkParams(params, greedy),
    optimizer: "lns",
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, {
      ...(options.cpSat ?? {}),
      ...(seed !== null ? { randomSeed: seed } : {})
    }),
    lns: normalizeLnsBenchmarkOptions(params.lns, options.lns)
  };
}

interface ReplayNeighborhoodOptions {
  maxNoImprovementIterations: number;
  neighborhoodRows: number;
  neighborhoodCols: number;
  neighborhoodAnchorPolicy: LnsOptions["neighborhoodAnchorPolicy"];
}

function buildReplayNeighborhoodOptions(G: Grid, params: SolverParams): ReplayNeighborhoodOptions {
  const lns = params.lns ?? {};
  return {
    maxNoImprovementIterations: lns.maxNoImprovementIterations ?? 4,
    neighborhoodRows: lns.neighborhoodRows ?? Math.max(1, Math.ceil(height(G) / 2)),
    neighborhoodCols: lns.neighborhoodCols ?? Math.max(1, Math.ceil(width(G) / 2)),
    neighborhoodAnchorPolicy: lns.neighborhoodAnchorPolicy
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
        profile: false
      }
    }),
    optimizer: "lns"
  });
}

function labelWithoutWallClock(label: LnsWindowReplayLabel): LnsWindowReplaySnapshotLabel {
  const { wallClockSeconds: _wallClockSeconds, timing, ...snapshot } = label;
  return {
    ...snapshot,
    timing: {
      repairTimeLimitSeconds: timing.repairTimeLimitSeconds,
      cpSatNumWorkers: timing.cpSatNumWorkers,
      workerCpuBudgetSeconds: timing.workerCpuBudgetSeconds
    }
  };
}

function validateReplaySolution(G: Grid, params: SolverParams, solution: Solution): ReplayValidationSummary {
  const validation = validateSolution({ grid: G, params, solution });
  return {
    valid: validation.valid,
    recomputedTotalPopulation: validation.recomputedTotalPopulation
  };
}

function statusForPopulationDelta(populationDelta: number): LnsWindowReplayLabel["status"] {
  if (populationDelta > 0) return "improved";
  if (populationDelta < 0) return "regressed";
  return "neutral";
}

function rollForwardStatusForPopulationDelta(
  populationDelta: number | null
): LnsWindowReplayRollForwardOutcome["statusVsBaseline"] {
  if (populationDelta === null) return "unknown";
  if (populationDelta > 0) return "improved";
  if (populationDelta < 0) return "regressed";
  return "neutral";
}

interface RollForwardOptions {
  iterations: number;
  repairTimeLimitSeconds: number;
}

function buildRollForwardOutcome(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  repairedSolution: Solution,
  window: LnsWindowReplayLabel["window"],
  options: RollForwardOptions
): LnsWindowReplayRollForwardOutcome {
  const rollForwardSolution = solveLns(G, {
    ...params,
    optimizer: "lns",
    lns: {
      ...(params.lns ?? {}),
      iterations: options.iterations,
      repairTimeLimitSeconds: options.repairTimeLimitSeconds,
      focusedRepairTimeLimitSeconds: options.repairTimeLimitSeconds,
      escalatedRepairTimeLimitSeconds: options.repairTimeLimitSeconds,
      seedHint: buildLnsWarmStartHint(repairedSolution, window)
    }
  });
  return {
    iterations: options.iterations,
    repairTimeLimitSeconds: options.repairTimeLimitSeconds,
    seedPopulation: repairedSolution.totalPopulation,
    totalPopulation: rollForwardSolution.totalPopulation,
    populationDeltaFromIncumbent: rollForwardSolution.totalPopulation - incumbent.totalPopulation,
    populationDeltaFromRepair: rollForwardSolution.totalPopulation - repairedSolution.totalPopulation,
    baselineTotalPopulation: null,
    populationDeltaVsBaseline: null,
    improvementVsBaseline: null,
    statusVsBaseline: "unknown"
  };
}

function isRecoverableCpSatFailure(error: unknown): boolean {
  return error instanceof Error && /No feasible solution found with CP-SAT\./.test(error.message);
}

function replayWindow(
  G: Grid,
  params: SolverParams,
  caseName: string,
  pressureFamily: LnsReplayPressureFamilyLabel,
  seed: number | null,
  statePolicy: LnsWindowReplayStatePolicy,
  stateIndex: number,
  stateSourceIteration: number | null,
  stateSourceStatus: LnsWindowReplayStateSourceStatus,
  stateStagnantIterations: number,
  incumbent: Solution,
  candidate: LnsAdaptiveNeighborhoodCandidate,
  windowIndex: number,
  selectionSource: LnsWindowReplayLabel["selectionSource"],
  selectedCandidate: LnsAdaptiveNeighborhoodCandidate | null,
  cpSatModelFingerprint: string,
  repairTimeLimitSeconds: number,
  rollForwardOptions: RollForwardOptions | null
): LnsWindowReplayLabel {
  const startedAtMs = performance.now();
  const { window } = candidate;
  const selectedByBaseline = sameCandidate(selectedCandidate, candidate);
  const features = buildWindowFeatures(G, window, params, incumbent, selectedByBaseline);
  const baseCpSatMetadata: LnsWindowReplayCpSatMetadata = {
    modelEncodingVersion: LNS_WINDOW_REPLAY_CP_SAT_MODEL_ENCODING_VERSION,
    candidateKeyVersion: LNS_WINDOW_REPLAY_CP_SAT_CANDIDATE_KEY_VERSION,
    modelFingerprint: cpSatModelFingerprint,
    warmStartFixOutsideNeighborhood: true,
    modelSize: null
  };
  try {
    const repairedSolution = solveCpSat(G, {
      ...params,
      optimizer: "cp-sat",
      cpSat: {
        ...(params.cpSat ?? {}),
        numWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
        timeLimitSeconds: repairTimeLimitSeconds,
        warmStartHint: buildLnsWarmStartHint(incumbent, window)
      }
    });
    const wallClockSeconds = (performance.now() - startedAtMs) / 1000;
    const populationDelta = repairedSolution.totalPopulation - incumbent.totalPopulation;
    const validation = validateReplaySolution(G, params, repairedSolution);
    const status = validation.valid ? statusForPopulationDelta(populationDelta) : "invalid";
    const rollForward =
      validation.valid && rollForwardOptions
        ? buildRollForwardOutcome(G, params, incumbent, repairedSolution, window, rollForwardOptions)
        : undefined;
    const timing: LnsWindowReplayTiming = {
      repairTimeLimitSeconds,
      cpSatNumWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
      workerCpuBudgetSeconds: repairTimeLimitSeconds * LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
      wallClockSeconds,
      cpSatSolveWallTimeSeconds: repairedSolution.cpSatTelemetry?.solveWallTimeSeconds ?? null,
      cpSatUserTimeSeconds: repairedSolution.cpSatTelemetry?.userTimeSeconds ?? null,
      observedCpuSeconds: repairedSolution.cpSatTelemetry?.userTimeSeconds ?? null
    };
    return {
      caseName,
      pressureFamily,
      seed,
      statePolicy,
      stateIndex,
      stateSourceIteration,
      stateSourceStatus,
      stateStagnantIterations,
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
      wallClockSeconds,
      timing,
      cpSat: {
        ...baseCpSatMetadata,
        modelSize: repairedSolution.cpSatTelemetry?.modelSize ?? null
      },
      validation,
      features,
      ...(rollForward ? { rollForward } : {})
    };
  } catch (error) {
    if (!isRecoverableCpSatFailure(error)) {
      throw error;
    }
    const wallClockSeconds = (performance.now() - startedAtMs) / 1000;
    return {
      caseName,
      pressureFamily,
      seed,
      statePolicy,
      stateIndex,
      stateSourceIteration,
      stateSourceStatus,
      stateStagnantIterations,
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
      wallClockSeconds,
      timing: {
        repairTimeLimitSeconds,
        cpSatNumWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
        workerCpuBudgetSeconds: repairTimeLimitSeconds * LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
        wallClockSeconds,
        cpSatSolveWallTimeSeconds: null,
        cpSatUserTimeSeconds: null,
        observedCpuSeconds: null
      },
      cpSat: baseCpSatMetadata,
      validation: validateReplaySolution(G, params, incumbent),
      features
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
      selectionSource: "baseline-top-k"
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
      selectionSource: "exploration-tail"
    });
    explorationAdded++;
  }

  return [...selected.values()];
}

function withRollForwardBaselineComparisons(labels: readonly LnsWindowReplayLabel[]): LnsWindowReplayLabel[] {
  const baseline = labels.find((label) => label.selectedByBaseline && label.rollForward)?.rollForward;
  if (!baseline) return [...labels];
  return labels.map((label) => {
    if (!label.rollForward) return label;
    const populationDeltaVsBaseline = label.rollForward.totalPopulation - baseline.totalPopulation;
    return {
      ...label,
      rollForward: {
        ...label.rollForward,
        baselineTotalPopulation: baseline.totalPopulation,
        populationDeltaVsBaseline,
        improvementVsBaseline: Math.max(0, populationDeltaVsBaseline),
        statusVsBaseline: rollForwardStatusForPopulationDelta(populationDeltaVsBaseline)
      }
    };
  });
}

interface CapturedReplayState {
  statePolicy: LnsWindowReplayStatePolicy;
  stateSourceIteration: number | null;
  stateSourceStatus: LnsWindowReplayStateSourceStatus;
  stateStagnantIterations: number;
  incumbent: Solution;
}

interface ReplayState extends CapturedReplayState {
  stateIndex: number;
}

function captureReplayState(
  captured: Map<LnsWindowReplayStatePolicy, CapturedReplayState>,
  state: CapturedReplayState
): void {
  if (!captured.has(state.statePolicy)) captured.set(state.statePolicy, state);
}

function needsCollectedReplayStates(statePolicies: readonly LnsWindowReplayStatePolicy[]): boolean {
  return statePolicies.some((policy) => policy !== "initial-incumbent");
}

function materializeReplayStates(
  captured: Map<LnsWindowReplayStatePolicy, CapturedReplayState>,
  statePolicies: readonly LnsWindowReplayStatePolicy[]
): ReplayState[] {
  return statePolicies.flatMap((statePolicy, stateIndex) => {
    const state = captured.get(statePolicy);
    return state ? [{ ...state, stateIndex }] : [];
  });
}

function collectReplayStates(
  G: Grid,
  params: SolverParams,
  initialIncumbent: Solution,
  neighborhoodOptions: ReplayNeighborhoodOptions,
  statePolicies: readonly LnsWindowReplayStatePolicy[],
  stateCollectionIterations: number,
  stateCollectionRepairTimeLimitSeconds: number
): ReplayState[] {
  const captured = new Map<LnsWindowReplayStatePolicy, CapturedReplayState>();
  captureReplayState(captured, {
    statePolicy: "initial-incumbent",
    stateSourceIteration: null,
    stateSourceStatus: "initial-incumbent",
    stateStagnantIterations: 0,
    incumbent: initialIncumbent
  });

  if (!needsCollectedReplayStates(statePolicies)) {
    return materializeReplayStates(captured, statePolicies);
  }

  let incumbent = initialIncumbent;
  let stagnantIterations = 0;
  for (let iteration = 0; iteration < stateCollectionIterations; iteration++) {
    if (statePolicies.every((policy) => captured.has(policy))) break;
    const candidates = buildAdaptiveNeighborhoodCandidates(
      G,
      params,
      incumbent,
      neighborhoodOptions,
      stagnantIterations + 1
    );
    if (candidates.length === 0) break;

    const selectedCandidate = selectAdaptiveNeighborhoodOperator(
      candidates,
      iteration,
      stagnantIterations,
      neighborhoodOptions
    );
    try {
      const repairedSolution = solveCpSat(G, {
        ...params,
        optimizer: "cp-sat",
        cpSat: {
          ...(params.cpSat ?? {}),
          numWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
          timeLimitSeconds: stateCollectionRepairTimeLimitSeconds,
          warmStartHint: buildLnsWarmStartHint(incumbent, selectedCandidate.window)
        }
      });
      if (repairedSolution.totalPopulation > incumbent.totalPopulation) {
        incumbent = {
          ...repairedSolution,
          optimizer: "lns"
        };
        stagnantIterations = 0;
        captureReplayState(captured, {
          statePolicy: "post-first-improvement",
          stateSourceIteration: iteration,
          stateSourceStatus: "improved",
          stateStagnantIterations: stagnantIterations,
          incumbent
        });
        continue;
      }
      stagnantIterations += 1;
      captureReplayState(captured, {
        statePolicy: "post-stagnation",
        stateSourceIteration: iteration,
        stateSourceStatus: "neutral",
        stateStagnantIterations: stagnantIterations,
        incumbent
      });
    } catch (error) {
      if (!isRecoverableCpSatFailure(error)) throw error;
      stagnantIterations += 1;
      captureReplayState(captured, {
        statePolicy: "post-stagnation",
        stateSourceIteration: iteration,
        stateSourceStatus: "recoverable-failure",
        stateStagnantIterations: stagnantIterations,
        incumbent
      });
    }
  }

  return materializeReplayStates(captured, statePolicies);
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
  const rollForwardIterations = nonNegativeIntegerOrDefault(options.rollForwardIterations, 0);
  const rollForwardRepairTimeLimitSeconds =
    rollForwardIterations > 0
      ? positiveFiniteNumberOrDefault(options.rollForwardRepairTimeLimitSeconds, replayRepairTimeLimitSeconds)
      : null;
  const rollForwardOptions =
    rollForwardIterations > 0 && rollForwardRepairTimeLimitSeconds !== null
      ? { iterations: rollForwardIterations, repairTimeLimitSeconds: rollForwardRepairTimeLimitSeconds }
      : null;
  const statePolicies = normalizeLnsWindowReplayStatePolicies(options.statePolicies);
  const stateCollectionIterations = positiveIntegerOrDefault(options.stateCollectionIterations, 4);
  const stateCollectionRepairTimeLimitSeconds = positiveFiniteNumberOrDefault(
    options.stateCollectionRepairTimeLimitSeconds,
    replayRepairTimeLimitSeconds
  );
  const cases = seedRuns.flatMap((seed) =>
    selectedCases.flatMap((benchmarkCase): LnsWindowReplayCaseResult[] => {
      const G = cloneBenchmarkGrid(benchmarkCase.grid);
      const params = buildReplayParams(benchmarkCase, seed, options);
      const cpSatModelFingerprint = computeCpSatRequestFingerprint(G, {
        ...params,
        optimizer: "cp-sat"
      });
      const incumbent = buildInitialIncumbent(G, params);
      const pressureFamily = getLnsReplayPressureFamily(benchmarkCase);
      const neighborhoodOptions = buildReplayNeighborhoodOptions(G, params);
      const replayStates = collectReplayStates(
        G,
        params,
        incumbent,
        neighborhoodOptions,
        statePolicies,
        stateCollectionIterations,
        stateCollectionRepairTimeLimitSeconds
      );

      return replayStates.map((state): LnsWindowReplayCaseResult => {
        const candidates = buildAdaptiveNeighborhoodCandidates(G, params, state.incumbent, neighborhoodOptions, 1);
        const selectedCandidate = candidates.length
          ? selectAdaptiveNeighborhoodOperator(candidates, 0, 0, neighborhoodOptions)
          : null;
        const replayWindows = selectReplayWindowPlans(candidates, maxWindows, explorationWindowCount);
        const labels = withRollForwardBaselineComparisons(
          replayWindows.map(({ candidate, windowIndex, selectionSource }) =>
            replayWindow(
              G,
              params,
              benchmarkCase.name,
              pressureFamily,
              seed,
              state.statePolicy,
              state.stateIndex,
              state.stateSourceIteration,
              state.stateSourceStatus,
              state.stateStagnantIterations,
              state.incumbent,
              candidate,
              windowIndex,
              selectionSource,
              selectedCandidate,
              cpSatModelFingerprint,
              replayRepairTimeLimitSeconds,
              rollForwardOptions
            )
          )
        );
        return {
          name: benchmarkCase.name,
          description: benchmarkCase.description,
          pressureFamily,
          seed,
          statePolicy: state.statePolicy,
          stateIndex: state.stateIndex,
          stateSourceIteration: state.stateSourceIteration,
          stateSourceStatus: state.stateSourceStatus,
          stateStagnantIterations: state.stateStagnantIterations,
          gridRows: height(G),
          gridCols: width(G),
          incumbentPopulation: state.incumbent.totalPopulation,
          candidateWindowCount: candidates.length,
          replayedWindowCount: labels.length,
          baselineSelectedWindow: selectedCandidate ? { ...selectedCandidate.window } : null,
          baselineSelectedOperator: selectedCandidate?.operator ?? null,
          labels
        };
      });
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
    rollForwardIterations,
    rollForwardRepairTimeLimitSeconds,
    statePolicies: [...statePolicies],
    capturedStatePolicies: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.statePolicy),
    stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds,
    stateCount: cases.length,
    featureSchemaVersion: LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
    cpSatNumWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
    cpSatModelFingerprints: uniqueBenchmarkValuesBy(
      cases.flatMap((benchmarkCase) => benchmarkCase.labels),
      (label) => label.cpSat.modelFingerprint
    ),
    rollForwardLabelCount: sumBenchmarkBy(
      cases,
      (benchmarkCase) => benchmarkCase.labels.filter((label) => label.rollForward).length
    ),
    labelCount: sumBenchmarkBy(cases, (benchmarkCase) => benchmarkCase.labels.length),
    cases
  };
}

export function createLnsWindowReplaySnapshot(result: LnsWindowReplaySuiteResult): LnsWindowReplaySnapshot {
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
    rollForwardIterations: result.rollForwardIterations,
    rollForwardRepairTimeLimitSeconds: result.rollForwardRepairTimeLimitSeconds,
    rollForwardLabelCount: result.rollForwardLabelCount,
    statePolicies: [...result.statePolicies],
    capturedStatePolicies: [...result.capturedStatePolicies],
    stateCollectionIterations: result.stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds: result.stateCollectionRepairTimeLimitSeconds,
    stateCount: result.stateCount,
    featureSchemaVersion: result.featureSchemaVersion,
    cpSatNumWorkers: result.cpSatNumWorkers,
    cpSatModelFingerprints: [...result.cpSatModelFingerprints],
    labelCount: result.labelCount,
    cases: result.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      baselineSelectedWindow: benchmarkCase.baselineSelectedWindow ? { ...benchmarkCase.baselineSelectedWindow } : null,
      labels: benchmarkCase.labels.map(labelWithoutWallClock)
    }))
  };
}
