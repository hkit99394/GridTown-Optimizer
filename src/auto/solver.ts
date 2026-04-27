import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { randomInt } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeServicePlacement } from "../core/buildings.js";
import { NO_TYPE_INDEX } from "../core/rules.js";
import { materializeValidLnsSeedSolution } from "../core/solverInputValidation.js";
import { solveCpSat, startCpSatSolve } from "../cp-sat/solver.js";
import { startGreedySolve } from "../greedy/bridge.js";
import { startLnsSolve } from "../lns/bridge.js";
import { solveLns } from "../lns/solver.js";
import { solveGreedy } from "../greedy/solver.js";

import type {
  AutoOptions,
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
  SolverParams,
} from "../core/types.js";

const DEFAULT_WEAK_CYCLE_IMPROVEMENT_THRESHOLD = 0.005;
const DEFAULT_MAX_CONSECUTIVE_WEAK_CYCLES = 2;
const DEFAULT_CP_SAT_STAGE_TIME_LIMIT_SECONDS = 30;
const DEFAULT_CP_SAT_STAGE_NO_IMPROVEMENT_TIMEOUT_SECONDS = 10;
const AUTO_GREEDY_STAGE_RESTART_CAP = 4;
const AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP = 1;
const AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP = 24;
const AUTO_GREEDY_STAGE_EXACT_POOL_CAP = 8;
const AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP = 512;
const AUTO_CP_SAT_STAGE_RESERVE_RATIO = 0.2;
const AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS = 1;
const MAX_STAGE_RANDOM_SEED = 0x7fffffff;

interface NormalizedAutoOptions {
  wallClockLimitSeconds: number | null;
  randomSeed: number | null;
  weakCycleImprovementThreshold: number;
  maxConsecutiveWeakCycles: number;
  cpSatStageTimeLimitSeconds: number;
  cpSatStageReserveRatio: number;
  cpSatStageNoImprovementTimeoutSeconds: number;
}

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

type StageStarter = (grid: Grid, params: SolverParams) => BackgroundSolveHandle;

interface AutoLnsStageBudget {
  wallClockLimitSeconds: number | null;
  seedTimeLimitSeconds?: number;
  repairTimeLimitSeconds: number;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
}

interface SyncAutoStopController {
  stopFilePath: string;
  currentStopReason: () => AutoSolveStopReason | null;
  cleanup: () => void;
}

const SYNC_AUTO_STOP_WATCHER_SCRIPT = `
const fs = require("node:fs");

const stopFilePath = process.argv[1];
const delayMsArg = process.argv[2];
const upstreamPaths = JSON.parse(process.argv[3] || "[]");
let stopped = false;

const triggerStop = () => {
  if (stopped) return;
  stopped = true;
  try {
    fs.writeFileSync(stopFilePath, "stop\\n");
  } catch {}
  clearTimeout(timer);
  if (poll !== null) clearInterval(poll);
};

const poll = upstreamPaths.length
  ? setInterval(() => {
      for (const filePath of upstreamPaths) {
        try {
          if (fs.existsSync(filePath)) {
            triggerStop();
            return;
          }
        } catch {}
      }
    }, 50)
  : null;

const timer = delayMsArg === "null"
  ? null
  : setTimeout(triggerStop, Math.max(0, Number(delayMsArg) || 0));
`;

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(finiteNumberOrDefault(value, fallback)));
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  const normalized = finiteNumberOrDefault(value, fallback);
  return normalized > 0 ? Math.max(0.001, normalized) : fallback;
}

