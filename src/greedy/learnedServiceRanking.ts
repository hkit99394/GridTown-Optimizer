import type { ServiceCandidate } from "../core/types.js";
import type { BuildingConnectivityShadow } from "../core/roads.js";

export const PHASE9_GREEDY_SERVICE_RANKER_VERSION = "phase9-greedy-offline-ranker-2026-05-17";
export const PHASE9_GREEDY_SERVICE_RANKER_FINGERPRINT =
  "e11544d1f3001db6c25ad15cfd87315147402e01b3fdaba4e1926b2dbf618d88";

const PHASE9_GREEDY_MODEL_WEIGHTS = [
  -0.791497465929, -0.22682423147, 0.0118528798529, 0.0198027061999, 0.0658051444099, -0.7295274146, 5.71274758969, -2.30514845308,
  0, 0.248877933627, 0.248877933627, -0.248877933627, 0.144667019919, -0.288365271541, 0.0631961460262, 0.0631961460262,
  0.183762394067, 0.0232776176187, 0.0599282616251, -0.0107080642943, -0.287023208443, 0.172675335904, -0.3295177294, -0.125364949153,
  0.920075094936, 0, -2.30514845308, 0, 0, 0, 0, 0,
  0, 0, 0, -0.125364949153, -0.125364949153, 0, -0.966076333877, -0.102760586782,
  -0.0514392141996, 0.150740440556, 0.144667019919, -1.42677227293, 5.71274758969, 0, 0, 0.248877933627,
  0.248877933627, -0.248877933627, 0.144667019919, -0.288365271541, 0.0631961460262, 0.0631961460262, 0.242185445795, 0.0471182813268,
  0.0599282616251, -0.0107080642943, -0.287023208443, 0.172675335904, -0.3295177294, -0.125364949153, 0.920075094936, 0,
  -2.30514845308, 0, 0, 0, 0, 0, 0, 0,
  0, -0.125364949153, -0.125364949153, 0, -0.966076333877, -0.102760586782, -0.0514392141996, 0.150740440556,
  0.144667019919, -1.42677227293, 5.71274758969, 0, 0, 0.248877933627, 0.248877933627, -0.248877933627,
  0.144667019919, -0.288365271541, 0.0631961460262, 0.0631961460262, 0.242185445795, 0.0471182813268, 0.0599282616251,
] as const;

const PHASE9_GREEDY_MODEL_RMS = [
  1.39449641562, 1.75564189999, 0.548300019508, 0.521681798354, 0.738841035643, 2.16561155744, 64.852559166, 3.62661261054,
  1, 2.17799698946, 2.17799698946, 2.17799698946, 0.646313792973, 2.20399522157, 0.594167398997, 0.594167398997,
  0.344486409131, 12.9873356034, 0.194870940738, 0.812286973047, 0.83438751887, 0.190767935103, 0.190767935103, 0.358000777879,
  1.13906468404, 1, 3.62661261054, 1, 1, 1, 1, 1,
  1, 1, 1, 0.119333592626, 2.38667185253, 1, 1.13349465221, 1.54469283334,
  0.514043292271, 0.48555071174, 0.646313792973, 1.84184827369, 64.852559166, 1, 1, 2.17799698946,
  2.17799698946, 2.17799698946, 0.646313792973, 2.20399522157, 0.594167398997, 0.594167398997, 0.323156896487, 12.7661538274,
  0.194870940738, 0.812286973047, 0.83438751887, 0.190767935103, 0.190767935103, 0.358000777879, 1.13906468404, 1,
  3.62661261054, 1, 1, 1, 1, 1, 1, 1,
  1, 0.119333592626, 2.38667185253, 1, 1.13349465221, 1.54469283334, 0.514043292271, 0.48555071174,
  0.646313792973, 1.84184827369, 64.852559166, 1, 1, 2.17799698946, 2.17799698946, 2.17799698946,
  0.646313792973, 2.20399522157, 0.594167398997, 0.594167398997, 0.323156896487, 12.7661538274, 0.194870940738,
] as const;

export interface LearnedServiceRankingFeatures {
  service: ServiceCandidate;
  score: number;
  roadCost: number;
  shadow?: BuildingConnectivityShadow;
}

function safeRms(index: number): number {
  return PHASE9_GREEDY_MODEL_RMS[index] || 1;
}

function area(service: ServiceCandidate): number {
  return service.rows * service.cols;
}

function shadowPenalty(shadow: BuildingConnectivityShadow | undefined): number {
  return shadow === undefined ? 0 : shadow.disconnectedCells + 0.125 * shadow.footprintCells;
}

function baseFeatureValues(features: LearnedServiceRankingFeatures): number[] {
  const { service, score, roadCost, shadow } = features;
  return [
    service.r,
    service.c,
    service.rows,
    service.cols,
    area(service),
    roadCost,
    score,
    shadowPenalty(shadow),
    shadow?.reachableBefore ?? 0,
    shadow?.reachableAfter ?? 0,
    shadow === undefined ? 0 : shadow.reachableAfter - shadow.reachableBefore,
    shadow?.lostCells ?? 0,
    shadow?.footprintCells ?? 0,
    shadow?.disconnectedCells ?? 0,
    shadow === undefined ? 0 : shadow.lostCells / Math.max(1, shadow.footprintCells),
    shadow === undefined ? 0 : shadow.disconnectedCells / Math.max(1, shadow.footprintCells),
    service.typeIndex,
    service.bonus,
    service.range,
  ];
}

export function scoreLearnedServiceCandidate(features: LearnedServiceRankingFeatures): number {
  const values = baseFeatureValues(features);
  let score = 0;
  // The online service hook is closest to the Phase 9 road-opportunity/accepted-near-miss labels.
  for (const contextOffset of [0, 38, 76]) {
    for (let index = 0; index < values.length; index += 1) {
      const modelIndex = contextOffset + index;
      score += (values[index] / safeRms(modelIndex)) * PHASE9_GREEDY_MODEL_WEIGHTS[modelIndex];
    }
  }
  return score;
}
