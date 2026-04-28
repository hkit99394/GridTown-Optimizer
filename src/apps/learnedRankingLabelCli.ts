import {
  createLearnedRankingLabelSnapshot,
  formatLearnedRankingLabelSuite,
  runLearnedRankingLabelSuite,
} from "../benchmarks/index.js";
import {
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";

interface ParsedLabelArgs {
  json: boolean;
  seeds?: number[];
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
}

function parseArgs(argv: string[]): ParsedLabelArgs {
  let json = false;
  let seeds: number[] | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
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
    if (arg.startsWith("--exploration-windows=")) {
      explorationWindowCount = parseNonNegativeInteger(
        arg.slice("--exploration-windows=".length),
        "exploration windows"
      );
      continue;
    }
    if (arg === "--pressure-corpus") {
      continue;
    }
    if (arg.startsWith("--repair-time=")) {
      repairTimeLimitSeconds = parsePositiveNumber(arg.slice("--repair-time=".length), "repair time");
      continue;
    }
    throw new Error(`Unknown learned-ranking label argument: ${arg}`);
  }

  return { json, seeds, maxWindows, explorationWindowCount, repairTimeLimitSeconds };
}

export function runLearnedRankingLabelCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLearnedRankingLabelSuite({
    seeds: args.seeds,
    maxWindows: args.maxWindows,
    explorationWindowCount: args.explorationWindowCount,
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
