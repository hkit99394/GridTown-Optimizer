import type { CrossModeBenchmarkMode, CrossModeBenchmarkModeResult } from "./crossMode.js";

export function compareModeResults(left: CrossModeBenchmarkModeResult, right: CrossModeBenchmarkModeResult): number {
  if (left.totalPopulation !== right.totalPopulation) return right.totalPopulation - left.totalPopulation;
  if (left.wallClockSeconds !== right.wallClockSeconds) return left.wallClockSeconds - right.wallClockSeconds;
  return left.mode.localeCompare(right.mode);
}

export function rankResults(results: CrossModeBenchmarkModeResult[]): CrossModeBenchmarkModeResult[] {
  const sorted = [...results].sort(compareModeResults);
  const rankByMode = new Map<CrossModeBenchmarkMode, number>();
  let last: CrossModeBenchmarkModeResult | null = null;
  let lastRank = 0;
  for (const [index, result] of sorted.entries()) {
    const rank =
      last && result.totalPopulation === last.totalPopulation && result.wallClockSeconds === last.wallClockSeconds
        ? lastRank
        : index + 1;
    rankByMode.set(result.mode, rank);
    last = result;
    lastRank = rank;
  }
  return results.map((result) => ({
    ...result,
    rank: rankByMode.get(result.mode) ?? result.rank
  }));
}
