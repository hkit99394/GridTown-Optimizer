import { computePopulationCapacityUpperBound } from "../core/index.js";
import { formatBenchmarkRate, formatNullableBenchmarkNumber, roundBenchmarkMetric } from "./benchmarkOptions.js";

import type { PopulationAttainmentMetrics } from "./benchmarkOptions.js";
import type { SolverParams } from "../core/index.js";

export interface BuildPopulationAttainmentOptions {
  totalPopulation: number;
  capacityUpperBound: number | null;
  elapsedSeconds?: number | null;
  baselinePopulation?: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue >= 0 ? numericValue : null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? roundBenchmarkMetric(numerator / denominator) : null;
}

function rawGapClosed(totalPopulation: number, baselinePopulation: number, capacityUpperBound: number): number | null {
  const remainingRoom = capacityUpperBound - baselinePopulation;
  if (remainingRoom <= 0) return null;
  return (totalPopulation - baselinePopulation) / remainingRoom;
}

export function buildPopulationAttainmentMetrics(
  options: BuildPopulationAttainmentOptions
): PopulationAttainmentMetrics {
  const capacityUpperBound = finiteNonNegativeNumber(options.capacityUpperBound);
  const totalPopulation = Math.max(0, options.totalPopulation);
  const baselinePopulation = finiteNumber(options.baselinePopulation);
  const elapsedSeconds = finiteNonNegativeNumber(options.elapsedSeconds);

  if (capacityUpperBound === null) {
    return {
      populationCapacityUpperBound: null,
      populationGapToCapacity: null,
      capacityUtilization: null,
      gapClosedVsZero: null,
      baselinePopulation,
      gapClosedVsBaseline: null,
      gapClosedPerSecond: null
    };
  }

  const rawGapClosedVsZero = rawGapClosed(totalPopulation, 0, capacityUpperBound);
  const gapClosedVsZero = rawGapClosedVsZero === null ? null : roundBenchmarkMetric(rawGapClosedVsZero);
  const rawGapClosedVsBaseline =
    baselinePopulation === null ? null : rawGapClosed(totalPopulation, baselinePopulation, capacityUpperBound);
  const gapClosedVsBaseline = rawGapClosedVsBaseline === null ? null : roundBenchmarkMetric(rawGapClosedVsBaseline);
  const closureForRate = rawGapClosedVsBaseline ?? rawGapClosedVsZero;
  return {
    populationCapacityUpperBound: capacityUpperBound,
    populationGapToCapacity: Math.max(0, roundBenchmarkMetric(capacityUpperBound - totalPopulation)),
    capacityUtilization: ratio(totalPopulation, capacityUpperBound),
    gapClosedVsZero,
    baselinePopulation,
    gapClosedVsBaseline,
    gapClosedPerSecond:
      elapsedSeconds !== null && elapsedSeconds > 0 && closureForRate !== null
        ? roundBenchmarkMetric(closureForRate / elapsedSeconds)
        : null
  };
}

export function buildPopulationAttainmentMetricsForParams(
  params: SolverParams,
  options: Omit<BuildPopulationAttainmentOptions, "capacityUpperBound">
): PopulationAttainmentMetrics {
  return buildPopulationAttainmentMetrics({
    ...options,
    capacityUpperBound: computePopulationCapacityUpperBound(params)
  });
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : formatBenchmarkRate(value);
}

function formatDecimal(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

export function formatPopulationAttainmentMetrics(metrics: PopulationAttainmentMetrics): string {
  return [
    `cap=${formatNullableBenchmarkNumber(metrics.populationCapacityUpperBound)}`,
    `gap=${formatNullableBenchmarkNumber(metrics.populationGapToCapacity)}`,
    `util=${formatRate(metrics.capacityUtilization)}`,
    `closed-zero=${formatRate(metrics.gapClosedVsZero)}`,
    `baseline=${formatNullableBenchmarkNumber(metrics.baselinePopulation)}`,
    `closed-baseline=${formatRate(metrics.gapClosedVsBaseline)}`,
    `closed/s=${formatDecimal(metrics.gapClosedPerSecond)}`
  ].join(" ");
}
