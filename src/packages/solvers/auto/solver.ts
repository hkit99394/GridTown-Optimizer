import {
  assertValidSolveInputs,
  materializeValidLnsSeedSolution,
  reachesPopulationCapacityUpperBound
} from "../../core/index.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { solveLns } from "../lns/solver.js";
import { solveGreedy } from "../greedy/solver.js";
import { normalizeAutoOptions } from "./stagePolicy.js";
import { stageSeedParams } from "./stageParams.js";
import { createSyncAutoStopController } from "./stopController.js";
import {
  currentAutoDeadlineAtMs,
  currentAutoDeadlineStopReason,
  notePopulationCapacityReached,
  populationCapacityGraceActive
} from "./capGrace.js";
import {
  buildSnapshotState,
  calculateImprovementRatio,
  createAutoRuntimeState,
  createAutoStageSeedGenerator,
  decorateAutoSolution,
  pickBetterSolution,
  recordAutoStageRunSummary,
  recordGreedySeedStageSummary,
  solutionStageName,
  stripAutoMetadata,
  type AutoRuntimeState
} from "./runtimeState.js";

import type {
  AutoSolveStopReason,
  AutoStageOptimizerName,
  BackgroundSolveHandle,
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

function remainingSeconds(deadlineAtMs: number | null): number | null {
  if (deadlineAtMs === null) return null;
  return Math.max(0, (deadlineAtMs - Date.now()) / 1000);
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
  globalDeadlineAtMs: number | null
): Promise<Solution | null> {
  const effectiveDeadlineAtMs = currentAutoDeadlineAtMs(globalDeadlineAtMs, state);
  const secondsRemaining = remainingSeconds(effectiveDeadlineAtMs);
  if (secondsRemaining !== null && secondsRemaining <= 0) {
    state.stopReason = currentAutoDeadlineStopReason(globalDeadlineAtMs, state) ?? "wall-clock-cap";
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
    const explicitStopReason = state.stopReason ?? currentAutoDeadlineStopReason(globalDeadlineAtMs, state);
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

function shouldStopAfterPopulationCapacityReached(params: SolverParams, incumbent: Solution | null): boolean {
  return Boolean(incumbent && reachesPopulationCapacityUpperBound(params, incumbent.totalPopulation));
}

function updatePopulationCapacityStop(
  params: SolverParams,
  incumbent: Solution | null,
  state: AutoRuntimeState,
  options: NormalizedAutoOptions
): boolean {
  if (!shouldStopAfterPopulationCapacityReached(params, incumbent)) return false;
  notePopulationCapacityReached(state, options.continueAfterPopulationCapSeconds);
  if (populationCapacityGraceActive(state)) return false;
  state.stopReason = "population-cap-reached";
  return true;
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
        if (updatePopulationCapacityStop(params, incumbent, state, options)) {
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
        if (updatePopulationCapacityStop(params, incumbent, state, options)) {
          nextStage = null;
          return;
        }
        nextStage = "cp-sat";
        return;
      }

      if (shouldStopAfterAutoCpSatStage(stageSolution, incumbent)) {
        state.stopReason = "optimal";
        nextStage = null;
        return;
      }

      if (updatePopulationCapacityStop(params, incumbent, state, options)) {
        nextStage = null;
        return;
      }

      if (populationCapacityGraceActive(state)) {
        cycleIndex += 1;
        cycleStart = incumbent;
        nextStage = "lns";
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
  assertValidSolveInputs(G, params);
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
      const effectiveDeadlineAtMs = currentAutoDeadlineAtMs(deadlineAtMs, state);
      const secondsRemaining = remainingSeconds(effectiveDeadlineAtMs);
      if (secondsRemaining !== null && secondsRemaining <= 0) {
        state.stopReason = currentAutoDeadlineStopReason(deadlineAtMs, state) ?? "wall-clock-cap";
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
        const explicitStopReason =
          stopController.currentStopReason() ?? currentAutoDeadlineStopReason(deadlineAtMs, state);
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
