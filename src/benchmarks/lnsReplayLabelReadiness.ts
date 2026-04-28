import {
  countBenchmarkMatches,
  sumBenchmarkBy,
  uniqueBenchmarkValues,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";

import type { LnsReplayPressureFamilyLabel } from "./lns.js";
import type {
  LnsWindowReplaySnapshot,
  LnsWindowReplaySnapshotLabel,
} from "./lnsWindowReplayLabels.js";

export interface LnsReplayLabelScaleThresholds {
  minPressureFamilies: number;
  minSeedsPerFamily: number;
  minUsableLabelsPerSplit: number;
  minNonNeutralLabelsPerSplit: number;
  minUsableLabelsPerFamily: number;
  maxNeutralLabelRatio: number;
}

export interface LnsReplayLabelFamilyScaleSummary {
  pressureFamily: LnsReplayPressureFamilyLabel;
  caseNames: string[];
  seeds: number[];
  labelCount: number;
  usableLabelCount: number;
  nonNeutralUsableLabelCount: number;
  neutralUsableLabelCount: number;
  neutralLabelRatio: number;
}

export interface LnsReplayLabelScaleSplitInput<Split extends string = string> {
  split: Split;
  seeds: readonly number[];
  replay: LnsWindowReplaySnapshot;
}

export interface LnsReplayLabelSplitScaleReadiness<Split extends string = string> {
  split: Split;
  pressureFamilyCount: number;
  seedCount: number;
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
});

function lnsLabelIsNonNeutral(label: LnsWindowReplaySnapshotLabel): boolean {
  return label.usable && (label.status === "improved" || label.status === "regressed");
}

function summarizeLnsReplayFamily(
  pressureFamily: LnsReplayPressureFamilyLabel,
  cases: readonly LnsWindowReplaySnapshot["cases"][number][]
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

  return {
    pressureFamily,
    caseNames: uniqueBenchmarkValuesBy(cases, (benchmarkCase) => benchmarkCase.name),
    seeds,
    labelCount: labels.length,
    usableLabelCount: usableLabels.length,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio: usableLabels.length === 0 ? 1 : neutralUsableLabelCount / usableLabels.length,
  };
}

function buildLnsReplayLabelSplitScaleReadiness<Split extends string>(
  split: LnsReplayLabelScaleSplitInput<Split>,
  thresholds: LnsReplayLabelScaleThresholds
): LnsReplayLabelSplitScaleReadiness<Split> {
  const familyCases = new Map<LnsReplayPressureFamilyLabel, LnsWindowReplaySnapshot["cases"][number][]>();
  for (const benchmarkCase of split.replay.cases) {
    const pressureFamily = benchmarkCase.pressureFamily;
    const cases = familyCases.get(pressureFamily) ?? [];
    cases.push(benchmarkCase);
    familyCases.set(pressureFamily, cases);
  }

  const families = [...familyCases.entries()]
    .map(([pressureFamily, cases]) => summarizeLnsReplayFamily(pressureFamily, cases))
    .sort((left, right) => left.pressureFamily.localeCompare(right.pressureFamily));
  const usableLabelCount = sumBenchmarkBy(families, (family) => family.usableLabelCount);
  const nonNeutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.nonNeutralUsableLabelCount);
  const neutralUsableLabelCount = sumBenchmarkBy(families, (family) => family.neutralUsableLabelCount);
  const neutralLabelRatio = usableLabelCount === 0 ? 1 : neutralUsableLabelCount / usableLabelCount;
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
  for (const family of families) {
    if (family.seeds.length < thresholds.minSeedsPerFamily) {
      failedReasons.push(`${family.pressureFamily} seeds ${family.seeds.length}/${thresholds.minSeedsPerFamily}`);
    }
    if (family.usableLabelCount < thresholds.minUsableLabelsPerFamily) {
      failedReasons.push(`${family.pressureFamily} usable-labels ${family.usableLabelCount}/${thresholds.minUsableLabelsPerFamily}`);
    }
  }

  return {
    split: split.split,
    pressureFamilyCount: families.length,
    seedCount: split.seeds.length,
    usableLabelCount,
    nonNeutralUsableLabelCount,
    neutralUsableLabelCount,
    neutralLabelRatio,
    passed: failedReasons.length === 0,
    failedReasons,
    families,
  };
}

export function buildLnsReplayLabelScaleReadiness<Split extends string>(
  splits: readonly LnsReplayLabelScaleSplitInput<Split>[],
  thresholds: LnsReplayLabelScaleThresholds = DEFAULT_LNS_REPLAY_LABEL_SCALE_THRESHOLDS
): LnsReplayLabelScaleReadiness<Split> {
  const splitReadiness = splits.map((split) => buildLnsReplayLabelSplitScaleReadiness(split, thresholds));
  return {
    thresholds: { ...thresholds },
    passed: splitReadiness.length > 0 && splitReadiness.every((split) => split.passed),
    splitReadiness,
  };
}
