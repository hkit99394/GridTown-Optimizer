/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { applyDeterministicDominanceUpgrades } from "../core/dominanceUpgrades.js";
import { normalizeServicePlacement } from "../core/buildings.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { height, width } from "../core/grid.js";
import { buildNeighborhoodWindows, selectNeighborhoodWindow } from "./neighborhoods.js";
import { NO_TYPE_INDEX } from "../core/rules.js";
import { writeSolutionSnapshot } from "../core/solutionSerialization.js";
import { assertValidLnsOptions, materializeValidLnsSeedSolution } from "../core/solverInputValidation.js";
import { solveGreedy } from "../greedy/solver.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  Grid,
  LnsNeighborhoodOutcome,
  LnsNeighborhoodOutcomeStatus,
  LnsNeighborhoodAnchorPolicy,
  LnsRepairPhase,
  LnsStopReason,
  LnsTelemetry,
  LnsOptions,
  Solution,
  SolverParams,
} from "../core/types.js";

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
  window: CpSatNeighborhoodWindow;
  stagnantIterationsBefore: number;
  staleSecondsBefore: number;
  repairTimeLimitSeconds: number;
  populationBefore: number;
  startedAtMs: number | null;
}

const DEFAULT_LNS_ITERATIONS = 12;
const DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS = 4;
const DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS = 5;
const LNS_NEIGHBORHOOD_ANCHOR_POLICIES = new Set<LnsNeighborhoodAnchorPolicy>([
  "ranked",
  "sliding-only",
  "weak-service-first",
  "residential-opportunity-first",
  "frontier-congestion-first",
  "placed-buildings-first",
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

function lnsNeighborhoodAnchorPolicyOrDefault(value: unknown): LnsNeighborhoodAnchorPolicy {
  return typeof value === "string" && LNS_NEIGHBORHOOD_ANCHOR_POLICIES.has(value as LnsNeighborhoodAnchorPolicy)
    ? value as LnsNeighborhoodAnchorPolicy
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

function getLnsOptions(G: Grid, params: SolverParams): NormalizedLnsOptions {
  const H = height(G);
  const W = width(G);
  const lns = params.lns ?? {};
  const repairableRows = H > 1 ? H - 1 : H;
  const repairTimeLimitSeconds = positiveFiniteNumberOrDefault(
    lns.repairTimeLimitSeconds,
    positiveFiniteNumberOrDefault(params.cpSat?.timeLimitSeconds, DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS)
  );
  const wallClockLimitSeconds = optionalPositiveFiniteNumber(lns.wallClockLimitSeconds)
    ?? optionalPositiveFiniteNumber(lns.timeLimitSeconds);
  return {
    iterations: positiveIntegerOrDefault(lns.iterations, DEFAULT_LNS_ITERATIONS),
    maxNoImprovementIterations: positiveIntegerOrDefault(
      lns.maxNoImprovementIterations,
      DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS
    ),
    wallClockLimitSeconds,
    noImprovementTimeoutSeconds: optionalPositiveFiniteNumber(lns.noImprovementTimeoutSeconds),
    seedTimeLimitSeconds: optionalPositiveFiniteNumber(lns.seedTimeLimitSeconds)
      ?? (wallClockLimitSeconds === null ? null : Math.max(0.1, Math.min(wallClockLimitSeconds * 0.2, repairTimeLimitSeconds))),
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
    focusedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(lns.focusedRepairTimeLimitSeconds, repairTimeLimitSeconds),
    escalatedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(
      lns.escalatedRepairTimeLimitSeconds,
      repairTimeLimitSeconds
    ),
    seedHint: lns.seedHint,
    stopFilePath: lns.stopFilePath ?? "",
    snapshotFilePath: lns.snapshotFilePath ?? "",
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

export function buildLnsWarmStartHint(solution: Solution, neighborhoodWindow: CpSatNeighborhoodWindow): CpSatWarmStartHint {
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
          bonus: solution.servicePopulationIncreases[index] ?? 0,
        };
      }),
      residentials: solution.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: solution.populations[index] ?? 0,
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation,
    },
    // Keep the incumbent as a regular warm start, but avoid OR-Tools' repair_hint
    // path here because it has been crashing inside MinimizeL1DistanceWithHint().
    neighborhoodWindow,
    fixOutsideNeighborhoodToHintedValue: true,
  };
}
export { buildNeighborhoodWindows } from "./neighborhoods.js";

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
      seedWallClockSeconds: (performance.now() - startedAt) / 1000,
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
        ...(options.stopFilePath ? { stopFilePath: options.stopFilePath } : {}),
      },
    }),
    optimizer: "lns" as const,
  };
  return {
    solution: applyDeterministicDominanceUpgrades(G, params, initialIncumbent),
    seedSource: "greedy",
    seedWallClockSeconds: (performance.now() - startedAt) / 1000,
  };
}

