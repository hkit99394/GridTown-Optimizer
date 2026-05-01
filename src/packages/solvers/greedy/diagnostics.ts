import type {
  Grid,
  GreedyDiagnostics,
  GreedyDiagnosticExample,
  GreedyDiagnosticKindReport,
  GreedyPlacementDiagnosticReason,
  ServiceCandidate,
  Solution,
  SolverParams,
} from "../../core/index.js";
import {
  createRoadProbeScratch,
  getResidentialBaseMax,
  NO_TYPE_INDEX,
  normalizeServicePlacement,
  overlaps,
} from "../../core/index.js";
import {
  getCandidateTypeIndex,
  materializeChosenServiceCandidate,
  serviceCandidateKey,
  stableResidentialPlacementKey,
} from "./candidates.js";
import { probeExplicitRoadConnection } from "./attemptState.js";
import type { ResidentialCandidateLike } from "./candidates.js";
import {
  addPlacementCellsToSet,
  overlapsCachedFootprint,
} from "./placementUtils.js";
import {
  computeResidentialPopulation,
  computeServiceMarginalScore,
  getCachedServiceEffectZoneSet,
  getCachedServiceFootprintKeys,
} from "./serviceScoring.js";
import type {
  GreedyPrecomputedIndexes,
  GreedyPreparedInputs,
  ResidentialScoringGroup,
} from "./types.js";

const GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT = 2_000;
const GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON = 3;

type DiagnosticExampleSeed = Omit<GreedyDiagnosticExample, "reason">;

function createDiagnosticKindReport(options: {
  placedCount: number;
  overallLimit: number | null;
  availabilityByType: GreedyDiagnosticKindReport["availabilityByType"];
}): GreedyDiagnosticKindReport {
  const { placedCount, overallLimit, availabilityByType } = options;
  return {
    candidateLimit: GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT,
    candidatesScanned: 0,
    candidatesSkippedAsPlaced: 0,
    truncated: false,
    placedCount,
    overallAvailability: {
      limit: overallLimit,
      used: placedCount,
      remaining: overallLimit === null ? null : Math.max(0, overallLimit - placedCount),
    },
    availabilityByType,
    reasonCounts: {},
    examplesByReason: {},
  };
}

function countTypeUsage(typeIndices: readonly number[], typeCount: number): number[] {
  const usage = new Array<number>(typeCount).fill(0);
  for (const typeIndex of typeIndices) {
    if (typeIndex >= 0 && typeIndex < usage.length) usage[typeIndex]++;
  }
  return usage;
}

function buildTypedAvailabilityDiagnostics(
  types: readonly { name?: string; avail: number }[] | undefined,
  typeIndices: readonly number[]
): {
  byType: GreedyDiagnosticKindReport["availabilityByType"];
  usageByType: number[];
  totalAvailability: number | null;
} {
  if (!types?.length) {
    return {
      byType: [],
      usageByType: [],
      totalAvailability: null,
    };
  }
  const usageByType = countTypeUsage(typeIndices, types.length);
  return {
    usageByType,
    totalAvailability: types.reduce((sum, type) => sum + Math.max(0, type.avail), 0),
    byType: types.map((type, typeIndex) => {
      const used = usageByType[typeIndex] ?? 0;
      return {
        typeIndex,
        ...(type.name ? { name: type.name } : {}),
        available: type.avail,
        used,
        remaining: Math.max(0, type.avail - used),
      };
    }),
  };
}

function addDiagnosticReasons(
  report: GreedyDiagnosticKindReport,
  reasons: GreedyPlacementDiagnosticReason[],
  exampleSeed: DiagnosticExampleSeed
): void {
  for (const reason of reasons) {
    report.reasonCounts[reason] = (report.reasonCounts[reason] ?? 0) + 1;
    const examples = report.examplesByReason[reason] ?? [];
    if (examples.length < GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON) {
      examples.push({
        ...exampleSeed,
        reason,
      });
      report.examplesByReason[reason] = examples;
    }
  }
}

