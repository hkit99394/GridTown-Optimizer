import type { GreedyRoadOpportunityCounterfactualReason } from "../../core/index.js";
import type { ConnectivityProbe, PlacementRect } from "./attemptState.js";
import { ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT } from "./roadOpportunity.js";
import type { RoadOpportunityCounterfactualCandidate } from "./roadOpportunity.js";

const ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT = ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT * 4;

export type RoadOpportunityCandidatePoolEntry<TCandidate> = {
  key: string;
  candidate: TCandidate;
  candidateIndex: number;
  placement: PlacementRect;
  probe: ConnectivityProbe;
  footprintKeys?: readonly string[];
  occupiedBuildings?: Set<string>;
  score: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: RoadOpportunityCounterfactualCandidate["moveKind"];
};

export type RoadOpportunityCandidatePools<TCandidate> = {
  score: RoadOpportunityCandidatePoolEntry<TCandidate>[];
  cheapRoad: RoadOpportunityCandidatePoolEntry<TCandidate>[];
};

function compareRoadOpportunityScorePoolEntries<TCandidate>(
  left: RoadOpportunityCandidatePoolEntry<TCandidate>,
  right: RoadOpportunityCandidatePoolEntry<TCandidate>
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.probe.roadCost !== right.probe.roadCost) return left.probe.roadCost - right.probe.roadCost;
  return left.key.localeCompare(right.key);
}

function compareRoadOpportunityCheapPoolEntries<TCandidate>(
  left: RoadOpportunityCandidatePoolEntry<TCandidate>,
  right: RoadOpportunityCandidatePoolEntry<TCandidate>
): number {
  if (left.probe.roadCost !== right.probe.roadCost) return left.probe.roadCost - right.probe.roadCost;
  if (left.score !== right.score) return right.score - left.score;
  return left.key.localeCompare(right.key);
}

function pushBoundedRoadOpportunityCandidate<TCandidate>(
  pool: RoadOpportunityCandidatePoolEntry<TCandidate>[],
  entry: RoadOpportunityCandidatePoolEntry<TCandidate>,
  compare: (
    left: RoadOpportunityCandidatePoolEntry<TCandidate>,
    right: RoadOpportunityCandidatePoolEntry<TCandidate>
  ) => number
): void {
  const existingIndex = pool.findIndex((candidate) => candidate.key === entry.key);
  if (existingIndex >= 0) {
    pool[existingIndex] = entry;
  } else {
    pool.push(entry);
  }
  pool.sort(compare);
  if (pool.length > ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT) {
    pool.length = ROAD_OPPORTUNITY_COUNTERFACTUAL_POOL_LIMIT;
  }
}

export function createRoadOpportunityCandidatePools<TCandidate>(): RoadOpportunityCandidatePools<TCandidate> {
  return { score: [], cheapRoad: [] };
}

export function pushRoadOpportunityCandidate<TCandidate>(
  pools: RoadOpportunityCandidatePools<TCandidate>,
  entry: RoadOpportunityCandidatePoolEntry<TCandidate>
): void {
  pushBoundedRoadOpportunityCandidate(pools.score, entry, compareRoadOpportunityScorePoolEntries);
  pushBoundedRoadOpportunityCandidate(pools.cheapRoad, entry, compareRoadOpportunityCheapPoolEntries);
}

function mergeRoadOpportunityCandidatePools<TCandidate>(
  pools: readonly RoadOpportunityCandidatePoolEntry<TCandidate>[][]
): RoadOpportunityCandidatePoolEntry<TCandidate>[] {
  const byKey = new Map<string, RoadOpportunityCandidatePoolEntry<TCandidate>>();
  for (const pool of pools) {
    for (const entry of pool) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    }
  }
  return [...byKey.values()];
}

