import { hasExplicitEmptyRoadAnchors } from "../../core/index.js";

import type {
  BackgroundSolveHandle,
  BackgroundSolveSnapshotState,
  Grid,
  OptimizerName,
  Solution,
  SolverParams
} from "../../core/index.js";

export function shouldReturnNoRoadAnchorSolution(params: Pick<SolverParams, "fixedRoads">): boolean {
  return hasExplicitEmptyRoadAnchors(params);
}

export function buildNoRoadAnchorSolution(optimizer: OptimizerName): Solution {
  return {
    optimizer,
    ...(optimizer === "auto"
      ? {
          autoStage: {
            requestedOptimizer: "auto" as const,
            activeStage: null,
            stageIndex: 0,
            cycleIndex: 0,
            consecutiveWeakCycles: 0,
            lastCycleImprovementRatio: null,
            stopReason: "completed-plan" as const,
            generatedSeeds: []
          }
        }
      : {}),
    roads: new Set<string>(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0
  };
}

export function startNoRoadAnchorSolve(_grid: Grid, optimizer: OptimizerName): BackgroundSolveHandle {
  const solution = buildNoRoadAnchorSolution(optimizer);
  const snapshotState: BackgroundSolveSnapshotState = {
    hasFeasibleSolution: true,
    totalPopulation: 0,
    ...(optimizer === "auto" ? { activeOptimizer: null, autoStage: solution.autoStage ?? null } : {}),
    cpSatStatus: null,
    bestPopulationUpperBound: null,
    populationGapUpperBound: null,
    solveWallTimeSeconds: null,
    lastImprovementAtSeconds: null,
    secondsSinceLastImprovement: null
  };
  return {
    promise: Promise.resolve(solution),
    cancel: () => undefined,
    getLatestSnapshot: () => solution,
    getLatestSnapshotState: () => snapshotState
  };
}
