const {
  assert,
  fs,
  os,
  path,
  solve,
  solveGreedy,
  validateSolution,
  runGreedyValidationOptimizerTests,
  createRoadOpportunityRecorder,
  recordRoadOpportunityPlacementFromOccupiedBuildings,
  roadAnchorSeedCandidates,
  roadAnchorRepresentativeSeedCandidates,
  runGreedyServiceLookaheadOptimizerAssertions,
  runGreedyBenchmarkOptimizerAssertions
} = require("./optimizerHarnessDeps.cjs");

const {
  testGeometryHelperVisitorParity,
  testBuildingGeometryHelpersParity,
  testRoadProbePreservesEdgeBorderConnectivity,
  testRoadProbeScratchWorkspaceResetsBetweenCalls,
  testBuildingConnectivityShadowMeasuresDisconnectedReachableCells,
  testGreedyAttemptStateRejectsMismatchedProbeKind,
  testRoadPruningDropsConnectorsOnlyNeededByAnchorBoundaryBuildings,
  testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval,
  testBuildingGeometryCachesParity,
  testPlannerExplainabilityMapSummarizesOpportunityAndRisk,
  testRoadProbeScratchRepeatability
} = require("./optimizerCoreAssertions.cjs");

function testGreedyDispatcher() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    basePop: 10,
    maxPop: 10,
    availableBuildings: { services: 0, residentials: 2 },
    greedy: { localSearch: false }
  };

  const dispatched = solve(grid, params);
  const direct = solveGreedy(grid, params);

  assert.equal(dispatched.optimizer, "greedy");
  assert.equal(dispatched.totalPopulation, direct.totalPopulation);
}

function testGreedyRandomSeedIsDeterministic() {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 60, range: 1, avail: 1 },
      { rows: 2, cols: 3, bonus: 90, range: 1, avail: 1 },
      { rows: 3, cols: 2, bonus: 70, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 180, avail: 2 },
      { w: 2, h: 3, min: 120, max: 260, avail: 2 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: false,
      randomSeed: 17,
      restarts: 4,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };

  const first = solveGreedy(grid, params);
  const second = solveGreedy(grid, params);

  assert.equal(first.totalPopulation, second.totalPopulation);
  assert.deepEqual([...first.roads].sort(), [...second.roads].sort());
  assert.deepEqual(first.services, second.services);
  assert.deepEqual(first.serviceTypeIndices, second.serviceTypeIndices);
  assert.deepEqual(first.servicePopulationIncreases, second.servicePopulationIncreases);
  assert.deepEqual(first.residentials, second.residentials);
  assert.deepEqual(first.residentialTypeIndices, second.residentialTypeIndices);
  assert.deepEqual(first.populations, second.populations);
}

