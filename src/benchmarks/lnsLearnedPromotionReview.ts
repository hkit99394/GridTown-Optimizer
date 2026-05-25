import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { validateSolution } from "../core/evaluator.js";
import { solveLns } from "../lns/solver.js";
import {
  applyNormalizedGreedyBenchmarkParams,
  benchmarkGeneratedAt,
  benchmarkRatio,
  cloneBenchmarkGrid,
  cloneBenchmarkSolverParams,
  countBenchmarkMatches,
  formatBenchmarkRate,
  formatBenchmarkSeconds,
  formatBenchmarkSignedNumber,
  inheritGreedyBenchmarkOptions,
  meanBenchmarkValue,
  percentileBenchmarkValue,
  roundBenchmarkMetric,
  selectBenchmarkCasesByName,
  sumBenchmarkBy,
  uniqueBenchmarkValuesBy,
} from "./benchmarkOptions.js";
import { normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import { normalizeCpSatBenchmarkOptions } from "./cpSat.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossMode.js";
import { DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS } from "./deterministicAblationGates.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";
import { normalizeGreedyBenchmarkOptions } from "./greedy.js";
import { normalizeLnsBenchmarkOptions } from "./lns.js";
import {
  PHASE12_LNS_WINDOW_RANKER_FINGERPRINT,
  PHASE12_LNS_WINDOW_RANKER_VERSION,
} from "../lns/learnedWindowRanking.js";
import { DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS } from "./productWorkflow.js";

import type {
  CpSatOptions,
  GreedyOptions,
  Grid,
  LnsOptions,
  Solution,
  SolverParams,
} from "../core/types.js";
import type {
  CrossModeBenchmarkCase,
  CrossModeProblemSizeBand,
} from "./crossMode.js";
import type {
  ProductWorkflowBenchmarkCase,
  ProductWorkflowPressureFamily,
  ProductWorkflowSplit,
} from "./productWorkflow.js";

export type LnsLearnedPromotionReviewVariantName = "baseline" | "learned-guarded";
export type LnsLearnedPromotionReviewSource = "product-workflow" | "cross-mode";
export type LnsLearnedPromotionReviewSplit = ProductWorkflowSplit | "cross-mode";

export interface LnsLearnedPromotionReviewCase {
  name: string;
  description: string;
  source: LnsLearnedPromotionReviewSource;
  family: ProductWorkflowPressureFamily | CrossModeProblemSizeBand;
  split: LnsLearnedPromotionReviewSplit;
  grid: Grid;
  params: SolverParams;
}

export type LnsLearnedPromotionReviewSolve = (
  grid: Grid,
  params: SolverParams,
  context: {
    benchmarkCase: LnsLearnedPromotionReviewCase;
    variantName: LnsLearnedPromotionReviewVariantName;
    seed: number;
  }
) => Solution;

export interface LnsLearnedPromotionReviewRunOptions {
  productNames?: readonly string[];
  crossModeNames?: readonly string[];
  seeds?: readonly number[];
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
  learnedWindowRankingCandidateLimit?: number;
  learnedWindowRankingMinScoreRatio?: number;
  solve?: LnsLearnedPromotionReviewSolve;
}

export interface LnsLearnedPromotionReviewVariantResult {
  variantName: LnsLearnedPromotionReviewVariantName;
  totalPopulation: number;
  populationDeltaVsBaseline: number;
  wallClockSeconds: number;
  wallClockDeltaVsBaselineSeconds: number;
  validationValid: boolean;
  validationErrors: string[];
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  stopReason: string | null;
  improvingIterations: number;
  learnedWindowRankingDisplacedAttempts: number;
  learnedWindowRankingDisplacedImprovements: number;
  learnedWindowRankingDisplacedNeutrals: number;
  learnedWindowRankingDisplacedRecoverableFailures: number;
  learnedWindowRankingDisplacedPopulationImprovement: number;
  learnedWindowRankingEvaluations: number;
  learnedWindowRankingWins: number;
}

export interface LnsLearnedPromotionReviewCaseResult {
  source: LnsLearnedPromotionReviewSource;
  split: LnsLearnedPromotionReviewSplit;
  family: string;
  caseName: string;
  description: string;
  seed: number;
  variants: LnsLearnedPromotionReviewVariantResult[];
}

export interface LnsLearnedPromotionReviewSummary {
  source: LnsLearnedPromotionReviewSource | "all";
  split: LnsLearnedPromotionReviewSplit | "all";
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
  validationFailureCount: number;
  learnedWindowRankingEvaluations: number;
  learnedWindowRankingWins: number;
  learnedWindowRankingDisplacedAttempts: number;
  learnedWindowRankingDisplacedImprovements: number;
  learnedWindowRankingDisplacedNeutrals: number;
  learnedWindowRankingDisplacedRecoverableFailures: number;
  learnedWindowRankingDisplacedPopulationImprovement: number;
}

export interface LnsLearnedPromotionReviewGate {
  passed: boolean;
  failedReasons: string[];
  protectedProductHoldout: boolean;
  requiresQualityLift: true;
  productHoldout: LnsLearnedPromotionReviewSummary;
  all: LnsLearnedPromotionReviewSummary;
}

export interface LnsLearnedPromotionReviewResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  selectedProductCaseNames: string[];
  selectedCrossModeCaseNames: string[];
  variants: LnsLearnedPromotionReviewVariantName[];
  candidateLimit: number;
  guardedMinScoreRatio: number;
  model: {
    version: typeof PHASE12_LNS_WINDOW_RANKER_VERSION;
    fingerprint: typeof PHASE12_LNS_WINDOW_RANKER_FINGERPRINT;
    cpuOnly: true;
    featureFlag: "lns.learnedWindowRanking";
  };
  cases: LnsLearnedPromotionReviewCaseResult[];
  summaries: LnsLearnedPromotionReviewSummary[];
  gate: LnsLearnedPromotionReviewGate;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: "promote-lns-learned-window-ranking-default" | "keep-lns-learned-window-ranking-opt-in";
  summary: string;
}

