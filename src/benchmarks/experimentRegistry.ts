import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const EXPERIMENT_REGISTRY_SCHEMA_VERSION = 1;
export const DEFAULT_EXPERIMENT_REGISTRY_PATH = "artifacts/experiments/index.jsonl";
export const EXPERIMENT_REGISTRY_ARTIFACT_TYPES = [
  "benchmark",
  "label-bundle",
  "ablation-gate",
  "health-check",
  "model-experiment",
  "portfolio-scorecard",
] as const;

export type ExperimentRegistryArtifactType = typeof EXPERIMENT_REGISTRY_ARTIFACT_TYPES[number];
export type ExperimentRegistryCases = string[] | Record<string, string[]> | null;

export interface ExperimentRegistryEntry {
  schemaVersion: 1;
  runId: string;
  artifactType: ExperimentRegistryArtifactType;
  generatedAt: string;
  indexedAt: string;
  indexedGitCommit: string;
  branch: string;
  artifactGitCommit: string | null;
  commands: string[];
  artifactPaths: string[];
  cases: ExperimentRegistryCases;
  caseFamilies: string[] | null;
  seeds: number[];
  splitStatus: Record<string, unknown> | null;
  budget: Record<string, unknown>;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  model: Record<string, unknown> | null;
  decision: string;
  summary: string;
  datasetFingerprint?: string;
  inputFingerprint?: string;
  labelFingerprint?: string;
  modelFingerprint?: string;
  solverParams?: Record<string, unknown>;
  summaryMetrics?: Record<string, unknown>;
}

export interface ExperimentRegistryIssue {
  code: string;
  message: string;
  lineNumber?: number;
  runId?: string;
  field?: string;
  severity?: "error" | "warning";
}

export interface ExperimentRegistryCheckOptions {
  rootDir?: string;
  cwd?: string;
  validateArtifactPaths?: boolean;
  checkArtifactPaths?: boolean;
  strict?: boolean;
  strictMetadata?: boolean;
  gitMetadata?: {
    commit: string;
    branch: string;
  };
  now?: Date;
}

export interface ExperimentRegistryCheckResult {
  valid: boolean;
  entries: ExperimentRegistryEntry[];
  issues: ExperimentRegistryIssue[];
}

export interface ExperimentRegistryValidationResult extends ExperimentRegistryCheckResult {
  errorCount: number;
  warningCount: number;
}

export interface ExperimentRegistryCompletionMetadata {
  indexedAt: string;
  indexedGitCommit: string;
  branch: string;
  generatedAt?: string;
  artifactGitCommit?: string | null;
  hardware?: Record<string, unknown> & { captured: boolean; gpuUsed: boolean };
}

export class ExperimentRegistryValidationError extends Error {
  readonly issues: ExperimentRegistryIssue[];

