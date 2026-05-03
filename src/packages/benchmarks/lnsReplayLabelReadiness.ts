import {
  countBenchmarkMatches,
  groupBenchmarkValuesBy,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
  uniqueBenchmarkValuesBy
} from "./benchmarkOptions.js";

import type { LnsWindowReplayStatePolicy } from "./lnsWindowReplayLabels.js";

type LnsReplayLabelReadinessPressureFamilyLabel =
  | "baseline"
  | "corridor"
  | "gate"
  | "footprint-pressure"
  | "service-pressure"
  | "anchor-service"
  | "uncategorized";

interface LnsReplayLabelReadinessLabel {
  status: "improved" | "neutral" | "regressed" | "invalid" | "recoverable-failure";
  usable: boolean;
}

interface LnsReplayLabelReadinessCase {
  name: string;
  pressureFamily: LnsReplayLabelReadinessPressureFamilyLabel;
  seed: number | null;
  statePolicy?: LnsWindowReplayStatePolicy;
  labels: readonly LnsReplayLabelReadinessLabel[];
}

interface LnsReplayLabelReadinessSnapshot {
  cases: readonly LnsReplayLabelReadinessCase[];
}

export interface LnsReplayLabelScaleThresholds {
  minPressureFamilies: number;
  minSeedsPerFamily: number;
  minUsableLabelsPerSplit: number;
  minNonNeutralLabelsPerSplit: number;
  minUsableLabelsPerFamily: number;
  maxNeutralLabelRatio: number;
  requiredStatePolicies?: readonly LnsWindowReplayStatePolicy[];
}

export interface LnsReplayLabelFamilyScaleSummary {
  pressureFamily: LnsReplayLabelReadinessPressureFamilyLabel;
  caseNames: string[];
  seeds: number[];
  requiredStatePolicies: LnsWindowReplayStatePolicy[];
  capturedStatePolicies: LnsWindowReplayStatePolicy[];
  missingStatePolicies: LnsWindowReplayStatePolicy[];
  labelCount: number;
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
}

export interface LnsReplayLabelScaleSplitInput<Split extends string = string> {
  split: Split;
  seeds: readonly number[];
  replay: LnsReplayLabelReadinessSnapshot;
}

export interface LnsReplayLabelSplitScaleReadiness<Split extends string = string> {
  split: Split;
  pressureFamilyCount: number;
  seedCount: number;
  requiredStatePolicies: LnsWindowReplayStatePolicy[];
  capturedStatePolicies: LnsWindowReplayStatePolicy[];
  missingStatePolicies: LnsWindowReplayStatePolicy[];
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
  passed: boolean;
  failedReasons: string[];
  families: LnsReplayLabelFamilyScaleSummary[];
}

export interface LnsReplayLabelScaleReadiness<Split extends string = string> {
  thresholds: LnsReplayLabelScaleThresholds;
  passed: boolean;
  splitReadiness: LnsReplayLabelSplitScaleReadiness<Split>[];
}

export const DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS: Readonly<LnsReplayLabelScaleThresholds> = Object.freeze({
  minPressureFamilies: 5,
  minSeedsPerFamily: 3,
  minUsableLabelsPerSplit: 200,
  minNonNeutralLabelsPerSplit: 50,
  minUsableLabelsPerFamily: 20,
  maxNeutralLabelRatio: 0.85,
  requiredStatePolicies: Object.freeze([])
});

function lnsLabelIsNonNeutral(label: LnsReplayLabelReadinessLabel): boolean {
  return label.usable && (label.status === "improved" || label.status === "regressed");
}

function summarizeLnsReplayFamily(
  pressureFamily: LnsReplayLabelReadinessPressureFamilyLabel,
  cases: readonly LnsReplayLabelReadinessCase[],
  requiredStatePolicies: readonly LnsWindowReplayStatePolicy[]
): LnsReplayLabelFamilyScaleSummary {
  const labels = cases.flatMap((benchmarkCase) => benchmarkCase.labels);
  const usableLabels = labels.filter((label) => label.usable);
  const neutralUsableLabelCount = countBenchmarkMatches(usableLabels, (label) => label.status === "neutral");
  const nonNeutralUsableLabelCount = countBenchmarkMatches(usableLabels, lnsLabelIsNonNeutral);
  const seeds = uniqueBenchmarkValues(
    cases
      .map((benchmarkCase) => benchmarkCase.seed)
      .filter((seed): seed is number => seed !== null)
      .map((seed) => String(seed))
  ).map((seed) => Number(seed));
  const capturedStatePolicies = uniqueBenchmarkValues(
    cases
      .map((benchmarkCase) => benchmarkCase.statePolicy)
      .filter((statePolicy): statePolicy is LnsWindowReplayStatePolicy => statePolicy !== undefined)
  ) as LnsWindowReplayStatePolicy[];
  const capturedStatePolicySet = new Set(capturedStatePolicies);
  const missingStatePolicies = requiredStatePolicies.filter((statePolicy) => !capturedStatePolicySet.has(statePolicy));

  return {
    pressureFamily,
    caseNames: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.name),
    seeds,
    requiredStatePolicies: [...requiredStatePolicies],
    capturedStatePolicies,
    missingStatePolicies,
    labelCount: labels.length,
    usableLabelCount: usableLabels.length,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio: usableLabels.length === 0 ? 1 : neutralUsableLabelCount / usableLabels.length
  };
}

