import { randomInt } from "node:crypto";

import { normalizeServicePlacement } from "../../core/index.js";
import { NO_TYPE_INDEX } from "../../core/index.js";
import { materializeValidLnsSeedSolution } from "../../core/index.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { solveLns } from "../lns/solver.js";
import { solveGreedy } from "../greedy/solver.js";
import {
  MAX_STAGE_RANDOM_SEED,
  buildAutoGreedyStageOptions,
  buildAutoLnsStageBudget,
  normalizeAutoOptions
} from "./stagePolicy.js";
import { createSyncAutoStopController } from "./stopController.js";

import type {
  AutoGreedySeedStageSummary,
  AutoSolveGeneratedSeed,
  AutoStageRunSummary,
  AutoSolveStageMetadata,
  AutoSolveStopReason,
  AutoStageOptimizerName,
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  CpSatWarmStartHint,
  Grid,
  Solution,
  SolverParams
} from "../../core/index.js";
import type { NormalizedAutoOptions } from "./stagePolicy.js";

export {
  describeAutoCompletedSolution,
  describeAutoRecoveredSolution,
  describeAutoStopReason,
  normalizeAutoTerminalSolution
} from "./terminal.js";
export type { AutoTerminalSolutionContext } from "./terminal.js";

interface AutoRuntimeState {
  activeStage: AutoStageOptimizerName | null;
  stageIndex: number;
  cycleIndex: number;
  consecutiveWeakCycles: number;
  lastCycleImprovementRatio: number | null;
  stopReason: AutoSolveStopReason | null;
  generatedSeeds: AutoSolveGeneratedSeed[];
  stageRuns: AutoStageRunSummary[];
  greedySeedStage: AutoGreedySeedStageSummary | null;
}

export type AutoBackgroundStageStarter = (grid: Grid, params: SolverParams) => BackgroundSolveHandle;

export interface AutoBackgroundStageStarters {
  greedy: AutoBackgroundStageStarter;
  lns: AutoBackgroundStageStarter;
  cpSat: AutoBackgroundStageStarter;
}

type AutoStageRunner<TResult> = (
  stage: AutoStageOptimizerName,
  cycleIndex: number,
  incumbent: Solution | null
) => TResult;

type MaybePromise<T> = T | Promise<T>;

interface AutoPlanStateChangeHooks {
  onIncumbentChange?: (incumbent: Solution | null) => void;
}

interface AutoPlanStageRequest {
  stage: AutoStageOptimizerName;
  cycleIndex: number;
  incumbent: Solution | null;
}

function generateRandomSeed(): number {
  return randomInt(1, MAX_STAGE_RANDOM_SEED);
}

function createAutoStageSeedGenerator(randomSeed: number | null): () => number {
  if (randomSeed === null) {
    return generateRandomSeed;
  }

  let state = randomSeed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state % MAX_STAGE_RANDOM_SEED) + 1;
  };
}

function optionalPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function cloneGreedySeedStageSummary(summary: AutoGreedySeedStageSummary | null): AutoGreedySeedStageSummary | null {
  if (!summary) return null;
  return {
    ...summary,
    ...(summary.phases ? { phases: summary.phases.map((phase) => ({ ...phase })) } : {})
  };
}

function buildGreedySeedStageSummary(
  stageParams: SolverParams,
  solution: Solution | null,
  elapsedSeconds: number | null
): AutoGreedySeedStageSummary {
  const greedy = stageParams.greedy ?? {};
  return {
    timeLimitSeconds: optionalPositiveNumber(greedy.timeLimitSeconds),
    localSearch: optionalBoolean(greedy.localSearch),
    restarts: optionalNumber(greedy.restarts),
    serviceRefineIterations: optionalNumber(greedy.serviceRefineIterations),
    serviceRefineCandidateLimit: optionalNumber(greedy.serviceRefineCandidateLimit),
    exhaustiveServiceSearch: optionalBoolean(greedy.exhaustiveServiceSearch),
    serviceExactPoolLimit: optionalNumber(greedy.serviceExactPoolLimit),
    serviceExactMaxCombinations: optionalNumber(greedy.serviceExactMaxCombinations),
    serviceMasterDecomposition: optionalBoolean(greedy.serviceMasterDecomposition),
    serviceMasterPoolLimit: optionalNumber(greedy.serviceMasterPoolLimit),
    serviceMasterMaxLayouts: optionalNumber(greedy.serviceMasterMaxLayouts),
    totalPopulation: solution?.totalPopulation ?? null,
    elapsedSeconds,
    ...(solution?.greedyProfile?.phases ? { phases: solution.greedyProfile.phases.map((phase) => ({ ...phase })) } : {})
  };
}

function elapsedSecondsSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs) / 1000;
}

function createAutoRuntimeState(): AutoRuntimeState {
  return {
    activeStage: null,
    stageIndex: 0,
    cycleIndex: 0,
    consecutiveWeakCycles: 0,
    lastCycleImprovementRatio: null,
    stopReason: null,
    generatedSeeds: [],
    stageRuns: [],
    greedySeedStage: null
  };
}

function recordGreedySeedStageSummary(
  state: AutoRuntimeState,
  stageParams: SolverParams,
  solution: Solution | null,
  startedAtMs: number
): void {
  state.greedySeedStage = buildGreedySeedStageSummary(stageParams, solution, elapsedSecondsSince(startedAtMs));
}

function acceptedStagePopulation(candidatePopulation: number | null, baselinePopulation: number | null): number | null {
  if (candidatePopulation === null) return baselinePopulation;
  if (baselinePopulation === null) return candidatePopulation;
  return Math.max(baselinePopulation, candidatePopulation);
}

function buildCpSatStageRunEvidence(solution: Solution | null): Partial<AutoStageRunSummary> {
  if (!solution) return {};
  const telemetry = solution.cpSatTelemetry;
  return {
    ...(solution.cpSatStatus !== undefined ? { cpSatStatus: solution.cpSatStatus ?? null } : {}),
    ...(telemetry
      ? {
          cpSatSolveWallTimeSeconds: telemetry.solveWallTimeSeconds,
          cpSatLastImprovementAtSeconds: telemetry.lastImprovementAtSeconds,
          cpSatPopulationGapUpperBound: telemetry.populationGapUpperBound
        }
      : {})
  };
}

function buildLnsStageRunEvidence(solution: Solution | null): Partial<AutoStageRunSummary> {
  const telemetry = solution?.lnsTelemetry;
  if (!telemetry) return {};
  return {
    lnsStopReason: telemetry.stopReason,
    lnsSeedTimeLimitSeconds: telemetry.seedTimeLimitSeconds,
    lnsSeedWallClockSeconds: telemetry.seedWallClockSeconds,
    lnsFocusedRepairTimeLimitSeconds: telemetry.focusedRepairTimeLimitSeconds,
    lnsEscalatedRepairTimeLimitSeconds: telemetry.escalatedRepairTimeLimitSeconds,
    lnsIterationsStarted: telemetry.iterationsStarted,
    lnsIterationsCompleted: telemetry.iterationsCompleted,
    lnsImprovingIterations: telemetry.improvingIterations,
    lnsNeutralIterations: telemetry.neutralIterations
  };
}

function recordAutoStageRunSummary(
  state: AutoRuntimeState,
  stage: AutoStageOptimizerName,
  randomSeed: number,
  solution: Solution | null,
  incumbentBeforeStage: Solution | null,
  autoStartedAtMs: number,
  stageStartedAtMs: number
): void {
  const startedAtSeconds = Math.max(0, stageStartedAtMs - autoStartedAtMs) / 1000;
  const completedAtSeconds = elapsedSecondsSince(autoStartedAtMs);
  const elapsedSeconds = Math.max(0, completedAtSeconds - startedAtSeconds);
  const candidatePopulation = solution?.totalPopulation ?? null;
  const baselinePopulation = incumbentBeforeStage?.totalPopulation ?? null;
  const acceptedPopulation = acceptedStagePopulation(candidatePopulation, baselinePopulation);
  state.stageRuns.push({
    stage,
    stageIndex: state.stageIndex,
    cycleIndex: state.cycleIndex,
    randomSeed,
    startedAtSeconds,
    elapsedSeconds,
    completedAtSeconds,
    populationBefore: baselinePopulation,
    candidatePopulation,
    acceptedPopulation,
    improvement:
      acceptedPopulation === null || baselinePopulation === null
        ? null
        : Math.max(0, acceptedPopulation - baselinePopulation),
    ...buildCpSatStageRunEvidence(solution),
    ...buildLnsStageRunEvidence(solution)
  });
}

function stripAutoMetadata(solution: Solution): Solution {
  return {
    ...solution,
    activeOptimizer: undefined,
    autoStage: undefined
  };
}

