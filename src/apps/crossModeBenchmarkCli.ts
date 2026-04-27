import {
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

import type { CrossModeBenchmarkBudgetAblationPolicy, CrossModeBenchmarkMode } from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  traceJsonl: boolean;
  budgetAblations: boolean;
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
  const modes = value
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode) => mode.length > 0);
  const unknownModes = modes.filter((mode) => !knownModes.has(mode));
  if (unknownModes.length > 0) {
    throw new Error(
      `Unknown cross-mode benchmark mode(s): ${unknownModes.join(", ")}. Available modes: ${DEFAULT_CROSS_MODE_BENCHMARK_MODES.join(", ")}.`
    );
  }
  return modes as CrossModeBenchmarkMode[];
}

function parseBudget(value: string): number {
  const budgetSeconds = Number(value);
  if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0) {
    throw new Error("Cross-mode benchmark --budget must be a positive number of seconds.");
  }
  return budgetSeconds;
}

function parseNumberList(value: string, label: string): number[] {
  const parts = value
    .split(",")
    .map((part) => part.trim());
  const numbers = parts.map((part) => Number(part));
  if (numbers.length === 0) {
    throw new Error(`Cross-mode benchmark --${label} must include at least one number.`);
  }
  if (parts.some((part) => part.length === 0) || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error(`Cross-mode benchmark --${label} must include only finite numbers.`);
  }
  return numbers;
}

function parseNameList(value: string, label: string): string[] {
  const names = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (names.length === 0) {
    throw new Error(`Cross-mode benchmark --${label} must include at least one name.`);
  }
  return names;
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
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg.startsWith("--modes=")) {
      modes = parseModes(arg.slice("--modes=".length));
      continue;
    }
    if (arg.startsWith("--ablation-policies=")) {
      ablationPolicyNames = parseNameList(arg.slice("--ablation-policies=".length), "ablation-policies");
      budgetAblations = true;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetSeconds = parseBudget(arg.slice("--budget=".length));
      continue;
    }
    if (arg.startsWith("--budgets=")) {
      budgetsSeconds = parseNumberList(arg.slice("--budgets=".length), "budgets");
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "seeds");
      continue;
    }
    names.push(arg);
  }

  return { json, traceJsonl, budgetAblations, list, names, modes, ablationPolicyNames, budgetSeconds, budgetsSeconds, seeds };
}

export async function runCrossModeBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    process.stdout.write(`${listCrossModeBenchmarkCaseNames().join("\n")}\n`);
    return;
  }

  if (args.budgetAblations) {
    const result = await runCrossModeBenchmarkBudgetAblations(undefined, {
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

  const result = await runCrossModeBenchmarkSuite(undefined, {
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
