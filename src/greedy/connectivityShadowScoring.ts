import type {
  GreedyConnectivityShadowDecisionTrace,
  GreedyConnectivityShadowPlacementTrace,
  GreedyProfileCounters,
  ServiceCandidate,
  Solution,
  SolverParams,
} from "../core/types.js";
import type {
  GreedyAttemptState,
  PlacementRect,
} from "./attemptState.js";
import {
  getCandidateTypeIndex,
  roadCostFromTieBreakProbe,
} from "./candidates.js";
import type { ResidentialCandidateLike, TieBreakProbe } from "./candidates.js";

export const CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT = 80;

const CONNECTIVITY_SHADOW_FOOTPRINT_PENALTY_WEIGHT = 0.125;
const CONNECTIVITY_SHADOW_MAX_ROAD_COST_DELTA = 4;
const CONNECTIVITY_SHADOW_MAX_ROAD_COST = 4;

export type ConnectivityShadowDecisionRecorder = (decision: GreedyConnectivityShadowDecisionTrace) => void;

export function createConnectivityShadowDecisionRecorder(enabled: boolean): {
  decisions: GreedyConnectivityShadowDecisionTrace[] | undefined;
  recordDecision: ConnectivityShadowDecisionRecorder | undefined;
} {
  if (!enabled) {
    return {
      decisions: undefined,
      recordDecision: undefined,
    };
  }

  const decisions: GreedyConnectivityShadowDecisionTrace[] = [];
  return {
    decisions,
    recordDecision: (decision) => {
      if (decisions.length < CONNECTIVITY_SHADOW_DECISION_TRACE_LIMIT) {
        decisions.push(decision);
      }
    },
  };
}

export function chooseConnectivityShadowGuardedSolution(candidate: Solution, baseline: Solution): Solution {
  if (candidate.totalPopulation !== baseline.totalPopulation) {
    return candidate.totalPopulation > baseline.totalPopulation ? candidate : baseline;
  }
  return candidate.roads.size <= baseline.roads.size ? candidate : baseline;
}

export function buildConnectivityShadowBaselineGuardParams(
  params: SolverParams,
  timeLimitSeconds: number | undefined
): SolverParams {
  const baselineParams = structuredClone(params);
  baselineParams.greedy = {
    ...(baselineParams.greedy ?? {}),
    connectivityShadowScoring: false,
    snapshotFilePath: "",
    ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
  };
  return baselineParams;
}

export function computeConnectivityShadowPenalty(
  attemptState: GreedyAttemptState,
  placement: PlacementRect,
  footprintKeys?: readonly string[]
): number {
  const shadow = attemptState.measureConnectivityShadow(placement, footprintKeys);
  return shadow.disconnectedCells + shadow.footprintCells * CONNECTIVITY_SHADOW_FOOTPRINT_PENALTY_WEIGHT;
}

export function compareConnectivityShadowPenalty(candidatePenalty: number, incumbentPenalty: number): number {
  if (Math.abs(candidatePenalty - incumbentPenalty) <= 1e-9) return 0;
  return candidatePenalty < incumbentPenalty ? 1 : -1;
}

export function canUseConnectivityShadowTieBreak(candidateProbe: TieBreakProbe, incumbentProbe: TieBreakProbe): boolean {
  const candidateRoadCost = roadCostFromTieBreakProbe(candidateProbe);
  const incumbentRoadCost = roadCostFromTieBreakProbe(incumbentProbe);
  return Math.max(candidateRoadCost, incumbentRoadCost) <= CONNECTIVITY_SHADOW_MAX_ROAD_COST
    && Math.abs(candidateRoadCost - incumbentRoadCost) <= CONNECTIVITY_SHADOW_MAX_ROAD_COST_DELTA;
}

export function servicePlacementTrace(
  service: ServiceCandidate,
  probe: TieBreakProbe
): GreedyConnectivityShadowPlacementTrace {
  return {
    r: service.r,
    c: service.c,
    rows: service.rows,
    cols: service.cols,
    roadCost: roadCostFromTieBreakProbe(probe),
    typeIndex: service.typeIndex,
    bonus: service.bonus,
    range: service.range,
  };
}

export function residentialPlacementTrace(
  residential: ResidentialCandidateLike,
  probe: TieBreakProbe
): GreedyConnectivityShadowPlacementTrace {
  return {
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
    roadCost: roadCostFromTieBreakProbe(probe),
    typeIndex: getCandidateTypeIndex(residential),
  };
}

export function recordConnectivityShadowTieDecision(options: {
  record?: ConnectivityShadowDecisionRecorder;
  profileCounters?: GreedyProfileCounters;
  phase: GreedyConnectivityShadowDecisionTrace["phase"];
  score: number;
  candidate: GreedyConnectivityShadowPlacementTrace;
  incumbent: GreedyConnectivityShadowPlacementTrace;
  candidateShadowPenalty: number;
  incumbentShadowPenalty: number;
  comparison: number;
}): void {
  const { profileCounters, comparison } = options;
  if (profileCounters) {
    profileCounters.roads.connectivityShadowScoreTies++;
    if (comparison > 0) {
      profileCounters.roads.connectivityShadowScoreWins++;
    } else if (comparison < 0) {
      profileCounters.roads.connectivityShadowScoreLosses++;
    } else {
      profileCounters.roads.connectivityShadowScoreNeutral++;
    }
  }
  if (comparison === 0 || !options.record) return;
  const candidateWon = comparison > 0;
  options.record({
    phase: options.phase,
    score: options.score,
    candidate: options.candidate,
    incumbent: options.incumbent,
    chosen: candidateWon ? options.candidate : options.incumbent,
    rejected: candidateWon ? options.incumbent : options.candidate,
    candidateShadowPenalty: options.candidateShadowPenalty,
    incumbentShadowPenalty: options.incumbentShadowPenalty,
  });
}
