import {
  ATOM_CAP_SUMMARY_SEMANTICS_VERSION,
  DISCOVERY_IDENTITY_SCHEMA_VERSION,
  METRIC_SEMANTICS_VERSION,
  REPORT_IDENTITY_SCHEMA_VERSION
} from "./online-selected-feature-gate-config.mjs";
import { candidateReportProjection, compactMetrics } from "./online-selected-feature-gate-core.mjs";

function canonicalCappedAtomSummary(summary) {
  return {
    semanticsVersion: ATOM_CAP_SUMMARY_SEMANTICS_VERSION,
    strategy: summary.strategy,
    safeSingletonAdmissionQuota: summary.safeSingletonAdmissionQuota,
    candidateAtomUniverseCount: summary.candidateAtomUniverseCount,
    perFeatureCappedAtomCount: summary.perFeatureCappedAtomCount,
    perFeatureOmittedAtomCount: summary.perFeatureOmittedAtomCount,
    reservationCandidateAtomCount: summary.reservationCandidateAtomCount,
    safeTargetAtomCount: summary.safeTargetAtomCount,
    unsafeTargetAtomCount: summary.unsafeTargetAtomCount,
    perFeatureCappedSafeTargetAtomCount: summary.perFeatureCappedSafeTargetAtomCount,
    perFeatureCappedUnsafeTargetAtomCount: summary.perFeatureCappedUnsafeTargetAtomCount,
    includedSafeTargetAtomCount: summary.includedSafeTargetAtomCount,
    omittedSafeTargetAtomCount: summary.omittedSafeTargetAtomCount,
    includedUnsafeTargetAtomCount: summary.includedUnsafeTargetAtomCount,
    omittedUnsafeTargetAtomCount: summary.omittedUnsafeTargetAtomCount,
    reservedConjunctionAtomCount: summary.reservedConjunctionAtomCount,
    reservedPerFeatureOmittedConjunctionAtomCount: summary.reservedPerFeatureOmittedConjunctionAtomCount,
    includedReservedConjunctionAtomCount: summary.includedReservedConjunctionAtomCount,
    omittedReservedConjunctionAtomCount: summary.omittedReservedConjunctionAtomCount,
    reservedUnsafeConjunctionAtomCount: summary.reservedUnsafeConjunctionAtomCount,
    conjunctionReservationRequestedMaxGroupSize: summary.conjunctionReservationRequestedMaxGroupSize,
    conjunctionReservationSearchMaxGroupSize: summary.conjunctionReservationSearchMaxGroupSize,
    conjunctionReservationSupportsRequestedMaxGroupSize: summary.conjunctionReservationSupportsRequestedMaxGroupSize,
    conjunctionReservationSearchExhaustive: summary.conjunctionReservationSearchExhaustive,
    conjunctionReservationCoversRequestedMaxGroupSize: summary.conjunctionReservationCoversRequestedMaxGroupSize,
    conjunctionReservationAvailableUnsafeTargetAtomCount: summary.conjunctionReservationAvailableUnsafeTargetAtomCount,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      summary.conjunctionReservationConsideredUnsafeTargetAtomCount,
    conjunctionReservationAvailablePartnerAtomCount: summary.conjunctionReservationAvailablePartnerAtomCount,
    conjunctionReservationConsideredPartnerAtomCount: summary.conjunctionReservationConsideredPartnerAtomCount,
    conjunctionReservationSlicedUnsafeTargetAtoms: summary.conjunctionReservationSlicedUnsafeTargetAtoms,
    conjunctionReservationSlicedPartnerAtoms: summary.conjunctionReservationSlicedPartnerAtoms,
    conjunctionReservationReachedReservationAtomCap: summary.conjunctionReservationReachedReservationAtomCap,
    reservedConjunctionGroupCount: summary.reservedConjunctionGroupCount,
    reservedConjunctionPairCount: summary.reservedConjunctionPairCount,
    reservedConjunctionTripleCount: summary.reservedConjunctionTripleCount,
    conjunctionReservationExhaustedSearchBudget: summary.conjunctionReservationExhaustedSearchBudget,
    conjunctionReservationEvaluatedGroupCount: summary.conjunctionReservationEvaluatedGroupCount,
    conjunctionReservationMaxEvaluatedGroupCount: summary.conjunctionReservationMaxEvaluatedGroupCount,
    conjunctionReservationEvaluatedPairCount: summary.conjunctionReservationEvaluatedPairCount,
    conjunctionReservationMaxEvaluatedPairCount: summary.conjunctionReservationMaxEvaluatedPairCount,
    reservedConjunctionExamples: summary.reservedConjunctionExamples.map((candidate) => ({
      atomCount: candidate.atomCount,
      cliArg: candidate.cliArg,
      targetImproved: candidate.targetImproved,
      selected: candidate.selected
    }))
  };
}

