const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowReplayMetrics,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  completeExperimentRegistryEntry,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatExperimentRegistryIssues,
  listCrossModeBenchmarkCaseNames,
  runCrossModeBenchmarkSuite,
  validateExperimentRegistryEntry,
} = require("../dist/benchmarks/index.js");

const repoRoot = path.join(__dirname, "..");
const testCommit = "1234567890abcdef1234567890abcdef12345678";

function emptySolution() {
  return {
    roads: new Set(),
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation: 0,
  };
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function casesBySplit(corpus) {
  return {
    development: corpus.filter((benchmarkCase) => benchmarkCase.split === "development").map((benchmarkCase) => benchmarkCase.name),
    holdout: corpus.filter((benchmarkCase) => benchmarkCase.split === "holdout").map((benchmarkCase) => benchmarkCase.name),
  };
}

function workflowTags(corpus) {
  return uniqueValues(corpus.flatMap((benchmarkCase) => benchmarkCase.workflowTags ?? [])).sort();
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function testProductCorpusListingIsStableAndMetadataRich() {
  const names = listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS);

  assert.equal(names.length, 10);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.slice(-2), ["manual-layout-replay-warm-start", "expansion-comparison-replay"]);

  const splitNames = casesBySplit(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS);
  assert.equal(splitNames.development.length > 0, true);
  assert.equal(splitNames.holdout.length > 0, true);
  assert.equal(splitNames.development.includes("manual-layout-replay-warm-start"), true);
  assert.equal(splitNames.holdout.includes("expansion-comparison-replay"), true);

  assert.deepEqual(workflowTags(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS), [
    "anchor-service",
    "corridor",
    "expansion-comparison",
    "footprint-pressure",
    "gate",
    "manual-layout-replay",
    "multi-anchor",
    "service-pressure",
    "solver-smoke",
  ]);

  const replayMetrics = buildCrossModeProductWorkflowReplayMetrics();
  assert.deepEqual(
    replayMetrics.map((metric) => [metric.caseName, metric.workflowTag, metric.apiRoute]),
    [
      ["manual-layout-replay-warm-start", "manual-layout-replay", "/api/layout/evaluate"],
      ["expansion-comparison-replay", "expansion-comparison", "/api/layout/evaluate"],
    ]
  );
  assert(replayMetrics.every((metric) => metric.valid));
  assert(replayMetrics.every((metric) => metric.populationDeltaFromReported === 0));
}

function testProductCorpusCliListMatchesExportedCorpus() {
  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--product-corpus", "--list"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(
    result.stdout.trim().split(/\r?\n/),
    listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS)
  );
}