function solutionStageName(solution: Solution | null): AutoStageOptimizerName | null {
  if (!solution) return null;
  if (solution.activeOptimizer) return solution.activeOptimizer;
  if (solution.optimizer === "greedy" || solution.optimizer === "lns" || solution.optimizer === "cp-sat") {
    return solution.optimizer;
  }
  return null;
}

function pickBetterSolution(left: Solution | null, right: Solution | null): Solution | null {
  if (!left) return right;
  if (!right) return left;
  return right.totalPopulation >= left.totalPopulation ? right : left;
}

function isSolutionWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): value is Solution {
  return value !== undefined && value.roads instanceof Set;
}

function cloneWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): CpSatWarmStartHint | undefined {
  if (!value) return undefined;
  if (isSolutionWarmStartHint(value)) {
    return solutionToLnsSeedHint(value);
  }
  return {
    ...value,
    ...(value.roadKeys ? { roadKeys: [...value.roadKeys] } : {}),
    ...(value.serviceCandidateKeys ? { serviceCandidateKeys: [...value.serviceCandidateKeys] } : {}),
    ...(value.residentialCandidateKeys ? { residentialCandidateKeys: [...value.residentialCandidateKeys] } : {}),
    ...(value.roads ? { roads: [...value.roads] } : {}),
    ...(value.services ? { services: value.services.map((service) => ({ ...service })) } : {}),
    ...(value.residentials ? { residentials: value.residentials.map((residential) => ({ ...residential })) } : {}),
    ...(value.solution
      ? {
          solution: {
            ...value.solution,
            ...(value.solution.roads ? { roads: [...value.solution.roads] } : {}),
            ...(value.solution.services
              ? { services: value.solution.services.map((service) => ({ ...service })) }
              : {}),
            ...(value.solution.residentials
              ? { residentials: value.solution.residentials.map((residential) => ({ ...residential })) }
              : {}),
            ...(value.solution.populations ? { populations: [...value.solution.populations] } : {})
          }
        }
      : {})
  };
}

function maxNumericValue(...values: Array<number | null | undefined>): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    best = best === undefined ? value : Math.max(best, value);
  }
  return best;
}

function shouldRecoverAutoStageError(stage: AutoStageOptimizerName, incumbent: Solution | null): boolean {
  return stage !== "greedy" && Boolean(incumbent);
}

function recoverableStageStopReason(
  state: AutoRuntimeState,
  stopReasonOverride: AutoSolveStopReason | null = null
): AutoSolveStopReason {
  return state.stopReason ?? stopReasonOverride ?? "stage-error";
}

function applyRecoverableStageError(
  stage: AutoStageOptimizerName,
  incumbent: Solution | null,
  state: AutoRuntimeState,
  error: unknown,
  stopReasonOverride: AutoSolveStopReason | null = null
): null {
  if (!shouldRecoverAutoStageError(stage, incumbent)) {
    throw error;
  }
  state.stopReason = recoverableStageStopReason(state, stopReasonOverride);
  return null;
}

function buildAutoCpSatWarmStartHint(
  incumbent: Solution,
  existingWarmStartHint: CpSatWarmStartHint | Solution | undefined
): CpSatWarmStartHint {
  const incumbentHint = solutionToLnsSeedHint(incumbent);
  const mergedWarmStartHint = {
    ...(cloneWarmStartHint(existingWarmStartHint) ?? {}),
    ...incumbentHint,
    ...(incumbentHint.solution?.roads ? { roads: [...incumbentHint.solution.roads] } : {}),
    ...(incumbentHint.solution?.services
      ? { services: incumbentHint.solution.services.map((service) => ({ ...service })) }
      : {}),
    ...(incumbentHint.solution?.residentials
      ? { residentials: incumbentHint.solution.residentials.map((residential) => ({ ...residential })) }
      : {})
  };
  const mergedObjectiveLowerBound = maxNumericValue(
    cloneWarmStartHint(existingWarmStartHint)?.objectiveLowerBound,
    incumbentHint.objectiveLowerBound,
    incumbent.totalPopulation
  );
  return {
    ...mergedWarmStartHint,
    ...(mergedObjectiveLowerBound !== undefined ? { objectiveLowerBound: mergedObjectiveLowerBound } : {})
  };
}

function calculateImprovementRatio(baselinePopulation: number | null, nextPopulation: number | null): number | null {
  if (baselinePopulation === null || nextPopulation === null) return null;
  const improvement = nextPopulation - baselinePopulation;
  if (improvement <= 0) return 0;
  if (baselinePopulation <= 0) return 1;
  return improvement / baselinePopulation;
}

