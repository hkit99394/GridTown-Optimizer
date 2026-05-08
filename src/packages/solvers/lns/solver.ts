/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { applyDeterministicDominanceUpgrades } from "../../core/index.js";
import { normalizeServicePlacement } from "../../core/index.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { height, width } from "../../core/index.js";
import { buildAdaptiveNeighborhoodCandidates, selectAdaptiveNeighborhoodOperator } from "./neighborhoods.js";
import { repairSmallWindowWithDp } from "./smallWindowDpRepair.js";
import {
  normalizeLnsWindowRankerOptions,
  selectLnsWindowRankerCandidate,
  type NormalizedLnsWindowRankerOptions
} from "./windowScorer.js";
import { NO_TYPE_INDEX } from "../../core/index.js";
import { writeSolutionSnapshot } from "../../core/index.js";
import { assertValidLnsOptions, materializeValidLnsSeedSolution } from "../../core/index.js";
import { solveGreedy } from "../greedy/solver.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  Grid,
  LnsAdaptiveOperatorName,
  LnsNeighborhoodOutcome,
  LnsNeighborhoodOutcomeStatus,
  LnsNeighborhoodAnchorPolicy,
  LnsOperatorSummary,
  LnsOperatorWeight,
  LnsRepairBackend,
  LnsRepairPhase,
  LnsWindowRankerSelectionTelemetry,
  LnsWindowRankerTelemetry,
  SmallWindowDpRepairTelemetry,
  LnsStopReason,
  LnsTelemetry,
  Solution,
  SolverParams
} from "../../core/index.js";

type NormalizedLnsOptions = {
  iterations: number;
  maxNoImprovementIterations: number;
  wallClockLimitSeconds: number | null;
  noImprovementTimeoutSeconds: number | null;
  seedTimeLimitSeconds: number | null;
  neighborhoodRows: number;
  neighborhoodCols: number;
  neighborhoodAnchorPolicy: LnsNeighborhoodAnchorPolicy;
  repairTimeLimitSeconds: number;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
  smallWindowDpRepair: boolean;
  smallWindowDpMaxMutableCells: number;
  smallWindowDpMaxCandidates: number;
  smallWindowDpMaxStates: number;
  windowRanker: NormalizedLnsWindowRankerOptions | null;
  seedHint?: CpSatWarmStartHint;
  stopFilePath: string;
  snapshotFilePath: string;
};

interface InitialLnsIncumbent {
  solution: Solution;
  seedSource: LnsTelemetry["seedSource"];
  seedWallClockSeconds: number;
}

interface LnsRepairAttempt {
  iteration: number;
  phase: LnsRepairPhase;
  operator: LnsAdaptiveOperatorName;
  operatorWeight: number;
  window: CpSatNeighborhoodWindow;
  stagnantIterationsBefore: number;
  staleSecondsBefore: number;
  repairTimeLimitSeconds: number;
  populationBefore: number;
  startedAtMs: number | null;
  windowRankerSelection?: LnsWindowRankerSelectionTelemetry;
}

const DEFAULT_LNS_ITERATIONS = 12;
const DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS = 4;
const DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS = 5;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_MUTABLE_CELLS = 14;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CANDIDATES = 28;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_STATES = 50_000;
const LNS_OPERATOR_MIN_WEIGHT = 0.25;
const LNS_OPERATOR_MAX_WEIGHT = 8;
const LNS_ADAPTIVE_OPERATORS: LnsAdaptiveOperatorName[] = [
  "weak-service",
  "residential-headroom",
  "frontier-congestion",
  "gate-choke",
  "service-overlap",
  "random-exploration",
  "placed-buildings",
  "sliding"
];
const LNS_NEIGHBORHOOD_ANCHOR_POLICIES = new Set<LnsNeighborhoodAnchorPolicy>([
  "ranked",
  "sliding-only",
  "weak-service-first",
  "residential-opportunity-first",
  "frontier-congestion-first",
  "placed-buildings-first"
]);

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveFiniteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalPositiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function lnsNeighborhoodAnchorPolicyOrDefault(value: unknown): LnsNeighborhoodAnchorPolicy {
  return typeof value === "string" && LNS_NEIGHBORHOOD_ANCHOR_POLICIES.has(value as LnsNeighborhoodAnchorPolicy)
    ? (value as LnsNeighborhoodAnchorPolicy)
    : "ranked";
}