async function testProductCorpusScorecardCarriesRegistryCoverageMetadata() {
  const selectedNames = ["manual-layout-replay-warm-start", "expansion-comparison-replay"];
  const result = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    names: selectedNames,
    modes: ["greedy"],
    budgetsSeconds: [1, 5],
    seeds: [7],
    solve: () => emptySolution(),
  });

  assert.equal(result.caseCount, selectedNames.length);
  assert.deepEqual(result.selectedCaseNames, selectedNames);
  assert.deepEqual(result.budgetsSeconds, [1, 5]);
  assert.deepEqual(result.seeds, [7]);

  const scorecardByName = new Map(result.cases.map((scorecard) => [scorecard.name, scorecard]));
  assert.equal(scorecardByName.get("manual-layout-replay-warm-start").split, "development");
  assert.deepEqual(scorecardByName.get("manual-layout-replay-warm-start").workflowTags, ["manual-layout-replay"]);
  assert.equal(scorecardByName.get("expansion-comparison-replay").split, "holdout");
  assert.deepEqual(scorecardByName.get("expansion-comparison-replay").workflowTags, ["expansion-comparison"]);

  const evidence = buildCrossModeProductWorkflowEvidenceSummary(result);
  assert.deepEqual(evidence.splitCaseCounts, { development: 1, holdout: 1 });
  assert.equal(evidence.workflowTagCounts["manual-layout-replay"], 2);
  assert.equal(evidence.workflowTagCounts["expansion-comparison"], 2);
  assert.equal(evidence.caseMetrics[0].manualReplayCoverage, "scorecard-replay-case");
  assert.equal(evidence.caseMetrics[0].expansionComparisonLift, null);
  assert.equal(evidence.caseMetrics[2].manualReplayCoverage, "not-applicable");
  assert.equal(evidence.caseMetrics[2].expansionComparisonLift, null);
  assert.equal(evidence.promotionCoverage.protectedHoldout, false);
  assert.deepEqual(evidence.promotionCoverage.missingModes, ["auto", "lns", "cp-sat"]);
  assert.deepEqual(evidence.promotionCoverage.missingBudgetsSeconds, [30, 120]);
  assert.deepEqual(
    evidence.replayMetrics.map((metric) => [metric.caseName, metric.sourceName, metric.reportedPopulation, metric.evaluatedPopulation]),
    [
      ["manual-layout-replay-warm-start", "manual-layout-replay", 160, 160],
      ["expansion-comparison-replay", "expansion-comparison-replay", 115, 115],
    ]
  );
  assert.equal(evidence.replayMetrics[0].validationErrorCount, 0);
  assert.equal(evidence.replayMetrics[1].expansionComparisonLift, -115);

  const draft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    runId: "product-corpus-scorecard-2026-04-30-test",
    commands: [
      "node dist/crossModeBenchmarkCli.js --product-corpus --modes=greedy --budgets=1,5 --seeds=7 --json manual-layout-replay-warm-start expansion-comparison-replay",
    ],
    artifactPaths: ["artifacts/product-corpus/2026-04-30/scorecard.json"],
    decision: "benchmark-evidence-only",
  });
  assert.deepEqual(draft.cases, {
    development: ["manual-layout-replay-warm-start"],
    holdout: ["expansion-comparison-replay"],
  });
  assert.deepEqual(draft.caseFamilies, ["expansion-comparison", "manual-layout-replay"]);
  assert.equal(draft.splitStatus.protectedHoldout, false);
  assert.equal(draft.splitStatus.leakage, "not-evaluated");
  assert.equal(draft.splitStatus.promotionCoverage.protectedHoldout, false);
  assert.deepEqual(draft.budget.wallClockBudgetsSeconds, [1, 5]);
  assert.equal(draft.budget.totalRuns, 4);
  assert.deepEqual(draft.summaryMetrics.modes, ["greedy"]);
  assert.equal(draft.summaryMetrics.caseMetricCount, 4);
  assert.equal(draft.summaryMetrics.caseMetrics[0].caseName, "manual-layout-replay-warm-start");
  assert.equal(draft.summaryMetrics.replayMetricCount, 2);
  assert.equal(draft.summaryMetrics.replayMetrics[0].apiRoute, "/api/layout/evaluate");

  const partialDraft = buildCrossModeProductWorkflowRegistryEntryDraft(
    {
      ...result,
      caseCount: 1,
      cases: result.cases.filter((scorecard) => scorecard.split === "development"),
    },
    {
      commands: ["node dist/crossModeBenchmarkCli.js --product-corpus --modes=greedy --budgets=1,5 --seeds=7 --json manual-layout-replay-warm-start"],
      artifactPaths: ["artifacts/product-corpus/2026-04-30/manual-only.json"],
    }
  );
  assert.equal(partialDraft.splitStatus.protectedHoldout, false);
  assert.equal(partialDraft.splitStatus.leakage, "not-evaluated");
  assert.deepEqual(partialDraft.cases, {
    development: ["manual-layout-replay-warm-start"],
    holdout: [],
  });

  const entry = completeExperimentRegistryEntry(draft, {
    indexedAt: "2026-04-30",
    indexedGitCommit: testCommit,
    branch: "features/product-corpus-registry-test",
    artifactGitCommit: testCommit,
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCores: 8,
      memoryGb: 16,
      gpuUsed: false,
    },
  });

  const validation = validateExperimentRegistryEntry(entry, {
    rootDir: repoRoot,
    strict: true,
    validateArtifactPaths: false,
  });
  assert.equal(validation.issues.length, 0, formatExperimentRegistryIssues(validation.issues));
  assert.equal(validation.entry.runId, entry.runId);
}

