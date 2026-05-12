import type { GreedyOptions, Grid, LnsOptions, SolverParams } from "../core/index.js";

type GeneratedLnsReplayPressureFamily =
  | "anchor-service"
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-pressure"
  | "product-expansion"
  | "product-footprint"
  | "product-service"
  | "product-warm-start";

interface GeneratedLnsBenchmarkCase {
  name: string;
  description: string;
  pressureFamily: GeneratedLnsReplayPressureFamily;
  grid: Grid;
  params: SolverParams;
}

const GENERATED_LNS_PRESSURE_OPTIONS: Readonly<
  Required<
    Pick<
      LnsOptions,
      "iterations" | "maxNoImprovementIterations" | "neighborhoodRows" | "neighborhoodCols" | "repairTimeLimitSeconds"
    >
  >
> = Object.freeze({
  iterations: 2,
  maxNoImprovementIterations: 4,
  neighborhoodRows: 3,
  neighborhoodCols: 3,
  repairTimeLimitSeconds: 0.5
});

interface GeneratedLnsPressureCaseInput {
  name: string;
  description: string;
  pressureFamily: GeneratedLnsReplayPressureFamily;
  grid: Grid;
  serviceTypes: NonNullable<SolverParams["serviceTypes"]>;
  residentialTypes: NonNullable<SolverParams["residentialTypes"]>;
  availableBuildings: NonNullable<SolverParams["availableBuildings"]>;
  randomSeed: number;
  serviceRefineCandidateLimit?: number;
  lns?: Partial<LnsOptions>;
}

function buildGeneratedPressureGreedyOptions(randomSeed: number, serviceRefineCandidateLimit = 8): GreedyOptions {
  return {
    localSearch: true,
    randomSeed,
    restarts: 2,
    serviceRefineIterations: 1,
    serviceRefineCandidateLimit,
    exhaustiveServiceSearch: false,
    serviceExactPoolLimit: 8,
    serviceExactMaxCombinations: 64
  };
}

function buildGeneratedLnsPressureCase(input: GeneratedLnsPressureCaseInput): GeneratedLnsBenchmarkCase {
  return {
    name: input.name,
    description: input.description,
    pressureFamily: input.pressureFamily,
    grid: input.grid,
    params: {
      optimizer: "lns",
      serviceTypes: input.serviceTypes,
      residentialTypes: input.residentialTypes,
      availableBuildings: input.availableBuildings,
      lns: { ...GENERATED_LNS_PRESSURE_OPTIONS, ...(input.lns ?? {}) },
      greedy: buildGeneratedPressureGreedyOptions(input.randomSeed, input.serviceRefineCandidateLimit)
    }
  };
}

