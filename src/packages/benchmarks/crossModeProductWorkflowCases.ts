import type { CrossModeBenchmarkCase } from "./crossModeTypes.js";

export const PRODUCT_WORKFLOW_DEVELOPMENT_EXTENSION_CASES: readonly CrossModeBenchmarkCase[] = Object.freeze([
  {
    name: "development-expansion-corridor-service",
    description:
      "Development corridor/expansion planning case with service pockets, fragmented access, and competing residential growth.",
    problemSizeBand: "small",
    split: "development",
    workflowTags: ["expansion-comparison", "corridor"],
    grid: [
      [1, 1, 1, 0, 1, 1, 0],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [0, 1, 1, 1, 1, 0, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 85, range: 2, avail: 1 },
        { rows: 2, cols: 1, bonus: 105, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 85, max: 200, avail: 3 },
        { w: 2, h: 3, min: 145, max: 320, avail: 1 },
        { w: 1, h: 2, min: 45, max: 105, avail: 3 }
      ],
      availableBuildings: { services: 2, residentials: 5 },
      greedy: {
        localSearch: true,
        randomSeed: 101,
        restarts: 4,
        serviceRefineIterations: 2,
        serviceRefineCandidateLimit: 14,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 12,
        serviceExactMaxCombinations: 384
      },
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 4,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 0.75
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1
      }
    }
  }
]);

export const PRODUCT_WORKFLOW_FRESH_HOLDOUT_CASES: readonly CrossModeBenchmarkCase[] = Object.freeze([
  {
    name: "fresh-multi-anchor-service-island",
    description:
      "Fresh product holdout with multiple road anchors, service reach islands, and road budget pressure for exact geometry and road semantics.",
    problemSizeBand: "small",
    split: "holdout",
    workflowTags: ["multi-anchor", "service-pressure", "gate"],
    grid: [
      [1, 1, 1, 0, 0, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [0, 1, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 45, range: 1, avail: 2 },
        { rows: 2, cols: 1, bonus: 95, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 1, h: 2, min: 70, max: 130, avail: 4 },
        { w: 2, h: 2, min: 140, max: 260, avail: 3 }
      ],
      availableBuildings: { services: 2, residentials: 5 },
      greedy: {
        localSearch: true,
        randomSeed: 83,
        restarts: 3,
        serviceRefineIterations: 2,
        serviceRefineCandidateLimit: 12,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 10,
        serviceExactMaxCombinations: 256
      },
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 4,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 0.75
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1
      }
    }
  },
  {
    name: "fresh-typed-footprint-scarcity",
    description:
      "Fresh product holdout with scarce large residential footprints, mixed service reach, and capacity-headroom pressure.",
    problemSizeBand: "small",
    split: "holdout",
    workflowTags: ["footprint-pressure", "service-pressure"],
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 35, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 80, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 100, max: 220, avail: 2 },
        { w: 3, h: 2, min: 220, max: 420, avail: 1 },
        { w: 1, h: 2, min: 55, max: 110, avail: 3 }
      ],
      availableBuildings: { services: 2, residentials: 4 },
      greedy: {
        localSearch: true,
        randomSeed: 89,
        restarts: 4,
        serviceRefineIterations: 2,
        serviceRefineCandidateLimit: 14,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 12,
        serviceExactMaxCombinations: 384
      },
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 4,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 0.75
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1
      }
    }
  },
  {
    name: "fresh-expansion-corridor-service",
    description:
      "Fresh product holdout for expansion planning on a corridor-constrained service layout with competing residential pockets.",
    problemSizeBand: "small",
    split: "holdout",
    workflowTags: ["expansion-comparison", "corridor"],
    grid: [
      [1, 1, 0, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 0, 1, 1],
      [0, 1, 1, 1, 1, 0, 1, 0],
      [0, 0, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1, 1]
    ],
    params: {
      serviceTypes: [
        { rows: 1, cols: 1, bonus: 45, range: 1, avail: 1 },
        { rows: 1, cols: 2, bonus: 90, range: 2, avail: 1 },
        { rows: 2, cols: 1, bonus: 120, range: 2, avail: 1 }
      ],
      residentialTypes: [
        { w: 2, h: 2, min: 90, max: 220, avail: 3 },
        { w: 2, h: 3, min: 150, max: 340, avail: 1 },
        { w: 1, h: 2, min: 50, max: 110, avail: 4 }
      ],
      availableBuildings: { services: 2, residentials: 5 },
      greedy: {
        localSearch: true,
        randomSeed: 97,
        restarts: 4,
        serviceRefineIterations: 2,
        serviceRefineCandidateLimit: 14,
        exhaustiveServiceSearch: false,
        serviceExactPoolLimit: 12,
        serviceExactMaxCombinations: 384
      },
      lns: {
        iterations: 4,
        maxNoImprovementIterations: 3,
        neighborhoodRows: 4,
        neighborhoodCols: 4,
        repairTimeLimitSeconds: 0.75
      },
      cpSat: {
        timeLimitSeconds: 1,
        maxDeterministicTime: 1
      }
    }
  }
]);
