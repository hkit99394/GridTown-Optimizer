const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendExperimentRegistryEntry,
  buildBenchmarkArtifactDateSlug,
  buildBenchmarkArtifactRunId,
  cloneBenchmarkArtifactPaths,
  cloneBenchmarkArtifactRecord,
  buildModelExperimentRegistryEntryDraft,
  buildModelExperimentTelemetryManifest,
  checkExperimentRegistryFile,
  completeExperimentRegistryEntry,
  ExperimentRegistryValidationError,
  formatExperimentRegistryIssues,
  validateExperimentRegistryFile,
  validateExperimentRegistryEntry
} = require("city-builder/benchmarks");

const repoRoot = path.join(__dirname, "..");
const testCommit = "1234567890abcdef1234567890abcdef12345678";

function createBaseEntry(overrides = {}) {
  return {
    schemaVersion: 1,
    runId: "registry-test-benchmark",
    artifactType: "benchmark",
    generatedAt: "2026-04-28T12:00:00.000Z",
    indexedAt: "2026-04-28",
    indexedGitCommit: testCommit,
    branch: "features/registry-test",
    artifactGitCommit: testCommit,
    commands: ["node dist/crossModeBenchmarkCli.js --json typed-housing-single"],
    artifactPaths: ["artifact.json"],
    cases: ["typed-housing-single"],
    caseFamilies: ["tiny"],
    seeds: [7],
    splitStatus: { protectedHoldout: false, notes: "Development benchmark smoke coverage." },
    budget: { wallClockBudgetsSeconds: [5], cpuBudgetSeconds: 5, observedCpuSeconds: 4.2 },
    hardware: {
      captured: true,
      cpuModel: "Test CPU",
      logicalCores: 8,
      memoryGb: 16,
      gpuUsed: false
    },
    model: null,
    decision: "no-default-promotion",
    summary: "Benchmark registry test fixture.",
    ...overrides
  };
}

function testSeedRegistryChecksWithoutShapeErrors() {
  const result = checkExperimentRegistryFile("artifacts/experiments/index.jsonl", { rootDir: repoRoot });
  assert.equal(result.valid, true, formatExperimentRegistryIssues(result.issues));
  assert.equal(result.entries.length >= 4, true);

  const strictResult = checkExperimentRegistryFile("artifacts/experiments/index.jsonl", {
    rootDir: repoRoot,
    strict: true
  });
  assert.equal(
    strictResult.issues.some((issue) => issue.code === "strict-missing-hardware"),
    true
  );
}

function testStrictMetadataRulesForBenchmarkAndLabelEntries() {
  const benchmark = createBaseEntry({
    hardware: { captured: false, gpuUsed: false },
    budget: {},
    splitStatus: null,
    seeds: null,
    cases: null,
    caseFamilies: null
  });
  const benchmarkResult = validateExperimentRegistryEntry(benchmark, {
    rootDir: repoRoot,
    validateArtifactPaths: false,
    strict: true
  });

  assert.equal(benchmarkResult.issues.length >= 5, true);
  assert.match(
    formatExperimentRegistryIssues(benchmarkResult.issues),
    /strict registry checks require captured hardware metadata/
  );
  assert.match(formatExperimentRegistryIssues(benchmarkResult.issues), /Field 'seeds' must be a non-empty array/);

  const labelBundle = createBaseEntry({
    runId: "registry-test-labels",
    artifactType: "label-bundle",
    model: null
  });
  const labelResult = validateExperimentRegistryEntry(labelBundle, {
    rootDir: repoRoot,
    validateArtifactPaths: false,
    strict: true
  });

  assert.equal(
    labelResult.issues.some((issue) => /label-bundle entries must include model metadata/.test(issue.message)),
    true
  );
}

function testRegistryRejectsOutOfRangeSeeds() {
  const negativeSeedResult = validateExperimentRegistryEntry(createBaseEntry({ seeds: [-1] }), {
    rootDir: repoRoot,
    validateArtifactPaths: false
  });
  assert.equal(
    negativeSeedResult.issues.some(
      (issue) => issue.code === "invalid-seed" && /between 0 and 2147483647/.test(issue.message)
    ),
    true
  );

  const overflowSeedResult = validateExperimentRegistryEntry(createBaseEntry({ seeds: [2147483648] }), {
    rootDir: repoRoot,
    validateArtifactPaths: false
  });
  assert.equal(
    overflowSeedResult.issues.some(
      (issue) => issue.code === "invalid-seed" && /between 0 and 2147483647/.test(issue.message)
    ),
    true
  );
}

