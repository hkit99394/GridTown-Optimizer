import fs from "node:fs";
import path from "node:path";

import {
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowReplayMetrics,
  buildCrossModeProductWorkflowReplayTelemetryManifest,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  buildCrossModeBenchmarkTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  ExperimentRegistryValidationError,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  formatExperimentRegistryIssues,
  listCrossModeBenchmarkCaseNames,
  PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS,
  PRODUCT_WORKFLOW_PROMOTION_MODES,
  PRODUCT_WORKFLOW_PROMOTION_SEEDS,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
  resolveExperimentRegistryGitMetadata
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveNumber
} from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliRaw,
  writeCliText
} from "../../apps/cliOutput.js";

import type {
  CrossModeBenchmarkBudgetAblationSuiteResult,
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSuiteResult
} from "../../benchmarkApi.js";
import {
  completeAppendableRegistryEntry,
  defaultCliReplayCommand,
  normalizeRepoRelativePath,
  writeJsonArtifact
} from "./artifactBundleHelpers.js";

interface ParsedBenchmarkArgs {
  json: boolean;
  traceJsonl: boolean;
  budgetAblations: boolean;
  coverageCorpus: boolean;
  productCorpus: boolean;
  list: boolean;
  names: string[];
  modes?: CrossModeBenchmarkMode[];
  ablationPolicyNames?: string[];
  budgetSeconds?: number;
  budgetsSeconds?: number[];
  seeds?: number[];
  artifactDir?: string;
  productArtifactDir?: string;
  productRunId?: string;
  productDecision?: string;
  productSummary?: string;
  productRegistryCommand?: string;
  productRegistryPath?: string;
  productRegister: boolean;
  productRegisterDryRun: boolean;
  productPromotionMatrix: boolean;
  ablationRunId?: string;
  ablationDecision?: string;
  ablationSummary?: string;
}

interface ScorecardArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    scorecardJson: string;
    scorecardText: string;
    telemetryManifestJson: string;
  };
  generatedAt: string;
  caseCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
}

interface ScorecardArtifactBundlePaths {
  artifactDir: string;
  artifactPaths: ScorecardArtifactManifest["artifactPaths"];
  absoluteArtifactPath(fileName: string): string;
}

interface ProductArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    scorecardJson: string;
    scorecardText: string;
    evidenceSummaryJson: string;
    workflowReplayJson: string;
    workflowReplayTelemetryManifestJson: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  caseCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
  registry?: {
    registryPath: string;
    dryRun: boolean;
    appended: boolean;
    runId: unknown;
  };
}

interface BudgetAblationArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    budgetAblationJson: string;
    budgetAblationText: string;
    decisionTraceJsonl: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  caseCount: number;
  policyCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
  baselinePolicyName: string | null;
  topPolicyName: string | null;
}

interface BudgetAblationArtifactBundlePaths {
  artifactDir: string;
  artifactPaths: BudgetAblationArtifactManifest["artifactPaths"];
  absoluteArtifactPath(fileName: string): string;
}

function parseModes(value: string): CrossModeBenchmarkMode[] {
  const knownModes = new Set<string>(DEFAULT_CROSS_MODE_BENCHMARK_MODES);
  const modes = parseNameList(value, "cross-mode benchmark --modes");
  const unknownModes = modes.filter((mode) => !knownModes.has(mode));
  if (unknownModes.length > 0) {
    throw new Error(
      `Unknown cross-mode benchmark mode(s): ${unknownModes.join(", ")}. Available modes: ${DEFAULT_CROSS_MODE_BENCHMARK_MODES.join(", ")}.`
    );
  }
  return modes as CrossModeBenchmarkMode[];
}

