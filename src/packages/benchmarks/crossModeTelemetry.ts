import { roundBenchmarkMetric } from "./benchmarkOptions.js";

import type {
  AutoLnsNeighborhoodOutcomeSummary,
  AutoStageRunSummary,
  CpSatModelSizeTelemetry,
  GreedyProfileCounters,
  GreedyProfilePhaseSummary,
  LnsNeighborhoodOutcome,
  OptimizerName,
  Solution,
  SolverDecisionTraceEvent,
  SolverParams,
  SolverTimeToQualityScorecard
} from "../core/index.js";
import type {
  CrossModeBenchmarkCase,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSplit,
  CrossModeBenchmarkSuiteResult,
  CrossModeProblemSizeBand,
  CrossModeWorkflowTag
} from "./crossMode.js";

export interface CrossModeBenchmarkSolverParamSummary {
  optimizer: OptimizerName;
  auto: Record<string, unknown> | null;
  greedy: Record<string, unknown> | null;
  lns: Record<string, unknown> | null;
  cpSat: Record<string, unknown> | null;
  portfolio: Record<string, unknown> | null;
}

export type CrossModeBenchmarkStageTelemetryKind =
  | "auto-stage"
  | "greedy-profile"
  | "lns"
  | "lns-neighborhood"
  | "cp-sat"
  | "cp-sat-portfolio-worker";

export interface CrossModeBenchmarkStageTelemetry {
  kind: CrossModeBenchmarkStageTelemetryKind;
  stage: OptimizerName;
  stageIndex: number | null;
  cycleIndex: number | null;
  phase: string | null;
  iteration: number | null;
  status: string | null;
  operatorOutcome: string | null;
  startedAtSeconds: number | null;
  wallClockSeconds: number | null;
  completedAtSeconds: number | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  improvement: number | null;
  exactGap: number | null;
  cpSatStatus: string | null;
  candidateCounts: Record<string, number> | null;
  cpSatModelSize: Record<string, number> | null;
}

export interface CrossModeBenchmarkRunTelemetry {
  schemaVersion: 1;
  runId: string;
  caseName: string;
  split: CrossModeBenchmarkSplit;
  workflowTags: CrossModeWorkflowTag[];
  problemSizeBand: CrossModeProblemSizeBand;
  mode: CrossModeBenchmarkMode;
  optimizer: OptimizerName;
  budgetAblationPolicyName?: string;
  budgetAblationPolicyApplied?: boolean;
  budgetSeconds: number;
  seed: number;
  solverParams: CrossModeBenchmarkSolverParamSummary;
  timing: {
    wallClockSeconds: number;
    firstFeasibleSeconds: number | null;
    firstImprovementSeconds: number | null;
    bestScoreSeconds: number | null;
  };
  score: {
    finalPopulation: number;
    bestScore: number | null;
    cpSatStatus: string | null;
    exactGap: number | null;
    lnsStopReason: string | null;
    autoStopReason: string | null;
    stoppedByUser: boolean;
  };
  cpu: {
    workerCpuBudgetSeconds: number;
    observedWorkerCpuSeconds: number | null;
  };
  stageCount: number;
  stages: CrossModeBenchmarkStageTelemetry[];
}

export interface CrossModeBenchmarkTelemetryManifest {
  schemaVersion: 1;
  source: "cross-mode-benchmark";
  generatedAt: string;
  command: string | null;
  git: {
    commit: string;
    branch: string;
  } | null;
  hardware: Record<string, unknown> | null;
  suite: {
    caseCount: number;
    modeCount: number;
    totalRuns: number;
    selectedCaseNames: string[];
    modes: CrossModeBenchmarkMode[];
    budgetsSeconds: number[];
    seeds: number[];
  };
  runs: CrossModeBenchmarkRunTelemetry[];
}

export interface CrossModeBenchmarkTelemetryManifestOptions {
  command?: string;
  git?: {
    commit: string;
    branch: string;
  };
  hardware?: Record<string, unknown>;
}

