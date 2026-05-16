import type { OptimizerName } from "../packages/core/index.js";
import { readNamedOptionValue } from "./cliParsing.js";

export const DEFAULT_CLI_CP_SAT_PARAMS = {
  timeLimitSeconds: 30,
  noImprovementTimeoutSeconds: 15,
  numWorkers: 8
};

export interface ParsedExampleCliArgs {
  optimizer: OptimizerName;
  greedyRandomSeed?: number;
  cpSatOptions?: typeof DEFAULT_CLI_CP_SAT_PARAMS;
}

const OPTION_NAMES_WITH_VALUE = new Set([
  "greedy-seed",
  "cp-sat-time-limit",
  "cp-sat-no-improvement-timeout",
  "cp-sat-workers"
]);

function isOptimizerName(value: string): value is OptimizerName {
  return value === "auto" || value === "greedy" || value === "lns" || value === "cp-sat";
}

function readCliOptimizer(argv: readonly string[]): OptimizerName {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index].trim();
    if (value.startsWith("--")) {
      const [optionName] = value.slice(2).split("=", 1);
      if (!value.includes("=") && OPTION_NAMES_WITH_VALUE.has(optionName)) index += 1;
      continue;
    }
    if (isOptimizerName(value)) return value;
  }
  return "auto";
}

function readCliGreedyRandomSeed(argv: readonly string[]): number | undefined {
  const value = Number.parseInt(readNamedOptionValue(argv, "greedy-seed") ?? "", 10);
  return Number.isInteger(value) ? value : undefined;
}

function readNumericCliOption(argv: readonly string[], longName: string, fallback: number): number {
  const value = Number(readNamedOptionValue(argv, longName) ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readIntegerCliOption(argv: readonly string[], longName: string, fallback: number): number {
  return Math.floor(readNumericCliOption(argv, longName, fallback));
}

function readCliCpSatOptions(argv: readonly string[]): typeof DEFAULT_CLI_CP_SAT_PARAMS {
  return {
    timeLimitSeconds: readNumericCliOption(argv, "cp-sat-time-limit", DEFAULT_CLI_CP_SAT_PARAMS.timeLimitSeconds),
    noImprovementTimeoutSeconds: readNumericCliOption(
      argv,
      "cp-sat-no-improvement-timeout",
      DEFAULT_CLI_CP_SAT_PARAMS.noImprovementTimeoutSeconds
    ),
    numWorkers: readIntegerCliOption(argv, "cp-sat-workers", DEFAULT_CLI_CP_SAT_PARAMS.numWorkers)
  };
}

export function parseExampleCliArgs(argv: readonly string[] = process.argv.slice(2)): ParsedExampleCliArgs {
  const optimizer = readCliOptimizer(argv);
  const greedyRandomSeed = readCliGreedyRandomSeed(argv);
  return {
    optimizer,
    ...(greedyRandomSeed !== undefined ? { greedyRandomSeed } : {}),
    ...(optimizer === "cp-sat" ? { cpSatOptions: readCliCpSatOptions(argv) } : {})
  };
}
