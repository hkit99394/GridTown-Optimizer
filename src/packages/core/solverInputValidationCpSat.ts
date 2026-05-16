import { CP_SAT_PORTFOLIO_CAPABILITY_LIMITS } from "./capabilities.js";

import type { OptimizerName, SolverParams } from "./types.js";

import {
  SolverInputError,
  assertValidCpSatWarmStartHint,
  describeIntegerRange,
  getOptionalFinitePositiveNumber,
  getOptionalIntegerInRange,
  isInteger,
  requireOptionalBoolean,
  requireOptionalFiniteNumber,
  requireOptionalFiniteNumberInRange,
  requireOptionalIntegerForValidation,
  requireOptionalIntegerInRange,
  requireOptionalString,
  requireValidationArray,
  requireValidationRecord
} from "./solverInputValidationShared.js";

const CP_SAT_MAX_TIME_LIMIT_SECONDS = 24 * 60 * 60;
const CP_SAT_MAX_NUM_WORKERS = 64;
const CP_SAT_RANDOM_SEED_MAX = 0x7fffffff;
const CP_SAT_PORTFOLIO_MAX_WORKERS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxWorkers;
const CP_SAT_PORTFOLIO_MAX_TOTAL_WORKER_THREADS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalWorkerThreads;
const CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalCpuBudgetSeconds;

