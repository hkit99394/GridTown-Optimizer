import type { CrossModeBenchmarkCase } from "./crossMode.js";

export const DEFAULT_CROSS_MODE_BENCHMARK_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  {
    name: "typed-housing-single",
    description: "Tiny typed-housing case shared by all solver modes.",
    problemSizeBand: "tiny",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      residentialTypes: [
        { w: 2, h: 2, min: 10, max: 10, avail: 1 },
        { w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 2, services: 0 },
      greedy: {
        localSearch: false,
        restarts: 1,
        serviceRefineIterations: 0,
        serviceRefineCandidateLimit: 4,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 4,
        serviceExactMaxCombinations: 16,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
  {
    name: "compact-service-single",
    description: "Small service-and-housing case for equal-budget mode comparisons.",
    problemSizeBand: "small",
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
      availableBuildings: { services: 1, residentials: 1 },
      greedy: {
        localSearch: true,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 8,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 32,
      },
      lns: {
        iterations: 1,
        maxNoImprovementIterations: 1,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
  {
    name: "compact-service-repair",
    description: "Small 6x6 mixed case for LNS and Auto repair scorecards.",
    problemSizeBand: "small",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ],
    params: {
      serviceTypes: [{ rows: 2, cols: 2, bonus: 80, range: 2, avail: 1 }],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 180, avail: 2 },
        { w: 2, h: 3, min: 130, max: 260, avail: 1 },
      ],
      availableBuildings: { services: 1, residentials: 3 },
      greedy: {
        localSearch: true,
        restarts: 2,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 10,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 64,
      },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 2,
        neighborhoodRows: 3,
        neighborhoodCols: 3,
        repairTimeLimitSeconds: 1,
      },
    },
  },
  {
    name: "row0-corridor-repair-pressure",
    description: "Sparse road-anchor access case with competing service footprints for Auto/LNS budget ablations.",
    problemSizeBand: "small",
    grid: [
      [1, 0, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 0],
      [1, 1, 1, 0, 1, 1],
      [0, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 2, bonus: 55, range: 1, avail: 1 },
        { rows: 2, cols: 2, bonus: 120, range: 2, avail: 1 },
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 80, max: 220, avail: 2 },
        { w: 2, h: 3, min: 140, max: 360, avail: 1 },
      ],
      availableBuildings: { services: 2, residentials: 3 },
      greedy: {
        localSearch: true,
        restarts: 3,
        serviceRefineIterations: 1,
        serviceRefineCandidateLimit: 12,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 8,
        serviceExactMaxCombinations: 80,
      },
      lns: {
        iterations: 2,
        maxNoImprovementIterations: 2,
        neighborhoodRows: 3,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 1,
      },
    },
  },
]);

