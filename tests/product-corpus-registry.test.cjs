const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCrossModeProductWorkflowEvidenceSummary,
  buildCrossModeProductWorkflowReplayMetrics,
  buildCrossModeProductWorkflowReplayTelemetryManifest,
  buildCrossModeProductWorkflowRegistryEntryDraft,
  completeExperimentRegistryEntry,
  DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
  formatExperimentRegistryIssues,
  listCrossModeBenchmarkCaseNames,
  PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS,
  PRODUCT_WORKFLOW_PROMOTION_MODES,
  PRODUCT_WORKFLOW_PROMOTION_SEEDS,
  runCrossModeBenchmarkSuite,
  validateExperimentRegistryEntry
} = require("city-builder/benchmarks");

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
    totalPopulation: 0
  };
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function casesBySplit(corpus) {
  return {
    development: corpus
      .filter((benchmarkCase) => benchmarkCase.split === "development")
      .map((benchmarkCase) => benchmarkCase.name),
    holdout: corpus
      .filter((benchmarkCase) => benchmarkCase.split === "holdout")
      .map((benchmarkCase) => benchmarkCase.name)
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
    "solver-smoke"
  ]);

  const replayMetrics = buildCrossModeProductWorkflowReplayMetrics();
  assert.deepEqual(
    replayMetrics.map((metric) => [metric.caseName, metric.workflowTag, metric.apiRoute]),
    [
      ["manual-layout-replay-warm-start", "manual-layout-replay", "/api/layout/evaluate"],
      ["expansion-comparison-replay", "expansion-comparison", "/api/layout/evaluate"]
    ]
  );
  assert(replayMetrics.every((metric) => metric.valid));
  assert(replayMetrics.every((metric) => metric.populationDeltaFromReported === 0));

  const replayTelemetryManifest = buildCrossModeProductWorkflowReplayTelemetryManifest(
    {
      generatedAt: "2026-05-01T00:00:00.000Z",
      caseCount: 2,
      selectedCaseNames: ["manual-layout-replay-warm-start", "expansion-comparison-replay"],
      cases: []
    },
    {
      command: "node dist/crossModeBenchmarkCli.js --product-corpus --json",
      git: { commit: testCommit, branch: "features/product-workflow-replay-test" },
      hardware: { captured: true, gpuUsed: false }
    }
  );
  assert.equal(replayTelemetryManifest.source, "product-workflow-replay");
  assert.equal(replayTelemetryManifest.suite.replayCount, 2);
  assert.deepEqual(replayTelemetryManifest.suite.workflowTags, ["expansion-comparison", "manual-layout-replay"]);
}

function testProductCorpusCliListMatchesExportedCorpus() {
  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--product-corpus", "--list"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(
    result.stdout.trim().split(/\r?\n/),
    listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS)
  );
}