  constructor(message: string, issues: ExperimentRegistryIssue[]) {
    super(message);
    this.name = "ExperimentRegistryValidationError";
    this.issues = issues;
  }
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateLike(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeCheckOptions(options: ExperimentRegistryCheckOptions = {}): Required<Pick<ExperimentRegistryCheckOptions, "rootDir" | "validateArtifactPaths" | "strict">> {
  return {
    rootDir: options.rootDir ?? options.cwd ?? process.cwd(),
    validateArtifactPaths: options.validateArtifactPaths ?? options.checkArtifactPaths ?? true,
    strict: options.strict ?? options.strictMetadata ?? false,
  };
}

function issue(
  issues: ExperimentRegistryIssue[],
  code: string,
  message: string,
  options: Pick<ExperimentRegistryIssue, "lineNumber" | "runId" | "field" | "severity"> = {}
): void {
  issues.push({ code, message, ...options });
}

function validateRequiredString(
  entry: Record<string, unknown>,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (!hasOwn(entry, key)) {
    issue(issues, "missing-field", `Missing required field '${key}'.`, { lineNumber, runId, field: key });
    return;
  }
  if (!isNonEmptyString(entry[key])) {
    issue(issues, "invalid-field", `Field '${key}' must be a non-empty string.`, { lineNumber, runId, field: key });
  }
}

function validateDateField(
  entry: Record<string, unknown>,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  validateRequiredString(entry, key, issues, lineNumber, runId);
  if (isNonEmptyString(entry[key]) && !isValidDateLike(entry[key] as string)) {
    issue(issues, "invalid-date", `Field '${key}' must be a parseable date or timestamp.`, { lineNumber, runId, field: key });
  }
}

function validateCommitField(
  entry: Record<string, unknown>,
  key: string,
  nullable: boolean,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (!hasOwn(entry, key)) {
    issue(issues, "missing-field", `Missing required field '${key}'.`, { lineNumber, runId, field: key });
    return;
  }
  const value = entry[key];
  if (nullable && value === null) return;
  if (!isNonEmptyString(value) || !COMMIT_SHA_PATTERN.test(value)) {
    issue(issues, "invalid-commit", `Field '${key}' must be a 40-character lowercase git commit SHA${nullable ? " or null" : ""}.`, {
      lineNumber,
      runId,
      field: key,
    });
  }
}

function validateStringList(
  value: unknown,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string,
  options: { allowEmpty?: boolean } = {}
): value is string[] {
  if (!Array.isArray(value)) {
    issue(issues, "invalid-field", `Field '${key}' must be an array.`, { lineNumber, runId, field: key });
    return false;
  }
  if (!options.allowEmpty && value.length === 0) {
    issue(issues, "invalid-field", `Field '${key}' must contain at least one entry.`, { lineNumber, runId, field: key });
    return false;
  }
  const seen = new Set<string>();
  value.forEach((entryValue, index) => {
    if (!isNonEmptyString(entryValue)) {
      issue(issues, "invalid-field", `Field '${key}[${index}]' must be a non-empty string.`, {
        lineNumber,
        runId,
        field: key,
      });
      return;
    }
    if (seen.has(entryValue)) {
      issue(issues, "duplicate-value", `Field '${key}' contains duplicate value '${entryValue}'.`, {
        lineNumber,
        runId,
        field: key,
      });
    }
    seen.add(entryValue);
  });
  return true;
}

function validateArtifactPath(
  artifactPath: string,
  rootDir: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (path.isAbsolute(artifactPath)) {
    issue(issues, "invalid-artifact-path", `Artifact path '${artifactPath}' must be relative to the repository root.`, {
      lineNumber,
      runId,
      field: "artifactPaths",
    });
    return;
  }

  const normalized = path.normalize(artifactPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    issue(issues, "invalid-artifact-path", `Artifact path '${artifactPath}' must stay inside the repository root.`, {
      lineNumber,
      runId,
      field: "artifactPaths",
    });
    return;
  }

  if (!fs.existsSync(path.resolve(rootDir, normalized))) {
    issue(issues, "missing-artifact", `Artifact path '${artifactPath}' does not exist.`, {
      lineNumber,
      runId,
      field: "artifactPaths",
    });
  }
}

function validateCases(
  value: unknown,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): value is ExperimentRegistryCases {
  if (value === null) return true;
  if (Array.isArray(value)) {
    return validateStringList(value, "cases", issues, lineNumber, runId);
  }
  if (!isRecord(value)) {
    issue(issues, "invalid-field", "Field 'cases' must be null, an array, or a split-to-case-list object.", {
      lineNumber,
      runId,
      field: "cases",
    });
    return false;
  }

  const splitNames = Object.keys(value);
  if (splitNames.length === 0) {
    issue(issues, "invalid-field", "Field 'cases' split object must contain at least one split.", {
      lineNumber,
      runId,
      field: "cases",
    });
    return false;
  }
  let caseCount = 0;
  for (const splitName of splitNames) {
    if (!validateStringList(value[splitName], `cases.${splitName}`, issues, lineNumber, runId, { allowEmpty: true })) {
      return false;
    }
    caseCount += (value[splitName] as string[]).length;
  }
  if (caseCount === 0) {
    issue(issues, "invalid-field", "Field 'cases' split object must contain at least one case across all splits.", {
      lineNumber,
      runId,
      field: "cases",
    });
    return false;
  }
  return true;
}

function validateSeeds(
  value: unknown,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): value is number[] {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "invalid-field", "Field 'seeds' must be a non-empty array.", { lineNumber, runId, field: "seeds" });
    return false;
  }
  const seen = new Set<number>();
  value.forEach((seed, index) => {
    if (!Number.isSafeInteger(seed)) {
      issue(issues, "invalid-seed", `Field 'seeds[${index}]' must be a safe integer.`, { lineNumber, runId, field: "seeds" });
      return;
    }
    if (seen.has(seed)) {
      issue(issues, "duplicate-value", `Field 'seeds' contains duplicate value '${seed}'.`, { lineNumber, runId, field: "seeds" });
    }
    seen.add(seed);
  });
  return true;
}

