import fs from "node:fs";
import path from "node:path";

import { MAX_BENCHMARK_RANDOM_SEED, isBenchmarkSeed } from "./benchmarkSeeds.js";
import type {
  ExperimentRegistryCases,
  ExperimentRegistryCheckOptions,
  ExperimentRegistryEntry,
  ExperimentRegistryIssue
} from "./experimentRegistry.js";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateLike(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function normalizeCheckOptions(
  options: ExperimentRegistryCheckOptions = {}
): Required<Pick<ExperimentRegistryCheckOptions, "rootDir" | "validateArtifactPaths" | "strict">> {
  return {
    rootDir: options.rootDir ?? options.cwd ?? process.cwd(),
    validateArtifactPaths: options.validateArtifactPaths ?? options.checkArtifactPaths ?? true,
    strict: options.strict ?? options.strictMetadata ?? false
  };
}

export function issue(
  issues: ExperimentRegistryIssue[],
  code: string,
  message: string,
  options: Pick<ExperimentRegistryIssue, "lineNumber" | "runId" | "field" | "severity"> = {}
): void {
  issues.push({ code, message, ...options });
}

export function validateRequiredString(
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

export function validateDateField(
  entry: Record<string, unknown>,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  validateRequiredString(entry, key, issues, lineNumber, runId);
  if (isNonEmptyString(entry[key]) && !isValidDateLike(entry[key] as string)) {
    issue(issues, "invalid-date", `Field '${key}' must be a parseable date or timestamp.`, {
      lineNumber,
      runId,
      field: key
    });
  }
}

export function validateCommitField(
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
    issue(
      issues,
      "invalid-commit",
      `Field '${key}' must be a 40-character lowercase git commit SHA${nullable ? " or null" : ""}.`,
      {
        lineNumber,
        runId,
        field: key
      }
    );
  }
}

export function validateStringList(
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
    issue(issues, "invalid-field", `Field '${key}' must contain at least one entry.`, {
      lineNumber,
      runId,
      field: key
    });
    return false;
  }
  const seen = new Set<string>();
  value.forEach((entryValue, index) => {
    if (!isNonEmptyString(entryValue)) {
      issue(issues, "invalid-field", `Field '${key}[${index}]' must be a non-empty string.`, {
        lineNumber,
        runId,
        field: key
      });
      return;
    }
    if (seen.has(entryValue)) {
      issue(issues, "duplicate-value", `Field '${key}' contains duplicate value '${entryValue}'.`, {
        lineNumber,
        runId,
        field: key
      });
    }
    seen.add(entryValue);
  });
  return true;
}

export function validateArtifactPath(
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
      field: "artifactPaths"
    });
    return;
  }

  const normalized = path.normalize(artifactPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    issue(issues, "invalid-artifact-path", `Artifact path '${artifactPath}' must stay inside the repository root.`, {
      lineNumber,
      runId,
      field: "artifactPaths"
    });
    return;
  }

  if (!fs.existsSync(path.resolve(rootDir, normalized))) {
    issue(issues, "missing-artifact", `Artifact path '${artifactPath}' does not exist.`, {
      lineNumber,
      runId,
      field: "artifactPaths"
    });
  }
}

export function validateCases(
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
      field: "cases"
    });
    return false;
  }

  const splitNames = Object.keys(value);
  if (splitNames.length === 0) {
    issue(issues, "invalid-field", "Field 'cases' split object must contain at least one split.", {
      lineNumber,
      runId,
      field: "cases"
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
      field: "cases"
    });
    return false;
  }
  return true;
}

export function validateSeeds(
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
  let valid = true;
  value.forEach((seed, index) => {
    if (!isBenchmarkSeed(seed)) {
      valid = false;
      issue(
        issues,
        "invalid-seed",
        `Field 'seeds[${index}]' must be an integer between 0 and ${MAX_BENCHMARK_RANDOM_SEED}.`,
        {
          lineNumber,
          runId,
          field: "seeds"
        }
      );
      return;
    }
    if (seen.has(seed)) {
      valid = false;
      issue(issues, "duplicate-value", `Field 'seeds' contains duplicate value '${seed}'.`, {
        lineNumber,
        runId,
        field: "seeds"
      });
    }
    seen.add(seed);
  });
  return valid;
}

export function validateBudgetValue(
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
        field: "budget"
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      issue(issues, "invalid-budget", `Budget field '${fieldPath}' must not be an empty array.`, {
        lineNumber,
        runId,
        field: "budget"
      });
      return;
    }
    value.forEach((entryValue, index) =>
      validateBudgetValue(entryValue, `${fieldPath}[${index}]`, issues, lineNumber, runId)
    );
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
    field: "budget"
  });
}

