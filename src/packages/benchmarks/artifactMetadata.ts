export interface BenchmarkArtifactGitMetadata {
  commit: string;
  branch: string;
}

export interface BenchmarkArtifactRunMetadata {
  command: string;
  git: BenchmarkArtifactGitMetadata;
  hardware: Record<string, unknown>;
}

export function buildBenchmarkArtifactDateSlug(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10) || "unknown-date";
  return parsed.toISOString().slice(0, 10);
}

export function buildBenchmarkArtifactRunId(prefix: string, generatedAt: string, suffix?: string | null): string {
  const base = `${prefix}-${buildBenchmarkArtifactDateSlug(generatedAt)}`;
  return suffix ? `${base}-${suffix}` : base;
}

export function cloneBenchmarkArtifactPaths(paths: readonly string[]): string[] {
  return [...paths];
}

export function cloneBenchmarkArtifactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}
