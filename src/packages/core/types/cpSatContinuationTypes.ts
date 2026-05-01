/**
 * CP-SAT continuation checkpoint types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { Grid } from "./baseTypes.js";
import type {
  CpSatContinuationHintedResidentialPlacement,
  CpSatContinuationHintedServicePlacement,
  PersistedResidentialCandidateKey,
  PersistedRoadKey,
  PersistedServiceCandidateKey,
} from "./cpSatTypes.js";
import type { SolverParams } from "./solverParamTypes.js";

/**
 * Full request model used to continue a saved CP-SAT solve later.
 * This is stricter than SolveRequestPayload because continuation only makes
 * sense when the model is rebuilt as CP-SAT again.
 */
export interface CpSatContinuationModelInput {
  grid: Grid;
  params: SolverParams & {
    optimizer: "cp-sat";
  };
}

/** Versioning and fingerprint data used to reject incompatible continuation attempts. */
export interface CpSatContinuationCompatibility {
  modelEncodingVersion: "cp-sat-layout-v1";
  candidateKeyVersion: 1;
  modelFingerprint: string;
  candidateUniverseHash: string;
  createdWith: {
    appVersion?: string;
    ortoolsVersion?: string;
  };
}

/** Default runtime knobs to reuse when restarting from a saved CP-SAT checkpoint. */
export interface CpSatContinuationRuntimeDefaults {
  numWorkers?: number;
  randomSeed?: number;
  randomizeSearch?: boolean;
  logSearchProgress?: boolean;
}

/** Best-known objective snapshot stored at save time. */
export interface CpSatContinuationIncumbent {
  status: "FEASIBLE" | "OPTIMAL";
  objective: {
    name: "totalPopulation";
    sense: "maximize";
    value: number;
    bestBound?: number | null;
  };
  elapsedMs: number;
  stoppedByUser: boolean;
}

/** Saved best-so-far assignment used as a warm start for a future CP-SAT run. */
export interface CpSatContinuationHint {
  roadKeys: PersistedRoadKey[];
  serviceCandidateKeys: PersistedServiceCandidateKey[];
  residentialCandidateKeys: PersistedResidentialCandidateKey[];
  solution: {
    roads: PersistedRoadKey[];
    services: CpSatContinuationHintedServicePlacement[];
    residentials: CpSatContinuationHintedResidentialPlacement[];
    populations: number[];
    totalPopulation: number;
  };
}

/** Resume policy for a future warm restart from a saved CP-SAT checkpoint. */
export interface CpSatContinuationResumePolicy {
  requireExactModelMatch: true;
  applyHints: boolean;
  repairHint: boolean;
  fixVariablesToHintedValue: boolean;
  objectiveCutoff: {
    op: ">=";
    value: number;
    preferStrictImprove: boolean;
  };
}

/** Persisted CP-SAT checkpoint that can be loaded later as a warm restart. */
export interface CpSatContinuationCheckpoint {
  kind: "city-builder.cp-sat-checkpoint";
  version: 1;
  compatibility: CpSatContinuationCompatibility;
  modelInput: CpSatContinuationModelInput;
  runtimeDefaults: CpSatContinuationRuntimeDefaults;
  incumbent: CpSatContinuationIncumbent;
  hint: CpSatContinuationHint;
  resumePolicy: CpSatContinuationResumePolicy;
}