function pushDiagnosticReason(
  reasons: GreedyPlacementDiagnosticReason[],
  reason: GreedyPlacementDiagnosticReason
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function buildSolutionOccupiedSet(solution: Solution): Set<string> {
  const occupied = new Set<string>(solution.roads);
  for (const service of solution.services) addPlacementCellsToSet(occupied, normalizeServicePlacement(service));
  for (const residential of solution.residentials) addPlacementCellsToSet(occupied, residential);
  return occupied;
}

function buildPlacedServiceCandidateKeys(solution: Solution): Set<string> {
  return new Set(solution.services.map((_, index) => serviceCandidateKey(materializeChosenServiceCandidate(solution, index))));
}

function buildPlacedResidentialCandidateKeys(solution: Solution): Set<string> {
  return new Set(solution.residentials.map((residential, index) =>
    stableResidentialPlacementKey({
      ...residential,
      typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
    })
  ));
}

function buildCurrentResidentialGroupBoosts(
  solution: Solution,
  residentialScoringGroups: readonly ResidentialScoringGroup[],
  serviceCoverageGroupsByKey: Map<string, number[]>
): number[] {
  const boosts = Array.from({ length: residentialScoringGroups.length }, () => 0);
  for (let index = 0; index < solution.services.length; index++) {
    const service = materializeChosenServiceCandidate(solution, index);
    for (const groupIndex of serviceCoverageGroupsByKey.get(serviceCandidateKey(service)) ?? []) {
      boosts[groupIndex] += service.bonus;
    }
  }
  return boosts;
}

type GreedyDiagnosticBuildContext = {
  G: Grid;
  params: SolverParams;
  solution: Solution;
  occupied: Set<string>;
  roadProbeScratch: ReturnType<typeof createRoadProbeScratch>;
  precomputedIndexes: GreedyPrecomputedIndexes;
};

type GreedyTypedAvailabilityDiagnostics = ReturnType<typeof buildTypedAvailabilityDiagnostics>;

function resolveDiagnosticOverallLimit(
  configuredLimit: number | undefined,
  availability: GreedyTypedAvailabilityDiagnostics
): number | null {
  return configuredLimit ?? availability.totalAvailability;
}

function isAvailabilityCappedForCandidate(
  overallCapped: boolean,
  type: { avail: number } | undefined,
  usageByType: readonly number[],
  typeIndex: number
): boolean {
  return overallCapped || Boolean(type && (usageByType[typeIndex] ?? 0) >= type.avail);
}

function isDiagnosticFootprintBlocked(
  occupied: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number },
  footprintKeys?: readonly string[]
): boolean {
  return footprintKeys
    ? overlapsCachedFootprint(occupied, footprintKeys)
    : overlaps(occupied, placement.r, placement.c, placement.rows, placement.cols);
}

function isDiagnosticRoadPathMissing(
  context: GreedyDiagnosticBuildContext,
  placement: { r: number; c: number; rows: number; cols: number }
): boolean {
  return probeExplicitRoadConnection(
    context.G,
    context.solution.roads,
    context.occupied,
    placement,
    context.roadProbeScratch
  ) === null;
}

function markDiagnosticScanLimit(
  report: GreedyDiagnosticKindReport,
  totalCandidateCount: number,
  scannedCandidateCount: number
): void {
  report.truncated = totalCandidateCount > scannedCandidateCount;
}

