import type {
  GreedyOptions,
  Grid,
  LnsOptions,
  SolverParams,
} from "../core/types.js";
import type {
  LnsBenchmarkCase,
  LnsReplayPressureFamily,
} from "./lns.js";

const GENERATED_LNS_PRESSURE_OPTIONS: Readonly<Required<
  Pick<
    LnsOptions,
    "iterations" | "maxNoImprovementIterations" | "neighborhoodRows" | "neighborhoodCols" | "repairTimeLimitSeconds"
  >
>> = Object.freeze({
  iterations: 2,
  maxNoImprovementIterations: 4,
  neighborhoodRows: 3,
  neighborhoodCols: 3,
  repairTimeLimitSeconds: 0.5,
});

interface GeneratedLnsPressureCaseInput {
  name: string;
  description: string;
  pressureFamily: LnsReplayPressureFamily;
  grid: Grid;
  serviceTypes: NonNullable<SolverParams["serviceTypes"]>;
  residentialTypes: NonNullable<SolverParams["residentialTypes"]>;
  availableBuildings: NonNullable<SolverParams["availableBuildings"]>;
  randomSeed: number;
  serviceRefineCandidateLimit?: number;
}

function buildGeneratedPressureGreedyOptions(
  randomSeed: number,
  serviceRefineCandidateLimit = 8
): GreedyOptions {
  return {
    localSearch: true,
    randomSeed,
    restarts: 2,
    serviceRefineIterations: 1,
    serviceRefineCandidateLimit,
    exhaustiveServiceSearch: false,
    serviceExactPoolLimit: 8,
    serviceExactMaxCombinations: 64,
  };
}

function buildGeneratedLnsPressureCase(input: GeneratedLnsPressureCaseInput): LnsBenchmarkCase {
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
      greedy: buildGeneratedPressureGreedyOptions(input.randomSeed, input.serviceRefineCandidateLimit),
    },
  };
}

export const GENERATED_LNS_PRESSURE_CASES: readonly LnsBenchmarkCase[] = Object.freeze([
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
      [1, 1, 1, 1, 1, 1, 1],
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 60, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 180, avail: 2 },
      { w: 2, h: 3, min: 140, max: 300, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 41,
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
      [1, 1, 1, 1, 1, 1],
    ],
    serviceTypes: [{ rows: 1, cols: 1, bonus: 70, range: 2, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 90, max: 190, avail: 2 },
      { w: 3, h: 2, min: 150, max: 330, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 43,
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
      [1, 1, 1, 1, 1, 1],
    ],
    serviceTypes: [{ rows: 1, cols: 2, bonus: 50, range: 1, avail: 1 }],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 170, avail: 2 },
      { w: 3, h: 2, min: 170, max: 340, avail: 1 },
    ],
    availableBuildings: { services: 1, residentials: 3 },
    randomSeed: 47,
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
      [1, 1, 1, 1, 1, 1],
    ],
    serviceTypes: [
      { rows: 1, cols: 1, bonus: 50, range: 1, avail: 1 },
      { rows: 2, cols: 1, bonus: 90, range: 2, avail: 1 },
    ],
    residentialTypes: [
      { w: 2, h: 2, min: 80, max: 220, avail: 2 },
      { w: 2, h: 3, min: 160, max: 360, avail: 1 },
    ],
    availableBuildings: { services: 2, residentials: 3 },
    randomSeed: 53,
    serviceRefineCandidateLimit: 10,
  }),
]);
