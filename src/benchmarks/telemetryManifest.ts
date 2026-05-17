import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CpSatPortfolioSummary,
  CpSatTelemetry,
  Grid,
  GreedyProfile,
  LnsTelemetry,
  OptimizerName,
  SolverDecisionTraceEvent,
  SolverParams,
  SolverProgressSummary,
  SolverTimeToQualityScorecard,
} from "../core/types.js";

export const SOLVER_TELEMETRY_MANIFEST_SCHEMA_VERSION = 1;
export const SOLVER_TELEMETRY_MANIFEST_TYPE = "solver-telemetry" as const;

export type SolverTelemetryDirtyState = "clean" | "dirty" | "unknown";

export interface SolverTelemetryManifestHardware {
  captured: boolean;
  platform?: string;
  arch?: string;
  cpuModel?: string;
  logicalCpuCount?: number;
  memoryBytes?: number;
  totalMemoryBytes?: number;
  gpuUsed: boolean;
  [key: string]: unknown;
}

export interface SolverTelemetryManifestGit {
  commit: string;
  branch: string;
  dirtyState: SolverTelemetryDirtyState;
  dirtyFileCount: number | null;
}

export interface SolverTelemetryStageManifest {
  name: string;
  eventCount: number;
  startedAtSeconds: number | null;
  completedAtSeconds: number | null;
  elapsedSeconds: number | null;
  firstFeasibleSeconds: number | null;
  bestScoreSeconds: number | null;
  finalScore: number | null;
  status: string;
}

export interface SolverTelemetryCpSatManifest {
  status: string | null;
  upperBound: number | null;
  populationGap: number | null;
  objectiveGap: number | null;
  solutionCount: number | null;
  branches: number | null;
  conflicts: number | null;
  userTimeSeconds: number | null;
  solveWallTimeSeconds: number | null;
  portfolioWorkerCount: number | null;
  portfolioFeasibleWorkers: number | null;
  model: Record<string, unknown>;
}

export interface SolverTelemetryLnsManifest {
  stopReason: string;
  seedSource: string;
  operatorSelectionPolicy: string | null;
  attempts: number;
  feasibleRepairs: number;
  improvements: number;
  neutralRepairs: number;
  recoverableFailures: number;
  skippedIterations: number;
  elapsedTimeSeconds: number;
  operatorScores: Array<{
    name: string;
    attempts: number;
    improvements: number;
    neutralRepairs: number;
    recoverableFailures: number;
    skippedIterations: number;
    reward: number;
    score: number;
    lastSelectedIteration: number | null;
  }>;
  selectedWindows: Array<{
    iteration: number;
    phase: string;
    operatorName: string | null;
    operatorScoreBefore: number | null;
    operatorScoreAfter: number | null;
    operatorExploration: boolean | null;
    window: { top: number; left: number; rows: number; cols: number };
    status: string;
    improvement: number;
    repairTimeLimitSeconds: number;
    wallClockSeconds: number;
  }>;
}

export interface SolverTelemetryGreedyManifest {
  profilePhaseCount: number;
  candidateScans: {
    service: number | null;
    residential: number | null;
    localSearch: number | null;
  };
  placements: {
    service: number | null;
    residential: number | null;
    localSearch: number | null;
  };
}

export interface SolverTelemetryRunManifest {
  runId: string;
  benchmarkName: string;
  caseName: string;
  caseFamily: string | null;
  optimizer: OptimizerName;
  mode: string;
  seed: number | null;
  budget: Record<string, unknown>;
  grid: {
    rows: number;
    cols: number;
    buildableCells: number;
  };
  solverParams: Record<string, unknown>;
  artifactPaths: string[];
  timings: {
    wallClockSeconds: number;
    firstFeasibleSeconds: number | null;
    bestScoreSeconds: number | null;
  };
  final: {
    status: string;
    totalPopulation: number;
    validation: {
      valid: boolean;
      errors: string[];
    };
  };
  progressSummary: SolverProgressSummary | null;
  timeToQuality: SolverTimeToQualityScorecard | null;
  stages: SolverTelemetryStageManifest[];
  cpSat: SolverTelemetryCpSatManifest | null;
  lns: SolverTelemetryLnsManifest | null;
  greedy: SolverTelemetryGreedyManifest | null;
}