function buildGreedyServiceDiagnostics(options: {
  context: GreedyDiagnosticBuildContext;
  serviceOrderSorted: readonly ServiceCandidate[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  residentialScoringGroups: ResidentialScoringGroup[];
  currentResidentialGroupBoosts: number[];
  serviceAvailability: GreedyTypedAvailabilityDiagnostics;
  serviceOverallLimit: number | null;
  remainingResidentialAvail: number[] | null;
}): GreedyDiagnosticKindReport {
  const {
    context,
    serviceOrderSorted,
    serviceCoverageGroupsByKey,
    residentialScoringGroups,
    currentResidentialGroupBoosts,
    serviceAvailability,
    serviceOverallLimit,
    remainingResidentialAvail,
  } = options;
  const { params, solution, occupied, precomputedIndexes } = context;
  const placedServiceKeys = buildPlacedServiceCandidateKeys(solution);
  const serviceReport = createDiagnosticKindReport({
    placedCount: solution.services.length,
    overallLimit: serviceOverallLimit,
    availabilityByType: serviceAvailability.byType,
  });
  const serviceOverallCapped =
    serviceOverallLimit !== null && solution.services.length >= serviceOverallLimit;
  const serviceCandidatesToScan = serviceOrderSorted.slice(0, GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT);
  markDiagnosticScanLimit(serviceReport, serviceOrderSorted.length, serviceCandidatesToScan.length);

  for (const service of serviceCandidatesToScan) {
    if (placedServiceKeys.has(serviceCandidateKey(service))) {
      serviceReport.candidatesSkippedAsPlaced++;
      continue;
    }
    serviceReport.candidatesScanned++;
    const reasons: GreedyPlacementDiagnosticReason[] = [];
    const serviceType = params.serviceTypes?.[service.typeIndex];
    if (isAvailabilityCappedForCandidate(
      serviceOverallCapped,
      serviceType,
      serviceAvailability.usageByType,
      service.typeIndex
    )) {
      pushDiagnosticReason(reasons, "availability-cap");
    }

    const footprintKeys = getCachedServiceFootprintKeys(precomputedIndexes, service);
    const blocked = isDiagnosticFootprintBlocked(occupied, service, footprintKeys);
    if (blocked) {
      pushDiagnosticReason(reasons, "blocked-footprint");
    }

    let noRoadPath = false;
    if (!blocked) {
      noRoadPath = isDiagnosticRoadPathMissing(context, service);
      if (noRoadPath) pushDiagnosticReason(reasons, "no-road-path");
    }

    const score = computeServiceMarginalScore(
      service,
      occupied,
      currentResidentialGroupBoosts,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      remainingResidentialAvail
    );
    if (!blocked && !noRoadPath && score <= 0) {
      pushDiagnosticReason(reasons, "no-service-coverage");
    }
    if (!blocked && !noRoadPath && score > 0) {
      pushDiagnosticReason(reasons, "lower-score-no-improvement");
    }

    addDiagnosticReasons(serviceReport, reasons, {
      kind: "service",
      reasons,
      r: service.r,
      c: service.c,
      rows: service.rows,
      cols: service.cols,
      typeIndex: service.typeIndex,
      ...(serviceType?.name ? { typeName: serviceType.name } : {}),
      score,
    });
  }

  return serviceReport;
}

function buildGreedyResidentialDiagnostics(options: {
  context: GreedyDiagnosticBuildContext;
  residentialCandidates: readonly ResidentialCandidateLike[];
  residentialAvailability: GreedyTypedAvailabilityDiagnostics;
  residentialOverallLimit: number | null;
}): GreedyDiagnosticKindReport {
  const {
    context,
    residentialCandidates,
    residentialAvailability,
    residentialOverallLimit,
  } = options;
  const { G, params, solution, occupied, precomputedIndexes } = context;
  const placedResidentialKeys = buildPlacedResidentialCandidateKeys(solution);
  const residentialReport = createDiagnosticKindReport({
    placedCount: solution.residentials.length,
    overallLimit: residentialOverallLimit,
    availabilityByType: residentialAvailability.byType,
  });
  const residentialOverallCapped =
    residentialOverallLimit !== null && solution.residentials.length >= residentialOverallLimit;
  const residentialCandidatesToScan = residentialCandidates.slice(0, GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT);
  markDiagnosticScanLimit(
    residentialReport,
    residentialCandidates.length,
    residentialCandidatesToScan.length
  );
  const finalEffectZones = solution.services.map((_, index) =>
    getCachedServiceEffectZoneSet(G, precomputedIndexes, materializeChosenServiceCandidate(solution, index))
  );
  for (const residential of residentialCandidatesToScan) {
    if (placedResidentialKeys.has(stableResidentialPlacementKey(residential))) {
      residentialReport.candidatesSkippedAsPlaced++;
      continue;
    }
    residentialReport.candidatesScanned++;
    const reasons: GreedyPlacementDiagnosticReason[] = [];
    const typeIndex = getCandidateTypeIndex(residential);
    const residentialType = params.residentialTypes?.[typeIndex];
    if (isAvailabilityCappedForCandidate(
      residentialOverallCapped,
      residentialType,
      residentialAvailability.usageByType,
      typeIndex
    )) {
      pushDiagnosticReason(reasons, "availability-cap");
    }

    const blocked = isDiagnosticFootprintBlocked(occupied, residential);
    if (blocked) {
      pushDiagnosticReason(reasons, "blocked-footprint");
    }

    let noRoadPath = false;
    if (!blocked) {
      noRoadPath = isDiagnosticRoadPathMissing(context, residential);
      if (noRoadPath) pushDiagnosticReason(reasons, "no-road-path");
    }

    const serviceBonuses = solution.servicePopulationIncreases;
    const population = computeResidentialPopulation(params, residential, finalEffectZones, serviceBonuses, typeIndex);
    const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    if (!blocked && !noRoadPath && population <= base) {
      pushDiagnosticReason(reasons, "base-only");
    }
    if (
      !blocked
      && !noRoadPath
      && population > base
    ) {
      pushDiagnosticReason(reasons, "lower-score-no-improvement");
    }

    addDiagnosticReasons(residentialReport, reasons, {
      kind: "residential",
      reasons,
      r: residential.r,
      c: residential.c,
      rows: residential.rows,
      cols: residential.cols,
      typeIndex,
      ...(residentialType?.name ? { typeName: residentialType.name } : {}),
      population,
      basePopulation: base,
      ...(Number.isFinite(max) ? { maxPopulation: max } : {}),
    });
  }

  return residentialReport;
}

export function buildGreedyDiagnostics(options: {
  G: Grid;
  params: SolverParams;
  solution: Solution;
  preparedInputs: GreedyPreparedInputs;
  maxServices: number | undefined;
  maxResidentials: number | undefined;
}): GreedyDiagnostics {
  const {
    G,
    params,
    solution,
    preparedInputs,
    maxServices,
    maxResidentials,
  } = options;
  const {
    serviceOrderSorted,
    baseSolveContext: {
      anyResidentialCandidates,
      residentialScoringGroups,
      serviceCoverageGroupsByKey,
      precomputedIndexes,
    },
  } = preparedInputs;
  const context: GreedyDiagnosticBuildContext = {
    G,
    params,
    solution,
    occupied: buildSolutionOccupiedSet(solution),
    roadProbeScratch: createRoadProbeScratch(G),
    precomputedIndexes,
  };
  const serviceAvailability = buildTypedAvailabilityDiagnostics(params.serviceTypes, solution.serviceTypeIndices);
  const residentialAvailability = buildTypedAvailabilityDiagnostics(params.residentialTypes, solution.residentialTypeIndices);
  const remainingResidentialAvail = params.residentialTypes?.length
    ? params.residentialTypes.map((type, typeIndex) =>
        Math.max(0, type.avail - (residentialAvailability.usageByType[typeIndex] ?? 0))
      )
    : null;
  const currentResidentialGroupBoosts = buildCurrentResidentialGroupBoosts(
    solution,
    residentialScoringGroups,
    serviceCoverageGroupsByKey
  );

  return {
    version: 1,
    candidateLimit: GREEDY_DIAGNOSTIC_CANDIDATE_LIMIT,
    examplesPerReason: GREEDY_DIAGNOSTIC_EXAMPLES_PER_REASON,
    services: buildGreedyServiceDiagnostics({
      context,
      serviceOrderSorted,
      serviceCoverageGroupsByKey,
      residentialScoringGroups,
      currentResidentialGroupBoosts,
      serviceAvailability,
      serviceOverallLimit: resolveDiagnosticOverallLimit(maxServices, serviceAvailability),
      remainingResidentialAvail,
    }),
    residentials: buildGreedyResidentialDiagnostics({
      context,
      residentialCandidates: anyResidentialCandidates,
      residentialAvailability,
      residentialOverallLimit: resolveDiagnosticOverallLimit(maxResidentials, residentialAvailability),
    }),
  };
}
