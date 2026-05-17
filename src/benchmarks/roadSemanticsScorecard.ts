import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { validateSolution } from "../core/evaluator.js";
import { solveCpSatAsync } from "../cp-sat/solver.js";
import {
  buildBenchmarkSuiteMetadata,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  listBenchmarkCaseNames,
  roundBenchmarkMetric,
  selectBenchmarkCasesByName,
} from "./benchmarkOptions.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";

import type {
  CpSatOptions,
  Grid,
  ResidentialPlacement,
  ServicePlacement,
  Solution,
  SolverParams,
} from "../core/types.js";

export type RoadSemanticsPressureFamily =
  | "row0-anchor"
  | "column0-anchor"
  | "multi-anchor"
  | "roadless-boundary"
  | "disconnected-non-anchor";

export interface RoadSemanticsSerializedSolution {
  roads: string[];
  services: ServicePlacement[];
  serviceTypeIndices: number[];
  servicePopulationIncreases: number[];
  residentials: ResidentialPlacement[];
  residentialTypeIndices: number[];
  populations: number[];
  totalPopulation: number;
}

export interface RoadSemanticsFixture {
  name: string;
  description: string;
  expectedValid: boolean;
  solution: RoadSemanticsSerializedSolution;
}

export interface RoadSemanticsCpSatExpectation {
  totalPopulation: number;
  roadCount?: number;
  roadComponentCount?: number;
  requiresRow0Road?: boolean;
  requiresColumn0Road?: boolean;
}

export interface RoadSemanticsScorecardCase {
  name: string;
  description: string;
  family: RoadSemanticsPressureFamily;
  grid: Grid;
  params: SolverParams;
  fixtures: RoadSemanticsFixture[];
  cpSatExpectation?: RoadSemanticsCpSatExpectation;
}

export interface RoadSemanticsScorecardRunOptions {
  names?: string[];
  cpSat?: Partial<CpSatOptions>;
}

export interface RoadSemanticsFixtureScore {
  caseName: string;
  fixtureName: string;
  description: string;
  expectedValid: boolean;
  valid: boolean;
  errors: string[];
  passed: boolean;
}

export interface RoadSemanticsRoadComponentSummary {
  componentCount: number;
  allComponentsTouchAnchor: boolean;
  row0RoadCount: number;
  column0RoadCount: number;
}

export interface RoadSemanticsCpSatScore {
  status: string | null;
  totalPopulation: number;
  roadCount: number;
  validationValid: boolean;
  validationErrors: string[];
  roadComponents: RoadSemanticsRoadComponentSummary;
  wallClockSeconds: number;
  expectationFailures: string[];
  solution: RoadSemanticsSerializedSolution;
}

export interface RoadSemanticsScorecardCaseResult {
  name: string;
  description: string;
  family: RoadSemanticsPressureFamily;
  gridRows: number;
  gridCols: number;
  fixtureResults: RoadSemanticsFixtureScore[];
  cpSat: RoadSemanticsCpSatScore | null;
  passed: boolean;
}

export interface RoadSemanticsScorecardRegistryHints {
  artifactType: "benchmark";
  cases: string[];
  caseFamilies: RoadSemanticsPressureFamily[];
  seeds: number[];
  budget: {
    cpSatTimeLimitSeconds: number | null;
    cpSatMaxDeterministicTime: number | null;
    cpSatNumWorkers: number | null;
  };
  summaryMetrics: {
    caseCount: number;
    passedCaseCount: number;
    failedCaseCount: number;
    cpSatCaseCount: number;
  };
  artifactPaths: string[];
  decision: string;
  summary: string;
}

export interface RoadSemanticsScorecardArtifactMetadata {
  commands: string[];
  branch: string;
  artifactGitCommit: string | null;
  hardware: ReturnType<typeof captureExperimentRegistryHardwareMetadata>;
}

export interface RoadSemanticsScorecardArtifactWriteOptions {
  commands?: readonly string[];
  metadata?: RoadSemanticsScorecardArtifactMetadata;
}

