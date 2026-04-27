import {
  createGreedyBenchmarkSnapshot,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyBenchmarkSuite,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyBenchmarkCaseNames,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyBenchmarkSuite,
} from "../benchmarks/index.js";
import type { GreedyBenchmarkOptions } from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  connectivityShadowAblation: boolean;
  list: boolean;
  names: string[];
  greedy: Partial<GreedyBenchmarkOptions>;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let connectivityShadowAblation = false;
  let list = false;
  const greedy: Partial<GreedyBenchmarkOptions> = {};

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--connectivity-shadow-ablation" || arg === "--connectivity-shadow-ablations") {
      connectivityShadowAblation = true;
      continue;
    }
    if (arg === "--connectivity-shadow-scoring") {
      greedy.connectivityShadowScoring = true;
      continue;
    }
    if (arg === "--no-connectivity-shadow-scoring") {
      greedy.connectivityShadowScoring = false;
      continue;
    }
    if (arg === "--profile") {
      greedy.profile = true;
      continue;
    }
    if (arg === "--no-profile") {
      greedy.profile = false;
      continue;
    }
    names.push(arg);
  }

  return { json, connectivityShadowAblation, list, names, greedy };
}

export function runGreedyBenchmarkCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const names = args.connectivityShadowAblation
      ? listGreedyConnectivityShadowScoringAblationCaseNames()
      : listGreedyBenchmarkCaseNames();
    process.stdout.write(`${names.join("\n")}\n`);
    return;
  }

  if (args.connectivityShadowAblation) {
    const result = runGreedyConnectivityShadowScoringAblation(undefined, {
      names: args.names.length > 0 ? args.names : undefined,
      greedy: args.greedy,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatGreedyConnectivityShadowScoringAblation(result)}\n`);
    return;
  }

  const result = runGreedyBenchmarkSuite(undefined, {
    names: args.names.length > 0 ? args.names : undefined,
    greedy: args.greedy,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(createGreedyBenchmarkSnapshot(result), null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatGreedyBenchmarkSuite(result)}\n`);
}

try {
  runGreedyBenchmarkCli();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