export interface LnsLearnedPromotionReviewSnapshot
  extends Omit<LnsLearnedPromotionReviewResult, "generatedAt"> {}

const DEFAULT_LNS_PROMOTION_REVIEW_CANDIDATE_LIMIT = 12;

function productReviewCase(benchmarkCase: ProductWorkflowBenchmarkCase): LnsLearnedPromotionReviewCase {
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    source: "product-workflow",
    family: benchmarkCase.family,
    split: benchmarkCase.split,
    grid: benchmarkCase.grid,
    params: benchmarkCase.params,
  };
}

function crossModeReviewCase(benchmarkCase: CrossModeBenchmarkCase): LnsLearnedPromotionReviewCase {
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    source: "cross-mode",
    family: benchmarkCase.problemSizeBand ?? "small",
    split: "cross-mode",
    grid: benchmarkCase.grid,
    params: benchmarkCase.params,
  };
}

function selectProductCases(names: readonly string[] | undefined): LnsLearnedPromotionReviewCase[] {
  return selectBenchmarkCasesByName(DEFAULT_PRODUCT_WORKFLOW_BENCHMARK_CORPUS, names, {
    caseLabel: "LNS learned promotion product workflow",
    corpusLabel: "LNS learned promotion product workflow",
  }).map(productReviewCase);
}

function selectCrossModeCases(names: readonly string[] | undefined): LnsLearnedPromotionReviewCase[] {
  return selectBenchmarkCasesByName(DEFAULT_CROSS_MODE_BENCHMARK_CORPUS, names, {
    caseLabel: "LNS learned promotion cross-mode",
    corpusLabel: "LNS learned promotion cross-mode",
  }).map(crossModeReviewCase);
}

function buildVariantParams(
  benchmarkCase: LnsLearnedPromotionReviewCase,
  seed: number,
  variantName: LnsLearnedPromotionReviewVariantName,
  options: LnsLearnedPromotionReviewRunOptions,
  candidateLimit: number,
  minScoreRatio: number
): SolverParams {
  const params = cloneBenchmarkSolverParams(benchmarkCase.params);
  const greedy = normalizeGreedyBenchmarkOptions(inheritGreedyBenchmarkOptions<GreedyOptions>(params), {
    ...(options.greedy ?? {}),
    randomSeed: seed,
    profile: true,
  });
  const learnedOptions: Partial<LnsOptions> =
    variantName === "baseline"
      ? { learnedWindowRanking: false }
      : {
          learnedWindowRanking: true,
          learnedWindowRankingCandidateLimit: candidateLimit,
          learnedWindowRankingMinScoreRatio: minScoreRatio,
        };
  return {
    ...applyNormalizedGreedyBenchmarkParams(params, greedy, "lns"),
    cpSat: normalizeCpSatBenchmarkOptions(params.cpSat, {
      ...(options.cpSat ?? {}),
      randomSeed: seed,
    }),
    lns: normalizeLnsBenchmarkOptions(params.lns, {
      ...(options.lns ?? {}),
      ...learnedOptions,
    }),
  };
}

