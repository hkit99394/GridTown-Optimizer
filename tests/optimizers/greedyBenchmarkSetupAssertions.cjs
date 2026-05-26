const {
  assert,
  buildDeterministicAblationGateReport,
  createGreedyDeterministicAblationSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_GREEDY_BENCHMARK_OPTIONS,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
  formatDeterministicAblationGateReport,
  formatGreedyBenchmarkSuite,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyDeterministicAblation,
  listGreedyBenchmarkCaseNames,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyDeterministicAblationCaseNames,
  normalizeGreedyBenchmarkOptions,
  runGreedyBenchmarkSuite,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyDeterministicAblation,
  solveGreedy,
  validateSolution,
  sortedRoads
} = require("./greedyBenchmarkHarnessDeps.cjs");

const STEP14_GREEDY_BENCHMARK_NAME = "step14-service-lookahead-reranker";
const STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME = "step14-deterministic-lookahead-ties";
const STEP14_ROW0_PATH_NULL_BENCHMARK_NAME = "step14-row0-path-null-reservation";
const STEP14_SCARCE_REFILL_BENCHMARK_NAME = "step14-scarce-type-sequential-refill";
const STEP14_FOLLOW_UP_BENCHMARK_NAMES = [
  STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME,
  STEP14_ROW0_PATH_NULL_BENCHMARK_NAME,
  STEP14_SCARCE_REFILL_BENCHMARK_NAME
];
const GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION = "serviceLookaheadCandidates";
const GREEDY_LOOKAHEAD_DISABLED = { [GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION]: undefined };

function getRequiredGreedyBenchmarkCase(name) {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === name);
  assert.ok(benchmarkCase, `Missing greedy benchmark case: ${name}`);
  return benchmarkCase;
}

function withPatchedGreedySolver(solveGreedyImpl, callback) {
  const solverModule = require("../../dist/packages/solvers/greedy/solver.js");
  const originalSolveGreedy = solverModule.solveGreedy;
  solverModule.solveGreedy = solveGreedyImpl;

  try {
    return callback();
  } finally {
    solverModule.solveGreedy = originalSolveGreedy;
  }
}

function runGreedyServiceLookaheadBenchmarkPair(name, solveGreedyImpl) {
  const benchmarkName = name ?? STEP14_GREEDY_BENCHMARK_NAME;
  const runPair = () => {
    const baseline = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
      names: [benchmarkName],
      greedy: GREEDY_LOOKAHEAD_DISABLED
    });
    const enabled = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
      names: [benchmarkName]
    });
    return { baseline, enabled };
  };

  return solveGreedyImpl ? withPatchedGreedySolver(solveGreedyImpl, runPair) : runPair();
}

function solveGreedyBenchmarkCase(name, greedyOverrides) {
  const benchmarkCase = getRequiredGreedyBenchmarkCase(name);
  const params = structuredClone(benchmarkCase.params);
  params.greedy = {
    ...(params.greedy ?? {}),
    ...(greedyOverrides ?? {}),
    profile: true
  };

  return {
    benchmarkCase,
    params,
    solution: solveGreedy(
      benchmarkCase.grid.map((row) => [...row]),
      params
    )
  };
}

function solveValidatedGreedyBenchmarkCase(name, greedyOverrides) {
  const solved = solveGreedyBenchmarkCase(name, greedyOverrides);
  return {
    ...solved,
    validation: validateSolution({
      grid: solved.benchmarkCase.grid,
      solution: solved.solution,
      params: solved.params
    })
  };
}

function assertStep14BenchmarkIsolation(name, expectedLocalSearch) {
  const benchmarkCase = getRequiredGreedyBenchmarkCase(name);
  const greedy = benchmarkCase.params.greedy ?? {};

  assert.equal(listGreedyBenchmarkCaseNames().includes(name), true);
  assert.match(benchmarkCase.description, /Step 14/i);
  assert.equal(greedy.serviceLookaheadCandidates, 4);
  assert.equal(greedy.localSearch, expectedLocalSearch);
  assert.equal(greedy.localSearchServiceMoves, false);
  assert.equal(greedy.serviceRefineIterations, 0);
  assert.equal(greedy.exhaustiveServiceSearch, false);

  return benchmarkCase;
}

