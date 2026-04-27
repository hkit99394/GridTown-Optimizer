import { formatBenchmarkSeeds, normalizeBenchmarkSeeds } from "./benchmarkSeeds.js";
import {
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
} from "./greedyConnectivityShadowAblations.js";
import { runGreedyBenchmarkSuite } from "./greedy.js";

import type {
  GreedyBenchmarkCase,
  GreedyBenchmarkOptions,
  GreedyBenchmarkRunOptions,
} from "./greedy.js";
import type {
  GreedyConnectivityShadowDecisionPhase,
  GreedyConnectivityShadowDecisionTrace,
  GreedyConnectivityShadowPlacementTrace,
} from "../core/types.js";

export type GreedyConnectivityShadowOrderingPreference = "candidate" | "incumbent";

export interface GreedyConnectivityShadowOrderingFeatures {
  candidateRoadCost: number;
  incumbentRoadCost: number;
  roadCostDelta: number;
  candidateArea: number;
  incumbentArea: number;
  areaDelta: number;
  candidateTypeIndex: number | null;
  incumbentTypeIndex: number | null;
  sameTypeIndex: boolean | null;
  candidateBonus: number | null;
  incumbentBonus: number | null;
  bonusDelta: number | null;
  candidateShadowPenalty: number;
  incumbentShadowPenalty: number;
  shadowPenaltyDelta: number;
}

export interface GreedyConnectivityShadowOrderingLabel {
  caseName: string;
  seed: number | null;
  labelIndex: number;
  phase: GreedyConnectivityShadowDecisionPhase;
  score: number;
  preferred: GreedyConnectivityShadowOrderingPreference;
  shadowPenaltyMargin: number;
  candidate: GreedyConnectivityShadowPlacementTrace;
  incumbent: GreedyConnectivityShadowPlacementTrace;
  chosen: GreedyConnectivityShadowPlacementTrace;
  rejected: GreedyConnectivityShadowPlacementTrace;
  features: GreedyConnectivityShadowOrderingFeatures;
}

export interface GreedyConnectivityShadowOrderingLabelRunOptions extends GreedyBenchmarkRunOptions {
  seeds?: readonly number[];
  maxLabelsPerCase?: number;
}

export interface GreedyConnectivityShadowOrderingLabelCaseResult {
  name: string;
  description: string;
  seed: number | null;
  gridRows: number;
  gridCols: number;
  totalPopulation: number;
  roadCount: number;
  serviceCount: number;
  residentialCount: number;
  greedyOptions: GreedyBenchmarkOptions;
  traceCount: number;
  labelCount: number;
  labels: GreedyConnectivityShadowOrderingLabel[];
}

export interface GreedyConnectivityShadowOrderingLabelSuiteResult {
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  comparisonCount: number;
  seeds: number[];
  selectedCaseNames: string[];
  maxLabelsPerCase: number;
  labelCount: number;
  cases: GreedyConnectivityShadowOrderingLabelCaseResult[];
}

export interface GreedyConnectivityShadowOrderingLabelSnapshot
  extends Omit<GreedyConnectivityShadowOrderingLabelSuiteResult, "generatedAt"> {}

export const DEFAULT_GREEDY_CONNECTIVITY_SHADOW_ORDERING_LABEL_CORPUS =
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS;

const DEFAULT_MAX_LABELS_PER_CASE = 80;

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function clonePlacement(
  placement: GreedyConnectivityShadowPlacementTrace
): GreedyConnectivityShadowPlacementTrace {
  return { ...placement };
}

function placementArea(placement: GreedyConnectivityShadowPlacementTrace): number {
  return placement.rows * placement.cols;
}

function optionalNumberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalDelta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function sameTypeIndex(
  candidateTypeIndex: number | null,
  incumbentTypeIndex: number | null
): boolean | null {
  return candidateTypeIndex === null || incumbentTypeIndex === null
    ? null
    : candidateTypeIndex === incumbentTypeIndex;
}

