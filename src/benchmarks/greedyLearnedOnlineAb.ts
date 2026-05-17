import {
  benchmarkGeneratedAt,
  benchmarkRatio,
  formatBenchmarkRate,
  formatBenchmarkSignedNumber,
  meanBenchmarkValue,
  percentileBenchmarkValue,
  selectBenchmarkCasesByName,
  sumBenchmarkBy,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import { DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS } from "./greedyDeterministicAblations.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";
import { DEFAULT_LEARNED_RANKING_LABEL_SPLITS } from "./learnedRankingLabels.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";

import type { GreedyBenchmarkCase, GreedyBenchmarkOptions } from "./greedy.js";
import type { LearnedRankingLabelSplit } from "./learnedRankingLabels.js";

export type GreedyLearnedOnlineVariantName =
  | "baseline"
  | "learned-guarded"
  | "learned-exploratory";

export interface GreedyLearnedOnlineAbRunOptions {
  names?: readonly string[];
  seeds?: readonly number[];
  corpus?: readonly GreedyBenchmarkCase[];
  greedy?: Partial<GreedyBenchmarkOptions>;
  learnedServiceRankingCandidateLimit?: number;
  exploratoryMinScoreRatio?: number;
}

export interface GreedyLearnedOnlineAbVariantResult {
  variantName: GreedyLearnedOnlineVariantName;
  totalPopulation: number;
  wallClockSeconds: number;
  serviceCount: number;
  residentialCount: number;
  learnedRankingEvaluations: number;
  learnedRankingWins: number;
}

export interface GreedyLearnedOnlineAbCaseResult {
  split: LearnedRankingLabelSplit;
  caseName: string;
  seed: number;
  variants: GreedyLearnedOnlineAbVariantResult[];
  comparisons: GreedyLearnedOnlineAbComparison[];
}

export interface GreedyLearnedOnlineAbComparison {
  variantName: Exclude<GreedyLearnedOnlineVariantName, "baseline">;
  populationDeltaVsBaseline: number;
  wallClockDeltaVsBaselineSeconds: number;
}

export interface GreedyLearnedOnlineAbSummary {
  variantName: Exclude<GreedyLearnedOnlineVariantName, "baseline">;
  split: LearnedRankingLabelSplit | "all";
  comparisonCount: number;
  winCount: number;
  tieCount: number;
  lossCount: number;
  winRate: number;
  lossRate: number;
  meanPopulationDeltaVsBaseline: number;
  medianPopulationDeltaVsBaseline: number;
  worstDecilePopulationDeltaVsBaseline: number;
  bestPopulationDeltaVsBaseline: number;
  meanWallClockDeltaVsBaselineSeconds: number;
  learnedRankingEvaluations: number;
  learnedRankingWins: number;
}

export interface GreedyLearnedOnlineAbGate {
  passed: boolean;
  failedReasons: string[];
  protectedHoldout: boolean;
  promotedVariant: "learned-guarded";
  holdout: GreedyLearnedOnlineAbSummary;
}

export interface GreedyLearnedOnlineAbResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  selectedCaseNames: string[];
  variants: GreedyLearnedOnlineVariantName[];
  splitCases: Record<LearnedRankingLabelSplit, string[]>;
  candidateLimit: number;
  guardedMinScoreRatio: 1;
  exploratoryMinScoreRatio: number;
  cases: GreedyLearnedOnlineAbCaseResult[];
  summaries: GreedyLearnedOnlineAbSummary[];
  gate: GreedyLearnedOnlineAbGate;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: "keep-learned-service-ranking-feature-flagged";
  summary: string;
}

export interface GreedyLearnedOnlineAbSnapshot
  extends Omit<GreedyLearnedOnlineAbResult, "generatedAt"> {}

const DEFAULT_GREEDY_ONLINE_AB_CANDIDATE_LIMIT = 12;
const DEFAULT_GREEDY_ONLINE_AB_EXPLORATORY_MIN_SCORE_RATIO = 0;

