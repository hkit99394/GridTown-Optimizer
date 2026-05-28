import {
  captureExperimentRegistryHardwareMetadata,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatGreedyDeterministicAblation,
  resolveExperimentRegistryGitMetadata
} from "../../benchmarkApi.js";
import type { GreedyDeterministicAblationSuiteResult } from "../../benchmarkApi.js";
import {
  defaultCliReplayCommand,
  prepareArtifactBundleDirectory,
  writeJsonArtifact,
  writeTextArtifact
} from "./artifactBundleHelpers.js";

export interface GreedyDeterministicAblationArtifactArgs {
  artifactDir?: string;
  ablationRunId?: string;
  ablationDecision?: string;
  ablationSummary?: string;
  forceArtifactDir: boolean;
  productCorpus: boolean;
}

export interface GreedyDeterministicAblationArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    ablationJson: string;
    ablationText: string;
    telemetryManifestJson: string;
    registryEntryDraftJson: string;
  };
  runId: unknown;
  generatedAt: string;
  caseCount: number;
  variantCount: number;
  comparisonCount: number;
  seeds: number[];
  productCorpus: boolean;
}

interface GreedyDeterministicAblationArtifactBundlePaths {
  artifactDir: string;
  artifactPaths: GreedyDeterministicAblationArtifactManifest["artifactPaths"];
  artifactPath(fileName: string): string;
  absoluteArtifactPath(fileName: string): string;
}

function defaultGreedyBenchmarkCommand(argv: readonly string[]): string {
  return defaultCliReplayCommand("dist/greedyBenchmarkCli.js", argv);
}

function prepareGreedyDeterministicAblationArtifactBundlePaths(
  artifactDirValue: string,
  force: boolean
): GreedyDeterministicAblationArtifactBundlePaths {
  const artifacts = prepareArtifactBundleDirectory(artifactDirValue, "--artifact-dir", { force });
  return {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      ablationJson: artifacts.artifactPath("greedy-deterministic-ablation.json"),
      ablationText: artifacts.artifactPath("greedy-deterministic-ablation.txt"),
      telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
      registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json")
    },
    artifactPath: artifacts.artifactPath,
    absoluteArtifactPath: artifacts.absoluteArtifactPath
  };
}

function dateSlug(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10) || "unknown-date";
  return parsed.toISOString().slice(0, 10);
}

function selectedProductCases(result: GreedyDeterministicAblationSuiteResult) {
  const selected = new Set(result.selectedCaseNames);
  return DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.filter((benchmarkCase) => selected.has(benchmarkCase.name));
}

function greedyAblationCases(
  result: GreedyDeterministicAblationSuiteResult,
  productCorpus: boolean
): string[] | Record<string, string[]> {
  if (!productCorpus) return [...result.selectedCaseNames];
  const bySplit: Record<string, string[]> = {
    development: [],
    holdout: []
  };
  for (const benchmarkCase of selectedProductCases(result)) {
    bySplit[benchmarkCase.split ?? "development"].push(benchmarkCase.name);
  }
  bySplit.development.sort();
  bySplit.holdout.sort();
  return bySplit;
}

function greedyAblationCaseFamilies(result: GreedyDeterministicAblationSuiteResult, productCorpus: boolean): string[] {
  const families = new Set<string>(["greedy-deterministic-ablation"]);
  if (productCorpus) {
    families.add("product-workflow");
    for (const benchmarkCase of selectedProductCases(result)) {
      families.add(benchmarkCase.problemSizeBand ?? "unspecified-size");
      for (const tag of benchmarkCase.workflowTags ?? []) families.add(tag);
    }
  }
  for (const variant of result.variants) families.add(`variant:${variant}`);
  return [...families].sort();
}

