/**
 * Large Neighborhood Search seeded from the greedy incumbent and repaired by CP-SAT.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { applyDeterministicDominanceUpgrades } from "../core/dominanceUpgrades.js";
import { normalizeServicePlacement } from "../core/buildings.js";
import { solveCpSat } from "../cp-sat/solver.js";
import { height, width } from "../core/grid.js";
import { buildNeighborhoodCandidates, selectNeighborhoodWindow } from "./neighborhoods.js";
import { NO_TYPE_INDEX } from "../core/rules.js";
import { writeSolutionSnapshot } from "../core/solutionSerialization.js";
import { assertValidLnsOptions, materializeValidLnsSeedSolution } from "../core/solverInputValidation.js";
import { solveGreedy } from "../greedy/solver.js";
import {
  buildLearnedLnsWindowFeatures,
  PHASE12_LNS_WINDOW_RANKER_FINGERPRINT,
  PHASE12_LNS_WINDOW_RANKER_VERSION,
  scoreLearnedLnsWindowCandidate,
} from "./learnedWindowRanking.js";
import { solveSmallWindowDpRepair } from "./smallWindowDpRepair.js";

import type {
  CpSatNeighborhoodWindow,
  CpSatWarmStartHint,
  Grid,
  LnsNeighborhoodOutcome,
  LnsNeighborhoodOutcomeStatus,
  LnsNeighborhoodAnchorPolicy,
  LnsOperatorScoreTelemetry,
  LnsOperatorSelectionPolicy,
  LnsRepairBackend,
  LnsRepairPhase,
  LnsRepairOperatorName,
  LnsSmallWindowDpTelemetry,
  LnsStopReason,
  LnsTelemetry,
  Solution,
  SolverParams,
} from "../core/types.js";

type NormalizedLnsOptions = {
  iterations: number;
  maxNoImprovementIterations: number;
  wallClockLimitSeconds: number | null;
  noImprovementTimeoutSeconds: number | null;
  seedTimeLimitSeconds: number | null;
  neighborhoodRows: number;
  neighborhoodCols: number;
  neighborhoodAnchorPolicy: LnsNeighborhoodAnchorPolicy;
  operatorSelectionPolicy: LnsOperatorSelectionPolicy;
  operatorExplorationInterval: number;
  operatorScoreDecay: number;
  learnedWindowRanking: boolean;
  learnedWindowRankingCandidateLimit: number;
  learnedWindowRankingMinScoreRatio: number;
  repairTimeLimitSeconds: number;
  focusedRepairTimeLimitSeconds: number;
  escalatedRepairTimeLimitSeconds: number;
  smallWindowDpRepair: boolean;
  smallWindowDpMaxCells: number;
  smallWindowDpMaxCandidates: number;
  smallWindowDpMaxStates: number;
  seedHint?: CpSatWarmStartHint;
  stopFilePath: string;
  snapshotFilePath: string;
};

interface InitialLnsIncumbent {
  solution: Solution;
  seedSource: LnsTelemetry["seedSource"];
  seedWallClockSeconds: number;
}

interface LnsRepairAttempt {
  iteration: number;
  phase: LnsRepairPhase;
  window: CpSatNeighborhoodWindow;
  operatorName: LnsRepairOperatorName;
  operatorScoreBefore: number;
  operatorExploration: boolean;
  learnedWindowRankingScore?: number;
  learnedWindowRankingBaselineScore?: number;
  learnedWindowRankingSelectedAdaptiveScore?: number;
  learnedWindowRankingBaselineAdaptiveScore?: number;
  learnedWindowRankingCandidateCount?: number;
  learnedWindowRankingShortlistCount?: number;
  learnedWindowRankingDisplaced?: boolean;
  stagnantIterationsBefore: number;
  staleSecondsBefore: number;
  repairTimeLimitSeconds: number;
  populationBefore: number;
  startedAtMs: number | null;
}

interface LnsOperatorScoreState extends LnsOperatorScoreTelemetry {}

const DEFAULT_LNS_ITERATIONS = 12;
const DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS = 4;
const DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS = 5;
const DEFAULT_LNS_OPERATOR_EXPLORATION_INTERVAL = 5;
const DEFAULT_LNS_OPERATOR_SCORE_DECAY = 0.7;
const DEFAULT_LNS_LEARNED_WINDOW_RANKING_CANDIDATE_LIMIT = 12;
const DEFAULT_LNS_LEARNED_WINDOW_RANKING_MIN_SCORE_RATIO = 1;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CELLS = 12;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CANDIDATES = 64;
const DEFAULT_LNS_SMALL_WINDOW_DP_MAX_STATES = 200_000;
const LNS_NEIGHBORHOOD_ANCHOR_POLICIES = new Set<LnsNeighborhoodAnchorPolicy>([
  "ranked",
  "sliding-only",
  "weak-service-first",
  "residential-opportunity-first",
  "frontier-congestion-first",
  "placed-buildings-first",
]);
const LNS_OPERATOR_SELECTION_POLICIES = new Set<LnsOperatorSelectionPolicy>([
  "legacy",
  "adaptive",
]);
const LNS_REPAIR_OPERATOR_NAMES: readonly LnsRepairOperatorName[] = [
  "weak-service-repair",
  "residential-headroom-repair",
  "frontier-congestion-repair",
  "gate-choke-repair",
  "service-overlap-repair",
  "random-exploration",
  "sliding-window",
];

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveFiniteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalPositiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function lnsNeighborhoodAnchorPolicyOrDefault(value: unknown): LnsNeighborhoodAnchorPolicy {
  return typeof value === "string" && LNS_NEIGHBORHOOD_ANCHOR_POLICIES.has(value as LnsNeighborhoodAnchorPolicy)
    ? value as LnsNeighborhoodAnchorPolicy
    : "ranked";
}

function lnsOperatorSelectionPolicyOrDefault(value: unknown): LnsOperatorSelectionPolicy {
  return typeof value === "string" && LNS_OPERATOR_SELECTION_POLICIES.has(value as LnsOperatorSelectionPolicy)
    ? value as LnsOperatorSelectionPolicy
    : "adaptive";
}

function operatorScoreDecayOrDefault(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : DEFAULT_LNS_OPERATOR_SCORE_DECAY;
}

function scoreRatioOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

function clampRepairBudgetToDeadline(repairTimeLimitSeconds: number, deadlineAtMs: number | null): number {
  if (deadlineAtMs === null) return repairTimeLimitSeconds;
  const remainingSeconds = (deadlineAtMs - performance.now()) / 1000;
  if (remainingSeconds <= 0) return 0;
  return Math.min(repairTimeLimitSeconds, remainingSeconds);
}

function getStaleSeconds(lastImprovementAtMs: number): number {
  return Math.max(0, (performance.now() - lastImprovementAtMs) / 1000);
}

function getEscalationTrigger(options: Pick<NormalizedLnsOptions, "maxNoImprovementIterations">): number {
  return Math.max(1, Math.ceil(options.maxNoImprovementIterations / 2));
}

function getRepairPhase(
  stagnantIterations: number,
  options: Pick<NormalizedLnsOptions, "maxNoImprovementIterations">
): LnsRepairPhase {
  return stagnantIterations + 1 >= getEscalationTrigger(options) ? "escalated" : "focused";
}

function getLnsOptions(G: Grid, params: SolverParams): NormalizedLnsOptions {
  const H = height(G);
  const W = width(G);
  const lns = params.lns ?? {};
  const repairableRows = H > 1 ? H - 1 : H;
  const repairTimeLimitSeconds = positiveFiniteNumberOrDefault(
    lns.repairTimeLimitSeconds,
    positiveFiniteNumberOrDefault(params.cpSat?.timeLimitSeconds, DEFAULT_LNS_REPAIR_TIME_LIMIT_SECONDS)
  );
  const wallClockLimitSeconds = optionalPositiveFiniteNumber(lns.wallClockLimitSeconds)
    ?? optionalPositiveFiniteNumber(lns.timeLimitSeconds);
  return {
    iterations: positiveIntegerOrDefault(lns.iterations, DEFAULT_LNS_ITERATIONS),
    maxNoImprovementIterations: positiveIntegerOrDefault(
      lns.maxNoImprovementIterations,
      DEFAULT_LNS_MAX_NO_IMPROVEMENT_ITERATIONS
    ),
    wallClockLimitSeconds,
    noImprovementTimeoutSeconds: optionalPositiveFiniteNumber(lns.noImprovementTimeoutSeconds),
    seedTimeLimitSeconds: optionalPositiveFiniteNumber(lns.seedTimeLimitSeconds)
      ?? (wallClockLimitSeconds === null ? null : Math.max(0.1, Math.min(wallClockLimitSeconds * 0.2, repairTimeLimitSeconds))),
    neighborhoodRows: Math.max(
      1,
      Math.min(repairableRows || 1, positiveIntegerOrDefault(lns.neighborhoodRows, Math.max(4, Math.ceil(H / 2))))
    ),
    neighborhoodCols: Math.max(
      1,
      Math.min(W || 1, positiveIntegerOrDefault(lns.neighborhoodCols, Math.max(4, Math.ceil(W / 2))))
    ),
    neighborhoodAnchorPolicy: lnsNeighborhoodAnchorPolicyOrDefault(lns.neighborhoodAnchorPolicy),
    operatorSelectionPolicy: lnsOperatorSelectionPolicyOrDefault(lns.operatorSelectionPolicy),
    operatorExplorationInterval: positiveIntegerOrDefault(
      lns.operatorExplorationInterval,
      DEFAULT_LNS_OPERATOR_EXPLORATION_INTERVAL
    ),
    operatorScoreDecay: operatorScoreDecayOrDefault(lns.operatorScoreDecay),
    learnedWindowRanking: lns.learnedWindowRanking === true,
    learnedWindowRankingCandidateLimit: positiveIntegerOrDefault(
      lns.learnedWindowRankingCandidateLimit,
      DEFAULT_LNS_LEARNED_WINDOW_RANKING_CANDIDATE_LIMIT
    ),
    learnedWindowRankingMinScoreRatio: scoreRatioOrDefault(
      lns.learnedWindowRankingMinScoreRatio,
      DEFAULT_LNS_LEARNED_WINDOW_RANKING_MIN_SCORE_RATIO
    ),
    repairTimeLimitSeconds,
    focusedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(lns.focusedRepairTimeLimitSeconds, repairTimeLimitSeconds),
    escalatedRepairTimeLimitSeconds: positiveFiniteNumberOrDefault(
      lns.escalatedRepairTimeLimitSeconds,
      repairTimeLimitSeconds
    ),
    smallWindowDpRepair: lns.smallWindowDpRepair === true,
    smallWindowDpMaxCells: positiveIntegerOrDefault(
      lns.smallWindowDpMaxCells,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CELLS
    ),
    smallWindowDpMaxCandidates: positiveIntegerOrDefault(
      lns.smallWindowDpMaxCandidates,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_CANDIDATES
    ),
    smallWindowDpMaxStates: positiveIntegerOrDefault(
      lns.smallWindowDpMaxStates,
      DEFAULT_LNS_SMALL_WINDOW_DP_MAX_STATES
    ),
    seedHint: lns.seedHint,
    stopFilePath: lns.stopFilePath ?? "",
    snapshotFilePath: lns.snapshotFilePath ?? "",
  };
}

function serviceCandidateKey(solution: Solution, index: number): string {
  const service = normalizeServicePlacement(solution.services[index]);
  const typeIndex = solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX;
  return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
}

function residentialCandidateKey(solution: Solution, index: number): string {
  const residential = solution.residentials[index];
  const typeIndex = solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX;
  return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
}

export function buildLnsWarmStartHint(solution: Solution, neighborhoodWindow: CpSatNeighborhoodWindow): CpSatWarmStartHint {
  const roadKeys = Array.from(solution.roads);
  return {
    sourceName: "lns-incumbent",
    roadKeys,
    serviceCandidateKeys: solution.services.map((_, index) => serviceCandidateKey(solution, index)),
    residentialCandidateKeys: solution.residentials.map((_, index) => residentialCandidateKey(solution, index)),
    solution: {
      roads: roadKeys,
      services: solution.services.map((service, index) => {
        const normalized = normalizeServicePlacement(service);
        return {
          r: normalized.r,
          c: normalized.c,
          rows: normalized.rows,
          cols: normalized.cols,
          range: normalized.range,
          typeIndex: solution.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
          bonus: solution.servicePopulationIncreases[index] ?? 0,
        };
      }),
      residentials: solution.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: solution.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: solution.populations[index] ?? 0,
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation,
    },
    // Keep the incumbent as a regular warm start, but avoid OR-Tools' repair_hint
    // path here because it has been crashing inside MinimizeL1DistanceWithHint().
    neighborhoodWindow,
    fixOutsideNeighborhoodToHintedValue: true,
  };
}
export { buildNeighborhoodCandidates, buildNeighborhoodWindows } from "./neighborhoods.js";

function shouldStop(stopFilePath: string): boolean {
  return Boolean(stopFilePath) && existsSync(stopFilePath);
}

function isRecoverableRepairFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /No feasible solution found with CP-SAT\./.test(error.message);
}

function buildInitialLnsIncumbent(G: Grid, params: SolverParams, options: NormalizedLnsOptions): InitialLnsIncumbent {
  const startedAt = performance.now();
  const seededIncumbent = materializeValidLnsSeedSolution(G, params, params.lns?.seedHint);
  if (seededIncumbent) {
    return {
      solution: applyDeterministicDominanceUpgrades(G, params, seededIncumbent),
      seedSource: "hint",
      seedWallClockSeconds: (performance.now() - startedAt) / 1000,
    };
  }

  const initialIncumbent = {
    ...solveGreedy(G, {
      ...params,
      optimizer: "greedy",
      greedy: {
        ...(params.greedy ?? {}),
        profile: params.greedy?.profile ?? true,
        ...(options.seedTimeLimitSeconds !== null ? { timeLimitSeconds: options.seedTimeLimitSeconds } : {}),
        ...(options.stopFilePath ? { stopFilePath: options.stopFilePath } : {}),
      },
    }),
    optimizer: "lns" as const,
  };
  return {
    solution: applyDeterministicDominanceUpgrades(G, params, initialIncumbent),
    seedSource: "greedy",
    seedWallClockSeconds: (performance.now() - startedAt) / 1000,
  };
}

function createOperatorScoreState(): Map<LnsRepairOperatorName, LnsOperatorScoreState> {
  return new Map(LNS_REPAIR_OPERATOR_NAMES.map((name) => [
    name,
    {
      name,
      attempts: 0,
      improvements: 0,
      neutralRepairs: 0,
      recoverableFailures: 0,
      skippedIterations: 0,
      reward: 0,
      score: 0,
      lastSelectedIteration: null,
    },
  ]));
}

function getOperatorState(
  scores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  operatorName: LnsRepairOperatorName
): LnsOperatorScoreState {
  const existing = scores.get(operatorName);
  if (existing) return existing;
  const created: LnsOperatorScoreState = {
    name: operatorName,
    attempts: 0,
    improvements: 0,
    neutralRepairs: 0,
    recoverableFailures: 0,
    skippedIterations: 0,
    reward: 0,
    score: 0,
    lastSelectedIteration: null,
  };
  scores.set(operatorName, created);
  return created;
}

function materializeOperatorScores(
  scores: Map<LnsRepairOperatorName, LnsOperatorScoreState>
): LnsOperatorScoreTelemetry[] {
  return [...scores.values()].map((score) => ({ ...score }));
}

function neighborhoodWindowKey(window: CpSatNeighborhoodWindow): string {
  return `${window.top}:${window.left}:${window.rows}:${window.cols}`;
}

function roundOperatorScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function updateOperatorScores(
  scores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  operatorName: LnsRepairOperatorName,
  iteration: number,
  status: LnsNeighborhoodOutcomeStatus,
  improvement: number,
  options: Pick<NormalizedLnsOptions, "operatorScoreDecay">
): number {
  for (const score of scores.values()) {
    score.score = roundOperatorScore(score.score * options.operatorScoreDecay);
  }

  const selected = getOperatorState(scores, operatorName);
  selected.attempts += 1;
  selected.lastSelectedIteration = iteration;
  if (status === "improved") {
    selected.improvements += 1;
    selected.reward = roundOperatorScore(selected.reward + Math.max(1, improvement));
    selected.score = roundOperatorScore(selected.score + Math.max(1, improvement));
  } else if (status === "neutral") {
    selected.neutralRepairs += 1;
    selected.score = roundOperatorScore(selected.score - 0.25);
  } else if (status === "recoverable-failure") {
    selected.recoverableFailures += 1;
    selected.score = roundOperatorScore(selected.score - 0.75);
  } else if (status === "skipped-budget" || status === "stopped") {
    selected.skippedIterations += 1;
    selected.score = roundOperatorScore(selected.score - 0.1);
  }
  return selected.score;
}

function scoreAdaptiveNeighborhoodCandidate(
  candidate: ReturnType<typeof buildNeighborhoodCandidates>[number],
  operatorScores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  windowAttemptCounts: ReadonlyMap<string, number>
): number {
  const candidateOperatorScore = getOperatorState(operatorScores, candidate.operatorName).score;
  const candidateAttemptPenalty = (windowAttemptCounts.get(neighborhoodWindowKey(candidate.window)) ?? 0) * 1_000_000;
  return candidate.score + candidateOperatorScore * 1000 - candidateAttemptPenalty;
}

function selectNeighborhoodCandidate(
  candidates: ReturnType<typeof buildNeighborhoodCandidates>,
  iteration: number,
  stagnantIterations: number,
  options: NormalizedLnsOptions,
  operatorScores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  windowAttemptCounts: ReadonlyMap<string, number>
): ReturnType<typeof buildNeighborhoodCandidates>[number] {
  if (options.operatorSelectionPolicy === "legacy") {
    const selectedWindow = selectNeighborhoodWindow(
      candidates.map((candidate) => candidate.window),
      iteration,
      stagnantIterations,
      options
    );
    return candidates.find((candidate) =>
      candidate.window.top === selectedWindow.top
      && candidate.window.left === selectedWindow.left
      && candidate.window.rows === selectedWindow.rows
      && candidate.window.cols === selectedWindow.cols
    ) ?? candidates[0]!;
  }

  if (new Set(candidates.map((candidate) => candidate.operatorName)).size === 1) {
    const selectedWindow = selectNeighborhoodWindow(
      candidates.map((candidate) => candidate.window),
      iteration,
      stagnantIterations,
      options
    );
    return candidates.find((candidate) =>
      candidate.window.top === selectedWindow.top
      && candidate.window.left === selectedWindow.left
      && candidate.window.rows === selectedWindow.rows
      && candidate.window.cols === selectedWindow.cols
    ) ?? candidates[0]!;
  }

  const repairAttempt = stagnantIterations + 1;
  if (repairAttempt >= options.maxNoImprovementIterations) {
    return candidates.reduce((best, candidate) => {
      const bestArea = best.window.rows * best.window.cols;
      const candidateArea = candidate.window.rows * candidate.window.cols;
      if (candidateArea !== bestArea) return candidateArea > bestArea ? candidate : best;
      if (candidate.window.rows !== best.window.rows) return candidate.window.rows > best.window.rows ? candidate : best;
      if (candidate.window.cols !== best.window.cols) return candidate.window.cols > best.window.cols ? candidate : best;
      if (candidate.score !== best.score) return candidate.score > best.score ? candidate : best;
      return best;
    });
  }

  const explorationDue = iteration > 0
    && options.operatorExplorationInterval > 0
    && (iteration + 1) % options.operatorExplorationInterval === 0;
  if (explorationDue) {
    const explorationCandidates = candidates.filter((candidate) => candidate.exploration);
    if (explorationCandidates.length > 0) {
      return explorationCandidates[iteration % explorationCandidates.length]!;
    }
  }

  return candidates.reduce((best, candidate) => {
    const candidateAdaptiveScore = scoreAdaptiveNeighborhoodCandidate(candidate, operatorScores, windowAttemptCounts);
    const bestAdaptiveScore = scoreAdaptiveNeighborhoodCandidate(best, operatorScores, windowAttemptCounts);
    if (candidateAdaptiveScore !== bestAdaptiveScore) {
      return candidateAdaptiveScore > bestAdaptiveScore ? candidate : best;
    }
    return best;
  });
}

interface LearnedNeighborhoodCandidatePlan {
  candidate: ReturnType<typeof buildNeighborhoodCandidates>[number];
  windowIndex: number;
  adaptiveScore: number;
}

interface LearnedNeighborhoodSelection {
  candidate: ReturnType<typeof buildNeighborhoodCandidates>[number];
  evaluations: number;
  displaced: boolean;
  learnedWindowRankingScore: number;
  learnedWindowRankingBaselineScore: number;
  learnedWindowRankingSelectedAdaptiveScore: number;
  learnedWindowRankingBaselineAdaptiveScore: number;
  learnedWindowRankingCandidateCount: number;
  learnedWindowRankingShortlistCount: number;
}

function sameNeighborhoodWindow(left: CpSatNeighborhoodWindow, right: CpSatNeighborhoodWindow): boolean {
  return left.top === right.top
    && left.left === right.left
    && left.rows === right.rows
    && left.cols === right.cols;
}

function buildUniqueLearnedCandidatePlans(
  candidates: ReturnType<typeof buildNeighborhoodCandidates>,
  operatorScores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  windowAttemptCounts: ReadonlyMap<string, number>
): LearnedNeighborhoodCandidatePlan[] {
  const plans = new Map<string, LearnedNeighborhoodCandidatePlan>();
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex]!;
    const key = neighborhoodWindowKey(candidate.window);
    if (plans.has(key)) continue;
    plans.set(key, {
      candidate,
      windowIndex: plans.size,
      adaptiveScore: scoreAdaptiveNeighborhoodCandidate(candidate, operatorScores, windowAttemptCounts),
    });
  }
  return [...plans.values()];
}

function selectLearnedNeighborhoodCandidate(
  G: Grid,
  params: SolverParams,
  incumbent: Solution,
  candidates: ReturnType<typeof buildNeighborhoodCandidates>,
  baselineCandidate: ReturnType<typeof buildNeighborhoodCandidates>[number],
  options: NormalizedLnsOptions,
  operatorScores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  windowAttemptCounts: ReadonlyMap<string, number>
): LearnedNeighborhoodSelection {
  const plans = buildUniqueLearnedCandidatePlans(candidates, operatorScores, windowAttemptCounts);
  const baselinePlan = plans.find((plan) => sameNeighborhoodWindow(plan.candidate.window, baselineCandidate.window)) ?? {
    candidate: baselineCandidate,
    windowIndex: 0,
    adaptiveScore: scoreAdaptiveNeighborhoodCandidate(baselineCandidate, operatorScores, windowAttemptCounts),
  };
  const shortlist = plans
    .slice()
    .sort((left, right) => {
      if (right.adaptiveScore !== left.adaptiveScore) return right.adaptiveScore - left.adaptiveScore;
      return left.windowIndex - right.windowIndex;
    })
    .slice(0, options.learnedWindowRankingCandidateLimit);
  if (!shortlist.some((plan) => sameNeighborhoodWindow(plan.candidate.window, baselineCandidate.window))) {
    shortlist.push(baselinePlan);
  }

  const scored = shortlist.map((plan) => ({
    plan,
    score: scoreLearnedLnsWindowCandidate(buildLearnedLnsWindowFeatures(G, params, incumbent, plan.candidate, {
      candidateWindowCount: plans.length,
      windowIndex: plan.windowIndex,
      selectedByBaseline: sameNeighborhoodWindow(plan.candidate.window, baselineCandidate.window),
    })),
  }));
  const baselineScored = scored.find((entry) =>
    sameNeighborhoodWindow(entry.plan.candidate.window, baselineCandidate.window)
  ) ?? {
    plan: baselinePlan,
    score: scoreLearnedLnsWindowCandidate(buildLearnedLnsWindowFeatures(G, params, incumbent, baselineCandidate, {
      candidateWindowCount: plans.length,
      windowIndex: baselinePlan.windowIndex,
      selectedByBaseline: true,
    })),
  };
  const best = scored.reduce((currentBest, entry) => entry.score > currentBest.score ? entry : currentBest, baselineScored);
  const passesAdaptiveGuard = options.learnedWindowRankingMinScoreRatio <= 0
    || best.plan.adaptiveScore >= baselinePlan.adaptiveScore * options.learnedWindowRankingMinScoreRatio;
  const selected = passesAdaptiveGuard ? best : baselineScored;
  const displaced = !sameNeighborhoodWindow(selected.plan.candidate.window, baselineCandidate.window);
  return {
    candidate: displaced ? selected.plan.candidate : baselineCandidate,
    evaluations: scored.length,
    displaced,
    learnedWindowRankingScore: selected.score,
    learnedWindowRankingBaselineScore: baselineScored.score,
    learnedWindowRankingSelectedAdaptiveScore: selected.plan.adaptiveScore,
    learnedWindowRankingBaselineAdaptiveScore: baselinePlan.adaptiveScore,
    learnedWindowRankingCandidateCount: plans.length,
    learnedWindowRankingShortlistCount: shortlist.length,
  };
}

function buildLnsTelemetry(
  stopReason: LnsStopReason,
  options: NormalizedLnsOptions,
  initialIncumbent: InitialLnsIncumbent,
  startedAtMs: number,
  stagnantIterations: number,
  outcomes: LnsTelemetry["outcomes"],
  operatorScores: Map<LnsRepairOperatorName, LnsOperatorScoreState>,
  learnedWindowRankingEvaluations: number,
  learnedWindowRankingWins: number
): LnsTelemetry {
  return {
    stopReason,
    seedSource: initialIncumbent.seedSource,
    seedWallClockSeconds: initialIncumbent.seedWallClockSeconds,
    seedTimeLimitSeconds: options.seedTimeLimitSeconds,
    wallClockLimitSeconds: options.wallClockLimitSeconds,
    noImprovementTimeoutSeconds: options.noImprovementTimeoutSeconds,
    focusedRepairTimeLimitSeconds: options.focusedRepairTimeLimitSeconds,
    escalatedRepairTimeLimitSeconds: options.escalatedRepairTimeLimitSeconds,
    iterationsStarted: outcomes.filter((outcome) => outcome.status !== "skipped-budget").length,
    iterationsCompleted: outcomes.filter((outcome) => outcome.status !== "skipped-budget" && outcome.status !== "stopped").length,
    improvingIterations: outcomes.filter((outcome) => outcome.status === "improved").length,
    neutralIterations: outcomes.filter((outcome) => outcome.status === "neutral").length,
    recoverableFailures: outcomes.filter((outcome) => outcome.status === "recoverable-failure").length,
    skippedIterations: outcomes.filter((outcome) => outcome.status === "skipped-budget" || outcome.status === "stopped").length,
    finalStagnantIterations: stagnantIterations,
    elapsedSeconds: (performance.now() - startedAtMs) / 1000,
    operatorSelectionPolicy: options.operatorSelectionPolicy,
    learnedWindowRankingEnabled: options.learnedWindowRanking,
    learnedWindowRankingModelVersion: options.learnedWindowRanking ? PHASE12_LNS_WINDOW_RANKER_VERSION : null,
    learnedWindowRankingModelFingerprint: options.learnedWindowRanking ? PHASE12_LNS_WINDOW_RANKER_FINGERPRINT : null,
    learnedWindowRankingCandidateLimit: options.learnedWindowRankingCandidateLimit,
    learnedWindowRankingMinScoreRatio: options.learnedWindowRankingMinScoreRatio,
    learnedWindowRankingEvaluations,
    learnedWindowRankingWins,
    operatorScores: materializeOperatorScores(operatorScores),
    outcomes: [...outcomes],
  };
}

function materializeLnsSolution(
  incumbent: Solution,
  telemetry: LnsTelemetry,
  stoppedByUser = false
): Solution {
  const solutionStoppedByUser = stoppedByUser || Boolean(incumbent.stoppedByUser);
  return {
    ...incumbent,
    optimizer: "lns",
    lnsTelemetry: telemetry,
    ...(solutionStoppedByUser ? { stoppedByUser: true } : {}),
  };
}

function writeLnsSnapshot(
  options: NormalizedLnsOptions,
  incumbent: Solution,
  telemetry: LnsTelemetry
): void {
  if (!options.snapshotFilePath) return;
  writeSolutionSnapshot(options.snapshotFilePath, materializeLnsSolution(incumbent, telemetry));
}

function buildRepairAttempt(input: Omit<LnsRepairAttempt, "startedAtMs"> & { startedAtMs?: number | null }): LnsRepairAttempt {
  return {
    ...input,
    startedAtMs: input.startedAtMs ?? null,
  };
}

function buildRepairOutcome(
  attempt: LnsRepairAttempt,
  status: LnsNeighborhoodOutcomeStatus,
  populationAfter: number,
  improvement = 0,
  cpSatStatus?: string | null,
  operatorScoreAfter?: number,
  repairBackend?: LnsRepairBackend,
  smallWindowDp?: LnsSmallWindowDpTelemetry
): LnsNeighborhoodOutcome {
  return {
    iteration: attempt.iteration,
    phase: attempt.phase,
    window: attempt.window,
    operatorName: attempt.operatorName,
    operatorScoreBefore: attempt.operatorScoreBefore,
    ...(operatorScoreAfter !== undefined ? { operatorScoreAfter } : {}),
    operatorExploration: attempt.operatorExploration,
    ...(attempt.learnedWindowRankingScore !== undefined ? {
      learnedWindowRankingScore: attempt.learnedWindowRankingScore,
      learnedWindowRankingModelVersion: PHASE12_LNS_WINDOW_RANKER_VERSION,
    } : {}),
    ...(attempt.learnedWindowRankingBaselineScore !== undefined ? {
      learnedWindowRankingBaselineScore: attempt.learnedWindowRankingBaselineScore,
    } : {}),
    ...(attempt.learnedWindowRankingSelectedAdaptiveScore !== undefined ? {
      learnedWindowRankingSelectedAdaptiveScore: attempt.learnedWindowRankingSelectedAdaptiveScore,
    } : {}),
    ...(attempt.learnedWindowRankingBaselineAdaptiveScore !== undefined ? {
      learnedWindowRankingBaselineAdaptiveScore: attempt.learnedWindowRankingBaselineAdaptiveScore,
    } : {}),
    ...(attempt.learnedWindowRankingCandidateCount !== undefined ? {
      learnedWindowRankingCandidateCount: attempt.learnedWindowRankingCandidateCount,
    } : {}),
    ...(attempt.learnedWindowRankingShortlistCount !== undefined ? {
      learnedWindowRankingShortlistCount: attempt.learnedWindowRankingShortlistCount,
    } : {}),
    ...(attempt.learnedWindowRankingDisplaced !== undefined ? {
      learnedWindowRankingDisplaced: attempt.learnedWindowRankingDisplaced,
    } : {}),
    stagnantIterationsBefore: attempt.stagnantIterationsBefore,
    staleSecondsBefore: attempt.staleSecondsBefore,
    repairTimeLimitSeconds: attempt.repairTimeLimitSeconds,
    wallClockSeconds: attempt.startedAtMs === null ? 0 : (performance.now() - attempt.startedAtMs) / 1000,
    populationBefore: attempt.populationBefore,
    populationAfter,
    improvement,
    status,
    ...(repairBackend !== undefined ? { repairBackend } : {}),
    ...(smallWindowDp !== undefined ? { smallWindowDp } : {}),
    ...(cpSatStatus !== undefined ? { cpSatStatus } : {}),
  };
}

export function solveLns(G: Grid, params: SolverParams): Solution {
  assertValidLnsOptions(params);
  const startedAtMs = performance.now();
  const options = getLnsOptions(G, params);
  const deadlineAtMs = options.wallClockLimitSeconds === null ? null : startedAtMs + options.wallClockLimitSeconds * 1000;
  const outcomes: LnsTelemetry["outcomes"] = [];
  const operatorScores = createOperatorScoreState();
  const windowAttemptCounts = new Map<string, number>();
  let learnedWindowRankingEvaluations = 0;
  let learnedWindowRankingWins = 0;

  const initialIncumbent = buildInitialLnsIncumbent(G, params, options);
  let incumbent = initialIncumbent.solution;
  let stagnantIterations = 0;
  let lastImprovementAtMs = performance.now();

  const buildTelemetry = (stopReason: LnsStopReason): LnsTelemetry =>
    buildLnsTelemetry(
      stopReason,
      options,
      initialIncumbent,
      startedAtMs,
      stagnantIterations,
      outcomes,
      operatorScores,
      learnedWindowRankingEvaluations,
      learnedWindowRankingWins
    );

  const writeRunningSnapshot = (): void => writeLnsSnapshot(options, incumbent, buildTelemetry("running"));

  const finish = (stopReason: LnsStopReason, stoppedByUser = false): Solution => {
    const telemetry = buildTelemetry(stopReason);
    writeLnsSnapshot(options, incumbent, telemetry);
    return materializeLnsSolution(incumbent, telemetry, stoppedByUser);
  };

  writeRunningSnapshot();

  if (shouldStop(options.stopFilePath)) {
    return finish("cancelled", true);
  }
  if (deadlineAtMs !== null && performance.now() >= deadlineAtMs) {
    return finish("wall-clock-limit");
  }

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    if (shouldStop(options.stopFilePath)) {
      return finish("cancelled", true);
    }

    if (deadlineAtMs !== null && performance.now() >= deadlineAtMs) {
      return finish("wall-clock-limit");
    }

    if (
      options.noImprovementTimeoutSeconds !== null
      && getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
    ) {
      return finish("stale-time-limit");
    }

    if (stagnantIterations >= options.maxNoImprovementIterations) {
      return finish("stale-iteration-limit");
    }

    const candidates = buildNeighborhoodCandidates(G, params, incumbent, options, stagnantIterations + 1);
    if (candidates.length === 0) {
      return finish("no-neighborhoods");
    }

    const baselineCandidate = selectNeighborhoodCandidate(
      candidates,
      iteration,
      stagnantIterations,
      options,
      operatorScores,
      windowAttemptCounts
    );
    const learnedSelection = options.learnedWindowRanking
      ? selectLearnedNeighborhoodCandidate(
          G,
          params,
          incumbent,
          candidates,
          baselineCandidate,
          options,
          operatorScores,
          windowAttemptCounts
        )
      : null;
    if (learnedSelection) {
      learnedWindowRankingEvaluations += learnedSelection.evaluations;
      if (learnedSelection.displaced) learnedWindowRankingWins += 1;
    }
    const candidate = learnedSelection?.candidate ?? baselineCandidate;
    const neighborhoodWindow = candidate.window;
    const selectedWindowKey = neighborhoodWindowKey(neighborhoodWindow);
    windowAttemptCounts.set(selectedWindowKey, (windowAttemptCounts.get(selectedWindowKey) ?? 0) + 1);
    const operatorScoreBefore = getOperatorState(operatorScores, candidate.operatorName).score;
    const phase = getRepairPhase(stagnantIterations, options);
    const configuredRepairTimeLimitSeconds = phase === "escalated"
      ? options.escalatedRepairTimeLimitSeconds
      : options.focusedRepairTimeLimitSeconds;
    const repairTimeLimitSeconds = clampRepairBudgetToDeadline(configuredRepairTimeLimitSeconds, deadlineAtMs);
    const populationBefore = incumbent.totalPopulation;
    const staleSecondsBefore = getStaleSeconds(lastImprovementAtMs);

    if (repairTimeLimitSeconds <= 0) {
      outcomes.push(buildRepairOutcome(buildRepairAttempt({
        iteration,
        phase,
        window: neighborhoodWindow,
        operatorName: candidate.operatorName,
        operatorScoreBefore,
        operatorExploration: candidate.exploration,
        ...(learnedSelection ? {
          learnedWindowRankingScore: learnedSelection.learnedWindowRankingScore,
          learnedWindowRankingBaselineScore: learnedSelection.learnedWindowRankingBaselineScore,
          learnedWindowRankingSelectedAdaptiveScore: learnedSelection.learnedWindowRankingSelectedAdaptiveScore,
          learnedWindowRankingBaselineAdaptiveScore: learnedSelection.learnedWindowRankingBaselineAdaptiveScore,
          learnedWindowRankingCandidateCount: learnedSelection.learnedWindowRankingCandidateCount,
          learnedWindowRankingShortlistCount: learnedSelection.learnedWindowRankingShortlistCount,
          learnedWindowRankingDisplaced: learnedSelection.displaced,
        } : {}),
        stagnantIterationsBefore: stagnantIterations,
        staleSecondsBefore,
        repairTimeLimitSeconds: 0,
        populationBefore,
      }), "skipped-budget", populationBefore, 0, undefined, updateOperatorScores(
        operatorScores,
        candidate.operatorName,
        iteration,
        "skipped-budget",
        0,
        options
      )));
      writeRunningSnapshot();
      return finish("wall-clock-limit");
    }

    const repairStartedAtMs = performance.now();
    const attempt = buildRepairAttempt({
      iteration,
      phase,
      window: neighborhoodWindow,
      operatorName: candidate.operatorName,
      operatorScoreBefore,
      operatorExploration: candidate.exploration,
      ...(learnedSelection ? {
        learnedWindowRankingScore: learnedSelection.learnedWindowRankingScore,
        learnedWindowRankingBaselineScore: learnedSelection.learnedWindowRankingBaselineScore,
        learnedWindowRankingSelectedAdaptiveScore: learnedSelection.learnedWindowRankingSelectedAdaptiveScore,
        learnedWindowRankingBaselineAdaptiveScore: learnedSelection.learnedWindowRankingBaselineAdaptiveScore,
        learnedWindowRankingCandidateCount: learnedSelection.learnedWindowRankingCandidateCount,
        learnedWindowRankingShortlistCount: learnedSelection.learnedWindowRankingShortlistCount,
        learnedWindowRankingDisplaced: learnedSelection.displaced,
      } : {}),
      stagnantIterationsBefore: stagnantIterations,
      staleSecondsBefore,
      repairTimeLimitSeconds,
      populationBefore,
      startedAtMs: repairStartedAtMs,
    });
    let repairBackend: LnsRepairBackend = "cp-sat";
    let smallWindowDpTelemetry: LnsSmallWindowDpTelemetry | undefined;
    try {
      let repaired: Solution | null = null;
      if (options.smallWindowDpRepair) {
        const dpRepair = solveSmallWindowDpRepair(G, params, incumbent, neighborhoodWindow, {
          maxWindowCells: options.smallWindowDpMaxCells,
          maxCandidates: options.smallWindowDpMaxCandidates,
          maxStates: options.smallWindowDpMaxStates,
        });
        smallWindowDpTelemetry = dpRepair.telemetry;
        if (dpRepair.solution) {
          repaired = dpRepair.solution;
          repairBackend = "small-window-dp";
        }
      }

      if (!repaired) {
        repaired = solveCpSat(G, {
          ...params,
          optimizer: "cp-sat",
          cpSat: {
            ...(params.cpSat ?? {}),
            // LNS repair is safer with a single worker; multi-worker repair_hint-style
            // search has been crashing in the local OR-Tools runtime.
            numWorkers: 1,
            timeLimitSeconds: repairTimeLimitSeconds,
            stopFilePath: options.stopFilePath || undefined,
            warmStartHint: buildLnsWarmStartHint(incumbent, neighborhoodWindow),
          },
        });
        repairBackend = "cp-sat";
      }

      if (repaired.totalPopulation > incumbent.totalPopulation) {
        incumbent = applyDeterministicDominanceUpgrades(G, params, {
          ...repaired,
          optimizer: "lns",
        });
        const populationAfter = incumbent.totalPopulation;
        const improvement = populationAfter - populationBefore;
        const operatorScoreAfter = updateOperatorScores(
          operatorScores,
          attempt.operatorName,
          iteration,
          "improved",
          improvement,
          options
        );
        outcomes.push(
          buildRepairOutcome(
            attempt,
            "improved",
            populationAfter,
            improvement,
            repaired.cpSatStatus ?? null,
            operatorScoreAfter,
            repairBackend,
            smallWindowDpTelemetry
          )
        );
        stagnantIterations = 0;
        lastImprovementAtMs = performance.now();
        writeRunningSnapshot();
        continue;
      }
      outcomes.push(buildRepairOutcome(
        attempt,
        "neutral",
        repaired.totalPopulation,
        0,
        repaired.cpSatStatus ?? null,
        updateOperatorScores(operatorScores, attempt.operatorName, iteration, "neutral", 0, options),
        repairBackend,
        smallWindowDpTelemetry
      ));
      stagnantIterations += 1;
      writeRunningSnapshot();
    } catch (error) {
      if (shouldStop(options.stopFilePath)) {
        outcomes.push(buildRepairOutcome(
          attempt,
          "stopped",
          populationBefore,
          0,
          undefined,
          updateOperatorScores(operatorScores, attempt.operatorName, iteration, "stopped", 0, options),
          repairBackend,
          smallWindowDpTelemetry
        ));
        return finish("cancelled", true);
      }
      if (isRecoverableRepairFailure(error)) {
        outcomes.push(buildRepairOutcome(
          attempt,
          "recoverable-failure",
          populationBefore,
          0,
          undefined,
          updateOperatorScores(operatorScores, attempt.operatorName, iteration, "recoverable-failure", 0, options),
          repairBackend,
          smallWindowDpTelemetry
        ));
        stagnantIterations += 1;
        writeRunningSnapshot();
        continue;
      }
      throw error;
    }
  }

  if (
    options.noImprovementTimeoutSeconds !== null
    && getStaleSeconds(lastImprovementAtMs) >= options.noImprovementTimeoutSeconds
  ) {
    return finish("stale-time-limit");
  }
  return finish(stagnantIterations >= options.maxNoImprovementIterations ? "stale-iteration-limit" : "iteration-limit");
}
