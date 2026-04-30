const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const {
  buildCrossModeProductWorkflowEvidenceSummary,
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
  assert.equal(draft.splitStatus.protectedHoldout, true);
  assert.equal(draft.splitStatus.leakage, "none");
  assert.deepEqual(draft.budget.wallClockBudgetsSeconds, [1, 5]);
  assert.equal(draft.budget.totalRuns, 4);
  assert.deepEqual(draft.summaryMetrics.modes, ["greedy"]);
  assert.equal(draft.summaryMetrics.caseMetricCount, 4);

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

async function run() {
  testProductCorpusListingIsStableAndMetadataRich();
  testProductCorpusCliListMatchesExportedCorpus();
  await testProductCorpusScorecardCarriesRegistryCoverageMetadata();
  console.log("Product corpus registry tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
