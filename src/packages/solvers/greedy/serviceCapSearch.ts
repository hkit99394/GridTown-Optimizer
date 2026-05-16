import type { GreedyProfileCounters, Solution, SolverParams } from "../../core/index.js";

export type CapSearchPhase = "full" | "coarse" | "refine";

type CapResult = {
  cap: number;
  phase: CapSearchPhase;
  solution: Solution | null;
  totalPopulation: number;
  serviceCount: number;
};

type GreedyServiceCapPlan = {
  coarseCaps: number[];
  refineCaps: number[];
  usesAdaptiveSearch: boolean;
};

export interface GreedyServiceCapPolicy {
  explicitServiceCap: number | undefined;
  inferredUpper: number;
  capPlan: GreedyServiceCapPlan;
}

export type GreedyCapEvaluator = (
  cap: number,
  phase: CapSearchPhase,
  restartBudget: number,
  allowAnchorRefinement: boolean
) => Solution | null;

export type GreedyExistingCapRefiner = (
  cap: number,
  bestForCap: Solution | null,
  restartBudget: number,
  allowAnchorRefinement: boolean
) => Solution | null;

function dedupeSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function inclusiveCapBand(center: number, upper: number, radius: number): number[] {
  const out: number[] = [];
  for (let cap = Math.max(0, center - radius); cap <= Math.min(upper, center + radius); cap++) {
    out.push(cap);
  }
  return out;
}

function buildAdaptiveServiceCapPlan(inferredUpper: number): GreedyServiceCapPlan {
  if (inferredUpper <= 6) {
    return {
      coarseCaps: Array.from({ length: inferredUpper + 1 }, (_, index) => index),
      refineCaps: [],
      usesAdaptiveSearch: false
    };
  }

  return {
    coarseCaps: dedupeSortedNumbers([
      0,
      inferredUpper,
      Math.floor(inferredUpper / 4),
      Math.floor(inferredUpper / 2),
      Math.ceil((3 * inferredUpper) / 4)
    ]),
    refineCaps: [],
    usesAdaptiveSearch: true
  };
}

function compareCapResults(a: CapResult, b: CapResult): number {
  return b.totalPopulation - a.totalPopulation || a.serviceCount - b.serviceCount || a.cap - b.cap;
}

function summarizeCapResult(cap: number, phase: CapSearchPhase, solution: Solution | null): CapResult {
  return {
    cap,
    phase,
    solution,
    totalPopulation: solution?.totalPopulation ?? -1,
    serviceCount: solution?.services.length ?? Number.POSITIVE_INFINITY
  };
}

export function buildGreedyServiceCapPolicy(
  params: SolverParams,
  maxServices: number | undefined
): GreedyServiceCapPolicy {
  // Explicit service caps are maxima, so lower counts remain eligible when extra services block housing.
  const explicitServiceCap = maxServices;
  const positiveBonuses = (params.serviceTypes ?? []).reduce(
    (sum, type) => sum + (type.bonus > 0 ? Math.max(0, type.avail) : 0),
    0
  );
  const totalServiceAvail = (params.serviceTypes ?? []).reduce((sum, type) => sum + Math.max(0, type.avail), 0);
  const serviceAvailabilityUpper =
    positiveBonuses > 0 ? Math.min(totalServiceAvail, positiveBonuses) : totalServiceAvail;
  const inferredUpper =
    explicitServiceCap !== undefined
      ? Math.min(explicitServiceCap, serviceAvailabilityUpper)
      : serviceAvailabilityUpper;
  const capPlan =
    explicitServiceCap !== undefined
      ? {
          coarseCaps: Array.from({ length: inferredUpper + 1 }, (_, cap) => cap),
          refineCaps: [],
          usesAdaptiveSearch: false
        }
      : buildAdaptiveServiceCapPlan(inferredUpper);
  return {
    explicitServiceCap,
    inferredUpper,
    capPlan
  };
}

export function runGreedyServiceCapSearch(options: {
  policy: GreedyServiceCapPolicy;
  restarts: number;
  profileCounters?: GreedyProfileCounters;
  evaluateNewCap: GreedyCapEvaluator;
  refineExistingCap: GreedyExistingCapRefiner;
}): void {
  const { policy, restarts, profileCounters, evaluateNewCap, refineExistingCap } = options;
  const { explicitServiceCap, inferredUpper, capPlan } = policy;
  const capResultsByCap = new Map<number, CapResult>();
  const evaluatedCaps = new Set<number>();

  if (explicitServiceCap !== undefined || !capPlan.usesAdaptiveSearch) {
    for (const cap of capPlan.coarseCaps) {
      const solution = evaluateNewCap(cap, "full", restarts, true);
      evaluatedCaps.add(cap);
      capResultsByCap.set(cap, summarizeCapResult(cap, "full", solution));
    }
    return;
  }

  for (const cap of capPlan.coarseCaps) {
    const solution = evaluateNewCap(cap, "coarse", 1, false);
    evaluatedCaps.add(cap);
    capResultsByCap.set(cap, summarizeCapResult(cap, "coarse", solution));
  }

  const coarseResults = [...capResultsByCap.values()]
    .filter((entry) => entry.phase === "coarse")
    .sort(compareCapResults);
  const focusCaps = new Set(coarseResults.slice(0, 2).map((entry) => entry.cap));
  const refineCaps = dedupeSortedNumbers([...focusCaps].flatMap((cap) => inclusiveCapBand(cap, inferredUpper, 2)));
  const refineCapSet = new Set(refineCaps);

  for (const cap of refineCaps) {
    if (evaluatedCaps.has(cap)) {
      if (profileCounters) profileCounters.attempts.refineCaps++;
      const current = capResultsByCap.get(cap)?.solution ?? null;
      capResultsByCap.set(cap, summarizeCapResult(cap, "refine", current));
      continue;
    }
    const solution = evaluateNewCap(cap, "refine", 1, false);
    evaluatedCaps.add(cap);
    capResultsByCap.set(cap, summarizeCapResult(cap, "refine", solution));
  }

  const restartFocusCaps = dedupeSortedNumbers([
    ...[...capResultsByCap.values()]
      .filter((entry) => refineCapSet.has(entry.cap))
      .sort(compareCapResults)
      .slice(0, 2)
      .map((entry) => entry.cap),
    ...[...focusCaps].flatMap((cap) => inclusiveCapBand(cap, inferredUpper, 1).filter((neighbor) => neighbor > 0))
  ]);

  for (const cap of restartFocusCaps) {
    const current = capResultsByCap.get(cap)?.solution ?? null;
    const refined = refineExistingCap(cap, current, restarts, true);
    capResultsByCap.set(cap, summarizeCapResult(cap, "refine", refined));
  }

  if (profileCounters) {
    profileCounters.attempts.capsSkipped += Math.max(0, inferredUpper + 1 - evaluatedCaps.size);
  }
}
