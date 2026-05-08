import type {
  LnsWindowReplayFeatures,
  LnsWindowReplayLabel,
  LnsWindowReplayRollForwardOutcome,
  LnsWindowReplayRollForwardStatus,
  LnsWindowReplaySuiteResult
} from "./lnsWindowReplayTypes.js";

export type LnsWindowReplayRepeatabilityLabel = Pick<
  LnsWindowReplayLabel,
  "caseName" | "pressureFamily" | "seed" | "statePolicy" | "operator" | "window" | "features"
> & {
  rollForward?: LnsWindowReplayRollForwardOutcome;
};

export interface LnsWindowReplayRepeatabilityInput {
  cases: readonly {
    labels: readonly LnsWindowReplayRepeatabilityLabel[];
  }[];
}

export interface LnsWindowReplayRepeatabilityStatusCounts {
  improved: number;
  neutral: number;
  regressed: number;
  unknown: number;
}

export interface LnsWindowReplayRepeatabilityBucketSummary {
  caseName: string;
  pressureFamily: string;
  statePolicy: string;
  operator: string;
  window: string;
  labelCount: number;
  seedCount: number;
  seeds: number[];
  statusCounts: LnsWindowReplayRepeatabilityStatusCounts;
  finalDeltas: number[];
  baselineTotals: number[];
  totalPopulations: number[];
  featureFingerprintCount: number;
}

export interface LnsWindowReplayRepeatabilitySummary {
  schemaVersion: 1;
  rollForwardLabelCount: number;
  bucketCount: number;
  repeatedBucketCount: number;
  mixedFinalStatusBucketCount: number;
  conflictingFinalStatusBucketCount: number;
  conflictingLabelCount: number;
  conflictingStatusCounts: LnsWindowReplayRepeatabilityStatusCounts;
  featureIdenticalConflictBucketCount: number;
  featureIdenticalConflictLabelCount: number;
  examples: LnsWindowReplayRepeatabilityBucketSummary[];
}

export interface LnsWindowReplayRepeatabilityConflictIndex {
  summary: LnsWindowReplayRepeatabilitySummary;
  conflictingBucketKeys: string[];
  featureIdenticalConflictBucketKeys: string[];
}

interface RepeatabilityBucket {
  key: string;
  caseName: string;
  pressureFamily: string;
  statePolicy: string;
  operator: string;
  window: string;
  labelCount: number;
  seeds: Set<number>;
  statusCounts: LnsWindowReplayRepeatabilityStatusCounts;
  finalDeltas: Set<number>;
  baselineTotals: Set<number>;
  totalPopulations: Set<number>;
  featureFingerprints: Set<string>;
}

function emptyStatusCounts(): LnsWindowReplayRepeatabilityStatusCounts {
  return { improved: 0, neutral: 0, regressed: 0, unknown: 0 };
}

function cloneStatusCounts(counts: LnsWindowReplayRepeatabilityStatusCounts): LnsWindowReplayRepeatabilityStatusCounts {
  return {
    improved: counts.improved,
    neutral: counts.neutral,
    regressed: counts.regressed,
    unknown: counts.unknown
  };
}

function addStatusCount(
  counts: LnsWindowReplayRepeatabilityStatusCounts,
  status: LnsWindowReplayRollForwardStatus
): void {
  counts[status] += 1;
}

function addStatusCounts(
  target: LnsWindowReplayRepeatabilityStatusCounts,
  source: LnsWindowReplayRepeatabilityStatusCounts
): void {
  target.improved += source.improved;
  target.neutral += source.neutral;
  target.regressed += source.regressed;
  target.unknown += source.unknown;
}

function nonZeroStatusCount(counts: LnsWindowReplayRepeatabilityStatusCounts): number {
  return [counts.improved, counts.neutral, counts.regressed, counts.unknown].filter((value) => value > 0).length;
}

function formatWindow(label: Pick<LnsWindowReplayRepeatabilityLabel, "window">): string {
  const { window } = label;
  return `${window.top}:${window.left}:${window.rows}x${window.cols}`;
}

function sortedNumberValues(values: Iterable<number>): number[] {
  return [...values].sort((left, right) => left - right);
}

function sortedNullableNumberValues(values: Iterable<number | null>): number[] {
  return [...values].filter((value): value is number => value !== null).sort((left, right) => left - right);
}

