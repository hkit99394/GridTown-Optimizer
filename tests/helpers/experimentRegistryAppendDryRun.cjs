const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

function repoRelative(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function assertRegistryDraftAppendDryRun(repoRoot, registryPath, options = {}) {
  const relativeRegistryPath = repoRelative(repoRoot, registryPath);
  const scratchRegistryPath =
    options.scratchRegistryPath ??
    path.posix.join("artifacts", `tmp-experiment-registry-append-dry-run-${process.pid}.jsonl`);
  const result = childProcess.spawnSync(
    process.execPath,
    [
      "dist/experimentRegistryCli.js",
      "append",
      "--dry-run",
      `--registry=${scratchRegistryPath}`,
      `--entry=${relativeRegistryPath}`
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  assert.equal(
    result.status,
    0,
    [
      `${relativeRegistryPath} failed experiment registry append dry-run.`,
      result.stdout.trim(),
      result.stderr.trim(),
      result.error?.message
    ]
      .filter(Boolean)
      .join("\n")
  );
}

module.exports = { assertRegistryDraftAppendDryRun };
