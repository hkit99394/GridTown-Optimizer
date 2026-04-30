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
} from "../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import { optionalCliNames, writeCliJson, writeCliJsonOrText, writeCliList, writeCliText } from "./cliOutput.js";
import type {
  LnsNeighborhoodAblationVariantName,
} from "../benchmarkApi.js";

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
  const inlineOptions: Record<string, (value: string) => void> = {
    "ablation-variants": (value) => {
      ablationVariantNames = parseNameList(
        value,
        "ablation variant"
      ) as LnsNeighborhoodAblationVariantName[];
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "seeds");
    },
    "max-windows": (value) => {
      maxWindows = parsePositiveInteger(value, "--max-windows");
    },
    "exploration-windows": (value) => {
      explorationWindowCount = parseNonNegativeInteger(value, "--exploration-windows");
    },
    "repair-time": (value) => {
      repairTimeLimitSeconds = parsePositiveNumber(value, "--repair-time");
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
    if (isCliFlag(arg, "--window-replay-labels", "--window-replay-label")) {
      windowReplayLabels = true;
      continue;
    }
    if (isCliFlag(arg, "--pressure-corpus")) {
      windowReplayLabels = true;
      continue;
    }
    if (isCliFlag(arg, "--rotate-variant-run-order")) {
      rotateVariantRunOrder = true;
      continue;
    }
    if (isCliFlag(arg, "--no-rotate-variant-run-order")) {
      rotateVariantRunOrder = false;
      continue;
    }
    if (isCliFlag(arg, "--neighborhood-ablation", "--neighborhood-ablations", "--deterministic-ablation", "--deterministic-ablations")) {
      neighborhoodAblation = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
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

runCliMain(runLnsBenchmarkCli);