function normalizeAutoOptions(params: SolverParams): NormalizedAutoOptions {
  const auto = params.auto ?? {};
  const configuredWallClockLimitSeconds = finiteNumberOrDefault(auto.wallClockLimitSeconds, Number.NaN);
  const wallClockLimitSeconds = configuredWallClockLimitSeconds > 0
    ? Math.max(0.001, configuredWallClockLimitSeconds)
    : null;
  return {
    wallClockLimitSeconds,
    randomSeed:
      typeof auto.randomSeed === "number" && Number.isInteger(auto.randomSeed) && auto.randomSeed >= 0
        ? Math.min(auto.randomSeed, MAX_STAGE_RANDOM_SEED)
        : null,
    weakCycleImprovementThreshold: Math.max(
      0,
      finiteNumberOrDefault(auto.weakCycleImprovementThreshold, DEFAULT_WEAK_CYCLE_IMPROVEMENT_THRESHOLD)
    ),
    maxConsecutiveWeakCycles: positiveIntegerOrDefault(
      auto.maxConsecutiveWeakCycles,
      DEFAULT_MAX_CONSECUTIVE_WEAK_CYCLES
    ),
    cpSatStageTimeLimitSeconds: positiveNumberOrDefault(
      auto.cpSatStageTimeLimitSeconds,
      DEFAULT_CP_SAT_STAGE_TIME_LIMIT_SECONDS
    ),
    cpSatStageReserveRatio: Math.max(
      0,
      Math.min(
        1,
        finiteNumberOrDefault(auto.cpSatStageReserveRatio, AUTO_CP_SAT_STAGE_RESERVE_RATIO)
      )
    ),
    cpSatStageNoImprovementTimeoutSeconds: positiveNumberOrDefault(
      auto.cpSatStageNoImprovementTimeoutSeconds,
      DEFAULT_CP_SAT_STAGE_NO_IMPROVEMENT_TIMEOUT_SECONDS
    ),
  };
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

function buildAutoGreedyStageOptions(params: SolverParams): NonNullable<SolverParams["greedy"]> {
  const greedy = params.greedy ?? {};
  return {
    ...greedy,
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    profile: greedy.profile ?? true,
    densityTieBreaker: false,
    densityTieBreakerTolerancePercent: 0,
    restarts: Math.max(
      1,
      Math.min(greedy.restarts ?? params.restarts ?? AUTO_GREEDY_STAGE_RESTART_CAP, AUTO_GREEDY_STAGE_RESTART_CAP)
    ),
    serviceRefineIterations: Math.max(
      0,
      Math.min(
        greedy.serviceRefineIterations ?? params.serviceRefineIterations ?? AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP,
        AUTO_GREEDY_STAGE_REFINE_ITERATION_CAP
      )
    ),
    serviceRefineCandidateLimit: Math.max(
      1,
      Math.min(
        greedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit ?? AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP,
        AUTO_GREEDY_STAGE_REFINE_CANDIDATE_CAP
      )
    ),
    exhaustiveServiceSearch: false,
    serviceExactPoolLimit: Math.max(
      1,
      Math.min(
        greedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit ?? AUTO_GREEDY_STAGE_EXACT_POOL_CAP,
        AUTO_GREEDY_STAGE_EXACT_POOL_CAP
      )
    ),
    serviceExactMaxCombinations: Math.max(
      1,
      Math.min(
        greedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations ?? AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP,
        AUTO_GREEDY_STAGE_EXACT_COMBINATION_CAP
      )
    ),
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

function cloneGreedySeedStageSummary(
  summary: AutoGreedySeedStageSummary | null
): AutoGreedySeedStageSummary | null {
  if (!summary) return null;
  return {
    ...summary,
    ...(summary.phases ? { phases: summary.phases.map((phase) => ({ ...phase })) } : {}),
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
    totalPopulation: solution?.totalPopulation ?? null,
    elapsedSeconds,
    ...(solution?.greedyProfile?.phases
      ? { phases: solution.greedyProfile.phases.map((phase) => ({ ...phase })) }
      : {}),
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
    greedySeedStage: null,
  };
}

function recordGreedySeedStageSummary(
  state: AutoRuntimeState,
  stageParams: SolverParams,
  solution: Solution | null,
  startedAtMs: number
): void {
  state.greedySeedStage = buildGreedySeedStageSummary(
    stageParams,
    solution,
    elapsedSecondsSince(startedAtMs)
  );
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
          cpSatPopulationGapUpperBound: telemetry.populationGapUpperBound,
        }
      : {}),
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
    improvement: acceptedPopulation === null || baselinePopulation === null
      ? null
      : Math.max(0, acceptedPopulation - baselinePopulation),
    ...buildCpSatStageRunEvidence(solution),
    ...buildLnsStageRunEvidence(solution),
  });
}

