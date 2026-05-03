/**
 * Example CLI runner for local experimentation.
 *
 * Product framing: `auto` is the recommended quality path and owns the capped
 * fast Greedy seed stage; standalone `greedy` is the heavy heuristic /
 * advanced inspection mode.
 */

import type { Grid, OptimizerName, SolverParams } from "../packages/core/index.js";
import { formatSolutionMap, normalizeServicePlacement, validateSolutionMap } from "../packages/core/index.js";
import { solveAsync, startAutoSolve, startCpSatSolve } from "../packages/runtime/index.js";
import { describeAutoStopReason } from "../packages/solvers/index.js";
import { runCliMain } from "./cliEntrypoint.js";
import { parseExampleCliArgs } from "./exampleCliArgs.js";

const DEFAULT_PARAMS = {
  serviceTypes: [
    { rows: 2, cols: 2, bonus: 108, range: 4, avail: 1 },
    { rows: 2, cols: 3, bonus: 204, range: 5, avail: 1 },
    { rows: 3, cols: 3, bonus: 189, range: 3, avail: 1 },
    { rows: 2, cols: 4, bonus: 48, range: 2, avail: 1 },
    { rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 },
    { rows: 2, cols: 3, bonus: 50, range: 2, avail: 1 }
  ],
  residentialTypes: [
    { w: 2, h: 2, min: 140, max: 420, avail: 1 },
    { w: 2, h: 2, min: 150, max: 450, avail: 3 },
    { w: 2, h: 2, min: 150, max: 450, avail: 1 },
    { w: 2, h: 2, min: 160, max: 480, avail: 2 },
    { w: 2, h: 3, min: 260, max: 780, avail: 2 },
    { w: 2, h: 3, min: 240, max: 720, avail: 3 },
    { w: 2, h: 3, min: 250, max: 750, avail: 3 },
    { w: 2, h: 2, min: 280, max: 840, avail: 2 },
    { w: 2, h: 2, min: 300, max: 900, avail: 2 }
  ],
  // Standalone Greedy mirrors the heavy UI profile. Auto uses AUTO_GREEDY_PARAMS
  // below when it only needs a capped fast seed stage.
  greedy: {
    localSearch: true,
    randomSeed: undefined,
    restarts: 20,
    serviceRefineIterations: 4,
    serviceRefineCandidateLimit: 60,
    exhaustiveServiceSearch: true,
    serviceExactPoolLimit: 22,
    serviceExactMaxCombinations: 12000
  }
};

const AUTO_GREEDY_PARAMS = {
  localSearch: true,
  restarts: 4,
  serviceRefineIterations: 1,
  serviceRefineCandidateLimit: 24,
  exhaustiveServiceSearch: false,
  serviceExactPoolLimit: 8,
  serviceExactMaxCombinations: 512
};

function describeOptimizerRole(optimizer: OptimizerName): string {
  if (optimizer === "auto") {
    return "Recommended quality path. A capped fast Greedy seed starts the run, then LNS and bounded CP-SAT continue improving the incumbent.";
  }
  if (optimizer === "lns") {
    return "Manual improvement mode. Starts from a greedy seed, then repairs neighborhoods with CP-SAT.";
  }
  if (optimizer === "cp-sat") {
    return "Bounded polish mode. Usually strongest after a seed already exists.";
  }
  return "Heavy standalone heuristic / advanced inspection mode. Best for Greedy-only quality checks and heuristic tuning.";
}

