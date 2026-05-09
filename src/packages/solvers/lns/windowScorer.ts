import {
  cellKey,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates,
  getResidentialBaseMax,
  height,
  isAllowed,
  NO_TYPE_INDEX,
  normalizeServicePlacement,
  orthogonalNeighbors,
  residentialFootprint,
  serviceFootprint,
  width
} from "../../core/index.js";

import { LNS_WINDOW_RANKER_FEATURE_NAMES } from "../../core/index.js";
import type {
  CpSatNeighborhoodWindow,
  Grid,
  LnsWindowRankerDecisionStateTelemetry,
  LnsWindowRankerFeatureDeltaGate,
  LnsWindowRankerFeatureName,
  LnsWindowRankerFeatureTelemetry,
  LnsWindowRankerOperatorTransition,
  LnsWindowRankerRuntimeModel,
  LnsWindowRankerRuntimeOptions,
  LnsWindowRankerSelectionTelemetry,
  Solution,
  SolverParams
} from "../../core/index.js";
import type { LnsAdaptiveNeighborhoodCandidate } from "./neighborhoods.js";

const LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION = 2;

export interface NormalizedLnsWindowRankerOptions {
  model: LnsWindowRankerRuntimeModel;
  minScoreDelta: number;
  allowedTransitions: readonly LnsWindowRankerOperatorTransition[] | null;
  featureDeltaGates: readonly LnsWindowRankerFeatureDeltaGate[];
  captureDecisionState: boolean;
}

export interface LnsWindowRankerSelectionDecision {
  candidate: LnsAdaptiveNeighborhoodCandidate;
  telemetry: LnsWindowRankerSelectionTelemetry;
}

interface EmptyGraphSummary {
  emptyKeys: Set<string>;
  reachableKeys: Set<string>;
  reachableCount: number;
  disconnectedCount: number;
  componentCount: number;
}

interface WindowRankerFeatureValues extends Record<LnsWindowRankerFeatureName, number> {}

interface ScoredWindowRankerCandidate {
  candidate: LnsAdaptiveNeighborhoodCandidate;
  index: number;
  features: WindowRankerFeatureValues;
  score: number;
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeAllowedTransitions(
  allowedTransitions: readonly LnsWindowRankerOperatorTransition[] | undefined
): readonly LnsWindowRankerOperatorTransition[] | null {
  return allowedTransitions === undefined ? null : [...new Set(allowedTransitions)];
}

function normalizeFeatureDeltaGates(
  featureDeltaGates: readonly LnsWindowRankerFeatureDeltaGate[] | undefined
): readonly LnsWindowRankerFeatureDeltaGate[] {
  return featureDeltaGates === undefined
    ? []
    : featureDeltaGates.map((gate) => ({
        feature: gate.feature,
        ...(gate.minDelta === undefined ? {} : { minDelta: gate.minDelta }),
        ...(gate.maxDelta === undefined ? {} : { maxDelta: gate.maxDelta })
      }));
}

export function normalizeLnsWindowRankerOptions(
  options: LnsWindowRankerRuntimeOptions | undefined
): NormalizedLnsWindowRankerOptions | null {
  if (!options || options.enabled === false) return null;
  return {
    model: options.model,
    minScoreDelta: Math.max(0, finiteNumberOrDefault(options.minScoreDelta, 0)),
    allowedTransitions: normalizeAllowedTransitions(options.allowedTransitions),
    featureDeltaGates: normalizeFeatureDeltaGates(options.featureDeltaGates),
    captureDecisionState: options.captureDecisionState === true
  };
}

function operatorTransition(
  baselineOperator: LnsAdaptiveNeighborhoodCandidate["operator"],
  selectedOperator: LnsAdaptiveNeighborhoodCandidate["operator"]
): LnsWindowRankerOperatorTransition {
  return `${baselineOperator}->${selectedOperator}` as LnsWindowRankerOperatorTransition;
}

function sameWindow(left: CpSatNeighborhoodWindow, right: CpSatNeighborhoodWindow): boolean {
  return left.top === right.top && left.left === right.left && left.rows === right.rows && left.cols === right.cols;
}

function sameCandidate(left: LnsAdaptiveNeighborhoodCandidate, right: LnsAdaptiveNeighborhoodCandidate): boolean {
  return left.operator === right.operator && sameWindow(left.window, right.window);
}

function rectangleIntersectsWindow(
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): boolean {
  return (
    r < window.top + window.rows && r + rows > window.top && c < window.left + window.cols && c + cols > window.left
  );
}

function cellKeyInsideWindow(window: CpSatNeighborhoodWindow, key: string): boolean {
  const [rRaw, cRaw] = key.split(",");
  const r = Number(rRaw);
  const c = Number(cRaw);
  return (
    Number.isInteger(r) &&
    Number.isInteger(c) &&
    r >= window.top &&
    r < window.top + window.rows &&
    c >= window.left &&
    c < window.left + window.cols
  );
}

function placementFootprintKeys(placement: { r: number; c: number; rows: number; cols: number }): string[] {
  return residentialFootprint(placement.r, placement.c, placement.rows, placement.cols);
}

function incumbentBuildingFootprintKeys(incumbent: Solution): Set<string> {
  const occupied = new Set<string>();
  for (const service of incumbent.services) {
    for (const key of serviceFootprint(normalizeServicePlacement(service))) occupied.add(key);
  }
  for (const residential of incumbent.residentials) {
    for (const key of residentialFootprint(residential.r, residential.c, residential.rows, residential.cols)) {
      occupied.add(key);
    }
  }
  return occupied;
}

function clearWindowFootprintKeys(
  occupied: Set<string>,
  window: CpSatNeighborhoodWindow
): { occupied: Set<string>; clearedBuildingFootprintCells: number } {
  const next = new Set(occupied);
  let clearedBuildingFootprintCells = 0;
  for (const key of occupied) {
    if (!cellKeyInsideWindow(window, key)) continue;
    next.delete(key);
    clearedBuildingFootprintCells += 1;
  }
  return {
    occupied: next,
    clearedBuildingFootprintCells
  };
}

function isAllowedEmptyCell(G: Grid, occupied: Set<string>, r: number, c: number): boolean {
  return isAllowed(G, r, c) && !occupied.has(cellKey(r, c));
}

function countAllowedWindowCells(G: Grid, occupied: Set<string>, window: CpSatNeighborhoodWindow): number {
  let count = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (isAllowedEmptyCell(G, occupied, r, c)) count += 1;
    }
  }
  return count;
}