function testProductPromotionMatrixFlagGuardsLongRunArgs() {
  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const missingCorpus = childProcess.spawnSync(process.execPath, [cliPath, "--product-promotion-matrix", "--list"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.notEqual(missingCorpus.status, 0);
  assert.match(missingCorpus.stderr, /--product-promotion-matrix requires --product-corpus/);

  const listResult = childProcess.spawnSync(
    process.execPath,
    [cliPath, "--product-corpus", "--product-promotion-matrix", "--list"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
  assert.deepEqual(
    listResult.stdout.trim().split(/\r?\n/),
    listCrossModeBenchmarkCaseNames(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS)
  );

  const conflict = childProcess.spawnSync(
    process.execPath,
    [cliPath, "--product-corpus", "--product-promotion-matrix", "--modes=greedy", "--list"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /--product-promotion-matrix cannot be combined/);
}

async function testProductCorpusScorecardCarriesRegistryCoverageMetadata() {
  const selectedNames = ["manual-layout-replay-warm-start", "expansion-comparison-replay"];
  const result = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    names: selectedNames,
    modes: ["greedy"],
    budgetsSeconds: [1, 5],
    seeds: [7],
    solve: () => emptySolution()
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
  assert.deepEqual(evidence.promotionCoverage.requiredSeeds, PRODUCT_WORKFLOW_PROMOTION_SEEDS);
  assert.deepEqual(evidence.promotionCoverage.missingSeeds, [19, 37]);
  assert.deepEqual(evidence.promotionCoverage.unexpectedSeeds, []);
  assert.deepEqual(
    evidence.replayMetrics.map((metric) => [
      metric.caseName,
      metric.sourceName,
      metric.reportedPopulation,
      metric.evaluatedPopulation
    ]),
    [
      ["manual-layout-replay-warm-start", "manual-layout-replay", 160, 160],
      ["expansion-comparison-replay", "expansion-comparison-replay", 115, 115]
    ]
  );
  assert.equal(evidence.replayMetrics[0].scorecardCount, 2);
  assert.deepEqual(evidence.replayMetrics[0].budgetsSeconds, [1, 5]);
  assert.deepEqual(evidence.replayMetrics[0].seeds, [7]);
  assert.deepEqual(evidence.replayMetrics[0].modes, ["greedy"]);
  assert.deepEqual(evidence.replayMetrics[0].bestScoreSource, { budgetSeconds: 1, seed: 7, mode: "greedy" });
  assert.equal(evidence.replayMetrics[0].validationErrorCount, 0);
  assert.equal(evidence.replayMetrics[1].expansionComparisonLift, -115);

  const draft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    runId: "product-corpus-scorecard-2026-04-30-test",
    commands: [
      "node dist/crossModeBenchmarkCli.js --product-corpus --modes=greedy --budgets=1,5 --seeds=7 --json manual-layout-replay-warm-start expansion-comparison-replay"
    ],
    artifactPaths: ["artifacts/product-corpus/2026-04-30/scorecard.json"],
    decision: "benchmark-evidence-only"
  });
  assert.deepEqual(draft.cases, {
    development: ["manual-layout-replay-warm-start"],
    holdout: ["expansion-comparison-replay"]
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
      cases: result.cases.filter((scorecard) => scorecard.split === "development")
    },
    {
      commands: [
        "node dist/crossModeBenchmarkCli.js --product-corpus --modes=greedy --budgets=1,5 --seeds=7 --json manual-layout-replay-warm-start"
      ],
      artifactPaths: ["artifacts/product-corpus/2026-04-30/manual-only.json"]
    }
  );
  assert.equal(partialDraft.splitStatus.protectedHoldout, false);
  assert.equal(partialDraft.splitStatus.leakage, "not-evaluated");
  assert.deepEqual(partialDraft.cases, {
    development: ["manual-layout-replay-warm-start"],
    holdout: []
  });
  const partialEntry = completeExperimentRegistryEntry(partialDraft, {
    indexedAt: "2026-04-30",
    indexedGitCommit: testCommit,
    branch: "features/product-corpus-partial-registry-test",
    artifactGitCommit: testCommit,
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCores: 8,
      memoryGb: 16,
      gpuUsed: false
    }
  });
  const partialValidation = validateExperimentRegistryEntry(partialEntry, {
    rootDir: repoRoot,
    strict: true,
    validateArtifactPaths: false
  });
  assert.equal(partialValidation.issues.length, 0, formatExperimentRegistryIssues(partialValidation.issues));

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
      gpuUsed: false
    }
  });

  const validation = validateExperimentRegistryEntry(entry, {
    rootDir: repoRoot,
    strict: true,
    validateArtifactPaths: false
  });
  assert.equal(validation.issues.length, 0, formatExperimentRegistryIssues(validation.issues));
  assert.equal(validation.entry.runId, entry.runId);
}