function stripAutoMetadata(solution: Solution): Solution {
  return {
    ...solution,
    activeOptimizer: undefined,
    autoStage: undefined,
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

function cloneWarmStartHint(
  value: CpSatWarmStartHint | Solution | undefined
): CpSatWarmStartHint | undefined {
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
            ...(value.solution.services ? { services: value.solution.services.map((service) => ({ ...service })) } : {}),
            ...(value.solution.residentials
              ? { residentials: value.solution.residentials.map((residential) => ({ ...residential })) }
              : {}),
            ...(value.solution.populations ? { populations: [...value.solution.populations] } : {}),
          },
        }
      : {}),
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

function reservedCpSatStageSeconds(options: NormalizedAutoOptions, remainingSeconds: number): number {
  if (
    options.wallClockLimitSeconds === null
    || options.cpSatStageReserveRatio <= 0
    || remainingSeconds <= AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS
  ) {
    return 0;
  }
  const budgetScaledReserve = options.wallClockLimitSeconds * options.cpSatStageReserveRatio;
  return Math.min(
    options.cpSatStageTimeLimitSeconds,
    Math.max(AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS, budgetScaledReserve),
    Math.max(0, remainingSeconds - AUTO_MIN_CP_SAT_STAGE_RESERVE_SECONDS)
  );
}

function budgetedAutoLnsStageSeconds(options: NormalizedAutoOptions, remainingSeconds: number): number {
  const cpSatReserveSeconds = reservedCpSatStageSeconds(options, remainingSeconds);
  return Math.max(0.001, remainingSeconds - cpSatReserveSeconds);
}

function capPositiveSeconds(value: number, limit: number): number {
  return Math.max(0.001, Math.min(value, limit));
}

function buildAutoLnsStageBudget(
  params: SolverParams,
  options: NormalizedAutoOptions,
  remainingSeconds: number | null
): AutoLnsStageBudget {
  const wallClockLimitSeconds = remainingSeconds === null
    ? null
    : budgetedAutoLnsStageSeconds(options, remainingSeconds);
  const configuredRepairTimeLimitSeconds = params.lns?.repairTimeLimitSeconds ?? params.cpSat?.timeLimitSeconds ?? 5;
  const repairTimeLimitSeconds = wallClockLimitSeconds === null
    ? configuredRepairTimeLimitSeconds
    : capPositiveSeconds(configuredRepairTimeLimitSeconds, wallClockLimitSeconds);
  const configuredSeedTimeLimitSeconds = optionalPositiveNumber(params.lns?.seedTimeLimitSeconds);
  const seedTimeLimitSeconds = wallClockLimitSeconds !== null && configuredSeedTimeLimitSeconds !== null
    ? capPositiveSeconds(configuredSeedTimeLimitSeconds, wallClockLimitSeconds)
    : undefined;
  const focusedRepairTimeLimitSeconds = wallClockLimitSeconds === null && params.lns?.focusedRepairTimeLimitSeconds !== undefined
    ? params.lns.focusedRepairTimeLimitSeconds
    : capPositiveSeconds(params.lns?.focusedRepairTimeLimitSeconds ?? repairTimeLimitSeconds, repairTimeLimitSeconds);
  const escalatedRepairTimeLimitSeconds = wallClockLimitSeconds === null && params.lns?.escalatedRepairTimeLimitSeconds !== undefined
    ? params.lns.escalatedRepairTimeLimitSeconds
    : capPositiveSeconds(params.lns?.escalatedRepairTimeLimitSeconds ?? repairTimeLimitSeconds, repairTimeLimitSeconds);

  return {
    wallClockLimitSeconds,
    ...(seedTimeLimitSeconds !== undefined ? { seedTimeLimitSeconds } : {}),
    repairTimeLimitSeconds,
    focusedRepairTimeLimitSeconds,
    escalatedRepairTimeLimitSeconds,
  };
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
    ...(incumbentHint.solution?.services ? { services: incumbentHint.solution.services.map((service) => ({ ...service })) } : {}),
    ...(incumbentHint.solution?.residentials
      ? { residentials: incumbentHint.solution.residentials.map((residential) => ({ ...residential })) }
      : {}),
  };
  const mergedObjectiveLowerBound = maxNumericValue(
    cloneWarmStartHint(existingWarmStartHint)?.objectiveLowerBound,
    incumbentHint.objectiveLowerBound,
    incumbent.totalPopulation
  );
  return {
    ...mergedWarmStartHint,
    ...(mergedObjectiveLowerBound !== undefined ? { objectiveLowerBound: mergedObjectiveLowerBound } : {}),
  };
}

