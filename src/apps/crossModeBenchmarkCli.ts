import {
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  formatCrossModeBenchmarkSuite,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkSuite,
} from "../benchmarks/index.js";

import type { CrossModeBenchmarkMode } from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  list: boolean;
  names: string[];
  modes?: CrossModeBenchmarkMode[];
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
}

function parseModes(value: string): CrossModeBenchmarkMode[] {
  const knownModes = new Set<string>(DEFAULT_CROSS_MODE_BENCHMARK_MODES);
  const modes = value
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode) => mode.length > 0);
  const unknownModes = modes.filter((mode) => !knownModes.has(mode));
  if (unknownModes.length > 0) {
    throw new Error(
      `Unknown cross-mode benchmark mode(s): ${unknownModes.join(", ")}. Available modes: ${DEFAULT_CROSS_MODE_BENCHMARK_MODES.join(", ")}.`
    );
  }
  return modes as CrossModeBenchmarkMode[];
}

function parseBudget(value: string): number {
  const budgetSeconds = Number(value);
  if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0) {
    throw new Error("Cross-mode benchmark --budget must be a positive number of seconds.");
  }
  return budgetSeconds;
}

function parseNumberList(value: string, label: string): number[] {
  const numbers = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
  if (numbers.length === 0) {
    throw new Error(`Cross-mode benchmark --${label} must include at least one number.`);
  }
  return numbers;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let list = false;
  let modes: CrossModeBenchmarkMode[] | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg.startsWith("--modes=")) {
      modes = parseModes(arg.slice("--modes=".length));
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetSeconds = parseBudget(arg.slice("--budget=".length));
      continue;
    }
    if (arg.startsWith("--budgets=")) {
      budgetsSeconds = parseNumberList(arg.slice("--budgets=".length), "budgets");
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "seeds");
      continue;
    }
    names.push(arg);
  }

  return { json, list, names, modes, budgetSeconds, budgetsSeconds, seeds };
}

export async function runCrossModeBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    process.stdout.write(`${listCrossModeBenchmarkCaseNames().join("\n")}\n`);
    return;
  }

  const result = await runCrossModeBenchmarkSuite(undefined, {
    names: args.names.length > 0 ? args.names : undefined,
    modes: args.modes,
    budgetSeconds: args.budgetSeconds,
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatCrossModeBenchmarkSuite(result)}\n`);
}

void runCrossModeBenchmarkCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
