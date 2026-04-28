import { formatCpSatBenchmarkSuite, listCpSatBenchmarkCaseNames, runCpSatBenchmarkSuite } from "../benchmarks/index.js";
import { optionalCliNames, writeCliJsonOrText, writeCliList } from "./cliOutput.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  list: boolean;
  names: string[];
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let list = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    names.push(arg);
  }

  return { json, list, names };
}

export async function runCpSatBenchmarkCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    writeCliList(listCpSatBenchmarkCaseNames());
    return;
  }
  const result = await runCpSatBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names),
    includeProgressTimeline: true,
  });
  writeCliJsonOrText(args.json, result, () => formatCpSatBenchmarkSuite(result));
}

void runCpSatBenchmarkCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
