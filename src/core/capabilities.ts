export interface CpSatPortfolioCapabilityLimits {
  defaultWorkers: number;
  defaultPerWorkerTimeLimitSeconds: number;
  maxWorkers: number;
  maxTotalWorkerThreads: number;
  maxPerWorkerThreads: number;
  maxTotalCpuBudgetSeconds: number;
}

export const CP_SAT_PORTFOLIO_CAPABILITY_LIMITS: Readonly<CpSatPortfolioCapabilityLimits> = Object.freeze({
  defaultWorkers: 3,
  defaultPerWorkerTimeLimitSeconds: 30,
  maxWorkers: 8,
  maxTotalWorkerThreads: 8,
  maxPerWorkerThreads: 4,
  maxTotalCpuBudgetSeconds: 8 * 60 * 60,
});
