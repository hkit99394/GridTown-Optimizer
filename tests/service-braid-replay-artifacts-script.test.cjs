const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-service-braid-replay-artifacts-${process.pid}`);
const obsoleteModelDir = path.join(tempRoot, "obsolete-model");
const outputDir = path.join(tempRoot, "out");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  fs.mkdirSync(obsoleteModelDir, { recursive: true });
  fs.writeFileSync(path.join(obsoleteModelDir, "OBSOLETE.md"), "Quarantined test model.\n");
  fs.writeFileSync(path.join(obsoleteModelDir, "model.json"), JSON.stringify({ weights: { area: 1 } }, null, 2));

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/generate-service-braid-replay-artifacts.mjs",
      "--bundle=service-braid-range1-big-service135",
      "--online-ablation",
      `--online-artifact-dir=${repoRelative(outputDir)}`,
      `--window-ranker-model=${repoRelative(path.join(obsoleteModelDir, "model.json"))}`,
      "--window-ranker-min-score-delta=0",
      "--lns-iterations=1",
      "--force-artifact-dir"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--window-ranker-model points to obsolete artifact bundle/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Service-braid replay artifact script tests passed.");
