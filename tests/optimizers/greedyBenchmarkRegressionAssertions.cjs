const {
  assert,
  childProcess,
  path,
  createGreedyBenchmarkSnapshot,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  formatGreedyBenchmarkSuite,
  runGreedyBenchmarkSuite,
  solveGreedy,
  validateSolution,
  validateSolutionMap,
  materializeDeferredRoadNetwork,
  rectangleBorderCells
} = require("./greedyBenchmarkHarnessDeps.cjs");
const fs = require("node:fs");

function testGreedyBenchmarkSuite() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["cap-sweep-mixed"]
  });
  const snapshot = createGreedyBenchmarkSnapshot(result);

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["cap-sweep-mixed"]);
  assert.equal(result.results[0].name, "cap-sweep-mixed");
  assert.equal(result.results[0].greedyOptions.profile, true);
  assert(result.results[0].wallClockSeconds >= 0);
  assert.equal(typeof result.results[0].attainment.populationCapacityUpperBound, "number");
  assert(result.results[0].greedyProfile);
  assert(result.results[0].greedyProfile.counters.precompute.serviceCandidates > 0);
  assert(result.results[0].greedyProfile.counters.attempts.serviceCaps > 0);
  assert(result.results[0].greedyProfile.counters.precompute.residentialPopulationCacheEntries > 0);
  assert(result.results[0].greedyProfile.counters.residentialPhase.populationCacheLookups > 0);
  assert(result.results[0].greedyProfile.counters.localSearch.populationCacheLookups > 0);
  assert(result.results[0].greedyProfile.counters.roads.connectivityShadowChecks > 0);
  assert(result.results[0].greedyProfile.counters.roads.connectivityShadowLostCells > 0);
  assert(result.results[0].greedyProfile.counters.roads.roadOpportunityChecks > 0);
  assert(
    result.results[0].greedyProfile.counters.roads.roadOpportunityLostCells >=
      result.results[0].greedyProfile.counters.roads.roadOpportunityFootprintCells
  );
  assert(result.results[0].greedyProfile.roadOpportunityTraces.length > 0);
  assert.equal(result.results[0].greedyProfile.roadOpportunityTraces[0].reachableBefore >= 0, true);
  assert.equal(
    result.results[0].greedyProfile.roadOpportunityTraces[0].lostCells,
    result.results[0].greedyProfile.roadOpportunityTraces[0].reachableBefore -
      result.results[0].greedyProfile.roadOpportunityTraces[0].reachableAfter
  );
  assert(
    result.results[0].greedyProfile.counters.roads.connectivityShadowLostCells >=
      result.results[0].greedyProfile.counters.roads.connectivityShadowFootprintCells
  );
  assert(result.results[0].greedyProfile.phases.some((phase) => phase.name === "precompute" && phase.runs === 1));
  assert(
    result.results[0].greedyProfile.phases.some(
      (phase) => phase.name === "constructiveCapSearch" && phase.bestPopulationAfter !== null
    )
  );
  assert.equal(Object.hasOwn(snapshot, "generatedAt"), false);
  assert.equal(Object.hasOwn(snapshot.results[0], "wallClockSeconds"), false);
  assert.equal(snapshot.results[0].progressSummary.elapsedTimeSeconds, null);
  assert.equal(Object.hasOwn(snapshot.results[0].greedyProfile.phases[0], "elapsedMs"), false);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-sweep-mixed/);
  assert.match(formatGreedyBenchmarkSuite(result), /attainment=cap=/);
  assert.match(formatGreedyBenchmarkSuite(result), /pop-cache=/);
  assert.match(formatGreedyBenchmarkSuite(result), /local-service=/);
  assert.match(formatGreedyBenchmarkSuite(result), /phases=/);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-search=/);
  assert.match(formatGreedyBenchmarkSuite(result), /connectivity-shadow=/);
  assert.match(formatGreedyBenchmarkSuite(result), /connectivity-shadow-scoring=/);
  assert.match(formatGreedyBenchmarkSuite(result), /road-opportunity=/);
  assert.match(formatGreedyBenchmarkSuite(result), /counterfactuals:/);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
  assert.match(formatGreedyBenchmarkSuite(result), /step14=/);
}

function runGreedyBenchmarkCliJson(args) {
  const cliPath = path.join(__dirname, "../..", "dist", "greedyBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--json", ...args], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Greedy benchmark CLI failed.");
  }
  return JSON.parse(result.stdout);
}

function runLnsBenchmarkCli(args) {
  const cliPath = path.join(__dirname, "../..", "dist", "lnsBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "LNS benchmark CLI failed.");
  }
  return result.stdout;
}