function assertLookaheadCounters(result, evaluations, wins) {
  assert.equal(result.greedyProfile.counters.servicePhase.lookaheadEvaluations, evaluations);
  assert.equal(result.greedyProfile.counters.servicePhase.lookaheadWins, wins);
}

function testGreedyBenchmarkCorpusHelpers() {
  const names = DEFAULT_GREEDY_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(listGreedyBenchmarkCaseNames(), names);

  const normalized = normalizeGreedyBenchmarkOptions(
    {
      localSearch: false,
      restarts: 4
    },
    {
      randomSeed: 13
    }
  );

  assert.equal(normalized.localSearch, false);
  assert.equal(normalized.profile, true);
  assert.equal(normalized.randomSeed, 13);
  assert.equal(normalized.restarts, 4);
  assert.equal(normalized.serviceRefineIterations, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineIterations);
  assert.equal(normalized.serviceRefineCandidateLimit, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceRefineCandidateLimit);
  assert.equal(normalized.serviceLookaheadCandidates, undefined);
  assert.equal(normalized.exhaustiveServiceSearch, false);
  assert.equal(normalized.serviceExactPoolLimit, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactPoolLimit);
  assert.equal(normalized.serviceExactMaxCombinations, DEFAULT_GREEDY_BENCHMARK_OPTIONS.serviceExactMaxCombinations);

  const normalizedLookahead = normalizeGreedyBenchmarkOptions(undefined, {
    [GREEDY_SERVICE_LOOKAHEAD_CANDIDATES_OPTION]: 4
  });

  assert.equal(normalizedLookahead.serviceLookaheadCandidates, 4);

  assert.throws(
    () => runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown greedy benchmark case\(s\): missing-case/
  );

  const legacyResult = runGreedyBenchmarkSuite(
    [
      {
        name: "legacy-top-level",
        description: "Legacy top-level greedy options stay consistent in benchmarks.",
        grid: [
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [1, 1, 1, 1]
        ],
        params: {
          optimizer: "greedy",
          residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
          availableBuildings: { services: 0, residentials: 1 },
          localSearch: false,
          restarts: 4,
          serviceRefineIterations: 0,
          serviceRefineCandidateLimit: 3,
          exhaustiveServiceSearch: false,
          serviceExactPoolLimit: 3,
          serviceExactMaxCombinations: 12
        }
      }
    ],
    undefined
  );

  assert.equal(legacyResult.results[0].greedyOptions.localSearch, false);
  assert.equal(legacyResult.results[0].greedyOptions.restarts, 4);
}

