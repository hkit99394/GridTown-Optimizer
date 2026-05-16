function buildLabel({
  windowIndex,
  operatorScore,
  improvement,
  selectedByBaseline = false,
  serviceCandidates = 0,
  residentialHeadroomCandidate = 0,
  residentialHeadroom = 0,
  serviceBonus = 0,
  anchorReachable = 0,
  newlyReachable = 0,
  operator = "service-anchor"
}) {
  return {
    windowIndex,
    operatorScore,
    selectedByBaseline,
    operator,
    improvement,
    populationDelta: improvement,
    status: improvement > 0 ? "improved" : "neutral",
    usable: true,
    features: {
      schemaVersion: 2,
      area: 4,
      touchesRoadAnchorBoundary: false,
      roadCountInside: 0,
      serviceCountInside: 0,
      residentialCountInside: 0,
      residentialHeadroomInside: residentialHeadroom,
      serviceBonusInside: serviceBonus,
      connectivityShadow: {
        reachableEmptyCellsBefore: 0,
        reachableEmptyCellsAfterClearingWindow: newlyReachable,
        newlyReachableEmptyCellsIfCleared: newlyReachable,
        disconnectedEmptyCellsBefore: 0,
        disconnectedEmptyCellsAfterClearingWindow: 0,
        clearedBuildingFootprintCells: 0
      },
      fragmentation: {
        emptyComponentCountBefore: 1,
        emptyComponentCountAfterClearingWindow: 1,
        componentDeltaAfterClearingWindow: 0,
        allowedWindowCellCount: 4,
        anchorReachableWindowCellCount: anchorReachable,
        narrowGateCellCount: 0
      },
      candidateLoss: {
        serviceCandidatesIntersectingWindow: serviceCandidates,
        residentialCandidatesIntersectingWindow: 0,
        serviceCandidatesBlockedByIncumbent: 0,
        residentialCandidatesBlockedByIncumbent: 0,
        serviceCandidateBonusInside: 0,
        maxServiceCandidateBonusInside: 0,
        residentialCandidateHeadroomInside: residentialHeadroomCandidate,
        serviceTypeCounts: {},
        residentialTypeCounts: {}
      }
    }
  };
}

function buildCase(name, split, pressureFamily, bestImprovement, seedHintKind = "curated") {
  const labels = [
    buildLabel({
      windowIndex: 0,
      operatorScore: 10,
      improvement: 0,
      selectedByBaseline: true,
      operator: "weak-service",
      residentialHeadroom: 900,
      residentialHeadroomCandidate: 900,
      anchorReachable: 4,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 1,
      operatorScore: 2,
      improvement: bestImprovement,
      operator: "service-overlap",
      serviceCandidates: 10,
      residentialHeadroomCandidate: 0,
      anchorReachable: 1,
      newlyReachable: 0
    }),
    buildLabel({
      windowIndex: 2,
      operatorScore: 1,
      improvement: Math.floor(bestImprovement / 4),
      operator: "sliding",
      serviceCandidates: 2,
      residentialHeadroomCandidate: 500,
      anchorReachable: 1,
      newlyReachable: 0
    })
  ];

  return {
    name,
    description: `${name} replay fixture`,
    pressureFamily,
    seed: 7,
    seedHintKind,
    seedHintSourceName: seedHintKind === "weak-replay" ? `${name}-weak-replay-seed` : name,
    statePolicy: "initial-incumbent",
    stateIndex: 0,
    stateSourceIteration: null,
    stateSourceStatus: "initial-incumbent",
    stateStagnantIterations: 0,
    gridRows: 4,
    gridCols: 4,
    incumbentPopulation: 0,
    candidateWindowCount: labels.length,
    replayedWindowCount: labels.length,
    baselineSelectedWindow: null,
    baselineSelectedOperator: null,
    labels: labels.map((label) => ({
      ...label,
      caseName: name,
      pressureFamily,
      seed: 7,
      seedHintKind,
      seedHintSourceName: seedHintKind === "weak-replay" ? `${name}-weak-replay-seed` : name,
      statePolicy: "initial-incumbent",
      stateIndex: 0,
      stateSourceIteration: null,
      stateSourceStatus: "initial-incumbent",
      stateStagnantIterations: 0,
      operator: label.operator,
      selectionSource: "baseline-top-k",
      window: { top: 0, left: label.windowIndex, rows: 2, cols: 2 },
      incumbentPopulation: 0,
      totalPopulation: label.improvement,
      cpSatStatus: "OPTIMAL",
      repairTimeLimitSeconds: 1,
      cpSat: {
        modelEncodingVersion: "cp-sat-layout-v1",
        candidateKeyVersion: 1,
        modelFingerprint: "fnv1a:00000000",
        warmStartFixOutsideNeighborhood: true,
        modelSize: null
      },
      validation: {
        valid: true,
        recomputedTotalPopulation: label.improvement
      }
    })),
    split
  };
}

