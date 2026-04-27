import type {
  AutoStageRunSummary,
  AutoStageOptimizerName,
  GreedyProfilePhaseSummary,
  LnsNeighborhoodOutcome,
  OptimizerName,
  Solution,
  SolverDecisionTraceDecision,
  SolverDecisionTraceEvent,
  SolverDecisionTraceScore,
  SolverTimeToQualityScorecard,
} from "./types.js";

export interface BuildDecisionTraceOptions {
  runId?: string;
  optimizer?: OptimizerName;
  elapsedTimeSeconds?: number | null;
  includeFinalCheckpoint?: boolean;
}

export interface BuildTimeToQualityScorecardOptions {
  finalElapsedMs?: number | null;
  finalScore?: number | null;
  timeCheckpointsMs?: readonly number[];
  qualityTargetRatios?: readonly number[];
}

const DEFAULT_TIME_CHECKPOINTS_MS = Object.freeze([5000, 30000, 120000] satisfies number[]);
const DEFAULT_QUALITY_TARGET_RATIOS = Object.freeze([0.5, 0.9, 1] satisfies number[]);

interface DecisionTraceBuilder {
  events: SolverDecisionTraceEvent[];
  push(input: Omit<SolverDecisionTraceEvent, "schemaVersion" | "runId" | "sequence" | "eventId" | "optimizer">): void;
}