function clampRepairBudgetToDeadline(repairTimeLimitSeconds: number, deadlineAtMs: number | null): number {
  if (deadlineAtMs === null) return repairTimeLimitSeconds;
  const remainingSeconds = (deadlineAtMs - performance.now()) / 1000;
  if (remainingSeconds <= 0) return 0;
  return Math.min(repairTimeLimitSeconds, remainingSeconds);
}

function getStaleSeconds(lastImprovementAtMs: number): number {
  return Math.max(0, (performance.now() - lastImprovementAtMs) / 1000);
}

function getEscalationTrigger(options: Pick<NormalizedLnsOptions, "maxNoImprovementIterations">): number {
  return Math.max(1, Math.ceil(options.maxNoImprovementIterations / 2));
}

function getRepairPhase(
  stagnantIterations: number,
  options: Pick<NormalizedLnsOptions, "maxNoImprovementIterations">
): LnsRepairPhase {
  return stagnantIterations + 1 >= getEscalationTrigger(options) ? "escalated" : "focused";
}

function clampOperatorWeight(weight: number): number {
  return Math.max(LNS_OPERATOR_MIN_WEIGHT, Math.min(LNS_OPERATOR_MAX_WEIGHT, weight));
}

function buildInitialOperatorSummaries(): Map<LnsAdaptiveOperatorName, LnsOperatorSummary> {
  return new Map(
    LNS_ADAPTIVE_OPERATORS.map((operator) => [
      operator,
      {
        operator,
        attempts: 0,
        feasibleRepairs: 0,
        improvements: 0,
        neutralRepairs: 0,
        recoverableFailures: 0,
        regressions: 0,
        totalImprovement: 0,
        elapsedSeconds: 0,
        weight: 1
      }
    ])
  );
}

function getOperatorSummary(
  summaries: Map<LnsAdaptiveOperatorName, LnsOperatorSummary>,
  operator: LnsAdaptiveOperatorName
): LnsOperatorSummary {
  const summary = summaries.get(operator);
  if (summary) return summary;
  const fallback: LnsOperatorSummary = {
    operator,
    attempts: 0,
    feasibleRepairs: 0,
    improvements: 0,
    neutralRepairs: 0,
    recoverableFailures: 0,
    regressions: 0,
    totalImprovement: 0,
    elapsedSeconds: 0,
    weight: 1
  };
  summaries.set(operator, fallback);
  return fallback;
}

function currentOperatorWeights(summaries: Map<LnsAdaptiveOperatorName, LnsOperatorSummary>): LnsOperatorWeight[] {
  return [...summaries.values()].map(({ operator, weight }) => ({ operator, weight }));
}

function materializeOperatorSummaries(
  summaries: Map<LnsAdaptiveOperatorName, LnsOperatorSummary>
): LnsOperatorSummary[] {
  return [...summaries.values()].map((summary) => ({ ...summary }));
}

function updateOperatorSummary(
  summaries: Map<LnsAdaptiveOperatorName, LnsOperatorSummary>,
  outcome: LnsNeighborhoodOutcome
): void {
  if (!outcome.operator) return;
  const summary = getOperatorSummary(summaries, outcome.operator);
  const regression = outcome.populationAfter < outcome.populationBefore;

  summary.attempts += 1;
  summary.elapsedSeconds += outcome.wallClockSeconds;
  if (outcome.status === "improved" || outcome.status === "neutral") summary.feasibleRepairs += 1;
  if (outcome.status === "improved") {
    summary.improvements += 1;
    summary.totalImprovement += outcome.improvement;
    summary.weight = clampOperatorWeight(summary.weight + 1 + Math.min(4, outcome.improvement / 100));
  } else if (outcome.status === "neutral") {
    summary.neutralRepairs += 1;
  } else if (outcome.status === "recoverable-failure") {
    summary.recoverableFailures += 1;
    summary.weight = clampOperatorWeight(summary.weight * 0.7);
  }

  if (regression) {
    summary.regressions += 1;
    summary.weight = clampOperatorWeight(summary.weight * 0.8);
  }
}

