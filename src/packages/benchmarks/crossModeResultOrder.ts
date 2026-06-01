import type { CrossModeBenchmarkMode, CrossModeBenchmarkModeResult } from "./crossMode.js";

const MODE_RESULT_ORDER: Record<CrossModeBenchmarkMode, number> = {
  auto: 0,
  greedy: 1,
  lns: 2,
  "cp-sat": 3,
  "cp-sat-portfolio": 4
};

export function compareModeResults(left: CrossModeBenchmarkModeResult, right: CrossModeBenchmarkModeResult): number {
  if (left.totalPopulation !== right.totalPopulation) return right.totalPopulation - left.totalPopulation;
  return MODE_RESULT_ORDER[left.mode] - MODE_RESULT_ORDER[right.mode];
}

export function rankResults(results: CrossModeBenchmarkModeResult[]): CrossModeBenchmarkModeResult[] {
  const sorted = [...results].sort(compareModeResults);
  const rankByMode = new Map<CrossModeBenchmarkMode, number>();
  let last: CrossModeBenchmarkModeResult | null = null;
  let lastRank = 0;
  for (const [index, result] of sorted.entries()) {
    const rank = last && result.totalPopulation === last.totalPopulation ? lastRank : index + 1;
    rankByMode.set(result.mode, rank);
    last = result;
    lastRank = rank;
  }
  return results.map((result) => ({
    ...result,
    rank: rankByMode.get(result.mode) ?? result.rank
  }));
}
