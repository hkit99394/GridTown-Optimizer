import type {
  AutoOptions,
  CpSatOptions,
  CpSatPortfolioOptions,
  Grid,
  GreedyOptions,
  LnsOptions,
  OptimizerName,
  Solution,
  SolverDecisionTraceEvent,
  SolverParams,
  SolverProgressSummary,
  SolverTimeToQualityScorecard
} from "../core/index.js";
import type { CrossModeBenchmarkRunTelemetry } from "./crossModeTelemetry.js";

export type CrossModeBenchmarkMode = OptimizerName | "cp-sat-portfolio";
export type CrossModeProblemSizeBand = "tiny" | "small" | "medium";
export type CrossModeBenchmarkSplit = "development" | "holdout";
export type CrossModeWorkflowTag =
  | "solver-smoke"
  | "manual-layout-replay"
  | "expansion-comparison"
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-pressure"
  | "anchor-service"
  | "multi-anchor";
export type CrossModeWinVsAuto = "baseline" | "win" | "loss" | "tie" | "no-auto";
export type CrossModeBudgetAllocationSignalKind =
  | "insufficient-trace"
  | "under-used-budget"
  | "over-budget"
  | "late-improvement"
  | "early-plateau"
  | "steady";
export type CrossModeBudgetPolicyRecommendation =
  | "keep-auto"
  | "add-auto-baseline"
  | "shift-auto-budget-to-greedy"
  | "shift-auto-budget-to-lns"
  | "shift-auto-budget-to-cp-sat"
  | "keep-portfolio-experimental"
  | "investigate-auto-loss";
export type CrossModePortfolioEfficiencyRecommendation =
  | "portfolio-cpu-win"
  | "portfolio-wall-win-only"
  | "single-cp-sat";

export interface CrossModeBenchmarkCase {
  name: string;
  description: string;
  problemSizeBand?: CrossModeProblemSizeBand;
  split?: CrossModeBenchmarkSplit;
  workflowTags?: readonly CrossModeWorkflowTag[];
  grid: Grid;
  params: SolverParams;
}

export interface CrossModeBenchmarkSolveContext {
  benchmarkCase: CrossModeBenchmarkCase;
  mode: CrossModeBenchmarkMode;
  budgetSeconds: number;
  seed: number;
  budgetAblationPolicyName?: string;
}

export type CrossModeBenchmarkSolve = (
  grid: Grid,
  params: SolverParams,
  context: CrossModeBenchmarkSolveContext
) => Solution | Promise<Solution>;

export interface CrossModeBudgetAllocationSignal {
  signal: CrossModeBudgetAllocationSignalKind;
  budgetUtilizationRatio: number;
  budgetRemainingSeconds: number;
  budgetOverrunSeconds: number;
  firstImprovementSeconds: number | null;
  bestScoreSeconds: number | null;
  secondsAfterBest: number | null;
  improvementsPerSecond: number | null;
  scoreDeltaVsAuto: number | null;
  autoBestScoreSecondsDelta: number | null;
  reason: string;
}

export interface CrossModeBenchmarkRunOptions {
  names?: string[];
  modes?: CrossModeBenchmarkMode[];
  /** Backward-compatible single-budget option. Prefer budgetsSeconds for scorecards. */
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  budgetAblationPolicy?: CrossModeBenchmarkBudgetAblationPolicy;
  auto?: Partial<AutoOptions>;
  greedy?: Partial<GreedyOptions>;
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  portfolio?: Partial<CpSatPortfolioOptions>;
  solve?: CrossModeBenchmarkSolve;
}

export interface CrossModeBenchmarkModeResult {
  mode: CrossModeBenchmarkMode;
  optimizer: OptimizerName;
  label: string;
  problemSizeBand: CrossModeProblemSizeBand;
  budgetSeconds: number;
  seed: number;
  totalPopulation: number;
  scoreDeltaToBest: number | null;
  scoreRatioToBest: number | null;
  winVsAuto: CrossModeWinVsAuto;
  scoreDeltaVsAuto: number | null;
  rank: number;
  wallClockSeconds: number;
  workerCpuBudgetSeconds: number;
  observedWorkerCpuSeconds: number | null;
  populationPerWorkerCpuBudgetSecond: number | null;
  populationPerObservedCpuSecond: number | null;
  roadCount: number;
  roadSemantics: CrossModeRoadSemanticsSummary;
  serviceCount: number;
  residentialCount: number;
  cpSatStatus: string | null;
  lnsStopReason: string | null;
  lnsSeedTimeLimitSeconds: number | null;
  lnsSeedWallClockSeconds: number | null;
  lnsSeedProfilePhaseCount: number;
  autoStopReason: string | null;
  autoGreedySeedTimeLimitSeconds: number | null;
  autoGreedySeedElapsedSeconds: number | null;
  autoGreedySeedProfilePhaseCount: number;
  stoppedByUser: boolean;
  progressSummary: SolverProgressSummary;
  decisionTrace: SolverDecisionTraceEvent[];
  timeToQuality: SolverTimeToQualityScorecard;
  budgetAllocationSignal: CrossModeBudgetAllocationSignal;
  checkpointReason: string;
  telemetry: CrossModeBenchmarkRunTelemetry;
}