export interface RoadSemanticsScorecardSuiteResult {
  generatedAt: string;
  commands?: string[];
  branch?: string;
  artifactGitCommit?: string | null;
  hardware?: ReturnType<typeof captureExperimentRegistryHardwareMetadata>;
  caseCount: number;
  selectedCaseNames: string[];
  passed: boolean;
  cpSatOptions: CpSatOptions;
  results: RoadSemanticsScorecardCaseResult[];
  registryHints: RoadSemanticsScorecardRegistryHints;
}

export const DEFAULT_ROAD_SEMANTICS_SCORECARD_OPTIONS: Readonly<Required<
  Pick<
    CpSatOptions,
    | "timeLimitSeconds"
    | "maxDeterministicTime"
    | "numWorkers"
    | "randomSeed"
    | "randomizeSearch"
    | "logSearchProgress"
  >
>> = Object.freeze({
  timeLimitSeconds: 5,
  maxDeterministicTime: 5,
  numWorkers: 1,
  randomSeed: 1,
  randomizeSearch: false,
  logSearchProgress: false,
});

function fixtureSolution(fixture: RoadSemanticsFixture): Solution {
  return {
    roads: new Set(fixture.solution.roads),
    services: fixture.solution.services.map((service) => ({ ...service })),
    serviceTypeIndices: [...fixture.solution.serviceTypeIndices],
    servicePopulationIncreases: [...fixture.solution.servicePopulationIncreases],
    residentials: fixture.solution.residentials.map((residential) => ({ ...residential })),
    residentialTypeIndices: [...fixture.solution.residentialTypeIndices],
    populations: [...fixture.solution.populations],
    totalPopulation: fixture.solution.totalPopulation,
  };
}

function serializeSolution(solution: Solution): RoadSemanticsSerializedSolution {
  return {
    roads: [...solution.roads].sort(),
    services: solution.services.map((service) => ({ ...service })),
    serviceTypeIndices: [...solution.serviceTypeIndices],
    servicePopulationIncreases: [...solution.servicePopulationIncreases],
    residentials: solution.residentials.map((residential) => ({ ...residential })),
    residentialTypeIndices: [...solution.residentialTypeIndices],
    populations: [...solution.populations],
    totalPopulation: solution.totalPopulation,
  };
}

function sortedNeighbors(key: string, roads: Set<string>): string[] {
  const [r, c] = key.split(",").map(Number);
  return [
    `${r - 1},${c}`,
    `${r + 1},${c}`,
    `${r},${c - 1}`,
    `${r},${c + 1}`,
  ].filter((neighbor) => roads.has(neighbor)).sort();
}

function summarizeRoadComponents(roads: Set<string>): RoadSemanticsRoadComponentSummary {
  const visited = new Set<string>();
  let componentCount = 0;
  let anchoredComponentCount = 0;
  let row0RoadCount = 0;
  let column0RoadCount = 0;

  for (const key of roads) {
    const [r, c] = key.split(",").map(Number);
    if (r === 0) row0RoadCount += 1;
    if (c === 0) column0RoadCount += 1;
  }

  for (const startKey of [...roads].sort()) {
    if (visited.has(startKey)) continue;
    componentCount += 1;
    let touchesAnchor = false;
    const queue = [startKey];
    visited.add(startKey);
    for (let index = 0; index < queue.length; index += 1) {
      const key = queue[index]!;
      const [r, c] = key.split(",").map(Number);
      if (r === 0 || c === 0) touchesAnchor = true;
      for (const neighbor of sortedNeighbors(key, roads)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    if (touchesAnchor) anchoredComponentCount += 1;
  }

  return {
    componentCount,
    allComponentsTouchAnchor: componentCount === anchoredComponentCount,
    row0RoadCount,
    column0RoadCount,
  };
}

function evaluateFixture(benchmarkCase: RoadSemanticsScorecardCase, fixture: RoadSemanticsFixture): RoadSemanticsFixtureScore {
  const validation = validateSolution({
    grid: benchmarkCase.grid,
    params: benchmarkCase.params,
    solution: fixtureSolution(fixture),
  });
  return {
    caseName: benchmarkCase.name,
    fixtureName: fixture.name,
    description: fixture.description,
    expectedValid: fixture.expectedValid,
    valid: validation.valid,
    errors: validation.errors,
    passed: validation.valid === fixture.expectedValid,
  };
}

function normalizeRoadSemanticsCpSatOptions(overrides?: Partial<CpSatOptions>): CpSatOptions {
  return normalizeCpSatBenchmarkOptions(undefined, {
    ...DEFAULT_ROAD_SEMANTICS_SCORECARD_OPTIONS,
    ...overrides,
  });
}

function buildCpSatParams(benchmarkCase: RoadSemanticsScorecardCase, cpSatOptions: CpSatOptions): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  return {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      ...(params.cpSat ?? {}),
      ...cpSatOptions,
    },
  };
}

