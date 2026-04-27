import {
  buildDeterministicAblationGateReport,
  createGreedyBenchmarkSnapshot,
  createGreedyConnectivityShadowOrderingLabelSnapshot,
  createGreedyDeterministicAblationSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  formatDeterministicAblationGateReport,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyConnectivityShadowOrderingLabels,
  formatGreedyBenchmarkSuite,
  formatGreedyDeterministicAblation,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyConnectivityShadowOrderingLabelCaseNames,
  listGreedyBenchmarkCaseNames,
  listGreedyDeterministicAblationCaseNames,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyConnectivityShadowOrderingLabels,
  runGreedyDeterministicAblation,
  runGreedyBenchmarkSuite,
} from "../benchmarks/index.js";
import type {
  GreedyBenchmarkOptions,
  GreedyDeterministicAblationVariantName,
} from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  connectivityShadowAblation: boolean;
  connectivityShadowLabels: boolean;
  deterministicAblation: boolean;
  gateReport: boolean;
  list: boolean;
  names: string[];
  greedy: Partial<GreedyBenchmarkOptions>;
  ablationVariantNames?: GreedyDeterministicAblationVariantName[];
  seeds?: number[];
  maxLabelsPerCase?: number;
}

function parseNameList(value: string, label: string): string[] {
  const names = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (names.length === 0) {
    throw new Error(`Expected at least one ${label}.`);
  }
  return names;
}

function parseNumberList(value: string, label: string): number[] {
  const parts = value
    .split(",")
    .map((entry) => entry.trim());
  const numbers = parts.map((entry) => Number(entry));
  if (parts.length === 0 || parts.some((entry) => entry.length === 0) || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error(`Expected ${label} to contain only finite numbers.`);
  }
  return numbers;
}

function parsePositiveInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return number;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let connectivityShadowAblation = false;
  let connectivityShadowLabels = false;
  let deterministicAblation = false;
  let gateReport = false;
  let list = false;
  const greedy: Partial<GreedyBenchmarkOptions> = {};
  let ablationVariantNames: GreedyDeterministicAblationVariantName[] | undefined;
  let seeds: number[] | undefined;
  let maxLabelsPerCase: number | undefined;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--gate-report" || arg === "--ablation-gate-report") {
      gateReport = true;
      continue;
    }
    if (arg === "--connectivity-shadow-ablation" || arg === "--connectivity-shadow-ablations") {
      connectivityShadowAblation = true;
      continue;
    }
    if (arg === "--connectivity-shadow-labels" || arg === "--connectivity-shadow-label") {
      connectivityShadowLabels = true;
      continue;
    }
    if (
      arg === "--deterministic-ablation"
      || arg === "--deterministic-ablations"
      || arg === "--ordering-ablation"
      || arg === "--ordering-ablations"
    ) {
      deterministicAblation = true;
      continue;
    }
    if (arg.startsWith("--ablation-variants=")) {
      ablationVariantNames = parseNameList(
        arg.slice("--ablation-variants=".length),
        "ablation variant"
      ) as GreedyDeterministicAblationVariantName[];
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "seeds");
      continue;
    }
    if (arg.startsWith("--max-labels=")) {
      maxLabelsPerCase = parsePositiveInteger(arg.slice("--max-labels=".length), "max labels");
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

  return {
    json,
    connectivityShadowAblation,
    connectivityShadowLabels,
    deterministicAblation,
    gateReport,
    list,
    names,
    greedy,
    ablationVariantNames,
    seeds,
    maxLabelsPerCase,
  };
}

export function runGreedyBenchmarkCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const modeCount = [
    args.connectivityShadowAblation,
    args.connectivityShadowLabels,
    args.deterministicAblation,
  ].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error("Choose only one of --connectivity-shadow-ablation, --connectivity-shadow-labels, or --deterministic-ablation.");
  }
  if (args.gateReport && !args.deterministicAblation) {
    throw new Error("--gate-report is only available with --deterministic-ablation.");
  }
  if (args.list) {
    const names = args.connectivityShadowAblation
      ? listGreedyConnectivityShadowScoringAblationCaseNames()
      : args.connectivityShadowLabels
        ? listGreedyConnectivityShadowOrderingLabelCaseNames()
      : args.deterministicAblation
        ? listGreedyDeterministicAblationCaseNames()
      : listGreedyBenchmarkCaseNames();
    process.stdout.write(`${names.join("\n")}\n`);
    return;
  }

  if (args.deterministicAblation) {
    const result = runGreedyDeterministicAblation(undefined, {
      names: args.names.length > 0 ? args.names : undefined,
      greedy: args.greedy,
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ greedy: result });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatDeterministicAblationGateReport(report)}\n`);
      return;
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify(createGreedyDeterministicAblationSnapshot(result), null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatGreedyDeterministicAblation(result)}\n`);
    return;
  }

  if (args.connectivityShadowLabels) {
    const result = runGreedyConnectivityShadowOrderingLabels(undefined, {
      names: args.names.length > 0 ? args.names : undefined,
      greedy: args.greedy,
      seeds: args.seeds,
      maxLabelsPerCase: args.maxLabelsPerCase,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(createGreedyConnectivityShadowOrderingLabelSnapshot(result), null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatGreedyConnectivityShadowOrderingLabels(result)}\n`);
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
