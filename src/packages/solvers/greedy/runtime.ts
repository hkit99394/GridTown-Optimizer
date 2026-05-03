import type { GreedyOptions, Solution, SolverParams } from "../../core/index.js";

export class GreedyStopError extends Error {
  constructor(
    readonly bestSolution: Solution | null,
    readonly reason: "cancelled" | "time-limit"
  ) {
    super(
      bestSolution
        ? reason === "time-limit"
          ? "Greedy solve reached its time limit."
          : "Greedy solve was stopped."
        : reason === "time-limit"
          ? "Greedy solve reached its time limit before finding a feasible solution."
          : "Greedy solve was stopped before finding a feasible solution."
    );
  }
}

export type RandomSource = () => number;

export type NormalizedGreedyOptions = Omit<Required<GreedyOptions>, "randomSeed" | "timeLimitSeconds"> & {
  randomSeed?: number;
  timeLimitSeconds?: number;
};

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(baseSeed: number, cap: number, restartIndex: number): number {
  let mixed = (baseSeed ^ Math.imul(cap + 1, 0x9e3779b1)) >>> 0;
  mixed = (mixed ^ Math.imul(restartIndex + 1, 0x85ebca6b)) >>> 0;
  return mixed >>> 0;
}

export function shuffle<T>(a: T[], random: RandomSource = Math.random): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function getGreedyOptions(params: SolverParams): NormalizedGreedyOptions {
  const greedy = params.greedy ?? {};
  const randomSeed =
    typeof greedy.randomSeed === "number" && Number.isInteger(greedy.randomSeed) ? greedy.randomSeed : undefined;
  const timeLimitSeconds =
    typeof greedy.timeLimitSeconds === "number" &&
    Number.isFinite(greedy.timeLimitSeconds) &&
    greedy.timeLimitSeconds > 0
      ? greedy.timeLimitSeconds
      : undefined;
  return {
    localSearch: greedy.localSearch ?? params.localSearch ?? true,
    localSearchServiceMoves: greedy.localSearchServiceMoves ?? true,
    localSearchServiceCandidateLimit: greedy.localSearchServiceCandidateLimit ?? 6,
    serviceLookaheadCandidates: greedy.serviceLookaheadCandidates ?? 0,
    deferRoadCommitment: greedy.deferRoadCommitment ?? false,
    densityTieBreaker: greedy.densityTieBreaker ?? false,
    densityTieBreakerTolerancePercent: greedy.densityTieBreakerTolerancePercent ?? 2,
    connectivityShadowScoring: greedy.connectivityShadowScoring ?? false,
    ...(randomSeed !== undefined ? { randomSeed } : {}),
    profile: greedy.profile ?? false,
    diagnostics: greedy.diagnostics ?? false,
    ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
    restarts: greedy.restarts ?? params.restarts ?? 1,
    serviceRefineIterations: greedy.serviceRefineIterations ?? params.serviceRefineIterations ?? 2,
    serviceRefineCandidateLimit: greedy.serviceRefineCandidateLimit ?? params.serviceRefineCandidateLimit ?? 40,
    exhaustiveServiceSearch: greedy.exhaustiveServiceSearch ?? params.exhaustiveServiceSearch ?? false,
    serviceExactPoolLimit: greedy.serviceExactPoolLimit ?? params.serviceExactPoolLimit ?? 22,
    serviceExactMaxCombinations: greedy.serviceExactMaxCombinations ?? params.serviceExactMaxCombinations ?? 12000,
    serviceMasterDecomposition: greedy.serviceMasterDecomposition ?? false,
    serviceMasterPoolLimit: greedy.serviceMasterPoolLimit ?? 12,
    serviceMasterMaxLayouts: greedy.serviceMasterMaxLayouts ?? 256,
    stopFilePath: greedy.stopFilePath ?? "",
    snapshotFilePath: greedy.snapshotFilePath ?? ""
  };
}
