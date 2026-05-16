import type { LnsBenchmarkCaseResult, LnsBenchmarkLayoutSnapshot } from "./lns.js";

export interface LnsWindowRankerOnlineFinalLayoutDelta {
  baselineFingerprint: string;
  variantFingerprint: string;
  sameFinalLayout: boolean;
  roadAddedCount: number;
  roadRemovedCount: number;
  roadDeltaCount: number;
  serviceAddedCount: number;
  serviceRemovedCount: number;
  serviceDeltaCount: number;
  residentialAddedCount: number;
  residentialRemovedCount: number;
  residentialDeltaCount: number;
  buildingDeltaCount: number;
  placementDeltaCount: number;
}

function countAdded(leftKeys: readonly string[], rightKeys: readonly string[]): number {
  const left = new Set(leftKeys);
  let added = 0;
  for (const key of rightKeys) {
    if (!left.has(key)) added += 1;
  }
  return added;
}

export function buildLnsWindowRankerOnlineFinalLayoutDelta(
  result: LnsBenchmarkCaseResult,
  baseline: LnsBenchmarkCaseResult
): LnsWindowRankerOnlineFinalLayoutDelta {
  const baselineLayout: LnsBenchmarkLayoutSnapshot = baseline.layout;
  const variantLayout: LnsBenchmarkLayoutSnapshot = result.layout;
  const roadAddedCount = countAdded(baselineLayout.roadKeys, variantLayout.roadKeys);
  const roadRemovedCount = countAdded(variantLayout.roadKeys, baselineLayout.roadKeys);
  const serviceAddedCount = countAdded(baselineLayout.serviceKeys, variantLayout.serviceKeys);
  const serviceRemovedCount = countAdded(variantLayout.serviceKeys, baselineLayout.serviceKeys);
  const residentialAddedCount = countAdded(baselineLayout.residentialKeys, variantLayout.residentialKeys);
  const residentialRemovedCount = countAdded(variantLayout.residentialKeys, baselineLayout.residentialKeys);
  const roadDeltaCount = roadAddedCount + roadRemovedCount;
  const serviceDeltaCount = serviceAddedCount + serviceRemovedCount;
  const residentialDeltaCount = residentialAddedCount + residentialRemovedCount;
  const buildingDeltaCount = serviceDeltaCount + residentialDeltaCount;
  return {
    baselineFingerprint: baselineLayout.fingerprint,
    variantFingerprint: variantLayout.fingerprint,
    sameFinalLayout: baselineLayout.fingerprint === variantLayout.fingerprint,
    roadAddedCount,
    roadRemovedCount,
    roadDeltaCount,
    serviceAddedCount,
    serviceRemovedCount,
    serviceDeltaCount,
    residentialAddedCount,
    residentialRemovedCount,
    residentialDeltaCount,
    buildingDeltaCount,
    placementDeltaCount: roadDeltaCount + buildingDeltaCount
  };
}