function testModelExperimentManifestAndRegistryDraft() {
  assert.equal(buildBenchmarkArtifactDateSlug("2026-05-01T00:00:00.000Z"), "2026-05-01");
  assert.equal(buildBenchmarkArtifactDateSlug("not-a-date-value"), "not-a-date");
  assert.equal(buildBenchmarkArtifactDateSlug(""), "unknown-date");
  assert.equal(
    buildBenchmarkArtifactRunId("model-experiment", "2026-05-01T00:00:00.000Z", "abc123"),
    "model-experiment-2026-05-01-abc123"
  );
  const artifactPaths = ["artifacts/models/test/model.json"];
  const clonedPaths = cloneBenchmarkArtifactPaths(artifactPaths);
  assert.deepEqual(clonedPaths, artifactPaths);
  assert.notEqual(clonedPaths, artifactPaths);
  const metadataRecord = { nested: { ok: true } };
  const clonedRecord = cloneBenchmarkArtifactRecord(metadataRecord);
  assert.deepEqual(clonedRecord, metadataRecord);
  assert.notEqual(clonedRecord.nested, metadataRecord.nested);

  const telemetryManifest = buildModelExperimentTelemetryManifest({
    command: "python python/ml/train.py --config=config.json",
    generatedAt: "2026-05-01T00:00:00.000Z",
    git: { commit: testCommit, branch: "features/model-contract-test" },
    hardware: { captured: true, cpuModel: "Test CPU", logicalCores: 8, memoryGb: 16, gpuUsed: false },
    model: { trained: true, version: "test-model-v1", format: "json" },
    inputArtifacts: ["artifacts/learned-ranking-labels/2026-05-01/bundle/labels.json"],
    outputArtifacts: ["artifacts/models/test/model.json"],
    labelFingerprint: "fnv1a:labels001",
    modelFingerprint: "fnv1a:model0001",
    metrics: { holdoutAccuracy: 0.75 },
    notes: "Registry helper contract only; no solver default changed."
  });

  assert.equal(telemetryManifest.source, "model-experiment");
  assert.equal(telemetryManifest.modelFingerprint, "fnv1a:model0001");
  assert.deepEqual(telemetryManifest.outputArtifacts, ["artifacts/models/test/model.json"]);

  const inferredTelemetryManifest = buildModelExperimentTelemetryManifest({
    command: telemetryManifest.command,
    generatedAt: telemetryManifest.generatedAt,
    model: { trained: true, version: "test-model-v1", format: "json" }
  });
  const inferredDraft = buildModelExperimentRegistryEntryDraft({
    commands: [telemetryManifest.command],
    artifactPaths: ["artifacts/models/test/model.json"],
    generatedAt: telemetryManifest.generatedAt,
    model: { trained: true, version: "test-model-v1", format: "json" }
  });
  assert.equal(inferredTelemetryManifest.modelFingerprint, inferredDraft.modelFingerprint);
  assert.equal(inferredDraft.runId, "model-experiment-2026-05-01");

  const draft = buildModelExperimentRegistryEntryDraft({
    runId: "model-experiment-test",
    generatedAt: telemetryManifest.generatedAt,
    commands: [telemetryManifest.command],
    artifactPaths: ["artifacts/models/test/model.json", "artifacts/models/test/telemetry-manifest.json"],
    cases: { development: ["case-a"], holdout: ["case-b"] },
    caseFamilies: ["model-fixture"],
    seeds: [7],
    splitStatus: { protectedHoldout: true },
    budget: { trainSeconds: 12, observedCpuSeconds: 10.5 },
    model: telemetryManifest.model,
    labelFingerprint: telemetryManifest.labelFingerprint,
    modelFingerprint: telemetryManifest.modelFingerprint,
    summaryMetrics: telemetryManifest.metrics
  });
  assert.equal(draft.artifactType, "model-experiment");
  assert.equal(draft.decision, "model-experiment-only");
  assert.equal(draft.summary, "Model experiment artifact; no solver default changed.");

  const entry = completeExperimentRegistryEntry(draft, {
    indexedAt: "2026-05-01",
    indexedGitCommit: testCommit,
    branch: "features/model-contract-test",
    artifactGitCommit: testCommit,
    hardware: { captured: true, cpuModel: "Test CPU", logicalCores: 8, memoryGb: 16, gpuUsed: false }
  });
  const validation = validateExperimentRegistryEntry(entry, {
    rootDir: repoRoot,
    validateArtifactPaths: false,
    strict: true
  });
  assert.equal(validation.issues.length, 0, formatExperimentRegistryIssues(validation.issues));
}