function preferredSide(
  decision: GreedyConnectivityShadowDecisionTrace
): GreedyConnectivityShadowOrderingPreference {
  return decision.candidateShadowPenalty < decision.incumbentShadowPenalty ? "candidate" : "incumbent";
}

function labelFromDecision(options: {
  caseName: string;
  seed: number | null;
  labelIndex: number;
  decision: GreedyConnectivityShadowDecisionTrace;
}): GreedyConnectivityShadowOrderingLabel {
  const { caseName, seed, labelIndex, decision } = options;
  const candidate = clonePlacement(decision.candidate);
  const incumbent = clonePlacement(decision.incumbent);
  const candidateTypeIndex = optionalNumberOrNull(candidate.typeIndex);
  const incumbentTypeIndex = optionalNumberOrNull(incumbent.typeIndex);
  const candidateBonus = optionalNumberOrNull(candidate.bonus);
  const incumbentBonus = optionalNumberOrNull(incumbent.bonus);
  const candidateArea = placementArea(candidate);
  const incumbentArea = placementArea(incumbent);
  const shadowPenaltyDelta = decision.candidateShadowPenalty - decision.incumbentShadowPenalty;

  return {
    caseName,
    seed,
    labelIndex,
    phase: decision.phase,
    score: decision.score,
    preferred: preferredSide(decision),
    shadowPenaltyMargin: Math.abs(shadowPenaltyDelta),
    candidate,
    incumbent,
    chosen: clonePlacement(decision.chosen),
    rejected: clonePlacement(decision.rejected),
    features: {
      candidateRoadCost: candidate.roadCost,
      incumbentRoadCost: incumbent.roadCost,
      roadCostDelta: candidate.roadCost - incumbent.roadCost,
      candidateArea,
      incumbentArea,
      areaDelta: candidateArea - incumbentArea,
      candidateTypeIndex,
      incumbentTypeIndex,
      sameTypeIndex: sameTypeIndex(candidateTypeIndex, incumbentTypeIndex),
      candidateBonus,
      incumbentBonus,
      bonusDelta: optionalDelta(candidateBonus, incumbentBonus),
      candidateShadowPenalty: decision.candidateShadowPenalty,
      incumbentShadowPenalty: decision.incumbentShadowPenalty,
      shadowPenaltyDelta,
    },
  };
}

export function listGreedyConnectivityShadowOrderingLabelCaseNames(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_CONNECTIVITY_SHADOW_ORDERING_LABEL_CORPUS
): string[] {
  return corpus.map((benchmarkCase) => benchmarkCase.name);
}

export function createGreedyConnectivityShadowOrderingLabelsFromDecisions(options: {
  caseName: string;
  seed?: number | null;
  decisions: readonly GreedyConnectivityShadowDecisionTrace[];
  maxLabels?: number;
}): GreedyConnectivityShadowOrderingLabel[] {
  const maxLabels = positiveIntegerOrDefault(options.maxLabels, DEFAULT_MAX_LABELS_PER_CASE);
  return options.decisions
    .slice(0, maxLabels)
    .map((decision, labelIndex) =>
      labelFromDecision({
        caseName: options.caseName,
        seed: options.seed ?? null,
        labelIndex,
        decision,
      })
    );
}

