import {
  benchmarkRatio,
  meanNullableBenchmarkValue,
  percentileBenchmarkValue,
  sumBenchmarkBy,
  summarizeBenchmarkVariantMetrics
} from "./benchmarkOptions.js";
import * as finalOutcomes from "./lnsWindowRankerOnlineFinalOutcomes.js";
import { buildLnsWindowRankerOnlineFinalLayoutDelta } from "./lnsWindowRankerOnlineLayoutDeltas.js";
import {
  buildLnsWindowRankerOnlineSelectionDiagnostics,
  buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics,
  mergeLnsWindowRankerOnlineSelectionDiagnostics
} from "./lnsWindowRankerOnlineSelectionDiagnostics.js";

import type { CpSatNeighborhoodWindow, LnsWindowRankerSelectionTelemetry } from "../core/index.js";
import type { LnsBenchmarkCaseResult } from "./lns.js";
import type { LnsWindowRankerOnlineSelectionDiagnostics } from "./lnsWindowRankerOnlineSelectionDiagnostics.js";
import type {
  LnsWindowRankerOnlineAblationCaseResult,
  LnsWindowRankerOnlineAblationSummary,
  LnsWindowRankerOnlineAblationTelemetrySummary,
  LnsWindowRankerOnlineAblationVariantName,
  LnsWindowRankerOnlineAblationVariantResult,
  LnsWindowRankerOnlineSelectionTraceEntry,
  LnsWindowRankerOnlineSelectionTraceStatus,
  LnsWindowRankerOnlineTimeToBestSummary
} from "./lnsWindowRankerOnlineAblations.js";

const VARIANT_DESCRIPTIONS: Record<LnsWindowRankerOnlineAblationVariantName, string> = {
  baseline: "Existing deterministic adaptive LNS window selector.",
  "window-ranker": "Opt-in learned LNS window scorer using the supplied offline ranker model."
};

function summarizeWindowRanker(result: LnsBenchmarkCaseResult): LnsWindowRankerOnlineAblationTelemetrySummary | null {
  const ranker = result.lnsTelemetry?.windowRanker;
  if (!ranker) return null;
  return {
    enabled: ranker.enabled,
    modelFingerprint: ranker.modelFingerprint ?? null,
    featureSchemaVersion: ranker.featureSchemaVersion ?? null,
    minScoreDelta: ranker.minScoreDelta,
    suppressionModelFingerprint: ranker.suppressionModelFingerprint ?? null,
    suppressionMinScoreDelta: ranker.suppressionMinScoreDelta ?? null,
    allowedTransitions: ranker.allowedTransitions ? [...ranker.allowedTransitions] : null,
    selectedFeatureGates: ranker.selectedFeatureGates ? [...ranker.selectedFeatureGates] : [],
    selectedFeatureGateGroups: ranker.selectedFeatureGateGroups
      ? ranker.selectedFeatureGateGroups.map((group) => [...group])
      : [],
    featureDeltaGates: ranker.featureDeltaGates ? [...ranker.featureDeltaGates] : [],
    decisions: ranker.decisions,
    overrides: ranker.overrides,
    fallbackDecisions: ranker.fallbackDecisions,
    overrideRate: benchmarkRatio(ranker.overrides, ranker.decisions),
    fallbackRate: benchmarkRatio(ranker.fallbackDecisions, ranker.decisions)
  };
}

function overrideOutcomeCount(result: LnsBenchmarkCaseResult): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.selectedByBaseline === false ? 1 : 0
  );
}

function fallbackOutcomeCount(result: LnsBenchmarkCaseResult): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.fallbackReason ? 1 : 0
  );
}

function overrideOutcomeStatusCount(result: LnsBenchmarkCaseResult, status: "improved" | "neutral"): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.selectedByBaseline === false && outcome.status === status ? 1 : 0
  );
}

function fallbackOutcomeStatusCount(result: LnsBenchmarkCaseResult, status: "improved" | "neutral"): number {
  return sumBenchmarkBy(result.lnsTelemetry?.outcomes ?? [], (outcome) =>
    outcome.windowRankerSelection?.fallbackReason && outcome.status === status ? 1 : 0
  );
}

