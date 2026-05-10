const assert = require("node:assert/strict");

const { solveLns } = require("city-builder/solver");
const {
  buildAdaptiveNeighborhoodCandidates,
  selectAdaptiveNeighborhoodOperator
} = require("../../dist/packages/solvers/lns/neighborhoods.js");
const {
  normalizeLnsWindowRankerOptions,
  selectLnsWindowRankerCandidate
} = require("../../dist/packages/solvers/lns/windowScorer.js");

function buildGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
}

function buildSelectionFixture() {
  const grid = buildGrid(6, 6);
  const params = {
    serviceTypes: [
      { rows: 2, cols: 2, bonus: 30, range: 1, avail: 1 },
      { rows: 2, cols: 2, bonus: 180, range: 4, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 160, avail: 1 },
      { w: 2, h: 2, min: 120, max: 320, avail: 1 }
    ]
  };
  const incumbent = {
    optimizer: "lns",
    roads: new Set(["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "1,0", "2,0", "3,0", "4,0", "5,0"]),
    services: [
      { r: 1, c: 4, rows: 2, cols: 2, range: 1 },
      { r: 1, c: 0, rows: 2, cols: 2, range: 4 }
    ],
    serviceTypeIndices: [0, 1],
    servicePopulationIncreases: [30, 180],
    residentials: [
      { r: 4, c: 0, rows: 2, cols: 2 },
      { r: 4, c: 4, rows: 2, cols: 2 }
    ],
    residentialTypeIndices: [1, 0],
    populations: [280, 150],
    totalPopulation: 430
  };
  const options = {
    maxNoImprovementIterations: 4,
    neighborhoodRows: 3,
    neighborhoodCols: 3
  };
  const candidates = buildAdaptiveNeighborhoodCandidates(grid, params, incumbent, options, 1);
  const baseline = selectAdaptiveNeighborhoodOperator(candidates, 0, 0, options);
  return { grid, params, incumbent, candidates, baseline };
}

function runtimeModel(weights, interactionWeights) {
  return {
    model: {
      modelType: "lns-window-linear-pairwise-ranker",
      modelFingerprint: "fnv1a:test0001",
      featureSchemaVersion: 2,
      weights,
      ...(interactionWeights === undefined ? {} : { interactionWeights })
    }
  };
}

function operatorFeatureSuffix(operator) {
  return {
    "weak-service": "WeakService",
    "residential-headroom": "ResidentialHeadroom",
    "frontier-congestion": "FrontierCongestion",
    "gate-choke": "GateChoke",
    "service-overlap": "ServiceOverlap",
    "random-exploration": "RandomExploration",
    "placed-buildings": "PlacedBuildings",
    sliding: "Sliding"
  }[operator];
}

function testWindowRankerCanOverrideAdaptiveBaseline() {
  const fixture = buildSelectionFixture();
  const options = normalizeLnsWindowRankerOptions(runtimeModel({ selectedByBaseline: -1 }));
  const decision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    options
  );

  assert.equal(decision.telemetry.source, "learned-window-ranker");
  assert.equal(decision.telemetry.modelFingerprint, "fnv1a:test0001");
  assert.equal(decision.telemetry.featureSchemaVersion, 2);
  assert.equal(decision.telemetry.selectedByBaseline, false);
  assert.equal(decision.telemetry.baselineCandidateIndex >= 0, true);
  assert.equal(decision.telemetry.selectedCandidateIndex >= 0, true);
  assert.equal(decision.telemetry.baselineOperator, fixture.baseline.operator);
  assert.equal(decision.telemetry.selectedOperator, decision.candidate.operator);
  assert.deepEqual(decision.telemetry.baselineWindow, fixture.baseline.window);
  assert.deepEqual(decision.telemetry.selectedWindow, decision.candidate.window);
  assert.equal(typeof decision.telemetry.baselineFeatures.selectedByBaseline, "number");
  assert.equal(decision.telemetry.baselineFeatures.selectedByBaseline, 1);
  assert.equal(decision.telemetry.selectedFeatures.selectedByBaseline, 0);
  assert.equal(decision.telemetry.featureDeltas.selectedByBaseline, -1);
  assert.equal(
    decision.telemetry.baselineFeatures[`baselineOperator${operatorFeatureSuffix(fixture.baseline.operator)}`],
    1
  );
  assert.equal(
    decision.telemetry.selectedFeatures[`selectedOperator${operatorFeatureSuffix(decision.candidate.operator)}`],
    1
  );
  assert.equal(typeof decision.telemetry.featureDeltas.serviceCandidatesIntersecting, "number");
  assert.equal(decision.telemetry.decisionState, undefined);
  assert.notDeepEqual(decision.candidate.window, fixture.baseline.window);

  const capturedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...runtimeModel({ selectedByBaseline: -1 }),
      captureDecisionState: true
    })
  );
  assert.equal(capturedDecision.telemetry.decisionState.source, "online-window-ranker-decision-state");
  assert.equal(capturedDecision.telemetry.decisionState.incumbentPopulation, fixture.incumbent.totalPopulation);
  assert.deepEqual(capturedDecision.telemetry.decisionState.seedHint.solution.roads, [...fixture.incumbent.roads]);
  assert.equal(
    capturedDecision.telemetry.decisionState.seedHint.solution.residentials[0].population,
    fixture.incumbent.populations[0]
  );
}