function testGreedyBenchmarkCliConnectivityShadowFlags() {
  const benchmarkName = "deterministic-tie-breaks";
  const defaultRun = runGreedyBenchmarkCliJson(["--no-profile", benchmarkName]);
  const disabledRun = runGreedyBenchmarkCliJson(["--no-connectivity-shadow-scoring", "--no-profile", benchmarkName]);
  const enabledRun = runGreedyBenchmarkCliJson(["--connectivity-shadow-scoring", "--no-profile", benchmarkName]);
  const labelRun = runGreedyBenchmarkCliJson([
    "--connectivity-shadow-labels",
    "--seeds=7",
    "--max-labels=1",
    benchmarkName
  ]);

  assert.deepEqual(defaultRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(disabledRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(enabledRun.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(labelRun.selectedCaseNames, [benchmarkName]);
  assert.equal(defaultRun.results[0].greedyOptions.connectivityShadowScoring, undefined);
  assert.equal(disabledRun.results[0].greedyOptions.connectivityShadowScoring, false);
  assert.equal(enabledRun.results[0].greedyOptions.connectivityShadowScoring, true);
  assert.equal(enabledRun.results[0].greedyOptions.profile, false);
  assert.equal(disabledRun.results[0].totalPopulation, defaultRun.results[0].totalPopulation);
  assert.equal(labelRun.seedCount, 1);
  assert.deepEqual(labelRun.seeds, [7]);
  assert.equal(labelRun.maxLabelsPerCase, 1);
  assert.equal(labelRun.cases[0].greedyOptions.connectivityShadowScoring, true);
  assert.equal(labelRun.cases[0].greedyOptions.profile, true);
  assert.equal(Object.hasOwn(labelRun, "generatedAt"), false);
}

function testGreedyBenchmarkCliDeterministicAblationFlags() {
  const benchmarkName = "step14-service-lookahead-reranker";
  const result = runGreedyBenchmarkCliJson([
    "--deterministic-ablation",
    "--ablation-variants=no-local-search",
    "--seeds=7,19",
    benchmarkName
  ]);

  assert.deepEqual(result.selectedCaseNames, [benchmarkName]);
  assert.deepEqual(result.variants, ["baseline", "no-local-search"]);
  assert.deepEqual(result.seeds, [7, 19]);
  assert.equal(result.caseCount, 1);
  assert.equal(result.seedCount, 2);
  assert.equal(result.comparisonCount, 2);
  assert.equal(result.coverage.runCount, 4);
  assert.deepEqual(
    result.cases.map((entry) => entry.seed),
    [7, 19]
  );
  assert.equal(result.cases[0].baseline.greedyOptions.profile, false);
  assert.equal(result.cases[0].variants[1].greedyOptions.localSearch, false);
  assert.equal(result.cases[1].baseline.greedyOptions.randomSeed, 19);

  const gateReport = runGreedyBenchmarkCliJson([
    "--deterministic-ablation",
    "--gate-report",
    "--ablation-variants=no-local-search",
    benchmarkName
  ]);
  assert.equal(gateReport.reportType, "deterministic-ablation-gate");
  assert.deepEqual(gateReport.suites[0].seeds, [7, 19, 37]);
  assert.equal(gateReport.suites[0].suite, "greedy-deterministic");
  assert.equal(Object.hasOwn(gateReport, "generatedAt"), false);

  const productCorpusResult = runGreedyBenchmarkCliJson([
    "--deterministic-ablation",
    "--product-corpus",
    "--ablation-variants=service-master-decomposition",
    "--seeds=7",
    "typed-housing-single"
  ]);
  assert.deepEqual(productCorpusResult.selectedCaseNames, ["typed-housing-single"]);
  assert.deepEqual(productCorpusResult.variants, ["baseline", "service-master-decomposition"]);
  assert.equal(productCorpusResult.coverage.runCount, 2);
  assert.equal(productCorpusResult.cases[0].variants[1].greedyOptions.serviceMasterDecomposition, true);

  const repoRoot = path.join(__dirname, "../..");
  const artifactDir = `artifacts/tmp-greedy-deterministic-ablation-${process.pid}`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  try {
    const artifactResult = runGreedyBenchmarkCliJson([
      "--deterministic-ablation",
      "--product-corpus",
      `--artifact-dir=${artifactDir}`,
      "--ablation-variants=service-master-decomposition",
      "--seeds=7",
      "typed-housing-single"
    ]);
    assert.equal(artifactResult.artifactDir, artifactDir);
    assert.deepEqual(Object.keys(artifactResult.artifactPaths).sort(), [
      "ablationJson",
      "ablationText",
      "registryEntryDraftJson",
      "telemetryManifestJson"
    ]);
    const ablationArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactResult.artifactPaths.ablationJson), "utf8")
    );
    const telemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactResult.artifactPaths.telemetryManifestJson), "utf8")
    );
    const registryDraft = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactResult.artifactPaths.registryEntryDraftJson), "utf8")
    );
    assert.deepEqual(ablationArtifact.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(telemetryArtifact.source, "greedy-deterministic-ablation");
    assert.equal(telemetryArtifact.suite.productCorpus, true);
    assert.equal(telemetryArtifact.suite.runCount, 2);
    assert.match(telemetryArtifact.command, /--product-corpus/);
    assert.equal(registryDraft.artifactType, "ablation-gate");
    assert.equal(registryDraft.splitStatus.protectedHoldout, true);
    assert.deepEqual(registryDraft.cases.development, ["typed-housing-single"]);
    assert.equal(registryDraft.summaryMetrics.variants[1].variantName, "service-master-decomposition");
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

function testLnsBenchmarkCliNeighborhoodAblationSeedListParsing() {
  const output = runLnsBenchmarkCli(["--list", "--neighborhood-ablation", "--seeds=7,19"]);

  assert.match(output, /compact-service-repair/);
  assert.match(output, /row0-anchor-repair/);

  const gateReport = JSON.parse(
    runLnsBenchmarkCli([
      "--json",
      "--neighborhood-ablation",
      "--gate-report",
      "--seeds=7",
      "--ablation-variants=baseline,sliding-only",
      "seeded-service-anchor-pressure"
    ])
  );
  assert.equal(gateReport.reportType, "deterministic-ablation-gate");
  assert.equal(gateReport.suites[0].suite, "lns-neighborhood");
  assert.deepEqual(gateReport.suites[0].seeds, [7]);
  assert.equal(Object.hasOwn(gateReport, "generatedAt"), false);
}

function testGreedyDeterministicTieBreakBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["deterministic-tie-breaks"]
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["deterministic-tie-breaks"]);
  assert.equal(result.results[0].serviceCount, 0);
  assert.equal(result.results[0].residentialCount, 1);
  assert.equal(result.results[0].totalPopulation, 40);
  assert(result.results[0].greedyProfile);
  assert.match(formatGreedyBenchmarkSuite(result), /deterministic-tie-breaks/);
}

function testGreedyConnectivityHeavyBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["bridge-connectivity-heavy"]
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["bridge-connectivity-heavy"]);
  assert.equal(result.results[0].name, "bridge-connectivity-heavy");
  assert.equal(result.results[0].greedyProfile.counters.roads.canConnectChecks > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeCalls > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeReuses > 0, true);
  assert.equal(result.results[0].totalPopulation > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /bridge-connectivity-heavy/);
  assert.match(formatGreedyBenchmarkSuite(result), /reuse=/);
}

function testGridRectangleBorderCellsPreserveExpectedRing() {
  assert.deepEqual(rectangleBorderCells(2, 3, 2, 3), [
    [1, 3],
    [4, 3],
    [1, 4],
    [4, 4],
    [1, 5],
    [4, 5],
    [2, 2],
    [2, 6],
    [3, 2],
    [3, 6]
  ]);
  assert.deepEqual(rectangleBorderCells(0, 0, 1, 1), [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ]);
}

function testGreedyGeometryOccupancyHotPathBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["geometry-occupancy-hot-path"]
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["geometry-occupancy-hot-path"]);
  assert.equal(result.results[0].name, "geometry-occupancy-hot-path");
  assert.equal(result.results[0].totalPopulation, 1160);
  assert.equal(result.results[0].serviceCount, 5);
  assert.equal(result.results[0].residentialCount, 7);
  assert.equal(result.results[0].greedyProfile.counters.servicePhase.candidateScans > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.residentialPhase.candidateScans > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.geometryCacheEntries > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.probeCalls > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.roads.scratchProbeCalls > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
  assert.match(formatGreedyBenchmarkSuite(result), /geometry-occupancy-hot-path/);
  assert.match(formatGreedyBenchmarkSuite(result), /scratch=/);
}

function inferredPositiveServiceUpper(params) {
  const types = params.serviceTypes ?? [];
  const positiveBonuses = types.reduce((sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0), 0);
  const totalAvail = types.reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  return positiveBonuses > 0 ? Math.min(totalAvail, positiveBonuses) : totalAvail;
}

function testGreedyExplicitServiceCapIsMaximum() {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 2, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 100, max: 150, avail: 4 }],
    availableBuildings: { services: 1 },
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      exhaustiveServiceSearch: false,
      profile: true
    }
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(validation.valid, true);
  assert.equal(solution.totalPopulation, 300);
  assert.equal(solution.services.length, 0);
  assert.equal(solution.residentials.length, 3);
  assert.equal(solution.greedyProfile.counters.attempts.serviceCaps, 2);
}

function testGreedyExplicitCapSweepsAllAllowedLowerCaps() {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 32, range: 1, avail: 5 },
      { rows: 2, cols: 2, bonus: 58, range: 1, avail: 3 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 8 },
      { w: 2, h: 3, min: 95, max: 175, avail: 4 }
    ],
    availableBuildings: { services: 3 },
    greedy: {
      localSearch: false,
      randomSeed: 53,
      restarts: 3,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64,
      profile: true
    }
  };

  const solution = solveGreedy(grid, params);
  const counters = solution.greedyProfile.counters.attempts;

  assert.equal(counters.serviceCaps, 4);
  assert.equal(counters.coarseCaps, 0);
  assert.equal(counters.refineCaps, 0);
  assert.equal(counters.capsSkipped, 0);
}

function testGreedySmallUpperKeepsFullCapSweep() {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "cap-sweep-mixed");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone({
      ...benchmarkCase.params,
      greedy: {
        ...benchmarkCase.params.greedy,
        profile: true
      }
    })
  );
  const counters = solution.greedyProfile.counters.attempts;
  const upper = inferredPositiveServiceUpper(benchmarkCase.params);

  assert.equal(upper <= 6, true);
  assert.equal(counters.serviceCaps, upper + 1);
  assert.equal(counters.coarseCaps, 0);
  assert.equal(counters.refineCaps, 0);
  assert.equal(counters.capsSkipped, 0);
}

function testGreedyAdaptiveCapSearchWideBenchmarkCase() {
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "adaptive-cap-search-wide");
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["adaptive-cap-search-wide"]
  });
  const counters = result.results[0].greedyProfile.counters.attempts;
  const upper = inferredPositiveServiceUpper(benchmarkCase.params);

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["adaptive-cap-search-wide"]);
  assert.equal(result.results[0].name, "adaptive-cap-search-wide");
  assert.equal(upper > 6, true);
  assert.equal(counters.serviceCaps < upper + 1, true);
  assert.equal(counters.coarseCaps > 0, true);
  assert.equal(counters.refineCaps > 0, true);
  assert.equal(counters.refineCaps <= counters.serviceCaps, true);
  assert.equal(counters.capsSkipped > 0, true);
  assert.equal(counters.serviceCaps + counters.capsSkipped, upper + 1);
  assert.equal(counters.restartCaps < counters.serviceCaps, true);
  assert.match(formatGreedyBenchmarkSuite(result), /adaptive-cap-search-wide/);
  assert.match(formatGreedyBenchmarkSuite(result), /cap-search=/);
}

