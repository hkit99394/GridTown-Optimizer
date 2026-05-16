const {
  assert,
  buildCpSatBenchmarkCpuPlan,
  DEFAULT_LEARNED_RANKING_LABEL_SPLITS,
  DEFAULT_LNS_REPLAY_LABEL_CASE_NAMES,
  DEFAULT_LNS_REPLAY_LABEL_CORPUS,
  DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_LNS_BENCHMARK_CORPUS,
  DEFAULT_LNS_BENCHMARK_OPTIONS,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS,
  formatLnsNeighborhoodAblation,
  formatLnsBenchmarkSuite,
  formatLnsWindowReplayLabels,
  listLnsReplayPressureFamilies,
  listLnsNeighborhoodAblationCaseNames,
  listLnsBenchmarkCaseNames,
  listLnsWindowReplayCaseNames,
  normalizeLnsBenchmarkOptions,
  runLnsNeighborhoodAblation,
  runLnsWindowReplayLabels,
  runLnsBenchmarkSuite,
  DEFAULT_CP_SAT_BENCHMARK_CORPUS,
  DEFAULT_CP_SAT_BENCHMARK_OPTIONS,
  DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES,
  formatCpSatBenchmarkSuite,
  listCpSatBenchmarkCaseNames,
  normalizeCpSatBenchmarkOptions,
  runCpSatBenchmarkSuite,
  solveGreedy,
  resolveCpSatPython,
  buildMockSolution
} = require("./optimizerHarnessDeps.cjs");

async function testCpSatBenchmarkCorpusHelpers() {
  const names = DEFAULT_CP_SAT_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(listCpSatBenchmarkCaseNames(), names);
  assert.deepEqual(
    [...DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES],
    [
      "typed-housing-single",
      "road-semantics-corridor-pressure",
      "road-semantics-gate-choke",
      "road-semantics-service-pressure",
      "multi-anchor-road-components",
      "road-semantics-dense-saturated"
    ]
  );
  assert(DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES.every((name) => names.includes(name)));
  assert.equal(names.includes("typed-housing-portfolio"), true);
  assert.equal(DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES.includes("typed-housing-portfolio"), false);

  const normalized = normalizeCpSatBenchmarkOptions(
    {
      timeLimitSeconds: 12,
      portfolio: {
        workerCount: 2
      }
    },
    {
      randomSeed: 7
    }
  );

  assert.equal(normalized.timeLimitSeconds, 12);
  assert.equal(normalized.maxDeterministicTime, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.maxDeterministicTime);
  assert.equal(normalized.numWorkers, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.numWorkers);
  assert.equal(normalized.randomSeed, 7);
  assert.equal(normalized.randomizeSearch, false);
  assert.equal(normalized.progressIntervalSeconds, DEFAULT_CP_SAT_BENCHMARK_OPTIONS.progressIntervalSeconds);
  assert.deepEqual(normalized.portfolio?.randomSeeds, [7, 108]);
  assert.equal(normalized.portfolio?.workerCount, 2);
  assert.equal(normalized.portfolio?.perWorkerTimeLimitSeconds, 12);
  assert.equal(
    normalized.portfolio?.perWorkerMaxDeterministicTime,
    DEFAULT_CP_SAT_BENCHMARK_OPTIONS.maxDeterministicTime
  );
  assert.equal(normalized.portfolio?.perWorkerNumWorkers, 1);
  assert.equal(normalized.portfolio?.totalCpuBudgetSeconds, 24);

  assert.deepEqual(buildCpSatBenchmarkCpuPlan(normalized), {
    mode: "portfolio",
    wallClockBudgetSeconds: 12,
    workerCount: 2,
    perWorkerNumWorkers: 1,
    perWorkerTimeLimitSeconds: 12,
    parallelWorkerCount: 2,
    workerCpuBudgetSeconds: 24,
    cpuBudgetMultiplier: 2,
    totalCpuBudgetSeconds: 24,
    cpuBudgetHeadroomSeconds: 0,
    admission: "within-budget"
  });

  assert.deepEqual(
    buildCpSatBenchmarkCpuPlan({
      timeLimitSeconds: 5,
      numWorkers: 4
    }),
    {
      mode: "single",
      wallClockBudgetSeconds: 5,
      workerCount: 1,
      perWorkerNumWorkers: 4,
      perWorkerTimeLimitSeconds: 5,
      parallelWorkerCount: 4,
      workerCpuBudgetSeconds: 20,
      cpuBudgetMultiplier: 4,
      totalCpuBudgetSeconds: null,
      cpuBudgetHeadroomSeconds: null,
      admission: "within-budget"
    }
  );

  const normalizedWithExplicitSeeds = normalizeCpSatBenchmarkOptions(
    {
      portfolio: {
        workerCount: 99,
        randomSeeds: [2, 5, 8]
      }
    },
    undefined
  );

  assert.equal(normalizedWithExplicitSeeds.portfolio?.workerCount, 3);
  assert.deepEqual(normalizedWithExplicitSeeds.portfolio?.randomSeeds, [2, 5, 8]);
  assert.equal(normalizedWithExplicitSeeds.portfolio?.totalCpuBudgetSeconds, 30);

  assert.throws(
    () =>
      normalizeCpSatBenchmarkOptions(
        {
          timeLimitSeconds: 5,
          portfolio: {
            workerCount: 3,
            totalCpuBudgetSeconds: 10
          }
        },
        undefined
      ),
    /CP-SAT benchmark portfolio requests 15 total CPU seconds, exceeding the 10 second benchmark portfolio budget/
  );

  await assert.rejects(
    () => runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown CP-SAT benchmark case\(s\): missing-case/
  );
}