async function testFullPromotionMatrixIsRequiredForProtectedHoldout() {
  const result = await runCrossModeBenchmarkSuite(DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS, {
    modes: [...PRODUCT_WORKFLOW_PROMOTION_MODES],
    budgetsSeconds: [...PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS],
    seeds: [...PRODUCT_WORKFLOW_PROMOTION_SEEDS],
    solve: () => emptySolution()
  });

  const evidence = buildCrossModeProductWorkflowEvidenceSummary(result);
  const expectedScorecardCount =
    DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.length *
    PRODUCT_WORKFLOW_PROMOTION_BUDGETS_SECONDS.length *
    PRODUCT_WORKFLOW_PROMOTION_SEEDS.length;
  assert.equal(evidence.promotionCoverage.protectedHoldout, true);
  assert.deepEqual(evidence.promotionCoverage.missingCaseNames, []);
  assert.deepEqual(evidence.promotionCoverage.missingModes, []);
  assert.deepEqual(evidence.promotionCoverage.missingBudgetsSeconds, []);
  assert.deepEqual(evidence.promotionCoverage.missingSeeds, []);
  assert.deepEqual(evidence.promotionCoverage.unexpectedSeeds, []);
  assert.equal(evidence.promotionCoverage.requiredSplitCoverage, true);
  assert.equal(evidence.promotionCoverage.requiredSeedCoverage, true);
  assert.deepEqual(evidence.promotionCoverage.splitMismatches, []);
  assert.equal(evidence.promotionCoverage.expectedScorecardCount, expectedScorecardCount);
  assert.equal(evidence.promotionCoverage.actualScorecardCount, expectedScorecardCount);
  assert.deepEqual(evidence.promotionCoverage.missingScorecards, []);
  assert.deepEqual(evidence.promotionCoverage.scorecardsMissingModes, []);
  assert.equal(evidence.caseMetrics.length, expectedScorecardCount);

  const draft = buildCrossModeProductWorkflowRegistryEntryDraft(result, {
    commands: [
      "node dist/crossModeBenchmarkCli.js --product-corpus --modes=auto,greedy,lns,cp-sat --budgets=1,5,30,120 --seeds=7,19,37 --json"
    ],
    artifactPaths: ["artifacts/product-corpus/2026-04-30/scorecard.json"]
  });
  assert.equal(draft.splitStatus.protectedHoldout, true);
  assert.equal(draft.splitStatus.leakage, "none");
  assert.equal(draft.budget.totalRuns, 480);

  const metadataOnlyResult = {
    ...result,
    cases: result.cases.filter((scorecard) => scorecard.budgetSeconds === 1 && scorecard.seed === 7)
  };
  const metadataOnlyEvidence = buildCrossModeProductWorkflowEvidenceSummary(metadataOnlyResult);
  assert.equal(metadataOnlyEvidence.promotionCoverage.protectedHoldout, false);
  assert.equal(metadataOnlyEvidence.promotionCoverage.expectedScorecardCount, 120);
  assert.equal(metadataOnlyEvidence.promotionCoverage.actualScorecardCount, 10);
  assert.equal(metadataOnlyEvidence.promotionCoverage.missingScorecards.length, 110);

  const wrongSeedResult = {
    ...result,
    seeds: [7, 19, 41],
    cases: result.cases.map((scorecard) => (scorecard.seed === 37 ? { ...scorecard, seed: 41 } : scorecard))
  };
  const wrongSeedEvidence = buildCrossModeProductWorkflowEvidenceSummary(wrongSeedResult);
  assert.equal(wrongSeedEvidence.promotionCoverage.protectedHoldout, false);
  assert.deepEqual(wrongSeedEvidence.promotionCoverage.missingSeeds, [37]);
  assert.deepEqual(wrongSeedEvidence.promotionCoverage.unexpectedSeeds, [41]);
  assert.equal(wrongSeedEvidence.promotionCoverage.requiredSeedCoverage, false);

  const missingModeResult = {
    ...result,
    cases: result.cases.map((scorecard, index) =>
      index === 0 ? { ...scorecard, results: scorecard.results.filter((entry) => entry.mode !== "cp-sat") } : scorecard
    )
  };
  const missingModeEvidence = buildCrossModeProductWorkflowEvidenceSummary(missingModeResult);
  assert.equal(missingModeEvidence.promotionCoverage.protectedHoldout, false);
  assert.deepEqual(missingModeEvidence.promotionCoverage.scorecardsMissingModes, [
    {
      caseName: result.cases[0].name,
      budgetSeconds: result.cases[0].budgetSeconds,
      seed: result.cases[0].seed,
      missingModes: ["cp-sat"]
    }
  ]);

  const splitMismatchResult = {
    ...result,
    cases: result.cases.map((scorecard) =>
      scorecard.name === "row0-corridor-repair-pressure" ? { ...scorecard, split: "development" } : scorecard
    )
  };
  const splitMismatchEvidence = buildCrossModeProductWorkflowEvidenceSummary(splitMismatchResult);
  assert.equal(splitMismatchEvidence.promotionCoverage.protectedHoldout, false);
  assert.deepEqual(splitMismatchEvidence.promotionCoverage.splitMismatches, [
    {
      caseName: "row0-corridor-repair-pressure",
      expectedSplit: "holdout",
      actualSplit: "development"
    }
  ]);
}