function variantSummaryMetrics(summary: GreedyDeterministicAblationSuiteResult["variantSummaries"][number]) {
  return {
    variantName: summary.variantName,
    description: summary.description,
    caseCount: summary.caseCount,
    seedCount: summary.seedCount,
    comparisonCount: summary.comparisonCount,
    meanPopulation: summary.meanPopulation,
    medianPopulation: summary.medianPopulation,
    worstDecilePopulation: summary.worstDecilePopulation,
    bestPopulation: summary.bestPopulation,
    meanPopulationDeltaVsBaseline: summary.meanPopulationDeltaVsBaseline,
    medianPopulationDeltaVsBaseline: summary.medianPopulationDeltaVsBaseline,
    worstDecilePopulationDeltaVsBaseline: summary.worstDecilePopulationDeltaVsBaseline,
    bestPopulationDeltaVsBaseline: summary.bestPopulationDeltaVsBaseline,
    worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
    meanWallClockSeconds: summary.meanWallClockSeconds,
    meanWallClockDeltaVsBaselineSeconds: summary.meanWallClockDeltaVsBaselineSeconds,
    improvedCaseCount: summary.improvedCaseCount,
    regressedCaseCount: summary.regressedCaseCount,
    unchangedCaseCount: summary.unchangedCaseCount,
    winRate: summary.winRate,
    regressionRate: summary.regressionRate,
    unchangedRate: summary.unchangedRate,
    bestPopulationDeltaCaseName: summary.bestPopulationDeltaCaseName,
    bestPopulationDeltaSeed: summary.bestPopulationDeltaSeed,
    worstPopulationDeltaCaseName: summary.worstPopulationDeltaCaseName,
    worstPopulationDeltaSeed: summary.worstPopulationDeltaSeed
  };
}

function buildGreedyDeterministicAblationTelemetryManifest(
  result: GreedyDeterministicAblationSuiteResult,
  options: {
    command: string;
    git: { commit: string; branch: string };
    hardware: Record<string, unknown>;
    productCorpus: boolean;
  }
): Record<string, unknown> {
  const runs = result.cases.flatMap((benchmarkCase) =>
    benchmarkCase.variants.map((variant) => ({
      caseName: benchmarkCase.name,
      seed: benchmarkCase.seed,
      variantName: variant.variantName,
      totalPopulation: variant.totalPopulation,
      populationDeltaVsBaseline: variant.populationDeltaVsBaseline,
      wallClockSeconds: variant.wallClockSeconds,
      wallClockDeltaVsBaselineSeconds: variant.wallClockDeltaVsBaselineSeconds,
      roadCount: variant.roadCount,
      roadDeltaVsBaseline: variant.roadDeltaVsBaseline,
      serviceCount: variant.serviceCount,
      residentialCount: variant.residentialCount,
      profileEnabled: variant.profileEnabled,
      phaseCount: variant.phaseCount
    }))
  );
  return {
    schemaVersion: 1,
    source: "greedy-deterministic-ablation",
    generatedAt: result.generatedAt,
    command: options.command,
    git: options.git,
    hardware: options.hardware,
    suite: {
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      comparisonCount: result.comparisonCount,
      variantCount: result.variants.length,
      runCount: runs.length,
      selectedCaseNames: [...result.selectedCaseNames],
      variants: [...result.variants],
      seeds: [...result.seeds],
      productCorpus: options.productCorpus,
      coverage: { ...result.coverage }
    },
    variantSummaries: result.variantSummaries.map(variantSummaryMetrics),
    runs
  };
}

