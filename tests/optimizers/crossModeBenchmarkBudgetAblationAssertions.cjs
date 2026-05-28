const assert = require("node:assert/strict");

const {
  buildCrossModeBenchmarkParams,
  formatCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite
} = require("city-builder/benchmarks");
const { buildMockSolution } = require("../helpers/solverFixtures.cjs");
const { buildCrossModeBenchmarkCase } = require("./crossModeBenchmarkTestHelpers.cjs");

async function testCrossModeBenchmarkBudgetAblationAssertions() {
  const benchmarkCase = buildCrossModeBenchmarkCase();
  const baselineOneSecondAutoParams = buildCrossModeBenchmarkParams(benchmarkCase, "auto", {
    budgetSeconds: 1,
    seeds: [5]
  });
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
      const solution = buildMockSolution({ optimizer: params.optimizer, totalPopulation });
      if (context.mode !== "auto") return solution;
      return {
        ...solution,
        autoStage: {
          requestedOptimizer: "auto",
          activeStage: "cp-sat",
          stageIndex: 3,
          cycleIndex: 1,
          consecutiveWeakCycles: 0,
          lastCycleImprovementRatio: reserveBonus > 0 ? 0.5 : 0,
          stopReason: "completed-plan",
          generatedSeeds: [],
          stageRuns: [
            {
              stage: "greedy",
              stageIndex: 1,
              cycleIndex: 0,
              randomSeed: 101,
              startedAtSeconds: 0,
              elapsedSeconds: 0.1,
              completedAtSeconds: 0.1,
              populationBefore: null,
              candidatePopulation: 10,
              acceptedPopulation: 10,
              improvement: null
            },
            {
              stage: "lns",
              stageIndex: 2,
              cycleIndex: 1,
              randomSeed: 102,
              startedAtSeconds: 0.1,
              elapsedSeconds: 0.2,
              completedAtSeconds: 0.3,
              populationBefore: 10,
              candidatePopulation: totalPopulation,
              acceptedPopulation: totalPopulation,
              improvement: reserveBonus,
              lnsIterationsStarted: 1,
              lnsIterationsCompleted: 1,
              lnsImprovingIterations: reserveBonus > 0 ? 1 : 0,
              lnsNeutralIterations: reserveBonus > 0 ? 0 : 1,
              lnsNeighborhoods: [
                {
                  iteration: 0,
                  phase: "focused",
                  status: reserveBonus > 0 ? "improved" : "neutral",
                  repairTimeLimitSeconds: 1,
                  wallClockSeconds: 0.15,
                  populationBefore: 10,
                  populationAfter: totalPopulation,
                  improvement: reserveBonus,
                  windowTop: 1,
                  windowLeft: 0,
                  windowRows: 2,
                  windowCols: 2,
                  stagnantIterationsBefore: 0,
                  cpSatStatus: "FEASIBLE"
                }
              ]
            },
            {
              stage: "cp-sat",
              stageIndex: 3,
              cycleIndex: 1,
              randomSeed: 103,
              startedAtSeconds: 0.3,
              elapsedSeconds: 0.2,
              completedAtSeconds: 0.5,
              populationBefore: totalPopulation,
              candidatePopulation: totalPopulation,
              acceptedPopulation: totalPopulation,
              improvement: 0,
              cpSatStatus: "FEASIBLE"
            }
          ]
        }
      };
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
  assert.equal(ablations.policies[1].policyApplicationSummary.scorecardCount, 1);
  assert.equal(ablations.policies[1].policyApplicationSummary.appliedScorecardCount, 1);
  assert.equal(ablations.policies[1].policyApplicationSummary.inactiveScorecardCount, 0);
  assert.equal(ablations.policies[1].policyApplicationSummary.appliedNonzeroAutoDeltaCount, 1);
  assert.equal(ablations.policies[1].policyApplicationSummary.inactiveNonzeroAutoDeltaCount, 0);
  assert.equal(ablations.policies[1].policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenApplied, 5);
  assert.equal(ablations.policies[1].policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenInactive, null);
  assert.equal(ablations.policies[1].autoSafetySummary.comparisonCount, 1);
  assert.equal(ablations.policies[1].autoSafetySummary.meanAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.worstDecileAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.worstAutoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoSafetySummary.regressedAutoCount, 0);
  assert(Math.abs(ablations.policies[1].autoSafetySummary.autoCpuBudgetEfficiencyRatioVsBaseline - 1.5) < 0.001);
  assert.equal(ablations.policies[0].autoReplayDiagnostics.length, 0);
  assert.equal(ablations.policies[1].autoReplayDiagnostics.length, 1);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].caseName, "mock-scorecard");
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].policyApplied, true);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].autoPopulationDeltaVsBaseline, 5);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].baseline.finalPopulation, 10);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.finalPopulation, 15);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.params.autoCpSatStageReserveRatio, 0.35);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.lnsNeighborhoodTraceCaptured, true);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.lnsNeighborhoods[0].stageIndex, 2);
  assert.equal(ablations.policies[1].autoReplayDiagnostics[0].candidate.lnsNeighborhoods[0].windowTop, 1);
  assert.doesNotMatch(
    ablations.policies[1].autoReplayDiagnostics[0].reason,
    /no longer carries detailed LNS neighborhoods/
  );
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
  assert.match(ablationText, /policy-application=scorecards=1 applied=1 inactive=0/);
  assert.match(ablationText, /auto-safety=paired=1 delta-mean=\+5/);
  assert.match(ablationText, /auto-replay-diagnostics=1 nonzero paired Auto rows/);
  assert.match(ablationText, /row=mock-scorecard\/budget:3s\/seed:5 applied=yes delta=\+5/);
  assert.match(ablationText, /improved-neighborhoods=baseline:none candidate:s2\/focused#0@1,0:2x2\+5/);
  assert.match(ablationText, /cpu-eff-ratio=1\.500/);
  assert.match(ablationText, /budget=3s cases=1 mean-best=15\.0/);

  const inactivePolicyAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto"],
    budgetsSeconds: [3],
    seeds: [5],
    policies: [
      { name: "baseline", description: "Mock baseline." },
      {
        name: "inactive-drift",
        description: "Mock policy with inactive predicate but observed run drift.",
        appliesToCase: () => false,
        autoCpSatStageReserveRatio: 0.35
      }
    ],
    solve: async (_grid, params, context) => {
      assert.equal(params.auto?.cpSatStageReserveRatio, undefined);
      if (context.budgetAblationPolicyName === "inactive-drift") {
        assert.equal(context.budgetAblationPolicyApplied, false);
      } else {
        assert.equal(context.budgetAblationPolicyApplied, true);
      }
      const inactiveDrift = context.budgetAblationPolicyName === "inactive-drift" ? 5 : 0;
      return buildMockSolution({ optimizer: params.optimizer, totalPopulation: 10 + inactiveDrift });
    }
  });
  const inactivePolicyResult = inactivePolicyAblations.policies.find(
    (policy) => policy.policyName === "inactive-drift"
  );
  assert.equal(inactivePolicyResult.policyApplicationSummary.appliedScorecardCount, 0);
  assert.equal(inactivePolicyResult.policyApplicationSummary.inactiveScorecardCount, 1);
  assert.equal(inactivePolicyResult.policyApplicationSummary.appliedNonzeroAutoDeltaCount, 0);
  assert.equal(inactivePolicyResult.policyApplicationSummary.inactiveNonzeroAutoDeltaCount, 1);
  assert.equal(inactivePolicyResult.policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenApplied, null);
  assert.equal(inactivePolicyResult.policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenInactive, 5);
  assert.equal(inactivePolicyResult.autoReplayDiagnostics[0].policyApplied, false);
  assert.match(
    formatCrossModeBenchmarkBudgetAblations(inactivePolicyAblations),
    /policy-application=scorecards=1 applied=0 inactive=1[\s\S]*row=mock-scorecard\/budget:3s\/seed:5 applied=no delta=\+5/
  );

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
        context.budgetAblationPolicyApplied === true &&
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
  assert.equal(guardedPolicyResult.policyApplicationSummary.scorecardCount, 2);
  assert.equal(guardedPolicyResult.policyApplicationSummary.appliedScorecardCount, 1);
  assert.equal(guardedPolicyResult.policyApplicationSummary.inactiveScorecardCount, 1);
  assert.equal(guardedPolicyResult.policyApplicationSummary.appliedAutoComparisonCount, 1);
  assert.equal(guardedPolicyResult.policyApplicationSummary.inactiveAutoComparisonCount, 1);
  assert.equal(guardedPolicyResult.policyApplicationSummary.appliedNonzeroAutoDeltaCount, 1);
  assert.equal(guardedPolicyResult.policyApplicationSummary.inactiveNonzeroAutoDeltaCount, 0);
  assert.equal(guardedPolicyResult.policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenApplied, 5);
  assert.equal(guardedPolicyResult.policyApplicationSummary.meanAutoPopulationDeltaVsBaselineWhenInactive, 0);
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
  const serviceMasterPolicyAblations = await runCrossModeBenchmarkBudgetAblations([benchmarkCase], {
    modes: ["auto", "greedy"],
    budgetsSeconds: [3],
    seeds: [5],
    policyNames: ["baseline", "service-master-shortlist"],
    solve: async (_grid, params, context) => {
      if (context.mode === "auto") {
        assert.equal(params.greedy?.serviceMasterDecomposition, undefined);
      }
      const serviceMasterGreedy =
        context.mode === "greedy" && params.greedy?.serviceMasterDecomposition === true ? 7 : 0;
      return buildMockSolution({
        optimizer: params.optimizer,
        totalPopulation: context.mode === "auto" ? 10 : 20 + serviceMasterGreedy
      });
    }
  });
  const serviceMasterPolicyResult = serviceMasterPolicyAblations.policies.find(
    (policy) => policy.policyName === "service-master-shortlist"
  );
  assert.equal(serviceMasterPolicyAblations.baselinePolicyName, "baseline");
  assert.equal(serviceMasterPolicyAblations.topPolicyName, "baseline");
  assert.equal(serviceMasterPolicyResult.autoSafetySummary.comparisonCount, 1);
  assert.equal(serviceMasterPolicyResult.autoSafetySummary.meanAutoPopulationDeltaVsBaseline, 0);
  assert.equal(serviceMasterPolicyResult.autoSafetySummary.regressedAutoCount, 0);
  assert.equal(
    serviceMasterPolicyResult.suite.cases[0].results.find((entry) => entry.mode === "greedy").totalPopulation,
    27
  );
  assert.equal(serviceMasterPolicyResult.deltaVsBaselineMeanBestPopulation, 7);
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

module.exports = { testCrossModeBenchmarkBudgetAblationAssertions };
