import fs from "node:fs";
import path from "node:path";

import {
  createLearnedRankingLabelSnapshot,
  formatLearnedRankingLabelSuite,
  runLearnedRankingLabelSuite,
} from "../benchmarks/index.js";
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
  outputPath?: string;
}

function parseArgs(argv: string[]): ParsedLabelArgs {
  let json = false;
  let seeds: number[] | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let repairTimeLimitSeconds: number | undefined;
  let outputPath: string | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
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

  return { json, seeds, maxWindows, explorationWindowCount, repairTimeLimitSeconds, outputPath };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function runLearnedRankingLabelCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLearnedRankingLabelSuite({
    seeds: args.seeds,
    maxWindows: args.maxWindows,
    explorationWindowCount: args.explorationWindowCount,
    repairTimeLimitSeconds: args.repairTimeLimitSeconds,
  });
  const snapshot = createLearnedRankingLabelSnapshot(result);

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, snapshot);
    if (!args.json) {
      process.stdout.write(`Wrote learned-ranking label artifact to ${args.outputPath}.\n`);
    }
  }

  writeCliJsonOrText(args.json, snapshot, () =>
    formatLearnedRankingLabelSuite(result)
  );
}

runCliMain(runLearnedRankingLabelCli);
