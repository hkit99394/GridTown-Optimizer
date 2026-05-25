import fs from "node:fs";
import path from "node:path";

import {
  benchmarkGeneratedAt,
  formatBenchmarkSeconds,
  formatBenchmarkSignedNumber,
  roundBenchmarkMetric,
} from "./benchmarkOptions.js";
import { captureExperimentRegistryHardwareMetadata } from "./experimentRegistry.js";
import { runLnsLearnedPromotionReview } from "./lnsLearnedPromotionReview.js";

import type { CpSatOptions, GreedyOptions, LnsOptions } from "../core/types.js";
import type {
  LnsLearnedPromotionReviewResult,
  LnsLearnedPromotionReviewSolve,
  LnsLearnedPromotionReviewSummary,
} from "./lnsLearnedPromotionReview.js";

export type LnsLearnedDisplacementDiagnosticsDecision =
  | "retry-promotion-with-displacement-config"
  | "retrain-lns-window-objective-before-promotion-review";

export interface LnsLearnedDisplacementDiagnosticsConfiguration {
  name: string;
  learnedWindowRankingCandidateLimit: number;
  learnedWindowRankingMinScoreRatio: number;
}

export interface LnsLearnedDisplacementDiagnosticsRunOptions {
  productNames?: readonly string[];
  crossModeNames?: readonly string[];
  seeds?: readonly number[];
  lns?: Partial<LnsOptions>;
  cpSat?: Partial<CpSatOptions>;
  greedy?: Partial<GreedyOptions>;
  configurations?: readonly LnsLearnedDisplacementDiagnosticsConfiguration[];
  solve?: LnsLearnedPromotionReviewSolve;
}

export interface LnsLearnedDisplacementDiagnosticsConfigurationResult {
  configuration: LnsLearnedDisplacementDiagnosticsConfiguration;
  review: LnsLearnedPromotionReviewResult;
  safeNoRegression: boolean;
  productHoldoutQualityLift: boolean;
  eligibleForPromotionReview: boolean;
  diagnosis: "strict-guard-blocked" | "displaced-windows-neutral" | "candidate-config-ready";
}

export interface LnsLearnedDisplacementDiagnosticsGate {
  passed: boolean;
  failedReasons: string[];
  displacementConfigCount: number;
  safeConfigCount: number;
  qualityLiftConfigCount: number;
  promotedConfigurationName: string | null;
}

export interface LnsLearnedDisplacementDiagnosticsResult {
  generatedAt: string;
  schemaVersion: 1;
  seeds: number[];
  selectedProductCaseNames: string[];
  selectedCrossModeCaseNames: string[];
  model: LnsLearnedPromotionReviewResult["model"];
  configurations: LnsLearnedDisplacementDiagnosticsConfigurationResult[];
  gate: LnsLearnedDisplacementDiagnosticsGate;
  hardware: Record<string, unknown> & {
    captured: boolean;
    gpuUsed: boolean;
  };
  decision: LnsLearnedDisplacementDiagnosticsDecision;
  summary: string;
}

export interface LnsLearnedDisplacementDiagnosticsSnapshot
  extends Omit<LnsLearnedDisplacementDiagnosticsResult, "generatedAt"> {}

export const DEFAULT_LNS_LEARNED_DISPLACEMENT_DIAGNOSTICS_CONFIGURATIONS:
readonly LnsLearnedDisplacementDiagnosticsConfiguration[] = Object.freeze([
  {
    name: "phase15-strict-guard",
    learnedWindowRankingCandidateLimit: 12,
    learnedWindowRankingMinScoreRatio: 1,
  },
  {
    name: "relaxed-guard",
    learnedWindowRankingCandidateLimit: 12,
    learnedWindowRankingMinScoreRatio: 0,
  },
  {
    name: "widened-shortlist",
    learnedWindowRankingCandidateLimit: 24,
    learnedWindowRankingMinScoreRatio: 0,
  },
]);