export type CrossModeRoadSemanticStatus = "anchor-connected" | "empty" | "no-anchor-touch" | "disconnected";

export interface CrossModeRoadSemanticsSummary {
  status: CrossModeRoadSemanticStatus;
  anchorRoadCount: number;
  anchorConnectedRoadCount: number;
  disconnectedRoadCount: number;
  anchorConnectedRoadRatio: number | null;
  roadAdjacentBuildingCount: number;
  roadUnadjacentBuildingCount: number;
}

export interface CrossModeBenchmarkCaseScorecard {
  name: string;
  description: string;
  problemSizeBand: CrossModeProblemSizeBand;
  split: CrossModeBenchmarkSplit;
  workflowTags: CrossModeWorkflowTag[];
  gridRows: number;
  gridCols: number;
  budgetSeconds: number;
  seed: number;
  bestScore: number | null;
  winnerModes: CrossModeBenchmarkMode[];
  results: CrossModeBenchmarkModeResult[];
}

export interface CrossModeBenchmarkModeSummary {
  mode: CrossModeBenchmarkMode;
  label: string;
  runs: number;
  meanPopulation: number;
  bestPopulation: number;
  worstPopulation: number;
  populationStdDev: number;
  meanWallClockSeconds: number;
  winRateVsAuto: number | null;
  meanScoreDeltaVsAuto: number | null;
}

export interface CrossModeBenchmarkProblemSizeSummary extends CrossModeBenchmarkModeSummary {
  problemSizeBand: CrossModeProblemSizeBand;
}

export interface CrossModeBenchmarkBudgetPolicySignal {
  caseName: string;
  problemSizeBand: CrossModeProblemSizeBand;
  budgetSeconds: number;
  seed: number;
  bestMode: CrossModeBenchmarkMode | null;
  bestScore: number | null;
  autoScore: number | null;
  autoDeltaToBest: number | null;
  recommendation: CrossModeBudgetPolicyRecommendation;
  reason: string;
  autoStopReason: string | null;
  autoGreedySeedElapsedSeconds: number | null;
  autoLnsStageElapsedSeconds: number | null;
  autoLnsStageImprovement: number | null;
  autoCpSatStageElapsedSeconds: number | null;
  autoCpSatStageImprovement: number | null;
  lnsScoreDeltaVsAuto: number | null;
  lnsSeedWallClockSeconds: number | null;
}

export interface CrossModePortfolioEfficiencySignal {
  caseName: string;
  problemSizeBand: CrossModeProblemSizeBand;
  budgetSeconds: number;
  seed: number;
  singleScore: number;
  portfolioScore: number;
  scoreDelta: number;
  singleWallClockSeconds: number;
  portfolioWallClockSeconds: number;
  wallClockDeltaSeconds: number;
  singleWorkerCpuBudgetSeconds: number;
  portfolioWorkerCpuBudgetSeconds: number;
  cpuBudgetDeltaSeconds: number;
  singleObservedWorkerCpuSeconds: number | null;
  portfolioObservedWorkerCpuSeconds: number | null;
  singlePopulationPerCpuBudgetSecond: number | null;
  portfolioPopulationPerCpuBudgetSecond: number | null;
  cpuBudgetEfficiencyRatio: number | null;
  recommendation: CrossModePortfolioEfficiencyRecommendation;
  reason: string;
}

export interface CrossModeBenchmarkSuiteResult {
  generatedAt: string;
  /** Backward-compatible first budget. */
  budgetSeconds: number;
  budgetsSeconds: number[];
  seeds: number[];
  modeCount: number;
  caseCount: number;
  selectedCaseNames: string[];
  modes: CrossModeBenchmarkMode[];
  cases: CrossModeBenchmarkCaseScorecard[];
  modeSummaries: CrossModeBenchmarkModeSummary[];
  problemSizeSummaries: CrossModeBenchmarkProblemSizeSummary[];
  budgetPolicySignals: CrossModeBenchmarkBudgetPolicySignal[];
  portfolioEfficiencySignals: CrossModePortfolioEfficiencySignal[];
}

export interface CrossModeBenchmarkBudgetAblationPolicy {
  name: string;
  description: string;
  activeBudgetSeconds?: readonly number[];
  auto?: Partial<AutoOptions>;
  lns?: Partial<LnsOptions>;
  lnsSeedBudgetRatio?: number;
  lnsRepairBudgetRatio?: number;
  lnsEscalatedRepairBudgetRatio?: number;
  autoCpSatStageReserveRatio?: number;
}
