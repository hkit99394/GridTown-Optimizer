import {
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  enumerateServiceCandidates
} from "../core/index.js";

import type { Grid, SolverParams } from "../core/index.js";
import type { CrossModeBenchmarkCase, CrossModeBenchmarkRunOptions, CrossModeWorkflowTag } from "./crossModeTypes.js";

const NO_OVERLAP2D_GEOMETRY_MIN_ALLOWED_CELLS = 24;
const NO_OVERLAP2D_GEOMETRY_MIN_CANDIDATE_DENSITY = 3.75;
const NO_OVERLAP2D_GEOMETRY_MAX_BLOCKED_CELL_RATIO = 0.25;
const NO_OVERLAP2D_GEOMETRY_MIN_MAX_FOOTPRINT_AREA = 4;

export interface CrossModeCpSatNoOverlap2dGeometryPressureSignal {
  applies: boolean;
  reason: string;
  allowedCellCount: number;
  blockedCellRatio: number;
  serviceCandidateCount: number;
  residentialCandidateCount: number;
  candidateDensity: number;
  maxFootprintArea: number;
  hasContinuationHint: boolean;
}

function workflowTagsIncludeAny(
  benchmarkCase: CrossModeBenchmarkCase,
  workflowTags: readonly CrossModeWorkflowTag[] | undefined
): boolean {
  if (!workflowTags?.length) return false;
  const caseTags = new Set(benchmarkCase.workflowTags ?? []);
  return workflowTags.some((tag) => caseTags.has(tag));
}

function countAllowedGridCells(grid: Grid): number {
  let allowedCellCount = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell) allowedCellCount++;
    }
  }
  return allowedCellCount;
}

function maxConfiguredFootprintArea(params: SolverParams): number {
  const serviceMaxArea = Math.max(0, ...(params.serviceTypes ?? []).map((type) => type.rows * type.cols));
  const residentialMaxArea = Math.max(0, ...(params.residentialTypes ?? []).map((type) => type.w * type.h));
  const legacyResidentialMaxArea = params.residentialTypes?.length ? 0 : 6;
  return Math.max(serviceMaxArea, residentialMaxArea, legacyResidentialMaxArea);
}

export function evaluateCpSatNoOverlap2dGeometryPressure(
  benchmarkCase: CrossModeBenchmarkCase
): CrossModeCpSatNoOverlap2dGeometryPressureSignal {
  const gridRows = benchmarkCase.grid.length;
  const gridCols = benchmarkCase.grid[0]?.length ?? 0;
  const gridCellCount = gridRows * gridCols;
  const allowedCellCount = countAllowedGridCells(benchmarkCase.grid);
  const blockedCellRatio = gridCellCount === 0 ? 1 : (gridCellCount - allowedCellCount) / gridCellCount;
  const serviceCandidateCount = enumerateServiceCandidates(benchmarkCase.grid, benchmarkCase.params).length;
  const residentialCandidateCount = benchmarkCase.params.residentialTypes?.length
    ? enumerateResidentialCandidatesFromTypes(benchmarkCase.grid, benchmarkCase.params.residentialTypes).length
    : enumerateResidentialCandidates(benchmarkCase.grid).length;
  const candidateDensity =
    allowedCellCount === 0 ? 0 : (serviceCandidateCount + residentialCandidateCount) / allowedCellCount;
  const maxFootprintArea = maxConfiguredFootprintArea(benchmarkCase.params);
  const hasContinuationHint = Boolean(benchmarkCase.params.cpSat?.warmStartHint ?? benchmarkCase.params.lns?.seedHint);

  const signalBase = {
    allowedCellCount,
    blockedCellRatio,
    serviceCandidateCount,
    residentialCandidateCount,
    candidateDensity,
    maxFootprintArea,
    hasContinuationHint
  };

  if (hasContinuationHint) {
    return { applies: false, reason: "continuation-hint", ...signalBase };
  }
  if (allowedCellCount < NO_OVERLAP2D_GEOMETRY_MIN_ALLOWED_CELLS) {
    return { applies: false, reason: "too-few-allowed-cells", ...signalBase };
  }
  if (blockedCellRatio > NO_OVERLAP2D_GEOMETRY_MAX_BLOCKED_CELL_RATIO) {
    return { applies: false, reason: "fragmented-corridor-mask", ...signalBase };
  }
  if (candidateDensity < NO_OVERLAP2D_GEOMETRY_MIN_CANDIDATE_DENSITY) {
    return { applies: false, reason: "low-placement-candidate-density", ...signalBase };
  }
  if (maxFootprintArea < NO_OVERLAP2D_GEOMETRY_MIN_MAX_FOOTPRINT_AREA) {
    return { applies: false, reason: "low-footprint-geometry-pressure", ...signalBase };
  }
  return { applies: true, reason: "dense-placement-geometry-pressure", ...signalBase };
}

export function withCaseScopedCpSatOptions(
  benchmarkCase: CrossModeBenchmarkCase,
  options: CrossModeBenchmarkRunOptions
): CrossModeBenchmarkRunOptions {
  if (!options.cpSatNoOverlap2dWorkflowTags?.length && !options.cpSatNoOverlap2dGeometryPressure) return options;
  const useNoOverlap2d = options.cpSatNoOverlap2dGeometryPressure
    ? evaluateCpSatNoOverlap2dGeometryPressure(benchmarkCase).applies
    : workflowTagsIncludeAny(benchmarkCase, options.cpSatNoOverlap2dWorkflowTags);
  return {
    ...options,
    cpSat: {
      ...(options.cpSat ?? {}),
      useNoOverlap2d
    }
  };
}
