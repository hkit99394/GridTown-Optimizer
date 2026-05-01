import type {
  Grid,
  GreedyProfileCounters,
  ServiceCandidate,
  ServicePlacement,
  SolverParams,
} from "../../core/index.js";
import {
  applyRoadConnectionProbe,
  createRoadProbeScratch,
  overlaps,
} from "../../core/index.js";
import {
  collectNewlyOccupiedKeysForPlacement,
  GreedyAttemptState,
  probeExplicitRoadConnection,
} from "./attemptState.js";
import type { ConnectivityProbe, RoadConnectionProbe } from "./attemptState.js";
import {
  canUseConnectivityShadowTieBreak,
  compareConnectivityShadowPenalty,
  computeConnectivityShadowPenalty,
  recordConnectivityShadowTieDecision,
  servicePlacementTrace,
} from "./connectivityShadowScoring.js";
import type { ConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import {
  recordRoadOpportunityPlacement,
  roadOpportunityHasTraceCapacity,
} from "./roadOpportunity.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import {
  collectIndexedCandidatesForCells,
  createActiveCandidatePool,
  invalidateCandidatePoolEntries,
  mapGlobalCandidateIndicesToLocal,
  markServiceCandidatesDirty,
} from "./candidatePools.js";
import {
  compareResidentialTieBreaks,
  compareServiceTieBreaks,
  getCandidateTypeIndex,
  materializeServicePlacement,
  serviceCandidateKey,
} from "./candidates.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import {
  compareDensityAwareScore,
  computePlacementDensityScore,
} from "./solutionRanking.js";
import { placementLeavesRoadAnchorCellAvailable } from "./roadAnchors.js";
import {
  createRoadOpportunityCandidatePools,
  pushRoadOpportunityCandidate,
  selectRoadOpportunityCounterfactuals,
} from "./roadOpportunityCandidates.js";
import type { RoadOpportunityCandidatePools } from "./roadOpportunityCandidates.js";
import { overlapsCachedFootprint } from "./placementUtils.js";
import {
  collectServiceCandidatesForResidentialGroups,
  computeResidentialPopulation,
  computeServiceMarginalScore,
  getCachedServiceEffectZoneSet,
  getCachedServiceFootprintKeys,
} from "./serviceScoring.js";
import type {
  GreedyPrecomputedIndexes,
  MaybeStop,
  ResidentialScoringGroup,
} from "./types.js";

const SERVICE_LOOKAHEAD = {
  residentialDepth: 2,
};

type ServiceLookaheadCandidate = {
  service: ServiceCandidate;
  candidateIndex: number;
  score: number;
  probe: ConnectivityProbe;
};

type ServiceLookaheadEvaluation = {
  totalScore: number;
  refillScore: number;
};

interface ServiceLookaheadEvaluatorState {
  grid: Grid;
  params: SolverParams;
  roads: Set<string>;
  occupied: Set<string>;
  effectZones: Set<string>[];
  serviceBonuses: number[];
  maxResidentials: number | undefined;
  useTypes: boolean;
  remainingAvail: number[] | null;
  anyResidentialCandidates: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  profileCounters?: GreedyProfileCounters;
  maybeStop?: MaybeStop;
}

function compareServiceLookaheadCandidates(
  left: ServiceLookaheadCandidate,
  right: ServiceLookaheadCandidate
): number {
  if (left.score !== right.score) return right.score - left.score;
  return compareServiceTieBreaks(left.service, left.probe, right.service, right.probe);
}

function pushBoundedServiceLookaheadCandidate(
  shortlist: ServiceLookaheadCandidate[],
  limit: number,
  entry: ServiceLookaheadCandidate
): void {
  if (limit <= 0 || entry.score <= 0) return;
  shortlist.push(entry);
  shortlist.sort(compareServiceLookaheadCandidates);
  if (shortlist.length > limit) shortlist.length = limit;
}

function compareServiceLookaheadEvaluations(
  leftEntry: ServiceLookaheadCandidate,
  left: ServiceLookaheadEvaluation,
  rightEntry: ServiceLookaheadCandidate,
  right: ServiceLookaheadEvaluation
): number {
  if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
  if (left.refillScore !== right.refillScore) return right.refillScore - left.refillScore;
  if (leftEntry.score !== rightEntry.score) return rightEntry.score - leftEntry.score;
  return compareServiceTieBreaks(leftEntry.service, leftEntry.probe, rightEntry.service, rightEntry.probe);
}