function testLnsBenchmarkCorpusHelpers() {
  const names = DEFAULT_LNS_BENCHMARK_CORPUS.map((entry) => entry.name);
  const replayNames = DEFAULT_LNS_REPLAY_LABEL_CORPUS.map((entry) => entry.name);
  const pressureFamilies = listLnsReplayPressureFamilies();
  assert.equal(new Set(names).size, names.length);
  assert(names.includes("seeded-service-anchor-pressure"));
  assert(names.includes("lns-corridor-squeeze-pressure"));
  assert.deepEqual(replayNames, [...DEFAULT_LNS_REPLAY_LABEL_CASE_NAMES]);
  assert.equal(new Set(replayNames).size, replayNames.length);
  assert.equal(pressureFamilies.length >= 5, true);
  assert(pressureFamilies.includes("corridor"));
  assert(pressureFamilies.includes("gate"));
  assert(pressureFamilies.includes("footprint-pressure"));
  assert(pressureFamilies.includes("service-pressure"));
  assert(pressureFamilies.includes("anchor-service"));
  const replayCasesByName = new Map(DEFAULT_LNS_REPLAY_LABEL_CORPUS.map((entry) => [entry.name, entry]));
  const requiredReplayFamilies = ["corridor", "gate", "footprint-pressure", "service-pressure", "anchor-service"];
  for (const split of DEFAULT_LEARNED_RANKING_LABEL_SPLITS) {
    const splitFamilies = new Set(split.lnsCaseNames.map((name) => replayCasesByName.get(name)?.pressureFamily));
    assert.equal(
      split.lnsCaseNames.every((name) => replayCasesByName.has(name)),
      true
    );
    assert.equal(splitFamilies.size >= DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS.minPressureFamilies, true);
    for (const family of requiredReplayFamilies) {
      assert.equal(splitFamilies.has(family), true);
    }
  }
  assert.deepEqual(listLnsBenchmarkCaseNames(), names);
  assert.deepEqual(listLnsWindowReplayCaseNames(), replayNames);

  const normalized = normalizeLnsBenchmarkOptions(
    {
      iterations: 4,
      wallClockLimitSeconds: 20
    },
    {
      neighborhoodRows: 5,
      repairTimeLimitSeconds: 2
    }
  );

  assert.equal(normalized.iterations, 4);
  assert.equal(normalized.maxNoImprovementIterations, DEFAULT_LNS_BENCHMARK_OPTIONS.maxNoImprovementIterations);
  assert.equal(normalized.wallClockLimitSeconds, 20);
  assert.equal(normalized.neighborhoodRows, 5);
  assert.equal(normalized.neighborhoodCols, DEFAULT_LNS_BENCHMARK_OPTIONS.neighborhoodCols);
  assert.equal(normalized.repairTimeLimitSeconds, 2);

  assert.throws(
    () => runLnsBenchmarkSuite(DEFAULT_LNS_BENCHMARK_CORPUS, { names: ["missing-case"] }),
    /Unknown LNS benchmark case\(s\): missing-case/
  );

  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;
  let observedParams = null;

  lnsModule.solveLns = (grid, params) => {
    observedParams = params;
    grid[0][0] = 0;
    return buildMockSolution({ optimizer: "lns", totalPopulation: 77, cpSatStatus: "FEASIBLE" });
  };

  try {
    const result = runLnsBenchmarkSuite(DEFAULT_LNS_BENCHMARK_CORPUS, {
      names: ["typed-housing-single"],
      lns: {
        iterations: 3,
        wallClockLimitSeconds: 20
      },
      cpSat: {
        randomSeed: 29,
        numWorkers: 1
      },
      greedy: {
        randomSeed: 31,
        profile: true
      }
    });

    assert.equal(result.caseCount, 1);
    assert.deepEqual(result.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(result.results[0].name, "typed-housing-single");
    assert.equal(result.results[0].totalPopulation, 77);
    assert.equal(result.results[0].roadCount, 1);
    assert.equal(result.results[0].residentialCount, 1);
    assert.equal(result.results[0].cpSatStatus, "FEASIBLE");
    assert.equal(result.results[0].lnsOptions.iterations, 3);
    assert.equal(result.results[0].lnsOptions.wallClockLimitSeconds, 20);
    assert.equal(result.results[0].cpSatOptions.randomSeed, 29);
    assert.equal(result.results[0].greedyOptions.randomSeed, 31);
    assert(result.results[0].wallClockSeconds >= 0);
    assert.equal(DEFAULT_LNS_BENCHMARK_CORPUS[0].grid[0][0], 1);

    assert.equal(observedParams.optimizer, "lns");
    assert.equal(observedParams.lns.iterations, 3);
    assert.equal(
      observedParams.lns.maxNoImprovementIterations,
      DEFAULT_LNS_BENCHMARK_OPTIONS.maxNoImprovementIterations
    );
    assert.equal(observedParams.cpSat.randomSeed, 29);
    assert.equal(observedParams.greedy.randomSeed, 31);

    const snapshot = createLnsBenchmarkSnapshot(result);
    assert.equal(Object.hasOwn(snapshot.results[0], "wallClockSeconds"), false);
    assert.match(formatLnsBenchmarkSuite(result), /=== LNS Benchmark Suite ===/);
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsNeighborhoodAblationRunner() {
  const ablationCase = {
    name: "lns-neighborhood-ablation-fixture",
    description: "Small fixture for deterministic LNS neighborhood matrix comparisons.",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 100, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: {
        localSearch: false,
        randomSeed: 7,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16
      }
    }
  };
  const variants = DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS.filter(
    (variant) => variant.name === "baseline" || variant.name === "small-2x2"
  );
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;
  const observedRuns = [];

  lnsModule.solveLns = (grid, params) => {
    observedRuns.push({
      window: `${params.lns.neighborhoodRows}x${params.lns.neighborhoodCols}`,
      greedySeed: params.greedy.randomSeed,
      cpSatSeed: params.cpSat.randomSeed
    });
    grid[0][0] = 0;
    return {
      ...buildMockSolution({
        optimizer: "lns",
        totalPopulation: params.lns.neighborhoodRows === 2 ? 90 : 70,
        cpSatStatus: "FEASIBLE"
      }),
      lnsTelemetry: {
        stopReason: "iteration-limit",
        seedSource: "greedy",
        seedWallClockSeconds: 0,
        seedTimeLimitSeconds: null,
        wallClockLimitSeconds: null,
        noImprovementTimeoutSeconds: null,
        focusedRepairTimeLimitSeconds: 1,
        escalatedRepairTimeLimitSeconds: 1,
        iterationsStarted: 1,
        iterationsCompleted: 1,
        improvingIterations: params.lns.neighborhoodRows === 2 ? 1 : 0,
        neutralIterations: params.lns.neighborhoodRows === 2 ? 0 : 1,
        recoverableFailures: 0,
        skippedIterations: 0,
        finalStagnantIterations: 0,
        outcomes: [
          {
            iteration: 0,
            phase: "focused",
            window: { top: 1, left: 0, rows: params.lns.neighborhoodRows, cols: params.lns.neighborhoodCols },
            stagnantIterationsBefore: 0,
            staleSecondsBefore: 0,
            repairTimeLimitSeconds: 1,
            wallClockSeconds: 0,
            populationBefore: 70,
            populationAfter: params.lns.neighborhoodRows === 2 ? 90 : 70,
            improvement: params.lns.neighborhoodRows === 2 ? 20 : 0,
            status: params.lns.neighborhoodRows === 2 ? "improved" : "neutral"
          }
        ]
      }
    };
  };

  try {
    const result = runLnsNeighborhoodAblation([ablationCase], { variants });
    const formatted = formatLnsNeighborhoodAblation(result);
    const snapshot = createLnsNeighborhoodAblationSnapshot(result);
    const benchmarkCase = result.cases[0];
    const baselineSummary = result.variantSummaries.find((entry) => entry.variantName === "baseline");
    const smallWindowSummary = result.variantSummaries.find((entry) => entry.variantName === "small-2x2");
    const smallWindow = benchmarkCase.variants.find((entry) => entry.variantName === "small-2x2");

    assert.equal(DEFAULT_LNS_NEIGHBORHOOD_ABLATION_CASE_NAMES.includes("compact-service-repair"), true);
    assert.equal(listLnsNeighborhoodAblationCaseNames().includes("row0-anchor-repair"), true);
    assert.equal(result.caseCount, 1);
    assert.equal(result.seedCount, 1);
    assert.equal(result.comparisonCount, 1);
    assert.deepEqual(result.selectedCaseNames, ["lns-neighborhood-ablation-fixture"]);
    assert.deepEqual(result.variants, ["baseline", "small-2x2"]);
    assert.deepEqual(result.variantExecutionOrders, [{ seed: null, variants: ["baseline", "small-2x2"] }]);
    assert.deepEqual(snapshot.variantExecutionOrders, result.variantExecutionOrders);
    assert.deepEqual(
      observedRuns.map((entry) => entry.window),
      ["3x3", "2x2"]
    );
    assert.equal(result.coverage.caseCount, 1);
    assert.equal(result.coverage.seedCount, 1);
    assert.equal(result.coverage.comparisonCount, 1);
    assert.equal(result.coverage.runCount, 2);
    assert.equal(result.coverage.variantCount, 2);
    assert.equal(result.coverage.gridCellCount, 16);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(Object.hasOwn(snapshot.variantSummaries[0], "meanWallClockSeconds"), false);
    assert.equal(Object.hasOwn(snapshot.cases[0].baseline, "wallClockSeconds"), false);
    assert.equal(benchmarkCase.baseline.totalPopulation, 70);
    assert.equal(benchmarkCase.baseline.populationDeltaVsBaseline, 0);
    assert.equal(benchmarkCase.baseline.lnsOptions.neighborhoodAnchorPolicy, "ranked");
    assert.equal(baselineSummary.winRate, 0);
    assert.equal(baselineSummary.regressionRate, 0);
    assert.equal(baselineSummary.unchangedRate, 1);
    assert.equal(baselineSummary.worstPopulationDeltaVsBaseline, 0);
    assert.equal(baselineSummary.worstPopulationDeltaCaseName, "lns-neighborhood-ablation-fixture");
    assert.equal(baselineSummary.worstPopulationDeltaSeed, null);
    assert.equal(baselineSummary.firstWindowMovementCount, 0);
    assert.equal(baselineSummary.firstWindowMovementRate, 0);
    assert.equal(smallWindow.totalPopulation, 90);
    assert.equal(smallWindow.populationDeltaVsBaseline, 20);
    assert.equal(smallWindowSummary.improvedCaseCount, 1);
    assert.equal(smallWindowSummary.regressedCaseCount, 0);
    assert.equal(smallWindowSummary.unchangedCaseCount, 0);
    assert.equal(smallWindowSummary.winRate, 1);
    assert.equal(smallWindowSummary.regressionRate, 0);
    assert.equal(smallWindowSummary.unchangedRate, 0);
    assert.equal(smallWindowSummary.worstPopulationDeltaVsBaseline, 20);
    assert.equal(smallWindowSummary.bestPopulationDeltaCaseName, "lns-neighborhood-ablation-fixture");
    assert.equal(smallWindowSummary.bestPopulationDeltaSeed, null);
    assert.equal(smallWindowSummary.firstWindowMovementCount, 1);
    assert.equal(smallWindowSummary.firstWindowMovementRate, 1);
    assert.equal(smallWindowSummary.windowSequenceMovementCount, 1);
    assert.equal(smallWindowSummary.windowSequenceMovementRate, 1);
    assert.equal(smallWindowSummary.anchorCoordinateMovementCount, 0);
    assert.equal(smallWindowSummary.anchorCoordinateMovementRate, 0);
    assert.equal(smallWindow.lnsOptions.neighborhoodRows, 2);
    assert.equal(smallWindow.lnsOptions.neighborhoodCols, 2);
    assert.equal(smallWindow.improvingIterations, 1);
    assert.equal(smallWindow.outcomes[0].window.rows, 2);
    assert.equal(smallWindow.outcomes[0].status, "improved");
    assert.match(formatted, /=== LNS Neighborhood Ablation Matrix ===/);
    assert.match(formatted, /small-2x2=population:90/);
    assert.match(formatted, /window:2x2/);
    assert.match(formatted, /win-rate=100\.0%/);
    assert.match(formatted, /first-window-moved=1\/1/);
    assert.match(formatted, /first-window:1:0:2x2\/improved\/\+20/);

    observedRuns.length = 0;
    const seededResult = runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7, 19] });
    const seededFormatted = formatLnsNeighborhoodAblation(seededResult);

    assert.deepEqual(seededResult.seeds, [7, 19]);
    assert.equal(seededResult.caseCount, 1);
    assert.equal(seededResult.seedCount, 2);
    assert.equal(seededResult.comparisonCount, 2);
    assert.deepEqual(seededResult.selectedCaseNames, ["lns-neighborhood-ablation-fixture"]);
    assert.deepEqual(
      seededResult.cases.map((entry) => entry.seed),
      [7, 19]
    );
    assert.deepEqual(seededResult.variantExecutionOrders, [
      { seed: 7, variants: ["baseline", "small-2x2"] },
      { seed: 19, variants: ["small-2x2", "baseline"] }
    ]);
    assert.deepEqual(
      seededResult.cases.map((entry) => entry.variants.map((variant) => variant.variantName)),
      [
        ["baseline", "small-2x2"],
        ["baseline", "small-2x2"]
      ]
    );
    assert.equal(seededResult.coverage.caseCount, 1);
    assert.equal(seededResult.coverage.seedCount, 2);
    assert.equal(seededResult.coverage.comparisonCount, 2);
    assert.equal(seededResult.coverage.runCount, 4);
    assert.equal(seededResult.variantSummaries[0].caseCount, 1);
    assert.equal(seededResult.variantSummaries[0].seedCount, 2);
    assert.equal(seededResult.variantSummaries[0].comparisonCount, 2);
    assert.equal(seededResult.variantSummaries[0].unchangedRate, 1);
    assert.equal(seededResult.variantSummaries[1].winRate, 1);
    assert.equal(seededResult.variantSummaries[1].firstWindowMovementCount, 2);
    assert.equal(seededResult.variantSummaries[1].firstWindowMovementRate, 1);
    assert.deepEqual(
      observedRuns.map((entry) => `${entry.greedySeed}/${entry.cpSatSeed}/${entry.window}`),
      ["7/7/3x3", "7/7/2x2", "19/19/2x2", "19/19/3x3"]
    );
    for (const seededCase of seededResult.cases) {
      for (const variant of seededCase.variants) {
        assert.equal(variant.seed, seededCase.seed);
      }
    }
    assert.match(seededFormatted, /Seeds: 7, 19/);
    assert.match(seededFormatted, /comparisons=2/);

    assert.throws(
      () =>
        runLnsNeighborhoodAblation([ablationCase], {
          variants: [{ name: "small-2x2", description: "Invalid missing baseline.", lns: { neighborhoodRows: 2 } }]
        }),
      /must include the baseline variant/
    );
    assert.throws(
      () =>
        runLnsNeighborhoodAblation([ablationCase], {
          variantNames: ["small-2x2", "small-2x2"]
        }),
      /requested variants must use unique names/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7.5] }),
      /must contain only integer seeds between 0 and 2147483647/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [2147483648] }),
      /must contain only integer seeds between 0 and 2147483647/
    );
    assert.throws(
      () => runLnsNeighborhoodAblation([ablationCase], { variants, seeds: [7, 7] }),
      /must not contain duplicate seeds/
    );
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsNeighborhoodAblationWindowSequenceMovement() {
  const ablationCase = {
    name: "lns-window-sequence-movement-fixture",
    description: "Small fixture for later-window movement tracking.",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    params: {
      optimizer: "lns",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 }
    }
  };
  const variants = [
    { name: "baseline", description: "Baseline ranked anchors.", lns: { neighborhoodAnchorPolicy: "ranked" } },
    {
      name: "weak-service-first",
      description: "Alternative anchors.",
      lns: { neighborhoodAnchorPolicy: "weak-service-first" }
    }
  ];
  const lnsModule = require("../../dist/packages/solvers/lns/solver.js");
  const originalSolveLns = lnsModule.solveLns;

  lnsModule.solveLns = (_grid, params) => {
    const shifted = params.lns.neighborhoodAnchorPolicy === "weak-service-first";
    const windows = shifted
      ? [
          { top: 0, left: 0, rows: 3, cols: 3 },
          { top: 2, left: 2, rows: 3, cols: 3 }
        ]
      : [
          { top: 0, left: 0, rows: 3, cols: 3 },
          { top: 1, left: 1, rows: 3, cols: 3 }
        ];
    return {
      ...buildMockSolution({ optimizer: "lns", totalPopulation: 70, cpSatStatus: "FEASIBLE" }),
      lnsTelemetry: {
        stopReason: "iteration-limit",
        seedSource: "greedy",
        seedWallClockSeconds: 0,
        seedTimeLimitSeconds: null,
        wallClockLimitSeconds: null,
        noImprovementTimeoutSeconds: null,
        focusedRepairTimeLimitSeconds: 1,
        escalatedRepairTimeLimitSeconds: 1,
        iterationsStarted: 2,
        iterationsCompleted: 2,
        improvingIterations: 0,
        neutralIterations: 2,
        recoverableFailures: 0,
        skippedIterations: 0,
        finalStagnantIterations: 2,
        outcomes: windows.map((window, iteration) => ({
          iteration,
          phase: "focused",
          window,
          stagnantIterationsBefore: iteration,
          staleSecondsBefore: 0,
          repairTimeLimitSeconds: 1,
          wallClockSeconds: 0,
          populationBefore: 70,
          populationAfter: 70,
          improvement: 0,
          status: "neutral"
        }))
      }
    };
  };

  try {
    const result = runLnsNeighborhoodAblation([ablationCase], { variants });
    const summary = result.variantSummaries.find((entry) => entry.variantName === "weak-service-first");

    assert.equal(summary.firstWindowMovementCount, 0);
    assert.equal(summary.firstWindowMovementRate, 0);
    assert.equal(summary.windowSequenceMovementCount, 1);
    assert.equal(summary.windowSequenceMovementRate, 1);
    assert.equal(summary.anchorCoordinateMovementCount, 1);
    assert.equal(summary.anchorCoordinateMovementRate, 1);
    assert.match(formatLnsNeighborhoodAblation(result), /window-sequence-moved=1\/1/);
    assert.match(formatLnsNeighborhoodAblation(result), /anchor-coordinate-moved=1\/1/);
  } finally {
    lnsModule.solveLns = originalSolveLns;
  }
}