function buildAutoStageMetadata(state: AutoRuntimeState): AutoSolveStageMetadata {
  const metadata: AutoSolveStageMetadata = {
    requestedOptimizer: "auto",
    activeStage: state.activeStage,
    stageIndex: state.stageIndex,
    cycleIndex: state.cycleIndex,
    consecutiveWeakCycles: state.consecutiveWeakCycles,
    lastCycleImprovementRatio: state.lastCycleImprovementRatio,
    stopReason: state.stopReason ?? null,
    generatedSeeds: state.generatedSeeds.map((seed) => ({ ...seed })),
    stageRuns: state.stageRuns.map((run) => ({ ...run }))
  };
  const greedySeedStage = cloneGreedySeedStageSummary(state.greedySeedStage);
  if (greedySeedStage) {
    metadata.greedySeedStage = greedySeedStage;
  }
  return metadata;
}

function decorateAutoSolution(
  solution: Solution,
  state: AutoRuntimeState,
  activeStageOverride: AutoStageOptimizerName | null = null,
  stoppedByUserOverride?: boolean
): Solution {
  const base = stripAutoMetadata(solution);
  return {
    ...base,
    optimizer: "auto",
    ...((activeStageOverride ?? solutionStageName(base))
      ? { activeOptimizer: activeStageOverride ?? solutionStageName(base) ?? undefined }
      : {}),
    autoStage: buildAutoStageMetadata({
      ...state,
      activeStage: activeStageOverride ?? state.activeStage
    }),
    stoppedByUser: stoppedByUserOverride ?? base.stoppedByUser
  };
}

function solutionToLnsSeedHint(solution: Solution): CpSatWarmStartHint {
  const base = stripAutoMetadata(solution);
  const roadKeys = Array.from(base.roads);
  return {
    sourceName: "auto-incumbent",
    roadKeys,
    solution: {
      roads: roadKeys,
      services: base.services.map((service, index) => {
        const normalized = normalizeServicePlacement(service);
        return {
          r: normalized.r,
          c: normalized.c,
          rows: normalized.rows,
          cols: normalized.cols,
          range: normalized.range,
          typeIndex: base.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
          bonus: base.servicePopulationIncreases[index] ?? 0
        };
      }),
      residentials: base.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: base.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: base.populations[index] ?? 0
      })),
      populations: [...base.populations],
      totalPopulation: base.totalPopulation
    },
    totalPopulation: base.totalPopulation,
    objectiveLowerBound: base.totalPopulation
  };
}

