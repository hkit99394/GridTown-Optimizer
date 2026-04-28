import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  appendExperimentRegistryEntry,
  captureExperimentRegistryHardwareMetadata,
  completeExperimentRegistryEntry,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile,
} from "../benchmarks/experimentRegistry.js";
import { parseNumberList, readInlineOptionValue } from "./cliParsing.js";
import { writeCliJson, writeCliText } from "./cliOutput.js";

import type {
  ExperimentRegistryCheckOptions,
  ExperimentRegistryEntry,
  ExperimentRegistryIssue,
} from "../benchmarks/experimentRegistry.js";

type RegistryCommand = "check" | "validate-entry" | "append" | "help";

interface ParsedRegistryArgs {
  command: RegistryCommand;
  registryPath: string;
  entryPath?: string;
  dryRun: boolean;
  json: boolean;
  strict: boolean;
  validateArtifactPaths: boolean;
  allowHistorical: boolean;
  commands: string[];
  artifactPaths: string[];
  cases?: unknown;
  caseFamilies: string[];
  seeds?: number[];
  splitStatus?: unknown;
  budget?: unknown;
  hardware?: unknown;
  model?: unknown;
  runId?: string;
  artifactType?: string;
  decision?: string;
  summary?: string;
  indexedAt?: string;
  indexedGitCommit?: string;
  artifactGitCommit?: string | null;
  branch?: string;
  generatedAt?: string;
  gpuModel?: string;
  gpuRuntime?: string;
  gpuDriver?: string;
  gpuMemoryBytes?: number;
  hardwareNotes?: string;
}

function usage(): string {
  return [
    "Usage: node dist/experimentRegistryCli.js <command> [options]",
    "",
    "Commands:",
    "  check             Validate artifacts/experiments/index.jsonl.",
    "  validate-entry    Validate one registry entry JSON file.",
    "  append            Complete, validate, and append one registry entry JSON file.",
    "",
    "Options:",
    "  --registry=<path>              Registry JSONL path.",
    "  --entry=<path|->               Entry JSON path, or '-' for stdin.",
    "  --dry-run                      Validate append without writing.",
    "  --json                         Print machine-readable output.",
    "  --strict                       Enforce promotion-grade metadata on check/validate.",
    "  --strict-metadata              Alias for --strict.",
    "  --allow-historical             Let append use historical completeness rules.",
    "  --no-artifacts                 Skip artifact path existence checks.",
    "  --indexed-at=<date>            Override index date.",
    "  --indexed-git-commit=<sha|HEAD> Override index commit.",
    "  --artifact-git-commit=<sha|HEAD|null>",
    "  --branch=<name>                Override branch.",
    "  --generated-at=<date>          Fill generatedAt when omitted.",
    "  --run-id=<id>                  Build an entry without --entry.",
    "  --artifact-type=<type>         Build an entry without --entry.",
    "  --command=<command>            Add command metadata.",
    "  --artifact-path=<path>         Add artifact path metadata.",
    "  --case=<name>                  Add case metadata.",
    "  --cases=<json>                 Set case metadata from JSON.",
    "  --case-family=<name>           Add case-family metadata.",
    "  --seeds=<csv>                  Set seed metadata.",
    "  --split-status=<json|null>     Set split metadata.",
    "  --budget=<json>                Set budget metadata.",
    "  --hardware=<json>              Set hardware metadata.",
    "  --model=<json|null>            Set model metadata.",
    "  --decision=<decision>          Set decision metadata.",
    "  --summary=<text>               Set summary metadata.",
    "  --gpu-model=<name>             Record GPU metadata for new appends.",
    "  --gpu-runtime=<name>           Record GPU runtime metadata.",
    "  --gpu-driver=<name>            Record GPU driver metadata.",
    "  --gpu-memory-bytes=<bytes>     Record GPU memory metadata.",
    "  --hardware-notes=<text>        Record hardware notes.",
  ].join("\n");
}

function parseNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Expected ${label} to be a finite non-negative number.`);
  }
  return number;
}

function parseArgs(argv: string[]): ParsedRegistryArgs {
  let command: RegistryCommand = "help";
  let registryPath = DEFAULT_EXPERIMENT_REGISTRY_PATH;
  let entryPath: string | undefined;
  let dryRun = false;
  let json = false;
  let strict = false;
  let validateArtifactPaths = true;
  let allowHistorical = false;
  const commands: string[] = [];
  const artifactPaths: string[] = [];
  let cases: unknown;
  const caseFamilies: string[] = [];
  let seeds: number[] | undefined;
  let splitStatus: unknown;
  let budget: unknown;
  let hardware: unknown;
  let model: unknown;
  let runId: string | undefined;
  let artifactType: string | undefined;
  let decision: string | undefined;
  let summary: string | undefined;
  let indexedAt: string | undefined;
  let indexedGitCommit: string | undefined;
  let artifactGitCommit: string | null | undefined;
  let branch: string | undefined;
  let generatedAt: string | undefined;
  let gpuModel: string | undefined;
  let gpuRuntime: string | undefined;
  let gpuDriver: string | undefined;
  let gpuMemoryBytes: number | undefined;
  let hardwareNotes: string | undefined;

  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("--")) {
    const requested = args.shift();
    if (requested === "check" || requested === "validate-entry" || requested === "append" || requested === "help") {
      command = requested;
    } else {
      throw new Error(`Unknown experiment registry command: ${requested}`);
    }
  }

  for (const arg of args) {
    let value: string | undefined;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--strict" || arg === "--strict-metadata") {
      strict = true;
      continue;
    }
    if (arg === "--allow-historical") {
      allowHistorical = true;
      continue;
    }
    if (arg === "--no-artifacts") {
      validateArtifactPaths = false;
      continue;
    }
    value = readInlineOptionValue(arg, "registry");
    if (value !== undefined) {
      registryPath = value;
      continue;
    }
    value = readInlineOptionValue(arg, "entry");
    if (value !== undefined) {
      entryPath = value;
      continue;
    }
    value = readInlineOptionValue(arg, "indexed-at");
    if (value !== undefined) {
      indexedAt = value;
      continue;
    }
    value = readInlineOptionValue(arg, "indexed-git-commit");
    if (value !== undefined) {
      indexedGitCommit = value;
      continue;
    }
    value = readInlineOptionValue(arg, "artifact-git-commit");
    if (value !== undefined) {
      artifactGitCommit = value === "null" || value === "none" ? null : value;
      continue;
    }
    value = readInlineOptionValue(arg, "branch");
    if (value !== undefined) {
      branch = value;
      continue;
    }
    value = readInlineOptionValue(arg, "generated-at");
    if (value !== undefined) {
      generatedAt = value;
      continue;
    }
    value = readInlineOptionValue(arg, "run-id");
    if (value !== undefined) {
      runId = value;
      continue;
    }
    value = readInlineOptionValue(arg, "artifact-type");
    if (value !== undefined) {
      artifactType = value;
      continue;
    }
    value = readInlineOptionValue(arg, "command");
    if (value !== undefined) {
      commands.push(value);
      continue;
    }
    value = readInlineOptionValue(arg, "artifact-path");
    if (value !== undefined) {
      artifactPaths.push(value);
      continue;
    }
    value = readInlineOptionValue(arg, "case");
    if (value !== undefined) {
      const currentCases = Array.isArray(cases) ? cases : [];
      cases = [...currentCases, value];
      continue;
    }
    value = readInlineOptionValue(arg, "cases");
    if (value !== undefined) {
      cases = JSON.parse(value) as unknown;
      continue;
    }
    value = readInlineOptionValue(arg, "case-family");
    if (value !== undefined) {
      caseFamilies.push(value);
      continue;
    }
    value = readInlineOptionValue(arg, "seeds");
    if (value !== undefined) {
      seeds = parseNumberList(value, "--seeds");
      continue;
    }
    value = readInlineOptionValue(arg, "split-status");
    if (value !== undefined) {
      splitStatus = value === "null" ? null : JSON.parse(value) as unknown;
      continue;
    }
    value = readInlineOptionValue(arg, "budget");
    if (value !== undefined) {
      budget = JSON.parse(value) as unknown;
      continue;
    }
    value = readInlineOptionValue(arg, "hardware");
    if (value !== undefined) {
      hardware = JSON.parse(value) as unknown;
      continue;
    }
    value = readInlineOptionValue(arg, "model");
    if (value !== undefined) {
      model = value === "null" ? null : JSON.parse(value) as unknown;
      continue;
    }
    value = readInlineOptionValue(arg, "decision");
    if (value !== undefined) {
      decision = value;
      continue;
    }
    value = readInlineOptionValue(arg, "summary");
    if (value !== undefined) {
      summary = value;
      continue;
    }
    value = readInlineOptionValue(arg, "gpu-model");
    if (value !== undefined) {
      gpuModel = value;
      continue;
    }
    value = readInlineOptionValue(arg, "gpu-runtime");
    if (value !== undefined) {
      gpuRuntime = value;
      continue;
    }
    value = readInlineOptionValue(arg, "gpu-driver");
    if (value !== undefined) {
      gpuDriver = value;
      continue;
    }
    value = readInlineOptionValue(arg, "gpu-memory-bytes");
    if (value !== undefined) {
      gpuMemoryBytes = parseNumber(value, "GPU memory bytes");
      continue;
    }
    value = readInlineOptionValue(arg, "hardware-notes");
    if (value !== undefined) {
      hardwareNotes = value;
      continue;
    }
    throw new Error(`Unknown experiment registry argument: ${arg}`);
  }

  return {
    command,
    registryPath,
    entryPath,
    dryRun,
    json,
    strict,
    validateArtifactPaths,
    allowHistorical,
    commands,
    artifactPaths,
    cases,
    caseFamilies,
    seeds,
    splitStatus,
    budget,
    hardware,
    model,
    runId,
    artifactType,
    decision,
    summary,
    indexedAt,
    indexedGitCommit,
    artifactGitCommit,
    branch,
    generatedAt,
    gpuModel,
    gpuRuntime,
    gpuDriver,
    gpuMemoryBytes,
    hardwareNotes,
  };
}

function gitValue(args: string[], fallback: string): string {
  try {
    return childProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function resolveCommit(value: string | null | undefined, fallback: string): string | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  if (value === "HEAD") return gitValue(["rev-parse", "HEAD"], fallback);
  return value;
}

function readEntry(entryPath: string | undefined): Record<string, unknown> {
  if (entryPath === undefined) {
    throw new Error("--entry is required.");
  }
  const content = entryPath === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(path.resolve(process.cwd(), entryPath), "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Registry entry JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function buildEntryFromArgs(args: ParsedRegistryArgs): Record<string, unknown> {
  if (args.entryPath !== undefined) {
    return readEntry(args.entryPath);
  }
  return {
    runId: args.runId,
    artifactType: args.artifactType,
    generatedAt: args.generatedAt,
    indexedAt: args.indexedAt,
    indexedGitCommit: args.indexedGitCommit,
    branch: args.branch,
    artifactGitCommit: args.artifactGitCommit,
    commands: args.commands,
    artifactPaths: args.artifactPaths,
    cases: args.cases ?? null,
    caseFamilies: args.caseFamilies.length > 0 ? args.caseFamilies : null,
    seeds: args.seeds,
    splitStatus: args.splitStatus ?? null,
    budget: args.budget,
    hardware: args.hardware,
    model: args.model ?? null,
    decision: args.decision,
    summary: args.summary,
  };
}

function printCheckResult(entries: ExperimentRegistryEntry[], issues: ExperimentRegistryIssue[], json: boolean): void {
  const errorCount = issues.filter((issue) => issue.severity !== "warning").length;
  const warningCount = issues.length - errorCount;
  if (json) {
    writeCliJson({ valid: errorCount === 0, entryCount: entries.length, errorCount, warningCount, issues });
    return;
  }
  if (errorCount === 0 && warningCount === 0) {
    writeCliText(`Experiment registry OK: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`);
    return;
  }
  const output = formatExperimentRegistryIssues(issues);
  if (errorCount > 0) {
    process.stderr.write(`${output}\n`);
  } else {
    writeCliText(output);
  }
}

function buildCompletedEntry(args: ParsedRegistryArgs): Record<string, unknown> {
  const now = new Date().toISOString().slice(0, 10);
  const currentCommit = gitValue(["rev-parse", "HEAD"], "0000000000000000000000000000000000000000");
  const currentBranch = gitValue(["branch", "--show-current"], "unknown");
  const hardwareOverrides: Record<string, unknown> = {};
  if (args.gpuModel !== undefined) hardwareOverrides.gpuModel = args.gpuModel;
  if (args.gpuRuntime !== undefined) hardwareOverrides.gpuRuntime = args.gpuRuntime;
  if (args.gpuDriver !== undefined) hardwareOverrides.gpuDriver = args.gpuDriver;
  if (args.gpuMemoryBytes !== undefined) hardwareOverrides.gpuMemoryBytes = args.gpuMemoryBytes;
  if (args.hardwareNotes !== undefined) hardwareOverrides.notes = args.hardwareNotes;

  const rawEntry = buildEntryFromArgs(args);
  return completeExperimentRegistryEntry(rawEntry, {
    indexedAt: args.indexedAt ?? now,
    indexedGitCommit: resolveCommit(args.indexedGitCommit, currentCommit) ?? currentCommit,
    branch: args.branch ?? currentBranch,
    generatedAt: args.generatedAt,
    artifactGitCommit: resolveCommit(args.artifactGitCommit, currentCommit),
    hardware: args.hardware as Record<string, unknown> & { captured: boolean; gpuUsed: boolean }
      ?? captureExperimentRegistryHardwareMetadata(hardwareOverrides),
  });
}

function assertNoDuplicateRunId(registryPath: string, entry: Record<string, unknown>, options: ExperimentRegistryCheckOptions): void {
  const registryRoot = options.rootDir ?? options.cwd ?? process.cwd();
  if (!fs.existsSync(path.resolve(registryRoot, registryPath))) {
    return;
  }
  const registryResult = validateExperimentRegistryFile(registryPath, {
    ...options,
    strict: false,
    strictMetadata: false,
  });
  if (!registryResult.valid) {
    throw new ExperimentRegistryValidationError("Existing experiment registry is invalid.", registryResult.issues);
  }
  if (typeof entry.runId !== "string") return;
  if (registryResult.entries.some((existingEntry) => existingEntry.runId === entry.runId)) {
    throw new ExperimentRegistryValidationError("Experiment registry entry duplicates an existing runId.", [
      {
        code: "duplicate-run-id",
        message: `Duplicate runId '${entry.runId}' already exists in '${registryPath}'.`,
        runId: entry.runId,
        field: "runId",
      },
    ]);
  }
}

export function runExperimentRegistryCli(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (args.command === "help") {
    writeCliText(usage());
    return;
  }

  const baseOptions: ExperimentRegistryCheckOptions = {
    rootDir: process.cwd(),
    validateArtifactPaths: args.validateArtifactPaths,
    strict: args.strict,
  };

  if (args.command === "check") {
    const result = validateExperimentRegistryFile(args.registryPath, baseOptions);
    printCheckResult(result.entries, result.issues, args.json);
    if (result.errorCount > 0) process.exitCode = 1;
    return;
  }

  if (args.command === "validate-entry") {
    const entry = readEntry(args.entryPath);
    const result = validateExperimentRegistryEntry(entry, baseOptions);
    printCheckResult(result.entry ? [result.entry] : [], result.issues, args.json);
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }

  const completedEntry = buildCompletedEntry(args);
  const appendOptions = {
    ...baseOptions,
    strict: args.allowHistorical ? args.strict : true,
  };

  if (args.dryRun) {
    assertNoDuplicateRunId(args.registryPath, completedEntry, appendOptions);
    const result = validateExperimentRegistryEntry(completedEntry, appendOptions);
    if (args.json) {
      writeCliJson({ valid: result.issues.length === 0, dryRun: true, entry: result.entry, issues: result.issues });
    } else {
      printCheckResult(result.entry ? [result.entry] : [], result.issues, false);
    }
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }

  const appended = appendExperimentRegistryEntry(args.registryPath, completedEntry, appendOptions);
  if (args.json) {
    writeCliJson({ appended: true, entry: appended });
    return;
  }
  writeCliText(`Appended experiment registry entry '${appended.runId}' to ${args.registryPath}.`);
}

try {
  runExperimentRegistryCli();
} catch (error) {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
