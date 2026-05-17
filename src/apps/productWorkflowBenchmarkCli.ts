import {
  formatProductWorkflowBenchmarkSuite,
  listProductWorkflowBenchmarkCaseNames,
  runProductWorkflowBenchmarkSuite,
  writeProductWorkflowBenchmarkArtifact,
} from "../benchmarks/index.js";
import { runCliMain } from "./cliEntrypoint.js";
import { optionalCliNames, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNumberList,
} from "./cliParsing.js";

interface ParsedProductWorkflowBenchmarkArgs {
  json: boolean;
  list: boolean;
  names: string[];
  outputPath?: string;
  budgetsSeconds?: number[];
  seeds?: number[];
}

function parseArgs(argv: string[]): ParsedProductWorkflowBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let list = false;
  let outputPath: string | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;

  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
    budgets: (value) => {
      budgetsSeconds = parseNumberList(value, "benchmark budgets");
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "benchmark seeds");
    },
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--list")) {
      list = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    names.push(arg);
  }

  return { json, list, names, outputPath, budgetsSeconds, seeds };
}

export async function runProductWorkflowBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    writeCliList(listProductWorkflowBenchmarkCaseNames());
    return;
  }

  let result = await runProductWorkflowBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names),
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
  });
  if (args.outputPath) {
    result = writeProductWorkflowBenchmarkArtifact(result, args.outputPath);
    if (!args.json) {
      writeCliText(`Wrote product workflow benchmark artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatProductWorkflowBenchmarkSuite(result));
  if (!result.passed) {
    process.exitCode = 1;
  }
}

runCliMain(runProductWorkflowBenchmarkCli);
