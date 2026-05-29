import { getBuildingLimits } from "./rules.js";

import type { ResidentialSettings, ResidentialTypeSetting, SolverParams } from "./types.js";

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sortedTypedResidentialMaxima(types: readonly ResidentialTypeSetting[]): number[] | null {
  const maxima: number[] = [];
  for (const type of types) {
    const avail = finiteNonNegativeInteger(type.avail);
    const max = finiteNonNegativeNumber(type.max);
    if (avail === null || max === null) return null;
    for (let count = 0; count < avail; count++) maxima.push(max);
  }
  return maxima.sort((left, right) => right - left);
}

function legacyResidentialSlotMax(params: SolverParams): number | null {
  const settings = params.residentialSettings;
  const maxima = finiteResidentialSettingMaxima(settings);
  const fallbackMax = finiteNonNegativeNumber(params.maxPop);
  if (fallbackMax !== null) maxima.push(fallbackMax);
  return maxima.length ? Math.max(...maxima) : null;
}

function finiteResidentialSettingMaxima(settings: ResidentialSettings | undefined): number[] {
  return Object.values(settings ?? {})
    .map((setting) => finiteNonNegativeNumber(setting?.max))
    .filter((max): max is number => max !== null);
}

function sumTop(values: readonly number[], limit: number | null): number {
  const selected = limit === null ? values : values.slice(0, limit);
  return selected.reduce((sum, value) => sum + value, 0);
}

/**
 * Cheap optimistic population capacity bound from configured residential capacity.
 *
 * This ignores geometry, road access, service reach, and boost feasibility.
 * It is safe as a runtime terminal hint only after a feasible validated
 * incumbent reaches it, because no higher configured residential population
 * remains available. CP-SAT proof bounds remain separate telemetry.
 */
export function computePopulationCapacityUpperBound(params: SolverParams): number | null {
  const maxResidentials = finiteNonNegativeInteger(getBuildingLimits(params).maxResidentials);
  if (maxResidentials === 0) return 0;

  const residentialTypes = params.residentialTypes ?? [];
  if (residentialTypes.length > 0) {
    const typedMaxima = sortedTypedResidentialMaxima(residentialTypes);
    if (typedMaxima === null) return null;
    return sumTop(typedMaxima, maxResidentials);
  }

  if (maxResidentials === null) return null;
  const slotMax = legacyResidentialSlotMax(params);
  return slotMax === null ? null : slotMax * maxResidentials;
}

export function reachesPopulationCapacityUpperBound(
  params: SolverParams,
  totalPopulation: number | null | undefined
): boolean {
  if (typeof totalPopulation !== "number" || !Number.isFinite(totalPopulation)) return false;
  const capacityUpperBound = computePopulationCapacityUpperBound(params);
  return capacityUpperBound !== null && totalPopulation >= capacityUpperBound;
}
