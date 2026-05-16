import { NO_TYPE_INDEX, normalizeServicePlacement } from "../../core/index.js";
import type { AutoStageOptimizerName, CpSatWarmStartHint, Solution, SolverParams } from "../../core/index.js";
import { buildAutoGreedyStageOptions, buildAutoLnsStageBudget, type NormalizedAutoOptions } from "./stagePolicy.js";

function stripAutoMetadata(solution: Solution): Solution {
  return {
    ...solution,
    activeOptimizer: undefined,
    autoStage: undefined
  };
}

export function solutionToLnsSeedHint(solution: Solution): CpSatWarmStartHint {
  const base = stripAutoMetadata(solution);
  const roadKeys = Array.from(base.roads);
  return {
    sourceName: "auto-incumbent",
    roadKeys,
    solution: {
      roads: roadKeys,
      services: base.services.map((service, index) => {
        const normalized = normalizeServicePlacement(service);
        return {
          r: normalized.r,
          c: normalized.c,
          rows: normalized.rows,
          cols: normalized.cols,
          range: normalized.range,
          typeIndex: base.serviceTypeIndices[index] ?? NO_TYPE_INDEX,
          bonus: base.servicePopulationIncreases[index] ?? 0
        };
      }),
      residentials: base.residentials.map((residential, index) => ({
        r: residential.r,
        c: residential.c,
        rows: residential.rows,
        cols: residential.cols,
        typeIndex: base.residentialTypeIndices[index] ?? NO_TYPE_INDEX,
        population: base.populations[index] ?? 0
      })),
      populations: [...base.populations],
      totalPopulation: base.totalPopulation
    },
    totalPopulation: base.totalPopulation,
    objectiveLowerBound: base.totalPopulation
  };
}

function isSolutionWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): value is Solution {
  return value !== undefined && value.roads instanceof Set;
}

function cloneWarmStartHint(value: CpSatWarmStartHint | Solution | undefined): CpSatWarmStartHint | undefined {
  if (!value) return undefined;
  if (isSolutionWarmStartHint(value)) {
    return solutionToLnsSeedHint(value);
  }
  return {
    ...value,
    ...(value.roadKeys ? { roadKeys: [...value.roadKeys] } : {}),
    ...(value.serviceCandidateKeys ? { serviceCandidateKeys: [...value.serviceCandidateKeys] } : {}),
    ...(value.residentialCandidateKeys ? { residentialCandidateKeys: [...value.residentialCandidateKeys] } : {}),
    ...(value.roads ? { roads: [...value.roads] } : {}),
    ...(value.services ? { services: value.services.map((service) => ({ ...service })) } : {}),
    ...(value.residentials ? { residentials: value.residentials.map((residential) => ({ ...residential })) } : {}),
    ...(value.solution
      ? {
          solution: {
            ...value.solution,
            ...(value.solution.roads ? { roads: [...value.solution.roads] } : {}),
            ...(value.solution.services
              ? { services: value.solution.services.map((service) => ({ ...service })) }
              : {}),
            ...(value.solution.residentials
              ? { residentials: value.solution.residentials.map((residential) => ({ ...residential })) }
              : {}),
            ...(value.solution.populations ? { populations: [...value.solution.populations] } : {})
          }
        }
      : {})
  };
}

function maxNumericValue(...values: Array<number | null | undefined>): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    best = best === undefined ? value : Math.max(best, value);
  }
  return best;
}

function buildAutoCpSatWarmStartHint(
  incumbent: Solution,
  existingWarmStartHint: CpSatWarmStartHint | Solution | undefined
): CpSatWarmStartHint {
  const incumbentHint = solutionToLnsSeedHint(incumbent);
  const mergedWarmStartHint = {
    ...(cloneWarmStartHint(existingWarmStartHint) ?? {}),
    ...incumbentHint,
    ...(incumbentHint.solution?.roads ? { roads: [...incumbentHint.solution.roads] } : {}),
    ...(incumbentHint.solution?.services
      ? { services: incumbentHint.solution.services.map((service) => ({ ...service })) }
      : {}),
    ...(incumbentHint.solution?.residentials
      ? { residentials: incumbentHint.solution.residentials.map((residential) => ({ ...residential })) }
      : {})
  };
  const mergedObjectiveLowerBound = maxNumericValue(
    cloneWarmStartHint(existingWarmStartHint)?.objectiveLowerBound,
    incumbentHint.objectiveLowerBound,
    incumbent.totalPopulation
  );
  return {
    ...mergedWarmStartHint,
    ...(mergedObjectiveLowerBound !== undefined ? { objectiveLowerBound: mergedObjectiveLowerBound } : {})
  };
}