function validateBudgetValue(
  value: unknown,
  fieldPath: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (value === null) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      issue(issues, "invalid-budget", `Budget field '${fieldPath}' must be a finite non-negative number.`, {
        lineNumber,
        runId,
        field: "budget",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      issue(issues, "invalid-budget", `Budget field '${fieldPath}' must not be an empty array.`, {
        lineNumber,
        runId,
        field: "budget",
      });
      return;
    }
    value.forEach((entryValue, index) => validateBudgetValue(entryValue, `${fieldPath}[${index}]`, issues, lineNumber, runId));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entryValue] of Object.entries(value)) {
      validateBudgetValue(entryValue, `${fieldPath}.${key}`, issues, lineNumber, runId);
    }
    return;
  }
  issue(issues, "invalid-budget", `Budget field '${fieldPath}' must contain numbers, arrays, objects, or null.`, {
    lineNumber,
    runId,
    field: "budget",
  });
}

function validateHardware(
  value: unknown,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): value is ExperimentRegistryEntry["hardware"] {
  if (!isRecord(value)) {
    issue(issues, "invalid-field", "Field 'hardware' must be an object.", { lineNumber, runId, field: "hardware" });
    return false;
  }
  if (typeof value.captured !== "boolean") {
    issue(issues, "invalid-hardware", "Field 'hardware.captured' must be a boolean.", { lineNumber, runId, field: "hardware" });
  }
  if (typeof value.gpuUsed !== "boolean") {
    issue(issues, "invalid-hardware", "Field 'hardware.gpuUsed' must be a boolean.", { lineNumber, runId, field: "hardware" });
  }
  if (value.captured === true) {
    if (!isNonEmptyString(value.cpuModel)) {
      issue(issues, "incomplete-hardware", "Captured hardware must include 'hardware.cpuModel'.", {
        lineNumber,
        runId,
        field: "hardware",
      });
    }
    const logicalCpuCount = value.logicalCpuCount ?? value.logicalCores;
    if (!Number.isSafeInteger(logicalCpuCount) || (logicalCpuCount as number) <= 0) {
      issue(issues, "incomplete-hardware", "Captured hardware must include a positive 'hardware.logicalCpuCount' or 'hardware.logicalCores'.", {
        lineNumber,
        runId,
        field: "hardware",
      });
    }
    if (typeof value.memoryBytes !== "number" && typeof value.memoryGb !== "number") {
      issue(issues, "incomplete-hardware", "Captured hardware must include 'hardware.memoryBytes' or 'hardware.memoryGb'.", {
        lineNumber,
        runId,
        field: "hardware",
      });
    }
    if (value.gpuUsed === true) {
      if (!isNonEmptyString(value.gpuModel)) {
        issue(issues, "incomplete-hardware", "GPU-backed runs must include 'hardware.gpuModel'.", {
          lineNumber,
          runId,
          field: "hardware",
        });
      }
      if (typeof value.gpuMemoryBytes !== "number" && typeof value.gpuMemoryGb !== "number") {
        issue(issues, "incomplete-hardware", "GPU-backed runs must include 'hardware.gpuMemoryBytes' or 'hardware.gpuMemoryGb'.", {
          lineNumber,
          runId,
          field: "hardware",
        });
      }
      if (!isNonEmptyString(value.gpuRuntime) && !isNonEmptyString(value.gpuDriver)) {
        issue(issues, "incomplete-hardware", "GPU-backed runs must include 'hardware.gpuRuntime' or 'hardware.gpuDriver'.", {
          lineNumber,
          runId,
          field: "hardware",
        });
      }
    }
  }
  return true;
}

