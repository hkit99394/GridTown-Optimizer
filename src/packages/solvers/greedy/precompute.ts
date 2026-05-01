import type {
  Grid,
  GreedyProfileCounters,
  SolverParams,
} from "../../core/index.js";
import {
  buildFootprintGeometryCache,
  buildServiceGeometryCache,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  getResidentialBaseMax,
} from "../../core/index.js";
import {
  buildFootprintCandidateIndexFromKeys,
  buildTypedCandidateIndex,
} from "./candidatePools.js";
import {
  getCandidateTypeIndex,
  serviceCandidateKey,
} from "./candidates.js";
import {
  buildResidentialGroupCellIndex,
  buildResidentialScoringGroups,
  buildServiceCoverageIndex,
  buildServiceCoverageReverseIndex,
  computeServiceStaticScore,
} from "./serviceScoring.js";
import type { ConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import type {
  GreedyCandidateCatalog,
  GreedyGeometryIndexes,
  GreedyPrecomputedIndexes,
  GreedyPreparedInputs,
  GreedyScoringIndexes,
  MaybeStop,
  ResidentialScoringGroup,
} from "./types.js";

function buildGreedyCandidateCatalog(
  G: Grid,
  params: SolverParams,
  options: {
    useTypes: boolean;
    profileCounters?: GreedyProfileCounters;
    maybeStop: MaybeStop;
  }
): GreedyCandidateCatalog {
  const { useTypes, profileCounters, maybeStop } = options;
  maybeStop?.(true);
  const residentialCandidatesLegacy = useTypes ? [] : enumerateResidentialCandidates(G, maybeStop);
  maybeStop?.(true);
  const residentialCandidatesFromTypes = useTypes
    ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes!, maybeStop)
    : [];
  maybeStop?.(true);
  const anyResidentialCandidates = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  const residentialCandidatesForLocal = useTypes ? residentialCandidatesFromTypes : residentialCandidatesLegacy;
  const serviceCandidates = enumerateServiceCandidates(G, params, maybeStop);
  maybeStop?.(true);
  if (profileCounters) profileCounters.precompute.serviceCandidates += serviceCandidates.length;
  const residentialCandidateStats = anyResidentialCandidates.map((residential) => ({
    r: residential.r,
    c: residential.c,
    rows: residential.rows,
    cols: residential.cols,
    typeIndex: getCandidateTypeIndex(residential),
    ...getResidentialBaseMax(params, residential.rows, residential.cols, getCandidateTypeIndex(residential)),
  }));
  maybeStop?.(true);
  if (profileCounters) profileCounters.precompute.residentialCandidates += residentialCandidateStats.length;
  return {
    serviceCandidates,
    anyResidentialCandidates,
    residentialCandidatesForLocal,
    residentialCandidateStats,
  };
}

function buildGreedyGeometryIndexes(
  G: Grid,
  catalog: GreedyCandidateCatalog,
  residentialScoringGroups: ResidentialScoringGroup[],
  options: {
    profileCounters?: GreedyProfileCounters;
    maybeStop: MaybeStop;
  }
): GreedyGeometryIndexes {
  const { profileCounters, maybeStop } = options;
  const { serviceCandidates, anyResidentialCandidates } = catalog;
  const serviceGeometryCache = buildServiceGeometryCache(G, serviceCandidates, maybeStop);
  maybeStop?.(true);
  const serviceEffectZoneSetsByCandidate = serviceGeometryCache.effectZoneKeysByIndex.map((keys) => new Set(keys));
  maybeStop?.(true);
  const residentialCandidateGeometryCache = buildFootprintGeometryCache(anyResidentialCandidates, maybeStop);
  maybeStop?.(true);
  const residentialGroupGeometryCache = buildFootprintGeometryCache(residentialScoringGroups, maybeStop);
  maybeStop?.(true);
  if (profileCounters) {
    profileCounters.precompute.geometryCacheEntries += serviceGeometryCache.footprintKeysByIndex.length;
    profileCounters.precompute.geometryCacheEntries += serviceEffectZoneSetsByCandidate.length;
    profileCounters.precompute.geometryCacheEntries += residentialCandidateGeometryCache.footprintKeysByIndex.length;
    profileCounters.precompute.geometryCacheEntries += residentialGroupGeometryCache.footprintKeysByIndex.length;
  }
  return {
    serviceGeometryCache,
    serviceEffectZoneSetsByCandidate,
    residentialCandidateGeometryCache,
    residentialGroupGeometryCache,
  };
}

function buildGreedyScoringIndexes(
  params: SolverParams,
  catalog: GreedyCandidateCatalog,
  residentialScoringGroups: ResidentialScoringGroup[],
  options: {
    useTypes: boolean;
    profileCounters?: GreedyProfileCounters;
    maybeStop: MaybeStop;
  }
): GreedyScoringIndexes {
  const { useTypes, profileCounters, maybeStop } = options;
  const { serviceCandidates } = catalog;
  const serviceCoverageGroupsByKey = buildServiceCoverageIndex(
    serviceCandidates,
    residentialScoringGroups,
    profileCounters,
    maybeStop
  );
  maybeStop?.(true);
  const initialResidentialAvail = useTypes ? params.residentialTypes!.map((type) => type.avail) : null;
  const initialResidentialGroupBoosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  const serviceScores = new Map<string, number>();
  for (const s of serviceCandidates) {
    maybeStop?.();
    serviceScores.set(
      serviceCandidateKey(s),
      computeServiceStaticScore(
        s,
        initialResidentialGroupBoosts,
        residentialScoringGroups,
        serviceCoverageGroupsByKey,
        initialResidentialAvail,
        profileCounters
      )
    );
  }
  const serviceOrderSorted = [...serviceCandidates].sort(
    (a, b) =>
      (serviceScores.get(serviceCandidateKey(b)) ?? 0) - (serviceScores.get(serviceCandidateKey(a)) ?? 0)
      || serviceCandidateKey(a).localeCompare(serviceCandidateKey(b))
  );
  return {
    residentialScoringGroups,
    serviceCoverageGroupsByKey,
    serviceOrderSorted,
  };
}