function testAppendHelperAddsCommitCommandBudgetHardwareModelAndDecisionMetadata() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-helper-"));
  fs.writeFileSync(path.join(tempDir, "artifact.json"), "{}\n");

  const entry = completeExperimentRegistryEntry(createBaseEntry(), {
    indexedAt: "2026-04-28",
    indexedGitCommit: testCommit,
    branch: "features/registry-test",
    artifactGitCommit: testCommit
  });
  const appended = appendExperimentRegistryEntry("index.jsonl", entry, {
    rootDir: tempDir,
    strict: true
  });

  assert.equal(appended.indexedAt, "2026-04-28");
  assert.equal(appended.indexedGitCommit, testCommit);
  assert.equal(appended.branch, "features/registry-test");
  assert.deepEqual(appended.commands, ["node dist/crossModeBenchmarkCli.js --json typed-housing-single"]);
  assert.equal(appended.hardware.captured, true);
  assert.equal(appended.decision, "no-default-promotion");

  const registry = fs.readFileSync(path.join(tempDir, "index.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.equal(registry.length, 1);
  const validation = checkExperimentRegistryFile("index.jsonl", {
    rootDir: tempDir,
    strict: true
  });
  assert.equal(validation.valid, true, formatExperimentRegistryIssues(validation.issues));
}

function isInvalidRegistryPathError(error) {
  assert.equal(error instanceof ExperimentRegistryValidationError, true);
  assert.equal(
    error.issues.some((issue) => issue.code === "invalid-registry-path"),
    true
  );
  return true;
}

function testRegistryFileHelpersRejectUnsafeRegistryPaths() {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-path-parent-"));
  const tempDir = path.join(parentDir, "repo");
  fs.mkdirSync(tempDir);

  assert.throws(
    () => checkExperimentRegistryFile("../outside.jsonl", { rootDir: tempDir }),
    isInvalidRegistryPathError
  );
  assert.throws(
    () => validateExperimentRegistryFile(path.join(tempDir, "absolute.jsonl"), { rootDir: tempDir }),
    isInvalidRegistryPathError
  );
  assert.throws(
    () =>
      appendExperimentRegistryEntry("../outside.jsonl", createBaseEntry(), {
        rootDir: tempDir,
        validateArtifactPaths: false
      }),
    isInvalidRegistryPathError
  );
  assert.throws(
    () =>
      appendExperimentRegistryEntry(path.join(tempDir, "absolute.jsonl"), createBaseEntry(), {
        rootDir: tempDir,
        validateArtifactPaths: false
      }),
    isInvalidRegistryPathError
  );

  assert.equal(fs.existsSync(path.join(parentDir, "outside.jsonl")), false);
  assert.equal(fs.existsSync(path.join(tempDir, "absolute.jsonl")), false);
}

function testCompleteEntryPreservesExplicitNullArtifactCommit() {
  const entry = completeExperimentRegistryEntry(createBaseEntry({ artifactGitCommit: null }), {
    indexedAt: "2026-04-28",
    indexedGitCommit: testCommit,
    branch: "features/registry-test",
    artifactGitCommit: testCommit
  });

  assert.equal(entry.artifactGitCommit, null);
}

function testSeedRegistryHistoricalWarningBudget() {
  const result = validateExperimentRegistryFile("artifacts/experiments/index.jsonl", { rootDir: repoRoot });
  assert.equal(result.valid, true, formatExperimentRegistryIssues(result.issues));
  assert.equal(result.errorCount, 0, formatExperimentRegistryIssues(result.issues));
  assert.deepEqual(
    result.issues.map(({ lineNumber, runId, code, severity }) => ({ lineNumber, runId, code, severity })),
    [
      {
        lineNumber: 1,
        runId: "deterministic-ablations-2026-04-27",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      },
      {
        lineNumber: 1,
        runId: "deterministic-ablations-2026-04-27",
        code: "historical-missing-hardware",
        severity: "warning"
      },
      {
        lineNumber: 1,
        runId: "deterministic-ablations-2026-04-27",
        code: "historical-abbreviated-command",
        severity: "warning"
      },
      {
        lineNumber: 2,
        runId: "learned-ranking-labels-2026-04-27",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      },
      {
        lineNumber: 2,
        runId: "learned-ranking-labels-2026-04-27",
        code: "historical-missing-hardware",
        severity: "warning"
      },
      {
        lineNumber: 3,
        runId: "cp-sat-portfolio-measurement-2026-04-28",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      },
      {
        lineNumber: 3,
        runId: "cp-sat-portfolio-measurement-2026-04-28",
        code: "historical-missing-hardware",
        severity: "warning"
      },
      {
        lineNumber: 4,
        runId: "next-stage-health-check-2026-04-28",
        code: "historical-missing-hardware",
        severity: "warning"
      },
      {
        lineNumber: 5,
        runId: "cp-sat-road-semantics-scorecard-2026-04-30",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      },
      {
        lineNumber: 6,
        runId: "product-corpus-scorecard-2026-04-30-initial-1s-5s-seed7",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      },
      {
        lineNumber: 7,
        runId: "product-corpus-scorecard-2026-04-30-initial-1s-5s-seed7-v2",
        code: "historical-missing-artifact-commit",
        severity: "warning"
      }
    ]
  );
}

function testHistoricalWarningsUseOriginalRegistryLineNumbers() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-line-numbers-"));
  fs.writeFileSync(path.join(tempDir, "artifact.json"), "{}\n");
  const historicalEntry = createBaseEntry({
    runId: "historical-warning-after-skipped-lines",
    artifactGitCommit: null,
    artifactPaths: ["artifact.json"],
    hardware: { captured: false, gpuUsed: false }
  });
  fs.writeFileSync(
    path.join(tempDir, "index.jsonl"),
    [
      "",
      "# registry note before the next accepted row",
      JSON.stringify({ schemaVersion: 1, runId: "invalid-before-historical-warning" }),
      JSON.stringify(historicalEntry)
    ].join("\n")
  );

  const result = validateExperimentRegistryFile("index.jsonl", { rootDir: tempDir });
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "malformed-json" && issue.lineNumber === 2),
    true,
    formatExperimentRegistryIssues(result.issues)
  );
  assert.equal(
    result.issues.some((issue) => issue.code === "missing-field" && issue.lineNumber === 3),
    true,
    formatExperimentRegistryIssues(result.issues)
  );
  assert.deepEqual(
    result.issues
      .filter((issue) => issue.runId === "historical-warning-after-skipped-lines" && issue.severity === "warning")
      .map(({ lineNumber, code }) => ({ lineNumber, code })),
    [
      { lineNumber: 4, code: "historical-missing-artifact-commit" },
      { lineNumber: 4, code: "historical-missing-hardware" }
    ]
  );
}

