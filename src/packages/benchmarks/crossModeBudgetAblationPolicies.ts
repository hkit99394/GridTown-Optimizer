import { selectBenchmarkCasesByName } from "./benchmarkOptions.js";
import { DEFAULT_CROSS_MODE_BENCHMARK_CORPUS } from "./crossMode.js";
import { DEFAULT_GREEDY_BENCHMARK_CORPUS } from "./greedy.js";
import { DEFAULT_LNS_BENCHMARK_CORPUS } from "./lns.js";

import type {
  CrossModeBenchmarkBudgetAblationPolicy,
  CrossModeBenchmarkCase,
  CrossModeProblemSizeBand
} from "./crossMode.js";

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_POLICIES = Object.freeze([
  {
    name: "baseline",
    description: "Current Auto/LNS budget policy."
  },
  {
    name: "seed-light",
    description: "Spend a smaller fixed share on LNS seeding and keep repair passes short.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15
  },
  {
    name: "repair-heavy",
    description: "Spend less on seeding and more on LNS repair before exact follow-up.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "cp-sat-reserve-heavy",
    description: "Reserve a larger Auto slice for CP-SAT and keep LNS repairs compact.",
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.1,
    lnsEscalatedRepairBudgetRatio: 0.15,
    autoCpSatStageReserveRatio: 0.35
  }
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

function isServicePressureCpSatReserveCandidate(benchmarkCase: CrossModeBenchmarkCase): boolean {
  const serviceTypeCount = benchmarkCase.params.serviceTypes?.length ?? 0;
  return serviceTypeCount >= 3 && benchmarkCase.params.greedy?.serviceRefineIterations === 0;
}

function hasServiceTypes(benchmarkCase: CrossModeBenchmarkCase): boolean {
  return (benchmarkCase.params.serviceTypes?.length ?? 0) > 0;
}

export const OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES = Object.freeze([
  {
    name: "baseline-repeat",
    description: "Repeat the current Auto/LNS budget policy as a short-budget variance control."
  },
  {
    name: "service-master-shortlist",
    description: "Enable the opt-in Greedy service-master shortlist path for standalone Greedy scorecards only.",
    greedy: { serviceMasterDecomposition: true }
  },
  {
    name: "service-pressure-cp-sat-reserve-5s-guarded",
    description:
      "Reserve a small Auto CP-SAT slice at 5s only for service-pressure cases with disabled greedy refinement.",
    activeBudgetSeconds: [5],
    appliesToCase: isServicePressureCpSatReserveCandidate,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "service-present-lns-seed-reserve-5s-guarded",
    description: "Shorten LNS seed and reserve a small Auto CP-SAT slice at 5s only when service types are present.",
    activeBudgetSeconds: [5],
    appliesToCase: hasServiceTypes,
    lnsSeedBudgetRatio: 0.05,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "repair-heavy-5s-guarded",
    description: "Apply the combined guarded repair-heavy LNS allocation only at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "lns-seed-short-5s-guarded",
    description: "Shorten only the LNS seed slice at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsSeedBudgetRatio: 0.05
  },
  {
    name: "lns-repair-time-5s-guarded",
    description: "Lengthen only the LNS repair-time slice at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3
  },
  {
    name: "cp-sat-reserve-5s-guarded",
    description: "Reserve only a small Auto CP-SAT slice at the 5s budget.",
    activeBudgetSeconds: [5],
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "lns-seed-repair-5s-guarded",
    description: "Shorten LNS seed and lengthen repair at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsSeedBudgetRatio: 0.05,
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3
  },
  {
    name: "lns-seed-reserve-5s-guarded",
    description: "Shorten LNS seed and reserve a small Auto CP-SAT slice at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsSeedBudgetRatio: 0.05,
    autoCpSatStageReserveRatio: 0.1
  },
  {
    name: "lns-repair-reserve-5s-guarded",
    description: "Lengthen LNS repair and reserve a small Auto CP-SAT slice at the 5s budget.",
    activeBudgetSeconds: [5],
    lnsRepairBudgetRatio: 0.2,
    lnsEscalatedRepairBudgetRatio: 0.3,
    autoCpSatStageReserveRatio: 0.1
  }
] satisfies CrossModeBenchmarkBudgetAblationPolicy[]);

const GREEDY_COVERAGE_CASE_NAMES = Object.freeze([
  "typed-footprint-pressure",
  "deferred-road-packing-gain",
  "service-local-neighborhood"
] satisfies string[]);

const LNS_COVERAGE_CASE_NAMES = Object.freeze(["row0-anchor-repair"] satisfies string[]);

function inferCoverageProblemSizeBand(benchmarkCase: CrossModeBenchmarkCase): CrossModeProblemSizeBand {
  const cells = benchmarkCase.grid.length * (benchmarkCase.grid[0]?.length ?? 0);
  if (cells <= 16) return "tiny";
  if (cells <= 36) return "small";
  return "medium";
}

function selectCoverageCases(
  corpus: readonly CrossModeBenchmarkCase[],
  names: readonly string[]
): CrossModeBenchmarkCase[] {
  return selectBenchmarkCasesByName(corpus, names, {
    caseLabel: "cross-mode budget ablation coverage",
    corpusLabel: "Cross-mode budget ablation coverage"
  }).map((benchmarkCase) => ({
    ...benchmarkCase,
    problemSizeBand: benchmarkCase.problemSizeBand ?? inferCoverageProblemSizeBand(benchmarkCase)
  }));
}

export const DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS: readonly CrossModeBenchmarkCase[] = Object.freeze([
  ...DEFAULT_CROSS_MODE_BENCHMARK_CORPUS,
  ...selectCoverageCases(DEFAULT_GREEDY_BENCHMARK_CORPUS, GREEDY_COVERAGE_CASE_NAMES),
  ...selectCoverageCases(DEFAULT_LNS_BENCHMARK_CORPUS, LNS_COVERAGE_CASE_NAMES)
]);