function countNarrowGateCells(G: Grid, occupied: Set<string>, window: CpSatNeighborhoodWindow): number {
  let count = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (!isAllowedEmptyCell(G, occupied, r, c)) continue;
      const degree = orthogonalNeighbors(G, r, c).filter(([rr, cc]) => isAllowedEmptyCell(G, occupied, rr, cc)).length;
      if (degree > 0 && degree <= 2) count += 1;
    }
  }
  return count;
}

function summarizeEmptyGraph(G: Grid, occupied: Set<string>): EmptyGraphSummary {
  const H = height(G);
  const W = width(G);
  const emptyKeys = new Set<string>();
  const roots: string[] = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isAllowedEmptyCell(G, occupied, r, c)) continue;
      const key = cellKey(r, c);
      emptyKeys.add(key);
      if (r === 0 || c === 0) roots.push(key);
    }
  }

  const reachableKeys = new Set<string>();
  const queue = [...roots];
  for (const key of roots) reachableKeys.add(key);
  for (let index = 0; index < queue.length; index++) {
    const [rRaw, cRaw] = queue[index]!.split(",");
    const r = Number(rRaw);
    const c = Number(cRaw);
    for (const [rr, cc] of orthogonalNeighbors(G, r, c)) {
      const neighborKey = cellKey(rr, cc);
      if (!emptyKeys.has(neighborKey) || reachableKeys.has(neighborKey)) continue;
      reachableKeys.add(neighborKey);
      queue.push(neighborKey);
    }
  }

  const seen = new Set<string>();
  let componentCount = 0;
  for (const key of emptyKeys) {
    if (seen.has(key)) continue;
    componentCount += 1;
    seen.add(key);
    const componentQueue = [key];
    for (let index = 0; index < componentQueue.length; index++) {
      const [rRaw, cRaw] = componentQueue[index]!.split(",");
      const r = Number(rRaw);
      const c = Number(cRaw);
      for (const [rr, cc] of orthogonalNeighbors(G, r, c)) {
        const neighborKey = cellKey(rr, cc);
        if (!emptyKeys.has(neighborKey) || seen.has(neighborKey)) continue;
        seen.add(neighborKey);
        componentQueue.push(neighborKey);
      }
    }
  }

  return {
    emptyKeys,
    reachableKeys,
    reachableCount: reachableKeys.size,
    disconnectedCount: emptyKeys.size - reachableKeys.size,
    componentCount
  };
}

function countReachableWindowCells(window: CpSatNeighborhoodWindow, reachableKeys: Set<string>): number {
  let count = 0;
  for (const key of reachableKeys) {
    if (cellKeyInsideWindow(window, key)) count += 1;
  }
  return count;
}

