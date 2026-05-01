import type {
  GreedyProfileCounters,
  ResidentialCandidate,
  ResidentialPlacement,
  ServiceCandidate,
  ServicePlacement,
  Solution,
  SolverParams,
} from "../../core/index.js";
import type {
  createRoadProbeScratch,
  buildFootprintGeometryCache,
  buildServiceGeometryCache,
} from "../../core/index.js";
import type { ConnectivityProbe } from "./attemptState.js";
import type { ResidentialCandidatesList } from "./candidates.js";
import type { GreedyProfilePhaseRecorder } from "./profile.js";
import type { ConnectivityShadowDecisionRecorder } from "./connectivityShadowScoring.js";
import type { RoadOpportunityRecorder } from "./roadOpportunity.js";

export type ResidentialCandidateStat = {
  r: number;
  c: number;
  rows: number;
  cols: number;
  base: number;
  max: number;
  typeIndex: number;
};

export type ResidentialScoringVariant = {
  base: number;
  max: number;
  typeIndex: number;
};

export type ResidentialScoringGroup = {
  r: number;
  c: number;
  rows: number;
  cols: number;
  variants: ResidentialScoringVariant[];
};

export type MaybeStop = ((force?: boolean) => void) | undefined;

export interface GreedyPrecomputedIndexes {
  serviceCandidateIndicesByKey: Map<string, number>;
  serviceCandidatesByOccupiedCell: Map<string, number[]>;
  serviceFootprintKeysByCandidate: readonly (readonly string[])[];
  serviceEffectZoneSetsByCandidate: readonly Set<string>[];
  residentialGroupsByOccupiedCell: Map<string, number[]>;
  serviceCandidateIndicesByResidentialGroup: number[][];
  serviceCandidateIndicesByType: number[][] | null;
  residentialCandidatesByOccupiedCell: Map<string, number[]>;
  residentialCandidateFootprintKeys: readonly (readonly string[])[];
  residentialCandidateIndicesByType: number[][] | null;
}

export interface GreedySolveContext {
  grid: import("../../core/index.js").Grid;
  params: SolverParams;
  serviceOrder: ServiceCandidate[];
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  anyResidentialCandidates: ResidentialCandidatesList;
  residentialCandidatesForLocal: ResidentialCandidatesList;
  precomputedIndexes: GreedyPrecomputedIndexes;
  maxResidentials: number | undefined;
  useServiceTypes: boolean;
  useTypes: boolean;
  localSearch: boolean;
  serviceLookaheadCandidates: number;
  profileCounters?: GreedyProfileCounters;
  recordProfilePhase?: GreedyProfilePhaseRecorder;
  maybeStop?: MaybeStop;
  recordConnectivityShadowDecision?: ConnectivityShadowDecisionRecorder;
  recordRoadOpportunity?: RoadOpportunityRecorder;
}

export interface SolveOneOptions {
  maxServices: number | undefined;
  initialRoadSeed?: Set<string>;
  fixedServices?: ServiceCandidate[];
  profileCounters?: GreedyProfileCounters;
}

export interface GreedyPreparedInputs {
  serviceCandidates: ServiceCandidate[];
  serviceOrderSorted: ServiceCandidate[];
  baseSolveContext: Omit<GreedySolveContext, "serviceOrder">;
}

export type GreedyServiceGeometryCache = ReturnType<typeof buildServiceGeometryCache>;
export type GreedyFootprintGeometryCache = ReturnType<typeof buildFootprintGeometryCache>;

export interface GreedyCandidateCatalog {
  serviceCandidates: ServiceCandidate[];
  anyResidentialCandidates: ResidentialCandidatesList;
  residentialCandidatesForLocal: ResidentialCandidatesList;
  residentialCandidateStats: ResidentialCandidateStat[];
}

export interface GreedyGeometryIndexes {
  serviceGeometryCache: GreedyServiceGeometryCache;
  serviceEffectZoneSetsByCandidate: Set<string>[];
  residentialCandidateGeometryCache: GreedyFootprintGeometryCache;
  residentialGroupGeometryCache: GreedyFootprintGeometryCache;
}

export interface GreedyScoringIndexes {
  residentialScoringGroups: ResidentialScoringGroup[];
  serviceCoverageGroupsByKey: Map<string, number[]>;
  serviceOrderSorted: ServiceCandidate[];
}

export type GreedySolveAttempt = (serviceOrder: ServiceCandidate[], options: SolveOneOptions) => Solution | null;
export type GreedyBestUpdater = (candidate: Solution | null) => void;

export type FixedServiceEvaluationBudget = {
  maxOrders: number;
  maxSeededOrders: number;
  maxSeeds: number;
};

export type GreedyForcedServiceEvaluator = (
  forcedServices: ServiceCandidate[],
  maxForcedServices: number,
  budget: FixedServiceEvaluationBudget
) => Solution | null;

export interface ResidentialLocalSearchState {
  grid: import("../../core/index.js").Grid;
  roads: Set<string>;
  occupied: Set<string>;
  services: ServicePlacement[];
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  totalPopulation: number;
  residentialCandidates: ResidentialPlacement[] | ResidentialCandidate[];
  residentialPopulationCache: number[];
  params: SolverParams;
  remainingAvail: number[] | null;
  maxResidentials: number | undefined;
  profileCounters?: GreedyProfileCounters;
  recordRoadOpportunity?: RoadOpportunityRecorder;
  maybeStop?: () => void;
  explicitRoadProbeScratch?: ReturnType<typeof createRoadProbeScratch>;
}

export type ServiceRelocationMove = {
  kind: "remove" | "add" | "swap";
  serviceIndex: number;
  candidate: ServiceCandidate;
  forcedServices: ServiceCandidate[];
  estimatedTotalPopulation: number;
  estimatedFutureScore: number;
  estimatedRoadCost: number;
  orderedServiceKey: string;
  traceKey?: string;
  traceProbe?: ConnectivityProbe;
  traceFootprintKeys?: readonly string[];
  traceOccupiedBuildings?: Set<string>;
};

export type ResidualServiceBundleTrial = {
  candidate: ServiceCandidate;
  forcedServices: ServiceCandidate[];
  displacedResidentialCount: number;
  estimatedTotalPopulation: number;
  estimatedFutureScore: number;
  orderedServiceKey: string;
};

export type ResidentialMoveChoice = {
  kind: "move";
  residentialIndex: number;
  candidate: ResidentialPlacement | ResidentialCandidate;
  candidateTypeIndex: number;
  currentTypeIndex: number;
  currentPop: number;
  newPop: number;
  key: string;
  probe: ConnectivityProbe;
  occupiedBuildings: Set<string>;
};

export type ResidentialAddChoice = {
  kind: "add";
  candidate: ResidentialPlacement | ResidentialCandidate;
  candidateTypeIndex: number;
  addPop: number;
  key: string;
  probe: ConnectivityProbe;
  occupiedBuildings: Set<string>;
};