function cloneFixtureWithWeakReplaySeedCases() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  const weakNames = new Set(["dev-service-a", "holdout-service-a"]);
  for (const split of fixture.lns.splits) {
    for (const benchmarkCase of split.replay.cases) {
      if (!weakNames.has(benchmarkCase.name)) continue;
      benchmarkCase.seedHintKind = "weak-replay";
      benchmarkCase.seedHintSourceName = `${benchmarkCase.name}-weak-replay-seed`;
      for (const label of benchmarkCase.labels) {
        label.seedHintKind = benchmarkCase.seedHintKind;
        label.seedHintSourceName = benchmarkCase.seedHintSourceName;
      }
    }
  }
  return fixture;
}

function buildSplit(name, cases) {
  const labelCount = cases.reduce((total, entry) => total + entry.labels.length, 0);
  return {
    split: name,
    selectedCaseNames: cases.map((entry) => entry.name),
    pressureFamilies: [...new Set(cases.map((entry) => entry.pressureFamily))],
    seeds: [7],
    labelCount,
    usableLabelCount: labelCount,
    statusCounts: {
      improved: cases.length * 2,
      neutral: cases.length,
      regressed: 0,
      invalid: 0,
      "recoverable-failure": 0
    },
    replay: {
      schemaVersion: 1,
      caseCount: cases.length,
      seedCount: 1,
      comparisonCount: cases.length,
      seeds: [7],
      selectedCaseNames: cases.map((entry) => entry.name),
      pressureFamilies: [...new Set(cases.map((entry) => entry.pressureFamily))],
      maxWindows: 3,
      explorationWindowCount: 0,
      repairTimeLimitSeconds: 1,
      statePolicies: ["initial-incumbent"],
      capturedStatePolicies: ["initial-incumbent"],
      stateCollectionIterations: 4,
      stateCollectionRepairTimeLimitSeconds: 1,
      stateCount: cases.length,
      featureSchemaVersion: 2,
      cpSatNumWorkers: 1,
      cpSatModelFingerprints: ["fnv1a:00000000"],
      labelCount,
      cases
    }
  };
}

function buildFixture() {
  const developmentCases = [
    buildCase("dev-service-a", "development", "service-pressure", 40),
    buildCase("dev-service-b", "development", "service-pressure", 35),
    buildCase("dev-gate-a", "development", "gate", 30)
  ];
  const holdoutCases = [
    buildCase("holdout-service-a", "holdout", "service-pressure", 50),
    buildCase("holdout-service-b", "holdout", "service-pressure", 45),
    buildCase("holdout-gate-a", "holdout", "gate", 40),
    buildCase("holdout-gate-b", "holdout", "gate", 35)
  ];

  return {
    schemaVersion: 1,
    seeds: [7],
    splitCount: 2,
    audit: {
      learnedModel: null,
      greedy: { profile: true, connectivityShadowScoring: true },
      lnsReplay: {
        preset: "strict-lns-replay",
        cpSatNumWorkers: 1,
        incumbentStatePolicy: "initial-incumbent",
        incumbentStatePolicies: ["initial-incumbent"],
        stateCollectionIterations: 4,
        stateCollectionRepairTimeLimitSeconds: 1,
        candidateWindowPolicy: "baseline-ranked-top-k",
        explorationWindowCount: 0,
        featureSchemaVersion: 2
      }
    },
    greedy: {
      labelCount: 0,
      sourceCounts: { "connectivity-shadow-decision": 0, "road-opportunity-counterfactual": 0 },
      splits: []
    },
    lns: {
      labelCount: 21,
      scaleReadiness: { passed: true, thresholds: {}, splitReadiness: [] },
      splits: [buildSplit("development", developmentCases), buildSplit("holdout", holdoutCases)]
    },
    leakage: {
      developmentGreedyCases: [],
      holdoutGreedyCases: [],
      developmentLnsCases: developmentCases.map((entry) => entry.name),
      holdoutLnsCases: holdoutCases.map((entry) => entry.name),
      greedyOverlap: [],
      lnsOverlap: [],
      protectedHoldout: true
    }
  };
}

