import fs from "node:fs";
import path from "node:path";

import {
  buildExperimentRegistryEntry,
  ExperimentRegistryValidationError,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile
} from "../../benchmarkApi.js";

import type { ExperimentRegistryEntry } from "../../benchmarkApi.js";

export interface ArtifactBundleDirectory {
  artifactDir: string;
  absoluteArtifactDir: string;
  artifactPath(fileName: string): string;
  absoluteArtifactPath(fileName: string): string;
}

interface ArtifactBundleDirectoryOptions {
  force?: boolean;
}

interface ArtifactWriteOptions {
  force?: boolean;
}

export function normalizeRepoRelativePath(value: string, label: string): string {
  const normalized = path.normalize(value);
  if (normalized === "." || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return normalized.split(path.sep).join(path.posix.sep);
}

export function assertArtifactPathNotObsolete(repoRelativePath: string, label: string): void {
  let currentDir = path.resolve(process.cwd(), path.dirname(repoRelativePath));
  const repoRoot = path.resolve(process.cwd());
  const artifactsRoot = path.resolve(repoRoot, "artifacts");

  while (currentDir.startsWith(artifactsRoot)) {
    if (fs.existsSync(path.join(currentDir, "OBSOLETE.md")) || fs.existsSync(path.join(currentDir, "OBSOLETE.json"))) {
      const displayPath = path.relative(repoRoot, currentDir).split(path.sep).join(path.posix.sep);
      throw new Error(`${label} points to obsolete artifact bundle '${displayPath}'.`);
    }
    if (currentDir === artifactsRoot) break;
    currentDir = path.dirname(currentDir);
  }
}

export function prepareArtifactBundleDirectory(
  value: string,
  label: string,
  options: ArtifactBundleDirectoryOptions = {}
): ArtifactBundleDirectory {
  const artifactDir = normalizeRepoRelativePath(value, label);
  if (artifactDir === "artifacts" || !artifactDir.startsWith("artifacts/")) {
    throw new Error(`${label} must be under artifacts/.`);
  }

  const repoRoot = process.cwd();
  const absoluteArtifactDir = path.resolve(repoRoot, artifactDir);
  const absoluteArtifactsRoot = path.resolve(repoRoot, "artifacts");
  const relativeToArtifactsRoot = path.relative(absoluteArtifactsRoot, absoluteArtifactDir);
  if (
    relativeToArtifactsRoot === "" ||
    relativeToArtifactsRoot.startsWith("..") ||
    path.isAbsolute(relativeToArtifactsRoot)
  ) {
    throw new Error(`${label} must be under artifacts/.`);
  }

  if (fs.existsSync(absoluteArtifactDir)) {
    const stats = fs.statSync(absoluteArtifactDir);
    if (!stats.isDirectory()) {
      throw new Error(`${label} '${artifactDir}' exists but is not a directory.`);
    }
    const entries = fs.readdirSync(absoluteArtifactDir);
    if (entries.length > 0 && !options.force) {
      throw new Error(
        `${label} '${artifactDir}' already exists and is not empty; pass --force-artifact-dir to reuse it.`
      );
    }
  } else {
    fs.mkdirSync(absoluteArtifactDir, { recursive: true });
  }

  return {
    artifactDir,
    absoluteArtifactDir,
    artifactPath: (fileName) => path.posix.join(artifactDir, fileName),
    absoluteArtifactPath: (fileName) => path.join(absoluteArtifactDir, fileName)
  };
}

export function quoteCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function defaultCliReplayCommand(cliPath: string, argv: readonly string[]): string {
  return ["node", cliPath, ...argv].map(quoteCommandArg).join(" ");
}

export function writeTextArtifact(filePath: string, value: string, options: ArtifactWriteOptions = {}): void {
  fs.writeFileSync(filePath, value, { flag: options.force ? "w" : "wx" });
}

export function writeJsonArtifact(filePath: string, value: unknown, options: ArtifactWriteOptions = {}): void {
  writeTextArtifact(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
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