function validateModel(
  value: unknown,
  entry: Record<string, unknown>,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): value is ExperimentRegistryEntry["model"] {
  if (value === null) return true;
  if (!isRecord(value)) {
    issue(issues, "invalid-field", "Field 'model' must be null or an object.", { lineNumber, runId, field: "model" });
    return false;
  }
  if (value.trained === true) {
    const hasVersion = isNonEmptyString(value.version);
    const hasFingerprint = isNonEmptyString(value.fingerprint) || isNonEmptyString(entry.modelFingerprint);
    const hasPath = isNonEmptyString(value.path) || isNonEmptyString(value.modelPath);
    if (!hasVersion && !hasFingerprint && !hasPath) {
      issue(issues, "incomplete-model", "Trained model entries must include a model version, fingerprint, or model path.", {
        lineNumber,
        runId,
        field: "model",
      });
    }
  }
  return true;
}

function validateOptionalFingerprint(
  entry: Record<string, unknown>,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (hasOwn(entry, key) && !isNonEmptyString(entry[key])) {
    issue(issues, "invalid-field", `Field '${key}' must be a non-empty string when present.`, { lineNumber, runId, field: key });
  }
}

function budgetHasFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.some((entryValue) => budgetHasFiniteNumber(entryValue));
  if (isRecord(value)) return Object.values(value).some((entryValue) => budgetHasFiniteNumber(entryValue));
  return false;
}

function validateStrictPromotionMetadata(
  entry: Record<string, unknown>,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (entry.artifactGitCommit === null) {
    issue(issues, "strict-missing-artifact-commit", "Strict registry checks require 'artifactGitCommit'.", {
      lineNumber,
      runId,
      field: "artifactGitCommit",
    });
  }

  if (Array.isArray(entry.commands) && entry.commands.some((command) => typeof command === "string" && command.includes("..."))) {
    issue(issues, "strict-abbreviated-command", "Strict registry checks require exact commands without ellipses.", {
      lineNumber,
      runId,
      field: "commands",
    });
  }

  if (isRecord(entry.budget) && !budgetHasFiniteNumber(entry.budget)) {
    issue(issues, "strict-missing-budget", "Strict registry checks require at least one finite budget or observed runtime value.", {
      lineNumber,
      runId,
      field: "budget",
    });
  }

  if (isRecord(entry.hardware) && entry.hardware.captured !== true) {
    issue(issues, "strict-missing-hardware", "hardware.captured is false; strict registry checks require captured hardware metadata.", {
      lineNumber,
      runId,
      field: "hardware",
    });
  }

  if ((entry.artifactType === "benchmark" || entry.artifactType === "label-bundle") && entry.splitStatus === null) {
    issue(issues, "strict-missing-split", `${entry.artifactType} entries must include splitStatus metadata.`, {
      lineNumber,
      runId,
      field: "splitStatus",
    });
  }

  if (entry.artifactType === "label-bundle" && entry.model === null) {
    issue(issues, "strict-missing-model", "label-bundle entries must include model metadata, even when no model was trained.", {
      lineNumber,
      runId,
      field: "model",
    });
  }
}

