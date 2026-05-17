import fs from "node:fs";
import path from "node:path";

import {
  formatGreedyOfflineRankerExperiment,
  runGreedyOfflineRankerExperiment,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { writeCliJsonOrText, writeCliText } from "./cliOutput.js";

interface ParsedGreedyOfflineRankerArgs {
  json: boolean;
  outputPath?: string;
  seeds?: number[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
  inferenceRepeats?: number;
}

function parseArgs(argv: string[]): ParsedGreedyOfflineRankerArgs {
  let json = false;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
  let epochs: number | undefined;
  let learningRate: number | undefined;
  let l2: number | undefined;
  let inferenceRepeats: number | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "--seeds");
    },
    epochs: (value) => {
      epochs = parsePositiveInteger(value, "--epochs");
    },
    "learning-rate": (value) => {
      learningRate = parsePositiveNumber(value, "--learning-rate");
    },
    l2: (value) => {
      l2 = parsePositiveNumber(value, "--l2");
    },
    "inference-repeats": (value) => {
      inferenceRepeats = parsePositiveInteger(value, "--inference-repeats");
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
    throw new Error(`Unknown Greedy offline ranker argument: ${arg}`);
  }

  return { json, outputPath, seeds, epochs, learningRate, l2, inferenceRepeats };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGreedyOfflineRankerCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runGreedyOfflineRankerExperiment({
    seeds: args.seeds,
    epochs: args.epochs,
    learningRate: args.learningRate,
    l2: args.l2,
    inferenceRepeats: args.inferenceRepeats,
  });

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, result);
    if (!args.json) {
      writeCliText(`Wrote Greedy offline ranker artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatGreedyOfflineRankerExperiment(result));
}

runCliMain(runGreedyOfflineRankerCli);
