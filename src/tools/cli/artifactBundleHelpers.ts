import fs from "node:fs";
import path from "node:path";

import {
  buildExperimentRegistryEntry,
  ExperimentRegistryValidationError,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile
} from "../../benchmarkApi.js";

import type { ExperimentRegistryEntry } from "../../benchmarkApi.js";

export function normalizeRepoRelativePath(value: string, label: string): string {
  const normalized = path.normalize(value);
  if (normalized === "." || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return normalized.split(path.sep).join(path.posix.sep);
}

export function quoteCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function defaultCliReplayCommand(cliPath: string, argv: readonly string[]): string {
  return ["node", cliPath, ...argv].map(quoteCommandArg).join(" ");
}

export function writeJsonArtifact(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function existingRegistryHasRunId(registryPath: string, runId: unknown): boolean {
  if (typeof runId !== "string") return false;
  const registryResult = validateExperimentRegistryFile(registryPath, {
    rootDir: process.cwd(),
    validateArtifactPaths: true,
    strict: false
  });
  if (registryResult.errorCount > 0) {
    throw new ExperimentRegistryValidationError("Existing experiment registry is invalid.", registryResult.issues);
  }
  return registryResult.entries.some((entry) => entry.runId === runId);
}

export function completeAppendableRegistryEntry(
  registryPath: string,
  registryEntryDraft: Record<string, unknown>,
  invalidMessage: string
): ExperimentRegistryEntry {
  const completedEntry = buildExperimentRegistryEntry(registryEntryDraft, {
    rootDir: process.cwd()
  });
  const validation = validateExperimentRegistryEntry(completedEntry, {
    rootDir: process.cwd(),
    validateArtifactPaths: true,
    strict: true
  });
  if (validation.entry === undefined) {
    throw new ExperimentRegistryValidationError(invalidMessage, validation.issues);
  }

  const absoluteRegistryPath = path.resolve(process.cwd(), registryPath);
  if (fs.existsSync(absoluteRegistryPath) && existingRegistryHasRunId(registryPath, validation.entry.runId)) {
    throw new ExperimentRegistryValidationError("Experiment registry entry duplicates an existing runId.", [
      {
        code: "duplicate-run-id",
        message: `Duplicate runId '${validation.entry.runId}' already exists in '${registryPath}'.`,
        runId: validation.entry.runId,
        field: "runId"
      }
    ]);
  }

  return validation.entry;
}