export function validateExperimentRegistryEntry(
  value: unknown,
  options: ExperimentRegistryCheckOptions & { lineNumber?: number } = {}
): { entry?: ExperimentRegistryEntry; issues: ExperimentRegistryIssue[] } {
  const issues: ExperimentRegistryIssue[] = [];
  const lineNumber = options.lineNumber;
  const normalizedOptions = normalizeCheckOptions(options);
  const rootDir = normalizedOptions.rootDir;
  const validateArtifactPaths = normalizedOptions.validateArtifactPaths;

  if (!isRecord(value)) {
    issue(issues, "invalid-json", "Registry line must be a JSON object.", { lineNumber });
    return { issues };
  }

  const runId = isNonEmptyString(value.runId) ? value.runId : undefined;

  if (value.schemaVersion !== EXPERIMENT_REGISTRY_SCHEMA_VERSION) {
    issue(issues, "invalid-schema-version", `Field 'schemaVersion' must be ${EXPERIMENT_REGISTRY_SCHEMA_VERSION}.`, {
      lineNumber,
      runId,
      field: "schemaVersion",
    });
  }

  validateRequiredString(value, "runId", issues, lineNumber, runId);
  validateRequiredString(value, "artifactType", issues, lineNumber, runId);
  if (isNonEmptyString(value.artifactType) && !EXPERIMENT_REGISTRY_ARTIFACT_TYPES.includes(value.artifactType as ExperimentRegistryArtifactType)) {
    issue(
      issues,
      "invalid-artifact-type",
      `Field 'artifactType' must be one of ${EXPERIMENT_REGISTRY_ARTIFACT_TYPES.join(", ")}.`,
      { lineNumber, runId, field: "artifactType" }
    );
  }
  validateDateField(value, "generatedAt", issues, lineNumber, runId);
  validateDateField(value, "indexedAt", issues, lineNumber, runId);
  validateCommitField(value, "indexedGitCommit", false, issues, lineNumber, runId);
  validateRequiredString(value, "branch", issues, lineNumber, runId);
  validateCommitField(value, "artifactGitCommit", true, issues, lineNumber, runId);

  if (!hasOwn(value, "commands")) {
    issue(issues, "missing-field", "Missing required field 'commands'.", { lineNumber, runId, field: "commands" });
  } else {
    validateStringList(value.commands, "commands", issues, lineNumber, runId);
  }

  if (!hasOwn(value, "artifactPaths")) {
    issue(issues, "missing-field", "Missing required field 'artifactPaths'.", { lineNumber, runId, field: "artifactPaths" });
  } else if (validateStringList(value.artifactPaths, "artifactPaths", issues, lineNumber, runId)) {
    if (validateArtifactPaths) {
      for (const artifactPath of value.artifactPaths as string[]) {
        validateArtifactPath(artifactPath, rootDir, issues, lineNumber, runId);
      }
    }
  }

  if (!hasOwn(value, "cases")) {
    issue(issues, "missing-field", "Missing required field 'cases'.", { lineNumber, runId, field: "cases" });
  } else {
    validateCases(value.cases, issues, lineNumber, runId);
  }

  if (!hasOwn(value, "caseFamilies")) {
    issue(issues, "missing-field", "Missing required field 'caseFamilies'.", { lineNumber, runId, field: "caseFamilies" });
  } else if (value.caseFamilies !== null) {
    validateStringList(value.caseFamilies, "caseFamilies", issues, lineNumber, runId);
  }

  if (hasOwn(value, "cases") && hasOwn(value, "caseFamilies") && value.cases === null && value.caseFamilies === null) {
    issue(issues, "incomplete-coverage", "At least one of 'cases' or 'caseFamilies' must be populated.", {
      lineNumber,
      runId,
      field: "cases",
    });
  }

  if (!hasOwn(value, "seeds")) {
    issue(issues, "missing-field", "Missing required field 'seeds'.", { lineNumber, runId, field: "seeds" });
  } else {
    validateSeeds(value.seeds, issues, lineNumber, runId);
  }

  if (!hasOwn(value, "splitStatus")) {
    issue(issues, "missing-field", "Missing required field 'splitStatus'.", { lineNumber, runId, field: "splitStatus" });
  } else if (value.splitStatus !== null && !isRecord(value.splitStatus)) {
    issue(issues, "invalid-field", "Field 'splitStatus' must be null or an object.", { lineNumber, runId, field: "splitStatus" });
  }

  if (!hasOwn(value, "budget")) {
    issue(issues, "missing-field", "Missing required field 'budget'.", { lineNumber, runId, field: "budget" });
  } else if (!isRecord(value.budget)) {
    issue(issues, "invalid-field", "Field 'budget' must be an object.", { lineNumber, runId, field: "budget" });
  } else {
    validateBudgetValue(value.budget, "budget", issues, lineNumber, runId);
  }

  if (!hasOwn(value, "hardware")) {
    issue(issues, "missing-field", "Missing required field 'hardware'.", { lineNumber, runId, field: "hardware" });
  } else {
    validateHardware(value.hardware, issues, lineNumber, runId);
  }

  if (!hasOwn(value, "model")) {
    issue(issues, "missing-field", "Missing required field 'model'.", { lineNumber, runId, field: "model" });
  } else {
    validateModel(value.model, value, issues, lineNumber, runId);
  }

  validateRequiredString(value, "decision", issues, lineNumber, runId);
  validateRequiredString(value, "summary", issues, lineNumber, runId);

  for (const fingerprintField of ["datasetFingerprint", "inputFingerprint", "labelFingerprint", "modelFingerprint"]) {
    validateOptionalFingerprint(value, fingerprintField, issues, lineNumber, runId);
  }

  if (hasOwn(value, "solverParams") && !isRecord(value.solverParams)) {
    issue(issues, "invalid-field", "Field 'solverParams' must be an object when present.", { lineNumber, runId, field: "solverParams" });
  }
  if (hasOwn(value, "summaryMetrics") && !isRecord(value.summaryMetrics)) {
    issue(issues, "invalid-field", "Field 'summaryMetrics' must be an object when present.", { lineNumber, runId, field: "summaryMetrics" });
  }

  if (normalizedOptions.strict === true) {
    validateStrictPromotionMetadata(value, issues, lineNumber, runId);
  }

  return {
    entry: issues.length === 0 ? value as unknown as ExperimentRegistryEntry : undefined,
    issues,
  };
}