function parseArgs(argv: string[]): ParsedBenchmarkArgs {
  const names: string[] = [];
  let json = false;
  let traceJsonl = false;
  let budgetAblations = false;
  let coverageCorpus = false;
  let productCorpus = false;
  let list = false;
  let modes: CrossModeBenchmarkMode[] | undefined;
  let ablationPolicyNames: string[] | undefined;
  let budgetSeconds: number | undefined;
  let budgetsSeconds: number[] | undefined;
  let seeds: number[] | undefined;
  let artifactDir: string | undefined;
  let productArtifactDir: string | undefined;
  let productRunId: string | undefined;
  let productDecision: string | undefined;
  let productSummary: string | undefined;
  let productRegistryCommand: string | undefined;
  let productRegistryPath: string | undefined;
  let productRegister = false;
  let productRegisterDryRun = false;
  let productPromotionMatrix = false;
  let ablationRunId: string | undefined;
  let ablationDecision: string | undefined;
  let ablationSummary: string | undefined;
  const inlineOptions: Record<string, (value: string) => void> = {
    modes: (value) => {
      modes = parseModes(value);
    },
    "ablation-policies": (value) => {
      ablationPolicyNames = parseNameList(value, "name for cross-mode benchmark --ablation-policies");
      budgetAblations = true;
    },
    budget: (value) => {
      budgetSeconds = parsePositiveNumber(value, "cross-mode benchmark --budget");
    },
    budgets: (value) => {
      budgetsSeconds = parseNumberList(value, "cross-mode benchmark --budgets");
    },
    seeds: (value) => {
      seeds = parseNumberList(value, "cross-mode benchmark --seeds");
    },
    "artifact-dir": (value) => {
      artifactDir = value;
    },
    "product-artifact-dir": (value) => {
      productArtifactDir = value;
    },
    "product-run-id": (value) => {
      productRunId = value;
    },
    "product-decision": (value) => {
      productDecision = value;
    },
    "product-summary": (value) => {
      productSummary = value;
    },
    "product-registry-command": (value) => {
      productRegistryCommand = value;
    },
    "product-registry": (value) => {
      productRegistryPath = value;
    },
    "ablation-run-id": (value) => {
      ablationRunId = value;
    },
    "ablation-decision": (value) => {
      ablationDecision = value;
    },
    "ablation-summary": (value) => {
      ablationSummary = value;
    }
  };

  for (const arg of argv) {
    if (isCliFlag(arg, "--json")) {
      json = true;
      continue;
    }
    if (isCliFlag(arg, "--trace-jsonl")) {
      traceJsonl = true;
      continue;
    }
    if (isCliFlag(arg, "--budget-ablation", "--budget-ablations")) {
      budgetAblations = true;
      continue;
    }
    if (isCliFlag(arg, "--coverage-corpus")) {
      coverageCorpus = true;
      continue;
    }
    if (isCliFlag(arg, "--product-corpus")) {
      productCorpus = true;
      continue;
    }
    if (isCliFlag(arg, "--product-register")) {
      productRegister = true;
      continue;
    }
    if (isCliFlag(arg, "--product-register-dry-run")) {
      productRegisterDryRun = true;
      continue;
    }
    if (isCliFlag(arg, "--product-promotion-matrix")) {
      productPromotionMatrix = true;
      continue;
    }
    if (isCliFlag(arg, "--list")) {
      list = true;
      continue;
    }
    if (applyInlineOptionHandlers(arg, inlineOptions)) {
      continue;
    }
    names.push(arg);
  }

  return {
    json,
    traceJsonl,
    budgetAblations,
    coverageCorpus,
    productCorpus,
    list,
    names,
    modes,
    ablationPolicyNames,
    budgetSeconds,
    budgetsSeconds,
    seeds,
    artifactDir,
    productArtifactDir,
    productRunId,
    productDecision,
    productSummary,
    productRegistryCommand,
    productRegistryPath,
    productRegister,
    productRegisterDryRun,
    productPromotionMatrix,
    ablationRunId,
    ablationDecision,
    ablationSummary
  };
}

function defaultBenchmarkCommand(argv: readonly string[]): string {
  return defaultCliReplayCommand("dist/crossModeBenchmarkCli.js", argv);
}

function defaultProductRegistryCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter(
    (arg) =>
      arg !== "--product-register" && arg !== "--product-register-dry-run" && !arg.startsWith("--product-registry=")
  );
  return defaultBenchmarkCommand(replayArgs);
}

function prepareScorecardArtifactBundlePaths(artifactDirValue: string, label: string): ScorecardArtifactBundlePaths {
  const artifactDir = normalizeRepoRelativePath(artifactDirValue, label);
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  return {
    artifactDir,
    artifactPaths: {
      scorecardJson: artifactPath("scorecard.json"),
      scorecardText: artifactPath("scorecard.txt"),
      telemetryManifestJson: artifactPath("telemetry-manifest.json")
    },
    absoluteArtifactPath: (fileName) => path.join(absoluteArtifactDir, fileName)
  };
}

