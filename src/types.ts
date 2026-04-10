/**
 * City Builder — type definitions (see SPEC.md)
 */

export type Grid = number[][];

export type Cell = { r: number; c: number };

/** Key for set/map of cells */
export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export function cellFromKey(key: string): Cell {
  const [r, c] = key.split(",").map(Number);
  return { r, c };
}

/** Rectangle: top-left (r, c), size (rows × cols) */
export type Rectangle = { r: number; c: number; rows: number; cols: number };

/** Service building placement with explicit footprint and effect range. */
export type ServicePlacement = { r: number; c: number; rows: number; cols: number; range: number };

/** Service candidate with type index and bonus metadata for optimizer use */
export type ServiceCandidate = ServicePlacement & { typeIndex: number; bonus: number };

/** Residential building: placement (r, c) and size (rows × cols) */
export type ResidentialPlacement = { r: number; c: number; rows: number; cols: number };

/** Residential candidate with type index (for per-type avail and min/max) */
export type ResidentialCandidate = ResidentialPlacement & { typeIndex: number };

/**
 * How many of each building type are available to place.
 * Omit or use undefined for "no limit".
 */
export interface AvailableBuildings {
  /** Max number of service buildings to place. Default: no limit */
  services?: number;
  /** Max number of residential buildings (2×2 or 2×3) to place. Default: no limit */
  residentials?: number;
}

/** Min (base) and max population for one residential size (e.g. 2×2 or 2×3) */
export interface ResidentialSizeSetting {
  min: number;
  max: number;
}

/** Key is "rowsxcols", e.g. "2x2", "2x3" */
export type ResidentialSettings = Partial<Record<string, ResidentialSizeSetting>>;

/**
 * One residential building type: size (w×h), min/max population, and how many can be placed.
 * Building can be rotated so both (w×h) and (h×w) count as this type and share the same avail.
 */
export interface ResidentialTypeSetting {
  w: number;
  h: number;
  min: number;
  max: number;
  avail: number;
}

/**
 * One service building type: size, bonus, effect range, and availability.
 * When allowRotation is true (default), both (rows×cols) and (cols×rows) are allowed for this type.
 */
export interface ServiceTypeSetting {
  rows: number;
  cols: number;
  bonus: number;
  range: number;
  avail: number;
  allowRotation?: boolean;
}

export type OptimizerName = "greedy" | "cp-sat";

export interface CpSatOptions {
  /** Python executable to run the CP-SAT backend. Defaults to .venv-cp-sat/bin/python when present, else python3. */
  pythonExecutable?: string;
  /** Override the CP-SAT backend script path. */
  scriptPath?: string;
  /** Max solve time in seconds. Default 120. */
  timeLimitSeconds?: number;
  /** CP-SAT worker count. Default 8. */
  numWorkers?: number;
  /** Emit OR-Tools search logs. Default false. */
  logSearchProgress?: boolean;
}

export interface GreedyOptions {
  /** Run local search to improve solution (default true) */
  localSearch?: boolean;
  /** Number of restarts with different service order; take best solution (default 1) */
  restarts?: number;
  /** Service-position refinement passes after restarts (default 2) */
  serviceRefineIterations?: number;
  /** Max service candidates considered per refinement pass (default 40) */
  serviceRefineCandidateLimit?: number;
  /** Run exhaustive search over service layouts in top-N pool (default false) */
  exhaustiveServiceSearch?: boolean;
  /** Pool size for exhaustive service search (default 22) */
  serviceExactPoolLimit?: number;
  /** Hard cap on evaluated service combinations (default 12000) */
  serviceExactMaxCombinations?: number;
}