export const GENERATED_LNS_PRESSURE_CASES: readonly GeneratedLnsBenchmarkCase[] = Object.freeze([
  buildGeneratedLnsPressureCase({
    name: "lns-corridor-squeeze-pressure",
    description: "Generated corridor pressure case with narrow anchor access and mixed footprints.",
    pressureFamily: "corridor",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 60, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 180, avail: 2 },
      { w: 2, h: 3, min: 140, max: 300, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 41
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-gate-choke-pressure",
    description: "Generated gate pressure case where a central choke point separates high-value placements.",
    pressureFamily: "gate",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 70, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 190, avail: 2 },
      { w: 3, h: 2, min: 150, max: 330, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 43
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-footprint-mix-pressure",
    description: "Generated footprint-pressure case with competing 2x2 and 3x2 residential placements.",
    pressureFamily: "footprint-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 170, avail: 2 },
      { w: 3, h: 2, min: 170, max: 340, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 47
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-service-overlap-pressure",
    description: "Generated service-pressure case with overlapping service ranges and scarce premium housing.",
    pressureFamily: "service-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 50, range: 1, avail: 1 },
      { rows: 2, cols: 1, bonus: 90, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 220, avail: 2 },
      { w: 2, h: 3, min: 160, max: 360, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    randomSeed: 53,
    serviceRefineCandidateLimit: 10
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-anchor-service-corner-pressure",
    description:
      "Generated anchor-service holdout case where service relocation competes with anchor-side road pressure.",
    pressureFamily: "anchor-service",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 2, cols: 2, bonus: 105, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 260, avail: 2 },
      { w: 2, h: 3, min: 150, max: 360, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 59
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-gate-side-channel-pressure",
    description: "Generated gate holdout case with two asymmetric passages around a blocked center.",
    pressureFamily: "gate",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 0, 1, 1, 1],
      [1, 1, 1, 0, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 0, 1, 1, 1],
      [1, 1, 1, 0, 0, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 75, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 200, avail: 2 },
      { w: 2, h: 3, min: 160, max: 340, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 61
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-footprint-bottleneck-pressure",
    description: "Generated footprint holdout case where larger buildings fight for a narrow buildable pocket.",
    pressureFamily: "footprint-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 190, avail: 2 },
      { w: 3, h: 2, min: 180, max: 360, avail: 1 },
      { w: 2, h: 3, min: 170, max: 350, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 4 },
    randomSeed: 67
  })
]);

const PRODUCT_MANUAL_LAYOUT_REPLAY_HINT: NonNullable<LnsOptions["seedHint"]> = {
  sourceName: "manual-layout-replay",
  roadKeys: ["0,0", "0,1", "1,1", "2,1", "3,1"],
  solution: {
    roads: ["0,0", "0,1", "1,1", "2,1", "3,1"],
    services: [{ r: 1, c: 0, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 40 }],
    residentials: [
      { r: 1, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 },
      { r: 3, c: 2, rows: 2, cols: 2, typeIndex: 0, population: 80 }
    ],
    populations: [80, 80],
    totalPopulation: 160
  },
  totalPopulation: 160,
  objectiveLowerBound: 160
};

const PRODUCT_EXPANSION_COMPARISON_REPLAY_HINT: NonNullable<LnsOptions["seedHint"]> = {
  sourceName: "expansion-comparison-replay",
  roadKeys: ["0,0", "0,1", "0,2", "1,2", "2,2"],
  solution: {
    roads: ["0,0", "0,1", "0,2", "1,2", "2,2"],
    services: [{ r: 1, c: 3, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 35 }],
    residentials: [{ r: 2, c: 3, rows: 2, cols: 2, typeIndex: 0, population: 115 }],
    populations: [115],
    totalPopulation: 115
  },
  totalPopulation: 115,
  objectiveLowerBound: 115
};

const FRESH_PRODUCT_EXPANSION_REPLAY_HINT: NonNullable<LnsOptions["seedHint"]> = {
  sourceName: "fresh-expansion-replay",
  roadKeys: ["0,1", "1,1", "1,2", "2,2", "3,2"],
  solution: {
    roads: ["0,1", "1,1", "1,2", "2,2", "3,2"],
    services: [{ r: 1, c: 3, rows: 1, cols: 1, range: 1, typeIndex: 0, bonus: 40 }],
    residentials: [{ r: 3, c: 3, rows: 2, cols: 2, typeIndex: 0, population: 85 }],
    populations: [85],
    totalPopulation: 85
  },
  totalPopulation: 85,
  objectiveLowerBound: 85
};

export const GENERATED_LNS_PRODUCT_PROMOTION_PRESSURE_CASES: readonly GeneratedLnsBenchmarkCase[] = Object.freeze([
  buildGeneratedLnsPressureCase({
    name: "lns-product-typed-footprint-pressure",
    description: "Protected product-promotion footprint case based on typed housing pressure.",
    pressureFamily: "product-footprint",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 1, bonus: 40, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 35, max: 150, avail: 1 },
      { w: 2, h: 2, min: 35, max: 95, avail: 4 },
      { w: 2, h: 3, min: 80, max: 150, avail: 2 }
    ],
    availableBuildings: { services: 2, residentials: 4 },
    randomSeed: 37
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-product-service-local-pressure",
    description: "Protected product-promotion service-local case with disabled coarse service refinement.",
    pressureFamily: "product-service",
    grid: [
      [0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 35, range: 1, avail: 2 },
      { rows: 2, cols: 2, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 45, range: 1, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 60, max: 120, avail: 5 },
      { w: 2, h: 3, min: 90, max: 170, avail: 3 }
    ],
    availableBuildings: { services: 4, residentials: 6 },
    randomSeed: 13,
    serviceRefineCandidateLimit: 8
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-product-manual-layout-replay-pressure",
    description: "Protected product-promotion manual-layout replay with a saved incumbent seed.",
    pressureFamily: "product-warm-start",
    grid: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 80, max: 140, avail: 2 }],
    availableBuildings: { services: 1, residentials: 2 },
    randomSeed: 71,
    lns: {
      maxNoImprovementIterations: 2,
      seedHint: PRODUCT_MANUAL_LAYOUT_REPLAY_HINT
    }
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-product-expansion-comparison-replay-pressure",
    description: "Protected product-promotion expansion-comparison replay with a saved pre-expansion incumbent.",
    pressureFamily: "product-expansion",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 35, range: 1, avail: 1 },
      { rows: 2, cols: 1, bonus: 65, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 180, avail: 3 },
      { w: 2, h: 3, min: 140, max: 280, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 4 },
    randomSeed: 79,
    serviceRefineCandidateLimit: 8,
    lns: {
      maxNoImprovementIterations: 3,
      seedHint: PRODUCT_EXPANSION_COMPARISON_REPLAY_HINT
    }
  })
]);