function meanOverrideScoreDelta(result: LnsBenchmarkCaseResult): number | null {
  const deltas = (result.lnsTelemetry?.outcomes ?? [])
    .filter((outcome) => outcome.windowRankerSelection?.selectedByBaseline === false)
    .map((outcome) => outcome.windowRankerSelection?.scoreDelta)
    .filter((delta): delta is number => delta !== undefined);
  return deltas.length ? sumBenchmarkBy(deltas, (delta) => delta) / deltas.length : null;
}

function nullableDelta(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

function finiteTimeToBestWallClockRatio(
  result: LnsWindowRankerOnlineAblationVariantResult,
  baseline: LnsWindowRankerOnlineAblationVariantResult
): number | null {
  const baselineSeconds = baseline.timeToBestWallClockSeconds;
  const resultSeconds = result.timeToBestWallClockSeconds;
  if (
    typeof baselineSeconds !== "number" ||
    !Number.isFinite(baselineSeconds) ||
    baselineSeconds <= 0 ||
    typeof resultSeconds !== "number" ||
    !Number.isFinite(resultSeconds)
  ) {
    return null;
  }
  return resultSeconds / baselineSeconds;
}

function medianNullableBenchmarkValue(values: ReadonlyArray<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length ? percentileBenchmarkValue(finiteValues, 0.5) : null;
}

function timeToBestSummary(result: LnsBenchmarkCaseResult): LnsWindowRankerOnlineTimeToBestSummary {
  const telemetry = result.lnsTelemetry;
  if (!telemetry) {
    return {
      timeToBestIteration: null,
      timeToBestWallClockSeconds: result.wallClockSeconds
    };
  }

  const outcomes = telemetry.outcomes ?? [];
  const bestPopulation = Math.max(
    result.totalPopulation,
    ...outcomes.flatMap((outcome) => [outcome.populationBefore, outcome.populationAfter])
  );
  const seedWallClockSeconds = telemetry.seedWallClockSeconds ?? 0;
  const seedPopulation = outcomes[0]?.populationBefore ?? result.totalPopulation;
  if (seedPopulation >= bestPopulation) {
    return {
      timeToBestIteration: 0,
      timeToBestWallClockSeconds: seedWallClockSeconds
    };
  }

  let elapsedSeconds = seedWallClockSeconds;
  for (const [index, outcome] of outcomes.entries()) {
    elapsedSeconds += outcome.wallClockSeconds;
    if (outcome.populationAfter >= bestPopulation) {
      return {
        timeToBestIteration: index + 1,
        timeToBestWallClockSeconds: elapsedSeconds
      };
    }
  }

  return {
    timeToBestIteration: null,
    timeToBestWallClockSeconds: result.wallClockSeconds
  };
}

function sameTraceWindow(left: CpSatNeighborhoodWindow, right: CpSatNeighborhoodWindow): boolean {
  return left.top === right.top && left.left === right.left && left.rows === right.rows && left.cols === right.cols;
}

function selectionTraceStatus(selection: LnsWindowRankerSelectionTelemetry): LnsWindowRankerOnlineSelectionTraceStatus {
  if (selection.selectedByBaseline === false) return "override";
  if (selection.fallbackReason) return "fallback";
  return "baseline";
}

function selectionTrace(result: LnsBenchmarkCaseResult): LnsWindowRankerOnlineSelectionTraceEntry[] {
  return (result.lnsTelemetry?.outcomes ?? []).flatMap((outcome) => {
    const selection = outcome.windowRankerSelection;
    if (!selection) return [];
    return [
      {
        iteration: outcome.iteration,
        phase: outcome.phase,
        outcomeStatus: outcome.status,
        populationBefore: outcome.populationBefore,
        populationAfter: outcome.populationAfter,
        improvement: outcome.improvement,
        stagnantIterationsBefore: outcome.stagnantIterationsBefore,
        repairTimeLimitSeconds: outcome.repairTimeLimitSeconds,
        appliedOperator: outcome.operator ?? null,
        appliedWindow: { ...outcome.window },
        transition: `${selection.baselineOperator}->${selection.selectedOperator}`,
        changedWindow: !sameTraceWindow(selection.baselineWindow, selection.selectedWindow),
        ...(selection.nominatedOperator === undefined
          ? {}
          : { nominatedTransition: `${selection.baselineOperator}->${selection.nominatedOperator}` }),
        ...(selection.nominatedWindow === undefined
          ? {}
          : { nominatedChangedWindow: !sameTraceWindow(selection.baselineWindow, selection.nominatedWindow) }),
        selectionStatus: selectionTraceStatus(selection),
        candidateCount: selection.candidateCount,
        baselineCandidateIndex: selection.baselineCandidateIndex,
        selectedCandidateIndex: selection.selectedCandidateIndex,
        baselineOperator: selection.baselineOperator,
        selectedOperator: selection.selectedOperator,
        baselineWindow: { ...selection.baselineWindow },
        selectedWindow: { ...selection.selectedWindow },
        selectedByBaseline: selection.selectedByBaseline,
        ...(selection.fallbackReason ? { fallbackReason: selection.fallbackReason } : {}),
        baselineScore: selection.baselineScore,
        selectedScore: selection.selectedScore,
        scoreDelta: selection.scoreDelta,
        ...(selection.nominatedCandidateIndex === undefined
          ? {}
          : { nominatedCandidateIndex: selection.nominatedCandidateIndex }),
        ...(selection.nominatedOperator === undefined ? {} : { nominatedOperator: selection.nominatedOperator }),
        ...(selection.nominatedWindow === undefined ? {} : { nominatedWindow: { ...selection.nominatedWindow } }),
        ...(selection.nominatedByBaseline === undefined ? {} : { nominatedByBaseline: selection.nominatedByBaseline }),
        ...(selection.nominatedScore === undefined ? {} : { nominatedScore: selection.nominatedScore }),
        ...(selection.nominatedScoreDelta === undefined ? {} : { nominatedScoreDelta: selection.nominatedScoreDelta }),
        ...(selection.suppressionModelFingerprint
          ? { suppressionModelFingerprint: selection.suppressionModelFingerprint }
          : {}),
        ...(selection.suppressionBaselineScore === undefined
          ? {}
          : { suppressionBaselineScore: selection.suppressionBaselineScore }),
        ...(selection.suppressionSelectedScore === undefined
          ? {}
          : { suppressionSelectedScore: selection.suppressionSelectedScore }),
        ...(selection.suppressionScoreDelta === undefined
          ? {}
          : { suppressionScoreDelta: selection.suppressionScoreDelta }),
        modelFingerprint: selection.modelFingerprint ?? null,
        featureSchemaVersion: selection.featureSchemaVersion ?? null,
        ...(selection.baselineFeatures ? { baselineFeatures: { ...selection.baselineFeatures } } : {}),
        ...(selection.selectedFeatures ? { selectedFeatures: { ...selection.selectedFeatures } } : {}),
        ...(selection.featureDeltas ? { featureDeltas: { ...selection.featureDeltas } } : {}),
        ...(selection.nominatedFeatures ? { nominatedFeatures: { ...selection.nominatedFeatures } } : {}),
        ...(selection.nominatedFeatureDeltas
          ? { nominatedFeatureDeltas: { ...selection.nominatedFeatureDeltas } }
          : {}),
        ...(selection.decisionState ? { decisionState: selection.decisionState } : {})
      }
    ];
  });
}

export function variantResult(
  variantName: LnsWindowRankerOnlineAblationVariantName,
  result: LnsBenchmarkCaseResult,
  baseline: LnsBenchmarkCaseResult,
  seed: number | null
): LnsWindowRankerOnlineAblationVariantResult {
  const populationDeltaVsBaseline = result.totalPopulation - baseline.totalPopulation;
  const overrides = overrideOutcomeCount(result);
  const fallbacks = fallbackOutcomeCount(result);
  const trajectory = timeToBestSummary(result);
  const baselineTrajectory = timeToBestSummary(baseline);
  return {
    variantName,
    description: VARIANT_DESCRIPTIONS[variantName],
    seed,
    totalPopulation: result.totalPopulation,
    populationDeltaVsBaseline,
    wallClockSeconds: result.wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: result.wallClockSeconds - baseline.wallClockSeconds,
    timeToBestIteration: trajectory.timeToBestIteration,
    timeToBestIterationDeltaVsBaseline: nullableDelta(
      trajectory.timeToBestIteration,
      baselineTrajectory.timeToBestIteration
    ),
    timeToBestWallClockSeconds: trajectory.timeToBestWallClockSeconds,
    timeToBestWallClockDeltaVsBaselineSeconds: nullableDelta(
      trajectory.timeToBestWallClockSeconds,
      baselineTrajectory.timeToBestWallClockSeconds
    ),
    roadCount: result.roadCount,
    roadDeltaVsBaseline: result.roadCount - baseline.roadCount,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    lnsOptions: result.lnsOptions,
    cpSatStatus: result.cpSatStatus,
    stopReason: result.lnsTelemetry?.stopReason ?? null,
    improvingIterations: result.lnsTelemetry?.improvingIterations ?? null,
    neutralIterations: result.lnsTelemetry?.neutralIterations ?? null,
    recoverableFailures: result.lnsTelemetry?.recoverableFailures ?? null,
    overrideOutcomeCount: overrides,
    fallbackOutcomeCount: fallbacks,
    overrideImprovedOutcomeCount: overrideOutcomeStatusCount(result, "improved"),
    overrideNeutralOutcomeCount: overrideOutcomeStatusCount(result, "neutral"),
    fallbackImprovedOutcomeCount: fallbackOutcomeStatusCount(result, "improved"),
    fallbackNeutralOutcomeCount: fallbackOutcomeStatusCount(result, "neutral"),
    meanOverrideScoreDelta: meanOverrideScoreDelta(result),
    selectionDiagnostics: buildLnsWindowRankerOnlineSelectionDiagnostics(result),
    selectionTrace: selectionTrace(result),
    finalLayoutDeltaVsBaseline: buildLnsWindowRankerOnlineFinalLayoutDelta(result, baseline),
    finalOutcome: finalOutcomes.buildLnsWindowRankerFinalOutcome(populationDeltaVsBaseline, overrides, fallbacks),
    windowRanker: summarizeWindowRanker(result)
  };
}

export function buildVariantSummary(
  variantName: LnsWindowRankerOnlineAblationVariantName,
  cases: readonly LnsWindowRankerOnlineAblationCaseResult[],
  caseCount: number,
  seedCount: number
): LnsWindowRankerOnlineAblationSummary {
  const missingResultMessage = `LNS window ranker online ablation result missing: ${variantName}.`;
  const caseResults = cases.map((entry) => {
    const result = entry.variants.find((candidate) => candidate.variantName === variantName);
    if (!result) {
      throw new Error(missingResultMessage);
    }
    return { benchmarkCase: entry, result };
  });
  const results = caseResults.map((entry) => entry.result);
  const timeToBestIterationDeltas = results.map((entry) => entry.timeToBestIterationDeltaVsBaseline);
  const knownTimeToBestIterationDeltas = timeToBestIterationDeltas.filter((delta): delta is number => delta !== null);
  const timeToBestWallClockRatios = caseResults.map(({ benchmarkCase, result }) =>
    finiteTimeToBestWallClockRatio(result, benchmarkCase.baseline)
  );
  const knownTimeToBestWallClockRatios = timeToBestWallClockRatios.filter((ratio): ratio is number => ratio !== null);
  const timeToBestWallClockFaster10PercentCount = sumBenchmarkBy(knownTimeToBestWallClockRatios, (ratio) =>
    ratio <= 0.9 ? 1 : 0
  );
  const timeToBestWallClockSlower10PercentCount = sumBenchmarkBy(knownTimeToBestWallClockRatios, (ratio) =>
    ratio >= 1.1 ? 1 : 0
  );
  const decisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.decisions ?? 0);
  const overrideCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.overrides ?? 0);
  const fallbackDecisionCount = sumBenchmarkBy(results, (entry) => entry.windowRanker?.fallbackDecisions ?? 0);
  const overrideOutcomeCount = sumBenchmarkBy(results, (entry) => entry.overrideOutcomeCount);
  const totalFinalLayoutPlacementDelta = sumBenchmarkBy(
    results,
    (entry) => entry.finalLayoutDeltaVsBaseline.placementDeltaCount
  );
  const overrideScoreDeltaWeightedSum = sumBenchmarkBy(
    results,
    (entry) => (entry.meanOverrideScoreDelta ?? 0) * entry.overrideOutcomeCount
  );
  const diagnostics = results
    .map((entry) => entry.selectionDiagnostics)
    .filter((entry): entry is LnsWindowRankerOnlineSelectionDiagnostics => entry !== null);
  const mergedDiagnostics = mergeLnsWindowRankerOnlineSelectionDiagnostics(diagnostics);
  const transitionOutcomeDiagnostics = buildLnsWindowRankerOnlineTransitionOutcomeDiagnostics(
    caseResults.map(({ benchmarkCase, result }) => ({
      pressureFamily: benchmarkCase.pressureFamily,
      finalOutcomeStatus: result.finalOutcome.status,
      selectionDiagnostics: result.selectionDiagnostics
    }))
  );
  const variantMetrics = summarizeBenchmarkVariantMetrics(
    variantName,
    cases,
    caseCount,
    seedCount,
    missingResultMessage
  );
  const equalPopulationTimeToBestGatePassed =
    variantMetrics.improvedCaseCount === 0 &&
    variantMetrics.regressedCaseCount === 0 &&
    variantMetrics.unchangedCaseCount === results.length;
  const medianTimeToBestWallClockRatioVsBaseline = medianNullableBenchmarkValue(timeToBestWallClockRatios);
  return {
    ...variantMetrics,
    description: VARIANT_DESCRIPTIONS[variantName],
    rankerDecisionCount: decisionCount,
    rankerOverrideCount: overrideCount,
    rankerFallbackDecisionCount: fallbackDecisionCount,
    rankerOverrideRate: benchmarkRatio(overrideCount, decisionCount),
    rankerFallbackRate: benchmarkRatio(fallbackDecisionCount, decisionCount),
    overrideOutcomeCount,
    fallbackOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackOutcomeCount),
    overrideImprovedOutcomeCount: sumBenchmarkBy(results, (entry) => entry.overrideImprovedOutcomeCount),
    overrideNeutralOutcomeCount: sumBenchmarkBy(results, (entry) => entry.overrideNeutralOutcomeCount),
    fallbackImprovedOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackImprovedOutcomeCount),
    fallbackNeutralOutcomeCount: sumBenchmarkBy(results, (entry) => entry.fallbackNeutralOutcomeCount),
    meanOverrideScoreDelta: overrideOutcomeCount > 0 ? overrideScoreDeltaWeightedSum / overrideOutcomeCount : null,
    overrideTransitionCounts: mergedDiagnostics.overrideTransitionCounts,
    fallbackTransitionCounts: mergedDiagnostics.fallbackTransitionCounts,
    overrideChangedWindowCount: mergedDiagnostics.overrideChangedWindowCount,
    fallbackChangedWindowCount: mergedDiagnostics.fallbackChangedWindowCount,
    overrideFeatureDeltaCount: mergedDiagnostics.overrideFeatureDeltaCount,
    fallbackFeatureDeltaCount: mergedDiagnostics.fallbackFeatureDeltaCount,
    overrideMeanFeatureDeltas: mergedDiagnostics.overrideMeanFeatureDeltas,
    fallbackMeanFeatureDeltas: mergedDiagnostics.fallbackMeanFeatureDeltas,
    overrideTransitionFeatureDeltaCounts: mergedDiagnostics.overrideTransitionFeatureDeltaCounts,
    fallbackTransitionFeatureDeltaCounts: mergedDiagnostics.fallbackTransitionFeatureDeltaCounts,
    overrideTransitionMeanFeatureDeltas: mergedDiagnostics.overrideTransitionMeanFeatureDeltas,
    fallbackTransitionMeanFeatureDeltas: mergedDiagnostics.fallbackTransitionMeanFeatureDeltas,
    overrideTransitionFinalOutcomeCounts: transitionOutcomeDiagnostics.overrideTransitionFinalOutcomeCounts,
    fallbackTransitionFinalOutcomeCounts: transitionOutcomeDiagnostics.fallbackTransitionFinalOutcomeCounts,
    overrideTransitionPressureFamilyCounts: transitionOutcomeDiagnostics.overrideTransitionPressureFamilyCounts,
    fallbackTransitionPressureFamilyCounts: transitionOutcomeDiagnostics.fallbackTransitionPressureFamilyCounts,
    overrideFinalOutcomeFeatureDeltaCounts: transitionOutcomeDiagnostics.overrideFinalOutcomeFeatureDeltaCounts,
    fallbackFinalOutcomeFeatureDeltaCounts: transitionOutcomeDiagnostics.fallbackFinalOutcomeFeatureDeltaCounts,
    overrideFinalOutcomeMeanFeatureDeltas: transitionOutcomeDiagnostics.overrideFinalOutcomeMeanFeatureDeltas,
    fallbackFinalOutcomeMeanFeatureDeltas: transitionOutcomeDiagnostics.fallbackFinalOutcomeMeanFeatureDeltas,
    overrideImprovedVsNeutralMeanFeatureDeltaGaps:
      transitionOutcomeDiagnostics.overrideImprovedVsNeutralMeanFeatureDeltaGaps,
    overrideRegressedVsNeutralMeanFeatureDeltaGaps:
      transitionOutcomeDiagnostics.overrideRegressedVsNeutralMeanFeatureDeltaGaps,
    selectionTraceCount: sumBenchmarkBy(results, (entry) => entry.selectionTrace.length),
    sameFinalLayoutCount: sumBenchmarkBy(results, (entry) =>
      entry.finalLayoutDeltaVsBaseline.sameFinalLayout ? 1 : 0
    ),
    changedFinalLayoutCount: sumBenchmarkBy(results, (entry) =>
      entry.finalLayoutDeltaVsBaseline.sameFinalLayout ? 0 : 1
    ),
    meanFinalLayoutPlacementDelta: benchmarkRatio(totalFinalLayoutPlacementDelta, results.length),
    meanTimeToBestIteration: meanNullableBenchmarkValue(results.map((entry) => entry.timeToBestIteration)),
    meanTimeToBestIterationDeltaVsBaseline: meanNullableBenchmarkValue(timeToBestIterationDeltas),
    meanTimeToBestWallClockSeconds: meanNullableBenchmarkValue(
      results.map((entry) => entry.timeToBestWallClockSeconds)
    ),
    meanTimeToBestWallClockDeltaVsBaselineSeconds: meanNullableBenchmarkValue(
      results.map((entry) => entry.timeToBestWallClockDeltaVsBaselineSeconds)
    ),
    timeToBestWallClockKnownPairCount: knownTimeToBestWallClockRatios.length,
    timeToBestWallClockUnknownPairCount: results.length - knownTimeToBestWallClockRatios.length,
    meanTimeToBestWallClockRatioVsBaseline: meanNullableBenchmarkValue(timeToBestWallClockRatios),
    medianTimeToBestWallClockRatioVsBaseline,
    timeToBestWallClockFaster10PercentCount,
    timeToBestWallClockSlower10PercentCount,
    timeToBestWallClockFaster10PercentRate: benchmarkRatio(
      timeToBestWallClockFaster10PercentCount,
      knownTimeToBestWallClockRatios.length
    ),
    timeToBestWallClockSlower10PercentRate: benchmarkRatio(
      timeToBestWallClockSlower10PercentCount,
      knownTimeToBestWallClockRatios.length
    ),
    equalPopulationTimeToBestGatePassed,
    timeToBestPromotionGatePassed:
      equalPopulationTimeToBestGatePassed &&
      knownTimeToBestWallClockRatios.length === results.length &&
      medianTimeToBestWallClockRatioVsBaseline !== null &&
      medianTimeToBestWallClockRatioVsBaseline <= 0.9 &&
      timeToBestWallClockSlower10PercentCount === 0,
    earlierTimeToBestCount: sumBenchmarkBy(knownTimeToBestIterationDeltas, (delta) => (delta < 0 ? 1 : 0)),
    sameTimeToBestCount: sumBenchmarkBy(knownTimeToBestIterationDeltas, (delta) => (delta === 0 ? 1 : 0)),
    laterTimeToBestCount: sumBenchmarkBy(knownTimeToBestIterationDeltas, (delta) => (delta > 0 ? 1 : 0)),
    unknownTimeToBestCount: results.length - knownTimeToBestIterationDeltas.length,
    ...finalOutcomes.summarizeLnsWindowRankerFinalOutcomes(results)
  };
}
