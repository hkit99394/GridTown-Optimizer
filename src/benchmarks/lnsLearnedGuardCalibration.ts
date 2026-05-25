import fs from "node:fs";
import path from "node:path";

import {
  benchmarkGeneratedAt,
  formatBenchmarkSeconds,
  formatBenchmarkSignedNumber,
  roundBenchmarkMetric,
} from "./benchmarkOptions.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";
import {
  runLnsLearnedPromotionReview,
} from "./lnsLearnedPromotionReview.js";

import type { CpSatOptions, GreedyOptions, LnsOptions } from "../core/types.js";
import type {
  LnsLearnedPromotionReviewResult,
  LnsLearnedPromotionReviewSolve,
  LnsLearnedPromotionReviewSummary,
} from "./lnsLearnedPromotionReview.js";

export type LnsLearnedGuardCalibrationDecision =
  | "retry-lns-learned-default-promotion-review"
  | "keep-phase14-guard-and-opt-in";

export interface LnsLearnedGuardCalibrationRunOptions {
  productNames?: readonly string[];
  crossModeNames?: readonly string[];
  seeds?: readonly number[];
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
  learnedWindowRankingCandidateLimit?: number;
  minScoreRatios?: readonly number[];
  solve?: LnsLearnedPromotionReviewSolve;
}

export interface LnsLearnedGuardCalibrationRatioGate {
  safeNoRegression: boolean;
  qualityLift: boolean;
  eligibleForPromotionReview: boolean;
  failedReasons: string[];
}

export interface LnsLearnedGuardCalibrationRatioResult {
  minScoreRatio: number;
  review: LnsLearnedPromotionReviewResult;
  gate: LnsLearnedGuardCalibrationRatioGate;
}

export interface LnsLearnedGuardCalibrationGate {
  passed: boolean;
  failedReasons: string[];
  safeRatioCount: number;
  qualityLiftRatioCount: number;
  eligibleRatioCount: number;
  recommendedMinScoreRatio: number | null;
}

export interface LnsLearnedGuardCalibrationResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  selectedProductCaseNames: string[];
  selectedCrossModeCaseNames: string[];
  candidateLimit: number;
  minScoreRatios: number[];
  model: LnsLearnedPromotionReviewResult["model"];
  ratios: LnsLearnedGuardCalibrationRatioResult[];
  gate: LnsLearnedGuardCalibrationGate;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: LnsLearnedGuardCalibrationDecision;
  summary: string;
}

export interface LnsLearnedGuardCalibrationSnapshot
  extends Omit<LnsLearnedGuardCalibrationResult, "generatedAt"> {}

export const DEFAULT_LNS_LEARNED_GUARD_CALIBRATION_MIN_SCORE_RATIOS = [
  1,
  0.95,
  0.9,
  0.75,
  0,
] as const;

function normalizeMinScoreRatios(ratios: readonly number[] | undefined): number[] {
  const selected = ratios ?? DEFAULT_LNS_LEARNED_GUARD_CALIBRATION_MIN_SCORE_RATIOS;
  if (selected.length === 0) {
    throw new Error("Expected LNS learned guard calibration to include at least one min-score ratio.");
  }
  const normalized: number[] = [];
  for (const ratio of selected) {
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new Error("Expected LNS learned guard calibration min-score ratios to be between 0 and 1.");
    }
    const rounded = roundBenchmarkMetric(ratio);
    if (!normalized.includes(rounded)) normalized.push(rounded);
  }
  return normalized;
}

