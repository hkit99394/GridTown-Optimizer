function uniqueSortedNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function stableNumberKey(value) {
  return Number.isInteger(value) ? String(value) : value.toString();
}

function isPositive(row, target) {
  return target === "final-improved"
    ? row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved"
    : row.selectionOutcomeStatus === "improved";
}

function isSelectionRegression(row) {
  return row.selectionOutcomeStatus === "regressed";
}

function isFinalRegression(row) {
  return row.finalOutcomeAttributed && row.finalOutcomeStatus === "regressed";
}

function isSafetyRegression(row) {
  return isSelectionRegression(row) || row.finalOutcomeStatus === "regressed";
}

function gatePasses(row, gate) {
  const value = row.selectedFeatures[gate.feature];
  return (
    Number.isFinite(value) &&
    (gate.minValue === undefined || value >= gate.minValue) &&
    (gate.maxValue === undefined || value <= gate.maxValue)
  );
}

function atomToGates(atom) {
  return atom.kind === "eq"
    ? [
        { feature: atom.feature, minValue: atom.value },
        { feature: atom.feature, maxValue: atom.value }
      ]
    : atom.kind === "min"
      ? [{ feature: atom.feature, minValue: atom.value }]
      : [{ feature: atom.feature, maxValue: atom.value }];
}

function atomSignature(atom) {
  return `${atom.feature}:${atom.kind}:${stableNumberKey(atom.value)}`;
}

function gateCliArg(gate) {
  return gate.minValue === undefined
    ? `${gate.feature}<=${stableNumberKey(gate.maxValue)}`
    : `${gate.feature}>=${stableNumberKey(gate.minValue)}`;
}

function gatesCliArg(gates) {
  return gates.map(gateCliArg).join(",");
}

function evaluatePredicate(rows, predicate, target) {
  const selectedRows = rows.filter(predicate);
  const selectedKeys = selectedRows.map((row) => row.key);
  const positiveKeys = selectedRows.filter((row) => isPositive(row, target)).map((row) => row.key);
  const selectionRegressionRows = selectedRows.filter(isSelectionRegression);
  const finalRegressionRows = selectedRows.filter(isFinalRegression);
  const safetyRegressionRows = selectedRows.filter(isSafetyRegression);
  return {
    selected: selectedRows.length,
    targetImproved: positiveKeys.length,
    selectionImproved: selectedRows.filter((row) => row.selectionOutcomeStatus === "improved").length,
    selectionRegressed: selectionRegressionRows.length,
    terminalFinalImproved: selectedRows.filter(
      (row) => row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved"
    ).length,
    terminalFinalRegressed: finalRegressionRows.length,
    finalImproved: selectedRows.filter((row) => row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved")
      .length,
    finalRegressed: finalRegressionRows.length,
    safetyRegressed: safetyRegressionRows.length,
    neutral: selectedRows.filter((row) => !isPositive(row, target) && !isSafetyRegression(row)).length,
    unknown: selectedRows.filter(
      (row) => row.selectionOutcomeStatus === "unknown" || row.finalOutcomeStatus === "unknown"
    ).length,
    bestFinalDelta: selectedRows.length ? Math.max(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    worstFinalDelta: selectedRows.length ? Math.min(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    selectedKeys,
    positiveKeys,
    regressionExamples: safetyRegressionRows.slice(0, 8).map(rowExample),
    selectionRegressionExamples: selectionRegressionRows.slice(0, 8).map(rowExample),
    finalRegressionExamples: finalRegressionRows.slice(0, 8).map(rowExample),
    safetyRegressionExamples: safetyRegressionRows.slice(0, 8).map(rowExample),
    positiveExamples: selectedRows
      .filter((row) => isPositive(row, target))
      .slice(0, 8)
      .map(rowExample)
  };
}

function evaluateGates(rows, gates, target) {
  return evaluatePredicate(rows, (row) => gates.every((gate) => gatePasses(row, gate)), target);
}

function withSafetyFlag(metrics) {
  return {
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0
  };
}

function rowSummaryFromMetrics(metrics) {
  return {
    overrideTraceCount: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta
  };
}

function rowExample(row) {
  return {
    sourceScorecard: row.sourceScorecard,
    caseIndex: row.caseIndex,
    caseName: row.caseName,
    pressureFamily: row.pressureFamily,
    seed: row.seed,
    variantIndex: row.variantIndex,
    traceIndex: row.traceIndex,
    iteration: row.iteration,
    transition: row.transition,
    selectedOperator: row.selectedOperator,
    selectedWindow: row.selectedWindow,
    selectionOutcomeStatus: row.selectionOutcomeStatus,
    finalOutcomeAttributed: row.finalOutcomeAttributed,
    finalOutcomeAttribution: row.finalOutcomeAttribution,
    finalOutcomeStatus: row.finalOutcomeStatus,
    finalPopulationDelta: row.finalPopulationDelta,
    selectedFeatures: row.selectedFeatures
  };
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])])
  );
}