export interface BuildCrossModeRunTelemetryOptions {
  benchmarkCase: CrossModeBenchmarkCase;
  mode: CrossModeBenchmarkMode;
  params: SolverParams;
  solution: Solution;
  traceArtifacts: {
    decisionTrace: SolverDecisionTraceEvent[];
    timeToQuality: SolverTimeToQualityScorecard;
  };
  problemSizeBand: CrossModeProblemSizeBand;
  budgetSeconds: number;
  seed: number;
  budgetAblationPolicyName?: string;
  budgetAblationPolicyApplied?: boolean;
  wallClockSeconds: number;
  workerCpuBudgetSeconds: number;
  observedWorkerCpuSeconds: number | null;
}

function modeToOptimizer(mode: CrossModeBenchmarkMode): OptimizerName {
  return mode === "cp-sat-portfolio" ? "cp-sat" : mode;
}

function compactRecord(entries: readonly [string, unknown][]): Record<string, unknown> | null {
  const record: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) record[key] = value;
  }
  return Object.keys(record).length > 0 ? record : null;
}

function compactNumericRecord(entries: readonly [string, unknown][]): Record<string, number> | null {
  const record: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
  }
  return Object.keys(record).length > 0 ? record : null;
}

function hintSource(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("sourceName" in value && typeof value.sourceName === "string") return value.sourceName;
  if ("roads" in value && value.roads instanceof Set) return "solution";
  return "hint";
}

function summarizeCrossModeSolverParams(params: SolverParams): CrossModeBenchmarkSolverParamSummary {
  const cpSat = params.cpSat;
  const portfolio = cpSat?.portfolio;
  return {
    optimizer: params.optimizer ?? "auto",
    auto: compactRecord([
      ["wallClockLimitSeconds", params.auto?.wallClockLimitSeconds],
      ["randomSeed", params.auto?.randomSeed],
      ["cpSatStageTimeLimitSeconds", params.auto?.cpSatStageTimeLimitSeconds],
      ["cpSatStageReserveRatio", params.auto?.cpSatStageReserveRatio],
      ["cpSatStageNoImprovementTimeoutSeconds", params.auto?.cpSatStageNoImprovementTimeoutSeconds],
      ["weakCycleImprovementThreshold", params.auto?.weakCycleImprovementThreshold],
      ["maxConsecutiveWeakCycles", params.auto?.maxConsecutiveWeakCycles]
    ]),
    greedy: compactRecord([
      ["timeLimitSeconds", params.greedy?.timeLimitSeconds],
      ["randomSeed", params.greedy?.randomSeed],
      ["localSearch", params.greedy?.localSearch],
      ["restarts", params.greedy?.restarts],
      ["serviceRefineIterations", params.greedy?.serviceRefineIterations],
      ["serviceRefineCandidateLimit", params.greedy?.serviceRefineCandidateLimit],
      ["exhaustiveServiceSearch", params.greedy?.exhaustiveServiceSearch],
      ["serviceExactPoolLimit", params.greedy?.serviceExactPoolLimit],
      ["serviceExactMaxCombinations", params.greedy?.serviceExactMaxCombinations],
      ["serviceMasterDecomposition", params.greedy?.serviceMasterDecomposition],
      ["serviceMasterPoolLimit", params.greedy?.serviceMasterPoolLimit],
      ["serviceMasterMaxLayouts", params.greedy?.serviceMasterMaxLayouts]
    ]),
    lns: compactRecord([
      ["wallClockLimitSeconds", params.lns?.wallClockLimitSeconds],
      ["timeLimitSeconds", params.lns?.timeLimitSeconds],
      ["seedTimeLimitSeconds", params.lns?.seedTimeLimitSeconds],
      ["iterations", params.lns?.iterations],
      ["maxNoImprovementIterations", params.lns?.maxNoImprovementIterations],
      ["noImprovementTimeoutSeconds", params.lns?.noImprovementTimeoutSeconds],
      ["neighborhoodRows", params.lns?.neighborhoodRows],
      ["neighborhoodCols", params.lns?.neighborhoodCols],
      ["neighborhoodAnchorPolicy", params.lns?.neighborhoodAnchorPolicy],
      ["repairTimeLimitSeconds", params.lns?.repairTimeLimitSeconds],
      ["focusedRepairTimeLimitSeconds", params.lns?.focusedRepairTimeLimitSeconds],
      ["escalatedRepairTimeLimitSeconds", params.lns?.escalatedRepairTimeLimitSeconds],
      ["seedHintSource", hintSource(params.lns?.seedHint)]
    ]),
    cpSat: compactRecord([
      ["timeLimitSeconds", cpSat?.timeLimitSeconds],
      ["maxDeterministicTime", cpSat?.maxDeterministicTime],
      ["numWorkers", cpSat?.numWorkers],
      ["randomSeed", cpSat?.randomSeed],
      ["randomizeSearch", cpSat?.randomizeSearch],
      ["relativeGapLimit", cpSat?.relativeGapLimit],
      ["absoluteGapLimit", cpSat?.absoluteGapLimit],
      ["noImprovementTimeoutSeconds", cpSat?.noImprovementTimeoutSeconds],
      ["warmStartHintSource", hintSource(cpSat?.warmStartHint)],
      ["objectiveLowerBound", cpSat?.objectiveLowerBound],
      ["streamProgress", cpSat?.streamProgress],
      ["progressIntervalSeconds", cpSat?.progressIntervalSeconds]
    ]),
    portfolio: compactRecord([
      ["workerCount", portfolio?.workerCount],
      ["randomSeeds", portfolio?.randomSeeds],
      ["totalCpuBudgetSeconds", portfolio?.totalCpuBudgetSeconds],
      ["perWorkerTimeLimitSeconds", portfolio?.perWorkerTimeLimitSeconds],
      ["perWorkerMaxDeterministicTime", portfolio?.perWorkerMaxDeterministicTime],
      ["perWorkerNumWorkers", portfolio?.perWorkerNumWorkers],
      ["randomizeSearch", portfolio?.randomizeSearch]
    ])
  };
}

