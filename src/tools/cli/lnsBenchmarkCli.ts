import fs from "node:fs";
import path from "node:path";

import {
  buildDeterministicAblationGateReport,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowRankerOnlineAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  formatDeterministicAblationGateReport,
  formatLnsNeighborhoodAblation,
  formatLnsBenchmarkSuite,
  formatLnsWindowRankerOnlineAblation,
  formatLnsWindowReplayLabels,
  listLnsWindowRankerOnlineAblationCaseNames,
  listLnsNeighborhoodAblationCaseNames,
  listLnsBenchmarkCaseNames,
  listLnsWindowReplayCaseNames,
  runLnsNeighborhoodAblation,
  runLnsWindowRankerOnlineAblation,
  runLnsWindowReplayLabels,
  runLnsBenchmarkSuite
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  countEnabledCliModes,
  isCliFlag,
  parseNameList,
  parseNonNegativeNumber,
  parseNonNegativeInteger,
  parseNumberList,
  parsePositiveInteger,
  parsePositiveNumber
} from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliText
} from "../../apps/cliOutput.js";
import { normalizeRepoRelativePath } from "./artifactBundleHelpers.js";
import type { LnsNeighborhoodAblationVariantName, LnsWindowReplayStatePolicy } from "../../benchmarkApi.js";

type LnsWindowRankerRuntimeModel = Parameters<typeof runLnsWindowRankerOnlineAblation>[1]["model"];

interface ParsedBenchmarkArgs {
  json: boolean;
  neighborhoodAblation: boolean;
  windowReplayLabels: boolean;
  windowRankerOnlineAblation: boolean;
  gateReport: boolean;
  list: boolean;
  names: string[];
  ablationVariantNames?: LnsNeighborhoodAblationVariantName[];
  seeds?: number[];
  rotateVariantRunOrder?: boolean;
  maxWindows?: number;
  explorationWindowCount?: number;
  repairTimeLimitSeconds?: number;
  statePolicies?: LnsWindowReplayStatePolicy[];
  stateCollectionIterations?: number;
  stateCollectionRepairTimeLimitSeconds?: number;
  windowRankerModelPath?: string;
  windowRankerMinScoreDelta?: number;
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let neighborhoodAblation = false;
  let windowReplayLabels = false;
  let windowRankerOnlineAblation = false;
  let gateReport = false;
  let list = false;
  let ablationVariantNames: LnsNeighborhoodAblationVariantName[] | undefined;
  let seeds: number[] | undefined;
  let rotateVariantRunOrder: boolean | undefined;
  let maxWindows: number | undefined;
  let explorationWindowCount: number | undefined;
  let repairTimeLimitSeconds: number | undefined;
  let statePolicies: LnsWindowReplayStatePolicy[] | undefined;
  let stateCollectionIterations: number | undefined;
  let stateCollectionRepairTimeLimitSeconds: number | undefined;
  let windowRankerModelPath: string | undefined;
  let windowRankerMinScoreDelta: number | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    "ablation-variants": (value) => {
      ablationVariantNames = parseNameList(value, "ablation variant") as LnsNeighborhoodAblationVariantName[];
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
    "state-policies": (value) => {
      statePolicies = parseNameList(value, "state policy") as LnsWindowReplayStatePolicy[];
    },
    "state-collection-iterations": (value) => {
      stateCollectionIterations = parsePositiveInteger(value, "--state-collection-iterations");
    },
    "state-collection-repair-time": (value) => {
      stateCollectionRepairTimeLimitSeconds = parsePositiveNumber(value, "--state-collection-repair-time");
    },
    "window-ranker-model": (value) => {
      windowRankerModelPath = value;
    },
    "window-ranker-min-score-delta": (value) => {
      windowRankerMinScoreDelta = parseNonNegativeNumber(value, "--window-ranker-min-score-delta");
    }
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
    if (
      isCliFlag(arg, "--window-ranker-online-ablation", "--window-ranker-ablation", "--online-window-ranker-ablation")
    ) {
      windowRankerOnlineAblation = true;
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
    if (
      isCliFlag(
        arg,
        "--neighborhood-ablation",
        "--neighborhood-ablations",
        "--deterministic-ablation",
        "--deterministic-ablations"
      )
    ) {
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
    windowRankerOnlineAblation,
    gateReport,
    list,
    names,
    ablationVariantNames,
    seeds,
    rotateVariantRunOrder,
    maxWindows,
    explorationWindowCount,
    repairTimeLimitSeconds,
    statePolicies,
    stateCollectionIterations,
    stateCollectionRepairTimeLimitSeconds,
    windowRankerModelPath,
    windowRankerMinScoreDelta
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readWindowRankerModel(modelPath: string): LnsWindowRankerRuntimeModel {
  const repoRelativePath = normalizeRepoRelativePath(modelPath, "--window-ranker-model");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), repoRelativePath), "utf8"));
  const candidate =
    isRecord(parsed) && isRecord(parsed.model) && isRecord(parsed.model.weights) ? parsed.model : parsed;
  if (!isRecord(candidate) || !isRecord(candidate.weights)) {
    throw new Error("--window-ranker-model must point to a model JSON object with a weights object.");
  }
  return candidate as unknown as LnsWindowRankerRuntimeModel;
}