function runRegistryCli(args, cwd) {
  const cliPath = path.join(repoRoot, "dist", "experimentRegistryCli.js");
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function testRegistryCliDefaultCheckHidesAcceptedHistoricalWarnings() {
  const checkResult = runRegistryCli(["check", "--json"], repoRoot);
  assert.equal(checkResult.status, 0, checkResult.stderr || checkResult.stdout);
  const payload = JSON.parse(checkResult.stdout);
  assert.equal(payload.valid, true);
  assert.equal(payload.errorCount, 0);
  assert.equal(payload.warningCount, 0);

  const historicalResult = runRegistryCli(["check", "--historical-warnings", "--json"], repoRoot);
  assert.equal(historicalResult.status, 0, historicalResult.stderr || historicalResult.stdout);
  const historicalPayload = JSON.parse(historicalResult.stdout);
  assert.equal(historicalPayload.valid, true);
  assert.equal(historicalPayload.errorCount, 0);
  assert.equal(historicalPayload.warningCount, 11);
  assert.equal(
    historicalPayload.issues.some((issue) => issue.code === "historical-missing-artifact-commit"),
    true
  );
}

function testRegistryCliCanAppendAndCheckLabelArtifacts() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-cli-"));
  fs.writeFileSync(path.join(tempDir, "labels.json"), "{}\n");
  fs.writeFileSync(
    path.join(tempDir, "entry.json"),
    `${JSON.stringify({
      runId: "registry-cli-labels",
      artifactType: "label-bundle",
      generatedAt: "2026-04-28T15:00:00.000Z",
      commands: ["node dist/learnedRankingLabelCli.js --json"],
      artifactPaths: ["labels.json"],
      cases: { development: ["case-a"], holdout: ["case-b"] },
      caseFamilies: ["label-fixture"],
      seeds: [7, 19],
      splitStatus: { protectedHoldout: true, development: "case-a", holdout: "case-b" },
      budget: { lnsRepairSeconds: 1, cpuBudgetSeconds: 2, observedCpuSeconds: 1.5 },
      hardware: { captured: true, cpuModel: "Test CPU", logicalCores: 8, memoryGb: 16, gpuUsed: false },
      model: { trained: false, version: null },
      decision: "offline-diagnostics-only",
      summary: "CLI label append fixture."
    })}\n`
  );

  const appendResult = runRegistryCli(
    [
      "append",
      "--registry=index.jsonl",
      "--entry=entry.json",
      "--indexed-at=2026-04-28",
      `--indexed-git-commit=${testCommit}`,
      "--branch=features/registry-test",
      `--artifact-git-commit=${testCommit}`
    ],
    tempDir
  );
  assert.equal(appendResult.status, 0, appendResult.stderr || appendResult.stdout);
  assert.match(appendResult.stdout, /registry-cli-labels/);

  const checkResult = runRegistryCli(["check", "--registry=index.jsonl", "--strict", "--json"], tempDir);
  assert.equal(checkResult.status, 0, checkResult.stderr || checkResult.stdout);
  const payload = JSON.parse(checkResult.stdout);
  assert.equal(payload.entryCount, 1);
  assert.equal(payload.valid, true);
  assert.deepEqual(payload.issues, []);
}