function secondsFromMs(value: number | null): number | null {
  return value === null ? null : roundBenchmarkMetric(value / 1000);
}

function greedyCandidateCounts(counters: GreedyProfileCounters | undefined): Record<string, number> | null {
  if (!counters) return null;
  return {
    serviceCandidates: counters.precompute.serviceCandidates,
    residentialCandidates: counters.precompute.residentialCandidates,
    residentialScoringGroups: counters.precompute.residentialScoringGroups,
    serviceCoveragePairs: counters.precompute.serviceCoveragePairs,
    serviceCandidateScans: counters.servicePhase.candidateScans,
    residentialCandidateScans: counters.residentialPhase.candidateScans,
    localSearchCandidateScans: counters.localSearch.candidateScans,
    roadProbeCalls: counters.roads.probeCalls
  };
}

function cpSatModelSizeRecord(modelSize: CpSatModelSizeTelemetry | null | undefined): Record<string, number> | null {
  if (!modelSize) return null;
  return { ...modelSize };
}

function cpSatCandidateCounts(modelSize: CpSatModelSizeTelemetry | null | undefined): Record<string, number> | null {
  if (!modelSize) return null;
  return {
    serviceCandidates: modelSize.serviceCandidateCount,
    residentialCandidates: modelSize.residentialCandidateCount,
    allowedCells: modelSize.allowedCellCount,
    roadEligibleCells: modelSize.roadEligibleCellCount,
    roadVariables: modelSize.roadVariableCount,
    directedEdges: modelSize.directedEdgeCount
  };
}

