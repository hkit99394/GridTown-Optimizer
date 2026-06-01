import { randomInt } from "node:crypto";

import { MAX_STAGE_RANDOM_SEED } from "./stagePolicy.js";
import type { PopulationCapacityGraceState } from "./capGrace.js";
import type {
  AutoGreedySeedStageSummary,
  AutoLnsNeighborhoodOutcomeSummary,
  AutoSolveGeneratedSeed,
  AutoSolveStageMetadata,
  AutoSolveStopReason,
  AutoStageOptimizerName,
  AutoStageRunSummary,
  BackgroundSolveSnapshotState,
  Solution,
  SolverParams
} from "../../core/index.js";

export interface AutoRuntimeState extends PopulationCapacityGraceState {
  activeStage: AutoStageOptimizerName | null;
  stageIndex: number;
  cycleIndex: number;
  consecutiveWeakCycles: number;
  lastCycleImprovementRatio: number | null;
  stopReason: AutoSolveStopReason | null;
  populationCapacityReachedAtMs: number | null;
  populationCapacityDeadlineAtMs: number | null;
  generatedSeeds: AutoSolveGeneratedSeed[];
  stageRuns: AutoStageRunSummary[];
  greedySeedStage: AutoGreedySeedStageSummary | null;
}

function generateRandomSeed(): number {
  return randomInt(1, MAX_STAGE_RANDOM_SEED);
}

export function createAutoStageSeedGenerator(randomSeed: number | null): () => number {
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

export function createAutoRuntimeState(): AutoRuntimeState {
  return {
    activeStage: null,
    stageIndex: 0,
    cycleIndex: 0,
    consecutiveWeakCycles: 0,
    lastCycleImprovementRatio: null,
    stopReason: null,
    populationCapacityReachedAtMs: null,
    populationCapacityDeadlineAtMs: null,
    generatedSeeds: [],
    stageRuns: [],
    greedySeedStage: null
  };
}

export function recordGreedySeedStageSummary(
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
    lnsNeutralIterations: telemetry.neutralIterations,
    lnsNeighborhoods: telemetry.outcomes.map(
      (outcome): AutoLnsNeighborhoodOutcomeSummary => ({
        iteration: outcome.iteration,
        phase: outcome.phase,
        ...(outcome.operator ? { operator: outcome.operator } : {}),
        status: outcome.status,
        ...(outcome.repairBackend ? { repairBackend: outcome.repairBackend } : {}),
        repairTimeLimitSeconds: outcome.repairTimeLimitSeconds,
        wallClockSeconds: outcome.wallClockSeconds,
        populationBefore: outcome.populationBefore,
        populationAfter: outcome.populationAfter,
        improvement: outcome.improvement,
        windowTop: outcome.window.top,
        windowLeft: outcome.window.left,
        windowRows: outcome.window.rows,
        windowCols: outcome.window.cols,
        stagnantIterationsBefore: outcome.stagnantIterationsBefore,
        cpSatStatus: outcome.cpSatStatus ?? null
      })
    )
  };
}

export function recordAutoStageRunSummary(
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

export function stripAutoMetadata(solution: Solution): Solution {
  return {
    ...solution,
    activeOptimizer: undefined,
    autoStage: undefined
  };
}

export function solutionStageName(solution: Solution | null): AutoStageOptimizerName | null {
  if (!solution) return null;
  if (solution.activeOptimizer) return solution.activeOptimizer;
  if (solution.optimizer === "greedy" || solution.optimizer === "lns" || solution.optimizer === "cp-sat") {
    return solution.optimizer;
  }
  return null;
}

export function pickBetterSolution(left: Solution | null, right: Solution | null): Solution | null {
  if (!left) return right;
  if (!right) return left;
  return right.totalPopulation >= left.totalPopulation ? right : left;
}

export function calculateImprovementRatio(
  baselinePopulation: number | null,
  nextPopulation: number | null
): number | null {
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

export function decorateAutoSolution(
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

export function buildSnapshotState(snapshot: Solution | null): BackgroundSolveSnapshotState {
  return {
    hasFeasibleSolution: Boolean(snapshot),
    totalPopulation: snapshot?.totalPopulation ?? null,
    activeOptimizer: snapshot?.activeOptimizer ?? null,
    autoStage: snapshot?.autoStage ?? null,
    cpSatStatus: snapshot?.cpSatStatus ?? null
  };
}