function assertOnlineAbOptions(options: {
  candidateLimit: number;
  exploratoryMinScoreRatio: number;
}): void {
  if (!Number.isInteger(options.candidateLimit) || options.candidateLimit <= 0) {
    throw new Error("Expected Greedy learned online A/B candidate limit to be a positive integer.");
  }
  if (
    !Number.isFinite(options.exploratoryMinScoreRatio)
    || options.exploratoryMinScoreRatio < 0
    || options.exploratoryMinScoreRatio > 1
  ) {
    throw new Error("Expected Greedy learned online A/B exploratory min-score ratio to be between 0 and 1.");
  }
}

function defaultOnlineAbCaseNames(): string[] {
  return DEFAULT_LEARNED_RANKING_LABEL_SPLITS.flatMap((split) => split.greedyCaseNames);
}

function splitCases(): Record<LearnedRankingLabelSplit, string[]> {
  const development = DEFAULT_LEARNED_RANKING_LABEL_SPLITS.find((split) => split.split === "development")!;
  const holdout = DEFAULT_LEARNED_RANKING_LABEL_SPLITS.find((split) => split.split === "holdout")!;
  return {
    development: [...development.greedyCaseNames],
    holdout: [...holdout.greedyCaseNames],
  };
}

function splitForCase(caseName: string): LearnedRankingLabelSplit {
  const splits = splitCases();
  return splits.holdout.includes(caseName) ? "holdout" : "development";
}

function selectedCases(
  corpus: readonly GreedyBenchmarkCase[],
  names: readonly string[] | undefined
): GreedyBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "Greedy learned online A/B",
    corpusLabel: "Greedy learned online A/B",
  });
}

function runVariant(options: {
  benchmarkCase: GreedyBenchmarkCase;
  seed: number;
  variantName: GreedyLearnedOnlineVariantName;
  greedy: Partial<GreedyBenchmarkOptions>;
  candidateLimit: number;
  exploratoryMinScoreRatio: number;
}): GreedyLearnedOnlineAbVariantResult {
  const { benchmarkCase, seed, variantName, greedy, candidateLimit, exploratoryMinScoreRatio } = options;
  const learnedOptions: Partial<GreedyBenchmarkOptions> =
    variantName === "baseline"
      ? { learnedServiceRanking: false }
      : {
          learnedServiceRanking: true,
          learnedServiceRankingCandidateLimit: candidateLimit,
          learnedServiceRankingMinScoreRatio:
            variantName === "learned-guarded" ? 1 : exploratoryMinScoreRatio,
        };
  const result = runGreedyBenchmarkSuite([benchmarkCase], {
    names: [benchmarkCase.name],
    greedy: {
      ...greedy,
      randomSeed: seed,
      profile: true,
      ...learnedOptions,
    },
  }).results[0]!;
  return {
    variantName,
    totalPopulation: result.totalPopulation,
    wallClockSeconds: result.wallClockSeconds,
    serviceCount: result.serviceCount,
    residentialCount: result.residentialCount,
    learnedRankingEvaluations: result.greedyProfile?.counters.servicePhase.learnedRankingEvaluations ?? 0,
    learnedRankingWins: result.greedyProfile?.counters.servicePhase.learnedRankingWins ?? 0,
  };
}

function buildComparisons(
  variants: readonly GreedyLearnedOnlineAbVariantResult[]
): GreedyLearnedOnlineAbComparison[] {
  const baseline = variants.find((variant) => variant.variantName === "baseline");
  if (!baseline) throw new Error("Greedy learned online A/B result is missing baseline variant.");
  return variants
    .filter((variant): variant is GreedyLearnedOnlineAbVariantResult & {
      variantName: Exclude<GreedyLearnedOnlineVariantName, "baseline">;
    } => variant.variantName !== "baseline")
    .map((variant) => ({
      variantName: variant.variantName,
      populationDeltaVsBaseline: variant.totalPopulation - baseline.totalPopulation,
      wallClockDeltaVsBaselineSeconds: variant.wallClockSeconds - baseline.wallClockSeconds,
    }));
}