function pushGreedyProfileStages(
  stages: CrossModeBenchmarkStageTelemetry[],
  phases: readonly GreedyProfilePhaseSummary[] | undefined,
  candidateCounts: Record<string, number> | null,
  stageIndex: number | null = null,
  cycleIndex: number | null = null
): void {
  if (!phases?.length) return;
  let completedAtSeconds = 0;
  for (const phase of phases) {
    const wallClockSeconds = roundBenchmarkMetric(phase.elapsedMs / 1000);
    completedAtSeconds = roundBenchmarkMetric(completedAtSeconds + wallClockSeconds);
    stages.push({
      kind: "greedy-profile",
      stage: "greedy",
      stageIndex,
      cycleIndex,
      phase: phase.name,
      iteration: null,
      status: phase.improvements > 0 ? "improved" : "stalled",
      operatorOutcome: null,
      startedAtSeconds: null,
      wallClockSeconds,
      completedAtSeconds,
      scoreBefore: phase.bestPopulationBefore,
      scoreAfter: phase.bestPopulationAfter,
      improvement: phase.bestPopulationDelta,
      exactGap: null,
      cpSatStatus: null,
      candidateCounts,
      cpSatModelSize: null
    });
  }
}

function lnsOutcomeStage(outcome: LnsNeighborhoodOutcome): CrossModeBenchmarkStageTelemetry {
  return {
    kind: "lns-neighborhood",
    stage: "lns",
    stageIndex: null,
    cycleIndex: null,
    phase: outcome.phase,
    iteration: outcome.iteration,
    status: outcome.status,
    operatorOutcome: outcome.status,
    startedAtSeconds: null,
    wallClockSeconds: roundBenchmarkMetric(outcome.wallClockSeconds),
    completedAtSeconds: null,
    scoreBefore: outcome.populationBefore,
    scoreAfter: outcome.populationAfter,
    improvement: outcome.improvement,
    exactGap: null,
    cpSatStatus: outcome.cpSatStatus ?? null,
    candidateCounts: {
      windowTop: outcome.window.top,
      windowLeft: outcome.window.left,
      windowRows: outcome.window.rows,
      windowCols: outcome.window.cols,
      windowArea: outcome.window.rows * outcome.window.cols,
      stagnantIterationsBefore: outcome.stagnantIterationsBefore
    },
    cpSatModelSize: null
  };
}

function autoLnsOutcomeStage(
  run: AutoStageRunSummary,
  outcome: AutoLnsNeighborhoodOutcomeSummary
): CrossModeBenchmarkStageTelemetry {
  return {
    kind: "lns-neighborhood",
    stage: "lns",
    stageIndex: run.stageIndex,
    cycleIndex: run.cycleIndex,
    phase: outcome.phase,
    iteration: outcome.iteration,
    status: outcome.status,
    operatorOutcome: outcome.status,
    startedAtSeconds: null,
    wallClockSeconds: roundBenchmarkMetric(outcome.wallClockSeconds),
    completedAtSeconds: null,
    scoreBefore: outcome.populationBefore,
    scoreAfter: outcome.populationAfter,
    improvement: outcome.improvement,
    exactGap: null,
    cpSatStatus: outcome.cpSatStatus ?? null,
    candidateCounts: {
      windowTop: outcome.windowTop,
      windowLeft: outcome.windowLeft,
      windowRows: outcome.windowRows,
      windowCols: outcome.windowCols,
      windowArea: outcome.windowRows * outcome.windowCols,
      stagnantIterationsBefore: outcome.stagnantIterationsBefore
    },
    cpSatModelSize: null
  };
}

