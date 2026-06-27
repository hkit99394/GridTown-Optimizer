import { performance } from "node:perf_hooks";

import {
  applyDeterministicDominanceUpgrades,
  applyRoadConnectionProbe,
  enumerateResidentialCandidates,
  enumerateResidentialCandidatesFromTypes,
  forEachRectangleCell,
  getBuildingLimits,
  getResidentialBaseMax,
  materializeValidLnsSeedSolution,
  NO_TYPE_INDEX,
  normalizeServicePlacement,
  overlaps,
  probeBuildingConnectedToRoads,
  roadAnchorsFromParams,
  roadAnchorSeedCandidates
} from "../../core/index.js";
import { buildAutoGreedyStageOptions } from "../auto/stagePolicy.js";
import { GreedyStopError } from "../greedy/runtime.js";
import { solveGreedy } from "../greedy/solver.js";

import type { Grid, LnsSearchStrategy, LnsTelemetry, Solution, SolverParams } from "../../core/index.js";

export const DEFAULT_LNS_ELITE_ARCHIVE_SIZE = 4;
export const DEFAULT_LNS_MULTI_START_SEEDS = 4;

const LNS_ELITE_SEED_MAX = 0x7fffffff;

export type LnsArchiveOptions = {
  searchStrategy: LnsSearchStrategy;
  eliteArchiveSize: number;
  multiStartSeeds: number;
  seedTimeLimitSeconds: number | null;
  stopFilePath: string;
};

export interface LnsArchiveEntry {
  solution: Solution;
  signature: string;
  seedIndex: number;
  source: "hint" | "greedy" | "repair";
}

export interface InitialLnsIncumbent {
  solution: Solution;
  seedSource: LnsTelemetry["seedSource"];
  seedWallClockSeconds: number;
  archive: LnsArchiveEntry[];
  archiveSeedCount: number;
}

function sortedRoadKeys(solution: Solution): string[] {
  return [...solution.roads].sort();
}

function lnsSolutionSignature(solution: Solution): string {
  const services = solution.services
    .map((service, index) => {
      const normalized = normalizeServicePlacement(service);
      return [
        solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
        normalized.r,
        normalized.c,
        normalized.rows,
        normalized.cols,
        normalized.range,
        solution.servicePopulationIncreases[index] ?? 0
      ].join(":");
    })
    .sort();
  const residentials = solution.residentials
    .map((residential, index) =>
      [
        solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        residential.r,
        residential.c,
        residential.rows,
        residential.cols,
        solution.populations[index] ?? 0
      ].join(":")
    )
    .sort();
  return [
    `roads=${sortedRoadKeys(solution).join(";")}`,
    `services=${services.join(";")}`,
    `res=${residentials.join(";")}`
  ].join("|");
}

function compareArchiveEntries(a: LnsArchiveEntry, b: LnsArchiveEntry): number {
  if (a.solution.totalPopulation !== b.solution.totalPopulation) {
    return b.solution.totalPopulation - a.solution.totalPopulation;
  }
  if (a.solution.roads.size !== b.solution.roads.size) return a.solution.roads.size - b.solution.roads.size;
  if (a.solution.services.length !== b.solution.services.length) {
    return b.solution.services.length - a.solution.services.length;
  }
  if (a.solution.residentials.length !== b.solution.residentials.length) {
    return b.solution.residentials.length - a.solution.residentials.length;
  }
  return a.signature.localeCompare(b.signature);
}

export function addSolutionToArchive(
  archive: LnsArchiveEntry[],
  solution: Solution,
  source: LnsArchiveEntry["source"],
  seedIndex: number,
  limit: number
): boolean {
  const signature = lnsSolutionSignature(solution);
  if (archive.some((entry) => entry.signature === signature)) return false;
  archive.push({ solution, signature, source, seedIndex });
  archive.sort(compareArchiveEntries);
  if (archive.length > limit) archive.length = limit;
  return true;
}

function deriveEliteGreedySeed(params: SolverParams, seedIndex: number): number {
  const baseSeed =
    typeof params.greedy?.randomSeed === "number" && Number.isInteger(params.greedy.randomSeed)
      ? params.greedy.randomSeed
      : 0;
  if (seedIndex === 0) return Math.min(baseSeed, LNS_ELITE_SEED_MAX);
  let mixed = (baseSeed ^ Math.imul(seedIndex + 1, 0x9e3779b1)) >>> 0;
  mixed = (mixed ^ Math.imul(seedIndex + 17, 0x85ebca6b)) >>> 0;
  return mixed % (LNS_ELITE_SEED_MAX + 1);
}