function testLnsSeededServiceAnchorPressureBenchmarkCase() {
  const result = runLnsNeighborhoodAblation(undefined, {
    names: ["seeded-service-anchor-pressure"],
    variantNames: ["sliding-only", "weak-service-first"]
  });
  const seededSnapshot = createLnsNeighborhoodAblationSnapshot(
    runLnsNeighborhoodAblation(undefined, {
      names: ["seeded-service-anchor-pressure"],
      variantNames: ["sliding-only", "weak-service-first"],
      seeds: [7]
    })
  );
  const repeatedSeededSnapshot = createLnsNeighborhoodAblationSnapshot(
    runLnsNeighborhoodAblation(undefined, {
      names: ["seeded-service-anchor-pressure"],
      variantNames: ["sliding-only", "weak-service-first"],
      seeds: [7]
    })
  );
  const benchmarkCase = result.cases[0];
  const slidingOnly = benchmarkCase.variants.find((entry) => entry.variantName === "sliding-only");
  const weakServiceFirst = benchmarkCase.variants.find((entry) => entry.variantName === "weak-service-first");

  assert.deepEqual(repeatedSeededSnapshot, seededSnapshot);
  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["seeded-service-anchor-pressure"]);
  assert.equal(benchmarkCase.baseline.totalPopulation, 200);
  assert.equal(slidingOnly.totalPopulation, 100);
  assert.equal(slidingOnly.populationDeltaVsBaseline, -100);
  assert.equal(weakServiceFirst.totalPopulation, 200);
  assert.equal(benchmarkCase.baseline.outcomes[0].window.left, 3);
  assert.equal(slidingOnly.outcomes[0].window.left, 0);
  assert.equal(weakServiceFirst.outcomes[0].status, "improved");
}

