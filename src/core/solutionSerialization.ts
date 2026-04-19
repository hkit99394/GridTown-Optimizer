/**
 * Shared solution serialization and snapshot persistence helpers.
 */

import { renameSync, writeFileSync } from "node:fs";

import type { SerializedSolution, Solution } from "./types.js";

export function serializeSolution(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

export function materializeSerializedSolution(solution: SerializedSolution): Solution {
  return {
    ...solution,
    roads: new Set(solution.roads),
  };
}

export function writeSolutionSnapshot(snapshotFilePath: string, solution: Solution): void {
  const tempPath = `${snapshotFilePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(serializeSolution(solution)));
  renameSync(tempPath, snapshotFilePath);
}
