/**
 * Feature-flagged LNS window scorer trained from the Phase 12 replay corpus.
 */

import {
  cellKey,
  getResidentialBaseMax,
  height,
  isAllowed,
  normalizeServicePlacement,
  width,
} from "../core/index.js";

import type {
  CpSatNeighborhoodWindow,
  Grid,
  Solution,
  SolverParams,
} from "../core/index.js";
import type { LnsNeighborhoodCandidate } from "./neighborhoods.js";

export const PHASE12_LNS_WINDOW_RANKER_VERSION = "lns-ranker-feature-enrichment-2026-05-17";
export const PHASE12_LNS_WINDOW_RANKER_FINGERPRINT =
  "12ba51f1f0a0c51b0e084caa5e524926aedcd66ccfc28c253e98e8daa618ff70";

export interface LearnedLnsWindowFeatureContext {
  candidateWindowCount: number;
  windowIndex: number;
  selectedByBaseline: boolean;
}

export interface LearnedLnsWindowFeatures {
  top: number;
  left: number;
  rows: number;
  cols: number;
  operatorWeakServiceRepair: number;
  operatorResidentialHeadroomRepair: number;
  operatorFrontierCongestionRepair: number;
  operatorGateChokeRepair: number;
  operatorServiceOverlapRepair: number;
  operatorRandomExploration: number;
  operatorSlidingWindow: number;
  operatorScore: number;
  operatorExploration: number;
  candidateWindowCount: number;
  candidateRankRatio: number;
  area: number;
  windowAreaRatio: number;
  touchesRoadAnchorBoundary: number;
  touchesTopBoundary: number;
  touchesLeftBoundary: number;
  minAnchorDistance: number;
  anchorBoundaryCellCount: number;
  anchorBoundaryCoverageRatio: number;
  allowedCellCountInside: number;
  blockedCellCountInside: number;
  roadCountInside: number;
  serviceCountInside: number;
  serviceFootprintCellsInside: number;
  residentialCountInside: number;
  residentialFootprintCellsInside: number;
  occupiedBuildingCellCountInside: number;
  emptyAllowedCellCountInside: number;
  roadDensityInside: number;
  buildingDensityInside: number;
  emptyAllowedRatioInside: number;
  residentialHeadroomInside: number;
  residentialHeadroomDensityInside: number;
  serviceBonusInside: number;
  serviceBonusDensityInside: number;
  selectedByBaseline: number;
  windowIndex: number;
  baselineRankScore: number;
  selectionSourceBaselineTopK: number;
  selectionSourceExplorationTail: number;
  aspectRatio: number;
  perimeter: number;
}

const PHASE12_ALL_CONTEXT_WEIGHTS: readonly number[] = Object.freeze([
  -0.017582078607822717,
  0.18576526382318542,
  0.12178721970186845,
  0,
  -0.00597277217844312,
  0.0006500055439777717,
  0.28988962717328204,
  -0.0023650013460484653,
  0,
  0,
  -0.20559362534505415,
  0.20413070866402014,
  0,
  0,
  -0.060801893425124126,
  0.12178721970186845,
  0.12178721970186863,
  0.024182864102126764,
  0.12178721970186845,
  -0.06010981877831807,
  0.11958649570121228,
  0.04235602646877471,
  0.01959561708621118,
  0.10767166959172679,
  0.06800697892102742,
  0.13897725067536765,
  0.5708060093978263,
  0.44787888435451867,
  0.3481847488698697,
  0.2076052504207139,
  0.40145209660826914,
  -0.35809730719942495,
  0.14210974885319738,
  0.36417135202984935,
  -0.32891602829341743,
  0.32683436322380527,
  0.2994678884257406,
  0.5650612276009863,
  0.5064513559550899,
  -0.00597277217844312,
  -0.06080189342512414,
  0.08655422829039323,
  0,
  0,
  0.12178721970186863,
  0.12178721970186845,
]);

const PHASE12_ALL_CONTEXT_RMS_SCALE: readonly number[] = Object.freeze([
  1.7194539072421902,
  1.9945578130415818,
  0.7223151185146152,
  1,
  0.3296902366978935,
  0.41702882811414954,
  0.5897678246195885,
  0.20851441405707477,
  1,
  1,
  0.8209220690651828,
  623259.602342761,
  1,
  1,
  0.8309821905228678,
  2.1669453555438456,
  0.06019292654288452,
  0.7661308776828738,
  0.7223151185146152,
  0.7071067811865476,
  1.4521348601882378,
  3.2201809292943935,
  0.2847259043004519,
  2.0903505010861947,
  0.5710402407201608,
  2.340568492816482,
  0.9088932591463857,
  2.0536288136729643,
  1.132523154576618,
  2.4182278815191345,
  3.5416773230871224,
  4.250319681071572,
  0.20851441405707472,
  0.3560824794847237,
  0.48433933070570706,
  140.74916016430265,
  14.514632865845208,
  83.24270434150345,
  8.17969277292043,
  0.3296902366978935,
  12.464732857843016,
  0.36063722009706706,
  1,
  1,
  0.2407717061715381,
  1.4446302370292303,
]);