function testWindowRankerTrajectoryFeaturesCanOverrideByTransition() {
  const fixture = buildSelectionFixture();
  assert.notEqual(fixture.baseline.operator, "sliding");
  assert(fixture.candidates.some((candidate) => candidate.operator === "sliding"));
  const transitionFeature = `transition${operatorFeatureSuffix(fixture.baseline.operator)}ToSliding`;
  const decision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions(runtimeModel({ [transitionFeature]: 1 }))
  );

  assert.equal(decision.telemetry.selectedByBaseline, false);
  assert.equal(decision.telemetry.selectedOperator, "sliding");
  assert.equal(decision.telemetry.selectedFeatures[transitionFeature], 1);
  assert.equal(decision.telemetry.baselineFeatures[transitionFeature], 0);
  assert.equal(decision.telemetry.featureDeltas[transitionFeature], 1);
}

function testWindowRankerInteractionWeightsCanOverrideAdaptiveBaseline() {
  const fixture = buildSelectionFixture();
  const options = normalizeLnsWindowRankerOptions(
    runtimeModel({ selectedByBaseline: 0 }, { "selectedByBaseline*selectedByBaseline": -1 })
  );
  const decision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    options
  );

  assert.equal(decision.telemetry.selectedByBaseline, false);
  assert.equal(decision.telemetry.baselineScore, -1);
  assert.equal(decision.telemetry.selectedScore, 0);
}

function testWindowRankerFallsBackWhenScoreDeltaIsTooSmall() {
  const fixture = buildSelectionFixture();
  const options = normalizeLnsWindowRankerOptions({
    ...runtimeModel({ selectedByBaseline: -1 }),
    minScoreDelta: 10
  });
  const decision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    options
  );

  assert.deepEqual(decision.candidate.window, fixture.baseline.window);
  assert.equal(decision.telemetry.selectedByBaseline, true);
  assert.equal(decision.telemetry.selectedCandidateIndex, decision.telemetry.baselineCandidateIndex);
  assert.equal(decision.telemetry.selectedOperator, decision.telemetry.baselineOperator);
  assert.deepEqual(decision.telemetry.selectedWindow, decision.telemetry.baselineWindow);
  assert.equal(decision.telemetry.fallbackReason, "score-delta-below-threshold");
}