function expectedCpSatFailures(
  expectation: RoadSemanticsCpSatExpectation,
  solution: Solution,
  validationValid: boolean,
  roadComponents: RoadSemanticsRoadComponentSummary
): string[] {
  const failures: string[] = [];
  if (!validationValid) {
    failures.push("CP-SAT solution failed TypeScript validation.");
  }
  if (solution.totalPopulation !== expectation.totalPopulation) {
    failures.push(`Expected population ${expectation.totalPopulation}, got ${solution.totalPopulation}.`);
  }
  if (expectation.roadCount !== undefined && solution.roads.size !== expectation.roadCount) {
    failures.push(`Expected ${expectation.roadCount} roads, got ${solution.roads.size}.`);
  }
  if (expectation.roadComponentCount !== undefined && roadComponents.componentCount !== expectation.roadComponentCount) {
    failures.push(`Expected ${expectation.roadComponentCount} road components, got ${roadComponents.componentCount}.`);
  }
  if (expectation.requiresRow0Road && roadComponents.row0RoadCount === 0) {
    failures.push("Expected at least one row-0 road.");
  }
  if (expectation.requiresColumn0Road && roadComponents.column0RoadCount === 0) {
    failures.push("Expected at least one column-0 road.");
  }
  if (!roadComponents.allComponentsTouchAnchor) {
    failures.push("A CP-SAT road component did not touch row 0 or column 0.");
  }
  return failures;
}

async function runCpSatCase(
  benchmarkCase: RoadSemanticsScorecardCase,
  cpSatOptions: CpSatOptions
): Promise<RoadSemanticsCpSatScore | null> {
  const expectation = benchmarkCase.cpSatExpectation;
  if (!expectation) return null;

  const params = buildCpSatParams(benchmarkCase, cpSatOptions);
  const startedAt = performance.now();
  const solution = await solveCpSatAsync(cloneBenchmarkGrid(benchmarkCase.grid), params);
  const wallClockSeconds = roundBenchmarkMetric((performance.now() - startedAt) / 1000);
  const validation = validateSolution({
    grid: benchmarkCase.grid,
    params,
    solution,
  });
  const roadComponents = summarizeRoadComponents(solution.roads);
  return {
    status: solution.cpSatStatus ?? null,
    totalPopulation: solution.totalPopulation,
    roadCount: solution.roads.size,
    validationValid: validation.valid,
    validationErrors: validation.errors,
    roadComponents,
    wallClockSeconds,
    expectationFailures: expectedCpSatFailures(expectation, solution, validation.valid, roadComponents),
    solution: serializeSolution(solution),
  };
}

function selectRoadSemanticsCases(
  corpus: readonly RoadSemanticsScorecardCase[],
  names: readonly string[] | undefined
): RoadSemanticsScorecardCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "road-semantics scorecard",
    corpusLabel: "road-semantics scorecard",
  });
}