function createServiceLookaheadEvaluator(
  state: ServiceLookaheadEvaluatorState
): (entry: ServiceLookaheadCandidate) => ServiceLookaheadEvaluation {
  const lookaheadRoadProbeScratch = createRoadProbeScratch(state.grid);
  return (entry) => {
    const {
      grid: G,
      params,
      roads,
      occupied,
      effectZones,
      serviceBonuses,
      maxResidentials,
      useTypes,
      remainingAvail,
      anyResidentialCandidates,
      precomputedIndexes,
      profileCounters,
      maybeStop,
    } = state;
    if (entry.probe.kind !== "explicit") {
      return {
        totalScore: entry.score,
        refillScore: 0,
      };
    }
    if (profileCounters) profileCounters.servicePhase.lookaheadEvaluations++;

    const roadsScratch = new Set(roads);
    const occupiedScratch = new Set(occupied);
    const placement = materializeServicePlacement(entry.service);
    const footprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, entry.service);
    const newlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
      occupiedScratch,
      entry.probe.roadProbe,
      placement,
      footprintKeys
    );
    applyRoadConnectionProbe(roadsScratch, entry.probe.roadProbe);
    for (const key of newlyOccupiedKeys) occupiedScratch.add(key);

    const futureEffectZones = [...effectZones, getCachedServiceEffectZoneSet(G, precomputedIndexes, entry.service)];
    const futureBonuses = [...serviceBonuses, entry.service.bonus];
    const remainingResidentialAvail = useTypes && remainingAvail ? [...remainingAvail] : null;
    const lookaheadDepth = Math.min(
      SERVICE_LOOKAHEAD.residentialDepth,
      maxResidentials ?? SERVICE_LOOKAHEAD.residentialDepth
    );

    let refillScore = 0;
    for (let depth = 0; depth < lookaheadDepth; depth++) {
      maybeStop?.();
      let bestResidential: ResidentialCandidatesList[0] | null = null;
      let bestResidentialIndex = -1;
      let bestResidentialProbe: RoadConnectionProbe | null = null;
      let bestResidentialPop = -1;

      for (let candidateIndex = 0; candidateIndex < anyResidentialCandidates.length; candidateIndex++) {
        maybeStop?.();
        const candidate = anyResidentialCandidates[candidateIndex];
        if (profileCounters) profileCounters.servicePhase.lookaheadResidentialScans++;
        const candidateTypeIndex = getCandidateTypeIndex(candidate);
        if (remainingResidentialAvail && candidateTypeIndex >= 0 && remainingResidentialAvail[candidateTypeIndex] <= 0) {
          continue;
        }
        if (roadsScratch.size === 0) {
          if (profileCounters) profileCounters.roads.roadAnchorChecks++;
          if (!placementLeavesRoadAnchorCellAvailable(G, occupiedScratch, candidate.r, candidate.c, candidate.rows, candidate.cols)) {
            continue;
          }
        }
        const candidateFootprintKeys = precomputedIndexes.residentialCandidateFootprintKeys[candidateIndex];
        if (
          candidateFootprintKeys
            ? overlapsCachedFootprint(occupiedScratch, candidateFootprintKeys)
            : overlaps(occupiedScratch, candidate.r, candidate.c, candidate.rows, candidate.cols)
        ) {
          continue;
        }
        const probe = probeExplicitRoadConnection(
          G,
          roadsScratch,
          occupiedScratch,
          candidate,
          lookaheadRoadProbeScratch,
          profileCounters
        );
        if (!probe) continue;
        const pop = computeResidentialPopulation(
          params,
          candidate,
          futureEffectZones,
          futureBonuses,
          candidateTypeIndex
        );
        if (
          pop > bestResidentialPop
          || (pop === bestResidentialPop && pop >= 0 && bestResidential !== null && bestResidentialProbe !== null
            && compareResidentialTieBreaks(params, candidate, probe, bestResidential, bestResidentialProbe) < 0)
        ) {
          bestResidential = candidate;
          bestResidentialIndex = candidateIndex;
          bestResidentialPop = pop;
          bestResidentialProbe = probe;
        }
      }

      if (!bestResidential || bestResidentialIndex < 0 || bestResidentialPop <= 0 || !bestResidentialProbe) break;

      const candidateFootprintKeys =
        precomputedIndexes.residentialCandidateFootprintKeys[bestResidentialIndex];
      const residentialNewlyOccupiedKeys = collectNewlyOccupiedKeysForPlacement(
        occupiedScratch,
        bestResidentialProbe,
        bestResidential,
        candidateFootprintKeys
      );
      applyRoadConnectionProbe(roadsScratch, bestResidentialProbe);
      for (const key of residentialNewlyOccupiedKeys) occupiedScratch.add(key);
      const candidateTypeIndex = getCandidateTypeIndex(bestResidential);
      if (remainingResidentialAvail && candidateTypeIndex >= 0) {
        remainingResidentialAvail[candidateTypeIndex] -= 1;
      }
      refillScore += bestResidentialPop;
    }

    return {
      totalScore: entry.score + refillScore,
      refillScore,
    };
  };
}

