const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendExperimentRegistryEntry,
  checkExperimentRegistryFile,
  completeExperimentRegistryEntry,
  formatExperimentRegistryIssues,
  validateExperimentRegistryEntry,
} = require("../dist/benchmarks/index.js");

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
      gpuUsed: false,
    },
    model: null,
    decision: "no-default-promotion",
    summary: "Benchmark registry test fixture.",
    ...overrides,
  };
}

function testSeedRegistryChecksWithoutShapeErrors() {
  const result = checkExperimentRegistryFile("artifacts/experiments/index.jsonl", { rootDir: repoRoot });
  assert.equal(result.valid, true, formatExperimentRegistryIssues(result.issues));
  assert.equal(result.entries.length >= 4, true);

  const strictResult = checkExperimentRegistryFile("artifacts/experiments/index.jsonl", {
    rootDir: repoRoot,
    strict: true,
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
    caseFamilies: null,
  });
  const benchmarkResult = validateExperimentRegistryEntry(benchmark, { rootDir: repoRoot, validateArtifactPaths: false, strict: true });

  assert.equal(benchmarkResult.issues.length >= 5, true);
  assert.match(formatExperimentRegistryIssues(benchmarkResult.issues), /strict registry checks require captured hardware metadata/);
  assert.match(formatExperimentRegistryIssues(benchmarkResult.issues), /Field 'seeds' must be a non-empty array/);

  const labelBundle = createBaseEntry({
    runId: "registry-test-labels",
    artifactType: "label-bundle",
    model: null,
  });
  const labelResult = validateExperimentRegistryEntry(labelBundle, { rootDir: repoRoot, validateArtifactPaths: false, strict: true });

  assert.equal(labelResult.issues.some((issue) => /label-bundle entries must include model metadata/.test(issue.message)), true);
}

function testAppendHelperAddsCommitCommandBudgetHardwareModelAndDecisionMetadata() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-registry-helper-"));
  fs.writeFileSync(path.join(tempDir, "artifact.json"), "{}\n");

  const entry = completeExperimentRegistryEntry(createBaseEntry(), {
    indexedAt: "2026-04-28",
    indexedGitCommit: testCommit,
    branch: "features/registry-test",
    artifactGitCommit: testCommit,
  });
  const appended = appendExperimentRegistryEntry("index.jsonl", entry, {
    rootDir: tempDir,
    strict: true,
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
    strict: true,
  });
  assert.equal(validation.valid, true, formatExperimentRegistryIssues(validation.issues));
}

function runRegistryCli(args, cwd) {
  const cliPath = path.join(repoRoot, "dist", "experimentRegistryCli.js");
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
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
      summary: "CLI label append fixture.",
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
      `--artifact-git-commit=${testCommit}`,
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

testSeedRegistryChecksWithoutShapeErrors();
testStrictMetadataRulesForBenchmarkAndLabelEntries();
testAppendHelperAddsCommitCommandBudgetHardwareModelAndDecisionMetadata();
testRegistryCliCanAppendAndCheckLabelArtifacts();

console.log("Experiment registry tests passed.");