function createSyncAutoStopController(deadlineAtMs: number | null, params: SolverParams): SyncAutoStopController {
  const upstreamStopFilePaths = [
    params.greedy?.stopFilePath,
    params.lns?.stopFilePath,
    params.cpSat?.stopFilePath,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (deadlineAtMs === null && upstreamStopFilePaths.length === 0) {
    return {
      stopFilePath: "",
      currentStopReason: () => null,
      cleanup: () => {},
    };
  }
  const tempDirectory = mkdtempSync(join(tmpdir(), "city-builder-auto-stop-"));
  const stopFilePath = join(tempDirectory, "stop");
  const delayMs = deadlineAtMs === null ? "null" : String(Math.max(0, deadlineAtMs - Date.now()));
  const timerProcess = spawn(
    process.execPath,
    ["-e", SYNC_AUTO_STOP_WATCHER_SCRIPT, stopFilePath, delayMs, JSON.stringify(upstreamStopFilePaths)],
    { stdio: "ignore" }
  );
  timerProcess.unref();

  return {
    stopFilePath,
    currentStopReason: () => {
      if (upstreamStopFilePaths.some((filePath) => existsSync(filePath))) {
        return "cancelled";
      }
      if (!existsSync(stopFilePath)) return null;
      return "wall-clock-cap";
    },
    cleanup: () => {
      try {
        timerProcess.kill();
      } catch {}
      rmSync(tempDirectory, { recursive: true, force: true });
    },
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
    stageRuns: state.stageRuns.map((run) => ({ ...run })),
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
    ...(activeStageOverride ?? solutionStageName(base)
      ? { activeOptimizer: (activeStageOverride ?? solutionStageName(base)) ?? undefined }
      : {}),
    autoStage: buildAutoStageMetadata({
      ...state,
      activeStage: activeStageOverride ?? state.activeStage,
    }),
    stoppedByUser: stoppedByUserOverride ?? base.stoppedByUser,
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
          bonus: base.servicePopulationIncreases[index] ?? 0,
        };
      }),
      residentials: base.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: base.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: base.populations[index] ?? 0,
      })),
      populations: [...base.populations],
      totalPopulation: base.totalPopulation,
    },
    totalPopulation: base.totalPopulation,
    objectiveLowerBound: base.totalPopulation,
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
  if (stage === "greedy") {
    const greedy = buildAutoGreedyStageOptions(params);
    const configuredGreedyTimeLimit =
      typeof greedy.timeLimitSeconds === "number" && Number.isFinite(greedy.timeLimitSeconds) && greedy.timeLimitSeconds > 0
        ? greedy.timeLimitSeconds
        : undefined;
    const greedyTimeLimitSeconds = remainingSeconds === null
      ? configuredGreedyTimeLimit
      : Math.max(0.001, Math.min(configuredGreedyTimeLimit ?? remainingSeconds, remainingSeconds));
    return {
      ...params,
      optimizer: "greedy",
      greedy: {
        ...greedy,
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        ...(greedyTimeLimitSeconds !== undefined ? { timeLimitSeconds: greedyTimeLimitSeconds } : {}),
        randomSeed: generatedSeed,
      },
    };
  }

  if (stage === "lns") {
    const lnsBudget = buildAutoLnsStageBudget(params, options, remainingSeconds);
    return {
      ...params,
      optimizer: "lns",
      cpSat: {
        ...(params.cpSat ?? {}),
        randomSeed: generatedSeed,
      },
      lns: {
        ...(params.lns ?? {}),
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        seedHint: incumbent ? solutionToLnsSeedHint(incumbent) : params.lns?.seedHint,
        ...(lnsBudget.wallClockLimitSeconds !== null
          ? {
              wallClockLimitSeconds: lnsBudget.wallClockLimitSeconds,
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds,
            }
          : {
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds,
            }),
        ...(lnsBudget.seedTimeLimitSeconds !== undefined ? { seedTimeLimitSeconds: lnsBudget.seedTimeLimitSeconds } : {}),
        focusedRepairTimeLimitSeconds: lnsBudget.focusedRepairTimeLimitSeconds,
        escalatedRepairTimeLimitSeconds: lnsBudget.escalatedRepairTimeLimitSeconds,
      },
    };
  }

  const configuredTimeLimit = params.cpSat?.timeLimitSeconds ?? options.cpSatStageTimeLimitSeconds;
  const configuredNoImprovementTimeout =
    params.cpSat?.noImprovementTimeoutSeconds ?? options.cpSatStageNoImprovementTimeoutSeconds;
  const warmStartHint = incumbent ? buildAutoCpSatWarmStartHint(incumbent, params.cpSat?.warmStartHint) : params.cpSat?.warmStartHint;
  const cappedTimeLimit = remainingSeconds === null
    ? configuredTimeLimit
    : Math.max(0.001, Math.min(configuredTimeLimit, remainingSeconds));
  const objectiveLowerBound = maxNumericValue(
    params.cpSat?.objectiveLowerBound,
    cloneWarmStartHint(warmStartHint)?.objectiveLowerBound,
    incumbent?.totalPopulation
  );

  return {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      ...(params.cpSat ?? {}),
      ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
      randomSeed: generatedSeed,
      timeLimitSeconds: cappedTimeLimit,
      noImprovementTimeoutSeconds: Math.max(0.001, Math.min(configuredNoImprovementTimeout, cappedTimeLimit)),
      ...(warmStartHint ? { warmStartHint } : {}),
      ...(objectiveLowerBound !== undefined ? { objectiveLowerBound } : {}),
    },
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
    cpSatStatus: snapshot?.cpSatStatus ?? null,
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
  startBackgroundSolve: StageStarter,
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
    randomSeed: generatedSeed,
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