export interface SolverTelemetryManifest {
  schemaVersion: typeof SOLVER_TELEMETRY_MANIFEST_SCHEMA_VERSION;
  manifestType: typeof SOLVER_TELEMETRY_MANIFEST_TYPE;
  manifestId: string;
  benchmarkName: string;
  generatedAt: string;
  commands: string[];
  git: SolverTelemetryManifestGit;
  hardware: SolverTelemetryManifestHardware;
  artifactPaths: string[];
  runCount: number;
  runs: SolverTelemetryRunManifest[];
  summaryMetrics: {
    validRunCount: number;
    invalidRunCount: number;
    optimizerCounts: Record<string, number>;
    cpSatRunCount: number;
    lnsRunCount: number;
    manifestRunCount: number;
  };
}

export interface BuildSolverTelemetryRunManifestInput {
  runId: string;
  benchmarkName: string;
  caseName: string;
  caseFamily?: string | null;
  optimizer: OptimizerName;
  mode?: string;
  seed?: number | null;
  budget: Record<string, unknown>;
  grid: Grid;
  solverParams: SolverParams;
  artifactPaths?: readonly string[];
  wallClockSeconds: number;
  totalPopulation: number;
  finalStatus?: string | null;
  validation: {
    valid: boolean;
    errors: readonly string[];
  };
  progressSummary?: SolverProgressSummary | null;
  decisionTrace?: readonly SolverDecisionTraceEvent[];
  timeToQuality?: SolverTimeToQualityScorecard | null;
  cpSatStatus?: string | null;
  cpSatTelemetry?: CpSatTelemetry | null;
  cpSatPortfolio?: CpSatPortfolioSummary | null;
  lnsTelemetry?: LnsTelemetry | null;
  greedyProfile?: GreedyProfile | null;
}

export interface BuildSolverTelemetryManifestInput {
  manifestId: string;
  benchmarkName: string;
  generatedAt?: string;
  commands: readonly string[];
  artifactPaths?: readonly string[];
  runs: readonly SolverTelemetryRunManifest[];
  git?: SolverTelemetryManifestGit;
  hardware?: SolverTelemetryManifestHardware;
}

export interface SolverTelemetryManifestIssue {
  code: string;
  message: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundSeconds(value: unknown): number | null {
  const number = finiteNumberOrNull(value);
  if (number === null) return null;
  return Math.round(Math.max(0, number) * 1000) / 1000;
}

function secondsFromMs(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundSeconds(value / 1000) : null;
}

function normalizeArtifactPath(artifactPath: string): string {
  const normalized = path.normalize(artifactPath);
  return path.isAbsolute(normalized)
    ? path.relative(process.cwd(), normalized)
    : normalized;
}

function gitValue(args: string[], fallback: string): string {
  try {
    const value = childProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
    return value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

export function captureSolverTelemetryManifestGit(): SolverTelemetryManifestGit {
  const status = gitValue(["status", "--porcelain"], "");
  const dirtyFiles = status === "" ? [] : status.split("\n").filter((line) => line.trim() !== "");
  return {
    commit: gitValue(["rev-parse", "HEAD"], "0000000000000000000000000000000000000000"),
    branch: gitValue(["branch", "--show-current"], "unknown"),
    dirtyState: dirtyFiles.length === 0 ? "clean" : "dirty",
    dirtyFileCount: dirtyFiles.length,
  };
}

export function captureSolverTelemetryManifestHardware(
  overrides: Record<string, unknown> = {}
): SolverTelemetryManifestHardware {
  const cpus = os.cpus();
  const gpuUsed = overrides.gpuUsed === true || typeof overrides.gpuModel === "string";
  return {
    captured: true,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpuCount: cpus.length,
    memoryBytes: os.totalmem(),
    totalMemoryBytes: os.totalmem(),
    gpuUsed,
    ...overrides,
  };
}

export function formatNpmScriptCommand(scriptName: string, argv: readonly string[]): string {
  const quote = (value: string): string => /^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : JSON.stringify(value);
  const command = ["npm", "run", scriptName];
  if (argv.length > 0) {
    command.push("--", ...argv);
  }
  return command.map(quote).join(" ");
}

function jsonSafeClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, entryValue) => {
    if (entryValue instanceof Set) return [...entryValue].sort();
    return entryValue;
  }));
}

