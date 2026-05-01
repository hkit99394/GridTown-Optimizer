/**
 * LNS solver option and telemetry types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

import type { CpSatNeighborhoodWindow, CpSatWarmStartHint } from "./cpSatTypes.js";

export type LnsNeighborhoodAnchorPolicy =
  | "ranked"
  | "sliding-only"
  | "weak-service-first"
  | "residential-opportunity-first"
  | "frontier-congestion-first"
  | "placed-buildings-first";

export interface LnsOptions {
  /** Number of neighborhood-repair attempts to run after the greedy seed. */
  iterations?: number;
  /** Stop after this many consecutive non-improving neighborhoods. */
  maxNoImprovementIterations?: number;
  /** Total LNS wall-clock budget in seconds, including seed construction. Omit for no LNS-specific wall-clock cap. */
  wallClockLimitSeconds?: number;
  /** Alias for wallClockLimitSeconds for callers that use the same naming as raw Greedy and CP-SAT. */
  timeLimitSeconds?: number;
  /** Stop after this many seconds without an improving neighborhood. Omit to rely on iteration-based stopping. */
  noImprovementTimeoutSeconds?: number;
  /** Optional greedy seed construction budget in seconds when no saved seed is provided. */
  seedTimeLimitSeconds?: number;
  /** Height of each repair neighborhood. Defaults to about half the grid height. */
  neighborhoodRows?: number;
  /** Width of each repair neighborhood. Defaults to about half the grid width. */
  neighborhoodCols?: number;
  /** Deterministic policy used to rank or suppress LNS repair-window anchors. Default ranked. */
  neighborhoodAnchorPolicy?: LnsNeighborhoodAnchorPolicy;
  /** Per-neighborhood CP-SAT repair budget in seconds. */
  repairTimeLimitSeconds?: number;
  /** Per-neighborhood budget for focused repair attempts before escalation. Defaults to repairTimeLimitSeconds. */
  focusedRepairTimeLimitSeconds?: number;
  /** Per-neighborhood budget for escalated repair attempts. Defaults to repairTimeLimitSeconds. */
  escalatedRepairTimeLimitSeconds?: number;
  /** Optional saved-layout seed used instead of rebuilding the initial greedy incumbent. */
  seedHint?: CpSatWarmStartHint;
  /** Internal stop-token path used by the local web server. */
  stopFilePath?: string;
  /** Internal best-snapshot path used by the local web server. */
  snapshotFilePath?: string;
}

export type LnsRepairPhase = "focused" | "escalated";

export type LnsAdaptiveOperatorName =
  | "weak-service"
  | "residential-headroom"
  | "frontier-congestion"
  | "gate-choke"
  | "service-overlap"
  | "random-exploration"
  | "placed-buildings"
  | "sliding";

export interface LnsOperatorWeight {
  operator: LnsAdaptiveOperatorName;
  weight: number;
}

export interface LnsOperatorSummary extends LnsOperatorWeight {
  attempts: number;
  feasibleRepairs: number;
  improvements: number;
  neutralRepairs: number;
  recoverableFailures: number;
  regressions: number;
  totalImprovement: number;
  elapsedSeconds: number;
}

export type LnsNeighborhoodOutcomeStatus =
  | "improved"
  | "neutral"
  | "recoverable-failure"
  | "skipped-budget"
  | "stopped";

export type LnsStopReason =
  | "running"
  | "iteration-limit"
  | "stale-iteration-limit"
  | "stale-time-limit"
  | "wall-clock-limit"
  | "no-neighborhoods"
  | "cancelled";

export interface LnsNeighborhoodOutcome {
  iteration: number;
  phase: LnsRepairPhase;
  operator?: LnsAdaptiveOperatorName;
  operatorWeight?: number;
  window: CpSatNeighborhoodWindow;
  stagnantIterationsBefore: number;
  staleSecondsBefore: number;
  repairTimeLimitSeconds: number;
  wallClockSeconds: number;
  populationBefore: number;
  populationAfter: number;
  improvement: number;
  status: LnsNeighborhoodOutcomeStatus;
  cpSatStatus?: string | null;
}

export interface LnsTelemetry {
  stopReason: LnsStopReason;
  seedSource: "greedy" | "hint";
  seedWallClockSeconds: number;
  seedTimeLimitSeconds: number | null;
  wallClockLimitSeconds: number | null;
  noImprovementTimeoutSeconds: number | null;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
  iterationsStarted: number;
  iterationsCompleted: number;
  improvingIterations: number;
  neutralIterations: number;
  recoverableFailures: number;
  skippedIterations: number;
  finalStagnantIterations: number;
  elapsedSeconds: number;
  operatorSummaries?: LnsOperatorSummary[];
  outcomes: LnsNeighborhoodOutcome[];
}