function sortedRecordEntries(record: Record<string, number>): [string, number][] {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function featureFingerprint(features: LnsWindowReplayFeatures): string {
  return JSON.stringify({
    schemaVersion: features.schemaVersion,
    area: features.area,
    touchesRoadAnchorBoundary: features.touchesRoadAnchorBoundary,
    roadCountInside: features.roadCountInside,
    serviceCountInside: features.serviceCountInside,
    residentialCountInside: features.residentialCountInside,
    residentialHeadroomInside: features.residentialHeadroomInside,
    serviceBonusInside: features.serviceBonusInside,
    selectedByBaseline: features.selectedByBaseline,
    connectivityShadow: features.connectivityShadow,
    fragmentation: features.fragmentation,
    candidateLoss: {
      ...features.candidateLoss,
      serviceTypeCounts: sortedRecordEntries(features.candidateLoss.serviceTypeCounts),
      residentialTypeCounts: sortedRecordEntries(features.candidateLoss.residentialTypeCounts)
    }
  });
}

export function lnsWindowReplayRepeatabilityBucketKey(label: LnsWindowReplayRepeatabilityLabel): string {
  return [label.caseName, label.statePolicy, label.operator, formatWindow(label)].join("\0");
}

function bucketSummary(bucket: RepeatabilityBucket): LnsWindowReplayRepeatabilityBucketSummary {
  return {
    caseName: bucket.caseName,
    pressureFamily: bucket.pressureFamily,
    statePolicy: bucket.statePolicy,
    operator: bucket.operator,
    window: bucket.window,
    labelCount: bucket.labelCount,
    seedCount: bucket.seeds.size,
    seeds: sortedNumberValues(bucket.seeds),
    statusCounts: cloneStatusCounts(bucket.statusCounts),
    finalDeltas: sortedNullableNumberValues(bucket.finalDeltas),
    baselineTotals: sortedNullableNumberValues(bucket.baselineTotals),
    totalPopulations: sortedNumberValues(bucket.totalPopulations),
    featureFingerprintCount: bucket.featureFingerprints.size
  };
}

function compareBucketSummaries(
  left: LnsWindowReplayRepeatabilityBucketSummary,
  right: LnsWindowReplayRepeatabilityBucketSummary
): number {
  const leftNonNeutral = left.statusCounts.improved + left.statusCounts.regressed;
  const rightNonNeutral = right.statusCounts.improved + right.statusCounts.regressed;
  return (
    rightNonNeutral - leftNonNeutral ||
    right.labelCount - left.labelCount ||
    right.statusCounts.regressed - left.statusCounts.regressed ||
    right.statusCounts.improved - left.statusCounts.improved ||
    left.caseName.localeCompare(right.caseName) ||
    left.statePolicy.localeCompare(right.statePolicy) ||
    left.operator.localeCompare(right.operator) ||
    left.window.localeCompare(right.window)
  );
}

export function summarizeLnsWindowReplayRepeatability(
  result: LnsWindowReplaySuiteResult | LnsWindowReplayRepeatabilityInput
): LnsWindowReplayRepeatabilitySummary {
  return buildLnsWindowReplayRepeatabilityConflictIndex(result).summary;
}

export function buildLnsWindowReplayRepeatabilityConflictIndex(
  result: LnsWindowReplaySuiteResult | LnsWindowReplayRepeatabilityInput
): LnsWindowReplayRepeatabilityConflictIndex {
  const buckets = new Map<string, RepeatabilityBucket>();
  let rollForwardLabelCount = 0;

  for (const benchmarkCase of result.cases) {
    for (const label of benchmarkCase.labels) {
      const rollForward = label.rollForward;
      if (!rollForward) continue;
      rollForwardLabelCount += 1;
      const key = lnsWindowReplayRepeatabilityBucketKey(label);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          caseName: label.caseName,
          pressureFamily: label.pressureFamily,
          statePolicy: label.statePolicy,
          operator: label.operator,
          window: formatWindow(label),
          labelCount: 0,
          seeds: new Set<number>(),
          statusCounts: emptyStatusCounts(),
          finalDeltas: new Set<number>(),
          baselineTotals: new Set<number>(),
          totalPopulations: new Set<number>(),
          featureFingerprints: new Set<string>()
        };
        buckets.set(key, bucket);
      }
      bucket.labelCount += 1;
      if (label.seed !== null) bucket.seeds.add(label.seed);
      addStatusCount(bucket.statusCounts, rollForward.statusVsBaseline);
      if (rollForward.populationDeltaVsBaseline !== null) bucket.finalDeltas.add(rollForward.populationDeltaVsBaseline);
      if (rollForward.baselineTotalPopulation !== null) bucket.baselineTotals.add(rollForward.baselineTotalPopulation);
      bucket.totalPopulations.add(rollForward.totalPopulation);
      bucket.featureFingerprints.add(featureFingerprint(label.features));
    }
  }

  let repeatedBucketCount = 0;
  let mixedFinalStatusBucketCount = 0;
  let conflictingFinalStatusBucketCount = 0;
  let conflictingLabelCount = 0;
  const conflictingStatusCounts = emptyStatusCounts();
  let featureIdenticalConflictBucketCount = 0;
  let featureIdenticalConflictLabelCount = 0;
  const conflictingBucketKeys: string[] = [];
  const featureIdenticalConflictBucketKeys: string[] = [];
  const examples: LnsWindowReplayRepeatabilityBucketSummary[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.labelCount > 1) repeatedBucketCount += 1;
    if (nonZeroStatusCount(bucket.statusCounts) > 1) mixedFinalStatusBucketCount += 1;
    const conflicting = bucket.statusCounts.improved > 0 && bucket.statusCounts.regressed > 0;
    if (!conflicting) continue;
    conflictingFinalStatusBucketCount += 1;
    conflictingLabelCount += bucket.labelCount;
    conflictingBucketKeys.push(bucket.key);
    addStatusCounts(conflictingStatusCounts, bucket.statusCounts);
    if (bucket.featureFingerprints.size === 1) {
      featureIdenticalConflictBucketCount += 1;
      featureIdenticalConflictLabelCount += bucket.labelCount;
      featureIdenticalConflictBucketKeys.push(bucket.key);
    }
    examples.push(bucketSummary(bucket));
  }

  return {
    summary: {
      schemaVersion: 1,
      rollForwardLabelCount,
      bucketCount: buckets.size,
      repeatedBucketCount,
      mixedFinalStatusBucketCount,
      conflictingFinalStatusBucketCount,
      conflictingLabelCount,
      conflictingStatusCounts,
      featureIdenticalConflictBucketCount,
      featureIdenticalConflictLabelCount,
      examples: examples.sort(compareBucketSummaries).slice(0, 12)
    },
    conflictingBucketKeys: conflictingBucketKeys.sort(),
    featureIdenticalConflictBucketKeys: featureIdenticalConflictBucketKeys.sort()
  };
}