function sanitizeSolverParams(params: SolverParams): Record<string, unknown> {
  const cloned = jsonSafeClone(params);
  if (!isRecord(cloned)) return {};
  const stripVolatilePaths = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripVolatilePaths);
    if (!isRecord(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (key === "stopFilePath" || key === "snapshotFilePath") continue;
      result[key] = stripVolatilePaths(entryValue);
    }
    return result;
  };
  return stripVolatilePaths(cloned) as Record<string, unknown>;
}

function buildableCellCount(grid: Grid): number {
  return grid.reduce((sum, row) => sum + row.filter((cell) => cell === 1).length, 0);
}

export function buildSolverModelSizeMetadata(grid: Grid, params: SolverParams): Record<string, unknown> {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const buildableCells = buildableCellCount(grid);
  const serviceTypeCount = params.serviceTypes?.length ?? 0;
  const residentialTypeCount = params.residentialTypes?.length ?? 0;
  const serviceCandidateUpperBound = (params.serviceTypes ?? []).reduce((sum, serviceType) => {
    const rotations = serviceType.allowRotation === false || serviceType.rows === serviceType.cols ? 1 : 2;
    return sum + buildableCells * rotations;
  }, 0);
  const residentialCandidateUpperBound = (params.residentialTypes ?? []).reduce((sum, residentialType) => {
    const rotations = residentialType.w === residentialType.h ? 1 : 2;
    return sum + buildableCells * rotations;
  }, 0);

  return {
    gridRows: rows,
    gridCols: cols,
    gridCells: rows * cols,
    buildableCells,
    roadCandidateCells: buildableCells,
    serviceTypeCount,
    residentialTypeCount,
    serviceCandidateUpperBound,
    residentialCandidateUpperBound,
    candidateUpperBound: buildableCells + serviceCandidateUpperBound + residentialCandidateUpperBound,
  };
}

function scoreFromEvent(event: SolverDecisionTraceEvent): number | null {
  return finiteNumberOrNull(event.score.best) ?? finiteNumberOrNull(event.score.after);
}

function firstFeasibleSeconds(events: readonly SolverDecisionTraceEvent[]): number | null {
  const feasible = events.find((event) => (scoreFromEvent(event) ?? 0) > 0);
  return feasible ? secondsFromMs(feasible.elapsedMs) : null;
}

function bestScoreSeconds(events: readonly SolverDecisionTraceEvent[]): number | null {
  let bestScore: number | null = null;
  let bestElapsedMs: number | null = null;
  for (const event of events) {
    const score = scoreFromEvent(event);
    if (score === null) continue;
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      bestElapsedMs = event.elapsedMs;
    }
  }
  return secondsFromMs(bestElapsedMs);
}

export function buildSolverTelemetryStages(
  optimizer: OptimizerName,
  decisionTrace: readonly SolverDecisionTraceEvent[] | undefined,
  wallClockSeconds: number
): SolverTelemetryStageManifest[] {
  const events = decisionTrace ?? [];
  const grouped = new Map<string, SolverDecisionTraceEvent[]>();
  for (const event of events) {
    const stageName = String(event.activeStage ?? optimizer);
    grouped.set(stageName, [...(grouped.get(stageName) ?? []), event]);
  }
  if (grouped.size === 0) {
    return [{
      name: optimizer,
      eventCount: 0,
      startedAtSeconds: 0,
      completedAtSeconds: roundSeconds(wallClockSeconds),
      elapsedSeconds: roundSeconds(wallClockSeconds),
      firstFeasibleSeconds: null,
      bestScoreSeconds: null,
      finalScore: null,
      status: "unknown",
    }];
  }

  return [...grouped.entries()].map(([name, stageEvents]) => {
    const elapsedValues = stageEvents.map((event) => event.elapsedMs).filter((value) => Number.isFinite(value));
    const startedAtMs = elapsedValues.length ? Math.min(...elapsedValues) : null;
    const completedAtMs = elapsedValues.length ? Math.max(...elapsedValues) : null;
    const sortedStageEvents = [...stageEvents].sort((left, right) => left.elapsedMs - right.elapsedMs || left.sequence - right.sequence);
    const finalEvent = sortedStageEvents[sortedStageEvents.length - 1];
    const finalScores = stageEvents.map(scoreFromEvent).filter((value): value is number => value !== null);
    return {
      name,
      eventCount: stageEvents.length,
      startedAtSeconds: secondsFromMs(startedAtMs),
      completedAtSeconds: secondsFromMs(completedAtMs),
      elapsedSeconds: startedAtMs === null || completedAtMs === null ? null : secondsFromMs(completedAtMs - startedAtMs),
      firstFeasibleSeconds: firstFeasibleSeconds(stageEvents),
      bestScoreSeconds: bestScoreSeconds(stageEvents),
      finalScore: finalScores.length ? finalScores[finalScores.length - 1]! : null,
      status: finalEvent?.decision ?? "unknown",
    };
  });
}

