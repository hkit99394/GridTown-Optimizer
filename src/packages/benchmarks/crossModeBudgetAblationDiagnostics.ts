import {
  formatNullableBenchmarkSeconds as formatSeconds,
  formatNullableBenchmarkSignedNumber as formatSigned,
  roundBenchmarkMetric
} from "./benchmarkOptions.js";

import type { CrossModeBenchmarkCaseScorecard, CrossModeBenchmarkModeResult } from "./crossMode.js";
import type { CrossModeBenchmarkSolverParamSummary, CrossModeBenchmarkStageTelemetry } from "./crossModeTelemetry.js";

export interface CrossModeBenchmarkBudgetAblationAutoReplayParamSummary {
  autoCpSatStageReserveRatio: number | null;
  lnsSeedTimeLimitSeconds: number | null;
  lnsRepairTimeLimitSeconds: number | null;
  lnsFocusedRepairTimeLimitSeconds: number | null;
  lnsEscalatedRepairTimeLimitSeconds: number | null;
  lnsIterations: number | null;
  cpSatTimeLimitSeconds: number | null;
  cpSatNoImprovementTimeoutSeconds: number | null;
}

export interface CrossModeBenchmarkBudgetAblationAutoReplayStageSummary {
  stage: string;
  stageIndex: number | null;
  cycleIndex: number | null;
  status: string | null;
  startedAtSeconds: number | null;
  wallClockSeconds: number | null;
  completedAtSeconds: number | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  improvement: number | null;
  exactGap: number | null;
  cpSatStatus: string | null;
  lnsIterationsStarted: number | null;
  lnsIterationsCompleted: number | null;
  lnsImprovingIterations: number | null;
  lnsNeutralIterations: number | null;
}

export interface CrossModeBenchmarkBudgetAblationLnsNeighborhoodReplaySummary {
  phase: string | null;
  iteration: number | null;
  status: string | null;
  wallClockSeconds: number | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  improvement: number | null;
  windowRows: number | null;
  windowCols: number | null;
  windowArea: number | null;
  stagnantIterationsBefore: number | null;
  cpSatStatus: string | null;
}

export interface CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics {
  runId: string;
  finalPopulation: number;
  wallClockSeconds: number;
  autoStopReason: string | null;
  bestScoreSeconds: number | null;
  params: CrossModeBenchmarkBudgetAblationAutoReplayParamSummary;
  stages: CrossModeBenchmarkBudgetAblationAutoReplayStageSummary[];
  lnsNeighborhoods: CrossModeBenchmarkBudgetAblationLnsNeighborhoodReplaySummary[];
  lnsNeighborhoodTraceCaptured: boolean;
  lnsStageImprovement: number;
  cpSatStageImprovement: number;
}