function canonicalGreedyGroupSet(greedy) {
  return {
    groups: greedy.groups,
    selectedFeatureGateGroups: greedy.selectedFeatureGateGroups,
    cliArg: greedy.cliArg,
    uncoveredPositiveCount: greedy.uncoveredPositiveCount,
    selected: greedy.selected,
    targetImproved: greedy.targetImproved,
    selectionImproved: greedy.selectionImproved,
    selectionRegressed: greedy.selectionRegressed,
    terminalFinalImproved: greedy.terminalFinalImproved,
    terminalFinalRegressed: greedy.terminalFinalRegressed,
    finalImproved: greedy.finalImproved,
    finalRegressed: greedy.finalRegressed,
    safetyRegressed: greedy.safetyRegressed,
    neutral: greedy.neutral,
    unknown: greedy.unknown,
    bestFinalDelta: greedy.bestFinalDelta,
    worstFinalDelta: greedy.worstFinalDelta,
    selectedKeys: greedy.selectedKeys.slice().sort(),
    positiveKeys: greedy.positiveKeys.slice().sort(),
    safeNoRegression: greedy.safeNoRegression
  };
}

function canonicalValidationGreedyGroupSet(greedy) {
  if (!greedy) return null;
  return {
    groups: greedy.groups,
    selectedFeatureGateGroups: greedy.selectedFeatureGateGroups,
    cliArg: greedy.cliArg,
    uncoveredPositiveCount: greedy.uncoveredPositiveCount,
    source: {
      ...compactMetrics(greedy.source),
      selectedKeys: greedy.source.selectedKeys.slice().sort(),
      positiveKeys: greedy.source.positiveKeys.slice().sort()
    },
    validation: {
      ...compactMetrics(greedy.validation),
      selectedKeys: greedy.validation.selectedKeys.slice().sort(),
      positiveKeys: greedy.validation.positiveKeys.slice().sort()
    }
  };
}

function discoveryIdentityPayload(payload) {
  return {
    schemaVersion: DISCOVERY_IDENTITY_SCHEMA_VERSION,
    artifactSchemaVersion: payload.schemaVersion,
    target: payload.target,
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
    v2DeprecatedMetricAliasSchemaVersion: payload.v2DeprecatedMetricAliases.schemaVersion,
    sourceScorecards: payload.sourceScorecards,
    validationSourceScorecards: payload.validationSourceScorecards,
    featureAllowlist: payload.featureAllowlist,
    features: payload.features,
    maxGroupSize: payload.maxGroupSize,
    maxAtomsPerFeature: payload.maxAtomsPerFeature,
    maxTotalAtoms: payload.maxTotalAtoms,
    totalCandidateAtomCount: payload.totalCandidateAtomCount,
    perFeatureCappedAtomCount: payload.perFeatureCappedAtomCount,
    atomCount: payload.atomCount,
    cappedAtomSummary: canonicalCappedAtomSummary(payload.cappedAtomSummary),
    rowSummary: payload.rowSummary,
    validationRowSummary: payload.validationRowSummary,
    candidateCount: payload.candidateCount,
    greedySelectedGateGroups: canonicalGreedyGroupSet(payload.greedySelectedGateGroups),
    validationGreedySelectedGateGroups: canonicalValidationGreedyGroupSet(payload.validationGreedySelectedGateGroups)
  };
}

