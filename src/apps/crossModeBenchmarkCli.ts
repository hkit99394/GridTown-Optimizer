import fs from "node:fs";
import path from "node:path";

import {
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatCrossModeBenchmarkBudgetAblationDecisionTraceJsonl,
  formatCrossModeBenchmarkBudgetAblations,
  formatCrossModeBenchmarkDecisionTraceJsonl,
  formatCrossModeBenchmarkSuite,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkBudgetAblations,
  runCrossModeBenchmarkSuite,
} from "../benchmarks/index.js";
import {
  applyInlineOptionHandlers,
  isCliFlag,
  parseNameList,
  parseNumberList,
  parsePositiveNumber,
} from "./cliParsing.js";
import { runCliMain } from "./cliEntrypoint.js";
import {
  optionalCliNames,
  writeCliJson,
  writeCliJsonOrText,
  writeCliList,
  writeCliRaw,
  writeCliText,
} from "./cliOutput.js";

import type {
  CrossModeBenchmarkMode,
  CrossModeBenchmarkSuiteResult,
} from "../benchmarks/index.js";

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
}

interface ProductArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    scorecardJson: string;
    scorecardText: string;
    evidenceSummaryJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  caseCount: number;
  modeCount: number;
  budgetsSeconds: number[];
  seeds: number[];
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
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function defaultProductRegistryCommand(argv: readonly string[]): string {
  return ["node", "dist/crossModeBenchmarkCli.js", ...argv].map(quoteCommandArg).join(" ");
}

function writeJsonArtifact(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  const registryEntryDraftJson = artifactPath("registry-entry-draft.json");
  const evidenceSummary = buildCrossModeProductWorkflowEvidenceSummary(result);
  const registryEntryDraft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    runId: args.productRunId,
    commands: [args.productRegistryCommand ?? defaultProductRegistryCommand(argv)],
    artifactPaths: [scorecardJson, scorecardText, evidenceSummaryJson],
    decision: args.productDecision,
    summary: args.productSummary,
  });

  writeJsonArtifact(absoluteArtifactPath("scorecard.json"), result);
  fs.writeFileSync(absoluteArtifactPath("scorecard.txt"), `${formatCrossModeBenchmarkSuite(result)}\n`);
  writeJsonArtifact(absoluteArtifactPath("evidence-summary.json"), evidenceSummary);
  writeJsonArtifact(absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft);

  return {
    artifactDir,
    artifactPaths: {
      scorecardJson,
      scorecardText,
      evidenceSummaryJson,
      registryEntryDraftJson,
    },
    runId: registryEntryDraft.runId,
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    modeCount: result.modeCount,
    budgetsSeconds: [...result.budgetsSeconds],
    seeds: [...result.seeds],
  };
}

function formatProductArtifactManifest(manifest: ProductArtifactManifest): string {
  return [
    `Product workflow artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `scorecard-json=${manifest.artifactPaths.scorecardJson}`,
    `scorecard-text=${manifest.artifactPaths.scorecardText}`,
    `evidence-summary=${manifest.artifactPaths.evidenceSummaryJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`,
  ].join("\n");
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
    modes: args.modes,
    budgetSeconds: args.budgetSeconds,
    budgetsSeconds: args.budgetsSeconds,
    seeds: args.seeds,
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

runCliMain(runCrossModeBenchmarkCli);