export interface CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic {
  policyName: string;
  baselinePolicyName: string | null;
  caseName: string;
  budgetSeconds: number;
  seed: number;
  autoPopulationDeltaVsBaseline: number;
  autoWallClockDeltaVsBaselineSeconds: number;
  baseline: CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics;
  candidate: CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics;
  reason: string;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundedNumber(value: unknown): number | null {
  const numberValue = finiteNumber(value);
  return numberValue === null ? null : roundBenchmarkMetric(numberValue);
}

function numericRecordValue(record: Record<string, unknown> | null, key: string): number | null {
  return roundedNumber(record?.[key]);
}

function summarizeParams(
  params: CrossModeBenchmarkSolverParamSummary
): CrossModeBenchmarkBudgetAblationAutoReplayParamSummary {
  return {
    autoCpSatStageReserveRatio: numericRecordValue(params.auto, "cpSatStageReserveRatio"),
    lnsSeedTimeLimitSeconds: numericRecordValue(params.lns, "seedTimeLimitSeconds"),
    lnsRepairTimeLimitSeconds: numericRecordValue(params.lns, "repairTimeLimitSeconds"),
    lnsFocusedRepairTimeLimitSeconds: numericRecordValue(params.lns, "focusedRepairTimeLimitSeconds"),
    lnsEscalatedRepairTimeLimitSeconds: numericRecordValue(params.lns, "escalatedRepairTimeLimitSeconds"),
    lnsIterations: numericRecordValue(params.lns, "iterations"),
    cpSatTimeLimitSeconds: numericRecordValue(params.cpSat, "timeLimitSeconds"),
    cpSatNoImprovementTimeoutSeconds: numericRecordValue(params.cpSat, "noImprovementTimeoutSeconds")
  };
}

function stageCountValue(stage: CrossModeBenchmarkStageTelemetry, key: string): number | null {
  return numericRecordValue(stage.candidateCounts, key);
}

function summarizeAutoStage(
  stage: CrossModeBenchmarkStageTelemetry
): CrossModeBenchmarkBudgetAblationAutoReplayStageSummary {
  return {
    stage: stage.stage,
    stageIndex: stage.stageIndex,
    cycleIndex: stage.cycleIndex,
    status: stage.status,
    startedAtSeconds: stage.startedAtSeconds,
    wallClockSeconds: stage.wallClockSeconds,
    completedAtSeconds: stage.completedAtSeconds,
    scoreBefore: stage.scoreBefore,
    scoreAfter: stage.scoreAfter,
    improvement: stage.improvement,
    exactGap: stage.exactGap,
    cpSatStatus: stage.cpSatStatus,
    lnsIterationsStarted: stageCountValue(stage, "lnsIterationsStarted"),
    lnsIterationsCompleted: stageCountValue(stage, "lnsIterationsCompleted"),
    lnsImprovingIterations: stageCountValue(stage, "lnsImprovingIterations"),
    lnsNeutralIterations: stageCountValue(stage, "lnsNeutralIterations")
  };
}

function summarizeLnsNeighborhood(
  stage: CrossModeBenchmarkStageTelemetry
): CrossModeBenchmarkBudgetAblationLnsNeighborhoodReplaySummary {
  return {
    phase: stage.phase,
    iteration: stage.iteration,
    status: stage.status,
    wallClockSeconds: stage.wallClockSeconds,
    scoreBefore: stage.scoreBefore,
    scoreAfter: stage.scoreAfter,
    improvement: stage.improvement,
    windowRows: stageCountValue(stage, "windowRows"),
    windowCols: stageCountValue(stage, "windowCols"),
    windowArea: stageCountValue(stage, "windowArea"),
    stagnantIterationsBefore: stageCountValue(stage, "stagnantIterationsBefore"),
    cpSatStatus: stage.cpSatStatus
  };
}

function sumStageImprovements(
  stages: readonly CrossModeBenchmarkBudgetAblationAutoReplayStageSummary[],
  stageName: string
): number {
  return stages
    .filter((stage) => stage.stage === stageName)
    .reduce((sum, stage) => sum + Math.max(0, stage.improvement ?? 0), 0);
}

function buildReplayRunDiagnostics(
  result: CrossModeBenchmarkModeResult
): CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics {
  const stages = result.telemetry.stages
    .filter((stage) => stage.kind === "auto-stage")
    .map((stage) => summarizeAutoStage(stage));
  const lnsNeighborhoods = result.telemetry.stages
    .filter((stage) => stage.kind === "lns-neighborhood")
    .map((stage) => summarizeLnsNeighborhood(stage));
  return {
    runId: result.telemetry.runId,
    finalPopulation: result.totalPopulation,
    wallClockSeconds: roundBenchmarkMetric(result.wallClockSeconds),
    autoStopReason: result.autoStopReason,
    bestScoreSeconds: result.budgetAllocationSignal.bestScoreSeconds,
    params: summarizeParams(result.telemetry.solverParams),
    stages,
    lnsNeighborhoods,
    lnsNeighborhoodTraceCaptured: lnsNeighborhoods.length > 0,
    lnsStageImprovement: sumStageImprovements(stages, "lns"),
    cpSatStageImprovement: sumStageImprovements(stages, "cp-sat")
  };
}

function formatParamChange(candidate: number | null, baseline: number | null): string {
  return `${candidate ?? "n/a"} vs ${baseline ?? "n/a"}`;
}

function describeReplayDiagnostic(
  delta: number,
  candidate: CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics,
  baseline: CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics
): string {
  const seedChange = formatParamChange(
    candidate.params.lnsSeedTimeLimitSeconds,
    baseline.params.lnsSeedTimeLimitSeconds
  );
  const reserveChange = formatParamChange(
    candidate.params.autoCpSatStageReserveRatio,
    baseline.params.autoCpSatStageReserveRatio
  );
  const missingTrace =
    !candidate.lnsNeighborhoodTraceCaptured && candidate.stages.some((stage) => stage.stage === "lns")
      ? " Candidate final incumbent no longer carries detailed LNS neighborhoods after a later stage handoff."
      : "";
  if (delta < 0 && baseline.lnsStageImprovement > candidate.lnsStageImprovement) {
    return `Baseline LNS repaired +${baseline.lnsStageImprovement} while candidate LNS repaired +${candidate.lnsStageImprovement}; LNS seed ${seedChange}, CP-SAT reserve ${reserveChange}.${missingTrace}`;
  }
  if (delta < 0 && candidate.cpSatStageImprovement <= 0) {
    return `Candidate regressed and CP-SAT did not recover population after LNS; LNS seed ${seedChange}, CP-SAT reserve ${reserveChange}.${missingTrace}`;
  }
  if (delta > 0 && candidate.lnsStageImprovement > baseline.lnsStageImprovement) {
    return `Candidate improved because LNS repaired +${candidate.lnsStageImprovement} versus baseline +${baseline.lnsStageImprovement}; LNS seed ${seedChange}, CP-SAT reserve ${reserveChange}.`;
  }
  return `${delta < 0 ? "Candidate regressed" : "Candidate improved"} by ${Math.abs(delta)} population; LNS seed ${seedChange}, CP-SAT reserve ${reserveChange}.${missingTrace}`;
}

function autoComparisonKey(scorecard: CrossModeBenchmarkCaseScorecard): string {
  return `${scorecard.name}\u0000${scorecard.budgetSeconds}\u0000${scorecard.seed}`;
}

function autoResult(scorecard: CrossModeBenchmarkCaseScorecard): CrossModeBenchmarkModeResult | null {
  return scorecard.results.find((result) => result.mode === "auto") ?? null;
}

export function buildCrossModeBudgetAblationAutoReplayDiagnostics(
  policyName: string,
  baselinePolicyName: string | null,
  scorecards: readonly CrossModeBenchmarkCaseScorecard[],
  baselineAutoByKey: ReadonlyMap<string, CrossModeBenchmarkModeResult>
): CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic[] {
  return scorecards
    .map((scorecard) => {
      const candidateResult = autoResult(scorecard);
      const baselineResult = baselineAutoByKey.get(autoComparisonKey(scorecard)) ?? null;
      if (candidateResult === null || baselineResult === null) return null;
      const delta = candidateResult.totalPopulation - baselineResult.totalPopulation;
      if (delta === 0) return null;
      const baseline = buildReplayRunDiagnostics(baselineResult);
      const candidate = buildReplayRunDiagnostics(candidateResult);
      return {
        policyName,
        baselinePolicyName,
        caseName: scorecard.name,
        budgetSeconds: scorecard.budgetSeconds,
        seed: scorecard.seed,
        autoPopulationDeltaVsBaseline: delta,
        autoWallClockDeltaVsBaselineSeconds: roundBenchmarkMetric(
          candidateResult.wallClockSeconds - baselineResult.wallClockSeconds
        ),
        baseline,
        candidate,
        reason: describeReplayDiagnostic(delta, candidate, baseline)
      };
    })
    .filter((diagnostic): diagnostic is CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic => diagnostic !== null)
    .sort((left, right) => {
      const delta = left.autoPopulationDeltaVsBaseline - right.autoPopulationDeltaVsBaseline;
      if (delta !== 0) return delta;
      const caseOrder = left.caseName.localeCompare(right.caseName);
      if (caseOrder !== 0) return caseOrder;
      if (left.budgetSeconds !== right.budgetSeconds) return left.budgetSeconds - right.budgetSeconds;
      return left.seed - right.seed;
    });
}

function formatImprovingNeighborhoods(run: CrossModeBenchmarkBudgetAblationAutoReplayRunDiagnostics): string {
  const improved = run.lnsNeighborhoods.filter((entry) => (entry.improvement ?? 0) > 0);
  if (!improved.length) return run.lnsNeighborhoodTraceCaptured ? "none" : "not-captured";
  return improved.map((entry) => `${entry.phase ?? "n/a"}#${entry.iteration ?? "n/a"}+${entry.improvement}`).join(",");
}

export function formatCrossModeBudgetAblationAutoReplayDiagnostic(
  diagnostic: CrossModeBenchmarkBudgetAblationAutoReplayDiagnostic
): string {
  return [
    `row=${diagnostic.caseName}/budget:${diagnostic.budgetSeconds}s/seed:${diagnostic.seed}`,
    `delta=${formatSigned(diagnostic.autoPopulationDeltaVsBaseline)}`,
    `wall=${formatSeconds(diagnostic.autoWallClockDeltaVsBaselineSeconds)}`,
    `baseline=${diagnostic.baseline.finalPopulation}`,
    `candidate=${diagnostic.candidate.finalPopulation}`,
    `lns=baseline+${diagnostic.baseline.lnsStageImprovement}/candidate+${diagnostic.candidate.lnsStageImprovement}`,
    `cp-sat=baseline+${diagnostic.baseline.cpSatStageImprovement}/candidate+${diagnostic.candidate.cpSatStageImprovement}`,
    `seed=${diagnostic.candidate.params.lnsSeedTimeLimitSeconds ?? "n/a"}vs${diagnostic.baseline.params.lnsSeedTimeLimitSeconds ?? "n/a"}`,
    `reserve=${diagnostic.candidate.params.autoCpSatStageReserveRatio ?? "n/a"}vs${diagnostic.baseline.params.autoCpSatStageReserveRatio ?? "n/a"}`,
    `improved-neighborhoods=baseline:${formatImprovingNeighborhoods(diagnostic.baseline)} candidate:${formatImprovingNeighborhoods(diagnostic.candidate)}`,
    `reason=${diagnostic.reason}`
  ].join(" ");
}