function rectangleOverlapArea(
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): number {
  const rowStart = Math.max(window.top, r);
  const rowEnd = Math.min(window.top + window.rows, r + rows);
  const colStart = Math.max(window.left, c);
  const colEnd = Math.min(window.left + window.cols, c + cols);
  return Math.max(0, rowEnd - rowStart) * Math.max(0, colEnd - colStart);
}

function addRectangleOverlapCells(
  target: Set<string>,
  window: CpSatNeighborhoodWindow,
  r: number,
  c: number,
  rows: number,
  cols: number
): void {
  const rowStart = Math.max(window.top, r);
  const rowEnd = Math.min(window.top + window.rows, r + rows);
  const colStart = Math.max(window.left, c);
  const colEnd = Math.min(window.left + window.cols, c + cols);
  for (let rr = rowStart; rr < rowEnd; rr++) {
    for (let cc = colStart; cc < colEnd; cc++) {
      target.add(cellKey(rr, cc));
    }
  }
}

function boolFeature(value: boolean): number {
  return value ? 1 : 0;
}

export function buildLearnedLnsWindowFeatures(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  candidate: LnsNeighborhoodCandidate,
  context: LearnedLnsWindowFeatureContext
): LearnedLnsWindowFeatures {
  const window = candidate.window;
  let serviceCountInside = 0;
  let serviceFootprintCellsInside = 0;
  let serviceBonusInside = 0;
  const occupiedBuildingCells = new Set<string>();
  for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
    const service = normalizeServicePlacement(incumbent.services[serviceIndex]);
    const overlapArea = rectangleOverlapArea(window, service.r, service.c, service.rows, service.cols);
    if (overlapArea <= 0) continue;
    serviceCountInside += 1;
    serviceFootprintCellsInside += overlapArea;
    serviceBonusInside += incumbent.servicePopulationIncreases[serviceIndex] ?? 0;
    addRectangleOverlapCells(occupiedBuildingCells, window, service.r, service.c, service.rows, service.cols);
  }

  let residentialCountInside = 0;
  let residentialFootprintCellsInside = 0;
  let residentialHeadroomInside = 0;
  for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
    const residential = incumbent.residentials[residentialIndex];
    const overlapArea = rectangleOverlapArea(window, residential.r, residential.c, residential.rows, residential.cols);
    if (overlapArea <= 0) continue;
    residentialCountInside += 1;
    residentialFootprintCellsInside += overlapArea;
    const typeIndex = incumbent.residentialTypeIndices[residentialIndex];
    const { max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    residentialHeadroomInside += Math.max(0, max - (incumbent.populations[residentialIndex] ?? 0));
    addRectangleOverlapCells(occupiedBuildingCells, window, residential.r, residential.c, residential.rows, residential.cols);
  }

  let allowedCellCountInside = 0;
  let blockedCellCountInside = 0;
  let roadCountInside = 0;
  let emptyAllowedCellCountInside = 0;
  let anchorBoundaryCellCount = 0;
  for (let r = window.top; r < window.top + window.rows; r++) {
    for (let c = window.left; c < window.left + window.cols; c++) {
      if (r === 0 || c === 0) anchorBoundaryCellCount += 1;
      const key = cellKey(r, c);
      if (!isAllowed(G, r, c)) {
        blockedCellCountInside += 1;
        continue;
      }
      allowedCellCountInside += 1;
      const hasRoad = incumbent.roads.has(key);
      if (hasRoad) roadCountInside += 1;
      if (!hasRoad && !occupiedBuildingCells.has(key)) emptyAllowedCellCountInside += 1;
    }
  }

  const area = window.rows * window.cols;
  const gridArea = Math.max(1, height(G) * width(G));
  const buildingCellCount = occupiedBuildingCells.size;
  const candidateRankRatio = context.candidateWindowCount <= 1
    ? 0
    : context.windowIndex / (context.candidateWindowCount - 1);
  return {
    top: window.top,
    left: window.left,
    rows: window.rows,
    cols: window.cols,
    operatorWeakServiceRepair: boolFeature(candidate.operatorName === "weak-service-repair"),
    operatorResidentialHeadroomRepair: boolFeature(candidate.operatorName === "residential-headroom-repair"),
    operatorFrontierCongestionRepair: boolFeature(candidate.operatorName === "frontier-congestion-repair"),
    operatorGateChokeRepair: boolFeature(candidate.operatorName === "gate-choke-repair"),
    operatorServiceOverlapRepair: boolFeature(candidate.operatorName === "service-overlap-repair"),
    operatorRandomExploration: boolFeature(candidate.operatorName === "random-exploration"),
    operatorSlidingWindow: boolFeature(candidate.operatorName === "sliding-window"),
    operatorScore: candidate.score,
    operatorExploration: boolFeature(candidate.exploration),
    candidateWindowCount: context.candidateWindowCount,
    candidateRankRatio,
    area,
    windowAreaRatio: area / gridArea,
    touchesRoadAnchorBoundary: boolFeature(window.top === 0 || window.left === 0),
    touchesTopBoundary: boolFeature(window.top === 0),
    touchesLeftBoundary: boolFeature(window.left === 0),
    minAnchorDistance: Math.min(window.top, window.left),
    anchorBoundaryCellCount,
    anchorBoundaryCoverageRatio: anchorBoundaryCellCount / Math.max(1, area),
    allowedCellCountInside,
    blockedCellCountInside,
    roadCountInside,
    serviceCountInside,
    serviceFootprintCellsInside,
    residentialCountInside,
    residentialFootprintCellsInside,
    occupiedBuildingCellCountInside: buildingCellCount,
    emptyAllowedCellCountInside,
    roadDensityInside: roadCountInside / Math.max(1, allowedCellCountInside),
    buildingDensityInside: buildingCellCount / Math.max(1, allowedCellCountInside),
    emptyAllowedRatioInside: emptyAllowedCellCountInside / Math.max(1, allowedCellCountInside),
    residentialHeadroomInside,
    residentialHeadroomDensityInside: residentialHeadroomInside / Math.max(1, area),
    serviceBonusInside,
    serviceBonusDensityInside: serviceBonusInside / Math.max(1, area),
    selectedByBaseline: boolFeature(context.selectedByBaseline),
    windowIndex: context.windowIndex,
    baselineRankScore: 1 / (1 + context.windowIndex),
    selectionSourceBaselineTopK: 1,
    selectionSourceExplorationTail: 0,
    aspectRatio: window.rows / Math.max(1, window.cols),
    perimeter: 2 * (window.rows + window.cols),
  };
}