function testWindowRankerFallsBackWhenTransitionIsNotAllowed() {
  const fixture = buildSelectionFixture();
  const model = runtimeModel({ selectedByBaseline: -1 });
  const openDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions(model)
  );
  const allowedTransition = `${openDecision.telemetry.baselineOperator}->${openDecision.telemetry.selectedOperator}`;
  assert.equal(openDecision.telemetry.selectedByBaseline, false);

  const blockedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      allowedTransitions: []
    })
  );
  assert.deepEqual(blockedDecision.candidate.window, fixture.baseline.window);
  assert.equal(blockedDecision.telemetry.selectedByBaseline, true);
  assert.equal(blockedDecision.telemetry.fallbackReason, "operator-transition-not-allowed");
  assert.equal(blockedDecision.telemetry.selectedOperator, blockedDecision.telemetry.baselineOperator);

  const allowedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      allowedTransitions: [allowedTransition]
    })
  );
  assert.equal(allowedDecision.telemetry.selectedByBaseline, false);
  assert.equal(allowedDecision.telemetry.fallbackReason, undefined);
  assert.equal(
    `${allowedDecision.telemetry.baselineOperator}->${allowedDecision.telemetry.selectedOperator}`,
    allowedTransition
  );
}

function testWindowRankerFallsBackWhenFeatureDeltaGateFails() {
  const fixture = buildSelectionFixture();
  const model = runtimeModel({ selectedByBaseline: -1 });
  const openDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions(model)
  );
  assert.equal(openDecision.telemetry.selectedByBaseline, false);
  assert.equal(openDecision.telemetry.featureDeltas.selectedByBaseline, -1);

  const blockedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      featureDeltaGates: [{ feature: "selectedByBaseline", minDelta: 0 }]
    })
  );
  assert.deepEqual(blockedDecision.candidate.window, fixture.baseline.window);
  assert.equal(blockedDecision.telemetry.selectedByBaseline, true);
  assert.equal(blockedDecision.telemetry.fallbackReason, "feature-delta-gate-not-met");
  assert.equal(blockedDecision.telemetry.featureDeltas.selectedByBaseline, 0);

  const allowedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      featureDeltaGates: [{ feature: "selectedByBaseline", maxDelta: -1 }]
    })
  );
  assert.equal(allowedDecision.telemetry.selectedByBaseline, false);
  assert.equal(allowedDecision.telemetry.fallbackReason, undefined);
  assert.equal(allowedDecision.telemetry.featureDeltas.selectedByBaseline, -1);

  const invalidFeatureDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      featureDeltaGates: [{ feature: "notAFeature", minDelta: 0 }]
    })
  );
  assert.deepEqual(invalidFeatureDecision.candidate.window, fixture.baseline.window);
  assert.equal(invalidFeatureDecision.telemetry.fallbackReason, "feature-delta-gate-not-met");
}

function testWindowRankerFallsBackWhenSelectedFeatureGateFails() {
  const fixture = buildSelectionFixture();
  const model = runtimeModel({ selectedByBaseline: -1 });
  const openDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions(model)
  );
  assert.equal(openDecision.telemetry.selectedByBaseline, false);
  assert.equal(openDecision.telemetry.selectedFeatures.selectedByBaseline, 0);

  const blockedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      selectedFeatureGates: [{ feature: "selectedByBaseline", minValue: 1 }]
    })
  );
  assert.deepEqual(blockedDecision.candidate.window, fixture.baseline.window);
  assert.equal(blockedDecision.telemetry.selectedByBaseline, true);
  assert.equal(blockedDecision.telemetry.fallbackReason, "selected-feature-gate-not-met");
  assert.equal(blockedDecision.telemetry.selectedFeatures.selectedByBaseline, 1);

  const allowedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      selectedFeatureGates: [{ feature: "selectedByBaseline", maxValue: 0 }]
    })
  );
  assert.equal(allowedDecision.telemetry.selectedByBaseline, false);
  assert.equal(allowedDecision.telemetry.fallbackReason, undefined);
  assert.equal(allowedDecision.telemetry.selectedFeatures.selectedByBaseline, 0);

  const groupedAllowedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      selectedFeatureGateGroups: [
        [{ feature: "selectedByBaseline", minValue: 1 }],
        [{ feature: "selectedByBaseline", maxValue: 0 }]
      ]
    })
  );
  assert.equal(groupedAllowedDecision.telemetry.selectedByBaseline, false);
  assert.equal(groupedAllowedDecision.telemetry.fallbackReason, undefined);

  const groupedBlockedDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      selectedFeatureGateGroups: [
        [{ feature: "selectedByBaseline", minValue: 1 }],
        [{ feature: "selectedByBaseline", minValue: 2 }]
      ]
    })
  );
  assert.deepEqual(groupedBlockedDecision.candidate.window, fixture.baseline.window);
  assert.equal(groupedBlockedDecision.telemetry.fallbackReason, "selected-feature-gate-not-met");

  const invalidFeatureDecision = selectLnsWindowRankerCandidate(
    fixture.grid,
    fixture.params,
    fixture.incumbent,
    fixture.candidates,
    fixture.baseline,
    normalizeLnsWindowRankerOptions({
      ...model,
      selectedFeatureGates: [{ feature: "notAFeature", minValue: 0 }]
    })
  );
  assert.deepEqual(invalidFeatureDecision.candidate.window, fixture.baseline.window);
  assert.equal(invalidFeatureDecision.telemetry.fallbackReason, "selected-feature-gate-not-met");
}

