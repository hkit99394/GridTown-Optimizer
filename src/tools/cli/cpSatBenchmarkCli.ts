import {
  DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES,
  formatCpSatBenchmarkSuite,
  listCpSatBenchmarkCaseNames,
  runCpSatBenchmarkSuite,
} from "../../benchmarkApi.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import { applyInlineOptionHandlers, isCliFlag, parsePositiveInteger, parsePositiveNumber } from "../../apps/cliParsing.js";
import { optionalCliNames, writeCliJsonOrText, writeCliList } from "../../apps/cliOutput.js";

import type { CpSatOptions } from "../../core/types.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  list: boolean;
  roadSemanticsScorecard: boolean;
  names: string[];
  cpSat: Partial<CpSatOptions>;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let list = false;
  let roadSemanticsScorecard = false;
  const cpSat: Partial<CpSatOptions> = {};
  const inlineOptions: Record<string, (value: string) => void> = {
    "time-limit": (value) => {
      cpSat.timeLimitSeconds = parsePositiveNumber(value, "CP-SAT benchmark --time-limit");
    },
    "deterministic-time": (value) => {
      cpSat.maxDeterministicTime = parsePositiveNumber(value, "CP-SAT benchmark --deterministic-time");
    },
    workers: (value) => {
      cpSat.numWorkers = parsePositiveInteger(value, "CP-SAT benchmark --workers");
    },
    seed: (value) => {
      cpSat.randomSeed = parsePositiveInteger(value, "CP-SAT benchmark --seed");
    },
    "progress-interval": (value) => {
      cpSat.progressIntervalSeconds = parsePositiveNumber(value, "CP-SAT benchmark --progress-interval");
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
    if (isCliFlag(arg, "--road-semantics-scorecard")) {
      roadSemanticsScorecard = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    names.push(arg);
  }

  return { json, list, roadSemanticsScorecard, names, cpSat };
}

export async function runCpSatBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    writeCliList(args.roadSemanticsScorecard
      ? DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES
      : listCpSatBenchmarkCaseNames());
    return;
  }
  const selectedNames =
    args.roadSemanticsScorecard && args.names.length === 0
      ? [...DEFAULT_CP_SAT_ROAD_SEMANTICS_SCORECARD_CASE_NAMES]
      : optionalCliNames(args.names);
  const result = await runCpSatBenchmarkSuite(undefined, {
    names: selectedNames,
    includeProgressTimeline: true,
    cpSat: args.cpSat,
  });
  writeCliJsonOrText(args.json, result, () => formatCpSatBenchmarkSuite(result));
}

runCliMain(runCpSatBenchmarkCli);