function prepareBudgetAblationArtifactBundlePaths(
  artifactDirValue: string,
  label: string
): BudgetAblationArtifactBundlePaths {
  const artifactDir = normalizeRepoRelativePath(artifactDirValue, label);
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  return {
    artifactDir,
    artifactPaths: {
      budgetAblationJson: artifactPath("budget-ablation.json"),
      budgetAblationText: artifactPath("budget-ablation.txt"),
      decisionTraceJsonl: artifactPath("decision-trace.jsonl"),
      telemetryManifestJson: artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifactPath("registry-entry-draft.json")
    },
    absoluteArtifactPath: (fileName) => path.join(absoluteArtifactDir, fileName)
  };
}

function writeScorecardArtifactFiles(
  result: CrossModeBenchmarkSuiteResult,
  artifacts: ScorecardArtifactBundlePaths,
  telemetryManifest: unknown
): void {
  writeJsonArtifact(artifacts.absoluteArtifactPath("scorecard.json"), result);
  fs.writeFileSync(artifacts.absoluteArtifactPath("scorecard.txt"), `${formatCrossModeBenchmarkSuite(result)}\n`);
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
}

function writeScorecardArtifactBundle(
  result: CrossModeBenchmarkSuiteResult,
  args: ParsedBenchmarkArgs,
  argv: readonly string[]
): ScorecardArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Scorecard artifact directory is required.");
  }
  const artifacts = prepareScorecardArtifactBundlePaths(args.artifactDir, "--artifact-dir");
  const telemetryManifest = buildCrossModeBenchmarkTelemetryManifest(result, {
    command: defaultBenchmarkCommand(argv),
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata()
  });

  writeScorecardArtifactFiles(result, artifacts, telemetryManifest);

  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: artifacts.artifactPaths,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds]
  };
}

function registerProductArtifacts(
  registryEntryDraft: Record<string, unknown>,
  args: ParsedBenchmarkArgs
): ProductArtifactManifest["registry"] {
  const registryPath = normalizeRepoRelativePath(
    args.productRegistryPath ?? DEFAULT_EXPERIMENT_REGISTRY_PATH,
    "--product-registry"
  );
  const dryRun = args.productRegisterDryRun;
  const completedEntry = completeAppendableRegistryEntry(
    registryPath,
    registryEntryDraft,
    "Product workflow registry entry is invalid."
  );
  if (dryRun) {
    return {
      registryPath,
      dryRun,
      appended: false,
      runId: completedEntry.runId
    };
  }

  throw new Error(
    "--product-register cannot append artifacts generated in the same command; use --product-register-dry-run, commit the artifact bundle, then run `npm run experiment-registry -- append --entry=<artifact-dir>/registry-entry-draft.json`."
  );
}