interface TimedScoreObservation {
  elapsedMs: number;
  score: number;
  bestScore: number;
  event: SolverDecisionTraceEvent | null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundElapsedMs(value: unknown): number {
  const numericValue = finiteNumberOrNull(value);
  if (numericValue === null) return 0;
  return Math.max(0, Math.round(numericValue));
}

function millisecondsFromSeconds(value: unknown): number {
  const seconds = finiteNumberOrNull(value);
  return seconds === null ? 0 : roundElapsedMs(seconds * 1000);
}

function optionalMillisecondsFromSeconds(value: unknown): number | null {
  const seconds = finiteNumberOrNull(value);
  return seconds === null ? null : roundElapsedMs(seconds * 1000);
}

function normalizeCheckpointMs(values: readonly number[] | undefined, fallback: readonly number[]): number[] {
  const requested = values?.length ? values : fallback;
  return [...new Set(
    requested
      .map((value) => finiteNumberOrNull(value))
      .filter((value): value is number => value !== null)
      .map(roundElapsedMs)
  )]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
}

function normalizeQualityTargetRatios(values: readonly number[] | undefined): number[] {
  const requested = values?.length ? values : DEFAULT_QUALITY_TARGET_RATIOS;
  return [...new Set(requested.map((value) => finiteNumberOrNull(value)).filter((value): value is number => value !== null))]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
}

function inferOptimizer(solution: Solution, fallback: OptimizerName | undefined): OptimizerName {
  return solution.optimizer ?? fallback ?? "auto";
}

function inferActiveStage(solution: Solution, optimizer: OptimizerName): OptimizerName | AutoStageOptimizerName | null {
  return solution.activeOptimizer ?? solution.autoStage?.activeStage ?? optimizer;
}

function score(input: Partial<SolverDecisionTraceScore>): SolverDecisionTraceScore {
  const before = finiteNumberOrNull(input.before);
  const after = finiteNumberOrNull(input.after);
  const best = finiteNumberOrNull(input.best) ?? after;
  const delta = finiteNumberOrNull(input.delta) ?? (
    before !== null && after !== null ? after - before : null
  );
  return {
    before,
    after,
    best,
    delta,
    upperBound: finiteNumberOrNull(input.upperBound),
    gap: finiteNumberOrNull(input.gap),
  };
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${(value / 1000).toFixed(3)}s`;
}

function traceBuilder(
  runId: string,
  optimizer: OptimizerName,
  defaultActiveStage: OptimizerName | AutoStageOptimizerName | null
): DecisionTraceBuilder {
  const events: SolverDecisionTraceEvent[] = [];
  return {
    events,
    push(input: Omit<SolverDecisionTraceEvent, "schemaVersion" | "runId" | "sequence" | "eventId" | "optimizer">): void {
      const sequence = events.length;
      const { activeStage, elapsedMs, ...rest } = input;
      const event: SolverDecisionTraceEvent = {
        schemaVersion: 1,
        runId,
        sequence,
        eventId: `${runId}:${String(sequence).padStart(4, "0")}:${rest.kind}`,
        optimizer,
        activeStage: activeStage ?? defaultActiveStage,
        ...rest,
        elapsedMs: roundElapsedMs(elapsedMs),
      };
      events.push(event);
    },
  };
}

function appendGreedyPhaseEvents(
  builder: DecisionTraceBuilder,
  phases: readonly GreedyProfilePhaseSummary[] | undefined,
  activeStage: OptimizerName | AutoStageOptimizerName | null,
  stage: { stageIndex?: number; cycleIndex?: number } = {}
): void {
  if (!phases?.length) return;

  let elapsedMs = 0;
  for (const phase of phases) {
    elapsedMs += roundElapsedMs(phase.elapsedMs);
    const delta = finiteNumberOrNull(phase.bestPopulationDelta) ?? finiteNumberOrNull(phase.candidatePopulationDelta) ?? 0;
    const decision: SolverDecisionTraceDecision = delta > 0 ? "improved" : "stalled";
    builder.push({
      elapsedMs,
      activeStage,
      kind: "greedy-phase",
      decision,
      reason: decision === "improved"
        ? `Greedy ${phase.name} improved best population by ${delta}.`
        : `Greedy ${phase.name} did not improve the incumbent.`,
      score: score({
        before: phase.bestPopulationBefore,
        after: phase.bestPopulationAfter,
        delta,
      }),
      stage: {
        ...stage,
        phase: phase.name,
      },
      evidence: {
        runs: phase.runs,
        improvements: phase.improvements,
        candidateDelta: phase.candidatePopulationDelta,
      },
    });
  }
}

function lnsDecision(outcome: LnsNeighborhoodOutcome): SolverDecisionTraceDecision {
  if (outcome.status === "improved" && outcome.improvement > 0) return "improved";
  if (outcome.status === "recoverable-failure") return "failed";
  if (outcome.status === "stopped" || outcome.status === "skipped-budget") return "stopped";
  return "stalled";
}

function appendLnsEvents(
  builder: DecisionTraceBuilder,
  solution: Solution,
  activeStage: OptimizerName | AutoStageOptimizerName | null,
  elapsedMsOffset = 0
): void {
  const telemetry = solution.lnsTelemetry;
  if (!telemetry) return;

  const seedElapsedMs = millisecondsFromSeconds(telemetry.seedWallClockSeconds);
  const seedPopulation = telemetry.outcomes[0]?.populationBefore ?? solution.totalPopulation;
  builder.push({
    elapsedMs: elapsedMsOffset + seedElapsedMs,
    activeStage,
    kind: "checkpoint",
    decision: "started",
    reason: `LNS seeded from ${telemetry.seedSource}.`,
    score: score({
      after: seedPopulation,
      best: seedPopulation,
    }),
    evidence: {
      seedSource: telemetry.seedSource,
      seedTimeLimitSeconds: telemetry.seedTimeLimitSeconds,
      seedWallClockSeconds: telemetry.seedWallClockSeconds,
    },
  });

  let elapsedMs = seedElapsedMs;
  for (const outcome of telemetry.outcomes) {
    elapsedMs += millisecondsFromSeconds(outcome.wallClockSeconds);
    const decision = lnsDecision(outcome);
    builder.push({
      elapsedMs: elapsedMsOffset + elapsedMs,
      activeStage,
      kind: "lns-neighborhood",
      decision,
      reason: decision === "improved"
        ? `LNS ${outcome.phase} neighborhood ${outcome.iteration + 1} improved population by ${outcome.improvement}.`
        : `LNS ${outcome.phase} neighborhood ${outcome.iteration + 1} ${outcome.status}.`,
      score: score({
        before: outcome.populationBefore,
        after: outcome.populationAfter,
        delta: outcome.improvement,
        best: Math.max(outcome.populationBefore, outcome.populationAfter),
      }),
      stage: {
        phase: outcome.phase,
        iteration: outcome.iteration,
      },
      evidence: {
        status: outcome.status,
        repairTimeLimitSeconds: outcome.repairTimeLimitSeconds,
        staleSecondsBefore: outcome.staleSecondsBefore,
        stagnantIterationsBefore: outcome.stagnantIterationsBefore,
        cpSatStatus: outcome.cpSatStatus ?? null,
      },
    });
  }
}

function appendCpSatEvents(
  builder: DecisionTraceBuilder,
  solution: Solution,
  activeStage: OptimizerName | AutoStageOptimizerName | null,
  finalElapsedMs: number,
  elapsedMsOffset = 0
): void {
  const portfolio = solution.cpSatPortfolio;
  if (portfolio?.workers.length) {
    for (const worker of [...portfolio.workers].sort((left, right) => left.workerIndex - right.workerIndex)) {
      builder.push({
        elapsedMs: finalElapsedMs,
        activeStage,
        kind: "cp-sat-progress",
        decision: worker.feasible ? "improved" : "failed",
        reason: worker.feasible
          ? `CP-SAT portfolio worker ${worker.workerIndex} found population ${worker.totalPopulation}.`
          : `CP-SAT portfolio worker ${worker.workerIndex} finished without a feasible incumbent.`,
        score: score({
          after: worker.totalPopulation,
          best: worker.totalPopulation,
        }),
        evidence: {
          workerIndex: worker.workerIndex,
          randomSeed: worker.randomSeed,
          randomizeSearch: worker.randomizeSearch,
          numWorkers: worker.numWorkers,
          status: worker.status,
          selected: portfolio.selectedWorkerIndex === worker.workerIndex,
        },
      });
    }
  }

  const telemetry = solution.cpSatTelemetry;
  if (!telemetry && !solution.cpSatStatus) return;

  const incumbent = telemetry?.incumbentPopulation ?? solution.totalPopulation;
  const upperBound = telemetry?.bestPopulationUpperBound ?? null;
  const gap = telemetry?.populationGapUpperBound ?? null;
  const evidence: NonNullable<SolverDecisionTraceEvent["evidence"]> = telemetry
    ? {
        status: solution.cpSatStatus ?? null,
        solutionCount: telemetry.solutionCount,
        solveWallTimeSeconds: telemetry.solveWallTimeSeconds,
        numBranches: telemetry.numBranches,
        numConflicts: telemetry.numConflicts,
        lastImprovementAtSeconds: telemetry.lastImprovementAtSeconds,
        secondsSinceLastImprovement: telemetry.secondsSinceLastImprovement,
      }
    : {
        status: solution.cpSatStatus ?? null,
      };
  const hasIncumbentImprovement = Boolean(telemetry && telemetry.solutionCount > 0 && incumbent > 0);
  if (telemetry && hasIncumbentImprovement) {
    builder.push({
      elapsedMs: Math.max(elapsedMsOffset + millisecondsFromSeconds(telemetry.lastImprovementAtSeconds), 0),
      activeStage,
      kind: "cp-sat-progress",
      decision: "improved",
      reason: `CP-SAT found incumbent population ${incumbent}.`,
      score: score({
        after: incumbent,
        best: incumbent,
      }),
      evidence,
    });
  }
  const decision: SolverDecisionTraceDecision =
    gap !== null || upperBound !== null
      ? "bounded"
      : incumbent > 0
        ? "improved"
        : "stalled";
  const terminalDecision: SolverDecisionTraceDecision = hasIncumbentImprovement && decision === "improved"
    ? "stalled"
    : decision;
  const terminalElapsedMs = telemetry ? millisecondsFromSeconds(telemetry.solveWallTimeSeconds) : finalElapsedMs;
  builder.push({
    elapsedMs: Math.max((telemetry ? elapsedMsOffset : 0) + terminalElapsedMs, 0),
    activeStage,
    kind: "cp-sat-progress",
    decision: terminalDecision,
    reason: gap !== null
      ? `CP-SAT ${solution.cpSatStatus ?? "finished"} with population gap ${gap}.`
      : `CP-SAT ${solution.cpSatStatus ?? "finished"} with incumbent population ${incumbent}.`,
    score: score({
      before: hasIncumbentImprovement ? incumbent : null,
      after: incumbent,
      best: incumbent,
      upperBound,
      gap,
    }),
    evidence,
  });
}

function autoStageRunDecision(run: AutoStageRunSummary): SolverDecisionTraceDecision {
  if ((run.improvement ?? 0) > 0) return "improved";
  return run.candidatePopulation === null ? "failed" : "stalled";
}

function autoStageRunEvidence(run: AutoStageRunSummary): NonNullable<SolverDecisionTraceEvent["evidence"]> {
  return {
    randomSeed: run.randomSeed,
    startedAtSeconds: run.startedAtSeconds,
    elapsedSeconds: run.elapsedSeconds,
    completedAtSeconds: run.completedAtSeconds,
    populationBefore: run.populationBefore,
    candidatePopulation: run.candidatePopulation,
    acceptedPopulation: run.acceptedPopulation,
    improvement: run.improvement,
    cpSatStatus: run.cpSatStatus ?? null,
    cpSatSolveWallTimeSeconds: run.cpSatSolveWallTimeSeconds ?? null,
    cpSatLastImprovementAtSeconds: run.cpSatLastImprovementAtSeconds ?? null,
    cpSatPopulationGapUpperBound: run.cpSatPopulationGapUpperBound ?? null,
    lnsStopReason: run.lnsStopReason ?? null,
    lnsSeedTimeLimitSeconds: run.lnsSeedTimeLimitSeconds ?? null,
    lnsSeedWallClockSeconds: run.lnsSeedWallClockSeconds ?? null,
    lnsFocusedRepairTimeLimitSeconds: run.lnsFocusedRepairTimeLimitSeconds ?? null,
    lnsEscalatedRepairTimeLimitSeconds: run.lnsEscalatedRepairTimeLimitSeconds ?? null,
    lnsIterationsStarted: run.lnsIterationsStarted ?? null,
    lnsIterationsCompleted: run.lnsIterationsCompleted ?? null,
    lnsImprovingIterations: run.lnsImprovingIterations ?? null,
    lnsNeutralIterations: run.lnsNeutralIterations ?? null,
  };
}

function appendAutoEvents(
  builder: DecisionTraceBuilder,
  solution: Solution,
  finalElapsedMs: number
): void {
  const autoStage = solution.autoStage;
  if (!autoStage) return;
  const stageRunByIndex = new Map((autoStage.stageRuns ?? []).map((run) => [run.stageIndex, run]));

  for (const seed of [...autoStage.generatedSeeds].sort((left, right) => left.stageIndex - right.stageIndex)) {
    const startedAtSeconds = stageRunByIndex.get(seed.stageIndex)?.startedAtSeconds ?? 0;
    builder.push({
      elapsedMs: millisecondsFromSeconds(startedAtSeconds),
      activeStage: seed.stage,
      kind: "auto-stage",
      decision: "started",
      reason: `Auto started ${seed.stage} stage ${seed.stageIndex}.`,
      score: score({}),
      stage: {
        stageIndex: seed.stageIndex,
        cycleIndex: seed.cycleIndex,
      },
      evidence: {
        randomSeed: seed.randomSeed,
      },
    });
  }

  const greedySeed = autoStage.greedySeedStage;
  if (greedySeed) {
    builder.push({
      elapsedMs: millisecondsFromSeconds(greedySeed.elapsedSeconds),
      activeStage: "greedy",
      kind: "auto-stage",
      decision: typeof greedySeed.totalPopulation === "number" ? "improved" : "stalled",
      reason: `Auto greedy seed produced population ${greedySeed.totalPopulation ?? "n/a"}.`,
      score: score({
        after: greedySeed.totalPopulation,
        best: greedySeed.totalPopulation,
      }),
      evidence: {
        timeLimitSeconds: greedySeed.timeLimitSeconds,
        localSearch: greedySeed.localSearch,
        restarts: greedySeed.restarts,
        serviceRefineIterations: greedySeed.serviceRefineIterations,
        serviceRefineCandidateLimit: greedySeed.serviceRefineCandidateLimit,
      },
    });
    appendGreedyPhaseEvents(builder, greedySeed.phases, "greedy");
  }

  for (const run of [...(autoStage.stageRuns ?? [])].sort((left, right) => left.stageIndex - right.stageIndex)) {
    if (run.stage === "greedy" && greedySeed) continue;
    builder.push({
      elapsedMs: millisecondsFromSeconds(run.completedAtSeconds),
      activeStage: run.stage,
      kind: "auto-stage",
      decision: autoStageRunDecision(run),
      reason: `Auto ${run.stage} stage ${run.stageIndex} completed with candidate population ${run.candidatePopulation ?? "n/a"}.`,
      score: score({
        before: run.populationBefore,
        after: run.acceptedPopulation,
        best: run.acceptedPopulation,
      }),
      stage: {
        stageIndex: run.stageIndex,
        cycleIndex: run.cycleIndex,
      },
      evidence: autoStageRunEvidence(run),
    });
  }

  if (autoStage.stopReason) {
    builder.push({
      elapsedMs: finalElapsedMs,
      activeStage: autoStage.activeStage,
      kind: "auto-stage",
      decision: autoStage.stopReason === "stage-error" ? "failed" : "stopped",
      reason: `Auto stopped: ${autoStage.stopReason}.`,
      score: score({
        after: solution.totalPopulation,
        best: solution.totalPopulation,
      }),
      stage: {
        stageIndex: autoStage.stageIndex,
        cycleIndex: autoStage.cycleIndex,
      },
      evidence: {
        consecutiveWeakCycles: autoStage.consecutiveWeakCycles,
        lastCycleImprovementRatio: autoStage.lastCycleImprovementRatio,
      },
    });
  }
}

function autoDetailOffsetMs(solution: Solution, stage: AutoStageOptimizerName): number {
  const matchingRun = [...(solution.autoStage?.stageRuns ?? [])]
    .filter((run) => run.stage === stage && run.candidatePopulation === solution.totalPopulation)
    .sort((left, right) => right.stageIndex - left.stageIndex)[0];
  return millisecondsFromSeconds(matchingRun?.startedAtSeconds);
}

function resolveFinalElapsedMs(solution: Solution, options: BuildDecisionTraceOptions): number {
  return optionalMillisecondsFromSeconds(options.elapsedTimeSeconds)
    ?? optionalMillisecondsFromSeconds(solution.cpSatTelemetry?.solveWallTimeSeconds)
    ?? optionalMillisecondsFromSeconds(solution.lnsTelemetry?.elapsedSeconds)
    ?? 0;
}

export function buildDecisionTraceFromSolution(
  solution: Solution,
  options: BuildDecisionTraceOptions = {}
): SolverDecisionTraceEvent[] {
  const optimizer = inferOptimizer(solution, options.optimizer);
  const activeStage = inferActiveStage(solution, optimizer);
  const runId = options.runId ?? `${optimizer}-run`;
  const finalElapsedMs = resolveFinalElapsedMs(solution, options);
  const builder = traceBuilder(runId, optimizer, activeStage);

  appendAutoEvents(builder, solution, finalElapsedMs);
  if (!solution.autoStage?.greedySeedStage?.phases?.length) {
    appendGreedyPhaseEvents(builder, solution.greedyProfile?.phases, activeStage);
  }
  if (optimizer === "auto") {
    appendLnsEvents(builder, solution, solution.lnsTelemetry ? "lns" : activeStage, autoDetailOffsetMs(solution, "lns"));
    appendCpSatEvents(
      builder,
      solution,
      solution.cpSatTelemetry || solution.cpSatStatus || solution.cpSatPortfolio ? "cp-sat" : activeStage,
      finalElapsedMs,
      autoDetailOffsetMs(solution, "cp-sat")
    );
  } else {
    appendLnsEvents(builder, solution, activeStage);
    appendCpSatEvents(builder, solution, activeStage, finalElapsedMs);
  }

  if (options.includeFinalCheckpoint ?? true) {
    const previousBest = Math.max(
      0,
      ...builder.events
        .map((event) => event.score.best ?? event.score.after)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    );
    const stopped = Boolean(solution.stoppedByUser || solution.stoppedByTimeLimit);
    builder.push({
      elapsedMs: finalElapsedMs,
      activeStage,
      kind: "checkpoint",
      decision: stopped ? "stopped" : solution.totalPopulation > previousBest ? "improved" : "stalled",
      reason: `${optimizer} final incumbent population ${solution.totalPopulation}.`,
      score: score({
        before: previousBest || null,
        after: solution.totalPopulation,
        best: Math.max(previousBest, solution.totalPopulation),
      }),
      evidence: {
        stoppedByUser: Boolean(solution.stoppedByUser),
        stoppedByTimeLimit: Boolean(solution.stoppedByTimeLimit),
        roadCount: solution.roads.size,
        serviceCount: solution.services.length,
        residentialCount: solution.residentials.length,
      },
    });
  }

  return builder.events.sort((left, right) => left.elapsedMs - right.elapsedMs || left.sequence - right.sequence)
    .map((event, sequence) => ({
      ...event,
      sequence,
      eventId: `${runId}:${String(sequence).padStart(4, "0")}:${event.kind}`,
    }));
}

function buildTimedScoreObservations(
  events: readonly SolverDecisionTraceEvent[],
  finalElapsedMs: number,
  finalScore: number | null
): TimedScoreObservation[] {
  const observations = events
    .flatMap((event): Array<Omit<TimedScoreObservation, "bestScore">> => {
      const eventScore = event.score.best ?? event.score.after;
      return eventScore === null ? [] : [{ elapsedMs: event.elapsedMs, score: eventScore, event }];
    });
  if (finalScore !== null) {
    observations.push({ elapsedMs: finalElapsedMs, score: finalScore, event: null });
  }
  observations.sort((left, right) => left.elapsedMs - right.elapsedMs);
  let bestScore: number | null = null;
  return observations.map((observation) => {
    bestScore = Math.max(bestScore ?? observation.score, observation.score);
    return {
      ...observation,
      bestScore,
    };
  });
}

export function buildTimeToQualityScorecard(
  events: readonly SolverDecisionTraceEvent[],
  options: BuildTimeToQualityScorecardOptions = {}
): SolverTimeToQualityScorecard {
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const finalElapsedMs = roundElapsedMs(options.finalElapsedMs ?? lastEvent?.elapsedMs ?? 0);
  const configuredFinalScore = finiteNumberOrNull(options.finalScore);
  const observations = buildTimedScoreObservations(events, finalElapsedMs, configuredFinalScore);
  const bestScore = observations.length
    ? Math.max(...observations.map((entry) => entry.bestScore))
    : configuredFinalScore;
  const finalObservation = observations.length ? observations[observations.length - 1] : undefined;
  const finalScore = configuredFinalScore ?? finalObservation?.score ?? null;
  const firstFeasibleAtMs = observations[0]?.elapsedMs ?? null;
  const firstImprovement = events.find((event) => {
    const after = event.score.after ?? event.score.best;
    if (after === null) return false;
    if (event.score.delta !== null) return event.score.delta > 0;
    return event.score.before === null && after > 0;
  });
  const bestObservation = bestScore === null
    ? null
    : observations.find((entry) => entry.bestScore >= bestScore) ?? null;
  const timeCheckpoints = normalizeCheckpointMs(options.timeCheckpointsMs, DEFAULT_TIME_CHECKPOINTS_MS).map((elapsedMs) => {
    const latestObservation = observations
      .filter((entry) => entry.elapsedMs <= elapsedMs)
      .reduce<TimedScoreObservation | null>((latest, entry) => (
        latest === null || entry.elapsedMs >= latest.elapsedMs ? entry : latest
      ), null);
    const checkpointScore = latestObservation?.bestScore ?? null;
    return {
      elapsedMs,
      bestScore: checkpointScore,
      scoreDeltaToBest: bestScore === null || checkpointScore === null ? null : bestScore - checkpointScore,
      scoreRatioToBest: bestScore === null || bestScore <= 0 || checkpointScore === null
        ? null
        : checkpointScore / bestScore,
      reached: latestObservation !== null,
    };
  });
  const qualityTargets = normalizeQualityTargetRatios(options.qualityTargetRatios).map((ratio) => {
    const normalizedRatio = Math.max(0, ratio);
    const targetScore = bestScore === null ? null : Math.ceil(bestScore * normalizedRatio);
    const reached = targetScore === null
      ? null
      : observations.find((entry) => entry.bestScore >= targetScore) ?? null;
    return {
      ratio: normalizedRatio,
      targetScore,
      reachedAtMs: reached?.elapsedMs ?? null,
      reachedScore: reached?.bestScore ?? null,
    };
  });

  return {
    finalElapsedMs,
    finalScore,
    bestScore,
    firstFeasibleAtMs,
    firstImprovementAtMs: firstImprovement?.elapsedMs ?? null,
    bestScoreAtMs: bestObservation?.elapsedMs ?? null,
    improvementCount: events.filter((event) => event.decision === "improved" && (event.score.delta ?? 1) > 0).length,
    timeCheckpoints,
    qualityTargets,
  };
}

export function summarizeDecisionTraceReason(events: readonly SolverDecisionTraceEvent[]): string {
  const rankedDecision = ["bounded", "improved", "stopped", "failed", "stalled", "started"];
  for (const decision of rankedDecision) {
    const event = [...events].reverse().find((candidate) => candidate.decision === decision);
    if (event) return event.reason;
  }
  return "No decision trace events were captured.";
}

export function formatTimeToQualityScorecard(scorecard: SolverTimeToQualityScorecard): string {
  const best = scorecard.bestScore === null ? "n/a" : `${scorecard.bestScore}@${formatMs(scorecard.bestScoreAtMs)}`;
  const timeCheckpoints = scorecard.timeCheckpoints
    .map((checkpoint) => `${formatMs(checkpoint.elapsedMs)}:${checkpoint.bestScore ?? "n/a"}`)
    .join(",");
  const qualityTargets = scorecard.qualityTargets
    .map((checkpoint) => {
      const label = `${Math.round(checkpoint.ratio * 100)}%`;
      return `${label}:${formatMs(checkpoint.reachedAtMs)}`;
    })
    .join(",");
  return [
    `first-feasible=${formatMs(scorecard.firstFeasibleAtMs)}`,
    `first-improve=${formatMs(scorecard.firstImprovementAtMs)}`,
    `best=${best}`,
    `improvements=${scorecard.improvementCount}`,
    `time-checkpoints=${timeCheckpoints}`,
    `quality-targets=${qualityTargets}`,
  ].join(" ");
}

export function serializeDecisionTraceJsonl(events: readonly SolverDecisionTraceEvent[]): string {
  return events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
}

export function parseDecisionTraceJsonl(jsonl: string): SolverDecisionTraceEvent[] {
  return jsonl
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SolverDecisionTraceEvent);
}
