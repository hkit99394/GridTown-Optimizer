/**
 * Solution map rendering and validation helpers.
 */

import type {
  Grid,
  Solution,
  SolutionValidationInput,
  SolutionValidationResult,
} from "./types.js";
import { height, width, isAllowed } from "./grid.js";
import { normalizeServicePlacement } from "./buildings.js";
import { validateSolution } from "./evaluator.js";

export interface SolutionMapValidationResult extends SolutionValidationResult {
  mapRows: string[];
  mapText: string;
}

/** Render ASCII map: # = blocked, R = road, S = service, H = residential, . = empty allowed */
export function renderSolutionMap(grid: Grid, solution: Solution): string[] {
  const h = height(grid);
  const w = width(grid);
  const cell: string[][] = Array.from({ length: h }, () => Array(w).fill("."));

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!isAllowed(grid, r, c)) cell[r][c] = "#";
    }
  }

  for (const key of solution.roads) {
    const [r, c] = key.split(",").map(Number);
    cell[r][c] = "R";
  }
  for (const service of solution.services) {
    const normalized = normalizeServicePlacement(service);
    for (let dr = 0; dr < normalized.rows; dr++) {
      for (let dc = 0; dc < normalized.cols; dc++) {
        cell[normalized.r + dr][normalized.c + dc] = "S";
      }
    }
  }
  for (const residential of solution.residentials) {
    for (let dr = 0; dr < residential.rows; dr++) {
      for (let dc = 0; dc < residential.cols; dc++) {
        cell[residential.r + dr][residential.c + dc] = "H";
      }
    }
  }

  const rows: string[] = [];
  rows.push("   " + Array.from({ length: w }, (_, i) => i % 10).join(""));
  for (let r = 0; r < h; r++) rows.push(String(r).padStart(2) + " " + cell[r].join(""));
  rows.push("");
  rows.push("Legend: # blocked  R road  S service  H residential  . empty");
  return rows;
}

export function formatSolutionMap(grid: Grid, solution: Solution): string {
  return renderSolutionMap(grid, solution).join("\n");
}

/**
 * Validate a solution and return the rendered map alongside the validation result.
 * This is a convenience wrapper for validating the exact layout shown to users.
 */
export function validateSolutionMap(input: SolutionValidationInput): SolutionMapValidationResult {
  const validation = validateSolution(input);
  const mapRows = renderSolutionMap(input.grid, input.solution);
  return {
    ...validation,
    mapRows,
    mapText: mapRows.join("\n"),
  };
}