function testGreedyConnectivityShadowScoringAblationRunner() {
  const ablationCase = {
    name: "shadow-ablation-fixture",
    description: "Small fixture for baseline vs opt-in connectivity-shadow scoring.",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 2 }],
      availableBuildings: { services: 0, residentials: 2 },
      greedy: {
        localSearch: false,
        randomSeed: 11,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 1,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 1,
        serviceExactMaxCombinations: 1,
        profile: true
      }
    }
  };

  const result = runGreedyConnectivityShadowScoringAblation([ablationCase]);
  const formatted = formatGreedyConnectivityShadowScoringAblation(result);

  assert.equal(
    DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES.includes("row0-corridor-repair-pressure"),
    true
  );
  assert.equal(
    DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS.some(
      (entry) => entry.name === "row0-corridor-repair-pressure"
    ),
    true
  );
  assert.equal(listGreedyConnectivityShadowScoringAblationCaseNames().includes("bridge-connectivity-heavy"), true);
  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["shadow-ablation-fixture"]);
  assert.deepEqual(result.variants, ["baseline", "connectivity-shadow"]);
  assert.equal(result.coverage.caseCount, 1);
  assert.equal(result.coverage.runCount, 2);
  assert.equal(result.coverage.variantCount, 2);
  assert.equal(result.coverage.gridCellCount, 9);
  assert.equal(result.coverage.profileEnabledRuns, 2);
  assert.equal(result.cases[0].baseline.connectivityShadowScoring, false);
  assert.equal(result.cases[0].connectivityShadow.connectivityShadowScoring, true);
  assert.equal(result.cases[0].baseline.greedyOptions.connectivityShadowScoring, false);
  assert.equal(result.cases[0].connectivityShadow.greedyOptions.connectivityShadowScoring, true);
  assert.equal(
    result.cases[0].populationDelta,
    result.cases[0].connectivityShadow.totalPopulation - result.cases[0].baseline.totalPopulation
  );
  assert.equal(
    result.cases[0].wallClockDeltaSeconds,
    result.cases[0].connectivityShadow.wallClockSeconds - result.cases[0].baseline.wallClockSeconds
  );
  assert.match(formatted, /=== Greedy Connectivity-Shadow Scoring Ablation ===/);
  assert.match(formatted, /Coverage: cases=1 runs=2 variants=2 grid-cells=9/);
  assert.match(formatted, /Population delta:/);
  assert.match(formatted, /wall-delta=/);
  assert.match(formatted, /baseline=connectivityShadowScoring:false/);
  assert.match(formatted, /connectivity-shadow=connectivityShadowScoring:true/);
}