function testLnsWindowReplayLabelRunner() {
  const cpSatModule = require("../../dist/packages/solvers/cp-sat/solver.js");
  const originalSolveCpSat = cpSatModule.solveCpSat;
  const observedRepairs = [];
  const replaySeededCase = DEFAULT_LNS_REPLAY_LABEL_CORPUS.find(
    (benchmarkCase) => benchmarkCase.name === "lns-service-overlap-pressure"
  );
  const benchmarkSeededCase = DEFAULT_LNS_BENCHMARK_CORPUS.find(
    (benchmarkCase) => benchmarkCase.name === "lns-service-overlap-pressure"
  );
  const curatedReplaySeedCase = DEFAULT_LNS_REPLAY_LABEL_CORPUS.find(
    (benchmarkCase) => benchmarkCase.name === "seeded-service-anchor-pressure"
  );

  assert(replaySeededCase);
  assert(benchmarkSeededCase);
  assert(curatedReplaySeedCase);
  assert.equal(replaySeededCase.params.lns.seedHint.sourceName, "lns-service-overlap-pressure-weak-replay-seed");
  assert.deepEqual(replaySeededCase.params.lns.seedHint.solution.roads, ["0,0"]);
  assert.equal(replaySeededCase.params.lns.seedHint.solution.totalPopulation, 0);
  assert.equal(benchmarkSeededCase.params.lns?.seedHint, undefined);
  assert.equal(curatedReplaySeedCase.params.lns.seedHint.sourceName, "seeded-service-anchor-pressure");

  cpSatModule.solveCpSat = (_grid, params) => {
    const window = params.cpSat.warmStartHint.neighborhoodWindow;
    observedRepairs.push({
      timeLimitSeconds: params.cpSat.timeLimitSeconds,
      fixOutsideNeighborhoodToHintedValue: params.cpSat.warmStartHint.fixOutsideNeighborhoodToHintedValue,
      window: { ...window },
      incumbentPopulation: params.cpSat.warmStartHint.solution.totalPopulation
    });
    return buildMockSolution({
      optimizer: "cp-sat",
      totalPopulation: window.top === 1 && window.left === 3 ? 200 : 90,
      cpSatStatus: "FEASIBLE",
      cpSatTelemetry: {
        solveWallTimeSeconds: 0.123,
        userTimeSeconds: 0.045,
        solutionCount: 1,
        incumbentObjectiveValue: null,
        bestObjectiveBound: null,
        objectiveGap: null,
        incumbentPopulation: window.top === 1 && window.left === 3 ? 200 : 90,
        bestPopulationUpperBound: null,
        populationGapUpperBound: null,
        lastImprovementAtSeconds: null,
        secondsSinceLastImprovement: null,
        numBranches: 0,
        numConflicts: 0,
        modelSize: {
          variableCount: 10,
          booleanVariableCount: 8,
          constraintCount: 6,
          allowedCellCount: 16,
          roadEligibleCellCount: 16,
          roadVariableCount: 4,
          rootVariableCount: 2,
          directedEdgeCount: 12,
          serviceCandidateCount: 3,
          residentialCandidateCount: 5,
          populationVariableCount: 2
        }
      }
    });
  };

  try {
    const result = runLnsWindowReplayLabels(undefined, {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 2,
      repairTimeLimitSeconds: 0.25
    });
    const repeatedSnapshot = createLnsWindowReplaySnapshot(
      runLnsWindowReplayLabels(undefined, {
        names: ["seeded-service-anchor-pressure"],
        seeds: [7],
        maxWindows: 2,
        repairTimeLimitSeconds: 0.25
      })
    );
    const snapshot = createLnsWindowReplaySnapshot(result);
    const formatted = formatLnsWindowReplayLabels(result);
    const benchmarkCase = result.cases[0];
    const selectedLabel = benchmarkCase.labels.find((label) => label.selectedByBaseline);
    const regressedLabel = benchmarkCase.labels.find((label) => !label.selectedByBaseline);

    assert.equal(result.caseCount, 1);
    assert.equal(result.seedCount, 1);
    assert.equal(result.comparisonCount, 1);
    assert.deepEqual(result.seeds, [7]);
    assert.deepEqual(result.selectedCaseNames, ["seeded-service-anchor-pressure"]);
    assert.deepEqual(result.pressureFamilies, ["anchor-service"]);
    assert.equal(result.maxWindows, 2);
    assert.equal(result.explorationWindowCount, 0);
    assert.equal(result.repairTimeLimitSeconds, 0.25);
    assert.deepEqual(result.statePolicies, ["initial-incumbent"]);
    assert.deepEqual(result.capturedStatePolicies, ["initial-incumbent"]);
    assert.equal(result.stateCollectionIterations, 4);
    assert.equal(result.stateCollectionRepairTimeLimitSeconds, 0.25);
    assert.equal(result.stateCount, 1);
    assert.equal(result.featureSchemaVersion, 2);
    assert.equal(result.cpSatNumWorkers, 1);
    assert.equal(result.cpSatModelFingerprints.length, 1);
    assert.match(result.cpSatModelFingerprints[0], /^fnv1a:[0-9a-f]{8}$/);
    assert.equal(result.labelCount, 2);
    assert.equal(benchmarkCase.incumbentPopulation, 100);
    assert.equal(benchmarkCase.pressureFamily, "anchor-service");
    assert.equal(benchmarkCase.seedHintKind, "curated");
    assert.equal(benchmarkCase.seedHintSourceName, "seeded-service-anchor-pressure");
    assert.equal(benchmarkCase.statePolicy, "initial-incumbent");
    assert.equal(benchmarkCase.stateIndex, 0);
    assert.equal(benchmarkCase.stateSourceIteration, null);
    assert.equal(benchmarkCase.stateSourceStatus, "initial-incumbent");
    assert.equal(benchmarkCase.stateStagnantIterations, 0);
    assert.equal(typeof benchmarkCase.baselineSelectedOperator, "string");
    assert.equal(benchmarkCase.replayedWindowCount, 2);
    assert.equal(benchmarkCase.candidateWindowCount >= 2, true);
    assert.equal(selectedLabel.window.left, 3);
    assert.equal(selectedLabel.improvement, 100);
    assert.equal(selectedLabel.status, "invalid");
    assert.equal(selectedLabel.usable, false);
    assert.equal(regressedLabel.populationDelta, -10);
    assert.equal(regressedLabel.improvement, 0);
    assert.equal(regressedLabel.status, "invalid");
    assert.equal(regressedLabel.usable, false);
    assert.equal(selectedLabel.features.selectedByBaseline, true);
    assert.equal(selectedLabel.statePolicy, "initial-incumbent");
    assert.equal(selectedLabel.stateIndex, 0);
    assert.equal(selectedLabel.stateSourceIteration, null);
    assert.equal(selectedLabel.stateSourceStatus, "initial-incumbent");
    assert.equal(selectedLabel.stateStagnantIterations, 0);
    assert.equal(selectedLabel.features.schemaVersion, 2);
    assert.equal(typeof selectedLabel.operator, "string");
    assert.equal(typeof selectedLabel.operatorScore, "number");
    assert.equal(selectedLabel.pressureFamily, "anchor-service");
    assert.equal(selectedLabel.seedHintKind, "curated");
    assert.equal(selectedLabel.seedHintSourceName, "seeded-service-anchor-pressure");
    assert.equal(selectedLabel.selectionSource, "baseline-top-k");
    assert.equal(selectedLabel.features.area, 9);
    assert.equal(typeof selectedLabel.validation.valid, "boolean");
    assert.equal(selectedLabel.validation.recomputedTotalPopulation >= 0, true);
    assert.equal(selectedLabel.features.serviceCountInside >= 1, true);
    assert.equal(selectedLabel.features.residentialHeadroomInside >= 0, true);
    assert.equal(
      selectedLabel.features.connectivityShadow.reachableEmptyCellsAfterClearingWindow >=
        selectedLabel.features.connectivityShadow.reachableEmptyCellsBefore,
      true
    );
    assert.equal(selectedLabel.features.connectivityShadow.clearedBuildingFootprintCells >= 0, true);
    assert.equal(selectedLabel.features.fragmentation.allowedWindowCellCount >= 0, true);
    assert.equal(selectedLabel.features.candidateLoss.serviceCandidatesIntersectingWindow >= 0, true);
    assert.equal(selectedLabel.features.candidateLoss.residentialCandidatesIntersectingWindow >= 0, true);
    assert.equal(selectedLabel.timing.repairTimeLimitSeconds, 0.25);
    assert.equal(selectedLabel.timing.cpSatNumWorkers, 1);
    assert.equal(selectedLabel.timing.workerCpuBudgetSeconds, 0.25);
    assert.equal(selectedLabel.timing.cpSatSolveWallTimeSeconds, 0.123);
    assert.equal(selectedLabel.timing.observedCpuSeconds, 0.045);
    assert.equal(selectedLabel.cpSat.modelEncodingVersion, "cp-sat-layout-v1");
    assert.equal(selectedLabel.cpSat.candidateKeyVersion, 1);
    assert.equal(selectedLabel.cpSat.modelFingerprint, result.cpSatModelFingerprints[0]);
    assert.equal(selectedLabel.cpSat.modelSize.variableCount, 10);
    assert.deepEqual(
      observedRepairs.slice(0, 2).map((entry) => entry.timeLimitSeconds),
      [0.25, 0.25]
    );
    assert.equal(observedRepairs[0].fixOutsideNeighborhoodToHintedValue, true);
    assert.equal(observedRepairs[0].incumbentPopulation, 100);
    assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
    assert.equal(snapshot.schemaVersion, 1);
    assert.deepEqual(snapshot.pressureFamilies, ["anchor-service"]);
    assert.deepEqual(snapshot.statePolicies, ["initial-incumbent"]);
    assert.deepEqual(snapshot.capturedStatePolicies, ["initial-incumbent"]);
    assert.deepEqual(snapshot.cpSatModelFingerprints, result.cpSatModelFingerprints);
    assert.equal(Object.hasOwn(snapshot.cases[0].labels[0], "wallClockSeconds"), false);
    assert.equal(Object.hasOwn(snapshot.cases[0].labels[0].timing, "wallClockSeconds"), false);
    assert.equal(snapshot.cases[0].labels[0].timing.workerCpuBudgetSeconds, 0.25);
    assert.match(formatted, /seed-hint=curated:seeded-service-anchor-pressure/);
    assert.deepEqual(repeatedSnapshot, snapshot);
    const explorationResult = runLnsWindowReplayLabels(undefined, {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 1,
      explorationWindowCount: 1,
      repairTimeLimitSeconds: 0.25
    });
    assert.equal(explorationResult.explorationWindowCount, 1);
    assert.equal(explorationResult.labelCount, 2);
    const explorationLabel = explorationResult.cases[0].labels.find(
      (label) => label.selectionSource === "exploration-tail"
    );
    assert(explorationLabel);
    assert.equal(explorationLabel.windowIndex >= explorationResult.maxWindows, true);
    observedRepairs.length = 0;
    const stateResult = runLnsWindowReplayLabels(undefined, {
      names: ["seeded-service-anchor-pressure"],
      seeds: [7],
      maxWindows: 1,
      repairTimeLimitSeconds: 0.25,
      statePolicies: ["initial-incumbent", "post-first-improvement", "post-stagnation"],
      stateCollectionIterations: 2,
      stateCollectionRepairTimeLimitSeconds: 0.05
    });
    assert.deepEqual(stateResult.statePolicies, ["initial-incumbent", "post-first-improvement", "post-stagnation"]);
    assert.deepEqual(stateResult.capturedStatePolicies, [
      "initial-incumbent",
      "post-first-improvement",
      "post-stagnation"
    ]);
    assert.equal(stateResult.comparisonCount, 3);
    assert.equal(stateResult.stateCount, 3);
    assert.equal(stateResult.labelCount, 3);
    assert.deepEqual(
      stateResult.cases.map((entry) => entry.statePolicy),
      ["initial-incumbent", "post-first-improvement", "post-stagnation"]
    );
    assert.equal(stateResult.cases[1].stateSourceIteration, 0);
    assert.equal(stateResult.cases[1].stateSourceStatus, "improved");
    assert.equal(stateResult.cases[1].incumbentPopulation, 200);
    assert.equal(stateResult.cases[2].stateSourceIteration, 1);
    assert.equal(stateResult.cases[2].stateSourceStatus, "neutral");
    assert.equal(stateResult.cases[2].stateStagnantIterations, 1);
    assert.equal(stateResult.cases[2].labels[0].statePolicy, "post-stagnation");
    assert.deepEqual(
      observedRepairs.map((entry) => entry.timeLimitSeconds),
      [0.05, 0.05, 0.25, 0.25, 0.25]
    );
    assert.equal(observedRepairs[0].incumbentPopulation, 100);
    assert.equal(observedRepairs[1].incumbentPopulation, 200);
    assert.match(formatted, /=== LNS Window Replay Labels ===/);
    assert.match(formatted, /Pressure families: anchor-service/);
    assert.match(formatted, /State policies: initial-incumbent/);
    assert.match(formatted, /Feature schema: 2/);
    assert.match(formatted, /cpu-budget=0.25s/);
    assert.match(formatted, /newly-reachable:/);
    assert.match(formatted, /operator=/);
    assert.match(formatted, /delta=\+100/);
    assert.match(formatted, /delta=-10/);
    assert.match(formatted, /usable=false/);
    assert.match(formatted, /improvement=\+100/);
  } finally {
    cpSatModule.solveCpSat = originalSolveCpSat;
  }
}

