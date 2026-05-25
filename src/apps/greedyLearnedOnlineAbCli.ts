import fs from "node:fs";
import path from "node:path";

import {
  formatGreedyLearnedOnlineAb,
  runGreedyLearnedOnlineAb,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveInteger,
  parseScoreRatio,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { writeCliJsonOrText, writeCliText } from "./cliOutput.js";

interface ParsedGreedyLearnedOnlineAbArgs {
  json: boolean;
  names?: string[];
  outputPath?: string;
  seeds?: number[];
  candidateLimit?: number;
  exploratoryMinScoreRatio?: number;
}

function parseArgs(argv: string[]): ParsedGreedyLearnedOnlineAbArgs {
  let json = false;
  let names: string[] | undefined;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
  let candidateLimit: number | undefined;
  let exploratoryMinScoreRatio: number | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    names: (value) => {
      names = parseNameList(value, "--names");
    },
    output: (value) => {
      outputPath = value;
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "--seeds");
    },
    "candidate-limit": (value) => {
      candidateLimit = parsePositiveInteger(value, "--candidate-limit");
    },
    "exploratory-min-score-ratio": (value) => {
      exploratoryMinScoreRatio = parseScoreRatio(value, "--exploratory-min-score-ratio");
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
    throw new Error(`Unknown Greedy learned online A/B argument: ${arg}`);
  }

  return { json, names, outputPath, seeds, candidateLimit, exploratoryMinScoreRatio };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGreedyLearnedOnlineAbCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runGreedyLearnedOnlineAb({
    names: args.names,
    seeds: args.seeds,
    learnedServiceRankingCandidateLimit: args.candidateLimit,
    exploratoryMinScoreRatio: args.exploratoryMinScoreRatio,
  });

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, result);
    if (!args.json) {
      writeCliText(`Wrote Greedy learned online A/B artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatGreedyLearnedOnlineAb(result));
}

runCliMain(runGreedyLearnedOnlineAbCli);