function getLnsOptions(G: Grid, params: SolverParams): NormalizedLnsOptions {
  const H = height(G);
  const W = width(G);
  const lns = params.lns ?? {};
  const repairableRows = H > 1 ? H - 1 : H;
  const repairTimeLimitSeconds = positiveFiniteNumberOrDefault(
    lns.repairTimeLimitSeconds,
    positiveFiniteNumberOrDefault(params.cpSat?.timeLimitSeconds, DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS)
  );
  const wallClockLimitSeconds =
    optionalPositiveFiniteNumber(lns.wallClockLimitSeconds) ?? optionalPositiveFiniteNumber(lns.timeLimitSeconds);
  return {
    iterations: positiveIntegerOrDefault(lns.iterations, DEFAULT_LNS_ITERATIONS),
    maxNoImprovementIterations: positiveIntegerOrDefault(
      lns.maxNoImprovementIterations,
      DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS
    ),
    wallClockLimitSeconds,
    noImprovementTimeoutSeconds: optionalPositiveFiniteNumber(lns.noImprovementTimeoutSeconds),
    seedTimeLimitSeconds:
      optionalPositiveFiniteNumber(lns.seedTimeLimitSeconds) ??
      (wallClockLimitSeconds === null
        ? null
        : Math.max(0.1, Math.min(wallClockLimitSeconds * 0.2, repairTimeLimitSeconds))),
    neighborhoodRows: Math.max(
      1,
      Math.min(repairableRows || 1, positiveIntegerOrDefault(lns.neighborhoodRows, Math.max(4, Math.ceil(H / 2))))
    ),
    neighborhoodCols: Math.max(
      1,
      Math.min(W || 1, positiveIntegerOrDefault(lns.neighborhoodCols, Math.max(4, Math.ceil(W / 2))))
    ),
    neighborhoodAnchorPolicy: lnsNeighborhoodAnchorPolicyOrDefault(lns.neighborhoodAnchorPolicy),
    repairTimeLimitSeconds,
    focusedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(
      lns.focusedRepairTimeLimitSeconds,
      repairTimeLimitSeconds
    ),
    escalatedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(
      lns.escalatedRepairTimeLimitSeconds,
      repairTimeLimitSeconds
    ),
    smallWindowDpRepair: booleanOrDefault(lns.smallWindowDpRepair, false),
    smallWindowDpMaxMutableCells: positiveIntegerOrDefault(
      lns.smallWindowDpMaxMutableCells,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_MUTABLE_CELLS
    ),
    smallWindowDpMaxCandidates: positiveIntegerOrDefault(
      lns.smallWindowDpMaxCandidates,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CANDIDATES
    ),
    smallWindowDpMaxStates: positiveIntegerOrDefault(
      lns.smallWindowDpMaxStates,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_STATES
    ),
    windowRanker: normalizeLnsWindowRankerOptions(lns.windowRanker),
    seedHint: lns.seedHint,
    stopFilePath: lns.stopFilePath ?? "",
    snapshotFilePath: lns.snapshotFilePath ?? ""
  };
}

function serviceCandidateKey(solution: Solution, index: number): string {
  const service = normalizeServicePlacement(solution.services[index]);
  const typeIndex = solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX;
  return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
}

function residentialCandidateKey(solution: Solution, index: number): string {
  const residential = solution.residentials[index];
  const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
  return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
}