export interface GreedyServiceConstructionResult {
  services: ServicePlacement[];
  serviceTypeIndices: number[];
  serviceBonuses: number[];
  effectZones: Set<string>[];
}

export interface GreedyServiceConstructionOptions {
  G: Grid;
  params: SolverParams;
  attemptState: GreedyAttemptState;
  roads: Set<string>;
  occupied: Set<string>;
  useDeferredRoadCommitment: boolean;
  serviceOrder: ServiceCandidate[];
  fixedServices?: ServiceCandidate[];
  maxServices: number | undefined;
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  anyResidentialCandidates: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  maxResidentials: number | undefined;
  useServiceTypes: boolean;
  useTypes: boolean;
  remainingServiceAvail: number[] | null;
  remainingAvail: number[] | null;
  densityTieBreaker: boolean;
  densityTieBreakerToleranceRatio: number;
  connectivityShadowScoring: boolean;
  serviceLookaheadCandidates: number;
  profileCounters?: GreedyProfileCounters;
  recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  maybeStop: MaybeStop;
}

interface GreedyServiceConstructionState {
  services: ServicePlacement[];
  serviceTypeIndices: number[];
  serviceBonuses: number[];
  effectZones: Set<string>[];
  currentResidentialGroupBoosts: number[];
}

interface GreedyServiceConstructionTelemetry {
  profileCounters?: GreedyProfileCounters;
  recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
  recordRoadOpportunity?: RoadOpportunityRecorder;
}

type ServiceRoadProbe = (
  snapshotOccupied: Set<string>,
  r: number,
  c: number,
  rows: number,
  cols: number
) => ConnectivityProbe | null;

interface GreedyServiceConstructionContext extends GreedyServiceConstructionOptions {
  state: GreedyServiceConstructionState;
  serviceSource: ServiceCandidate[];
  telemetry: GreedyServiceConstructionTelemetry;
  probeRoadConnection: ServiceRoadProbe;
}

interface GreedyServicePlacementStrategy {
  construct(): boolean;
}

type GreedyActiveCandidatePool = ReturnType<typeof createActiveCandidatePool>;

interface DynamicGreedyServiceCandidatePoolState {
  activePool: GreedyActiveCandidatePool;
  scoreCache: number[];
  scoreDirty: boolean[];
  orderGlobalCandidateIndices: number[];
  globalToLocalCandidateIndices: number[];
}

interface DynamicGreedyServiceChoice {
  candidate: ServiceCandidate;
  candidateIndex: number;
  probe: ConnectivityProbe;
  score: number;
  roadOpportunityPools: RoadOpportunityCandidatePools<ServiceCandidate> | null;
  lookaheadDisplacedCandidateIndex: number;
}

type ServiceLookaheadEvaluator = (entry: ServiceLookaheadCandidate) => ServiceLookaheadEvaluation;

function createGreedyServiceConstructionState(groupCount: number): GreedyServiceConstructionState {
  return {
    services: [],
    serviceTypeIndices: [],
    serviceBonuses: [],
    effectZones: [],
    currentResidentialGroupBoosts: Array.from({ length: groupCount }, () => 0),
  };
}

