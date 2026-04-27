import type {
  Grid,
  GreedyProfileCounters,
  GreedyRoadOpportunityCounterfactualTrace,
  GreedyRoadOpportunityTrace,
} from "../core/types.js";
import { measureBuildingConnectivityShadow } from "../core/roads.js";
import type { BuildingConnectivityShadow } from "../core/roads.js";
import type {
  ConnectivityProbe,
  GreedyAttemptState,
  PlacementRect,
} from "./attemptState.js";

export const ROAD_OPPORTUNITY_TRACE_LIMIT = 80;
export const ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT = 3;
const ROAD_OPPORTUNITY_LOCAL_SEARCH_TRACE_RESERVE = 16;

type RoadCounters = GreedyProfileCounters["roads"];
type ConnectivityOpportunity = BuildingConnectivityShadow;

export type RoadOpportunityRecorder = ((trace: GreedyRoadOpportunityTrace) => void) & {
  remaining: () => number;
  remainingForPhase: (phase: GreedyRoadOpportunityTrace["phase"]) => number;
};

export type RoadOpportunityCounterfactualCandidate = {
  reason: GreedyRoadOpportunityCounterfactualTrace["reason"];
  placement: PlacementRect;
  probe: ConnectivityProbe;
  footprintKeys?: readonly string[];
  occupiedBuildings?: Set<string>;
  score: number;
  tieBreakComparison?: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: GreedyRoadOpportunityTrace["moveKind"];
};

type RecordRoadOpportunityBaseOptions = {
  placement: PlacementRect;
  probe: ConnectivityProbe;
  phase: GreedyRoadOpportunityTrace["phase"];
  profileCounters?: GreedyProfileCounters;
  record?: RoadOpportunityRecorder;
  score?: number;
  counterfactuals?: readonly RoadOpportunityCounterfactualCandidate[];
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: GreedyRoadOpportunityTrace["moveKind"];
};

function recordConnectivityShadowCounters(
  counters: RoadCounters,
  opportunity: ConnectivityOpportunity
): void {
  counters.connectivityShadowChecks++;
  counters.connectivityShadowLostCells += opportunity.lostCells;
  counters.connectivityShadowFootprintCells += opportunity.footprintCells;
  counters.connectivityShadowDisconnectedCells += opportunity.disconnectedCells;
  counters.connectivityShadowMaxLostCells = Math.max(
    counters.connectivityShadowMaxLostCells,
    opportunity.lostCells
  );
  counters.connectivityShadowMaxDisconnectedCells = Math.max(
    counters.connectivityShadowMaxDisconnectedCells,
    opportunity.disconnectedCells
  );
}

function recordRoadOpportunityCounters(
  counters: RoadCounters,
  opportunity: ConnectivityOpportunity
): void {
  counters.roadOpportunityChecks++;
  counters.roadOpportunityLostCells += opportunity.lostCells;
  counters.roadOpportunityFootprintCells += opportunity.footprintCells;
  counters.roadOpportunityDisconnectedCells += opportunity.disconnectedCells;
  counters.roadOpportunityMaxLostCells = Math.max(
    counters.roadOpportunityMaxLostCells,
    opportunity.lostCells
  );
  counters.roadOpportunityMaxDisconnectedCells = Math.max(
    counters.roadOpportunityMaxDisconnectedCells,
    opportunity.disconnectedCells
  );
}

export function createRoadOpportunityRecorder(enabled: boolean): {
  traces: GreedyRoadOpportunityTrace[] | undefined;
  recordRoadOpportunity: RoadOpportunityRecorder | undefined;
} {
  if (!enabled) {
    return {
      traces: undefined,
      recordRoadOpportunity: undefined,
    };
  }

  const traces: GreedyRoadOpportunityTrace[] = [];
  const constructiveTraceLimit = Math.max(0, ROAD_OPPORTUNITY_TRACE_LIMIT - ROAD_OPPORTUNITY_LOCAL_SEARCH_TRACE_RESERVE);
  const record = ((trace: GreedyRoadOpportunityTrace) => {
    if (!isLocalSearchRoadOpportunityPhase(trace.phase) && constructiveTraceCount(traces) >= constructiveTraceLimit) {
      return;
    }
    if (traces.length < ROAD_OPPORTUNITY_TRACE_LIMIT) {
      traces.push(trace);
    }
  }) as RoadOpportunityRecorder;
  record.remaining = () => Math.max(0, ROAD_OPPORTUNITY_TRACE_LIMIT - traces.length);
  record.remainingForPhase = (phase: GreedyRoadOpportunityTrace["phase"]) => {
    const globalRemaining = Math.max(0, ROAD_OPPORTUNITY_TRACE_LIMIT - traces.length);
    if (isLocalSearchRoadOpportunityPhase(phase)) return globalRemaining;
    return Math.min(
      globalRemaining,
      Math.max(0, constructiveTraceLimit - constructiveTraceCount(traces))
    );
  };
  return {
    traces,
    recordRoadOpportunity: record,
  };
}

function isLocalSearchRoadOpportunityPhase(phase: GreedyRoadOpportunityTrace["phase"]): boolean {
  return phase === "residential-local-search" || phase === "service-neighborhood";
}

function constructiveTraceCount(traces: readonly GreedyRoadOpportunityTrace[]): number {
  let count = 0;
  for (const trace of traces) {
    if (!isLocalSearchRoadOpportunityPhase(trace.phase)) count++;
  }
  return count;
}

