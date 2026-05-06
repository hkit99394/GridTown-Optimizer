import { formatBenchmarkSignedNumber as formatSigned } from "./benchmarkOptions.js";

import type { CpSatNeighborhoodWindow } from "../core/index.js";
import type { LnsWindowReplaySuiteResult } from "./lnsWindowReplayTypes.js";

function formatWindow(window: CpSatNeighborhoodWindow | null): string {
  return window === null ? "n/a" : `${window.top}:${window.left}:${window.rows}x${window.cols}`;
}

function formatNullableSigned(value: number | null): string {
  return value === null ? "n/a" : formatSigned(value);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatNullableSeconds(value: number | null): string {
  return value === null ? "n/a" : `${value}s`;
}

export function formatLnsWindowReplayLabels(result: LnsWindowReplaySuiteResult): string {
  const lines: string[] = [];
  lines.push("=== LNS Window Replay Labels ===");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Cases: ${result.caseCount}`);
  lines.push(`Seeds: ${result.seeds.length ? result.seeds.join(", ") : "case-default"}`);
  lines.push(`Labels: ${result.labelCount}`);
  lines.push(`Max windows: ${result.maxWindows}`);
  lines.push(`Exploration windows: ${result.explorationWindowCount}`);
  lines.push(`State policies: ${result.statePolicies.join(", ")}`);
  lines.push(`Captured state policies: ${result.capturedStatePolicies.join(", ") || "none"}`);
  lines.push(
    `State collection: iterations=${result.stateCollectionIterations} repair=${result.stateCollectionRepairTimeLimitSeconds}s`
  );
  lines.push(
    `Roll-forward: iterations=${result.rollForwardIterations} repair=${formatNullableSeconds(result.rollForwardRepairTimeLimitSeconds)} labels=${result.rollForwardLabelCount}`
  );
  lines.push(`Feature schema: ${result.featureSchemaVersion}`);
  lines.push(`CP-SAT workers: ${result.cpSatNumWorkers}`);
  lines.push(`CP-SAT fingerprints: ${result.cpSatModelFingerprints.join(", ") || "none"}`);
  lines.push(`Pressure families: ${result.pressureFamilies.join(", ")}`);
  for (const benchmarkCase of result.cases) {
    const seedLabel = benchmarkCase.seed === null ? "case-default" : benchmarkCase.seed;
    const onlineTrace =
      benchmarkCase.onlineDecisionTrace === undefined
        ? ""
        : ` online=${benchmarkCase.onlineDecisionTrace.selectionStatus}:${benchmarkCase.onlineDecisionTrace.transition}@${benchmarkCase.onlineDecisionTrace.iteration} score-delta=${formatSigned(benchmarkCase.onlineDecisionTrace.scoreDelta)}`;
    lines.push(
      `- ${benchmarkCase.name} family=${benchmarkCase.pressureFamily} seed=${seedLabel} seed-hint=${benchmarkCase.seedHintKind}:${benchmarkCase.seedHintSourceName ?? "none"} state=${benchmarkCase.statePolicy}#${benchmarkCase.stateIndex} source=${benchmarkCase.stateSourceStatus}@${benchmarkCase.stateSourceIteration ?? "initial"} stagnant=${benchmarkCase.stateStagnantIterations}: incumbent=${benchmarkCase.incumbentPopulation} windows=${benchmarkCase.replayedWindowCount}/${benchmarkCase.candidateWindowCount} selected=${benchmarkCase.baselineSelectedOperator ?? "n/a"}:${formatWindow(benchmarkCase.baselineSelectedWindow)}${onlineTrace}`
    );
    for (const label of benchmarkCase.labels) {
      const rollForward =
        label.rollForward === undefined
          ? ""
          : ` roll-forward=population:${label.rollForward.totalPopulation} delta:${formatSigned(label.rollForward.populationDeltaFromIncumbent)} repair-delta:${formatSigned(label.rollForward.populationDeltaFromRepair)} baseline:${formatNullableNumber(label.rollForward.baselineTotalPopulation)} final-delta:${formatNullableSigned(label.rollForward.populationDeltaVsBaseline)} final-status:${label.rollForward.statusVsBaseline}`;
      lines.push(
        `  window#${label.windowIndex} state=${label.statePolicy}#${label.stateIndex} ${formatWindow(label.window)} operator=${label.operator} score=${label.operatorScore.toFixed(3)} source=${label.selectionSource} selected=${label.selectedByBaseline} status=${label.status} usable=${label.usable} population=${label.totalPopulation} delta=${formatSigned(label.populationDelta)} improvement=+${label.improvement} repair=${label.repairTimeLimitSeconds}s cpu-budget=${label.timing.workerCpuBudgetSeconds}s valid=${label.validation.valid} cp-sat=${label.cpSat.modelFingerprint}${rollForward} features=area:${label.features.area} roads:${label.features.roadCountInside} services:${label.features.serviceCountInside} residentials:${label.features.residentialCountInside} headroom:${label.features.residentialHeadroomInside} service-bonus:${label.features.serviceBonusInside} reachable:${label.features.connectivityShadow.reachableEmptyCellsBefore}->${label.features.connectivityShadow.reachableEmptyCellsAfterClearingWindow} newly-reachable:${label.features.connectivityShadow.newlyReachableEmptyCellsIfCleared} components:${label.features.fragmentation.emptyComponentCountBefore}->${label.features.fragmentation.emptyComponentCountAfterClearingWindow} candidates:svc:${label.features.candidateLoss.serviceCandidatesIntersectingWindow}/res:${label.features.candidateLoss.residentialCandidatesIntersectingWindow}`
      );
    }
  }
  return lines.join("\n");
}
