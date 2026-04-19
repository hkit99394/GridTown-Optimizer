import { formatCpSatBenchmarkSuite, listCpSatBenchmarkCaseNames, runCpSatBenchmarkSuite } from "../benchmarks/index.js";

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
    process.stdout.write(`${listCpSatBenchmarkCaseNames().join("\n")}\n`);
    return;
  }
  const result = await runCpSatBenchmarkSuite(undefined, {
    names: args.names.length > 0 ? args.names : undefined,
    includeProgressTimeline: true,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatCpSatBenchmarkSuite(result)}\n`);
}

void runCpSatBenchmarkCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
