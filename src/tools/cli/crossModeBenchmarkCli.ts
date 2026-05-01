import fs from "node:fs";
import path from "node:path";

import {
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  buildCrossModeBenchmarkTelemetryManifest,
  buildExperimentRegistryEntry,
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
  resolveExperimentRegistryGitMetadata,
  validateExperimentRegistryEntry,
  validateExperimentRegistryFile,
} from "../../benchmarkApi.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveNumber,
} from "../../apps/cliParsing.js";
import { runCliMain } from "../../apps/cliEntrypoint.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliRaw,
  writeCliText,
} from "../../apps/cliOutput.js";

import type {
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSuiteResult,
  ExperimentRegistryEntry,
} from "../../benchmarkApi.js";

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
  productArtifactDir?: string;
  productRunId?: string;
  productDecision?: string;
  productSummary?: string;
  productRegistryCommand?: string;
  productRegistryPath?: string;
  productRegister: boolean;
  productRegisterDryRun: boolean;
  productPromotionMatrix: boolean;
}

interface ProductArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    scorecardJson: string;
    scorecardText: string;
    evidenceSummaryJson: string;
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
  let productArtifactDir: string | undefined;
  let productRunId: string | undefined;
  let productDecision: string | undefined;
  let productSummary: string | undefined;
  let productRegistryCommand: string | undefined;
  let productRegistryPath: string | undefined;
  let productRegister = false;
  let productRegisterDryRun = false;
  let productPromotionMatrix = false;
  const inlineOptions: Record<string, (value: string) => void> = {
    modes: (value) => {
      modes = parseModes(value);
    },
    "ablation-policies": (value) => {
      ablationPolicyNames = parseNameList(
        value,
        "name for cross-mode benchmark --ablation-policies"
      );
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
    productArtifactDir,
    productRunId,
    productDecision,
    productSummary,
    productRegistryCommand,
    productRegistryPath,
    productRegister,
    productRegisterDryRun,
    productPromotionMatrix,
  };
}

function normalizeRepoRelativePath(value: string, label: string): string {
  const normalized = path.normalize(value);
  if (normalized === "." || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return normalized.split(path.sep).join(path.posix.sep);
}

function quoteCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function defaultProductRegistryCommand(argv: readonly string[]): string {
  const replayArgs = argv.filter((arg) =>
    arg !== "--product-register"
    && arg !== "--product-register-dry-run"
    && !arg.startsWith("--product-registry=")
  );
  return ["node", "dist/crossModeBenchmarkCli.js", ...replayArgs].map(quoteCommandArg).join(" ");
}

function writeJsonArtifact(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function existingRegistryHasRunId(registryPath: string, runId: unknown): boolean {
  if (typeof runId !== "string") return false;
  const registryResult = validateExperimentRegistryFile(registryPath, {
    rootDir: process.cwd(),
    validateArtifactPaths: true,
    strict: false,
  });
  if (registryResult.errorCount > 0) {
    throw new ExperimentRegistryValidationError("Existing experiment registry is invalid.", registryResult.issues);
  }
  return registryResult.entries.some((entry) => entry.runId === runId);
}

function completeAppendableRegistryEntry(
  registryPath: string,
  registryEntryDraft: Record<string, unknown>
): ExperimentRegistryEntry {
  const completedEntry = buildExperimentRegistryEntry(registryEntryDraft, {
    rootDir: process.cwd(),
  });
  const validation = validateExperimentRegistryEntry(completedEntry, {
    rootDir: process.cwd(),
    validateArtifactPaths: true,
    strict: true,
  });
  if (validation.entry === undefined) {
    throw new ExperimentRegistryValidationError("Product workflow registry entry is invalid.", validation.issues);
  }

  const absoluteRegistryPath = path.resolve(process.cwd(), registryPath);
  if (fs.existsSync(absoluteRegistryPath) && existingRegistryHasRunId(registryPath, validation.entry.runId)) {
    throw new ExperimentRegistryValidationError("Product workflow registry entry duplicates an existing runId.", [
      {
        code: "duplicate-run-id",
        message: `Duplicate runId '${validation.entry.runId}' already exists in '${registryPath}'.`,
        runId: validation.entry.runId,
        field: "runId",
      },
    ]);
  }

  return validation.entry;
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
  const completedEntry = completeAppendableRegistryEntry(registryPath, registryEntryDraft);
  if (dryRun) {
    return {
      registryPath,
      dryRun,
      appended: false,
      runId: completedEntry.runId,
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
  const artifactDir = normalizeRepoRelativePath(args.productArtifactDir, "--product-artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });

  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const scorecardJson = artifactPath("scorecard.json");
  const scorecardText = artifactPath("scorecard.txt");
  const evidenceSummaryJson = artifactPath("evidence-summary.json");
  const telemetryManifestJson = artifactPath("telemetry-manifest.json");
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const evidenceSummary = buildCrossModeProductWorkflowEvidenceSummary(result);
  const command = args.productRegistryCommand ?? defaultProductRegistryCommand(argv);
  const telemetryManifest = buildCrossModeBenchmarkTelemetryManifest(result, {
    command,
    git: resolveExperimentRegistryGitMetadata(),
    hardware: captureExperimentRegistryHardwareMetadata(),
  });
  const registryEntryDraft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    runId: args.productRunId,
    commands: [command],
    artifactPaths: [scorecardJson, scorecardText, evidenceSummaryJson, telemetryManifestJson],
    decision: args.productDecision,
    summary: args.productSummary,
  });

  writeJsonArtifact(absoluteArtifactPath("scorecard.json"), result);
  fs.writeFileSync(absoluteArtifactPath("scorecard.txt"), `${formatCrossModeBenchmarkSuite(result)}\n`);
  writeJsonArtifact(absoluteArtifactPath("evidence-summary.json"), evidenceSummary);
  writeJsonArtifact(absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);
  const registry = args.productRegister || args.productRegisterDryRun
    ? registerProductArtifacts(registryEntryDraft, args)
    : undefined;

  return {
    artifactDir,
    artifactPaths: {
      scorecardJson,
      scorecardText,
      evidenceSummaryJson,
      telemetryManifestJson,
      registryEntryDraftJson,
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
    registry,
  };
}

function formatProductArtifactManifest(manifest: ProductArtifactManifest): string {
  const lines = [
    `Product workflow artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `evidence-summary=${manifest.artifactPaths.evidenceSummaryJson}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`,
  ];
  if (manifest.registry !== undefined) {
    lines.push(
      `registry-${manifest.registry.appended ? "appended" : "dry-run"}=${manifest.registry.registryPath}`
    );
  }
  return lines.join("\n");
}

export async function runCrossModeBenchmarkCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.coverageCorpus && args.productCorpus) {
    throw new Error("Use only one cross-mode corpus selector: --coverage-corpus or --product-corpus.");
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
  if ((args.productRegister || args.productRegisterDryRun || args.productRegistryPath !== undefined) && !args.productCorpus) {
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
    args.productPromotionMatrix
    && (
      args.modes !== undefined
      || args.budgetSeconds !== undefined
      || args.budgetsSeconds !== undefined
      || args.seeds !== undefined
    )
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
      seeds: args.seeds,
    });

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
    seeds: args.productPromotionMatrix ? [...PRODUCT_WORKFLOW_PROMOTION_SEEDS] : args.seeds,
  });

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