function writeProductArtifactBundle(
  result: CrossModeBenchmarkSuiteResult,
  args: ParsedBenchmarkArgs,
  argv: readonly string[]
): ProductArtifactManifest {
  if (args.productArtifactDir === undefined) {
    throw new Error("Product artifact directory is required.");
  }
  const artifacts = prepareScorecardArtifactBundlePaths(args.productArtifactDir, "--product-artifact-dir");
  const evidenceSummaryJson = path.posix.join(artifacts.artifactDir, "evidence-summary.json");
  const workflowReplayJson = path.posix.join(artifacts.artifactDir, "workflow-replay.json");
  const workflowReplayTelemetryManifestJson = path.posix.join(
    artifacts.artifactDir,
    "workflow-replay-telemetry-manifest.json"
  );
  const registryEntryDraftJson = path.posix.join(artifacts.artifactDir, "registry-entry-draft.json");
  const evidenceSummary = buildCrossModeProductWorkflowEvidenceSummary(result);
  const command = args.productRegistryCommand ?? defaultProductRegistryCommand(argv);
  const git = resolveExperimentRegistryGitMetadata();
  const hardware = captureExperimentRegistryHardwareMetadata();
  const telemetryManifest = buildCrossModeBenchmarkTelemetryManifest(result, {
    command,
    git,
    hardware
  });
  const workflowReplay = buildCrossModeProductWorkflowReplayMetrics({ result });
  const workflowReplayTelemetryManifest = buildCrossModeProductWorkflowReplayTelemetryManifest(result, {
    command,
    git,
    hardware
  });
  const registryEntryDraft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    runId: args.productRunId,
    commands: [command],
    artifactPaths: [
      artifacts.artifactPaths.scorecardJson,
      artifacts.artifactPaths.scorecardText,
      evidenceSummaryJson,
      workflowReplayJson,
      workflowReplayTelemetryManifestJson,
      artifacts.artifactPaths.telemetryManifestJson
    ],
    decision: args.productDecision,
    summary: args.productSummary
  });

  writeScorecardArtifactFiles(result, artifacts, telemetryManifest);
  writeJsonArtifact(artifacts.absoluteArtifactPath("evidence-summary.json"), evidenceSummary);
  writeJsonArtifact(artifacts.absoluteArtifactPath("workflow-replay.json"), workflowReplay);
  writeJsonArtifact(
    artifacts.absoluteArtifactPath("workflow-replay-telemetry-manifest.json"),
    workflowReplayTelemetryManifest
  );
  writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);
  const registry =
    args.productRegister || args.productRegisterDryRun ? registerProductArtifacts(registryEntryDraft, args) : undefined;

  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      scorecardJson: artifacts.artifactPaths.scorecardJson,
      scorecardText: artifacts.artifactPaths.scorecardText,
      evidenceSummaryJson,
      workflowReplayJson,
      workflowReplayTelemetryManifestJson,
      telemetryManifestJson: artifacts.artifactPaths.telemetryManifestJson,
      registryEntryDraftJson
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
    registry
  };
}

function dateSlug(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10) || "unknown-date";
  return parsed.toISOString().slice(0, 10);
}

function budgetAblationCasesBySplit(result: CrossModeBenchmarkBudgetAblationSuiteResult): Record<string, string[]> {
  const bySplit = new Map<string, Set<string>>();
  for (const policy of result.policies) {
    for (const scorecard of policy.suite.cases) {
      const split = scorecard.split ?? "unspecified";
      const names = bySplit.get(split) ?? new Set<string>();
      names.add(scorecard.name);
      bySplit.set(split, names);
    }
  }
  return Object.fromEntries(
    [...bySplit.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([split, names]) => [split, [...names].sort()])
  );
}

function budgetAblationCaseFamilies(result: CrossModeBenchmarkBudgetAblationSuiteResult): string[] {
  const families = new Set<string>(["cross-mode-budget-ablation"]);
  for (const policy of result.policies) {
    for (const scorecard of policy.suite.cases) {
      for (const tag of scorecard.workflowTags) families.add(tag);
      families.add(scorecard.problemSizeBand);
    }
  }
  return [...families].sort();
}

function countBudgetAblationModeRuns(result: CrossModeBenchmarkBudgetAblationSuiteResult): number {
  return result.policies.reduce(
    (sum, policy) => sum + policy.suite.cases.reduce((caseSum, scorecard) => caseSum + scorecard.results.length, 0),
    0
  );
}

function budgetAblationPolicySummary(
  policy: CrossModeBenchmarkBudgetAblationSuiteResult["policies"][number]
): Record<string, unknown> {
  return {
    policyName: policy.policyName,
    description: policy.description,
    meanBestPopulation: policy.meanBestPopulation,
    meanAutoPopulation: policy.meanAutoPopulation,
    meanLnsPopulation: policy.meanLnsPopulation,
    meanAutoDeltaToBest: policy.meanAutoDeltaToBest,
    meanAutoLnsStageElapsedSeconds: policy.meanAutoLnsStageElapsedSeconds,
    meanAutoCpSatStageElapsedSeconds: policy.meanAutoCpSatStageElapsedSeconds,
    deltaVsBaselineMeanBestPopulation: policy.deltaVsBaselineMeanBestPopulation,
    deltaVsBaselineMeanAutoPopulation: policy.deltaVsBaselineMeanAutoPopulation,
    deltaVsBaselineMeanLnsPopulation: policy.deltaVsBaselineMeanLnsPopulation,
    policyApplicationSummary: policy.policyApplicationSummary,
    autoSafetySummary: policy.autoSafetySummary,
    autoReplayDiagnostics: policy.autoReplayDiagnostics,
    autoVarianceSummary: policy.autoVarianceSummary,
    recommendationCounts: policy.recommendationCounts,
    budgetSummaries: policy.budgetSummaries
  };
}

