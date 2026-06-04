import { benchmarkGeneratedAt } from "./benchmarkOptions.js";
import { hashString, stableStringify } from "../core/cpSatContinuation.js";
import {
  buildBenchmarkArtifactRunId,
  cloneBenchmarkArtifactPaths,
  cloneBenchmarkArtifactRecord
} from "./artifactMetadata.js";

export interface ModelExperimentTelemetryManifestOptions {
  command: string;
  generatedAt?: string;
  git?: {
    commit: string;
    branch: string;
  };
  hardware?: Record<string, unknown>;
  model: Record<string, unknown>;
  inputArtifacts?: readonly string[];
  outputArtifacts?: readonly string[];
  labelFingerprint?: string;
  datasetFingerprint?: string;
  modelFingerprint?: string;
  metrics?: Record<string, unknown>;
  notes?: string;
}

export interface ModelExperimentTelemetryManifest {
  schemaVersion: 1;
  source: "model-experiment";
  command: string;
  generatedAt: string;
  git: ModelExperimentTelemetryManifestOptions["git"] | null;
  hardware: Record<string, unknown>;
  model: Record<string, unknown>;
  inputArtifacts: string[];
  outputArtifacts: string[];
  labelFingerprint?: string;
  datasetFingerprint?: string;
  modelFingerprint: string;
  metrics: Record<string, unknown>;
  notes?: string;
}

export interface ModelExperimentRegistryEntryDraftOptions {
  runId?: string;
  commands: readonly string[];
  artifactPaths: readonly string[];
  generatedAt?: string;
  cases?: string[] | Record<string, string[]> | null;
  caseFamilies?: readonly string[] | null;
  seeds?: readonly number[];
  splitStatus?: Record<string, unknown> | null;
  budget?: Record<string, unknown>;
  model: Record<string, unknown>;
  decision?: string;
  summary?: string;
  labelFingerprint?: string;
  datasetFingerprint?: string;
  inputFingerprint?: string;
  modelFingerprint?: string;
  summaryMetrics?: Record<string, unknown>;
}

function assertNonEmptyStringList(values: readonly string[], label: string): void {
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`Model experiment ${label} must include at least one non-empty string.`);
  }
}

export function buildModelExperimentFingerprint(value: unknown): string {
  return `fnv1a:${hashString(stableStringify(value))}`;
}

export function buildModelExperimentTelemetryManifest(
  options: ModelExperimentTelemetryManifestOptions
): ModelExperimentTelemetryManifest {
  const generatedAt = options.generatedAt ?? benchmarkGeneratedAt();
  const model = cloneBenchmarkArtifactRecord(options.model);
  const modelFingerprint = options.modelFingerprint ?? buildModelExperimentFingerprint(model);
  return {
    schemaVersion: 1,
    source: "model-experiment",
    command: options.command,
    generatedAt,
    git: options.git ?? null,
    hardware: options.hardware ?? { captured: false, gpuUsed: false },
    model,
    inputArtifacts: cloneBenchmarkArtifactPaths(options.inputArtifacts ?? []),
    outputArtifacts: cloneBenchmarkArtifactPaths(options.outputArtifacts ?? []),
    ...(options.labelFingerprint === undefined ? {} : { labelFingerprint: options.labelFingerprint }),
    ...(options.datasetFingerprint === undefined ? {} : { datasetFingerprint: options.datasetFingerprint }),
    modelFingerprint,
    metrics: cloneBenchmarkArtifactRecord(options.metrics ?? {}),
    ...(options.notes === undefined ? {} : { notes: options.notes })
  };
}

export function buildModelExperimentRegistryEntryDraft(
  options: ModelExperimentRegistryEntryDraftOptions
): Record<string, unknown> {
  assertNonEmptyStringList([...options.commands], "commands");
  assertNonEmptyStringList([...options.artifactPaths], "artifact paths");
  const generatedAt = options.generatedAt ?? benchmarkGeneratedAt();
  const model = cloneBenchmarkArtifactRecord(options.model);
  const modelFingerprint = options.modelFingerprint ?? buildModelExperimentFingerprint(model);
  return {
    schemaVersion: 1,
    runId: options.runId ?? buildBenchmarkArtifactRunId("model-experiment", generatedAt),
    artifactType: "model-experiment",
    generatedAt,
    commands: cloneBenchmarkArtifactPaths(options.commands),
    artifactPaths: cloneBenchmarkArtifactPaths(options.artifactPaths),
    cases: options.cases ?? null,
    caseFamilies:
      options.caseFamilies === undefined || options.caseFamilies === null ? null : [...options.caseFamilies],
    seeds: [...(options.seeds ?? [])],
    splitStatus: options.splitStatus ?? null,
    budget: cloneBenchmarkArtifactRecord(options.budget ?? {}),
    model,
    decision: options.decision ?? "model-experiment-only",
    summary: options.summary ?? "Model experiment artifact; no solver default changed.",
    ...(options.labelFingerprint === undefined ? {} : { labelFingerprint: options.labelFingerprint }),
    ...(options.datasetFingerprint === undefined ? {} : { datasetFingerprint: options.datasetFingerprint }),
    ...(options.inputFingerprint === undefined ? {} : { inputFingerprint: options.inputFingerprint }),
    modelFingerprint,
    summaryMetrics: cloneBenchmarkArtifactRecord(options.summaryMetrics ?? {})
  };
}