function candidateFootprintIsBlocked(footprintKeys: readonly string[], occupied: Set<string>): boolean {
  return footprintKeys.some((key) => occupied.has(key));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function candidateLossValues(
  G: Grid,
  params: SolverParams,
  window: CpSatNeighborhoodWindow,
  occupied: Set<string>
): Pick<
  WindowRankerFeatureValues,
  | "serviceCandidatesIntersecting"
  | "residentialCandidatesIntersecting"
  | "serviceCandidatesBlocked"
  | "residentialCandidatesBlocked"
  | "serviceCandidateBonus"
  | "maxServiceCandidateBonus"
  | "residentialCandidateHeadroom"
> {
  let serviceCandidatesIntersecting = 0;
  let residentialCandidatesIntersecting = 0;
  let serviceCandidatesBlocked = 0;
  let residentialCandidatesBlocked = 0;
  let serviceCandidateBonus = 0;
  let maxServiceCandidateBonus = 0;
  let residentialCandidateHeadroom = 0;

  for (const candidate of enumerateServiceCandidates(G, params)) {
    if (!rectangleIntersectsWindow(window, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
    serviceCandidatesIntersecting += 1;
    serviceCandidateBonus += candidate.bonus;
    maxServiceCandidateBonus = Math.max(maxServiceCandidateBonus, candidate.bonus);
    if (candidateFootprintIsBlocked(placementFootprintKeys(candidate), occupied)) serviceCandidatesBlocked += 1;
  }

  const residentialCandidates = params.residentialTypes?.length
    ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes)
    : enumerateResidentialCandidates(G);
  for (const candidate of residentialCandidates) {
    if (!rectangleIntersectsWindow(window, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
    residentialCandidatesIntersecting += 1;
    const rawTypeIndex = (candidate as { typeIndex?: unknown }).typeIndex;
    const typeIndex = typeof rawTypeIndex === "number" ? rawTypeIndex : undefined;
    const { base, max } = getResidentialBaseMax(params, candidate.rows, candidate.cols, typeIndex);
    residentialCandidateHeadroom += finiteNonNegative(max - base);
    if (candidateFootprintIsBlocked(placementFootprintKeys(candidate), occupied)) residentialCandidatesBlocked += 1;
  }

  return {
    serviceCandidatesIntersecting,
    residentialCandidatesIntersecting,
    serviceCandidatesBlocked,
    residentialCandidatesBlocked,
    serviceCandidateBonus,
    maxServiceCandidateBonus,
    residentialCandidateHeadroom
  };
}

function buildFeatureValues(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  candidate: LnsAdaptiveNeighborhoodCandidate,
  selectedByBaseline: boolean
): WindowRankerFeatureValues {
  const { window } = candidate;
  let serviceCountInside = 0;
  let serviceBonusInside = 0;
  for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
    const service = normalizeServicePlacement(incumbent.services[serviceIndex]);
    if (!rectangleIntersectsWindow(window, service.r, service.c, service.rows, service.cols)) continue;
    serviceCountInside += 1;
    serviceBonusInside += incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
  }

  let residentialCountInside = 0;
  let residentialHeadroomInside = 0;
  for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
    const residential = incumbent.residentials[residentialIndex];
    if (!rectangleIntersectsWindow(window, residential.r, residential.c, residential.rows, residential.cols)) continue;
    residentialCountInside += 1;
    const typeIndex = incumbent.residentialTypeIndices[residentialIndex];
    const { max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    residentialHeadroomInside += finiteNonNegative(max - (incumbent.populations[residentialIndex] ?? 0));
  }

  const occupied = incumbentBuildingFootprintKeys(incumbent);
  const beforeGraph = summarizeEmptyGraph(G, occupied);
  const cleared = clearWindowFootprintKeys(occupied, window);
  const afterGraph = summarizeEmptyGraph(G, cleared.occupied);
  return {
    operatorScore: candidate.score / 100,
    selectedByBaseline: selectedByBaseline ? 1 : 0,
    area: (window.rows * window.cols) / 20,
    roadCountInside: [...incumbent.roads].filter((key) => cellKeyInsideWindow(window, key)).length / 10,
    serviceCountInside: serviceCountInside / 4,
    residentialCountInside: residentialCountInside / 4,
    residentialHeadroomInside: residentialHeadroomInside / 500,
    serviceBonusInside: serviceBonusInside / 500,
    reachableBefore: beforeGraph.reachableCount / 50,
    reachableAfter: afterGraph.reachableCount / 50,
    newlyReachable: Math.max(0, afterGraph.reachableCount - beforeGraph.reachableCount) / 50,
    disconnectedBefore: beforeGraph.disconnectedCount / 50,
    disconnectedAfter: afterGraph.disconnectedCount / 50,
    clearedFootprint: cleared.clearedBuildingFootprintCells / 20,
    emptyComponentsBefore: beforeGraph.componentCount / 10,
    emptyComponentsAfter: afterGraph.componentCount / 10,
    componentDelta: (afterGraph.componentCount - beforeGraph.componentCount) / 10,
    allowedWindowCells: countAllowedWindowCells(G, cleared.occupied, window) / 20,
    anchorReachableWindowCells: countReachableWindowCells(window, afterGraph.reachableKeys) / 20,
    narrowGateCells: countNarrowGateCells(G, cleared.occupied, window) / 10,
    ...normalizeCandidateLoss(candidateLossValues(G, params, window, occupied))
  };
}

function normalizeCandidateLoss(
  values: ReturnType<typeof candidateLossValues>
): Pick<
  WindowRankerFeatureValues,
  | "serviceCandidatesIntersecting"
  | "residentialCandidatesIntersecting"
  | "serviceCandidatesBlocked"
  | "residentialCandidatesBlocked"
  | "serviceCandidateBonus"
  | "maxServiceCandidateBonus"
  | "residentialCandidateHeadroom"
> {
  return {
    serviceCandidatesIntersecting: values.serviceCandidatesIntersecting / 20,
    residentialCandidatesIntersecting: values.residentialCandidatesIntersecting / 20,
    serviceCandidatesBlocked: values.serviceCandidatesBlocked / 20,
    residentialCandidatesBlocked: values.residentialCandidatesBlocked / 20,
    serviceCandidateBonus: values.serviceCandidateBonus / 500,
    maxServiceCandidateBonus: values.maxServiceCandidateBonus / 500,
    residentialCandidateHeadroom: values.residentialCandidateHeadroom / 500
  };
}

function scoreFeatureValues(values: WindowRankerFeatureValues, model: LnsWindowRankerRuntimeModel): number {
  let score = finiteNumberOrDefault(model.intercept, 0);
  for (const featureName of LNS_WINDOW_RANKER_FEATURE_NAMES) {
    score += finiteNumberOrDefault(model.weights[featureName], 0) * values[featureName];
  }
  for (const [interactionName, weight] of Object.entries(model.interactionWeights ?? {})) {
    score += finiteNumberOrDefault(weight, 0) * interactionFeatureValue(values, interactionName);
  }
  return score;
}

function interactionFeatureValue(values: WindowRankerFeatureValues, interactionName: string): number {
  const [left, right, extra] = interactionName.split("*");
  if (extra !== undefined || !isWindowRankerFeatureName(left) || !isWindowRankerFeatureName(right)) return 0;
  return values[left] * values[right];
}

function isWindowRankerFeatureName(value: string | undefined): value is LnsWindowRankerFeatureName {
  return value !== undefined && (LNS_WINDOW_RANKER_FEATURE_NAMES as readonly string[]).includes(value);
}

function roundedScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundedFeature(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function featureTelemetry(values: WindowRankerFeatureValues): LnsWindowRankerFeatureTelemetry {
  return Object.fromEntries(
    LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName) => [featureName, roundedFeature(values[featureName])])
  );
}

function featureDeltaTelemetry(
  selected: WindowRankerFeatureValues,
  baseline: WindowRankerFeatureValues
): LnsWindowRankerFeatureTelemetry {
  return Object.fromEntries(
    LNS_WINDOW_RANKER_FEATURE_NAMES.map((featureName) => [
      featureName,
      roundedFeature(selected[featureName] - baseline[featureName])
    ])
  );
}

function featureDeltaGatesPassed(
  selected: WindowRankerFeatureValues,
  baseline: WindowRankerFeatureValues,
  gates: readonly LnsWindowRankerFeatureDeltaGate[]
): boolean {
  return gates.every((gate) => {
    const delta = selected[gate.feature] - baseline[gate.feature];
    if (gate.minDelta !== undefined && delta < gate.minDelta) return false;
    return gate.maxDelta === undefined || delta <= gate.maxDelta;
  });
}

function buildDecisionStateTelemetry(incumbent: Solution): LnsWindowRankerDecisionStateTelemetry {
  const roadKeys = Array.from(incumbent.roads);
  return {
    schemaVersion: 1,
    source: "online-window-ranker-decision-state",
    incumbentPopulation: incumbent.totalPopulation,
    roadCount: roadKeys.length,
    serviceCount: incumbent.services.length,
    residentialCount: incumbent.residentials.length,
    seedHint: {
      sourceName: "lns-window-ranker-online-decision-state",
      roadKeys,
      solution: {
        roads: roadKeys,
        services: incumbent.services.map((service, index) => {
          const normalized = normalizeServicePlacement(service);
          return {
            r: normalized.r,
            c: normalized.c,
            rows: normalized.rows,
            cols: normalized.cols,
            range: normalized.range,
            typeIndex: incumbent.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
            bonus: incumbent.servicePopulationIncreases[index] ?? 0
          };
        }),
        residentials: incumbent.residentials.map((residential, index) => ({
          r: residential.r,
          c: residential.c,
          rows: residential.rows,
          cols: residential.cols,
          typeIndex: incumbent.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
          population: incumbent.populations[index] ?? 0
        })),
        populations: [...incumbent.populations],
        totalPopulation: incumbent.totalPopulation
      },
      totalPopulation: incumbent.totalPopulation,
      objectiveLowerBound: incumbent.totalPopulation
    }
  };
}

export function selectLnsWindowRankerCandidate(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  candidates: readonly LnsAdaptiveNeighborhoodCandidate[],
  baselineCandidate: LnsAdaptiveNeighborhoodCandidate,
  options: NormalizedLnsWindowRankerOptions
): LnsWindowRankerSelectionDecision {
  const scored = candidates
    .map<ScoredWindowRankerCandidate>((candidate, index) => {
      const features = buildFeatureValues(G, params, incumbent, candidate, sameCandidate(candidate, baselineCandidate));
      return {
        candidate,
        index,
        features,
        score: scoreFeatureValues(features, options.model)
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || right.candidate.score - left.candidate.score || left.index - right.index
    );
  const baselineFeatures = buildFeatureValues(G, params, incumbent, baselineCandidate, true);
  const baseline = scored.find((entry) => sameCandidate(entry.candidate, baselineCandidate)) ?? {
    candidate: baselineCandidate,
    index: 0,
    features: baselineFeatures,
    score: scoreFeatureValues(baselineFeatures, options.model)
  };
  const best = scored[0] ?? baseline;
  const scoreDelta = best.score - baseline.score;
  const selectedTransition = operatorTransition(baseline.candidate.operator, best.candidate.operator);
  const bestIsBaseline = sameCandidate(best.candidate, baselineCandidate);
  const transitionAllowed =
    bestIsBaseline || options.allowedTransitions === null || options.allowedTransitions.includes(selectedTransition);
  const featureGatePassed =
    bestIsBaseline || featureDeltaGatesPassed(best.features, baseline.features, options.featureDeltaGates);
  const fallbackReason =
    scoreDelta < options.minScoreDelta
      ? ("score-delta-below-threshold" as const)
      : transitionAllowed
        ? undefined
        : ("operator-transition-not-allowed" as const);
  const featureFallbackReason =
    fallbackReason === undefined && !featureGatePassed ? ("feature-delta-gate-not-met" as const) : fallbackReason;
  const selected = featureFallbackReason ? baseline : best;
  return {
    candidate: selected.candidate,
    telemetry: {
      source: "learned-window-ranker",
      ...(options.model.modelFingerprint ? { modelFingerprint: options.model.modelFingerprint } : {}),
      featureSchemaVersion:
        options.model.featureSchemaVersion === undefined
          ? LNS_WINDOW_RANKER_FEATURE_SCHEMA_VERSION
          : options.model.featureSchemaVersion,
      candidateCount: candidates.length,
      baselineScore: roundedScore(baseline.score),
      selectedScore: roundedScore(selected.score),
      scoreDelta: roundedScore(selected.score - baseline.score),
      baselineCandidateIndex: baseline.index,
      selectedCandidateIndex: selected.index,
      baselineOperator: baseline.candidate.operator,
      selectedOperator: selected.candidate.operator,
      baselineWindow: { ...baseline.candidate.window },
      selectedWindow: { ...selected.candidate.window },
      selectedByBaseline: sameCandidate(selected.candidate, baselineCandidate),
      baselineFeatures: featureTelemetry(baseline.features),
      selectedFeatures: featureTelemetry(selected.features),
      featureDeltas: featureDeltaTelemetry(selected.features, baseline.features),
      ...(options.captureDecisionState ? { decisionState: buildDecisionStateTelemetry(incumbent) } : {}),
      ...(featureFallbackReason ? { fallbackReason: featureFallbackReason } : {})
    }
  };
}
