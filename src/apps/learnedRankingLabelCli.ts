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
  readInlineOptionValue,
} from "./cliParsing.js";
import { writeCliJsonOrText } from "./cliOutput.js";

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
    let value: string | undefined;
    if (arg === "--json") {
      json = true;
      continue;
    }
    value = readInlineOptionValue(arg, "seeds");
    if (value !== undefined) {
      seeds = parseNumberList(value, "seeds");
      continue;
    }
    value = readInlineOptionValue(arg, "max-windows");
    if (value !== undefined) {
      maxWindows = parsePositiveInteger(value, "max windows");
      continue;
    }
    value = readInlineOptionValue(arg, "exploration-windows");
    if (value !== undefined) {
      explorationWindowCount = parseNonNegativeInteger(value, "exploration windows");
      continue;
    }
    if (arg === "--pressure-corpus") {
      continue;
    }
    value = readInlineOptionValue(arg, "repair-time");
    if (value !== undefined) {
      repairTimeLimitSeconds = parsePositiveNumber(value, "repair time");
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

  writeCliJsonOrText(args.json, () => createLearnedRankingLabelSnapshot(result), () =>
    formatLearnedRankingLabelSuite(result)
  );
}

try {
  runLearnedRankingLabelCli();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