function greedySeedTimeLimitSeconds(options: LnsArchiveOptions): number | null {
  if (options.seedTimeLimitSeconds === null) return null;
  if (options.searchStrategy !== "elite-archive" || options.multiStartSeeds <= 1) return options.seedTimeLimitSeconds;
  return Math.max(0.001, options.seedTimeLimitSeconds / options.multiStartSeeds);
}

function solveGreedySeedCandidate(
  G: Grid,
  params: SolverParams,
  options: LnsArchiveOptions,
  seedIndex: number
): Solution | null {
  const seedTimeLimitSeconds = greedySeedTimeLimitSeconds(options);
  const useFastEliteSeed = options.searchStrategy === "elite-archive" && seedTimeLimitSeconds !== null;
  const deriveSeed =
    params.greedy?.randomSeed !== undefined ||
    (options.searchStrategy === "elite-archive" && (options.seedTimeLimitSeconds !== null || seedIndex > 0));
  const seedGreedyOptions = useFastEliteSeed ? buildAutoGreedyStageOptions(params) : (params.greedy ?? {});
  try {
    return solveGreedy(G, {
      ...params,
      optimizer: "greedy",
      greedy: {
        ...seedGreedyOptions,
        profile: seedGreedyOptions.profile ?? true,
        ...(deriveSeed ? { randomSeed: deriveEliteGreedySeed(params, seedIndex) } : {}),
        ...(seedTimeLimitSeconds !== null ? { timeLimitSeconds: seedTimeLimitSeconds } : {}),
        ...(options.stopFilePath ? { stopFilePath: options.stopFilePath } : {})
      }
    });
  } catch (error) {
    if (error instanceof GreedyStopError) return error.bestSolution;
    throw error;
  }
}

function lnsResidentialCandidateTypeIndex(candidate: unknown): number {
  if (typeof candidate !== "object" || candidate === null || !("typeIndex" in candidate)) return NO_TYPE_INDEX;
  const typeIndex = (candidate as { typeIndex?: unknown }).typeIndex;
  return typeof typeIndex === "number" ? typeIndex : NO_TYPE_INDEX;
}

function rotateArray<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return [];
  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