function defaultSolve(grid: Grid, params: SolverParams): Solution {
  return solveLns(grid, params);
}

function runVariant(options: {
  benchmarkCase: LnsLearnedPromotionReviewCase;
  seed: number;
  variantName: LnsLearnedPromotionReviewVariantName;
  baseline?: LnsLearnedPromotionReviewVariantResult;
  runOptions: LnsLearnedPromotionReviewRunOptions;
  candidateLimit: number;
  minScoreRatio: number;
}): LnsLearnedPromotionReviewVariantResult {
  const { benchmarkCase, seed, variantName, baseline, runOptions, candidateLimit, minScoreRatio } = options;
  const params = buildVariantParams(benchmarkCase, seed, variantName, runOptions, candidateLimit, minScoreRatio);
  const startedAt = performance.now();
  const solution = (runOptions.solve ?? defaultSolve)(cloneBenchmarkGrid(benchmarkCase.grid), params, {
    benchmarkCase,
    seed,
    variantName,
  });
  const wallClockSeconds = roundBenchmarkMetric((performance.now() - startedAt) / 1000);
  const validation = validateSolution({
    grid: benchmarkCase.grid,
    params,
    solution,
  });
  const outcomes = solution.lnsTelemetry?.outcomes ?? [];
  const displacedOutcomes = outcomes.filter((outcome) => outcome.learnedWindowRankingDisplaced === true);
  return {
    variantName,
    totalPopulation: solution.totalPopulation,
    populationDeltaVsBaseline: baseline === undefined ? 0 : solution.totalPopulation - baseline.totalPopulation,
    wallClockSeconds,
    wallClockDeltaVsBaselineSeconds: baseline === undefined ? 0 : wallClockSeconds - baseline.wallClockSeconds,
    validationValid: validation.valid,
    validationErrors: validation.errors,
    roadCount: solution.roads.size,
    serviceCount: solution.services.length,
    residentialCount: solution.residentials.length,
    stopReason: solution.lnsTelemetry?.stopReason ?? null,
    improvingIterations: solution.lnsTelemetry?.improvingIterations ?? 0,
    learnedWindowRankingDisplacedAttempts: displacedOutcomes.length,
    learnedWindowRankingDisplacedImprovements: countBenchmarkMatches(displacedOutcomes, (outcome) => outcome.status === "improved"),
    learnedWindowRankingDisplacedNeutrals: countBenchmarkMatches(displacedOutcomes, (outcome) => outcome.status === "neutral"),
    learnedWindowRankingDisplacedRecoverableFailures: countBenchmarkMatches(displacedOutcomes, (outcome) => outcome.status === "recoverable-failure"),
    learnedWindowRankingDisplacedPopulationImprovement: sumBenchmarkBy(displacedOutcomes, (outcome) => outcome.improvement),
    learnedWindowRankingEvaluations: solution.lnsTelemetry?.learnedWindowRankingEvaluations ?? 0,
    learnedWindowRankingWins: solution.lnsTelemetry?.learnedWindowRankingWins ?? 0,
  };
}

function summarize(
  cases: readonly LnsLearnedPromotionReviewCaseResult[],
  source: LnsLearnedPromotionReviewSource | "all",
  split: LnsLearnedPromotionReviewSplit | "all"
): LnsLearnedPromotionReviewSummary {
  const selected = cases.filter((entry) =>
    (source === "all" || entry.source === source)
    && (split === "all" || entry.split === split)
  );
  const learnedRuns = selected
    .map((entry) => entry.variants.find((variant) => variant.variantName === "learned-guarded"))
    .filter((variant): variant is LnsLearnedPromotionReviewVariantResult => variant !== undefined);
  const deltas = learnedRuns.map((variant) => variant.populationDeltaVsBaseline);
  const wallDeltas = learnedRuns.map((variant) => variant.wallClockDeltaVsBaselineSeconds);
  const winCount = countBenchmarkMatches(deltas, (delta) => delta > 0);
  const lossCount = countBenchmarkMatches(deltas, (delta) => delta < 0);
  const tieCount = deltas.length - winCount - lossCount;
  return {
    source,
    split,
    comparisonCount: learnedRuns.length,
    winCount,
    tieCount,
    lossCount,
    winRate: benchmarkRatio(winCount, learnedRuns.length),
    lossRate: benchmarkRatio(lossCount, learnedRuns.length),
    meanPopulationDeltaVsBaseline: meanBenchmarkValue(deltas),
    medianPopulationDeltaVsBaseline: percentileBenchmarkValue(deltas, 0.5),
    worstDecilePopulationDeltaVsBaseline: percentileBenchmarkValue(deltas, 0.1),
    bestPopulationDeltaVsBaseline: deltas.length === 0 ? 0 : Math.max(...deltas),
    meanWallClockDeltaVsBaselineSeconds: meanBenchmarkValue(wallDeltas),
    validationFailureCount: sumBenchmarkBy(learnedRuns, (variant) => variant.validationValid ? 0 : 1),
    learnedWindowRankingEvaluations: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingEvaluations),
    learnedWindowRankingWins: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingWins),
    learnedWindowRankingDisplacedAttempts: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingDisplacedAttempts),
    learnedWindowRankingDisplacedImprovements: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingDisplacedImprovements),
    learnedWindowRankingDisplacedNeutrals: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingDisplacedNeutrals),
    learnedWindowRankingDisplacedRecoverableFailures: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingDisplacedRecoverableFailures),
    learnedWindowRankingDisplacedPopulationImprovement: sumBenchmarkBy(learnedRuns, (variant) => variant.learnedWindowRankingDisplacedPopulationImprovement),
  };
}