function buildRatioGate(review: LnsLearnedPromotionReviewResult): LnsLearnedGuardCalibrationRatioGate {
  const holdout = review.gate.productHoldout;
  const all = review.gate.all;
  const failedReasons: string[] = [];

  if (holdout.comparisonCount === 0) failedReasons.push("product holdout has no comparisons");
  if (holdout.lossCount > 0) failedReasons.push(`product holdout regressions ${holdout.lossCount}`);
  if (holdout.worstDecilePopulationDeltaVsBaseline < 0) {
    failedReasons.push(`product holdout worst-decile delta ${holdout.worstDecilePopulationDeltaVsBaseline}`);
  }
  if (all.lossCount > 0) failedReasons.push(`overall regressions ${all.lossCount}`);
  if (all.validationFailureCount > 0) failedReasons.push(`validation failures ${all.validationFailureCount}`);

  const safeNoRegression = failedReasons.length === 0;
  const qualityLift = holdout.medianPopulationDeltaVsBaseline > 0 || holdout.meanPopulationDeltaVsBaseline > 0;
  if (!qualityLift) failedReasons.push("no product-holdout quality lift");

  return {
    safeNoRegression,
    qualityLift,
    eligibleForPromotionReview: safeNoRegression && qualityLift,
    failedReasons,
  };
}

function comparePromotionCandidates(
  left: LnsLearnedGuardCalibrationRatioResult,
  right: LnsLearnedGuardCalibrationRatioResult
): number {
  const leftHoldout = left.review.gate.productHoldout;
  const rightHoldout = right.review.gate.productHoldout;
  return (
    rightHoldout.meanPopulationDeltaVsBaseline - leftHoldout.meanPopulationDeltaVsBaseline
    || rightHoldout.medianPopulationDeltaVsBaseline - leftHoldout.medianPopulationDeltaVsBaseline
    || rightHoldout.worstDecilePopulationDeltaVsBaseline - leftHoldout.worstDecilePopulationDeltaVsBaseline
    || leftHoldout.meanWallClockDeltaVsBaselineSeconds - rightHoldout.meanWallClockDeltaVsBaselineSeconds
    || right.minScoreRatio - left.minScoreRatio
  );
}

function buildGate(ratios: readonly LnsLearnedGuardCalibrationRatioResult[]): LnsLearnedGuardCalibrationGate {
  const safeRatioCount = ratios.filter((entry) => entry.gate.safeNoRegression).length;
  const qualityLiftRatioCount = ratios.filter((entry) => entry.gate.qualityLift).length;
  const eligible = ratios
    .filter((entry) => entry.gate.eligibleForPromotionReview)
    .sort(comparePromotionCandidates);
  const failedReasons: string[] = [];
  if (eligible.length === 0) {
    failedReasons.push("no calibrated guard had product-holdout quality lift without regressions");
  }
  return {
    passed: eligible.length > 0,
    failedReasons,
    safeRatioCount,
    qualityLiftRatioCount,
    eligibleRatioCount: eligible.length,
    recommendedMinScoreRatio: eligible[0]?.minScoreRatio ?? null,
  };
}

function summarizeRatio(summary: LnsLearnedPromotionReviewSummary): string {
  return `n=${summary.comparisonCount} wins=${summary.winCount} ties=${summary.tieCount} losses=${summary.lossCount} mean=${formatBenchmarkSignedNumber(summary.meanPopulationDeltaVsBaseline)} median=${formatBenchmarkSignedNumber(summary.medianPopulationDeltaVsBaseline)} worst-decile=${formatBenchmarkSignedNumber(summary.worstDecilePopulationDeltaVsBaseline)} wall=${formatBenchmarkSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} validation-failures=${summary.validationFailureCount}`;
}

function summarizeRun(
  gate: LnsLearnedGuardCalibrationGate,
  ratios: readonly LnsLearnedGuardCalibrationRatioResult[]
): string {
  if (gate.recommendedMinScoreRatio !== null) {
    const recommended = ratios.find((entry) => entry.minScoreRatio === gate.recommendedMinScoreRatio);
    const holdout = recommended?.review.gate.productHoldout;
    const details = holdout
      ? ` product holdout mean delta ${formatBenchmarkSignedNumber(holdout.meanPopulationDeltaVsBaseline)}, median delta ${formatBenchmarkSignedNumber(holdout.medianPopulationDeltaVsBaseline)}, losses ${holdout.lossCount}.`
      : ".";
    return `LNS learned guard calibration found a promotion-review candidate at min-score-ratio ${gate.recommendedMinScoreRatio}:${details} Defaults remain unchanged until a separate promotion decision.`;
  }
  return `LNS learned guard calibration did not find a promotion-review candidate: ${gate.safeRatioCount}/${ratios.length} ratios were regression-safe and ${gate.qualityLiftRatioCount}/${ratios.length} showed product-holdout quality lift. Defaults remain opt-in.`;
}

