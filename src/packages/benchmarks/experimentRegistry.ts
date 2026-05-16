import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hasOwn,
  isNonEmptyString,
  isRecord,
  normalizeCheckOptions,
  issue,
  validateArtifactPath,
  validateBudgetValue,
  validateCases,
  validateCommitField,
  validateDateField,
  validateHardware,
  validateModel,
  validateOptionalFingerprint,
  validateRequiredString,
  validateSeeds,
  validateStrictPromotionMetadata,
  validateStringList
} from "./experimentRegistryValidationRules.js";

export const EXPERIMENT_REGISTRY_SCHEMA_VERSION = 1;
export const DEFAULT_EXPERIMENT_REGISTRY_PATH = "artifacts/experiments/index.jsonl";
export const EXPERIMENT_REGISTRY_ARTIFACT_TYPES = [
  "benchmark",
  "label-bundle",
  "ablation-gate",
  "health-check",
  "model-experiment",
  "portfolio-scorecard"
] as const;

export type ExperimentRegistryArtifactType = (typeof EXPERIMENT_REGISTRY_ARTIFACT_TYPES)[number];
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

const parsedRegistryEntryLineNumbers = new WeakMap<ExperimentRegistryEntry, number>();

function invalidRegistryPathError(message: string): ExperimentRegistryValidationError {
  return new ExperimentRegistryValidationError("Experiment registry path is invalid.", [
    {
      code: "invalid-registry-path",
      message,
      field: "registryPath"
    }
  ]);
}

export function resolveExperimentRegistryPath(registryPath: string, rootDir: string): string {
  if (!isNonEmptyString(registryPath)) {
    throw invalidRegistryPathError("Experiment registry path must be a non-empty string.");
  }

  if (path.isAbsolute(registryPath) || path.win32.isAbsolute(registryPath)) {
    throw invalidRegistryPathError(
      `Experiment registry path '${registryPath}' must be relative to the repository root.`
    );
  }

  if (registryPath.split(/[\\/]+/).some((segment) => segment === "..")) {
    throw invalidRegistryPathError(
      `Experiment registry path '${registryPath}' must not contain '..' traversal segments.`
    );
  }

  const normalized = path.normalize(registryPath);
  if (normalized === "." || path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw invalidRegistryPathError(
      `Experiment registry path '${registryPath}' must be relative to the repository root.`
    );
  }

  const absoluteRootDir = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRootDir, normalized);
  const relativeToRoot = path.relative(absoluteRootDir, absolutePath);
  if (
    relativeToRoot === "" ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw invalidRegistryPathError(`Experiment registry path '${registryPath}' must stay inside the repository root.`);
  }

  return absolutePath;
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
      field: "schemaVersion"
    });
  }

  validateRequiredString(value, "runId", issues, lineNumber, runId);
  validateRequiredString(value, "artifactType", issues, lineNumber, runId);
  if (
    isNonEmptyString(value.artifactType) &&
    !EXPERIMENT_REGISTRY_ARTIFACT_TYPES.includes(value.artifactType as ExperimentRegistryArtifactType)
  ) {
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
    issue(issues, "missing-field", "Missing required field 'artifactPaths'.", {
      lineNumber,
      runId,
      field: "artifactPaths"
    });
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
    issue(issues, "missing-field", "Missing required field 'caseFamilies'.", {
      lineNumber,
      runId,
      field: "caseFamilies"
    });
  } else if (value.caseFamilies !== null) {
    validateStringList(value.caseFamilies, "caseFamilies", issues, lineNumber, runId);
  }

  if (hasOwn(value, "cases") && hasOwn(value, "caseFamilies") && value.cases === null && value.caseFamilies === null) {
    issue(issues, "incomplete-coverage", "At least one of 'cases' or 'caseFamilies' must be populated.", {
      lineNumber,
      runId,
      field: "cases"
    });
  }

  if (!hasOwn(value, "seeds")) {
    issue(issues, "missing-field", "Missing required field 'seeds'.", { lineNumber, runId, field: "seeds" });
  } else {
    validateSeeds(value.seeds, issues, lineNumber, runId);
  }

  if (!hasOwn(value, "splitStatus")) {
    issue(issues, "missing-field", "Missing required field 'splitStatus'.", {
      lineNumber,
      runId,
      field: "splitStatus"
    });
  } else if (value.splitStatus !== null && !isRecord(value.splitStatus)) {
    issue(issues, "invalid-field", "Field 'splitStatus' must be null or an object.", {
      lineNumber,
      runId,
      field: "splitStatus"
    });
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
    issue(issues, "invalid-field", "Field 'solverParams' must be an object when present.", {
      lineNumber,
      runId,
      field: "solverParams"
    });
  }
  if (hasOwn(value, "summaryMetrics") && !isRecord(value.summaryMetrics)) {
    issue(issues, "invalid-field", "Field 'summaryMetrics' must be an object when present.", {
      lineNumber,
      runId,
      field: "summaryMetrics"
    });
  }

  if (normalizedOptions.strict === true) {
    validateStrictPromotionMetadata(value, issues, lineNumber, runId);
  }

  return {
    entry: issues.length === 0 ? (value as unknown as ExperimentRegistryEntry) : undefined,
    issues
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
          field: "runId"
        });
      } else {
        seenRunIds.set(runId, lineNumber);
      }
    }

    const validation = validateExperimentRegistryEntry(parsed, { ...options, lineNumber });
    issues.push(...validation.issues);
    if (validation.entry !== undefined) {
      entries.push(validation.entry);
      parsedRegistryEntryLineNumbers.set(validation.entry, lineNumber);
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
  const absolutePath = resolveExperimentRegistryPath(registryPath, rootDir);
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
  const artifactGitCommit = Object.prototype.hasOwnProperty.call(entry, "artifactGitCommit")
    ? entry.artifactGitCommit
    : (metadata.artifactGitCommit ?? null);
  return {
    ...entry,
    schemaVersion: entry.schemaVersion ?? EXPERIMENT_REGISTRY_SCHEMA_VERSION,
    generatedAt: entry.generatedAt ?? metadata.generatedAt ?? metadata.indexedAt,
    indexedAt: entry.indexedAt ?? metadata.indexedAt,
    indexedGitCommit: entry.indexedGitCommit ?? metadata.indexedGitCommit,
    branch: entry.branch ?? metadata.branch,
    artifactGitCommit,
    splitStatus: entry.splitStatus ?? null,
    hardware: entry.hardware ?? metadata.hardware ?? { captured: false, gpuUsed: false },
    model: entry.model ?? null
  };
}

