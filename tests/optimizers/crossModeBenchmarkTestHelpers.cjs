function buildCrossModeBenchmarkCase() {
  return {
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
}

function buildCpSatTelemetry(population, userTimeSeconds = 1) {
  return {
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
  };
}

module.exports = { buildCpSatTelemetry, buildCrossModeBenchmarkCase };