function formatStatusCounts(counts: LnsWindowReplayRepeatabilityStatusCounts): string {
  return `improved:${counts.improved} neutral:${counts.neutral} regressed:${counts.regressed} unknown:${counts.unknown}`;
}

export function formatLnsWindowReplayRepeatabilitySummary(summary: LnsWindowReplayRepeatabilitySummary): string {
  const lines = [
    `Repeatability: roll-forward-labels=${summary.rollForwardLabelCount} buckets=${summary.bucketCount} repeated=${summary.repeatedBucketCount} mixed=${summary.mixedFinalStatusBucketCount} conflicting=${summary.conflictingFinalStatusBucketCount} feature-identical-conflicts=${summary.featureIdenticalConflictBucketCount} conflict-labels=${summary.conflictingLabelCount} conflict-status=${formatStatusCounts(summary.conflictingStatusCounts)}`
  ];
  for (const example of summary.examples.slice(0, 5)) {
    lines.push(
      `- repeatability conflict ${example.caseName} state=${example.statePolicy} operator=${example.operator} window=${example.window} labels=${example.labelCount} seeds=${example.seeds.join(",") || "case-default"} status=${formatStatusCounts(example.statusCounts)} final-deltas=${example.finalDeltas.map((value) => (value > 0 ? `+${value}` : String(value))).join(",") || "n/a"} baseline-totals=${example.baselineTotals.join(",") || "n/a"} totals=${example.totalPopulations.join(",") || "n/a"} feature-fingerprints=${example.featureFingerprintCount}`
    );
  }
  return lines.join("\n");
}
