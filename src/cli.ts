/**
 * Example CLI runner for local experimentation.
 */

import type { Grid, OptimizerName } from "./types.js";
import { normalizeServicePlacement } from "./buildings.js";
import { formatSolutionMap, solveAsync, validateSolutionMap } from "./index.js";

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
    restarts: 20,
    serviceRefineIterations: 4,
    serviceRefineCandidateLimit: 60,
    exhaustiveServiceSearch: true,
    serviceExactPoolLimit: 22,
    serviceExactMaxCombinations: 12000,
  },
};

function readCliOptimizer(): OptimizerName {
  const value = process.argv[2]?.trim();
  if (value === "cp-sat") return "cp-sat";
  if (value === "lns") return "lns";
  return "greedy";
}

async function runExample(): Promise<void> {
  const optimizer = readCliOptimizer();
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

  const params = { ...DEFAULT_PARAMS, optimizer };
  const solution = await solveAsync(
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