function appendConstructedGreedyService(
  context: GreedyServiceConstructionContext,
  service: ServiceCandidate,
  placement: ServicePlacement
): number[] {
  const {
    G,
    precomputedIndexes,
    serviceCoverageGroupsByKey,
    state,
  } = context;
  state.services.push(placement);
  state.serviceTypeIndices.push(service.typeIndex);
  state.serviceBonuses.push(service.bonus);
  state.effectZones.push(getCachedServiceEffectZoneSet(G, precomputedIndexes, service));
  const coveredGroupIndices = serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? [];
  for (const groupIndex of coveredGroupIndices) {
    state.currentResidentialGroupBoosts[groupIndex] += service.bonus;
  }
  return coveredGroupIndices;
}

class FixedGreedyServicePlacementStrategy implements GreedyServicePlacementStrategy {
  constructor(private readonly context: GreedyServiceConstructionContext) {}

  construct(): boolean {
    const {
      G,
      attemptState,
      roads,
      occupied,
      serviceSource,
      maxServices,
      precomputedIndexes,
      useServiceTypes,
      remainingServiceAvail,
      maybeStop,
      probeRoadConnection,
      state,
    } = this.context;
    const { profileCounters, recordRoadOpportunity } = this.context.telemetry;
    for (const service of serviceSource) {
      maybeStop?.();
      if (maxServices !== undefined && state.services.length >= maxServices) break;
      if (profileCounters) profileCounters.servicePhase.fixedPlacements++;
      const placement = materializeServicePlacement(service);
      const cachedFootprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, service);
      if (useServiceTypes && remainingServiceAvail && remainingServiceAvail[service.typeIndex] <= 0) {
        return false;
      }
      if (roads.size === 0 && !placementLeavesRoadAnchorCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return false;
      }
      if (overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols)) {
        return false;
      }
      if (profileCounters) profileCounters.servicePhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, placement.r, placement.c, placement.rows, placement.cols);
      if (!probe || probe.kind !== "explicit") {
        return false;
      }
      recordRoadOpportunityPlacement({
        attemptState,
        placement,
        probe,
        phase: "service",
        footprintKeys: cachedFootprintKeys,
        profileCounters,
        record: recordRoadOpportunity,
        typeIndex: service.typeIndex,
        bonus: service.bonus,
        range: service.range,
      });
      attemptState.commitExplicitPlacement({
        probe: probe.roadProbe,
        placement,
        footprintKeys: cachedFootprintKeys,
        countProbeReuse: false,
        recordConnectivityShadow: false,
      });
      appendConstructedGreedyService(this.context, service, placement);
      if (useServiceTypes && remainingServiceAvail) remainingServiceAvail[service.typeIndex]--;
      if (profileCounters) profileCounters.servicePhase.placements++;
    }
    return true;
  }
}

class DynamicGreedyServicePlacementStrategy implements GreedyServicePlacementStrategy {
  constructor(private readonly context: GreedyServiceConstructionContext) {}

  construct(): boolean {
    const {
      maxServices,
      maybeStop,
      state,
    } = this.context;
    const poolState = this.createCandidatePoolState();
    const evaluateServiceLookahead = this.createLookaheadEvaluator();
    for (;;) {
      maybeStop?.();
      if (maxServices !== undefined && state.services.length >= maxServices) break;
      const choice = this.chooseNextPlacement(poolState, evaluateServiceLookahead);
      if (!choice) break;
      if (!this.commitChoice(choice, poolState)) break;
    }
    return true;
  }

