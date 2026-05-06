const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCrossModeBenchmarkParams,
  buildCrossModeBenchmarkTelemetryManifest,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES,
  DEFAULT_CROSS_MODE_BENCHMARK_BUDGETS_SECONDS,
  DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_BENCHMARK_SEEDS,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite
} = require("city-builder/benchmarks");
const {
  buildDecisionTraceFromSolution,
  buildTimeToQualityScorecard,
  parseDecisionTraceJsonl,
  serializeDecisionTraceJsonl
} = require("city-builder/solver");
const { delay } = require("../helpers/processHelpers.cjs");
const { buildMockSolution } = require("../helpers/solverFixtures.cjs");

async function testCrossModeBenchmarkHelpers() {
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
    ["baseline-repeat", "repair-heavy-5s-guarded"]
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

  const result = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["greedy"],
    budgetsSeconds: [3],
    seeds: [5],
    greedy: {
      localSearch: false,
      restarts: 1,
      serviceRefineIterations: 0,
      serviceRefineCandidateLimit: 1,
      exhaustiveServiceSearch: false,
      serviceExactPoolLimit: 1,
      serviceExactMaxCombinations: 1
    }
  });

  assert.equal(result.caseCount, 1);
  assert.deepEqual(result.selectedCaseNames, ["mock-scorecard"]);
  assert.deepEqual(result.budgetsSeconds, [3]);
  assert.deepEqual(result.seeds, [5]);
  assert.deepEqual(result.modes, ["greedy"]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].split, "development");
  assert.deepEqual(result.cases[0].workflowTags, []);
  assert.equal(result.cases[0].results.length, 1);
  assert.equal(result.cases[0].results[0].mode, "greedy");
  assert.equal(result.cases[0].results[0].winVsAuto, "no-auto");
  assert.equal(result.cases[0].results[0].scoreDeltaVsAuto, null);
  assert.equal(result.cases[0].results[0].progressSummary.activeStage, "greedy");
  assert.equal(typeof result.cases[0].results[0].budgetAllocationSignal.budgetUtilizationRatio, "number");
  assert.equal(result.cases[0].results[0].budgetAllocationSignal.scoreDeltaVsAuto, null);
  assert.equal(result.cases[0].results[0].telemetry.schemaVersion, 1);
  assert.equal(result.cases[0].results[0].telemetry.caseName, "mock-scorecard");
  assert.equal(result.cases[0].results[0].telemetry.mode, "greedy");
  assert.equal(result.cases[0].results[0].telemetry.budgetSeconds, 3);
  assert.equal(result.cases[0].results[0].telemetry.seed, 5);
  assert.equal(result.cases[0].results[0].telemetry.solverParams.greedy.timeLimitSeconds, 3);
  assert.equal(typeof result.cases[0].results[0].telemetry.timing.wallClockSeconds, "number");
  assert.equal(result.cases[0].results[0].telemetry.cpu.workerCpuBudgetSeconds, 3);
  assert.equal(result.modeSummaries[0].mode, "greedy");
  assert.equal(result.problemSizeSummaries[0].problemSizeBand, "tiny");
  assert.equal(result.budgetPolicySignals.length, 1);
  assert.equal(result.budgetPolicySignals[0].caseName, "mock-scorecard");
  assert.equal(result.budgetPolicySignals[0].recommendation, "add-auto-baseline");

  const productWorkflowResult = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    names: ["manual-layout-replay-warm-start"],
    modes: ["greedy"],
    budgetsSeconds: [1],
    seeds: [7],
    solve: (_grid, params, context) =>
      buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: context.benchmarkCase.params.cpSat.warmStartHint.solution.totalPopulation,
        roads: context.benchmarkCase.params.cpSat.warmStartHint.solution.roads,
        residentials: context.benchmarkCase.params.cpSat.warmStartHint.solution.residentials,
        services: context.benchmarkCase.params.cpSat.warmStartHint.solution.services
      })
  });
  assert.equal(productWorkflowResult.caseCount, 1);
  assert.equal(productWorkflowResult.selectedCaseNames[0], "manual-layout-replay-warm-start");
  assert.equal(productWorkflowResult.cases[0].split, "development");
  assert.deepEqual(productWorkflowResult.cases[0].workflowTags, ["manual-layout-replay"]);
  assert.equal(productWorkflowResult.cases[0].bestScore, 160);

  const mocked = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["auto", "greedy", "lns", "cp-sat-portfolio"],
    budgetsSeconds: [3],
    seeds: [5, 11],
    portfolio: { workerCount: 2 },
    solve: async (_grid, params, context) => {
      const seedBonus = context.seed === 11 ? 1 : 0;
      const modeScores = {
        auto: 10 + seedBonus,
        greedy: 12 + seedBonus,
        lns: 8 + seedBonus,
        "cp-sat-portfolio": 10 + seedBonus
      };
      const solution = buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: modeScores[context.mode],
        cpSatStatus: params.optimizer === "cp-sat" ? "FEASIBLE" : undefined,
        roads:
          context.mode === "greedy"
            ? ["0,1"]
            : context.mode === "lns"
              ? ["1,1"]
              : context.mode === "cp-sat-portfolio"
                ? ["0,0", "2,2"]
                : ["0,0"],
        residentials: [{ r: 1, c: 1, rows: 1, cols: 1 }]
      });
      if (context.mode === "auto") {
        solution.activeOptimizer = "lns";
        solution.autoStage = {
          requestedOptimizer: "auto",
          activeStage: "lns",
          stageIndex: 2,
          cycleIndex: 1,
          consecutiveWeakCycles: 0,
          lastCycleImprovementRatio: null,
          stopReason: "wall-clock-cap",
          generatedSeeds: [{ stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: context.seed }],
          stageRuns: [
            {
              stage: "greedy",
              stageIndex: 1,
              cycleIndex: 0,
              randomSeed: context.seed,
              startedAtSeconds: 0,
              elapsedSeconds: 0.1,
              completedAtSeconds: 0.1,
              populationBefore: null,
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: null
            },
            {
              stage: "lns",
              stageIndex: 2,
              cycleIndex: 1,
              randomSeed: context.seed + 1,
              startedAtSeconds: 0.1,
              elapsedSeconds: 1.1,
              completedAtSeconds: 1.2,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 0,
              lnsStopReason: "iteration-limit"
            },
            {
              stage: "lns",
              stageIndex: 3,
              cycleIndex: 2,
              randomSeed: context.seed + 2,
              startedAtSeconds: 1.2,
              elapsedSeconds: 0.4,
              completedAtSeconds: 1.6,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 0,
              lnsStopReason: "iteration-limit"
            },
            {
              stage: "cp-sat",
              stageIndex: 4,
              cycleIndex: 2,
              randomSeed: context.seed + 3,
              startedAtSeconds: 1.6,
              elapsedSeconds: 0.2,
              completedAtSeconds: 1.8,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 1,
              cpSatStatus: "FEASIBLE"
            },
            {
              stage: "cp-sat",
              stageIndex: 5,
              cycleIndex: 3,
              randomSeed: context.seed + 4,
              startedAtSeconds: 1.8,
              elapsedSeconds: 0.5,
              completedAtSeconds: 2.3,
              populationBefore: modeScores[context.mode],
              candidatePopulation: modeScores[context.mode],
              acceptedPopulation: modeScores[context.mode],
              improvement: 2,
              cpSatStatus: "FEASIBLE"
            }
          ],
          greedySeedStage: {
            timeLimitSeconds: 3,
            localSearch: true,
            restarts: 4,
            serviceRefineIterations: 1,
            serviceRefineCandidateLimit: 30,
            exhaustiveServiceSearch: false,
            serviceExactPoolLimit: 25,
            serviceExactMaxCombinations: 2000,
            totalPopulation: modeScores[context.mode],
            elapsedSeconds: 0.1,
            phases: [
              {
                name: "constructiveCapSearch",
                runs: 1,
                elapsedMs: 4,
                bestPopulationBefore: 0,
                bestPopulationAfter: modeScores[context.mode],
                bestPopulationDelta: modeScores[context.mode],
                candidatePopulationBefore: 0,
                candidatePopulationAfter: modeScores[context.mode],
                candidatePopulationDelta: modeScores[context.mode],
                improvements: 1
              }
            ]
          }
        };
        solution.lnsTelemetry = {
          stopReason: "iteration-limit",
          seedSource: "hint",
          seedTimeLimitSeconds: 0.2,
          seedWallClockSeconds: 0.2,
          wallClockLimitSeconds: 1.1,
          noImprovementTimeoutSeconds: null,
          focusedRepairTimeLimitSeconds: 1,
          escalatedRepairTimeLimitSeconds: 1,
          iterationsStarted: 1,
          iterationsCompleted: 1,
          improvingIterations: 0,
          neutralIterations: 1,
          recoverableFailures: 0,
          skippedIterations: 0,
          finalStagnantIterations: 1,
          elapsedSeconds: 0.3,
          outcomes: [
            {
              iteration: 0,
              phase: "focused",
              window: { top: 0, left: 0, rows: 2, cols: 2 },
              stagnantIterationsBefore: 0,
              staleSecondsBefore: 0,
              repairTimeLimitSeconds: 1,
              wallClockSeconds: 0.1,
              populationBefore: modeScores[context.mode],
              populationAfter: modeScores[context.mode],
              improvement: 0,
              status: "neutral",
              cpSatStatus: "FEASIBLE"
            }
          ]
        };
      }
      if (context.mode === "lns") {
        solution.lnsTelemetry = {
          stopReason: "iteration-limit",
          seedSource: "greedy",
          seedTimeLimitSeconds: 2,
          seedWallClockSeconds: 0.2,
          wallClockLimitSeconds: 3,
          noImprovementTimeoutSeconds: null,
          focusedRepairTimeLimitSeconds: 1,
          escalatedRepairTimeLimitSeconds: 1,
          iterationsStarted: 1,
          iterationsCompleted: 1,
          improvingIterations: 0,
          neutralIterations: 1,
          recoverableFailures: 0,
          skippedIterations: 0,
          finalStagnantIterations: 1,
          elapsedSeconds: 1,
          outcomes: [
            {
              iteration: 0,
              phase: "focused",
              window: { top: 0, left: 0, rows: 2, cols: 2 },
              stagnantIterationsBefore: 0,
              staleSecondsBefore: 0,
              repairTimeLimitSeconds: 1,
              wallClockSeconds: 0.1,
              populationBefore: modeScores[context.mode],
              populationAfter: modeScores[context.mode],
              improvement: 0,
              status: "neutral",
              cpSatStatus: "FEASIBLE"
            }
          ]
        };
      }
      if (context.mode === "cp-sat-portfolio") {
        solution.cpSatTelemetry = {
          solveWallTimeSeconds: 1,
          userTimeSeconds: 1,
          solutionCount: 1,
          incumbentObjectiveValue: modeScores[context.mode],
          bestObjectiveBound: modeScores[context.mode] + 2,
          objectiveGap: 2,
          incumbentPopulation: modeScores[context.mode],
          bestPopulationUpperBound: modeScores[context.mode] + 2,
          populationGapUpperBound: 2,
          lastImprovementAtSeconds: 0.5,
          secondsSinceLastImprovement: 0.5,
          numBranches: 0,
          numConflicts: 0
        };
        solution.cpSatPortfolio = {
          workerCount: 2,
          selectedWorkerIndex: 1,
          workers: [
            {
              workerIndex: 0,
              randomSeed: context.seed,
              randomizeSearch: true,
              numWorkers: 1,
              status: "UNKNOWN",
              feasible: false,
              totalPopulation: null
            },
            {
              workerIndex: 1,
              randomSeed: context.seed + 101,
              randomizeSearch: true,
              numWorkers: 1,
              status: "FEASIBLE",
              feasible: true,
              totalPopulation: modeScores[context.mode]
            }
          ]
        };
      }
      return solution;
    }
  });

  assert.equal(mocked.cases.length, 2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "greedy").winVsAuto, "win");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").winVsAuto, "loss");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").winVsAuto, "tie");
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").lnsSeedTimeLimitSeconds, 2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "lns").lnsSeedWallClockSeconds, 0.2);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedTimeLimitSeconds, 3);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedElapsedSeconds, 0.1);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "auto").autoGreedySeedProfilePhaseCount, 1);
  assert.equal(mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").workerCpuBudgetSeconds, 6);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "greedy").winRateVsAuto, 1);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "lns").winRateVsAuto, 0);
  assert.equal(mocked.modeSummaries.find((entry) => entry.mode === "greedy").populationStdDev, 0.5);
  assert.equal(mocked.budgetPolicySignals.length, 2);
  assert.equal(mocked.budgetPolicySignals[0].recommendation, "shift-auto-budget-to-greedy");
  assert.equal(mocked.budgetPolicySignals[0].autoDeltaToBest, 2);
  assert.equal(mocked.budgetPolicySignals[0].lnsScoreDeltaVsAuto, -2);
  assert.equal(mocked.budgetPolicySignals[0].autoLnsStageElapsedSeconds, 1.5);
  assert.equal(mocked.budgetPolicySignals[0].autoLnsStageImprovement, 0);
  assert.equal(mocked.budgetPolicySignals[0].autoCpSatStageElapsedSeconds, 0.7);
  assert.equal(mocked.budgetPolicySignals[0].autoCpSatStageImprovement, 3);
  assert.match(mocked.budgetPolicySignals[0].reason, /Greedy beat Auto by 2 population/);
  assert.match(mocked.budgetPolicySignals[0].reason, /Auto LNS used 1\.500s/);
  assert.match(mocked.budgetPolicySignals[0].reason, /Auto CP-SAT used 0\.700s for \+3/);
  assert.equal(
    mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio").progressSummary.portfolioWorkerSummary
      .feasibleWorkers,
    1
  );
  const mockedAuto = mocked.cases[0].results.find((entry) => entry.mode === "auto");
  const mockedGreedy = mocked.cases[0].results.find((entry) => entry.mode === "greedy");
  const mockedLns = mocked.cases[0].results.find((entry) => entry.mode === "lns");
  const mockedPortfolio = mocked.cases[0].results.find((entry) => entry.mode === "cp-sat-portfolio");
  assert.equal(mockedGreedy.roadSemantics.status, "anchor-connected");
  assert.equal(mockedGreedy.roadSemantics.anchorRoadCount, 1);
  assert.equal(mockedGreedy.roadSemantics.anchorConnectedRoadRatio, 1);
  assert.equal(mockedGreedy.roadSemantics.roadAdjacentBuildingCount, 1);
  assert.equal(mockedLns.roadSemantics.status, "no-anchor-touch");
  assert.equal(mockedLns.roadSemantics.anchorConnectedRoadCount, 0);
  assert.equal(mockedPortfolio.roadSemantics.status, "disconnected");
  assert.equal(mockedPortfolio.roadSemantics.disconnectedRoadCount, 1);
  assert.equal(mockedAuto.budgetAllocationSignal.scoreDeltaVsAuto, 0);
  assert.equal(mockedLns.budgetAllocationSignal.scoreDeltaVsAuto, -2);
  assert.equal(mockedLns.budgetAllocationSignal.signal, "under-used-budget");
  assert(mockedLns.budgetAllocationSignal.budgetRemainingSeconds > 2);
  assert.match(mockedLns.budgetAllocationSignal.reason, /small share/);
  assert(mockedAuto.decisionTrace.some((event) => event.kind === "auto-stage"));
  assert(mockedAuto.decisionTrace.some((event) => event.kind === "greedy-phase"));
  const mockedAutoLnsNeighborhood = mockedAuto.decisionTrace.find((event) => event.kind === "lns-neighborhood");
  assert(mockedAutoLnsNeighborhood);
  assert.equal(mockedAutoLnsNeighborhood.activeStage, "lns");
  assert.equal(mockedAutoLnsNeighborhood.elapsedMs, 1500);
  assert(mockedLns.decisionTrace.some((event) => event.kind === "lns-neighborhood"));
  assert(mockedPortfolio.decisionTrace.some((event) => event.kind === "cp-sat-progress"));
  assert.equal(mockedAuto.timeToQuality.bestScore, 10);
  assert.equal(mockedLns.timeToQuality.finalScore, 8);
  assert.equal(mockedAuto.timeToQuality.timeCheckpoints.find((entry) => entry.elapsedMs === 5000).bestScore, 10);
  assert.equal(mockedAuto.timeToQuality.qualityTargets.find((entry) => entry.ratio === 1).reachedScore, 10);
  assert.match(mockedPortfolio.checkpointReason, /CP-SAT portfolio worker|CP-SAT FEASIBLE/);
  assert.equal(mocked.portfolioEfficiencySignals.length, 0);
  assert.equal(mockedAuto.telemetry.stageCount, mockedAuto.telemetry.stages.length);
  assert(mockedAuto.telemetry.stages.some((entry) => entry.kind === "auto-stage" && entry.stage === "lns"));
  assert.equal(
    mockedAuto.telemetry.stages.find((entry) => entry.kind === "lns-neighborhood").operatorOutcome,
    "neutral"
  );
  assert.equal(mockedLns.telemetry.stages.find((entry) => entry.kind === "lns").candidateCounts.iterationsStarted, 1);
  assert.equal(mockedPortfolio.telemetry.cpu.workerCpuBudgetSeconds, 6);
  assert.equal(mockedPortfolio.telemetry.score.cpSatStatus, "FEASIBLE");
  assert.equal(mockedPortfolio.telemetry.stages.filter((entry) => entry.kind === "cp-sat-portfolio-worker").length, 2);
  const mockedTelemetryManifest = buildCrossModeBenchmarkTelemetryManifest(mocked, {
    command: "node dist/crossModeBenchmarkCli.js --json",
    git: {
      commit: "1234567890abcdef1234567890abcdef12345678",
      branch: "features/telemetry-manifest-test"
    },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      memoryBytes: 16,
      gpuUsed: false
    }
  });
  assert.equal(mockedTelemetryManifest.schemaVersion, 1);
  assert.equal(mockedTelemetryManifest.source, "cross-mode-benchmark");
  assert.equal(mockedTelemetryManifest.command, "node dist/crossModeBenchmarkCli.js --json");
  assert.equal(mockedTelemetryManifest.git.branch, "features/telemetry-manifest-test");
  assert.equal(mockedTelemetryManifest.hardware.cpuModel, "Test CPU");
  assert.equal(mockedTelemetryManifest.suite.totalRuns, 8);
  assert.equal(mockedTelemetryManifest.runs.length, 8);
  assert(
    mockedTelemetryManifest.runs.some(
      (entry) =>
        entry.caseName === "mock-scorecard" &&
        entry.mode === "lns" &&
        entry.stages.some((stage) => stage.kind === "lns-neighborhood" && stage.operatorOutcome === "neutral")
    )
  );

  const telemetry = (population, userTimeSeconds = 1) => ({
    solveWallTimeSeconds: userTimeSeconds,
    userTimeSeconds,
    solutionCount: 1,
    incumbentObjectiveValue: population,
    bestObjectiveBound: population,
    objectiveGap: 0,
    incumbentPopulation: population,
    bestPopulationUpperBound: population,
    populationGapUpperBound: 0,
    lastImprovementAtSeconds: userTimeSeconds,
    secondsSinceLastImprovement: 0,
    numBranches: 0,
    numConflicts: 0
  });
  const portfolioCompared = await runCrossModeBenchmarkSuite([benchmarkCase], {
    modes: ["cp-sat", "cp-sat-portfolio"],
    budgetsSeconds: [3],
    seeds: [5],
    portfolio: { workerCount: 2 },
    solve: async (_grid, params, context) => {
      await delay(context.mode === "cp-sat" ? 50 : 1);
      const totalPopulation = context.mode === "cp-sat-portfolio" ? 24 : 10;
      const solution = buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation,
        cpSatStatus: "FEASIBLE"
      });
      solution.cpSatTelemetry = telemetry(totalPopulation, context.mode === "cp-sat" ? 2 : 1);
      if (context.mode === "cp-sat-portfolio") {
        solution.cpSatPortfolio = {
          workerCount: 2,
          selectedWorkerIndex: 1,
          workers: [
            {
              workerIndex: 0,
              randomSeed: context.seed,
              randomizeSearch: true,
              numWorkers: 1,
              status: "FEASIBLE",
              feasible: true,
              totalPopulation: 12,
              telemetry: telemetry(12, 1)
            },
            {
              workerIndex: 1,
              randomSeed: context.seed + 101,
              randomizeSearch: true,
              numWorkers: 1,
              status: "FEASIBLE",
              feasible: true,
              totalPopulation,
              telemetry: telemetry(totalPopulation, 1)
            }
          ]
        };
      }
      return solution;
    }
  });
  assert.equal(portfolioCompared.portfolioEfficiencySignals.length, 1);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].scoreDelta, 14);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].portfolioWorkerCpuBudgetSeconds, 6);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].portfolioObservedWorkerCpuSeconds, 2);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].cpuBudgetEfficiencyRatio, 1.2);
  assert.equal(portfolioCompared.portfolioEfficiencySignals[0].recommendation, "portfolio-cpu-win");

  const lnsTraceJsonl = serializeDecisionTraceJsonl(mockedLns.decisionTrace);
  assert.equal(parseDecisionTraceJsonl(lnsTraceJsonl).length, mockedLns.decisionTrace.length);
  assert.match(formatCrossModeBenchmarkDecisionTraceJsonl(mocked), /"schemaVersion":1/);
  const zeroElapsedTrace = buildDecisionTraceFromSolution(
    {
      ...buildMockSolution({ optimizer: "cp-sat", totalPopulation: 5, cpSatStatus: "FEASIBLE" }),
      cpSatTelemetry: {
        solveWallTimeSeconds: 3,
        userTimeSeconds: 3,
        solutionCount: 1,
        incumbentObjectiveValue: 5,
        bestObjectiveBound: 5,
        objectiveGap: 0,
        incumbentPopulation: 5,
        bestPopulationUpperBound: 5,
        populationGapUpperBound: 0,
        lastImprovementAtSeconds: 0,
        secondsSinceLastImprovement: 3,
        numBranches: 0,
        numConflicts: 0
      }
    },
    { elapsedTimeSeconds: 0 }
  );
  const zeroElapsedCpSatProgressEvents = zeroElapsedTrace.filter((event) => event.kind === "cp-sat-progress");
  assert.equal(zeroElapsedCpSatProgressEvents[0].elapsedMs, 0);
  assert.equal(zeroElapsedCpSatProgressEvents[0].evidence.solveWallTimeSeconds, 3);
  const terminalCpSatProgress = zeroElapsedCpSatProgressEvents.find((event) => event.decision === "bounded");
  assert(terminalCpSatProgress);
  assert.equal(terminalCpSatProgress.elapsedMs, 3000);
  assert.equal(zeroElapsedTrace.find((event) => event.kind === "checkpoint").elapsedMs, 0);
  const cumulativeScorecard = buildTimeToQualityScorecard(
    [
      {
        schemaVersion: 1,
        runId: "synthetic",
        sequence: 0,
        eventId: "synthetic:0000",
        elapsedMs: 1000,
        optimizer: "greedy",
        activeStage: "greedy",
        kind: "checkpoint",
        decision: "improved",
        reason: "Synthetic improvement.",
        score: { before: null, after: 20, best: 20, delta: 20, upperBound: null, gap: null }
      },
      {
        schemaVersion: 1,
        runId: "synthetic",
        sequence: 1,
        eventId: "synthetic:0001",
        elapsedMs: 2000,
        optimizer: "greedy",
        activeStage: "greedy",
        kind: "checkpoint",
        decision: "stalled",
        reason: "Synthetic lower side event.",
        score: { before: 20, after: 10, best: 10, delta: -10, upperBound: null, gap: null }
      }
    ],
    { finalElapsedMs: 3000, finalScore: 10, timeCheckpointsMs: [2500, Number.NaN], qualityTargetRatios: [1] }
  );
  assert.equal(cumulativeScorecard.timeCheckpoints.length, 1);
  assert.equal(cumulativeScorecard.timeCheckpoints[0].bestScore, 20);
  assert.equal(cumulativeScorecard.qualityTargets[0].reachedAtMs, 1000);

  const formatted = formatCrossModeBenchmarkSuite(result);
  assert.match(formatted, /=== Cross-Mode Benchmark Scorecard ===/);
  assert.match(formatted, /Equal wall-clock budgets: 3s per mode/);
  assert.match(formatted, /progress=current=/);
  assert.match(formatted, /quality=first-feasible=/);
  assert.match(formatted, /road-semantics=/);
  assert.match(formatted, /budget-signal=/);
  const mockedFormatted = formatCrossModeBenchmarkSuite(mocked);
  assert.match(mockedFormatted, /road-semantics=anchor-connected anchor-roads=1 anchor-connected=1 disconnected=0/);
  assert.match(mockedFormatted, /road-semantics=no-anchor-touch anchor-roads=0 anchor-connected=0/);
  assert.match(mockedFormatted, /road-semantics=disconnected anchor-roads=1 anchor-connected=1 disconnected=1/);
  assert.match(mockedFormatted, /seed-policy=.*lns-seed-limit:2\.000s/);
  assert.match(mockedFormatted, /seed-policy=.*auto-greedy-seed-limit:3\.000s/);
  assert.match(mockedFormatted, /budget-signal=under-used-budget/);
  assert.match(mockedFormatted, /Budget policy signals:/);
  assert.match(mockedFormatted, /recommendation=shift-auto-budget-to-greedy/);
  assert.match(mockedFormatted, /auto-gap=2/);
  assert.match(mockedFormatted, /reason=/);

  const repoRoot = path.join(__dirname, "../..");
  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const artifactDir = `artifacts/tmp-cross-mode-scorecard-artifacts-${process.pid}`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  try {
    const artifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${artifactDir}`,
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "typed-housing-single"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(artifactResult.status, 0, artifactResult.stderr || artifactResult.stdout);
    const artifactManifest = JSON.parse(artifactResult.stdout);
    assert.equal(artifactManifest.artifactDir, artifactDir);
    assert.deepEqual(Object.keys(artifactManifest.artifactPaths).sort(), [
      "scorecardJson",
      "scorecardText",
      "telemetryManifestJson"
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson)), true);
    const scorecardArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.scorecardJson), "utf8")
    );
    const telemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, artifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    assert.deepEqual(scorecardArtifact.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(telemetryArtifact.source, "cross-mode-benchmark");
    assert.match(telemetryArtifact.command, /--artifact-dir=artifacts\/tmp-cross-mode-scorecard-artifacts-/);
    assert.equal(telemetryArtifact.suite.totalRuns, 1);
    assert.equal(telemetryArtifact.runs[0].caseName, "typed-housing-single");
    assert.equal(telemetryArtifact.runs[0].mode, "greedy");
    assert.equal(telemetryArtifact.runs[0].budgetSeconds, 1);
    assert.equal(telemetryArtifact.runs[0].seed, 7);
    assert.equal(typeof telemetryArtifact.hardware.captured, "boolean");

    const ablationArtifactDir = `${artifactDir}-ablation`;
    const absoluteAblationArtifactDir = path.join(repoRoot, ablationArtifactDir);
    fs.rmSync(absoluteAblationArtifactDir, { recursive: true, force: true });
    const ablationArtifactResult = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        `--artifact-dir=${ablationArtifactDir}`,
        "--budget-ablation",
        "--ablation-policies=baseline,seed-light",
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "typed-housing-single"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.equal(ablationArtifactResult.status, 0, ablationArtifactResult.stderr || ablationArtifactResult.stdout);
    const ablationArtifactManifest = JSON.parse(ablationArtifactResult.stdout);
    assert.equal(ablationArtifactManifest.artifactDir, ablationArtifactDir);
    assert.deepEqual(Object.keys(ablationArtifactManifest.artifactPaths).sort(), [
      "budgetAblationJson",
      "budgetAblationText",
      "decisionTraceJsonl",
      "registryEntryDraftJson",
      "telemetryManifestJson"
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.decisionTraceJsonl)), true);
    assert.equal(
      fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.telemetryManifestJson)),
      true
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.registryEntryDraftJson)),
      true
    );
    const budgetAblationArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.budgetAblationJson), "utf8")
    );
    const ablationTelemetryArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.telemetryManifestJson), "utf8")
    );
    const ablationRegistryDraft = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ablationArtifactManifest.artifactPaths.registryEntryDraftJson), "utf8")
    );
    assert.deepEqual(budgetAblationArtifact.selectedCaseNames, ["typed-housing-single"]);
    assert.equal(budgetAblationArtifact.policies.length, 2);
    assert.equal(ablationTelemetryArtifact.source, "cross-mode-budget-ablation");
    assert.equal(ablationTelemetryArtifact.suite.policyCount, 2);
    assert.equal(ablationTelemetryArtifact.runs.length, 2);
    assert.equal(ablationTelemetryArtifact.runs[0].budgetAblationPolicyName, "baseline");
    assert.equal(ablationRegistryDraft.artifactType, "ablation-gate");
    assert.equal(ablationRegistryDraft.budget.policyCount, 2);
    assert.deepEqual(ablationRegistryDraft.cases.development, ["typed-housing-single"]);

    const artifactWriterConflict = childProcess.spawnSync(
      process.execPath,
      [cliPath, `--artifact-dir=${artifactDir}`, "--product-corpus", `--product-artifact-dir=${artifactDir}-product`],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    assert.notEqual(artifactWriterConflict.status, 0);
    assert.match(artifactWriterConflict.stderr, /Use only one artifact writer/);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
    fs.rmSync(`${absoluteArtifactDir}-product`, { recursive: true, force: true });
    fs.rmSync(`${absoluteArtifactDir}-ablation`, { recursive: true, force: true });
  }

  const ablations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto", "lns"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      {
        name: "reserve-heavy",
        description: "Mock reserve-heavy policy.",
        autoCpSatStageReserveRatio: 0.35,
        lnsSeedBudgetRatio: 0.1,
        lnsRepairBudgetRatio: 0.2
      }
    ],
    solve: async (_grid, params, context) => {
      const reserveBonus = params.auto?.cpSatStageReserveRatio === 0.35 ? 5 : 0;
      const totalPopulation = context.mode === "auto" ? 10 + reserveBonus : 9;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation });
    }
  });
  assert.equal(ablations.policies.length, 2);
  assert.equal(ablations.baselinePolicyName, "baseline");
  assert.equal(ablations.bestPolicyName, "reserve-heavy");
  assert.equal(ablations.policies[0].meanAutoPopulation, 10);
  assert.equal(ablations.policies[1].meanAutoPopulation, 15);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(ablations.policies[1].deltaVsBaselineMeanLnsPopulation, 0);
  assert.equal(ablations.policies[1].autoSafetySummary.comparisonCount, 1);
  assert.equal(ablations.policies[1].autoSafetySummary.meanAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.worstDecileAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.worstAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.regressedAutoCount, 0);
  assert(Math.abs(ablations.policies[1].autoSafetySummary.autoCpuBudgetEfficiencyRatioVsBaseline - 1.5) < 0.001);
  assert.equal(ablations.policies[0].autoReplayDiagnostics.length, 0);
  assert.equal(ablations.policies[1].autoReplayDiagnostics.length, 1);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].caseName, "mock-scorecard");
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].autoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].baseline.finalPopulation, 10);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.finalPopulation, 15);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.params.autoCpSatStageReserveRatio, 0.35);
  assert.equal(ablations.policies[1].autoVarianceSummary, null);
  assert.equal(ablations.policies[1].budgetSummaries.length, 1);
  assert.equal(ablations.policies[1].budgetSummaries[0].budgetSeconds, 3);
  assert.equal(ablations.policies[1].budgetSummaries[0].meanAutoPopulation, 15);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(ablations.policies[1].budgetSummaries[0].deltaVsBaselineMeanLnsPopulation, 0);
  assert.equal(ablations.policies[1].budgetSummaries[0].autoSafetySummary.comparisonCount, 1);
  assert.equal(ablations.policies[1].budgetSummaries[0].autoSafetySummary.meanAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.budgetedModeSeconds, 12);
  assert(
    ablations.policies[1].suite.cases[0].results
      .find((entry) => entry.mode === "auto")
      .decisionTrace.some((event) => event.runId.includes("policy-reserve-heavy"))
  );
  const ablationText = formatCrossModeBenchmarkBudgetAblations(ablations);
  assert.match(ablationText, /=== Cross-Mode Budget Ablations ===/);
  assert.match(ablationText, /Coverage: policies=2 scorecards=2 mode-runs=4 budgeted-mode-seconds=12/);
  assert.match(ablationText, /reserve-heavy/);
  assert.match(ablationText, /delta-vs-baseline=\+5/);
  assert.match(ablationText, /auto-delta-vs-baseline=\+5/);
  assert.match(ablationText, /lns-delta-vs-baseline=0/);
  assert.match(ablationText, /auto-safety=paired=1 delta-mean=\+5/);
  assert.match(ablationText, /auto-replay-diagnostics=1 nonzero paired Auto rows/);
  assert.match(ablationText, /row=mock-scorecard\/budget:3s\/seed:5 delta=\+5/);
  assert.match(ablationText, /cpu-eff-ratio=1\.500/);
  assert.match(ablationText, /budget=3s cases=1 mean-best=15\.0/);

  const reorderedAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      {
        name: "reserve-heavy",
        description: "Mock reserve-heavy policy.",
        autoCpSatStageReserveRatio: 0.35
      },
      { name: "baseline", description: "Mock baseline." }
    ],
    solve: async (_grid, params) => {
      const reserveBonus = params.auto?.cpSatStageReserveRatio === 0.35 ? 5 : 0;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation: 10 + reserveBonus });
    }
  });
  assert.equal(reorderedAblations.baselinePolicyName, "baseline");
  assert.equal(reorderedAblations.policies[0].policyName, "reserve-heavy");
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanBestPopulation, 5);
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanAutoPopulation, 5);
  assert.equal(reorderedAblations.policies[0].deltaVsBaselineMeanLnsPopulation, null);
  assert.equal(reorderedAblations.policies[1].deltaVsBaselineMeanBestPopulation, 0);

  const tiedAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "aaa-tie", description: "Alphabetically first tied policy." },
      { name: "baseline", description: "Mock baseline." }
    ],
    solve: async (_grid, params) => buildMockSolution({ optimizer: params.optimizer, totalPopulation: 10 })
  });
  assert.equal(tiedAblations.baselinePolicyName, "baseline");
  assert.equal(tiedAblations.bestPolicyName, "baseline");
  assert.equal(tiedAblations.topPolicyName, "baseline");
  assert.equal(tiedAblations.topPolicyRankingBasis, "mean-auto-population");
  assert.deepEqual(tiedAblations.topPolicyTiedPolicyNames, ["aaa-tie", "baseline"]);
  assert.match(formatCrossModeBenchmarkBudgetAblations(tiedAblations), /tied=aaa-tie,baseline/);

  const lnsOnlyAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["greedy", "lns"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      { name: "lns-win", description: "Mock LNS improvement." }
    ],
    solve: async (_grid, params, context) => {
      const totalPopulation = context.mode === "greedy" ? 20 : context.budgetAblationPolicyName === "lns-win" ? 15 : 10;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation });
    }
  });
  assert.equal(lnsOnlyAblations.topPolicyRankingBasis, "mean-lns-population");
  assert.equal(lnsOnlyAblations.topPolicyName, "lns-win");
  assert.equal(lnsOnlyAblations.bestPolicyName, "lns-win");
  assert.deepEqual(lnsOnlyAblations.topPolicyTiedPolicyNames, ["lns-win"]);
  assert.equal(lnsOnlyAblations.policies[0].autoSafetySummary.comparisonCount, 0);
  assert.equal(lnsOnlyAblations.policies[1].autoSafetySummary.meanAutoPopulationDeltaVsBaseline, null);

  const guardedBudgetAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [1, 5],
    seeds: [5],
    policyNames: ["baseline", "repair-heavy-5s-guarded"],
    solve: async (_grid, params, context) => {
      const guardedPolicyActive =
        context.budgetAblationPolicyName === "repair-heavy-5s-guarded" &&
        params.auto?.cpSatStageReserveRatio === 0.1 &&
        params.lns?.repairTimeLimitSeconds === 1;
      return buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: 10 + (guardedPolicyActive ? 5 : 0)
      });
    }
  });
  const guardedPolicyResult = guardedBudgetAblations.policies.find(
    (policy) => policy.policyName === "repair-heavy-5s-guarded"
  );
  assert.equal(guardedBudgetAblations.topPolicyName, "repair-heavy-5s-guarded");
  assert.equal(guardedPolicyResult.deltaVsBaselineMeanAutoPopulation, 2.5);
  assert.equal(guardedPolicyResult.autoSafetySummary.comparisonCount, 2);
  assert.equal(guardedPolicyResult.autoSafetySummary.meanAutoPopulationDeltaVsBaseline, 2.5);
  assert.equal(guardedPolicyResult.autoSafetySummary.worstDecileAutoPopulationDeltaVsBaseline, 0);
  assert.equal(guardedPolicyResult.autoSafetySummary.worstAutoPopulationDeltaVsBaseline, 0);
  assert.equal(guardedPolicyResult.autoSafetySummary.bestAutoPopulationDeltaVsBaseline, 5);
  assert.equal(guardedPolicyResult.autoSafetySummary.regressedAutoCount, 0);
  assert.equal(
    guardedPolicyResult.budgetSummaries.find((budget) => budget.budgetSeconds === 1).deltaVsBaselineMeanAutoPopulation,
    0
  );
  assert.equal(
    guardedPolicyResult.budgetSummaries.find((budget) => budget.budgetSeconds === 1).autoSafetySummary
      .worstAutoPopulationDeltaVsBaseline,
    0
  );
  assert.equal(
    guardedPolicyResult.budgetSummaries.find((budget) => budget.budgetSeconds === 5).deltaVsBaselineMeanAutoPopulation,
    5
  );
  assert.equal(
    guardedPolicyResult.budgetSummaries.find((budget) => budget.budgetSeconds === 5).autoSafetySummary
      .bestAutoPopulationDeltaVsBaseline,
    5
  );
  const repeatabilityAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [1],
    seeds: [5, 11],
    policyNames: ["baseline", "baseline-repeat"],
    solve: async (_grid, params, context) => {
      const repeatDrift = context.budgetAblationPolicyName === "baseline-repeat" && context.seed === 11 ? -2 : 0;
      return buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: 10 + repeatDrift
      });
    }
  });
  const repeatPolicyResult = repeatabilityAblations.policies.find((policy) => policy.policyName === "baseline-repeat");
  assert.equal(repeatabilityAblations.baselinePolicyName, "baseline");
  assert.equal(repeatabilityAblations.topPolicyName, "baseline");
  assert.equal(repeatPolicyResult.autoSafetySummary.comparisonCount, 2);
  assert.equal(repeatPolicyResult.autoSafetySummary.regressedAutoCount, 1);
  assert.equal(repeatPolicyResult.autoSafetySummary.meanAutoPopulationDeltaVsBaseline, -1);
  assert.equal(repeatPolicyResult.autoSafetySummary.worstAutoPopulationDeltaVsBaseline, -2);
  assert.equal(repeatPolicyResult.autoSafetySummary.worstAutoPopulationDeltaSeed, 11);
  assert.equal(repeatPolicyResult.autoReplayDiagnostics.length, 1);
  assert.equal(repeatPolicyResult.autoReplayDiagnostics[0].seed, 11);
  assert.equal(repeatPolicyResult.autoReplayDiagnostics[0].autoPopulationDeltaVsBaseline, -2);
  assert.match(repeatPolicyResult.autoReplayDiagnostics[0].reason, /regressed/);
  assert.equal(repeatPolicyResult.autoVarianceSummary.baselineRepeatPolicyName, "baseline-repeat");
  assert.equal(repeatPolicyResult.autoVarianceSummary.comparisonCount, 2);
  assert.equal(repeatPolicyResult.autoVarianceSummary.insideRepeatEnvelopeCount, 2);
  assert.equal(repeatPolicyResult.autoVarianceSummary.outsideRepeatEnvelopeCount, 0);
  assert.equal(repeatPolicyResult.autoVarianceSummary.repeatAutoPopulationDeltaMin, -2);
  assert.equal(repeatPolicyResult.autoVarianceSummary.repeatAutoPopulationDeltaMax, 0);
  assert.equal(
    repeatPolicyResult.suite.cases[0].results[0].telemetry.solverParams.auto.cpSatStageReserveRatio,
    undefined
  );
  assert.equal(
    repeatPolicyResult.suite.cases[0].results[0].telemetry.solverParams.lns.seedTimeLimitSeconds,
    baselineOneSecondAutoParams.lns.seedTimeLimitSeconds
  );

  const varianceGateAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [1],
    seeds: [5, 11],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      { name: "baseline-repeat", description: "Mock baseline repeat." },
      { name: "candidate", description: "Mock candidate outside repeat envelope." }
    ],
    solve: async (_grid, params, context) => {
      const repeatDrift = context.budgetAblationPolicyName === "baseline-repeat" && context.seed === 11 ? -2 : 0;
      const candidateDrift = context.budgetAblationPolicyName === "candidate" ? (context.seed === 5 ? 1 : -4) : 0;
      return buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: 10 + repeatDrift + candidateDrift
      });
    }
  });
  const varianceCandidate = varianceGateAblations.policies.find((policy) => policy.policyName === "candidate");
  assert.equal(varianceCandidate.autoVarianceSummary.comparisonCount, 2);
  assert.equal(varianceCandidate.autoVarianceSummary.insideRepeatEnvelopeCount, 0);
  assert.equal(varianceCandidate.autoVarianceSummary.outsideRepeatEnvelopeCount, 2);
  assert.equal(varianceCandidate.autoVarianceSummary.outsideNegativeRepeatEnvelopeCount, 1);
  assert.equal(varianceCandidate.autoVarianceSummary.outsidePositiveRepeatEnvelopeCount, 1);
  assert.equal(varianceCandidate.autoVarianceSummary.repeatAutoPopulationDeltaMin, -2);
  assert.equal(varianceCandidate.autoVarianceSummary.repeatAutoPopulationDeltaMax, 0);
  assert.equal(varianceCandidate.autoVarianceSummary.candidateAutoPopulationDeltaMin, -4);
  assert.equal(varianceCandidate.autoVarianceSummary.candidateAutoPopulationDeltaMax, 1);
  assert.equal(varianceCandidate.autoVarianceSummary.meanAbsoluteCandidateDeltaBeyondRepeatEnvelope, 1.5);
  assert.equal(varianceCandidate.autoVarianceSummary.worstCandidateDeltaBeyondRepeatEnvelope, -2);
  assert.equal(varianceCandidate.autoVarianceSummary.bestCandidateDeltaBeyondRepeatEnvelope, 1);
  assert.match(
    formatCrossModeBenchmarkBudgetAblations(varianceGateAblations),
    /auto-variance=repeat=baseline-repeat paired=2 inside=0 outside=2 outside-neg=1 outside-pos=1/
  );

  await assert.rejects(
    () =>
      runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
        modes: ["auto"],
        budgetsSeconds: [3],
        seeds: [5],
        baselinePolicyName: "missing-baseline",
        policies: [{ name: "baseline", description: "Mock baseline." }],
        solve: async () => {
          throw new Error("baseline validation should run before suite execution");
        }
      }),
    /baseline policy not found: missing-baseline/
  );

  await assert.rejects(
    () =>
      runCrossModeBenchmarkSuite([benchmarkCase], {
        modes: ["greedy", "bad-mode"],
        budgetsSeconds: [3],
        seeds: [5],
        solve: async () => {
          throw new Error("mode validation should run before suite execution");
        }
      }),
    /Unknown cross-mode benchmark mode\(s\): bad-mode/
  );

  await assert.rejects(
    () => runCrossModeBenchmarkSuite([benchmarkCase], { names: ["missing-case"], modes: ["greedy"] }),
    /Unknown cross-mode benchmark case\(s\): missing-case/
  );
}

testCrossModeBenchmarkHelpers()
  .then(() => {
    console.log("Cross-mode benchmark tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