function testProductCorpusArtifactWriterCreatesRegistryDraft() {
  const artifactDir = "artifacts/tmp-product-corpus-registry-test";
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });

  try {
    const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
    const result = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        "--product-corpus",
        `--product-artifact-dir=${artifactDir}`,
        "--product-run-id=product-corpus-artifact-cli-test",
        "--product-decision=benchmark-evidence-only",
        "--product-summary=summary $HOME and 'quote'",
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "manual-layout-replay-warm-start",
        "expansion-comparison-replay"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.artifactDir, artifactDir);
    assert.equal(manifest.runId, "product-corpus-artifact-cli-test");
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.scorecardJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.scorecardText)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.evidenceSummaryJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.workflowReplayJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.workflowReplayTelemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.telemetryManifestJson)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.registryEntryDraftJson)), true);

    const scorecard = readJson(manifest.artifactPaths.scorecardJson);
    const evidence = readJson(manifest.artifactPaths.evidenceSummaryJson);
    const workflowReplay = readJson(manifest.artifactPaths.workflowReplayJson);
    const workflowReplayTelemetryManifest = readJson(manifest.artifactPaths.workflowReplayTelemetryManifestJson);
    const telemetryManifest = readJson(manifest.artifactPaths.telemetryManifestJson);
    const draft = readJson(manifest.artifactPaths.registryEntryDraftJson);
    assert.equal(scorecard.caseCount, 2);
    assert.deepEqual(evidence.splitCaseCounts, { development: 1, holdout: 1 });
    assert.equal(workflowReplay.length, 2);
    assert.deepEqual(workflowReplay.map((metric) => metric.workflowTag).sort(), [
      "expansion-comparison",
      "manual-layout-replay"
    ]);
    assert.equal(workflowReplayTelemetryManifest.schemaVersion, 1);
    assert.equal(workflowReplayTelemetryManifest.source, "product-workflow-replay");
    assert.equal(workflowReplayTelemetryManifest.suite.replayCount, 2);
    assert.equal(workflowReplayTelemetryManifest.suite.validReplayCount, 2);
    assert.equal(workflowReplayTelemetryManifest.suite.invalidReplayCount, 0);
    assert.deepEqual(workflowReplayTelemetryManifest.suite.apiRoutes, ["/api/layout/evaluate"]);
    assert.equal(workflowReplayTelemetryManifest.hardware.captured, true);
    assert.equal(telemetryManifest.schemaVersion, 1);
    assert.equal(telemetryManifest.source, "cross-mode-benchmark");
    assert.equal(telemetryManifest.suite.caseCount, 2);
    assert.equal(telemetryManifest.suite.totalRuns, 2);
    assert.equal(telemetryManifest.hardware.captured, true);
    assert.equal(typeof telemetryManifest.git.commit, "string");
    assert.equal(telemetryManifest.runs[0].solverParams.greedy.timeLimitSeconds, 1);
    assert.equal(typeof telemetryManifest.runs[0].timing.wallClockSeconds, "number");
    assert.equal(draft.splitStatus.protectedHoldout, false);
    assert.equal(draft.summary, "summary $HOME and 'quote'");
    assert(draft.commands[0].includes("'--product-summary=summary $HOME and "));
    assert(draft.commands[0].includes("'\\''quote'\\'''"));
    assert.equal(draft.commands[0].includes('"--product-summary'), false);
    assert.deepEqual(draft.artifactPaths, [
      manifest.artifactPaths.scorecardJson,
      manifest.artifactPaths.scorecardText,
      manifest.artifactPaths.evidenceSummaryJson,
      manifest.artifactPaths.workflowReplayJson,
      manifest.artifactPaths.workflowReplayTelemetryManifestJson,
      manifest.artifactPaths.telemetryManifestJson
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
        gpuUsed: false
      }
    });
    const validation = validateExperimentRegistryEntry(entry, {
      rootDir: repoRoot,
      strict: true,
      validateArtifactPaths: true
    });
    assert.equal(validation.issues.length, 0, formatExperimentRegistryIssues(validation.issues));
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