function buildLnsTelemetry(
  stopReason: LnsStopReason,
  options: NormalizedLnsOptions,
  initialIncumbent: InitialLnsIncumbent,
  startedAtMs: number,
  stagnantIterations: number,
  outcomes: LnsTelemetry["outcomes"]
): LnsTelemetry {
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
    iterationsCompleted: outcomes.filter((outcome) => outcome.status !== "skipped-budget" && outcome.status !== "stopped").length,
    improvingIterations: outcomes.filter((outcome) => outcome.status === "improved").length,
    neutralIterations: outcomes.filter((outcome) => outcome.status === "neutral").length,
    recoverableFailures: outcomes.filter((outcome) => outcome.status === "recoverable-failure").length,
    skippedIterations: outcomes.filter((outcome) => outcome.status === "skipped-budget" || outcome.status === "stopped").length,
    finalStagnantIterations: stagnantIterations,
    elapsedSeconds: (performance.now() - startedAtMs) / 1000,
    outcomes: [...outcomes],
  };
}

function materializeLnsSolution(
  incumbent: Solution,
  telemetry: LnsTelemetry,
  stoppedByUser = false
): Solution {
  const solutionStoppedByUser = stoppedByUser || Boolean(incumbent.stoppedByUser);
  return {
    ...incumbent,
    optimizer: "lns",
    lnsTelemetry: telemetry,
    ...(solutionStoppedByUser ? { stoppedByUser: true } : {}),
  };
}

function writeLnsSnapshot(
  options: NormalizedLnsOptions,
  incumbent: Solution,
  telemetry: LnsTelemetry
): void {
  if (!options.snapshotFilePath) return;
  writeSolutionSnapshot(options.snapshotFilePath, materializeLnsSolution(incumbent, telemetry));
}

function buildRepairAttempt(input: Omit<LnsRepairAttempt, "startedAtMs"> & { startedAtMs?: number | null }): LnsRepairAttempt {
  return {
    ...input,
    startedAtMs: input.startedAtMs ?? null,
  };
}

function buildRepairOutcome(
  attempt: LnsRepairAttempt,
  status: LnsNeighborhoodOutcomeStatus,
  populationAfter: number,
  improvement = 0,
  cpSatStatus?: string | null
): LnsNeighborhoodOutcome {
  return {
    iteration: attempt.iteration,
    phase: attempt.phase,
    window: attempt.window,
    stagnantIterationsBefore: attempt.stagnantIterationsBefore,
    staleSecondsBefore: attempt.staleSecondsBefore,
    repairTimeLimitSeconds: attempt.repairTimeLimitSeconds,
    wallClockSeconds: attempt.startedAtMs === null ? 0 : (performance.now() - attempt.startedAtMs) / 1000,
    populationBefore: attempt.populationBefore,
    populationAfter,
    improvement,
    status,
    ...(cpSatStatus !== undefined ? { cpSatStatus } : {}),
  };
}