async function maybeTestCpSatBenchmarkSuite() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const result = await runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      maxDeterministicTime: 5,
      numWorkers: 1,
      randomSeed: 13,
      progressIntervalSeconds: 0
    }
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["compact-service-single"]);
  assert.equal(result.results[0].name, "compact-service-single");
  assert.match(result.results[0].cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(result.results[0].cpSatOptions.randomSeed, 13);
  assert(result.results[0].wallClockSeconds >= 0);
  assert.equal(typeof result.results[0].cpSatTelemetry?.solveWallTimeSeconds, "number");
  assert.equal(typeof result.results[0].cpSatTelemetry?.modelSize?.variableCount, "number");
  assert.equal(typeof result.results[0].cpSatTelemetry?.modelSize?.constraintCount, "number");
  assert(result.results[0].progressTimeline.length > 0);
  assert.match(formatCpSatBenchmarkSuite(result), /model-size=vars=/);

  const withoutTimeline = await runCpSatBenchmarkSuite(DEFAULT_CP_SAT_BENCHMARK_CORPUS, {
    names: ["compact-service-single"],
    includeProgressTimeline: false,
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      maxDeterministicTime: 5,
      numWorkers: 1,
      randomSeed: 13
    }
  });

  assert.equal(withoutTimeline.results[0].progressTimeline.length, 0);

  const continuationGrid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const continuationParams = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    greedy: { localSearch: false, restarts: 1 }
  };
  const seed = solveGreedy(continuationGrid, continuationParams);
  const continuationBenchmark = await runCpSatBenchmarkSuite(
    [
      {
        name: "continued-single",
        description: "Continuation benchmark with a Solution warm start.",
        grid: continuationGrid,
        params: {
          ...continuationParams,
          optimizer: "cp-sat",
          cpSat: {
            warmStartHint: seed,
            objectiveLowerBound: seed.totalPopulation
          }
        }
      }
    ],
    {
      cpSat: {
        pythonExecutable,
        timeLimitSeconds: 5,
        maxDeterministicTime: 5,
        numWorkers: 1,
        randomSeed: 19,
        progressIntervalSeconds: 0
      }
    }
  );

  assert.match(continuationBenchmark.results[0].cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert(continuationBenchmark.results[0].cpSatOptions.warmStartHint);
  assert(continuationBenchmark.results[0].cpSatOptions.warmStartHint.roads instanceof Set);
}

async function runOptimizerBenchmarkSuiteAssertions() {
  await testCpSatBenchmarkCorpusHelpers();
  testLnsBenchmarkCorpusHelpers();
  testLnsNeighborhoodAblationRunner();
  testLnsNeighborhoodAblationWindowSequenceMovement();
  testLnsSeededServiceAnchorPressureBenchmarkCase();
  testLnsWindowReplayLabelRunner();
  await maybeTestCpSatBenchmarkSuite();
}

module.exports = {
  runOptimizerBenchmarkSuiteAssertions
};