function testSolveLnsWindowRankerTelemetryAndDefaultSafety() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  let cpSatCalls = 0;
  cpSatModule.solveCpSat = (_grid, params) => {
    cpSatCalls += 1;
    const roads = new Set(params.cpSat.warmStartHint.solution.roads);
    return {
      optimizer: "cp-sat",
      roads,
      services: [],
      serviceTypeIndices: [],
      servicePopulationIncreases: [],
      residentials: [],
      residentialTypeIndices: [],
      populations: [],
      totalPopulation: 0,
      cpSatStatus: "FEASIBLE"
    };
  };

  try {
    const grid = buildGrid(4, 4);
    const baseParams = {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 4,
        neighborhoodRows: 2,
        neighborhoodCols: 2,
        seedHint: {
          solution: {
            roads: ["0,0"],
            services: [],
            residentials: [],
            populations: [],
            totalPopulation: 0
          }
        }
      }
    };

    const defaultSolution = solveLns(grid, baseParams);
    assert.equal(defaultSolution.lnsTelemetry.windowRanker, undefined);
    assert.equal(defaultSolution.lnsTelemetry.outcomes[0].windowRankerSelection, undefined);

    const disabledSolution = solveLns(grid, {
      ...baseParams,
      lns: {
        ...baseParams.lns,
        windowRanker: { enabled: false }
      }
    });
    assert.equal(disabledSolution.lnsTelemetry.windowRanker, undefined);
    assert.equal(disabledSolution.lnsTelemetry.outcomes[0].windowRankerSelection, undefined);

    const rankedSolution = solveLns(grid, {
      ...baseParams,
      lns: {
        ...baseParams.lns,
        windowRanker: runtimeModel({ selectedByBaseline: -1 })
      }
    });
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.enabled, true);
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.decisions, 1);
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.overrides, 1);
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.allowedTransitions, undefined);
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.selectedFeatureGates, undefined);
    assert.equal(rankedSolution.lnsTelemetry.windowRanker.featureDeltaGates, undefined);
    assert.equal(rankedSolution.lnsTelemetry.outcomes[0].windowRankerSelection.selectedByBaseline, false);
    assert.equal(typeof rankedSolution.lnsTelemetry.outcomes[0].windowRankerSelection.selectedOperator, "string");
    assert.equal(typeof rankedSolution.lnsTelemetry.outcomes[0].windowRankerSelection.selectedWindow.top, "number");
    assert.equal(
      typeof rankedSolution.lnsTelemetry.outcomes[0].windowRankerSelection.featureDeltas.selectedByBaseline,
      "number"
    );
    assert.equal(cpSatCalls, 3);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

