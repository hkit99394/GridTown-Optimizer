import {
  buildDeterministicAblationGateReport,
  createLnsBenchmarkSnapshot,
  createLnsNeighborhoodAblationSnapshot,
  createLnsWindowReplaySnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS,
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
} from "./cliParsing.js";
import type {
  LnsNeighborhoodAblationVariant,
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
    if (arg.startsWith("--ablation-variants=")) {
      ablationVariantNames = parseNameList(
        arg.slice("--ablation-variants=".length),
        "ablation variant"
      ) as LnsNeighborhoodAblationVariantName[];
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = parseNumberList(arg.slice("--seeds=".length), "seeds");
      continue;
    }
    if (arg.startsWith("--max-windows=")) {
      maxWindows = parsePositiveInteger(arg.slice("--max-windows=".length), "--max-windows");
      continue;
    }
    if (arg.startsWith("--exploration-windows=")) {
      explorationWindowCount = parseNonNegativeInteger(
        arg.slice("--exploration-windows=".length),
        "--exploration-windows"
      );
      continue;
    }
    if (arg.startsWith("--repair-time=")) {
      repairTimeLimitSeconds = parsePositiveNumber(arg.slice("--repair-time=".length), "--repair-time");
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

function selectLnsNeighborhoodAblationVariants(
  names: readonly LnsNeighborhoodAblationVariantName[] | undefined
): readonly LnsNeighborhoodAblationVariant[] | undefined {
  if (!names || names.length === 0) return undefined;
  const byName = new Map(DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS.map((variant) => [variant.name, variant]));
  const requested = ["baseline", ...names.filter((name) => name !== "baseline")] as LnsNeighborhoodAblationVariantName[];
  const missing = requested.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown LNS neighborhood ablation variant(s): ${missing.join(", ")}. Available variants: ${DEFAULT_LNS_NEIGHBORHOOD_ABLATION_VARIANTS.map((variant) => variant.name).join(", ")}.`
    );
  }
  return requested.map((name) => byName.get(name) as LnsNeighborhoodAblationVariant);
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
    process.stdout.write(`${names.join("\n")}\n`);
    return;
  }

  if (args.windowReplayLabels) {
    const result = runLnsWindowReplayLabels(undefined, {
      names: args.names.length > 0 ? args.names : undefined,
      seeds: args.seeds,
      maxWindows: args.maxWindows,
      explorationWindowCount: args.explorationWindowCount,
      repairTimeLimitSeconds: args.repairTimeLimitSeconds,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(createLnsWindowReplaySnapshot(result), null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatLnsWindowReplayLabels(result)}\n`);
    return;
  }

  if (args.neighborhoodAblation) {
    const result = runLnsNeighborhoodAblation(undefined, {
      names: args.names.length > 0 ? args.names : undefined,
      variants: selectLnsNeighborhoodAblationVariants(args.ablationVariantNames),
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
      rotateVariantRunOrder: args.rotateVariantRunOrder,
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ lns: result });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatDeterministicAblationGateReport(report)}\n`);
      return;
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify(createLnsNeighborhoodAblationSnapshot(result), null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatLnsNeighborhoodAblation(result)}\n`);
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