function testGreedyDeterministicAblationRunner() {
  const ablationCase = {
    name: "deterministic-ablation-fixture",
    description: "Small fixture for deterministic Greedy variant comparisons.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 40, avail: 3 }],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: {
        localSearch: true,
        localSearchServiceMoves: true,
        randomSeed: 11,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16,
        profile: true
      }
    }
  };
  const variants = [
    { name: "baseline", description: "Baseline fixture settings.", greedy: {} },
    {
      name: "no-local-search",
      description: "Disable all local search.",
      greedy: { localSearch: false, localSearchServiceMoves: false }
    },
    { name: "deferred-roads", description: "Enable deferred road commitment.", greedy: { deferRoadCommitment: true } }
  ];

  const result = runGreedyDeterministicAblation([ablationCase], { variants });
  const formatted = formatGreedyDeterministicAblation(result);
  const snapshot = createGreedyDeterministicAblationSnapshot(result);
  const benchmarkCase = result.cases[0];
  const baselineSummary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
  const noLocalSearch = benchmarkCase.variants.find((entry) => entry.variantName === "no-local-search");

  assert.equal(DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES.includes("step14-service-lookahead-reranker"), true);
  assert.equal(listGreedyDeterministicAblationCaseNames().includes("row0-corridor-repair-pressure"), true);
  const defaultServiceMasterVariantResult = runGreedyDeterministicAblation([ablationCase], {
    variantNames: ["service-master-decomposition"]
  });
  assert.deepEqual(defaultServiceMasterVariantResult.variants, ["baseline", "service-master-decomposition"]);
  assert.equal(
    defaultServiceMasterVariantResult.cases[0].variants.find(
      (entry) => entry.variantName === "service-master-decomposition"
    ).greedyOptions.serviceMasterDecomposition,
    true
  );
  assert.equal(result.caseCount, 1);
  assert.equal(result.seedCount, 1);
  assert.equal(result.comparisonCount, 1);
  assert.deepEqual(result.seeds, []);
  assert.deepEqual(result.selectedCaseNames, ["deterministic-ablation-fixture"]);
  assert.deepEqual(result.variants, ["baseline", "no-local-search", "deferred-roads"]);
  assert.equal(result.coverage.caseCount, 1);
  assert.equal(result.coverage.seedCount, 1);
  assert.equal(result.coverage.comparisonCount, 1);
  assert.equal(result.coverage.runCount, 3);
  assert.equal(result.coverage.variantCount, 3);
  assert.equal(result.coverage.gridCellCount, 16);
  assert.equal(result.coverage.profileEnabledRuns, 0);
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.variantSummaries[0], "meanWallClockSeconds"), false);
  assert.equal(Object.hasOwn(snapshot.cases[0].baseline, "wallClockSeconds"), false);
  assert.equal(benchmarkCase.baseline.greedyOptions.profile, false);
  assert.equal(benchmarkCase.baseline.populationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.meanPopulationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.winRate, 0);
  assert.equal(baselineSummary.regressionRate, 0);
  assert.equal(baselineSummary.unchangedRate, 1);
  assert.equal(baselineSummary.worstPopulationDeltaVsBaseline, 0);
  assert.equal(baselineSummary.worstPopulationDeltaCaseName, "deterministic-ablation-fixture");
  assert.equal(baselineSummary.worstPopulationDeltaSeed, null);
  assert.equal(baselineSummary.bestPopulationDeltaCaseName, "deterministic-ablation-fixture");
  assert.equal(baselineSummary.bestPopulationDeltaSeed, null);
  assert.equal(noLocalSearch.greedyOptions.localSearch, false);
  assert.equal(
    noLocalSearch.populationDeltaVsBaseline,
    noLocalSearch.totalPopulation - benchmarkCase.baseline.totalPopulation
  );
  assert.match(formatted, /=== Greedy Deterministic Ablation Matrix ===/);
  assert.match(formatted, /Seeds: case-default/);
  assert.match(formatted, /worst-decile=/);
  assert.match(formatted, /win-rate=0\.0%/);
  assert.match(formatted, /unchanged-rate=100\.0%/);
  assert.match(formatted, /worst-case=deterministic-ablation-fixture\/case-default/);
  assert.match(formatted, /no-local-search=population:/);

  const seededResult = runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7, 19] });
  const seededFormatted = formatGreedyDeterministicAblation(seededResult);
  assert.deepEqual(seededResult.seeds, [7, 19]);
  assert.equal(seededResult.seedCount, 2);
  assert.equal(seededResult.caseCount, 1);
  assert.equal(seededResult.comparisonCount, 2);
  assert.deepEqual(seededResult.selectedCaseNames, ["deterministic-ablation-fixture"]);
  assert.equal(seededResult.coverage.caseCount, 1);
  assert.equal(seededResult.coverage.seedCount, 2);
  assert.equal(seededResult.coverage.comparisonCount, 2);
  assert.equal(seededResult.coverage.runCount, 6);
  assert.equal(seededResult.variantSummaries[0].caseCount, 1);
  assert.equal(seededResult.variantSummaries[0].seedCount, 2);
  assert.equal(seededResult.variantSummaries[0].comparisonCount, 2);
  assert.equal(seededResult.variantSummaries[0].unchangedRate, 1);
  assert.equal(seededResult.variantSummaries[0].worstPopulationDeltaSeed, 7);
  assert.equal(seededResult.variantSummaries[0].bestPopulationDeltaSeed, 7);
  assert.deepEqual(
    seededResult.cases.map((entry) => entry.seed),
    [7, 19]
  );
  assert.deepEqual(
    seededResult.cases.flatMap((entry) => entry.variants.map((variant) => variant.greedyOptions.randomSeed)),
    [7, 7, 7, 19, 19, 19]
  );
  for (const seededCase of seededResult.cases) {
    for (const variant of seededCase.variants) {
      assert.equal(variant.seed, seededCase.seed);
      assert.equal(variant.greedyOptions.randomSeed, seededCase.seed);
    }
  }
  assert.match(seededFormatted, /Seeds: 7, 19/);
  assert.match(seededFormatted, /comparisons=2/);
  assert.throws(
    () =>
      runGreedyDeterministicAblation([ablationCase], {
        variants: [
          { name: "no-local-search", description: "Invalid missing baseline.", greedy: { localSearch: false } }
        ]
      }),
    /must include the baseline variant/
  );
  assert.throws(
    () =>
      runGreedyDeterministicAblation([ablationCase], {
        variantNames: ["no-local-search", "no-local-search"]
      }),
    /requested variants must use unique names/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7.5] }),
    /must contain only integer seeds between 0 and 2147483647/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [4294967297] }),
    /must contain only integer seeds between 0 and 2147483647/
  );
  assert.throws(
    () => runGreedyDeterministicAblation([ablationCase], { variants, seeds: [7, 7] }),
    /must not contain duplicate seeds/
  );
}