function testGreedyConnectivityShadowScoringIsOptInTieBreaker() {
  const grid = [
    [0, 1, 1],
    [0, 1, 0],
    [1, 0, 0]
  ];
  const baseParams = {
    optimizer: "greedy",
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };
  const defaultSolution = solveGreedy(grid, structuredClone(baseParams));
  const explicitOff = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: false
    }
  });
  const profiledDefault = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      profile: true
    }
  });
  const enabled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: true
    }
  });
  const enabledProfiled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      connectivityShadowScoring: true,
      profile: true
    }
  });
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "greedy-shadow-snapshot-"));
  const snapshotFilePath = path.join(snapshotDir, "snapshot.json");

  try {
    const snapshotted = solveGreedy(grid, {
      ...structuredClone(baseParams),
      greedy: {
        ...baseParams.greedy,
        connectivityShadowScoring: true,
        snapshotFilePath
      }
    });
    const snapshot = JSON.parse(fs.readFileSync(snapshotFilePath, "utf8"));

    assert.deepEqual(defaultSolution.residentials, [{ r: 0, c: 1, rows: 1, cols: 1 }]);
    assert.deepEqual(explicitOff.residentials, defaultSolution.residentials);
    assert.deepEqual(profiledDefault.residentials, defaultSolution.residentials);
    assert.deepEqual([...explicitOff.roads].sort(), [...defaultSolution.roads].sort());
    assert.equal(defaultSolution.totalPopulation, enabled.totalPopulation);
    assert.deepEqual(enabled.residentials, [{ r: 0, c: 2, rows: 1, cols: 1 }]);
    assert.deepEqual([...enabled.roads].sort(), ["0,1"]);
    assert.deepEqual(enabledProfiled.residentials, enabled.residentials);
    assert(enabledProfiled.greedyProfile.counters.roads.connectivityShadowScoreTies > 0);
    assert(enabledProfiled.greedyProfile.counters.roads.connectivityShadowScoreWins > 0);
    assert(enabledProfiled.greedyProfile.connectivityShadowDecisions.length > 0);
    assert.equal(enabledProfiled.greedyProfile.connectivityShadowDecisions[0].phase, "residential");
    assert.deepEqual(enabledProfiled.greedyProfile.connectivityShadowDecisions[0].chosen, {
      r: 0,
      c: 2,
      rows: 1,
      cols: 1,
      roadCost: 0,
      typeIndex: 0
    });
    assert.deepEqual(snapshotted.residentials, enabled.residentials);
    assert.deepEqual(snapshot.residentials, enabled.residentials);
    assert.equal(validateSolution({ grid, solution: enabled, params: baseParams }).valid, true);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

function testGreedyRoadOpportunityCounterfactualsAreBoundedAndObservational() {
  const grid = [
    [1, 1],
    [1, 0],
    [1, 0]
  ];
  const baseParams = {
    optimizer: "greedy",
    residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };

  const baseline = solveGreedy(grid, structuredClone(baseParams));
  const profiled = solveGreedy(grid, {
    ...structuredClone(baseParams),
    greedy: {
      ...baseParams.greedy,
      profile: true
    }
  });
  const trace = profiled.greedyProfile.roadOpportunityTraces.find(
    (entry) => entry.phase === "residential" && (entry.counterfactuals?.length ?? 0) > 0
  );

  assert.deepEqual(profiled.residentials, baseline.residentials);
  assert.deepEqual([...profiled.roads].sort(), [...baseline.roads].sort());
  assert.equal(profiled.totalPopulation, baseline.totalPopulation);
  assert(trace);
  assert.equal(trace.score, 10);
  assert(trace.counterfactuals.length <= 3);

  const counterfactual = trace.counterfactuals.find((entry) => entry.reason === "same-score-tie");
  assert(counterfactual);
  assert.equal(counterfactual.score, 10);
  assert.equal(counterfactual.scoreDelta, 0);
  assert.equal(counterfactual.roadCostDelta, counterfactual.roadCost - trace.roadCost);
  assert.equal(counterfactual.lostCells, counterfactual.reachableBefore - counterfactual.reachableAfter);
}

function testRoadOpportunityLocalSearchMeasurementUsesPostRemoveOccupancy() {
  const grid = [[1], [1], [1]];
  const { traces, recordRoadOpportunity } = createRoadOpportunityRecorder(true);
  const probe = { kind: "explicit", roadCost: 0, roadProbe: { path: null } };

  for (let index = 0; index < 80; index++) {
    recordRoadOpportunityPlacementFromOccupiedBuildings({
      grid,
      occupiedBuildings: new Set(),
      placement: { r: 1, c: 0, rows: 1, cols: 1 },
      probe,
      phase: "residential",
      record: recordRoadOpportunity,
      score: 10
    });
  }

  recordRoadOpportunityPlacementFromOccupiedBuildings({
    grid,
    occupiedBuildings: new Set(),
    placement: { r: 2, c: 0, rows: 1, cols: 1 },
    probe,
    phase: "residential-local-search",
    record: recordRoadOpportunity,
    score: 10,
    moveKind: "residential-move"
  });

  const localTrace = traces.find((entry) => entry.phase === "residential-local-search");
  assert.equal(traces.filter((entry) => entry.phase === "residential").length, 64);
  assert(localTrace);
  assert.equal(localTrace.moveKind, "residential-move");
  assert.equal(localTrace.reachableBefore, 3);
  assert.equal(localTrace.reachableAfter, 2);
  assert.equal(localTrace.lostCells, 1);
}

function testGreedyStopFileCancelsBeforePrecompute() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "greedy-stop-precompute-"));
  const stopFilePath = path.join(tempDir, "stop-now");
  fs.writeFileSync(stopFilePath, "stop");

  try {
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
    assert.throws(
      () =>
        solveGreedy(grid, {
          residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 4 }],
          availableBuildings: { services: 0, residentials: 4 },
          greedy: {
            localSearch: false,
            restarts: 1,
            stopFilePath
          }
        }),
      /Greedy solve was stopped before finding a feasible solution\./
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testGreedyWallClockBudgetStopsWithBestSolution() {
  const originalDateNow = Date.now;
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    return dateNowCalls < 100 ? 1000 : 3000;
  };

  try {
    const grid = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ];
    const solution = solveGreedy(grid, {
      residentialTypes: [{ w: 2, h: 2, min: 100, max: 100, avail: 1 }],
      availableBuildings: { services: 0, residentials: 1 },
      greedy: {
        localSearch: false,
        restarts: 100,
        timeLimitSeconds: 1
      }
    });

    assert.equal(solution.totalPopulation, 100);
    assert.equal(solution.stoppedByTimeLimit, true);
    assert.equal(solution.stoppedByUser, undefined);
    assert.equal(dateNowCalls >= 100, true);
  } finally {
    Date.now = originalDateNow;
  }
}

