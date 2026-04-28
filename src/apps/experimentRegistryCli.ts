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
  formatExperimentRegistryValidationReport,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile,
} from "../benchmarks/experimentRegistry.js";

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
    if (arg.startsWith("--registry=")) {
      registryPath = arg.slice("--registry=".length);
      continue;
    }
    if (arg.startsWith("--entry=")) {
      entryPath = arg.slice("--entry=".length);
      continue;
    }
    if (arg.startsWith("--indexed-at=")) {
      indexedAt = arg.slice("--indexed-at=".length);
      continue;
    }
    if (arg.startsWith("--indexed-git-commit=")) {
      indexedGitCommit = arg.slice("--indexed-git-commit=".length);
      continue;
    }
    if (arg.startsWith("--artifact-git-commit=")) {
      const raw = arg.slice("--artifact-git-commit=".length);
      artifactGitCommit = raw === "null" || raw === "none" ? null : raw;
      continue;
    }
    if (arg.startsWith("--branch=")) {
      branch = arg.slice("--branch=".length);
      continue;
    }
    if (arg.startsWith("--generated-at=")) {
      generatedAt = arg.slice("--generated-at=".length);
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
      continue;
    }
    if (arg.startsWith("--artifact-type=")) {
      artifactType = arg.slice("--artifact-type=".length);
      continue;
    }
    if (arg.startsWith("--command=")) {
      commands.push(arg.slice("--command=".length));
      continue;
    }
    if (arg.startsWith("--artifact-path=")) {
      artifactPaths.push(arg.slice("--artifact-path=".length));
      continue;
    }
    if (arg.startsWith("--case=")) {
      const caseName = arg.slice("--case=".length);
      const currentCases = Array.isArray(cases) ? cases : [];
      cases = [...currentCases, caseName];
      continue;
    }
    if (arg.startsWith("--cases=")) {
      cases = JSON.parse(arg.slice("--cases=".length)) as unknown;
      continue;
    }
    if (arg.startsWith("--case-family=")) {
      caseFamilies.push(arg.slice("--case-family=".length));
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = arg
        .slice("--seeds=".length)
        .split(",")
        .map((entry) => Number(entry.trim()));
      continue;
    }
    if (arg.startsWith("--split-status=")) {
      const raw = arg.slice("--split-status=".length);
      splitStatus = raw === "null" ? null : JSON.parse(raw) as unknown;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budget = JSON.parse(arg.slice("--budget=".length)) as unknown;
      continue;
    }
    if (arg.startsWith("--hardware=")) {
      hardware = JSON.parse(arg.slice("--hardware=".length)) as unknown;
      continue;
    }
    if (arg.startsWith("--model=")) {
      const raw = arg.slice("--model=".length);
      model = raw === "null" ? null : JSON.parse(raw) as unknown;
      continue;
    }
    if (arg.startsWith("--decision=")) {
      decision = arg.slice("--decision=".length);
      continue;
    }
    if (arg.startsWith("--summary=")) {
      summary = arg.slice("--summary=".length);
      continue;
    }
    if (arg.startsWith("--gpu-model=")) {
      gpuModel = arg.slice("--gpu-model=".length);
      continue;
    }
    if (arg.startsWith("--gpu-runtime=")) {
      gpuRuntime = arg.slice("--gpu-runtime=".length);
      continue;
    }
    if (arg.startsWith("--gpu-driver=")) {
      gpuDriver = arg.slice("--gpu-driver=".length);
      continue;
    }
    if (arg.startsWith("--gpu-memory-bytes=")) {
      gpuMemoryBytes = parseNumber(arg.slice("--gpu-memory-bytes=".length), "GPU memory bytes");
      continue;
    }
    if (arg.startsWith("--hardware-notes=")) {
      hardwareNotes = arg.slice("--hardware-notes=".length);
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

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printCheckResult(entries: ExperimentRegistryEntry[], issues: ExperimentRegistryIssue[], json: boolean): void {
  const errorCount = issues.filter((issue) => issue.severity !== "warning").length;
  const warningCount = issues.length - errorCount;
  if (json) {
    printJson({ valid: errorCount === 0, entryCount: entries.length, errorCount, warningCount, issues });
    return;
  }
  if (errorCount === 0 && warningCount === 0) {
    process.stdout.write(`Experiment registry OK: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.\n`);
    return;
  }
  const output = formatExperimentRegistryIssues(issues);
  if (errorCount > 0) {
    process.stderr.write(`${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
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
    process.stdout.write(`${usage()}\n`);
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
      printJson({ valid: result.issues.length === 0, dryRun: true, entry: result.entry, issues: result.issues });
    } else {
      printCheckResult(result.entry ? [result.entry] : [], result.issues, false);
    }
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }

  const appended = appendExperimentRegistryEntry(args.registryPath, completedEntry, appendOptions);
  if (args.json) {
    printJson({ appended: true, entry: appended });
    return;
  }
  process.stdout.write(`Appended experiment registry entry '${appended.runId}' to ${args.registryPath}.\n`);
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