function buildGreedyPrecomputedIndexes(
  params: SolverParams,
  catalog: GreedyCandidateCatalog,
  scoring: GreedyScoringIndexes,
  geometry: GreedyGeometryIndexes,
  options: {
    useServiceTypes: boolean;
    useTypes: boolean;
  }
): GreedyPrecomputedIndexes {
  const { useServiceTypes, useTypes } = options;
  const { serviceCandidates, anyResidentialCandidates } = catalog;
  const { residentialScoringGroups, serviceCoverageGroupsByKey } = scoring;
  const {
    serviceGeometryCache,
    serviceEffectZoneSetsByCandidate,
    residentialCandidateGeometryCache,
    residentialGroupGeometryCache,
  } = geometry;
  return {
    serviceCandidateIndicesByKey: new Map(
      serviceCandidates.map((candidate, candidateIndex) => [serviceCandidateKey(candidate), candidateIndex])
    ),
    serviceCandidatesByOccupiedCell: buildFootprintCandidateIndexFromKeys(serviceGeometryCache.footprintKeysByIndex),
    serviceFootprintKeysByCandidate: serviceGeometryCache.footprintKeysByIndex,
    serviceEffectZoneSetsByCandidate: serviceEffectZoneSetsByCandidate,
    residentialGroupsByOccupiedCell: buildResidentialGroupCellIndex(residentialGroupGeometryCache.footprintKeysByIndex),
    serviceCandidateIndicesByResidentialGroup: buildServiceCoverageReverseIndex(
      serviceCandidates,
      serviceCoverageGroupsByKey,
      residentialScoringGroups.length
    ),
    serviceCandidateIndicesByType: useServiceTypes
      ? buildTypedCandidateIndex(
          serviceCandidates.length,
          (candidateIndex) => serviceCandidates[candidateIndex].typeIndex,
          params.serviceTypes!.length
        )
      : null,
    residentialCandidatesByOccupiedCell: buildFootprintCandidateIndexFromKeys(
      residentialCandidateGeometryCache.footprintKeysByIndex
    ),
    residentialCandidateFootprintKeys: residentialCandidateGeometryCache.footprintKeysByIndex,
    residentialCandidateIndicesByType: useTypes
      ? buildTypedCandidateIndex(
          anyResidentialCandidates.length,
          (candidateIndex) => getCandidateTypeIndex(anyResidentialCandidates[candidateIndex]),
          params.residentialTypes!.length
        )
      : null,
  };
}

export function prepareGreedyInputs(
  G: Grid,
  params: SolverParams,
  options: {
    maxResidentials: number | undefined;
    useServiceTypes: boolean;
    useTypes: boolean;
    localSearch: boolean;
    serviceLookaheadCandidates: number;
    profileCounters?: GreedyProfileCounters;
    recordProfilePhase?: GreedyProfilePhaseRecorder;
    recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
    recordRoadOpportunity?: RoadOpportunityRecorder;
    maybeStop: MaybeStop;
  }
): GreedyPreparedInputs {
  const {
    maxResidentials,
    useServiceTypes,
    useTypes,
    localSearch,
    serviceLookaheadCandidates,
    profileCounters,
    recordProfilePhase,
    recordConnectivityShadowDecision,
    recordRoadOpportunity,
    maybeStop,
  } = options;
  const catalog = buildGreedyCandidateCatalog(G, params, {
    useTypes,
    profileCounters,
    maybeStop,
  });
  const residentialScoringGroups = buildResidentialScoringGroups(
    catalog.residentialCandidateStats,
    profileCounters,
    maybeStop
  );
  maybeStop?.(true);
  const geometry = buildGreedyGeometryIndexes(G, catalog, residentialScoringGroups, {
    profileCounters,
    maybeStop,
  });
  const scoring = buildGreedyScoringIndexes(params, catalog, residentialScoringGroups, {
    useTypes,
    profileCounters,
    maybeStop,
  });
  const precomputedIndexes = buildGreedyPrecomputedIndexes(params, catalog, scoring, geometry, {
    useServiceTypes,
    useTypes,
  });
  maybeStop?.(true);
  const {
    serviceCandidates,
    anyResidentialCandidates,
    residentialCandidatesForLocal,
  } = catalog;
  const {
    serviceOrderSorted,
    serviceCoverageGroupsByKey,
  } = scoring;
  return {
    serviceCandidates,
    serviceOrderSorted,
    baseSolveContext: {
      grid: G,
      params,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      anyResidentialCandidates,
      residentialCandidatesForLocal,
      precomputedIndexes,
      maxResidentials,
      useServiceTypes,
      useTypes,
      localSearch,
      serviceLookaheadCandidates,
      profileCounters,
      recordProfilePhase,
      recordConnectivityShadowDecision,
      recordRoadOpportunity,
      maybeStop,
    },
  };
}
