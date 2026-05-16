import type { Grid } from "./types.js";

export function validateGridShape(value: unknown, path = "Grid"): { grid: Grid } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: `${path} must be a non-empty rectangular 0/1 grid.` };
  }

  let width: number | null = null;
  for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
    const row = value[rowIndex];
    if (!Array.isArray(row) || row.length === 0) {
      return { error: `${path}[${rowIndex}] must be a non-empty row array.` };
    }
    if (width === null) {
      width = row.length;
    } else if (row.length !== width) {
      return { error: `${path}[${rowIndex}] must have length ${width} to keep the grid rectangular.` };
    }

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      if (cell !== 0 && cell !== 1) {
        return { error: `${path}[${rowIndex}][${columnIndex}] must be 0 or 1.` };
      }
    }
  }

  return { grid: value as Grid };
}