  private createCandidatePoolState(): DynamicGreedyServiceCandidatePoolState {
    const {
      serviceOrder,
      serviceSource,
      occupied,
      precomputedIndexes,
      useServiceTypes,
      remainingServiceAvail,
    } = this.context;
    const orderGlobalCandidateIndices = serviceSource.map(
      (candidate) => precomputedIndexes.serviceCandidateIndicesByKey.get(serviceCandidateKey(candidate)) ?? -1
    );
    const globalToLocalCandidateIndices = Array.from({ length: serviceOrder.length }, () => -1);
    for (let localIndex = 0; localIndex < orderGlobalCandidateIndices.length; localIndex++) {
      const globalIndex = orderGlobalCandidateIndices[localIndex];
      if (globalIndex >= 0) {
        globalToLocalCandidateIndices[globalIndex] = localIndex;
      }
    }
    const poolState: DynamicGreedyServiceCandidatePoolState = {
      activePool: createActiveCandidatePool(serviceSource.length),
      scoreCache: Array.from({ length: serviceSource.length }, () => 0),
      scoreDirty: Array.from({ length: serviceSource.length }, () => true),
      orderGlobalCandidateIndices,
      globalToLocalCandidateIndices,
    };
    if (occupied.size > 0) {
      this.invalidateGlobalCandidates(
        poolState,
        collectIndexedCandidatesForCells(occupied, precomputedIndexes.serviceCandidatesByOccupiedCell)
      );
    }
    if (useServiceTypes && remainingServiceAvail && precomputedIndexes.serviceCandidateIndicesByType) {
      for (let typeIndex = 0; typeIndex < remainingServiceAvail.length; typeIndex++) {
        if (remainingServiceAvail[typeIndex] > 0) continue;
        this.invalidateGlobalCandidates(
          poolState,
          precomputedIndexes.serviceCandidateIndicesByType[typeIndex] ?? [],
          true
        );
      }
    }
    return poolState;
  }

  private createLookaheadEvaluator(): ServiceLookaheadEvaluator {
    const {
      G,
      params,
      roads,
      occupied,
      maxResidentials,
      useTypes,
      remainingAvail,
      anyResidentialCandidates,
      precomputedIndexes,
      maybeStop,
      state,
    } = this.context;
    const { profileCounters } = this.context.telemetry;
    return createServiceLookaheadEvaluator({
      grid: G,
      params,
      roads,
      occupied,
      effectZones: state.effectZones,
      serviceBonuses: state.serviceBonuses,
      maxResidentials,
      useTypes,
      remainingAvail,
      anyResidentialCandidates,
      precomputedIndexes,
      profileCounters,
      maybeStop,
    });
  }

  private isLookaheadEnabled(): boolean {
    const {
      useDeferredRoadCommitment,
      maxResidentials,
      anyResidentialCandidates,
      residentialScoringGroups,
      serviceLookaheadCandidates,
    } = this.context;
    return serviceLookaheadCandidates > 1
      && !useDeferredRoadCommitment
      && (maxResidentials === undefined || maxResidentials > 0)
      && anyResidentialCandidates.length > 0
      && residentialScoringGroups.length > 0;
  }