export async function runExample(): Promise<void> {
  const { optimizer, greedyRandomSeed, cpSatOptions } = parseExampleCliArgs();
  const grid: Grid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]
  ];

  const params: SolverParams = {
    ...DEFAULT_PARAMS,
    optimizer,
    greedy: {
      ...(optimizer === "auto" ? AUTO_GREEDY_PARAMS : DEFAULT_PARAMS.greedy),
      ...(greedyRandomSeed !== undefined ? { randomSeed: greedyRandomSeed } : {})
    },
    ...(cpSatOptions ? { cpSat: cpSatOptions } : {})
  };
  const solution =
    optimizer === "auto"
      ? await (async () => {
          const handle = startAutoSolve(grid, params);
          let lastStage = "";
          let lastStageIndex = -1;
          let lastCycleIndex = -1;
          const progressTicker = setInterval(() => {
            const snapshot = handle.getLatestSnapshot();
            const autoStage = snapshot?.autoStage;
            const activeStage = snapshot?.activeOptimizer;
            if (!snapshot || !autoStage || !activeStage) return;
            if (
              autoStage.stageIndex === lastStageIndex &&
              autoStage.cycleIndex === lastCycleIndex &&
              activeStage === lastStage
            ) {
              return;
            }
            lastStage = activeStage;
            lastStageIndex = autoStage.stageIndex;
            lastCycleIndex = autoStage.cycleIndex;
            const cycleLabel = autoStage.cycleIndex > 0 ? `cycle=${autoStage.cycleIndex}` : "initial";
            const generatedSeed = autoStage.generatedSeeds[autoStage.generatedSeeds.length - 1]?.randomSeed;
            console.log(
              "[AUTO progress]",
              `stage=${autoStage.stageIndex}`,
              cycleLabel,
              `optimizer=${activeStage}`,
              `seed=${generatedSeed ?? "n/a"}`,
              `best=${snapshot.totalPopulation}`
            );
          }, 500);
          progressTicker.unref?.();
          try {
            return await handle.promise;
          } finally {
            clearInterval(progressTicker);
          }
        })()
      : optimizer === "cp-sat"
        ? await runCpSatExampleSolve(grid, params)
        : await solveAsync(grid, params);
  const validation = validateSolutionMap({ grid, solution, params });

  console.log("=== City Builder Solution ===\n");
  console.log("Optimizer:", solution.optimizer ?? optimizer);
  console.log("Optimizer role:", describeOptimizerRole(solution.optimizer ?? optimizer));
  if (solution.activeOptimizer) console.log("Active stage:", solution.activeOptimizer);
  if (solution.autoStage?.generatedSeeds.length) {
    console.log(
      "Auto seeds:",
      solution.autoStage.generatedSeeds.map((seed) => `${seed.stage}@${seed.stageIndex}:${seed.randomSeed}`).join(", ")
    );
  }
  if (solution.autoStage?.stopReason) {
    console.log(
      "Auto stop reason:",
      describeAutoStopReason(solution.autoStage.stopReason) ?? solution.autoStage.stopReason
    );
  }
  if (params.greedy?.randomSeed !== undefined) console.log("Greedy random seed:", params.greedy.randomSeed);
  if (params.cpSat) {
    console.log(
      "CP-SAT limits:",
      `time=${params.cpSat.timeLimitSeconds ?? "none"}s,`,
      `noImprovement=${params.cpSat.noImprovementTimeoutSeconds ?? "none"}s,`,
      `workers=${params.cpSat.numWorkers ?? "default"}`
    );
  }
  if (solution.cpSatStatus) console.log("CP-SAT status:", solution.cpSatStatus);
  if (solution.cpSatObjectivePolicy) console.log("CP-SAT objective:", solution.cpSatObjectivePolicy.summary);
  if (solution.cpSatTelemetry) {
    console.log(
      "CP-SAT telemetry:",
      `wall=${solution.cpSatTelemetry.solveWallTimeSeconds.toFixed(3)}s,`,
      `bestBound=${solution.cpSatTelemetry.bestPopulationUpperBound},`,
      `gap=${solution.cpSatTelemetry.populationGapUpperBound},`,
      `lastImprovementLag=${solution.cpSatTelemetry.secondsSinceLastImprovement?.toFixed(3)}s`
    );
  }
  if (solution.cpSatPortfolio) {
    console.log(
      "CP-SAT portfolio:",
      `workers=${solution.cpSatPortfolio.workerCount},`,
      `selected=${solution.cpSatPortfolio.selectedWorkerIndex}`
    );
  }
  console.log("Total population:", solution.totalPopulation);
  console.log("Roads:", solution.roads.size, "cells");
  console.log("Services:", solution.services.length);
  console.log("Residentials:", solution.residentials.length);
  console.log("\nService placements [population increase, range]:");
  for (let i = 0; i < solution.services.length; i++) {
    const service = normalizeServicePlacement(solution.services[i]);
    const increase = solution.servicePopulationIncreases[i];
    console.log(
      `  (r=${service.r}, c=${service.c}) ${service.rows}×${service.cols}  +${increase}  range=${service.range}`
    );
  }
  console.log("\nResidential placements:");
  for (let i = 0; i < solution.residentials.length; i++) {
    const residential = solution.residentials[i];
    console.log(
      `  (r=${residential.r}, c=${residential.c}) ${residential.rows}×${residential.cols}  pop=${solution.populations[i]}`
    );
  }
  console.log("\nValidation:", validation.valid ? "PASS" : "FAIL");
  if (!validation.valid) {
    for (const error of validation.errors) console.log(`  - ${error}`);
    process.exitCode = 1;
  }
  console.log("\n=== Map ===");
  console.log(formatSolutionMap(grid, solution));
}

async function runCpSatExampleSolve(grid: Grid, params: SolverParams) {
  const handle = startCpSatSolve(grid, params);
  let stopRequested = false;
  let lastPopulation: number | null = null;
  let lastStatus: string | null = null;

  const requestStop = () => {
    if (stopRequested) return;
    stopRequested = true;
    console.log("\nStopping CP-SAT after current feasible snapshot...");
    handle.cancel();
  };

  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  const progressTicker = setInterval(() => {
    const snapshot = handle.getLatestSnapshot();
    if (!snapshot) return;
    const status = snapshot.cpSatStatus ?? null;
    const population = snapshot.totalPopulation;
    if (status === lastStatus && population === lastPopulation) return;
    lastStatus = status;
    lastPopulation = population;
    console.log("[CP-SAT progress]", `status=${status ?? "snapshot"}`, `best=${population}`);
  }, 1000);
  progressTicker.unref?.();

  try {
    return await handle.promise;
  } finally {
    clearInterval(progressTicker);
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
  }
}

runCliMain(runExample);
