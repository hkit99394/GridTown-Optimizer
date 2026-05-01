import { buildServiceEffectZoneSet, normalizeServicePlacement, residentialFootprint } from "./buildings.js";
import { compatibleResidentialTypeIndices, getResidentialBaseMax, NO_TYPE_INDEX } from "./rules.js";

import type { Grid, ServiceTypeSetting, Solution, SolverParams } from "./types.js";

function serviceTypeSupportsPlacement(
  type: ServiceTypeSetting,
  placement: ReturnType<typeof normalizeServicePlacement>
): boolean {
  return (
    (placement.rows === type.rows && placement.cols === type.cols)
    || ((type.allowRotation ?? true) && placement.rows === type.cols && placement.cols === type.rows)
  );
}

function countServiceTypeUsage(solution: Solution, typeCount: number): number[] {
  const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
  for (const typeIndex of solution.serviceTypeIndices) {
    if (typeIndex >= 0 && typeIndex < counts.length) {
      counts[typeIndex] += 1;
    }
  }
  return counts;
}

function countResidentialTypeUsage(solution: Solution, typeCount: number): number[] {
  const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
  for (const typeIndex of solution.residentialTypeIndices) {
    if (typeIndex >= 0 && typeIndex < counts.length) {
      counts[typeIndex] += 1;
    }
  }
  return counts;
}

function computeResidentialBoostsForSolution(G: Grid, solution: Solution): number[] {
  const effectZones = solution.services.map((service) => buildServiceEffectZoneSet(G, service));
  return solution.residentials.map((residential) => {
    const footprint = residentialFootprint(residential.r, residential.c, residential.rows, residential.cols);
    let boost = 0;
    for (let serviceIndex = 0; serviceIndex < effectZones.length; serviceIndex++) {
      if (footprint.some((cell) => effectZones[serviceIndex].has(cell))) {
        boost += solution.servicePopulationIncreases[serviceIndex] ?? 0;
      }
    }
    return boost;
  });
}

function recomputeSolutionPopulationTotals(G: Grid, params: SolverParams, solution: Solution): Solution {
  const boosts = computeResidentialBoostsForSolution(G, solution);
  const populations = solution.residentials.map((residential, index) => {
    const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
    const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    return Math.min(Math.max(base + boosts[index], base), max);
  });
  return {
    ...solution,
    populations,
    totalPopulation: populations.reduce((sum, population) => sum + population, 0),
  };
}

function applyDeterministicServiceUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  const serviceTypes = params.serviceTypes ?? [];
  if (!serviceTypes.length || solution.services.length === 0) return solution;

  let incumbent = solution;
  let improved = true;

  while (improved) {
    improved = false;
    const usage = countServiceTypeUsage(incumbent, serviceTypes.length);
    let bestCandidate: Solution | null = null;
    let bestPopulation = incumbent.totalPopulation;

    for (let serviceIndex = 0; serviceIndex < incumbent.services.length; serviceIndex++) {
      const placement = normalizeServicePlacement(incumbent.services[serviceIndex]);
      const currentTypeIndex = incumbent.serviceTypeIndices[serviceIndex] ?? NO_TYPE_INDEX;
      const currentBonus = incumbent.servicePopulationIncreases[serviceIndex] ?? 0;

      for (let candidateTypeIndex = 0; candidateTypeIndex < serviceTypes.length; candidateTypeIndex++) {
        if (candidateTypeIndex === currentTypeIndex) continue;
        const serviceType = serviceTypes[candidateTypeIndex];
        if (serviceType.avail <= 0) continue;
        if (!serviceTypeSupportsPlacement(serviceType, placement)) continue;
        if ((usage[candidateTypeIndex] ?? 0) >= serviceType.avail) continue;

        // Skip obviously weaker replacements at the same footprint.
        if (serviceType.bonus <= currentBonus && serviceType.range <= placement.range) continue;

        const nextServices = incumbent.services.map((service, index) =>
          index === serviceIndex ? { ...placement, range: serviceType.range } : { ...service }
        );
        const nextServiceTypeIndices = [...incumbent.serviceTypeIndices];
        nextServiceTypeIndices[serviceIndex] = candidateTypeIndex;
        const nextServiceBonuses = [...incumbent.servicePopulationIncreases];
        nextServiceBonuses[serviceIndex] = serviceType.bonus;
        const candidateSolution = recomputeSolutionPopulationTotals(G, params, {
          ...incumbent,
          services: nextServices,
          serviceTypeIndices: nextServiceTypeIndices,
          servicePopulationIncreases: nextServiceBonuses,
        });
        if (candidateSolution.totalPopulation <= bestPopulation) continue;

        bestPopulation = candidateSolution.totalPopulation;
        bestCandidate = candidateSolution;
      }
    }

    if (bestCandidate) {
      incumbent = bestCandidate;
      improved = true;
    }
  }

  return incumbent;
}

function applyDeterministicResidentialUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  const residentialTypes = params.residentialTypes ?? [];
  if (!residentialTypes.length || solution.residentials.length === 0) return solution;

  let incumbent = solution;
  let improved = true;

  while (improved) {
    improved = false;
    const usage = countResidentialTypeUsage(incumbent, residentialTypes.length);
    let bestCandidate: Solution | null = null;
    let bestPopulation = incumbent.totalPopulation;

    for (let residentialIndex = 0; residentialIndex < incumbent.residentials.length; residentialIndex++) {
      const placement = incumbent.residentials[residentialIndex];
      const currentTypeIndex = incumbent.residentialTypeIndices[residentialIndex] ?? NO_TYPE_INDEX;
      if (currentTypeIndex < 0 || currentTypeIndex >= residentialTypes.length) continue;
      const currentType = residentialTypes[currentTypeIndex];
      const compatibleTypeIndices = compatibleResidentialTypeIndices(params, placement.rows, placement.cols);

      for (const candidateTypeIndex of compatibleTypeIndices) {
        if (candidateTypeIndex === currentTypeIndex) continue;
        const candidateType = residentialTypes[candidateTypeIndex];
        if ((usage[candidateTypeIndex] ?? 0) >= candidateType.avail) continue;

        // Skip obviously weaker replacements for the same footprint.
        if (candidateType.min <= currentType.min && candidateType.max <= currentType.max) continue;

        const nextResidentialTypeIndices = [...incumbent.residentialTypeIndices];
        nextResidentialTypeIndices[residentialIndex] = candidateTypeIndex;
        const candidateSolution = recomputeSolutionPopulationTotals(G, params, {
          ...incumbent,
          residentialTypeIndices: nextResidentialTypeIndices,
        });

        if (candidateSolution.totalPopulation <= bestPopulation) continue;
        bestPopulation = candidateSolution.totalPopulation;
        bestCandidate = candidateSolution;
      }
    }

    if (bestCandidate) {
      incumbent = bestCandidate;
      improved = true;
    }
  }

  return incumbent;
}

export function applyDeterministicDominanceUpgrades(G: Grid, params: SolverParams, solution: Solution): Solution {
  let incumbent = recomputeSolutionPopulationTotals(G, params, solution);

  while (true) {
    const afterServiceUpgrades = applyDeterministicServiceUpgrades(G, params, incumbent);
    const afterResidentialUpgrades = applyDeterministicResidentialUpgrades(G, params, afterServiceUpgrades);
    if (afterResidentialUpgrades.totalPopulation <= incumbent.totalPopulation) {
      return incumbent;
    }
    incumbent = afterResidentialUpgrades;
  }
}