function reportMetricsPayload(discovery) {
  return {
    sourceScorecardCount: discovery.sourceScorecards.length,
    validationSourceScorecardCount: discovery.validationSourceScorecards.length,
    overrideTraceCount: discovery.rowSummary.overrideTraceCount,
    targetImproved: discovery.rowSummary.targetImproved,
    selectionImproved: discovery.rowSummary.selectionImproved,
    selectionRegressed: discovery.rowSummary.selectionRegressed,
    terminalFinalImproved: discovery.rowSummary.terminalFinalImproved,
    terminalFinalRegressed: discovery.rowSummary.terminalFinalRegressed,
    finalImproved: discovery.rowSummary.finalImproved,
    finalRegressed: discovery.rowSummary.finalRegressed,
    safetyRegressed: discovery.rowSummary.safetyRegressed,
    validationOverrideTraceCount: discovery.validationRowSummary.overrideTraceCount,
    validationTargetImproved: discovery.validationRowSummary.targetImproved,
    validationSelectionImproved: discovery.validationRowSummary.selectionImproved,
    validationSelectionRegressed: discovery.validationRowSummary.selectionRegressed,
    validationTerminalFinalImproved: discovery.validationRowSummary.terminalFinalImproved,
    validationTerminalFinalRegressed: discovery.validationRowSummary.terminalFinalRegressed,
    validationFinalImproved: discovery.validationRowSummary.finalImproved,
    validationFinalRegressed: discovery.validationRowSummary.finalRegressed,
    validationSafetyRegressed: discovery.validationRowSummary.safetyRegressed,
    totalCandidateAtomCount: discovery.totalCandidateAtomCount,
    perFeatureCappedAtomCount: discovery.perFeatureCappedAtomCount,
    atomCount: discovery.atomCount,
    cappedAtomSummary: canonicalCappedAtomSummary(discovery.cappedAtomSummary),
    candidateCount: discovery.candidateCount,
    topCandidateCount: discovery.topCandidateCount,
    topCandidateCliArg: discovery.topCandidates[0]?.cliArg ?? null,
    topCandidates: discovery.topCandidates.map(candidateReportProjection),
    greedySelectedGateGroups: {
      groups: discovery.greedySelectedGateGroups.groups,
      selectedFeatureGateGroups: discovery.greedySelectedGateGroups.selectedFeatureGateGroups,
      cliArg: discovery.greedySelectedGateGroups.cliArg,
      selected: discovery.greedySelectedGateGroups.selected,
      targetImproved: discovery.greedySelectedGateGroups.targetImproved,
      selectionImproved: discovery.greedySelectedGateGroups.selectionImproved,
      selectionRegressed: discovery.greedySelectedGateGroups.selectionRegressed,
      terminalFinalImproved: discovery.greedySelectedGateGroups.terminalFinalImproved,
      terminalFinalRegressed: discovery.greedySelectedGateGroups.terminalFinalRegressed,
      finalImproved: discovery.greedySelectedGateGroups.finalImproved,
      finalRegressed: discovery.greedySelectedGateGroups.finalRegressed,
      safetyRegressed: discovery.greedySelectedGateGroups.safetyRegressed,
      neutral: discovery.greedySelectedGateGroups.neutral,
      safeNoRegression: discovery.greedySelectedGateGroups.safeNoRegression
    },
    validationGreedySelectedGateGroups: discovery.validationGreedySelectedGateGroups
      ? {
          groups: discovery.validationGreedySelectedGateGroups.groups,
          selectedFeatureGateGroups: discovery.validationGreedySelectedGateGroups.selectedFeatureGateGroups,
          cliArg: discovery.validationGreedySelectedGateGroups.cliArg,
          selected: discovery.validationGreedySelectedGateGroups.selected,
          targetImproved: discovery.validationGreedySelectedGateGroups.targetImproved,
          selectionImproved: discovery.validationGreedySelectedGateGroups.selectionImproved,
          selectionRegressed: discovery.validationGreedySelectedGateGroups.selectionRegressed,
          terminalFinalImproved: discovery.validationGreedySelectedGateGroups.terminalFinalImproved,
          terminalFinalRegressed: discovery.validationGreedySelectedGateGroups.terminalFinalRegressed,
          finalImproved: discovery.validationGreedySelectedGateGroups.finalImproved,
          finalRegressed: discovery.validationGreedySelectedGateGroups.finalRegressed,
          safetyRegressed: discovery.validationGreedySelectedGateGroups.safetyRegressed,
          neutral: discovery.validationGreedySelectedGateGroups.neutral,
          safeNoRegression: discovery.validationGreedySelectedGateGroups.safeNoRegression,
          source: compactMetrics(discovery.validationGreedySelectedGateGroups.source),
          validation: compactMetrics(discovery.validationGreedySelectedGateGroups.validation)
        }
      : null
  };
}

function registryDisplayProjection(rows) {
  return {
    cases: [...new Set(rows.map((row) => row.caseName))].sort(),
    caseFamilies: [
      "lns-window-ranker-online",
      ...new Set(rows.map((row) => row.pressureFamily).filter(Boolean))
    ].sort(),
    seeds: [...new Set(rows.map((row) => row.seed).filter((seed) => seed !== null))].sort((left, right) => left - right)
  };
}

function reportIdentityPayload({ discovery, command, artifactDir, outputArtifacts, top, registryDisplay }) {
  return {
    schemaVersion: REPORT_IDENTITY_SCHEMA_VERSION,
    source: "lns-online-selected-feature-gate-discovery",
    discoveryFingerprint: discovery.discoveryFingerprint,
    top,
    reportMetrics: reportMetricsPayload(discovery),
    registryDisplay,
    command,
    artifactDir,
    outputArtifacts
  };
}

export { discoveryIdentityPayload, registryDisplayProjection, reportIdentityPayload };