function normalizeConfigurations(
  configurations: readonly LnsLearnedDisplacementDiagnosticsConfiguration[] | undefined
): LnsLearnedDisplacementDiagnosticsConfiguration[] {
  const selected = configurations ?? DEFAULT_LNS_LEARNED_DISPLACEMENT_DIAGNOSTICS_CONFIGURATIONS;
  if (selected.length === 0) {
    throw new Error("Expected LNS learned displacement diagnostics to include at least one configuration.");
  }
  const names = new Set<string>();
  return selected.map((configuration) => {
    if (!configuration.name.trim()) {
      throw new Error("Expected LNS learned displacement diagnostics configuration names to be non-empty.");
    }
    if (names.has(configuration.name)) {
      throw new Error(`Duplicate LNS learned displacement diagnostics configuration '${configuration.name}'.`);
    }
    names.add(configuration.name);
    if (
      !Number.isInteger(configuration.learnedWindowRankingCandidateLimit)
      || configuration.learnedWindowRankingCandidateLimit <= 0
    ) {
      throw new Error("Expected LNS learned displacement diagnostics candidate limits to be positive integers.");
    }
    if (
      !Number.isFinite(configuration.learnedWindowRankingMinScoreRatio)
      || configuration.learnedWindowRankingMinScoreRatio < 0
      || configuration.learnedWindowRankingMinScoreRatio > 1
    ) {
      throw new Error("Expected LNS learned displacement diagnostics min-score ratios to be between 0 and 1.");
    }
    return {
      name: configuration.name,
      learnedWindowRankingCandidateLimit: configuration.learnedWindowRankingCandidateLimit,
      learnedWindowRankingMinScoreRatio: roundBenchmarkMetric(configuration.learnedWindowRankingMinScoreRatio),
    };
  });
}

function diagnoseConfiguration(
  configuration: LnsLearnedDisplacementDiagnosticsConfiguration,
  review: LnsLearnedPromotionReviewResult
): LnsLearnedDisplacementDiagnosticsConfigurationResult {
  const holdout = review.gate.productHoldout;
  const all = review.gate.all;
  const safeNoRegression = holdout.comparisonCount > 0
    && holdout.lossCount === 0
    && holdout.worstDecilePopulationDeltaVsBaseline >= 0
    && all.lossCount === 0
    && all.validationFailureCount === 0;
  const productHoldoutQualityLift = holdout.medianPopulationDeltaVsBaseline > 0
    || holdout.meanPopulationDeltaVsBaseline > 0;
  const eligibleForPromotionReview = safeNoRegression && productHoldoutQualityLift;
  const diagnosis = eligibleForPromotionReview
    ? "candidate-config-ready"
    : all.learnedWindowRankingDisplacedAttempts === 0
      ? "strict-guard-blocked"
      : "displaced-windows-neutral";
  return {
    configuration,
    review,
    safeNoRegression,
    productHoldoutQualityLift,
    eligibleForPromotionReview,
    diagnosis,
  };
}

function compareEligibleConfigurations(
  left: LnsLearnedDisplacementDiagnosticsConfigurationResult,
  right: LnsLearnedDisplacementDiagnosticsConfigurationResult
): number {
  const leftHoldout = left.review.gate.productHoldout;
  const rightHoldout = right.review.gate.productHoldout;
  return (
    rightHoldout.meanPopulationDeltaVsBaseline - leftHoldout.meanPopulationDeltaVsBaseline
    || rightHoldout.medianPopulationDeltaVsBaseline - leftHoldout.medianPopulationDeltaVsBaseline
    || leftHoldout.meanWallClockDeltaVsBaselineSeconds - rightHoldout.meanWallClockDeltaVsBaselineSeconds
    || left.configuration.learnedWindowRankingCandidateLimit - right.configuration.learnedWindowRankingCandidateLimit
  );
}

function buildGate(
  configurations: readonly LnsLearnedDisplacementDiagnosticsConfigurationResult[]
): LnsLearnedDisplacementDiagnosticsGate {
  const eligible = configurations
    .filter((configuration) => configuration.eligibleForPromotionReview)
    .sort(compareEligibleConfigurations);
  const failedReasons: string[] = [];
  if (eligible.length === 0) {
    failedReasons.push("no displacement configuration produced product-holdout quality lift");
  }
  return {
    passed: eligible.length > 0,
    failedReasons,
    displacementConfigCount: configurations.length,
    safeConfigCount: configurations.filter((configuration) => configuration.safeNoRegression).length,
    qualityLiftConfigCount: configurations.filter((configuration) => configuration.productHoldoutQualityLift).length,
    promotedConfigurationName: eligible[0]?.configuration.name ?? null,
  };
}

function summarizeReviewSummary(summary: LnsLearnedPromotionReviewSummary): string {
  return `n=${summary.comparisonCount} wins=${summary.winCount} ties=${summary.tieCount} losses=${summary.lossCount} mean=${formatBenchmarkSignedNumber(summary.meanPopulationDeltaVsBaseline)} median=${formatBenchmarkSignedNumber(summary.medianPopulationDeltaVsBaseline)} wall=${formatBenchmarkSeconds(summary.meanWallClockDeltaVsBaselineSeconds)} displaced=${summary.learnedWindowRankingDisplacedAttempts}/${summary.learnedWindowRankingDisplacedImprovements}`;
}