function buildCpSatTelemetryManifest(
  grid: Grid,
  params: SolverParams,
  status: string | null | undefined,
  telemetry: CpSatTelemetry | null | undefined,
  portfolio: CpSatPortfolioSummary | null | undefined
): SolverTelemetryCpSatManifest | null {
  if (!status && !telemetry && !portfolio) return null;
  const workers = portfolio?.workers ?? [];
  return {
    status: status ?? null,
    upperBound: telemetry?.bestPopulationUpperBound ?? null,
    populationGap: telemetry?.populationGapUpperBound ?? null,
    objectiveGap: telemetry?.objectiveGap ?? null,
    solutionCount: telemetry?.solutionCount ?? null,
    branches: telemetry?.numBranches ?? null,
    conflicts: telemetry?.numConflicts ?? null,
    userTimeSeconds: telemetry?.userTimeSeconds ?? null,
    solveWallTimeSeconds: telemetry?.solveWallTimeSeconds ?? null,
    portfolioWorkerCount: portfolio?.workerCount ?? null,
    portfolioFeasibleWorkers: portfolio ? workers.filter((worker) => worker.feasible).length : null,
    model: buildSolverModelSizeMetadata(grid, params),
  };
}

function buildLnsTelemetryManifest(telemetry: LnsTelemetry | null | undefined): SolverTelemetryLnsManifest | null {
  if (!telemetry) return null;
  return {
    stopReason: telemetry.stopReason,
    seedSource: telemetry.seedSource,
    operatorSelectionPolicy: telemetry.operatorSelectionPolicy ?? null,
    attempts: telemetry.outcomes.length,
    feasibleRepairs: telemetry.outcomes.filter((outcome) => outcome.status === "improved" || outcome.status === "neutral").length,
    improvements: telemetry.improvingIterations,
    neutralRepairs: telemetry.neutralIterations,
    recoverableFailures: telemetry.recoverableFailures,
    skippedIterations: telemetry.skippedIterations,
    elapsedTimeSeconds: roundSeconds(telemetry.elapsedSeconds) ?? 0,
    operatorScores: telemetry.operatorScores?.map((score) => ({ ...score })) ?? [],
    selectedWindows: telemetry.outcomes.map((outcome) => ({
      iteration: outcome.iteration,
      phase: outcome.phase,
      operatorName: outcome.operatorName ?? null,
      operatorScoreBefore: typeof outcome.operatorScoreBefore === "number" ? outcome.operatorScoreBefore : null,
      operatorScoreAfter: typeof outcome.operatorScoreAfter === "number" ? outcome.operatorScoreAfter : null,
      operatorExploration: typeof outcome.operatorExploration === "boolean" ? outcome.operatorExploration : null,
      window: { ...outcome.window },
      status: outcome.status,
      improvement: outcome.improvement,
      repairTimeLimitSeconds: outcome.repairTimeLimitSeconds,
      wallClockSeconds: roundSeconds(outcome.wallClockSeconds) ?? 0,
    })),
  };
}

function buildGreedyTelemetryManifest(profile: GreedyProfile | null | undefined): SolverTelemetryGreedyManifest | null {
  if (!profile) return null;
  return {
    profilePhaseCount: profile.phases.length,
    candidateScans: {
      service: profile.counters.servicePhase.candidateScans,
      residential: profile.counters.residentialPhase.candidateScans,
      localSearch: profile.counters.localSearch.candidateScans,
    },
    placements: {
      service: profile.counters.servicePhase.placements,
      residential: profile.counters.residentialPhase.placements,
      localSearch: profile.counters.localSearch.placements,
    },
  };
}