function stageSeedParams(
  params: SolverParams,
  stage: AutoStageOptimizerName,
  incumbent: Solution | null,
  generatedSeed: number,
  options: NormalizedAutoOptions,
  remainingSeconds: number | null,
  sharedStopFilePath?: string
): SolverParams {
  const { portfolio: _portfolio, ...stageCpSatOptions } = params.cpSat ?? {};
  const stageBaseParams: SolverParams = params.cpSat
    ? {
        ...params,
        cpSat: stageCpSatOptions
      }
    : params;

  if (stage === "greedy") {
    const greedy = buildAutoGreedyStageOptions(params);
    const configuredGreedyTimeLimit =
      typeof greedy.timeLimitSeconds === "number" &&
      Number.isFinite(greedy.timeLimitSeconds) &&
      greedy.timeLimitSeconds > 0
        ? greedy.timeLimitSeconds
        : undefined;
    const greedyTimeLimitSeconds =
      remainingSeconds === null
        ? configuredGreedyTimeLimit
        : Math.max(0.001, Math.min(configuredGreedyTimeLimit ?? remainingSeconds, remainingSeconds));
    return {
      ...stageBaseParams,
      optimizer: "greedy",
      greedy: {
        ...greedy,
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        ...(greedyTimeLimitSeconds !== undefined ? { timeLimitSeconds: greedyTimeLimitSeconds } : {}),
        randomSeed: generatedSeed
      }
    };
  }

  if (stage === "lns") {
    const lnsBudget = buildAutoLnsStageBudget(params, options, remainingSeconds);
    return {
      ...stageBaseParams,
      optimizer: "lns",
      cpSat: {
        ...stageCpSatOptions,
        randomSeed: generatedSeed
      },
      lns: {
        ...(params.lns ?? {}),
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        seedHint: incumbent ? solutionToLnsSeedHint(incumbent) : params.lns?.seedHint,
        ...(lnsBudget.wallClockLimitSeconds !== null
          ? {
              wallClockLimitSeconds: lnsBudget.wallClockLimitSeconds,
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds
            }
          : {
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds
            }),
        ...(lnsBudget.seedTimeLimitSeconds !== undefined
          ? { seedTimeLimitSeconds: lnsBudget.seedTimeLimitSeconds }
          : {}),
        ...(lnsBudget.iterations !== undefined ? { iterations: lnsBudget.iterations } : {}),
        ...(lnsBudget.maxNoImprovementIterations !== undefined
          ? { maxNoImprovementIterations: lnsBudget.maxNoImprovementIterations }
          : {}),
        focusedRepairTimeLimitSeconds: lnsBudget.focusedRepairTimeLimitSeconds,
        escalatedRepairTimeLimitSeconds: lnsBudget.escalatedRepairTimeLimitSeconds
      }
    };
  }

  const configuredTimeLimit = stageCpSatOptions.timeLimitSeconds ?? options.cpSatStageTimeLimitSeconds;
  const configuredNoImprovementTimeout =
    stageCpSatOptions.noImprovementTimeoutSeconds ?? options.cpSatStageNoImprovementTimeoutSeconds;
  const warmStartHint = incumbent
    ? buildAutoCpSatWarmStartHint(incumbent, stageCpSatOptions.warmStartHint)
    : stageCpSatOptions.warmStartHint;
  const cappedTimeLimit =
    remainingSeconds === null ? configuredTimeLimit : Math.max(0.001, Math.min(configuredTimeLimit, remainingSeconds));
  const objectiveLowerBound = maxNumericValue(
    stageCpSatOptions.objectiveLowerBound,
    cloneWarmStartHint(warmStartHint)?.objectiveLowerBound,
    incumbent?.totalPopulation
  );

  return {
    ...stageBaseParams,
    optimizer: "cp-sat",
    cpSat: {
      ...stageCpSatOptions,
      ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
      randomSeed: generatedSeed,
      timeLimitSeconds: cappedTimeLimit,
      noImprovementTimeoutSeconds: Math.max(0.001, Math.min(configuredNoImprovementTimeout, cappedTimeLimit)),
      ...(warmStartHint ? { warmStartHint } : {}),
      ...(objectiveLowerBound !== undefined ? { objectiveLowerBound } : {})
    }
  };
}

function remainingSeconds(deadlineAtMs: number | null): number | null {
  if (deadlineAtMs === null) return null;
  return Math.max(0, (deadlineAtMs - Date.now()) / 1000);
}

function deadlineStopReason(deadlineAtMs: number | null): AutoSolveStopReason | null {
  if (deadlineAtMs === null || Date.now() < deadlineAtMs) return null;
  return "wall-clock-cap";
}

function buildSnapshotState(snapshot: Solution | null): BackgroundSolveSnapshotState {
  return {
    hasFeasibleSolution: Boolean(snapshot),
    totalPopulation: snapshot?.totalPopulation ?? null,
    activeOptimizer: snapshot?.activeOptimizer ?? null,
    autoStage: snapshot?.autoStage ?? null,
    cpSatStatus: snapshot?.cpSatStatus ?? null
  };
}