function buildSummaries(cases: readonly LnsLearnedPromotionReviewCaseResult[]): LnsLearnedPromotionReviewSummary[] {
  return [
    summarize(cases, "product-workflow", "development"),
    summarize(cases, "product-workflow", "holdout"),
    summarize(cases, "product-workflow", "all"),
    summarize(cases, "cross-mode", "cross-mode"),
    summarize(cases, "all", "all"),
  ];
}

function buildGate(summaries: readonly LnsLearnedPromotionReviewSummary[]): LnsLearnedPromotionReviewGate {
  const productHoldout = summaries.find((summary) =>
    summary.source === "product-workflow" && summary.split === "holdout"
  );
  const all = summaries.find((summary) => summary.source === "all" && summary.split === "all");
  if (!productHoldout || !all) throw new Error("LNS learned promotion review is missing required summaries.");
  const failedReasons: string[] = [];
  if (productHoldout.comparisonCount === 0) failedReasons.push("product holdout has no comparisons");
  if (productHoldout.lossCount > 0) failedReasons.push(`product holdout regressions ${productHoldout.lossCount}`);
  if (productHoldout.worstDecilePopulationDeltaVsBaseline < 0) {
    failedReasons.push(`product holdout worst-decile delta ${productHoldout.worstDecilePopulationDeltaVsBaseline}`);
  }
  if (all.lossCount > 0) failedReasons.push(`overall regressions ${all.lossCount}`);
  if (all.validationFailureCount > 0) failedReasons.push(`validation failures ${all.validationFailureCount}`);
  if (productHoldout.medianPopulationDeltaVsBaseline <= 0 && productHoldout.meanPopulationDeltaVsBaseline <= 0) {
    failedReasons.push("no product-holdout quality lift");
  }
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    protectedProductHoldout: productHoldout.comparisonCount > 0,
    requiresQualityLift: true,
    productHoldout,
    all,
  };
}

function summarizeRun(gate: LnsLearnedPromotionReviewGate): string {
  const holdout = gate.productHoldout;
  const all = gate.all;
  return `LNS learned default promotion review ${gate.passed ? "passed" : "did not pass"}: product holdout median delta ${formatBenchmarkSignedNumber(holdout.medianPopulationDeltaVsBaseline)}, mean delta ${formatBenchmarkSignedNumber(holdout.meanPopulationDeltaVsBaseline)}, losses ${holdout.lossCount}; overall losses ${all.lossCount}, validation failures ${all.validationFailureCount}. Defaults stay ${gate.passed ? "eligible for promotion" : "unchanged"}.`;
}