function chooseInitialIncumbent(
  G: Grid,
  params: SolverParams,
  greedySolution: Solution | null
): Solution | null {
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

export function describeAutoStopReason(stopReason: AutoSolveStopReason | null | undefined): string | null {
  if (stopReason === "optimal") {
    return "Auto stopped after CP-SAT proved the incumbent optimal.";
  }
  if (stopReason === "weak-cycle-limit") {
    return "Auto stopped after two consecutive weak LNS -> CP-SAT cycles.";
  }
  if (stopReason === "wall-clock-cap") {
    return "Auto stopped at the global wall-clock safety cap and kept the best incumbent found so far.";
  }
  if (stopReason === "stage-error") {
    return "Auto kept the best available incumbent after a later stage ended without a usable result.";
  }
  if (stopReason === "cancelled") {
    return "Auto solve was stopped by user. Showing the best incumbent found so far.";
  }
  if (stopReason === "completed-plan") {
    return "Auto completed its staged incumbent-first plan.";
  }
  return null;
}

export function solveAuto(G: Grid, params: SolverParams): Solution {
  const options = normalizeAutoOptions(params);
  const state = createAutoRuntimeState();
  const startedAtMs = Date.now();
  const deadlineAtMs = options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const stopController = createSyncAutoStopController(deadlineAtMs, params);
  const nextStageSeed = createAutoStageSeedGenerator(options.randomSeed);

  try {
    const runStage = (stage: AutoStageOptimizerName, cycleIndex: number, incumbent: Solution | null): Solution | null => {
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
        randomSeed: generatedSeed,
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
        return applyRecoverableStageError(
          stage,
          incumbent,
          state,
          error,
          explicitStopReason
        );
      }
      const stopReasonAfterStage = stopController.currentStopReason();
      if (stopReasonAfterStage && !state.stopReason) {
        state.stopReason = stopReasonAfterStage;
      }
      return solution;
    };

    const greedySolution = runStage("greedy", 0, null);
    let incumbent = chooseInitialIncumbent(G, params, greedySolution);
    if (!incumbent) {
      throw new Error("Auto solve did not find an initial incumbent.");
    }

    if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
      state.stopReason = "wall-clock-cap";
      return finalizeAutoSolution(incumbent, state);
    }

    let cycleIndex = 1;
    while (!state.stopReason) {
      const cycleStart = incumbent;
      const lnsSolution = runStage("lns", cycleIndex, incumbent);
      incumbent = pickBetterSolution(incumbent, lnsSolution);
      if (!incumbent) break;
      if (state.stopReason) break;

      const cpSatSolution = runStage("cp-sat", cycleIndex, incumbent);
      incumbent = pickBetterSolution(incumbent, cpSatSolution);
      if (!incumbent) break;
      if (state.stopReason) break;

      if (cpSatSolution?.cpSatStatus === "OPTIMAL" && incumbent.totalPopulation === cpSatSolution.totalPopulation) {
        state.stopReason = "optimal";
        break;
      }

      advanceWeakCycleState(cycleStart, incumbent, state, options);
      if (state.consecutiveWeakCycles >= options.maxConsecutiveWeakCycles) {
        state.stopReason = "weak-cycle-limit";
        break;
      }
      if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
        state.stopReason = "wall-clock-cap";
        break;
      }
      cycleIndex += 1;
    }

    if (!state.stopReason) {
      state.stopReason = "completed-plan";
    }

    if (!incumbent) {
      throw new Error("Auto solve did not keep a feasible incumbent.");
    }
    return finalizeAutoSolution(incumbent, state);
  } finally {
    stopController.cleanup();
  }
}