function testGreedyAdaptiveCapSearchMatchesBestExplicitCap() {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 1));
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 28, range: 1, avail: 5 },
      { rows: 2, cols: 2, bonus: 50, range: 1, avail: 2 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 6 },
      { w: 2, h: 3, min: 95, max: 175, avail: 3 }
    ],
    greedy: {
      localSearch: false,
      randomSeed: 59,
      restarts: 2,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64
    }
  };
  const upper = inferredPositiveServiceUpper(params);
  let bestExplicit = null;
  let bestExplicitCap = null;

  for (let cap = 0; cap <= upper; cap++) {
    const candidate = solveGreedy(
      grid.map((row) => [...row]),
      structuredClone({
        ...params,
        availableBuildings: { services: cap }
      })
    );
    if (!bestExplicit || candidate.totalPopulation > bestExplicit.totalPopulation) {
      bestExplicit = candidate;
      bestExplicitCap = cap;
    }
  }

  const adaptive = solveGreedy(
    grid.map((row) => [...row]),
    structuredClone({
      ...params,
      greedy: {
        ...params.greedy,
        profile: true
      }
    })
  );

  assert.equal(upper > 6, true);
  assert.notEqual(bestExplicitCap, 0);
  assert.notEqual(bestExplicitCap, upper);
  assert.equal(adaptive.totalPopulation, bestExplicit.totalPopulation);
  assert.equal(adaptive.greedyProfile.counters.attempts.coarseCaps > 0, true);
  assert.equal(adaptive.greedyProfile.counters.attempts.refineCaps > 0, true);
}

function testGreedyIncrementalInvalidationPreservesBenchmarkOutputs() {
  const expectations = {
    "typed-housing-baseline": { totalPopulation: 110, serviceCount: 0, residentialCount: 2 },
    "compact-service-single": { totalPopulation: 370, serviceCount: 1, residentialCount: 2 },
    "cap-sweep-mixed": { totalPopulation: 580, serviceCount: 3, residentialCount: 4 },
    "bridge-connectivity-heavy": { totalPopulation: 400, serviceCount: 1, residentialCount: 3 },
    "geometry-occupancy-hot-path": { totalPopulation: 1160, serviceCount: 5, residentialCount: 7 },
    "typed-footprint-pressure": { totalPopulation: 505, serviceCount: 2, residentialCount: 4 },
    "adaptive-cap-search-wide": { totalPopulation: 1028, serviceCount: 1, residentialCount: 9 },
    "crowded-invalidation-heavy": { totalPopulation: 791, serviceCount: 4, residentialCount: 5 },
    "service-local-neighborhood": { totalPopulation: 395, serviceCount: 2, residentialCount: 3 },
    "step14-deterministic-lookahead-ties": { totalPopulation: 200, serviceCount: 1, residentialCount: 2 },
    "step14-row0-path-null-reservation": { totalPopulation: 230, serviceCount: 1, residentialCount: 2 },
    "step14-scarce-type-sequential-refill": { totalPopulation: 275, serviceCount: 1, residentialCount: 3 }
  };

  for (const [name, expected] of Object.entries(expectations)) {
    const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, { names: [name] });
    const benchmark = result.results[0];

    assert.equal(benchmark.name, name);
    assert.equal(benchmark.totalPopulation, expected.totalPopulation);
    assert.equal(benchmark.serviceCount, expected.serviceCount);
    assert.equal(benchmark.residentialCount, expected.residentialCount);
  }
}

function testGreedyIncrementalInvalidationCounters() {
  const crowdedBenchmarkResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["crowded-invalidation-heavy"]
  });
  assert.equal(crowdedBenchmarkResult.caseCount, 1);
  assert.deepEqual(crowdedBenchmarkResult.selectedCaseNames, ["crowded-invalidation-heavy"]);
  assert.equal(crowdedBenchmarkResult.results[0].name, "crowded-invalidation-heavy");
  assert.match(formatGreedyBenchmarkSuite(crowdedBenchmarkResult), /crowded-invalidation-heavy/);
  assert.match(formatGreedyBenchmarkSuite(crowdedBenchmarkResult), /invalidation=/);

  const crowdedBenchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find(
    (entry) => entry.name === "crowded-invalidation-heavy"
  );
  const focusedCrowdedParams = structuredClone(crowdedBenchmarkCase.params);
  focusedCrowdedParams.maxServices = 1;
  focusedCrowdedParams.greedy = {
    ...focusedCrowdedParams.greedy,
    localSearch: false,
    restarts: 1,
    serviceRefineIterations: 0,
    profile: true
  };
  const focusedCrowdedSolution = solveGreedy(
    crowdedBenchmarkCase.grid.map((row) => [...row]),
    focusedCrowdedParams
  );
  const focusedCrowdedCounters = focusedCrowdedSolution.greedyProfile.counters;

  assert.equal(focusedCrowdedSolution.totalPopulation, 781);
  assert.equal(focusedCrowdedSolution.services.length, 1);
  assert.equal(focusedCrowdedSolution.residentials.length, 7);
  assert.equal(focusedCrowdedCounters.attempts.serviceCaps, 2);
  assert.equal(focusedCrowdedCounters.attempts.restarts, 0);
  assert.equal(focusedCrowdedCounters.attempts.localSearchIterations, 0);
  assert.equal(focusedCrowdedCounters.servicePhase.fixedPlacements, 0);
  assert.equal(focusedCrowdedCounters.servicePhase.candidateInvalidations > 0, true);
  assert.equal(focusedCrowdedCounters.servicePhase.scoreDirtyMarks > 0, true);
  assert.equal(focusedCrowdedCounters.servicePhase.scoreRecomputes > 0, true);
  assert.equal(focusedCrowdedCounters.residentialPhase.candidateInvalidations > 0, true);
  assert.equal(
    focusedCrowdedCounters.servicePhase.candidateScans <
      focusedCrowdedCounters.precompute.serviceCandidates * Math.max(1, focusedCrowdedCounters.servicePhase.placements),
    true
  );
  assert.equal(focusedCrowdedCounters.servicePhase.candidateScans < 1000, true);
  assert.equal(
    focusedCrowdedCounters.residentialPhase.candidateScans <
      focusedCrowdedCounters.precompute.residentialCandidates *
        Math.max(1, focusedCrowdedCounters.residentialPhase.placements),
    true
  );

  const typedResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-availability-pressure"]
  });
  const typedCounters = typedResult.results[0].greedyProfile.counters;

  assert.equal(typedCounters.servicePhase.typeInvalidations > 0, true);
  assert.equal(typedCounters.residentialPhase.typeInvalidations > 0, true);

  const fixedServiceResult = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"]
  });
  const fixedServiceCounters = fixedServiceResult.results[0].greedyProfile.counters;

  assert.equal(fixedServiceCounters.attempts.serviceRefineTrials > 0, true);
  assert.equal(fixedServiceCounters.servicePhase.fixedPlacements > 0, true);
}

function testGreedyDeferredRoadCommitmentBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["deferred-road-packing-gain"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "deferred-road-packing-gain");
  const deferredParams = structuredClone(benchmarkCase.params);
  deferredParams.greedy = { ...deferredParams.greedy, profile: true };
  const deferredSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    deferredParams
  );
  const explicitParams = structuredClone(benchmarkCase.params);
  explicitParams.greedy = { ...explicitParams.greedy, deferRoadCommitment: false, profile: true };
  const explicitSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    explicitParams
  );
  const counters = deferredSolution.greedyProfile.counters;
  const validation = validateSolutionMap({
    grid: benchmarkCase.grid,
    solution: deferredSolution,
    params: deferredParams
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["deferred-road-packing-gain"]);
  assert.equal(result.results[0].name, "deferred-road-packing-gain");
  assert.equal(result.results[0].totalPopulation, 260);
  assert.equal(result.results[0].roadCount, 1);
  assert.equal(result.results[0].serviceCount, 1);
  assert.equal(result.results[0].residentialCount, 2);
  assert.equal(deferredSolution.totalPopulation, 260);
  assert.equal(deferredSolution.roads.size, 1);
  assert.equal(explicitSolution.totalPopulation, 260);
  assert.equal(explicitSolution.roads.size, 1);
  assert.equal(deferredSolution.totalPopulation >= explicitSolution.totalPopulation, true);
  assert.equal(validation.valid, true);
  assert.equal(counters.roads.deferredFrontierRecomputes > 0, true);
  assert.equal(counters.roads.deferredReconstructionSteps > 0, true);
  assert.equal(counters.roads.deferredReconstructionFailures >= 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /deferred-road-packing-gain/);
  assert.match(formatGreedyBenchmarkSuite(result), /deferred-roads=/);
}

function testGreedyDeferredRoadCommitmentKeepsTopRowShortcut() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  const params = {
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
    availableBuildings: { residentials: 1, services: 0 },
    greedy: { localSearch: false, restarts: 1, exhaustiveServiceSearch: false, deferRoadCommitment: true }
  };

  const solution = solveGreedy(grid, params);
  const validation = validateSolution({ grid, solution, params });

  assert.equal(solution.residentials[0].r, 0);
  assert.equal(solution.roads.size > 0, true);
  assert.equal(validation.valid, true);
}

function testGreedyDeferredRoadMaterializationFailsDeterministically() {
  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const occupiedBuildings = new Set(["0,0", "0,1", "0,2", "0,3", "1,0", "2,0", "3,0"]);
  const roads = materializeDeferredRoadNetwork(grid, undefined, occupiedBuildings, [{ r: 2, c: 1, rows: 1, cols: 1 }]);

  assert.equal(roads, null);
}