export function captureExperimentRegistryHardwareMetadata(overrides: Record<string, unknown> = {}): Record<
  string,
  unknown
> & {
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
    ...overrides
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
    branch: execGitValue(["branch", "--show-current"], "unknown")
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
    artifactGitCommit:
      entry.artifactGitCommit === undefined ? gitMetadata.commit : (entry.artifactGitCommit as string | null),
    hardware: captureExperimentRegistryHardwareMetadata()
  });
}

function historicalWarningsForEntry(entry: ExperimentRegistryEntry, lineNumber?: number): ExperimentRegistryIssue[] {
  const warnings: ExperimentRegistryIssue[] = [];
  if (entry.artifactGitCommit === null) {
    issue(
      warnings,
      "historical-missing-artifact-commit",
      "artifactGitCommit is null; future promotion-grade entries should record the artifact commit.",
      {
        lineNumber,
        runId: entry.runId,
        field: "artifactGitCommit",
        severity: "warning"
      }
    );
  }
  if (entry.hardware.captured === false) {
    issue(
      warnings,
      "historical-missing-hardware",
      "hardware.captured is false; future promotion-grade entries should record CPU/GPU metadata.",
      {
        lineNumber,
        runId: entry.runId,
        field: "hardware",
        severity: "warning"
      }
    );
  }
  if (entry.commands.some((command) => command.includes("..."))) {
    issue(
      warnings,
      "historical-abbreviated-command",
      "commands include an ellipsis; future entries should record exact commands.",
      {
        lineNumber,
        runId: entry.runId,
        field: "commands",
        severity: "warning"
      }
    );
  }
  return warnings;
}

function toValidationResult(
  entries: ExperimentRegistryEntry[],
  issues: ExperimentRegistryIssue[]
): ExperimentRegistryValidationResult {
  const normalizedIssues = issues.map((entry) => ({
    ...entry,
    severity: entry.severity ?? ("error" as const)
  }));
  const errorCount = normalizedIssues.filter((entry) => entry.severity !== "warning").length;
  const warningCount = normalizedIssues.length - errorCount;
  return {
    valid: errorCount === 0,
    entries,
    issues: normalizedIssues,
    errorCount,
    warningCount
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
      lineNumber: index + 1
    });
    issues.push(
      ...validation.issues.map((validationIssue) => ({
        ...validationIssue,
        severity: validationIssue.severity ?? ("error" as const)
      }))
    );
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
  const absolutePath = resolveExperimentRegistryPath(registryPath, normalizedOptions.rootDir);
  const content = fs.readFileSync(absolutePath, "utf8");
  const check = checkExperimentRegistryContent(content, {
    ...options,
    rootDir: normalizedOptions.rootDir,
    validateArtifactPaths: normalizedOptions.validateArtifactPaths,
    strict: normalizedOptions.strict
  });
  const issues = check.issues.map((entry) => ({ ...entry, severity: entry.severity ?? ("error" as const) }));
  check.entries.forEach((entry, index) => {
    const lineNumber = parsedRegistryEntryLineNumbers.get(entry) ?? index + 1;
    issues.push(
      ...historicalWarningsForEntry(entry, lineNumber).map((warning) => ({
        ...warning,
        severity: warning.severity ?? ("warning" as const)
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
  const absolutePath = resolveExperimentRegistryPath(registryPath, rootDir);
  const existingContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";

  if (existingContent.length > 0) {
    const existingCheck = checkExperimentRegistryContent(existingContent, {
      ...options,
      rootDir,
      strict: false,
      strictMetadata: false
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
        message: "Registry entry must be a JSON object."
      }
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
        field: "runId"
      }
    ]);
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const prefix = existingContent.length === 0 || existingContent.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(absolutePath, `${prefix}${JSON.stringify(validation.entry)}\n`);
  return validation.entry;
}
