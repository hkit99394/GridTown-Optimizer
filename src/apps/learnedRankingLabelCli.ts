import {
  createLearnedRankingLabelSnapshot,
  formatLearnedRankingLabelSuite,
  runLearnedRankingLabelSuite,
} from "../benchmarks/index.js";

interface ParsedLabelArgs {
  json: boolean;
  seeds?: number[];
  maxWindows?: number;
  repairTimeLimitSeconds?: number;
}

function parseNumberList(value: string, label: string): number[] {
  const parts = value
    .split(",")
    .map((entry) => entry.trim());
  const numbers = parts.map((entry) => Number(entry));
  if (parts.length === 0 || parts.some((entry) => entry.length === 0) || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error(`Expected ${label} to contain only finite numbers.`);
  }
  return numbers;
}

function parsePositiveInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return number;
}

function parsePositiveNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Expected ${label} to be a positive number.`);
  }
  return number;
}

function parseArgs(argv: string[]): ParsedLabelArgs {
  let json = false;
  let seeds: number[] | undefined;
  let maxWindows: number | undefined;
  let repairTimeLimitSeconds: number | undefined;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "seeds");
      continue;
    }
    if (arg.startsWith("--max-windows=")) {
      maxWindows = parsePositiveInteger(arg.slice("--max-windows=".length), "max windows");
      continue;
    }
    if (arg.startsWith("--repair-time=")) {
      repairTimeLimitSeconds = parsePositiveNumber(arg.slice("--repair-time=".length), "repair time");
      continue;
    }
    throw new Error(`Unknown learned-ranking label argument: ${arg}`);
  }

  return { json, seeds, maxWindows, repairTimeLimitSeconds };
}

export function runLearnedRankingLabelCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLearnedRankingLabelSuite({
    seeds: args.seeds,
    maxWindows: args.maxWindows,
    repairTimeLimitSeconds: args.repairTimeLimitSeconds,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(createLearnedRankingLabelSnapshot(result), null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatLearnedRankingLabelSuite(result)}\n`);
}

try {
  runLearnedRankingLabelCli();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