export function buildLnsWarmStartHint(
  solution: Solution,
  neighborhoodWindow: CpSatNeighborhoodWindow
): CpSatWarmStartHint {
  const roadKeys = Array.from(solution.roads);
  return {
    sourceName: "lns-incumbent",
    roadKeys,
    serviceCandidateKeys: solution.services.map((_, index) => serviceCandidateKey(solution, index)),
    residentialCandidateKeys: solution.residentials.map((_, index) => residentialCandidateKey(solution, index)),
    solution: {
      roads: roadKeys,
      services: solution.services.map((service, index) => {
        const normalized = normalizeServicePlacement(service);
        return {
          r: normalized.r,
          c: normalized.c,
          rows: normalized.rows,
          cols: normalized.cols,
          range: normalized.range,
          typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
          bonus: solution.servicePopulationIncreases[index] ?? 0
        };
      }),
      residentials: solution.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: solution.populations[index] ?? 0
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation
    },
    // Keep the incumbent as a regular warm start, but avoid OR-Tools' repair_hint
    // path here because it has been crashing inside MinimizeL1DistanceWithHint().
    neighborhoodWindow,
    fixOutsideNeighborhoodToHintedValue: true
  };
}
export {
  buildAdaptiveNeighborhoodCandidates,
  buildNeighborhoodWindows,
  selectAdaptiveNeighborhoodOperator
} from "./neighborhoods.js";

function shouldStop(stopFilePath: string): boolean {
  return Boolean(stopFilePath) && existsSync(stopFilePath);
}

function isRecoverableRepairFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /No feasible solution found with CP-SAT\./.test(error.message);
}

function buildInitialLnsIncumbent(G: Grid, params: SolverParams, options: NormalizedLnsOptions): InitialLnsIncumbent {
  const startedAt = performance.now();
  const seededIncumbent = materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
  if (seededIncumbent) {
    return {
      solution: applyDeterministicDominanceUpgrades(G, params, seededIncumbent),
      seedSource: "hint",
      seedWallClockSeconds: (performance.now() - startedAt) / 1000
    };
  }

  const initialIncumbent = {
    ...solveGreedy(G, {
      ...params,
      optimizer: "greedy",
      greedy: {
        ...(params.greedy ?? {}),
        profile: params.greedy?.profile ?? true,
        ...(options.seedTimeLimitSeconds !== null ? { timeLimitSeconds: options.seedTimeLimitSeconds } : {}),
        ...(options.stopFilePath ? { stopFilePath: options.stopFilePath } : {})
      }
    }),
    optimizer: "lns" as const
  };
  return {
    solution: applyDeterministicDominanceUpgrades(G, params, initialIncumbent),
    seedSource: "greedy",
    seedWallClockSeconds: (performance.now() - startedAt) / 1000
  };
}

function buildLnsTelemetry(
  stopReason: LnsStopReason,
  options: NormalizedLnsOptions,
  initialIncumbent: InitialLnsIncumbent,
  startedAtMs: number,
  stagnantIterations: number,
  outcomes: LnsTelemetry["outcomes"],
  operatorSummaries: LnsOperatorSummary[]
): LnsTelemetry {
  const windowRanker = buildWindowRankerTelemetry(options.windowRanker, outcomes);
  return {
    stopReason,
    seedSource: initialIncumbent.seedSource,
    seedWallClockSeconds: initialIncumbent.seedWallClockSeconds,
    seedTimeLimitSeconds: options.seedTimeLimitSeconds,
    wallClockLimitSeconds: options.wallClockLimitSeconds,
    noImprovementTimeoutSeconds: options.noImprovementTimeoutSeconds,
    focusedRepairTimeLimitSeconds: options.focusedRepairTimeLimitSeconds,
    escalatedRepairTimeLimitSeconds: options.escalatedRepairTimeLimitSeconds,
    iterationsStarted: outcomes.filter((outcome) => outcome.status !== "skipped-budget").length,
    iterationsCompleted: outcomes.filter(
      (outcome) => outcome.status !== "skipped-budget" && outcome.status !== "stopped"
    ).length,
    improvingIterations: outcomes.filter((outcome) => outcome.status === "improved").length,
    neutralIterations: outcomes.filter((outcome) => outcome.status === "neutral").length,
    recoverableFailures: outcomes.filter((outcome) => outcome.status === "recoverable-failure").length,
    skippedIterations: outcomes.filter((outcome) => outcome.status === "skipped-budget" || outcome.status === "stopped")
      .length,
    finalStagnantIterations: stagnantIterations,
    elapsedSeconds: (performance.now() - startedAtMs) / 1000,
    ...(windowRanker ? { windowRanker } : {}),
    operatorSummaries,
    outcomes: [...outcomes]
  };
}

