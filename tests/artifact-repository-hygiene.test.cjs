const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const trackedArtifactMaxBytes = 780 * 1024 * 1024;
const trackedArtifactFileMaxBytes = 14 * 1024 * 1024;
const trackedArtifactFileCountSoftMax = 1500;
const trackedArtifactFileCountMax = 1600;
const blockedTrackedArtifactPatterns = [/^artifacts\/solve-progress\//, /^artifacts\/tmp-[^/]*(?:\/|$)/];

function gitLsFiles(paths) {
  const result = childProcess.spawnSync("git", ["ls-files", "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || "git ls-files failed while enumerating artifact files"
  );
  return result.stdout
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);
}

function statTrackedFiles(filePaths) {
  return filePaths.map((filePath) => {
    const absolutePath = path.join(repoRoot, ...filePath.split("/"));
    const stats = fs.statSync(absolutePath);
    return {
      filePath,
      size: stats.size
    };
  });
}

function testTrackedArtifactsStayBounded() {
  const trackedArtifacts = statTrackedFiles(gitLsFiles(["artifacts"]));
  const totalBytes = trackedArtifacts.reduce((total, artifact) => total + artifact.size, 0);
  const oversizedFiles = trackedArtifacts.filter((artifact) => artifact.size > trackedArtifactFileMaxBytes);
  const blockedFiles = trackedArtifacts.filter((artifact) =>
    blockedTrackedArtifactPatterns.some((pattern) => pattern.test(artifact.filePath))
  );

  assert.equal(blockedFiles.length, 0, `scratch/progress artifact files should not be tracked: ${blockedFiles[0]}`);
  assert.equal(
    oversizedFiles.length,
    0,
    `tracked artifact file exceeds ${trackedArtifactFileMaxBytes} bytes: ${oversizedFiles[0]?.filePath}`
  );
  assert.ok(
    trackedArtifacts.length <= trackedArtifactFileCountMax,
    `tracked artifact count ${trackedArtifacts.length} exceeds ${trackedArtifactFileCountMax}`
  );
  assert.ok(
    totalBytes <= trackedArtifactMaxBytes,
    `tracked artifact bytes ${totalBytes} exceed ${trackedArtifactMaxBytes}`
  );

  if (trackedArtifacts.length > trackedArtifactFileCountSoftMax) {
    console.warn(
      `[artifact-hygiene] tracked artifact count ${trackedArtifacts.length} exceeds soft target ` +
        `${trackedArtifactFileCountSoftMax}; hard cap is ${trackedArtifactFileCountMax}. ` +
        "Run npm run artifact-hygiene:inventory and pair broad evidence runs with an externalization plan."
    );
  }
}

function testInventoryReportsSoftCapState() {
  const trackedArtifactCount = gitLsFiles(["artifacts"]).length;
  const result = childProcess.spawnSync(
    process.execPath,
    ["scripts/prepare-artifact-hygiene-recovery.mjs", "--inventory"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message || "artifact hygiene inventory failed");

  const inventory = JSON.parse(result.stdout);
  const softLimitExceeded = trackedArtifactCount > trackedArtifactFileCountSoftMax;

  assert.equal(inventory.trackedArtifactCount, trackedArtifactCount);
  assert.equal(inventory.trackedArtifactFileCountSoftMax, trackedArtifactFileCountSoftMax);
  assert.equal(inventory.trackedArtifactFileCountHardMax, trackedArtifactFileCountMax);
  assert.equal(
    inventory.trackedArtifactCountOverSoftLimit,
    Math.max(0, trackedArtifactCount - trackedArtifactFileCountSoftMax)
  );
  assert.equal(inventory.trackedArtifactHardLimitRemaining, trackedArtifactFileCountMax - trackedArtifactCount);
  assert.equal(inventory.softLimitExceeded, softLimitExceeded);
  assert.equal(inventory.hardLimitExceeded, trackedArtifactCount > trackedArtifactFileCountMax);
  assert.equal(inventory.artifactHygieneStatus, softLimitExceeded ? "soft-warning" : "pass");

  if (softLimitExceeded) {
    assert.ok(
      inventory.warnings.some((warning) => warning.code === "tracked-artifact-soft-cap"),
      "inventory should include a soft-cap warning when the tracked artifact count exceeds the soft target"
    );
  } else {
    assert.deepEqual(inventory.warnings, []);
  }
}

function testStatusReportsActionableSoftCapState() {
  const trackedArtifactCount = gitLsFiles(["artifacts"]).length;
  const result = childProcess.spawnSync(
    process.execPath,
    ["scripts/prepare-artifact-hygiene-recovery.mjs", "--status"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message || "artifact hygiene status failed");

  const softLimitExceeded = trackedArtifactCount > trackedArtifactFileCountSoftMax;
  assert.match(result.stdout, /artifactHygieneStatus=(pass|soft-warning)/);
  assert.match(
    result.stdout,
    new RegExp(`trackedArtifactCount=${trackedArtifactCount}/${trackedArtifactFileCountMax}`)
  );
  assert.match(result.stdout, new RegExp(`softTarget=${trackedArtifactFileCountSoftMax}`));
  assert.match(
    result.stdout,
    new RegExp(`softOverage=${Math.max(0, trackedArtifactCount - trackedArtifactFileCountSoftMax)}`)
  );
  assert.match(result.stdout, new RegExp(`hardCapHeadroom=${trackedArtifactFileCountMax - trackedArtifactCount}`));
  assert.match(result.stdout, /unindexedRawCandidates=\d+/);
  assert.match(result.stdout, /nextAction=/);

  if (softLimitExceeded) {
    assert.match(result.stdout, /warning\[tracked-artifact-soft-cap\]=/);
  } else {
    assert.doesNotMatch(result.stdout, /warning\[tracked-artifact-soft-cap\]=/);
  }
}

testTrackedArtifactsStayBounded();
testInventoryReportsSoftCapState();
testStatusReportsActionableSoftCapState();
