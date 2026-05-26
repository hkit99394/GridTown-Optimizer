const { buildMockSolution } = require("./solverFixtures.cjs");
const { createGreedyProfileCounters } = require("../../dist/packages/solvers/greedy/profile.js");

function buildNeutralLnsTelemetry(modeScore, overrides = {}) {
  return {
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
        populationBefore: modeScore,
        populationAfter: modeScore,
        improvement: 0,
        status: "neutral",
        cpSatStatus: "FEASIBLE"
      }
    ],
    ...overrides
  };
}

function buildMockAutoStage(modeScore, seed) {
  return {
    requestedOptimizer: "auto",
    activeStage: "lns",
    stageIndex: 2,
    cycleIndex: 1,
    consecutiveWeakCycles: 0,
    lastCycleImprovementRatio: null,
    stopReason: "wall-clock-cap",
    generatedSeeds: [{ stage: "greedy", stageIndex: 1, cycleIndex: 0, randomSeed: seed }],
    stageRuns: [
      {
        stage: "greedy",
        stageIndex: 1,
        cycleIndex: 0,
        randomSeed: seed,
        startedAtSeconds: 0,
        elapsedSeconds: 0.1,
        completedAtSeconds: 0.1,
        populationBefore: null,
        candidatePopulation: modeScore,
        acceptedPopulation: modeScore,
        improvement: null
      },
      {
        stage: "lns",
        stageIndex: 2,
        cycleIndex: 1,
        randomSeed: seed + 1,
        startedAtSeconds: 0.1,
        elapsedSeconds: 1.1,
        completedAtSeconds: 1.2,
        populationBefore: modeScore,
        candidatePopulation: modeScore,
        acceptedPopulation: modeScore,
        improvement: 0,
        lnsStopReason: "iteration-limit"
      },
      {
        stage: "lns",
        stageIndex: 3,
        cycleIndex: 2,
        randomSeed: seed + 2,
        startedAtSeconds: 1.2,
        elapsedSeconds: 0.4,
        completedAtSeconds: 1.6,
        populationBefore: modeScore,
        candidatePopulation: modeScore,
        acceptedPopulation: modeScore,
        improvement: 0,
        lnsStopReason: "iteration-limit"
      },
      {
        stage: "cp-sat",
        stageIndex: 4,
        cycleIndex: 2,
        randomSeed: seed + 3,
        startedAtSeconds: 1.6,
        elapsedSeconds: 0.2,
        completedAtSeconds: 1.8,
        populationBefore: modeScore,
        candidatePopulation: modeScore,
        acceptedPopulation: modeScore,
        improvement: 1,
        cpSatStatus: "FEASIBLE"
      },
      {
        stage: "cp-sat",
        stageIndex: 5,
        cycleIndex: 3,
        randomSeed: seed + 4,
        startedAtSeconds: 1.8,
        elapsedSeconds: 0.5,
        completedAtSeconds: 2.3,
        populationBefore: modeScore,
        candidatePopulation: modeScore,
        acceptedPopulation: modeScore,
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
      totalPopulation: modeScore,
      elapsedSeconds: 0.1,
      phases: [
        {
          name: "constructiveCapSearch",
          runs: 1,
          elapsedMs: 4,
          bestPopulationBefore: 0,
          bestPopulationAfter: modeScore,
          bestPopulationDelta: modeScore,
          candidatePopulationBefore: 0,
          candidatePopulationAfter: modeScore,
          candidatePopulationDelta: modeScore,
          improvements: 1
        }
      ]
    }
  };
}

function attachMockPortfolioTelemetry(solution, modeScore, seed) {
  solution.cpSatTelemetry = {
    solveWallTimeSeconds: 1,
    userTimeSeconds: 1,
    solutionCount: 1,
    incumbentObjectiveValue: modeScore,
    bestObjectiveBound: modeScore + 2,
    objectiveGap: 2,
    incumbentPopulation: modeScore,
    bestPopulationUpperBound: modeScore + 2,
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
        randomSeed: seed,
        randomizeSearch: true,
        numWorkers: 1,
        status: "UNKNOWN",
        feasible: false,
        totalPopulation: null
      },
      {
        workerIndex: 1,
        randomSeed: seed + 101,
        randomizeSearch: true,
        numWorkers: 1,
        status: "FEASIBLE",
        feasible: true,
        totalPopulation: modeScore
      }
    ]
  };
}

function attachMockGreedyProfile(solution, modeScore) {
  const counters = createGreedyProfileCounters();
  counters.attempts.serviceMasterCandidatesConsidered = 8;
  counters.attempts.serviceMasterCandidatesShortlisted = 4;
  counters.attempts.serviceMasterLayouts = 6;
  counters.attempts.serviceMasterFeasibleLayouts = 5;
  counters.attempts.serviceMasterImprovingLayouts = 1;
  counters.attempts.serviceMasterNoGoodSkips = 2;
  solution.greedyProfile = {
    counters,
    phases: [
      {
        name: "serviceMasterDecomposition",
        runs: 1,
        elapsedMs: 12,
        bestPopulationBefore: modeScore - 1,
        bestPopulationAfter: modeScore,
        bestPopulationDelta: 1,
        candidatePopulationBefore: modeScore - 1,
        candidatePopulationAfter: modeScore,
        candidatePopulationDelta: 1,
        improvements: 1
      }
    ]
  };
}

function buildCrossModeMockSolve() {
  return async (_grid, params, context) => {
    const seedBonus = context.seed === 11 ? 1 : 0;
    const modeScores = {
      auto: 10 + seedBonus,
      greedy: 12 + seedBonus,
      lns: 8 + seedBonus,
      "cp-sat-portfolio": 10 + seedBonus
    };
    const modeScore = modeScores[context.mode];
    const solution = buildMockSolution({
      optimizer: params.optimizer,
      totalPopulation: modeScore,
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
      solution.autoStage = buildMockAutoStage(modeScore, context.seed);
      solution.lnsTelemetry = buildNeutralLnsTelemetry(modeScore, {
        seedSource: "hint",
        seedTimeLimitSeconds: 0.2,
        wallClockLimitSeconds: 1.1,
        elapsedSeconds: 0.3
      });
    }
    if (context.mode === "greedy") {
      attachMockGreedyProfile(solution, modeScore);
    }
    if (context.mode === "lns") {
      solution.lnsTelemetry = buildNeutralLnsTelemetry(modeScore);
    }
    if (context.mode === "cp-sat-portfolio") {
      attachMockPortfolioTelemetry(solution, modeScore, context.seed);
    }

    return solution;
  };
}

module.exports = { buildCrossModeMockSolve };