function buildWindowRankerTelemetry(
  options: NormalizedLnsWindowRankerOptions | null,
  outcomes: LnsTelemetry["outcomes"]
): LnsWindowRankerTelemetry | undefined {
  if (!options) return undefined;
  const selections = outcomes
    .map((outcome) => outcome.windowRankerSelection)
    .filter((selection): selection is LnsWindowRankerSelectionTelemetry => selection !== undefined);
  return {
    enabled: true,
    ...(options.model.modelFingerprint ? { modelFingerprint: options.model.modelFingerprint } : {}),
    featureSchemaVersion: options.model.featureSchemaVersion ?? null,
    minScoreDelta: options.minScoreDelta,
    ...(options.allowedTransitions === null ? {} : { allowedTransitions: [...options.allowedTransitions] }),
    decisions: selections.length,
    overrides: selections.filter((selection) => !selection.selectedByBaseline).length,
    fallbackDecisions: selections.filter((selection) => selection.fallbackReason !== undefined).length
  };
}

function materializeLnsSolution(incumbent: Solution, telemetry: LnsTelemetry, stoppedByUser = false): Solution {
  const solutionStoppedByUser = stoppedByUser || Boolean(incumbent.stoppedByUser);
  return {
    ...incumbent,
    optimizer: "lns",
    lnsTelemetry: telemetry,
    ...(solutionStoppedByUser ? { stoppedByUser: true } : {})
  };
}

function writeLnsSnapshot(options: NormalizedLnsOptions, incumbent: Solution, telemetry: LnsTelemetry): void {
  if (!options.snapshotFilePath) return;
  writeSolutionSnapshot(options.snapshotFilePath, materializeLnsSolution(incumbent, telemetry));
}

function buildRepairAttempt(
  input: Omit<LnsRepairAttempt, "startedAtMs"> & { startedAtMs?: number | null }
): LnsRepairAttempt {
  return {
    ...input,
    startedAtMs: input.startedAtMs ?? null,
    ...(input.windowRankerSelection ? { windowRankerSelection: input.windowRankerSelection } : {})
  };
}

function buildRepairOutcome(
  attempt: LnsRepairAttempt,
  status: LnsNeighborhoodOutcomeStatus,
  populationAfter: number,
  improvement = 0,
  cpSatStatus?: string | null,
  metadata: {
    repairBackend?: LnsRepairBackend;
    smallWindowDp?: SmallWindowDpRepairTelemetry;
  } = {}
): LnsNeighborhoodOutcome {
  return {
    iteration: attempt.iteration,
    phase: attempt.phase,
    operator: attempt.operator,
    operatorWeight: attempt.operatorWeight,
    window: attempt.window,
    stagnantIterationsBefore: attempt.stagnantIterationsBefore,
    staleSecondsBefore: attempt.staleSecondsBefore,
    repairTimeLimitSeconds: attempt.repairTimeLimitSeconds,
    wallClockSeconds: attempt.startedAtMs === null ? 0 : (performance.now() - attempt.startedAtMs) / 1000,
    populationBefore: attempt.populationBefore,
    populationAfter,
    improvement,
    status,
    ...(metadata.repairBackend ? { repairBackend: metadata.repairBackend } : {}),
    ...(attempt.windowRankerSelection ? { windowRankerSelection: attempt.windowRankerSelection } : {}),
    ...(cpSatStatus !== undefined ? { cpSatStatus } : {}),
    ...(metadata.smallWindowDp ? { smallWindowDp: metadata.smallWindowDp } : {})
  };
}

