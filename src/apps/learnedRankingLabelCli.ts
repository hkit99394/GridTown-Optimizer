import {
  createLearnedRankingLabelSnapshot,
  formatLearnedRankingLabelSuite,
  runLearnedRankingLabelSuite,
} from "../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
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
  const inlineOptions: Record<string, (value: string) => void> = {
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    "max-windows": (value) => {
      maxWindows = parsePositiveInteger(value, "max windows");
    },
    "exploration-windows": (value) => {
      explorationWindowCount = parseNonNegativeInteger(value, "exploration windows");
    },
    "repair-time": (value) => {
      repairTimeLimitSeconds = parsePositiveNumber(value, "repair time");
    },
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    if (isCliFlag(arg, "--pressure-corpus")) {
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

runCliMain(runLearnedRankingLabelCli);
