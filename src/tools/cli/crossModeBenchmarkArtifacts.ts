import {
  buildCrossModeBenchmarkTelemetryManifest,
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  buildCrossModeProductWorkflowReplayMetrics,
  buildCrossModeProductWorkflowReplayTelemetryManifest,
  captureExperimentRegistryHardwareMetadata,
  DEFAULT_EXPERIMENT_REGISTRY_PATH,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkSuite,
  resolveExperimentRegistryGitMetadata
} from "../../benchmarkApi.js";
import type { CrossModeBenchmarkBudgetAblationSuiteResult, CrossModeBenchmarkSuiteResult } from "../../benchmarkApi.js";
import {
  completeAppendableRegistryEntry,
  defaultCliReplayCommand,
  normalizeRepoRelativePath,
  prepareArtifactBundleDirectory,
  writeJsonArtifact,
  writeTextArtifact
} from "./artifactBundleHelpers.js";

export interface CrossModeBenchmarkArtifactArgs {
  artifactDir?: string;
  productArtifactDir?: string;
  productRunId?: string;
  productDecision?: string;
  productSummary?: string;
  productRegistryCommand?: string;
  productRegistryPath?: string;
  productRegister: boolean;
  productRegisterDryRun: boolean;
  forceArtifactDir: boolean;
  ablationRunId?: string;
  ablationDecision?: string;
  ablationSummary?: string;
}

export interface ScorecardArtifactManifest {
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
  artifactPath(fileName: string): string;
  absoluteArtifactPath(fileName: string): string;
}

export interface ProductArtifactManifest {
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

export interface BudgetAblationArtifactManifest {
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
  artifactPath(fileName: string): string;
  absoluteArtifactPath(fileName: string): string;
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

function prepareScorecardArtifactBundlePaths(
  artifactDirValue: string,
  label: string,
  force: boolean
): ScorecardArtifactBundlePaths {
  const artifacts = prepareArtifactBundleDirectory(artifactDirValue, label, { force });
  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      scorecardJson: artifacts.artifactPath("scorecard.json"),
      scorecardText: artifacts.artifactPath("scorecard.txt"),
      telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json")
    },
    artifactPath: artifacts.artifactPath,
    absoluteArtifactPath: artifacts.absoluteArtifactPath
  };
}

function prepareBudgetAblationArtifactBundlePaths(
  artifactDirValue: string,
  label: string,
  force: boolean
): BudgetAblationArtifactBundlePaths {
  const artifacts = prepareArtifactBundleDirectory(artifactDirValue, label, { force });
  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      budgetAblationJson: artifacts.artifactPath("budget-ablation.json"),
      budgetAblationText: artifacts.artifactPath("budget-ablation.txt"),
      decisionTraceJsonl: artifacts.artifactPath("decision-trace.jsonl"),
      telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json")
    },
    artifactPath: artifacts.artifactPath,
    absoluteArtifactPath: artifacts.absoluteArtifactPath
  };
}

function writeScorecardArtifactFiles(
  result: CrossModeBenchmarkSuiteResult,
  artifacts: ScorecardArtifactBundlePaths,
  telemetryManifest: unknown,
  force: boolean
): void {
  writeJsonArtifact(artifacts.absoluteArtifactPath("scorecard.json"), result, { force });
  writeTextArtifact(artifacts.absoluteArtifactPath("scorecard.txt"), `${formatCrossModeBenchmarkSuite(result)}\n`, {
    force
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, { force });
}

export function writeScorecardArtifactBundle(
  result: CrossModeBenchmarkSuiteResult,
  args: CrossModeBenchmarkArtifactArgs,
  argv: readonly string[]
): ScorecardArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Scorecard artifact directory is required.");
  }
  const artifacts = prepareScorecardArtifactBundlePaths(args.artifactDir, "--artifact-dir", args.forceArtifactDir);
  const telemetryManifest = buildCrossModeBenchmarkTelemetryManifest(result, {
    command: defaultBenchmarkCommand(argv),
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata()
  });

  writeScorecardArtifactFiles(result, artifacts, telemetryManifest, args.forceArtifactDir);

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
  args: CrossModeBenchmarkArtifactArgs
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

