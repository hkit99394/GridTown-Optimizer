import {
  formatLnsLearnedPromotionReview,
  runLnsLearnedPromotionReview,
  writeLnsLearnedPromotionReviewArtifact,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveInteger,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { writeCliJsonOrText, writeCliText } from "./cliOutput.js";

interface ParsedLnsLearnedPromotionReviewArgs {
  json: boolean;
  productNames?: string[];
  crossModeNames?: string[];
  outputPath?: string;
  seeds?: number[];
  candidateLimit?: number;
}

function parseArgs(argv: string[]): ParsedLnsLearnedPromotionReviewArgs {
  let json = false;
  let productNames: string[] | undefined;
  let crossModeNames: string[] | undefined;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
  let candidateLimit: number | undefined;
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
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    throw new Error(`Unknown LNS learned promotion review argument: ${arg}`);
  }

  return { json, productNames, crossModeNames, outputPath, seeds, candidateLimit };
}

export function runLnsLearnedPromotionReviewCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLnsLearnedPromotionReview({
    productNames: args.productNames,
    crossModeNames: args.crossModeNames,
    seeds: args.seeds,
    learnedWindowRankingCandidateLimit: args.candidateLimit,
  });

  if (args.outputPath) {
    writeLnsLearnedPromotionReviewArtifact(result, args.outputPath);
    if (!args.json) {
      writeCliText(`Wrote LNS learned promotion review artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatLnsLearnedPromotionReview(result));
}

runCliMain(runLnsLearnedPromotionReviewCli);
