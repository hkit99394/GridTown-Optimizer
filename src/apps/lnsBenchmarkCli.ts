import {
  buildDeterministicAblationGateReport,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  formatDeterministicAblationGateReport,
  formatLnsNeighborhoodAblation,
  formatLnsBenchmarkSuite,
  formatLnsWindowReplayLabels,
  listLnsNeighborhoodAblationCaseNames,
  listLnsBenchmarkCaseNames,
  listLnsWindowReplayCaseNames,
  runLnsNeighborhoodAblation,
  runLnsWindowReplayLabels,
  runLnsBenchmarkSuite,
} from "../benchmarks/index.js";
import {
  parseNameList,
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
  readInlineOptionValue,
} from "./cliParsing.js";
import { optionalCliNames, writeCliJson, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";
import type {
  LnsNeighborhoodAblationVariantName,
} from "../benchmarks/index.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  neighborhoodAblation: boolean;
  windowReplayLabels: boolean;
  gateReport: boolean;
  list: boolean;
  names: string[];
  ablationVariantNames?: LnsNeighborhoodAblationVariantName[];
  seeds?: number[];
  rotateVariantRunOrder?: boolean;
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let neighborhoodAblation = false;
  let windowReplayLabels = false;
  let gateReport = false;
  let list = false;
  let ablationVariantNames: LnsNeighborhoodAblationVariantName[] | undefined;
  let seeds: number[] | undefined;
  let rotateVariantRunOrder: boolean | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let repairTimeLimitSeconds: number | undefined;

  for (const arg of argv) {
    let value: string | undefined;
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
    if (arg === "--window-replay-labels" || arg === "--window-replay-label") {
      windowReplayLabels = true;
      continue;
    }
    if (arg === "--pressure-corpus") {
      windowReplayLabels = true;
      continue;
    }
    if (arg === "--rotate-variant-run-order") {
      rotateVariantRunOrder = true;
      continue;
    }
    if (arg === "--no-rotate-variant-run-order") {
      rotateVariantRunOrder = false;
      continue;
    }
    if (
      arg === "--neighborhood-ablation"
      || arg === "--neighborhood-ablations"
      || arg === "--deterministic-ablation"
      || arg === "--deterministic-ablations"
    ) {
      neighborhoodAblation = true;
      continue;
    }
    value = readInlineOptionValue(arg, "ablation-variants");
    if (value !== undefined) {
      ablationVariantNames = parseNameList(
        value,
        "ablation variant"
      ) as LnsNeighborhoodAblationVariantName[];
      continue;
    }
    value = readInlineOptionValue(arg, "seeds");
    if (value !== undefined) {
      seeds = parseNumberList(value, "seeds");
      continue;
    }
    value = readInlineOptionValue(arg, "max-windows");
    if (value !== undefined) {
      maxWindows = parsePositiveInteger(value, "--max-windows");
      continue;
    }
    value = readInlineOptionValue(arg, "exploration-windows");
    if (value !== undefined) {
      explorationWindowCount = parseNonNegativeInteger(value, "--exploration-windows");
      continue;
    }
    value = readInlineOptionValue(arg, "repair-time");
    if (value !== undefined) {
      repairTimeLimitSeconds = parsePositiveNumber(value, "--repair-time");
      continue;
    }
    names.push(arg);
  }

  return {
    json,
    neighborhoodAblation,
    windowReplayLabels,
    gateReport,
    list,
    names,
    ablationVariantNames,
    seeds,
    rotateVariantRunOrder,
    maxWindows,
    explorationWindowCount,
    repairTimeLimitSeconds,
  };
}

export function runLnsBenchmarkCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.gateReport && !args.neighborhoodAblation) {
    throw new Error("--gate-report is only available with --neighborhood-ablation.");
  }
  if (args.windowReplayLabels && args.neighborhoodAblation) {
    throw new Error("Choose either --window-replay-labels or --neighborhood-ablation, not both.");
  }
  if (args.list) {
    const names = args.neighborhoodAblation
      ? listLnsNeighborhoodAblationCaseNames()
      : args.windowReplayLabels
        ? listLnsWindowReplayCaseNames()
      : listLnsBenchmarkCaseNames();
    writeCliList(names);
    return;
  }

  if (args.windowReplayLabels) {
    const result = runLnsWindowReplayLabels(undefined, {
      names: optionalCliNames(args.names),
      seeds: args.seeds,
      maxWindows: args.maxWindows,
      explorationWindowCount: args.explorationWindowCount,
      repairTimeLimitSeconds: args.repairTimeLimitSeconds,
    });

    writeCliJsonOrText(args.json, () => createLnsWindowReplaySnapshot(result), () =>
      formatLnsWindowReplayLabels(result)
    );
    return;
  }

  if (args.neighborhoodAblation) {
    const result = runLnsNeighborhoodAblation(undefined, {
      names: optionalCliNames(args.names),
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
      rotateVariantRunOrder: args.rotateVariantRunOrder,
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ lns: result });
      if (args.json) {
        writeCliJson(report);
        return;
      }
      writeCliText(formatDeterministicAblationGateReport(report));
      return;
    }

    writeCliJsonOrText(args.json, () => createLnsNeighborhoodAblationSnapshot(result), () =>
      formatLnsNeighborhoodAblation(result)
    );
    return;
  }

  const result = runLnsBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names),
  });

  writeCliJsonOrText(args.json, () => createLnsBenchmarkSnapshot(result), () => formatLnsBenchmarkSuite(result));
}

try {
  runLnsBenchmarkCli();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