function inferFinalStatus(input: BuildSolverTelemetryRunManifestInput): string {
  return input.finalStatus
    ?? input.cpSatStatus
    ?? input.lnsTelemetry?.stopReason
    ?? input.progressSummary?.stopReason
    ?? (input.validation.valid ? "valid" : "invalid");
}

export function buildSolverTelemetryRunManifest(input: BuildSolverTelemetryRunManifestInput): SolverTelemetryRunManifest {
  return {
    runId: input.runId,
    benchmarkName: input.benchmarkName,
    caseName: input.caseName,
    caseFamily: input.caseFamily ?? null,
    optimizer: input.optimizer,
    mode: input.mode ?? input.optimizer,
    seed: input.seed ?? null,
    budget: jsonSafeClone(input.budget) as Record<string, unknown>,
    grid: {
      rows: input.grid.length,
      cols: input.grid[0]?.length ?? 0,
      buildableCells: buildableCellCount(input.grid),
    },
    solverParams: sanitizeSolverParams(input.solverParams),
    artifactPaths: (input.artifactPaths ?? []).map(normalizeArtifactPath),
    timings: {
      wallClockSeconds: roundSeconds(input.wallClockSeconds) ?? 0,
      firstFeasibleSeconds: secondsFromMs(input.timeToQuality?.firstFeasibleAtMs ?? null),
      bestScoreSeconds: secondsFromMs(input.timeToQuality?.bestScoreAtMs ?? null),
    },
    final: {
      status: inferFinalStatus(input),
      totalPopulation: input.totalPopulation,
      validation: {
        valid: input.validation.valid,
        errors: [...input.validation.errors],
      },
    },
    progressSummary: input.progressSummary ?? null,
    timeToQuality: input.timeToQuality ?? null,
    stages: buildSolverTelemetryStages(input.optimizer, input.decisionTrace, input.wallClockSeconds),
    cpSat: buildCpSatTelemetryManifest(input.grid, input.solverParams, input.cpSatStatus, input.cpSatTelemetry, input.cpSatPortfolio),
    lns: buildLnsTelemetryManifest(input.lnsTelemetry),
    greedy: buildGreedyTelemetryManifest(input.greedyProfile),
  };
}

function optimizerCounts(runs: readonly SolverTelemetryRunManifest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) {
    counts[run.optimizer] = (counts[run.optimizer] ?? 0) + 1;
  }
  return counts;
}

export function buildSolverTelemetryManifest(input: BuildSolverTelemetryManifestInput): SolverTelemetryManifest {
  const runs = [...input.runs];
  return {
    schemaVersion: SOLVER_TELEMETRY_MANIFEST_SCHEMA_VERSION,
    manifestType: SOLVER_TELEMETRY_MANIFEST_TYPE,
    manifestId: input.manifestId,
    benchmarkName: input.benchmarkName,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    commands: [...input.commands],
    git: input.git ?? captureSolverTelemetryManifestGit(),
    hardware: input.hardware ?? captureSolverTelemetryManifestHardware(),
    artifactPaths: (input.artifactPaths ?? []).map(normalizeArtifactPath),
    runCount: runs.length,
    runs,
    summaryMetrics: {
      validRunCount: runs.filter((run) => run.final.validation.valid).length,
      invalidRunCount: runs.filter((run) => !run.final.validation.valid).length,
      optimizerCounts: optimizerCounts(runs),
      cpSatRunCount: runs.filter((run) => run.cpSat !== null).length,
      lnsRunCount: runs.filter((run) => run.lns !== null).length,
      manifestRunCount: runs.length,
    },
  };
}

export function writeSolverTelemetryManifest(
  manifest: SolverTelemetryManifest,
  outputPath: string
): SolverTelemetryManifest {
  const normalizedOutputPath = path.normalize(outputPath);
  fs.mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  const manifestWithPath = {
    ...manifest,
    artifactPaths: [...new Set([...manifest.artifactPaths, normalizeArtifactPath(normalizedOutputPath)])],
  };
  fs.writeFileSync(normalizedOutputPath, `${JSON.stringify(manifestWithPath, null, 2)}\n`);
  return manifestWithPath;
}

