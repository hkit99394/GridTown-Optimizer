import { existsSync } from "node:fs";

import type {
  Grid,
  GreedyProfileCounters,
  GreedyProfilePhaseName,
  Solution,
  SolverParams,
} from "../../core/index.js";
import { writeSolutionSnapshot } from "../../core/index.js";
import {
  createGreedyProfilePhaseRecorder,
  createGreedyProfilePhaseSummaries,
  runGreedyProfilePhase,
} from "./profile.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import {
  CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT,
  buildConnectivityShadowBaselineGuardParams,
  chooseConnectivityShadowGuardedSolution,
  createConnectivityShadowDecisionRecorder,
} from "./connectivityShadowScoring.js";
import {
  ROAD_OPPORTUNITY_TRACE_LIMIT,
  createRoadOpportunityRecorder,
} from "./roadOpportunity.js";
import { GreedyStopError } from "./runtime.js";
import {
  isBetterDensityAwareSearchSolution,
  isBetterSearchSolution,
} from "./solutionRanking.js";
import { buildGreedyDiagnostics } from "./diagnostics.js";
import type {
  GreedyBestUpdater,
  GreedyPreparedInputs,
} from "./types.js";

export interface GreedyRunLifecycle {
  maybeStop: (force?: boolean) => void;
  updateBest: GreedyBestUpdater;
  getBestPopulation: () => number | null;
  requireBest: () => Solution;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
  runProfiledPhase: <T>(phase: GreedyProfilePhaseName, run: () => T) => T;
  finalizeWithBaselineGuard: (
    solution: Solution,
    preparedInputs: GreedyPreparedInputs,
    maxServices: number | undefined,
    maxResidentials: number | undefined
  ) => Solution;
}

export function createGreedyRunLifecycle(options: {
  G: Grid;
  params: SolverParams;
  diagnostics: boolean;
  timeLimitSeconds: number | undefined;
  stopFilePath: string | undefined;
  snapshotFilePath: string | undefined;
  densityTieBreaker: boolean;
  connectivityShadowScoring: boolean;
  profileCounters?: GreedyProfileCounters;
  profilePhases?: ReturnType<typeof createGreedyProfilePhaseSummaries>;
  connectivityShadowDecisions?: ReturnType<typeof createConnectivityShadowDecisionRecorder>["decisions"];
  roadOpportunityTraces?: ReturnType<typeof createRoadOpportunityRecorder>["traces"];
  getBest: () => Solution | null;
  setBest: (solution: Solution | null) => void;
  baselineSolver: (G: Grid, params: SolverParams) => Solution;
}): GreedyRunLifecycle {
  const {
    G,
    params,
    diagnostics,
    timeLimitSeconds,
    stopFilePath,
    snapshotFilePath,
    densityTieBreaker,
    connectivityShadowScoring,
    profileCounters,
    profilePhases,
    connectivityShadowDecisions,
    roadOpportunityTraces,
    getBest,
    setBest,
    baselineSolver,
  } = options;
  let stopCounter = 0;
  const startedAtMs = Date.now();
  const deadlineAtMs = timeLimitSeconds === undefined ? null : startedAtMs + timeLimitSeconds * 1000;
  const getBestPopulation = (): number | null => getBest()?.totalPopulation ?? null;
  const recordProfilePhase = createGreedyProfilePhaseRecorder(profilePhases);
  const runProfiledPhase = <T>(phase: GreedyProfilePhaseName, run: () => T): T => {
    return runGreedyProfilePhase({
      phase,
      recordProfilePhase,
      getBestPopulation,
      run,
    });
  };
  const maybeStop = (force = false): void => {
    const best = getBest();
    if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
      throw new GreedyStopError(best ? { ...best, stoppedByTimeLimit: true } : null, "time-limit");
    }
    if (!stopFilePath) return;
    stopCounter += 1;
    if (!force && stopCounter % 128 !== 0) return;
    if (!existsSync(stopFilePath)) return;
    throw new GreedyStopError(best ? { ...best, stoppedByUser: true } : null, "cancelled");
  };
  const updateBest = (candidate: Solution | null): void => {
    if (!candidate) return;
    const best = getBest();
    const isBetterCandidate = densityTieBreaker
      ? isBetterDensityAwareSearchSolution(G, candidate, best)
      : isBetterSearchSolution(candidate, best);
    if (isBetterCandidate) {
      setBest(candidate);
      if (snapshotFilePath) writeSolutionSnapshot(snapshotFilePath, candidate);
    }
  };
  const requireBest = (): Solution => {
    const best = getBest();
    if (!best) throw new Error("No feasible solution found.");
    return best;
  };
  const finalizeGreedySolution = (
    solution: Solution,
    preparedInputs: GreedyPreparedInputs,
    maxServices: number | undefined,
    maxResidentials: number | undefined
  ): Solution => {
    const withDiagnostics = diagnostics
      ? {
          ...solution,
          greedyDiagnostics: buildGreedyDiagnostics({
            G,
            params,
            solution,
            preparedInputs,
            maxServices,
            maxResidentials,
          }),
        }
      : solution;
    if (!profileCounters) return withDiagnostics;
    return {
      ...withDiagnostics,
      greedyProfile: {
        counters: structuredClone(profileCounters),
        phases: structuredClone(profilePhases ?? []),
        connectivityShadowDecisions: structuredClone(connectivityShadowDecisions ?? []),
        connectivityShadowDecisionTraceLimit: CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT,
        roadOpportunityTraces: structuredClone(roadOpportunityTraces ?? []),
        roadOpportunityTraceLimit: ROAD_OPPORTUNITY_TRACE_LIMIT,
      },
    };
  };
  const applyConnectivityShadowBaselineGuard = (solution: Solution): Solution => {
    if (!connectivityShadowScoring) return solution;
    const remainingSeconds =
      deadlineAtMs === null ? undefined : Math.max(0, (deadlineAtMs - Date.now()) / 1000);
    if (remainingSeconds !== undefined && remainingSeconds <= 0) {
      return solution;
    }
    let baseline: Solution;
    try {
      baseline = baselineSolver(
        G.map((row) => [...row]),
        buildConnectivityShadowBaselineGuardParams(params, remainingSeconds)
      );
    } catch (error) {
      if (error instanceof GreedyStopError) return solution;
      throw error;
    }
    const guarded = chooseConnectivityShadowGuardedSolution(solution, baseline);
    if (snapshotFilePath) writeSolutionSnapshot(snapshotFilePath, guarded);
    return guarded;
  };
  return {
    maybeStop,
    updateBest,
    getBestPopulation,
    requireBest,
    recordProfilePhase,
    runProfiledPhase,
    finalizeWithBaselineGuard: (
      solution,
      preparedInputs,
      maxServices,
      maxResidentials
    ) => applyConnectivityShadowBaselineGuard(finalizeGreedySolution(
      solution,
      preparedInputs,
      maxServices,
      maxResidentials
    )),
  };
}