export function validateHardware(
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
    issue(issues, "invalid-hardware", "Field 'hardware.captured' must be a boolean.", {
      lineNumber,
      runId,
      field: "hardware"
    });
  }
  if (typeof value.gpuUsed !== "boolean") {
    issue(issues, "invalid-hardware", "Field 'hardware.gpuUsed' must be a boolean.", {
      lineNumber,
      runId,
      field: "hardware"
    });
  }
  if (value.captured === true) {
    if (!isNonEmptyString(value.cpuModel)) {
      issue(issues, "incomplete-hardware", "Captured hardware must include 'hardware.cpuModel'.", {
        lineNumber,
        runId,
        field: "hardware"
      });
    }
    const logicalCpuCount = value.logicalCpuCount ?? value.logicalCores;
    if (!Number.isSafeInteger(logicalCpuCount) || (logicalCpuCount as number) <= 0) {
      issue(
        issues,
        "incomplete-hardware",
        "Captured hardware must include a positive 'hardware.logicalCpuCount' or 'hardware.logicalCores'.",
        {
          lineNumber,
          runId,
          field: "hardware"
        }
      );
    }
    if (typeof value.memoryBytes !== "number" && typeof value.memoryGb !== "number") {
      issue(
        issues,
        "incomplete-hardware",
        "Captured hardware must include 'hardware.memoryBytes' or 'hardware.memoryGb'.",
        {
          lineNumber,
          runId,
          field: "hardware"
        }
      );
    }
    if (value.gpuUsed === true) {
      if (!isNonEmptyString(value.gpuModel)) {
        issue(issues, "incomplete-hardware", "GPU-backed runs must include 'hardware.gpuModel'.", {
          lineNumber,
          runId,
          field: "hardware"
        });
      }
      if (typeof value.gpuMemoryBytes !== "number" && typeof value.gpuMemoryGb !== "number") {
        issue(
          issues,
          "incomplete-hardware",
          "GPU-backed runs must include 'hardware.gpuMemoryBytes' or 'hardware.gpuMemoryGb'.",
          {
            lineNumber,
            runId,
            field: "hardware"
          }
        );
      }
      if (!isNonEmptyString(value.gpuRuntime) && !isNonEmptyString(value.gpuDriver)) {
        issue(
          issues,
          "incomplete-hardware",
          "GPU-backed runs must include 'hardware.gpuRuntime' or 'hardware.gpuDriver'.",
          {
            lineNumber,
            runId,
            field: "hardware"
          }
        );
      }
    }
  }
  return true;
}

export function validateModel(
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
      issue(
        issues,
        "incomplete-model",
        "Trained model entries must include a model version, fingerprint, or model path.",
        {
          lineNumber,
          runId,
          field: "model"
        }
      );
    }
  }
  return true;
}

export function validateOptionalFingerprint(
  entry: Record<string, unknown>,
  key: string,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (hasOwn(entry, key) && !isNonEmptyString(entry[key])) {
    issue(issues, "invalid-field", `Field '${key}' must be a non-empty string when present.`, {
      lineNumber,
      runId,
      field: key
    });
  }
}

function budgetHasFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.some((entryValue) => budgetHasFiniteNumber(entryValue));
  if (isRecord(value)) return Object.values(value).some((entryValue) => budgetHasFiniteNumber(entryValue));
  return false;
}

export function validateStrictPromotionMetadata(
  entry: Record<string, unknown>,
  issues: ExperimentRegistryIssue[],
  lineNumber?: number,
  runId?: string
): void {
  if (entry.artifactGitCommit === null) {
    issue(issues, "strict-missing-artifact-commit", "Strict registry checks require 'artifactGitCommit'.", {
      lineNumber,
      runId,
      field: "artifactGitCommit"
    });
  }

  if (
    Array.isArray(entry.commands) &&
    entry.commands.some((command) => typeof command === "string" && command.includes("..."))
  ) {
    issue(issues, "strict-abbreviated-command", "Strict registry checks require exact commands without ellipses.", {
      lineNumber,
      runId,
      field: "commands"
    });
  }

  if (isRecord(entry.budget) && !budgetHasFiniteNumber(entry.budget)) {
    issue(
      issues,
      "strict-missing-budget",
      "Strict registry checks require at least one finite budget or observed runtime value.",
      {
        lineNumber,
        runId,
        field: "budget"
      }
    );
  }

  if (isRecord(entry.hardware) && entry.hardware.captured !== true) {
    issue(
      issues,
      "strict-missing-hardware",
      "hardware.captured is false; strict registry checks require captured hardware metadata.",
      {
        lineNumber,
        runId,
        field: "hardware"
      }
    );
  }

  if ((entry.artifactType === "benchmark" || entry.artifactType === "label-bundle") && entry.splitStatus === null) {
    issue(issues, "strict-missing-split", `${entry.artifactType} entries must include splitStatus metadata.`, {
      lineNumber,
      runId,
      field: "splitStatus"
    });
  }

  if (entry.artifactType === "label-bundle" && entry.model === null) {
    issue(
      issues,
      "strict-missing-model",
      "label-bundle entries must include model metadata, even when no model was trained.",
      {
        lineNumber,
        runId,
        field: "model"
      }
    );
  }
}