export const GENERATED_LNS_FRESH_PRESSURE_HOLDOUT_CASES: readonly GeneratedLnsBenchmarkCase[] = Object.freeze([
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-product-expansion-side-pocket-pressure",
    description: "Fresh product-style expansion holdout with a shifted incumbent path and side-pocket services.",
    pressureFamily: "product-expansion",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 40, range: 1, avail: 1 },
      { rows: 2, cols: 1, bonus: 70, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 85, max: 190, avail: 3 },
      { w: 2, h: 3, min: 145, max: 300, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 4 },
    randomSeed: 113,
    serviceRefineCandidateLimit: 8,
    lns: {
      maxNoImprovementIterations: 3,
      seedHint: FRESH_PRODUCT_EXPANSION_REPLAY_HINT
    }
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-product-footprint-offset-pressure",
    description: "Fresh product-style footprint holdout with offset high-headroom residences.",
    pressureFamily: "product-footprint",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 60, range: 1, avail: 1 },
      { rows: 1, cols: 1, bonus: 45, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 40, max: 160, avail: 2 },
      { w: 2, h: 3, min: 95, max: 180, avail: 2 },
      { w: 3, h: 2, min: 110, max: 210, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 4 },
    randomSeed: 127
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-product-service-island-pressure",
    description: "Fresh product-style service holdout with sparse blockers and local service contention.",
    pressureFamily: "product-service",
    grid: [
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 1, 0, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 0],
      [1, 0, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 40, range: 1, avail: 2 },
      { rows: 2, cols: 1, bonus: 60, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 50, range: 1, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 65, max: 130, avail: 4 },
      { w: 2, h: 3, min: 95, max: 185, avail: 3 }
    ],
    availableBuildings: { services: 4, residentials: 6 },
    randomSeed: 131,
    serviceRefineCandidateLimit: 8
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-service-cross-pressure",
    description: "Fresh service-pressure holdout with crossed service ranges and premium scarcity.",
    pressureFamily: "service-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 0, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 100, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 95, max: 245, avail: 2 },
      { w: 2, h: 3, min: 185, max: 410, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    randomSeed: 137,
    serviceRefineCandidateLimit: 10
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-footprint-cascade-pressure",
    description: "Fresh footprint holdout with cascading blockers and competing wide residences.",
    pressureFamily: "footprint-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 1, 0],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 62, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 95, max: 225, avail: 2 },
      { w: 3, h: 2, min: 190, max: 390, avail: 1 },
      { w: 2, h: 3, min: 175, max: 365, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 4 },
    randomSeed: 139
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-fresh-anchor-service-inlet-pressure",
    description: "Fresh anchor-service holdout with inlet-shaped blockers around a movable large service.",
    pressureFamily: "anchor-service",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 2, cols: 2, bonus: 120, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 110, max: 290, avail: 2 },
      { w: 2, h: 3, min: 180, max: 420, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 149
  })
]);

