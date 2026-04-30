export type ActiveCandidatePool = {
  activeIndices: number[];
  positions: number[];
};

export function createActiveCandidatePool(candidateCount: number): ActiveCandidatePool {
  return {
    activeIndices: Array.from({ length: candidateCount }, (_, index) => index),
    positions: Array.from({ length: candidateCount }, (_, index) => index),
  };
}

export function isCandidateActive(pool: ActiveCandidatePool, candidateIndex: number): boolean {
  return (pool.positions[candidateIndex] ?? -1) >= 0;
}

export function removeActiveCandidate(pool: ActiveCandidatePool, candidateIndex: number): boolean {
  const position = pool.positions[candidateIndex] ?? -1;
  if (position < 0) return false;
  const lastPosition = pool.activeIndices.length - 1;
  const lastCandidateIndex = pool.activeIndices[lastPosition];
  pool.activeIndices[position] = lastCandidateIndex;
  pool.positions[lastCandidateIndex] = position;
  pool.activeIndices.pop();
  pool.positions[candidateIndex] = -1;
  return true;
}

export function buildFootprintCandidateIndexFromKeys(
  footprintKeysByCandidate: readonly (readonly string[])[]
): Map<string, number[]> {
  const byCell = new Map<string, number[]>();
  for (let candidateIndex = 0; candidateIndex < footprintKeysByCandidate.length; candidateIndex++) {
    for (const cellKey of footprintKeysByCandidate[candidateIndex] ?? []) {
      const existing = byCell.get(cellKey);
      if (existing) {
        existing.push(candidateIndex);
      } else {
        byCell.set(cellKey, [candidateIndex]);
      }
    }
  }
  return byCell;
}

export function buildTypedCandidateIndex(
  candidateCount: number,
  getTypeIndex: (candidateIndex: number) => number,
  typeCount: number
): number[][] {
  const byType = Array.from({ length: typeCount }, () => [] as number[]);
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const typeIndex = getTypeIndex(candidateIndex);
    if (typeIndex >= 0 && typeIndex < typeCount) {
      byType[typeIndex].push(candidateIndex);
    }
  }
  return byType;
}

export function collectIndexedCandidatesForCells(
  cellKeys: Iterable<string>,
  indexByCell: Map<string, number[]>
): number[] {
  const affected = new Set<number>();
  for (const cellKey of cellKeys) {
    for (const candidateIndex of indexByCell.get(cellKey) ?? []) {
      affected.add(candidateIndex);
    }
  }
  return [...affected];
}

export function mapGlobalCandidateIndicesToLocal(
  candidateIndices: Iterable<number>,
  globalToLocalCandidateIndices: readonly number[]
): number[] {
  const mapped = new Set<number>();
  for (const candidateIndex of candidateIndices) {
    const localIndex = globalToLocalCandidateIndices[candidateIndex] ?? -1;
    if (localIndex >= 0) mapped.add(localIndex);
  }
  return [...mapped];
}

export function invalidateCandidatePoolEntries(
  pool: ActiveCandidatePool,
  candidateIndices: Iterable<number>
): number {
  let invalidated = 0;
  for (const candidateIndex of candidateIndices) {
    if (removeActiveCandidate(pool, candidateIndex)) {
      invalidated += 1;
    }
  }
  return invalidated;
}

export function markServiceCandidatesDirty(
  candidateIndices: Iterable<number>,
  dirtyScores: boolean[],
  activePool: ActiveCandidatePool
): number {
  let marked = 0;
  for (const candidateIndex of candidateIndices) {
    if (!isCandidateActive(activePool, candidateIndex) || dirtyScores[candidateIndex]) continue;
    dirtyScores[candidateIndex] = true;
    marked += 1;
  }
  return marked;
}
