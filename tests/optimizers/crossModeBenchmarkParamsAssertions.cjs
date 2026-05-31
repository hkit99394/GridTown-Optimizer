const assert = require("node:assert/strict");

const {
  buildCrossModeBenchmarkParams,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES,
  DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS,
  DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_BENCHMARK_SEEDS,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations
} = require("city-builder/benchmarks");

async function testCrossModeBenchmarkParamsAssertions() {
  const names = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS.map((entry) => entry.name);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS, [5, 30, 120]);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_SEEDS, [7, 19, 37]);
  assert.deepEqual(DEFAULT_CROSS_MODE_BENCHMARK_MODES, ["auto", "greedy", "lns", "cp-sat", "cp-sat-portfolio"]);
  assert.equal(typeof runCrossModeBenchmarkBudgetAblations, "function");
  assert.equal(new Set(names).size, names.length);
  assert(names.includes("row0-corridor-repair-pressure"));
  assert.deepEqual(listCrossModeBenchmarkCaseNames(), names);

  const ablationCoverageCase = DEFAULT_CROSS_MODE_BENCHMARK_CORPUS.find(
    (entry) => entry.name === "row0-corridor-repair-pressure"
  );
  assert.equal(ablationCoverageCase.problemSizeBand, "small");
  assert.equal(ablationCoverageCase.grid.length, 6);
  assert.equal(ablationCoverageCase.params.serviceTypes.length, 2);
  assert.equal(ablationCoverageCase.params.residentialTypes.length, 2);

  const benchmarkCase = {
    name: "mock-scorecard",
    description: "Mock scorecard case for equal-budget mode option checks.",
    problemSizeBand: "tiny",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    params: {
      residentialTypes: [{ w: 1, h: 1, min: 1, max: 1, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 }
    }
  };

  const greedyParams = buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: 3, seeds: [5] });
  assert.equal(greedyParams.optimizer, "greedy");
  assert.equal(greedyParams.greedy.timeLimitSeconds, 3);
  assert.equal(greedyParams.greedy.randomSeed, 5);

  const autoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", { budgetSeconds: 3, seeds: [5] });
  assert.equal(autoParams.optimizer, "auto");
  assert.equal(autoParams.auto.wallClockLimitSeconds, 3);
  assert.equal(autoParams.auto.randomSeed, 5);
  assert.equal(autoParams.lns.wallClockLimitSeconds, 3);
  assert.equal(autoParams.cpSat.timeLimitSeconds, 3);
  assert.equal(autoParams.cpSat.portfolio, undefined);
  assert.deepEqual(
    DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.map((policy) => policy.name),
    ["baseline", "seed-light", "repair-heavy", "cp-sat-reserve-heavy"]
  );
  assert.deepEqual(
    OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.map((policy) => policy.name),
    [
      "baseline-repeat",
      "service-master-shortlist",
      "service-pressure-cp-sat-reserve-5s-guarded",
      "service-present-lns-seed-reserve-5s-guarded",
      "repair-heavy-5s-guarded",
      "lns-seed-short-5s-guarded",
      "lns-repair-time-5s-guarded",
      "cp-sat-reserve-5s-guarded",
      "lns-seed-repair-5s-guarded",
      "lns-seed-reserve-5s-guarded",
      "lns-repair-reserve-5s-guarded",
      "expansion-corridor-lns-repair-5s-guarded",
      "expansion-corridor-lns-seed-repair-5s-guarded"
    ]
  );
  const coverageNames = DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(coverageNames).size, coverageNames.length);
  assert(coverageNames.includes("typed-footprint-pressure"));
  assert(coverageNames.includes("deferred-road-packing-gain"));
  assert(coverageNames.includes("service-local-neighborhood"));
  assert(coverageNames.includes("row0-anchor-repair"));
  assert.deepEqual(listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS), coverageNames);

  const productNames = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.map((entry) => entry.name);
  assert.equal(new Set(productNames).size, productNames.length);
  assert.deepEqual(listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS), productNames);
  assert(productNames.includes("manual-layout-replay-warm-start"));
  assert(productNames.includes("expansion-comparison-replay"));
  assert(productNames.includes("multi-anchor-road-components"));
  assert(productNames.includes("development-expansion-corridor-service"));
  assert(productNames.includes("fresh-expansion-corridor-service"));
  const productTags = new Set(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.flatMap((entry) => entry.workflowTags ?? []));
  for (const tag of [
    "solver-smoke",
    "manual-layout-replay",
    "expansion-comparison",
    "corridor",
    "gate",
    "footprint-pressure",
    "service-pressure",
    "anchor-service",
    "multi-anchor"
  ]) {
    assert(productTags.has(tag), `Expected product workflow corpus to include ${tag}.`);
  }
  assert(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.some((entry) => entry.split === "development"));
  assert(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.some((entry) => entry.split === "holdout"));
  const manualReplayCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "manual-layout-replay-warm-start"
  );
  assert.equal(manualReplayCase.params.lns.seedHint.sourceName, "manual-layout-replay");
  assert.equal(manualReplayCase.params.cpSat.warmStartHint.sourceName, "manual-layout-replay");

  assert.throws(
    () => buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: -1, seeds: [5] }),
    /budget seconds must be a finite number greater than 0/
  );
  assert.throws(
    () => buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: 3, seeds: [5.5] }),
    /Cross-mode benchmark seeds must contain only integer seeds between 0 and 2147483647/
  );
  assert.throws(
    () => buildCrossModeBenchmarkParams(benchmarkCase, "greedy", { budgetSeconds: 3, seeds: [5, 5] }),
    /Cross-mode benchmark seeds must not contain duplicate seeds/
  );
  assert.throws(
    () => buildCrossModeBenchmarkParams(benchmarkCase, "bad-mode", { budgetSeconds: 3, seeds: [5] }),
    /Unknown cross-mode benchmark mode\(s\): bad-mode/
  );
  const helperBudgetListParams = buildCrossModeBenchmarkParams(benchmarkCase, "greedy", {
    budgetsSeconds: [30],
    seeds: [5]
  });
  assert.equal(helperBudgetListParams.greedy.timeLimitSeconds, 30);

  const tunedLnsParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", { budgetSeconds: 30, seeds: [5] });
  assert.equal(tunedLnsParams.lns.wallClockLimitSeconds, 30);
  assert.equal(tunedLnsParams.lns.seedTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.repairTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.focusedRepairTimeLimitSeconds, 2);
  assert.equal(tunedLnsParams.lns.escalatedRepairTimeLimitSeconds, 3);
  assert.equal(tunedLnsParams.lns.iterations, 14);
  assert.equal(tunedLnsParams.lns.maxNoImprovementIterations, 14);

  const expectedAblationLnsPolicies = [
    {
      budgetSeconds: 5,
      seedTimeLimitSeconds: 1,
      repairTimeLimitSeconds: 1,
      focusedRepairTimeLimitSeconds: 1,
      escalatedRepairTimeLimitSeconds: 1,
      iterations: 4,
      maxNoImprovementIterations: 4
    },
    {
      budgetSeconds: 30,
      seedTimeLimitSeconds: 2,
      repairTimeLimitSeconds: 2,
      focusedRepairTimeLimitSeconds: 2,
      escalatedRepairTimeLimitSeconds: 3,
      iterations: 14,
      maxNoImprovementIterations: 14
    },
    {
      budgetSeconds: 120,
      seedTimeLimitSeconds: 5,
      repairTimeLimitSeconds: 5,
      focusedRepairTimeLimitSeconds: 5,
      escalatedRepairTimeLimitSeconds: 10,
      iterations: 23,
      maxNoImprovementIterations: 23
    }
  ];
  for (const corpusCase of DEFAULT_CROSS_MODE_BENCHMARK_CORPUS) {
    const ablationLnsPolicies = DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS.map((budgetSeconds) => {
      const params = buildCrossModeBenchmarkParams(corpusCase, "lns", { budgetSeconds, seeds: [5] });
      return {
        budgetSeconds,
        seedTimeLimitSeconds: params.lns.seedTimeLimitSeconds,
        repairTimeLimitSeconds: params.lns.repairTimeLimitSeconds,
        focusedRepairTimeLimitSeconds: params.lns.focusedRepairTimeLimitSeconds,
        escalatedRepairTimeLimitSeconds: params.lns.escalatedRepairTimeLimitSeconds,
        iterations: params.lns.iterations,
        maxNoImprovementIterations: params.lns.maxNoImprovementIterations
      };
    });
    assert.deepEqual(ablationLnsPolicies, expectedAblationLnsPolicies);
  }

  const explicitLnsParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", {
    budgetSeconds: 30,
    seeds: [5],
    lns: {
      seedTimeLimitSeconds: 5,
      repairTimeLimitSeconds: 7,
      focusedRepairTimeLimitSeconds: 4,
      escalatedRepairTimeLimitSeconds: 6,
      iterations: 3,
      maxNoImprovementIterations: 2
    }
  });
  assert.equal(explicitLnsParams.lns.seedTimeLimitSeconds, 5);
  assert.equal(explicitLnsParams.lns.repairTimeLimitSeconds, 7);
  assert.equal(explicitLnsParams.lns.focusedRepairTimeLimitSeconds, 4);
  assert.equal(explicitLnsParams.lns.escalatedRepairTimeLimitSeconds, 6);
  assert.equal(explicitLnsParams.lns.iterations, 3);
  assert.equal(explicitLnsParams.lns.maxNoImprovementIterations, 2);

  const seedLightPolicy = DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.find((policy) => policy.name === "seed-light");
  const seedLightParams = buildCrossModeBenchmarkParams(benchmarkCase, "lns", {
    budgetSeconds: 20,
    seeds: [5],
    budgetAblationPolicy: seedLightPolicy
  });
  assert.equal(seedLightParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(seedLightParams.lns.repairTimeLimitSeconds, 2);
  assert.equal(seedLightParams.lns.focusedRepairTimeLimitSeconds, 2);
  assert.equal(seedLightParams.lns.escalatedRepairTimeLimitSeconds, 3);

  const reserveHeavyPolicy = DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "cp-sat-reserve-heavy"
  );
  const reserveHeavyParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 20,
    seeds: [5],
    budgetAblationPolicy: reserveHeavyPolicy
  });
  assert.equal(reserveHeavyParams.auto.cpSatStageReserveRatio, 0.35);
  assert.equal(reserveHeavyParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(reserveHeavyParams.lns.repairTimeLimitSeconds, 2);
  const guardedRepairPolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "repair-heavy-5s-guarded"
  );
  const baselineOneSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 1,
    seeds: [5]
  });
  const guardedOneSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 1,
    seeds: [5],
    budgetAblationPolicy: guardedRepairPolicy
  });
  assert.equal(
    guardedOneSecondAutoParams.auto.cpSatStageReserveRatio,
    baselineOneSecondAutoParams.auto.cpSatStageReserveRatio
  );
  assert.equal(
    guardedOneSecondAutoParams.lns.seedTimeLimitSeconds,
    baselineOneSecondAutoParams.lns.seedTimeLimitSeconds
  );
  assert.equal(
    guardedOneSecondAutoParams.lns.repairTimeLimitSeconds,
    baselineOneSecondAutoParams.lns.repairTimeLimitSeconds
  );
  const guardedFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: guardedRepairPolicy
  });
  assert.equal(guardedFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(guardedFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(guardedFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(guardedFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const seedShortFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "lns-seed-short-5s-guarded"
    )
  });
  assert.equal(seedShortFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(seedShortFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(seedShortFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(seedShortFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1);
  const repairTimeFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "lns-repair-time-5s-guarded"
    )
  });
  assert.equal(repairTimeFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(repairTimeFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(repairTimeFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(repairTimeFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const cpSatReserveFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "cp-sat-reserve-5s-guarded"
    )
  });
  assert.equal(cpSatReserveFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(cpSatReserveFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(cpSatReserveFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(cpSatReserveFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1);
  const servicePressureReservePolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "service-pressure-cp-sat-reserve-5s-guarded"
  );
  const servicePressureCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "service-local-neighborhood"
  );
  const typedFootprintCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "typed-footprint-pressure"
  );
  const typedHousingCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "typed-housing-single"
  );
  const row0CorridorCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "row0-corridor-repair-pressure"
  );
  const freshExpansionCorridorCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "fresh-expansion-corridor-service"
  );
  const developmentExpansionCorridorCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "development-expansion-corridor-service"
  );
  const freshMultiAnchorCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "fresh-multi-anchor-service-island"
  );
  const multiAnchorCase = DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.find(
    (entry) => entry.name === "multi-anchor-road-components"
  );
  assert(servicePressureReservePolicy);
  assert(servicePressureCase);
  assert(typedFootprintCase);
  assert(typedHousingCase);
  assert(row0CorridorCase);
  assert(freshExpansionCorridorCase);
  assert(developmentExpansionCorridorCase);
  assert(freshMultiAnchorCase);
  assert(multiAnchorCase);
  const servicePressureFiveSecondAutoParams = buildCrossModeBenchmarkParams(servicePressureCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePressureReservePolicy
  });
  assert.equal(servicePressureFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(servicePressureFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(servicePressureFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  const servicePressureOneSecondAutoParams = buildCrossModeBenchmarkParams(servicePressureCase, "auto", {
    budgetSeconds: 1,
    seeds: [5],
    budgetAblationPolicy: servicePressureReservePolicy
  });
  assert.equal(servicePressureOneSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  const row0ReserveFiveSecondAutoParams = buildCrossModeBenchmarkParams(row0CorridorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePressureReservePolicy
  });
  assert.equal(row0ReserveFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  const multiAnchorReserveFiveSecondAutoParams = buildCrossModeBenchmarkParams(multiAnchorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePressureReservePolicy
  });
  assert.equal(multiAnchorReserveFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  const servicePresentSeedReservePolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "service-present-lns-seed-reserve-5s-guarded"
  );
  assert(servicePresentSeedReservePolicy);
  const servicePresentTypedFiveSecondAutoParams = buildCrossModeBenchmarkParams(typedFootprintCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePresentSeedReservePolicy
  });
  assert.equal(servicePresentTypedFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(servicePresentTypedFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(servicePresentTypedFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  const servicePresentRow0FiveSecondAutoParams = buildCrossModeBenchmarkParams(row0CorridorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePresentSeedReservePolicy
  });
  assert.equal(servicePresentRow0FiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(servicePresentRow0FiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  const servicePresentTypedOneSecondAutoParams = buildCrossModeBenchmarkParams(typedFootprintCase, "auto", {
    budgetSeconds: 1,
    seeds: [5],
    budgetAblationPolicy: servicePresentSeedReservePolicy
  });
  assert.equal(servicePresentTypedOneSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(servicePresentTypedOneSecondAutoParams.lns.seedTimeLimitSeconds, 0.2);
  const servicePresentTypedHousingFiveSecondAutoParams = buildCrossModeBenchmarkParams(typedHousingCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePresentSeedReservePolicy
  });
  assert.equal(servicePresentTypedHousingFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(servicePresentTypedHousingFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  const servicePresentMultiAnchorFiveSecondAutoParams = buildCrossModeBenchmarkParams(multiAnchorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: servicePresentSeedReservePolicy
  });
  assert.equal(servicePresentMultiAnchorFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(servicePresentMultiAnchorFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  const seedRepairFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "lns-seed-repair-5s-guarded"
    )
  });
  assert.equal(seedRepairFiveSecondAutoParams.auto.cpSatStageReserveRatio, undefined);
  assert.equal(seedRepairFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(seedRepairFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(seedRepairFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const seedReserveFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "lns-seed-reserve-5s-guarded"
    )
  });
  assert.equal(seedReserveFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(seedReserveFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(seedReserveFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(seedReserveFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1);
  const repairReserveFiveSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
      (policy) => policy.name === "lns-repair-reserve-5s-guarded"
    )
  });
  assert.equal(repairReserveFiveSecondAutoParams.auto.cpSatStageReserveRatio, 0.1);
  assert.equal(repairReserveFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(repairReserveFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(repairReserveFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const expansionCorridorRepairPolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "expansion-corridor-lns-repair-5s-guarded"
  );
  assert(expansionCorridorRepairPolicy);
  const expansionCorridorFreshFiveSecondAutoParams = buildCrossModeBenchmarkParams(freshExpansionCorridorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: expansionCorridorRepairPolicy
  });
  assert.equal(expansionCorridorFreshFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(expansionCorridorFreshFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const expansionCorridorRow0FiveSecondLnsParams = buildCrossModeBenchmarkParams(row0CorridorCase, "lns", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: expansionCorridorRepairPolicy
  });
  assert.equal(expansionCorridorRow0FiveSecondLnsParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(expansionCorridorRow0FiveSecondLnsParams.lns.escalatedRepairTimeLimitSeconds, 1.5);
  const expansionCorridorFreshOneSecondAutoParams = buildCrossModeBenchmarkParams(freshExpansionCorridorCase, "auto", {
    budgetSeconds: 1,
    seeds: [5],
    budgetAblationPolicy: expansionCorridorRepairPolicy
  });
  const expansionCorridorFreshOneSecondBaselineAutoParams = buildCrossModeBenchmarkParams(
    freshExpansionCorridorCase,
    "auto",
    {
      budgetSeconds: 1,
      seeds: [5]
    }
  );
  assert.equal(
    expansionCorridorFreshOneSecondAutoParams.lns.repairTimeLimitSeconds,
    expansionCorridorFreshOneSecondBaselineAutoParams.lns.repairTimeLimitSeconds
  );
  const expansionCorridorFreshMultiFiveSecondAutoParams = buildCrossModeBenchmarkParams(freshMultiAnchorCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: expansionCorridorRepairPolicy
  });
  assert.equal(expansionCorridorFreshMultiFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  assert.equal(expansionCorridorFreshMultiFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 1);
  const expansionCorridorSeedRepairPolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "expansion-corridor-lns-seed-repair-5s-guarded"
  );
  assert(expansionCorridorSeedRepairPolicy);
  const expansionCorridorDevelopmentFiveSecondAutoParams = buildCrossModeBenchmarkParams(
    developmentExpansionCorridorCase,
    "auto",
    {
      budgetSeconds: 5,
      seeds: [5],
      budgetAblationPolicy: expansionCorridorSeedRepairPolicy
    }
  );
  assert.equal(expansionCorridorDevelopmentFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(expansionCorridorDevelopmentFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1.25);
  assert.equal(expansionCorridorDevelopmentFiveSecondAutoParams.lns.escalatedRepairTimeLimitSeconds, 2);
  const expansionCorridorSeedRepairFreshFiveSecondAutoParams = buildCrossModeBenchmarkParams(
    freshExpansionCorridorCase,
    "auto",
    {
      budgetSeconds: 5,
      seeds: [5],
      budgetAblationPolicy: expansionCorridorSeedRepairPolicy
    }
  );
  assert.equal(expansionCorridorSeedRepairFreshFiveSecondAutoParams.lns.seedTimeLimitSeconds, 0.25);
  assert.equal(expansionCorridorSeedRepairFreshFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1.25);
  const expansionCorridorSeedRepairFreshMultiFiveSecondAutoParams = buildCrossModeBenchmarkParams(
    freshMultiAnchorCase,
    "auto",
    {
      budgetSeconds: 5,
      seeds: [5],
      budgetAblationPolicy: expansionCorridorSeedRepairPolicy
    }
  );
  assert.equal(expansionCorridorSeedRepairFreshMultiFiveSecondAutoParams.lns.seedTimeLimitSeconds, 1);
  assert.equal(expansionCorridorSeedRepairFreshMultiFiveSecondAutoParams.lns.repairTimeLimitSeconds, 1);
  const serviceMasterShortlistPolicy = OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "service-master-shortlist"
  );
  const serviceMasterGreedyParams = buildCrossModeBenchmarkParams(typedFootprintCase, "greedy", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: serviceMasterShortlistPolicy
  });
  assert.equal(serviceMasterGreedyParams.greedy.serviceMasterDecomposition, true);
  const serviceMasterAutoParams = buildCrossModeBenchmarkParams(typedFootprintCase, "auto", {
    budgetSeconds: 5,
    seeds: [5],
    budgetAblationPolicy: serviceMasterShortlistPolicy
  });
  assert.equal(serviceMasterAutoParams.greedy.serviceMasterDecomposition, undefined);
  assert.equal(serviceMasterAutoParams.auto.wallClockLimitSeconds, 5);

  const portfolioParams = buildCrossModeBenchmarkParams(benchmarkCase, "cp-sat-portfolio", {
    budgetSeconds: 3,
    seeds: [5],
    portfolio: { workerCount: 2 }
  });
  assert.equal(portfolioParams.optimizer, "cp-sat");
  assert.equal(portfolioParams.cpSat.timeLimitSeconds, 3);
  assert.equal(portfolioParams.cpSat.maxDeterministicTime, 3);
  assert.equal(portfolioParams.cpSat.portfolio.workerCount, 2);
  assert.deepEqual(portfolioParams.cpSat.portfolio.randomSeeds, [5, 106]);
  assert.equal(portfolioParams.cpSat.portfolio.totalCpuBudgetSeconds, 6);
}

module.exports = { testCrossModeBenchmarkParamsAssertions };