function uniqueFamilies(results: readonly RoadSemanticsScorecardCaseResult[]): RoadSemanticsPressureFamily[] {
  return [...new Set(results.map((result) => result.family))].sort();
}

function buildRegistryHints(
  result: Omit<RoadSemanticsScorecardSuiteResult, "registryHints">,
  artifactPaths: string[] = []
): RoadSemanticsScorecardRegistryHints {
  const failedCaseCount = result.results.filter((caseResult) => !caseResult.passed).length;
  const cpSatCaseCount = result.results.filter((caseResult) => caseResult.cpSat !== null).length;
  return {
    artifactType: "benchmark",
    cases: result.selectedCaseNames,
    caseFamilies: uniqueFamilies(result.results),
    seeds: result.cpSatOptions.randomSeed === undefined ? [] : [result.cpSatOptions.randomSeed],
    budget: {
      cpSatTimeLimitSeconds: result.cpSatOptions.timeLimitSeconds ?? null,
      cpSatMaxDeterministicTime: result.cpSatOptions.maxDeterministicTime ?? null,
      cpSatNumWorkers: result.cpSatOptions.numWorkers ?? null,
    },
    summaryMetrics: {
      caseCount: result.caseCount,
      passedCaseCount: result.caseCount - failedCaseCount,
      failedCaseCount,
      cpSatCaseCount,
    },
    artifactPaths,
    decision: result.passed ? "road-semantics-alignment-ready-for-product-scorecard" : "road-semantics-alignment-blocked",
    summary: result.passed
      ? "Road-semantics adversarial fixtures and CP-SAT solves agree with the TypeScript evaluator."
      : "Road-semantics scorecard found mismatches that must be fixed before promotion.",
  };
}

