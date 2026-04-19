/**
 * Example CLI runner for local experimentation.
 */

import type { Grid, OptimizerName } from "../core/types.js";
import { normalizeServicePlacement } from "../core/buildings.js";
import { formatSolutionMap, validateSolutionMap } from "../core/index.js";
import { solveAsync } from "../runtime/solve.js";
import { describeAutoStopReason, startAutoSolve } from "../auto/index.js";

const DEFAULT_PARAMS = {
  serviceTypes: [
    { rows: 2, cols: 2, bonus: 108, range: 4, avail: 1 },
    { rows: 2, cols: 3, bonus: 204, range: 5, avail: 1 },
    { rows: 3, cols: 3, bonus: 189, range: 3, avail: 1 },
    { rows: 2, cols: 4, bonus: 48, range: 2, avail: 1 },
    { rows: 2, cols: 2, bonus: 45, range: 1, avail: 1 },
    { rows: 2, cols: 3, bonus: 50, range: 2, avail: 1 },
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
    { w: 2, h: 2, min: 300, max: 900, avail: 2 },
  ],
  greedy: {
    localSearch: true,
    randomSeed: undefined,
    restarts: 20,
    serviceRefineIterations: 4,
    serviceRefineCandidateLimit: 60,
    exhaustiveServiceSearch: true,
    serviceExactPoolLimit: 22,
    serviceExactMaxCombinations: 12000,
  },
};

const AUTO_GREEDY_PARAMS = {
  localSearch: true,
  restarts: 4,
  serviceRefineIterations: 1,
  serviceRefineCandidateLimit: 24,
  exhaustiveServiceSearch: false,
  serviceExactPoolLimit: 8,
  serviceExactMaxCombinations: 512,
};

function readCliArgs(): string[] {
  return process.argv.slice(2);
}

function readCliOptimizer(): OptimizerName {
  const value = readCliArgs().find((arg) => {
    const trimmed = arg.trim();
    return trimmed === "auto" || trimmed === "greedy" || trimmed === "lns" || trimmed === "cp-sat";
  });
  if (value === "auto") return "auto";
  if (value === "cp-sat") return "cp-sat";
  if (value === "lns") return "lns";
  return "auto";
}

function readCliGreedyRandomSeed(): number | undefined {
  const args = readCliArgs();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index].trim();
    if (arg.startsWith("--greedy-seed=")) {
      const value = Number.parseInt(arg.slice("--greedy-seed=".length), 10);
      return Number.isInteger(value) ? value : undefined;
    }
    if (arg === "--greedy-seed") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      return Number.isInteger(value) ? value : undefined;
    }
  }
  return undefined;
}

export async function runExample(): Promise<void> {
  const optimizer = readCliOptimizer();
  const greedyRandomSeed = readCliGreedyRandomSeed();
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
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  ];

  const params = {
    ...DEFAULT_PARAMS,
    optimizer,
    greedy: {
      ...(optimizer === "auto" ? AUTO_GREEDY_PARAMS : DEFAULT_PARAMS.greedy),
      ...(greedyRandomSeed !== undefined ? { randomSeed: greedyRandomSeed } : {}),
    },
  };
  const solution = optimizer === "auto"
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
          if (autoStage.stageIndex === lastStageIndex && autoStage.cycleIndex === lastCycleIndex && activeStage === lastStage) {
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
    : await solveAsync(
        grid,
        params,
        optimizer === "cp-sat"
          ? {
              onProgress: (update) => {
                if (update.kind === "portfolio-worker-complete" && update.worker) {
                  console.log(
                    "[CP-SAT progress]",
                    `worker=${update.worker.workerIndex}`,
                    `status=${update.worker.status}`,
                    `population=${update.worker.totalPopulation ?? "n/a"}`
                  );
                  return;
                }
                if (!update.telemetry) {
                  return;
                }
                console.log(
                  "[CP-SAT progress]",
                  `kind=${update.kind}`,
                  `wall=${update.telemetry.solveWallTimeSeconds.toFixed(3)}s`,
                  `pop=${update.telemetry.incumbentPopulation ?? "n/a"}`,
                  `bound=${update.telemetry.bestPopulationUpperBound ?? "n/a"}`,
                  `gap=${update.telemetry.populationGapUpperBound ?? "n/a"}`
                );
              },
            }
          : undefined
      );
  const validation = validateSolutionMap({ grid, solution, params });

  console.log("=== City Builder Solution ===\n");
  console.log("Optimizer:", solution.optimizer ?? optimizer);
  if (solution.activeOptimizer) console.log("Active stage:", solution.activeOptimizer);
  if (solution.autoStage?.generatedSeeds.length) {
    console.log(
      "Auto seeds:",
      solution.autoStage.generatedSeeds.map((seed) => `${seed.stage}@${seed.stageIndex}:${seed.randomSeed}`).join(", ")
    );
  }
  if (solution.autoStage?.stopReason) {
    console.log("Auto stop reason:", describeAutoStopReason(solution.autoStage.stopReason) ?? solution.autoStage.stopReason);
  }
  if (params.greedy.randomSeed !== undefined) console.log("Greedy random seed:", params.greedy.randomSeed);
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
    console.log(`  (r=${service.r}, c=${service.c}) ${service.rows}×${service.cols}  +${increase}  range=${service.range}`);
  }
  console.log("\nResidential placements:");
  for (let i = 0; i < solution.residentials.length; i++) {
    const residential = solution.residentials[i];
    console.log(`  (r=${residential.r}, c=${residential.c}) ${residential.rows}×${residential.cols}  pop=${solution.populations[i]}`);
  }
  console.log("\nValidation:", validation.valid ? "PASS" : "FAIL");
  if (!validation.valid) {
    for (const error of validation.errors) console.log(`  - ${error}`);
    process.exitCode = 1;
  }
  console.log("\n=== Map ===");
  console.log(formatSolutionMap(grid, solution));
}

void runExample().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
