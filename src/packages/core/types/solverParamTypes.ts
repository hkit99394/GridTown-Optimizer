/**
 * Shared solver parameter contract
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type {
  AvailableBuildings,
  OptimizerName,
  ResidentialSettings,
  ResidentialTypeSetting,
  ServiceTypeSetting
} from "./baseTypes.js";
import type { AutoOptions } from "./autoTypes.js";
import type { CpSatOptions } from "./cpSatTypes.js";
import type { GreedyOptions } from "./greedyTypes.js";
import type { LnsOptions } from "./lnsTypes.js";

export interface SolverParams {
  /** Optimizer backend. Defaults to auto. */
  optimizer?: OptimizerName;
  /**
   * Explicit road cells that must remain roads. These cells also act as road-anchor
   * roots, so generated road components may connect to them instead of only to
   * row 0 or column 0.
   */
  fixedRoads?: string[];
  /** Auto-orchestration options, used when optimizer = "auto". */
  auto?: AutoOptions;
  /** CP-SAT backend options, used when optimizer = "cp-sat". */
  cpSat?: CpSatOptions;
  /** Greedy-only tuning knobs. Ignored by the CP-SAT backend. */
  greedy?: GreedyOptions;
  /** LNS-only tuning knobs. Ignored by other backends. */
  lns?: LnsOptions;
  /** Service types: each type has its own footprint, bonus, range, and availability. */
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
  localSearch?: boolean;
  /** @deprecated Use greedy.restarts */
  restarts?: number;
  /** @deprecated Use greedy.serviceRefineIterations */
  serviceRefineIterations?: number;
  /** @deprecated Use greedy.serviceRefineCandidateLimit */
  serviceRefineCandidateLimit?: number;
  /** @deprecated Use greedy.exhaustiveServiceSearch */
  exhaustiveServiceSearch?: boolean;
  /** @deprecated Use greedy.serviceExactPoolLimit */
  serviceExactPoolLimit?: number;
  /** @deprecated Use greedy.serviceExactMaxCombinations */
  serviceExactMaxCombinations?: number;
}