function exampleReportProjection(example) {
  return {
    sourceScorecard: example.sourceScorecard,
    caseIndex: example.caseIndex,
    caseName: example.caseName,
    pressureFamily: example.pressureFamily,
    seed: example.seed,
    variantIndex: example.variantIndex,
    traceIndex: example.traceIndex,
    iteration: example.iteration,
    transition: example.transition,
    selectedOperator: example.selectedOperator,
    selectedWindow: canonicalJsonValue(example.selectedWindow),
    selectionOutcomeStatus: example.selectionOutcomeStatus,
    finalOutcomeAttributed: example.finalOutcomeAttributed,
    finalOutcomeAttribution: example.finalOutcomeAttribution,
    finalOutcomeStatus: example.finalOutcomeStatus,
    finalPopulationDelta: example.finalPopulationDelta,
    selectedFeatures: canonicalJsonValue(example.selectedFeatures)
  };
}

function compareCandidates(left, right) {
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  if (left.atomCount !== right.atomCount) return left.atomCount - right.atomCount;
  return left.cliArg.localeCompare(right.cliArg);
}

function compareCandidatesWithValidation(left, right) {
  const leftValidation = left.validation;
  const rightValidation = right.validation;
  if (!leftValidation || !rightValidation) return compareCandidates(left, right);

  const leftSafePositive = leftValidation.safeNoRegression && leftValidation.targetImproved > 0 ? 1 : 0;
  const rightSafePositive = rightValidation.safeNoRegression && rightValidation.targetImproved > 0 ? 1 : 0;
  if (leftSafePositive !== rightSafePositive) return rightSafePositive - leftSafePositive;
  if (leftValidation.safetyRegressed !== rightValidation.safetyRegressed) {
    return leftValidation.safetyRegressed - rightValidation.safetyRegressed;
  }
  if (leftValidation.targetImproved !== rightValidation.targetImproved) {
    return rightValidation.targetImproved - leftValidation.targetImproved;
  }
  if (leftValidation.neutral !== rightValidation.neutral) return leftValidation.neutral - rightValidation.neutral;
  if (leftValidation.selected !== rightValidation.selected) return leftValidation.selected - rightValidation.selected;
  return compareCandidates(left, right);
}

function compareAtoms(left, right) {
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  return left.signature.localeCompare(right.signature);
}

function compareAtomsSafetyFirst(left, right) {
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  return left.signature.localeCompare(right.signature);
}

function atomComparatorForTarget(target) {
  return target === "final-improved" ? compareAtomsSafetyFirst : compareAtoms;
}

function sortedUniqueAtoms(atoms, compareAtomsForTarget) {
  const seen = new Set();
  const unique = [];
  for (const atom of atoms.sort(compareAtomsForTarget)) {
    if (seen.has(atom.signature)) continue;
    seen.add(atom.signature);
    unique.push(atom);
  }
  return unique;
}