function testGreedyFixedServiceRealizationCompletenessBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["fixed-service-realization-complete"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find(
    (entry) => entry.name === "fixed-service-realization-complete"
  );
  const improvedParams = structuredClone(benchmarkCase.params);
  improvedParams.greedy = { ...improvedParams.greedy, profile: true };
  const improvedSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    improvedParams
  );
  const baselineParams = structuredClone(benchmarkCase.params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    profile: true,
    serviceRefineIterations: 0,
    exhaustiveServiceSearch: false
  };
  const baselineSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    baselineParams
  );
  const exhaustiveOnlyParams = structuredClone(benchmarkCase.params);
  exhaustiveOnlyParams.greedy = {
    ...exhaustiveOnlyParams.greedy,
    profile: true,
    serviceRefineIterations: 0
  };
  const exhaustiveOnlySolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    exhaustiveOnlyParams
  );
  const counters = improvedSolution.greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["fixed-service-realization-complete"]);
  assert.equal(result.results[0].name, "fixed-service-realization-complete");
  assert.equal(result.results[0].totalPopulation, 400);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(result.results[0].residentialCount, 3);
  assert.equal(improvedSolution.totalPopulation, 400);
  assert.equal(baselineSolution.totalPopulation, 395);
  assert.equal(exhaustiveOnlySolution.totalPopulation, 395);
  assert.equal(improvedSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.equal(exhaustiveOnlySolution.totalPopulation >= baselineSolution.totalPopulation, true);
  assert.deepEqual(exhaustiveOnlySolution.services, [
    { r: 2, c: 2, rows: 1, cols: 2, range: 1 },
    { r: 0, c: 3, rows: 1, cols: 1, range: 1 }
  ]);
  assert.deepEqual(exhaustiveOnlySolution.populations, [170, 120, 105]);
  assert.equal(exhaustiveOnlySolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(exhaustiveOnlySolution.greedyProfile.counters.attempts.exhaustiveTrials > 0, true);
  assert.equal(counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(counters.attempts.serviceRefineTrials > 0, true);
  assert.equal(counters.attempts.exhaustiveTrials > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /fixed-service-realization-complete/);
  assert.match(formatGreedyBenchmarkSuite(result), /fixed-set:/);
}

function testGreedyFixedServiceRealizationCompletenessImprovesMultiServiceRefineCase() {
  const grid = [
    [0, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [0, 0, 1, 0, 1, 1],
    [1, 1, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 48, range: 2, avail: 1 },
      { rows: 1, cols: 2, bonus: 67, range: 2, avail: 2 },
      { rows: 1, cols: 2, bonus: 47, range: 1, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 53, max: 157, avail: 5 },
      { w: 2, h: 3, min: 81, max: 171, avail: 2 }
    ],
    greedy: {
      localSearch: false,
      randomSeed: 498,
      restarts: 1,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 6,
      serviceExactMaxCombinations: 64,
      profile: true
    }
  };

  const baselineParams = structuredClone(params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    serviceRefineIterations: 0
  };
  const baselineSolution = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const improvedSolution = solveGreedy(
    grid.map((row) => [...row]),
    params
  );
  const baselineValidation = validateSolution({ grid, solution: baselineSolution, params: baselineParams });
  const improvedValidation = validateSolution({ grid, solution: improvedSolution, params });

  assert.equal(baselineValidation.valid, true);
  assert.equal(improvedValidation.valid, true);
  assert.equal(baselineSolution.totalPopulation, 416);
  assert.equal(improvedSolution.totalPopulation, 469);
  assert.equal(improvedSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.deepEqual(baselineSolution.serviceTypeIndices, [1]);
  assert.deepEqual(improvedSolution.serviceTypeIndices, [1]);
  assert.deepEqual(improvedSolution.services, [{ r: 0, c: 2, rows: 2, cols: 1, range: 2 }]);
  assert.deepEqual(improvedSolution.populations, [148, 148, 120, 53]);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials > 0, true);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.serviceRefineTrials > 0, true);
}

function testGreedyServiceMasterDecompositionBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["service-master-decomposition-experiment"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find(
    (entry) => entry.name === "service-master-decomposition-experiment"
  );
  const baselineParams = structuredClone(benchmarkCase.params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    serviceMasterDecomposition: false,
    profile: true
  };
  const masterParams = structuredClone(benchmarkCase.params);
  masterParams.greedy = {
    ...masterParams.greedy,
    profile: true
  };
  const baselineSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    baselineParams
  );
  const masterSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    masterParams
  );
  const validation = validateSolution({
    grid: benchmarkCase.grid,
    solution: masterSolution,
    params: masterParams
  });
  const counters = masterSolution.greedyProfile.counters.attempts;
  const phase = masterSolution.greedyProfile.phases.find((entry) => entry.name === "serviceMasterDecomposition");

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["service-master-decomposition-experiment"]);
  assert.equal(result.results[0].name, "service-master-decomposition-experiment");
  assert.equal(result.results[0].totalPopulation, 555);
  assert.equal(result.results[0].serviceCount, 1);
  assert.equal(result.results[0].residentialCount, 4);
  assert.equal(validation.valid, true);
  assert.equal(baselineSolution.totalPopulation, 465);
  assert.equal(masterSolution.totalPopulation, 555);
  assert.equal(masterSolution.totalPopulation > baselineSolution.totalPopulation, true);
  assert.deepEqual(masterSolution.services, [{ r: 0, c: 3, rows: 2, cols: 1, range: 1 }]);
  assert.equal(counters.serviceMasterCandidatesConsidered >= counters.serviceMasterCandidatesShortlisted, true);
  assert.equal(counters.serviceMasterCandidatesShortlisted > 0, true);
  assert.equal(counters.serviceMasterLayouts > 0, true);
  assert.equal(counters.serviceMasterFeasibleLayouts > 0, true);
  assert.equal(counters.serviceMasterImprovingLayouts > 0, true);
  assert.equal(counters.serviceMasterNoGoodSkips > 0, true);
  assert.equal(counters.fixedServiceRealizationTrials > 0, true);
  assert.equal(phase.runs, 1);
  assert.equal(phase.improvements, 1);
  assert.match(formatGreedyBenchmarkSuite(result), /service-master-decomposition-experiment/);
  assert.match(formatGreedyBenchmarkSuite(result), /service-master=candidates:\d+\/\d+/);
}

function testGreedyServiceLocalNeighborhoodBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["service-local-neighborhood"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "service-local-neighborhood");
  const improvedParams = structuredClone(benchmarkCase.params);
  improvedParams.greedy = { ...improvedParams.greedy, profile: true };
  const improvedSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    improvedParams
  );
  const baselineParams = structuredClone(benchmarkCase.params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    profile: true,
    localSearch: true,
    localSearchServiceMoves: false
  };
  const baselineSolution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    baselineParams
  );
  const counters = improvedSolution.greedyProfile.counters.localSearch;
  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["service-local-neighborhood"]);
  assert.equal(result.results[0].name, "service-local-neighborhood");
  assert.equal(result.results[0].totalPopulation, 395);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(result.results[0].residentialCount, 3);
  assert.equal(improvedSolution.totalPopulation, 395);
  assert.equal(baselineSolution.totalPopulation, 395);
  assert.equal(improvedSolution.totalPopulation >= baselineSolution.totalPopulation, true);
  assert.equal(improvedSolution.greedyProfile.counters.attempts.fixedServiceRealizationTrials, 0);
  assert.equal(improvedSolution.greedyProfile.counters.localSearch.occupancyScratchReuses > 0, true);
  assert.equal(improvedSolution.greedyProfile.counters.roads.scratchProbeCalls > 0, true);
  assert.equal(counters.serviceRemoveChecks > 0, true);
  assert.equal(counters.serviceAddChecks > 0, true);
  assert.equal(counters.serviceSwapChecks > 0, true);
  assert.equal(counters.serviceNeighborhoodImprovements >= 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /service-local-neighborhood/);
  assert.match(formatGreedyBenchmarkSuite(result), /local-service=/);
  assert.match(formatGreedyBenchmarkSuite(result), /step13=/);
}

function testGreedyResidualServiceBundleRepairAddsServiceAndRefillsResidentials() {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 20, range: 1, avail: 2 }],
    residentialTypes: [{ w: 2, h: 2, min: 80, max: 120, avail: 3 }],
    availableBuildings: { services: 2, residentials: 3 },
    greedy: {
      localSearch: true,
      localSearchServiceMoves: true,
      randomSeed: 1,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 4,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 4,
      serviceExactMaxCombinations: 16,
      profile: true
    }
  };
  const baselineParams = structuredClone(params);
  baselineParams.greedy = {
    ...baselineParams.greedy,
    localSearchServiceMoves: false
  };

  const baseline = solveGreedy(
    grid.map((row) => [...row]),
    baselineParams
  );
  const repaired = solveGreedy(
    grid.map((row) => [...row]),
    params
  );
  const validation = validateSolution({ grid, solution: repaired, params });
  const overlaps = (a, b) => a.r < b.r + b.rows && a.r + a.rows > b.r && a.c < b.c + b.cols && a.c + a.cols > b.c;

  assert.equal(validation.valid, true);
  assert.equal(baseline.totalPopulation, 320);
  assert.equal(baseline.services.length, 2);
  assert.equal(repaired.totalPopulation, 320);
  assert.equal(repaired.totalPopulation >= baseline.totalPopulation, true);
  assert.deepEqual(repaired.services, [
    { r: 1, c: 0, rows: 1, cols: 1, range: 1 },
    { r: 2, c: 0, rows: 1, cols: 1, range: 1 }
  ]);
  assert.deepEqual(repaired.serviceTypeIndices, [0, 0]);
  assert.deepEqual(repaired.populations, [120, 120, 80]);
  assert.equal(
    baseline.residentials.some((residential) => overlaps(repaired.services[0], residential)),
    false
  );
  assert.equal(repaired.greedyProfile.counters.localSearch.serviceSwapChecks > 0, true);
  assert.equal(repaired.greedyProfile.counters.localSearch.serviceNeighborhoodImprovements >= 0, true);
}

function testGreedyTypedFootprintPressureBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-footprint-pressure"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "typed-footprint-pressure");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone(benchmarkCase.params)
  );

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["typed-footprint-pressure"]);
  assert.equal(result.results[0].name, "typed-footprint-pressure");
  assert.equal(result.results[0].totalPopulation, 505);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(solution.totalPopulation, 505);
  assert.deepEqual(solution.serviceTypeIndices, [1, 0]);
  assert.deepEqual(solution.services, [
    { r: 3, c: 2, rows: 1, cols: 1, range: 2 },
    { r: 2, c: 3, rows: 1, cols: 1, range: 1 }
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [2, 2, 0, 1]);
  assert.deepEqual(solution.populations, [150, 150, 130, 75]);
  assert(result.results[0].greedyProfile);
  assert.equal(result.results[0].greedyProfile.counters.precompute.residentialScoringGroups > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.residentialScoringVariantsCollapsed > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.precompute.serviceCoverageGroups > 0, true);
  assert.equal(result.results[0].greedyProfile.counters.servicePhase.groupedScoreLookups > 0, true);
  assert.match(formatGreedyBenchmarkSuite(result), /typed-footprint-pressure/);
  assert.match(formatGreedyBenchmarkSuite(result), /grouped-score=/);
}