export function roadOpportunityHasTraceCapacity(
  record?: RoadOpportunityRecorder,
  phase?: GreedyRoadOpportunityTrace["phase"]
): boolean {
  if (!record) return false;
  return phase ? record.remainingForPhase(phase) > 0 : record.remaining() > 0;
}

function shouldMeasureRoadOpportunity(options: {
  profileCounters?: GreedyProfileCounters;
  record?: RoadOpportunityRecorder;
  phase: GreedyRoadOpportunityTrace["phase"];
}): boolean {
  return Boolean(options.profileCounters) || roadOpportunityHasTraceCapacity(options.record, options.phase);
}

function buildCounterfactualTraceFromOpportunity(options: {
  chosenRoadCost: number;
  chosenScore: number;
  candidate: RoadOpportunityCounterfactualCandidate;
  opportunity: ConnectivityOpportunity;
}): GreedyRoadOpportunityCounterfactualTrace {
  const { chosenRoadCost, chosenScore, candidate, opportunity } = options;
  return {
    reason: candidate.reason,
    r: candidate.placement.r,
    c: candidate.placement.c,
    rows: candidate.placement.rows,
    cols: candidate.placement.cols,
    roadCost: candidate.probe.roadCost,
    score: candidate.score,
    scoreDelta: candidate.score - chosenScore,
    roadCostDelta: candidate.probe.roadCost - chosenRoadCost,
    reachableBefore: opportunity.reachableBefore,
    reachableAfter: opportunity.reachableAfter,
    lostCells: opportunity.lostCells,
    footprintCells: opportunity.footprintCells,
    disconnectedCells: opportunity.disconnectedCells,
    ...(candidate.tieBreakComparison === undefined ? {} : { tieBreakComparison: candidate.tieBreakComparison }),
    ...(candidate.typeIndex === undefined ? {} : { typeIndex: candidate.typeIndex }),
    ...(candidate.bonus === undefined ? {} : { bonus: candidate.bonus }),
    ...(candidate.range === undefined ? {} : { range: candidate.range }),
    ...(candidate.moveKind === undefined ? {} : { moveKind: candidate.moveKind }),
  };
}

function recordMeasuredRoadOpportunity(options: RecordRoadOpportunityBaseOptions & {
  opportunity: ConnectivityOpportunity;
  measureCounterfactual: (candidate: RoadOpportunityCounterfactualCandidate) => ConnectivityOpportunity;
}): void {
  if (!options.profileCounters && !options.record) return;

  const counters = options.profileCounters?.roads;
  if (counters) {
    recordConnectivityShadowCounters(counters, options.opportunity);
    recordRoadOpportunityCounters(counters, options.opportunity);
  }

  const counterfactuals =
    options.record
    && options.score !== undefined
    && options.counterfactuals?.length
    && roadOpportunityHasTraceCapacity(options.record, options.phase)
      ? options.counterfactuals
          .slice(0, ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT)
          .map((candidate) => buildCounterfactualTraceFromOpportunity({
            chosenRoadCost: options.probe.roadCost,
            chosenScore: options.score!,
            candidate,
            opportunity: options.measureCounterfactual(candidate),
          }))
      : undefined;

  options.record?.({
    phase: options.phase,
    r: options.placement.r,
    c: options.placement.c,
    rows: options.placement.rows,
    cols: options.placement.cols,
    roadCost: options.probe.roadCost,
    ...(options.score === undefined ? {} : { score: options.score }),
    reachableBefore: options.opportunity.reachableBefore,
    reachableAfter: options.opportunity.reachableAfter,
    lostCells: options.opportunity.lostCells,
    footprintCells: options.opportunity.footprintCells,
    disconnectedCells: options.opportunity.disconnectedCells,
    ...(options.typeIndex === undefined ? {} : { typeIndex: options.typeIndex }),
    ...(options.bonus === undefined ? {} : { bonus: options.bonus }),
    ...(options.range === undefined ? {} : { range: options.range }),
    ...(options.moveKind === undefined ? {} : { moveKind: options.moveKind }),
    ...(counterfactuals?.length ? { counterfactuals } : {}),
  });
}

export function recordRoadOpportunityPlacement(options: RecordRoadOpportunityBaseOptions & {
  attemptState: GreedyAttemptState;
  footprintKeys?: readonly string[];
}): void {
  if (!shouldMeasureRoadOpportunity(options)) return;

  recordMeasuredRoadOpportunity({
    ...options,
    opportunity: options.attemptState.measureConnectivityShadow(options.placement, options.footprintKeys),
    measureCounterfactual: (candidate) =>
      options.attemptState.measureConnectivityShadow(candidate.placement, candidate.footprintKeys),
  });
}

export function recordRoadOpportunityPlacementFromOccupiedBuildings(options: RecordRoadOpportunityBaseOptions & {
  grid: Grid;
  occupiedBuildings: Set<string>;
  footprintKeys?: readonly string[];
}): void {
  if (!shouldMeasureRoadOpportunity(options)) return;

  recordMeasuredRoadOpportunity({
    ...options,
    opportunity: measureBuildingConnectivityShadow(
      options.grid,
      options.occupiedBuildings,
      options.placement,
      options.footprintKeys
    ),
    measureCounterfactual: (candidate) =>
      measureBuildingConnectivityShadow(
        options.grid,
        candidate.occupiedBuildings ?? options.occupiedBuildings,
        candidate.placement,
        candidate.footprintKeys
      ),
  });
}