function buildEmergencyLnsSeed(G: Grid, params: SolverParams, variantIndex: number): Solution | null {
  const roadAnchors = roadAnchorsFromParams(params);
  const roadSeeds = roadAnchorSeedCandidates(G, roadAnchors);
  const roads = new Set(roadSeeds[variantIndex % Math.max(1, roadSeeds.length)] ?? []);
  if (roads.size === 0) return null;

  const occupied = new Set(roads);
  const residentials: Solution["residentials"] = [];
  const residentialTypeIndices: number[] = [];
  const populations: number[] = [];
  let totalPopulation = 0;
  const maxResidentials = getBuildingLimits(params).maxResidentials ?? Number.POSITIVE_INFINITY;
  const emergencyResidentialLimit = Math.min(maxResidentials, 4);
  const typedCandidates =
    params.residentialTypes && params.residentialTypes.length > 0
      ? enumerateResidentialCandidatesFromTypes(G, params.residentialTypes)
      : enumerateResidentialCandidates(G);
  const residentialTypeUseCounts = new Map<number, number>();

  for (const candidate of rotateArray(typedCandidates, variantIndex)) {
    if (residentials.length >= emergencyResidentialLimit) break;
    const typeIndex = lnsResidentialCandidateTypeIndex(candidate);
    if (typeIndex >= 0) {
      const available = params.residentialTypes?.[typeIndex]?.avail ?? Number.POSITIVE_INFINITY;
      if ((residentialTypeUseCounts.get(typeIndex) ?? 0) >= available) continue;
    }
    if (overlaps(occupied, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;
    const roadProbe = probeBuildingConnectedToRoads(
      G,
      roads,
      occupied,
      candidate.r,
      candidate.c,
      candidate.rows,
      candidate.cols,
      undefined,
      roadAnchors
    );
    if (!roadProbe) continue;
    applyRoadConnectionProbe(roads, roadProbe);
    for (const roadKey of roads) occupied.add(roadKey);
    if (overlaps(occupied, candidate.r, candidate.c, candidate.rows, candidate.cols)) continue;

    const { base } = getResidentialBaseMax(params, candidate.rows, candidate.cols, typeIndex);
    residentials.push({ r: candidate.r, c: candidate.c, rows: candidate.rows, cols: candidate.cols });
    residentialTypeIndices.push(typeIndex);
    populations.push(base);
    totalPopulation += base;
    if (typeIndex >= 0) residentialTypeUseCounts.set(typeIndex, (residentialTypeUseCounts.get(typeIndex) ?? 0) + 1);
    forEachRectangleCell(candidate.r, candidate.c, candidate.rows, candidate.cols, (r, c) => {
      occupied.add(`${r},${c}`);
    });
  }

  return applyDeterministicDominanceUpgrades(G, params, {
    optimizer: "lns",
    roads,
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials,
    residentialTypeIndices,
    populations,
    totalPopulation
  });
}

export function materializeLnsArchiveSolution(G: Grid, params: SolverParams, solution: Solution): Solution {
  return applyDeterministicDominanceUpgrades(G, params, {
    ...solution,
    optimizer: "lns"
  });
}

export function selectArchiveRepairEntry(
  archive: readonly LnsArchiveEntry[],
  options: Pick<LnsArchiveOptions, "searchStrategy">,
  iteration: number,
  stagnantIterations: number
): LnsArchiveEntry {
  if (archive.length === 0) {
    throw new Error("LNS elite archive is empty.");
  }
  if (options.searchStrategy !== "elite-archive" || archive.length === 1 || stagnantIterations === 0) {
    return archive[0];
  }
  const alternateCount = archive.length - 1;
  const alternateIndex = 1 + ((iteration + stagnantIterations - 1) % alternateCount);
  return archive[alternateIndex];
}

function archiveSeedSource(entry: LnsArchiveEntry): LnsTelemetry["seedSource"] {
  return entry.source === "hint" ? "hint" : "greedy";
}

export function buildInitialLnsIncumbent(
  G: Grid,
  params: SolverParams,
  options: LnsArchiveOptions
): InitialLnsIncumbent {
  const startedAt = performance.now();
  const archive: LnsArchiveEntry[] = [];
  const seededIncumbent = materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
  let seedAttemptCount = 0;
  if (seededIncumbent) {
    const solution = materializeLnsArchiveSolution(G, params, seededIncumbent);
    addSolutionToArchive(archive, solution, "hint", 0, options.eliteArchiveSize);
    seedAttemptCount += 1;
    if (options.searchStrategy !== "elite-archive") {
      return {
        solution,
        seedSource: "hint",
        seedWallClockSeconds: (performance.now() - startedAt) / 1000,
        archive,
        archiveSeedCount: seedAttemptCount
      };
    }
  }

  const runBoundedEliteSeeds = options.searchStrategy === "elite-archive" && options.seedTimeLimitSeconds !== null;
  const seedCount = runBoundedEliteSeeds ? options.multiStartSeeds : seededIncumbent ? 0 : 1;
  let firstError: unknown = null;
  for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
    try {
      const seed = solveGreedySeedCandidate(G, params, options, seedIndex);
      if (!seed) continue;
      seedAttemptCount += 1;
      addSolutionToArchive(
        archive,
        materializeLnsArchiveSolution(G, params, seed),
        "greedy",
        seedIndex,
        options.eliteArchiveSize
      );
    } catch (error) {
      if (firstError === null) firstError = error;
      if (archive.length === 0) throw error;
    }
  }

  if (archive.length === 0) {
    const emergencySeedCount = runBoundedEliteSeeds ? options.multiStartSeeds : 1;
    for (let seedIndex = 0; seedIndex < emergencySeedCount; seedIndex++) {
      const fallbackSeed = buildEmergencyLnsSeed(G, params, seedIndex);
      if (!fallbackSeed) continue;
      seedAttemptCount += 1;
      addSolutionToArchive(archive, fallbackSeed, "greedy", seedCount + seedIndex, options.eliteArchiveSize);
    }
  }
  if (archive.length === 0) {
    if (firstError) throw firstError;
    throw new Error("LNS could not build an initial greedy incumbent.");
  }

  return {
    solution: archive[0].solution,
    seedSource: archiveSeedSource(archive[0]),
    seedWallClockSeconds: (performance.now() - startedAt) / 1000,
    archive,
    archiveSeedCount: seedAttemptCount
  };
}