export function solveLns(G: Grid, params: SolverParams): Solution {
  assertValidLnsOptions(params);
  const startedAtMs = performance.now();
  const options = getLnsOptions(G, params);
  const deadlineAtMs = options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const outcomes: LnsTelemetry["outcomes"] = [];

  const initialIncumbent = buildInitialLnsIncumbent(G, params, options);
  let incumbent = initialIncumbent.solution;
  let stagnantIterations = 0;
  let lastImprovementAtMs = performance.now();

  const buildTelemetry = (stopReason: LnsStopReason): LnsTelemetry =>
    buildLnsTelemetry(stopReason, options, initialIncumbent, startedAtMs, stagnantIterations, outcomes);

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
      options.noImprovementTimeoutSeconds !== null
      && getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
    ) {
      return finish("stale-time-limit");
    }

    if (stagnantIterations >= options.maxNoImprovementIterations) {
      return finish("stale-iteration-limit");
    }

    const windows = buildNeighborhoodWindows(G, params, incumbent, options, stagnantIterations + 1);
    if (windows.length === 0) {
      return finish("no-neighborhoods");
    }

    const neighborhoodWindow = selectNeighborhoodWindow(windows, iteration, stagnantIterations, options);
    const phase = getRepairPhase(stagnantIterations, options);
    const configuredRepairTimeLimitSeconds = phase === "escalated"
      ? options.escalatedRepairTimeLimitSeconds
      : options.focusedRepairTimeLimitSeconds;
    const repairTimeLimitSeconds = clampRepairBudgetToDeadline(configuredRepairTimeLimitSeconds, deadlineAtMs);
    const populationBefore = incumbent.totalPopulation;
    const staleSecondsBefore = getStaleSeconds(lastImprovementAtMs);

    if (repairTimeLimitSeconds <= 0) {
      outcomes.push(buildRepairOutcome(buildRepairAttempt({
        iteration,
        phase,
        window: neighborhoodWindow,
        stagnantIterationsBefore: stagnantIterations,
        staleSecondsBefore,
        repairTimeLimitSeconds: 0,
        populationBefore,
      }), "skipped-budget", populationBefore));
      writeRunningSnapshot();
      return finish("wall-clock-limit");
    }

    const repairStartedAtMs = performance.now();
    const attempt = buildRepairAttempt({
      iteration,
      phase,
      window: neighborhoodWindow,
      stagnantIterationsBefore: stagnantIterations,
      staleSecondsBefore,
      repairTimeLimitSeconds,
      populationBefore,
      startedAtMs: repairStartedAtMs,
    });
    try {
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
          warmStartHint: buildLnsWarmStartHint(incumbent, neighborhoodWindow),
        },
      });

      if (candidate.totalPopulation > incumbent.totalPopulation) {
        incumbent = applyDeterministicDominanceUpgrades(G, params, {
          ...candidate,
          optimizer: "lns",
        });
        const populationAfter = incumbent.totalPopulation;
        outcomes.push(
          buildRepairOutcome(attempt, "improved", populationAfter, populationAfter - populationBefore, candidate.cpSatStatus ?? null)
        );
        stagnantIterations = 0;
        lastImprovementAtMs = performance.now();
        writeRunningSnapshot();
        continue;
      }
      outcomes.push(buildRepairOutcome(attempt, "neutral", candidate.totalPopulation, 0, candidate.cpSatStatus ?? null));
      stagnantIterations += 1;
      writeRunningSnapshot();
    } catch (error) {
      if (shouldStop(options.stopFilePath)) {
        outcomes.push(buildRepairOutcome(attempt, "stopped", populationBefore));
        return finish("cancelled", true);
      }
      if (isRecoverableRepairFailure(error)) {
        outcomes.push(buildRepairOutcome(attempt, "recoverable-failure", populationBefore));
        stagnantIterations += 1;
        writeRunningSnapshot();
        continue;
      }
      throw error;
    }
  }

  if (
    options.noImprovementTimeoutSeconds !== null
    && getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
  ) {
    return finish("stale-time-limit");
  }
  return finish(stagnantIterations >= options.maxNoImprovementIterations ? "stale-iteration-limit" : "iteration-limit");
}