export function solveLns(G: Grid, params: SolverParams): Solution {
  assertValidLnsOptions(params);
  const startedAtMs = performance.now();
  const options = getLnsOptions(G, params);
  const deadlineAtMs =
    options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const outcomes: LnsTelemetry["outcomes"] = [];
  const operatorSummaries = buildInitialOperatorSummaries();

  const initialIncumbent = buildInitialLnsIncumbent(G, params, options);
  let incumbent = initialIncumbent.solution;
  let stagnantIterations = 0;
  let lastImprovementAtMs = performance.now();

  const buildTelemetry = (stopReason: LnsStopReason): LnsTelemetry =>
    buildLnsTelemetry(
      stopReason,
      options,
      initialIncumbent,
      startedAtMs,
      stagnantIterations,
      outcomes,
      materializeOperatorSummaries(operatorSummaries)
    );

  const recordOutcome = (outcome: LnsNeighborhoodOutcome): void => {
    outcomes.push(outcome);
    updateOperatorSummary(operatorSummaries, outcome);
  };

  const writeRunningSnapshot = (): void => writeLnsSnapshot(options, incumbent, buildTelemetry("running"));

  const finish = (stopReason: LnsStopReason, stoppedByUser = false): Solution => {
    const telemetry = buildTelemetry(stopReason);
    writeLnsSnapshot(options, incumbent, telemetry);
    return materializeLnsSolution(incumbent, telemetry, stoppedByUser);
  };

  writeRunningSnapshot();

  if (shouldStop(options.stopFilePath)) {
    return finish("cancelled", true);
  }
  if (deadlineAtMs !== null && performance.now() >= deadlineAtMs) {
    return finish("wall-clock-limit");
  }

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    if (shouldStop(options.stopFilePath)) {
      return finish("cancelled", true);
    }

    if (deadlineAtMs !== null && performance.now() >= deadlineAtMs) {
      return finish("wall-clock-limit");
    }

    if (
      options.noImprovementTimeoutSeconds !== null &&
      getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
    ) {
      return finish("stale-time-limit");
    }

    if (stagnantIterations >= options.maxNoImprovementIterations) {
      return finish("stale-iteration-limit");
    }

    const candidates = buildAdaptiveNeighborhoodCandidates(G, params, incumbent, options, stagnantIterations + 1);
    if (candidates.length === 0) {
      return finish("no-neighborhoods");
    }

    const baselineNeighborhood = selectAdaptiveNeighborhoodOperator(
      candidates,
      iteration,
      stagnantIterations,
      options,
      currentOperatorWeights(operatorSummaries)
    );
    const windowRankerDecision = options.windowRanker
      ? selectLnsWindowRankerCandidate(G, params, incumbent, candidates, baselineNeighborhood, options.windowRanker)
      : null;
    const selectedNeighborhood = windowRankerDecision?.candidate ?? baselineNeighborhood;
    const neighborhoodWindow = selectedNeighborhood.window;
    const operatorSummary = getOperatorSummary(operatorSummaries, selectedNeighborhood.operator);
    const phase = getRepairPhase(stagnantIterations, options);
    const configuredRepairTimeLimitSeconds =
      phase === "escalated" ? options.escalatedRepairTimeLimitSeconds : options.focusedRepairTimeLimitSeconds;
    const repairTimeLimitSeconds = clampRepairBudgetToDeadline(configuredRepairTimeLimitSeconds, deadlineAtMs);
    const populationBefore = incumbent.totalPopulation;
    const staleSecondsBefore = getStaleSeconds(lastImprovementAtMs);

    if (repairTimeLimitSeconds <= 0) {
      recordOutcome(
        buildRepairOutcome(
          buildRepairAttempt({
            iteration,
            phase,
            operator: selectedNeighborhood.operator,
            operatorWeight: operatorSummary.weight,
            window: neighborhoodWindow,
            stagnantIterationsBefore: stagnantIterations,
            staleSecondsBefore,
            repairTimeLimitSeconds: 0,
            populationBefore,
            ...(windowRankerDecision ? { windowRankerSelection: windowRankerDecision.telemetry } : {})
          }),
          "skipped-budget",
          populationBefore
        )
      );
      writeRunningSnapshot();
      return finish("wall-clock-limit");
    }

    const repairStartedAtMs = performance.now();
    const attempt = buildRepairAttempt({
      iteration,
      phase,
      operator: selectedNeighborhood.operator,
      operatorWeight: operatorSummary.weight,
      window: neighborhoodWindow,
      stagnantIterationsBefore: stagnantIterations,
      staleSecondsBefore,
      repairTimeLimitSeconds,
      populationBefore,
      startedAtMs: repairStartedAtMs,
      ...(windowRankerDecision ? { windowRankerSelection: windowRankerDecision.telemetry } : {})
    });
    try {
      let smallWindowDp: SmallWindowDpRepairTelemetry | undefined;
      if (options.smallWindowDpRepair) {
        const dpResult = repairSmallWindowWithDp(G, params, incumbent, neighborhoodWindow, {
          maxMutableCells: options.smallWindowDpMaxMutableCells,
          maxCandidates: options.smallWindowDpMaxCandidates,
          maxStates: options.smallWindowDpMaxStates
        });
        smallWindowDp = dpResult.telemetry;
        if (dpResult.status === "optimal" && dpResult.solution) {
          if (dpResult.solution.totalPopulation > incumbent.totalPopulation) {
            incumbent = applyDeterministicDominanceUpgrades(G, params, {
              ...dpResult.solution,
              optimizer: "lns"
            });
            const populationAfter = incumbent.totalPopulation;
            recordOutcome(
              buildRepairOutcome(attempt, "improved", populationAfter, populationAfter - populationBefore, undefined, {
                repairBackend: "small-window-dp",
                smallWindowDp
              })
            );
            stagnantIterations = 0;
            lastImprovementAtMs = performance.now();
            writeRunningSnapshot();
            continue;
          }
          recordOutcome(
            buildRepairOutcome(attempt, "neutral", dpResult.solution.totalPopulation, 0, undefined, {
              repairBackend: "small-window-dp",
              smallWindowDp
            })
          );
          stagnantIterations += 1;
          writeRunningSnapshot();
          continue;
        }
      }

      const candidate = solveCpSat(G, {
        ...params,
        optimizer: "cp-sat",
        cpSat: {
          ...(params.cpSat ?? {}),
          // LNS repair is safer with a single worker; multi-worker repair_hint-style
          // search has been crashing in the local OR-Tools runtime.
          numWorkers: 1,
          timeLimitSeconds: repairTimeLimitSeconds,
          stopFilePath: options.stopFilePath || undefined,
          warmStartHint: buildLnsWarmStartHint(incumbent, neighborhoodWindow)
        }
      });

      if (candidate.totalPopulation > incumbent.totalPopulation) {
        incumbent = applyDeterministicDominanceUpgrades(G, params, {
          ...candidate,
          optimizer: "lns"
        });
        const populationAfter = incumbent.totalPopulation;
        recordOutcome(
          buildRepairOutcome(
            attempt,
            "improved",
            populationAfter,
            populationAfter - populationBefore,
            candidate.cpSatStatus ?? null,
            { repairBackend: "cp-sat", smallWindowDp }
          )
        );
        stagnantIterations = 0;
        lastImprovementAtMs = performance.now();
        writeRunningSnapshot();
        continue;
      }
      recordOutcome(
        buildRepairOutcome(attempt, "neutral", candidate.totalPopulation, 0, candidate.cpSatStatus ?? null, {
          repairBackend: "cp-sat",
          smallWindowDp
        })
      );
      stagnantIterations += 1;
      writeRunningSnapshot();
    } catch (error) {
      if (shouldStop(options.stopFilePath)) {
        recordOutcome(buildRepairOutcome(attempt, "stopped", populationBefore));
        return finish("cancelled", true);
      }
      if (isRecoverableRepairFailure(error)) {
        recordOutcome(buildRepairOutcome(attempt, "recoverable-failure", populationBefore));
        stagnantIterations += 1;
        writeRunningSnapshot();
        continue;
      }
      throw error;
    }
  }

  if (
    options.noImprovementTimeoutSeconds !== null &&
    getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
  ) {
    return finish("stale-time-limit");
  }
  return finish(stagnantIterations >= options.maxNoImprovementIterations ? "stale-iteration-limit" : "iteration-limit");
}