async function testFullPromotionMatrixIsRequiredForProtectedHoldout() {
  const result = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    modes: ["auto", "greedy", "lns", "cp-sat"],
    budgetsSeconds: [1, 5, 30, 120],
    seeds: [7, 19, 37],
    solve: () => emptySolution(),
  });

  const evidence = buildCrossModeProductWorkflowEvidenceSummary(result);
  assert.equal(evidence.promotionCoverage.protectedHoldout, true);
  assert.deepEqual(evidence.promotionCoverage.missingCaseNames, []);
  assert.deepEqual(evidence.promotionCoverage.missingModes, []);
  assert.deepEqual(evidence.promotionCoverage.missingBudgetsSeconds, []);

  const draft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    commands: ["node dist/crossModeBenchmarkCli.js --product-corpus --modes=auto,greedy,lns,cp-sat --budgets=1,5,30,120 --seeds=7,19,37 --json"],
    artifactPaths: ["artifacts/product-corpus/2026-04-30/scorecard.json"],
  });
  assert.equal(draft.splitStatus.protectedHoldout, true);
  assert.equal(draft.splitStatus.leakage, "none");
  assert.equal(draft.budget.totalRuns, 480);
}

function testProductCorpusArtifactWriterCreatesRegistryDraft() {
  const artifactDir = "artifacts/tmp-product-corpus-registry-test";
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });

  try {
    const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
    const result = childProcess.spawnSync(process.execPath, [
      cliPath,
      "--product-corpus",
      `--product-artifact-dir=${artifactDir}`,
      "--product-run-id=product-corpus-artifact-cli-test",
      "--product-decision=benchmark-evidence-only",
      "--modes=greedy",
      "--budgets=1",
      "--seeds=7",
      "--json",
      "manual-layout-replay-warm-start",
      "expansion-comparison-replay",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.artifactDir, artifactDir);
    assert.equal(manifest.runId, "product-corpus-artifact-cli-test");
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.scorecardJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.scorecardText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.evidenceSummaryJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.registryEntryDraftJson)), true);

    const scorecard = readJson(manifest.artifactPaths.scorecardJson);
    const evidence = readJson(manifest.artifactPaths.evidenceSummaryJson);
    const draft = readJson(manifest.artifactPaths.registryEntryDraftJson);
    assert.equal(scorecard.caseCount, 2);
    assert.deepEqual(evidence.splitCaseCounts, { development: 1, holdout: 1 });
    assert.equal(draft.splitStatus.protectedHoldout, false);
    assert.deepEqual(draft.artifactPaths, [
      manifest.artifactPaths.scorecardJson,
      manifest.artifactPaths.scorecardText,
      manifest.artifactPaths.evidenceSummaryJson,
    ]);

    const entry = completeExperimentRegistryEntry(draft, {
      indexedAt: "2026-04-30",
      indexedGitCommit: testCommit,
      branch: "features/product-corpus-artifact-test",
      artifactGitCommit: testCommit,
      hardware: {
        captured: true,
        cpuModel: "Test CPU",
        logicalCores: 8,
        memoryGb: 16,
        gpuUsed: false,
      },
    });
    const validation = validateExperimentRegistryEntry(entry, {
      rootDir: repoRoot,
      strict: true,
      validateArtifactPaths: true,
    });
    assert.equal(validation.issues.length, 0, formatExperimentRegistryIssues(validation.issues));
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

async function run() {
  testProductCorpusListingIsStableAndMetadataRich();
  testProductCorpusCliListMatchesExportedCorpus();
  await testProductCorpusScorecardCarriesRegistryCoverageMetadata();
  await testFullPromotionMatrixIsRequiredForProtectedHoldout();
  testProductCorpusArtifactWriterCreatesRegistryDraft();
  console.log("Product corpus registry tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