export const GENERATED_LNS_PROTECTED_HOLDOUT_PRESSURE_CASES: readonly GeneratedLnsBenchmarkCase[] = Object.freeze([
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-corridor-weave-pressure",
    description: "Protected corridor holdout with alternating narrow passages and mixed footprints.",
    pressureFamily: "corridor",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 0, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 0, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 65, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 190, avail: 2 },
      { w: 2, h: 3, min: 150, max: 320, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 71
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-gate-offset-pressure",
    description: "Protected gate holdout with offset obstructions and asymmetric repair choices.",
    pressureFamily: "gate",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 0, 1, 0, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 80, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 210, avail: 2 },
      { w: 3, h: 2, min: 160, max: 350, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 73
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-footprint-stagger-pressure",
    description: "Protected footprint holdout where staggered blocks compete with larger residences.",
    pressureFamily: "footprint-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 55, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 200, avail: 2 },
      { w: 3, h: 2, min: 180, max: 370, avail: 1 },
      { w: 2, h: 3, min: 170, max: 350, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 4 },
    randomSeed: 79
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-service-ridge-pressure",
    description: "Protected service holdout with two service shapes fighting over a buildable ridge.",
    pressureFamily: "service-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 45, range: 1, avail: 1 },
      { rows: 2, cols: 1, bonus: 95, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 230, avail: 2 },
      { w: 2, h: 3, min: 170, max: 380, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    randomSeed: 83,
    serviceRefineCandidateLimit: 10
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-anchor-service-shelf-pressure",
    description: "Protected anchor-service holdout where service relocation competes with shelf access.",
    pressureFamily: "anchor-service",
    grid: [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 2, cols: 2, bonus: 110, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 270, avail: 2 },
      { w: 2, h: 3, min: 160, max: 380, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 89
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-corridor-switchback-pressure",
    description: "Protected corridor holdout with switchback access and separated buildable pockets.",
    pressureFamily: "corridor",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 0, 1],
      [1, 0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 70, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 95, max: 210, avail: 2 },
      { w: 2, h: 3, min: 160, max: 340, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 97
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-gate-double-choke-pressure",
    description: "Protected gate holdout with two staggered chokepoints and competing service approaches.",
    pressureFamily: "gate",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 0, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 85, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 100, max: 220, avail: 2 },
      { w: 3, h: 2, min: 170, max: 360, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 101
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-footprint-lattice-pressure",
    description: "Protected footprint holdout with lattice gaps that favor different residential orientations.",
    pressureFamily: "footprint-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 60, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 95, max: 220, avail: 2 },
      { w: 3, h: 2, min: 190, max: 380, avail: 1 },
      { w: 2, h: 3, min: 180, max: 370, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 4 },
    randomSeed: 103
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-service-braid-pressure",
    description: "Protected service holdout with braided service ranges and scarce high-value residences.",
    pressureFamily: "service-pressure",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1, 1]
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 55, range: 1, avail: 1 },
      { rows: 1, cols: 2, bonus: 95, range: 2, avail: 1 }
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 95, max: 240, avail: 2 },
      { w: 2, h: 3, min: 180, max: 400, avail: 1 }
    ],
    availableBuildings: { services: 2, residentials: 3 },
    randomSeed: 107,
    serviceRefineCandidateLimit: 10
  }),
  buildGeneratedLnsPressureCase({
    name: "lns-holdout-anchor-service-harbor-pressure",
    description: "Protected anchor-service holdout with harbor-shaped access and a movable large service.",
    pressureFamily: "anchor-service",
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ],
    serviceTypes: [{ rows: 2, cols: 2, bonus: 115, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 105, max: 280, avail: 2 },
      { w: 2, h: 3, min: 170, max: 400, avail: 1 }
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 109
  })
]);
