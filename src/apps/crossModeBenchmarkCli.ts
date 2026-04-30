import {
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
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
  productCorpus: boolean;
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
  let productCorpus = false;
  let list = false;
  let modes: CrossModeBenchmarkMode[] | undefined;
  let ablationPolicyNames: string[] | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    modes: (value) => {
      modes = parseModes(value);
    },
    "ablation-policies": (value) => {
      ablationPolicyNames = parseNameList(
        value,
        "name for cross-mode benchmark --ablation-policies"
      );
      budgetAblations = true;
    },
    budget: (value) => {
      budgetSeconds = parsePositiveNumber(value, "cross-mode benchmark --budget");
    },
    budgets: (value) => {
      budgetsSeconds = parseNumberList(value, "cross-mode benchmark --budgets");
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "cross-mode benchmark --seeds");
    },
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--trace-jsonl")) {
      traceJsonl = true;
      continue;
    }
    if (isCliFlag(arg, "--budget-ablation", "--budget-ablations")) {
      budgetAblations = true;
      continue;
    }
    if (isCliFlag(arg, "--coverage-corpus")) {
      coverageCorpus = true;
      continue;
    }
    if (isCliFlag(arg, "--product-corpus")) {
      productCorpus = true;
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

  return {
    json,
    traceJsonl,
    budgetAblations,
    coverageCorpus,
    productCorpus,
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
  if (args.coverageCorpus && args.productCorpus) {
    throw new Error("Use only one cross-mode corpus selector: --coverage-corpus or --product-corpus.");
  }
  const corpus = args.productCorpus
    ? DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS
    : args.coverageCorpus
      ? DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS
      : undefined;
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

runCliMain(runCrossModeBenchmarkCli);
