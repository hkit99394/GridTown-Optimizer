import {
  formatLnsLearnedDisplacementDiagnostics,
  runLnsLearnedDisplacementDiagnostics,
  writeLnsLearnedDisplacementDiagnosticsArtifact,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { writeCliJsonOrText, writeCliText } from "./cliOutput.js";

interface ParsedLnsLearnedDisplacementDiagnosticsArgs {
  json: boolean;
  productNames?: string[];
  crossModeNames?: string[];
  outputPath?: string;
  seeds?: number[];
}

function parseArgs(argv: string[]): ParsedLnsLearnedDisplacementDiagnosticsArgs {
  let json = false;
  let productNames: string[] | undefined;
  let crossModeNames: string[] | undefined;
  let outputPath: string | undefined;
  let seeds: number[] | undefined;
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
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    throw new Error(`Unknown LNS learned displacement diagnostics argument: ${arg}`);
  }

  return { json, productNames, crossModeNames, outputPath, seeds };
}

export function runLnsLearnedDisplacementDiagnosticsCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = runLnsLearnedDisplacementDiagnostics({
    productNames: args.productNames,
    crossModeNames: args.crossModeNames,
    seeds: args.seeds,
  });

  if (args.outputPath) {
    writeLnsLearnedDisplacementDiagnosticsArtifact(result, args.outputPath);
    if (!args.json) {
      writeCliText(`Wrote LNS learned displacement diagnostics artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatLnsLearnedDisplacementDiagnostics(result));
}

runCliMain(runLnsLearnedDisplacementDiagnosticsCli);