function testGreedyTypedAvailabilityPressureBenchmarkCase() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["typed-availability-pressure"]
  });
  const benchmarkCase = DEFAULT_GREEDY_BENCHMARK_CORPUS.find((entry) => entry.name === "typed-availability-pressure");
  const solution = solveGreedy(
    benchmarkCase.grid.map((row) => [...row]),
    structuredClone(benchmarkCase.params)
  );
  const counters = result.results[0].greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["typed-availability-pressure"]);
  assert.equal(result.results[0].name, "typed-availability-pressure");
  assert.equal(result.results[0].totalPopulation, 615);
  assert.equal(result.results[0].serviceCount, 2);
  assert.equal(solution.totalPopulation, 615);
  assert.deepEqual(solution.serviceTypeIndices, [0, 0]);
  assert.equal(solution.services.length, 2);
  assert.deepEqual(solution.services, [
    { r: 3, c: 3, rows: 1, cols: 1, range: 2 },
    { r: 2, c: 2, rows: 1, cols: 1, range: 2 }
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [0, 1, 1, 1, 1]);
  assert.deepEqual(solution.populations, [175, 110, 110, 110, 110]);
  assert(result.results[0].greedyProfile);
  assert.equal(counters.servicePhase.availabilityDiscountedGroups > 0, true);
  assert.equal(
    counters.precompute.serviceStaticAvailabilityDiscountedGroups + counters.servicePhase.availabilityDiscountedGroups >
      0,
    true
  );
  assert.match(formatGreedyBenchmarkSuite(result), /typed-availability-pressure/);
  assert.match(formatGreedyBenchmarkSuite(result), /discounted:/);
}

function testGreedyGroupedServiceScoringLeavesUntypedBenchmarkUndiscounted() {
  const result = runGreedyBenchmarkSuite(DEFAULT_GREEDY_BENCHMARK_CORPUS, {
    names: ["compact-service-single"]
  });
  const counters = result.results[0].greedyProfile.counters;

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["compact-service-single"]);
  assert.equal(counters.precompute.residentialScoringVariantsCollapsed, 0);
  assert.equal(counters.precompute.serviceStaticAvailabilityDiscountedGroups, 0);
  assert.equal(counters.servicePhase.availabilityDiscountedGroups, 0);
}

function testGreedyGroupedServiceScoringDiscountsLimitedFallbackTypes() {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1]
  ];
  const params = {
    optimizer: "greedy",
    serviceTypes: [{ rows: 1, cols: 1, bonus: 65, range: 2, avail: 2 }],
    residentialTypes: [
      { w: 2, h: 2, min: 45, max: 180, avail: 1 },
      { w: 2, h: 2, min: 45, max: 90, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 5 },
    greedy: {
      localSearch: true,
      randomSeed: 41,
      restarts: 2,
      serviceRefineIterations: 1,
      serviceRefineCandidateLimit: 8,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 8,
      serviceExactMaxCombinations: 64,
      profile: true
    }
  };

  const solution = solveGreedy(grid, params);

  assert.equal(solution.totalPopulation, 265);
  assert.deepEqual(solution.serviceTypeIndices, [0, 0]);
  assert.deepEqual(solution.services, [
    { r: 2, c: 2, rows: 1, cols: 1, range: 2 },
    { r: 1, c: 0, rows: 1, cols: 1, range: 2 }
  ]);
  assert.deepEqual(solution.residentialTypeIndices, [0, 1]);
  assert.deepEqual(solution.populations, [175, 90]);
  assert(solution.greedyProfile);
  assert.equal(solution.greedyProfile.counters.servicePhase.availabilityDiscountedGroups > 0, true);
}

function runGreedyBenchmarkRegressionAssertions() {
  testGreedyBenchmarkSuite();
  testGreedyBenchmarkCliConnectivityShadowFlags();
  testGreedyBenchmarkCliDeterministicAblationFlags();
  testLnsBenchmarkCliNeighborhoodAblationSeedListParsing();
  testGreedyDeterministicTieBreakBenchmarkCase();
  testGreedyConnectivityHeavyBenchmarkCase();
  testGreedyGeometryOccupancyHotPathBenchmarkCase();
  testGreedyAdaptiveCapSearchWideBenchmarkCase();
  testGreedyIncrementalInvalidationPreservesBenchmarkOutputs();
  testGreedyDeferredRoadCommitmentBenchmarkCase();
  testGreedyFixedServiceRealizationCompletenessBenchmarkCase();
  testGreedyServiceMasterDecompositionBenchmarkCase();
  testGreedyServiceLocalNeighborhoodBenchmarkCase();
  testGreedyTypedFootprintPressureBenchmarkCase();
  testGreedyTypedAvailabilityPressureBenchmarkCase();
  testGreedyGroupedServiceScoringLeavesUntypedBenchmarkUndiscounted();
}

function runGreedyBenchmarkOptimizerAssertions() {
  testGridRectangleBorderCellsPreserveExpectedRing();
  testGreedyExplicitServiceCapIsMaximum();
  testGreedyExplicitCapSweepsAllAllowedLowerCaps();
  testGreedySmallUpperKeepsFullCapSweep();
  testGreedyAdaptiveCapSearchMatchesBestExplicitCap();
  testGreedyIncrementalInvalidationCounters();
  testGreedyDeferredRoadCommitmentKeepsTopRowShortcut();
  testGreedyDeferredRoadMaterializationFailsDeterministically();
  testGreedyFixedServiceRealizationCompletenessImprovesMultiServiceRefineCase();
  testGreedyServiceMasterDecompositionBenchmarkCase();
  testGreedyResidualServiceBundleRepairAddsServiceAndRefillsResidentials();
  testGreedyGroupedServiceScoringDiscountsLimitedFallbackTypes();
}

module.exports = {
  runGreedyBenchmarkOptimizerAssertions,
  runGreedyBenchmarkRegressionAssertions
};
