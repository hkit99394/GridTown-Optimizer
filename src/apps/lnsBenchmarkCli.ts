import fs from "node:fs";
import path from "node:path";

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
  outputPath?: string;
  fixedRectangleBaseline?: boolean;
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
  let outputPath: string | undefined;
  let fixedRectangleBaseline = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    output: (value) => {
      outputPath = value;
    },
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
    if (isCliFlag(arg, "--fixed-rectangle-baseline")) {
      fixedRectangleBaseline = true;
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
    outputPath,
    fixedRectangleBaseline,
  };
}

function writeJsonArtifact(outputPath: string, value: unknown): void {
  const normalizedPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${JSON.stringify(value, null, 2)}\n`);
}

function phase4FixedRectangleBaselineVariants(): readonly LnsNeighborhoodAblationVariant[] {
  return [
    {
      name: "baseline",
      description: "Fixed-rectangle sliding LNS windows without semantic operator ranking.",
      lns: { neighborhoodAnchorPolicy: "sliding-only", operatorSelectionPolicy: "legacy" },
    },
    {
      name: "adaptive-operators",
      description: "Adaptive semantic LNS operators with weak-service, headroom, frontier, gate, overlap, and exploration repair.",
      lns: { neighborhoodAnchorPolicy: "ranked", operatorSelectionPolicy: "adaptive" },
    },
  ];
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
    if (args.outputPath) {
      writeJsonArtifact(args.outputPath, createLnsWindowReplaySnapshot(result));
      if (!args.json) writeCliText(`Wrote LNS window replay artifact to ${args.outputPath}.`);
    }

    writeCliJsonOrText(args.json, () => createLnsWindowReplaySnapshot(result), () =>
      formatLnsWindowReplayLabels(result)
    );
    return;
  }

  if (args.neighborhoodAblation) {
    if (args.fixedRectangleBaseline && args.ablationVariantNames?.length) {
      throw new Error("--fixed-rectangle-baseline cannot be combined with --ablation-variants.");
    }
    const result = runLnsNeighborhoodAblation(undefined, {
      names: optionalCliNames(args.names),
      variants: args.fixedRectangleBaseline ? phase4FixedRectangleBaselineVariants() : undefined,
      variantNames: args.ablationVariantNames,
      seeds: args.seeds ?? (args.gateReport ? DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS : undefined),
      rotateVariantRunOrder: args.rotateVariantRunOrder,
    });

    if (args.gateReport) {
      const report = buildDeterministicAblationGateReport({ lns: result });
      if (args.outputPath) {
        writeJsonArtifact(args.outputPath, report);
        if (!args.json) writeCliText(`Wrote LNS neighborhood ablation gate report to ${args.outputPath}.`);
      }
      if (args.json) {
        writeCliJson(report);
        return;
      }
      writeCliText(formatDeterministicAblationGateReport(report));
      return;
    }

    if (args.outputPath) {
      writeJsonArtifact(args.outputPath, createLnsNeighborhoodAblationSnapshot(result));
      if (!args.json) writeCliText(`Wrote LNS neighborhood ablation artifact to ${args.outputPath}.`);
    }
    writeCliJsonOrText(args.json, () => createLnsNeighborhoodAblationSnapshot(result), () =>
      formatLnsNeighborhoodAblation(result)
    );
    return;
  }

  const result = runLnsBenchmarkSuite(undefined, {
    names: optionalCliNames(args.names),
  });
  if (args.outputPath) {
    writeJsonArtifact(args.outputPath, createLnsBenchmarkSnapshot(result));
    if (!args.json) writeCliText(`Wrote LNS benchmark artifact to ${args.outputPath}.`);
  }

  writeCliJsonOrText(args.json, () => createLnsBenchmarkSnapshot(result), () => formatLnsBenchmarkSuite(result));
}

runCliMain(runLnsBenchmarkCli);