export interface SolverParams {
  /** Optimizer backend. Defaults to greedy. */
  optimizer?: OptimizerName;
  /** CP-SAT backend options, used when optimizer = "cp-sat". */
  cpSat?: CpSatOptions;
  /** Greedy-only tuning knobs. Ignored by the CP-SAT backend. */
  greedy?: GreedyOptions;
  /**
   * Service types: each type has its own footprint, bonus, range, and availability.
   */
  serviceTypes?: ServiceTypeSetting[];
  /**
   * Residential types with rotation: each type allows (w×h) and (h×w), with per-type min, max, and avail.
   * If provided, used for candidate enumeration and population bounds; avail caps how many of that type are placed.
   */
  residentialTypes?: ResidentialTypeSetting[];
  /**
   * Per-size min/max for residentials (legacy). Key = "rowsxcols" (e.g. "2x2", "2x3").
   * Ignored when residentialTypes is provided.
   */
  residentialSettings?: ResidentialSettings;
  /** Base population per residential when no type/size setting applies */
  basePop?: number;
  /** Max population per residential when no type/size setting applies */
  maxPop?: number;
  /**
   * Available buildings: caps on how many of each type to place.
   * You can set this instead of (or it overrides) maxServices / maxResidentials.
   */
  availableBuildings?: AvailableBuildings;
  /** @deprecated Use availableBuildings.services */
  maxServices?: number;
  /** @deprecated Use availableBuildings.residentials */
  maxResidentials?: number;
  /** @deprecated Use greedy.localSearch */
  /** Run local search to improve solution (default true) */
  localSearch?: boolean;
  /** @deprecated Use greedy.restarts */
  /** Number of restarts with different service order; take best solution (default 1) */
  restarts?: number;
  /** @deprecated Use greedy.serviceRefineIterations */
  /** Service-position refinement passes after restarts (default 2) */
  serviceRefineIterations?: number;
  /** @deprecated Use greedy.serviceRefineCandidateLimit */
  /** Max service candidates considered per refinement pass (default 40) */
  serviceRefineCandidateLimit?: number;
  /** @deprecated Use greedy.exhaustiveServiceSearch */
  /** Run exhaustive search over service layouts in top-N pool (default false) */
  exhaustiveServiceSearch?: boolean;
  /** @deprecated Use greedy.serviceExactPoolLimit */
  /** Pool size for exhaustive service search (default 22) */
  serviceExactPoolLimit?: number;
  /** @deprecated Use greedy.serviceExactMaxCombinations */
  /** Hard cap on evaluated service combinations (default 12000) */
  serviceExactMaxCombinations?: number;
}

export interface Solution {
  optimizer?: OptimizerName;
  /** CP-SAT backend status such as OPTIMAL or FEASIBLE; omitted for non-CP-SAT solvers. */
  cpSatStatus?: string;
  roads: Set<string>;
  services: ServicePlacement[];
  /** Service type index per placement; -1 only for manual solutions without configured service types */
  serviceTypeIndices: number[];
  /** Population increase applied by the i-th service (same order as services) */
  servicePopulationIncreases: number[];
  residentials: ResidentialPlacement[];
  /** Residential type index per placement; -1 when the solution did not use typed residentials */
  residentialTypeIndices: number[];
  /** Population per residential (same order as residentials) */
  populations: number[];
  totalPopulation: number;
}

/** Explicit service placement for manual layout evaluation */
export interface EvaluatedServicePlacement extends ServicePlacement {
  /** Population increase contributed by this service */
  bonus: number;
}

/** Input payload for strict layout evaluation */
export interface LayoutEvaluationInput {
  grid: Grid;
  roads: Set<string>;
  services: EvaluatedServicePlacement[];
  residentials: ResidentialPlacement[];
  params: SolverParams;
}

/** Per-building scored result for manual layout evaluation */
export interface EvaluatedResidentialResult extends ResidentialPlacement {
  population: number;
}

/** Output payload for strict layout evaluation */
export interface LayoutEvaluationResult {
  valid: boolean;
  errors: string[];
  populations: EvaluatedResidentialResult[];
  totalPopulation: number;
}

/** Input payload for full solution validation */
export interface SolutionValidationInput {
  grid: Grid;
  solution: Solution;
  params: SolverParams;
}

/** Output payload for full solution validation */
export interface SolutionValidationResult {
  valid: boolean;
  errors: string[];
  recomputedPopulations: number[];
  recomputedTotalPopulation: number;
  layoutEvaluation: LayoutEvaluationResult;
}