function pushIssue(
  issues: SolverTelemetryManifestIssue[],
  code: string,
  message: string,
  issuePath: string
): void {
  issues.push({ code, message, path: issuePath });
}

function validateString(value: unknown, fieldPath: string, issues: SolverTelemetryManifestIssue[]): value is string {
  if (typeof value === "string" && value.length > 0) return true;
  pushIssue(issues, "invalid-string", `${fieldPath} must be a non-empty string.`, fieldPath);
  return false;
}

function validateStringList(value: unknown, fieldPath: string, issues: SolverTelemetryManifestIssue[]): value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    pushIssue(issues, "invalid-string-list", `${fieldPath} must be a string array.`, fieldPath);
    return false;
  }
  return true;
}

function validateNullableNumber(value: unknown, fieldPath: string, issues: SolverTelemetryManifestIssue[]): void {
  if (value === null || (typeof value === "number" && Number.isFinite(value))) return;
  pushIssue(issues, "invalid-number", `${fieldPath} must be a finite number or null.`, fieldPath);
}

function validateRun(run: unknown, index: number, issues: SolverTelemetryManifestIssue[]): void {
  const runPath = `runs[${index}]`;
  if (!isRecord(run)) {
    pushIssue(issues, "invalid-run", `${runPath} must be an object.`, runPath);
    return;
  }
  validateString(run.runId, `${runPath}.runId`, issues);
  validateString(run.benchmarkName, `${runPath}.benchmarkName`, issues);
  validateString(run.caseName, `${runPath}.caseName`, issues);
  validateString(run.optimizer, `${runPath}.optimizer`, issues);
  if (!isRecord(run.budget)) pushIssue(issues, "missing-budget", `${runPath}.budget must be an object.`, `${runPath}.budget`);
  if (!isRecord(run.solverParams)) pushIssue(issues, "missing-solver-params", `${runPath}.solverParams must be an object.`, `${runPath}.solverParams`);
  validateStringList(run.artifactPaths, `${runPath}.artifactPaths`, issues);
  if (!isRecord(run.timings)) {
    pushIssue(issues, "missing-timings", `${runPath}.timings must be an object.`, `${runPath}.timings`);
  } else {
    validateNullableNumber(run.timings.wallClockSeconds, `${runPath}.timings.wallClockSeconds`, issues);
    validateNullableNumber(run.timings.firstFeasibleSeconds, `${runPath}.timings.firstFeasibleSeconds`, issues);
    validateNullableNumber(run.timings.bestScoreSeconds, `${runPath}.timings.bestScoreSeconds`, issues);
  }
  if (!isRecord(run.final) || !isRecord(run.final.validation) || typeof run.final.validation.valid !== "boolean") {
    pushIssue(issues, "missing-final-validation", `${runPath}.final.validation.valid must be a boolean.`, `${runPath}.final.validation`);
  }
  if (!Array.isArray(run.stages) || run.stages.length === 0) {
    pushIssue(issues, "missing-stages", `${runPath}.stages must include at least one stage.`, `${runPath}.stages`);
  }
  if (run.optimizer === "cp-sat" && !isRecord(run.cpSat)) {
    pushIssue(issues, "missing-cp-sat-telemetry", `${runPath}.cpSat is required for CP-SAT runs.`, `${runPath}.cpSat`);
  }
  if (isRecord(run.cpSat)) {
    if (!isRecord(run.cpSat.model)) pushIssue(issues, "missing-cp-sat-model", `${runPath}.cpSat.model must be an object.`, `${runPath}.cpSat.model`);
    validateNullableNumber(run.cpSat.upperBound, `${runPath}.cpSat.upperBound`, issues);
    validateNullableNumber(run.cpSat.populationGap, `${runPath}.cpSat.populationGap`, issues);
  }
  if (run.optimizer === "lns" && !isRecord(run.lns)) {
    pushIssue(issues, "missing-lns-telemetry", `${runPath}.lns is required for LNS runs.`, `${runPath}.lns`);
  }
  if (isRecord(run.lns)) {
    for (const key of ["attempts", "feasibleRepairs", "improvements", "neutralRepairs", "recoverableFailures", "elapsedTimeSeconds"]) {
      validateNullableNumber(run.lns[key], `${runPath}.lns.${key}`, issues);
    }
    if (
      run.lns.operatorSelectionPolicy !== undefined
      && run.lns.operatorSelectionPolicy !== null
      && typeof run.lns.operatorSelectionPolicy !== "string"
    ) {
      pushIssue(issues, "invalid-lns-operator-policy", `${runPath}.lns.operatorSelectionPolicy must be a string or null.`, `${runPath}.lns.operatorSelectionPolicy`);
    }
    if (run.lns.operatorScores !== undefined && !Array.isArray(run.lns.operatorScores)) {
      pushIssue(issues, "missing-lns-operator-scores", `${runPath}.lns.operatorScores must be an array.`, `${runPath}.lns.operatorScores`);
    }
    if (!Array.isArray(run.lns.selectedWindows)) {
      pushIssue(issues, "missing-lns-windows", `${runPath}.lns.selectedWindows must be an array.`, `${runPath}.lns.selectedWindows`);
    } else {
      run.lns.selectedWindows.forEach((window, windowIndex) => {
        if (!isRecord(window)) {
          pushIssue(issues, "invalid-lns-window", `${runPath}.lns.selectedWindows[${windowIndex}] must be an object.`, `${runPath}.lns.selectedWindows[${windowIndex}]`);
          return;
        }
        if (
          window.operatorName !== undefined
          && window.operatorName !== null
          && typeof window.operatorName !== "string"
        ) {
          pushIssue(issues, "invalid-lns-window-operator", `${runPath}.lns.selectedWindows[${windowIndex}].operatorName must be a string or null.`, `${runPath}.lns.selectedWindows[${windowIndex}].operatorName`);
        }
      });
    }
  }
}

