import * as fs from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  formatNpmScriptCommand,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
  writeCrossModeTelemetryManifest,
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
  list: boolean;
  names: string[];
  modes?: CrossModeBenchmarkMode[];
  ablationPolicyNames?: string[];
  outputPath?: string;
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  manifestOutputPath?: string;
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
  let outputPath: string | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;
  let manifestOutputPath: string | undefined;
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
    output: (value) => {
      outputPath = value;
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
    "manifest-output": (value) => {
      manifestOutputPath = value;
    },
    manifest: (value) => {
      manifestOutputPath = value;
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
    list,
    names,
    modes,
    ablationPolicyNames,
    outputPath,
    budgetSeconds,
    budgetsSeconds,
    seeds,
    manifestOutputPath,
  };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
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

    if (args.outputPath) {
      writeJsonArtifact(args.outputPath, result);
      if (!args.json && !args.traceJsonl) {
        writeCliText(`Wrote cross-mode budget ablation artifact to ${args.outputPath}.`);
      }
    }

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

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, result);
    if (!args.json && !args.traceJsonl) {
      writeCliText(`Wrote cross-mode benchmark artifact to ${args.outputPath}.`);
    }
  }

  if (args.manifestOutputPath) {
    writeCrossModeTelemetryManifest(result, args.manifestOutputPath, corpus, {
      names: optionalCliNames(args.names),
      modes: args.modes,
      budgetSeconds: args.budgetSeconds,
      budgetsSeconds: args.budgetsSeconds,
      seeds: args.seeds,
      commands: [formatNpmScriptCommand("benchmark:scorecard", process.argv.slice(2))],
      artifactPaths: [args.manifestOutputPath],
    });
    if (!args.json && !args.traceJsonl) {
      writeCliText(`Wrote solver telemetry manifest to ${args.manifestOutputPath}.`);
    }
  }

  if (args.traceJsonl) {
    writeCliRaw(formatCrossModeBenchmarkDecisionTraceJsonl(result));
    return;
  }

  writeCliJsonOrText(args.json, result, () => formatCrossModeBenchmarkSuite(result));
}

runCliMain(runCrossModeBenchmarkCli);