export function stageSeedParams(
  params: SolverParams,
  stage: AutoStageOptimizerName,
  incumbent: Solution | null,
  generatedSeed: number,
  options: NormalizedAutoOptions,
  remainingSeconds: number | null,
  sharedStopFilePath?: string
): SolverParams {
  const { portfolio: _portfolio, ...stageCpSatOptions } = params.cpSat ?? {};
  const stageBaseParams: SolverParams = params.cpSat
    ? {
        ...params,
        cpSat: stageCpSatOptions
      }
    : params;

  if (stage === "greedy") {
    const greedy = buildAutoGreedyStageOptions(params);
    const configuredGreedyTimeLimit =
      typeof greedy.timeLimitSeconds === "number" &&
      Number.isFinite(greedy.timeLimitSeconds) &&
      greedy.timeLimitSeconds > 0
        ? greedy.timeLimitSeconds
        : undefined;
    const greedyTimeLimitSeconds =
      remainingSeconds === null
        ? configuredGreedyTimeLimit
        : Math.max(0.001, Math.min(configuredGreedyTimeLimit ?? remainingSeconds, remainingSeconds));
    return {
      ...stageBaseParams,
      optimizer: "greedy",
      greedy: {
        ...greedy,
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        ...(greedyTimeLimitSeconds !== undefined ? { timeLimitSeconds: greedyTimeLimitSeconds } : {}),
        randomSeed: generatedSeed
      }
    };
  }

  if (stage === "lns") {
    const lnsBudget = buildAutoLnsStageBudget(params, options, remainingSeconds);
    return {
      ...stageBaseParams,
      optimizer: "lns",
      cpSat: {
        ...stageCpSatOptions,
        randomSeed: generatedSeed
      },
      lns: {
        ...(params.lns ?? {}),
        ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
        seedHint: incumbent ? solutionToLnsSeedHint(incumbent) : params.lns?.seedHint,
        ...(lnsBudget.wallClockLimitSeconds !== null
          ? {
              wallClockLimitSeconds: lnsBudget.wallClockLimitSeconds,
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds
            }
          : {
              repairTimeLimitSeconds: lnsBudget.repairTimeLimitSeconds
            }),
        ...(lnsBudget.seedTimeLimitSeconds !== undefined
          ? { seedTimeLimitSeconds: lnsBudget.seedTimeLimitSeconds }
          : {}),
        ...(lnsBudget.iterations !== undefined ? { iterations: lnsBudget.iterations } : {}),
        ...(lnsBudget.maxNoImprovementIterations !== undefined
          ? { maxNoImprovementIterations: lnsBudget.maxNoImprovementIterations }
          : {}),
        focusedRepairTimeLimitSeconds: lnsBudget.focusedRepairTimeLimitSeconds,
        escalatedRepairTimeLimitSeconds: lnsBudget.escalatedRepairTimeLimitSeconds
      }
    };
  }

  const configuredTimeLimit = stageCpSatOptions.timeLimitSeconds ?? options.cpSatStageTimeLimitSeconds;
  const configuredNoImprovementTimeout =
    stageCpSatOptions.noImprovementTimeoutSeconds ?? options.cpSatStageNoImprovementTimeoutSeconds;
  const warmStartHint = incumbent
    ? buildAutoCpSatWarmStartHint(incumbent, stageCpSatOptions.warmStartHint)
    : stageCpSatOptions.warmStartHint;
  const cappedTimeLimit =
    remainingSeconds === null ? configuredTimeLimit : Math.max(0.001, Math.min(configuredTimeLimit, remainingSeconds));
  const objectiveLowerBound = maxNumericValue(
    stageCpSatOptions.objectiveLowerBound,
    cloneWarmStartHint(warmStartHint)?.objectiveLowerBound,
    incumbent?.totalPopulation
  );

  return {
    ...stageBaseParams,
    optimizer: "cp-sat",
    cpSat: {
      ...stageCpSatOptions,
      ...(sharedStopFilePath ? { stopFilePath: sharedStopFilePath } : {}),
      randomSeed: generatedSeed,
      timeLimitSeconds: cappedTimeLimit,
      noImprovementTimeoutSeconds: Math.max(0.001, Math.min(configuredNoImprovementTimeout, cappedTimeLimit)),
      ...(warmStartHint ? { warmStartHint } : {}),
      ...(objectiveLowerBound !== undefined ? { objectiveLowerBound } : {})
    }
  };
}