function cloneFixtureWithBaselineReplayTies() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  for (const split of fixture.lns.splits) {
    const statusCounts = { improved: 0, neutral: 0, regressed: 0, invalid: 0, "recoverable-failure": 0 };
    for (const benchmarkCase of split.replay.cases) {
      const bestImprovement = Math.max(...benchmarkCase.labels.map((label) => label.improvement));
      const baselineLabel = benchmarkCase.labels.find((label) => label.selectedByBaseline);
      baselineLabel.improvement = bestImprovement;
      baselineLabel.populationDelta = bestImprovement;
      baselineLabel.status = "improved";
      baselineLabel.totalPopulation = bestImprovement;
      baselineLabel.validation.recomputedTotalPopulation = bestImprovement;
      for (const label of benchmarkCase.labels) statusCounts[label.status]++;
    }
    split.statusCounts = statusCounts;
  }
  return fixture;
}

function cloneFixtureWithRollForwardTargets() {
  const fixture = JSON.parse(JSON.stringify(buildFixture()));
  fixture.audit.lnsReplay.rollForwardIterations = 1;
  fixture.audit.lnsReplay.rollForwardRepairTimeLimitSeconds = 0.1;
  for (const split of fixture.lns.splits) {
    split.replay.rollForwardIterations = 1;
    split.replay.rollForwardRepairTimeLimitSeconds = 0.1;
    split.replay.rollForwardLabelCount = split.labelCount;
    for (const benchmarkCase of split.replay.cases) {
      for (const label of benchmarkCase.labels) {
        const finalDelta = label.windowIndex === 2 ? label.improvement + 100 : label.windowIndex === 1 ? 0 : -10;
        label.rollForward = {
          iterations: 1,
          repairTimeLimitSeconds: 0.1,
          seedPopulation: label.totalPopulation,
          totalPopulation: benchmarkCase.incumbentPopulation + finalDelta,
          populationDeltaFromIncumbent: finalDelta,
          populationDeltaFromRepair: finalDelta - label.populationDelta,
          baselineTotalPopulation: benchmarkCase.incumbentPopulation,
          populationDeltaVsBaseline: finalDelta,
          improvementVsBaseline: Math.max(0, finalDelta),
          statusVsBaseline: finalDelta > 0 ? "improved" : finalDelta < 0 ? "regressed" : "neutral"
        };
      }
    }
  }
  return fixture;
}

function cloneFixtureWithFeatureIdenticalRepeatabilityConflict() {
  const fixture = cloneFixtureWithRollForwardTargets();
  const developmentSplit = fixture.lns.splits.find((split) => split.split === "development");
  const sourceCase = developmentSplit.replay.cases[0];
  const conflictCase = JSON.parse(JSON.stringify(sourceCase));
  conflictCase.seed = 19;
  for (const label of conflictCase.labels) {
    label.seed = 19;
    label.rollForward.baselineTotalPopulation = 50;
    if (label.windowIndex === 2) {
      label.rollForward.totalPopulation = 0;
      label.rollForward.populationDeltaFromIncumbent = 0;
      label.rollForward.populationDeltaFromRepair = -label.populationDelta;
    }
    label.rollForward.populationDeltaVsBaseline = label.rollForward.totalPopulation - 50;
    label.rollForward.improvementVsBaseline = Math.max(0, label.rollForward.populationDeltaVsBaseline);
    label.rollForward.statusVsBaseline =
      label.rollForward.populationDeltaVsBaseline > 0
        ? "improved"
        : label.rollForward.populationDeltaVsBaseline < 0
          ? "regressed"
          : "neutral";
  }
  developmentSplit.replay.cases.push(conflictCase);
  developmentSplit.replay.caseCount += 1;
  developmentSplit.replay.comparisonCount += 1;
  developmentSplit.replay.stateCount += 1;
  developmentSplit.replay.seeds = [7, 19];
  developmentSplit.replay.seedCount = 2;
  developmentSplit.seeds = [7, 19];
  developmentSplit.labelCount += conflictCase.labels.length;
  developmentSplit.usableLabelCount += conflictCase.labels.length;
  developmentSplit.replay.labelCount += conflictCase.labels.length;
  developmentSplit.replay.rollForwardLabelCount += conflictCase.labels.length;
  fixture.lns.labelCount += conflictCase.labels.length;
  fixture.seeds = [7, 19];
  return fixture;
}

module.exports = {
  buildFixture,
  cloneFixtureWithBaselineReplayTies,
  cloneFixtureWithFeatureIdenticalRepeatabilityConflict,
  cloneFixtureWithRollForwardTargets,
  cloneFixtureWithWeakReplaySeedCases
};