function execGitValue(args: string[], fallback: string): string {
  try {
    const value = childProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
    return value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

function quoteRoadSemanticsCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : JSON.stringify(value);
}

export function formatRoadSemanticsScorecardCommand(argv: readonly string[]): string {
  const command = ["npm", "run", "benchmark:road-semantics"];
  if (argv.length > 0) {
    command.push("--", ...argv);
  }
  return command.map(quoteRoadSemanticsCommandArg).join(" ");
}

export function buildRoadSemanticsScorecardArtifactMetadata(
  commands: readonly string[]
): RoadSemanticsScorecardArtifactMetadata {
  const artifactGitCommit = execGitValue(["rev-parse", "HEAD"], "");
  return {
    commands: [...commands],
    branch: execGitValue(["branch", "--show-current"], "unknown"),
    artifactGitCommit: artifactGitCommit === "" ? null : artifactGitCommit,
    hardware: captureExperimentRegistryHardwareMetadata(),
  };
}

export function listRoadSemanticsScorecardCaseNames(
  corpus: readonly RoadSemanticsScorecardCase[] = DEFAULT_ROAD_SEMANTICS_SCORECARD_CASES
): string[] {
  return listBenchmarkCaseNames(corpus, {
    caseLabel: "road-semantics scorecard",
    corpusLabel: "road-semantics scorecard",
  });
}

export function evaluateRoadSemanticsScorecardFixtures(
  corpus: readonly RoadSemanticsScorecardCase[] = DEFAULT_ROAD_SEMANTICS_SCORECARD_CASES
): RoadSemanticsFixtureScore[] {
  return corpus.flatMap((benchmarkCase) => benchmarkCase.fixtures.map((fixture) => evaluateFixture(benchmarkCase, fixture)));
}

export async function runRoadSemanticsScorecard(
  corpus: readonly RoadSemanticsScorecardCase[] = DEFAULT_ROAD_SEMANTICS_SCORECARD_CASES,
  options?: RoadSemanticsScorecardRunOptions
): Promise<RoadSemanticsScorecardSuiteResult> {
  const selected = selectRoadSemanticsCases(corpus, options?.names);
  const cpSatOptions = normalizeRoadSemanticsCpSatOptions(options?.cpSat);
  const results: RoadSemanticsScorecardCaseResult[] = [];

  for (const benchmarkCase of selected) {
    const fixtureResults = benchmarkCase.fixtures.map((fixture) => evaluateFixture(benchmarkCase, fixture));
    const cpSat = await runCpSatCase(benchmarkCase, cpSatOptions);
    const passed = fixtureResults.every((fixture) => fixture.passed) && (cpSat?.expectationFailures.length ?? 0) === 0;
    results.push({
      name: benchmarkCase.name,
      description: benchmarkCase.description,
      family: benchmarkCase.family,
      gridRows: benchmarkCase.grid.length,
      gridCols: benchmarkCase.grid[0]?.length ?? 0,
      fixtureResults,
      cpSat,
      passed,
    });
  }

  const metadata = buildBenchmarkSuiteMetadata(results.map((result) => result.name));
  const partialResult = {
    ...metadata,
    passed: results.every((result) => result.passed),
    cpSatOptions,
    results,
  };
  return {
    ...partialResult,
    registryHints: buildRegistryHints(partialResult),
  };
}

export function writeRoadSemanticsScorecardArtifact(
  result: RoadSemanticsScorecardSuiteResult,
  outputPath: string,
  options: RoadSemanticsScorecardArtifactWriteOptions = {}
): RoadSemanticsScorecardSuiteResult {
  const normalizedOutputPath = path.normalize(outputPath);
  const commands = options.commands ?? [formatRoadSemanticsScorecardCommand([`--output=${normalizedOutputPath}`])];
  const metadata = options.metadata ?? buildRoadSemanticsScorecardArtifactMetadata(commands);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  const resultWithArtifactPath = {
    ...result,
    ...metadata,
    registryHints: buildRegistryHints(result, [normalizedOutputPath]),
  };
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(resultWithArtifactPath, null, 2)}\n`);
  return resultWithArtifactPath;
}

function formatCpSatScore(score: RoadSemanticsCpSatScore | null): string {
  if (!score) return "cp-sat=n/a";
  const failures = score.expectationFailures.length === 0 ? "pass" : `fail:${score.expectationFailures.join(" ")}`;
  return [
    `cp-sat=${score.status ?? "unknown"}`,
    `population=${score.totalPopulation}`,
    `roads=${score.roadCount}`,
    `components=${score.roadComponents.componentCount}`,
    `row0-roads=${score.roadComponents.row0RoadCount}`,
    `column0-roads=${score.roadComponents.column0RoadCount}`,
    `wall=${score.wallClockSeconds.toFixed(3)}s`,
    failures,
  ].join(" ");
}

export function formatRoadSemanticsScorecard(result: RoadSemanticsScorecardSuiteResult): string {
  const lines: string[] = [];
  lines.push("=== Road Semantics Scorecard ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Status: ${result.passed ? "PASS" : "FAIL"}`);
  lines.push(
    `CP-SAT budget: time=${result.cpSatOptions.timeLimitSeconds ?? "n/a"}s deterministic=${
      result.cpSatOptions.maxDeterministicTime ?? "n/a"
    } workers=${result.cpSatOptions.numWorkers ?? "n/a"} seed=${result.cpSatOptions.randomSeed ?? "n/a"}`
  );
  lines.push("");

  for (const caseResult of result.results) {
    lines.push(`- ${caseResult.name} [${caseResult.family}]: ${caseResult.description}`);
    for (const fixture of caseResult.fixtureResults) {
      lines.push(
        `  fixture=${fixture.fixtureName} expected=${fixture.expectedValid ? "valid" : "invalid"} actual=${
          fixture.valid ? "valid" : "invalid"
        } ${fixture.passed ? "pass" : `fail:${fixture.errors.join(" ")}`}`
      );
    }
    lines.push(`  ${formatCpSatScore(caseResult.cpSat)}`);
  }

  return lines.join("\n");
}

