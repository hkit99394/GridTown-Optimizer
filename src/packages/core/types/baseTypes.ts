/**
 * Shared geometry and solver identity types
 *
 * Re-exported by ../types.ts to preserve the public API.
 */

export type Grid = number[][];

export type Cell = { r: number; c: number };

/** Key for set/map of cells */
export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

const CELL_KEY_PATTERN = /^(0|[1-9]\d*),(0|[1-9]\d*)$/;

export function parseCellKey(key: string): Cell | null {
  const match = CELL_KEY_PATTERN.exec(key);
  if (!match) return null;
  const r = Number(match[1]);
  const c = Number(match[2]);
  if (!Number.isSafeInteger(r) || !Number.isSafeInteger(c)) return null;
  return { r, c };
}

export function isCellKey(value: unknown): value is string {
  return typeof value === "string" && parseCellKey(value) !== null;
}

export function cellFromKey(key: string): Cell {
  const cell = parseCellKey(key);
  if (!cell) throw new Error(`Invalid cell key: ${key}`);
  return cell;
}

/** Rectangle: top-left (r, c), size (rows × cols) */
export type Rectangle = { r: number; c: number; rows: number; cols: number };

/** Service building placement with explicit footprint and effect range. */
export type ServicePlacement = { r: number; c: number; rows: number; cols: number; range: number };

/** Service candidate with type index and bonus metadata for optimizer use */
export type ServiceCandidate = ServicePlacement & { typeIndex: number; bonus: number };

/** Residential building: placement (r, c) and size (rows × cols) */
export type ResidentialPlacement = { r: number; c: number; rows: number; cols: number };

/** Residential candidate with type index (for per-type avail and min/max) */
export type ResidentialCandidate = ResidentialPlacement & { typeIndex: number };

/**
 * How many of each building type are available to place.
 * Omit or use undefined for "no limit".
 */
export interface AvailableBuildings {
  /** Max number of service buildings to place. Default: no limit */
  services?: number;
  /** Max number of residential buildings (2×2 or 2×3) to place. Default: no limit */
  residentials?: number;
}

/** Min (base) and max population for one residential size (e.g. 2×2 or 2×3) */
export interface ResidentialSizeSetting {
  min: number;
  max: number;
}

/** Key is "rowsxcols", e.g. "2x2", "2x3" */
export type ResidentialSettings = Partial<Record<string, ResidentialSizeSetting>>;

/**
 * One residential building type: size (w×h), min/max population, and how many can be placed.
 * Building can be rotated so both (w×h) and (h×w) count as this type and share the same avail.
 */
export interface ResidentialTypeSetting {
  name?: string;
  w: number;
  h: number;
  min: number;
  max: number;
  avail: number;
}

/**
 * One service building type: size, bonus, effect range, and availability.
 * When allowRotation is true (default), both (rows×cols) and (cols×rows) are allowed for this type.
 */
export interface ServiceTypeSetting {
  name?: string;
  rows: number;
  cols: number;
  bonus: number;
  range: number;
  avail: number;
  allowRotation?: boolean;
}

export type OptimizerName = "auto" | "greedy" | "cp-sat" | "lns";

export function isOptimizerName(value: unknown): value is OptimizerName {
  return value === "auto" || value === "greedy" || value === "cp-sat" || value === "lns";
}

/** Fallback when a raw backend/API request omits `params.optimizer`. */
export const OMITTED_SOLVER_OPTIMIZER: OptimizerName = "auto";

/** Recommended default for interactive planner and CLI entry points. */
export const RECOMMENDED_INTERACTIVE_OPTIMIZER: OptimizerName = "auto";

export type AutoStageOptimizerName = Exclude<OptimizerName, "auto">;