async function runBackgroundStage(
  G: Grid,
  params: SolverParams,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions,
  incumbentRef: { current: Solution | null },
  currentHandleRef: { current: BackgroundSolveHandle | null },
  stage: AutoStageOptimizerName,
  cycleIndex: number,
  startBackgroundSolve: AutoBackgroundStageStarter,
  nextStageSeed: () => number,
  autoStartedAtMs: number,
  deadlineAtMs: number | null
): Promise<Solution | null> {
  const secondsRemaining = remainingSeconds(deadlineAtMs);
  if (secondsRemaining !== null && secondsRemaining <= 0) {
    state.stopReason = "wall-clock-cap";
    return null;
  }

  state.stageIndex += 1;
  state.cycleIndex = cycleIndex;
  state.activeStage = stage;
  const generatedSeed = nextStageSeed();
  state.generatedSeeds.push({
    stage,
    stageIndex: state.stageIndex,
    cycleIndex,
    randomSeed: generatedSeed
  });

  const stageParams = stageSeedParams(params, stage, incumbentRef.current, generatedSeed, options, secondsRemaining);
  const incumbentBeforeStage = incumbentRef.current;
  const stageStartedAtMs = Date.now();
  const handle = startBackgroundSolve(G, stageParams);
  currentHandleRef.current = handle;

  try {
    const solution = await handle.promise;
    const strippedSolution = stripAutoMetadata(solution);
    recordAutoStageRunSummary(
      state,
      stage,
      generatedSeed,
      strippedSolution,
      incumbentBeforeStage,
      autoStartedAtMs,
      stageStartedAtMs
    );
    if (stage === "greedy") {
      recordGreedySeedStageSummary(state, stageParams, strippedSolution, stageStartedAtMs);
    }
    return strippedSolution;
  } catch (error) {
    const recovered = handle.getLatestSnapshot();
    const explicitStopReason = state.stopReason ?? deadlineStopReason(deadlineAtMs);
    if (recovered) {
      const strippedRecovered = stripAutoMetadata(recovered);
      recordAutoStageRunSummary(
        state,
        stage,
        generatedSeed,
        strippedRecovered,
        incumbentBeforeStage,
        autoStartedAtMs,
        stageStartedAtMs
      );
      if (stage === "greedy") {
        recordGreedySeedStageSummary(state, stageParams, strippedRecovered, stageStartedAtMs);
      }
      if (explicitStopReason) {
        applyRecoverableStageError(stage, incumbentRef.current, state, error, explicitStopReason);
      }
      return strippedRecovered;
    }
    if (stage === "greedy") {
      recordGreedySeedStageSummary(state, stageParams, null, stageStartedAtMs);
    }
    recordAutoStageRunSummary(
      state,
      stage,
      generatedSeed,
      null,
      incumbentBeforeStage,
      autoStartedAtMs,
      stageStartedAtMs
    );
    return applyRecoverableStageError(stage, incumbentRef.current, state, error, explicitStopReason);
  } finally {
    currentHandleRef.current = null;
  }
}

function syncStageSolve(G: Grid, params: SolverParams, stage: AutoStageOptimizerName): Solution {
  if (stage === "greedy") return solveGreedy(G, params);
  if (stage === "lns") return solveLns(G, params);
  return solveCpSat(G, params);
}

function finalizeAutoSolution(incumbent: Solution, state: AutoRuntimeState): Solution {
  const stoppedByUser = state.stopReason === "cancelled";
  const finalActiveStage = state.activeStage ?? solutionStageName(incumbent);
  return decorateAutoSolution(incumbent, state, finalActiveStage, stoppedByUser);
}

function chooseInitialIncumbent(G: Grid, params: SolverParams, greedySolution: Solution | null): Solution | null {
  const requestedSeed = materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
  return pickBetterSolution(greedySolution, requestedSeed ? stripAutoMetadata(requestedSeed) : null);
}

function advanceWeakCycleState(
  incumbentBeforeCycle: Solution | null,
  incumbentAfterCycle: Solution | null,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions
): void {
  state.lastCycleImprovementRatio = calculateImprovementRatio(
    incumbentBeforeCycle?.totalPopulation ?? null,
    incumbentAfterCycle?.totalPopulation ?? null
  );

  if ((state.lastCycleImprovementRatio ?? 0) < options.weakCycleImprovementThreshold) {
    state.consecutiveWeakCycles += 1;
  } else {
    state.consecutiveWeakCycles = 0;
  }
}

function initializeAutoPlanIncumbent(
  G: Grid,
  params: SolverParams,
  greedySolution: Solution | null,
  state: AutoRuntimeState,
  hooks: AutoPlanStateChangeHooks = {}
): Solution {
  const incumbent = chooseInitialIncumbent(G, params, greedySolution);
  hooks.onIncumbentChange?.(incumbent);
  if (!incumbent) {
    if (state.stopReason === "cancelled") {
      throw new Error("Auto solve was stopped before finding a feasible solution.");
    }
    throw new Error("Auto solve did not find an initial incumbent.");
  }
  return incumbent;
}

function acceptAutoStageResult(
  incumbent: Solution | null,
  stageSolution: Solution | null,
  hooks: AutoPlanStateChangeHooks = {}
): Solution | null {
  const nextIncumbent = pickBetterSolution(incumbent, stageSolution);
  hooks.onIncumbentChange?.(nextIncumbent);
  return nextIncumbent;
}

function shouldStopAfterAutoCpSatStage(cpSatSolution: Solution | null, incumbent: Solution | null): boolean {
  return Boolean(
    cpSatSolution?.cpSatStatus === "OPTIMAL" && incumbent && incumbent.totalPopulation === cpSatSolution.totalPopulation
  );
}