  private chooseNextPlacement(
    poolState: DynamicGreedyServiceCandidatePoolState,
    evaluateServiceLookahead: ServiceLookaheadEvaluator
  ): DynamicGreedyServiceChoice | null {
    const {
      G,
      attemptState,
      roads,
      occupied,
      serviceSource,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      precomputedIndexes,
      useServiceTypes,
      remainingServiceAvail,
      remainingAvail,
      densityTieBreaker,
      densityTieBreakerToleranceRatio,
      connectivityShadowScoring,
      serviceLookaheadCandidates,
      maybeStop,
      probeRoadConnection,
      state,
    } = this.context;
    const {
      profileCounters,
      recordConnectivityShadowDecision,
      recordRoadOpportunity,
    } = this.context.telemetry;
    const enableServiceLookahead = this.isLookaheadEnabled();
    let bestCandidate: ServiceCandidate | null = null;
    let bestCandidateIndex = -1;
    let bestProbe: ConnectivityProbe | null = null;
    let bestScore = 0;
    let bestDensityScore = Number.NEGATIVE_INFINITY;
    let bestConnectivityShadowPenalty: number | null = null;
    const lookaheadShortlist: ServiceLookaheadCandidate[] = [];
    const collectRoadOpportunityCounterfactuals = roadOpportunityHasTraceCapacity(recordRoadOpportunity, "service");
    const serviceRoadOpportunityPools = collectRoadOpportunityCounterfactuals
      ? createRoadOpportunityCandidatePools<ServiceCandidate>()
      : null;

    for (const candidateIndex of poolState.activePool.activeIndices) {
      maybeStop?.();
      if (profileCounters) profileCounters.servicePhase.candidateScans++;
      const service = serviceSource[candidateIndex];
      const globalCandidateIndex = poolState.orderGlobalCandidateIndices[candidateIndex] ?? -1;
      if (globalCandidateIndex < 0) continue;
      const placement = materializeServicePlacement(service);
      if (useServiceTypes && remainingServiceAvail && remainingServiceAvail[service.typeIndex] <= 0) continue;
      if (roads.size === 0) {
        if (profileCounters) profileCounters.roads.roadAnchorChecks++;
        if (!placementLeavesRoadAnchorCellAvailable(G, occupied, placement.r, placement.c, placement.rows, placement.cols)) continue;
      }
      if (profileCounters) profileCounters.servicePhase.canConnectChecks++;
      const probe = probeRoadConnection(occupied, placement.r, placement.c, placement.rows, placement.cols);
      if (!probe) continue;
      if (poolState.scoreDirty[candidateIndex]) {
        poolState.scoreCache[candidateIndex] = computeServiceMarginalScore(
          service,
          occupied,
          state.currentResidentialGroupBoosts,
          residentialScoringGroups,
          serviceCoverageGroupsByKey,
          remainingAvail,
          profileCounters
        );
        poolState.scoreDirty[candidateIndex] = false;
        if (profileCounters) profileCounters.servicePhase.scoreRecomputes++;
      }
      const score = poolState.scoreCache[candidateIndex] ?? 0;
      const densityScore = densityTieBreaker
        ? computePlacementDensityScore(G, service, score)
        : 0;
      const serviceFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[globalCandidateIndex];
      if (serviceRoadOpportunityPools && score > 0) {
        pushRoadOpportunityCandidate(serviceRoadOpportunityPools, {
          key: serviceCandidateKey(service),
          candidate: service,
          candidateIndex,
          placement,
          probe,
          footprintKeys: serviceFootprintKeys,
          score,
          typeIndex: service.typeIndex,
          bonus: service.bonus,
          range: service.range,
        });
      }
      if (enableServiceLookahead) {
        pushBoundedServiceLookaheadCandidate(
          lookaheadShortlist,
          serviceLookaheadCandidates,
          {
            service,
            candidateIndex,
            score,
            probe,
          }
        );
      }
      const scoreComparison = bestCandidate === null
        ? (score > 0 ? 1 : -1)
        : compareDensityAwareScore(
            score,
            densityScore,
            bestScore,
            bestDensityScore,
            densityTieBreakerToleranceRatio
          );
      let candidateConnectivityShadowPenalty: number | null = null;
      let connectivityShadowComparison = 0;
      if (
        scoreComparison === 0
        && score > 0
        && connectivityShadowScoring
        && bestCandidate !== null
        && bestProbe !== null
        && canUseConnectivityShadowTieBreak(probe, bestProbe)
      ) {
        candidateConnectivityShadowPenalty = computeConnectivityShadowPenalty(
          attemptState,
          placement,
          serviceFootprintKeys
        );
        if (bestConnectivityShadowPenalty === null) {
          const bestGlobalCandidateIndex = poolState.orderGlobalCandidateIndices[bestCandidateIndex] ?? -1;
          const bestFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[bestGlobalCandidateIndex];
          bestConnectivityShadowPenalty = computeConnectivityShadowPenalty(
            attemptState,
            materializeServicePlacement(bestCandidate),
            bestFootprintKeys
          );
        }
        connectivityShadowComparison = compareConnectivityShadowPenalty(
          candidateConnectivityShadowPenalty,
          bestConnectivityShadowPenalty
        );
        recordConnectivityShadowTieDecision({
          record: recordConnectivityShadowDecision,
          profileCounters,
          phase: "service",
          score,
          candidate: servicePlacementTrace(service, probe),
          incumbent: servicePlacementTrace(bestCandidate, bestProbe),
          candidateShadowPenalty: candidateConnectivityShadowPenalty,
          incumbentShadowPenalty: bestConnectivityShadowPenalty,
          comparison: connectivityShadowComparison,
        });
      }
      if (
        scoreComparison > 0
        || connectivityShadowComparison > 0
        || (scoreComparison === 0 && connectivityShadowComparison === 0 && score > 0 && bestCandidate !== null
          && bestProbe !== null
          && compareServiceTieBreaks(service, probe, bestCandidate, bestProbe) < 0)
      ) {
        bestCandidate = service;
        bestCandidateIndex = candidateIndex;
        bestScore = score;
        bestDensityScore = densityScore;
        bestConnectivityShadowPenalty = connectivityShadowComparison !== 0
          ? candidateConnectivityShadowPenalty
          : null;
        bestProbe = probe;
      }
    }

    let lookaheadDisplacedCandidateIndex = -1;
    const preLookaheadBestCandidateIndex = bestCandidateIndex;
    if (
      enableServiceLookahead
      && lookaheadShortlist.length > 1
      && bestCandidate !== null
      && bestProbe !== null
    ) {
      let lookaheadBestEntry = lookaheadShortlist[0]!;
      let lookaheadBestEvaluation = evaluateServiceLookahead(lookaheadBestEntry);
      for (const entry of lookaheadShortlist.slice(1)) {
        const evaluation = evaluateServiceLookahead(entry);
        if (
          compareServiceLookaheadEvaluations(
            entry,
            evaluation,
            lookaheadBestEntry,
            lookaheadBestEvaluation
          ) < 0
        ) {
          lookaheadBestEntry = entry;
          lookaheadBestEvaluation = evaluation;
        }
      }
      if (lookaheadBestEntry.candidateIndex !== bestCandidateIndex) {
        bestCandidate = lookaheadBestEntry.service;
        bestCandidateIndex = lookaheadBestEntry.candidateIndex;
        bestProbe = lookaheadBestEntry.probe;
        bestScore = lookaheadBestEntry.score;
        lookaheadDisplacedCandidateIndex = preLookaheadBestCandidateIndex;
        if (profileCounters) profileCounters.servicePhase.lookaheadWins++;
      }
    }

    if (!bestCandidate || bestCandidateIndex < 0 || bestScore <= 0 || !bestProbe) return null;
    return {
      candidate: bestCandidate,
      candidateIndex: bestCandidateIndex,
      probe: bestProbe,
      score: bestScore,
      roadOpportunityPools: serviceRoadOpportunityPools,
      lookaheadDisplacedCandidateIndex,
    };
  }

