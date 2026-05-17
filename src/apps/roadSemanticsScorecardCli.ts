import {
  formatRoadSemanticsScorecard,
  listRoadSemanticsScorecardCaseNames,
  runRoadSemanticsScorecard,
  writeRoadSemanticsScorecardArtifact,
} from "../benchmarks/index.js";
import { runCliMain } from "./cliEntrypoint.js";
import { optionalCliNames, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";

import type { CpSatOptions } from "../core/types.js";

interface ParsedRoadSemanticsScorecardArgs {
  json: boolean;
  list: boolean;
  names: string[];
  outputPath?: string;
  cpSat: Partial<CpSatOptions>;
}

function parseArgs(argv: string[]): ParsedRoadSemanticsScorecardArgs {
  const names: string[] = [];
  const cpSat: Partial<CpSatOptions> = {};
  let json = false;
  let list = false;
  let outputPath: string | undefined;

  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
    "cp-sat-time-limit": (value) => {
      cpSat.timeLimitSeconds = parsePositiveNumber(value, "CP-SAT time limit");
    },
    "cp-sat-max-deterministic-time": (value) => {
      cpSat.maxDeterministicTime = parsePositiveNumber(value, "CP-SAT max deterministic time");
    },
    "cp-sat-workers": (value) => {
      cpSat.numWorkers = parsePositiveInteger(value, "CP-SAT worker count");
    },
    "cp-sat-seed": (value) => {
      cpSat.randomSeed = parsePositiveInteger(value, "CP-SAT random seed");
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

  return { json, list, names, outputPath, cpSat };
}

export async function runRoadSemanticsScorecardCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    writeCliList(listRoadSemanticsScorecardCaseNames());
    return;
  }

  let result = await runRoadSemanticsScorecard(undefined, {
    names: optionalCliNames(args.names),
    cpSat: args.cpSat,
  });
  if (args.outputPath) {
    result = writeRoadSemanticsScorecardArtifact(result, args.outputPath);
    if (!args.json) {
      writeCliText(`Wrote road-semantics scorecard artifact to ${args.outputPath}.`);
    }
  }

  writeCliJsonOrText(args.json, result, () => formatRoadSemanticsScorecard(result));
  if (!result.passed) {
    process.exitCode = 1;
  }
}

runCliMain(runRoadSemanticsScorecardCli);