function finalizeCompletedAutoPlan(incumbent: Solution | null, state: AutoRuntimeState): Solution {
  if (!state.stopReason) {
    state.stopReason = "completed-plan";
  }

  if (!incumbent) {
    if (state.stopReason === "cancelled") {
      throw new Error("Auto solve was stopped before finding a feasible solution.");
    }
    throw new Error("Auto solve did not find a feasible solution.");
  }
  return finalizeAutoSolution(incumbent, state);
}

function createAutoPlanStepper(
  G: Grid,
  params: SolverParams,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions,
  hooks: AutoPlanStateChangeHooks = {}
): {
  next: () => AutoPlanStageRequest | null;
  accept: (request: AutoPlanStageRequest, stageSolution: Solution | null) => void;
  finalize: () => Solution;
} {
  let incumbent: Solution | null = null;
  let cycleStart: Solution | null = null;
  let cycleIndex = 0;
  let nextStage: AutoStageOptimizerName | null = "greedy";

  return {
    next: () => {
      if (nextStage === null || state.stopReason) return null;
      return {
        stage: nextStage,
        cycleIndex,
        incumbent
      };
    },
    accept: (request, stageSolution) => {
      if (request.stage === "greedy") {
        incumbent = initializeAutoPlanIncumbent(G, params, stageSolution, state, hooks);
        if (state.stopReason) {
          nextStage = null;
          return;
        }
        cycleIndex = 1;
        cycleStart = incumbent;
        nextStage = "lns";
        return;
      }

      incumbent = acceptAutoStageResult(incumbent, stageSolution, hooks);
      if (!incumbent || state.stopReason) {
        nextStage = null;
        return;
      }

      if (request.stage === "lns") {
        nextStage = "cp-sat";
        return;
      }

      if (shouldStopAfterAutoCpSatStage(stageSolution, incumbent)) {
        state.stopReason = "optimal";
        nextStage = null;
        return;
      }

      advanceWeakCycleState(cycleStart, incumbent, state, options);
      if (state.consecutiveWeakCycles >= options.maxConsecutiveWeakCycles) {
        state.stopReason = "weak-cycle-limit";
        nextStage = null;
        return;
      }

      cycleIndex += 1;
      cycleStart = incumbent;
      nextStage = "lns";
    },
    finalize: () => finalizeCompletedAutoPlan(incumbent, state)
  };
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}

function runAutoPlan(
  G: Grid,
  params: SolverParams,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions,
  runStage: AutoStageRunner<Solution | null>,
  hooks?: AutoPlanStateChangeHooks
): Solution;
function runAutoPlan(
  G: Grid,
  params: SolverParams,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions,
  runStage: AutoStageRunner<Promise<Solution | null>>,
  hooks?: AutoPlanStateChangeHooks
): Promise<Solution>;
function runAutoPlan(
  G: Grid,
  params: SolverParams,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions,
  runStage: AutoStageRunner<MaybePromise<Solution | null>>,
  hooks: AutoPlanStateChangeHooks = {}
): MaybePromise<Solution> {
  const plan = createAutoPlanStepper(G, params, state, options, hooks);
  const advance = (): MaybePromise<Solution> => {
    const request = plan.next();
    if (request === null) return plan.finalize();

    const stageResult = runStage(request.stage, request.cycleIndex, request.incumbent);
    if (isPromiseLike(stageResult)) {
      return stageResult.then((stageSolution) => {
        plan.accept(request, stageSolution);
        return advance();
      });
    }

    plan.accept(request, stageResult);
    return advance();
  };

  return advance();
}

