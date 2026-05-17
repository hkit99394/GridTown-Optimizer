import fs from "node:fs";
import path from "node:path";

import {
  formatServiceMasterBenchmarkSuite,
  listServiceMasterBenchmarkCaseNames,
  runServiceMasterBenchmarkSuite,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { optionalCliNames, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";

interface ParsedArgs {
  json: boolean;
  list: boolean;
  names: string[];
  outputPath?: string;
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  maxServiceLayouts?: number;
  serviceCandidatePoolSize?: number;
  maxLayoutServiceCount?: number;
  cpSatTimeLimitSeconds?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const names: string[] = [];
  let json = false;
  let list = false;
  let outputPath: string | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;
  let maxServiceLayouts: number | undefined;
  let serviceCandidatePoolSize: number | undefined;
  let maxLayoutServiceCount: number | undefined;
  let cpSatTimeLimitSeconds: number | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
    budget: (value) => {
      budgetSeconds = parsePositiveNumber(value, "--budget");
    },
    budgets: (value) => {
      budgetsSeconds = parseNumberList(value, "--budgets");
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "--seeds");
    },
    "max-layouts": (value) => {
      maxServiceLayouts = parsePositiveInteger(value, "--max-layouts");
    },
    "candidate-pool": (value) => {
      serviceCandidatePoolSize = parsePositiveInteger(value, "--candidate-pool");
    },
    "max-layout-services": (value) => {
      maxLayoutServiceCount = parsePositiveInteger(value, "--max-layout-services");
    },
    "cp-sat-time": (value) => {
      cpSatTimeLimitSeconds = parsePositiveNumber(value, "--cp-sat-time");
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

  return {
    json,
    list,
    names,
    outputPath,
    budgetSeconds,
    budgetsSeconds,
    seeds,
    maxServiceLayouts,
    serviceCandidatePoolSize,
    maxLayoutServiceCount,
    cpSatTimeLimitSeconds,
  };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runServiceMasterBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    writeCliList(listServiceMasterBenchmarkCaseNames());
    return;
  }

  const result = await runServiceMasterBenchmarkSuite({
    names: optionalCliNames(args.names),
    budgetSeconds: args.budgetSeconds,
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
    maxServiceLayouts: args.maxServiceLayouts,
    serviceCandidatePoolSize: args.serviceCandidatePoolSize,
    maxLayoutServiceCount: args.maxLayoutServiceCount,
    cpSat: args.cpSatTimeLimitSeconds === undefined
      ? undefined
      : {
          timeLimitSeconds: args.cpSatTimeLimitSeconds,
          maxDeterministicTime: args.cpSatTimeLimitSeconds,
        },
  });

  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, result);
    if (!args.json) writeCliText(`Wrote service-master benchmark artifact to ${args.outputPath}.`);
  }

  writeCliJsonOrText(args.json, result, () => formatServiceMasterBenchmarkSuite(result));
}

runCliMain(runServiceMasterBenchmarkCli);