function summarizeVariant(
  cases: readonly GreedyLearnedOnlineAbCaseResult[],
  variantName: Exclude<GreedyLearnedOnlineVariantName, "baseline">,
  split: LearnedRankingLabelSplit | "all"
): GreedyLearnedOnlineAbSummary {
  const selected = split === "all" ? cases : cases.filter((entry) => entry.split === split);
  const comparisons = selected.flatMap((entry) =>
    entry.comparisons.filter((comparison) => comparison.variantName === variantName)
  );
  const deltas = comparisons.map((comparison) => comparison.populationDeltaVsBaseline);
  const wallDeltas = comparisons.map((comparison) => comparison.wallClockDeltaVsBaselineSeconds);
  const variantRuns = selected
    .flatMap((entry) => entry.variants)
    .filter((variant) => variant.variantName === variantName);
  const winCount = deltas.filter((delta) => delta > 0).length;
  const lossCount = deltas.filter((delta) => delta < 0).length;
  const tieCount = deltas.length - winCount - lossCount;
  return {
    variantName,
    split,
    comparisonCount: comparisons.length,
    winCount,
    tieCount,
    lossCount,
    winRate: benchmarkRatio(winCount, comparisons.length),
    lossRate: benchmarkRatio(lossCount, comparisons.length),
    meanPopulationDeltaVsBaseline: meanBenchmarkValue(deltas),
    medianPopulationDeltaVsBaseline: percentileBenchmarkValue(deltas, 0.5),
    worstDecilePopulationDeltaVsBaseline: percentileBenchmarkValue(deltas, 0.1),
    bestPopulationDeltaVsBaseline: deltas.length === 0 ? 0 : Math.max(...deltas),
    meanWallClockDeltaVsBaselineSeconds: meanBenchmarkValue(wallDeltas),
    learnedRankingEvaluations: sumBenchmarkBy(variantRuns, (variant) => variant.learnedRankingEvaluations),
    learnedRankingWins: sumBenchmarkBy(variantRuns, (variant) => variant.learnedRankingWins),
  };
}

function buildSummaries(cases: readonly GreedyLearnedOnlineAbCaseResult[]): GreedyLearnedOnlineAbSummary[] {
  const summaries: GreedyLearnedOnlineAbSummary[] = [];
  for (const variantName of ["learned-guarded", "learned-exploratory"] as const) {
    for (const split of ["development", "holdout", "all"] as const) {
      summaries.push(summarizeVariant(cases, variantName, split));
    }
  }
  return summaries;
}

function buildGate(
  splitCasesByName: Record<LearnedRankingLabelSplit, string[]>,
  summaries: readonly GreedyLearnedOnlineAbSummary[]
): GreedyLearnedOnlineAbGate {
  const holdout = summaries.find((summary) =>
    summary.variantName === "learned-guarded" && summary.split === "holdout"
  );
  if (!holdout) throw new Error("Greedy learned online A/B result is missing guarded holdout summary.");
  const overlap = splitCasesByName.development.filter((caseName) => splitCasesByName.holdout.includes(caseName));
  const failedReasons: string[] = [];
  if (overlap.length > 0) failedReasons.push(`development/holdout overlap: ${overlap.join(", ")}`);
  if (holdout.comparisonCount === 0) failedReasons.push("holdout has no paired comparisons");
  if (holdout.lossCount > 0) failedReasons.push(`holdout regressions ${holdout.lossCount}`);
  if (holdout.worstDecilePopulationDeltaVsBaseline < 0) {
    failedReasons.push(`worst-decile delta ${holdout.worstDecilePopulationDeltaVsBaseline}`);
  }
  if (holdout.medianPopulationDeltaVsBaseline <= 0 && holdout.meanWallClockDeltaVsBaselineSeconds >= 0) {
    failedReasons.push("no holdout median population or mean wall-clock win");
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    protectedHoldout: overlap.length === 0,
    promotedVariant: "learned-guarded",
    holdout,
  };
}

function summarizeRun(gate: GreedyLearnedOnlineAbGate, summaries: readonly GreedyLearnedOnlineAbSummary[]): string {
  const guarded = gate.holdout;
  const exploratory = summaries.find((summary) =>
    summary.variantName === "learned-exploratory" && summary.split === "holdout"
  );
  const exploratorySummary = exploratory
    ? ` Exploratory holdout mean delta ${formatBenchmarkSignedNumber(exploratory.meanPopulationDeltaVsBaseline)}, losses ${exploratory.lossCount}.`
    : "";
  return `Feature-flagged Greedy learned service ranking ${gate.passed ? "passed" : "did not pass"} online A/B: guarded holdout median delta ${formatBenchmarkSignedNumber(guarded.medianPopulationDeltaVsBaseline)}, worst-decile ${formatBenchmarkSignedNumber(guarded.worstDecilePopulationDeltaVsBaseline)}, losses ${guarded.lossCount}, mean wall delta ${guarded.meanWallClockDeltaVsBaselineSeconds.toFixed(4)}s.${exploratorySummary} No default changed.`;
}