export function writeProductArtifactBundle(
  result: CrossModeBenchmarkSuiteResult,
  args: CrossModeBenchmarkArtifactArgs,
  argv: readonly string[]
): ProductArtifactManifest {
  if (args.productArtifactDir === undefined) {
    throw new Error("Product artifact directory is required.");
  }
  const artifacts = prepareScorecardArtifactBundlePaths(
    args.productArtifactDir,
    "--product-artifact-dir",
    args.forceArtifactDir
  );
  const evidenceSummaryJson = artifacts.artifactPath("evidence-summary.json");
  const workflowReplayJson = artifacts.artifactPath("workflow-replay.json");
  const workflowReplayTelemetryManifestJson = artifacts.artifactPath("workflow-replay-telemetry-manifest.json");
  const registryEntryDraftJson = artifacts.artifactPath("registry-entry-draft.json");
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

  writeJsonArtifact(artifacts.absoluteArtifactPath("scorecard.json"), result, { force: args.forceArtifactDir });
  writeTextArtifact(artifacts.absoluteArtifactPath("scorecard.txt"), `${formatCrossModeBenchmarkSuite(result)}\n`, {
    force: args.forceArtifactDir
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("evidence-summary.json"), evidenceSummary, {
    force: args.forceArtifactDir
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("workflow-replay.json"), workflowReplay, {
    force: args.forceArtifactDir
  });
  writeJsonArtifact(
    artifacts.absoluteArtifactPath("workflow-replay-telemetry-manifest.json"),
    workflowReplayTelemetryManifest,
    { force: args.forceArtifactDir }
  );
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
    force: args.forceArtifactDir
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
    force: args.forceArtifactDir
  });
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
  args: CrossModeBenchmarkArtifactArgs,
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

export function writeBudgetAblationArtifactBundle(
  result: CrossModeBenchmarkBudgetAblationSuiteResult,
  args: CrossModeBenchmarkArtifactArgs,
  argv: readonly string[]
): BudgetAblationArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Budget ablation artifact directory is required.");
  }
  const artifacts = prepareBudgetAblationArtifactBundlePaths(args.artifactDir, "--artifact-dir", args.forceArtifactDir);
  const command = defaultBenchmarkCommand(argv);
  const git = resolveExperimentRegistryGitMetadata();
  const hardware = captureExperimentRegistryHardwareMetadata();
  const telemetryManifest = buildBudgetAblationTelemetryManifest(result, {
    command,
    git,
    hardware
  });
  const registryEntryDraft = buildBudgetAblationRegistryEntryDraft(result, artifacts.artifactPaths, args, command);

  writeJsonArtifact(artifacts.absoluteArtifactPath("budget-ablation.json"), result, { force: args.forceArtifactDir });
  writeTextArtifact(
    artifacts.absoluteArtifactPath("budget-ablation.txt"),
    `${formatCrossModeBenchmarkBudgetAblations(result)}\n`,
    { force: args.forceArtifactDir }
  );
  writeTextArtifact(
    artifacts.absoluteArtifactPath("decision-trace.jsonl"),
    formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl(result),
    { force: args.forceArtifactDir }
  );
  writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
    force: args.forceArtifactDir
  });
  writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
    force: args.forceArtifactDir
  });

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

export function formatScorecardArtifactManifest(manifest: ScorecardArtifactManifest): string {
  return [
    `Cross-mode scorecard artifacts written to ${manifest.artifactDir}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`
  ].join("\n");
}

export function formatProductArtifactManifest(manifest: ProductArtifactManifest): string {
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

export function formatBudgetAblationArtifactManifest(manifest: BudgetAblationArtifactManifest): string {
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