function testDeterministicAblationGateReport() {
  const summary = (variantName, overrides = {}) => ({
    variantName,
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 4,
    medianPopulationDeltaVsBaseline: 0,
    worstDecilePopulationDeltaVsBaseline: 0,
    bestPopulationDeltaVsBaseline: 0,
    worstPopulationDeltaVsBaseline: 0,
    winRate: 0,
    regressionRate: 0,
    unchangedRate: 1,
    bestPopulationDeltaCaseName: "case-a",
    bestPopulationDeltaSeed: 7,
    worstPopulationDeltaCaseName: "case-a",
    worstPopulationDeltaSeed: 7,
    ...overrides
  });
  const greedySuite = {
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 4,
    seeds: [7, 19],
    selectedCaseNames: ["case-a", "case-b"],
    variants: ["baseline", "candidate", "target", "bad"],
    variantSummaries: [
      summary("baseline"),
      summary("candidate", {
        medianPopulationDeltaVsBaseline: 10,
        bestPopulationDeltaVsBaseline: 20,
        winRate: 0.75,
        unchangedRate: 0.25
      }),
      summary("target", {
        bestPopulationDeltaVsBaseline: 10,
        winRate: 0.25,
        unchangedRate: 0.75
      }),
      summary("bad", {
        worstDecilePopulationDeltaVsBaseline: -5,
        worstPopulationDeltaVsBaseline: -5,
        bestPopulationDeltaVsBaseline: 20,
        winRate: 0.25,
        regressionRate: 0.25,
        unchangedRate: 0.5
      })
    ]
  };
  const lnsSuite = {
    caseCount: 1,
    seedCount: 2,
    comparisonCount: 2,
    seeds: [7, 19],
    selectedCaseNames: ["lns-case"],
    variants: ["baseline", "moved-window"],
    variantSummaries: [
      summary("baseline", {
        caseCount: 1,
        comparisonCount: 2,
        firstWindowMovementRate: 0,
        windowSequenceMovementRate: 0,
        anchorCoordinateMovementRate: 0
      }),
      summary("moved-window", {
        caseCount: 1,
        comparisonCount: 2,
        firstWindowMovementRate: 0,
        windowSequenceMovementRate: 1,
        anchorCoordinateMovementRate: 1
      })
    ]
  };

  const report = buildDeterministicAblationGateReport({ greedy: greedySuite, lns: lnsSuite });
  const formatted = formatDeterministicAblationGateReport(report);
  const greedyDecisions = report.suites.find((entry) => entry.suite === "greedy-deterministic").decisions;
  const lnsDecisions = report.suites.find((entry) => entry.suite === "lns-neighborhood").decisions;

  assert.deepEqual(DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS, [7, 19, 37]);
  assert.equal(report.reportType, "deterministic-ablation-gate");
  assert.equal(Object.hasOwn(report, "generatedAt"), false);
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "baseline").decision, "keep-baseline");
  assert.equal(
    greedyDecisions.find((entry) => entry.variantName === "candidate").decision,
    "safe-deterministic-candidate"
  );
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "target").decision, "learning-target");
  assert.equal(greedyDecisions.find((entry) => entry.variantName === "bad").decision, "blocked-regression");
  assert.equal(lnsDecisions.find((entry) => entry.variantName === "moved-window").decision, "learning-target");
  assert.match(formatted, /Deterministic Ablation Gate Report/);
  assert.match(formatted, /candidate: safe-deterministic-candidate/);
  assert.match(formatted, /Collect counterfactual LNS window replay labels/);
  assert.throws(() => buildDeterministicAblationGateReport({}), /requires at least one suite result/);
}