export function solveAuto(G: Grid, params: SolverParams): Solution {
  const options = normalizeAutoOptions(params);
  const state = createAutoRuntimeState();
  const startedAtMs = Date.now();
  const deadlineAtMs =
    options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const stopController = createSyncAutoStopController(deadlineAtMs, params);
  const nextStageSeed = createAutoStageSeedGenerator(options.randomSeed);

  try {
    const runStage = (
      stage: AutoStageOptimizerName,
      cycleIndex: number,
      incumbent: Solution | null
    ): Solution | null => {
      const secondsRemaining = remainingSeconds(deadlineAtMs);
      if (secondsRemaining !== null && secondsRemaining <= 0) {
        state.stopReason = "wall-clock-cap";
        return null;
      }

      const pendingStopReason = stopController.currentStopReason();
      if (pendingStopReason) {
        state.stopReason = pendingStopReason;
        return null;
      }

      state.stageIndex += 1;
      state.cycleIndex = cycleIndex;
      state.activeStage = stage;
      const generatedSeed = nextStageSeed();
      state.generatedSeeds.push({
        stage,
        stageIndex: state.stageIndex,
        cycleIndex,
        randomSeed: generatedSeed
      });
      const stageParams = stageSeedParams(
        params,
        stage,
        incumbent,
        generatedSeed,
        options,
        secondsRemaining,
        stopController.stopFilePath
      );
      const incumbentBeforeStage = incumbent;
      const stageStartedAtMs = Date.now();
      let solution: Solution | null;
      try {
        solution = stripAutoMetadata(syncStageSolve(G, stageParams, stage));
        recordAutoStageRunSummary(
          state,
          stage,
          generatedSeed,
          solution,
          incumbentBeforeStage,
          startedAtMs,
          stageStartedAtMs
        );
        if (stage === "greedy") {
          recordGreedySeedStageSummary(state, stageParams, solution, stageStartedAtMs);
        }
      } catch (error) {
        if (stage === "greedy") {
          recordGreedySeedStageSummary(state, stageParams, null, stageStartedAtMs);
        }
        recordAutoStageRunSummary(
          state,
          stage,
          generatedSeed,
          null,
          incumbentBeforeStage,
          startedAtMs,
          stageStartedAtMs
        );
        const explicitStopReason = stopController.currentStopReason() ?? deadlineStopReason(deadlineAtMs);
        return applyRecoverableStageError(stage, incumbent, state, error, explicitStopReason);
      }
      const stopReasonAfterStage = stopController.currentStopReason();
      if (stopReasonAfterStage && !state.stopReason) {
        state.stopReason = stopReasonAfterStage;
      }
      return solution;
    };

    return runAutoPlan(G, params, state, options, runStage);
  } finally {
    stopController.cleanup();
  }
}

export function startAutoSolveWithStages(
  G: Grid,
  params: SolverParams,
  stageStarters: AutoBackgroundStageStarters
): BackgroundSolveHandle {
  const options = normalizeAutoOptions(params);
  const state = createAutoRuntimeState();
  const startedAtMs = Date.now();
  const deadlineAtMs =
    options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const incumbentRef: { current: Solution | null } = { current: null };
  const currentHandleRef: { current: BackgroundSolveHandle | null } = { current: null };
  const nextStageSeed = createAutoStageSeedGenerator(options.randomSeed);

  const requestStop = (stopReason: AutoSolveStopReason): void => {
    if (state.stopReason) return;
    state.stopReason = stopReason;
    currentHandleRef.current?.cancel();
  };

  const wallClockTimer =
    deadlineAtMs === null
      ? null
      : setTimeout(
          () => {
            requestStop("wall-clock-cap");
          },
          Math.max(1, deadlineAtMs - Date.now())
        );
  wallClockTimer?.unref?.();

  const promise = (async () => {
    try {
      const runStage = (
        stage: AutoStageOptimizerName,
        cycleIndex: number,
        incumbent: Solution | null
      ): Promise<Solution | null> => {
        incumbentRef.current = incumbent;
        const startStageSolve =
          stage === "greedy" ? stageStarters.greedy : stage === "lns" ? stageStarters.lns : stageStarters.cpSat;
        return runBackgroundStage(
          G,
          params,
          state,
          options,
          incumbentRef,
          currentHandleRef,
          stage,
          cycleIndex,
          startStageSolve,
          nextStageSeed,
          startedAtMs,
          deadlineAtMs
        );
      };

      return runAutoPlan(G, params, state, options, runStage, {
        onIncumbentChange: (incumbent) => {
          incumbentRef.current = incumbent;
        }
      });
    } finally {
      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
      }
    }
  })();

  const getLatestSnapshot = (): Solution | null => {
    const liveStageSnapshot = currentHandleRef.current?.getLatestSnapshot();
    const visibleBase = pickBetterSolution(
      incumbentRef.current,
      liveStageSnapshot ? stripAutoMetadata(liveStageSnapshot) : null
    );
    if (!visibleBase) return null;
    return decorateAutoSolution(
      visibleBase,
      state,
      state.activeStage,
      state.stopReason === "cancelled" ? true : state.stopReason === "wall-clock-cap" ? false : undefined
    );
  };

  return {
    promise,
    cancel: () => {
      requestStop("cancelled");
    },
    getLatestSnapshot,
    getLatestSnapshotState: () => buildSnapshotState(getLatestSnapshot())
  };
}