function summarizeRun(
  gate: LnsLearnedDisplacementDiagnosticsGate,
  configurations: readonly LnsLearnedDisplacementDiagnosticsConfigurationResult[]
): string {
  if (gate.promotedConfigurationName !== null) {
    return `LNS learned displacement diagnostics found a promotion-review candidate: ${gate.promotedConfigurationName}. Defaults remain unchanged until a separate promotion review.`;
  }
  const neutralConfigs = configurations.filter((configuration) => configuration.diagnosis === "displaced-windows-neutral").length;
  const blockedConfigs = configurations.filter((configuration) => configuration.diagnosis === "strict-guard-blocked").length;
  return `LNS learned displacement diagnostics found no promotion candidate: ${gate.safeConfigCount}/${configurations.length} configurations were regression-safe, ${gate.qualityLiftConfigCount}/${configurations.length} had product-holdout lift, ${blockedConfigs} were blocked by the strict guard, and ${neutralConfigs} displaced windows without final quality lift. Retrain or retarget the window objective before another promotion review.`;
}

export function runLnsLearnedDisplacementDiagnostics(
  options: LnsLearnedDisplacementDiagnosticsRunOptions = {}
): LnsLearnedDisplacementDiagnosticsResult {
  const normalizedConfigurations = normalizeConfigurations(options.configurations);
  const configurations = normalizedConfigurations.map((configuration) => {
    const review = runLnsLearnedPromotionReview({
      productNames: options.productNames,
      crossModeNames: options.crossModeNames,
      seeds: options.seeds,
      lns: options.lns,
      cpSat: options.cpSat,
      greedy: options.greedy,
      learnedWindowRankingCandidateLimit: configuration.learnedWindowRankingCandidateLimit,
      learnedWindowRankingMinScoreRatio: configuration.learnedWindowRankingMinScoreRatio,
      solve: options.solve,
    });
    return diagnoseConfiguration(configuration, review);
  });
  const firstReview = configurations[0]?.review;
  if (!firstReview) throw new Error("LNS learned displacement diagnostics produced no configuration reviews.");
  const gate = buildGate(configurations);
  const decision: LnsLearnedDisplacementDiagnosticsDecision = gate.passed
    ? "retry-promotion-with-displacement-config"
    : "retrain-lns-window-objective-before-promotion-review";
  return {
    generatedAt: benchmarkGeneratedAt(),
    schemaVersion: 1,
    seeds: [...firstReview.seeds],
    selectedProductCaseNames: [...firstReview.selectedProductCaseNames],
    selectedCrossModeCaseNames: [...firstReview.selectedCrossModeCaseNames],
    model: firstReview.model,
    configurations,
    gate,
    hardware: captureExperimentRegistryHardwareMetadata({ gpuUsed: false }),
    decision,
    summary: summarizeRun(gate, configurations),
  };
}

export function createLnsLearnedDisplacementDiagnosticsSnapshot(
  result: LnsLearnedDisplacementDiagnosticsResult
): LnsLearnedDisplacementDiagnosticsSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return snapshot;
}

export function writeLnsLearnedDisplacementDiagnosticsArtifact(
  result: LnsLearnedDisplacementDiagnosticsResult,
  outputPath: string
): LnsLearnedDisplacementDiagnosticsResult {
  const normalizedOutputPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function formatLnsLearnedDisplacementDiagnostics(
  result: LnsLearnedDisplacementDiagnosticsResult
): string {
  const lines: string[] = [];
  lines.push("=== LNS Learned Displacement Diagnostics ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Schema: ${result.schemaVersion}`);
  lines.push(`Model: ${result.model.version} ${result.model.fingerprint}`);
  lines.push(`Product cases: ${result.selectedProductCaseNames.join(", ")}`);
  lines.push(`Cross-mode cases: ${result.selectedCrossModeCaseNames.join(", ")}`);
  lines.push(`Seeds: ${result.seeds.join(", ")}`);
  lines.push(`Gate: passed=${result.gate.passed} promoted=${result.gate.promotedConfigurationName ?? "none"} failures=${result.gate.failedReasons.length ? result.gate.failedReasons.join("; ") : "none"}`);
  for (const configuration of result.configurations) {
    lines.push(
      `- ${configuration.configuration.name}: candidate-limit=${configuration.configuration.learnedWindowRankingCandidateLimit} min-score-ratio=${configuration.configuration.learnedWindowRankingMinScoreRatio} diagnosis=${configuration.diagnosis} holdout ${summarizeReviewSummary(configuration.review.gate.productHoldout)}; all ${summarizeReviewSummary(configuration.review.gate.all)}`
    );
  }
  lines.push(`Decision: ${result.decision}`);
  lines.push(result.summary);
  return lines.join("\n");
}
