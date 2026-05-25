import {
  formatLnsLearnedGuardCalibration,
  runLnsLearnedGuardCalibration,
  writeLnsLearnedGuardCalibrationArtifact,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveInteger,
  parseScoreRatioList,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { writeCliJsonOrText, writeCliText } from "./cliOutput.js";

interface ParsedLnsLearnedGuardCalibrationArgs {
  json: boolean;
  productNames?: string[];
  crossModeNames?: string[];
  outputPath?: string;
  seeds?: number[];
  candidateLimit?: number;
  minScoreRatios?: number[];
}

function parseArgs(argv: string[]): ParsedLnsLearnedGuardCalibrationArgs {
  let json = false;
  let productNames: string[] | undefined;
  let crossModeNames: string[] | undefined;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
  let candidateLimit: number | undefined;
  let minScoreRatios: number[] | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    "product-names": (value) => {
      productNames = parseNameList(value, "--product-names");
    },
    "cross-mode-names": (value) => {
      crossModeNames = parseNameList(value, "--cross-mode-names");
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
    "min-score-ratios": (value) => {
      minScoreRatios = parseScoreRatioList(value, "--min-score-ratios");
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
    throw new Error(`Unknown LNS learned guard calibration argument: ${arg}`);
  }

  return { json, productNames, crossModeNames, outputPath, seeds, candidateLimit, minScoreRatios };
}

export function runLnsLearnedGuardCalibrationCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLnsLearnedGuardCalibration({
    productNames: args.productNames,
    crossModeNames: args.crossModeNames,
    seeds: args.seeds,
    learnedWindowRankingCandidateLimit: args.candidateLimit,
    minScoreRatios: args.minScoreRatios,
  });

  if (args.outputPath) {
    writeLnsLearnedGuardCalibrationArtifact(result, args.outputPath);
    if (!args.json) {
      writeCliText(`Wrote LNS learned guard calibration artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatLnsLearnedGuardCalibration(result));
}

runCliMain(runLnsLearnedGuardCalibrationCli);
