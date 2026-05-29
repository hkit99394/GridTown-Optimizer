const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const trackedArtifactMaxBytes = 780 * 1024 * 1024;
const trackedArtifactFileMaxBytes = 14 * 1024 * 1024;
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
}

testTrackedArtifactsStayBounded();
