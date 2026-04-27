export const MAX_BENCHMARK_RANDOM_SEED = 0x7fffffff;

export function normalizeBenchmarkSeeds(
  seeds: readonly number[] | undefined,
  label: string
): number[] | undefined {
  if (!seeds?.length) return undefined;
  const invalid = seeds.filter(
    (value) =>
      !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < 0
      || value > MAX_BENCHMARK_RANDOM_SEED
  );
  if (invalid.length > 0) {
    throw new Error(`${label} must contain only integer seeds between 0 and ${MAX_BENCHMARK_RANDOM_SEED}.`);
  }
  if (new Set(seeds).size !== seeds.length) {
    throw new Error(`${label} must not contain duplicate seeds.`);
  }
  return [...seeds];
}

export function formatBenchmarkSeeds(seeds: readonly number[]): string {
  return seeds.length ? seeds.join(", ") : "case-default";
}