export function runLnsLearnedPromotionReview(
  options: LnsLearnedPromotionReviewRunOptions = {}
): LnsLearnedPromotionReviewResult {
  const productCases = selectProductCases(options.productNames);
  const crossModeCases = selectCrossModeCases(options.crossModeNames);
  const seeds = normalizeBenchmarkSeeds(options.seeds, "LNS learned promotion review seeds")
    ?? [DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS[0] ?? 7];
  const candidateLimit = options.learnedWindowRankingCandidateLimit ?? DEFAULT_LNS_PROMOTION_REVIEW_CANDIDATE_LIMIT;
  if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) {
    throw new Error("Expected LNS learned promotion review candidate limit to be a positive integer.");
  }
  const minScoreRatio = options.learnedWindowRankingMinScoreRatio ?? 1;
  if (!Number.isFinite(minScoreRatio) || minScoreRatio < 0 || minScoreRatio > 1) {
    throw new Error("Expected LNS learned promotion review min-score ratio to be between 0 and 1.");
  }
  const cases: LnsLearnedPromotionReviewCaseResult[] = [];
  const variantNames: LnsLearnedPromotionReviewVariantName[] = ["baseline", "learned-guarded"];
  for (const benchmarkCase of [...productCases, ...crossModeCases]) {
    for (const seed of seeds) {
      const baseline = runVariant({
        benchmarkCase,
        seed,
        variantName: "baseline",
        runOptions: options,
        candidateLimit,
        minScoreRatio,
      });
      const learned = runVariant({
        benchmarkCase,
        seed,
        variantName: "learned-guarded",
        baseline,
        runOptions: options,
        candidateLimit,
        minScoreRatio,
      });
      cases.push({
        source: benchmarkCase.source,
        split: benchmarkCase.split,
        family: benchmarkCase.family,
        caseName: benchmarkCase.name,
        description: benchmarkCase.description,
        seed,
        variants: [baseline, learned],
      });
    }
  }
  const summaries = buildSummaries(cases);
  const gate = buildGate(summaries);
  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...seeds],
    selectedProductCaseNames: uniqueBenchmarkValuesBy(productCases, (benchmarkCase) => benchmarkCase.name),
    selectedCrossModeCaseNames: uniqueBenchmarkValuesBy(crossModeCases, (benchmarkCase) => benchmarkCase.name),
    variants: variantNames,
    candidateLimit,
    guardedMinScoreRatio: minScoreRatio,
    model: {
      version: PHASE12_LNS_WINDOW_RANKER_VERSION,
      fingerprint: PHASE12_LNS_WINDOW_RANKER_FINGERPRINT,
      cpuOnly: true,
      featureFlag: "lns.learnedWindowRanking",
    },
    cases,
    summaries,
    gate,
    hardware: captureExperimentRegistryHardwareMetadata({ gpuUsed: false }),
    decision: gate.passed
      ? "promote-lns-learned-window-ranking-default"
      : "keep-lns-learned-window-ranking-opt-in",
    summary: summarizeRun(gate),
  };
}

export function createLnsLearnedPromotionReviewSnapshot(
  result: LnsLearnedPromotionReviewResult
): LnsLearnedPromotionReviewSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function writeLnsLearnedPromotionReviewArtifact(
  result: LnsLearnedPromotionReviewResult,
  outputPath: string
): LnsLearnedPromotionReviewResult {
  const normalizedOutputPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function formatLnsLearnedPromotionReview(result: LnsLearnedPromotionReviewResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Learned Default Promotion Review ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Model: ${result.model.version} ${result.model.fingerprint}`);
  lines.push(`Product cases: ${result.selectedProductCaseNames.join(", ")}`);
  lines.push(`Cross-mode cases: ${result.selectedCrossModeCaseNames.join(", ")}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Variants: ${result.variants.join(", ")}`);
  lines.push(`Guarded candidate limit=${result.candidateLimit} min-score-ratio=${result.guardedMinScoreRatio}`);
  lines.push(`Gate: passed=${result.gate.passed} failures=${result.gate.failedReasons.length ? result.gate.failedReasons.join("; ") : "none"}`);
  for (const summary of result.summaries) {
    lines.push(
      `- ${summary.source}/${summary.split}: n=${summary.comparisonCount} wins=${summary.winCount} ties=${summary.tieCount} losses=${summary.lossCount} win-rate=${formatBenchmarkRate(summary.winRate)} mean-delta=${formatBenchmarkSignedNumber(summary.meanPopulationDeltaVsBaseline)} median-delta=${formatBenchmarkSignedNumber(summary.medianPopulationDeltaVsBaseline)} worst-decile=${formatBenchmarkSignedNumber(summary.worstDecilePopulationDeltaVsBaseline)} wall-delta=${formatBenchmarkSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} validation-failures=${summary.validationFailureCount} learned-evals=${summary.learnedWindowRankingEvaluations} learned-wins=${summary.learnedWindowRankingWins}`
      + ` displaced-attempts=${summary.learnedWindowRankingDisplacedAttempts} displaced-improvements=${summary.learnedWindowRankingDisplacedImprovements} displaced-neutral=${summary.learnedWindowRankingDisplacedNeutrals}`
    );
  }
  lines.push(`Decision: ${result.decision}`);
  lines.push(result.summary);
  return lines.join("\n");
}
