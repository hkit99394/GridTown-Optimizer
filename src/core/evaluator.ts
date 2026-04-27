/**
 * Strict layout evaluator: validates constraints and computes exact population.
 */

import type {
  LayoutEvaluationInput,
  LayoutEvaluationResult,
  EvaluatedResidentialResult,
  Solution,
  SolutionValidationInput,
  SolutionValidationResult,
  SolverParams,
  EvaluatedServicePlacement,
} from "./types.js";
import { cellFromKey } from "./types.js";
import { isAllowed } from "./grid.js";
import {
  serviceFootprint,
  residentialFootprint,
  buildServiceEffectZoneSet,
  normalizeServicePlacement,
} from "./buildings.js";
import { isAdjacentToRoads, roadsConnectedToRow0 } from "./roads.js";
import {
  compatibleResidentialTypeIndices,
  getBuildingLimits,
  getResidentialBaseMax,
  NO_TYPE_INDEX,
  normalizeSize,
} from "./rules.js";

export interface SolutionValidationOptions {
  ignoreReportedPopulation?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function compareCellKeys(a: string, b: string): number {
  const cellA = cellFromKey(a);
  const cellB = cellFromKey(b);
  return cellA.r - cellB.r || cellA.c - cellB.c;
}

function formatCellKey(key: string): string {
  const { r, c } = cellFromKey(key);
  return `(${r},${c})`;
}

function summarizeCellKeys(keys: string[], limit = 12): string {
  const sorted = [...keys].sort(compareCellKeys);
  const shown = sorted.slice(0, limit).map(formatCellKey).join(", ");
  const hiddenCount = sorted.length - limit;
  return hiddenCount > 0 ? `${shown}, and ${hiddenCount} more` : shown;
}

function computeResidentialBoosts(
  grid: number[][],
  services: EvaluatedServicePlacement[],
  residentials: { r: number; c: number; rows: number; cols: number }[]
): number[] {
  const effectZones = services.map((s) => buildServiceEffectZoneSet(grid, s));
  return residentials.map((res) => {
    let boost = 0;
    const foot = residentialFootprint(res.r, res.c, res.rows, res.cols);
    for (let i = 0; i < services.length; i++) {
      if (foot.some((k) => effectZones[i].has(k))) boost += services[i].bonus;
    }
    return boost;
  });
}

type GroupAssignment = { ok: boolean; assignedPop: number[] };

/**
 * Exact assignment for one size-group of residentials:
 * choose a type (with remaining avail) per building to maximize total population.
 */
function assignGroupExact(
  boosts: number[],
  typeIndices: number[],
  params: SolverParams
): GroupAssignment {
  const types = params.residentialTypes ?? [];
  const m = typeIndices.length;
  const n = boosts.length;
  const caps = typeIndices.map((ti) => Math.max(0, types[ti].avail));
  const totalCap = caps.reduce((a, b) => a + b, 0);
  if (n > totalCap) return { ok: false, assignedPop: [] };

  const rewards: number[][] = Array.from({ length: n }, (_, i) =>
    typeIndices.map((ti) => {
      const t = types[ti];
      return clamp(t.min + boosts[i], t.min, t.max);
    })
  );

  const memo = new Map<string, number>();
  const choice = new Map<string, number>();
  const negInf = -1e15;

  function key(i: number, rem: number[]): string {
    return `${i}|${rem.join(",")}`;
  }

  function dfs(i: number, rem: number[]): number {
    if (i === n) return 0;
    const k = key(i, rem);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;
    let best = negInf;
    let bestT = -1;
    for (let t = 0; t < m; t++) {
      if (rem[t] <= 0) continue;
      rem[t]--;
      const v = rewards[i][t] + dfs(i + 1, rem);
      rem[t]++;
      if (v > best) {
        best = v;
        bestT = t;
      }
    }
    memo.set(k, best);
    choice.set(k, bestT);
    return best;
  }

  const rem0 = [...caps];
  const bestTotal = dfs(0, rem0);
  if (bestTotal <= negInf / 2) return { ok: false, assignedPop: [] };

  const assignedPop: number[] = [];
  let i = 0;
  let rem = [...caps];
  while (i < n) {
    const k = key(i, rem);
    const t = choice.get(k);
    if (t === undefined || t < 0 || rem[t] <= 0) return { ok: false, assignedPop: [] };
    assignedPop.push(rewards[i][t]);
    rem[t]--;
    i++;
  }
  return { ok: true, assignedPop };
}

export function evaluateLayout(input: LayoutEvaluationInput): LayoutEvaluationResult {
  const { grid, roads, services, residentials, params } = input;
  const errors: string[] = [];
  const { maxServices, maxResidentials } = getBuildingLimits(params);

  const buildingCells = new Set<string>();

  if (maxServices !== undefined && services.length > maxServices) {
    errors.push(`Layout uses ${services.length} services, exceeding the limit of ${maxServices}.`);
  }
  if (maxResidentials !== undefined && residentials.length > maxResidentials) {
    errors.push(`Layout uses ${residentials.length} residentials, exceeding the limit of ${maxResidentials}.`);
  }

  // Validate services.
  for (const s of services) {
    for (const k of serviceFootprint(s)) {
      const [r, c] = k.split(",").map(Number);
      if (!isAllowed(grid, r, c)) {
        errors.push(`Service at (${s.r},${s.c}) uses non-allowed cell (${r},${c}).`);
      }
      if (buildingCells.has(k)) {
        errors.push(`Service at (${s.r},${s.c}) overlaps another building at (${r},${c}).`);
      }
      buildingCells.add(k);
    }
  }

  // Validate residentials.
  for (const res of residentials) {
    for (const k of residentialFootprint(res.r, res.c, res.rows, res.cols)) {
      const [r, c] = k.split(",").map(Number);
      if (!isAllowed(grid, r, c)) {
        errors.push(`Residential at (${res.r},${res.c}) uses non-allowed cell (${r},${c}).`);
      }
      if (buildingCells.has(k)) {
        errors.push(`Residential at (${res.r},${res.c}) overlaps another building at (${r},${c}).`);
      }
      buildingCells.add(k);
    }
  }

  // Road basic validation and no overlap with buildings.
  for (const k of roads) {
    const [r, c] = k.split(",").map(Number);
    if (!isAllowed(grid, r, c)) {
      errors.push(`Road cell (${r},${c}) is not allowed.`);
    }
    if (buildingCells.has(k)) {
      errors.push(`Road overlaps building at (${r},${c}).`);
    }
  }

  // Road connectivity to row 0.
  const connected = roadsConnectedToRow0(grid, roads);
  if (connected.size === 0) {
    errors.push("Road network does not touch row 0.");
  }
  if (connected.size !== roads.size) {
    const disconnectedRoads = [...roads].filter((key) => !connected.has(key));
    const disconnectedSummary = disconnectedRoads.length > 0
      ? ` Disconnected road cells: ${summarizeCellKeys(disconnectedRoads)}.`
      : "";
    errors.push(`Some road cells are not connected to any row-0-connected road component.${disconnectedSummary}`);
  }

  // Building-road adjacency.
  // Buildings that cover row 0 are treated as connected to the road anchor.
  for (const s of services) {
    const normalized = normalizeServicePlacement(s);
    if (!isAdjacentToRoads(roads, normalized.r, normalized.c, normalized.rows, normalized.cols)) {
      errors.push(`Service at (${s.r},${s.c}) is not adjacent to a road.`);
    }
  }
  for (const res of residentials) {
    if (!isAdjacentToRoads(roads, res.r, res.c, res.rows, res.cols)) {
      errors.push(`Residential at (${res.r},${res.c}) size ${res.rows}x${res.cols} is not adjacent to a road.`);
    }
  }

  // Population computation.
  const boosts = computeResidentialBoosts(grid, services, residentials);

  const populations = new Array<number>(residentials.length).fill(0);

  if ((params.residentialTypes?.length ?? 0) > 0) {
    // Group residentials by normalized size so type assignment is exact under avail limits.
    const groups = new Map<string, number[]>();
    for (let i = 0; i < residentials.length; i++) {
      const [a, b] = normalizeSize(residentials[i].rows, residentials[i].cols);
      const k = `${a}x${b}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(i);
    }
    for (const idxs of groups.values()) {
      const sample = residentials[idxs[0]];
      const tis = compatibleResidentialTypeIndices(params, sample.rows, sample.cols);
      if (tis.length === 0) {
        errors.push(`No residential type configured for size ${sample.rows}x${sample.cols}.`);
        continue;
      }
      const groupBoosts = idxs.map((i) => boosts[i]);
      const assigned = assignGroupExact(groupBoosts, tis, params);
      if (!assigned.ok) {
        errors.push(`Insufficient avail to assign all residentials of size ${sample.rows}x${sample.cols}.`);
        continue;
      }
      for (let j = 0; j < idxs.length; j++) populations[idxs[j]] = assigned.assignedPop[j];
    }
  } else {
    // Legacy per-size/base-max fallback.
    for (let i = 0; i < residentials.length; i++) {
      const res = residentials[i];
      const { base, max } = getResidentialBaseMax(params, res.rows, res.cols);
      populations[i] = clamp(base + boosts[i], base, max);
    }
  }

  const popRows: EvaluatedResidentialResult[] = residentials.map((res, i) => ({
    ...res,
    population: populations[i],
  }));
  const totalPopulation = popRows.reduce((acc, r) => acc + r.population, 0);

  return {
    valid: errors.length === 0,
    errors,
    populations: popRows,
    totalPopulation,
    boosts,
  };
}

function validateServiceTypeAssignments(solution: Solution, params: SolverParams, errors: string[]): void {
  const usingTypes = (params.serviceTypes?.length ?? 0) > 0;
  if (solution.serviceTypeIndices.length !== solution.services.length) {
    errors.push(`Solution reports ${solution.serviceTypeIndices.length} service type indices for ${solution.services.length} services.`);
    return;
  }

  if (!usingTypes) {
    for (let i = 0; i < solution.serviceTypeIndices.length; i++) {
      if (solution.serviceTypeIndices[i] !== NO_TYPE_INDEX) {
        errors.push(`Service ${i} reports type index ${solution.serviceTypeIndices[i]} but no service types were configured.`);
      }
    }
    return;
  }

  const types = params.serviceTypes ?? [];
  const counts = new Array<number>(types.length).fill(0);
  for (let i = 0; i < solution.services.length; i++) {
    const typeIndex = solution.serviceTypeIndices[i];
    const service = normalizeServicePlacement(solution.services[i]);
    if (typeIndex < 0 || typeIndex >= types.length) {
      errors.push(`Service ${i} has invalid type index ${typeIndex}.`);
      continue;
    }
    const type = types[typeIndex];
    const compatibleOrientation =
      (service.rows === type.rows && service.cols === type.cols) ||
      ((type.allowRotation ?? true) && service.rows === type.cols && service.cols === type.rows);
    if (!compatibleOrientation || service.range !== type.range || (solution.servicePopulationIncreases[i] ?? 0) !== type.bonus) {
      errors.push(
        `Service ${i} does not match configured service type ${typeIndex}.`
      );
      continue;
    }
    counts[typeIndex]++;
  }

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > types[i].avail) {
      errors.push(`Service type ${i} is used ${counts[i]} times, exceeding avail ${types[i].avail}.`);
    }
  }
}

function validateResidentialTypeAssignments(
  solution: Solution,
  params: SolverParams,
  errors: string[]
): void {
  const usingTypes = (params.residentialTypes?.length ?? 0) > 0;
  if (solution.residentialTypeIndices.length !== solution.residentials.length) {
    errors.push(
      `Solution reports ${solution.residentialTypeIndices.length} residential type indices for ${solution.residentials.length} residentials.`
    );
    return;
  }

  if (!usingTypes) {
    for (let i = 0; i < solution.residentialTypeIndices.length; i++) {
      if (solution.residentialTypeIndices[i] !== NO_TYPE_INDEX) {
        errors.push(`Residential ${i} reports type index ${solution.residentialTypeIndices[i]} but no residential types were configured.`);
      }
    }
    return;
  }

  const types = params.residentialTypes ?? [];
  const counts = new Array<number>(types.length).fill(0);
  for (let i = 0; i < solution.residentials.length; i++) {
    const typeIndex = solution.residentialTypeIndices[i];
    const residential = solution.residentials[i];
    if (typeIndex < 0 || typeIndex >= types.length) {
      errors.push(`Residential ${i} has invalid type index ${typeIndex}.`);
      continue;
    }
    const compatible = compatibleResidentialTypeIndices(params, residential.rows, residential.cols);
    if (!compatible.includes(typeIndex)) {
      errors.push(
        `Residential ${i} size ${residential.rows}x${residential.cols} is not compatible with type index ${typeIndex}.`
      );
      continue;
    }
    counts[typeIndex]++;
  }

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > types[i].avail) {
      errors.push(`Residential type ${i} is used ${counts[i]} times, exceeding avail ${types[i].avail}.`);
    }
  }
}

function recomputeSolutionPopulations(solution: Solution, params: SolverParams, boosts: number[]): number[] {
  return solution.residentials.map((residential, index) => {
    const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
    const { base, max } = getResidentialBaseMax(params, residential.rows, residential.cols, typeIndex);
    return clamp(base + boosts[index], base, max);
  });
}

export function validateSolution(
  input: SolutionValidationInput,
  options: SolutionValidationOptions = {}
): SolutionValidationResult {
  const { grid, solution, params } = input;
  const errors: string[] = [];

  if (solution.servicePopulationIncreases.length !== solution.services.length) {
    errors.push(
      `Solution reports ${solution.servicePopulationIncreases.length} service bonuses for ${solution.services.length} services.`
    );
  }
  if (!options.ignoreReportedPopulation && solution.populations.length !== solution.residentials.length) {
    errors.push(
      `Solution reports ${solution.populations.length} residential populations for ${solution.residentials.length} residentials.`
    );
  }

  validateServiceTypeAssignments(solution, params, errors);
  validateResidentialTypeAssignments(solution, params, errors);

  const services = solution.services.map((service, index) => ({
    ...service,
    bonus: solution.servicePopulationIncreases[index] ?? 0,
  }));
  const layoutEvaluation = evaluateLayout({
    grid,
    roads: solution.roads,
    services,
    residentials: solution.residentials,
    params,
  });

  for (const error of layoutEvaluation.errors) errors.push(error);

  const recomputedPopulations =
    solution.residentialTypeIndices.length === solution.residentials.length
      ? recomputeSolutionPopulations(solution, params, layoutEvaluation.boosts)
      : layoutEvaluation.populations.map((row) => row.population);
  const recomputedTotalPopulation = recomputedPopulations.reduce((sum, population) => sum + population, 0);

  if (!options.ignoreReportedPopulation && solution.populations.length === recomputedPopulations.length) {
    for (let i = 0; i < recomputedPopulations.length; i++) {
      if (solution.populations[i] !== recomputedPopulations[i]) {
        errors.push(
          `Residential ${i} reports population ${solution.populations[i]}, expected ${recomputedPopulations[i]}.`
        );
      }
    }
  }

  if (!options.ignoreReportedPopulation && solution.totalPopulation !== recomputedTotalPopulation) {
    errors.push(
      `Solution reports total population ${solution.totalPopulation}, expected ${recomputedTotalPopulation}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    recomputedPopulations,
    recomputedTotalPopulation,
    layoutEvaluation,
  };
}