function testGreedyStep14ServiceLookaheadBenchmarkCaseIsolated() {
  assertStep14BenchmarkIsolation(STEP14_GREEDY_BENCHMARK_NAME, true);
}

function testGreedyStep14FollowUpBenchmarkCasesStayIsolated() {
  for (const name of STEP14_FOLLOW_UP_BENCHMARK_NAMES) {
    assertStep14BenchmarkIsolation(name, false);
  }
}

function testGreedyServiceLookaheadIsOffByDefaultAndLeavesCorpusUnchangedWhenOff() {
  const { baseline } = runGreedyServiceLookaheadBenchmarkPair(STEP14_GREEDY_BENCHMARK_NAME);
  const untouchedCorpusCase = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"]
  });

  assert.deepEqual(baseline.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(baseline.results[0].totalPopulation, 395);
  assert.equal(baseline.results[0].serviceCount, 2);
  assert.equal(baseline.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations, 0);
  assert.equal(baseline.results[0].greedyProfile.counters.servicePhase.lookaheadWins, 0);
  assert.deepEqual(untouchedCorpusCase.selectedCaseNames, ["compact-service-single"]);
  assert.equal(untouchedCorpusCase.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(untouchedCorpusCase.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations, 0);
}

function testGreedyStep14ServiceLookaheadBenchmarkCaseImprovesWhenEnabled() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_GREEDY_BENCHMARK_NAME);

  assert.deepEqual(baseline.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_GREEDY_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].greedyOptions.serviceLookaheadCandidates, undefined);
  assert.equal(enabled.results[0].greedyOptions.serviceLookaheadCandidates, 4);
  assert.equal(baseline.results[0].totalPopulation, 395);
  assert.equal(enabled.results[0].totalPopulation, 395);
  assert.equal(enabled.results[0].serviceCount, 2);
  assert.equal(enabled.results[0].roadCount < baseline.results[0].roadCount, true);
  assert.equal(enabled.results[0].greedyProfile.counters.servicePhase.lookaheadEvaluations > 0, true);
  assert.equal(enabled.results[0].greedyProfile.counters.servicePhase.lookaheadWins > 0, true);
}

function testGreedyStep14DeterministicLookaheadTieBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  const baselineSolve = solveGreedyBenchmarkCase(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME, GREEDY_LOOKAHEAD_DISABLED);
  const firstEnabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  const secondEnabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME]);
  assert.equal(enabled.results[0].name, STEP14_DETERMINISTIC_TIES_BENCHMARK_NAME);
  assert.equal(baseline.results[0].totalPopulation, 200);
  assert.equal(enabled.results[0].totalPopulation, 200);
  assert.equal(enabled.results[0].serviceCount, 1);
  assert.equal(enabled.results[0].residentialCount, 2);
  assertLookaheadCounters(enabled.results[0], 28, 2);
  assert.deepEqual(baselineSolve.solution.services, [{ r: 1, c: 0, rows: 1, cols: 1, range: 1 }]);
  assert.deepEqual(firstEnabledSolve.solution.services, [{ r: 1, c: 0, rows: 1, cols: 1, range: 1 }]);
  assert.deepEqual(firstEnabledSolve.solution.residentials, [
    { r: 0, c: 1, rows: 2, cols: 2 },
    { r: 2, c: 0, rows: 2, cols: 2 }
  ]);
  assert.deepEqual(firstEnabledSolve.solution.populations, [100, 100]);
  assert.deepEqual(sortedRoads(firstEnabledSolve.solution), ["0,0"]);
  assert.deepEqual(firstEnabledSolve.solution.services, baselineSolve.solution.services);
  assert.deepEqual(secondEnabledSolve.solution.services, firstEnabledSolve.solution.services);
  assert.deepEqual(secondEnabledSolve.solution.residentials, firstEnabledSolve.solution.residentials);
  assert.deepEqual(secondEnabledSolve.solution.populations, firstEnabledSolve.solution.populations);
  assert.deepEqual(sortedRoads(secondEnabledSolve.solution), sortedRoads(firstEnabledSolve.solution));
  assert.equal(firstEnabledSolve.validation.valid, true);
  assert.equal(secondEnabledSolve.validation.valid, true);
  assert.match(formatGreedyBenchmarkSuite(enabled), /step14=/);
}