export function validateSolverTelemetryManifest(value: unknown): SolverTelemetryManifestIssue[] {
  const issues: SolverTelemetryManifestIssue[] = [];
  if (!isRecord(value)) {
    pushIssue(issues, "invalid-manifest", "Telemetry manifest must be a JSON object.", "$");
    return issues;
  }
  if (value.schemaVersion !== SOLVER_TELEMETRY_MANIFEST_SCHEMA_VERSION) {
    pushIssue(issues, "invalid-schema-version", `schemaVersion must be ${SOLVER_TELEMETRY_MANIFEST_SCHEMA_VERSION}.`, "schemaVersion");
  }
  if (value.manifestType !== SOLVER_TELEMETRY_MANIFEST_TYPE) {
    pushIssue(issues, "invalid-manifest-type", `manifestType must be ${SOLVER_TELEMETRY_MANIFEST_TYPE}.`, "manifestType");
  }
  validateString(value.manifestId, "manifestId", issues);
  validateString(value.benchmarkName, "benchmarkName", issues);
  validateStringList(value.commands, "commands", issues);
  validateStringList(value.artifactPaths, "artifactPaths", issues);
  if (!isRecord(value.git)) {
    pushIssue(issues, "missing-git", "git metadata is required.", "git");
  } else {
    validateString(value.git.commit, "git.commit", issues);
    validateString(value.git.branch, "git.branch", issues);
    if (value.git.dirtyState !== "clean" && value.git.dirtyState !== "dirty" && value.git.dirtyState !== "unknown") {
      pushIssue(issues, "invalid-dirty-state", "git.dirtyState must be clean, dirty, or unknown.", "git.dirtyState");
    }
  }
  if (!isRecord(value.hardware) || value.hardware.captured !== true || typeof value.hardware.gpuUsed !== "boolean") {
    pushIssue(issues, "missing-hardware", "hardware must include captured=true and gpuUsed.", "hardware");
  }
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    pushIssue(issues, "missing-runs", "runs must include at least one run.", "runs");
  } else {
    value.runs.forEach((run, index) => validateRun(run, index, issues));
  }
  if (typeof value.runCount !== "number" || (Array.isArray(value.runs) && value.runCount !== value.runs.length)) {
    pushIssue(issues, "invalid-run-count", "runCount must match runs.length.", "runCount");
  }
  return issues;
}

export function formatSolverTelemetryManifestIssues(issues: readonly SolverTelemetryManifestIssue[]): string {
  return issues.map((issue) => `${issue.path}: [${issue.code}] ${issue.message}`).join("\n");
}