function buildCrossModeStageTelemetry(solution: Solution): CrossModeBenchmarkStageTelemetry[] {
  const stages: CrossModeBenchmarkStageTelemetry[] = [];
  const greedyCounts = greedyCandidateCounts(solution.greedyProfile?.counters);
  pushGreedyProfileStages(stages, solution.greedyProfile?.phases, greedyCounts);
  pushGreedyProfileStages(stages, solution.autoStage?.greedySeedStage?.phases, greedyCounts);
  const autoLnsNeighborhoodStages: CrossModeBenchmarkStageTelemetry[] = [];

  for (const run of solution.autoStage?.stageRuns ?? []) {
    stages.push({
      kind: "auto-stage",
      stage: run.stage,
      stageIndex: run.stageIndex,
      cycleIndex: run.cycleIndex,
      phase: null,
      iteration: null,
      status: run.candidatePopulation === null ? "failed" : (run.improvement ?? 0) > 0 ? "improved" : "stalled",
      operatorOutcome: run.stage,
      startedAtSeconds: roundBenchmarkMetric(run.startedAtSeconds),
      wallClockSeconds: roundBenchmarkMetric(run.elapsedSeconds),
      completedAtSeconds: roundBenchmarkMetric(run.completedAtSeconds),
      scoreBefore: run.populationBefore,
      scoreAfter: run.acceptedPopulation,
      improvement: run.improvement,
      exactGap: run.cpSatPopulationGapUpperBound ?? null,
      cpSatStatus: run.cpSatStatus ?? null,
      candidateCounts: compactNumericRecord([
        ["lnsIterationsStarted", run.lnsIterationsStarted],
        ["lnsIterationsCompleted", run.lnsIterationsCompleted],
        ["lnsImprovingIterations", run.lnsImprovingIterations],
        ["lnsNeutralIterations", run.lnsNeutralIterations]
      ]),
      cpSatModelSize: null
    });
    if (run.stage === "lns") {
      autoLnsNeighborhoodStages.push(
        ...(run.lnsNeighborhoods ?? []).map((outcome) => autoLnsOutcomeStage(run, outcome))
      );
    }
  }

  stages.push(...autoLnsNeighborhoodStages);

  if (solution.lnsTelemetry && autoLnsNeighborhoodStages.length === 0) {
    const telemetry = solution.lnsTelemetry;
    stages.push({
      kind: "lns",
      stage: "lns",
      stageIndex: null,
      cycleIndex: null,
      phase: null,
      iteration: null,
      status: telemetry.stopReason,
      operatorOutcome: telemetry.stopReason,
      startedAtSeconds: null,
      wallClockSeconds: roundBenchmarkMetric(telemetry.elapsedSeconds),
      completedAtSeconds: roundBenchmarkMetric(telemetry.elapsedSeconds),
      scoreBefore: telemetry.outcomes[0]?.populationBefore ?? null,
      scoreAfter: solution.totalPopulation,
      improvement: telemetry.outcomes.reduce((sum, outcome) => sum + Math.max(0, outcome.improvement), 0),
      exactGap: null,
      cpSatStatus: null,
      candidateCounts: {
        iterationsStarted: telemetry.iterationsStarted,
        iterationsCompleted: telemetry.iterationsCompleted,
        improvingIterations: telemetry.improvingIterations,
        neutralIterations: telemetry.neutralIterations,
        recoverableFailures: telemetry.recoverableFailures,
        skippedIterations: telemetry.skippedIterations
      },
      cpSatModelSize: null
    });
    stages.push(...telemetry.outcomes.map(lnsOutcomeStage));
  }

  if (solution.cpSatTelemetry || solution.cpSatStatus) {
    const telemetry = solution.cpSatTelemetry;
    stages.push({
      kind: "cp-sat",
      stage: "cp-sat",
      stageIndex: null,
      cycleIndex: null,
      phase: null,
      iteration: null,
      status: solution.cpSatStatus ?? null,
      operatorOutcome: solution.cpSatStatus ?? null,
      startedAtSeconds: null,
      wallClockSeconds: telemetry ? roundBenchmarkMetric(telemetry.solveWallTimeSeconds) : null,
      completedAtSeconds: telemetry ? roundBenchmarkMetric(telemetry.solveWallTimeSeconds) : null,
      scoreBefore: null,
      scoreAfter: telemetry?.incumbentPopulation ?? solution.totalPopulation,
      improvement: null,
      exactGap: telemetry?.populationGapUpperBound ?? null,
      cpSatStatus: solution.cpSatStatus ?? null,
      candidateCounts: cpSatCandidateCounts(telemetry?.modelSize),
      cpSatModelSize: cpSatModelSizeRecord(telemetry?.modelSize)
    });
  }

  for (const worker of solution.cpSatPortfolio?.workers ?? []) {
    stages.push({
      kind: "cp-sat-portfolio-worker",
      stage: "cp-sat",
      stageIndex: worker.workerIndex,
      cycleIndex: null,
      phase: null,
      iteration: null,
      status: worker.status,
      operatorOutcome: worker.feasible ? "feasible" : "infeasible",
      startedAtSeconds: null,
      wallClockSeconds: worker.telemetry ? roundBenchmarkMetric(worker.telemetry.solveWallTimeSeconds) : null,
      completedAtSeconds: worker.telemetry ? roundBenchmarkMetric(worker.telemetry.solveWallTimeSeconds) : null,
      scoreBefore: null,
      scoreAfter: worker.totalPopulation,
      improvement: null,
      exactGap: worker.telemetry?.populationGapUpperBound ?? null,
      cpSatStatus: worker.status,
      candidateCounts: cpSatCandidateCounts(worker.telemetry?.modelSize),
      cpSatModelSize: cpSatModelSizeRecord(worker.telemetry?.modelSize)
    });
  }

  return stages;
}