function buildLnsReplayLabelSplitScaleReadiness<Split extends string>(
  split: LnsReplayLabelScaleSplitInput<Split>,
  thresholds: LnsReplayLabelScaleThresholds
): LnsReplayLabelSplitScaleReadiness<Split> {
  const requiredStatePolicies = [...(thresholds.requiredStatePolicies ?? [])];
  const families = [
    ...groupBenchmarkValuesBy(split.replay.cases, (benchmarkCase) => benchmarkCase.pressureFamily).entries()
  ]
    .map(([pressureFamily, cases]) => summarizeLnsReplayFamily(pressureFamily, cases, requiredStatePolicies))
    .sort((left, right) => left.pressureFamily.localeCompare(right.pressureFamily));
  const usableLabelCount = sumBenchmarkBy(families, (family) => family.usableLabelCount);
  const nonNeutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.nonNeutralUsableLabelCount);
  const neutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.neutralUsableLabelCount);
  const neutralLabelRatio = usableLabelCount === 0 ? 1 : neutralUsableLabelCount / usableLabelCount;
  const capturedStatePolicies = uniqueBenchmarkValues(
    split.replay.cases
      .map((benchmarkCase) => benchmarkCase.statePolicy)
      .filter((statePolicy): statePolicy is LnsWindowReplayStatePolicy => statePolicy !== undefined)
  ) as LnsWindowReplayStatePolicy[];
  const capturedStatePolicySet = new Set(capturedStatePolicies);
  const missingStatePolicies = requiredStatePolicies.filter((statePolicy) => !capturedStatePolicySet.has(statePolicy));
  const failedReasons: string[] = [];

  if (families.length < thresholds.minPressureFamilies) {
    failedReasons.push(`pressure-families ${families.length}/${thresholds.minPressureFamilies}`);
  }
  if (usableLabelCount < thresholds.minUsableLabelsPerSplit) {
    failedReasons.push(`usable-labels ${usableLabelCount}/${thresholds.minUsableLabelsPerSplit}`);
  }
  if (nonNeutralUsableLabelCount < thresholds.minNonNeutralLabelsPerSplit) {
    failedReasons.push(`non-neutral-labels ${nonNeutralUsableLabelCount}/${thresholds.minNonNeutralLabelsPerSplit}`);
  }
  if (neutralLabelRatio > thresholds.maxNeutralLabelRatio) {
    failedReasons.push(`neutral-ratio ${neutralLabelRatio.toFixed(3)}/${thresholds.maxNeutralLabelRatio}`);
  }
  if (missingStatePolicies.length > 0) {
    failedReasons.push(`state-policies missing:${missingStatePolicies.join(",")}`);
  }
  for (const family of families) {
    if (family.seeds.length < thresholds.minSeedsPerFamily) {
      failedReasons.push(`${family.pressureFamily} seeds ${family.seeds.length}/${thresholds.minSeedsPerFamily}`);
    }
    if (family.usableLabelCount < thresholds.minUsableLabelsPerFamily) {
      failedReasons.push(
        `${family.pressureFamily} usable-labels ${family.usableLabelCount}/${thresholds.minUsableLabelsPerFamily}`
      );
    }
    if (family.missingStatePolicies.length > 0) {
      failedReasons.push(`${family.pressureFamily} state-policies missing:${family.missingStatePolicies.join(",")}`);
    }
  }

  return {
    split: split.split,
    pressureFamilyCount: families.length,
    seedCount: split.seeds.length,
    requiredStatePolicies,
    capturedStatePolicies,
    missingStatePolicies,
    usableLabelCount,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio,
    passed: failedReasons.length === 0,
    failedReasons,
    families
  };
}

export function buildLnsReplayLabelScaleReadiness<Split extends string>(
  splits: readonly LnsReplayLabelScaleSplitInput<Split>[],
  thresholds: LnsReplayLabelScaleThresholds = DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS
): LnsReplayLabelScaleReadiness<Split> {
  const splitReadiness = splits.map((split) => buildLnsReplayLabelSplitScaleReadiness(split, thresholds));
  return {
    thresholds: {
      ...thresholds,
      requiredStatePolicies: [...(thresholds.requiredStatePolicies ?? [])]
    },
    passed: splitReadiness.length > 0 && splitReadiness.every((split) => split.passed),
    splitReadiness
  };
}
