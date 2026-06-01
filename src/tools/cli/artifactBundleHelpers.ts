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

interface RepoInputPathOptions {
  mustExist?: boolean;
  rejectObsolete?: boolean;
}

export function normalizeRepoRelativePath(value: string, label: string): string {
  const normalized = path.normalize(value);
  if (normalized === "." || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return normalized.split(path.sep).join(path.posix.sep);
}

export function resolveRepoInputPath(value: string, label: string, options: RepoInputPathOptions = {}): string {
  const repoRoot = path.resolve(process.cwd());
  const absolutePath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside the repository: ${value}`);
  }
  if (options.mustExist && !fs.existsSync(absolutePath)) {
    throw new Error(`${label} does not exist: ${value}`);
  }
  const repoRelativePath = relativePath.split(path.sep).join(path.posix.sep);
  if (options.rejectObsolete) assertArtifactPathNotObsolete(repoRelativePath, label);
  return repoRelativePath;
}

export function resolveRepoInputArtifactPath(value: string, label: string, options: RepoInputPathOptions = {}): string {
  return resolveRepoInputPath(value, label, { ...options, rejectObsolete: true });
}

export function readJsonRepoInputArtifact<T = unknown>(
  value: string,
  label: string,
  options: RepoInputPathOptions = {}
): { repoRelativePath: string; value: T } {
  const repoRelativePath = resolveRepoInputArtifactPath(value, label, { ...options, mustExist: true });
  return {
    repoRelativePath,
    value: JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8")) as T
  };
}

export function assertArtifactPathNotObsolete(repoRelativePath: string, label: string): void {
  let currentDir = path.resolve(process.cwd(), path.dirname(repoRelativePath));
  const repoRoot = path.resolve(process.cwd());
  const artifactsRoot = path.resolve(repoRoot, "artifacts");

  while (currentDir === artifactsRoot || currentDir.startsWith(`${artifactsRoot}${path.sep}`)) {
    if (fs.existsSync(path.join(currentDir, "OBSOLETE.md")) || fs.existsSync(path.join(currentDir, "OBSOLETE.json"))) {
      const displayPath = path.relative(repoRoot, currentDir).split(path.sep).join(path.posix.sep);
      throw new Error(`${label} points to obsolete artifact bundle '${displayPath}'.`);
    }
    if (currentDir === artifactsRoot) break;
    currentDir = path.dirname(currentDir);
  }
}

function assertNoSymlinkPathSegments(absolutePath: string, label: string): void {
  const repoRoot = path.resolve(process.cwd());
  const relativePath = path.relative(repoRoot, absolutePath);
  const parts = relativePath.split(path.sep).filter((part) => part.length > 0);
  let currentPath = repoRoot;

  for (const part of parts) {
    currentPath = path.join(currentPath, part);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      const displayPath = path.relative(repoRoot, currentPath).split(path.sep).join(path.posix.sep);
      throw new Error(`${label} must not use symbolic links under artifacts/: ${displayPath}`);
    }
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
  assertNoSymlinkPathSegments(absoluteArtifactDir, label);

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
