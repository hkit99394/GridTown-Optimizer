import { materializeValidLnsSeedSolution } from "../core/index.js";
import { computeCpSatRequestFingerprint } from "../core/cpSatContinuation.js";
import { buildAdaptiveNeighborhoodCandidates } from "../solvers/index.js";
import {
  benchmarkGeneratedAt,
  cloneBenchmarkGrid,
  nonNegativeIntegerOrDefault,
  positiveFiniteNumberOrDefault,
  positiveIntegerOrDefault,
  sumBenchmarkBy,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";
import { DEFAULT_LNS_REPLAY_LABEL_CORPUS, getLnsReplayPressureFamily } from "./lns.js";
import { sameCandidate } from "./lnsWindowReplayFeatures.js";
import {
  buildReplayNeighborhoodOptions,
  buildReplayParams,
  replayCandidateKey,
  replayWindow,
  type ReplayWindowPlan,
  selectReplayCases,
  selectReplayWindowPlans,
  withRollForwardBaselineComparisons
} from "./lnsWindowReplayLabels.js";
import {
  LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
  LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
  LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY
} from "./lnsWindowReplayTypes.js";

import type { CpSatNeighborhoodWindow } from "../core/index.js";
import type { LnsAdaptiveNeighborhoodCandidate } from "../solvers/index.js";
import type { LnsBenchmarkCase } from "./lns.js";
import type {
  LnsWindowRankerOnlineAblationSnapshot,
  LnsWindowRankerOnlineSelectionTraceEntry
} from "./lnsWindowRankerOnlineAblations.js";
import type {
  LnsWindowReplayCaseResult,
  LnsWindowReplayLabel,
  LnsWindowReplayLabelRunOptions,
  LnsWindowReplayOnlineDecisionTrace,
  LnsWindowReplayStateSourceStatus,
  LnsWindowReplaySuiteResult
} from "./lnsWindowReplayTypes.js";

function sameReplayWindow(left: CpSatNeighborhoodWindow, right: CpSatNeighborhoodWindow): boolean {
  return left.top === right.top && left.left === right.left && left.rows === right.rows && left.cols === right.cols;
}

function sameReplayCandidate(
  candidate: LnsAdaptiveNeighborhoodCandidate,
  operator: LnsWindowRankerOnlineSelectionTraceEntry["baselineOperator"],
  window: CpSatNeighborhoodWindow
): boolean {
  return candidate.operator === operator && sameReplayWindow(candidate.window, window);
}

function candidateFromOnlineTrace(
  candidates: readonly LnsAdaptiveNeighborhoodCandidate[],
  operator: LnsWindowRankerOnlineSelectionTraceEntry["baselineOperator"],
  window: CpSatNeighborhoodWindow
): LnsAdaptiveNeighborhoodCandidate {
  const matched = candidates.find((candidate) => sameReplayCandidate(candidate, operator, window));
  return matched ?? { operator, window: { ...window }, score: 0 };
}

function upsertReplayWindowPlan(
  plans: Map<string, ReplayWindowPlan>,
  candidate: LnsAdaptiveNeighborhoodCandidate,
  selectionSource: LnsWindowReplayLabel["selectionSource"]
): void {
  plans.set(replayCandidateKey(candidate), {
    candidate,
    windowIndex: plans.size,
    selectionSource
  });
}

function selectOnlineDecisionReplayWindowPlans(
  candidates: readonly LnsAdaptiveNeighborhoodCandidate[],
  baselineCandidate: LnsAdaptiveNeighborhoodCandidate,
  selectedCandidate: LnsAdaptiveNeighborhoodCandidate,
  maxWindows: number,
  explorationWindowCount: number
): ReplayWindowPlan[] {
  const plans = new Map<string, ReplayWindowPlan>();
  for (const plan of selectReplayWindowPlans(candidates, maxWindows, explorationWindowCount)) {
    plans.set(replayCandidateKey(plan.candidate), plan);
  }
  upsertReplayWindowPlan(plans, baselineCandidate, "online-baseline");
  if (!sameCandidate(baselineCandidate, selectedCandidate)) {
    upsertReplayWindowPlan(plans, selectedCandidate, "online-selected");
  }
  return [...plans.values()].map((plan, windowIndex) => ({ ...plan, windowIndex }));
}

function onlineRankerVariant(
  benchmarkCase: LnsWindowRankerOnlineAblationSnapshot["cases"][number]
): LnsWindowRankerOnlineAblationSnapshot["cases"][number]["variants"][number] {
  const variant = benchmarkCase.variants.find((entry) => entry.variantName === "window-ranker");
  if (!variant) {
    throw new Error(`LNS online decision replay missing window-ranker variant: ${benchmarkCase.name}.`);
  }
  return variant;
}

function onlineDecisionTrace(trace: LnsWindowRankerOnlineSelectionTraceEntry): LnsWindowReplayOnlineDecisionTrace {
  return {
    selectionStatus: trace.selectionStatus,
    transition: trace.transition,
    iteration: trace.iteration,
    phase: trace.phase,
    outcomeStatus: trace.outcomeStatus,
    baselineOperator: trace.baselineOperator,
    selectedOperator: trace.selectedOperator,
    baselineWindow: { ...trace.baselineWindow },
    selectedWindow: { ...trace.selectedWindow },
    changedWindow: trace.changedWindow,
    scoreDelta: trace.scoreDelta,
    baselineScore: trace.baselineScore,
    selectedScore: trace.selectedScore
  };
}

function sourceStatusFromOnlineTrace(
  trace: LnsWindowRankerOnlineSelectionTraceEntry
): LnsWindowReplayStateSourceStatus {
  if (
    trace.outcomeStatus === "improved" ||
    trace.outcomeStatus === "neutral" ||
    trace.outcomeStatus === "recoverable-failure" ||
    trace.outcomeStatus === "skipped-budget" ||
    trace.outcomeStatus === "stopped"
  ) {
    return trace.outcomeStatus;
  }
  return "neutral";
}

function selectedOnlineReplayCases(
  onlineScorecard: LnsWindowRankerOnlineAblationSnapshot,
  corpus: readonly LnsBenchmarkCase[],
  options: LnsWindowReplayLabelRunOptions
): Map<string, LnsBenchmarkCase> {
  const selectedCaseNames = options.names?.length ? options.names : onlineScorecard.selectedCaseNames;
  return new Map(
    selectReplayCases(corpus, selectedCaseNames).map((benchmarkCase) => [benchmarkCase.name, benchmarkCase])
  );
}

export function runLnsWindowReplayLabelsFromOnlineDecisionStates(
  onlineScorecard: LnsWindowRankerOnlineAblationSnapshot,
  corpus: readonly LnsBenchmarkCase[] = DEFAULT_LNS_REPLAY_LABEL_CORPUS,
  options: LnsWindowReplayLabelRunOptions = {}
): LnsWindowReplaySuiteResult {
  const selectedCases = selectedOnlineReplayCases(onlineScorecard, corpus, options);
  const seedFilter = options.seeds?.length ? new Set(options.seeds) : null;
  const maxWindows = positiveIntegerOrDefault(options.maxWindows, 8);
  const explorationWindowCount = nonNegativeIntegerOrDefault(options.explorationWindowCount, 0);
  const repairTimeLimitSeconds = positiveFiniteNumberOrDefault(options.repairTimeLimitSeconds, 1);
  const rollForwardIterations = nonNegativeIntegerOrDefault(options.rollForwardIterations, 0);
  const rollForwardRepairTimeLimitSeconds =
    rollForwardIterations > 0
      ? positiveFiniteNumberOrDefault(options.rollForwardRepairTimeLimitSeconds, repairTimeLimitSeconds)
      : null;
  const rollForwardOptions =
    rollForwardIterations > 0 && rollForwardRepairTimeLimitSeconds !== null
      ? { iterations: rollForwardIterations, repairTimeLimitSeconds: rollForwardRepairTimeLimitSeconds }
      : null;
  const cases = onlineScorecard.cases.flatMap((onlineCase): LnsWindowReplayCaseResult[] => {
    const benchmarkCase = selectedCases.get(onlineCase.name);
    if (!benchmarkCase) return [];
    if (seedFilter && (onlineCase.seed === null || !seedFilter.has(onlineCase.seed))) return [];
    const G = cloneBenchmarkGrid(benchmarkCase.grid);
    const params = buildReplayParams(benchmarkCase, onlineCase.seed ?? null, options);
    const cpSatModelFingerprint = computeCpSatRequestFingerprint(G, { ...params, optimizer: "cp-sat" });
    const pressureFamily = getLnsReplayPressureFamily(benchmarkCase);
    const neighborhoodOptions = buildReplayNeighborhoodOptions(G, params);
    return (onlineRankerVariant(onlineCase).selectionTrace ?? []).flatMap((trace, traceIndex) => {
      if (!trace.decisionState) return [];
      const incumbent = materializeValidLnsSeedSolution(G, params, trace.decisionState.seedHint);
      if (!incumbent) {
        throw new Error(`LNS online decision replay missing incumbent seed state: ${onlineCase.name}/${traceIndex}.`);
      }
      const candidates = buildAdaptiveNeighborhoodCandidates(
        G,
        params,
        incumbent,
        neighborhoodOptions,
        trace.stagnantIterationsBefore + 1
      );
      const baselineCandidate = candidateFromOnlineTrace(candidates, trace.baselineOperator, trace.baselineWindow);
      const selectedCandidate = candidateFromOnlineTrace(candidates, trace.selectedOperator, trace.selectedWindow);
      const decisionTrace = onlineDecisionTrace(trace);
      const replayWindows = selectOnlineDecisionReplayWindowPlans(
        candidates,
        baselineCandidate,
        selectedCandidate,
        maxWindows,
        explorationWindowCount
      );
      const labels = withRollForwardBaselineComparisons(
        replayWindows.map(({ candidate, windowIndex, selectionSource }) =>
          replayWindow(
            G,
            params,
            benchmarkCase.name,
            pressureFamily,
            onlineCase.seed ?? null,
            "online-decision",
            trace.decisionState?.seedHint.sourceName ?? null,
            LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY,
            traceIndex,
            trace.iteration,
            sourceStatusFromOnlineTrace(trace),
            trace.stagnantIterationsBefore,
            incumbent,
            candidate,
            windowIndex,
            selectionSource,
            baselineCandidate,
            cpSatModelFingerprint,
            repairTimeLimitSeconds,
            rollForwardOptions,
            decisionTrace
          )
        )
      );
      return [
        {
          name: benchmarkCase.name,
          description: benchmarkCase.description,
          pressureFamily,
          seed: onlineCase.seed ?? null,
          seedHintKind: "online-decision",
          seedHintSourceName: trace.decisionState.seedHint.sourceName ?? null,
          statePolicy: LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY,
          stateIndex: traceIndex,
          stateSourceIteration: trace.iteration,
          stateSourceStatus: sourceStatusFromOnlineTrace(trace),
          stateStagnantIterations: trace.stagnantIterationsBefore,
          gridRows: G.length,
          gridCols: G[0]?.length ?? 0,
          incumbentPopulation: incumbent.totalPopulation,
          candidateWindowCount: candidates.length,
          replayedWindowCount: labels.length,
          baselineSelectedWindow: { ...trace.baselineWindow },
          baselineSelectedOperator: trace.baselineOperator,
          onlineDecisionTrace: decisionTrace,
          labels
        }
      ];
    });
  });
  const replaySeeds = uniqueBenchmarkValuesBy(
    cases.filter((benchmarkCase) => benchmarkCase.seed !== null),
    (benchmarkCase) => benchmarkCase.seed as number
  );
  const seedCount = replaySeeds.length || (cases.some((benchmarkCase) => benchmarkCase.seed === null) ? 1 : 0);

  return {
    schemaVersion: 1,
    generatedAt: benchmarkGeneratedAt(),
    caseCount: selectedCases.size,
    seedCount,
    comparisonCount: cases.length,
    seeds: replaySeeds,
    selectedCaseNames: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.name),
    pressureFamilies: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.pressureFamily),
    maxWindows,
    explorationWindowCount,
    repairTimeLimitSeconds,
    rollForwardIterations,
    rollForwardRepairTimeLimitSeconds,
    statePolicies: [LNS_WINDOW_REPLAY_ONLINE_DECISION_STATE_POLICY],
    capturedStatePolicies: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.statePolicy),
    stateCollectionIterations: 0,
    stateCollectionRepairTimeLimitSeconds: repairTimeLimitSeconds,
    stateCount: cases.length,
    featureSchemaVersion: LNS_WINDOW_REPLAY_FEATURE_SCHEMA_VERSION,
    cpSatNumWorkers: LNS_WINDOW_REPLAY_CP_SAT_NUM_WORKERS,
    cpSatModelFingerprints: uniqueBenchmarkValuesBy(
      cases.flatMap((benchmarkCase) => benchmarkCase.labels),
      (label) => label.cpSat.modelFingerprint
    ),
    rollForwardLabelCount: sumBenchmarkBy(
      cases,
      (benchmarkCase) => benchmarkCase.labels.filter((label) => label.rollForward).length
    ),
    labelCount: sumBenchmarkBy(cases, (benchmarkCase) => benchmarkCase.labels.length),
    cases
  };
}
