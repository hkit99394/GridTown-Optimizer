import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  appendExperimentRegistryEntry,
  captureExperimentRegistryHardwareMetadata,
  checkExperimentRegistryFile,
  completeExperimentRegistryEntry,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile
} from "../../benchmarkApi.js";
import { applyInlineOptionHandlers, isCliFlag, parseNumberList } from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import { writeCliJson, writeCliText } from "../../apps/cliOutput.js";

import type {
  ExperimentRegistryCheckOptions,
  ExperimentRegistryEntry,
  ExperimentRegistryIssue
} from "../../benchmarkApi.js";

type RegistryCommand = "check" | "validate-entry" | "append" | "help";

interface ParsedRegistryArgs {
  command: RegistryCommand;
  registryPath: string;
  entryPath?: string;
  dryRun: boolean;
  json: boolean;
  strict: boolean;
  historicalWarnings: boolean;
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
    "  --historical-warnings          Include accepted historical metadata warnings on check.",
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
    "  --hardware-notes=<text>        Record hardware notes."
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
  let historicalWarnings = false;
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
  const inlineOptions: Record<string, (value: string) => void> = {
    registry: (value) => {
      registryPath = value;
    },
    entry: (value) => {
      entryPath = value;
    },
    "indexed-at": (value) => {
      indexedAt = value;
    },
    "indexed-git-commit": (value) => {
      indexedGitCommit = value;
    },
    "artifact-git-commit": (value) => {
      artifactGitCommit = value === "null" || value === "none" ? null : value;
    },
    branch: (value) => {
      branch = value;
    },
    "generated-at": (value) => {
      generatedAt = value;
    },
    "run-id": (value) => {
      runId = value;
    },
    "artifact-type": (value) => {
      artifactType = value;
    },
    command: (value) => {
      commands.push(value);
    },
    "artifact-path": (value) => {
      artifactPaths.push(value);
    },
    case: (value) => {
      const currentCases = Array.isArray(cases) ? cases : [];
      cases = [...currentCases, value];
    },
    cases: (value) => {
      cases = JSON.parse(value) as unknown;
    },
    "case-family": (value) => {
      caseFamilies.push(value);
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "--seeds");
    },
    "split-status": (value) => {
      splitStatus = value === "null" ? null : (JSON.parse(value) as unknown);
    },
    budget: (value) => {
      budget = JSON.parse(value) as unknown;
    },
    hardware: (value) => {
      hardware = JSON.parse(value) as unknown;
    },
    model: (value) => {
      model = value === "null" ? null : (JSON.parse(value) as unknown);
    },
    decision: (value) => {
      decision = value;
    },
    summary: (value) => {
      summary = value;
    },
    "gpu-model": (value) => {
      gpuModel = value;
    },
    "gpu-runtime": (value) => {
      gpuRuntime = value;
    },
    "gpu-driver": (value) => {
      gpuDriver = value;
    },
    "gpu-memory-bytes": (value) => {
      gpuMemoryBytes = parseNumber(value, "GPU memory bytes");
    },
    "hardware-notes": (value) => {
      hardwareNotes = value;
    }
  };

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
    if (isCliFlag(arg, "--dry-run")) {
      dryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--strict", "--strict-metadata")) {
      strict = true;
      continue;
    }
    if (isCliFlag(arg, "--historical-warnings")) {
      historicalWarnings = true;
      continue;
    }
    if (isCliFlag(arg, "--allow-historical")) {
      allowHistorical = true;
      continue;
    }
    if (isCliFlag(arg, "--no-artifacts")) {
      validateArtifactPaths = false;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
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
    historicalWarnings,
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
    hardwareNotes
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
  const content =
    entryPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(process.cwd(), entryPath), "utf8");
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
    summary: args.summary
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
    hardware:
      (args.hardware as Record<string, unknown> & { captured: boolean; gpuUsed: boolean }) ??
      captureExperimentRegistryHardwareMetadata(hardwareOverrides)
  });
}

function assertNoDuplicateRunId(
  registryPath: string,
  entry: Record<string, unknown>,
  options: ExperimentRegistryCheckOptions
): void {
  const registryRoot = options.rootDir ?? options.cwd ?? process.cwd();
  if (!fs.existsSync(path.resolve(registryRoot, registryPath))) {
    return;
  }
  const registryResult = validateExperimentRegistryFile(registryPath, {
    ...options,
    strict: false,
    strictMetadata: false
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
        field: "runId"
      }
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
    strict: args.strict
  };

  if (args.command === "check") {
    const result = args.historicalWarnings
      ? validateExperimentRegistryFile(args.registryPath, baseOptions)
      : checkExperimentRegistryFile(args.registryPath, baseOptions);
    printCheckResult(result.entries, result.issues, args.json);
    if (result.issues.some((issue) => issue.severity !== "warning")) process.exitCode = 1;
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
    strict: args.allowHistorical ? args.strict : true
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

runCliMain(runExperimentRegistryCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    console.error(error);
  }
});