export function runLnsBenchmarkCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.gateReport && !args.neighborhoodAblation) {
    throw new Error("--gate-report is only available with --neighborhood-ablation.");
  }
  if (countEnabledCliModes([args.windowReplayLabels, args.neighborhoodAblation, args.windowRankerOnlineAblation]) > 1) {
    throw new Error(
      "Choose only one LNS benchmark mode: --window-replay-labels, --neighborhood-ablation, or --window-ranker-online-ablation."
    );
  }
  if (args.list) {
    const names = args.neighborhoodAblation
      ? listLnsNeighborhoodAblationCaseNames()
      : args.windowReplayLabels
        ? listLnsWindowReplayCaseNames()
        : args.windowRankerOnlineAblation
          ? listLnsWindowRankerOnlineAblationCaseNames()
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
      statePolicies: args.statePolicies,
      stateCollectionIterations: args.stateCollectionIterations,
      stateCollectionRepairTimeLimitSeconds: args.stateCollectionRepairTimeLimitSeconds
    });

    writeCliJsonOrText(
      args.json,
      () => createLnsWindowReplaySnapshot(result),
      () => formatLnsWindowReplayLabels(result)
    );
    return;
  }

  if (args.windowRankerOnlineAblation) {
    if (!args.windowRankerModelPath) {
      throw new Error("--window-ranker-online-ablation requires --window-ranker-model=<path>.");
    }
    const result = runLnsWindowRankerOnlineAblation(undefined, {
      names: optionalCliNames(args.names),
      seeds: args.seeds,
      model: readWindowRankerModel(args.windowRankerModelPath),
      minScoreDelta: args.windowRankerMinScoreDelta,
      lns:
        args.repairTimeLimitSeconds === undefined
          ? undefined
          : {
              repairTimeLimitSeconds: args.repairTimeLimitSeconds
            }
    });

    writeCliJsonOrText(
      args.json,
      () => createLnsWindowRankerOnlineAblationSnapshot(result),
      () => formatLnsWindowRankerOnlineAblation(result)
    );
    return;
  }

  if (args.neighborhoodAblation) {
    const result = runLnsNeighborhoodAblation(undefined, {
      names: optionalCliNames(args.names),
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
      rotateVariantRunOrder: args.rotateVariantRunOrder
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

    writeCliJsonOrText(
      args.json,
      () => createLnsNeighborhoodAblationSnapshot(result),
      () => formatLnsNeighborhoodAblation(result)
    );
    return;
  }

  const result = runLnsBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names)
  });

  writeCliJsonOrText(
    args.json,
    () => createLnsBenchmarkSnapshot(result),
    () => formatLnsBenchmarkSuite(result)
  );
}

runCliMain(runLnsBenchmarkCli);
