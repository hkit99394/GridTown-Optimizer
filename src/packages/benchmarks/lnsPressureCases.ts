import type { GreedyOptions, Grid, LnsOptions, SolverParams } from "../core/index.js";

type GeneratedLnsReplayPressureFamily =
  | "anchor-service"
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-pressure";

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
      lns: { ...GENERATED_LNS_PRESSURE_OPTIONS },
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
