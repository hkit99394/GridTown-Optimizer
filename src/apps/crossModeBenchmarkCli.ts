import {
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES,
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
} from "./cliParsing.js";

import type { CrossModeBenchmarkBudgetAblationPolicy, CrossModeBenchmarkMode } from "../benchmarks/index.js";

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

function selectAblationPolicies(names: string[] | undefined): CrossModeBenchmarkBudgetAblationPolicy[] | undefined {
  if (!names?.length) return undefined;
  const byName = new Map(DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.map((policy) => [policy.name, policy]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown cross-mode budget ablation policy(s): ${missing.join(", ")}. Available policies: ${DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES.map((policy) => policy.name).join(", ")}.`
    );
  }
  return names.map((name) => byName.get(name) as CrossModeBenchmarkBudgetAblationPolicy);
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
    if (arg.startsWith("--modes=")) {
      modes = parseModes(arg.slice("--modes=".length));
      continue;
    }
    if (arg.startsWith("--ablation-policies=")) {
      ablationPolicyNames = parseNameList(
        arg.slice("--ablation-policies=".length),
        "name for cross-mode benchmark --ablation-policies"
      );
      budgetAblations = true;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetSeconds = parsePositiveNumber(arg.slice("--budget=".length), "cross-mode benchmark --budget");
      continue;
    }
    if (arg.startsWith("--budgets=")) {
      budgetsSeconds = parseNumberList(arg.slice("--budgets=".length), "cross-mode benchmark --budgets");
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "cross-mode benchmark --seeds");
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
    process.stdout.write(`${listCrossModeBenchmarkCaseNames(corpus).join("\n")}\n`);
    return;
  }

  if (args.budgetAblations) {
    const result = await runCrossModeBenchmarkBudgetAblations(corpus, {
      names: args.names.length > 0 ? args.names : undefined,
      modes: args.modes,
      policies: selectAblationPolicies(args.ablationPolicyNames),
      budgetSeconds: args.budgetSeconds,
      budgetsSeconds: args.budgetsSeconds,
      seeds: args.seeds,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (args.traceJsonl) {
      process.stdout.write(formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(result));
      return;
    }

    process.stdout.write(`${formatCrossModeBenchmarkBudgetAblations(result)}\n`);
    return;
  }

  const result = await runCrossModeBenchmarkSuite(corpus, {
    names: args.names.length > 0 ? args.names : undefined,
    modes: args.modes,
    budgetSeconds: args.budgetSeconds,
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (args.traceJsonl) {
    process.stdout.write(formatCrossModeBenchmarkDecisionTraceJsonl(result));
    return;
  }

  process.stdout.write(`${formatCrossModeBenchmarkSuite(result)}\n`);
}

void runCrossModeBenchmarkCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