export function checkExperimentRegistryContent(
  content: string,
  options: ExperimentRegistryCheckOptions = {}
): ExperimentRegistryCheckResult {
  const entries: ExperimentRegistryEntry[] = [];
  const issues: ExperimentRegistryIssue[] = [];
  const seenRunIds = new Map<string, number>();
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issue(issues, "malformed-json", `Line is not valid JSON: ${message}`, { lineNumber });
      return;
    }

    const runId = isRecord(parsed) && isNonEmptyString(parsed.runId) ? parsed.runId : undefined;
    if (runId !== undefined) {
      const previousLine = seenRunIds.get(runId);
      if (previousLine !== undefined) {
        issue(issues, "duplicate-run-id", `Duplicate runId '${runId}' also appears on line ${previousLine}.`, {
          lineNumber,
          runId,
          field: "runId",
        });
      } else {
        seenRunIds.set(runId, lineNumber);
      }
    }

    const validation = validateExperimentRegistryEntry(parsed, { ...options, lineNumber });
    issues.push(...validation.issues);
    if (validation.entry !== undefined) {
      entries.push(validation.entry);
    }
  });

  if (entries.length === 0 && issues.length === 0) {
    issue(issues, "empty-registry", "Experiment registry must contain at least one entry.");
  }

  return { valid: issues.length === 0, entries, issues };
}