export function runGreedyConnectivityShadowOrderingLabels(
  corpus: readonly GreedyBenchmarkCase[] = DEFAULT_GREEDY_CONNECTIVITY_SHADOW_ORDERING_LABEL_CORPUS,
  options: GreedyConnectivityShadowOrderingLabelRunOptions = {}
): GreedyConnectivityShadowOrderingLabelSuiteResult {
  const seeds = normalizeBenchmarkSeeds(options.seeds, "Greedy connectivity-shadow ordering label seeds") ?? [];
  const seedRuns: readonly (number | null)[] = seeds.length ? seeds : [null];
  const maxLabelsPerCase = positiveIntegerOrDefault(options.maxLabelsPerCase, DEFAULT_MAX_LABELS_PER_CASE);
  const cases = seedRuns.flatMap((seed) => {
    const suite = runGreedyBenchmarkSuite(corpus, {
      names: options.names,
      greedy: {
        ...(options.greedy ?? {}),
        connectivityShadowScoring: true,
        profile: true,
        ...(seed !== null ? { randomSeed: seed } : {}),
      },
    });
    return suite.results.map((result): GreedyConnectivityShadowOrderingLabelCaseResult => {
      const decisions = result.greedyProfile?.connectivityShadowDecisions ?? [];
      const labels = createGreedyConnectivityShadowOrderingLabelsFromDecisions({
        caseName: result.name,
        seed,
        decisions,
        maxLabels: maxLabelsPerCase,
      });
      return {
        name: result.name,
        description: result.description,
        seed,
        gridRows: result.gridRows,
        gridCols: result.gridCols,
        totalPopulation: result.totalPopulation,
        roadCount: result.roadCount,
        serviceCount: result.serviceCount,
        residentialCount: result.residentialCount,
        greedyOptions: result.greedyOptions,
        traceCount: decisions.length,
        labelCount: labels.length,
        labels,
      };
    });
  });
  const selectedCaseNames = [...new Set(cases.map((benchmarkCase) => benchmarkCase.name))];

  return {
    generatedAt: new Date().toISOString(),
    caseCount: selectedCaseNames.length,
    seedCount: seedRuns.length,
    comparisonCount: cases.length,
    seeds,
    selectedCaseNames,
    maxLabelsPerCase,
    labelCount: cases.reduce((total, benchmarkCase) => total + benchmarkCase.labelCount, 0),
    cases,
  };
}

export function createGreedyConnectivityShadowOrderingLabelSnapshot(
  result: GreedyConnectivityShadowOrderingLabelSuiteResult
): GreedyConnectivityShadowOrderingLabelSnapshot {
  const { generatedAt: _generatedAt, ...snapshot } = result;
  return {
    ...snapshot,
    seeds: [...snapshot.seeds],
    selectedCaseNames: [...snapshot.selectedCaseNames],
    cases: snapshot.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      greedyOptions: structuredClone(benchmarkCase.greedyOptions),
      labels: benchmarkCase.labels.map((label) => structuredClone(label)),
    })),
  };
}

function formatPlacement(placement: GreedyConnectivityShadowPlacementTrace): string {
  const extras = [
    placement.typeIndex === undefined ? null : `type:${placement.typeIndex}`,
    placement.bonus === undefined ? null : `bonus:${placement.bonus}`,
    placement.range === undefined ? null : `range:${placement.range}`,
  ].filter((entry): entry is string => entry !== null);
  return `r${placement.r}c${placement.c} ${placement.rows}x${placement.cols} road:${placement.roadCost}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${Number(value).toLocaleString()}` : Number(value).toLocaleString();
}

export function formatGreedyConnectivityShadowOrderingLabels(
  result: GreedyConnectivityShadowOrderingLabelSuiteResult
): string {
  const lines: string[] = [];
  lines.push("=== Greedy Connectivity-Shadow Ordering Labels ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${formatBenchmarkSeeds(result.seeds)}`);
  lines.push(`Labels: ${result.labelCount}`);
  lines.push(`Max labels per case: ${result.maxLabelsPerCase}`);

  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    lines.push(
      `- ${benchmarkCase.name} seed=${seedLabel}: population=${benchmarkCase.totalPopulation} labels=${benchmarkCase.labelCount}/${benchmarkCase.traceCount}`
    );
    for (const label of benchmarkCase.labels) {
      lines.push(
        `  label#${label.labelIndex} phase=${label.phase} score=${label.score} preferred=${label.preferred} margin=${label.shadowPenaltyMargin.toFixed(3)} shadow-delta=${formatSigned(label.features.shadowPenaltyDelta)} road-delta=${formatSigned(label.features.roadCostDelta)} chosen=${formatPlacement(label.chosen)} rejected=${formatPlacement(label.rejected)}`
      );
    }
  }

  return lines.join("\n");
}