function discoverConjunctionReservations(rawAtoms, rows, target, maxGroupSize, maxTotalAtoms) {
  if (maxGroupSize < 2 || maxTotalAtoms < 2) {
    return {
      reservedAtoms: [],
      reservedConjunctions: [],
      reservedPairs: [],
      requestedMaxGroupSize: maxGroupSize,
      searchMaxGroupSize: maxGroupSize < 2 ? 1 : maxGroupSize,
      supportsRequestedMaxGroupSize: true,
      reservationSearchExhaustive: true,
      coversRequestedMaxGroupSize: true,
      searchDescription: "No conjunction reservation search needed for singleton-only discovery.",
      availableUnsafeTargetAtomCount: 0,
      consideredUnsafeTargetAtomCount: 0,
      availablePartnerAtomCount: 0,
      consideredPartnerAtomCount: 0,
      evaluatedConjunctionGroupCount: 0,
      maxEvaluatedConjunctionGroupCount: 0,
      evaluatedPairCount: 0,
      maxEvaluatedPairCount: 0
    };
  }
  const compareTargetAtoms = atomComparatorForTarget(target);
  const availableUnsafeTargetAtoms = rawAtoms
    .filter((atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0)
    .sort(compareTargetAtoms);
  const availablePartnerAtoms = rawAtoms.filter((atom) => atom.targetImproved > 0).sort(compareTargetAtoms);
  const unsafeTargetAtomConsiderationLimit = Math.max(maxTotalAtoms, 8);
  const partnerAtomConsiderationLimit = Math.max(maxTotalAtoms * 4, 16);
  const unsafeTargetAtoms = availableUnsafeTargetAtoms.slice(0, unsafeTargetAtomConsiderationLimit);
  const partnerAtoms = availablePartnerAtoms.slice(0, partnerAtomConsiderationLimit);
  const slicedUnsafeTargetAtoms = unsafeTargetAtoms.length < availableUnsafeTargetAtoms.length;
  const slicedPartnerAtoms = partnerAtoms.length < availablePartnerAtoms.length;
  const maxEvaluatedConjunctionGroupCount = Math.max(maxTotalAtoms * 128 * (maxGroupSize - 1), 128);
  const reserved = new Map();
  const reservedConjunctions = [];
  const evaluatedSignatures = new Set();
  let evaluatedConjunctionGroupCount = 0;
  let evaluatedConjunctionPairCount = 0;
  let exhaustedSearchBudget = false;
  let reachedReservationAtomCap = false;

  for (const unsafeAtom of unsafeTargetAtoms) {
    const group = [unsafeAtom];
    const usedFeatures = new Set([unsafeAtom.feature]);

    function visit(start) {
      if (reserved.size >= maxTotalAtoms || exhaustedSearchBudget) {
        if (reserved.size >= maxTotalAtoms) reachedReservationAtomCap = true;
        return;
      }
      if (group.length >= 2) {
        const signature = group
          .map((atom) => atom.signature)
          .sort()
          .join("|");
        if (!evaluatedSignatures.has(signature)) {
          evaluatedSignatures.add(signature);
          evaluatedConjunctionGroupCount += 1;
          if (group.length === 2) evaluatedConjunctionPairCount += 1;
          if (evaluatedConjunctionGroupCount > maxEvaluatedConjunctionGroupCount) {
            exhaustedSearchBudget = true;
            return;
          }
          const missingAtoms = group.filter((atom) => !reserved.has(atom.signature));
          if (reserved.size + missingAtoms.length <= maxTotalAtoms) {
            const candidate = buildCandidate(group, rows, target);
            if (candidate.safeNoRegression) {
              for (const atom of missingAtoms) reserved.set(atom.signature, atom);
              reservedConjunctions.push({
                atomCount: candidate.atomCount,
                cliArg: candidate.cliArg,
                targetImproved: candidate.targetImproved,
                selected: candidate.selected
              });
              if (reserved.size >= maxTotalAtoms) {
                reachedReservationAtomCap = true;
                return;
              }
            }
          }
        }
      }
      if (group.length >= maxGroupSize) return;
      for (let index = start; index < partnerAtoms.length; index += 1) {
        const partnerAtom = partnerAtoms[index];
        if (unsafeAtom.signature === partnerAtom.signature || usedFeatures.has(partnerAtom.feature)) continue;
        usedFeatures.add(partnerAtom.feature);
        group.push(partnerAtom);
        visit(index + 1);
        group.pop();
        usedFeatures.delete(partnerAtom.feature);
        if (reserved.size >= maxTotalAtoms || exhaustedSearchBudget) return;
      }
    }

    visit(0);
    if (exhaustedSearchBudget || reserved.size >= maxTotalAtoms) {
      if (reserved.size >= maxTotalAtoms) reachedReservationAtomCap = true;
      break;
    }
  }

  const reservedPairs = reservedConjunctions.filter((candidate) => candidate.atomCount === 2);
  const searchMaxGroupSize = maxGroupSize;
  const supportsRequestedMaxGroupSize = searchMaxGroupSize >= maxGroupSize;
  const reservationSearchExhaustive =
    !slicedUnsafeTargetAtoms && !slicedPartnerAtoms && !exhaustedSearchBudget && !reachedReservationAtomCap;
  return {
    reservedAtoms: sortedUniqueAtoms([...reserved.values()], compareTargetAtoms),
    reservedConjunctions,
    reservedPairs,
    requestedMaxGroupSize: maxGroupSize,
    searchMaxGroupSize,
    supportsRequestedMaxGroupSize,
    reservationSearchExhaustive,
    coversRequestedMaxGroupSize: supportsRequestedMaxGroupSize && reservationSearchExhaustive,
    searchDescription: reservationSearchExhaustive
      ? "Exhaustive recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size."
      : "Bounded recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size.",
    availableUnsafeTargetAtomCount: availableUnsafeTargetAtoms.length,
    consideredUnsafeTargetAtomCount: unsafeTargetAtoms.length,
    availablePartnerAtomCount: availablePartnerAtoms.length,
    consideredPartnerAtomCount: partnerAtoms.length,
    slicedUnsafeTargetAtoms,
    slicedPartnerAtoms,
    reachedReservationAtomCap,
    exhaustedSearchBudget,
    evaluatedConjunctionGroupCount,
    maxEvaluatedConjunctionGroupCount,
    evaluatedPairCount: evaluatedConjunctionPairCount,
    maxEvaluatedPairCount: maxEvaluatedConjunctionGroupCount
  };
}

function selectCappedAtoms(
  rawAtoms,
  maxTotalAtoms,
  target,
  { rows = [], maxGroupSize = 1, reservationAtoms = rawAtoms } = {}
) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const sortedRawAtoms = rawAtoms.slice().sort(compareTargetAtoms);
  const sortedReservationAtoms = sortedUniqueAtoms(reservationAtoms.slice(), compareTargetAtoms);
  const conjunctionReservations = discoverConjunctionReservations(
    sortedReservationAtoms,
    rows,
    target,
    maxGroupSize,
    maxTotalAtoms
  );
  const rawAtomSignatures = new Set(sortedRawAtoms.map((atom) => atom.signature));
  const hasExternalReservedAtom = conjunctionReservations.reservedAtoms.some(
    (atom) => !rawAtomSignatures.has(atom.signature)
  );
  if (rawAtoms.length <= maxTotalAtoms && !hasExternalReservedAtom) {
    return {
      atoms: sortedRawAtoms,
      capDetails: {
        strategy: "uncapped",
        reservationCandidateAtomCount: sortedReservationAtoms.length,
        conjunctionReservations
      }
    };
  }

  const selectedAtoms = [];
  const selectedSignatures = new Set();
  const addAtom = (atom) => {
    if (selectedAtoms.length >= maxTotalAtoms || selectedSignatures.has(atom.signature)) return false;
    selectedAtoms.push(atom);
    selectedSignatures.add(atom.signature);
    return true;
  };

  const safeTargetAtoms = sortedRawAtoms.filter((atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0);
  for (const atom of conjunctionReservations.reservedAtoms) addAtom(atom);

  const safeSingletonCapacity = Math.max(0, maxTotalAtoms - selectedAtoms.length);
  const safeSingletonAdmissionQuota =
    safeTargetAtoms.length === 0 || safeSingletonCapacity === 0
      ? 0
      : Math.min(safeTargetAtoms.length, safeSingletonCapacity, Math.max(1, Math.ceil(maxTotalAtoms / 2)));
  for (const safeAtom of safeTargetAtoms.slice(0, safeSingletonAdmissionQuota)) addAtom(safeAtom);

  const safeAtoms = sortedRawAtoms.filter((atom) => atom.safetyRegressed === 0);
  for (const safeAtom of safeAtoms) addAtom(safeAtom);

  for (const atom of sortedRawAtoms) addAtom(atom);

  return {
    atoms: selectedAtoms.sort(compareTargetAtoms),
    capDetails: {
      strategy: maxGroupSize > 1 ? "conjunction-reservations-first-safe-singleton-fill" : "safe-singleton-first",
      safeSingletonAdmissionQuota,
      reservationCandidateAtomCount: sortedReservationAtoms.length,
      conjunctionReservations
    }
  };
}

function atomCapSummary(totalCandidateAtoms, perFeatureCappedAtoms, atoms, capDetails) {
  const included = new Set(atoms.map((atom) => atom.signature));
  const perFeatureCapped = new Set(perFeatureCappedAtoms.map((atom) => atom.signature));
  const safeTargetAtoms = totalCandidateAtoms.filter((atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0);
  const unsafeTargetAtoms = totalCandidateAtoms.filter((atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0);
  const perFeatureCappedSafeTargetAtoms = perFeatureCappedAtoms.filter(
    (atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0
  );
  const perFeatureCappedUnsafeTargetAtoms = perFeatureCappedAtoms.filter(
    (atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0
  );
  const reservedConjunctionAtoms = capDetails?.conjunctionReservations?.reservedAtoms ?? [];
  const reservedConjunctionAtomSignatures = new Set(reservedConjunctionAtoms.map((atom) => atom.signature));
  return {
    strategy: capDetails?.strategy ?? "unknown",
    safeSingletonAdmissionQuota: capDetails?.safeSingletonAdmissionQuota ?? 0,
    candidateAtomUniverseCount: totalCandidateAtoms.length,
    perFeatureCappedAtomCount: perFeatureCappedAtoms.length,
    perFeatureOmittedAtomCount: totalCandidateAtoms.filter((atom) => !perFeatureCapped.has(atom.signature)).length,
    reservationCandidateAtomCount:
      capDetails?.reservationCandidateAtomCount ?? capDetails?.conjunctionReservations?.reservedAtoms?.length ?? 0,
    safeTargetAtomCount: safeTargetAtoms.length,
    unsafeTargetAtomCount: unsafeTargetAtoms.length,
    perFeatureCappedSafeTargetAtomCount: perFeatureCappedSafeTargetAtoms.length,
    perFeatureCappedUnsafeTargetAtomCount: perFeatureCappedUnsafeTargetAtoms.length,
    includedSafeTargetAtomCount: safeTargetAtoms.filter((atom) => included.has(atom.signature)).length,
    omittedSafeTargetAtomCount: safeTargetAtoms.filter((atom) => !included.has(atom.signature)).length,
    includedUnsafeTargetAtomCount: unsafeTargetAtoms.filter((atom) => included.has(atom.signature)).length,
    omittedUnsafeTargetAtomCount: unsafeTargetAtoms.filter((atom) => !included.has(atom.signature)).length,
    reservedConjunctionAtomCount: reservedConjunctionAtoms.length,
    reservedPerFeatureOmittedConjunctionAtomCount: reservedConjunctionAtoms.filter(
      (atom) => !perFeatureCapped.has(atom.signature)
    ).length,
    includedReservedConjunctionAtomCount: reservedConjunctionAtoms.filter((atom) => included.has(atom.signature))
      .length,
    omittedReservedConjunctionAtomCount: reservedConjunctionAtoms.filter((atom) => !included.has(atom.signature))
      .length,
    reservedUnsafeConjunctionAtomCount: unsafeTargetAtoms.filter((atom) =>
      reservedConjunctionAtomSignatures.has(atom.signature)
    ).length,
    conjunctionReservationRequestedMaxGroupSize: capDetails?.conjunctionReservations?.requestedMaxGroupSize ?? 1,
    conjunctionReservationSearchMaxGroupSize: capDetails?.conjunctionReservations?.searchMaxGroupSize ?? 1,
    conjunctionReservationSupportsRequestedMaxGroupSize:
      capDetails?.conjunctionReservations?.supportsRequestedMaxGroupSize ?? true,
    conjunctionReservationSearchExhaustive: capDetails?.conjunctionReservations?.reservationSearchExhaustive ?? true,
    conjunctionReservationCoversRequestedMaxGroupSize:
      capDetails?.conjunctionReservations?.coversRequestedMaxGroupSize ?? true,
    conjunctionReservationSearchDescription:
      capDetails?.conjunctionReservations?.searchDescription ??
      "Bounded recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size.",
    conjunctionReservationAvailableUnsafeTargetAtomCount:
      capDetails?.conjunctionReservations?.availableUnsafeTargetAtomCount ?? 0,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      capDetails?.conjunctionReservations?.consideredUnsafeTargetAtomCount ?? 0,
    conjunctionReservationAvailablePartnerAtomCount:
      capDetails?.conjunctionReservations?.availablePartnerAtomCount ?? 0,
    conjunctionReservationConsideredPartnerAtomCount:
      capDetails?.conjunctionReservations?.consideredPartnerAtomCount ?? 0,
    conjunctionReservationSlicedUnsafeTargetAtoms:
      capDetails?.conjunctionReservations?.slicedUnsafeTargetAtoms ?? false,
    conjunctionReservationSlicedPartnerAtoms: capDetails?.conjunctionReservations?.slicedPartnerAtoms ?? false,
    conjunctionReservationReachedReservationAtomCap:
      capDetails?.conjunctionReservations?.reachedReservationAtomCap ?? false,
    reservedConjunctionGroupCount: capDetails?.conjunctionReservations?.reservedConjunctions?.length ?? 0,
    reservedConjunctionPairCount: capDetails?.conjunctionReservations?.reservedPairs?.length ?? 0,
    reservedConjunctionTripleCount:
      capDetails?.conjunctionReservations?.reservedConjunctions?.filter((candidate) => candidate.atomCount === 3)
        .length ?? 0,
    conjunctionReservationExhaustedSearchBudget: capDetails?.conjunctionReservations?.exhaustedSearchBudget ?? false,
    conjunctionReservationEvaluatedGroupCount: capDetails?.conjunctionReservations?.evaluatedConjunctionGroupCount ?? 0,
    conjunctionReservationMaxEvaluatedGroupCount:
      capDetails?.conjunctionReservations?.maxEvaluatedConjunctionGroupCount ?? 0,
    conjunctionReservationEvaluatedPairCount: capDetails?.conjunctionReservations?.evaluatedPairCount ?? 0,
    conjunctionReservationMaxEvaluatedPairCount: capDetails?.conjunctionReservations?.maxEvaluatedPairCount ?? 0,
    reservedConjunctionExamples: (capDetails?.conjunctionReservations?.reservedConjunctions ?? []).slice(0, 8)
  };
}

function selectCappedFeatureAtoms(featureAtoms, maxAtomsPerFeature, target, maxGroupSize) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const sortedFeatureAtoms = featureAtoms.slice().sort(compareTargetAtoms);
  if (sortedFeatureAtoms.length <= maxAtomsPerFeature) return sortedFeatureAtoms;

  const selectedAtoms = [];
  const selectedSignatures = new Set();
  const addAtom = (atom) => {
    if (selectedAtoms.length >= maxAtomsPerFeature || selectedSignatures.has(atom.signature)) return false;
    selectedAtoms.push(atom);
    selectedSignatures.add(atom.signature);
    return true;
  };

  const unsafeReservation =
    maxGroupSize > 1 && maxAtomsPerFeature >= 2
      ? Math.min(
          sortedFeatureAtoms.filter((atom) => atom.safetyRegressed > 0).length,
          Math.max(1, Math.floor(maxAtomsPerFeature / 3))
        )
      : 0;
  const safeCapacity = Math.max(0, maxAtomsPerFeature - unsafeReservation);
  for (const atom of sortedFeatureAtoms.filter((candidate) => candidate.safetyRegressed === 0).slice(0, safeCapacity)) {
    addAtom(atom);
  }
  for (const atom of sortedFeatureAtoms
    .filter((candidate) => candidate.safetyRegressed > 0)
    .slice(0, unsafeReservation)) {
    addAtom(atom);
  }
  for (const atom of sortedFeatureAtoms) addAtom(atom);
  return selectedAtoms.sort(compareTargetAtoms);
}

function buildAtoms(rows, features, maxAtomsPerFeature, target, maxGroupSize) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const totalCandidateAtoms = [];
  const perFeatureCappedAtoms = [];
  for (const feature of features) {
    const featureAtoms = uniqueSortedNumbers(rows.map((row) => row.selectedFeatures[feature]))
      .flatMap((value) => [
        { feature, kind: "eq", value },
        { feature, kind: "min", value },
        { feature, kind: "max", value }
      ])
      .map((atom) => ({
        ...atom,
        signature: atomSignature(atom),
        gates: atomToGates(atom),
        ...evaluatePredicate(rows, (row) => atomToGates(atom).every((gate) => gatePasses(row, gate)), target)
      }))
      .filter((atom) => atom.targetImproved > 0)
      .sort(compareTargetAtoms);
    totalCandidateAtoms.push(...featureAtoms);
    perFeatureCappedAtoms.push(...selectCappedFeatureAtoms(featureAtoms, maxAtomsPerFeature, target, maxGroupSize));
  }
  return {
    totalCandidateAtoms: sortedUniqueAtoms(totalCandidateAtoms, compareTargetAtoms),
    perFeatureCappedAtoms: sortedUniqueAtoms(perFeatureCappedAtoms, compareTargetAtoms)
  };
}

function buildCandidate(atomGroup, rows, target, validationRows = []) {
  const gates = atomGroup.flatMap(atomToGates);
  const cliArg = gatesCliArg(gates);
  const metrics = evaluateGates(rows, gates, target);
  const validationMetrics =
    validationRows.length > 0 ? withSafetyFlag(evaluateGates(validationRows, gates, target)) : null;
  return {
    atomCount: atomGroup.length,
    atoms: atomGroup.map(({ feature, kind, value, signature }) => ({ feature, kind, value, signature })),
    gates,
    cliArg,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0,
    validation: validationMetrics
  };
}

function enumerateCandidates(rows, atoms, maxGroupSize, target, validationRows = []) {
  const candidates = [];
  const seen = new Set();

  function visit(start, group, usedFeatures) {
    if (group.length > 0) {
      const candidate = buildCandidate(group, rows, target, validationRows);
      const signature = candidate.cliArg;
      if (!seen.has(signature)) {
        seen.add(signature);
        if (candidate.targetImproved > 0 && candidate.safetyRegressed === 0) candidates.push(candidate);
      }
    }
    if (group.length >= maxGroupSize) return;
    for (let index = start; index < atoms.length; index += 1) {
      const atom = atoms[index];
      if (usedFeatures.has(atom.feature)) continue;
      usedFeatures.add(atom.feature);
      group.push(atom);
      visit(index + 1, group, usedFeatures);
      group.pop();
      usedFeatures.delete(atom.feature);
    }
  }

  visit(0, [], new Set());
  return candidates.sort(validationRows.length > 0 ? compareCandidatesWithValidation : compareCandidates);
}

function buildGreedyGroupSet(rows, candidates, target) {
  const uncovered = new Set(rows.filter((row) => isPositive(row, target)).map((row) => row.key));
  const selectedGroups = [];
  const selectedKeys = new Set();
  for (const candidate of candidates) {
    const positiveGain = candidate.positiveKeys.filter((key) => uncovered.has(key)).length;
    if (positiveGain === 0) continue;
    selectedGroups.push(candidate);
    for (const key of candidate.selectedKeys) selectedKeys.add(key);
    for (const key of candidate.positiveKeys) uncovered.delete(key);
    if (uncovered.size === 0) break;
  }
  const metrics = evaluatePredicate(rows, (row) => selectedKeys.has(row.key), target);
  return {
    groups: selectedGroups.map((candidate) => ({
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      targetImproved: candidate.targetImproved,
      selectionImproved: candidate.selectionImproved,
      selectionRegressed: candidate.selectionRegressed,
      terminalFinalImproved: candidate.terminalFinalImproved,
      terminalFinalRegressed: candidate.terminalFinalRegressed,
      finalImproved: candidate.finalImproved,
      finalRegressed: candidate.finalRegressed,
      safetyRegressed: candidate.safetyRegressed,
      neutral: candidate.neutral,
      selected: candidate.selected
    })),
    selectedFeatureGateGroups: selectedGroups.map((candidate) => candidate.gates),
    cliArg: selectedGroups.map((candidate) => candidate.cliArg).join(";"),
    uncoveredPositiveCount: uncovered.size,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0
  };
}

function gatesGroupPredicate(selectedGateGroups) {
  return (row) => selectedGateGroups.some((gates) => gates.every((gate) => gatePasses(row, gate)));
}

function buildValidationGreedyGroupSet(rows, validationRows, candidates, target) {
  if (validationRows.length === 0) return null;
  const uncovered = new Set(validationRows.filter((row) => isPositive(row, target)).map((row) => row.key));
  const selectedGroups = [];
  const selectedValidationKeys = new Set();
  for (const candidate of candidates.filter((candidate) => candidate.validation?.safeNoRegression)) {
    const positiveGain = candidate.validation.positiveKeys.filter((key) => uncovered.has(key)).length;
    if (positiveGain === 0) continue;
    selectedGroups.push(candidate);
    for (const key of candidate.validation.selectedKeys) selectedValidationKeys.add(key);
    for (const key of candidate.validation.positiveKeys) uncovered.delete(key);
    if (uncovered.size === 0) break;
  }
  const selectedFeatureGateGroups = selectedGroups.map((candidate) => candidate.gates);
  const validationMetrics = withSafetyFlag(
    evaluatePredicate(validationRows, (row) => selectedValidationKeys.has(row.key), target)
  );
  const sourceMetrics = withSafetyFlag(
    selectedFeatureGateGroups.length === 0
      ? evaluatePredicate(rows, () => false, target)
      : evaluatePredicate(rows, gatesGroupPredicate(selectedFeatureGateGroups), target)
  );
  return {
    groups: selectedGroups.map((candidate) => ({
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      source: compactMetrics(candidate),
      validation: compactMetrics(candidate.validation)
    })),
    selectedFeatureGateGroups,
    cliArg: selectedGroups.map((candidate) => candidate.cliArg).join(";"),
    uncoveredPositiveCount: uncovered.size,
    source: sourceMetrics,
    validation: validationMetrics,
    ...validationMetrics,
    safeNoRegression: validationMetrics.safeNoRegression
  };
}

function compactMetrics(metrics) {
  return {
    selected: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta,
    safeNoRegression: metrics.safeNoRegression
  };
}

function metricsReportProjection(metrics) {
  return {
    selected: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta,
    safeNoRegression: metrics.safeNoRegression,
    positiveExamples: metrics.positiveExamples.map(exampleReportProjection),
    regressionExamples: metrics.regressionExamples.map(exampleReportProjection),
    selectionRegressionExamples: metrics.selectionRegressionExamples.map(exampleReportProjection),
    finalRegressionExamples: metrics.finalRegressionExamples.map(exampleReportProjection),
    safetyRegressionExamples: metrics.safetyRegressionExamples.map(exampleReportProjection)
  };
}

function candidateReportProjection(candidate) {
  return {
    atomCount: candidate.atomCount,
    atoms: candidate.atoms,
    gates: candidate.gates,
    cliArg: candidate.cliArg,
    ...metricsReportProjection(candidate),
    validation: candidate.validation ? metricsReportProjection(candidate.validation) : null
  };
}

export {
  atomCapSummary,
  atomComparatorForTarget,
  buildAtoms,
  buildGreedyGroupSet,
  buildValidationGreedyGroupSet,
  candidateReportProjection,
  compactMetrics,
  enumerateCandidates,
  evaluatePredicate,
  metricsReportProjection,
  rowSummaryFromMetrics,
  selectCappedAtoms
};