  private commitChoice(
    choice: DynamicGreedyServiceChoice,
    poolState: DynamicGreedyServiceCandidatePoolState
  ): boolean {
    const {
      attemptState,
      useDeferredRoadCommitment,
      precomputedIndexes,
    } = this.context;
    const { profileCounters, recordRoadOpportunity } = this.context.telemetry;
    const placement = materializeServicePlacement(choice.candidate);
    const globalCandidateIndex = poolState.orderGlobalCandidateIndices[choice.candidateIndex] ?? -1;
    const cachedFootprintKeys = precomputedIndexes.serviceFootprintKeysByCandidate[globalCandidateIndex];
    const newlyOccupiedKeys = attemptState.collectNewlyOccupiedKeys(
      useDeferredRoadCommitment ? null : choice.probe.kind === "explicit" ? choice.probe.roadProbe : null,
      placement,
      cachedFootprintKeys
    );
    const counterfactuals = choice.roadOpportunityPools
      ? selectRoadOpportunityCounterfactuals({
          pools: choice.roadOpportunityPools,
          chosenKey: serviceCandidateKey(choice.candidate),
          chosenCandidate: choice.candidate,
          chosenProbe: choice.probe,
          chosenScore: choice.score,
          compareTieBreaks: compareServiceTieBreaks,
          isLookaheadDisplaced: (entry) => entry.candidateIndex === choice.lookaheadDisplacedCandidateIndex,
        })
      : undefined;
    recordRoadOpportunityPlacement({
      attemptState,
      placement,
      probe: choice.probe,
      phase: "service",
      footprintKeys: cachedFootprintKeys,
      profileCounters,
      record: recordRoadOpportunity,
      score: choice.score,
      counterfactuals,
      typeIndex: choice.candidate.typeIndex,
      bonus: choice.candidate.bonus,
      range: choice.candidate.range,
    });
    const committedKeys = attemptState.commitPlacement(choice.probe, placement, {
      footprintKeys: cachedFootprintKeys,
      newlyOccupiedKeys,
      recordConnectivityShadow: false,
    });
    if (!committedKeys) {
      return false;
    }
    const coveredGroupIndices = appendConstructedGreedyService(this.context, choice.candidate, placement);
    this.invalidateGlobalCandidates(
      poolState,
      collectIndexedCandidatesForCells(newlyOccupiedKeys, precomputedIndexes.serviceCandidatesByOccupiedCell)
    );
    this.markScoresDirty(poolState, newlyOccupiedKeys, coveredGroupIndices);
    this.consumeServiceAvailability(poolState, choice.candidate);
    if (profileCounters) profileCounters.servicePhase.placements++;
    return true;
  }

