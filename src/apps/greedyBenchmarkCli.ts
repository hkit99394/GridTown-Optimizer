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
import {
  applyInlineOptionHandlers,
  countEnabledCliModes,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveInteger,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { optionalCliNames, writeCliJson, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";
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
  const inlineOptions: Record<string, (value: string) => void> = {
    "ablation-variants": (value) => {
      ablationVariantNames = parseNameList(
        value,
        "ablation variant"
      ) as GreedyDeterministicAblationVariantName[];
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    "max-labels": (value) => {
      maxLabelsPerCase = parsePositiveInteger(value, "max labels");
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
    if (isCliFlag(arg, "--gate-report", "--ablation-gate-report")) {
      gateReport = true;
      continue;
    }
    if (isCliFlag(arg, "--connectivity-shadow-ablation", "--connectivity-shadow-ablations")) {
      connectivityShadowAblation = true;
      continue;
    }
    if (isCliFlag(arg, "--connectivity-shadow-labels", "--connectivity-shadow-label")) {
      connectivityShadowLabels = true;
      continue;
    }
    if (isCliFlag(arg, "--deterministic-ablation", "--deterministic-ablations", "--ordering-ablation", "--ordering-ablations")) {
      deterministicAblation = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    if (isCliFlag(arg, "--connectivity-shadow-scoring")) {
      greedy.connectivityShadowScoring = true;
      continue;
    }
    if (isCliFlag(arg, "--no-connectivity-shadow-scoring")) {
      greedy.connectivityShadowScoring = false;
      continue;
    }
    if (isCliFlag(arg, "--profile")) {
      greedy.profile = true;
      continue;
    }
    if (isCliFlag(arg, "--no-profile")) {
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
  const modeCount = countEnabledCliModes([
    args.connectivityShadowAblation,
    args.connectivityShadowLabels,
    args.deterministicAblation,
  ]);
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
    writeCliList(names);
    return;
  }

  if (args.deterministicAblation) {
    const result = runGreedyDeterministicAblation(undefined, {
      names: optionalCliNames(args.names),
      greedy: args.greedy,
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ greedy: result });
      if (args.json) {
        writeCliJson(report);
        return;
      }
      writeCliText(formatDeterministicAblationGateReport(report));
      return;
    }

    writeCliJsonOrText(args.json, () => createGreedyDeterministicAblationSnapshot(result), () =>
      formatGreedyDeterministicAblation(result)
    );
    return;
  }

  if (args.connectivityShadowLabels) {
    const result = runGreedyConnectivityShadowOrderingLabels(undefined, {
      names: optionalCliNames(args.names),
      greedy: args.greedy,
      seeds: args.seeds,
      maxLabelsPerCase: args.maxLabelsPerCase,
    });

    writeCliJsonOrText(
      args.json,
      () => createGreedyConnectivityShadowOrderingLabelSnapshot(result),
      () => formatGreedyConnectivityShadowOrderingLabels(result)
    );
    return;
  }

  if (args.connectivityShadowAblation) {
    const result = runGreedyConnectivityShadowScoringAblation(undefined, {
      names: optionalCliNames(args.names),
      greedy: args.greedy,
    });

    writeCliJsonOrText(args.json, result, () => formatGreedyConnectivityShadowScoringAblation(result));
    return;
  }

  const result = runGreedyBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names),
    greedy: args.greedy,
  });

  writeCliJsonOrText(args.json, () => createGreedyBenchmarkSnapshot(result), () => formatGreedyBenchmarkSuite(result));
}

runCliMain(runGreedyBenchmarkCli);