function buildGreedyDeterministicAblationRegistryEntryDraft(
  result: GreedyDeterministicAblationSuiteResult,
  artifactPaths: GreedyDeterministicAblationArtifactManifest["artifactPaths"],
  args: GreedyDeterministicAblationArtifactArgs,
  command: string
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: args.ablationRunId ?? `greedy-deterministic-ablation-${dateSlug(result.generatedAt)}`,
    artifactType: "ablation-gate",
    generatedAt: result.generatedAt,
    commands: [command],
    artifactPaths: [artifactPaths.ablationJson, artifactPaths.ablationText, artifactPaths.telemetryManifestJson],
    cases: greedyAblationCases(result, args.productCorpus),
    caseFamilies: greedyAblationCaseFamilies(result, args.productCorpus),
    seeds: [...result.seeds],
    splitStatus: args.productCorpus
      ? {
          splitField: "CrossModeBenchmarkCase.split",
          protectedHoldout: true,
          caseCount: result.caseCount,
          casesBySplit: greedyAblationCases(result, true),
          leakage: "product-workflow-development-holdout-splits",
          notes:
            "Greedy deterministic ablation uses the product workflow corpus split metadata; it remains opt-in evidence and does not promote solver defaults."
        }
      : {
          splitField: null,
          protectedHoldout: false,
          caseCount: result.caseCount,
          leakage: "not-protected-holdout",
          notes: "Greedy deterministic ablation without product-corpus split metadata is diagnostic only."
        },
    budget: {
      caseCount: result.caseCount,
      seedCount: result.seedCount,
      comparisonCount: result.comparisonCount,
      variantCount: result.variants.length,
      runCount: result.coverage.runCount,
      gridCellCount: result.coverage.gridCellCount,
      profileEnabledRuns: result.coverage.profileEnabledRuns
    },
    model: null,
    decision: args.ablationDecision ?? "diagnostics-only-no-default-promotion",
    summary:
      args.ablationSummary ??
      `Greedy deterministic ablation over ${result.caseCount} cases, ${result.variants.length} variants, and ${result.seeds.length} seed(s).`,
    summaryMetrics: {
      productCorpus: args.productCorpus,
      coverage: { ...result.coverage },
      variants: result.variantSummaries.map(variantSummaryMetrics)
    }
  };
}

export function writeGreedyDeterministicAblationArtifactBundle(
  result: GreedyDeterministicAblationSuiteResult,
  args: GreedyDeterministicAblationArtifactArgs,
  argv: readonly string[]
): GreedyDeterministicAblationArtifactManifest {
  if (args.artifactDir === undefined) {
    throw new Error("Greedy deterministic ablation artifact directory is required.");
  }
  if (result.seeds.length === 0) {
    throw new Error("Greedy deterministic ablation artifact bundles require explicit --seeds.");
  }
  const artifacts = prepareGreedyDeterministicAblationArtifactBundlePaths(args.artifactDir, args.forceArtifactDir);
  const command = defaultGreedyBenchmarkCommand(argv);
  const git = resolveExperimentRegistryGitMetadata();
  const hardware = captureExperimentRegistryHardwareMetadata();
  const telemetryManifest = buildGreedyDeterministicAblationTelemetryManifest(result, {
    command,
    git,
    hardware,
    productCorpus: args.productCorpus
  });
  const registryEntryDraft = buildGreedyDeterministicAblationRegistryEntryDraft(
    result,
    artifacts.artifactPaths,
    args,
    command
  );

  writeJsonArtifact(artifacts.absoluteArtifactPath("greedy-deterministic-ablation.json"), result, {
    force: args.forceArtifactDir
  });
  writeTextArtifact(
    artifacts.absoluteArtifactPath("greedy-deterministic-ablation.txt"),
    `${formatGreedyDeterministicAblation(result)}\n`,
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
    variantCount: result.variants.length,
    comparisonCount: result.comparisonCount,
    seeds: [...result.seeds],
    productCorpus: args.productCorpus
  };
}

export function formatGreedyDeterministicAblationArtifactManifest(
  manifest: GreedyDeterministicAblationArtifactManifest
): string {
  return [
    `Greedy deterministic ablation artifacts written to ${manifest.artifactDir}`,
    `run-id=${manifest.runId}`,
    `ablation-json=${manifest.artifactPaths.ablationJson}`,
    `ablation-text=${manifest.artifactPaths.ablationText}`,
    `telemetry-manifest=${manifest.artifactPaths.telemetryManifestJson}`,
    `registry-entry-draft=${manifest.artifactPaths.registryEntryDraftJson}`
  ].join("\n");
}
