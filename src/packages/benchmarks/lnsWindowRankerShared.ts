import { DEFAULT_LNS_REPLAY_LABEL_CORPUS } from "./lns.js";

import type { LnsWindowReplaySeedHintKind, LnsWindowReplaySnapshotLabel } from "./lnsWindowReplayLabels.js";
import type { LnsWindowReplaySnapshotCaseResult } from "./lnsWindowReplayLabels.js";

export type LnsWindowRankerLabelTarget =
  | "immediate-improvement"
  | "roll-forward-final-lift"
  | "roll-forward-baseline-stall-lift";

export function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function positiveFiniteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeLnsWindowRankerLabelTarget(value: unknown): LnsWindowRankerLabelTarget {
  if (value === undefined || value === "immediate-improvement") return "immediate-improvement";
  if (value === "roll-forward-final-lift") return "roll-forward-final-lift";
  if (value === "roll-forward-baseline-stall-lift") return "roll-forward-baseline-stall-lift";
  throw new Error(`Unknown LNS window ranker label target: ${String(value)}.`);
}

export function normalizeLnsWindowRankerWeakSeedAllowance(value: unknown): boolean {
  return value !== false;
}

export function normalizeLnsWindowRankerFeatureIdenticalRepeatabilityConflictExclusion(value: unknown): boolean {
  return value === true;
}

function seedHintKindFromSource(
  sourceName: string | null | undefined,
  hasSeedHint: boolean
): LnsWindowReplaySeedHintKind {
  if (!hasSeedHint) return "none";
  return sourceName?.endsWith("-weak-replay-seed") ? "weak-replay" : "curated";
}

const DEFAULT_REPLAY_SEED_HINT_KIND_BY_CASE = new Map(
  DEFAULT_LNS_REPLAY_LABEL_CORPUS.map((benchmarkCase) => [
    benchmarkCase.name,
    seedHintKindFromSource(benchmarkCase.params.lns?.seedHint?.sourceName, Boolean(benchmarkCase.params.lns?.seedHint))
  ])
);

export function inferLnsWindowRankerReplaySeedHintKind(
  benchmarkCase: Pick<LnsWindowReplaySnapshotCaseResult, "name" | "seedHintKind" | "seedHintSourceName">
): LnsWindowReplaySeedHintKind | "unknown" {
  if (benchmarkCase.seedHintKind) return benchmarkCase.seedHintKind;
  if (benchmarkCase.seedHintSourceName) return seedHintKindFromSource(benchmarkCase.seedHintSourceName, true);
  return DEFAULT_REPLAY_SEED_HINT_KIND_BY_CASE.get(benchmarkCase.name) ?? "unknown";
}

export function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function hasTargetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): boolean {
  return target === "immediate-improvement" || typeof label.rollForward?.populationDeltaVsBaseline === "number";
}

export function targetValue(label: LnsWindowReplaySnapshotLabel, target: LnsWindowRankerLabelTarget): number {
  if (target === "immediate-improvement") return label.improvement;
  const rollForward = label.rollForward;
  if (!rollForward || typeof rollForward.populationDeltaVsBaseline !== "number") return 0;
  if (target === "roll-forward-baseline-stall-lift") {
    const baselineGainFromIncumbent =
      rollForward.baselineTotalPopulation === null
        ? 0
        : rollForward.baselineTotalPopulation - label.incumbentPopulation;
    return baselineGainFromIncumbent > 0 ? 0 : rollForward.populationDeltaVsBaseline;
  }
  return rollForward.populationDeltaVsBaseline;
}

export function targetAllowsFeatureIdenticalRepeatabilityConflicts(target: LnsWindowRankerLabelTarget): boolean {
  return target === "roll-forward-baseline-stall-lift";
}