export function learnedLnsWindowFeatureVector(features: LearnedLnsWindowFeatures): number[] {
  return [
    features.top,
    features.left,
    features.rows,
    features.cols,
    features.operatorWeakServiceRepair,
    features.operatorResidentialHeadroomRepair,
    features.operatorFrontierCongestionRepair,
    features.operatorGateChokeRepair,
    features.operatorServiceOverlapRepair,
    features.operatorRandomExploration,
    features.operatorSlidingWindow,
    features.operatorScore,
    features.operatorExploration,
    features.candidateWindowCount,
    features.candidateRankRatio,
    features.area,
    features.windowAreaRatio,
    features.touchesRoadAnchorBoundary,
    features.touchesTopBoundary,
    features.touchesLeftBoundary,
    features.minAnchorDistance,
    features.anchorBoundaryCellCount,
    features.anchorBoundaryCoverageRatio,
    features.allowedCellCountInside,
    features.blockedCellCountInside,
    features.roadCountInside,
    features.serviceCountInside,
    features.serviceFootprintCellsInside,
    features.residentialCountInside,
    features.residentialFootprintCellsInside,
    features.occupiedBuildingCellCountInside,
    features.emptyAllowedCellCountInside,
    features.roadDensityInside,
    features.buildingDensityInside,
    features.emptyAllowedRatioInside,
    features.residentialHeadroomInside,
    features.residentialHeadroomDensityInside,
    features.serviceBonusInside,
    features.serviceBonusDensityInside,
    features.selectedByBaseline,
    features.windowIndex,
    features.baselineRankScore,
    features.selectionSourceBaselineTopK,
    features.selectionSourceExplorationTail,
    features.aspectRatio,
    features.perimeter,
  ];
}

export function scoreLearnedLnsWindowCandidate(features: LearnedLnsWindowFeatures): number {
  const values = learnedLnsWindowFeatureVector(features);
  let score = 0;
  for (let index = 0; index < values.length; index++) {
    score += PHASE12_ALL_CONTEXT_WEIGHTS[index]! * (values[index]! / PHASE12_ALL_CONTEXT_RMS_SCALE[index]!);
  }
  return score;
}
