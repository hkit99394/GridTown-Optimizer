import {
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
} from "../benchmarks/index.js";
import {
  parseNameList,
  parseNumberList,
  parsePositiveNumber,
  readInlineOptionValue,
} from "./cliParsing.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliRaw,
  writeCliText,
} from "./cliOutput.js";

import type { CrossModeBenchmarkMode } from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  traceJsonl: boolean;
  budgetAblations: boolean;
  coverageCorpus: boolean;
  list: boolean;
  names: string[];
  modes?: CrossModeBenchmarkMode[];
  ablationPolicyNames?: string[];
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
}

function parseModes(value: string): CrossModeBenchmarkMode[] {
  const knownModes = new Set<string>(DEFAULT_CROSS_MODE_BENCHMARK_MODES);
  const modes = parseNameList(value, "cross-mode benchmark --modes");
  const unknownModes = modes.filter((mode) => !knownModes.has(mode));
  if (unknownModes.length > 0) {
    throw new Error(
      `Unknown cross-mode benchmark mode(s): ${unknownModes.join(", ")}. Available modes: ${DEFAULT_CROSS_MODE_BENCHMARK_MODES.join(", ")}.`
    );
  }
  return modes as CrossModeBenchmarkMode[];
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let traceJsonl = false;
  let budgetAblations = false;
  let coverageCorpus = false;
  let list = false;
  let modes: CrossModeBenchmarkMode[] | undefined;
  let ablationPolicyNames: string[] | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;

  for (const arg of argv) {
    let value: string | undefined;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--trace-jsonl") {
      traceJsonl = true;
      continue;
    }
    if (arg === "--budget-ablation" || arg === "--budget-ablations") {
      budgetAblations = true;
      continue;
    }
    if (arg === "--coverage-corpus") {
      coverageCorpus = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    value = readInlineOptionValue(arg, "modes");
    if (value !== undefined) {
      modes = parseModes(value);
      continue;
    }
    value = readInlineOptionValue(arg, "ablation-policies");
    if (value !== undefined) {
      ablationPolicyNames = parseNameList(
        value,
        "name for cross-mode benchmark --ablation-policies"
      );
      budgetAblations = true;
      continue;
    }
    value = readInlineOptionValue(arg, "budget");
    if (value !== undefined) {
      budgetSeconds = parsePositiveNumber(value, "cross-mode benchmark --budget");
      continue;
    }
    value = readInlineOptionValue(arg, "budgets");
    if (value !== undefined) {
      budgetsSeconds = parseNumberList(value, "cross-mode benchmark --budgets");
      continue;
    }
    value = readInlineOptionValue(arg, "seeds");
    if (value !== undefined) {
      seeds = parseNumberList(value, "cross-mode benchmark --seeds");
      continue;
    }
    names.push(arg);
  }

  return {
    json,
    traceJsonl,
    budgetAblations,
    coverageCorpus,
    list,
    names,
    modes,
    ablationPolicyNames,
    budgetSeconds,
    budgetsSeconds,
    seeds,
  };
}

export async function runCrossModeBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const corpus = args.coverageCorpus ? DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS : undefined;
  if (args.list) {
    writeCliList(listCrossModeBenchmarkCaseNames(corpus));
    return;
  }

  if (args.budgetAblations) {
    const result = await runCrossModeBenchmarkBudgetAblations(corpus, {
      names: optionalCliNames(args.names),
      modes: args.modes,
      policyNames: args.ablationPolicyNames,
      budgetSeconds: args.budgetSeconds,
      budgetsSeconds: args.budgetsSeconds,
      seeds: args.seeds,
    });

    if (args.json) {
      writeCliJson(result);
      return;
    }

    if (args.traceJsonl) {
      writeCliRaw(formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(result));
      return;
    }

    writeCliText(formatCrossModeBenchmarkBudgetAblations(result));
    return;
  }

  const result = await runCrossModeBenchmarkSuite(corpus, {
    names: optionalCliNames(args.names),
    modes: args.modes,
    budgetSeconds: args.budgetSeconds,
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
  });

  if (args.traceJsonl) {
    writeCliRaw(formatCrossModeBenchmarkDecisionTraceJsonl(result));
    return;
  }

  writeCliJsonOrText(args.json, result, () => formatCrossModeBenchmarkSuite(result));
}

void runCrossModeBenchmarkCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