function residentialSolution(
  roads: string[],
  residentials: ResidentialPlacement[],
  populations: number[],
  residentialTypeIndices: number[] = residentials.map(() => 0)
): RoadSemanticsSerializedSolution {
  return {
    roads,
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation: populations.reduce((sum, population) => sum + population, 0),
  };
}

export const DEFAULT_ROAD_SEMANTICS_SCORECARD_CASES: readonly RoadSemanticsScorecardCase[] = Object.freeze([
  {
    name: "row0-anchored-road-access",
    description: "A non-boundary building is connected by a road component rooted on row 0.",
    family: "row0-anchor",
    grid: [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
    fixtures: [
      {
        name: "row0-road-valid",
        description: "A single row-0 road gives access to the only feasible residential footprint.",
        expectedValid: true,
        solution: residentialSolution(["0,1"], [{ r: 1, c: 1, rows: 2, cols: 2 }], [10]),
      },
    ],
    cpSatExpectation: {
      totalPopulation: 10,
      roadCount: 1,
      roadComponentCount: 1,
      requiresRow0Road: true,
    },
  },
  {
    name: "column0-anchored-road-access",
    description: "A non-boundary building is connected by a road component rooted on column 0.",
    family: "column0-anchor",
    grid: [
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [1, 1, 1, 0],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
    fixtures: [
      {
        name: "column0-road-valid",
        description: "A single column-0 road gives access to the only feasible residential footprint.",
        expectedValid: true,
        solution: residentialSolution(["2,0"], [{ r: 1, c: 1, rows: 2, cols: 2 }], [10]),
      },
    ],
    cpSatExpectation: {
      totalPopulation: 10,
      roadCount: 1,
      roadComponentCount: 1,
      requiresColumn0Road: true,
    },
  },
  {
    name: "multiple-independent-anchor-components",
    description: "Two disconnected islands each use their own anchored road component.",
    family: "multi-anchor",
    grid: [
      [0, 1, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 1],
      [0, 1, 1, 0, 1, 1],
      [0, 1, 1, 0, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 2, h: 2, min: 10, max: 10, avail: 2 }],
      availableBuildings: { residentials: 2, services: 0 },
    },
    fixtures: [
      {
        name: "two-components-valid",
        description: "Each residential island is served by a separate row-0-anchored road component.",
        expectedValid: true,
        solution: residentialSolution(
          ["0,1", "1,1", "0,5", "1,5"],
          [
            { r: 2, c: 1, rows: 2, cols: 2 },
            { r: 2, c: 4, rows: 2, cols: 2 },
          ],
          [10, 10],
          [0, 0]
        ),
      },
    ],
    cpSatExpectation: {
      totalPopulation: 20,
      roadComponentCount: 2,
      requiresRow0Road: true,
    },
  },
  {
    name: "roadless-boundary-building",
    description: "A building touching the anchor boundary is connected without explicit roads.",
    family: "roadless-boundary",
    grid: [[1]],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
    fixtures: [
      {
        name: "boundary-building-roadless-valid",
        description: "A row-0/column-0 residential placement needs no explicit road.",
        expectedValid: true,
        solution: residentialSolution([], [{ r: 0, c: 0, rows: 1, cols: 1 }], [10]),
      },
    ],
    cpSatExpectation: {
      totalPopulation: 10,
      roadCount: 0,
      roadComponentCount: 0,
    },
  },
  {
    name: "disconnected-non-anchor-road-rejected",
    description: "An explicit road component away from row 0 and column 0 is invalid.",
    family: "disconnected-non-anchor",
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    params: {
      optimizer: "cp-sat",
      residentialTypes: [{ w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
    },
    fixtures: [
      {
        name: "non-anchor-road-invalid",
        description: "The residential is adjacent to a road, but that road component has no anchor.",
        expectedValid: false,
        solution: residentialSolution(["1,1"], [{ r: 1, c: 2, rows: 1, cols: 1 }], [10]),
      },
    ],
    cpSatExpectation: {
      totalPopulation: 10,
      roadCount: 0,
      roadComponentCount: 0,
    },
  },
]);