function testGreedyExploresAllAllowedRoadAnchorSeeds() {
  const grid = [
    [1, 0, 1, 0],
    [0, 0, 1, 1],
    [0, 0, 1, 1]
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 1, c: 2, rows: 2, cols: 2 }]);
  assert.deepEqual([...solution.roads].sort(), ["0,2"]);
}

function testGreedyExploresMultipleRoadAnchorSeedsWithinOneComponent() {
  const grid = [
    [1, 1, 1, 0, 0],
    [1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0]
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { services: 0, residentials: 1 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 10);
  assert.deepEqual(solution.residentials, [{ r: 0, c: 0, rows: 2, cols: 2 }]);
  assert.deepEqual([...solution.roads].sort(), ["0,2"]);
}

function testGreedyExploresWideRoadAnchors() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0]
  ];
  const params = {
    serviceTypes: [{ rows: 2, cols: 2, bonus: 40, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 50, avail: 3 },
      { w: 2, h: 3, min: 15, max: 60, avail: 2 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 120);
}

function testGreedyExploresAnchorsBeyondLegacyRepresentativeCap() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1]
  ];
  const params = {
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 20 },
      { w: 2, h: 3, min: 15, max: 15, avail: 20 }
    ],
    availableBuildings: { services: 0, residentials: 20 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 85);
}

function testRoadAnchorSeedCandidatesIncludeAllAllowedAnchorBoundaryCells() {
  const singleComponentGrid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const disconnectedComponentGrid = [
    [1, 0, 1, 1, 0, 1],
    [1, 0, 1, 1, 0, 0]
  ];
  const wideComponentGrid = [Array.from({ length: 20 }, () => 1), Array.from({ length: 20 }, () => 1)];

  assert.deepEqual(
    roadAnchorSeedCandidates(singleComponentGrid).map((seed) => [...seed][0]),
    ["0,0", "0,1", "0,2", "0,3", "1,0"]
  );
  assert.deepEqual(
    roadAnchorSeedCandidates(disconnectedComponentGrid).map((seed) => [...seed][0]),
    ["0,0", "0,2", "0,3", "0,5", "1,0"]
  );
  const wideSeeds = roadAnchorSeedCandidates(wideComponentGrid).map((seed) => [...seed][0]);
  assert.equal(wideSeeds.length, 21);
  assert.equal(wideSeeds[0], "0,0");
  assert.equal(wideSeeds[wideSeeds.length - 1], "1,0");
}

function testRepresentativeRoadAnchorSeedCandidatesStayBoundaryExhaustive() {
  const wideGrid = [Array.from({ length: 40 }, () => 1), Array.from({ length: 40 }, () => 1)];

  const representativeKeys = roadAnchorRepresentativeSeedCandidates(wideGrid, 12).map((seed) => [...seed][0]);

  assert.equal(representativeKeys.length, 41);
  assert.equal(representativeKeys[0], "0,0");
  assert.equal(representativeKeys[39], "0,39");
  assert.equal(representativeKeys[representativeKeys.length - 1], "1,0");
}

