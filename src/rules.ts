/**
 * Shared problem rules used by both solvers and validators.
 */

import type { SolverParams } from "./types.js";

export const NO_TYPE_INDEX = -1;

export function normalizeSize(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

export function getBuildingLimits(params: SolverParams): {
  maxServices: number | undefined;
  maxResidentials: number | undefined;
} {
  return {
    maxServices: params.availableBuildings?.services ?? params.maxServices,
    maxResidentials: params.availableBuildings?.residentials ?? params.maxResidentials,
  };
}

/** Get base (min) and max population for a residential of size (rows × cols) */
export function getResidentialBaseMax(
  params: SolverParams,
  rows: number,
  cols: number,
  typeIndex: number = NO_TYPE_INDEX
): { base: number; max: number } {
  const types = params.residentialTypes;
  if (types?.length && typeIndex >= 0 && typeIndex < types.length) {
    const type = types[typeIndex];
    return { base: type.min, max: type.max };
  }
  if (types?.length) {
    const [r, c] = normalizeSize(rows, cols);
    const matched = types.find((type) => {
      const [tw, th] = normalizeSize(type.w, type.h);
      return tw === r && th === c;
    });
    if (matched) return { base: matched.min, max: matched.max };
  }
  const key = `${rows}x${cols}`;
  const sizeSetting = params.residentialSettings?.[key];
  if (sizeSetting) return { base: sizeSetting.min, max: sizeSetting.max };
  return { base: params.basePop ?? 0, max: params.maxPop ?? Infinity };
}

export function compatibleResidentialTypeIndices(params: SolverParams, rows: number, cols: number): number[] {
  const types = params.residentialTypes ?? [];
  const [r, c] = normalizeSize(rows, cols);
  const out: number[] = [];
  for (let i = 0; i < types.length; i++) {
    const [tw, th] = normalizeSize(types[i].w, types[i].h);
    if (tw === r && th === c) out.push(i);
  }
  return out;
}