export function startAutoSolve(G: Grid, params: SolverParams): BackgroundSolveHandle {
  const options = normalizeAutoOptions(params);
  const state = createAutoRuntimeState();
  const startedAtMs = Date.now();
  const deadlineAtMs = options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const incumbentRef: { current: Solution | null } = { current: null };
  const currentHandleRef: { current: BackgroundSolveHandle | null } = { current: null };
  const nextStageSeed = createAutoStageSeedGenerator(options.randomSeed);

  const requestStop = (stopReason: AutoSolveStopReason): void => {
    if (state.stopReason) return;
    state.stopReason = stopReason;
    currentHandleRef.current?.cancel();
  };

  const wallClockTimer = deadlineAtMs === null
    ? null
    : setTimeout(() => {
        requestStop("wall-clock-cap");
      }, Math.max(1, deadlineAtMs - Date.now()));
  wallClockTimer?.unref?.();

  const promise = (async () => {
    try {
      const greedySolution = await runBackgroundStage(
        G,
        params,
        state,
        options,
        incumbentRef,
        currentHandleRef,
        "greedy",
        0,
        startGreedySolve,
        nextStageSeed,
        startedAtMs,
        deadlineAtMs
      );
      incumbentRef.current = chooseInitialIncumbent(G, params, greedySolution);
      if (!incumbentRef.current) {
        if (state.stopReason === "cancelled") {
          throw new Error("Auto solve was stopped before finding a feasible solution.");
        }
        throw new Error("Auto solve did not find an initial incumbent.");
      }

      let cycleIndex = 1;
      while (!state.stopReason) {
        const cycleStart = incumbentRef.current;
        const lnsSolution = await runBackgroundStage(
          G,
          params,
          state,
          options,
          incumbentRef,
          currentHandleRef,
          "lns",
          cycleIndex,
          startLnsSolve,
          nextStageSeed,
          startedAtMs,
          deadlineAtMs
        );
        incumbentRef.current = pickBetterSolution(incumbentRef.current, lnsSolution);
        if (!incumbentRef.current || state.stopReason) break;

        const cpSatSolution = await runBackgroundStage(
          G,
          params,
          state,
          options,
          incumbentRef,
          currentHandleRef,
          "cp-sat",
          cycleIndex,
          startCpSatSolve,
          nextStageSeed,
          startedAtMs,
          deadlineAtMs
        );
        incumbentRef.current = pickBetterSolution(incumbentRef.current, cpSatSolution);
        if (!incumbentRef.current) break;
        if (state.stopReason) break;

        if (cpSatSolution?.cpSatStatus === "OPTIMAL" && incumbentRef.current.totalPopulation === cpSatSolution.totalPopulation) {
          state.stopReason = "optimal";
          break;
        }

        advanceWeakCycleState(cycleStart, incumbentRef.current, state, options);
        if (state.consecutiveWeakCycles >= options.maxConsecutiveWeakCycles) {
          state.stopReason = "weak-cycle-limit";
          break;
        }
        cycleIndex += 1;
      }

      if (!incumbentRef.current) {
        if (state.stopReason === "cancelled") {
          throw new Error("Auto solve was stopped before finding a feasible solution.");
        }
        throw new Error("Auto solve did not find a feasible solution.");
      }

      if (!state.stopReason) {
        state.stopReason = "completed-plan";
      }

      return finalizeAutoSolution(incumbentRef.current, state);
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
    getLatestSnapshotState: () => buildSnapshotState(getLatestSnapshot()),
  };
}