function classifyRoadOpportunityCounterfactual(options: {
  candidateScore: number;
  chosenScore: number;
  candidateRoadCost: number;
  chosenRoadCost: number;
  lookaheadDisplaced: boolean;
}): GreedyRoadOpportunityCounterfactualReason | null {
  const { candidateScore, chosenScore, candidateRoadCost, chosenRoadCost, lookaheadDisplaced } = options;
  if (lookaheadDisplaced) return "lookahead-rejected";
  if (candidateScore > chosenScore) return "higher-score-rejected";
  if (candidateScore === chosenScore) return "same-score-tie";

  const scoreWindow = Math.max(1, Math.ceil(Math.max(1, Math.abs(chosenScore)) * 0.1));
  if (candidateScore >= chosenScore - scoreWindow) return "near-score";
  if (candidateRoadCost < chosenRoadCost && candidateScore >= 0) return "lower-road-cost";

  return null;
}

function compareSelectedRoadOpportunityCounterfactuals(
  left: RoadOpportunityCounterfactualCandidate & { key: string },
  right: RoadOpportunityCounterfactualCandidate & { key: string },
  chosenScore: number,
  chosenRoadCost: number
): number {
  const reasonRank: Record<GreedyRoadOpportunityCounterfactualReason, number> = {
    "lookahead-rejected": 0,
    "higher-score-rejected": 1,
    "same-score-tie": 2,
    "near-score": 3,
    "lower-road-cost": 4
  };
  if (reasonRank[left.reason] !== reasonRank[right.reason]) {
    return reasonRank[left.reason] - reasonRank[right.reason];
  }

  const leftScoreDelta = Math.abs(left.score - chosenScore);
  const rightScoreDelta = Math.abs(right.score - chosenScore);
  if (leftScoreDelta !== rightScoreDelta) return leftScoreDelta - rightScoreDelta;

  const leftRoadDelta = Math.abs(left.probe.roadCost - chosenRoadCost);
  const rightRoadDelta = Math.abs(right.probe.roadCost - chosenRoadCost);
  if (leftRoadDelta !== rightRoadDelta) return leftRoadDelta - rightRoadDelta;

  return left.key.localeCompare(right.key);
}

export function selectRoadOpportunityCounterfactuals<TCandidate>(options: {
  pools: RoadOpportunityCandidatePools<TCandidate>;
  chosenKey: string;
  chosenCandidate: TCandidate;
  chosenProbe: ConnectivityProbe;
  chosenScore: number;
  compareTieBreaks: (
    candidate: TCandidate,
    probe: ConnectivityProbe,
    chosen: TCandidate,
    chosenProbe: ConnectivityProbe
  ) => number;
  isLookaheadDisplaced?: (entry: RoadOpportunityCandidatePoolEntry<TCandidate>) => boolean;
}): RoadOpportunityCounterfactualCandidate[] {
  const selected: Array<RoadOpportunityCounterfactualCandidate & { key: string }> = [];
  for (const entry of mergeRoadOpportunityCandidatePools([options.pools.score, options.pools.cheapRoad])) {
    if (entry.key === options.chosenKey) continue;
    const lookaheadDisplaced = options.isLookaheadDisplaced?.(entry) ?? false;
    const reason = classifyRoadOpportunityCounterfactual({
      candidateScore: entry.score,
      chosenScore: options.chosenScore,
      candidateRoadCost: entry.probe.roadCost,
      chosenRoadCost: options.chosenProbe.roadCost,
      lookaheadDisplaced
    });
    if (!reason) continue;
    const tieBreakComparison = options.compareTieBreaks(
      entry.candidate,
      entry.probe,
      options.chosenCandidate,
      options.chosenProbe
    );
    selected.push({
      key: entry.key,
      reason,
      placement: entry.placement,
      probe: entry.probe,
      footprintKeys: entry.footprintKeys,
      occupiedBuildings: entry.occupiedBuildings,
      score: entry.score,
      tieBreakComparison,
      ...(entry.typeIndex === undefined ? {} : { typeIndex: entry.typeIndex }),
      ...(entry.bonus === undefined ? {} : { bonus: entry.bonus }),
      ...(entry.range === undefined ? {} : { range: entry.range }),
      ...(entry.moveKind === undefined ? {} : { moveKind: entry.moveKind })
    });
  }

  selected.sort((left, right) =>
    compareSelectedRoadOpportunityCounterfactuals(left, right, options.chosenScore, options.chosenProbe.roadCost)
  );
  return selected.slice(0, ROAD_OPPORTUNITY_COUNTERFACTUAL_TRACE_LIMIT);
}
