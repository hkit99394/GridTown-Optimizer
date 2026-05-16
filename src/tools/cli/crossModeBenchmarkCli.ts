import {
  DEFAULT_CROSS_MODE_BUDGET_ABLATION_COVERAGE_CORPUS,
  DEFAULT_CROSS_MODE_BENCHMARK_MODES,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
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
  runCrossModeBenchmarkSuite
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

import type { CrossModeBenchmarkMode } from "../../benchmarkApi.js";
import {
  formatBudgetAblationArtifactManifest,
  formatProductArtifactManifest,
  formatScorecardArtifactManifest,
  writeBudgetAblationArtifactBundle,
  writeProductArtifactBundle,
  writeScorecardArtifactBundle
} from "./crossModeBenchmarkArtifacts.js";

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
  forceArtifactDir: boolean;
  ablationRunId?: string;
  ablationDecision?: string;
  ablationSummary?: string;
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
  let forceArtifactDir = false;
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
    if (isCliFlag(arg, "--force-artifact-dir")) {
      forceArtifactDir = true;
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
    forceArtifactDir,
    ablationRunId,
    ablationDecision,
    ablationSummary
  };
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
  if (args.forceArtifactDir && args.artifactDir === undefined && args.productArtifactDir === undefined) {
    throw new Error("--force-artifact-dir requires --artifact-dir or --product-artifact-dir.");
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