function testGreedyStep14Row0PathNullReservationBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_ROW0_PATH_NULL_BENCHMARK_NAME);
  const baselineSolve = solveValidatedGreedyBenchmarkCase(
    STEP14_ROW0_PATH_NULL_BENCHMARK_NAME,
    GREEDY_LOOKAHEAD_DISABLED
  );
  const enabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_ROW0_PATH_NULL_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_ROW0_PATH_NULL_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].totalPopulation, 230);
  assert.equal(enabled.results[0].totalPopulation, 230);
  assert.equal(enabled.results[0].serviceCount, 1);
  assert.equal(enabled.results[0].residentialCount, 2);
  assertLookaheadCounters(enabled.results[0], 56, 6);
  assert.deepEqual(baselineSolve.solution.services, [{ r: 1, c: 0, rows: 1, cols: 1, range: 1 }]);
  assert.deepEqual(enabledSolve.solution.services, [{ r: 0, c: 2, rows: 1, cols: 1, range: 1 }]);
  assert.deepEqual(sortedRoads(baselineSolve.solution), ["0,0"]);
  assert.deepEqual(sortedRoads(enabledSolve.solution), ["0,3"]);
  assert.deepEqual(enabledSolve.solution.residentials, [
    { r: 0, c: 0, rows: 3, cols: 2 },
    { r: 1, c: 2, rows: 2, cols: 2 }
  ]);
  assert.equal(enabledSolve.solution.services[0].r, 0);
  assert.equal(enabledSolve.solution.roads.size, baselineSolve.solution.roads.size);
  assert.equal(baselineSolve.validation.valid, true);
  assert.equal(enabledSolve.validation.valid, true);
}

function testGreedyStep14ScarceTypeSequentialRefillBenchmarkCase() {
  const { baseline, enabled } = runGreedyServiceLookaheadBenchmarkPair(STEP14_SCARCE_REFILL_BENCHMARK_NAME);
  const baselineSolve = solveValidatedGreedyBenchmarkCase(
    STEP14_SCARCE_REFILL_BENCHMARK_NAME,
    GREEDY_LOOKAHEAD_DISABLED
  );
  const enabledSolve = solveValidatedGreedyBenchmarkCase(STEP14_SCARCE_REFILL_BENCHMARK_NAME);

  assert.equal(enabled.caseCount, 1);
  assert.deepEqual(enabled.selectedCaseNames, [STEP14_SCARCE_REFILL_BENCHMARK_NAME]);
  assert.equal(baseline.results[0].totalPopulation, 275);
  assert.equal(enabled.results[0].totalPopulation, 275);
  assert.equal(enabled.results[0].serviceCount, 1);
  assert.equal(enabled.results[0].residentialCount, 3);
  assertLookaheadCounters(enabled.results[0], 104, 1);
  assert.deepEqual(enabledSolve.solution.services, [{ r: 1, c: 2, rows: 1, cols: 1, range: 1 }]);
  assert.deepEqual(enabledSolve.solution.residentialTypeIndices, [0, 1, 1]);
  assert.deepEqual(enabledSolve.solution.populations, [95, 90, 90]);
  assert.equal(enabledSolve.solution.residentialTypeIndices.filter((typeIndex) => typeIndex === 0).length, 1);
  assert.equal(enabledSolve.solution.residentialTypeIndices.filter((typeIndex) => typeIndex === 1).length, 2);
  assert.deepEqual(baselineSolve.solution.residentialTypeIndices, [0, 1, 1]);
  assert.deepEqual(baselineSolve.solution.populations, [95, 90, 90]);
  assert.equal(enabledSolve.solution.totalPopulation, baselineSolve.solution.totalPopulation);
  assert.equal(baselineSolve.validation.valid, true);
  assert.equal(enabledSolve.validation.valid, true);
}

