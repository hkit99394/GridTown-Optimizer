import type {
  GreedyDeterministicAblationSuiteResult,
  GreedyDeterministicAblationVariantSummary,
} from "./greedyDeterministicAblations.js";
import type {
  LnsNeighborhoodAblationSuiteResult,
  LnsNeighborhoodAblationVariantSummary,
} from "./lnsNeighborhoodAblations.js";

export type DeterministicAblationGateSuiteName = "greedy-deterministic" | "lns-neighborhood";

export type DeterministicAblationGateDecision =
  | "keep-baseline"
  | "safe-deterministic-candidate"
  | "learning-target"
  | "blocked-regression";

export interface DeterministicAblationGateEvidence {
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  medianPopulationDeltaVsBaseline: number;
  worstDecilePopulationDeltaVsBaseline: number;
  bestPopulationDeltaVsBaseline: number;
  worstPopulationDeltaVsBaseline: number;
  winRate: number;
  regressionRate: number;
  unchangedRate: number;
  meanWallClockSeconds: number;
  meanWallClockDeltaVsBaselineSeconds: number;
  bestPopulationDeltaCaseName: string | null;
  bestPopulationDeltaSeed: number | null;
  worstPopulationDeltaCaseName: string | null;
  worstPopulationDeltaSeed: number | null;
  firstWindowMovementRate?: number;
  windowSequenceMovementRate?: number;
  anchorCoordinateMovementRate?: number;
}

export interface DeterministicAblationGateVariantDecision {
  suite: DeterministicAblationGateSuiteName;
  variantName: string;
  decision: DeterministicAblationGateDecision;
  nextAction: string;
  reasons: string[];
  evidence: DeterministicAblationGateEvidence;
}

export interface DeterministicAblationGateSuiteReport {
  suite: DeterministicAblationGateSuiteName;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  variants: string[];
  decisions: DeterministicAblationGateVariantDecision[];
}

export interface DeterministicAblationGateReport {
  schemaVersion: 1;
  reportType: "deterministic-ablation-gate";
  suites: DeterministicAblationGateSuiteReport[];
  nextActions: string[];
}

export interface DeterministicAblationGateReportInput {
  greedy?: GreedyDeterministicAblationSuiteResult;
  lns?: LnsNeighborhoodAblationSuiteResult;
}

export const DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS = Object.freeze([7, 19, 37]);

type VariantSummary =
  | GreedyDeterministicAblationVariantSummary
  | LnsNeighborhoodAblationVariantSummary;