export function checkExperimentRegistryFile(
  registryPath = DEFAULT_EXPERIMENT_REGISTRY_PATH,
  options: ExperimentRegistryCheckOptions = {}
): ExperimentRegistryCheckResult {
  const rootDir = normalizeCheckOptions(options).rootDir;
  const absolutePath = path.resolve(rootDir, registryPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  return checkExperimentRegistryContent(content, { ...options, rootDir });
}

export function formatExperimentRegistryIssues(issues: ExperimentRegistryIssue[]): string {
  return issues
    .map((entry) => {
      const location = entry.lineNumber !== undefined ? `line ${entry.lineNumber}` : "registry";
      const runId = entry.runId !== undefined ? ` ${entry.runId}` : "";
      return `${location}${runId}: [${entry.code}] ${entry.message}`;
    })
    .join("\n");
}

export function completeExperimentRegistryEntry(
  entry: Record<string, unknown>,
  metadata: ExperimentRegistryCompletionMetadata
): Record<string, unknown> {
  return {
    ...entry,
    schemaVersion: entry.schemaVersion ?? EXPERIMENT_REGISTRY_SCHEMA_VERSION,
    generatedAt: entry.generatedAt ?? metadata.generatedAt ?? metadata.indexedAt,
    indexedAt: entry.indexedAt ?? metadata.indexedAt,
    indexedGitCommit: entry.indexedGitCommit ?? metadata.indexedGitCommit,
    branch: entry.branch ?? metadata.branch,
    artifactGitCommit: entry.artifactGitCommit ?? metadata.artifactGitCommit ?? null,
    splitStatus: entry.splitStatus ?? null,
    hardware: entry.hardware ?? metadata.hardware ?? { captured: false, gpuUsed: false },
    model: entry.model ?? null,
  };
}

export function captureExperimentRegistryHardwareMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> & {
  captured: boolean;
  gpuUsed: boolean;
} {
  const cpus = os.cpus();
  const gpuUsed = overrides.gpuUsed === true || isNonEmptyString(overrides.gpuModel);
  return {
    captured: true,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpuCount: cpus.length,
    memoryBytes: os.totalmem(),
    totalMemoryBytes: os.totalmem(),
    gpuUsed,
    ...overrides,
  };
}

function execGitValue(args: string[], fallback: string): string {
  try {
    return childProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function indexDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function resolveExperimentRegistryGitMetadata(options: ExperimentRegistryCheckOptions = {}): {
  commit: string;
  branch: string;
} {
  if (options.gitMetadata !== undefined) {
    return options.gitMetadata;
  }
  return {
    commit: execGitValue(["rev-parse", "HEAD"], "0000000000000000000000000000000000000000"),
    branch: execGitValue(["branch", "--show-current"], "unknown"),
  };
}

export function buildExperimentRegistryEntry(
  entry: Record<string, unknown>,
  options: ExperimentRegistryCheckOptions = {}
): Record<string, unknown> {
  const now = options.now ?? new Date();
  const gitMetadata = resolveExperimentRegistryGitMetadata(options);
  return completeExperimentRegistryEntry(entry, {
    indexedAt: indexDate(now),
    indexedGitCommit: gitMetadata.commit,
    branch: gitMetadata.branch,
    artifactGitCommit: entry.artifactGitCommit === undefined ? gitMetadata.commit : entry.artifactGitCommit as string | null,
    hardware: captureExperimentRegistryHardwareMetadata(),
  });
}

function historicalWarningsForEntry(entry: ExperimentRegistryEntry, lineNumber?: number): ExperimentRegistryIssue[] {
  const warnings: ExperimentRegistryIssue[] = [];
  if (entry.artifactGitCommit === null) {
    issue(warnings, "historical-missing-artifact-commit", "artifactGitCommit is null; future promotion-grade entries should record the artifact commit.", {
      lineNumber,
      runId: entry.runId,
      field: "artifactGitCommit",
      severity: "warning",
    });
  }
  if (entry.hardware.captured === false) {
    issue(warnings, "historical-missing-hardware", "hardware.captured is false; future promotion-grade entries should record CPU/GPU metadata.", {
      lineNumber,
      runId: entry.runId,
      field: "hardware",
      severity: "warning",
    });
  }
  if (entry.commands.some((command) => command.includes("..."))) {
    issue(warnings, "historical-abbreviated-command", "commands include an ellipsis; future entries should record exact commands.", {
      lineNumber,
      runId: entry.runId,
      field: "commands",
      severity: "warning",
    });
  }
  return warnings;
}

function toValidationResult(entries: ExperimentRegistryEntry[], issues: ExperimentRegistryIssue[]): ExperimentRegistryValidationResult {
  const normalizedIssues = issues.map((entry) => ({
    ...entry,
    severity: entry.severity ?? "error" as const,
  }));
  const errorCount = normalizedIssues.filter((entry) => entry.severity !== "warning").length;
  const warningCount = normalizedIssues.length - errorCount;
  return {
    valid: errorCount === 0,
    entries,
    issues: normalizedIssues,
    errorCount,
    warningCount,
  };
}

export function validateExperimentRegistryEntries(
  entries: unknown[],
  options: ExperimentRegistryCheckOptions = {}
): ExperimentRegistryValidationResult {
  const normalizedOptions = normalizeCheckOptions(options);
  const validEntries: ExperimentRegistryEntry[] = [];
  const issues: ExperimentRegistryIssue[] = [];

  entries.forEach((entry, index) => {
    const validation = validateExperimentRegistryEntry(entry, {
      ...options,
      rootDir: normalizedOptions.rootDir,
      validateArtifactPaths: normalizedOptions.validateArtifactPaths,
      strict: normalizedOptions.strict,
      lineNumber: index + 1,
    });
    issues.push(...validation.issues.map((validationIssue) => ({ ...validationIssue, severity: validationIssue.severity ?? "error" as const })));
    if (validation.entry !== undefined) {
      validEntries.push(validation.entry);
      issues.push(...historicalWarningsForEntry(validation.entry, index + 1));
    }
  });

  return toValidationResult(validEntries, issues);
}

export function validateExperimentRegistryFile(
  registryPath = DEFAULT_EXPERIMENT_REGISTRY_PATH,
  options: ExperimentRegistryCheckOptions = {}
): ExperimentRegistryValidationResult {
  const normalizedOptions = normalizeCheckOptions(options);
  const absolutePath = path.resolve(normalizedOptions.rootDir, registryPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const check = checkExperimentRegistryContent(content, {
    ...options,
    rootDir: normalizedOptions.rootDir,
    validateArtifactPaths: normalizedOptions.validateArtifactPaths,
    strict: normalizedOptions.strict,
  });
  const issues = check.issues.map((entry) => ({ ...entry, severity: entry.severity ?? "error" as const }));
  check.entries.forEach((entry, index) => {
    issues.push(
      ...historicalWarningsForEntry(entry, index + 1).map((warning) => ({
        ...warning,
        severity: warning.severity ?? "warning" as const,
      }))
    );
  });
  return toValidationResult(check.entries, issues);
}

export function formatExperimentRegistryValidationReport(result: ExperimentRegistryValidationResult): string {
  if (result.issues.length === 0) {
    return `Experiment registry OK: ${result.entries.length} entr${result.entries.length === 1 ? "y" : "ies"}.`;
  }
  return result.issues
    .map((entry) => {
      const severity = entry.severity ?? "error";
      const location = entry.lineNumber !== undefined ? `line ${entry.lineNumber}` : "registry";
      const runId = entry.runId !== undefined ? ` ${entry.runId}` : "";
      return `${severity.toUpperCase()} ${location}${runId}: [${entry.code}] ${entry.message}`;
    })
    .join("\n");
}

export function appendExperimentRegistryEntry(
  registryPath: string,
  entry: unknown,
  options: ExperimentRegistryCheckOptions = {}
): ExperimentRegistryEntry {
  const rootDir = normalizeCheckOptions(options).rootDir;
  const absolutePath = path.resolve(rootDir, registryPath);
  const existingContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";

  if (existingContent.length > 0) {
    const existingCheck = checkExperimentRegistryContent(existingContent, {
      ...options,
      rootDir,
      strict: false,
      strictMetadata: false,
    });
    if (!existingCheck.valid) {
      throw new ExperimentRegistryValidationError("Existing experiment registry is invalid.", existingCheck.issues);
    }
  }

  const existingRunIds = new Set<string>();
  for (const existingLine of existingContent.split(/\r?\n/)) {
    if (existingLine.trim().length === 0) continue;
    const parsed = JSON.parse(existingLine) as unknown;
    if (isRecord(parsed) && isNonEmptyString(parsed.runId)) {
      existingRunIds.add(parsed.runId);
    }
  }

  if (!isRecord(entry)) {
    throw new ExperimentRegistryValidationError("Experiment registry entry is invalid.", [
      {
        code: "invalid-json",
        message: "Registry entry must be a JSON object.",
      },
    ]);
  }

  const completedEntry = buildExperimentRegistryEntry(entry, options);
  const validation = validateExperimentRegistryEntry(completedEntry, { ...options, rootDir });
  if (!validation.entry) {
    throw new ExperimentRegistryValidationError("Experiment registry entry is invalid.", validation.issues);
  }
  if (existingRunIds.has(validation.entry.runId)) {
    throw new ExperimentRegistryValidationError("Experiment registry entry duplicates an existing runId.", [
      {
        code: "duplicate-run-id",
        message: `Duplicate runId '${validation.entry.runId}' already exists in '${registryPath}'.`,
        runId: validation.entry.runId,
        field: "runId",
      },
    ]);
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const prefix = existingContent.length === 0 || existingContent.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(absolutePath, `${prefix}${JSON.stringify(validation.entry)}\n`);
  return validation.entry;
}