function buildBudgetAblationTelemetryManifest(
  result: CrossModeBenchmarkBudgetAblationSuiteResult,
  options: {
    command: string;
    git: { commit: string; branch: string };
    hardware: Record<string, unknown>;
  }
): Record<string, unknown> {
  const runs = result.policies.flatMap(
    (policy) => buildCrossModeBenchmarkTelemetryManifest(policy.suite, options).runs
  );
  return {
    schemaVersion: 1,
    source: "cross-mode-budget-ablation",
    generatedAt: result.generatedAt,
    command: options.command,
    git: options.git,
    hardware: options.hardware,
    suite: {
      caseCount: result.caseCount,
      policyCount: result.policies.length,
      modeCount: result.modes.length,
      totalRuns: runs.length,
      selectedCaseNames: [...result.selectedCaseNames],
      modes: [...result.modes],
      budgetsSeconds: [...result.budgetsSeconds],
      seeds: [...result.seeds],
      baselinePolicyName: result.baselinePolicyName,
      topPolicyName: result.topPolicyName,
      topPolicyRankingBasis: result.topPolicyRankingBasis,
      topPolicyTiedPolicyNames: [...result.topPolicyTiedPolicyNames],
      budgetedModeSeconds: result.budgetedModeSeconds
    },
    policies: result.policies.map(budgetAblationPolicySummary),
    runs
  };
}

function buildBudgetAblationRegistryEntryDraft(
  result: CrossModeBenchmarkBudgetAblationSuiteResult,
  artifactPaths: BudgetAblationArtifactManifest["artifactPaths"],
  args: ParsedBenchmarkArgs,
  command: string
): Record<string, unknown> {
  const casesBySplit = budgetAblationCasesBySplit(result);
  const budgetSummaries = result.policies.map(budgetAblationPolicySummary);
  return {
    schemaVersion: 1,
    runId: args.ablationRunId ?? `cross-mode-budget-ablation-${dateSlug(result.generatedAt)}`,
    artifactType: "ablation-gate",
    generatedAt: result.generatedAt,
    commands: [command],
    artifactPaths: [
      artifactPaths.budgetAblationJson,
      artifactPaths.budgetAblationText,
      artifactPaths.decisionTraceJsonl,
      artifactPaths.telemetryManifestJson
    ],
    cases: casesBySplit,
    caseFamilies: budgetAblationCaseFamilies(result),
    seeds: [...result.seeds],
    splitStatus: {
      splitField: "CrossModeBenchmarkCase.split",
      policyCount: result.policies.length,
      caseCount: result.caseCount,
      casesBySplit,
      leakage: "not-promotion-evidence",
      notes:
        "Budget ablation artifact is diagnostic evidence for Auto policy triage; it does not promote solver defaults."
    },
    budget: {
      wallClockBudgetsSeconds: [...result.budgetsSeconds],
      policyCount: result.policies.length,
      caseCount: result.caseCount,
      modeCount: result.modes.length,
      totalRuns: countBudgetAblationModeRuns(result),
      budgetedModeSeconds: result.budgetedModeSeconds
    },
    model: null,
    decision: args.ablationDecision ?? "diagnostics-only-no-default-promotion",
    summary:
      args.ablationSummary ??
      `Cross-mode budget ablation over ${result.caseCount} cases, ${result.policies.length} policies, ${result.modes.length} modes, ${result.budgetsSeconds.length} budget(s), and ${result.seeds.length} seed(s).`,
    summaryMetrics: {
      baselinePolicyName: result.baselinePolicyName,
      topPolicyName: result.topPolicyName,
      topPolicyRankingBasis: result.topPolicyRankingBasis,
      topPolicyTiedPolicyNames: [...result.topPolicyTiedPolicyNames],
      policies: budgetSummaries
    }
  };
}