export function buildCrossModeRunTelemetry(options: BuildCrossModeRunTelemetryOptions): CrossModeBenchmarkRunTelemetry {
  const runId =
    options.traceArtifacts.decisionTrace[0]?.runId ??
    `${options.benchmarkCase.name}:${options.mode}:budget-${options.budgetSeconds}:seed-${options.seed}`;
  const stages = buildCrossModeStageTelemetry(options.solution);
  return {
    schemaVersion: 1,
    runId,
    caseName: options.benchmarkCase.name,
    split: options.benchmarkCase.split ?? "development",
    workflowTags: [...(options.benchmarkCase.workflowTags ?? [])],
    problemSizeBand: options.problemSizeBand,
    mode: options.mode,
    optimizer: options.params.optimizer ?? modeToOptimizer(options.mode),
    ...(options.budgetAblationPolicyName
      ? {
          budgetAblationPolicyName: options.budgetAblationPolicyName,
          budgetAblationPolicyApplied: Boolean(options.budgetAblationPolicyApplied)
        }
      : {}),
    budgetSeconds: options.budgetSeconds,
    seed: options.seed,
    solverParams: summarizeCrossModeSolverParams(options.params),
    timing: {
      wallClockSeconds: roundBenchmarkMetric(options.wallClockSeconds),
      firstFeasibleSeconds: secondsFromMs(options.traceArtifacts.timeToQuality.firstFeasibleAtMs),
      firstImprovementSeconds: secondsFromMs(options.traceArtifacts.timeToQuality.firstImprovementAtMs),
      bestScoreSeconds: secondsFromMs(options.traceArtifacts.timeToQuality.bestScoreAtMs)
    },
    score: {
      finalPopulation: options.solution.totalPopulation,
      bestScore: options.traceArtifacts.timeToQuality.bestScore,
      cpSatStatus: options.solution.cpSatStatus ?? null,
      exactGap: options.solution.cpSatTelemetry?.populationGapUpperBound ?? null,
      lnsStopReason: options.solution.lnsTelemetry?.stopReason ?? null,
      autoStopReason: options.solution.autoStage?.stopReason ?? null,
      stoppedByUser: Boolean(options.solution.stoppedByUser)
    },
    cpu: {
      workerCpuBudgetSeconds: roundBenchmarkMetric(options.workerCpuBudgetSeconds),
      observedWorkerCpuSeconds: options.observedWorkerCpuSeconds
    },
    stageCount: stages.length,
    stages
  };
}

export function buildCrossModeBenchmarkTelemetryManifest(
  result: CrossModeBenchmarkSuiteResult,
  options: CrossModeBenchmarkTelemetryManifestOptions = {}
): CrossModeBenchmarkTelemetryManifest {
  const runs = result.cases.flatMap((scorecard) => scorecard.results.map((benchmark) => benchmark.telemetry));
  return {
    schemaVersion: 1,
    source: "cross-mode-benchmark",
    generatedAt: result.generatedAt,
    command: options.command ?? null,
    git: options.git ?? null,
    hardware: options.hardware ?? null,
    suite: {
      caseCount: result.caseCount,
      modeCount: result.modeCount,
      totalRuns: runs.length,
      selectedCaseNames: [...result.selectedCaseNames],
      modes: [...result.modes],
      budgetsSeconds: [...result.budgetsSeconds],
      seeds: [...result.seeds]
    },
    runs
  };
}