function testGreedyStep14LookaheadCapsRefillDepthWhenMaxResidentialsIsOne() {
  const grid = [
    [0, 1, 1, 1, 1, 1],
    [1, 1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [0, 1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1, 0]
  ];
  const enabledParams = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
      { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 5 },
      { w: 2, h: 3, min: 90, max: 170, avail: 3 }
    ],
    availableBuildings: { residentials: 1 },
    greedy: {
      localSearch: false,
      localSearchServiceMoves: false,
      randomSeed: 13,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 6,
      serviceExactMaxCombinations: 64,
      serviceLookaheadCandidates: 4,
      profile: true
    }
  };
  const baselineParams = structuredClone(enabledParams);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    serviceLookaheadCandidates: undefined
  };

  const baseline = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const enabled = solveGreedy(
    grid.map((row) => [...row]),
    enabledParams
  );
  const validation = validateSolution({ grid, solution: enabled, params: enabledParams });

  assert.equal(baseline.totalPopulation, 170);
  assert.equal(enabled.totalPopulation, 170);
  assert.equal(enabled.residentials.length, 1);
  assert.deepEqual(enabled.services, [
    { r: 2, c: 3, rows: 1, cols: 2, range: 1 },
    { r: 2, c: 0, rows: 1, cols: 1, range: 1 }
  ]);
  assert.deepEqual(enabled.serviceTypeIndices, [2, 0]);
  assert.deepEqual(enabled.residentials, [{ r: 0, c: 1, rows: 3, cols: 2 }]);
  assert.deepEqual(enabled.residentialTypeIndices, [1]);
  assert.deepEqual(enabled.populations, [170]);
  assert.equal(enabled.greedyProfile.counters.servicePhase.lookaheadEvaluations > 0, true);
  assert.equal(enabled.greedyProfile.counters.servicePhase.lookaheadWins > 0, true);
  assert.equal(validation.valid, true);
}

function runGreedyBenchmarkSetupAssertions() {
  testGreedyBenchmarkCorpusHelpers();
  testGreedyConnectivityShadowScoringAblationRunner();
  testGreedyDeterministicAblationRunner();
  testDeterministicAblationGateReport();
  testGreedyStep14ServiceLookaheadBenchmarkCaseIsolated();
  testGreedyStep14FollowUpBenchmarkCasesStayIsolated();
  testGreedyServiceLookaheadIsOffByDefaultAndLeavesCorpusUnchangedWhenOff();
  testGreedyStep14ServiceLookaheadBenchmarkCaseImprovesWhenEnabled();
  testGreedyStep14DeterministicLookaheadTieBenchmarkCase();
  testGreedyStep14Row0PathNullReservationBenchmarkCase();
  testGreedyStep14ScarceTypeSequentialRefillBenchmarkCase();
}

function runGreedyServiceLookaheadOptimizerAssertions() {
  testGreedyStep14LookaheadCapsRefillDepthWhenMaxResidentialsIsOne();
}

module.exports = {
  runGreedyBenchmarkSetupAssertions,
  runGreedyServiceLookaheadOptimizerAssertions
};