export function runGreedyLearnedOnlineAb(
  options: GreedyLearnedOnlineAbRunOptions = {}
): GreedyLearnedOnlineAbResult {
  const corpus = options.corpus ?? DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CORPUS;
  const names = options.names ?? defaultOnlineAbCaseNames();
  const cases = selectedCases(corpus, names);
  const selectedCaseNames = cases.map((benchmarkCase) => benchmarkCase.name);
  const seeds = normalizeBenchmarkSeeds(options.seeds, "Greedy learned online A/B seeds")
    ?? [...DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS];
  const candidateLimit =
    options.learnedServiceRankingCandidateLimit ?? DEFAULT_GREEDY_ONLINE_AB_CANDIDATE_LIMIT;
  const exploratoryMinScoreRatio =
    options.exploratoryMinScoreRatio ?? DEFAULT_GREEDY_ONLINE_AB_EXPLORATORY_MIN_SCORE_RATIO;
  assertOnlineAbOptions({ candidateLimit, exploratoryMinScoreRatio });
  const variantNames: GreedyLearnedOnlineVariantName[] = [
    "baseline",
    "learned-guarded",
    "learned-exploratory",
  ];
  const results: GreedyLearnedOnlineAbCaseResult[] = [];

  for (const benchmarkCase of cases) {
    for (const seed of seeds) {
      const variants = variantNames.map((variantName) => runVariant({
        benchmarkCase,
        seed,
        variantName,
        greedy: options.greedy ?? {},
        candidateLimit,
        exploratoryMinScoreRatio,
      }));
      results.push({
        split: splitForCase(benchmarkCase.name),
        caseName: benchmarkCase.name,
        seed,
        variants,
        comparisons: buildComparisons(variants),
      });
    }
  }

  const summaries = buildSummaries(results);
  const splitCaseMap = splitCases();
  const gate = buildGate(splitCaseMap, summaries);

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...seeds],
    selectedCaseNames,
    variants: variantNames,
    splitCases: splitCaseMap,
    candidateLimit,
    guardedMinScoreRatio: 1,
    exploratoryMinScoreRatio,
    cases: results,
    summaries,
    gate,
    hardware: captureExperimentRegistryHardwareMetadata({ gpuUsed: false }),
    decision: "keep-learned-service-ranking-feature-flagged",
    summary: summarizeRun(gate, summaries),
  };
}

export function createGreedyLearnedOnlineAbSnapshot(
  result: GreedyLearnedOnlineAbResult
): GreedyLearnedOnlineAbSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function formatGreedyLearnedOnlineAb(result: GreedyLearnedOnlineAbResult): string {
  const lines: string[] = [];
  lines.push("=== Greedy Learned Service Ranking Online A/B ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Cases: ${result.selectedCaseNames.join(", ")}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  lines.push(`Guarded candidate limit=${result.candidateLimit} min-score-ratio=${result.guardedMinScoreRatio}`);
  lines.push(`Gate: passed=${result.gate.passed} failures=${result.gate.failedReasons.length ? result.gate.failedReasons.join("; ") : "none"}`);
  for (const summary of result.summaries) {
    lines.push(
      `- ${summary.variantName}/${summary.split}: n=${summary.comparisonCount} wins=${summary.winCount} ties=${summary.tieCount} losses=${summary.lossCount} win-rate=${formatBenchmarkRate(summary.winRate)} mean-delta=${formatBenchmarkSignedNumber(summary.meanPopulationDeltaVsBaseline)} median-delta=${formatBenchmarkSignedNumber(summary.medianPopulationDeltaVsBaseline)} worst-decile=${formatBenchmarkSignedNumber(summary.worstDecilePopulationDeltaVsBaseline)} wall-delta=${summary.meanWallClockDeltaVsBaselineSeconds.toFixed(4)}s learned-evals=${summary.learnedRankingEvaluations} learned-wins=${summary.learnedRankingWins}`
    );
  }
  lines.push(`Decision: ${result.decision}`);
  lines.push(result.summary);
  return lines.join("\n");
}
