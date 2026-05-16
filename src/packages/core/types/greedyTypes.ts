/**
 * Greedy solver option, diagnostic, and profiling types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

export interface GreedyOptions {
  /** Run bounded local search to improve the greedy seed (residential neighborhoods plus bounded service neighborhoods). */
  localSearch?: boolean;
  /** Allow bounded service remove/add/swap neighborhoods around the incumbent after greedy construction (default true). */
  localSearchServiceMoves?: boolean;
  /** Maximum ranked service candidates considered by bounded service neighborhoods per iteration (default 6). */
  localSearchServiceCandidateLimit?: number;
  /** Experimental Step 14 reranker: top-N service candidates to rescore with a bounded residential refill lookahead. Default 0/off. */
  serviceLookaheadCandidates?: number;
  /** Prototype deferred road commitment during the main greedy construction pass (default false). */
  deferRoadCommitment?: boolean;
  /** Prefer more central high-population candidates when Greedy scores are close. Default false. */
  densityTieBreaker?: boolean;
  /** Population/score window for density tie-breaking, expressed as a percent. Default 2. */
  densityTieBreakerTolerancePercent?: number;
  /** Prefer placements with lower building-induced road-anchor connectivity shadow when Greedy scores tie. Default false. */
  connectivityShadowScoring?: boolean;
  /** Fixed seed for reproducible greedy restart shuffling. */
  randomSeed?: number;
  /** Optional wall-clock budget in seconds for raw greedy solves. Omit for no greedy-specific cap. */
  timeLimitSeconds?: number;
  /** Collect phase-level profiling counters without changing solver behavior. */
  profile?: boolean;
  /** Emit a bounded post-solve "why not placed?" diagnostic report. Default false. */
  diagnostics?: boolean;
  /** Number of restarts with different service order; take best solution (default 1) */
  restarts?: number;
  /** Service-position refinement passes after restarts (default 2) */
  serviceRefineIterations?: number;
  /** Max service candidates considered per refinement pass (default 40) */
  serviceRefineCandidateLimit?: number;
  /** Run exhaustive search over service layouts in top-N pool (default false) */
  exhaustiveServiceSearch?: boolean;
  /** Pool size for exhaustive service search (default 22) */
  serviceExactPoolLimit?: number;
  /** Hard cap on evaluated service combinations (default 12000) */
  serviceExactMaxCombinations?: number;
  /** Experimental master/subproblem pass: enumerate bounded service layouts, then realize residentials/roads. Default false. */
  serviceMasterDecomposition?: boolean;
  /** Ranked service-candidate pool size for service-master decomposition (default 12). */
  serviceMasterPoolLimit?: number;
  /** Hard cap on service-master layouts evaluated through fixed-service realization (default 256). */
  serviceMasterMaxLayouts?: number;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export type GreedyPlacementDiagnosticReason =
  | "blocked-footprint"
  | "no-road-path"
  | "no-service-coverage"
  | "base-only"
  | "availability-cap"
  | "lower-score-no-improvement";

export interface GreedyDiagnosticAvailabilityEntry {
  typeIndex: number;
  name?: string;
  available: number;
  used: number;
  remaining: number;
}