export function runLnsLearnedGuardCalibration(
  options: LnsLearnedGuardCalibrationRunOptions = {}
): LnsLearnedGuardCalibrationResult {
  const minScoreRatios = normalizeMinScoreRatios(options.minScoreRatios);
  const ratios = minScoreRatios.map((minScoreRatio): LnsLearnedGuardCalibrationRatioResult => {
    const review = runLnsLearnedPromotionReview({
      productNames: options.productNames,
      crossModeNames: options.crossModeNames,
      seeds: options.seeds,
      lns: options.lns,
      cpSat: options.cpSat,
      greedy: options.greedy,
      learnedWindowRankingCandidateLimit: options.learnedWindowRankingCandidateLimit,
      learnedWindowRankingMinScoreRatio: minScoreRatio,
      solve: options.solve,
    });
    return {
      minScoreRatio,
      review,
      gate: buildRatioGate(review),
    };
  });
  const firstReview = ratios[0]?.review;
  if (!firstReview) throw new Error("LNS learned guard calibration produced no ratio reviews.");
  const gate = buildGate(ratios);
  const decision: LnsLearnedGuardCalibrationDecision = gate.passed
    ? "retry-lns-learned-default-promotion-review"
    : "keep-phase14-guard-and-opt-in";

  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...firstReview.seeds],
    selectedProductCaseNames: [...firstReview.selectedProductCaseNames],
    selectedCrossModeCaseNames: [...firstReview.selectedCrossModeCaseNames],
    candidateLimit: firstReview.candidateLimit,
    minScoreRatios,
    model: firstReview.model,
    ratios,
    gate,
    hardware: captureExperimentRegistryHardwareMetadata({ gpuUsed: false }),
    decision,
    summary: summarizeRun(gate, ratios),
  };
}

export function createLnsLearnedGuardCalibrationSnapshot(
  result: LnsLearnedGuardCalibrationResult
): LnsLearnedGuardCalibrationSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function writeLnsLearnedGuardCalibrationArtifact(
  result: LnsLearnedGuardCalibrationResult,
  outputPath: string
): LnsLearnedGuardCalibrationResult {
  const normalizedOutputPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function formatLnsLearnedGuardCalibration(result: LnsLearnedGuardCalibrationResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Learned Guard Calibration ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Model: ${result.model.version} ${result.model.fingerprint}`);
  lines.push(`Product cases: ${result.selectedProductCaseNames.join(", ")}`);
  lines.push(`Cross-mode cases: ${result.selectedCrossModeCaseNames.join(", ")}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Guarded candidate limit=${result.candidateLimit}`);
  lines.push(`Min-score ratios: ${result.minScoreRatios.join(", ")}`);
  lines.push(`Gate: passed=${result.gate.passed} recommended=${result.gate.recommendedMinScoreRatio ?? "none"} failures=${result.gate.failedReasons.length ? result.gate.failedReasons.join("; ") : "none"}`);
  for (const ratio of result.ratios) {
    lines.push(
      `- ratio=${ratio.minScoreRatio}: eligible=${ratio.gate.eligibleForPromotionReview} safe=${ratio.gate.safeNoRegression} lift=${ratio.gate.qualityLift} holdout ${summarizeRatio(ratio.review.gate.productHoldout)}; all ${summarizeRatio(ratio.review.gate.all)}`
    );
  }
  lines.push(`Decision: ${result.decision}`);
  lines.push(result.summary);
  return lines.join("\n");
}