function testGreedyDiagnosticsAreOptInDeterministicAndAdditive() {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 20, range: 1, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 20 }],
    availableBuildings: { services: 1, residentials: 2 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false
    }
  };

  const withoutDiagnostics = solveGreedy(grid, params);
  const withDiagnostics = solveGreedy(grid, {
    ...params,
    greedy: { ...params.greedy, diagnostics: true }
  });
  const repeated = solveGreedy(grid, {
    ...params,
    greedy: { ...params.greedy, diagnostics: true }
  });

  assert.equal(withoutDiagnostics.greedyDiagnostics, undefined);
  assert(withDiagnostics.greedyDiagnostics);
  assert.deepEqual(withDiagnostics.greedyDiagnostics, repeated.greedyDiagnostics);
  assert.equal(withDiagnostics.totalPopulation, withoutDiagnostics.totalPopulation);
  assert.deepEqual(withDiagnostics.services, withoutDiagnostics.services);
  assert.deepEqual(withDiagnostics.serviceTypeIndices, withoutDiagnostics.serviceTypeIndices);
  assert.deepEqual(withDiagnostics.residentials, withoutDiagnostics.residentials);
  assert.deepEqual(withDiagnostics.residentialTypeIndices, withoutDiagnostics.residentialTypeIndices);
  assert.deepEqual(withDiagnostics.populations, withoutDiagnostics.populations);
  assert.equal(withDiagnostics.greedyDiagnostics.candidateLimit, 2000);
  assert.equal(withDiagnostics.greedyDiagnostics.examplesPerReason, 3);

  const serviceReasons = withDiagnostics.greedyDiagnostics.services.reasonCounts;
  const residentialReasons = withDiagnostics.greedyDiagnostics.residentials.reasonCounts;
  assert.equal(serviceReasons["availability-cap"] > 0, true);
  assert.equal(serviceReasons["blocked-footprint"] > 0, true);
  assert.equal(serviceReasons["no-road-path"] > 0, true);
  assert.equal(serviceReasons["lower-score-no-improvement"] > 0, true);
  assert.equal(residentialReasons["availability-cap"] > 0, true);
  assert.equal(residentialReasons["blocked-footprint"] > 0, true);
  assert.equal(residentialReasons["no-road-path"] > 0, true);
  assert.equal(residentialReasons["base-only"] > 0, true);
  assert.equal(
    withDiagnostics.greedyDiagnostics.services.examplesByReason["lower-score-no-improvement"].length <= 3,
    true
  );
  assert.equal(withDiagnostics.greedyDiagnostics.services.overallAvailability.remaining, 0);
  assert.equal(withDiagnostics.greedyDiagnostics.residentials.overallAvailability.remaining, 0);
}

function testGreedyDiagnosticsReportsNoServiceCoverage() {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 50, range: 0, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 2 }],
    availableBuildings: { services: 2, residentials: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      diagnostics: true
    }
  };

  const solution = solveGreedy(grid, params);
  const diagnostics = solution.greedyDiagnostics;

  assert(diagnostics);
  assert.equal(solution.services.length, 0);
  assert.equal(diagnostics.services.reasonCounts["no-service-coverage"] > 0, true);
  assert.equal(diagnostics.services.examplesByReason["no-service-coverage"][0].score, 0);
  assert.equal(diagnostics.services.overallAvailability.remaining, 2);
}

async function runGreedyOptimizerTests() {
  testGeometryHelperVisitorParity();
  testBuildingGeometryHelpersParity();
  testRoadProbePreservesEdgeBorderConnectivity();
  testRoadProbeScratchWorkspaceResetsBetweenCalls();
  testBuildingConnectivityShadowMeasuresDisconnectedReachableCells();
  testGreedyAttemptStateRejectsMismatchedProbeKind();
  testRoadPruningDropsConnectorsOnlyNeededByAnchorBoundaryBuildings();
  testRoadPruningRevisitsCandidatesAfterDependentRoadRemoval();
  testGreedyDispatcher();
  testGreedyRandomSeedIsDeterministic();
  testGreedyConnectivityShadowScoringIsOptInTieBreaker();
  testGreedyRoadOpportunityCounterfactualsAreBoundedAndObservational();
  testRoadOpportunityLocalSearchMeasurementUsesPostRemoveOccupancy();
  testGreedyStopFileCancelsBeforePrecompute();
  testGreedyWallClockBudgetStopsWithBestSolution();
  testGreedyExploresAllAllowedRoadAnchorSeeds();
  testGreedyExploresMultipleRoadAnchorSeedsWithinOneComponent();
  testGreedyExploresWideRoadAnchors();
  testGreedyExploresAnchorsBeyondLegacyRepresentativeCap();
  testRoadAnchorSeedCandidatesIncludeAllAllowedAnchorBoundaryCells();
  testRepresentativeRoadAnchorSeedCandidatesStayBoundaryExhaustive();
  runGreedyValidationOptimizerTests();
  runGreedyServiceLookaheadOptimizerAssertions();
  testGreedyDiagnosticsAreOptInDeterministicAndAdditive();
  testGreedyDiagnosticsReportsNoServiceCoverage();
  testBuildingGeometryCachesParity();
  testPlannerExplainabilityMapSummarizesOpportunityAndRisk();
  testRoadProbeScratchRepeatability();
  runGreedyBenchmarkOptimizerAssertions();
}

module.exports = {
  runGreedyOptimizerTests
};
