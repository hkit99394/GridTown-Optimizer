import {
  createLnsBenchmarkSnapshot,
  formatLnsBenchmarkSuite,
  listLnsBenchmarkCaseNames,
  runLnsBenchmarkSuite,
} from "../benchmarks/index.js";

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

export function runLnsBenchmarkCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    process.stdout.write(`${listLnsBenchmarkCaseNames().join("\n")}\n`);
    return;
  }

  const result = runLnsBenchmarkSuite(undefined, {
    names: args.names.length > 0 ? args.names : undefined,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(createLnsBenchmarkSnapshot(result), null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatLnsBenchmarkSuite(result)}\n`);
}

try {
  runLnsBenchmarkCli();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
