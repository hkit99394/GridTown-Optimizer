import fs from "node:fs";
import path from "node:path";

import {
  formatLnsOfflineRankerExperiment,
  runLnsOfflineRankerExperiment,
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

import type { LearnedRankingLabelSuiteResult } from "../benchmarks/index.js";

interface ParsedLnsOfflineRankerArgs {
  json: boolean;
  inputPath?: string;
  outputPath?: string;
  seeds?: number[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
  inferenceRepeats?: number;
}

function parseArgs(argv: string[]): ParsedLnsOfflineRankerArgs {
  let json = false;
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
  let epochs: number | undefined;
  let learningRate: number | undefined;
  let l2: number | undefined;
  let inferenceRepeats: number | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    input: (value) => {
      inputPath = value;
    },
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
    throw new Error(`Unknown LNS offline ranker argument: ${arg}`);
  }

  return { json, inputPath, outputPath, seeds, epochs, learningRate, l2, inferenceRepeats };
}

function readLabelSuite(inputPath: string | undefined): LearnedRankingLabelSuiteResult | undefined {
  if (inputPath === undefined) return undefined;
  const normalizedPath = path.resolve(process.cwd(), inputPath);
  return JSON.parse(fs.readFileSync(normalizedPath, "utf8")) as LearnedRankingLabelSuiteResult;
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function runLnsOfflineRankerCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLnsOfflineRankerExperiment({
    labelSuite: readLabelSuite(args.inputPath),
    seeds: args.seeds,
    epochs: args.epochs,
    learningRate: args.learningRate,
    l2: args.l2,
    inferenceRepeats: args.inferenceRepeats,
  });

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, result);
    if (!args.json) {
      writeCliText(`Wrote LNS offline ranker artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatLnsOfflineRankerExperiment(result));
}

runCliMain(runLnsOfflineRankerCli);