export interface GreedyDiagnosticOverallAvailability {
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface GreedyDiagnosticExample {
  kind: "service" | "residential";
  reason: GreedyPlacementDiagnosticReason;
  reasons: GreedyPlacementDiagnosticReason[];
  r: number;
  c: number;
  rows: number;
  cols: number;
  typeIndex: number;
  typeName?: string;
  score?: number;
  population?: number;
  basePopulation?: number;
  maxPopulation?: number;
}

export interface GreedyDiagnosticKindReport {
  candidateLimit: number;
  candidatesScanned: number;
  candidatesSkippedAsPlaced: number;
  truncated: boolean;
  placedCount: number;
  overallAvailability: GreedyDiagnosticOverallAvailability;
  availabilityByType: GreedyDiagnosticAvailabilityEntry[];
  reasonCounts: Partial<Record<GreedyPlacementDiagnosticReason, number>>;
  examplesByReason: Partial<Record<GreedyPlacementDiagnosticReason, GreedyDiagnosticExample[]>>;
}

export interface GreedyDiagnostics {
  version: 1;
  candidateLimit: number;
  examplesPerReason: number;
  services: GreedyDiagnosticKindReport;
  residentials: GreedyDiagnosticKindReport;
}

export interface GreedyProfileCounters {
  precompute: {
    serviceCandidates: number;
    residentialCandidates: number;
    geometryCacheEntries: number;
    residentialScoringGroups: number;
    residentialScoringVariantsCollapsed: number;
    serviceCoveragePairs: number;
    serviceCoverageGroups: number;
    serviceStaticScores: number;
    serviceStaticScoreGroupEvaluations: number;
    serviceStaticAvailabilityDiscountedGroups: number;
    residentialPopulationCacheEntries: number;
  };
  attempts: {
    serviceCaps: number;
    coarseCaps: number;
    refineCaps: number;
    capsSkipped: number;
    restarts: number;
    restartCaps: number;
    serviceRefineTrials: number;
    exhaustiveTrials: number;
    serviceMasterLayouts: number;
    serviceMasterFeasibleLayouts: number;
    serviceMasterNoGoodSkips: number;
    fixedServiceRealizationTrials: number;
    localSearchIterations: number;
  };
  servicePhase: {
    candidateScans: number;
    canConnectChecks: number;
    lookaheadEvaluations: number;
    lookaheadResidentialScans: number;
    lookaheadWins: number;
    candidateInvalidations: number;
    typeInvalidations: number;
    groupedScoreLookups: number;
    groupedScoreGroupEvaluations: number;
    availabilityDiscountedGroups: number;
    scoreDirtyMarks: number;
    scoreRecomputes: number;
    placements: number;
    fixedPlacements: number;
  };
  residentialPhase: {
    candidateScans: number;
    canConnectChecks: number;
    candidateInvalidations: number;
    typeInvalidations: number;
    placements: number;
    populationCacheLookups: number;
  };
  localSearch: {
    candidateScans: number;
    canConnectChecks: number;
    placements: number;
    occupancyScratchReuses: number;
    moveChecks: number;
    addChecks: number;
    serviceRemoveChecks: number;
    serviceAddChecks: number;
    serviceSwapChecks: number;
    serviceNeighborhoodImprovements: number;
    populationCacheLookups: number;
  };
  roads: {
    canConnectChecks: number;
    ensureConnectedCalls: number;
    probeCalls: number;
    probeReuses: number;
    scratchProbeCalls: number;
    roadAnchorChecks: number;
    fallbackRoads: number;
    deferredFrontierRecomputes: number;
    deferredReconstructionSteps: number;
    deferredReconstructionFailures: number;
    connectivityShadowChecks: number;
    connectivityShadowLostCells: number;
    connectivityShadowFootprintCells: number;
    connectivityShadowDisconnectedCells: number;
    connectivityShadowMaxLostCells: number;
    connectivityShadowMaxDisconnectedCells: number;
    connectivityShadowScoreTies: number;
    connectivityShadowScoreWins: number;
    connectivityShadowScoreLosses: number;
    connectivityShadowScoreNeutral: number;
    roadOpportunityChecks: number;
    roadOpportunityLostCells: number;
    roadOpportunityFootprintCells: number;
    roadOpportunityDisconnectedCells: number;
    roadOpportunityMaxLostCells: number;
    roadOpportunityMaxDisconnectedCells: number;
  };
}

export type GreedyConnectivityShadowDecisionPhase = "service" | "residential";

export interface GreedyConnectivityShadowPlacementTrace {
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
}

export interface GreedyConnectivityShadowDecisionTrace {
  phase: GreedyConnectivityShadowDecisionPhase;
  score: number;
  candidate: GreedyConnectivityShadowPlacementTrace;
  incumbent: GreedyConnectivityShadowPlacementTrace;
  chosen: GreedyConnectivityShadowPlacementTrace;
  rejected: GreedyConnectivityShadowPlacementTrace;
  candidateShadowPenalty: number;
  incumbentShadowPenalty: number;
}

export type GreedyRoadOpportunityPhase =
  | "service"
  | "residential"
  | "service-neighborhood"
  | "residential-local-search";

export type GreedyRoadOpportunityMoveKind = "residential-add" | "residential-move" | "service-add" | "service-swap";

export type GreedyRoadOpportunityCounterfactualReason =
  | "same-score-tie"
  | "near-score"
  | "lower-road-cost"
  | "higher-score-rejected"
  | "lookahead-rejected";

export interface GreedyRoadOpportunityCounterfactualTrace {
  reason: GreedyRoadOpportunityCounterfactualReason;
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  score: number;
  scoreDelta: number;
  roadCostDelta: number;
  reachableBefore: number;
  reachableAfter: number;
  lostCells: number;
  footprintCells: number;
  disconnectedCells: number;
  tieBreakComparison?: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: GreedyRoadOpportunityMoveKind;
}

export interface GreedyRoadOpportunityTrace {
  phase: GreedyRoadOpportunityPhase;
  r: number;
  c: number;
  rows: number;
  cols: number;
  roadCost: number;
  score?: number;
  reachableBefore: number;
  reachableAfter: number;
  lostCells: number;
  footprintCells: number;
  disconnectedCells: number;
  typeIndex?: number;
  bonus?: number;
  range?: number;
  moveKind?: GreedyRoadOpportunityMoveKind;
  counterfactuals?: GreedyRoadOpportunityCounterfactualTrace[];
}

export type GreedyProfilePhaseName =
  | "precompute"
  | "constructiveCapSearch"
  | "forcedServiceRealization"
  | "serviceRefinement"
  | "exhaustiveServiceSearch"
  | "serviceMasterDecomposition"
  | "residentialLocalSearch"
  | "serviceNeighborhoodSearch";

export interface GreedyProfilePhaseSummary {
  name: GreedyProfilePhaseName;
  runs: number;
  elapsedMs: number;
  bestPopulationBefore: number | null;
  bestPopulationAfter: number | null;
  bestPopulationDelta: number;
  candidatePopulationDelta: number;
  improvements: number;
}

export interface GreedyProfile {
  counters: GreedyProfileCounters;
  phases: GreedyProfilePhaseSummary[];
  connectivityShadowDecisions?: GreedyConnectivityShadowDecisionTrace[];
  connectivityShadowDecisionTraceLimit?: number;
  roadOpportunityTraces?: GreedyRoadOpportunityTrace[];
  roadOpportunityTraceLimit?: number;
}