function testWindowRankerValidationRejectsBadWeights() {
  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: "bad" }
            }
          }
        }
      }),
    /lns\.windowRanker\.model\.weights\.selectedByBaseline must be a finite number/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1, selectedByBasline: 1 }
            }
          }
        }
      }),
    /lns\.windowRanker\.model\.weights\.selectedByBasline must be one of the LNS window ranker feature names/
  );

  assert.throws(
    () =>
      normalizeLnsWindowRankerOptions({
        model: {
          modelType: "lns-window-linear-pairwise-ranker",
          featureSchemaVersion: 2,
          featureNames: ["selectedByBaseline", "selectedByBasline"],
          weights: { selectedByBaseline: 1 }
        }
      }),
    /LNS window ranker model\.featureNames entries must be LNS window ranker feature names/
  );

  assert.throws(
    () =>
      normalizeLnsWindowRankerOptions({
        model: {
          modelType: "lns-window-linear-pairwise-ranker",
          featureSchemaVersion: 1,
          weights: { selectedByBaseline: 1 }
        }
      }),
    /LNS window ranker model\.featureSchemaVersion must be null or one of 2, 3/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            captureDecisionState: "yes"
          }
        }
      }),
    /lns\.windowRanker\.captureDecisionState must be a boolean/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            allowedTransitions: ["weak-service=>sliding"]
          }
        }
      }),
    /lns\.windowRanker\.allowedTransitions must contain operator transitions/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            featureDeltaGates: [{ feature: "selectedByBaseline" }]
          }
        }
      }),
    /lns\.windowRanker\.featureDeltaGates\[0\] must include minDelta or maxDelta/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            featureDeltaGates: [{ feature: "notAFeature", maxDelta: 0 }]
          }
        }
      }),
    /lns\.windowRanker\.featureDeltaGates\[0\]\.feature must be one of the LNS window ranker feature names/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            selectedFeatureGates: [{ feature: "selectedByBaseline" }]
          }
        }
      }),
    /lns\.windowRanker\.selectedFeatureGates\[0\] must include minValue or maxValue/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            selectedFeatureGates: [{ feature: "notAFeature", maxValue: 0 }]
          }
        }
      }),
    /lns\.windowRanker\.selectedFeatureGates\[0\]\.feature must be one of the LNS window ranker feature names/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            selectedFeatureGateGroups: [[]]
          }
        }
      }),
    /lns\.windowRanker\.selectedFeatureGateGroups\[0\] must be a non-empty array of gate objects/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 }
            },
            selectedFeatureGateGroups: [[{ feature: "notAFeature", maxValue: 0 }]]
          }
        }
      }),
    /lns\.windowRanker\.selectedFeatureGateGroups\[0\]\[0\]\.feature must be one of the LNS window ranker feature names/
  );

  assert.throws(
    () =>
      solveLns(buildGrid(3, 3), {
        optimizer: "lns",
        availableBuildings: { residentials: 0, services: 0 },
        lns: {
          iterations: 1,
          windowRanker: {
            model: {
              modelType: "lns-window-linear-pairwise-ranker",
              featureSchemaVersion: 2,
              weights: { selectedByBaseline: 1 },
              interactionWeights: { "selectedByBaseline*notAFeature": 1 }
            }
          }
        }
      }),
    /lns\.windowRanker\.model\.interactionWeights keys must be pairwise feature names/
  );

  assert.doesNotThrow(() =>
    normalizeLnsWindowRankerOptions(
      runtimeModel({ selectedByBaseline: 1 }, { "selectedByBaseline*selectedByBaseline": -1 })
    )
  );
}

testWindowRankerCanOverrideAdaptiveBaseline();
testWindowRankerTrajectoryFeaturesCanOverrideByTransition();
testWindowRankerInteractionWeightsCanOverrideAdaptiveBaseline();
testWindowRankerFallsBackWhenScoreDeltaIsTooSmall();
testWindowRankerFallsBackWhenTransitionIsNotAllowed();
testWindowRankerFallsBackWhenFeatureDeltaGateFails();
testWindowRankerFallsBackWhenSelectedFeatureGateFails();
testSolveLnsWindowRankerTelemetryAndDefaultSafety();
testWindowRankerValidationRejectsBadWeights();