function isLnsVariantSummary(summary: VariantSummary): summary is LnsNeighborhoodAblationVariantSummary {
  return "firstWindowMovementRate" in summary;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${Number(value).toLocaleString()}` : Number(value).toLocaleString();
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function evidenceFromSummary(summary: VariantSummary): DeterministicAblationGateEvidence {
  const evidence: DeterministicAblationGateEvidence = {
    caseCount: summary.caseCount,
    seedCount: summary.seedCount,
    comparisonCount: summary.comparisonCount,
    medianPopulationDeltaVsBaseline: summary.medianPopulationDeltaVsBaseline,
    worstDecilePopulationDeltaVsBaseline: summary.worstDecilePopulationDeltaVsBaseline,
    bestPopulationDeltaVsBaseline: summary.bestPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
    winRate: summary.winRate,
    regressionRate: summary.regressionRate,
    unchangedRate: summary.unchangedRate,
    meanWallClockSeconds: summary.meanWallClockSeconds ?? 0,
    meanWallClockDeltaVsBaselineSeconds: summary.meanWallClockDeltaVsBaselineSeconds ?? 0,
    bestPopulationDeltaCaseName: summary.bestPopulationDeltaCaseName,
    bestPopulationDeltaSeed: summary.bestPopulationDeltaSeed,
    worstPopulationDeltaCaseName: summary.worstPopulationDeltaCaseName,
    worstPopulationDeltaSeed: summary.worstPopulationDeltaSeed,
  };
  if (isLnsVariantSummary(summary)) {
    evidence.firstWindowMovementRate = summary.firstWindowMovementRate;
    evidence.windowSequenceMovementRate = summary.windowSequenceMovementRate;
    evidence.anchorCoordinateMovementRate = summary.anchorCoordinateMovementRate;
  }
  return evidence;
}

function hasPopulationRegression(summary: VariantSummary): boolean {
  return summary.regressionRate > 0
    || summary.worstPopulationDeltaVsBaseline < 0
    || summary.medianPopulationDeltaVsBaseline < 0
    || summary.worstDecilePopulationDeltaVsBaseline < 0;
}

function hasRepeatedNonRegressingWin(summary: VariantSummary): boolean {
  return summary.winRate > 0
    && summary.medianPopulationDeltaVsBaseline > 0
    && summary.worstDecilePopulationDeltaVsBaseline >= 0
    && summary.worstPopulationDeltaVsBaseline >= 0;
}

function hasMeanWallClockCost(summary: VariantSummary): boolean {
  return (summary.meanWallClockDeltaVsBaselineSeconds ?? 0) > 0;
}

function hasIsolatedPopulationWin(summary: VariantSummary): boolean {
  return summary.bestPopulationDeltaVsBaseline > 0;
}

function hasWindowMovement(summary: LnsNeighborhoodAblationVariantSummary): boolean {
  return summary.firstWindowMovementRate > 0
    || summary.windowSequenceMovementRate > 0
    || summary.anchorCoordinateMovementRate > 0;
}

function decideVariant(
  suite: DeterministicAblationGateSuiteName,
  summary: VariantSummary
): DeterministicAblationGateVariantDecision {
  const evidence = evidenceFromSummary(summary);
  const reasons: string[] = [];
  let decision: DeterministicAblationGateDecision;
  let nextAction: string;

  if (summary.variantName === "baseline") {
    decision = "keep-baseline";
    nextAction = "Keep the current baseline as the comparison reference.";
    reasons.push("Baseline variant is the reference behavior.");
  } else if (hasPopulationRegression(summary)) {
    decision = "blocked-regression";
    nextAction = "Do not promote; inspect the worst case/seed and add pressure coverage before retrying.";
    reasons.push(
      `Regression evidence exists: regression-rate=${formatRate(summary.regressionRate)}, worst-delta=${formatSigned(summary.worstPopulationDeltaVsBaseline)}.`
    );
  } else if (hasRepeatedNonRegressingWin(summary) && !hasMeanWallClockCost(summary)) {
    decision = "safe-deterministic-candidate";
    nextAction = "Treat as a deterministic candidate and rerun the seeded matrix on expanded held-out pressure cases.";
    reasons.push(
      `Repeated non-regressing win: win-rate=${formatRate(summary.winRate)}, median-delta=${formatSigned(summary.medianPopulationDeltaVsBaseline)}.`
    );
  } else if (hasRepeatedNonRegressingWin(summary) && hasMeanWallClockCost(summary)) {
    decision = "learning-target";
    nextAction = "Rerun at fixed wall-clock budgets or collect labels before promotion; population lift currently carries mean time cost.";
    reasons.push(
      `Population lift is non-regressing but slower on average: median-delta=${formatSigned(summary.medianPopulationDeltaVsBaseline)}, wall-delta-mean=${formatSeconds(summary.meanWallClockDeltaVsBaselineSeconds ?? 0)}.`
    );
  } else if (hasIsolatedPopulationWin(summary)) {
    decision = "learning-target";
    nextAction = suite === "lns-neighborhood"
      ? "Collect counterfactual LNS window replay labels before learned window ranking."
      : "Collect ordering labels before trying learned Greedy ranking.";
    reasons.push(
      `Has isolated wins but not enough repeated lift for deterministic promotion: best-delta=${formatSigned(summary.bestPopulationDeltaVsBaseline)}.`
    );
  } else if (isLnsVariantSummary(summary) && hasWindowMovement(summary)) {
    decision = "learning-target";
    nextAction = "Collect counterfactual LNS window replay labels before learned window ranking.";
    reasons.push(
      `Window choice changed without population lift: first-window-move-rate=${formatRate(summary.firstWindowMovementRate)}, window-sequence-move-rate=${formatRate(summary.windowSequenceMovementRate)}, anchor-coordinate-move-rate=${formatRate(summary.anchorCoordinateMovementRate)}.`
    );
  } else {
    decision = "keep-baseline";
    nextAction = "Keep baseline and expand pressure cases before adding learned guidance.";
    reasons.push("No repeated population win was observed.");
  }

  return {
    suite,
    variantName: summary.variantName,
    decision,
    nextAction,
    reasons,
    evidence,
  };
}

function buildSuiteReport(
  suite: DeterministicAblationGateSuiteName,
  result: GreedyDeterministicAblationSuiteResult | LnsNeighborhoodAblationSuiteResult
): DeterministicAblationGateSuiteReport {
  return {
    suite,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    selectedCaseNames: [...result.selectedCaseNames],
    variants: [...result.variants],
    decisions: result.variantSummaries.map((summary) => decideVariant(suite, summary)),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nextActionsForSuites(suites: readonly DeterministicAblationGateSuiteReport[]): string[] {
  const decisions = suites.flatMap((suite) => suite.decisions);
  const actions: string[] = [];
  if (decisions.some((entry) => entry.decision === "blocked-regression")) {
    actions.push("Keep blocked variants out of defaults and inspect their worst case/seed evidence.");
  }
  if (decisions.some((entry) => entry.decision === "safe-deterministic-candidate")) {
    actions.push("Validate safe deterministic candidates on expanded held-out pressure cases before promotion.");
  }
  if (decisions.some((entry) => entry.suite === "greedy-deterministic" && entry.decision === "learning-target")) {
    actions.push("Collect Greedy ordering labels for variants with isolated wins but weak repeatability.");
  }
  if (decisions.some((entry) => entry.suite === "lns-neighborhood" && entry.decision === "learning-target")) {
    actions.push("Collect counterfactual LNS window replay labels before learned window ranking.");
  }
  if (actions.length === 0) {
    actions.push("Keep deterministic baselines and expand pressure coverage before learned guidance.");
  }
  return unique(actions);
}

export function buildDeterministicAblationGateReport(
  input: DeterministicAblationGateReportInput
): DeterministicAblationGateReport {
  const suites: DeterministicAblationGateSuiteReport[] = [];
  if (input.greedy) {
    suites.push(buildSuiteReport("greedy-deterministic", input.greedy));
  }
  if (input.lns) {
    suites.push(buildSuiteReport("lns-neighborhood", input.lns));
  }
  if (suites.length === 0) {
    throw new Error("Deterministic ablation gate report requires at least one suite result.");
  }
  return {
    schemaVersion: 1,
    reportType: "deterministic-ablation-gate",
    suites,
    nextActions: nextActionsForSuites(suites),
  };
}

export function formatDeterministicAblationGateReport(
  report: DeterministicAblationGateReport
): string {
  const lines: string[] = [];
  lines.push("=== Deterministic Ablation Gate Report ===");
  for (const suite of report.suites) {
    lines.push(
      `- ${suite.suite}: cases=${suite.caseCount} seeds=${suite.seedCount} comparisons=${suite.comparisonCount} variants=${suite.variants.join(", ")}`
    );
    for (const decision of suite.decisions) {
      const evidence = decision.evidence;
      const windowEvidence = evidence.firstWindowMovementRate === undefined
        ? ""
        : ` first-window-move-rate=${formatRate(evidence.firstWindowMovementRate)} window-sequence-move-rate=${formatRate(evidence.windowSequenceMovementRate ?? 0)} anchor-coordinate-move-rate=${formatRate(evidence.anchorCoordinateMovementRate ?? 0)}`;
      lines.push(
        `  ${decision.variantName}: ${decision.decision} win-rate=${formatRate(evidence.winRate)} regression-rate=${formatRate(evidence.regressionRate)} median-delta=${formatSigned(evidence.medianPopulationDeltaVsBaseline)} worst-delta=${formatSigned(evidence.worstPopulationDeltaVsBaseline)} best-delta=${formatSigned(evidence.bestPopulationDeltaVsBaseline)} wall-mean=${formatSeconds(evidence.meanWallClockSeconds)} wall-delta-mean=${formatSeconds(evidence.meanWallClockDeltaVsBaselineSeconds)}${windowEvidence}`
      );
      lines.push(`    next: ${decision.nextAction}`);
      for (const reason of decision.reasons) {
        lines.push(`    reason: ${reason}`);
      }
    }
  }
  lines.push("Next actions:");
  for (const action of report.nextActions) {
    lines.push(`- ${action}`);
  }
  return lines.join("\n");
}