function testProductCorpusArtifactWriterValidatesRegistryEntryWithoutAppending() {
  const artifactDir = "artifacts/tmp-product-corpus-register-test";
  const registryPath = `${artifactDir}/index.jsonl`;
  const absoluteArtifactDir = path.join(repoRoot, artifactDir);
  fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });

  try {
    const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
    const dryRun = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        "--product-corpus",
        `--product-artifact-dir=${artifactDir}`,
        "--product-run-id=product-corpus-register-cli-test",
        "--product-register-dry-run",
        `--product-registry=${registryPath}`,
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "manual-layout-replay-warm-start"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const dryRunManifest = JSON.parse(dryRun.stdout);
    assert.deepEqual(dryRunManifest.registry, {
      registryPath,
      dryRun: true,
      appended: false,
      runId: "product-corpus-register-cli-test"
    });
    assert.equal(fs.existsSync(path.join(repoRoot, registryPath)), false);
    const dryRunDraft = readJson(dryRunManifest.artifactPaths.registryEntryDraftJson);
    assert.equal(dryRunDraft.commands[0].includes("--product-register-dry-run"), false);
    assert.equal(dryRunDraft.commands[0].includes("--product-registry="), false);

    const result = childProcess.spawnSync(
      process.execPath,
      [
        cliPath,
        "--product-corpus",
        `--product-artifact-dir=${artifactDir}`,
        "--product-run-id=product-corpus-register-cli-test",
        "--product-register",
        `--product-registry=${registryPath}`,
        "--modes=greedy",
        "--budgets=1",
        "--seeds=7",
        "--json",
        "manual-layout-replay-warm-start"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--product-register cannot append artifacts generated in the same command/);
    assert.equal(fs.existsSync(path.join(repoRoot, registryPath)), false);
  } finally {
    fs.rmSync(absoluteArtifactDir, { recursive: true, force: true });
  }
}

async function run() {
  testProductCorpusListingIsStableAndMetadataRich();
  testProductCorpusCliListMatchesExportedCorpus();
  testProductPromotionMatrixFlagGuardsLongRunArgs();
  await testProductCorpusScorecardCarriesRegistryCoverageMetadata();
  await testFullPromotionMatrixIsRequiredForProtectedHoldout();
  testProductCorpusArtifactWriterCreatesRegistryDraft();
  testProductCorpusArtifactWriterValidatesRegistryEntryWithoutAppending();
  console.log("Product corpus registry tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