function writeBudgetAblationArtifactBundle(
  result: CrossModeBenchmarkBudgetAblationSuiteResult,
  args: ParsedBenchmarkArgs,
  argv: readonly string[]
): BudgetAblationArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Budget ablation artifact directory is required.");
  }
  const artifacts = prepareBudgetAblationArtifactBundlePaths(args.artifactDir, "--artifact-dir");
  const command = defaultBenchmarkCommand(argv);
  const git = resolveExperimentRegistryGitMetadata();
  const hardware = captureExperimentRegistryHardwareMetadata();
  const telemetryManifest = buildBudgetAblationTelemetryManifest(result, {
    command,
    git,
    hardware
  });
  const registryEntryDraft = buildBudgetAblationRegistryEntryDraft(result, artifacts.artifactPaths, args, command);

  writeJsonArtifact(artifacts.absoluteArtifactPath("budget-ablation.json"), result);
  fs.writeFileSync(
    artifacts.absoluteArtifactPath("budget-ablation.txt"),
    `${formatCrossModeBenchmarkBudgetAblations(result)}\n`
  );
  fs.writeFileSync(
    artifacts.absoluteArtifactPath("decision-trace.jsonl"),
    formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(result)
  );
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: artifacts.artifactPaths,
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    policyCount: result.policies.length,
    modeCount: result.modes.length,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
    baselinePolicyName: result.baselinePolicyName,
    topPolicyName: result.topPolicyName
  };
}

function formatScorecardArtifactManifest(manifest: ScorecardArtifactManifest): string {
  return [
    `Cross-mode scorecard artifacts written to ${manifest.artifactDir}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`
  ].join("\n");
}

function formatProductArtifactManifest(manifest: ProductArtifactManifest): string {
  const lines = [
    `Product workflow artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `evidence-summary=${manifest.artifactPaths.evidenceSummaryJson}`,
    `workflow-replay=${manifest.artifactPaths.workflowReplayJson}`,
    `workflow-replay-telemetry-manifest=${manifest.artifactPaths.workflowReplayTelemetryManifestJson}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ];
  if (manifest.registry !== undefined) {
    lines.push(`registry-${manifest.registry.appended ? "appended" : "dry-run"}=${manifest.registry.registryPath}`);
  }
  return lines.join("\n");
}

function formatBudgetAblationArtifactManifest(manifest: BudgetAblationArtifactManifest): string {
  return [
    `Cross-mode budget ablation artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `budget-ablation-json=${manifest.artifactPaths.budgetAblationJson}`,
    `budget-ablation-text=${manifest.artifactPaths.budgetAblationText}`,
    `decision-trace-jsonl=${manifest.artifactPaths.decisionTraceJsonl}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ].join("\n");
}

export async function runCrossModeBenchmarkCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.coverageCorpus && args.productCorpus) {
    throw new Error("Use only one cross-mode corpus selector: --coverage-corpus or --product-corpus.");
  }
  if (args.artifactDir !== undefined && args.productArtifactDir !== undefined) {
    throw new Error("Use only one artifact writer: --artifact-dir or --product-artifact-dir.");
  }
  const hasAblationArtifactMetadata =
    args.ablationRunId !== undefined || args.ablationDecision !== undefined || args.ablationSummary !== undefined;
  if (hasAblationArtifactMetadata && !args.budgetAblations) {
    throw new Error("--ablation-run-id, --ablation-decision, and --ablation-summary require --budget-ablation.");
  }
  if (hasAblationArtifactMetadata && args.artifactDir === undefined) {
    throw new Error("--ablation-run-id, --ablation-decision, and --ablation-summary require --artifact-dir.");
  }
  if (args.artifactDir !== undefined && args.list) {
    throw new Error("--artifact-dir cannot be combined with --list.");
  }
  if (args.artifactDir !== undefined && args.traceJsonl) {
    throw new Error("--artifact-dir cannot be combined with --trace-jsonl.");
  }
  if (args.productArtifactDir !== undefined && !args.productCorpus) {
    throw new Error("--product-artifact-dir requires --product-corpus.");
  }
  if (args.productArtifactDir !== undefined && args.list) {
    throw new Error("--product-artifact-dir cannot be combined with --list.");
  }
  if (args.productArtifactDir !== undefined && args.budgetAblations) {
    throw new Error("--product-artifact-dir cannot be combined with --budget-ablation.");
  }
  if (args.productArtifactDir !== undefined && args.traceJsonl) {
    throw new Error("--product-artifact-dir cannot be combined with --trace-jsonl.");
  }
  if (
    (args.productRegister || args.productRegisterDryRun || args.productRegistryPath !== undefined) &&
    !args.productCorpus
  ) {
    throw new Error("--product-register, --product-register-dry-run, and --product-registry require --product-corpus.");
  }
  if (args.productPromotionMatrix && !args.productCorpus) {
    throw new Error("--product-promotion-matrix requires --product-corpus.");
  }
  if ((args.productRegister || args.productRegisterDryRun) && args.productArtifactDir === undefined) {
    throw new Error("--product-register and --product-register-dry-run require --product-artifact-dir.");
  }
  if (args.productRegister && args.productRegisterDryRun) {
    throw new Error("Use only one product registry action: --product-register or --product-register-dry-run.");
  }
  if (args.productRegister) {
    throw new Error(
      "--product-register cannot append artifacts generated in the same command; use --product-register-dry-run, commit the artifact bundle, then run `npm run experiment-registry -- append --entry=<artifact-dir>/registry-entry-draft.json`."
    );
  }
  if (args.productRegistryPath !== undefined && !args.productRegister && !args.productRegisterDryRun) {
    throw new Error("--product-registry requires --product-register or --product-register-dry-run.");
  }
  if (args.productPromotionMatrix && args.budgetAblations) {
    throw new Error("--product-promotion-matrix cannot be combined with --budget-ablation.");
  }
  if (
    args.productPromotionMatrix &&
    (args.modes !== undefined ||
      args.budgetSeconds !== undefined ||
      args.budgetsSeconds !== undefined ||
      args.seeds !== undefined)
  ) {
    throw new Error("--product-promotion-matrix cannot be combined with --modes, --budget, --budgets, or --seeds.");
  }
  const corpus = args.productCorpus
    ? DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS
    : args.coverageCorpus
      ? DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS
      : undefined;
  if (args.list) {
    writeCliList(listCrossModeBenchmarkCaseNames(corpus));
    return;
  }

  if (args.budgetAblations) {
    const result = await runCrossModeBenchmarkBudgetAblations(corpus, {
      names: optionalCliNames(args.names),
      modes: args.modes,
      policyNames: args.ablationPolicyNames,
      budgetSeconds: args.budgetSeconds,
      budgetsSeconds: args.budgetsSeconds,
      seeds: args.seeds
    });

    if (args.artifactDir !== undefined) {
      const manifest = writeBudgetAblationArtifactBundle(result, args, argv);
      writeCliJsonOrText(args.json, manifest, () => formatBudgetAblationArtifactManifest(manifest));
      return;
    }

    if (args.json) {
      writeCliJson(result);
      return;
    }

    if (args.traceJsonl) {
      writeCliRaw(formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(result));
      return;
    }

    writeCliText(formatCrossModeBenchmarkBudgetAblations(result));
    return;
  }

  const result = await runCrossModeBenchmarkSuite(corpus, {
    names: optionalCliNames(args.names),
    modes: args.productPromotionMatrix ? [...PRODUCT_WORKFLOW_PROMOTION_MODES] : args.modes,
    budgetSeconds: args.productPromotionMatrix ? undefined : args.budgetSeconds,
    budgetsSeconds: args.productPromotionMatrix ? [...PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS] : args.budgetsSeconds,
    seeds: args.productPromotionMatrix ? [...PRODUCT_WORKFLOW_PROMOTION_SEEDS] : args.seeds
  });

  if (args.artifactDir !== undefined) {
    const manifest = writeScorecardArtifactBundle(result, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatScorecardArtifactManifest(manifest));
    return;
  }

  if (args.productArtifactDir !== undefined) {
    const manifest = writeProductArtifactBundle(result, args, argv);
    writeCliJsonOrText(args.json, manifest, () => formatProductArtifactManifest(manifest));
    return;
  }

  if (args.traceJsonl) {
    writeCliRaw(formatCrossModeBenchmarkDecisionTraceJsonl(result));
    return;
  }

  writeCliJsonOrText(args.json, result, () => formatCrossModeBenchmarkSuite(result));
}

runCliMain(runCrossModeBenchmarkCli, (error) => {
  if (error instanceof ExperimentRegistryValidationError) {
    process.stderr.write(`${formatExperimentRegistryIssues(error.issues)}\n`);
  } else {
    console.error(error);
  }
});
