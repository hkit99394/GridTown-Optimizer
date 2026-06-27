/**
 * Solution, background solve, and planner API payload types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { AutoSolveStageMetadata } from "./autoTypes.js";
import type {
  AutoStageOptimizerName,
  Grid,
  OptimizerName,
  ResidentialPlacement,
  ServicePlacement
} from "./baseTypes.js";
import type {
  CpSatObjectivePolicy,
  CpSatPortfolioSummary,
  CpSatTelemetry,
  SolverProgressSummary
} from "./cpSatTypes.js";
import type { GreedyDiagnostics, GreedyProfile } from "./greedyTypes.js";
import type { LnsNeighborhoodOutcomeStatus, LnsStopReason, LnsTelemetry } from "./lnsTypes.js";
import type { SolveProgressSampleSource, SolverLifecycleSnapshotState } from "./solverLifecycleTypes.js";
import type { SolverParams } from "./solverParamTypes.js";

export interface Solution {
  optimizer?: OptimizerName;
  /** Active inner stage when a meta-optimizer is orchestrating multiple backends. */
  activeOptimizer?: AutoStageOptimizerName;
  /** Metadata for staged auto solves. Omitted for single-stage runs. */
  autoStage?: AutoSolveStageMetadata;
  /** True when the layout was manually edited and then revalidated outside a solver run. */
  manualLayout?: boolean;
  /** CP-SAT backend status such as OPTIMAL or FEASIBLE; omitted for non-CP-SAT solvers. */
  cpSatStatus?: string;
  /** Explicit CP-SAT objective metadata when the solution came from the CP-SAT backend. */
  cpSatObjectivePolicy?: CpSatObjectivePolicy;
  /** Exact-run telemetry emitted by the CP-SAT backend when available. */
  cpSatTelemetry?: CpSatTelemetry;
  /** Portfolio summary when CP-SAT used multi-run portfolio search. */
  cpSatPortfolio?: CpSatPortfolioSummary;
  /** Optional greedy profiling counters collected only when profiling is enabled. */
  greedyProfile?: GreedyProfile;
  /** Optional bounded "why not placed?" report for final greedy candidates. */
  greedyDiagnostics?: GreedyDiagnostics;
  /** LNS run summary and per-neighborhood outcomes when the LNS backend produced this solution. */
  lnsTelemetry?: LnsTelemetry;
  /** True when a run was stopped early and this solution is the best feasible result found so far. */
  stoppedByUser?: boolean;
  /** True when a greedy wall-clock budget stopped the run and this is the best feasible result found so far. */
  stoppedByTimeLimit?: boolean;
  /** Road cells that were supplied as fixed anchors for this layout. */
  fixedRoads?: string[];
  roads: Set<string>;
  services: ServicePlacement[];
  /** Service type index per placement; -1 only for manual solutions without configured service types */
  serviceTypeIndices: number[];
  /** Population increase applied by the i-th service (same order as services) */
  servicePopulationIncreases: number[];
  residentials: ResidentialPlacement[];
  /** Residential type index per placement; -1 when the solution did not use typed residentials */
  residentialTypeIndices: number[];
  /** Population per residential (same order as residentials) */
  populations: number[];
  totalPopulation: number;
}

/** Shared progress snapshot returned by long-running background solvers. */
export interface BackgroundSolveSnapshotState extends SolverLifecycleSnapshotState {}

/** Shared contract for cancellable background solver runs. */
export interface BackgroundSolveHandle {
  promise: Promise<Solution>;
  cancel: () => void;
  forceKill?: () => void;
  getLatestSnapshot: () => Solution | null;
  getLatestSnapshotState: () => BackgroundSolveSnapshotState;
}

/** JSON-serializable form of Solution for APIs and persisted browser storage. */
export interface SerializedSolution extends Omit<Solution, "roads"> {
  roads: string[];
}

/** Current solve request payload shape used by the web planner and local web server. */
export interface SolveRequestPayload {
  grid: Grid;
  params: SolverParams;
}

/** Solver summary returned by the local web server for display and persistence. */
export interface SolveResponseStats {
  optimizer?: OptimizerName;
  activeOptimizer?: AutoStageOptimizerName;
  autoStage?: AutoSolveStageMetadata;
  manualLayout: boolean;
  cpSatStatus: string | null;
  lnsTelemetry?: LnsTelemetry;
  progressSummary?: SolverProgressSummary;
  stoppedByUser: boolean;
  stoppedByTimeLimit: boolean;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
}

/** Validation details returned alongside a solved layout. */
export interface SolveResponseValidation {
  valid: boolean;
  errors: string[];
  recomputedPopulations: number[];
  recomputedTotalPopulation: number;
  mapRows: string[];
  mapText: string;
}

export interface PlannerExplainabilityCell {
  r: number;
  c: number;
  allowed: boolean;
  occupiedKind: "service" | "residential" | "road" | null;
  roadAnchorReachable: boolean;
  roadAnchorDistance: number | null;
  serviceValue: number;
  bestServiceBonus: number;
  residentialOpportunity: number;
  residentialHeadroom: number;
  connectivityLostCells: number;
  connectivityDisconnectedCells: number;
  connectivityFootprintCells: number;
}

export interface PlannerExplainabilityMap {
  schemaVersion: 1;
  rows: number;
  cols: number;
  maxServiceValue: number;
  maxBestServiceBonus: number;
  maxResidentialOpportunity: number;
  maxResidentialHeadroom: number;
  maxConnectivityLostCells: number;
  maxConnectivityDisconnectedCells: number;
  roadAnchorReachableCellCount: number;
  cells: PlannerExplainabilityCell[][];
}

/** Chronological performance sample captured during a planner solve. */
export interface SolveProgressLogEntry {
  capturedAt: string;
  elapsedMs: number;
  /** Latest sample time covered by this entry when unchanged progress snapshots are compacted. */
  lastCapturedAt?: string;
  /** Latest elapsed time covered by this entry when unchanged progress snapshots are compacted. */
  lastElapsedMs?: number;
  source: SolveProgressSampleSource;
  optimizer: OptimizerName | null;
  activeOptimizer?: AutoStageOptimizerName | null;
  autoStage?: AutoSolveStageMetadata | null;
  hasFeasibleSolution: boolean;
  totalPopulation: number | null;
  cpSatStatus: string | null;
  lnsStopReason?: LnsStopReason | null;
  lnsNeighborhoodStatus?: LnsNeighborhoodOutcomeStatus | null;
  lnsNeighborhoodImprovement?: number | null;
  lnsNeighborhoodsCompleted?: number | null;
  progressSummary?: SolverProgressSummary;
  bestPopulationUpperBound: number | null;
  populationGapUpperBound: number | null;
  solveWallTimeSeconds: number | null;
  lastImprovementAtSeconds: number | null;
  secondsSinceLastImprovement: number | null;
  note?: string | null;
}

/** Display-ready solve result payload as saved by the planner UI. */
export interface SolveResponsePayload {
  solution: SerializedSolution;
  validation: SolveResponseValidation;
  stats: SolveResponseStats;
  explainability?: PlannerExplainabilityMap;
  progressLog?: SolveProgressLogEntry[];
  progressLogFilePath?: string;
  message?: string;
}
