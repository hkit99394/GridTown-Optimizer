import { cellKey, forEachRectangleCell } from "../../core/index.js";
import type { ResidentialPlacement, ServicePlacement } from "../../core/index.js";
import type { ConnectivityProbe, RoadConnectionProbe } from "./attemptState.js";

export type OccupancyScratch = {
  cells: Set<string>;
  addedKeys: Set<string>;
  removedKeys: Set<string>;
};

export function forEachPlacementCell(
  placement: { r: number; c: number; rows: number; cols: number },
  visit: (key: string) => void
): void {
  forEachRectangleCell(placement.r, placement.c, placement.rows, placement.cols, (r, c) => visit(cellKey(r, c)));
}

export function forEachCachedPlacementCell(footprintKeys: readonly string[], visit: (key: string) => void): void {
  for (const key of footprintKeys) visit(key);
}

export function addPlacementCellsToSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.add(key));
}

export function addCachedPlacementCellsToSet(target: Set<string>, footprintKeys: readonly string[]): void {
  forEachCachedPlacementCell(footprintKeys, (key) => target.add(key));
}

export function deletePlacementCellsFromSet(
  target: Set<string>,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => target.delete(key));
}

export function toExplicitConnectivityProbe(probe: RoadConnectionProbe): ConnectivityProbe {
  return { kind: "explicit", roadCost: probe.path?.length ?? 0, roadProbe: probe };
}

export function buildLocalSearchBuildingOccupancy(
  services: readonly ServicePlacement[],
  residentials: readonly ResidentialPlacement[],
  excludedResidentialIndex = -1
): Set<string> {
  const occupiedBuildings = new Set<string>();
  for (const service of services) addPlacementCellsToSet(occupiedBuildings, service);
  for (let index = 0; index < residentials.length; index++) {
    if (index === excludedResidentialIndex) continue;
    addPlacementCellsToSet(occupiedBuildings, residentials[index]);
  }
  return occupiedBuildings;
}

export function overlapsCachedFootprint(occupied: Set<string>, footprintKeys: readonly string[]): boolean {
  for (const key of footprintKeys) {
    if (occupied.has(key)) return true;
  }
  return false;
}

export function createOccupancyScratch(base: Set<string>): OccupancyScratch {
  return {
    cells: new Set(base),
    addedKeys: new Set(),
    removedKeys: new Set()
  };
}

export function resetOccupancyScratch(scratch: OccupancyScratch): void {
  for (const key of scratch.addedKeys) {
    scratch.cells.delete(key);
  }
  for (const key of scratch.removedKeys) {
    scratch.cells.add(key);
  }
  scratch.addedKeys.clear();
  scratch.removedKeys.clear();
}

export function deleteOccupancyScratchKey(scratch: OccupancyScratch, key: string): void {
  if (!scratch.cells.has(key)) return;
  scratch.cells.delete(key);
  if (scratch.addedKeys.has(key)) {
    scratch.addedKeys.delete(key);
  } else {
    scratch.removedKeys.add(key);
  }
}

export function deleteKeysFromOccupancyScratch(scratch: OccupancyScratch, footprintKeys: readonly string[]): void {
  for (const key of footprintKeys) deleteOccupancyScratchKey(scratch, key);
}

export function deletePlacementCellsFromOccupancyScratch(
  scratch: OccupancyScratch,
  placement: { r: number; c: number; rows: number; cols: number }
): void {
  forEachPlacementCell(placement, (key) => deleteOccupancyScratchKey(scratch, key));
}

export function rectanglesOverlap(
  a: { r: number; c: number; rows: number; cols: number },
  b: { r: number; c: number; rows: number; cols: number }
): boolean {
  return a.r < b.r + b.rows && a.r + a.rows > b.r && a.c < b.c + b.cols && a.c + a.cols > b.c;
}