  private invalidateGlobalCandidates(
    poolState: DynamicGreedyServiceCandidatePoolState,
    globalCandidateIndices: Iterable<number>,
    countTypeInvalidations = false
  ): number {
    const invalidated = invalidateCandidatePoolEntries(
      poolState.activePool,
      mapGlobalCandidateIndicesToLocal(
        globalCandidateIndices,
        poolState.globalToLocalCandidateIndices
      )
    );
    const { profileCounters } = this.context.telemetry;
    if (profileCounters) {
      profileCounters.servicePhase.candidateInvalidations += invalidated;
      if (countTypeInvalidations) profileCounters.servicePhase.typeInvalidations += invalidated;
    }
    return invalidated;
  }

  private markScoresDirty(
    poolState: DynamicGreedyServiceCandidatePoolState,
    newlyOccupiedKeys: Iterable<string>,
    coveredGroupIndices: readonly number[]
  ): void {
    const { precomputedIndexes } = this.context;
    const blockedGroupIndices = collectIndexedCandidatesForCells(
      newlyOccupiedKeys,
      precomputedIndexes.residentialGroupsByOccupiedCell
    );
    const affectedGroupIndices = new Set<number>(coveredGroupIndices);
    for (const groupIndex of blockedGroupIndices) affectedGroupIndices.add(groupIndex);
    const dirtyMarks = markServiceCandidatesDirty(
      mapGlobalCandidateIndicesToLocal(
        collectServiceCandidatesForResidentialGroups(
          affectedGroupIndices,
          precomputedIndexes.serviceCandidateIndicesByResidentialGroup
        ),
        poolState.globalToLocalCandidateIndices
      ),
      poolState.scoreDirty,
      poolState.activePool
    );
    const { profileCounters } = this.context.telemetry;
    if (profileCounters) profileCounters.servicePhase.scoreDirtyMarks += dirtyMarks;
  }

  private consumeServiceAvailability(
    poolState: DynamicGreedyServiceCandidatePoolState,
    service: ServiceCandidate
  ): void {
    const {
      useServiceTypes,
      remainingServiceAvail,
      precomputedIndexes,
    } = this.context;
    if (!useServiceTypes || !remainingServiceAvail) return;
    remainingServiceAvail[service.typeIndex]--;
    if (remainingServiceAvail[service.typeIndex] > 0 || !precomputedIndexes.serviceCandidateIndicesByType) return;
    this.invalidateGlobalCandidates(
      poolState,
      precomputedIndexes.serviceCandidateIndicesByType[service.typeIndex] ?? [],
      true
    );
  }
}

function createGreedyServicePlacementStrategy(
  context: GreedyServiceConstructionContext
): GreedyServicePlacementStrategy {
  return context.fixedServices
    ? new FixedGreedyServicePlacementStrategy(context)
    : new DynamicGreedyServicePlacementStrategy(context);
}

export function constructGreedyServicePhase(options: GreedyServiceConstructionOptions): GreedyServiceConstructionResult | null {
  const state = createGreedyServiceConstructionState(options.residentialScoringGroups.length);
  const context: GreedyServiceConstructionContext = {
    ...options,
    state,
    serviceSource: options.fixedServices ?? options.serviceOrder,
    telemetry: {
      profileCounters: options.profileCounters,
      recordConnectivityShadowDecision: options.recordConnectivityShadowDecision,
      recordRoadOpportunity: options.recordRoadOpportunity,
    },
    probeRoadConnection: (snapshotOccupied, r, c, rows, cols) =>
      options.attemptState.probeRoadConnection(snapshotOccupied, { r, c, rows, cols }),
  };
  const strategy = createGreedyServicePlacementStrategy(context);
  if (!strategy.construct()) return null;
  if (options.fixedServices && state.services.length !== options.fixedServices.length) return null;

  return {
    services: state.services,
    serviceTypeIndices: state.serviceTypeIndices,
    serviceBonuses: state.serviceBonuses,
    effectZones: state.effectZones,
  };
}
