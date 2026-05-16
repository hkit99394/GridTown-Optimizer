const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  prepareArtifactBundleDirectory,
  resolveRepoInputPath,
  writeJsonArtifact,
  writeTextArtifact
} = require("../dist/tools/cli/artifactBundleHelpers.js");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-artifact-bundle-helpers-${process.pid}`);
const relativeTempRoot = path.relative(repoRoot, tempRoot).split(path.sep).join(path.posix.sep);

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  const freshDir = `${relativeTempRoot}/fresh`;
  const fresh = prepareArtifactBundleDirectory(freshDir, "--artifact-dir");
  assert.equal(fresh.artifactDir, freshDir);
  assert.equal(fs.existsSync(fresh.absoluteArtifactDir), true);
  writeJsonArtifact(fresh.absoluteArtifactPath("manifest.json"), { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh.absoluteArtifactPath("manifest.json"), "utf8")), { ok: true });

  assert.throws(
    () => prepareArtifactBundleDirectory("tmp/not-artifacts", "--artifact-dir"),
    /--artifact-dir must be under artifacts\//
  );
  assert.throws(() => prepareArtifactBundleDirectory("artifacts", "--artifact-dir"), /must be under artifacts\//);
  assert.throws(() => resolveRepoInputPath("..", "--input"), /--input must stay inside the repository: \.\./);
  assert.throws(
    () => resolveRepoInputPath(path.dirname(repoRoot), "--input"),
    /--input must stay inside the repository: /
  );

  const nonEmptyDir = `${relativeTempRoot}/non-empty`;
  const absoluteNonEmptyDir = path.join(repoRoot, nonEmptyDir);
  fs.mkdirSync(absoluteNonEmptyDir, { recursive: true });
  fs.writeFileSync(path.join(absoluteNonEmptyDir, "existing.txt"), "old");

  assert.throws(
    () => prepareArtifactBundleDirectory(nonEmptyDir, "--artifact-dir"),
    /already exists and is not empty; pass --force-artifact-dir/
  );

  const forced = prepareArtifactBundleDirectory(nonEmptyDir, "--artifact-dir", { force: true });
  assert.equal(forced.artifactDir, nonEmptyDir);
  assert.throws(() => writeTextArtifact(forced.absoluteArtifactPath("existing.txt"), "new"), /EEXIST/);
  writeTextArtifact(forced.absoluteArtifactPath("existing.txt"), "new", { force: true });
  assert.equal(fs.readFileSync(forced.absoluteArtifactPath("existing.txt"), "utf8"), "new");

  const cliArtifactDir = `${relativeTempRoot}/cli-scorecard`;
  const absoluteCliArtifactDir = path.join(repoRoot, cliArtifactDir);
  fs.mkdirSync(absoluteCliArtifactDir, { recursive: true });
  fs.writeFileSync(path.join(absoluteCliArtifactDir, "existing.txt"), "old");

  const cliPath = path.join(repoRoot, "dist", "crossModeBenchmarkCli.js");
  const cliArgs = [
    cliPath,
    `--artifact-dir=${cliArtifactDir}`,
    "--modes=greedy",
    "--budgets=1",
    "--seeds=7",
    "--json",
    "typed-housing-single"
  ];
  const refused = childProcess.spawnSync(process.execPath, cliArgs, { cwd: repoRoot, encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /already exists and is not empty; pass --force-artifact-dir/);

  const forcedCli = childProcess.spawnSync(process.execPath, [...cliArgs, "--force-artifact-dir"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(forcedCli.status, 0, forcedCli.stderr || forcedCli.stdout);
  const manifest = JSON.parse(forcedCli.stdout);
  assert.equal(manifest.artifactDir, cliArtifactDir);
  assert.equal(fs.existsSync(path.join(repoRoot, manifest.artifactPaths.scorecardJson)), true);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Artifact bundle helper tests passed.");