function testRegistryCliRejectsUnsafeDryRunAppendRegistryPath() {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-cli-path-parent-"));
  const tempDir = path.join(parentDir, "repo");
  fs.mkdirSync(tempDir);
  fs.writeFileSync(path.join(tempDir, "artifact.json"), "{}\n");
  fs.writeFileSync(path.join(tempDir, "entry.json"), `${JSON.stringify(createBaseEntry())}\n`);

  const traversalResult = runRegistryCli(
    ["append", "--dry-run", "--registry=../outside.jsonl", "--entry=entry.json"],
    tempDir
  );
  assert.equal(traversalResult.status, 1, traversalResult.stderr || traversalResult.stdout);
  assert.match(traversalResult.stderr, /invalid-registry-path/);
  assert.equal(fs.existsSync(path.join(parentDir, "outside.jsonl")), false);

  const absoluteRegistryPath = path.join(tempDir, "absolute.jsonl");
  const absoluteResult = runRegistryCli(
    ["append", "--dry-run", `--registry=${absoluteRegistryPath}`, "--entry=entry.json"],
    tempDir
  );
  assert.equal(absoluteResult.status, 1, absoluteResult.stderr || absoluteResult.stdout);
  assert.match(absoluteResult.stderr, /invalid-registry-path/);
  assert.equal(fs.existsSync(absoluteRegistryPath), false);
}

testSeedRegistryChecksWithoutShapeErrors();
testStrictMetadataRulesForBenchmarkAndLabelEntries();
testRegistryRejectsOutOfRangeSeeds();
testModelExperimentManifestAndRegistryDraft();
testAppendHelperAddsCommitCommandBudgetHardwareModelAndDecisionMetadata();
testRegistryFileHelpersRejectUnsafeRegistryPaths();
testCompleteEntryPreservesExplicitNullArtifactCommit();
testSeedRegistryHistoricalWarningBudget();
testHistoricalWarningsUseOriginalRegistryLineNumbers();
testRegistryCliDefaultCheckHidesAcceptedHistoricalWarnings();
testRegistryCliCanAppendAndCheckLabelArtifacts();
testRegistryCliRejectsUnsafeDryRunAppendRegistryPath();

console.log("Experiment registry tests passed.");