function assertValidCpSatPortfolioOptions(value: unknown, path: string, cpSat: Record<string, unknown>): void {
  const portfolio = requireValidationRecord(value, path);

  requireOptionalIntegerInRange(portfolio, "workerCount", `${path}.workerCount`, 1, CP_SAT_PORTFOLIO_MAX_WORKERS);

  let randomSeedCount: number | undefined;
  if (portfolio.randomSeeds !== undefined) {
    const randomSeeds = requireValidationArray(portfolio.randomSeeds, `${path}.randomSeeds`);
    if (randomSeeds.length === 0 || randomSeeds.length > CP_SAT_PORTFOLIO_MAX_WORKERS) {
      throw new SolverInputError(
        `${path}.randomSeeds must contain between 1 and ${CP_SAT_PORTFOLIO_MAX_WORKERS} seeds.`
      );
    }
    randomSeeds.forEach((seed, index) => {
      if (!isInteger(seed) || seed > CP_SAT_RANDOM_SEED_MAX) {
        throw new SolverInputError(
          `${path}.randomSeeds[${index}] must be ${describeIntegerRange(0, CP_SAT_RANDOM_SEED_MAX)}.`
        );
      }
    });
    if (new Set(randomSeeds).size !== randomSeeds.length) {
      throw new SolverInputError(`${path}.randomSeeds must not contain duplicate seeds.`);
    }
    randomSeedCount = randomSeeds.length;
  }

  requireOptionalFiniteNumberInRange(
    portfolio,
    "totalCpuBudgetSeconds",
    `${path}.totalCpuBudgetSeconds`,
    0,
    CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    portfolio,
    "perWorkerTimeLimitSeconds",
    `${path}.perWorkerTimeLimitSeconds`,
    0,
    CP_SAT_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    portfolio,
    "perWorkerMaxDeterministicTime",
    `${path}.perWorkerMaxDeterministicTime`,
    0,
    CP_SAT_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalIntegerInRange(
    portfolio,
    "perWorkerNumWorkers",
    `${path}.perWorkerNumWorkers`,
    1,
    CP_SAT_MAX_NUM_WORKERS
  );
  requireOptionalBoolean(portfolio, "randomizeSearch", `${path}.randomizeSearch`);

  const resolvedWorkerCount =
    randomSeedCount ??
    getOptionalIntegerInRange(portfolio, "workerCount", 1, CP_SAT_PORTFOLIO_MAX_WORKERS) ??
    Math.min(4, CP_SAT_PORTFOLIO_MAX_WORKERS);
  const perWorkerNumWorkers =
    getOptionalIntegerInRange(portfolio, "perWorkerNumWorkers", 1, CP_SAT_MAX_NUM_WORKERS) ?? 1;
  const requestedWorkerThreads = resolvedWorkerCount * perWorkerNumWorkers;
  if (requestedWorkerThreads > CP_SAT_PORTFOLIO_MAX_TOTAL_WORKER_THREADS) {
    throw new SolverInputError(
      `${path} requests ${requestedWorkerThreads} parallel CP-SAT workers, exceeding the ${CP_SAT_PORTFOLIO_MAX_TOTAL_WORKER_THREADS} worker portfolio limit.`
    );
  }

  const perWorkerTimeLimitSeconds =
    getOptionalFinitePositiveNumber(portfolio, "perWorkerTimeLimitSeconds") ??
    getOptionalFinitePositiveNumber(cpSat, "timeLimitSeconds");

  const configuredCpuBudget = getOptionalFinitePositiveNumber(portfolio, "totalCpuBudgetSeconds");
  if (perWorkerTimeLimitSeconds === undefined) {
    if (configuredCpuBudget !== undefined) {
      throw new SolverInputError(
        `${path}.totalCpuBudgetSeconds requires cpSat.timeLimitSeconds or ${path}.perWorkerTimeLimitSeconds.`
      );
    }
    return;
  }

  const cpuBudgetLimit = Math.min(
    configuredCpuBudget ?? CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS,
    CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS
  );
  const requestedCpuSeconds = resolvedWorkerCount * perWorkerNumWorkers * perWorkerTimeLimitSeconds;
  if (requestedCpuSeconds > cpuBudgetLimit) {
    throw new SolverInputError(
      `${path} requests ${requestedCpuSeconds} total CPU seconds, exceeding the ${cpuBudgetLimit} second portfolio budget.`
    );
  }
}

export function assertValidCpSatOptions(params: SolverParams, optimizer: OptimizerName): void {
  const cpSatValue = (params as Record<string, unknown>).cpSat;
  if (cpSatValue === undefined) return;

  const cpSat = requireValidationRecord(cpSatValue, "CP-SAT options cpSat");
  requireOptionalString(cpSat, "pythonExecutable", "CP-SAT runtime option cpSat.pythonExecutable");
  requireOptionalString(cpSat, "scriptPath", "CP-SAT runtime option cpSat.scriptPath");
  requireOptionalFiniteNumberInRange(
    cpSat,
    "timeLimitSeconds",
    "CP-SAT runtime option cpSat.timeLimitSeconds",
    0,
    CP_SAT_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalFiniteNumberInRange(
    cpSat,
    "maxDeterministicTime",
    "CP-SAT runtime option cpSat.maxDeterministicTime",
    0,
    CP_SAT_MAX_TIME_LIMIT_SECONDS
  );
  requireOptionalIntegerInRange(
    cpSat,
    "numWorkers",
    "CP-SAT runtime option cpSat.numWorkers",
    1,
    CP_SAT_MAX_NUM_WORKERS
  );
  requireOptionalIntegerInRange(
    cpSat,
    "randomSeed",
    "CP-SAT runtime option cpSat.randomSeed",
    0,
    CP_SAT_RANDOM_SEED_MAX
  );
  if ("roadConnectivityMode" in cpSat) {
    throw new SolverInputError(
      "CP-SAT runtime option cpSat.roadConnectivityMode is no longer supported; CP-SAT always uses anchor-components road connectivity."
    );
  }
  requireOptionalBoolean(cpSat, "randomizeSearch", "CP-SAT runtime option cpSat.randomizeSearch");
  requireOptionalFiniteNumber(cpSat, "relativeGapLimit", "CP-SAT runtime option cpSat.relativeGapLimit", 0, true);
  requireOptionalFiniteNumber(cpSat, "absoluteGapLimit", "CP-SAT runtime option cpSat.absoluteGapLimit", 0, true);
  requireOptionalFiniteNumber(
    cpSat,
    "noImprovementTimeoutSeconds",
    "CP-SAT runtime option cpSat.noImprovementTimeoutSeconds",
    0
  );
  requireOptionalIntegerForValidation(cpSat, "objectiveLowerBound", "CP-SAT runtime option cpSat.objectiveLowerBound");
  requireOptionalBoolean(cpSat, "streamProgress", "CP-SAT runtime option cpSat.streamProgress");
  requireOptionalFiniteNumber(
    cpSat,
    "progressIntervalSeconds",
    "CP-SAT runtime option cpSat.progressIntervalSeconds",
    0,
    true
  );
  requireOptionalBoolean(cpSat, "logSearchProgress", "CP-SAT runtime option cpSat.logSearchProgress");
  requireOptionalString(cpSat, "stopFilePath", "CP-SAT runtime option cpSat.stopFilePath");
  requireOptionalString(cpSat, "snapshotFilePath", "CP-SAT runtime option cpSat.snapshotFilePath");

  if (cpSat.warmStartHint !== undefined) {
    assertValidCpSatWarmStartHint(cpSat.warmStartHint, "CP-SAT warm-start hint cpSat.warmStartHint");
  }
  if (cpSat.portfolio !== undefined) {
    if (optimizer !== "cp-sat") {
      throw new SolverInputError(
        'CP-SAT portfolio option cpSat.portfolio is only supported when optimizer is "cp-sat".'
      );
    }
    assertValidCpSatPortfolioOptions(cpSat.portfolio, "CP-SAT portfolio option cpSat.portfolio", cpSat);
  }
}
